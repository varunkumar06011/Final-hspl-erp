/**
 * Shared helpers for scenario-based E2E tests.
 *
 * Provides: active project, head users, dev-token auth, supertest client,
 * prisma, and a per-scenario report printer. NO teardown — data persists.
 */
import supertest from 'supertest';
import { prisma } from '../../src/config/prisma';
import app from '../../src/app';

const request = supertest(app);

// ─── Resolve the real active project + its head users ───────────
export interface TestContext {
  projectId: string;
  projectName: string;
  userPhId: string;     // PROJECT_HEAD
  userHocId: string;    // HEAD_OF_CONSTRUCTION
  userAdminId: string;  // ADMIN
  userAdmin2Id: string; // ADMIN_2
}

let ctx: TestContext | null = null;

export async function getContext(): Promise<TestContext> {
  if (ctx) return ctx;

  const project = await prisma.project.findFirst({
    where: { status: 'ACTIVE', deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!project) throw new Error('No active project found — seed the DB first');

  const users = await prisma.user.findMany({
    where: { projectId: project.id, isActive: true },
    select: { id: true, role: true, name: true },
  });
  const byRole = (r: string) => users.find((u) => u.role === r)?.id ?? '';

  ctx = {
    projectId: project.id,
    projectName: project.name,
    userPhId: byRole('PROJECT_HEAD'),
    userHocId: byRole('HEAD_OF_CONSTRUCTION'),
    userAdminId: byRole('ADMIN'),
    userAdmin2Id: byRole('ADMIN_2'),
  };

  if (!ctx.userPhId || !ctx.userHocId) {
    throw new Error('Need at least PROJECT_HEAD + HEAD_OF_CONSTRUCTION users in the project');
  }

  return ctx;
}

// ─── Auth header helper (dev-token bypass) ──────────────────────
export function authAs(userId: string) {
  return { Authorization: `Bearer dev-token:${userId}` };
}

// ─── Expose prisma + request for scenario tests ─────────────────
export { prisma, request };

// ─── Per-scenario report ────────────────────────────────────────
export function makeReporter(scenarioName: string, runId: string) {
  const results: { step: string; ok: boolean; detail: string }[] = [];

  function record(step: string, ok: boolean, detail: string) {
    results.push({ step, ok, detail });
  }

  function printReport() {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`  ${scenarioName} — run ${runId}`);
    console.log('═══════════════════════════════════════════════════════════════');
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    for (const r of results) {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.step} — ${r.detail}`);
    }
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`  Total: ${results.length}   Passed: ${passed}   Failed: ${failed}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
  }

  return { record, printReport, results };
}
