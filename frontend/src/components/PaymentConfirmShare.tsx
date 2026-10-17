import { useState } from 'react';
import { IconButton, Menu, MenuItem, ListItemIcon, ListItemText, CircularProgress } from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import SmsIcon from '@mui/icons-material/Sms';
import { useTranslation } from 'react-i18next';
import api, { extractErrorMessage } from '../config/api';
import { shareOnWhatsApp } from '../utils/whatsappShare';

interface Confirmation {
  paymentCode: string;
  vendorName: string;
  amount: number;
  poNumber: string | null;
  invoiceCode: string | null;
  mode: string | null;
  reference: string | null;
  voucherNumber: string | null;
  status: string;
  vendorPhone: string | null;
  headName: string | null;
  headPhone: string | null;
  projectName: string;
}

/** Digits only, with the India code added to a bare 10-digit number (wa.me / sms: want no "+"). */
function dialNumber(raw: string | null | undefined): string | undefined {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  return digits.length === 10 ? `91${digits}` : digits;
}

function confirmationText(c: Confirmation): string {
  const lines = [
    `✅ *Payment done — ${c.projectName}*`,
    ``,
    `Paid to: ${c.vendorName}`,
    `Amount: ₹${Number(c.amount).toLocaleString('en-IN')}`,
    c.poNumber ? `PO: ${c.poNumber}` : null,
    c.invoiceCode ? `Invoice: ${c.invoiceCode}` : null,
    c.mode ? `Mode: ${c.mode.replace(/_/g, ' ')}` : null,
    c.reference ? `Ref / UTR: ${c.reference}` : null,
    `Payment ref: ${c.paymentCode}`,
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Confirmation | null>(null);

  async function openMenu(el: HTMLElement) {
    setAnchor(el);
    if (info) return;
    try {
      const res = await api.get<Confirmation>(`/payments/${paymentId}/confirmation`);
      setInfo(res.data);
    } catch (err) {
      setAnchor(null);
      onError(extractErrorMessage(err));
    }
  }

  async function fetchPdf(c: Confirmation): Promise<File> {
    const res = await api.get(`/payments/${paymentId}/confirmation.pdf`, { responseType: 'blob' });
    return new File([res.data as Blob], `${c.paymentCode}-payment-confirmation.pdf`, { type: 'application/pdf' });
  }

  async function sendWhatsApp(phone: string | null | undefined) {
    if (!info) return;
    setAnchor(null);
    setBusy(true);
    try {
      const file = await fetchPdf(info);
      const text = confirmationText(info);
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        // Phone share sheet: the PDF goes along with the text.
        await navigator.share({ files: [file], text, title: info.paymentCode });
      } else {
        // No file sharing here (desktop): save the PDF to attach, and open the chat with the text.
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
        shareOnWhatsApp(`${text}\n\n(Payment confirmation PDF attached)`, dialNumber(phone));
      }
      onShared?.({ status: info.status });
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') onError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function sendSms() {
    if (!info) return;
    setAnchor(null);
    const number = dialNumber(info.vendorPhone);
    if (!number) return;
    const body = `${info.projectName}: payment of Rs ${Number(info.amount).toLocaleString('en-IN')} has been made to ${info.vendorName}${info.poNumber ? ` for ${info.poNumber}` : ''}${info.reference ? `. Ref ${info.reference}` : ''}. Ref no ${info.paymentCode}.`;
    window.location.href = `sms:+${number}?body=${encodeURIComponent(body)}`;
    onShared?.({ status: info.status });
  }

  return (
    <>
      <IconButton size="small" sx={{ color: '#25D366' }} disabled={busy} onClick={(e) => { void openMenu(e.currentTarget); }} title={t('shareOnWhatsapp')}>
        {busy ? <CircularProgress size={18} color="inherit" /> : <WhatsAppIcon fontSize="small" />}
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem disabled={!info} onClick={() => { void sendWhatsApp(info?.vendorPhone); }}>
          <ListItemIcon><WhatsAppIcon fontSize="small" sx={{ color: '#25D366' }} /></ListItemIcon>
          <ListItemText>{t('confirmToVendor')}</ListItemText>
        </MenuItem>
        <MenuItem disabled={!info} onClick={() => { void sendWhatsApp(info?.headPhone); }}>
          <ListItemIcon><WhatsAppIcon fontSize="small" sx={{ color: '#25D366' }} /></ListItemIcon>
          <ListItemText>{t('confirmToHead', { name: info?.headName ?? '' })}</ListItemText>
        </MenuItem>
        <MenuItem disabled={!info?.vendorPhone} onClick={sendSms}>
          <ListItemIcon><SmsIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{info && !info.vendorPhone ? t('confirmNoVendorPhone') : t('confirmSmsVendor')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
