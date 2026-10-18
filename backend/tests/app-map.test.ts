import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/prisma', () => ({ prisma: {} }));

import supertest from 'supertest';
import app from '../src/app';

describe('GET /app-map', () => {
  it('serves the business flow chart page without login, with a CSP that lets its charts load', async () => {
    const res = await supertest(app).get('/app-map');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('How the app works');
    expect(res.headers['content-security-policy']).toContain('https://cdn.jsdelivr.net');
  });
});
