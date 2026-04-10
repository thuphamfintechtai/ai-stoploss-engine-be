import Portfolio from '../../models/Portfolio.js';

/**
 * Risk Calculator – Đơn vị tiền tệ: VND (tiền Việt Nam).
 * Toàn bộ logic: total_balance, max_risk, current_risk, risk_value, profit_loss đều VND.
 */

class RiskCalculator {
  /**
   * Tính risk cho 1 position (VND).
   * Risk VND = |Entry - StopLoss| × Quantity
   */
  static calculatePositionRisk(entryPrice, stopLoss, quantity) {
    const entry = Number(entryPrice);
    const stop = Number(stopLoss);
    const qty = Number(quantity);
    if (Number.isNaN(entry) || Number.isNaN(stop) || Number.isNaN(qty) || qty <= 0) {
      return { riskVND: 0, riskPerShare: 0 };
    }
    const riskPerShare = Math.abs(entry - stop);
    const riskVND = riskPerShare * qty;
    const vnd = Number.isFinite(riskVND) ? parseFloat(riskVND.toFixed(2)) : 0;
    const perShare = Number.isFinite(riskPerShare) ? parseFloat(riskPerShare.toFixed(2)) : 0;
    return { riskVND: vnd, riskPerShare: perShare };
  }

  /**
   * Kiểm tra position mới có vượt hạn mức risk không – dùng VND.
   * @param {string} portfolioId
   * @param {number} newPositionRiskVND - Rủi ro vị thế mới (VND)
   */
  static async validatePositionAgainstRisk(portfolioId, newPositionRiskVND) {
    try {
      const portfolio = await Portfolio.findById(portfolioId);
      if (!portfolio) {
        return {
          allowed: false,
          reason: 'Portfolio not found'
        };
      }

      const addRisk = Number(newPositionRiskVND) || 0;
      const totalBalanceVND = parseFloat(portfolio.total_balance);
      const maxRiskPercent = parseFloat(portfolio.max_risk_percent);
      if (Number.isNaN(totalBalanceVND) || totalBalanceVND < 0 || Number.isNaN(maxRiskPercent)) {
        return { allowed: false, reason: 'Invalid portfolio balance or max risk percent' };
      }
      const maxRiskVND = (totalBalanceVND * maxRiskPercent) / 100;

      const riskStatus = await Portfolio.getRiskStatus(portfolioId);
      const currentRiskVND = riskStatus ? (parseFloat(riskStatus.current_risk_vnd) || 0) : 0;

      const totalRiskVND = currentRiskVND + addRisk;
      const riskUsagePercent = maxRiskVND > 0 ? (totalRiskVND / maxRiskVND) * 100 : 0;

      if (totalRiskVND > maxRiskVND) {
        return {
          allowed: false,
          reason: `Vượt hạn mức rủi ro. Hiện tại: ${currentRiskVND.toLocaleString('vi-VN')}, Thêm: ${addRisk.toLocaleString('vi-VN')}, Tổng: ${totalRiskVND.toLocaleString('vi-VN')}, Hạn mức: ${maxRiskVND.toLocaleString('vi-VN')}`,
          details: {
            currentRiskVND: parseFloat(currentRiskVND.toFixed(2)),
            newPositionRiskVND: parseFloat(addRisk.toFixed(2)),
            totalRiskVND: parseFloat(totalRiskVND.toFixed(2)),
            maxRiskVND: parseFloat(maxRiskVND.toFixed(2)),
            riskUsagePercent: parseFloat(riskUsagePercent.toFixed(2)),
            exceeded: true
          }
        };
      }

      const remainingRiskVND = maxRiskVND - totalRiskVND;

      return {
        allowed: true,
        details: {
          currentRiskVND: parseFloat(currentRiskVND.toFixed(2)),
          newPositionRiskVND: parseFloat(addRisk.toFixed(2)),
          totalRiskVND: parseFloat(totalRiskVND.toFixed(2)),
          maxRiskVND: parseFloat(maxRiskVND.toFixed(2)),
          remainingRiskVND: parseFloat(remainingRiskVND.toFixed(2)),
          riskUsagePercent: parseFloat(riskUsagePercent.toFixed(2)),
          exceeded: false
        }
      };
    } catch (error) {
      console.error('Error validating risk:', error);
      return {
        allowed: false,
        reason: `Lỗi kiểm tra rủi ro: ${error.message}`
      };
    }
  }

  /**
   * Trạng thái risk portfolio – trả về VND là chính.
   */
  static async getPortfolioRiskStatus(portfolioId) {
    try {
      const portfolio = await Portfolio.findById(portfolioId);
      if (!portfolio) {
        throw new Error('Portfolio not found');
      }

      const riskStatus = await Portfolio.getRiskStatus(portfolioId);

      if (!riskStatus) {
        const totalBalanceVND = parseFloat(portfolio.total_balance);
        const maxRiskPercent = parseFloat(portfolio.max_risk_percent);
        const maxRiskVND = (Number.isFinite(totalBalanceVND) && Number.isFinite(maxRiskPercent))
          ? (totalBalanceVND * maxRiskPercent) / 100 : 0;
        const safeMaxVND = Number.isFinite(maxRiskVND) ? parseFloat(maxRiskVND.toFixed(2)) : 0;
        return {
          portfolioId,
          totalBalance: Number.isFinite(totalBalanceVND) ? totalBalanceVND : 0,
          maxRiskPercent: Number.isFinite(maxRiskPercent) ? maxRiskPercent : 0,
          maxRiskVND: safeMaxVND,
          currentRiskVND: 0,
          availableRiskVND: safeMaxVND,
          riskUsagePercent: 0,
          openPositionsCount: 0,
          status: 'SAFE'
        };
      }

      const totalBalanceVND = parseFloat(riskStatus.total_balance);
      const maxRiskPct = parseFloat(riskStatus.max_risk_percent);
      const maxRiskVND = parseFloat(
        riskStatus.max_risk_vnd ?? (Number.isFinite(totalBalanceVND) && Number.isFinite(maxRiskPct) ? totalBalanceVND * maxRiskPct / 100 : 0)
      );
      const currentRiskVND = parseFloat(riskStatus.current_risk_vnd ?? 0) || 0;
      const safeCurrent = Number.isFinite(currentRiskVND) ? currentRiskVND : 0;
      const safeMax = Number.isFinite(maxRiskVND) ? maxRiskVND : 0;
      const availableRiskVND = parseFloat(
        riskStatus.available_risk_vnd ?? (safeMax - safeCurrent)
      );
      const riskUsagePercent = parseFloat(riskStatus.risk_usage_percent ?? 0) || 0;
      let status = 'SAFE';

      if (riskUsagePercent >= 90) status = 'CRITICAL';
      else if (riskUsagePercent >= 80) status = 'WARNING';
      else if (riskUsagePercent >= 50) status = 'MODERATE';

      const safeAvailable = Number.isFinite(availableRiskVND) ? parseFloat(availableRiskVND.toFixed(2)) : 0;
      const openCount = parseInt(riskStatus.open_positions_count, 10);
      return {
        portfolioId,
        totalBalance: Number.isFinite(totalBalanceVND) ? totalBalanceVND : 0,
        maxRiskPercent: Number.isFinite(maxRiskPct) ? maxRiskPct : 0,
        maxRiskVND: parseFloat(safeMax.toFixed(2)),
        currentRiskVND: parseFloat(safeCurrent.toFixed(2)),
        availableRiskVND: safeAvailable,
        riskUsagePercent: Number.isFinite(riskUsagePercent) ? parseFloat(riskUsagePercent.toFixed(2)) : 0,
        openPositionsCount: Number.isInteger(openCount) && openCount >= 0 ? openCount : 0,
        status
      };
    } catch (error) {
      console.error('Error getting portfolio risk status:', error);
      throw error;
    }
  }

  /**
   * Khối lượng đề xuất theo hạn mức rủi ro còn lại (VND).
   */
  static calculateRecommendedPositionSize(
    portfolioBalanceVND,
    maxRiskPercent,
    currentRiskVND,
    entryPrice,
    stopLoss
  ) {
    const balance = Number(portfolioBalanceVND);
    const pct = Number(maxRiskPercent);
    const current = Number(currentRiskVND) || 0;
    const entry = Number(entryPrice);
    const stop = Number(stopLoss);
    if (!Number.isFinite(balance) || balance <= 0 || !Number.isFinite(pct) || pct <= 0) {
      return { recommendedQuantity: 0, reason: 'Số dư hoặc max risk không hợp lệ' };
    }
    const maxRiskVND = (balance * pct / 100) - current;

    if (!Number.isFinite(maxRiskVND) || maxRiskVND <= 0) {
      return {
        recommendedQuantity: 0,
        reason: 'Không còn hạn mức rủi ro (VND)'
      };
    }

    const riskPerShare = Math.abs(entry - stop);
    if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) {
      return { recommendedQuantity: 0, reason: 'Risk per share phải > 0' };
    }

    const recommendedQuantity = Math.floor(maxRiskVND / riskPerShare);
    const safeQty = Number.isFinite(recommendedQuantity) && recommendedQuantity >= 0 ? recommendedQuantity : 0;

    return {
      recommendedQuantity: safeQty,
      maxRiskVND: parseFloat(maxRiskVND.toFixed(2)),
      riskPerShare: parseFloat(riskPerShare.toFixed(2)),
      reason: 'Tính theo hạn mức rủi ro còn lại (VND)'
    };
  }

  /**
   * Lãi/lỗ khi đóng lệnh (VND).
   */
  static calculateProfitLoss(entryPrice, closedPrice, quantity) {
    const entry = Number(entryPrice);
    const closed = Number(closedPrice);
    const qty = Number(quantity) || 0;
    if (!Number.isFinite(entry) || entry <= 0 || qty <= 0 || !Number.isFinite(closed)) {
      return { profitVND: 0, profitPercent: 0 };
    }
    const profitPerShare = closed - entry;
    const profitVND = profitPerShare * qty;
    const profitPercent = entry !== 0 ? (profitPerShare / entry) * 100 : 0;

    return {
      profitVND: Number.isFinite(profitVND) ? parseFloat(profitVND.toFixed(2)) : 0,
      profitPercent: Number.isFinite(profitPercent) ? parseFloat(profitPercent.toFixed(2)) : 0
    };
  }

  /**
   * Tỷ lệ R:R (không phụ thuộc đơn vị tiền).
   */
  static calculateRiskRewardRatio(entryPrice, stopLoss, takeProfit) {
    const entry = Number(entryPrice);
    const stop = Number(stopLoss);
    const tp = Number(takeProfit);
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(tp)) {
      return null;
    }
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(tp - entry);

    if (risk === 0 || !Number.isFinite(risk) || !Number.isFinite(reward)) return null;

    const ratio = reward / risk;
    if (!Number.isFinite(ratio)) return null;

    return {
      ratio: parseFloat(ratio.toFixed(2)),
      risk: parseFloat(risk.toFixed(2)),
      reward: parseFloat(reward.toFixed(2)),
      formatted: `1:${ratio.toFixed(2)}`
    };
  }
}

export default RiskCalculator;
