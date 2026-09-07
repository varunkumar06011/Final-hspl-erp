import http from 'http';
import { env } from './config/env';
import app from './app';
import { initSocketServer } from './socket';
import { startQuotationAgingScheduler, stopQuotationAgingScheduler } from './services/scheduler.service';

const server = http.createServer(app);

initSocketServer(server);

server.listen(env.PORT, () => {
  console.log(` Hospital Construction ERP API running on port ${env.PORT}`);
  console.log(` Environment: ${env.NODE_ENV}`);
  console.log(` Frontend URL: ${env.FRONTEND_URL}`);
  console.log(` Storage mode: ${env.STORAGE_MODE}`);

  // Start the backend scheduler for quotation approval aging notifications.
  // This runs independently of the frontend — checks every hour for
  // quotations pending approval for ≥ 24 hours and sends push + in-app
  // notifications to admins. Ensures notifications are delivered even
  // when nobody has the app open.
  startQuotationAgingScheduler();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  stopQuotationAgingScheduler();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  stopQuotationAgingScheduler();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

export default app;
