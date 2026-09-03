/**
 * Lightweight structured logger — emits JSON lines to stdout/stderr.
 *
 * No external dependency. In production every log is a single JSON object so
 * it can be ingested by Render's log drains / Datadog / Loki without parsing.
 * In development the format stays readable (JSON with a newline).
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info({ event: 'push_sent', count: 3 });
 *   logger.error({ event: 'db_error', err: err.message });
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Minimum level to emit. Override via LOG_LEVEL env var.
const minLevel: Level =
  (process.env.LOG_LEVEL as Level | undefined) ??
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function emit(level: Level, fields: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

  const record = {
    level,
    time: new Date().toISOString(),
    ...fields,
  };

  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (fields: Record<string, unknown>) => emit('debug', fields),
  info: (fields: Record<string, unknown>) => emit('info', fields),
  warn: (fields: Record<string, unknown>) => emit('warn', fields),
  error: (fields: Record<string, unknown>) => emit('error', fields),
};
