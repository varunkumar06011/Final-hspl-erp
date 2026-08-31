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
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractErrorMessage } from '../config/api';
import { LedgerGroup } from '@hospital-erp/shared';

export interface LedgerOption {
  id: string;
  name: string;
  group: string;
  currentBalance: number;
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
  FIXED_ASSET: 'Fixed Asset',
  CURRENT_ASSET: 'Current Asset',
  BANK: 'Bank',
  CASH: 'Cash',
  CURRENT_LIABILITY: 'Current Liability',
  LOAN: 'Loan / Borrowing',
  DUTIES_TAXES: 'Duties & Taxes',
  CAPITAL_ACCOUNT: 'Capital Account',
  SUNDRY_CREDITORS: 'Sundry Creditors (Vendors)',
  SUNDRY_DEBTORS: 'Sundry Debtors (Customers)',
  DIRECT_EXPENSE: 'Direct Expense',
  INDIRECT_EXPENSE: 'Indirect Expense',
  PURCHASE: 'Purchase',
  DIRECT_INCOME: 'Direct Income',
  INDIRECT_INCOME: 'Indirect Income',
  SALES: 'Sales',
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
            onChange((newValue as LedgerOption).id, newValue as LedgerOption);
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
                  <span>{option.name}</span>
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
            onChange={(e) => setNewLedgerGroup(e.target.value)}
          >
            {ALL_GROUPS.map((g) => (
              <MenuItem key={g} value={g}>{GROUP_LABELS[g] ?? g}</MenuItem>
            ))}
          </TextField>
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
