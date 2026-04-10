import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection } from './config/database.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { initializeWebSocket } from './services/websocket.js';
import { startPriceAlertMonitor } from './services/priceAlertMonitor.js';
import { startWorker } from './workers/stopLossMonitor.js';
import { startSettlementWorker } from './workers/settlementWorker.js';
import { startPaperFillWorker } from './workers/paperFillWorker.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

// CORS
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.LOG_LEVEL === 'debug') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// Routes
app.use('/', routes);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'AI Stop-Loss Engine API',
    version: '1.1.0',
    endpoints: {
      health: 'GET /api/health',
      auth: 'POST /api/auth/register, POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout',
      portfolios: 'GET/POST /api/portfolios, GET/PUT/DELETE /api/portfolios/:id, GET /api/portfolios/:id/risk, GET /api/portfolios/:id/performance',
      orders: 'GET/POST /api/portfolios/:portfolioId/orders, DELETE /api/portfolios/:portfolioId/orders/:id',
      positions: 'GET/POST /api/portfolios/:portfolioId/positions, GET/PATCH /api/portfolios/:portfolioId/positions/:id, POST /api/portfolios/:portfolioId/positions/calculate, POST /api/portfolios/:portfolioId/positions/:id/close',
      market: 'GET /api/market/position-form-spec, GET /api/market/symbols/:symbol/entry-info, GET /api/market/stocks|symbols|...',
      ai: 'POST /api/ai/suggest-sltp, POST /api/ai/analyze-trend, POST /api/ai/evaluate-risk, GET /api/ai/signals, GET /api/ai/dashboard, GET /api/ai/evaluations',
      notifications: 'GET /api/notifications, GET /api/notifications/unread-count, PATCH /api/notifications/:id/read, POST /api/notifications/mark-all-read, DELETE /api/notifications/:id'
    }
  });
});

app.use(notFound);
app.use(errorHandler);

async function startServer() {
  try {
    console.log('🔌 Connecting to database...');
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error('Database connection failed. Exiting...');
      process.exit(1);
    }

    console.log('🔌 Initializing WebSocket server...');
    initializeWebSocket(httpServer);

    console.log('📡 Starting Price Alert Monitor...');
    startPriceAlertMonitor();

    console.log('📊 Starting Stop-Loss / Take-Profit Worker...');
    startWorker();

    console.log('💰 Starting Settlement Worker...');
    startSettlementWorker();

    console.log('📄 Paper Fill Worker starting...');
    startPaperFillWorker();

    httpServer.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log('🚀 AI STOP-LOSS ENGINE - BACKEND');
      console.log('='.repeat(60));
      console.log(`   Server: http://${process.env.HOST || 'localhost'}:${PORT}`);
      console.log(`   API: http://${process.env.HOST || 'localhost'}:${PORT}/api`);
      console.log('='.repeat(60));
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();
