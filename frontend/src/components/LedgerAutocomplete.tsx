import { useState, useMemo } from 'react';
import {
  Autocomplete,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Chip,
  CircularProgress,
  Typography,
  Collapse,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import { LedgerGroup } from '@hospital-erp/shared';

export interface LedgerOption {
  id: string;
  name: string;
  group: string;
  currentBalance: number;
  isActive?: boolean;
  linkedEntityType: string | null;
}

interface LedgerAutocompleteProps {
  label?: string;
  value: string; // ledger ID
  onChange: (ledgerId: string, ledger: LedgerOption | null) => void;
  ledgers: LedgerOption[];
  /** Restrict to only these groups (e.g. ['BANK','CASH'] for Contra) */
  allowedGroups?: string[];
  /** Pre-filter the dropdown to show these groups first */
  preferredGroups?: string[];
  size?: 'small' | 'medium';
  autoFocus?: boolean;
  placeholder?: string;
  onError?: (msg: string) => void;
}

const GROUP_LABELS: Record<string, string> = {
  FIXED_ASSET: 'Fixed Assets',
  CURRENT_ASSET: 'Current Assets',
  BANK: 'Bank Accounts',
  CASH: 'Cash-in-Hand',
  CURRENT_LIABILITY: 'Current Liabilities',
  LOAN: 'Loans (Liability)',
  DUTIES_TAXES: 'Duties & Taxes',
  CAPITAL_ACCOUNT: 'Capital Account',
  SUNDRY_CREDITORS: 'Sundry Creditors',
  SUNDRY_DEBTORS: 'Sundry Debtors',
  DIRECT_EXPENSE: 'Direct Expenses',
  INDIRECT_EXPENSE: 'Indirect Expenses',
  PURCHASE: 'Purchase Accounts',
  DIRECT_INCOME: 'Direct Incomes',
  INDIRECT_INCOME: 'Indirect Incomes',
  SALES: 'Sales Accounts',
};

const ALL_GROUPS = Object.values(LedgerGroup);

export default function LedgerAutocomplete({
  label = 'Ledger',
  value,
  onChange,
  ledgers,
  allowedGroups,
  preferredGroups,
  size = 'small',
  autoFocus = false,
  placeholder = 'Type ledger name...',
  onError,
}: LedgerAutocompleteProps) {
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newLedgerName, setNewLedgerName] = useState('');
  const [newLedgerGroup, setNewLedgerGroup] = useState<string>(LedgerGroup.INDIRECT_EXPENSE);
  const [createError, setCreateError] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupParent, setNewGroupParent] = useState<string>(LedgerGroup.INDIRECT_EXPENSE);
  const [groupError, setGroupError] = useState('');

  // Fetch custom groups
  const { data: customGroupsData } = useQuery({
    queryKey: ['/ledgers/groups'],
    queryFn: async () => {
      const response = await api.get('/ledgers/groups');
      return response.data;
    },
  });
  const customGroups: { id: string; name: string; parentGroup: string }[] = customGroupsData?.data ?? [];

  // Filter ledgers by allowed groups if specified
  const filteredLedgers = useMemo(() => {
    let list = ledgers;
    if (allowedGroups && allowedGroups.length > 0) {
      list = list.filter((l) => allowedGroups.includes(l.group));
    }
    // Sort: preferred groups first, then alphabetical
    if (preferredGroups && preferredGroups.length > 0) {
      list = [...list].sort((a, b) => {
        const aPref = preferredGroups.includes(a.group) ? 0 : 1;
        const bPref = preferredGroups.includes(b.group) ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        return a.name.localeCompare(b.name);
      });
    } else {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [ledgers, allowedGroups, preferredGroups]);

  const selectedLedger = filteredLedgers.find((l) => l.id === value) ?? null;

  const createLedgerMutation = useMutation({
    mutationFn: async (payload: { name: string; group: string }) => {
      const response = await api.post('/ledgers/quick-create', payload);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/ledgers'] });
      queryClient.invalidateQueries({ queryKey: ['/ledgers', 'all-active'] });
      const newLedger: LedgerOption = {
        id: data.id,
        name: data.name,
        group: data.group,
        currentBalance: Number(data.currentBalance),
        linkedEntityType: data.linkedEntityType,
      };
      onChange(data.id, newLedger);
      setCreateOpen(false);
      setNewLedgerName('');
      setCreateError('');
    },
    onError: (err: unknown) => {
      const msg = extractErrorMessage(err);
      setCreateError(msg);
      onError?.(msg);
    },
  });

  const handleCreate = () => {
    if (!newLedgerName.trim()) {
      setCreateError('Enter a ledger name');
      return;
    }
    createLedgerMutation.mutate({ name: newLedgerName.trim(), group: newLedgerGroup });
  };

  const createGroupMutation = useMutation({
    mutationFn: async (payload: { name: string; parentGroup: string }) => {
      const response = await api.post('/ledgers/groups', payload);
      return response.data;
    },
    onSuccess: (data) => {
      // Add the new group to the cache immediately so the dropdown shows it
      queryClient.setQueryData(['/ledgers/groups'], (old: any) => ({
        ...old,
        data: [...(old?.data ?? []), data],
      }));
      setNewLedgerGroup(data.name);
      setShowCreateGroup(false);
      setNewGroupName('');
      setGroupError('');
    },
    onError: (err: unknown) => {
      setGroupError(extractErrorMessage(err));
    },
  });

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) {
      setGroupError('Enter a group name');
      return;
    }
    createGroupMutation.mutate({ name: newGroupName.trim(), parentGroup: newGroupParent });
  };

  return (
    <Box>
      <Autocomplete
        size={size}
        autoFocus={autoFocus}
        value={selectedLedger}
        inputValue={inputValue}
        onInputChange={(_, newInputValue) => setInputValue(newInputValue)}
        onChange={(_, newValue) => {
          if (newValue && typeof newValue === 'object' && 'id' in newValue) {
            const option = newValue as LedgerOption;
            if (option.id.startsWith('__create__')) {
              // "Create <name>" option was clicked — open create dialog with the real name
              const realName = option.name.replace(/^Create\s+"/, '').replace(/"$/, '');
              setNewLedgerName(realName);
              setCreateOpen(true);
              // Clear the input so the placeholder text doesn't show "Create ..."
              setInputValue('');
            } else {
              onChange(option.id, option);
            }
          } else if (typeof newValue === 'string') {
            // freeSolo text — open create dialog
            setNewLedgerName(newValue);
            setCreateOpen(true);
          } else if (newValue === null) {
            onChange('', null);
          }
        }}
        options={filteredLedgers}
        loading={false}
        isOptionEqualToValue={(option, val) => option.id === val.id}
        getOptionLabel={(option) => {
          if (typeof option === 'string') return option;
          return (option as LedgerOption).name;
        }}
        filterOptions={(options, params) => {
          const filtered = options.filter((opt) =>
            opt.name.toLowerCase().includes(params.inputValue.toLowerCase()),
          );
          // If typed text doesn't match any ledger, offer to create
          if (
            params.inputValue.trim() !== '' &&
            !filtered.find((opt) => opt.name.toLowerCase() === params.inputValue.toLowerCase())
          ) {
            filtered.push({
              id: `__create__${params.inputValue}`,
              name: `Create "${params.inputValue}"`,
              group: '',
              currentBalance: 0,
              linkedEntityType: null,
            });
          }
          return filtered;
        }}
        renderOption={(props, option) => {
          const isCreateOption = option.id.startsWith('__create__');
          return (
            <li {...props} style={{ fontWeight: isCreateOption ? 600 : 400, whiteSpace: 'normal', wordBreak: 'break-word' }}>
              {isCreateOption ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'primary.main' }}>
                  <AddIcon fontSize="small" />
                  <span>{option.name}</span>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span style={{ opacity: option.isActive === false ? 0.5 : 1 }}>{option.name}</span>
                    {option.isActive === false && (
                      <Chip label="Inactive" size="small" sx={{ fontSize: '0.6rem', height: 16, color: 'text.secondary' }} />
                    )}
                  </Box>
                  <Chip
                    label={GROUP_LABELS[option.group] ?? option.group}
                    size="small"
                    variant="outlined"
                    sx={{ ml: 1, fontSize: '0.7rem' }}
                  />
                </Box>
              )}
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder={placeholder}
          />
        )}
        freeSolo
        selectOnFocus
        clearOnBlur
        handleHomeEndKeys
        noOptionsText="No ledgers found — type to create a new one"
      />

      {/* Quick-create ledger dialog (Tally Alt+C style) */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Create New Ledger</DialogTitle>
        <DialogContent>
          {createError && (
            <Typography color="error" variant="body2" sx={{ mb: 1 }}>{createError}</Typography>
          )}
          <TextField
            autoFocus
            fullWidth
            label="Ledger Name"
            value={newLedgerName}
            onChange={(e) => setNewLedgerName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            select
            fullWidth
            label="Group"
            value={newLedgerGroup}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '__create_new__') {
                setShowCreateGroup(true);
              } else {
                setNewLedgerGroup(val);
              }
            }}
          >
            {ALL_GROUPS.map((g) => (
              <MenuItem key={g} value={g}>{GROUP_LABELS[g] ?? g}</MenuItem>
            ))}
            {customGroups.length > 0 && (
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider', my: 0.5 }} />
            )}
            {customGroups.map((g) => (
              <MenuItem key={g.id} value={g.name}>
                {g.name} <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>({GROUP_LABELS[g.parentGroup] ?? g.parentGroup})</Typography>
              </MenuItem>
            ))}
            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', my: 0.5 }} />
            <MenuItem value="__create_new__" sx={{ color: 'primary.main', fontWeight: 600 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AddIcon fontSize="small" /> Create New Group
              </Box>
            </MenuItem>
          </TextField>

          {/* Inline create-group form (Tally Alt+C in group field) */}
          <Collapse in={showCreateGroup}>
            <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Create New Group</Typography>
              {groupError && <Typography color="error" variant="body2" sx={{ mb: 1 }}>{groupError}</Typography>}
              <TextField
                autoFocus
                fullWidth
                size="small"
                label="Group Name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                sx={{ mb: 1.5 }}
              />
              <TextField
                select
                fullWidth
                size="small"
                label="Under (Parent Group)"
                value={newGroupParent}
                onChange={(e) => setNewGroupParent(e.target.value)}
                sx={{ mb: 1.5 }}
              >
                {ALL_GROUPS.map((g) => (
                  <MenuItem key={g} value={g}>{GROUP_LABELS[g] ?? g}</MenuItem>
                ))}
              </TextField>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleCreateGroup}
                  disabled={createGroupMutation.isPending}
                  startIcon={createGroupMutation.isPending ? <CircularProgress size={14} /> : undefined}
                >
                  Create Group
                </Button>
                <Button size="small" onClick={() => { setShowCreateGroup(false); setNewGroupName(''); setGroupError(''); }}>
                  Cancel
                </Button>
              </Box>
            </Box>
          </Collapse>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Opening balance defaults to 0. You can adjust it later from Chart of Accounts.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={createLedgerMutation.isPending}
            startIcon={createLedgerMutation.isPending ? <CircularProgress size={16} /> : undefined}
          >
            Create & Select
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
