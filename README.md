# AI Stop Loss Engine - Backend

Server Node.js với cấu trúc **index / controller / model / route**.

## Cấu trúc thư mục

```
├── index.js                 # Entry point, khởi tạo Express và mount routes
├── controller/              # Xử lý request/response, gọi model
│   └── example.controller.js
├── model/                   # Định nghĩa dữ liệu, logic truy vấn
│   └── example.model.js
├── route/                   # Định nghĩa API routes
│   └── index.js
├── package.json
└── README.md
```

## Cài đặt và chạy

```bash
npm install
npm start
```

Chạy ở chế độ dev (tự reload khi đổi code):

```bash
npm run dev
```

## API mẫu

- `GET /api/health` — Health check
- `GET /api/market/news` — Tin tức thị trường từ CafeF (cafef.vn). Query: `limit` (1–100), `search`, `format` (json|markdown|text). Có thể set `FIRECRAWL_API_KEY` trong `.env` để dùng Firecrawl (chất lượng tốt hơn), không có thì fallback scrape HTML.

Mặc định chạy tại: **http://localhost:3000**
