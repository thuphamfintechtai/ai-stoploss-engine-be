# Coding Conventions

**Analysis Date:** 2026-03-26

## Overview

This is a full-stack trading application with a React + TypeScript frontend (`ai-stoploss-engine-fe`) and Node.js + Express backend (`ai-stoploss-engine-be`). Conventions differ between frontend and backend but follow clear patterns within each.

## Frontend (React + TypeScript)

### Naming Patterns

**Files:**
- React components: PascalCase with `.tsx` extension. Example: `DashboardView.tsx`, `TraderCard.tsx`, `AuthView.tsx`
- Utility files: camelCase with `.ts` extension. Example: `vnStockRules.ts`, `api.ts`, `websocket.ts`
- Chart plugin files: kebab-case with `.ts` extension. Example: `rectangle-drawing-tool.ts`, `plugin-base.ts`

**Functions:**
- Components: Exported as named constants with PascalCase. Example:
  ```typescript
  export const AuthView: React.FC<AuthViewProps> = ({ onSuccess }) => { ... }
  ```
- Utility functions: camelCase. Example: `convertToLightweightTime()`, `calculateSMA()`, `getPriceStep()`
- Event handlers: camelCase with `on` or descriptive verb prefix. Example: `onAiCheck`, `onSuccess`

**Variables:**
- Constants (file-level): UPPER_SNAKE_CASE. Example: `EXCHANGES`, `MARKET_INDEX_CODES`, `STOCK_PRICE_DISPLAY_SCALE`
- Local variables and function parameters: camelCase. Example: `portfolioId`, `maxRiskPercent`, `newPosition`
- React state: camelCase. Example: `isAnalyzing`, `isHighRisk`

**Types/Interfaces:**
- PascalCase for all type definitions. Example: `TraderProfile`, `AiAnalysis`, `Position`, `TradeConfig`
- Interfaces for component props: `{ComponentName}Props`. Example: `AuthViewProps`, `TraderCardProps`

### Code Style

**Formatting:**
- Vite with React plugin (no explicit Prettier/ESLint config found)
- Indentation: 2 spaces (inferred from source)
- Line endings: LF (standard for Node.js projects)
- TypeScript target: ES2022
- JSX mode: react-jsx (automatic imports)

**Imports Organization:**
1. React and third-party libraries (`import React, { useState } from 'react'`)
2. Chart libraries (`import { createChart } from 'lightweight-charts'`)
3. UI libraries (`import { PieChart, Pie } from 'recharts'`)
4. Internal type imports (`import type { Position } from './services/api'`)
5. Internal component imports (`import { DashboardView } from './components/DashboardView'`)
6. Service imports (`import { portfolioApi } from './services/api'`)
7. Utility imports (`import { EXCHANGES, formatNumberVI } from './constants'`)

**Path Aliases:**
- Configured in `tsconfig.json`: `@/*` maps to `./*` (project root)
- Used in imports like `import { authApi } from '@/services/api'` (though most imports use relative paths)

## Backend (Node.js + Express)

### Naming Patterns

**Files:**
- Controllers: `{resource}.controller.js`. Example: `auth.controller.js`, `portfolio.controller.js`, `position.controller.js`
- Models: PascalCase class names in `{Model}.js` files. Example: `User.js`, `Portfolio.js`, `Position.js`
- Routes: `{resource}.routes.js`. Example: `auth.routes.js`, `portfolio.routes.js`
- Middleware: descriptive name in `middleware/` directory. Example: `auth.js`, `errorHandler.js`, `validation.js`
- Services: descriptive name with "Service" or "Calculator" suffix. Example: `riskCalculator.js`, `notificationService.js`, `fillEngine.js`
- Configuration: `config/{name}.js`. Example: `database.js`, `constants.js`
- Workers/Scripts: descriptive names in `workers/` or `scripts/`. Example: `stopLossMonitor.js`, `migrate.js`

**Functions:**
- Controllers (route handlers): camelCase. Example: `register`, `login`, `getAll`, `getById`, `create`
- Model static methods: camelCase. Example: `findById`, `findByEmail`, `findByUsername`, `validatePassword`, `create`
- Middleware functions: camelCase. Example: `authenticateToken`, `validate`, `validateQuery`, `errorHandler`
- Service class methods: camelCase. Example: `calculatePositionRisk`, `validatePositionAgainstRisk`

**Variables:**
- Constants: UPPER_SNAKE_CASE. Example: `DB_SCHEMA`, `BCRYPT_ROUNDS`, `PORT`
- Database columns returned from queries: snake_case (reflecting PostgreSQL table structure). Example: `user_id`, `password_hash`, `full_name`, `created_at`
- API request/response field names: camelCase. Example: `totalBalance`, `maxRiskPercent`, `expectedReturnPercent`
- Local variables: camelCase. Example: `existingUser`, `newHash`, `portfolioId`

**Classes:**
- Model classes: PascalCase. Example: `class User`, `class Portfolio`, `class Position`
- Exported as default: `export default ClassName`

### Code Style

**Formatting:**
- No explicit Prettier/ESLint config found - appears to be freestyle formatting
- Indentation: 2 spaces (observed consistently)
- Using ES6 modules (`import`/`export`)
- `"type": "module"` in package.json enables ES6 modules

**Imports Organization:**
1. Core modules: `import express from 'express'`, `import jwt from 'jsonwebtoken'`
2. Third-party packages: `import { query } from '../config/database.js'`, `import Joi from 'joi'`
3. Internal middleware: `import { validate } from '../middleware/validation.js'`
4. Internal routes: `import routes from './routes/index.js'`

**Response Format:**
All API responses follow a consistent structure:
```javascript
{
  success: boolean,
  data?: T,           // Optional data payload
  message?: string,   // Optional message (for errors or info)
  error?: string,     // Optional error details
  errors?: Array      // Optional validation error array with field and message
}
```

Validation errors:
```javascript
{
  success: false,
  message: 'Validation error',
  errors: [
    { field: 'email', message: 'Email is required' },
    { field: 'password', message: 'Password must be at least 6 characters' }
  ]
}
```

## Error Handling

**Frontend:**
- React Error Boundary component: `AppErrorBoundary.tsx`
- API client uses axios with interceptors for 401 responses (triggers logout)
- Errors dispatched via custom events: `new CustomEvent('auth:logout')`
- Try-catch in async operations with error object handling

**Backend:**
- Express error handler middleware: `middleware/errorHandler.js`
- Handles Joi validation errors with `err.isJoi` check
- PostgreSQL errors by error code (23505 for unique violation, 23503 for foreign key)
- All errors return JSON with `success: false` and message
- Stack trace included in responses only when `NODE_ENV === 'development'`
- Controllers use try-catch with `next(error)` to pass to global error handler

Pattern in controllers:
```javascript
export const functionName = async (req, res, next) => {
  try {
    // Business logic
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);  // Pass to global error handler
  }
};
```

## Logging

**Frontend:**
- Uses `console.log()` for debug output (in index.tsx for theme initialization)
- No structured logging library detected

**Backend:**
- Uses `console.log()`, `console.error()`, `console.warn()`
- Debug logging enabled via `LOG_LEVEL === 'debug'` environment variable
- Request logging middleware logs method, path, and timestamp: `[ISO timestamp] METHOD PATH`
- Server startup outputs formatted messages with visual separators (ASCII art with `=` characters)
- Worker processes (stopLossMonitor) use console for lifecycle events

## Comments

**JSDoc/TSDoc:**
- Backend services use JSDoc comments above methods. Example from `riskCalculator.js`:
  ```javascript
  /**
   * Risk Calculator – Đơn vị tiền tệ: VND (tiền Việt Nam).
   * Toàn bộ logic: total_balance, max_risk, current_risk, risk_value, profit_loss đều VND.
   */
  ```
- Frontend: Comments used sparingly, mostly for helper functions
- Vietnamese comments mixed with English in complex business logic

**Inline Comments:**
- Strategic comments explaining business logic (e.g., "Input: '12/2/2026' (dd/mm/yyyy) → Output: '2026-02-12' (yyyy-mm-dd)")
- Comments in utility functions explaining calculation steps

## Validation

**Frontend:**
- TypeScript for type safety
- API response type definitions for contract enforcement
- Axios request/response interceptors

**Backend:**
- Joi schema validation for all request bodies
- Separate validation schemas exported near controller functions
- Validation schemas define field types, requirements, lengths, ranges
- Validation middleware applies schemas before controller execution: `router.post('/endpoint', validate(schema), controller)`
- Request body becomes `req.validatedBody` after validation passes
- Query string validation via `validateQuery()` middleware

Example schema:
```javascript
export const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  username: Joi.string().min(3).max(50).required(),
  password: Joi.string().min(6).required(),
  fullName: Joi.string().max(255).optional()
});
```

## Async/Await

**Backend:**
- All database operations use async/await
- Controllers are async functions
- Static methods in models are async
- Database operations wrapped in try-catch blocks
- Error handler at controller level via `next(error)`

**Frontend:**
- Async operations in event handlers and effects
- useState for loading states during async calls
- Axios promises for API calls

## Module Exports

**Backend:**
- Controllers export named functions for individual routes
- Schemas exported as named exports alongside controllers
- Models export default class: `export default User`
- Routes export default router: `export default router`
- Middleware/services export named functions or default object

**Frontend:**
- Components export const with React.FC type: `export const ComponentName: React.FC<Props> = (...) => {}`
- Service modules export named functions and interfaces
- Constants exported as named exports
- Types exported as interfaces

## Code Organization

**Backend Layers:**
1. Routes (`routes/*.js`) - HTTP endpoint definitions
2. Controllers (`controllers/*.js`) - Request handlers and business logic
3. Models (`models/*.js`) - Database queries and data access
4. Services (`services/*.js`) - Business logic utilities (risk calc, notifications, etc.)
5. Middleware (`middleware/*.js`) - Cross-cutting concerns (auth, validation, error handling)
6. Config (`config/*.js`) - Configuration and database setup

**Frontend Layers:**
1. Components (`components/*.tsx`) - React UI components
2. Services (`services/*.ts`) - API calls, WebSocket, external integrations
3. Utilities (`utils/*.ts`) - Pure functions for business rules
4. Chart plugins (`chart-plugins/*.ts`) - Custom chart extensions
5. Types (`types.ts`) - TypeScript interfaces
6. Constants (`constants.ts`) - Application constants

## Database Field Naming

- PostgreSQL tables use snake_case columns
- JavaScript/API use camelCase for field names
- Conversion happens at model layer:
  - API sends `totalBalance`, model converts to `total_balance` for DB query
  - DB returns `total_balance`, API converts to `totalBalance` in response

---

*Convention analysis: 2026-03-26*
