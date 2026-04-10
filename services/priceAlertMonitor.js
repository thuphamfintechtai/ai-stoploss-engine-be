/**
 * Price Alert Monitor – Giám sát cảnh báo giá và broadcast realtime qua WebSocket.
 *
 * Hai nhiệm vụ chạy trong cùng process với main server:
 *
 * 1. checkPriceAlerts()   – mỗi 2 phút: kiểm tra các price_alerts đang active,
 *    nếu điều kiện thoả → tạo notification + broadcast WS + đánh dấu triggered.
 *
 * 2. broadcastPriceUpdates() – mỗi 30 giây: lấy giá các mã có trong watchlist
 *    và broadcast 'price_update' cho client đang subscribe symbol tương ứng.
 */
import cron from 'node-cron';
import { query } from '../config/database.js';
import { createNotification } from './notificationService.js';
import { broadcastPriceUpdate } from './websocket.js';

const DB = process.env.DB_SCHEMA || 'financial';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
// Cache giá đã fetch trong vòng 1 phút (tránh gọi quá nhiều VPBank API)
const priceCache = new Map(); // symbol → { price, fetchedAt }
const CACHE_TTL = 60_000; // 60 giây

// VPBS /api/market/symbols/:symbol/price trả giá thẳng bằng VND (không cần × 1000)
async function fetchPriceVND(symbol, exchange = 'HOSE') {
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.price;

  try {
    const res = await fetch(
      `${API_BASE}/api/market/symbols/${encodeURIComponent(symbol)}/price?exchange=${exchange}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const priceVND = json?.data?.price;
    if (priceVND == null) return null;
    const price = parseFloat(priceVND);
    if (!Number.isFinite(price)) return null;

    priceCache.set(symbol, { price, fetchedAt: Date.now(), raw: json.data });
    return price;
  } catch {
    return null;
  }
}

// ─── 1. KIỂM TRA PRICE ALERTS ─────────────────────────────────────────────

async function checkPriceAlerts() {
  try {
    // Lấy tất cả alerts đang active chưa triggered
    const result = await query(
      `SELECT pa.*, u.id as user_id
       FROM ${DB}.price_alerts pa
       JOIN ${DB}.users u ON pa.user_id = u.id
       WHERE pa.is_active = TRUE AND pa.is_triggered = FALSE`
    );
    const alerts = result.rows;
    if (alerts.length === 0) return;

    // Lấy giá cho tất cả symbols unique
    const symbols = [...new Set(alerts.map(a => a.symbol))];
    await Promise.all(symbols.map(sym => {
      const alert = alerts.find(a => a.symbol === sym);
      return fetchPriceVND(sym, alert?.exchange || 'HOSE');
    }));

    for (const alert of alerts) {
      const currentPrice = priceCache.get(alert.symbol)?.price;
      if (!currentPrice) continue;

      const target = parseFloat(alert.target_value);
      const refPrice = alert.reference_price ? parseFloat(alert.reference_price) : null;

      let triggered = false;
      let alertMsg = '';
      let alertTitle = '';

      // Định dạng giá VND → "60,000"
      const fmtVND = (v) => Math.round(v).toLocaleString('vi-VN');

      switch (alert.condition) {
        case 'ABOVE':
          if (currentPrice >= target) {
            triggered = true;
            alertTitle = `📈 ${alert.symbol} vượt mức ${fmtVND(target)}đ`;
            alertMsg = `${alert.symbol} đang ở ${fmtVND(currentPrice)}đ – vượt mức cảnh báo ${fmtVND(target)}đ.`;
          }
          break;

        case 'BELOW':
          if (currentPrice <= target) {
            triggered = true;
            alertTitle = `📉 ${alert.symbol} xuống dưới ${fmtVND(target)}đ`;
            alertMsg = `${alert.symbol} đang ở ${fmtVND(currentPrice)}đ – xuống dưới mức cảnh báo ${fmtVND(target)}đ.`;
          }
          break;

        case 'PERCENT_UP':
          if (refPrice && refPrice > 0) {
            const changePct = ((currentPrice - refPrice) / refPrice) * 100;
            if (changePct >= target) {
              triggered = true;
              alertTitle = `🚀 ${alert.symbol} tăng ${changePct.toFixed(1)}%`;
              alertMsg = `${alert.symbol} tăng ${changePct.toFixed(2)}% so với tham chiếu (từ ${fmtVND(refPrice)}đ → ${fmtVND(currentPrice)}đ).`;
            }
          }
          break;

        case 'PERCENT_DOWN':
          if (refPrice && refPrice > 0) {
            const changePct = ((refPrice - currentPrice) / refPrice) * 100;
            if (changePct >= target) {
              triggered = true;
              alertTitle = `⚠️ ${alert.symbol} giảm ${changePct.toFixed(1)}%`;
              alertMsg = `${alert.symbol} giảm ${changePct.toFixed(2)}% so với tham chiếu (từ ${fmtVND(refPrice)}đ → ${fmtVND(currentPrice)}đ).`;
            }
          }
          break;
      }

      if (triggered) {
        // Đánh dấu triggered trong DB
        await query(
          `UPDATE ${DB}.price_alerts
           SET is_triggered = TRUE, triggered_at = NOW(), triggered_price = $1,
               is_active = FALSE, updated_at = NOW()
           WHERE id = $2`,
          [currentPrice, alert.id]
        );

        // Tạo notification
        await createNotification({
          userId: alert.user_id,
          type: 'PRICE_ALERT',
          title: alertTitle + (alert.note ? ` – ${alert.note}` : ''),
          message: alertMsg,
          severity: alert.condition === 'BELOW' || alert.condition === 'PERCENT_DOWN' ? 'WARNING' : 'SUCCESS',
          metadata: {
            alert_id: alert.id,
            symbol: alert.symbol,
            exchange: alert.exchange,
            condition: alert.condition,
            target_value: target,
            current_price: currentPrice,
            reference_price: refPrice
          }
        });

        console.log(`[PriceAlert] ${alert.condition} triggered for ${alert.symbol} @ ${currentPrice}`);
      }
    }
  } catch (error) {
    console.error('[PriceAlertMonitor] checkPriceAlerts error:', error.message);
  }
}

// ─── 2. BROADCAST GIÁ THEO DÕI REALTIME ──────────────────────────────────

async function broadcastWatchlistPrices() {
  try {
    // Lấy tất cả symbols trong watchlist của tất cả user (unique)
    const result = await query(
      `SELECT DISTINCT symbol, exchange FROM ${DB}.watchlists`
    );
    const items = result.rows;
    if (items.length === 0) return;

    // Fetch giá và broadcast cho subscribers
    await Promise.all(items.map(async (item) => {
      try {
        const cached = priceCache.get(item.symbol);
        // Chỉ fetch nếu cache cũ hơn 25 giây
        let priceData = null;
        if (!cached || Date.now() - cached.fetchedAt > 25_000) {
          await fetchPriceVND(item.symbol, item.exchange);
          priceData = priceCache.get(item.symbol);
        } else {
          priceData = cached;
        }

        if (priceData?.raw) {
          const d = priceData.raw;
          broadcastPriceUpdate(item.symbol, {
            symbol: item.symbol,
            exchange: item.exchange,
            price: priceData.price,   // VND
            change: d.change,
            change_percent: d.percentChange,
            volume: d.volume,
            source: 'watchlist_broadcast'
          });
        }
      } catch { /* ignore per-symbol errors */ }
    }));
  } catch (error) {
    console.error('[PriceAlertMonitor] broadcastWatchlistPrices error:', error.message);
  }
}

// ─── KHỞI ĐỘNG ──────────────────────────────────────────────────────────────

export function startPriceAlertMonitor() {
  const alertCron = process.env.PRICE_ALERT_CRON || '*/2 * * * *';
  const broadcastCron = process.env.PRICE_BROADCAST_CRON || '*/30 * * * * *';

  cron.schedule(alertCron, async () => {
    try { await checkPriceAlerts(); } catch (e) { console.error('[PriceAlert]', e.message); }
  });

  cron.schedule(broadcastCron, async () => {
    try { await broadcastWatchlistPrices(); } catch (e) { console.error('[PriceBroadcast]', e.message); }
  });

  console.log('📡 Price Alert Monitor started (alerts:', alertCron, '/ broadcast:', broadcastCron + ')');
}
