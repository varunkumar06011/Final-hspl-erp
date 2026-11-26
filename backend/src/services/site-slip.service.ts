/**
 * Daily site material slips. A person on site records:
 *  - morning (any time in the day): what they took from the store, and what it is
 *    for (a phase, a budget head and/or the work). Stock goes down at once (OUT),
 *    so the store count stays right during the day;
 *  - evening: of each material taken, how much was used for the work and how
 *    much came back. The returned part goes back into stock (RETURN) at the same
 *    unit cost it left at; the used part stays deducted. Used + returned must
 *    equal taken.
 *  - later, if needed: a correction of a closed slip's used / returned split.
 * One open slip per person per day; taking more the same day adds to it.
 */
import { Prisma } from '@prisma/client';
import { InventoryItemType, InventoryTxnType, UserRole, isAdminRole } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { generateProjectSequenceNumber } from './sequence.service';
import { applyInbound, applyOutbound, applyOutboundAtCost } from './inventory-valuation.service';

export class SlipError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

export interface SlipActor {
  id: string;
  name: string;
  role: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Today's date on site (India), as the UTC-midnight Date a DATE column stores. */
export function siteToday(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Parses YYYY-MM-DD into the stored DATE value; null when it is not a real date. */
export function parseSlipDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const slipInclude = {
  takenBy: { select: { id: true, name: true } },
  phase: { select: { id: true, name: true } },
  budgetHead: { select: { id: true, particulars: true } },
  lines: {
    include: { inventoryItem: { select: { id: true, name: true, unit: true, currentStock: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.SiteMaterialSlipInclude;

/** The taker, admins and the two heads may close (or correct) a slip. */
export function canCloseSlip(actor: SlipActor, takenById: string): boolean {
  return (
    actor.id === takenById ||
    isAdminRole(actor.role) ||
    actor.role === UserRole.PROJECT_HEAD ||
    actor.role === UserRole.HEAD_OF_CONSTRUCTION
  );
}

/** Unit cost a line's stock left the store at (falls back to the item's average when unknown). */
function lineUnitCost(line: { takenQty: Prisma.Decimal | number; takenValue: Prisma.Decimal | number }, fallback: number): number {
  const qty = Number(line.takenQty);
  const value = Number(line.takenValue);
  return qty > 0 && value > 0 ? value / qty : fallback;
}

/** Merges repeated items in one request and checks the quantities. */
function cleanTakeLines(lines: Array<{ itemId?: unknown; quantity?: unknown }>): Map<string, number> {
  if (!Array.isArray(lines) || lines.length === 0) throw new SlipError('Add at least one material');
  const byItem = new Map<string, number>();
  for (const l of lines) {
    const itemId = typeof l.itemId === 'string' ? l.itemId : '';
    const qty = Number(l.quantity);
    if (!itemId) throw new SlipError('Pick a material on every line');
    if (!Number.isFinite(qty) || qty <= 0) throw new SlipError('Enter a quantity above 0 on every line');
    byItem.set(itemId, round2((byItem.get(itemId) ?? 0) + qty));
  }
  return byItem;
}

export interface TakeInput {
  lines: Array<{ itemId?: unknown; quantity?: unknown }>;
  work?: unknown;
  phaseId?: unknown;
  budgetHeadId?: unknown;
}

/**
 * Records material taken from the store today. Adds to the person's open slip
 * for today, or starts one. Stock goes down at once; refused if the store does
 * not have that much.
 */
export async function takeMaterial(projectId: string, actor: SlipActor, input: TakeInput) {
  // A double-tap on the first take of the day sends two requests that both see no slip.
  // The database allows one open slip per person per day (and unique slip numbers), so the
  // loser fails with a unique violation and simply runs again, adding to the winner's slip.
  for (let attempt = 1; ; attempt++) {
    try {
      return await takeOnce(projectId, actor, input);
    } catch (err) {
      const unique = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!unique || attempt >= 3) throw err;
    }
  }
}

const optionalId = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function takeOnce(projectId: string, actor: SlipActor, input: TakeInput) {
  const byItem = cleanTakeLines(input.lines);
  const work = typeof input.work === 'string' && input.work.trim() ? input.work.trim().slice(0, 300) : null;
  const phaseId = optionalId(input.phaseId);
  const budgetHeadId = optionalId(input.budgetHeadId);

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: [...byItem.keys()] }, projectId, deletedAt: null },
    select: { id: true, name: true, unit: true, itemType: true, currentStock: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const [id, qty] of byItem) {
    const item = itemById.get(id);
    if (!item) throw new SlipError('Material not found in this project’s inventory', 404);
    if (item.itemType === InventoryItemType.ASSET) {
      throw new SlipError(`${item.name} is an asset. Issue assets from the Assets page`);
    }
    if (Number(item.currentStock) < qty) {
      throw new SlipError(`Not enough ${item.name} in store: ${Number(item.currentStock)} ${item.unit} left, ${qty} asked`, 400, 'INSUFFICIENT_STOCK');
    }
  }

  const today = siteToday();
  const existing = await prisma.siteMaterialSlip.findFirst({
    where: { projectId, takenById: actor.id, slipDate: today, status: 'OPEN' },
    select: { id: true, phaseId: true, budgetHeadId: true, phase: { select: { name: true } }, budgetHead: { select: { particulars: true } } },
  });

  if (existing) {
    // The day's open slip is charged to one phase / budget head; taking for another one
    // means closing this slip first (a new slip can then be started the same day).
    const otherPhase = phaseId && existing.phaseId && phaseId !== existing.phaseId;
    const otherHead = budgetHeadId && existing.budgetHeadId && budgetHeadId !== existing.budgetHeadId;
    if (otherPhase || otherHead) {
      const current = existing.phase?.name ?? existing.budgetHead?.particulars ?? 'another phase';
      throw new SlipError(`Today’s open slip is for ${current}. Do its evening update first, then take material for the other work`, 409, 'SLIP_OTHER_PHASE');
    }
  } else {
    // Like the normal "issue stock" screen: say what the material is for.
    if (!phaseId && !budgetHeadId && !work) {
      throw new SlipError('Say what the material is for: choose a phase, a budget head or enter the work', 400, 'SLIP_PURPOSE_REQUIRED');
    }
    if (phaseId) {
      const phase = await prisma.phase.findFirst({ where: { id: phaseId, projectId, deletedAt: null }, select: { id: true } });
      if (!phase) throw new SlipError('Phase not found');
    }
    if (budgetHeadId) {
      const head = await prisma.budgetHead.findFirst({ where: { id: budgetHeadId, projectId, deletedAt: null }, select: { id: true } });
      if (!head) throw new SlipError('Budget head not found');
    }
  }
  const slipNumber = existing ? null : await generateProjectSequenceNumber('siteMaterialSlip', 'slipNumber', 'SLIP', 3, projectId);

  return prisma.$transaction(
    async (tx) => {
      const slip = existing
        ? await tx.siteMaterialSlip.update({
            where: { id: existing.id },
            data: {
              ...(work ? { work } : {}),
              // A slip started with only "work" can still be given its phase / head later in the day.
              ...(phaseId && !existing.phaseId ? { phaseId } : {}),
              ...(budgetHeadId && !existing.budgetHeadId ? { budgetHeadId } : {}),
            },
            select: { id: true, slipNumber: true, phaseId: true, budgetHeadId: true },
          })
        : await tx.siteMaterialSlip.create({
            data: { projectId, slipNumber: slipNumber!, slipDate: today, takenById: actor.id, work, phaseId, budgetHeadId },
            select: { id: true, slipNumber: true, phaseId: true, budgetHeadId: true },
          });

      for (const [itemId, qty] of byItem) {
        const item = itemById.get(itemId)!;
        const moved = await applyOutbound(tx, itemId, qty);
        if (moved.balance < -0.001) {
          throw new SlipError(`Not enough ${item.name} in store`, 400, 'INSUFFICIENT_STOCK');
        }
        await tx.inventoryTransaction.create({
          data: {
            itemId,
            type: InventoryTxnType.OUT,
            quantity: qty,
            balanceAfter: moved.balance,
            unitCost: moved.unitCost,
            totalCost: moved.totalCost,
            userId: actor.id,
            purpose: 'Taken to site',
            phaseId: slip.phaseId,
            budgetHeadId: slip.budgetHeadId,
            issuedTo: actor.name,
            notes: `Site slip ${slip.slipNumber}${work ? ` · ${work}` : ''}`,
          },
        });
        await tx.siteMaterialSlipLine.upsert({
          where: { slipId_inventoryItemId: { slipId: slip.id, inventoryItemId: itemId } },
          create: { slipId: slip.id, inventoryItemId: itemId, takenQty: qty, takenValue: moved.totalCost },
          update: { takenQty: { increment: qty }, takenValue: { increment: moved.totalCost } },
        });
      }
      const full = await tx.siteMaterialSlip.findUniqueOrThrow({ where: { id: slip.id }, include: slipInclude });
      // `created` tells the caller whether this take started the day's slip (audit CREATE vs UPDATE).
      return { ...full, created: !existing };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

type SplitInput = { lines: Array<{ lineId?: unknown; usedQty?: unknown; returnedQty?: unknown }> };

/** Reads used / returned per line and checks they add up to what was taken. */
function readSplit(
  slipLines: Array<{ id: string; takenQty: Prisma.Decimal | number; inventoryItem: { name: string; unit: string } }>,
  input: SplitInput,
) {
  const given = new Map<string, { used: number; returned: number }>();
  for (const l of input.lines ?? []) {
    if (typeof l.lineId !== 'string') continue;
    const used = Number(l.usedQty ?? 0);
    const returned = Number(l.returnedQty ?? 0);
    if (!Number.isFinite(used) || !Number.isFinite(returned) || used < 0 || returned < 0) {
      throw new SlipError('Used and returned cannot be negative');
    }
    given.set(l.lineId, { used: round2(used), returned: round2(returned) });
  }
  for (const line of slipLines) {
    const g = given.get(line.id);
    const name = line.inventoryItem.name;
    if (!g) throw new SlipError(`Enter used and returned for ${name}`);
    const taken = Number(line.takenQty);
    if (Math.abs(g.used + g.returned - taken) > 0.01) {
      throw new SlipError(`${name}: used (${g.used}) + returned (${g.returned}) must equal taken (${taken} ${line.inventoryItem.unit})`, 400, 'SLIP_MISMATCH');
    }
  }
  return given;
}

async function loadSlip(projectId: string, slipId: string) {
  const slip = await prisma.siteMaterialSlip.findFirst({
    where: { id: slipId, projectId },
    include: { lines: { include: { inventoryItem: { select: { name: true, unit: true, weightedAvgCost: true } } } } },
  });
  if (!slip) throw new SlipError('Slip not found', 404);
  return slip;
}

/**
 * Evening update: for every line, how much was used and how much came back.
 * Used + returned must equal taken. Returned goes back into stock at the unit cost
 * it left at.
 */
export async function closeSlip(projectId: string, actor: SlipActor, slipId: string, input: SplitInput) {
  const slip = await loadSlip(projectId, slipId);
  if (!canCloseSlip(actor, slip.takenById)) throw new SlipError('Only the person who took the material, or a head, can update this slip', 403);
  if (slip.status !== 'OPEN') throw new SlipError('This slip is already closed', 409);
  const given = readSplit(slip.lines, input);

  return prisma.$transaction(
    async (tx) => {
      const claimed = await tx.siteMaterialSlip.updateMany({
        where: { id: slip.id, status: 'OPEN' },
        data: { status: 'CLOSED', closedAt: new Date(), closedBy: actor.id },
      });
      if (claimed.count !== 1) throw new SlipError('This slip is already closed', 409);

      for (const line of slip.lines) {
        const g = given.get(line.id)!;
        await tx.siteMaterialSlipLine.update({ where: { id: line.id }, data: { usedQty: g.used, returnedQty: g.returned } });
        if (g.returned > 0) {
          const cost = lineUnitCost(line, Number(line.inventoryItem.weightedAvgCost));
          const moved = await applyInbound(tx, line.inventoryItemId, g.returned, cost);
          await tx.inventoryTransaction.create({
            data: {
              itemId: line.inventoryItemId,
              type: InventoryTxnType.RETURN,
              quantity: g.returned,
              balanceAfter: moved.balance,
              unitCost: moved.unitCost,
              totalCost: moved.totalCost,
              userId: actor.id,
              purpose: 'Returned from site',
              phaseId: slip.phaseId,
              budgetHeadId: slip.budgetHeadId,
              issuedTo: slip.takenById === actor.id ? actor.name : null,
              notes: `Site slip ${slip.slipNumber}: used ${g.used}, returned ${g.returned}`,
            },
          });
        }
      }
      return tx.siteMaterialSlip.findUniqueOrThrow({ where: { id: slip.id }, include: slipInclude });
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/**
 * Corrects a closed slip's used / returned split (a wrong number typed in the evening).
 * More returned than before → the difference goes back into stock; less → it is taken
 * out of stock again (refused if the store no longer has it). Both at the line's own
 * unit cost. Every change is its own stock movement, so the history shows the fix.
 */
export async function correctSlip(projectId: string, actor: SlipActor, slipId: string, input: SplitInput) {
  const slip = await loadSlip(projectId, slipId);
  if (!canCloseSlip(actor, slip.takenById)) throw new SlipError('Only the person who took the material, or a head, can correct this slip', 403);
  if (slip.status !== 'CLOSED') throw new SlipError('Do the evening update first; only an updated slip can be corrected', 409);
  const given = readSplit(slip.lines, input);
  const changes = slip.lines
    .map((line) => ({ line, g: given.get(line.id)!, delta: round2(given.get(line.id)!.returned - Number(line.returnedQty ?? 0)) }))
    .filter((c) => Math.abs(c.delta) > 0.001 || Math.abs(c.g.used - Number(c.line.usedQty ?? 0)) > 0.001);
  if (changes.length === 0) throw new SlipError('Nothing changed', 400, 'SLIP_NO_CHANGE');

  return prisma.$transaction(
    async (tx) => {
      for (const { line, g, delta } of changes) {
        await tx.siteMaterialSlipLine.update({ where: { id: line.id }, data: { usedQty: g.used, returnedQty: g.returned } });
        if (Math.abs(delta) <= 0.001) continue;
        const cost = lineUnitCost(line, Number(line.inventoryItem.weightedAvgCost));
        const moved = delta > 0
          ? await applyInbound(tx, line.inventoryItemId, delta, cost)
          : await applyOutboundAtCost(tx, line.inventoryItemId, -delta, cost);
        if (moved.balance < -0.001) {
          throw new SlipError(`Not enough ${line.inventoryItem.name} in store to take back ${-delta} ${line.inventoryItem.unit}`, 400, 'INSUFFICIENT_STOCK');
        }
        await tx.inventoryTransaction.create({
          data: {
            itemId: line.inventoryItemId,
            type: delta > 0 ? InventoryTxnType.RETURN : InventoryTxnType.OUT,
            quantity: Math.abs(delta),
            balanceAfter: moved.balance,
            unitCost: moved.unitCost,
            totalCost: moved.totalCost,
            userId: actor.id,
            purpose: delta > 0 ? 'Returned from site' : 'Taken to site',
            phaseId: slip.phaseId,
            budgetHeadId: slip.budgetHeadId,
            notes: `Site slip ${slip.slipNumber} corrected: used ${g.used}, returned ${g.returned} (was ${Number(line.usedQty ?? 0)} / ${Number(line.returnedQty ?? 0)})`,
          },
        });
      }
      return tx.siteMaterialSlip.findUniqueOrThrow({ where: { id: slip.id }, include: slipInclude });
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

export interface UsageDayRow {
  date: string;
  itemId: string;
  name: string;
  unit: string;
  taken: number;
  used: number;
  returned: number;
  open: number;
}

/**
 * Day-wise usage between two dates (inclusive): one row per day and material,
 * newest day first, plus the total per material for the whole range.
 */
export async function usageHistory(projectId: string, from: Date, to: Date) {
  if (from > to) throw new SlipError('“From” must be on or before “To”');
  if (to.getTime() - from.getTime() > 366 * 86_400_000) throw new SlipError('Pick a range of one year or less');

  const slips = await prisma.siteMaterialSlip.findMany({
    where: { projectId, slipDate: { gte: from, lte: to } },
    select: {
      slipDate: true,
      status: true,
      lines: {
        select: {
          inventoryItemId: true,
          takenQty: true,
          usedQty: true,
          returnedQty: true,
          inventoryItem: { select: { name: true, unit: true } },
        },
      },
    },
  });

  const rows = new Map<string, UsageDayRow>();
  const totals = new Map<string, Omit<UsageDayRow, 'date'>>();
  for (const s of slips) {
    const date = s.slipDate.toISOString().slice(0, 10);
    for (const l of s.lines) {
      const key = `${date}|${l.inventoryItemId}`;
      const base = { itemId: l.inventoryItemId, name: l.inventoryItem.name, unit: l.inventoryItem.unit, taken: 0, used: 0, returned: 0, open: 0 };
      const r = rows.get(key) ?? { date, ...base };
      const t = totals.get(l.inventoryItemId) ?? { ...base };
      const taken = Number(l.takenQty);
      for (const x of [r, t]) {
        x.taken = round2(x.taken + taken);
        if (s.status === 'CLOSED') {
          x.used = round2(x.used + Number(l.usedQty ?? 0));
          x.returned = round2(x.returned + Number(l.returnedQty ?? 0));
        } else {
          x.open = round2(x.open + taken);
        }
      }
      rows.set(key, r);
      totals.set(l.inventoryItemId, t);
    }
  }
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    days: [...rows.values()].sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : b.date.localeCompare(a.date))),
    totals: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Open slips from days before today, oldest first (the evening update was forgotten). */
export async function overdueSlips(projectId: string, takenById?: string) {
  return prisma.siteMaterialSlip.findMany({
    where: { projectId, status: 'OPEN', slipDate: { lt: siteToday() }, ...(takenById ? { takenById } : {}) },
    select: {
      id: true,
      slipNumber: true,
      slipDate: true,
      work: true,
      createdAt: true,
      takenBy: { select: { id: true, name: true } },
      lines: { select: { takenQty: true, inventoryItem: { select: { name: true, unit: true } } } },
    },
    orderBy: { slipDate: 'asc' },
    take: 50,
  });
}

/** Slips of one day (default today), with a per-material total for the day. */
export async function listSlips(projectId: string, date: Date, mineOnlyFor?: string) {
  const slips = await prisma.siteMaterialSlip.findMany({
    where: { projectId, slipDate: date, ...(mineOnlyFor ? { takenById: mineOnlyFor } : {}) },
    include: slipInclude,
    orderBy: { createdAt: 'asc' },
  });
  const totals = new Map<string, { itemId: string; name: string; unit: string; taken: number; used: number; returned: number; open: number }>();
  for (const s of slips) {
    for (const l of s.lines) {
      const t = totals.get(l.inventoryItemId) ?? {
        itemId: l.inventoryItemId, name: l.inventoryItem.name, unit: l.inventoryItem.unit, taken: 0, used: 0, returned: 0, open: 0,
      };
      t.taken = round2(t.taken + Number(l.takenQty));
      if (s.status === 'CLOSED') {
        t.used = round2(t.used + Number(l.usedQty ?? 0));
        t.returned = round2(t.returned + Number(l.returnedQty ?? 0));
      } else {
        t.open = round2(t.open + Number(l.takenQty));
      }
      totals.set(l.inventoryItemId, t);
    }
  }
  // Open slips from earlier days still waiting for their evening update, listed so they can be opened.
  const overdue = (await overdueSlips(projectId, mineOnlyFor)).map((s) => ({
    id: s.id,
    slipNumber: s.slipNumber,
    date: s.slipDate.toISOString().slice(0, 10),
    takenBy: s.takenBy,
  }));
  return {
    date: date.toISOString().slice(0, 10),
    slips,
    totals: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name)),
    openCount: slips.filter((s) => s.status === 'OPEN').length,
    overdueOpen: overdue.length,
    overdue,
  };
}
