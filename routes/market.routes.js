import express from 'express';
import * as marketController from '../controllers/market.controller.js';
import { validateQuery } from '../middleware/validation.js';

const router = express.Router();

// All routes are public (no auth required for market data)

router.get('/position-form-spec', marketController.getPositionFormSpec);
router.get('/stocks', marketController.getStocks);
router.get('/symbols', marketController.getSymbols);
router.get('/symbols/:symbol/info', marketController.getSymbolInfo);
router.get('/symbols/:symbol/entry-info', marketController.getEntryInfo);
router.get('/symbols/:symbol/detail', marketController.getSymbolDetail);
router.get('/symbols/:symbol/price', marketController.getPrice);
router.get('/stock-detail-by-index', marketController.getStockDetailByIndex);
router.get('/stock-cw-detail', marketController.getStockCWDetail);
router.get('/stock-ef-detail', marketController.getStockEFDetail);
router.get('/stock-fu-detail', marketController.getStockFUDetail);
router.get('/stock-detail-by-industry', marketController.getStockDetailByIndustry);
router.get('/pt-stock-match', marketController.getPtStockMatch);
router.get('/pt-stock-bid', marketController.getPtStockBid);
router.get('/pt-stock-ask', marketController.getPtStockAsk);
router.get('/pt-stock-detail', marketController.getPtStockDetail);
router.get('/odd-lot-stock-detail', marketController.getOddLotStockDetail);
router.get('/symbols/:symbol/ohlcv', validateQuery(marketController.ohlcvQuerySchema), marketController.getOHLCV);
router.get('/symbols/:symbol/indicators', marketController.getIndicators);
router.get('/overview', marketController.getOverview);
router.get('/intraday-index', marketController.getIntradayMarketIndex);
router.get('/intraday-indices', marketController.getIntradayMarketIndices);
router.get('/market-index-detail', marketController.getMarketIndexDetail);
router.get('/news', marketController.getCafefNews);

// Trái phiếu doanh nghiệp (Neopro)
router.get('/corp-bond-list', marketController.getCorpBondList);
router.get('/corp-bond-info/:symbol', marketController.getCorpBondInfo);

// VPBank API Proxy endpoints
router.get('/symbols/:symbol/company-info', marketController.getCompanyInfo);
router.get('/symbols/:symbol/shareholders', marketController.getShareholders);
router.get('/symbols/:symbol/advanced-info', marketController.getAdvancedInfo);
router.get('/symbols/:symbol/intraday-ohlcv', marketController.getIntradayOHLCV);
router.get('/symbols/:symbol/matching-history', marketController.getMatchingHistory);
router.get('/symbols/:symbol/order-book', marketController.getOrderBook);

export default router;
