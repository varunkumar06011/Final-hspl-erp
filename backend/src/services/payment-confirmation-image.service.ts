import sharp from 'sharp';
import type { PaymentConfirmationData } from './payment-confirmation-pdf.service';

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/** Wraps text to lines of at most `max` characters. */
function wrap(text: string, max: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, max - 3)}...`;
  }
  return lines;
}

/** The "payment done" card as a PNG photo that can be sent over WhatsApp. */
export async function paymentConfirmationPng(d: PaymentConfirmationData): Promise<Buffer> {
  const W = 900;
  const amount = `₹${d.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const account = d.vendorAccountLast4 ? `${d.vendorBank ? `${d.vendorBank} ` : ''}a/c ending ${d.vendorAccountLast4}` : null;
  const materialLines = wrap(d.materials?.length ? d.materials.join(', ') : d.description ?? '', 52, 3);

  const rows: Array<[string, string[]]> = [
    ['Paid to', [d.vendorCode ? `${d.vendorName} (${d.vendorCode})` : d.vendorName]],
  ];
  if (account) rows.push(['Bank account', [account]]);
  if (materialLines.length) rows.push(['For', materialLines]);
  if (d.poNumber) rows.push(['PO', [d.poNumber]]);
  if (d.invoiceCode) rows.push(['Invoice', [d.invoiceCode]]);
  if (d.suppliedOn) rows.push(['Supplied on', [fmtDate(new Date(d.suppliedOn))]]);
  rows.push(['Payment done on', [fmtDate(d.paidOn)]]);
  if (d.mode) rows.push(['Mode', [d.mode.replace(/_/g, ' ')]]);
  if (d.reference) rows.push(['Ref / UTR', [d.reference]]);
  rows.push(['Payment ref', [d.paymentCode]]);

  let y = 330;
  const body = rows
    .map(([k, vs]) => {
      const out = `<text x="50" y="${y}" font-size="22" fill="#78909C">${esc(k)}</text>` +
        vs.map((v, i) => `<text x="290" y="${y + i * 30}" font-size="26" font-weight="bold" fill="#263238">${esc(v)}</text>`).join('');
      y += Math.max(1, vs.length) * 30 + 22;
      return out;
    })
    .join('');
  const H = y + 70;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect width="${W}" height="120" fill="#0F4C4C"/>
  <text x="50" y="58" font-size="34" font-weight="bold" fill="#ffffff">${esc(d.projectName)}</text>
  <text x="50" y="96" font-size="22" fill="#CFE8E8">Payment Confirmation</text>
  <rect x="40" y="150" width="${W - 80}" height="140" rx="12" fill="#E8F5F5"/>
  <text x="70" y="196" font-size="22" font-weight="bold" fill="#0F4C4C">✔ PAYMENT DONE</text>
  <text x="70" y="262" font-size="56" font-weight="bold" fill="#263238">${esc(amount)}</text>
  ${body}
  <rect x="40" y="${H - 54}" width="${W - 80}" height="2" fill="#B0BEC5"/>
  <text x="50" y="${H - 20}" font-size="18" fill="#78909C">Please do not raise another PO for this payment.</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
