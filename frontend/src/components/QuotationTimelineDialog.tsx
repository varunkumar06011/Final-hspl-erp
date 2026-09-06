import { useState } from 'react';
import {
  Box,
  Typography,
  DialogTitle,
  DialogContent,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  AttachFile as AttachFileIcon,
  Schedule as ScheduleIcon,
  HourglassEmpty as HourglassEmptyIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import ResponsiveDialog from './ResponsiveDialog';
import api, { extractErrorMessage } from '../config/api';
import { formatCurrency, formatDate, formatDateTime } from '../utils/enumOptions';

interface TimelineEvent {
  timestamp: string;
  action: string;
  actionLabel: string;
  userName: string;
  userRole: string;
  details: Record<string, unknown>;
}

interface TimelineData {
  quotation: {
    id: string;
    quotationNumber: string;
    vendor: { id: string; name: string; vendorCode: string };
    status: string;
    grandTotal: number;
    fileName: string | null;
    filePath: string | null;
    createdAt: string;
    createdByUser: { id: string; name: string; role: string };
  };
  timeline: TimelineEvent[];
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  CREATED: <AddIcon fontSize="small" />,
  UPDATE: <EditIcon fontSize="small" />,
  DELETE: <DeleteIcon fontSize="small" />,
  APPROVE: <CheckIcon fontSize="small" />,
  REJECT: <CloseIcon fontSize="small" />,
  STEP_APPROVED: <CheckIcon fontSize="small" />,
  STEP_REJECTED: <CloseIcon fontSize="small" />,
  PENDING_APPROVAL: <HourglassEmptyIcon fontSize="small" />,
  FILE_ATTACHED: <AttachFileIcon fontSize="small" />,
};

const ACTION_COLORS: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default' | 'primary'> = {
  CREATED: 'primary',
  UPDATE: 'info',
  DELETE: 'error',
  APPROVE: 'success',
  REJECT: 'error',
  STEP_APPROVED: 'success',
  STEP_REJECTED: 'error',
  PENDING_APPROVAL: 'warning',
  FILE_ATTACHED: 'info',
};

export default function QuotationTimelineDialog({
  quotationId,
  open,
  onClose,
}: {
  quotationId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [errorMsg, setErrorMsg] = useState('');

  const { data, isLoading, error } = useQuery<TimelineData>({
    queryKey: ['/quotations', quotationId, 'timeline'],
    queryFn: async () => {
      const response = await api.get(`/quotations/${quotationId}/timeline`);
      return response.data;
    },
    enabled: !!quotationId && open,
    retry: false,
  });

  const errMsg = errorMsg || (error ? extractErrorMessage(error) : '');

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      sx={{ '& .MuiDialog-paper': { margin: { xs: 1 } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <ScheduleIcon />
        <Typography component="span" variant="h6">
          Quotation Timeline
        </Typography>
        {data && (
          <Chip
            label={data.quotation.quotationNumber}
            size="small"
            color="primary"
            sx={{ ml: 1 }}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {errMsg && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMsg('')}>
            {errMsg}
          </Alert>
        )}

        {data && (
          <Box>
            {/* Quotation summary header */}
            <Box
              sx={{
                mb: 2,
                p: 2,
                bgcolor: 'grey.50',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: { xs: 1, sm: 3 },
                  alignItems: 'center',
                }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Vendor
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {data.quotation.vendor?.vendorCode} — {data.quotation.vendor?.name}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Grand Total
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {formatCurrency(data.quotation.grandTotal)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Status
                  </Typography>
                  <Box>
                    <Chip
                      label={data.quotation.status.replace(/_/g, ' ')}
                      size="small"
                      color="primary"
                    />
                  </Box>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Created By
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {data.quotation.createdByUser?.name ?? '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Created On
                  </Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {formatDate(data.quotation.createdAt)}
                  </Typography>
                </Box>
                {data.quotation.fileName && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Attachment
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      <AttachFileIcon
                        fontSize="small"
                        sx={{ verticalAlign: 'middle', mr: 0.5 }}
                      />
                      {data.quotation.fileName}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>

            <Divider sx={{ mb: 2 }}>
              <Typography variant="overline" color="text.secondary">
                Lifecycle ({data.timeline.length} events)
              </Typography>
            </Divider>

            {/* Timeline */}
            <Box sx={{ position: 'relative', pl: { xs: 1, sm: 3 } }}>
              {/* Vertical line */}
              <Box
                sx={{
                  position: 'absolute',
                  left: { xs: 15, sm: 27 },
                  top: 8,
                  bottom: 8,
                  width: 2,
                  bgcolor: 'divider',
                }}
              />

              {data.timeline.map((event, index) => {
                const icon =
                  ACTION_ICONS[event.action] ?? <ScheduleIcon fontSize="small" />;
                const color = ACTION_COLORS[event.action] ?? 'default';

                return (
                  <Box
                    key={index}
                    sx={{
                      display: 'flex',
                      gap: 2,
                      mb: 2.5,
                      position: 'relative',
                    }}
                  >
                    {/* Icon circle */}
                    <Box
                      sx={{
                        position: 'relative',
                        zIndex: 1,
                        flexShrink: 0,
                        width: { xs: 28, sm: 32 },
                        height: { xs: 28, sm: 32 },
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor:
                          color === 'success'
                            ? 'success.main'
                            : color === 'error'
                            ? 'error.main'
                            : color === 'warning'
                            ? 'warning.main'
                            : color === 'info'
                            ? 'info.main'
                            : color === 'primary'
                            ? 'primary.main'
                            : 'grey.400',
                        color: 'white',
                        boxShadow: '0 0 0 3px white',
                      }}
                    >
                      {icon}
                    </Box>

                    {/* Content */}
                    <Box sx={{ flex: 1, minWidth: 0, pt: 0.25 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 1,
                        }}
                      >
                        <Typography variant="subtitle2" fontWeight={600}>
                          {event.actionLabel}
                        </Typography>
                        <Chip
                          label={event.action}
                          size="small"
                          variant="outlined"
                          sx={{ height: 18, fontSize: '0.65rem' }}
                        />
                      </Box>

                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mt: 0.25 }}
                      >
                        {formatDateTime(event.timestamp)}
                      </Typography>

                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        <strong>User:</strong> {event.userName}
                        {event.userRole && (
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                            sx={{ ml: 0.5 }}
                          >
                            ({event.userRole.replace(/_/g, ' ')})
                          </Typography>
                        )}
                      </Typography>

                      {/* Details */}
                      {event.details &&
                        Object.keys(event.details).length > 0 && (
                          <Box
                            sx={{
                              mt: 0.5,
                              p: 1,
                              bgcolor: 'grey.50',
                              borderRadius: 0.5,
                              fontSize: '0.75rem',
                            }}
                          >
                            {renderDetails(event.details, event.action)}
                          </Box>
                        )}
                    </Box>
                  </Box>
                );
              })}
            </Box>

            {data.timeline.length === 0 && (
              <Typography color="text.secondary" align="center" sx={{ py: 3 }}>
                No timeline events recorded.
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
    </ResponsiveDialog>
  );
}

function renderDetails(
  details: Record<string, unknown>,
  action: string
): React.ReactNode {
  // For approval/rejection steps, show comments prominently
  if (
    action === 'STEP_APPROVED' ||
    action === 'STEP_REJECTED' ||
    action === 'APPROVE' ||
    action === 'REJECT'
  ) {
    const comments = details.comments as string | undefined;
    const reason = details.reason as string | undefined;
    const text = reason ?? comments;
    if (text) {
      return (
        <Typography variant="caption">
          <strong>Comments:</strong> {text}
        </Typography>
      );
    }
  }

  // For file updates, show file name
  if (action === 'UPDATE' && ('filePath' in details || 'fileName' in details)) {
    const fileName = details.fileName as string | undefined;
    return (
      <Typography variant="caption">
        <strong>File attached:</strong> {fileName ?? '—'}
      </Typography>
    );
  }

  // For creation, show vendor and amount
  if (action === 'CREATED') {
    const vendor = details.vendor as
      | { name: string; vendorCode: string }
      | undefined;
    const hasFile = details.hasFile as boolean | undefined;
    return (
      <Box>
        {vendor && (
          <Typography variant="caption" sx={{ display: 'block' }}>
            <strong>Vendor:</strong> {vendor.vendorCode} — {vendor.name}
          </Typography>
        )}
        {hasFile && (
          <Typography variant="caption" sx={{ display: 'block' }}>
            <strong>Attachment:</strong> {details.fileName as string}
          </Typography>
        )}
      </Box>
    );
  }

  // For pending steps, show step number
  if (action === 'PENDING_APPROVAL') {
    return (
      <Typography variant="caption">
        <strong>Step:</strong> {details.stepNumber as number} — Awaiting decision
      </Typography>
    );
  }

  // Default: show key-value pairs (excluding internal fields)
  const skipKeys = new Set([
    'stepId',
    'acknowledged',
    'previousValues',
    'stepStatus',
    'stepNumber',
  ]);
  const entries = Object.entries(details).filter(([k]) => !skipKeys.has(k));
  if (entries.length === 0) return null;

  return (
    <Box>
      {entries.map(([key, value]) => (
        <Typography key={key} variant="caption" sx={{ display: 'block' }}>
          <strong>{key}:</strong>{' '}
          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
        </Typography>
      ))}
    </Box>
  );
}
