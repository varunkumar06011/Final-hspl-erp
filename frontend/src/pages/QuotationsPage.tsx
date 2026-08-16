import EntityPage from '../components/EntityPage';
import { QuotationStatus } from '@hospital-erp/shared';
import { enumToOptions, formatCurrency, STATUS_COLORS } from '../utils/enumOptions';
import { parseLineItems, LINE_ITEMS_HINT } from '../utils/lineItems';

export default function QuotationsPage() {
  return (
    <EntityPage
      title="Quotations"
      endpoint="/quotations"
      entityName="Quotation"
      entityType="QUOTATION"
      columns={[
        { key: 'quotationNumber', label: 'Number' },
        { key: 'vendor', label: 'Vendor', render: (r) => (r.vendor as any)?.name ?? '—' },
        { key: 'date', label: 'Date', render: (r) => new Date(r.date as string).toLocaleDateString() },
        { key: 'totalAmount', label: 'Total', render: (r) => formatCurrency(r.totalAmount) },
        { key: 'status', label: 'Status' },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'vendorId', label: 'Vendor', type: 'select', required: true, optionsEndpoint: '/vendors' },
        { name: 'quotationNumber', label: 'Quotation Number', type: 'text', required: true },
        { name: 'status', label: 'Status', type: 'select', options: enumToOptions(QuotationStatus), defaultValue: QuotationStatus.DRAFT, dropdownType: 'QUOTATION_STATUS' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        { name: 'items', label: `Line Items — ${LINE_ITEMS_HINT}`, type: 'textarea', required: true },
      ]}
      buildPayload={(form) => ({
        vendorId: form.vendorId,
        quotationNumber: form.quotationNumber,
        status: form.status,
        notes: form.notes || undefined,
        items: parseLineItems(String(form.items ?? '')),
      })}
    />
  );
}
