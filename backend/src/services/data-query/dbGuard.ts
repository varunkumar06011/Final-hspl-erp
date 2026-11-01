/**
 * The database half of the read guard. Every data query runs in its own
 * transaction that is:
 *   - READ ONLY (Postgres refuses any write, whatever the query builder produced),
 *   - capped by statement_timeout (a heavy question cannot slow the app down),
 *   - tagged with the caller's project (miko.project_id), and
 *   - run as the NOLOGIN role miko_reader when the migration could create it:
 *     that role can read only granted columns of granted tables, and row-level
 *     security shows it only the rows of the tagged project.
 *
 * The query builder (query.ts) already pins the project and strips secret
 * columns; this layer makes the database enforce the same rules a second time.
 * If the role is missing (e.g. the database user may not create roles) queries
 * still run read-only and project-pinned, and the status says the role is off.
 */
import { prisma } from '../../config/prisma';
import { logger } from '../../utils/logger';
import { readOnlyTransaction } from '../search/manager';
import { GUARDED_COLUMNS } from './grants.generated';

export const READER_ROLE = 'miko_reader';
export const STATEMENT_TIMEOUT_MS = 5_000;
const TRANSACTION_TIMEOUT_MS = 15_000;
const RECHECK_MS = 10 * 60 * 1000;

let roleState: { ok: boolean; at: number } | null = null;

/** Whether this server's database user may switch to the reader role (checked every 10 min). */
export async function readerRoleAvailable(): Promise<boolean> {
  if (roleState && Date.now() - roleState.at < RECHECK_MS) return roleState.ok;
  let ok = false;
  try {
    const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${READER_ROLE})
         AND pg_has_role(current_user, ${READER_ROLE}, 'MEMBER') AS ok`;
    ok = rows[0]?.ok === true;
  } catch {
    ok = false;
  }
  if (!ok && roleState?.ok !== false) logger.warn({ event: 'miko_guard_role_missing', role: READER_ROLE });
  roleState = { ok, at: Date.now() };
  return ok;
}

/** Columns the reader role was granted for a model (null = the role was never granted this table). */
export function guardedColumns(model: string): readonly string[] | null {
  return GUARDED_COLUMNS[model] ?? null;
}

export type GuardedClient = typeof prisma;

/** Runs `fn` inside the guarded read-only transaction for one project. */
export async function runGuarded<T>(
  projectId: string,
  fn: (tx: GuardedClient, guard: { role: boolean }) => Promise<T>,
): Promise<{ result: T; role: boolean }> {
  const role = await readerRoleAvailable();
  const result = await readOnlyTransaction(
    async (raw) => {
      const tx = raw as GuardedClient;
      // Same as SET TRANSACTION READ ONLY, but valid at any point of the transaction.
      await tx.$executeRawUnsafe('SET LOCAL transaction_read_only = on');
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      await tx.$queryRaw`SELECT set_config('miko.project_id', ${projectId}, true)`;
      if (role) await tx.$executeRawUnsafe(`SET LOCAL ROLE ${READER_ROLE}`);
      return fn(tx, { role });
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 5_000 },
  );
  return { result, role };
}
