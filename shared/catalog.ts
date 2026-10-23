// ═══════════════════════════════════════════════════════════
// Item catalog: one list of materials and services shared by every project.
// Every line that names a material (request, quotation, PO, gate pass, goods
// receipt, stock entry) links to a catalog item and takes its specification
// from that item's own list, so "Steel 12mm TMT" is one thing everywhere.
// ═══════════════════════════════════════════════════════════

import { UserRole, isAdminRole, canOverrideApprovals } from './enums.js';

export enum CatalogItemKind {
  MATERIAL = 'MATERIAL',
  SERVICE = 'SERVICE',
}

/** Code prefix per kind: MAT-0001, SRV-0001. */
export const CATALOG_CODE_PREFIX: Record<CatalogItemKind, string> = {
  [CatalogItemKind.MATERIAL]: 'MAT-',
  [CatalogItemKind.SERVICE]: 'SRV-',
};

// Letters, digits and the Telugu block (U+0C00-U+0C7F) are kept; written as \u{...} escapes so
// the source stays plain ASCII.
// The Telugu block includes combining vowel signs on purpose: they are part of the words.
// eslint-disable-next-line no-misleading-character-class
const NAME_JUNK = /[^a-z0-9\u{0C00}-\u{0C7F}]+/gu;
// eslint-disable-next-line no-misleading-character-class
const SPEC_JUNK = /[^a-z0-9.\u{0C00}-\u{0C7F}]+/gu;

/** Normalised item name: "  TMT  Bars." -> "tmt bars". Two names with the same key are the same item. */
export function catalogNameKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(NAME_JUNK, ' ').trim().replace(/\s+/g, ' ');
}

/** Normalised specification: "12 mm TMT", "12mm-tmt" and "12MM TMT" are the same spec. */
export function catalogSpecKey(spec: string | null | undefined): string {
  return (spec ?? '').toLowerCase().replace(SPEC_JUNK, '').replace(/^\.+|\.+$/g, '');
}

/** Tidy a typed spec for storage: trimmed, single spaces. */
export function tidySpec(spec: string | null | undefined): string | null {
  const value = (spec ?? '').trim().replace(/\s+/g, ' ');
  return value ? value : null;
}

/**
 * Identity of a line across the chain (request -> quotation -> PO -> gate pass -> receipt):
 * the same item with a different spec is a different line ("Steel 8mm" vs "Steel 12mm").
 * Lines saved before specs travelled have no spec and still match by name alone.
 */
export function lineKey(line: { materialName: string; specification?: string | null }): string {
  return `${catalogNameKey(line.materialName)}|${catalogSpecKey(line.specification)}`;
}

/**
 * The line of `lines` that `want` refers to: by PO line id when given, else the same item +
 * spec, else (lines saved before specs travelled) the only line of that name.
 */
export function findLine<T extends { id?: string; materialName: string; specification?: string | null }>(
  lines: readonly T[],
  want: { poItemId?: string | null; materialName: string; specification?: string | null },
): T | undefined {
  if (want.poItemId) {
    const byId = lines.find((l) => l.id === want.poItemId);
    if (byId) return byId;
  }
  const exact = lines.find((l) => lineKey(l) === lineKey(want));
  if (exact) return exact;
  const sameName = lines.filter((l) => catalogNameKey(l.materialName) === catalogNameKey(want.materialName));
  if (sameName.length === 1) return sameName[0];
  return want.specification ? undefined : sameName.find((l) => !l.specification) ?? sameName[0];
}

/** "Steel - 12mm TMT" for one-line displays (inventory item names, PDFs, messages). */
export function lineLabel(line: { materialName: string; specification?: string | null }): string {
  const spec = tidySpec(line.specification);
  return spec ? `${line.materialName.trim()} - ${spec}` : line.materialName.trim();
}

// ── Price check: how a rate compares with the last price paid ──

export interface PriceComparison {
  difference: number;
  /** Percent change against the last price (0 when there is none). */
  percent: number;
  direction: 'UP' | 'DOWN' | 'SAME';
}

export function comparePrice(rate: number, lastRate: number): PriceComparison {
  const difference = Math.round((rate - lastRate) * 100) / 100;
  const percent = lastRate > 0 ? Math.round((difference / lastRate) * 1000) / 10 : 0;
  return { difference, percent, direction: Math.abs(difference) < 0.005 ? 'SAME' : difference > 0 ? 'UP' : 'DOWN' };
}

// ── Predefined specifications ──
// When an item with one of these names (or aliases) is created, it starts with this
// list. Each item only ever offers its own specs: steel shows steel sizes, iron shows
// iron sections. People can add more on the spot; these are just the common ones.

export interface PredefinedItem {
  name: string;
  kind: CatalogItemKind;
  unit?: string;
  category?: string;
  aliases?: string[];
  specs: string[];
}

const sizes = (list: string[], suffix: string) => list.map((s) => `${s}${suffix}`);

export const PREDEFINED_ITEMS: PredefinedItem[] = [
  {
    name: 'Steel',
    kind: CatalogItemKind.MATERIAL,
    unit: 'ton',
    category: 'STEEL',
    aliases: ['tmt', 'tmt bar', 'tmt bars', 'tmt steel', 'steel bar', 'steel bars', 'steel rod', 'steel rods', 'saria', 'sariya', 'rebar'],
    specs: [...sizes(['8', '10', '12', '16', '20', '25', '32'], 'mm TMT Bar'), 'Binding wires'],
  },
  {
    name: 'Iron',
    kind: CatalogItemKind.MATERIAL,
    unit: 'kg',
    category: 'STEEL',
    aliases: ['ms', 'mild steel', 'ms iron', 'structural steel'],
    specs: [
      'MS Angle 25x25x3', 'MS Angle 40x40x5', 'MS Angle 50x50x6', 'MS Angle 65x65x6',
      'MS Flat 25x5', 'MS Flat 50x6', 'MS Channel 75x40', 'MS Channel 100x50',
      'MS Plate 5mm', 'MS Plate 6mm', 'MS Plate 8mm', 'MS Plate 10mm',
      'MS Square Tube 25x25', 'MS Square Tube 40x40', 'MS Round Bar 12mm', 'MS Round Bar 16mm',
    ],
  },
  {
    name: 'Cement',
    kind: CatalogItemKind.MATERIAL,
    unit: 'bag',
    category: 'CEMENT',
    specs: ['OPC 43 Grade', 'OPC 53 Grade', 'PPC', 'PSC', 'White Cement'],
  },
  {
    name: 'Sand',
    kind: CatalogItemKind.MATERIAL,
    unit: 'cft',
    aliases: ['m sand', 'msand', 'river sand', 'p sand'],
    specs: ['River Sand', 'M-Sand', 'P-Sand (Plastering)', 'Filling Sand'],
  },
  {
    name: 'Aggregate',
    kind: CatalogItemKind.MATERIAL,
    unit: 'cft',
    aliases: ['jelly', 'metal', 'gravel', 'coarse aggregate', 'stone chips'],
    specs: ['6mm', '12mm', '20mm', '40mm', 'GSB', 'Stone Dust'],
  },
  {
    name: 'Bricks',
    kind: CatalogItemKind.MATERIAL,
    unit: 'nos',
    aliases: ['brick', 'red bricks'],
    specs: ['Red Clay 9x4x3', 'Fly Ash 9x4x3', 'Wire Cut'],
  },
  {
    name: 'Blocks',
    kind: CatalogItemKind.MATERIAL,
    unit: 'nos',
    aliases: ['block', 'aac block', 'aac blocks', 'concrete blocks', 'cement blocks'],
    specs: ['AAC 4 inch', 'AAC 6 inch', 'AAC 8 inch', 'Solid 4 inch', 'Solid 6 inch', 'Solid 8 inch', 'Hollow 4 inch', 'Hollow 6 inch', 'Hollow 8 inch'],
  },
  {
    name: 'Ready Mix Concrete',
    kind: CatalogItemKind.MATERIAL,
    unit: 'cum',
    aliases: ['rmc', 'concrete', 'ready mix'],
    specs: ['M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40'],
  },
  {
    name: 'PVC Pipe',
    kind: CatalogItemKind.MATERIAL,
    unit: 'nos',
    aliases: ['pvc pipes', 'upvc pipe'],
    specs: [
      '20mm', '25mm', '32mm', '40mm', '50mm', '63mm', '75mm 4kg ISI', '75mm 6kg ISI',
      '110mm 4kg ISI', '110mm 6kg ISI', '110mm 6kg Non-ISI', '160mm 4kg ISI', '160mm 6kg ISI', '160mm 6kg Non-ISI',
    ],
  },
  {
    name: 'CPVC Pipe',
    kind: CatalogItemKind.MATERIAL,
    unit: 'nos',
    aliases: ['cpvc pipes'],
    specs: sizes(['1/2', '3/4', '1', '1-1/4', '1-1/2', '2'], ' inch SDR 11'),
  },
  {
    name: 'GI Pipe',
    kind: CatalogItemKind.MATERIAL,
    unit: 'nos',
    aliases: ['gi pipes'],
    specs: [...sizes(['1/2', '3/4', '1', '1-1/2', '2'], ' inch Class B'), ...sizes(['1/2', '3/4', '1', '1-1/2', '2'], ' inch Class C')],
  },
  {
    name: 'Electrical Wire',
    kind: CatalogItemKind.MATERIAL,
    unit: 'roll',
    aliases: ['copper wire', 'house wire'],
    specs: sizes(['1.0', '1.5', '2.5', '4', '6', '10'], ' sq mm FRLS Copper'),
  },
  {
    name: 'MCB',
    kind: CatalogItemKind.MATERIAL,
    unit: 'nos',
    aliases: ['mcbs'],
    specs: ['6A SP', '10A SP', '16A SP', '20A SP', '32A SP', '10A DP', '16A DP', '32A DP', '40A DP', '63A DP', '32A TP', '63A TP'],
  },
  {
    name: 'Paint',
    kind: CatalogItemKind.MATERIAL,
    unit: 'ltr',
    specs: ['Interior Emulsion', 'Exterior Emulsion', 'Enamel', 'Primer', 'Distemper', 'Wall Putty'],
  },
  {
    name: 'Tiles',
    kind: CatalogItemKind.MATERIAL,
    unit: 'sqft',
    aliases: ['tile', 'vitrified tiles', 'floor tiles'],
    specs: ['Vitrified 600x600', 'Vitrified 800x800', 'Ceramic Wall 300x450', 'Ceramic Wall 300x600', 'Anti-skid 300x300'],
  },
  {
    name: 'Plywood',
    kind: CatalogItemKind.MATERIAL,
    unit: 'sheet',
    aliases: ['ply'],
    specs: ['6mm MR', '12mm MR', '18mm MR', '12mm BWP', '18mm BWP', '19mm BWP'],
  },
  {
    name: 'Binding Wire',
    kind: CatalogItemKind.MATERIAL,
    unit: 'kg',
    specs: ['18 Gauge', '20 Gauge'],
  },
  {
    name: 'Nails',
    kind: CatalogItemKind.MATERIAL,
    unit: 'kg',
    aliases: ['nail'],
    specs: ['1 inch', '2 inch', '3 inch', '4 inch'],
  },
  {
    name: 'Water Tanker',
    kind: CatalogItemKind.SERVICE,
    unit: 'trip',
    aliases: ['water supply', 'tanker'],
    specs: ['5000 L', '10000 L', '12000 L'],
  },
  {
    name: 'JCB',
    kind: CatalogItemKind.SERVICE,
    unit: 'hour',
    aliases: ['jcb work', 'jcb hire', 'excavator'],
    specs: ['Per Hour', 'Per Day', 'Per Trip'],
  },
  {
    name: 'Transport',
    kind: CatalogItemKind.SERVICE,
    unit: 'trip',
    aliases: ['transportation', 'freight'],
    specs: ['Tractor Trip', 'Tipper Trip', 'Lorry Trip', 'Mini Truck Trip'],
  },
];

/** The predefined entry whose name or alias matches, if any. */
export function findPredefinedItem(name: string, kind?: CatalogItemKind): PredefinedItem | undefined {
  const key = catalogNameKey(name);
  if (!key) return undefined;
  return PREDEFINED_ITEMS.find(
    (p) => (!kind || p.kind === kind) && (catalogNameKey(p.name) === key || (p.aliases ?? []).some((a) => catalogNameKey(a) === key)),
  );
}

/** Who may tidy the catalog (rename, merge, turn an item into a spec): admins, heads, supervisors, super admins. */
export function canManageCatalog(role: string, extraPermissions?: readonly string[] | null): boolean {
  return (
    isAdminRole(role) ||
    role === UserRole.PROJECT_HEAD ||
    role === UserRole.HEAD_OF_CONSTRUCTION ||
    role === UserRole.SUPERVISOR ||
    canOverrideApprovals(role, extraPermissions)
  );
}
