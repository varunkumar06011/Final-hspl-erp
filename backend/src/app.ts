import path from 'path';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import routes from './routes';
import { errorMiddleware } from './middleware/error';
import { requestLogger } from './middleware/requestLogger';
import { prisma } from './config/prisma';
import { logger } from './utils/logger';
import { INTERNAL_HEADER, INTERNAL_SECRET } from './services/assistant/internalApi';
import { SECRET_HEADER as TASKHUB_HEADER, isValidTaskHubSecret } from './services/taskhub.service';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
// gzip the JSON replies (lists, search results): several times smaller on mobile data.
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Structured request logging — one JSON line per request.
app.use(requestLogger);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  // The AI assistant calls this server's own API on the user's behalf; those
  // loopback calls carry a per-process secret and must not eat the user's quota.
  // Voice transcription sends live previews while the user speaks; it has its own per-user budget.
  // Task Hub's server reads approvals for several people from one address.
  skip: (req) =>
    req.headers[INTERNAL_HEADER] === INTERNAL_SECRET ||
    req.path === '/assistant/transcribe' ||
    isValidTaskHubSecret(req.headers[TASKHUB_HEADER]),
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

// Business flow chart of the app (docs/app-map.html), a plain page outside the app itself.
// It draws its charts with Mermaid from jsDelivr, so its CSP allows that script and inline code.
const APP_MAP_FILE = path.resolve(__dirname, '../../docs/app-map.html');
app.get('/app-map', (_req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:",
  );
  res.sendFile(APP_MAP_FILE);
});

app.use('/api', routes);

// 404 handler for unknown API routes
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use(errorMiddleware);

export default app;
