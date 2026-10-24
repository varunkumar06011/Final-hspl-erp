/**
 * What Miko's data questions may read, derived from the Prisma schema.
 *
 * Nothing here lists business tables: every model with a `projectId` is a
 * PROJECT table, every model without one that hangs off a project table through
 * required to-one relations is a CHILD (read only through its parent's project),
 * and a short allowlist of shared tables is GLOBAL. Anything else is invisible.
 *
 * Guard rails decided here (enforced again in the database, see dbGuard.ts):
 *  - tables in DATA_EXCLUDED are never readable (secrets, private chats, locked documents…);
 *  - secret-looking columns (hash, token, PIN, file paths…) are never readable;
 *  - `projectId` is never exposed or filterable — the server always pins it;
 *  - who may read a table follows the search registry (the module's list permission);
 *    a table with no registry entry is readable by admin roles only;
 *  - tables of modules switched off for the user are hidden.
 */
import { Prisma } from '@prisma/client';
import { APP_MODULES, hasPermission, isAdminRole, isModuleSwitchedOff, type ModuleAccessSubject } from '@hospital-erp/shared';
import { REGISTRY, SENSITIVE_COLUMN } from '../search/registry';

/** Tables Miko can never read, with the reason. */
export const DATA_EXCLUDED: Record<string, string> = {
  Project: 'the tenant itself; the current project is pinned by the server',
  Document: 'general documents can be PIN-locked',
  PushSubscription: 'device tokens',
  AppNotification: 'per-user inbox',
  AuditLog: 'raw before/after snapshots; has its own page',
  AssistantAction: "Miko's own log (proposals, stored photos)",
  ChatConversation: 'private conversations',
  ChatMember: 'private conversations',
  ChatMessage: 'private conversations',
  ChatAttachment: 'private conversations',
};

/** Shared (not per-project) tables everyone may read. */
const GLOBAL_MODELS = new Set(['CatalogItem', 'CatalogItemSpec']);

/** Users are shared across projects: only reachable as a related record, and only these columns. */
export const USER_MODEL = 'User';
const USER_FIELDS = ['id', 'name', 'role'];

/** Extra column names never exposed, on top of the search index's SENSITIVE_COLUMN. */
const EXTRA_SENSITIVE = /^(pin|apiKey|privateKey|accountPassword)$|pin(hash|code)?$/i;

export type Scope = 'project' | 'child' | 'global' | 'user';

export interface CatalogField {
  name: string;
  type: string; // String | Int | Float | Decimal | DateTime | Boolean | Json | <enum name>
  list: boolean;
  isEnum: boolean;
}

export interface CatalogRelation {
  name: string;
  target: string;
  toMany: boolean;
}

export interface PathStep {
  relation: string;
  /** Foreign-key column on this side (e.g. `poId`). */
  fk: string;
  target: string;
}

export interface CatalogModel {
  model: string;
  delegate: string;
  table: string;
  scope: Scope;
  /** Child → project-table hops (child scope only). */
  path: PathStep[];
  /** Project table whose rules (permission, module) apply. */
  owner: string | null;
  fields: Map<string, CatalogField>;
  relations: Map<string, CatalogRelation>;
  hasDeletedAt: boolean;
}

type Model = Prisma.DMMF.Model;
type Field = Prisma.DMMF.Field;
type Datamodel = Pick<Prisma.DMMF.Datamodel, 'models'>;

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const isToOne = (f: Field) => f.kind === 'object' && !f.isList && (f.relationFromFields?.length ?? 0) > 0;

export function isSensitiveColumn(name: string): boolean {
  return SENSITIVE_COLUMN.test(name) || EXTRA_SENSITIVE.test(name);
}

export function buildCatalog(datamodel: Datamodel = Prisma.dmmf.datamodel): Map<string, CatalogModel> {
  const models = new Map<string, Model>(datamodel.models.map((m) => [m.name, m]));
  const hasProjectId = (m: Model) => m.fields.some((f) => f.name === 'projectId' && f.kind === 'scalar');
  const allowed = (name: string) => models.has(name) && !(name in DATA_EXCLUDED);

  const projectModels = new Set([...models.values()].filter((m) => allowed(m.name) && hasProjectId(m)).map((m) => m.name));

  // Shortest chain of REQUIRED to-one relations up to a project table: a child row always has a parent.
  const pathToProject = (start: string): PathStep[] | null => {
    const queue: { model: string; path: PathStep[] }[] = [{ model: start, path: [] }];
    const seen = new Set([start]);
    while (queue.length) {
      const { model, path } = queue.shift()!;
      for (const f of models.get(model)!.fields) {
        if (!isToOne(f) || !f.isRequired || !allowed(f.type) || seen.has(f.type)) continue;
        const next = [...path, { relation: f.name, fk: f.relationFromFields![0], target: f.type }];
        if (projectModels.has(f.type)) return next;
        if (next.length < 3) {
          seen.add(f.type);
          queue.push({ model: f.type, path: next });
        }
      }
    }
    return null;
  };

  const out = new Map<string, CatalogModel>();
  for (const m of models.values()) {
    if (!allowed(m.name)) continue;
    let scope: Scope;
    let path: PathStep[] = [];
    let owner: string | null = null;
    if (m.name === USER_MODEL) scope = 'user';
    else if (projectModels.has(m.name)) {
      scope = 'project';
      owner = m.name;
    } else if (GLOBAL_MODELS.has(m.name)) scope = 'global';
    else {
      const found = pathToProject(m.name);
      if (!found) continue;
      scope = 'child';
      path = found;
      owner = found[found.length - 1].target;
    }

    const fields = new Map<string, CatalogField>();
    for (const f of m.fields) {
      if (f.kind !== 'scalar' && f.kind !== 'enum') continue;
      if (f.name === 'projectId' || isSensitiveColumn(f.name)) continue;
      if (scope === 'user' && !USER_FIELDS.includes(f.name)) continue;
      fields.set(f.name, { name: f.name, type: f.type, list: f.isList, isEnum: f.kind === 'enum' });
    }
    out.set(m.name, {
      model: m.name,
      delegate: lowerFirst(m.name),
      table: m.dbName ?? m.name,
      scope,
      path,
      owner,
      fields,
      relations: new Map(),
      hasDeletedAt: m.fields.some((f) => f.name === 'deletedAt'),
    });
  }

  // Relations are kept only between readable tables. To-many relations only go down to the
  // table's own children (PO → its items), never sideways into other project tables.
  for (const m of models.values()) {
    const entry = out.get(m.name);
    if (!entry || entry.scope === 'user') continue;
    for (const f of m.fields) {
      if (f.kind !== 'object') continue;
      const target = out.get(f.type);
      if (!target) continue;
      if (f.isList) {
        if (target.scope !== 'child' || target.path[0]?.target !== m.name) continue;
        entry.relations.set(f.name, { name: f.name, target: f.type, toMany: true });
      } else if (isToOne(f)) {
        entry.relations.set(f.name, { name: f.name, target: f.type, toMany: false });
      }
    }
  }
  return out;
}

let cached: Map<string, CatalogModel> | null = null;
export function getCatalog(): Map<string, CatalogModel> {
  return (cached ??= buildCatalog());
}

// ─── who may read what ──────────────────────────────────────────────────────

export interface Reader extends ModuleAccessSubject {
  role: string;
  /** Effective extra permissions (module grants folded in), as on req.user. */
  extraPermissions?: readonly string[];
}

function basePath(model: string): string | null {
  try {
    const p = REGISTRY[model]?.path?.('x', {});
    return p ? p.split('?')[0].replace(/\/x$/, '') : null;
  } catch {
    return null;
  }
}

function isHiddenModule(model: string, subject: ModuleAccessSubject): boolean {
  const path = basePath(model);
  if (!path) return false;
  return APP_MODULES.some((m) => m.path && (path === m.path || path.startsWith(`${m.path}/`)) && isModuleSwitchedOff(subject, m.key));
}

/** May this person read rows of `model`? (Project pinning is separate and always applies.) */
export function canRead(entry: CatalogModel, reader: Reader, subject: ModuleAccessSubject = reader): boolean {
  if (entry.scope === 'global' || entry.scope === 'user') return true;
  const owner = entry.owner!;
  const reg = REGISTRY[owner];
  const permitted = reg ? !reg.permission || hasPermission(reader.role, reg.permission, reader.extraPermissions) : isAdminRole(reader.role);
  return permitted && !isHiddenModule(owner, subject);
}
