import { useState } from 'react';
import { IconButton, Button, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItem, ListItemText, Typography, CircularProgress } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import SmsIcon from '@mui/icons-material/Sms';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';
import { shareOnWhatsApp } from '../utils/whatsappShare';

interface Recipient { key: string; role: string; name: string; phone: string | null }

interface Confirmation {
  paymentCode: string;
  vendorName: string;
  amount: number;
  poNumber: string | null;
  invoiceCode: string | null;
  materials?: string[];
  suppliedOn?: string | null;
  paidOn: string;
  vendorBank?: string | null;
  vendorAccountLast4?: string | null;
  mode: string | null;
  reference: string | null;
  voucherNumber: string | null;
  status: string;
  vendorPhone: string | null;
  recipients: Recipient[];
  projectName: string;
}

/** Digits only, with the India code added to a bare 10-digit number (wa.me / sms: want no "+"). */
function dialNumber(raw: string | null | undefined): string | undefined {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  return digits.length === 10 ? `91${digits}` : digits;
}

function fmtDay(v: string | null | undefined): string | null {
  return v ? new Date(v).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : null;
}

/** The ready-made "payment done" message (WhatsApp text is outside the translated screens by design). */
function confirmationText(c: Confirmation): string {
  const account = c.vendorAccountLast4 ? `${c.vendorBank ? `${c.vendorBank} ` : ''}a/c ending ${c.vendorAccountLast4}` : null;
  const lines = [
    `✅ *Payment done — ${c.projectName}*`,
    ``,
    `${c.projectName} has paid ₹${Number(c.amount).toLocaleString('en-IN')} to ${c.vendorName}${account ? ` (${account})` : ''}`,
    c.materials?.length ? `For: ${c.materials.join(', ')}` : null,
    c.poNumber ? `PO: ${c.poNumber}` : null,
    c.invoiceCode ? `Invoice: ${c.invoiceCode}` : null,
    fmtDay(c.suppliedOn) ? `Supplied on: ${fmtDay(c.suppliedOn)}` : null,
    `Payment done on: ${fmtDay(c.paidOn)}`,
    c.mode ? `Mode: ${c.mode.replace(/_/g, ' ')}` : null,
    c.reference ? `Ref / UTR: ${c.reference}` : null,
    `Payment ref: ${c.paymentCode}`,
    ``,
    `This payment is complete. Please do not raise another PO for it.`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/**
 * WhatsApp button of a payment row: shares the "payment done" message together
 * with a generated PDF confirmation, to the vendor or the Head of Construction.
 * There is also an SMS option for the vendor's number. `onShared` fires after a
 * send so the page can offer to record the voucher.
 */
export default function PaymentConfirmShare({
  paymentId,
  onShared,
  onError,
}: {
  paymentId: string;
  onShared?: (c: { status: string }) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation('payments');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Confirmation | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());

  async function openDialog() {
    setOpen(true);
    if (info) return;
    try {
      const res = await api.get<Confirmation>(`/payments/${paymentId}/confirmation`);
      setInfo(res.data);
    } catch (err) {
      setOpen(false);
      onError(extractErrorMessage(err));
    }
  }

  /** The payment photo; the PDF slip is the fallback if the image cannot be made. */
  async function fetchSlip(c: Confirmation): Promise<File> {
    try {
      const res = await api.get(`/payments/${paymentId}/confirmation.png`, { responseType: 'blob' });
      return new File([res.data as Blob], `${c.paymentCode}-payment-done.png`, { type: 'image/png' });
    } catch {
      const res = await api.get(`/payments/${paymentId}/confirmation.pdf`, { responseType: 'blob' });
      return new File([res.data as Blob], `${c.paymentCode}-payment-confirmation.pdf`, { type: 'application/pdf' });
    }
  }

  async function sendWhatsApp(r: Recipient) {
    if (!info) return;
    setBusy(true);
    try {
      const file = await fetchSlip(info);
      const text = confirmationText(info);
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        // Phone share sheet: pick this person's chat; the photo goes along with the text.
        await navigator.share({ files: [file], text, title: info.paymentCode });
      } else {
        // No file sharing here (desktop): save the photo to attach, and open this person's chat with the text.
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        shareOnWhatsApp(text, dialNumber(r.phone));
      }
      setSent((prev) => new Set(prev).add(r.key));
      onShared?.({ status: info.status });
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') onError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function sendSms() {
    if (!info) return;
    const number = dialNumber(info.vendorPhone);
    if (!number) return;
    const body = `${info.projectName}: payment of Rs ${Number(info.amount).toLocaleString('en-IN')} has been made to ${info.vendorName}${info.poNumber ? ` for ${info.poNumber}` : ''}${info.reference ? `. Ref ${info.reference}` : ''}. Ref no ${info.paymentCode}.`;
    window.location.href = `sms:+${number}?body=${encodeURIComponent(body)}`;
    onShared?.({ status: info.status });
  }

  return (
    <>
      <IconButton size="small" sx={{ color: '#25D366' }} onClick={() => { void openDialog(); }} title={t('shareOnWhatsapp')}>
        <WhatsAppIcon fontSize="small" />
      </IconButton>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('confirmDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('confirmDialogHint')}</Typography>
          {!info ? (
            <CircularProgress size={22} />
          ) : (
            <List dense disablePadding>
              {info.recipients.map((r) => (
                <ListItem
                  key={r.key}
                  disableGutters
                  secondaryAction={
                    <Button
                      size="small"
                      variant={sent.has(r.key) ? 'outlined' : 'contained'}
                      color="success"
                      startIcon={sent.has(r.key) ? <CheckIcon /> : <WhatsAppIcon />}
                      disabled={busy || !r.phone}
                      onClick={() => { void sendWhatsApp(r); }}
                    >
                      {sent.has(r.key) ? t('confirmSent') : t('confirmSend')}
                    </Button>
                  }
                >
                  <ListItemText
                    primary={r.name}
                    secondary={r.phone ? `${t(`confirmRole${r.role}`, r.role)} · ${r.phone}` : `${t(`confirmRole${r.role}`, r.role)} · ${t('confirmNoPhone')}`}
                  />
                </ListItem>
              ))}
            </List>
          )}
          {info?.vendorPhone && (
            <Button size="small" startIcon={<SmsIcon />} sx={{ mt: 1 }} onClick={sendSms}>{t('confirmSmsVendor')}</Button>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('confirmClose')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
