/**
 * Tests cho WebSocket JWT auth + room isolation (MDI-02, MDI-07).
 *
 * Behavior:
 *  1. Client connect KHÔNG có auth.token → connect_error 'UNAUTHENTICATED'
 *  2. Client connect với token invalid → connect_error 'INVALID_TOKEN'
 *  3. Client connect với token valid → connect success, auto join user:{userId}
 *  4. Sau auth: subscribe_symbol('VNM') → join symbol:VNM, emit 'subscribed'
 *  5. broadcastNotification(B, ...): A KHÔNG nhận, B nhận (user room isolation)
 *
 * Strategy: real httpServer.listen(0) + real socket.io server + real socket.io-client.
 * Set process.env.JWT_SECRET trước khi import initializeWebSocket.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { io as ioc } from 'socket.io-client';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-mdi-02';

const { initializeWebSocket, broadcastNotification, broadcastPriceUpdate } =
  await import('../../services/shared/websocket.js');

let httpServer;
let io;
let port;

function serverUrl() {
  return `http://localhost:${port}`;
}

function signToken(userId, opts = {}) {
  return jwt.sign({ userId, email: `${userId}@test.vn` }, process.env.JWT_SECRET, {
    expiresIn: '1h',
    ...opts,
  });
}

function waitEvent(client, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeoutMs);
    client.once(event, (...args) => {
      clearTimeout(to);
      resolve(args.length === 1 ? args[0] : args);
    });
  });
}

describe('WebSocket JWT auth + room isolation (MDI-02, MDI-07)', () => {
  beforeAll(async () => {
    httpServer = createServer();
    io = initializeWebSocket(httpServer);
    await new Promise((r) => httpServer.listen(0, r));
    port = httpServer.address().port;
  });

  afterAll(async () => {
    io.close();
    await new Promise((r) => httpServer.close(r));
  });

  it('Scenario 1: no token → connect_error UNAUTHENTICATED', async () => {
    const client = ioc(serverUrl(), {
      auth: {},
      reconnection: false,
      transports: ['websocket'],
    });

    const err = await waitEvent(client, 'connect_error');
    expect(err.message).toBe('UNAUTHENTICATED');
    client.close();
  });

  it('Scenario 2: invalid token → connect_error INVALID_TOKEN', async () => {
    const client = ioc(serverUrl(), {
      auth: { token: 'not.a.valid.jwt' },
      reconnection: false,
      transports: ['websocket'],
    });

    const err = await waitEvent(client, 'connect_error');
    expect(err.message).toBe('INVALID_TOKEN');
    client.close();
  });

  it('Scenario 3: valid token → connect success', async () => {
    const token = signToken('user-A');
    const client = ioc(serverUrl(), {
      auth: { token },
      reconnection: false,
      transports: ['websocket'],
    });

    await waitEvent(client, 'connect');
    expect(client.connected).toBe(true);
    client.close();
  });

  it('Scenario 4: sau auth — subscribe_symbol → subscribed event', async () => {
    const token = signToken('user-A');
    const client = ioc(serverUrl(), {
      auth: { token },
      reconnection: false,
      transports: ['websocket'],
    });

    await waitEvent(client, 'connect');
    const subscribedPromise = waitEvent(client, 'subscribed');
    client.emit('subscribe_symbol', 'VNM');
    const payload = await subscribedPromise;
    expect(payload.type).toBe('symbol');
    expect(payload.id).toBe('VNM');
    client.close();
  });

  it('Scenario 5: broadcastNotification user-B — user-A KHÔNG nhận, user-B nhận (room isolation)', async () => {
    const tokenA = signToken('user-A');
    const tokenB = signToken('user-B');
    const clientA = ioc(serverUrl(), { auth: { token: tokenA }, reconnection: false, transports: ['websocket'] });
    const clientB = ioc(serverUrl(), { auth: { token: tokenB }, reconnection: false, transports: ['websocket'] });

    await Promise.all([waitEvent(clientA, 'connect'), waitEvent(clientB, 'connect')]);

    let aReceived = false;
    clientA.on('notification', () => { aReceived = true; });

    const bPromise = waitEvent(clientB, 'notification');
    // Broadcast tới user-B only — trigger sau khi 2 client đã join room của họ
    setTimeout(() => broadcastNotification('user-B', { message: 'hello-B' }), 50);

    const bPayload = await bPromise;
    expect(bPayload.message).toBe('hello-B');

    // Wait 150ms để confirm A không nhận
    await new Promise((r) => setTimeout(r, 150));
    expect(aReceived).toBe(false);

    clientA.close();
    clientB.close();
  });

  it('Scenario 6: broadcastPriceUpdate payload KHÔNG có user_id/portfolio_id (MDI-07)', async () => {
    const token = signToken('user-A');
    const client = ioc(serverUrl(), { auth: { token }, reconnection: false, transports: ['websocket'] });
    await waitEvent(client, 'connect');

    // Subscribe symbol:VNM
    const subPromise = waitEvent(client, 'subscribed');
    client.emit('subscribe_symbol', 'VNM');
    await subPromise;

    const pricePromise = waitEvent(client, 'price_update');
    broadcastPriceUpdate('VNM', {
      symbol: 'VNM',
      exchange: 'HOSE',
      price: 80_000,
      change: 500,
      change_percent: 0.62,
      volume: 1_000_000,
      source: 'VPBS',
    });
    const payload = await pricePromise;

    // Explicit assertion — public room payload không được leak
    expect(payload.user_id).toBeUndefined();
    expect(payload.portfolio_id).toBeUndefined();
    expect(payload.symbol).toBe('VNM');

    client.close();
  });
});
