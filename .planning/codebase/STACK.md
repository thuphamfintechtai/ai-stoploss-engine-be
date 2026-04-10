# Technology Stack

**Analysis Date:** 2026-03-26

## Languages

**Primary:**
- JavaScript/TypeScript - Used across frontend and backend
- Node.js - Backend runtime

**Secondary:**
- SQL - PostgreSQL schema and queries
- HTML/CSS - Frontend markup and styling

## Runtime

**Environment:**
- Node.js v24.10.0 - Server runtime for backend
- Browser runtime - Client-side React application

**Package Manager:**
- npm v10+ - Dependency management
- Lockfiles: `package-lock.json` present in both `ai-stoploss-engine-be` and `ai-stoploss-engine-fe`

## Frameworks

**Core:**
- React 19.2.4 - Frontend UI library
- Express.js 4.21.0 - Backend HTTP framework
- Vite 6.2.0 - Frontend build tool and dev server
- Socket.IO 4.6.1 (backend), 4.8.3 (client) - Real-time WebSocket communication

**UI & Styling:**
- Tailwind CSS 4.1.18 - Utility-first CSS framework
- PostCSS 8.5.6 - CSS processing
- Autoprefixer 10.4.24 - CSS vendor prefixing

**Testing & Dev Tools:**
- TypeScript ~5.8.2 - Type safety
- Vite React Plugin 5.0.0 - React integration for Vite

## Key Dependencies

**Critical:**
- `@google/generative-ai` 0.21.0 - Google Gemini AI integration for trading analysis
- `pg` 8.11.5 - PostgreSQL driver for database access
- `jsonwebtoken` 9.0.2 - JWT token generation and verification
- `bcrypt` 5.1.1 - Password hashing for authentication
- `axios` 1.6.5 / 1.13.5 - HTTP client for API requests
- `socket.io` + `socket.io-client` - Real-time bidirectional communication

**Infrastructure:**
- `dotenv` 16.4.1 - Environment variable management
- `cors` 2.8.5 - Cross-origin resource sharing middleware
- `express-rate-limit` 7.1.5 - API rate limiting
- `joi` 17.12.0 - Schema validation
- `uuid` 9.0.0 - UUID generation for unique IDs
- `node-cron` 3.0.3 - Job scheduling for background tasks
- `telegraf` 4.15.0 - Telegram bot integration (currently disabled)

**Frontend-Specific:**
- `recharts` 3.7.0 - Chart components for portfolio visualization
- `lightweight-charts` 5.1.0 - TradingView-style charting library
- `@google/genai` 1.41.0 - Gemini API client for frontend

## Configuration

**Environment:**
- Configuration via `.env` file in backend `ai-stoploss-engine-be/.env`
- Frontend uses Vite's `import.meta.env` for environment variables
- Frontend Vite config: `ai-stoploss-engine-fe/vite.config.ts`
- Key configs required:
  - Database credentials (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)
  - JWT secret (JWT_SECRET)
  - Gemini API key (GEMINI_API_KEY)
  - Firecrawl API key (FIRECRAWL_API_KEY)
  - Socket.IO configuration (CORS_ORIGIN)

**Build:**
- Backend: Node.js with ES modules
- Frontend: Vite with TypeScript
  - TypeScript config: `ai-stoploss-engine-fe/tsconfig.json`
  - Outputs to `dist/` directory
  - Source path alias `@/` resolves to project root

## Platform Requirements

**Development:**
- Node.js v24.10.0
- npm package manager
- PostgreSQL 12+ database
- Port 3000 (backend API)
- Port 5173 or 3000 (frontend dev server)
- API keys: Google Gemini, Firecrawl (optional)

**Production:**
- Node.js v24+
- PostgreSQL database server
- Static file hosting for built frontend (from `dist/`)
- Environment variables for secrets and configuration
- CORS configuration for cross-origin requests
- WebSocket support on main server or reverse proxy

---

*Stack analysis: 2026-03-26*
