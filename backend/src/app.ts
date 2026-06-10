import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { logger } from './config/logger';
import { requestContextMiddleware } from './middlewares/auditTrail.middleware';
import { globalRateLimiter } from './middlewares/rateLimit.middleware';
import { networkRestriction } from './middlewares/networkRestriction.middleware';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.middleware';
import { setupSwagger } from './config/swagger';
import { getList } from './services/systemConfig.service';
import apiRouter from './routes';

/**
 * Build the Express application. Security hardening (Module 15): Helmet with a
 * strict CSP + HSTS, a CORS whitelist sourced from SystemConfig, JSON body
 * limits, the per-request audit context, and Swagger docs.
 */
export async function createApp(): Promise<Express> {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline required by Swagger UI
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: env.isProd ? [] : null,
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // CORS — whitelist only (security.allowed_origins) plus the configured frontend.
  // FRONTEND_ORIGIN supports a comma-separated list so multiple origins (e.g. localhost
  // and a LAN IP) can be allowed without changing the database config.
  const envOrigins = env.frontendOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  let allowedOrigins: string[] = envOrigins;
  try {
    const fromConfig = await getList('security.allowed_origins');
    allowedOrigins = Array.from(new Set([...allowedOrigins, ...fromConfig]));
  } catch {
    /* DB may not be reachable yet during tests — fall back to env origin */
  }
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Origin not allowed by CORS policy'));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Establish the audit context for every request (actor filled in by auth).
  app.use(requestContextMiddleware);

  // API docs (penetration-testing readiness, Module 15 §11).
  setupSwagger(app);

  app.use('/api', networkRestriction, globalRateLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info(`CORS whitelist: ${allowedOrigins.join(', ')}`);
  return app;
}
