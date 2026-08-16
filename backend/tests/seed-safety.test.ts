import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { execSync } from 'child_process';

describe('Seed Script Safety Tests', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  beforeEach(() => {
    vi.resetModules();
  });

  it('NODE_ENV=production npm run seed → exits with error, does not modify DB', () => {
    let exitCode = 0;
    let stderr = '';

    try {
      execSync('npx tsx prisma/seed.ts', {
        cwd: __dirname + '/..',
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: 10000,
        stdio: 'pipe',
      });
    } catch (err: any) {
      exitCode = err.status ?? 1;
      stderr = err.stderr?.toString() ?? '';
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('REFUSING TO SEED');
  });

  it('seed script source contains NODE_ENV guard', () => {
    const fs = require('fs');
    const path = require('path');
    const seedSource = fs.readFileSync(
      path.join(__dirname, '..', 'prisma', 'seed.ts'),
      'utf-8'
    );

    expect(seedSource).toContain('NODE_ENV');
    expect(seedSource).toContain('development');
    expect(seedSource).toContain('REFUSING TO SEED');
    expect(seedSource).toContain('process.exit(1)');
  });
});
