import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import MaterialAutocomplete, { findCatalogMaterial, type CatalogMaterial } from './MaterialAutocomplete';
import SpecAutocomplete from './SpecAutocomplete';

export interface CatalogLine {
  materialName: string;
  itemId?: string | null;
  specification?: string | null;
  unit?: string | null;
}

/** The catalog item of a line: the linked one, else the item its typed name already is. */
export function catalogItemOf(catalog: CatalogMaterial[], line: CatalogLine): CatalogMaterial | null {
  return (line.itemId ? catalog.find((m) => m.itemId === line.itemId) : undefined) ?? findCatalogMaterial(catalog, line.materialName);
}

/**
 * Material + specification for one line, stacked (for edit tables). The material comes from
 * the shared item catalog and the spec from that item's own list; new ones are created when
 * the record is saved (or, for a spec, right away).
 */
export default function CatalogLineFields({
  catalog,
  line,
  onChange,
  minWidth = 170,
  label,
}: {
  catalog: CatalogMaterial[];
  line: CatalogLine;
  onChange: (patch: Partial<CatalogLine>) => void;
  minWidth?: number;
  /** Label of the material field (tables usually rely on the column header). */
  label?: string;
}) {
  const { t } = useTranslation('catalog');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth }}>
      <MaterialAutocomplete
        value={line.materialName}
        label={label}
        catalog={catalog}
        onTyped={(name, exact) => onChange({ materialName: name, itemId: exact?.itemId ?? null })}
        onPicked={(m) => onChange({ materialName: m.materialName, itemId: m.itemId, ...(m.unit && !line.unit ? { unit: m.unit } : {}) })}
        sx={{ minWidth: 0 }}
      />
      <SpecAutocomplete
        item={catalogItemOf(catalog, line)}
        value={line.specification ?? ''}
        label={t('specification')}
        onChange={(spec) => onChange({ specification: spec })}
        sx={{ minWidth: 0 }}
      />
    </Box>
  );
}
