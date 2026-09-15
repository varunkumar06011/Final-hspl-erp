import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

// ─── Hook: useApprovalDeepLink ────────────────────────────
// When a push notification is tapped, the URL includes ?approval=<workflowId>
// This hook detects that param, finds the matching row, and calls onOpen
// Then clears the param so it doesn't re-trigger on refresh
//
// If the workflow has already been decided (approved/rejected on another
// device or section), the dialog is NOT opened — the param is just cleared.

interface RowWithApproval {
  id: string;
  status?: string;
  approvalWorkflow?: {
    id: string;
    status?: string;
    steps?: { status: string }[];
  } | null;
}

export function useApprovalDeepLink<T extends RowWithApproval>(
  rows: T[] | undefined,
  onOpen: (row: T) => void
): void {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const approvalId = searchParams.get('approval');
    if (!approvalId || !rows || rows.length === 0) return;

    const match = rows.find((row) => row.approvalWorkflow?.id === approvalId);
    if (match) {
      const wf = match.approvalWorkflow;
      const alreadyDecided =
        wf?.status === 'APPROVED' ||
        wf?.status === 'REJECTED' ||
        (!!wf?.steps && wf.steps.length > 0 && !wf.steps.some((s) => s.status === 'PENDING'));

      if (!alreadyDecided) {
        onOpen(match);
      }
      // Clear the param so it doesn't re-trigger
      searchParams.delete('approval');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, rows, onOpen]);
}
