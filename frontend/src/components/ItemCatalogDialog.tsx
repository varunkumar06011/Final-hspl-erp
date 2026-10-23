import { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CatalogItemKind, fuzzyFilter, fuzzyScore } from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from './ResponsiveDialog';
import { useToast } from './ToastProvider';
import { CATALOG_QUERY_KEY, useMaterialCatalog, type CatalogMaterial } from './MaterialAutocomplete';
import type { PriceCheckResult } from './PriceFlag';
import { formatCurrency } from '../utils/enumOptions';

/** A name with no letters at all ("27/09/26", "160/6") is almost certainly not an item. */
const looksWrong = (name: string) => !/[a-z]/i.test(name);

/** Pairs of items of the same kind whose names look like the same material (spelling only). */
function likelyDuplicates(items: CatalogMaterial[]): Array<[CatalogMaterial, CatalogMaterial]> {
  const nums = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(',');
  const pairs: Array<[CatalogMaterial, CatalogMaterial]> = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const x = items[a];
      const y = items[b];
      if (x.kind !== y.kind || nums(x.materialName) !== nums(y.materialName)) continue;
      const s1 = fuzzyScore(x.materialName, y.materialName);
      const s2 = fuzzyScore(y.materialName, x.materialName);
      if (s1 !== null && s2 !== null && Math.max(s1, s2) <= 2.4) pairs.push(x.uses >= y.uses ? [y, x] : [x, y]);
    }
  }
  return pairs.slice(0, 50);
}

interface ItemDetail {
  id: string;
  code: string;
  name: string;
  kind: CatalogItemKind;
  unit: string | null;
  specs: { id: string; value: string; isPredefined: boolean }[];
  prices: PriceCheckResult;
}

/**
 * Tidy the shared item list: rename an item, fix its unit or kind, merge duplicates, turn a
 * wrongly entered "item" into a specification of the right one ("160/6 ISI" -> PVC Pipe),
 * keep each item's spec list, and see what every vendor charged. Every change is applied to
 * all documents and stock items that use the item.
 */
export default function ItemCatalogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('catalog');
  const toast = useToast();
  const queryClient = useQueryClient();
  const catalog = useMaterialCatalog(open);
  const [kind, setKind] = useState<'ALL' | CatalogItemKind>('ALL');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'all' | 'review'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listed = useMemo(() => {
    const ofKind = catalog.filter((m) => kind === 'ALL' || m.kind === kind);
    return search.trim() ? fuzzyFilter(ofKind, search, (m) => [m.materialName, m.materialCode, ...m.aliases]) : ofKind;
  }, [catalog, kind, search]);
  const duplicates = useMemo(() => (open ? likelyDuplicates(catalog) : []), [catalog, open]);
  const wrong = useMemo(() => catalog.filter((m) => looksWrong(m.materialName)), [catalog]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['/catalog/item'] });
    queryClient.invalidateQueries({ queryKey: ['/catalog/price-check'] });
  };

  const merge = useMutation({
    mutationFn: async (v: { sourceId: string; targetId: string; asSpecification?: string }) =>
      (await api.post(`/catalog/items/${v.sourceId}/merge`, { targetId: v.targetId, asSpecification: v.asSpecification || undefined })).data as {
        summary: { sourceName: string; targetName: string; linesMoved: number; asSpec: string | null };
      },
    onSuccess: (r) => {
      toast.success(
        r.summary.asSpec
          ? t('madeSpec', { source: r.summary.sourceName, target: r.summary.targetName, spec: r.summary.asSpec, n: r.summary.linesMoved })
          : t('merged', { source: r.summary.sourceName, target: r.summary.targetName, n: r.summary.linesMoved }),
      );
      setSelectedId(null);
      refresh();
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  return (
    <ResponsiveDialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{t('manageTitle')}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>{t('manageHelp')}</Alert>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v) => v && setView(v)}>
            <ToggleButton value="all">{t('viewAll', { n: catalog.length })}</ToggleButton>
            <ToggleButton value="review">{t('viewReview', { n: duplicates.length + wrong.length })}</ToggleButton>
          </ToggleButtonGroup>
          {view === 'all' && (
            <>
              <ToggleButtonGroup size="small" exclusive value={kind} onChange={(_e, v) => v && setKind(v)}>
                <ToggleButton value="ALL">{t('kindAll')}</ToggleButton>
                <ToggleButton value={CatalogItemKind.MATERIAL}>{t('kindMaterial')}</ToggleButton>
                <ToggleButton value={CatalogItemKind.SERVICE}>{t('kindService')}</ToggleButton>
              </ToggleButtonGroup>
              <TextField size="small" placeholder={t('searchItems')} value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 200, flex: 1 }} />
            </>
          )}
        </Box>

        {view === 'review' ? (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2">{t('duplicatesTitle')}</Typography>
              {duplicates.length === 0 && <Typography variant="body2" color="text.secondary">{t('noDuplicates')}</Typography>}
              {duplicates.map(([a, b]) => (
                <Box key={`${a.itemId}-${b.itemId}`} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', py: 0.5 }}>
                  <Typography variant="body2">
                    <b>{a.materialName}</b> ({a.materialCode}, {t('usesN', { n: a.uses })}) → <b>{b.materialName}</b> ({b.materialCode}, {t('usesN', { n: b.uses })})
                  </Typography>
                  <Button size="small" disabled={merge.isPending} onClick={() => window.confirm(t('confirmMerge', { source: a.materialName, target: b.materialName })) && merge.mutate({ sourceId: a.itemId, targetId: b.itemId })}>
                    {t('mergeThese')}
                  </Button>
                  <Button size="small" onClick={() => setSelectedId(a.itemId)}>{t('open')}</Button>
                </Box>
              ))}
            </Box>
            <Divider />
            <Box>
              <Typography variant="subtitle2">{t('wrongTitle')}</Typography>
              {wrong.length === 0 && <Typography variant="body2" color="text.secondary">{t('noWrong')}</Typography>}
              {wrong.map((m) => (
                <Box key={m.itemId} sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 0.5 }}>
                  <Typography variant="body2"><b>{m.materialName}</b> ({m.materialCode}, {t('usesN', { n: m.uses })})</Typography>
                  <Button size="small" onClick={() => setSelectedId(m.itemId)}>{t('fix')}</Button>
                </Box>
              ))}
            </Box>
          </Stack>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('colName')}</TableCell>
                  <TableCell>{t('colCode')}</TableCell>
                  <TableCell>{t('colKind')}</TableCell>
                  <TableCell>{t('colUnit')}</TableCell>
                  <TableCell align="right">{t('colSpecs')}</TableCell>
                  <TableCell align="right">{t('colUses')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {listed.slice(0, 300).map((m) => (
                  <TableRow key={m.itemId} hover selected={m.itemId === selectedId} onClick={() => setSelectedId(m.itemId)} sx={{ cursor: 'pointer' }}>
                    <TableCell>
                      {m.materialName}
                      {looksWrong(m.materialName) && <Chip size="small" color="warning" label={t('checkName')} sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell>{m.materialCode}</TableCell>
                    <TableCell>{m.kind === CatalogItemKind.SERVICE ? t('kindService') : t('kindMaterial')}</TableCell>
                    <TableCell>{m.unit ?? '—'}</TableCell>
                    <TableCell align="right">{m.specs.length}</TableCell>
                    <TableCell align="right">{m.uses}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
      </DialogActions>

      <ItemEditor
        itemId={selectedId}
        catalog={catalog}
        onClose={() => setSelectedId(null)}
        onChanged={refresh}
        onMerge={(v) => merge.mutate(v)}
        merging={merge.isPending}
      />
    </ResponsiveDialog>
  );
}

function ItemEditor({
  itemId,
  catalog,
  onClose,
  onChanged,
  onMerge,
  merging,
}: {
  itemId: string | null;
  catalog: CatalogMaterial[];
  onClose: () => void;
  onChanged: () => void;
  onMerge: (v: { sourceId: string; targetId: string; asSpecification?: string }) => void;
  merging: boolean;
}) {
  const { t } = useTranslation('catalog');
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['/catalog/item', itemId],
    queryFn: async () => (await api.get(`/catalog/items/${itemId}`)).data as ItemDetail,
    enabled: !!itemId,
  });
  const [draft, setDraft] = useState<{ name?: string; unit?: string; kind?: CatalogItemKind }>({});
  const [newSpec, setNewSpec] = useState('');
  const [target, setTarget] = useState<CatalogMaterial | null>(null);
  const [asSpec, setAsSpec] = useState('');
  const [mode, setMode] = useState<'merge' | 'spec'>('merge');

  const name = draft.name ?? data?.name ?? '';
  const unit = draft.unit ?? data?.unit ?? '';
  const kind = draft.kind ?? data?.kind ?? CatalogItemKind.MATERIAL;
  const dirty = !!data && (name !== data.name || unit !== (data.unit ?? '') || kind !== data.kind);

  const close = () => {
    setDraft({});
    setNewSpec('');
    setTarget(null);
    setAsSpec('');
    onClose();
  };

  const save = useMutation({
    mutationFn: async () => (await api.patch(`/catalog/items/${itemId}`, { name, unit: unit || null, kind })).data,
    onSuccess: () => {
      toast.success(t('itemSaved'));
      setDraft({});
      onChanged();
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });
  const addSpec = useMutation({
    mutationFn: async () => (await api.post(`/catalog/items/${itemId}/specs`, { value: newSpec })).data,
    onSuccess: () => {
      setNewSpec('');
      onChanged();
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });
  const renameSpec = useMutation({
    mutationFn: async (v: { id: string; value: string }) => (await api.patch(`/catalog/specs/${v.id}`, { value: v.value })).data,
    onSuccess: onChanged,
    onError: (err) => toast.error(extractErrorMessage(err)),
  });
  const deleteSpec = useMutation({
    mutationFn: async (id: string) => api.delete(`/catalog/specs/${id}`),
    onSuccess: onChanged,
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const targets = catalog.filter((m) => m.itemId !== itemId);
  const per = data?.unit ? `/${data.unit}` : '';

  return (
    <ResponsiveDialog open={!!itemId} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>{data ? `${data.name} · ${data.code}` : t('item')}</DialogTitle>
      <DialogContent>
        {isLoading || !data ? (
          <CircularProgress size={24} />
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr auto' }, gap: 1, alignItems: 'center' }}>
              <TextField size="small" label={t('colName')} value={name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <TextField size="small" label={t('colUnit')} value={unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
              <TextField select size="small" label={t('colKind')} value={kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CatalogItemKind })}>
                <MenuItem value={CatalogItemKind.MATERIAL}>{t('kindMaterial')}</MenuItem>
                <MenuItem value={CatalogItemKind.SERVICE}>{t('kindService')}</MenuItem>
              </TextField>
              <Button variant="contained" disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}>{t('save')}</Button>
            </Box>
            {kind !== data.kind && <Alert severity="warning">{t('kindChangeWarn')}</Alert>}

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('specsOf', { item: data.name })}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                {data.specs.length === 0 && <Typography variant="body2" color="text.secondary">{t('noSpecsYet')}</Typography>}
                {data.specs.map((s) => (
                  <Chip
                    key={s.id}
                    size="small"
                    label={s.value}
                    variant={s.isPredefined ? 'outlined' : 'filled'}
                    onClick={() => {
                      const value = window.prompt(t('renameSpecPrompt'), s.value);
                      if (value && value.trim() && value.trim() !== s.value) renameSpec.mutate({ id: s.id, value: value.trim() });
                    }}
                    onDelete={() => window.confirm(t('confirmDeleteSpec', { spec: s.value })) && deleteSpec.mutate(s.id)}
                  />
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField size="small" label={t('newSpec')} value={newSpec} onChange={(e) => setNewSpec(e.target.value)} sx={{ flex: 1 }} />
                <Button disabled={!newSpec.trim() || addSpec.isPending} onClick={() => addSpec.mutate()}>{t('add')}</Button>
              </Box>
              <Typography variant="caption" color="text.secondary">{t('specsHint')}</Typography>
            </Box>

            <Divider />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('fixTitle')}</Typography>
              <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_e, v) => v && setMode(v)} sx={{ mb: 1 }}>
                <ToggleButton value="merge">{t('modeMerge')}</ToggleButton>
                <ToggleButton value="spec">{t('modeSpec')}</ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {mode === 'merge' ? t('modeMergeHelp', { item: data.name }) : t('modeSpecHelp', { item: data.name })}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: mode === 'spec' ? '1fr 1fr auto' : '1fr auto' }, gap: 1, alignItems: 'center' }}>
                <Autocomplete<CatalogMaterial>
                  size="small"
                  options={targets}
                  value={target}
                  onChange={(_e, v) => setTarget(v)}
                  getOptionLabel={(o) => `${o.materialName} · ${o.materialCode ?? ''}`}
                  isOptionEqualToValue={(a, b) => a.itemId === b.itemId}
                  filterOptions={(opts, s) => (s.inputValue.trim() ? fuzzyFilter(opts, s.inputValue, (o) => [o.materialName, o.materialCode]).slice(0, 30) : opts.slice(0, 50))}
                  renderInput={(params) => <TextField {...params} label={t('targetItem')} />}
                />
                {mode === 'spec' && (
                  <Autocomplete
                    freeSolo
                    size="small"
                    options={(target?.specs ?? []).map((s) => s.value)}
                    inputValue={asSpec}
                    onInputChange={(_e, v) => setAsSpec(v)}
                    renderInput={(params) => <TextField {...params} label={t('asSpecLabel')} placeholder={data.name} />}
                  />
                )}
                <Button
                  variant="contained"
                  color="warning"
                  disabled={!target || merging || (mode === 'spec' && !asSpec.trim())}
                  onClick={() => {
                    if (!target) return;
                    const ok = window.confirm(
                      mode === 'spec'
                        ? t('confirmMakeSpec', { source: data.name, target: target.materialName, spec: asSpec.trim() })
                        : t('confirmMerge', { source: data.name, target: target.materialName }),
                    );
                    if (ok) onMerge({ sourceId: data.id, targetId: target.itemId, asSpecification: mode === 'spec' ? asSpec.trim() : undefined });
                  }}
                >
                  {mode === 'spec' ? t('makeSpec') : t('mergeInto')}
                </Button>
              </Box>
            </Box>

            <Divider />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('vendorPrices')}</Typography>
              {data.prices.vendors.length === 0 ? (
                <Typography variant="body2" color="text.secondary">{t('noPrices')}</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('colVendor')}</TableCell>
                      <TableCell align="right">{t('colLatest')}</TableCell>
                      <TableCell align="right">{t('colLowest')}</TableCell>
                      <TableCell>{t('colProjects')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.prices.vendors.map((v) => (
                      <TableRow key={v.vendorName}>
                        <TableCell sx={{ fontWeight: v.vendorName === data.prices.bestVendor ? 700 : 400 }}>
                          {v.vendorName}{v.vendorName === data.prices.bestVendor ? ` · ${t('cheapest')}` : ''}
                        </TableCell>
                        <TableCell align="right">{formatCurrency(v.latestRate)}{per}</TableCell>
                        <TableCell align="right">{formatCurrency(v.lowestRate)}{per}</TableCell>
                        <TableCell>{v.projectCodes.join(', ')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Typography variant="caption" color="text.secondary">{t('pricesNoSpecHint')}</Typography>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('close')}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
