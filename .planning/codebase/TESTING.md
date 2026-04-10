# Testing Patterns

**Analysis Date:** 2026-03-26

## Overview

**Status:** No automated testing framework currently configured. No test files found in source code (excluding node_modules). Manual testing appears to be the only testing approach in this codebase.

## Test Framework

**Runner:**
- Not detected - No test runner (Jest, Vitest, Mocha) configured
- No test configuration file found (`jest.config.js`, `vitest.config.ts`, etc.)

**Assertion Library:**
- Not detected - No assertion libraries in package.json

**Run Commands:**
- No test commands in either `package.json` file
- Frontend: `dev`, `build`, `preview` scripts only
- Backend: `start`, `dev`, `migrate`, `seed`, `worker:stoploss` scripts only

## What Testing Does Exist

### Error Handling Testing (Implicit)

The codebase has defensive patterns that suggest manual testing approach:

**Backend Error Handling:**

Controllers implement try-catch blocks and pass errors to middleware. Example from `auth.controller.js`:
```javascript
export const register = async (req, res, next) => {
  try {
    // Business logic
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: { user: {...}, token }
    });
  } catch (error) {
    next(error);
  }
};
```

Error handler in `middleware/errorHandler.js` explicitly handles:
- Joi validation errors (`err.isJoi`)
- PostgreSQL errors by code (23505 for unique constraints, 23503 for foreign keys)
- JWT errors (`JsonWebTokenError`, `TokenExpiredError`)
- Generic 500 errors

**Frontend Error Boundaries:**

`components/AppErrorBoundary.tsx` - Error boundary component for catching React render errors
- Catches unhandled errors in component tree
- Prevents full app crash
- Pattern: Wrapping main app components with boundary

**API Client Error Handling:**

From `services/api.ts`:
```typescript
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:logout'));
      }
    }
    return Promise.reject(error);
  }
);
```

Handles 401 responses by clearing auth and triggering logout event.

### Input Validation (Pre-testing)

**Backend Validation:**

Joi schemas validate all request bodies before reaching controllers. From `auth.controller.js`:
```javascript
export const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  username: Joi.string().min(3).max(50).required(),
  password: Joi.string().min(6).required(),
  fullName: Joi.string().max(255).optional()
});

router.post('/register', validate(registerSchema), authController.register);
```

Validation happens in `middleware/validation.js`:
```javascript
export const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message
        }))
      });
    }
    req.validatedBody = value;
    next();
  };
};
```

**Frontend Type Safety:**

TypeScript enforces type safety at compile time. Example from `services/api.ts`:
```typescript
export interface Position {
  id: string;
  portfolio_id: string;
  symbol: string;
  exchange: string;
  entry_price: number;
  // ... 20+ typed fields
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}
```

### Database Integrity Testing (Implicit)

Models implement business logic validations. Example from `services/riskCalculator.js`:
```javascript
static async validatePositionAgainstRisk(portfolioId, newPositionRiskVND) {
  const portfolio = await Portfolio.findById(portfolioId);
  if (!portfolio) {
    return { allowed: false, reason: 'Portfolio not found' };
  }

  const totalRiskVND = currentRiskVND + addRisk;
  if (totalRiskVND > maxRiskVND) {
    return {
      allowed: false,
      reason: `Vượt hạn mức rủi ro. ...`,
      details: { /* detailed info */ }
    };
  }

  return { allowed: true, details: { /* risk details */ } };
}
```

## Test File Organization

**Current State:**
- No test files present in source code
- No dedicated `__tests__`, `tests/`, or `test/` directories
- No co-located `.test.ts` or `.spec.ts` files

**Recommended Structure (If Testing Added):**

For **backend** following established Node.js convention:
```
ai-stoploss-engine-be/
├── tests/
│   ├── unit/
│   │   ├── models/
│   │   │   └── User.test.js
│   │   ├── controllers/
│   │   │   └── auth.controller.test.js
│   │   └── services/
│   │       └── riskCalculator.test.js
│   └── integration/
│       ├── auth.integration.test.js
│       └── portfolio.integration.test.js
├── controllers/
├── models/
└── services/
```

For **frontend** following React convention:
```
ai-stoploss-engine-fe/
├── components/
│   ├── DashboardView.tsx
│   ├── DashboardView.test.tsx
│   └── TraderCard.test.tsx
├── services/
│   ├── api.ts
│   └── api.test.ts
└── utils/
    ├── vnStockRules.ts
    └── vnStockRules.test.ts
```

## Mocking Patterns

**Not Implemented** - No mocking framework detected (Jest, Sinon, etc.)

If testing were added, recommended approach based on codebase structure:

**Backend Mocking (Would Use Jest or Sinon):**
```javascript
// Mock database queries
jest.mock('../config/database.js', () => ({
  query: jest.fn()
}));

// Mock model methods
jest.mock('../models/User.js', () => ({
  __esModule: true,
  default: {
    findByEmail: jest.fn(),
    create: jest.fn()
  }
}));
```

**Frontend Mocking (Would Use Vitest or Jest with MSW):**
```typescript
// Mock API service
jest.mock('../services/api.ts', () => ({
  authApi: {
    login: jest.fn(),
    register: jest.fn()
  }
}));

// Mock WebSocket service
jest.mock('../services/websocket.ts');
```

## What Should Be Tested

### Backend - High Priority

**Controllers** (`ai-stoploss-engine-be/controllers/*.js`):
- Authentication flow (register, login, token validation)
- Authorization (user can only access their own portfolios)
- API response format consistency
- Error responses (400, 401, 403, 404, 409, 500)

**Models** (`ai-stoploss-engine-be/models/*.js`):
- CRUD operations (create, read, update, delete)
- Duplicate detection (unique constraints)
- Relationship integrity (foreign keys)

**Services** (`ai-stoploss-engine-be/services/*.js`):
- Risk calculation logic with edge cases
- Position fill calculations
- Stop-loss/take-profit order logic
- Notification formatting

**Middleware** (`ai-stoploss-engine-be/middleware/*.js`):
- JWT authentication and token verification
- Validation schema enforcement
- Error response formatting

### Frontend - High Priority

**Components** (`ai-stoploss-engine-fe/components/*.tsx`):
- Rendering with different data states (loading, error, success)
- User interactions (click handlers, form submission)
- Conditional rendering based on state
- Integration with API calls

**Services** (`ai-stoploss-engine-fe/services/*.ts`):
- API request/response handling
- Token inclusion in requests
- Error handling for failed requests
- WebSocket connection logic

**Utilities** (`ai-stoploss-engine-fe/utils/*.ts`):
- Stock market rules (tick size, price stepping)
- Calculations (risk, fees, profit/loss)
- Data transformations

## Testing Gaps

**Critical Gaps:**

1. **No unit tests** - Business logic untested
   - Risk calculations (`riskCalculator.js`)
   - Stock trading rules (`vnStockRules.ts`)
   - Fee/slippage calculations (`feeEngine.js`)

2. **No integration tests** - API flows untested
   - Authentication flow (register → login → use token)
   - Portfolio operations (create → add position → calculate risk → close position)
   - Stop-loss triggering workflow

3. **No component tests** - UI logic untested
   - Form validation feedback
   - Loading states
   - Error displays

4. **No e2e tests** - End-to-end workflows untested
   - Full trading workflow
   - Data consistency across features

5. **No API contract tests** - Response format consistency untested

## Recommended Testing Strategy

### Phase 1: Unit Tests (High Impact, Low Effort)
- Jest for backend
- Vitest for frontend
- Focus on utility functions and calculations first
- 70% coverage minimum

### Phase 2: Integration Tests
- Test API endpoints with real database
- Test component integration with services
- Mock external APIs (Gemini, VPBS)

### Phase 3: E2E Tests
- Playwright or Cypress
- Full user workflows
- Focus on critical trading operations

### Phase 4: Performance Tests
- Load testing for real-time price updates
- WebSocket stress testing
- Database query optimization validation

## Development Testing Process

Currently (without automation), developers should:

1. **Manual API Testing:**
   - Use Postman/Insomnia to test endpoints
   - Test with valid and invalid inputs
   - Verify error response formats

2. **Frontend Manual Testing:**
   - Run `npm run dev` for development server
   - Test different user flows manually
   - Check browser console for errors
   - Test with different data states

3. **Database Verification:**
   - Check database directly for constraints
   - Verify cascading operations
   - Test unique constraint violations

4. **Integration Verification:**
   - Test API→DB flow end-to-end
   - Verify response formats match types
   - Test error handling paths

---

*Testing analysis: 2026-03-26*

## Implementation Roadmap

**If test framework were to be added:**

**Backend (Jest):**
1. Install: `npm install --save-dev jest @types/jest`
2. Add config: `jest.config.js` with Node environment
3. Update package.json: `"test": "jest --watch"`
4. Start with model tests (easiest dependencies)
5. Add controller tests (mock models)
6. Add integration tests (real database or test DB)

**Frontend (Vitest):**
1. Install: `npm install --save-dev vitest @testing-library/react`
2. Update vite config for test environment
3. Start with utility function tests
4. Add component tests with @testing-library/react
5. Mock API service for isolated component tests

