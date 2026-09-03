/**
 * Opens WhatsApp with a pre-filled message.
 * Works on both desktop (WhatsApp Web) and mobile (WhatsApp app).
 */
export function shareOnWhatsApp(message: string, phoneNumber?: string) {
  const encoded = encodeURIComponent(message);
  const url = phoneNumber
    ? `https://wa.me/${phoneNumber}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Builds a shareable message for a purchase order.
 */
export function buildPOShareMessage(po: {
  poNumber: string;
  vendorName?: string;
  grandTotal?: number;
  status?: string;
  date?: string;
}): string {
  return [
    `📋 *Purchase Order ${po.poNumber}*`,
    ``,
    `Vendor: ${po.vendorName ?? '—'}`,
    `Amount: ₹${Number(po.grandTotal ?? 0).toLocaleString('en-IN')}`,
    `Status: ${po.status ?? '—'}`,
    `Date: ${po.date ?? '—'}`,
    ``,
    `Sent from Hospital Construction ERP`,
  ].join('\n');
}

/**
 * Builds a shareable message for an invoice.
 */
export function buildInvoiceShareMessage(inv: {
  invoiceCode?: string;
  invoiceNumber?: string;
  vendorName?: string;
  totalAmount?: number;
  paymentStatus?: string;
  verificationStatus?: string;
  date?: string;
}): string {
  return [
    `🧾 *Invoice ${inv.invoiceCode ?? inv.invoiceNumber ?? ''}*`,
    ``,
    `Vendor: ${inv.vendorName ?? '—'}`,
    `Amount: ₹${Number(inv.totalAmount ?? 0).toLocaleString('en-IN')}`,
    `Payment: ${inv.paymentStatus ?? '—'}`,
    `Verification: ${inv.verificationStatus ?? '—'}`,
    `Date: ${inv.date ?? '—'}`,
    ``,
    `Sent from Hospital Construction ERP`,
  ].join('\n');
}

/**
 * Builds a shareable message for a payment request.
 */
export function buildPaymentShareMessage(pay: {
  paymentCode?: string;
  requestNumber?: string;
  vendorName?: string;
  amount?: number;
  status?: string;
  type?: string;
  description?: string;
}): string {
  return [
    `💰 *Payment ${pay.paymentCode ?? pay.requestNumber ?? ''}*`,
    ``,
    `Vendor: ${pay.vendorName ?? '—'}`,
    `Amount: ₹${Number(pay.amount ?? 0).toLocaleString('en-IN')}`,
    `Type: ${pay.type ?? '—'}`,
    `Status: ${pay.status ?? '—'}`,
    pay.description ? `Description: ${pay.description}` : null,
    ``,
    `Sent from Hospital Construction ERP`,
  ].filter(Boolean).join('\n');
}
