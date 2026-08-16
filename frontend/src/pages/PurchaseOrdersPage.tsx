import EntityPage from '../components/EntityPage';
import { POStatus } from '@hospital-erp/shared';
import { enumToOptions, formatCurrency, STATUS_COLORS } from '../utils/enumOptions';
import { parseLineItems, LINE_ITEMS_HINT } from '../utils/lineItems';

export default function PurchaseOrdersPage() {
  return (
    <EntityPage
      title="Purchase Orders"
      endpoint="/purchase-orders"
      entityName="Purchase Order"
      entityType="PURCHASE_ORDER"
      columns={[
        { key: 'poNumber', label: 'PO Number' },
        { key: 'vendor', label: 'Vendor', render: (r) => (r.vendor as any)?.name ?? '—' },
        { key: 'date', label: 'Date', render: (r) => new Date(r.date as string).toLocaleDateString() },
        { key: 'totalAmount', label: 'Total', render: (r) => formatCurrency(r.totalAmount) },
        { key: 'status', label: 'Status' },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'vendorId', label: 'Vendor', type: 'select', required: true, optionsEndpoint: '/vendors' },
        { name: 'quotationId', label: 'From Quotation (optional)', type: 'select', optionsEndpoint: '/quotations' },
        { name: 'poNumber', label: 'PO Number', type: 'text', required: true },
        { name: 'deliveryDate', label: 'Delivery Date', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', options: enumToOptions(POStatus), defaultValue: POStatus.DRAFT, dropdownType: 'PO_STATUS' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        { name: 'items', label: `Line Items — ${LINE_ITEMS_HINT}`, type: 'textarea', required: true },
      ]}
      buildPayload={(form) => ({
        vendorId: form.vendorId,
        quotationId: form.quotationId || undefined,
        poNumber: form.poNumber,
        deliveryDate: form.deliveryDate || undefined,
        status: form.status,
        notes: form.notes || undefined,
        items: parseLineItems(String(form.items ?? '')),
      })}
    />
  );
}
