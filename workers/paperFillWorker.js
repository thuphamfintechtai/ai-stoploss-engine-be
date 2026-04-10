/**
 * Paper Fill Worker — Kiểm tra và fill PENDING REALISTIC paper orders định kỳ.
 *
 * Cron jobs:
 *   - Fill check:   mỗi 30 giây (chỉ trong giờ giao dịch VN)
 *   - Expiry:       15:00 Mon-Fri (cuối phiên)
 *   - Settlement:   09:00 Mon-Fri (trước khi mở sàn)
 *
 * Per D-04: delay 1-5s giữa các fills (mô phỏng queue thực tế).
 * Per D-06: T+2 settlement được xử lý bởi PaperCapitalService.processSettlements().
 * Per D-10: ATO expire nếu không khớp trong phiên mở cửa, ATC expire phiên đóng.
 */

import cron from 'node-cron';
import Order from '../models/Order.js';
import { fillOrderRealistic, expireEndOfSessionOrders } from '../services/paper/fillEngine.js';
import PaperCapitalService from '../services/paper/paperCapitalService.js';

const FILL_CRON       = '*/30 * * * * *'; // mỗi 30 giây
const EXPIRE_CRON     = '0 15 * * 1-5';   // 15:00 Mon-Fri — cuối phiên
const SETTLEMENT_CRON = '0 9 * * 1-5';    // 09:00 Mon-Fri — trước khi mở sàn

// ─── Market hours guard ───────────────────────────────────────────────────────

function isWithinTradingHours() {
  const now = new Date();
  const tz  = 'Asia/Ho_Chi_Minh';

  // Bỏ qua cuối tuần
  const day = now.toLocaleDateString('vi-VN', { weekday: 'short', timeZone: tz });
  if (day === 'CN' || day === 'T7') return false;

  // Giờ giao dịch VN: 9:00-11:30 và 13:00-15:00 (GMT+7)
  const t = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  const [h, m] = t.split(':').map(Number);
  const hhmm   = h * 100 + m;

  return (hhmm >= 900 && hhmm <= 1130) || (hhmm >= 1300 && hhmm <= 1500);
}

// ─── Helper: random delay 1-5s để mô phỏng queue thực tế (D-04) ─────────────

function randomDelay(minMs = 1000, maxMs = 5000) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── checkPendingOrders: fill PENDING REALISTIC paper orders ─────────────────

async function checkPendingOrders() {
  try {
    // Lấy tất cả PAPER PENDING orders với simulation_mode = 'REALISTIC'
    const { query } = await import('../config/database.js');
    const { rows: pendingOrders } = await query(
      `SELECT * FROM financial.orders
       WHERE context = 'PAPER'
         AND status = 'PENDING'
         AND simulation_mode = 'REALISTIC'
       ORDER BY placed_at ASC`
    );

    if (pendingOrders.length === 0) return;

    // Group by symbol để xử lý từng group
    const bySymbol = {};
    for (const order of pendingOrders) {
      const key = order.symbol;
      if (!bySymbol[key]) bySymbol[key] = [];
      bySymbol[key].push(order);
    }

    let checkedCount = 0;
    let filledCount  = 0;

    for (const [symbol, orders] of Object.entries(bySymbol)) {
      for (const order of orders) {
        checkedCount++;
        try {
          const result = await fillOrderRealistic(order);
          if (result.filled) {
            filledCount++;
          }
        } catch (err) {
          console.error(`[PaperFillWorker] Error filling order ${order.id} (${symbol}):`, err.message);
        }

        // Delay 1-5s giữa các fills (per D-04: mô phỏng độ trễ queue thực tế)
        if (orders.indexOf(order) < orders.length - 1) {
          await randomDelay(1000, 5000);
        }
      }
    }

    if (checkedCount > 0) {
      console.log(`[PaperFillWorker] Checked ${checkedCount} pending orders, ${filledCount} filled`);
    }
  } catch (err) {
    console.error('[PaperFillWorker] checkPendingOrders error:', err.message);
  }
}

// ─── processExpiry: expire orders hết phiên ──────────────────────────────────

async function processExpiry() {
  try {
    const expiredCount = await expireEndOfSessionOrders();
    if (expiredCount > 0) {
      console.log(`[PaperFillWorker] Expired ${expiredCount} paper orders (end of session)`);
    }
  } catch (err) {
    console.error('[PaperFillWorker] processExpiry error:', err.message);
  }
}

// ─── processPaperSettlements: xử lý T+2 settlements ─────────────────────────

async function processPaperSettlements() {
  try {
    const processed = await PaperCapitalService.processSettlements();
    if (processed > 0) {
      console.log(`[PaperFillWorker] Processed ${processed} paper settlements (T+2)`);
    }
  } catch (err) {
    console.error('[PaperFillWorker] processPaperSettlements error:', err.message);
  }
}

// ─── startPaperFillWorker — gọi từ index.js ──────────────────────────────────

export function startPaperFillWorker() {
  // Fill check mỗi 30 giây — chỉ trong giờ giao dịch VN
  cron.schedule(FILL_CRON, async () => {
    if (!isWithinTradingHours()) {
      // Không log để tránh spam (chạy 2 lần/phút, 24/7)
      return;
    }
    await checkPendingOrders();
  });

  // Expire orders lúc 15:00 Mon-Fri
  cron.schedule(EXPIRE_CRON, async () => {
    console.log('[PaperFillWorker] End of session: expiring unmatched orders...');
    await processExpiry();
  });

  // Xử lý paper settlements lúc 09:00 Mon-Fri
  cron.schedule(SETTLEMENT_CRON, async () => {
    console.log('[PaperFillWorker] Processing paper T+2 settlements...');
    await processPaperSettlements();
  });

  console.log('[PaperFillWorker] Started: fill check */30s, expire 15:00, settlement 09:00');
}
