import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import routes from './routes';
import { errorMiddleware } from './middleware/error';
import { requestLogger } from './middleware/requestLogger';
import { prisma } from './config/prisma';
import { logger } from './utils/logger';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Structured request logging — one JSON line per request.
app.use(requestLogger);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Deep health check — verifies DB connectivity so uptime monitors catch
// both app and database outages.
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', timestamp: new Date().toISOString(), db: 'up' });
  } catch (err) {
    logger.error({ event: 'health_check_db_down', err: (err as Error).message });
    res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString(), db: 'down' });
  }
});

app.use('/api', routes);

// 404 handler for unknown API routes
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use(errorMiddleware);

export default app;
