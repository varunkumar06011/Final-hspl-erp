import http from 'http';
import { env } from './config/env';
import app from './app';
import { initSocketServer } from './socket';

const server = http.createServer(app);

initSocketServer(server);

server.listen(env.PORT, () => {
  console.log(` Hospital Construction ERP API running on port ${env.PORT}`);
  console.log(` Environment: ${env.NODE_ENV}`);
  console.log(` Frontend URL: ${env.FRONTEND_URL}`);
  console.log(` Storage mode: ${env.STORAGE_MODE}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

export default app;
