import Portfolio from '../models/Portfolio.js';
import RiskCalculator from '../services/riskCalculator.js';
import Joi from 'joi';

// Validation schemas – totalBalance luôn VND (đồng), đồng bộ API VPBS
export const createPortfolioSchema = Joi.object({
  name: Joi.string().max(255).default('Default Portfolio'),
  totalBalance: Joi.number().positive().required(), // VND
  maxRiskPercent: Joi.number().min(0.1).max(100).required(),
  expectedReturnPercent: Joi.number().min(-100).max(100).optional().default(0)
});

export const updatePortfolioSchema = Joi.object({
  name: Joi.string().max(255).optional(),
  totalBalance: Joi.number().positive().optional(),
  maxRiskPercent: Joi.number().min(0.1).max(100).optional(),
  expectedReturnPercent: Joi.number().min(-100).max(100).optional(),
  isActive: Joi.boolean().optional()
});

// Get all portfolios for current user
export const getAll = async (req, res, next) => {
  try {
    const portfolios = await Portfolio.findByUserId(req.user.userId);

    res.json({
      success: true,
      data: portfolios,
      count: portfolios.length
    });
  } catch (error) {
    next(error);
  }
};

// Get portfolio by ID
export const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const portfolio = await Portfolio.findById(id);

    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found'
      });
    }

    // Check ownership
    if (portfolio.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: portfolio
    });
  } catch (error) {
    next(error);
  }
};

// Create new portfolio
export const create = async (req, res, next) => {
  try {
    const body = req.validatedBody || req.body;
    const { name, totalBalance, maxRiskPercent, expectedReturnPercent } = body;

    const portfolio = await Portfolio.create({
      userId: req.user.userId,
      name,
      totalBalance,
      maxRiskPercent,
      expectedReturnPercent
    });

    res.status(201).json({
      success: true,
      message: 'Portfolio created successfully',
      data: portfolio
    });
  } catch (error) {
    next(error);
  }
};

// Update portfolio
export const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.validatedBody || req.body;
    const { name, totalBalance, maxRiskPercent, expectedReturnPercent, isActive } = body;

    // Check ownership
    const existing = await Portfolio.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found'
      });
    }

    if (existing.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const portfolio = await Portfolio.update(id, {
      name,
      totalBalance,
      maxRiskPercent,
      expectedReturnPercent,
      isActive
    });

    res.json({
      success: true,
      message: 'Portfolio updated successfully',
      data: portfolio
    });
  } catch (error) {
    next(error);
  }
};

// Delete portfolio
export const deletePortfolio = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check ownership
    const existing = await Portfolio.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found'
      });
    }

    if (existing.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await Portfolio.delete(id);

    res.json({
      success: true,
      message: 'Portfolio deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get risk status – response toàn bộ VND (maxRiskVND, currentRiskVND, availableRiskVND)
export const getRisk = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check ownership
    const portfolio = await Portfolio.findById(id);
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found'
      });
    }

    if (portfolio.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const riskStatus = await RiskCalculator.getPortfolioRiskStatus(id);

    res.json({
      success: true,
      data: riskStatus
    });
  } catch (error) {
    next(error);
  }
};

// Get performance
export const getPerformance = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check ownership
    const portfolio = await Portfolio.findById(id);
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found'
      });
    }

    if (portfolio.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const performance = await Portfolio.getPerformance(id);

    res.json({
      success: true,
      data: performance
    });
  } catch (error) {
    next(error);
  }
};

export default {
  getAll,
  getById,
  create,
  update,
  deletePortfolio,
  getRisk,
  getPerformance,
  createPortfolioSchema,
  updatePortfolioSchema
};
