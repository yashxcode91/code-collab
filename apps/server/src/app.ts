import express, { Application } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { healthRouter } from './modules/health/health.router';
import { authRouter } from './modules/auth/auth.router';
import { csrfProtection, getAllowedOrigin } from './middleware/csrf.middleware';
import {
  globalErrorHandler,
  notFoundHandler,
} from './middleware/error.middleware';
import { validateJwtConfig } from './utils/jwt';

// Fail fast on startup if security config is missing or malformed
getAllowedOrigin();
if (process.env.NODE_ENV !== 'test') {
  validateJwtConfig();
}

export const app: Application = express();

// 1. Credentialed CORS locked to our validated frontend origin
app.use(
  cors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin || requestOrigin === getAllowedOrigin()) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  })
);

// 2. Cookie parsing + JSON-only body parsing (no urlencoded form parser)
app.use(cookieParser());
app.use(express.json());

// 3. Defense-in-depth Origin/Referer validation for state-changing requests
app.use(csrfProtection);

// 4. Feature routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);

// 5. Fallback 404 & centralized error middleware (must stay last)
app.use(notFoundHandler);
app.use(globalErrorHandler);
