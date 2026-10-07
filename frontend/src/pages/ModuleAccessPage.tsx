import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Lock as LockIcon,
  RestartAlt as ResetIcon,
  Search as SearchIcon,
  Undo as UndoIcon,
} from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  APP_MODULES,
  MODULE_SECTIONS,
  isModuleEnabled,
  isModuleOnByDefault,
  type AppModule,
  type ModuleAccessMap,
  type ModuleSection,
} from '@hospital-erp/shared';
import api, { extractErrorMessage } from '../config/api';
import ResponsiveDialog from '../components/ResponsiveDialog';
import { useToast } from '../components/ToastProvider';
import { useAuthStore } from '../stores/authStore';
import { canManageModuleAccess } from '../utils/moduleAccess';
import { roleLabel } from '../utils/enumOptions';

interface AccessUser {
  id: string;
  name: string;
  phone: string;
  role: string;
  isActive: boolean;
  extraPermissions: string[];
  moduleAccess: ModuleAccessMap;
  fullControl: boolean;
}

/** module key → true/false (override) or null (back to role default) */
type Changes = Record<string, boolean | null>;

const QUERY_KEY = ['/module-access/users'];

const BY_SECTION: { section: ModuleSection; modules: AppModule[] }[] = MODULE_SECTIONS.map((section) => ({
  section,
  modules: APP_MODULES.filter((m) => m.section === section),
}));

const subject = (u: AccessUser) => ({ role: u.role, extraPermissions: u.extraPermissions, moduleAccess: u.moduleAccess });
const enabled = (u: AccessUser, key: string) => isModuleEnabled(subject(u), key);
const onByDefault = (u: AccessUser, m: AppModule) => isModuleOnByDefault(m, u.role, u.extraPermissions);
const isCustom = (u: AccessUser, key: string) => !u.fullControl && typeof u.moduleAccess[key] === 'boolean';

/** Change that makes the module `on` for the user, stored only when it differs from the role default. */
function changeFor(u: AccessUser, m: AppModule, on: boolean): boolean | null {
  return on === onByDefault(u, m) ? null : on;
}

function applyChanges(u: AccessUser, changes: Changes, replace?: boolean): AccessUser {
  const moduleAccess: ModuleAccessMap = replace ? {} : { ...u.moduleAccess };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete moduleAccess[key];
    else moduleAccess[key] = value;
  }
  return { ...u, moduleAccess };
}

export default function ModuleAccessPage() {
  const { t } = useTranslation();
  const { t: ta } = useTranslation('access');
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'user' | 'matrix'>('user');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySource, setCopySource] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [columnMenu, setColumnMenu] = useState<{ anchor: HTMLElement; module: AppModule } | null>(null);

  const allowed = canManageModuleAccess(me);
  const { data, isLoading, error } = useQuery<{ data: AccessUser[] }>({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get('/module-access/users')).data,
    enabled: allowed,
  });
  const users = useMemo(() => data?.data ?? [], [data]);

  const mutation = useMutation({
    mutationFn: async (body: { userIds: string[]; changes: Changes; replace?: boolean }) =>
      (await api.patch('/module-access/users', body)).data as { data: AccessUser[]; skipped: number },
    // Switches flip at once; a failed save rolls back.
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<{ data: AccessUser[] }>(QUERY_KEY);
      const ids = new Set(body.userIds);
      queryClient.setQueryData<{ data: AccessUser[] }>(QUERY_KEY, (cur) =>
        cur && { data: cur.data.map((u) => (ids.has(u.id) && !u.fullControl ? applyChanges(u, body.changes, body.replace) : u)) },
      );
      return { previous };
    },
    onError: (err, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(QUERY_KEY, ctx.previous);
      toast.error(extractErrorMessage(err));
    },
    onSuccess: (res, body) => {
      const saved = new Map(res.data.map((u) => [u.id, u]));
      queryClient.setQueryData<{ data: AccessUser[] }>(QUERY_KEY, (cur) =>
        cur && { data: cur.data.map((u) => saved.get(u.id) ?? u) },
      );
      if (res.skipped > 0) toast.info(ta('skipped', { count: res.skipped }));
      else if (body.userIds.length > 1) toast.success(ta('savedMany', { count: body.userIds.length }));
    },
  });

  const roles = useMemo(() => [...new Set(users.map((u) => u.role))].sort(), [users]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!roleFilter || u.role === roleFilter) &&
        (!q || u.name.toLowerCase().includes(q) || u.phone.includes(q) || roleLabel(u.role).toLowerCase().includes(q)),
    );
  }, [users, search, roleFilter]);

  const selectedId = params.get('user') ?? users.find((u) => !u.fullControl)?.id ?? '';
  const selected = users.find((u) => u.id === selectedId) ?? null;
  const selectUser = (id: string) => setParams({ user: id }, { replace: true });

  if (!allowed) return <Navigate to="/" replace />;

  const save = (userIds: string[], changes: Changes, replace?: boolean) => mutation.mutate({ userIds, changes, replace });

  const setModules = (u: AccessUser, modules: AppModule[], on: boolean | 'default') => {
    const changes: Changes = {};
    for (const m of modules) changes[m.key] = on === 'default' ? null : changeFor(u, m, on);
    save([u.id], changes);
  };

  const sameRoleOthers = selected
    ? users.filter((u) => u.role === selected.role && u.id !== selected.id && !u.fullControl)
    : [];

  const customCount = (u: AccessUser) => APP_MODULES.filter((m) => isCustom(u, m.key)).length;
  const moduleLabel = (m: AppModule) => t(`nav.${m.label}`, m.label);

  // ── Per-user view ─────────────────────────────────────────────
  const userList = (
    <Card sx={{ height: { md: 'calc(100vh - 220px)' }, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <TextField
          size="small"
          placeholder={ta('searchUsers')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <TextField select size="small" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} label={ta('role')}>
          <MenuItem value="">{ta('allRoles')}</MenuItem>
          {roles.map((r) => <MenuItem key={r} value={r}>{roleLabel(r)}</MenuItem>)}
        </TextField>
      </Box>
      <Divider />
      <List dense sx={{ overflowY: 'auto', flex: 1, maxHeight: { xs: 260, md: 'none' } }}>
        {filtered.length === 0 && <Typography sx={{ p: 2 }} color="text.secondary">{ta('noUsers')}</Typography>}
        {filtered.map((u) => {
          const custom = customCount(u);
          return (
            <ListItemButton key={u.id} selected={u.id === selectedId} onClick={() => selectUser(u.id)} sx={{ opacity: u.isActive ? 1 : 0.55 }}>
              <ListItemAvatar sx={{ minWidth: 44 }}>
                <Avatar sx={{ width: 32, height: 32, fontSize: 14 }}>{u.name.charAt(0)}</Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={u.name}
                secondary={`${roleLabel(u.role)}${u.isActive ? '' : ` · ${ta('inactive')}`}`}
                primaryTypographyProps={{ noWrap: true, fontWeight: 500 }}
              />
              {u.fullControl ? (
                <Tooltip title={ta('fullControl')}><LockIcon fontSize="small" color="disabled" /></Tooltip>
              ) : custom > 0 ? (
                <Chip size="small" color="warning" variant="outlined" label={ta('customCount', { count: custom })} />
              ) : null}
            </ListItemButton>
          );
        })}
      </List>
    </Card>
  );

  const userPanel = selected && (
    <Stack spacing={2}>
      <Card>
        <CardContent sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" noWrap>{selected.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {roleLabel(selected.role)} · {selected.phone}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {ta('modulesOn', {
                on: APP_MODULES.filter((m) => enabled(selected, m.key)).length,
                total: APP_MODULES.length,
              })}
              {customCount(selected) > 0 && ` · ${ta('customCount', { count: customCount(selected) })}`}
            </Typography>
          </Box>
          {!selected.fullControl && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" startIcon={<ResetIcon />} disabled={customCount(selected) === 0} onClick={() => save([selected.id], {}, true)}>
                {ta('resetAll')}
              </Button>
              <Button size="small" variant="outlined" onClick={() => { setCopySource(''); setCopyOpen(true); }}>
                {ta('copyFrom')}
              </Button>
              <Button size="small" variant="outlined" disabled={sameRoleOthers.length === 0} onClick={() => setApplyOpen(true)}>
                {ta('applyToRole', { role: roleLabel(selected.role) })}
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>

      {selected.fullControl && <Alert severity="info" icon={<LockIcon />}>{ta('fullControlNote')}</Alert>}

      {BY_SECTION.map(({ section, modules }) => {
        const onCount = modules.filter((m) => enabled(selected, m.key)).length;
        return (
          <Card key={section}>
            <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 120 }}>
                {t(`sections.${section}`, section)}{' '}
                <Typography component="span" variant="caption" color="text.secondary">{onCount}/{modules.length}</Typography>
              </Typography>
              {!selected.fullControl && (
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" onClick={() => setModules(selected, modules, true)}>{ta('allOn')}</Button>
                  <Button size="small" onClick={() => setModules(selected, modules, false)}>{ta('allOff')}</Button>
                  <Button size="small" onClick={() => setModules(selected, modules, 'default')}>{ta('sectionDefault')}</Button>
                </Stack>
              )}
            </Box>
            {modules.map((m, i) => {
              const on = enabled(selected, m.key);
              const custom = isCustom(selected, m.key);
              return (
                <Box
                  key={m.key}
                  sx={{
                    px: 2,
                    py: 0.75,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    borderTop: i === 0 ? 0 : 1,
                    borderColor: 'divider',
                    bgcolor: (theme) => (custom ? alpha(theme.palette.warning.main, 0.08) : 'transparent'),
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={500}>{moduleLabel(m)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {custom ? ta('custom') : ta('roleDefault')} · {onByDefault(selected, m) ? ta('defaultOn') : ta('defaultOff')}
                    </Typography>
                  </Box>
                  {custom && (
                    <Tooltip title={ta('backToDefault')}>
                      <IconButton size="small" onClick={() => save([selected.id], { [m.key]: null })}>
                        <UndoIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Switch
                    checked={on}
                    disabled={selected.fullControl}
                    onChange={(e) => save([selected.id], { [m.key]: changeFor(selected, m, e.target.checked) })}
                    inputProps={{ 'aria-label': moduleLabel(m) }}
                  />
                </Box>
              );
            })}
          </Card>
        );
      })}
    </Stack>
  );

  // ── Matrix view: every user × every module ────────────────────
  const matrix = (
    <Card>
      <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>{ta('matrixHint')}</Typography>
      <TableContainer sx={{ maxHeight: 'calc(100vh - 260px)' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ position: 'sticky', left: 0, zIndex: 4, bgcolor: 'background.paper', minWidth: 170 }} />
              {BY_SECTION.map(({ section, modules }) => (
                <TableCell key={section} colSpan={modules.length} align="center" sx={{ fontWeight: 700, borderLeft: 1, borderColor: 'divider' }}>
                  {t(`sections.${section}`, section)}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell sx={{ position: 'sticky', left: 0, top: 37, zIndex: 4, bgcolor: 'background.paper', fontWeight: 700 }}>
                {ta('user')}
              </TableCell>
              {BY_SECTION.flatMap(({ modules }) =>
                modules.map((m, i) => (
                  <TableCell
                    key={m.key}
                    align="center"
                    sx={{ top: 37, p: 0.5, verticalAlign: 'bottom', borderLeft: i === 0 ? 1 : 0, borderColor: 'divider' }}
                  >
                    <Button
                      size="small"
                      onClick={(e) => setColumnMenu({ anchor: e.currentTarget, module: m })}
                      sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', minWidth: 0, px: 0.5, py: 1, fontSize: 12, textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      {moduleLabel(m)}
                    </Button>
                  </TableCell>
                )),
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((u) => (
              <TableRow key={u.id} hover sx={{ opacity: u.isActive ? 1 : 0.55 }}>
                <TableCell sx={{ position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper', whiteSpace: 'nowrap' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {u.fullControl && <LockIcon sx={{ fontSize: 14 }} color="disabled" />}
                    <Typography variant="body2" fontWeight={500}>{u.name}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">{roleLabel(u.role)}</Typography>
                </TableCell>
                {BY_SECTION.flatMap(({ modules }) =>
                  modules.map((m, i) => {
                    const custom = isCustom(u, m.key);
                    return (
                      <TableCell
                        key={m.key}
                        align="center"
                        sx={{
                          p: 0,
                          borderLeft: i === 0 ? 1 : 0,
                          borderColor: 'divider',
                          bgcolor: (theme) => (custom ? alpha(theme.palette.warning.main, 0.16) : 'transparent'),
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={enabled(u, m.key)}
                          disabled={u.fullControl}
                          onChange={(e) => save([u.id], { [m.key]: changeFor(u, m, e.target.checked) })}
                          inputProps={{ 'aria-label': `${u.name} – ${moduleLabel(m)}` }}
                        />
                      </TableCell>
                    );
                  }),
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1.5 }}>{ta('legendCustom')}</Typography>
    </Card>
  );

  const columnTargets = filtered.filter((u) => !u.fullControl);
  const setColumn = (m: AppModule, on: boolean | 'default') => {
    setColumnMenu(null);
    // One request per distinct change keeps role defaults intact for each user.
    const groups = new Map<string, string[]>();
    for (const u of columnTargets) {
      const value = on === 'default' ? null : changeFor(u, m, on);
      const k = String(value);
      groups.set(k, [...(groups.get(k) ?? []), u.id]);
    }
    for (const [k, ids] of groups) save(ids, { [m.key]: k === 'null' ? null : k === 'true' });
  };

  const copySourceUser = users.find((u) => u.id === copySource);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={600} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{ta('title')}</Typography>
          <Typography variant="body2" color="text.secondary">{ta('subtitle')}</Typography>
        </Box>
        {mutation.isPending && <CircularProgress size={20} />}
      </Box>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="user" label={ta('tabByUser')} />
        <Tab value="matrix" label={ta('tabMatrix')} />
      </Tabs>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{extractErrorMessage(error)}</Alert>}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : tab === 'user' ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '300px 1fr' }, gap: 2, alignItems: 'start' }}>
          {userList}
          <Box sx={{ minWidth: 0 }}>
            {userPanel || <Typography color="text.secondary" sx={{ p: 2 }}>{ta('selectUser')}</Typography>}
          </Box>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder={ta('searchUsers')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
            <TextField select size="small" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} label={ta('role')} sx={{ minWidth: 180 }}>
              <MenuItem value="">{ta('allRoles')}</MenuItem>
              {roles.map((r) => <MenuItem key={r} value={r}>{roleLabel(r)}</MenuItem>)}
            </TextField>
          </Box>
          {matrix}
        </>
      )}

      <Menu anchorEl={columnMenu?.anchor} open={!!columnMenu} onClose={() => setColumnMenu(null)}>
        <MenuItem disabled>
          {columnMenu && ta('columnFor', { module: moduleLabel(columnMenu.module), count: columnTargets.length })}
        </MenuItem>
        <MenuItem onClick={() => columnMenu && setColumn(columnMenu.module, true)}>{ta('everyoneOn')}</MenuItem>
        <MenuItem onClick={() => columnMenu && setColumn(columnMenu.module, false)}>{ta('everyoneOff')}</MenuItem>
        <MenuItem onClick={() => columnMenu && setColumn(columnMenu.module, 'default')}>{ta('everyoneDefault')}</MenuItem>
      </Menu>

      {/* Copy another user's modules onto the selected user */}
      <ResponsiveDialog open={copyOpen} onClose={() => setCopyOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{ta('copyTitle')}</DialogTitle>
        <DialogContent>
          <TextField select fullWidth size="small" sx={{ mt: 1 }} label={ta('sourceUser')} value={copySource} onChange={(e) => setCopySource(e.target.value)}>
            {users.filter((u) => u.id !== selected?.id).map((u) => (
              <MenuItem key={u.id} value={u.id}>{u.name} — {roleLabel(u.role)}</MenuItem>
            ))}
          </TextField>
          {selected && copySourceUser && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              {ta('copyHint', { name: selected.name, source: copySourceUser.name })}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopyOpen(false)}>{ta('cancel')}</Button>
          <Button
            variant="contained"
            disabled={!selected || !copySourceUser}
            onClick={() => {
              if (!selected || !copySourceUser) return;
              const changes: Changes = {};
              for (const m of APP_MODULES) {
                const value = changeFor(selected, m, enabled(copySourceUser, m.key));
                if (value !== null) changes[m.key] = value;
              }
              save([selected.id], changes, true);
              setCopyOpen(false);
            }}
          >
            {ta('copy')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>

      {/* Give every other user of the same role the selected user's modules */}
      <ResponsiveDialog open={applyOpen} onClose={() => setApplyOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{selected && ta('applyToRole', { role: roleLabel(selected.role) })}</DialogTitle>
        <DialogContent>
          {selected && (
            <Typography variant="body2">
              {ta('applyHint', { count: sameRoleOthers.length, role: roleLabel(selected.role), name: selected.name })}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApplyOpen(false)}>{ta('cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!selected) return;
              save(sameRoleOthers.map((u) => u.id), { ...selected.moduleAccess }, true);
              setApplyOpen(false);
            }}
          >
            {ta('apply')}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </Box>
  );
}
