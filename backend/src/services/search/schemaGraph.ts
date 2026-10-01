/**
 * Turns the Prisma data model into an indexing plan. Nothing here names a
 * business table: it reads columns, types and relations from Prisma's own
 * metadata, so adding a model or a column to schema.prisma changes what is
 * searchable with no further code.
 *
 *  - ROOT   a project-scoped table (has `projectId`). Becomes a search result.
 *  - CHILD  a table with no `projectId` reachable from a root by to-one
 *           relations (PO items, quotation items…). Its text is folded into
 *           the root's document and shown as "Material · Cement 53 Grade".
 *  - POLY   a table pointing at "any record" through entityType/entityId
 *           (comments, attachments). Folded into whichever record it points at.
 */
import { Prisma } from '@prisma/client';
import { EXCLUDED_MODELS, REGISTRY, SENSITIVE_COLUMN } from './registry';

export interface PathStep {
  /** Relation field on the child side (e.g. `purchaseOrder`). */
  relation: string;
  /** Foreign-key column holding the parent id (e.g. `poId`). */
  fk: string;
  /** Model on the other end. */
  target: string;
}

export interface Edge {
  fk: string;
  target: string;
}

export interface TextField {
  name: string;
  weight: number;
  list: boolean;
}

export type Role = 'root' | 'child' | 'poly';

export interface ModelPlan {
  model: string;
  /** Key on the Prisma client (`purchaseOrder`). */
  delegate: string;
  role: Role;
  /** Child → root hops (empty for roots and poly). */
  path: PathStep[];
  /** Root model a child folds into (null for poly, resolved per row). */
  root: string | null;
  text: TextField[];
  numbers: string[];
  dates: string[];
  json: string[];
  /** Scalar FK columns (kept so we can build edges and registry paths). */
  fks: string[];
  /** To-one links to other roots, used for "found via its vendor". */
  edges: Edge[];
  hasDeletedAt: boolean;
  hasProjectId: boolean;
  /** Column used to detect changes: updatedAt → createdAt → none. */
  stamp: 'updatedAt' | 'createdAt' | null;
  statusField: string | null;
  titleFields: string[];
  amountField: string | null;
  dateField: string | null;
}

type Datamodel = Pick<Prisma.DMMF.Datamodel, 'models'>;
type Field = Prisma.DMMF.Field;
type Model = Prisma.DMMF.Model;

const NAME_LIKE = /^(name|title)$/i;
const NAME_SUFFIX = /(name|title|particulars|label|caption|subject)$/i;
// Business identifiers: poNumber, vendorCode, assetId (real FK columns never reach this check)…
const IDENTIFIER_LIKE = /(Number|Code|No|Id|Ref|Reference)$|^(sku|udi|gtin|code|number|reference|ref)$/;
const AMOUNT_EXACT = /^(grandTotal|totalAmount|netAmount|amount|total)$/i;
const AMOUNT_LIKE = /(total|amount)$/i;
const NUMERIC_TYPES = new Set(['Int', 'BigInt', 'Float', 'Decimal']);
const SKIPPED_NUMBER = /^(sequence|version|sortOrder|order|index|position|retry|attempt)/i;

export function humanize(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function weightFor(name: string): number {
  if (NAME_LIKE.test(name) || NAME_SUFFIX.test(name)) return 3;
  if (IDENTIFIER_LIKE.test(name)) return 3;
  return 1;
}

function isToOne(f: Field): boolean {
  return f.kind === 'object' && !f.isList && (f.relationFromFields?.length ?? 0) > 0;
}

export function buildPlans(datamodel: Datamodel = Prisma.dmmf.datamodel): ModelPlan[] {
  const models = new Map<string, Model>(datamodel.models.map((m) => [m.name, m]));

  const hasProjectId = (m: Model) =>
    m.fields.some((f) => f.name === 'projectId' && f.kind === 'scalar' && f.type === 'String');
  const isPoly = (m: Model) =>
    m.fields.some((f) => f.name === 'entityType' && f.type === 'String') &&
    m.fields.some((f) => f.name === 'entityId' && f.type === 'String');

  const usable = (name: string) => models.has(name) && !(name in EXCLUDED_MODELS);

  const polyModels = new Set<string>();
  const roots = new Set<string>();
  for (const m of models.values()) {
    if (!usable(m.name)) continue;
    if (isPoly(m) && hasProjectId(m)) polyModels.add(m.name);
    else if (hasProjectId(m)) roots.add(m.name);
  }

  // Shortest chain of to-one relations from `start` up to a root.
  const pathToRoot = (start: string): PathStep[] | null => {
    const queue: { model: string; path: PathStep[] }[] = [{ model: start, path: [] }];
    const seen = new Set<string>([start]);
    while (queue.length) {
      const { model, path } = queue.shift()!;
      const m = models.get(model)!;
      const links = m.fields
        .filter(isToOne)
        .sort((a, b) => Number(b.isRequired) - Number(a.isRequired));
      for (const f of links) {
        if (!usable(f.type) || seen.has(f.type)) continue;
        const step: PathStep = { relation: f.name, fk: f.relationFromFields![0], target: f.type };
        if (roots.has(f.type)) return [...path, step];
        if (path.length < 3) {
          seen.add(f.type);
          queue.push({ model: f.type, path: [...path, step] });
        }
      }
    }
    return null;
  };

  const plans: ModelPlan[] = [];
  for (const m of models.values()) {
    if (!usable(m.name)) continue;

    let role: Role;
    let path: PathStep[] = [];
    let root: string | null = null;
    if (polyModels.has(m.name)) role = 'poly';
    else if (roots.has(m.name)) role = 'root';
    else {
      const found = pathToRoot(m.name);
      if (!found) continue;
      role = 'child';
      path = found;
      root = found[found.length - 1].target;
    }

    const fkCols = new Set(m.fields.flatMap((f) => f.relationFromFields ?? []));
    const polyKeys = role === 'poly' ? new Set(['entityType', 'entityId']) : new Set<string>();
    const text: TextField[] = [];
    const numbers: string[] = [];
    const dates: string[] = [];
    const json: string[] = [];

    for (const f of m.fields) {
      if (f.kind !== 'scalar' || f.isId || fkCols.has(f.name) || f.name === 'projectId') continue;
      if (SENSITIVE_COLUMN.test(f.name) || polyKeys.has(f.name)) continue;
      if (f.type === 'String') text.push({ name: f.name, weight: weightFor(f.name), list: f.isList });
      else if (NUMERIC_TYPES.has(f.type) && !SKIPPED_NUMBER.test(f.name)) numbers.push(f.name);
      else if (f.type === 'DateTime' && !/At$/.test(f.name)) dates.push(f.name);
      else if (f.type === 'Json') json.push(f.name);
    }

    // A record with nothing to read is not worth an index entry.
    if (text.length === 0 && json.length === 0 && (role !== 'root' || numbers.length === 0)) continue;

    const names = new Set(m.fields.map((f) => f.name));
    const registered = REGISTRY[m.name];
    const edges: Edge[] =
      role === 'root'
        ? m.fields.filter(isToOne).filter((f) => roots.has(f.type)).map((f) => ({ fk: f.relationFromFields![0], target: f.type }))
        : [];

    const textNames = text.map((t) => t.name);
    const derivedTitle =
      textNames.find((n) => NAME_LIKE.test(n)) ??
      textNames.find((n) => NAME_SUFFIX.test(n)) ??
      textNames.find((n) => IDENTIFIER_LIKE.test(n)) ??
      textNames[0];
    const titleFields = (registered?.title ?? []).filter((n) => names.has(n));

    plans.push({
      model: m.name,
      delegate: lowerFirst(m.name),
      role,
      path,
      root,
      text,
      numbers,
      dates,
      json,
      fks: [...fkCols],
      edges,
      hasDeletedAt: names.has('deletedAt'),
      hasProjectId: hasProjectId(m),
      stamp: names.has('updatedAt') ? 'updatedAt' : names.has('createdAt') ? 'createdAt' : null,
      statusField: names.has('status') ? 'status' : null,
      titleFields: titleFields.length ? titleFields : derivedTitle ? [derivedTitle] : [],
      amountField:
        numbers.find((n) => AMOUNT_EXACT.test(n)) ?? numbers.find((n) => AMOUNT_LIKE.test(n)) ?? null,
      dateField: dates.includes('date') ? 'date' : dates[0] ?? null,
    });
  }
  return plans;
}

/** Models in the schema that are neither indexable nor explicitly excluded. */
export function unclassifiedModels(datamodel: Datamodel = Prisma.dmmf.datamodel): string[] {
  const planned = new Set(buildPlans(datamodel).map((p) => p.model));
  return datamodel.models.map((m) => m.name).filter((n) => !planned.has(n) && !(n in EXCLUDED_MODELS));
}

let cached: ModelPlan[] | null = null;
export function getPlans(): ModelPlan[] {
  return (cached ??= buildPlans());
}
