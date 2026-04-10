# TradeGuard AI - Backend

Backend API server cho hệ thống hỗ trợ dừng lỗ và chốt lợi nhuận tăng cường AI, phục vụ nhà đầu tư chứng khoán Việt Nam.

Hệ thống gồm 2 module chính: Portfolio Management (quản lý danh mục thật) và Paper Trading (mô phỏng giao dịch). Tích hợp Google Gemini AI để tư vấn stop loss, take profit, cảnh báo rủi ro và hỗ trợ ra quyết định.


## Công nghệ

- **Runtime:** Node.js (ES Modules)
- **Framework:** Express.js
- **Database:** PostgreSQL
- **Real-time:** Socket.IO
- **AI:** Google Gemini
- **Validation:** Joi
- **Auth:** JWT + bcrypt
- **Testing:** Vitest


## Cấu trúc thư mục

```
ai-stoploss-engine-be/
├── index.js                    # Entry point - Express server + Socket.IO
├── config/
│   ├── database.js             # PostgreSQL connection pool
│   └── constants.js            # Hằng số ứng dụng
├── middleware/
│   ├── auth.js                 # Xác thực JWT
│   ├── errorHandler.js         # Xử lý lỗi tập trung
│   └── validation.js           # Validation request với Joi
├── migrations/
│   ├── schema.sql              # Schema chính
│   └── 003-009_*.sql           # Các migration bổ sung
├── models/
│   ├── User.js                 # Người dùng
│   ├── Portfolio.js            # Danh mục đầu tư
│   ├── Position.js             # Vị thế giao dịch
│   ├── Order.js                # Lệnh giao dịch
│   ├── Notification.js         # Thông báo
│   ├── AiRecommendation.js     # Khuyến nghị AI
│   └── ExecutionLog.js         # Log thực thi
├── routes/
│   ├── index.js                # Mount tất cả routes
│   ├── auth.routes.js          # Đăng nhập, đăng ký
│   ├── portfolio.routes.js     # CRUD danh mục + vị thế + lệnh
│   ├── market.routes.js        # Dữ liệu thị trường VPBS
│   ├── ai.routes.js            # Phân tích AI, khuyến nghị
│   ├── orders.routes.js        # Quản lý lệnh
│   ├── notifications.routes.js # Thông báo
│   ├── watchlist.routes.js     # Danh sách theo dõi
│   └── priceAlerts.routes.js   # Cảnh báo giá
├── controllers/
│   ├── auth.controller.js      # Xử lý đăng nhập/đăng ký
│   ├── portfolio.controller.js # Xử lý danh mục
│   ├── market.controller.js    # Xử lý dữ liệu thị trường
│   ├── ai.controller.js        # Xử lý phân tích AI
│   ├── paper/                  # Paper trading controllers
│   │   ├── paperPosition.controller.js
│   │   ├── paperOrder.controller.js
│   │   └── paperPerformance.controller.js
│   └── portfolio/              # Portfolio management controllers
│       ├── realOrder.controller.js
│       ├── realPosition.controller.js
│       └── portfolioSummary.controller.js
├── services/
│   ├── aiService.js            # Tích hợp Google Gemini
│   ├── stopLossResolver.js     # Quyết định đóng vị thế (SL/TP)
│   ├── priceAlertMonitor.js    # Giám sát cảnh báo giá
│   ├── cafefNewsService.js     # Tin tức từ CafeF
│   ├── marketNewsService.js    # Tin tức thị trường
│   ├── ai/                     # Các service AI chuyên biệt
│   │   ├── dynamicStopLoss.js      # Stop loss động theo volatility
│   │   ├── capitalAllocation.js     # Phân bổ vốn tối ưu
│   │   ├── rebalancingSuggestion.js # Tái cân bằng danh mục
│   │   ├── monteCarloService.js     # Mô phỏng Monte Carlo
│   │   ├── varService.js            # Value at Risk
│   │   ├── stressTestService.js     # Stress test danh mục
│   │   ├── probabilityTP.js         # Xác suất chốt lời
│   │   ├── sectorClassification.js  # Phân loại ngành
│   │   ├── sectorConcentration.js   # Tập trung ngành
│   │   ├── regimeDetector.js        # Nhận diện xu hướng thị trường
│   │   └── indicatorCache.js        # Cache chỉ báo kỹ thuật
│   ├── paper/                  # Paper trading services
│   │   ├── fillEngine.js           # Khớp lệnh paper
│   │   ├── paperMatchingEngine.js   # So khớp giá
│   │   ├── paperCapitalService.js   # Quản lý vốn paper
│   │   └── paperPerformanceService.js # Báo cáo hiệu suất
│   ├── portfolio/              # Portfolio services
│   │   ├── capitalService.js       # Quản lý vốn thật
│   │   ├── realOrderService.js     # Xử lý lệnh thật
│   │   └── realPositionService.js  # Xử lý vị thế thật
│   └── shared/                 # Services dùng chung
│       ├── websocket.js            # WebSocket broadcast
│       ├── marketPriceService.js   # Lấy giá từ VPBS
│       ├── riskCalculator.js       # Tính rủi ro vị thế
│       ├── feeEngine.js            # Tính phí giao dịch
│       ├── tickSizeEngine.js       # Bước giá theo sàn
│       ├── slippageCalculator.js   # Tính trượt giá
│       ├── notificationService.js  # Gửi thông báo
│       └── priceBandValidator.js   # Kiểm tra biên độ giá
├── workers/
│   ├── stopLossMonitor.js      # Giám sát SL/TP (chạy mỗi 2 phút)
│   ├── paperFillWorker.js      # Kiểm tra khớp lệnh paper
│   └── settlementWorker.js     # Xử lý thanh toán T+2
├── scripts/
│   ├── migrate.js              # Chạy migration
│   ├── seed.js                 # Tạo dữ liệu mẫu
│   └── ...                     # Các script tiện ích khác
└── tests/                      # Unit tests (Vitest)
    ├── helpers/
    └── services/
```


## Cài đặt

### Yêu cầu

- Node.js v18+
- PostgreSQL 12+

### Các bước

1. Cài đặt dependencies:

```bash
npm install
```

2. Tạo file `.env` từ mẫu:

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

3. Chạy migration:

```bash
npm run migrate
```

4. (Tùy chọn) Tạo dữ liệu mẫu:

```bash
npm run seed
```

5. Khởi động server:

```bash
npm run dev
```

Server chạy tại `http://localhost:3000`.


## API Endpoints

### Authentication

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | /api/auth/register | Đăng ký tài khoản |
| POST | /api/auth/login | Đăng nhập |

### Portfolio

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | /api/portfolios | Lấy danh sách danh mục |
| POST | /api/portfolios | Tạo danh mục mới |
| GET | /api/portfolios/:id | Chi tiết danh mục |
| PUT | /api/portfolios/:id | Cập nhật danh mục |
| DELETE | /api/portfolios/:id | Xóa danh mục |
| GET | /api/portfolios/:id/positions | Lấy vị thế trong danh mục |
| POST | /api/portfolios/:id/positions | Tạo vị thế mới |
| GET | /api/portfolios/:id/orders | Lấy lệnh trong danh mục |
| POST | /api/portfolios/:id/orders | Đặt lệnh mới |
| GET | /api/portfolios/:id/summary | Tổng quan danh mục |

### Market Data

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | /api/market/price/:symbol | Giá hiện tại từ VPBS |
| GET | /api/market/chart/:symbol | Dữ liệu biểu đồ OHLCV |
| GET | /api/market/company/:symbol | Thông tin công ty |
| GET | /api/market/intraday/:symbol | Lịch sử khớp lệnh trong ngày |
| GET | /api/market/news | Tin tức thị trường |

### AI Analysis

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | /api/ai/analyze-position | Phân tích vị thế |
| POST | /api/ai/stop-loss | Tính stop loss động |
| POST | /api/ai/capital-allocation | Phân bổ vốn tối ưu |
| POST | /api/ai/rebalancing | Gợi ý tái cân bằng |
| POST | /api/ai/monte-carlo | Mô phỏng Monte Carlo |
| POST | /api/ai/var | Tính Value at Risk |
| POST | /api/ai/stress-test | Stress test danh mục |

### Watchlist

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | /api/watchlist | Lấy danh sách theo dõi |
| POST | /api/watchlist | Thêm mã vào watchlist |
| DELETE | /api/watchlist/:symbol | Xóa mã khỏi watchlist |

### Price Alerts

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | /api/price-alerts | Lấy danh sách cảnh báo |
| POST | /api/price-alerts | Tạo cảnh báo giá |
| DELETE | /api/price-alerts/:id | Xóa cảnh báo |

### Health Check

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | /api/health | Kiểm tra trạng thái server |


## Scripts

| Lệnh | Mô tả |
|------|-------|
| `npm run dev` | Chạy development (auto-reload) |
| `npm start` | Chạy production |
| `npm run migrate` | Chạy database migrations |
| `npm run seed` | Tạo dữ liệu mẫu |
| `npm test` | Chạy tất cả tests |
| `npm run test:watch` | Chạy tests (watch mode) |


## Background Workers

Hệ thống có 3 worker chạy nền:

- **Stop Loss Monitor** - Kiểm tra các vị thế mỗi 2 phút, tự động đóng khi chạm ngưỡng SL/TP. Xử lý xung đột giữa SL và TP, tính trượt giá.
- **Paper Fill Worker** - Kiểm tra lệnh paper trading có khớp với giá thị trường không, tự động fill khi đủ điều kiện.
- **Settlement Worker** - Xử lý thanh toán T+2 theo quy định sàn chứng khoán Việt Nam.


## WebSocket Events

Server phát các sự kiện real-time qua Socket.IO:

| Event | Mô tả |
|-------|-------|
| `position:updated` | Vị thế được cập nhật (SL/TP triggered) |
| `position:closed` | Vị thế đã đóng |
| `order:filled` | Lệnh đã khớp |
| `price:alert` | Cảnh báo giá đạt ngưỡng |
| `notification:new` | Thông báo mới |


## Testing

```bash
# Chạy tất cả tests
npm test

# Chạy tests và theo dõi thay đổi
npm run test:watch
```

Tests sử dụng Vitest, bao gồm:
- Paper trading engine (order, fill, matching, capital, performance)
- AI services (stop loss động, phân bổ vốn, VaR, Monte Carlo, stress test)
- Portfolio services (order, position, settlement, summary)


## Ghi chú

- Tất cả giá trị tiền tệ tính bằng VND (đồng).
- Giá từ VPBS trả về đơn vị nghìn, hệ thống tự động chuyển về VND.
- Bước giá (tick size) áp dụng theo quy định của từng sàn (HOSE, HNX, UPCOM).
- Thanh toán theo quy tắc T+2 của thị trường chứng khoán Việt Nam.
