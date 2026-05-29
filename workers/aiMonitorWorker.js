/**
 * AI Monitor Worker — Rà soát danh mục định kỳ, tạo cảnh báo.
 *
 * Chạy mỗi phút, check portfolios có ai_monitor_enabled = true và next_run_at <= NOW.
 * Với mỗi portfolio đến hạn:
 *   1. Lấy open positions
 *   2. Lấy giá hiện tại từ market
 *   3. Check các điều kiện: gần SL, gần TP, sector concentration
 *   4. Tạo alerts nếu cần
 *   5. Update last_run_at, next_run_at
 */

import cron from 'node-cron';
import { query } from '../config/database.js';
import { getMarketData } from '../services/shared/marketPriceService.js';
import { getSector, SECTOR_LABELS } from '../services/ai/sectorClassification.js';

const PRICE_SCALE = 1000; // VND scale factor

/**
 * Check một position có gần SL/TP không.
 * @returns {Array<{severity, title, narrative, action_type}>}
 */
function checkPositionAlerts(position, currentPrice) {
  const alerts = [];
  const entry = Number(position.entry_price);
  const sl = Number(position.stop_loss || position.trailing_current_stop || 0);
  const tp = Number(position.take_profit || 0);
  const qty = Number(position.quantity);

  if (!currentPrice || currentPrice <= 0 || entry <= 0) return alerts;

  const pnlPct = ((currentPrice - entry) / entry) * 100;

  // Check gần SL (trong 3%)
  if (sl > 0) {
    const slDistance = ((currentPrice - sl) / currentPrice) * 100;
    if (slDistance <= 3 && slDistance > 0) {
      alerts.push({
        position_id: position.id,
        symbol: position.symbol,
        severity: slDistance <= 1 ? 'HIGH' : 'MEDIUM',
        title: `${position.symbol} gần chạm Stop Loss`,
        narrative: `Giá hiện tại ${(currentPrice/PRICE_SCALE).toFixed(2)} chỉ còn cách SL ${(sl/PRICE_SCALE).toFixed(2)} khoảng ${slDistance.toFixed(1)}%. P&L hiện tại: ${pnlPct.toFixed(2)}%`,
        action_type: 'TIGHTEN_SL',
      });
    }
  }

  // Check gần TP (trong 5%)
  if (tp > 0 && currentPrice < tp) {
    const tpDistance = ((tp - currentPrice) / currentPrice) * 100;
    if (tpDistance <= 5) {
      alerts.push({
        position_id: position.id,
        symbol: position.symbol,
        severity: 'LOW',
        title: `${position.symbol} gần chạm Take Profit`,
        narrative: `Giá hiện tại ${(currentPrice/PRICE_SCALE).toFixed(2)} chỉ còn cách TP ${(tp/PRICE_SCALE).toFixed(2)} khoảng ${tpDistance.toFixed(1)}%. Cân nhắc chốt một phần lợi nhuận.`,
        action_type: 'TAKE_PARTIAL',
      });
    }
  }

  // Check lỗ nặng (> 10%)
  if (pnlPct < -10) {
    alerts.push({
      position_id: position.id,
      symbol: position.symbol,
      severity: 'HIGH',
      title: `${position.symbol} đang lỗ ${Math.abs(pnlPct).toFixed(1)}%`,
      narrative: `Vị thế đang lỗ nặng. Entry: ${(entry/PRICE_SCALE).toFixed(2)}, Hiện tại: ${(currentPrice/PRICE_SCALE).toFixed(2)}. Cân nhắc cắt lỗ hoặc điều chỉnh SL.`,
      action_type: 'EXIT',
    });
  }

  return alerts;
}

/**
 * Check sector concentration cho portfolio.
 */
function checkSectorConcentration(positions, prices) {
  const alerts = [];
  const sectorValues = {};
  let totalValue = 0;

  for (const p of positions) {
    const price = prices[p.symbol] || Number(p.entry_price);
    const value = price * Number(p.quantity);
    const sector = getSector(p.symbol);
    sectorValues[sector] = (sectorValues[sector] || 0) + value;
    totalValue += value;
  }

  if (totalValue <= 0) return alerts;

  for (const [sector, value] of Object.entries(sectorValues)) {
    const pct = (value / totalValue) * 100;
    if (pct > 40) {
      alerts.push({
        symbol: null,
        severity: 'HIGH',
        title: `Ngành ${SECTOR_LABELS[sector] || sector} quá tập trung`,
        narrative: `Ngành ${SECTOR_LABELS[sector] || sector} chiếm ${pct.toFixed(1)}% danh mục (> 40%). Nên cân nhắc giảm tỷ trọng để phân tán rủi ro.`,
        action_type: 'REBALANCE',
      });
    } else if (pct > 30) {
      alerts.push({
        symbol: null,
        severity: 'MEDIUM',
        title: `Ngành ${SECTOR_LABELS[sector] || sector} tập trung cao`,
        narrative: `Ngành ${SECTOR_LABELS[sector] || sector} chiếm ${pct.toFixed(1)}% danh mục (> 30%). Theo dõi và cân nhắc đa dạng hóa.`,
        action_type: 'INFO',
      });
    }
  }

  return alerts;
}

/**
 * Rà soát một portfolio.
 */
async function reviewPortfolio(portfolio) {
  const portfolioId = portfolio.id;
  console.log(`[AI Monitor] Reviewing portfolio ${portfolioId}`);

  // Get open positions
  const posRes = await query(
    `SELECT * FROM financial.positions
     WHERE portfolio_id = $1 AND status = 'OPEN' AND context = 'REAL'`,
    [portfolioId]
  );
  const positions = posRes.rows;

  if (positions.length === 0) {
    console.log(`[AI Monitor] No open positions for ${portfolioId}`);
    return { alerts: 0 };
  }

  // Fetch current prices
  const symbols = [...new Set(positions.map(p => p.symbol))];
  const prices = {};

  await Promise.all(symbols.map(async (sym) => {
    try {
      const data = await getMarketData(sym);
      const price = data?.lastPrice || data?.close || data?.price;
      if (price) prices[sym] = Number(price) * PRICE_SCALE;
    } catch (e) {
      console.warn(`[AI Monitor] Failed to get price for ${sym}:`, e.message);
    }
  }));

  // Generate alerts
  const allAlerts = [];

  // Position-level alerts
  for (const pos of positions) {
    const currentPrice = prices[pos.symbol];
    const posAlerts = checkPositionAlerts(pos, currentPrice);
    allAlerts.push(...posAlerts.map(a => ({ ...a, portfolio_id: portfolioId })));
  }

  // Portfolio-level alerts (sector concentration)
  const sectorAlerts = checkSectorConcentration(positions, prices);
  allAlerts.push(...sectorAlerts.map(a => ({ ...a, portfolio_id: portfolioId, position_id: null })));

  // Insert alerts (avoid duplicates - don't create same alert within 1 hour)
  let insertedCount = 0;
  for (const alert of allAlerts) {
    // Check for recent duplicate
    const dupCheck = await query(
      `SELECT id FROM financial.ai_alerts
       WHERE portfolio_id = $1
         AND title = $2
         AND created_at > NOW() - INTERVAL '1 hour'
         AND dismissed_at IS NULL
       LIMIT 1`,
      [alert.portfolio_id, alert.title]
    );

    if (dupCheck.rows.length === 0) {
      await query(
        `INSERT INTO financial.ai_alerts
         (portfolio_id, position_id, severity, symbol, title, narrative, action_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [alert.portfolio_id, alert.position_id || null, alert.severity, alert.symbol || null,
         alert.title, alert.narrative, alert.action_type || null]
      );
      insertedCount++;
    }
  }

  console.log(`[AI Monitor] Portfolio ${portfolioId}: ${allAlerts.length} alerts generated, ${insertedCount} new`);
  return { alerts: insertedCount };
}

/**
 * Main worker function - chạy bởi cron.
 */
async function runMonitorCheck() {
  try {
    // Find portfolios due for review
    const duePortfolios = await query(
      `SELECT * FROM financial.portfolios
       WHERE ai_monitor_enabled = true
         AND (ai_monitor_next_run IS NULL OR ai_monitor_next_run <= NOW())`
    );

    if (duePortfolios.rows.length === 0) {
      return;
    }

    console.log(`[AI Monitor] Found ${duePortfolios.rows.length} portfolios due for review`);

    for (const portfolio of duePortfolios.rows) {
      try {
        await reviewPortfolio(portfolio);

        // Update next run time
        const freq = portfolio.ai_monitor_frequency_min || 30;
        await query(
          `UPDATE financial.portfolios
           SET ai_monitor_last_run = NOW(),
               ai_monitor_next_run = NOW() + INTERVAL '${freq} minutes'
           WHERE id = $1`,
          [portfolio.id]
        );
      } catch (err) {
        console.error(`[AI Monitor] Error reviewing portfolio ${portfolio.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[AI Monitor] Worker error:', err.message);
  }
}

/**
 * Start the AI Monitor worker.
 */
export function startAiMonitorWorker() {
  // Run every minute
  cron.schedule('* * * * *', runMonitorCheck);
  console.log('🤖 AI Monitor Worker started (every minute)');

  // Run immediately on start
  runMonitorCheck();
}

export default { startAiMonitorWorker };
