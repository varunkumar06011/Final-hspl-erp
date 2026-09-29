import { Box, Chip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../i18n';
import { CommentBody, roleLabel } from './CommentsButton';

export interface ActivityItem {
  id: string;
  kind: 'AUDIT' | 'COMMENT';
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  url: string | null;
  actor: { id: string; name: string; role: string } | null;
  at: string;
  note: string | null;
  mentions: Array<{ id: string; name: string }>;
}

// Page that holds each record type, for click-through from a feed row.
const ENTITY_ROUTES: Record<string, string> = {
  QUOTATION: '/quotations',
  PURCHASE_ORDER: '/pos',
  VENDOR_INVOICE: '/invoices',
  PAYMENT_REQUEST: '/payments',
  MATERIAL_PURCHASE_REQUEST: '/material-purchase-requests',
  JOURNAL_VOUCHER: '/vouchers',
  VOUCHER: '/vouchers',
  GOODS_RECEIPT: '/goods-receipts',
  GATE_PASS: '/gate-passes',
  VENDOR: '/vendors',
  CONTRACT: '/contracts',
  ISSUE: '/issues',
  INSPECTION: '/inspections',
  DOCUMENT: '/documents',
  INVENTORY_ITEM: '/inventory',
  ASSET: '/assets',
  BUDGET_HEAD: '/budget-heads',
  BANK_ACCOUNT: '/bank-accounts',
  CASH_ACCOUNT: '/cash-accounts',
  LEDGER: '/ledgers',
  SITE_PHOTO: '/photos',
  WORK_TASK: '/work',
};

export function activityPath(item: ActivityItem): string | null {
  return item.url ?? ENTITY_ROUTES[item.entityType] ?? null;
}

// Audit actions that share one sentence with their plain counterpart.
const ACTION_KEY: Record<string, string> = {
  APPROVE: 'approve',
  REJECT: 'reject',
  CREATE: 'create',
  CREATE_MPR: 'create',
  UPDATE: 'update',
  UPDATE_MPR: 'update',
  DELETE: 'delete',
  DELETE_MPR: 'delete',
  SUBMIT_MPR: 'submit',
  CANCEL_MPR: 'cancel',
  CLOSE_MPR: 'close',
  COMMENT: 'comment',
};

export const ACTIVITY_COLORS: Record<string, string> = {
  approve: '#2fd9a4',
  reject: '#ff5c7a',
  create: '#4f8cff',
  update: '#f5b43a',
  delete: '#ff5c7a',
  submit: '#4f8cff',
  cancel: '#ff5c7a',
  close: '#94a3b8',
  comment: '#a78bfa',
};

export function activityActionKey(action: string): string {
  return ACTION_KEY[action] ?? 'other';
}

export function formatActivityTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(dateLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One sentence: "<Name> approved Purchase Order PO-0012". Name is rendered separately (bold). */
export function useActivitySentence() {
  const { t } = useTranslation('activity');
  return (item: ActivityItem): string => {
    const key = activityActionKey(item.action);
    const e = t(`entity_${item.entityType}`, {
      defaultValue: item.entityType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    });
    return t(`do_${key}`, { e, l: item.entityLabel ?? '', defaultValue: t('do_other', { e, l: item.entityLabel ?? '' }) }).replace(/\s+/g, ' ').trim();
  };
}

/** Feed row used by the Activity Log page (full) and the dashboard panel (compact). */
export default function ActivityLogRow({
  item,
  onOpen,
  compact = false,
  dark = false,
}: {
  item: ActivityItem;
  onOpen?: (path: string) => void;
  compact?: boolean;
  dark?: boolean;
}) {
  const sentence = useActivitySentence();
  const key = activityActionKey(item.action);
  const color = ACTIVITY_COLORS[key] ?? '#94a3b8';
  const path = activityPath(item);
  const dim = dark ? '#8b98b0' : 'text.secondary';
  const fg = dark ? '#e6ebf5' : 'text.primary';
  const clickable = !!path && !!onOpen;

  return (
    <Box
      onClick={clickable ? () => onOpen!(path!) : undefined}
      sx={{
        display: 'flex',
        gap: 1,
        minWidth: 0,
        alignItems: 'flex-start',
        cursor: clickable ? 'pointer' : 'default',
        ...(compact
          ? { px: 0.8, py: 0.6, borderRadius: 1.5, bgcolor: 'rgba(148,163,184,.04)', border: '1px solid rgba(148,163,184,.14)', '&:hover': clickable ? { bgcolor: 'rgba(148,163,184,.08)' } : {} }
          : { py: 1.25 }),
      }}
    >
      <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 2, bgcolor: color, flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Typography component="span" sx={{ fontWeight: 700, fontSize: compact ? '0.72rem' : '0.9rem', color: fg }}>
            {item.actor?.name ?? '—'}
          </Typography>
          {!compact && item.actor && (
            <Chip size="small" label={roleLabel(item.actor.role)} sx={{ height: 18, fontSize: '0.62rem' }} />
          )}
          <Typography component="span" sx={{ fontSize: compact ? '0.72rem' : '0.9rem', color: fg }}>
            {sentence(item)}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: compact ? '0.6rem' : '0.72rem', color: dim }}>
          {formatActivityTime(item.at)}
        </Typography>
        {item.note && (
          <Box
            sx={{
              mt: 0.4,
              pl: 1,
              borderLeft: `2px solid ${color}66`,
              fontSize: compact ? '0.66rem' : '0.82rem',
              color: dark ? '#c3cde0' : 'text.primary',
              ...(compact && { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
            }}
          >
            {item.kind === 'COMMENT' ? <CommentBody body={item.note} mentions={item.mentions} /> : item.note}
          </Box>
        )}
      </Box>
    </Box>
  );
}
