/**
 * Resolve stop loss và take profit từ type + params.
 * Đơn vị: entryPrice, stopLoss, takeProfit đều là VND (đồng). FE gửi stop_price/take_profit_price đã quy đổi điểm → VND (× 1000).
 */

function resolveStopLoss(stopType, stopParams, entryPrice, quantity, side, fixedStop, resolverOptions = {}) {
  const entry = Number(entryPrice);
  const qty = Number(quantity) || 0;
  if (!Number.isFinite(entry) || qty <= 0) {
    return { stopLoss: null, error: 'Entry price và quantity không hợp lệ' };
  }

  switch (stopType) {
    case 'FIXED': {
      const level = fixedStop ?? stopParams?.stop_price ?? stopParams?.level_price;
      const num = Number(level);
      if (!Number.isFinite(num)) return { stopLoss: null, error: 'FIXED stop cần stop_price hoặc level_price' };
      return { stopLoss: num };
    }
    case 'PERCENT': {
      const percent = Number(stopParams?.percent ?? stopParams?.percent_loss) || 0;
      if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
        return { stopLoss: null, error: 'PERCENT stop cần percent trong (0, 100)' };
      }
      const stop = side === 'LONG' ? entry * (1 - percent / 100) : entry * (1 + percent / 100);
      return { stopLoss: parseFloat(stop.toFixed(2)) };
    }
    case 'MAX_LOSS': {
      const maxLossVnd = Number(stopParams?.max_loss_vnd ?? stopParams?.max_loss) || 0;
      if (!Number.isFinite(maxLossVnd) || maxLossVnd <= 0) {
        return { stopLoss: null, error: 'MAX_LOSS stop cần max_loss_vnd' };
      }
      const lossPerShare = maxLossVnd / qty;
      const stop = side === 'LONG' ? entry - lossPerShare : entry + lossPerShare;
      return { stopLoss: parseFloat(stop.toFixed(2)) };
    }
    case 'ATR': {
      const atr = Number(resolverOptions?.atrValue ?? stopParams?.atr_value) ?? null;
      if (atr == null || !Number.isFinite(atr) || atr <= 0) {
        return { stopLoss: null, error: 'ATR stop cần atr_value trong stop_params hoặc resolverOptions' };
      }
      const stop = side === 'LONG' ? entry - atr : entry + atr;
      return { stopLoss: parseFloat(stop.toFixed(2)) };
    }
    case 'MA': {
      const ma = Number(resolverOptions?.maValue ?? stopParams?.ma_value ?? stopParams?.level_price) ?? null;
      if (ma == null || !Number.isFinite(ma)) {
        return { stopLoss: null, error: 'MA stop cần ma_value hoặc level_price' };
      }
      return { stopLoss: parseFloat(ma.toFixed(2)) };
    }
    case 'TRAILING':
    case 'SUPPORT_RESISTANCE': {
      const level = fixedStop ?? stopParams?.stop_price ?? stopParams?.level_price ?? stopParams?.level;
      const num = Number(level);
      if (!Number.isFinite(num)) {
        return { stopLoss: null, error: `${stopType} cần stop_price hoặc level_price` };
      }
      return { stopLoss: num };
    }
    default:
      return { stopLoss: null, error: `Stop type không hỗ trợ: ${stopType}` };
  }
}

function resolveTakeProfit(tpType, tpParams, entryPrice, stopLoss, side, takeProfitPrice) {
  const entry = Number(entryPrice);
  const stop = Number(stopLoss);
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) {
    return { takeProfit: null, error: 'Entry hoặc stop loss không hợp lệ' };
  }

  switch (tpType) {
    case 'FIXED': {
      const price = Number(takeProfitPrice ?? tpParams?.take_profit_price ?? tpParams?.level_price);
      if (!Number.isFinite(price)) return { takeProfit: null, error: 'FIXED take profit cần take_profit_price' };
      return { takeProfit: parseFloat(price.toFixed(2)) };
    }
    case 'PERCENT': {
      const percent = Number(tpParams?.percent ?? tpParams?.percent_profit) || 0;
      if (!Number.isFinite(percent) || percent <= 0) {
        return { takeProfit: null, error: 'PERCENT take profit cần percent > 0' };
      }
      const tp = side === 'LONG' ? entry * (1 + percent / 100) : entry * (1 - percent / 100);
      return { takeProfit: parseFloat(tp.toFixed(2)) };
    }
    case 'R_RATIO': {
      const ratio = Number(tpParams?.ratio ?? tpParams?.r_ratio ?? tpParams?.risk_reward_ratio) || 0;
      if (!Number.isFinite(ratio) || ratio <= 0) {
        return { takeProfit: null, error: 'R_RATIO take profit cần ratio hoặc risk_reward_ratio > 0' };
      }
      const risk = Math.abs(entry - stop);
      const reward = risk * ratio;
      const tp = side === 'LONG' ? entry + reward : entry - reward;
      return { takeProfit: parseFloat(tp.toFixed(2)) };
    }
    default:
      return { takeProfit: null, error: `Take profit type không hỗ trợ: ${tpType}` };
  }
}

export default { resolveStopLoss, resolveTakeProfit };
