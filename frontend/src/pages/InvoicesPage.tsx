import EntityPage from '../components/EntityPage';
import { formatCurrency, STATUS_COLORS } from '../utils/enumOptions';

export default function InvoicesPage() {
  return (
    <EntityPage
      title="Vendor Invoices"
      endpoint="/invoices"
      entityName="Invoice"
      entityType="VENDOR_INVOICE"
      columns={[
        { key: 'invoiceNumber', label: 'Invoice Number' },
        { key: 'vendor', label: 'Vendor', render: (r) => (r.vendor as any)?.name ?? '—' },
        { key: 'date', label: 'Date', render: (r) => new Date(r.date as string).toLocaleDateString() },
        { key: 'totalAmount', label: 'Total', render: (r) => formatCurrency(r.totalAmount) },
        { key: 'verificationStatus', label: 'Verification' },
      ]}
      statusKey="verificationStatus"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'vendorId', label: 'Vendor', type: 'select', required: true, optionsEndpoint: '/vendors' },
        { name: 'poId', label: 'PO (optional)', type: 'select', optionsEndpoint: '/purchase-orders' },
        { name: 'invoiceNumber', label: 'Invoice Number', type: 'text', required: true },
        { name: 'amount', label: 'Amount', type: 'number', required: true },
        { name: 'taxAmount', label: 'Tax Amount', type: 'number', defaultValue: 0 },
        { name: 'totalAmount', label: 'Total Amount', type: 'number', required: true },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
    />
  );
}
