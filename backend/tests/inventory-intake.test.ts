/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Add Inventory" (/inventory-intake): every role may type in arrived material, nobody
 * learns anything about stock from it, quantities in another unit are refused, and a blank
 * rate is valued at the item's current average. Auth, database and stock-entry saving are faked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Permission, UserRole, hasPermission, isModuleEnabled } from '@hospital-erp/shared';

const { state } = vi.hoisted(() => ({ state: { role: 'SITE_SUPERVISOR', existing: null as any, saved: [] as any[] } }));

vi.mock('../src/config/prisma', () => ({ prisma: {} }));
vi.mock('../src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'u1', name: 'Ravi', role: state.role, projectId: 'p', extraPermissions: [] };
    next();
  },
  requireProjectId: (req: any) => req.user.projectId,
}));
vi.mock('../src/middleware/catalogLines', () => ({ catalogLinesMiddleware: () => (_r: any, _s: any, next: any) => next() }));
vi.mock('../src/services/inventory-match.service', () => ({ findInventoryItemForMaterial: vi.fn(async () => state.existing) }));
vi.mock('../src/routes/stock-entry.routes', () => ({
  createStockEntry: vi.fn(async (_p: string, _u: any, input: any, options: any) => {
    state.saved.push({ ...input, options });
    return { id: 'se-1', entryNumber: 'VGH-STK001', status: 'POSTED', items: input.items, secretValue: 999 };
  }),
}));

import router from '../src/routes/inventory-intake.routes';

const app = express().use(express.json()).use('/inventory-intake', router);
const body = (item: Record<string, unknown> = {}) => ({ items: [{ materialName: 'Cement', unit: 'bags', quantity: 20, ...item }] });

describe('add inventory (entry only)', () => {
  beforeEach(() => {
    state.role = 'SITE_SUPERVISOR';
    state.existing = { unit: 'bag', itemType: 'CONSUMABLE', weightedAvgCost: 400, currentStock: 75 };
    state.saved = [];
  });

  it('every role may add inventory, but that does not let a site supervisor see inventory', () => {
    for (const role of Object.values(UserRole)) expect(hasPermission(role, Permission.ADD_INVENTORY)).toBe(true);
    const site = { role: UserRole.SITE_SUPERVISOR, extraPermissions: [] };
    expect(hasPermission(site.role, Permission.MANAGE_INVENTORY)).toBe(false);
    expect(isModuleEnabled(site, 'addInventory')).toBe(true);
    expect(isModuleEnabled(site, 'inventory')).toBe(false);
  });

  it('adds straight to stock without approval and replies with the number and status only', async () => {
    const res = await request(app).post('/inventory-intake').send(body());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'se-1', entryNumber: 'VGH-STK001', status: 'POSTED' });
    expect(state.saved[0]).toMatchObject({ sourceType: 'MATERIAL_DELIVERY', options: { postNow: true } });
  });

  it('values a blank rate at the current average and keeps a typed rate', async () => {
    await request(app).post('/inventory-intake').send(body());
    await request(app).post('/inventory-intake').send(body({ unitCost: 455 }));
    expect(state.saved[0].items[0]).toMatchObject({ unitCost: 400, itemType: 'CONSUMABLE' });
    expect(state.saved[1].items[0].unitCost).toBe(455);
  });

  it('a new material starts as a consumable', async () => {
    state.existing = null;
    await request(app).post('/inventory-intake').send(body({ materialName: 'Tile glue' }));
    expect(state.saved[0].items[0]).toMatchObject({ itemType: 'CONSUMABLE', unitCost: 0 });
  });

  it('refuses a different unit and says which one to use, without revealing stock', async () => {
    const res = await request(app).post('/inventory-intake').send(body({ unit: 'kg' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNIT_MISMATCH');
    expect(res.body.error).toContain('bag');
    expect(JSON.stringify(res.body)).not.toMatch(/75|400/);
    expect(state.saved).toHaveLength(0);
  });

  it('refuses an empty list and a zero quantity', async () => {
    expect((await request(app).post('/inventory-intake').send({ items: [] })).status).toBe(400);
    expect((await request(app).post('/inventory-intake').send(body({ quantity: 0 }))).status).toBe(400);
    expect(state.saved).toHaveLength(0);
  });
});
