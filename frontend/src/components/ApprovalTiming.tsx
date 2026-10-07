import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { isAdminRole, isFirstLevelApproverRole } from '@hospital-erp/shared';

interface TimingStep {
  stepNumber?: number;
  approverRole: string;
  status: string;
  decidedAt?: string | null;
  approverUser?: { name: string } | null;
}

interface TimingWorkflow {
  status: string;
  createdAt?: string | null;
  steps?: TimingStep[];
}

/** "2d 3h", "5h 20m", "12m" — never shows seconds. */
export function formatDuration(ms: number, t: (key: string) => string): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}${t('approvalTime.d')} ${hours}${t('approvalTime.h')}`;
  if (hours > 0) return `${hours}${t('approvalTime.h')} ${mins}${t('approvalTime.m')}`;
  return `${mins}${t('approvalTime.m')}`;
}

/**
 * How long each approval stage took (or has been waiting): first the Project Head /
 * Head of Construction, then — once a head approves — the admins. The clock starts when
 * the request is raised and the admin clock starts at the head's approval.
 */
export default function ApprovalTiming({
  startedAt,
  workflow,
  compact = false,
}: {
  startedAt?: string | null;
  workflow?: TimingWorkflow | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const steps = workflow?.steps ?? [];
  const pendingStage = workflow && workflow.status !== 'APPROVED' && workflow.status !== 'REJECTED';

  useEffect(() => {
    if (!pendingStage) return undefined;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [pendingStage]);

  const start = new Date(workflow?.createdAt ?? startedAt ?? '').getTime();
  if (!workflow || steps.length === 0 || Number.isNaN(start)) return null;

  const decided = (s: TimingStep) => s.status === 'APPROVED' && !!s.decidedAt;
  const byTime = (a: TimingStep, b: TimingStep) => new Date(a.decidedAt!).getTime() - new Date(b.decidedAt!).getTime();
  const headDone = steps.filter((s) => isFirstLevelApproverRole(s.approverRole) && decided(s)).sort(byTime)[0];
  const adminDone = steps.filter((s) => isAdminRole(s.approverRole) && decided(s)).sort(byTime)[0];

  const lines: { key: string; text: string; done: boolean }[] = [];
  const headEnd = headDone ? new Date(headDone.decidedAt!).getTime() : undefined;

  // Stage 1 — heads
  if (headDone) {
    lines.push({
      key: 'head',
      done: true,
      text: t('approvalTime.tookToApprove', { name: headDone.approverUser?.name ?? t('approvalTime.head'), d: formatDuration(headEnd! - start, t) }),
    });
  } else if (pendingStage) {
    lines.push({ key: 'head', done: false, text: t('approvalTime.waitingHead', { d: formatDuration(now - start, t) }) });
  }

  // Stage 2 — admins (clock starts at the head's approval)
  const adminStart = headEnd ?? start;
  if (adminDone) {
    lines.push({
      key: 'admin',
      done: true,
      text: t('approvalTime.tookToApprove', { name: adminDone.approverUser?.name ?? t('approvalTime.admin'), d: formatDuration(new Date(adminDone.decidedAt!).getTime() - adminStart, t) }),
    });
  } else if (pendingStage && headDone) {
    lines.push({ key: 'admin', done: false, text: t('approvalTime.waitingAdmin', { d: formatDuration(now - adminStart, t) }) });
  }

  if (lines.length === 0) return null;
  const shown = compact ? lines.slice(-1) : lines;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {shown.map((line) => (
        <Typography key={line.key} variant="caption" sx={{ color: line.done ? 'text.secondary' : 'warning.main', fontWeight: line.done ? 400 : 600 }}>
          ⏱ {line.text}
        </Typography>
      ))}
    </Box>
  );
}
