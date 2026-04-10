# TradeGuard AI - Backend

Backend API server cho he thong ho tro dung lo va chot loi nhuan tang cuong AI, phuc vu nha dau tu chung khoan Viet Nam.

He thong gom 2 module chinh: Portfolio Management (quan ly danh muc that) va Paper Trading (mo phong giao dich). Tich hop Google Gemini AI de tu van stop loss, take profit, canh bao rui ro va ho tro ra quyet dinh.


## Cong nghe

- **Runtime:** Node.js (ES Modules)
- **Framework:** Express.js
- **Database:** PostgreSQL
- **Real-time:** Socket.IO
- **AI:** Google Gemini
- **Validation:** Joi
- **Auth:** JWT + bcrypt
- **Testing:** Vitest


## Cau truc thu muc

```
ai-stoploss-engine-be/
├── index.js                    # Entry point - Express server + Socket.IO
├── config/
│   ├── database.js             # PostgreSQL connection pool
│   └── constants.js            # Hang so ung dung
├── middleware/
│   ├── auth.js                 # Xac thuc JWT
│   ├── errorHandler.js         # Xu ly loi tap trung
│   └── validation.js           # Validation request voi Joi
├── migrations/
│   ├── schema.sql              # Schema chinh
│   └── 003-009_*.sql           # Cac migration bo sung
├── models/
│   ├── User.js                 # Nguoi dung
│   ├── Portfolio.js            # Danh muc dau tu
│   ├── Position.js             # Vi the giao dich
│   ├── Order.js                # Lenh giao dich
│   ├── Notification.js         # Thong bao
│   ├── AiRecommendation.js     # Khuyen nghi AI
│   └── ExecutionLog.js         # Log thuc thi
├── routes/
│   ├── index.js                # Mount tat ca routes
│   ├── auth.routes.js          # Dang nhap, dang ky
│   ├── portfolio.routes.js     # CRUD danh muc + vi the + lenh
│   ├── market.routes.js        # Du lieu thi truong VPBS
│   ├── ai.routes.js            # Phan tich AI, khuyen nghi
│   ├── orders.routes.js        # Quan ly lenh
│   ├── notifications.routes.js # Thong bao
│   ├── watchlist.routes.js     # Danh sach theo doi
│   └── priceAlerts.routes.js   # Canh bao gia
├── controllers/
│   ├── auth.controller.js      # Xu ly dang nhap/dang ky
│   ├── portfolio.controller.js # Xu ly danh muc
│   ├── market.controller.js    # Xu ly du lieu thi truong
│   ├── ai.controller.js        # Xu ly phan tich AI
│   ├── paper/                  # Paper trading controllers
│   │   ├── paperPosition.controller.js
│   │   ├── paperOrder.controller.js
│   │   └── paperPerformance.controller.js
│   └── portfolio/              # Portfolio management controllers
│       ├── realOrder.controller.js
│       ├── realPosition.controller.js
│       └── portfolioSummary.controller.js
├── services/
│   ├── aiService.js            # Tich hop Google Gemini
│   ├── stopLossResolver.js     # Quyet dinh dong vi the (SL/TP)
│   ├── priceAlertMonitor.js    # Giam sat canh bao gia
│   ├── cafefNewsService.js     # Tin tuc tu CafeF
│   ├── marketNewsService.js    # Tin tuc thi truong
│   ├── ai/                     # Cac service AI chuyen biet
│   │   ├── dynamicStopLoss.js      # Stop loss dong theo volatility
│   │   ├── capitalAllocation.js     # Phan bo von toi uu
│   │   ├── rebalancingSuggestion.js # Tai can bang danh muc
│   │   ├── monteCarloService.js     # Mo phong Monte Carlo
│   │   ├── varService.js            # Value at Risk
│   │   ├── stressTestService.js     # Stress test danh muc
│   │   ├── probabilityTP.js         # Xac suat chot loi
│   │   ├── sectorClassification.js  # Phan loai nganh
│   │   ├── sectorConcentration.js   # Tap trung nganh
│   │   ├── regimeDetector.js        # Nhan dien xu huong thi truong
│   │   └── indicatorCache.js        # Cache chi bao ky thuat
│   ├── paper/                  # Paper trading services
│   │   ├── fillEngine.js           # Khop lenh paper
│   │   ├── paperMatchingEngine.js   # So khop gia
│   │   ├── paperCapitalService.js   # Quan ly von paper
│   │   └── paperPerformanceService.js # Bao cao hieu suat
│   ├── portfolio/              # Portfolio services
│   │   ├── capitalService.js       # Quan ly von that
│   │   ├── realOrderService.js     # Xu ly lenh that
│   │   └── realPositionService.js  # Xu ly vi the that
│   └── shared/                 # Services dung chung
│       ├── websocket.js            # WebSocket broadcast
│       ├── marketPriceService.js   # Lay gia tu VPBS
│       ├── riskCalculator.js       # Tinh rui ro vi the
│       ├── feeEngine.js            # Tinh phi giao dich
│       ├── tickSizeEngine.js       # Buoc gia theo san
│       ├── slippageCalculator.js   # Tinh truot gia
│       ├── notificationService.js  # Gui thong bao
│       └── priceBandValidator.js   # Kiem tra bien do gia
├── workers/
│   ├── stopLossMonitor.js      # Giam sat SL/TP (chay moi 2 phut)
│   ├── paperFillWorker.js      # Kiem tra khop lenh paper
│   └── settlementWorker.js     # Xu ly thanh toan T+2
├── scripts/
│   ├── migrate.js              # Chay migration
│   ├── seed.js                 # Tao du lieu mau
│   └── ...                     # Cac script tien ich khac
└── tests/                      # Unit tests (Vitest)
    ├── helpers/
    └── services/
```


## Cai dat

### Yeu cau

- Node.js v18+
- PostgreSQL 12+

### Cac buoc

1. Cai dat dependencies:

```bash
npm install
```

2. Tao file `.env` tu mau:

```
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database
DB_USER=your_user
DB_PASSWORD=your_password
DB_SCHEMA=financial

JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d

GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash

CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info
```

3. Chay migration:

```bash
npm run migrate
```

4. (Tuy chon) Tao du lieu mau:

```bash
npm run seed
```

5. Khoi dong server:

```bash
npm run dev
```

Server chay tai `http://localhost:3000`.


## API Endpoints

### Authentication

| Method | Endpoint | Mo ta |
|--------|----------|-------|
| POST | /api/auth/register | Dang ky tai khoan |
| POST | /api/auth/login | Dang nhap |

### Portfolio

| Method | Endpoint | Mo ta |
|--------|----------|-------|
| GET | /api/portfolios | Lay danh sach danh muc |
| POST | /api/portfolios | Tao danh muc moi |
| GET | /api/portfolios/:id | Chi tiet danh muc |
| PUT | /api/portfolios/:id | Cap nhat danh muc |
| DELETE | /api/portfolios/:id | Xoa danh muc |
| GET | /api/portfolios/:id/positions | Lay vi the trong danh muc |
| POST | /api/portfolios/:id/positions | Tao vi the moi |
| GET | /api/portfolios/:id/orders | Lay lenh trong danh muc |
| POST | /api/portfolios/:id/orders | Dat lenh moi |
| GET | /api/portfolios/:id/summary | Tong quan danh muc |

### Market Data

| Method | Endpoint | Mo ta |
|--------|----------|-------|
| GET | /api/market/price/:symbol | Gia hien tai tu VPBS |
| GET | /api/market/chart/:symbol | Du lieu bieu do OHLCV |
| GET | /api/market/company/:symbol | Thong tin cong ty |
| GET | /api/market/intraday/:symbol | Lich su khop lenh trong ngay |
| GET | /api/market/news | Tin tuc thi truong |

### AI Analysis

| Method | Endpoint | Mo ta |
|--------|----------|-------|
| POST | /api/ai/analyze-position | Phan tich vi the |
| POST | /api/ai/stop-loss | Tinh stop loss dong |
| POST | /api/ai/capital-allocation | Phan bo von toi uu |
| POST | /api/ai/rebalancing | Goi y tai can bang |
| POST | /api/ai/monte-carlo | Mo phong Monte Carlo |
| POST | /api/ai/var | Tinh Value at Risk |
| POST | /api/ai/stress-test | Stress test danh muc |

### Watchlist

| Method | Endpoint | Mo ta |
|--------|----------|-------|
| GET | /api/watchlist | Lay danh sach theo doi |
| POST | /api/watchlist | Them ma vao watchlist |
| DELETE | /api/watchlist/:symbol | Xoa ma khoi watchlist |

### Price Alerts

| Method | Endpoint | Mo ta |
|--------|----------|-------|
| GET | /api/price-alerts | Lay danh sach canh bao |
| POST | /api/price-alerts | Tao canh bao gia |
| DELETE | /api/price-alerts/:id | Xoa canh bao |

### Health Check

| Method | Endpoint | Mo ta |
|--------|----------|-------|
| GET | /api/health | Kiem tra trang thai server |


## Scripts

| Lenh | Mo ta |
|------|-------|
| `npm run dev` | Chay development (auto-reload) |
| `npm start` | Chay production |
| `npm run migrate` | Chay database migrations |
| `npm run seed` | Tao du lieu mau |
| `npm test` | Chay tat ca tests |
| `npm run test:watch` | Chay tests (watch mode) |


## Background Workers

He thong co 3 worker chay nen:

- **Stop Loss Monitor** - Kiem tra cac vi the moi 2 phut, tu dong dong khi cham nguong SL/TP. Xu ly xung dot giua SL va TP, tinh truot gia.
- **Paper Fill Worker** - Kiem tra lenh paper trading co khop voi gia thi truong khong, tu dong fill khi du dieu kien.
- **Settlement Worker** - Xu ly thanh toan T+2 theo quy dinh san chung khoan Viet Nam.


## WebSocket Events

Server phat cac su kien real-time qua Socket.IO:

| Event | Mo ta |
|-------|-------|
| `position:updated` | Vi the duoc cap nhat (SL/TP triggered) |
| `position:closed` | Vi the da dong |
| `order:filled` | Lenh da khop |
| `price:alert` | Canh bao gia dat nguong |
| `notification:new` | Thong bao moi |


## Testing

```bash
# Chay tat ca tests
npm test

# Chay tests va theo doi thay doi
npm run test:watch
```

Tests su dung Vitest, bao gom:
- Paper trading engine (order, fill, matching, capital, performance)
- AI services (stop loss dong, phan bo von, VaR, Monte Carlo, stress test)
- Portfolio services (order, position, settlement, summary)


## Ghi chu

- Tat ca gia tri tien te tinh bang VND (dong).
- Gia tu VPBS tra ve don vi nghin, he thong tu dong chuyen ve VND.
- Buoc gia (tick size) ap dung theo quy dinh cua tung san (HOSE, HNX, UPCOM).
- Thanh toan theo quy tac T+2 cua thi truong chung khoan Viet Nam.
