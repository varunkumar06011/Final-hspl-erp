import { prisma } from '../config/prisma';

/**
 * Multi-project helpers. Users are shared across projects; the project a session
 * works in is chosen at login and carried as a signed `projectId` claim in the JWT.
 */

const CACHE_TTL_MS = 60_000;

interface ProjectInfo {
  id: string;
  code: string;
  usable: boolean;
}

const cache = new Map<string, { value: ProjectInfo | null; expiresAt: number }>();

/** Drop cached project info (call after creating/archiving/editing a project). */
export function invalidateProjectCache(projectId?: string): void {
  if (projectId) cache.delete(projectId);
  else cache.clear();
  liveCountCache = null;
}

async function loadProject(projectId: string): Promise<ProjectInfo | null> {
  const hit = cache.get(projectId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const row = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, deletedAt: true },
  });
  const value: ProjectInfo | null = row
    ? { id: row.id, code: row.code, usable: row.deletedAt === null }
    : null;
  cache.set(projectId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** True when the project exists and has not been archived. */
export async function isProjectUsable(projectId: string): Promise<boolean> {
  const info = await loadProject(projectId);
  return !!info?.usable;
}

/** The project's document-number prefix code (e.g. "VGH"). */
export async function getProjectCode(projectId: string): Promise<string> {
  const info = await loadProject(projectId);
  if (!info) throw new Error('Project not found');
  return info.code;
}

let liveCountCache: { value: number; expiresAt: number } | null = null;

/**
 * "[ABC] " when more than one project is live, so a push/in-app message says which
 * project it is about; empty while there is only one project (nothing to tell apart).
 */
export async function projectTitlePrefix(projectId: string): Promise<string> {
  try {
    if (!liveCountCache || liveCountCache.expiresAt <= Date.now()) {
      const value = await prisma.project.count({ where: { deletedAt: null } });
      liveCountCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    if (liveCountCache.value <= 1) return '';
    return `[${await getProjectCode(projectId)}] `;
  } catch {
    return '';
  }
}

/**
 * Pick the project a login should land in: the one the user chose, else their
 * stored default, else the oldest non-archived project. Returns null when the
 * requested project is invalid (caller should answer 400) or none exists.
 */
export async function resolveLoginProjectId(
  requestedProjectId: string | undefined | null,
  userDefaultProjectId: string | null
): Promise<string | null> {
  if (requestedProjectId) {
    return (await isProjectUsable(requestedProjectId)) ? requestedProjectId : null;
  }
  if (userDefaultProjectId && (await isProjectUsable(userDefaultProjectId))) {
    return userDefaultProjectId;
  }
  const first = await prisma.project.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return first?.id ?? null;
}
