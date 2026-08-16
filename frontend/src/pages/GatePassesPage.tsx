import EntityPage from '../components/EntityPage';
import { GatePassType } from '@hospital-erp/shared';
import { enumToOptions, STATUS_COLORS } from '../utils/enumOptions';
import { parseLineItems, LINE_ITEMS_HINT } from '../utils/lineItems';

export default function GatePassesPage() {
  return (
    <EntityPage
      title="Gate Passes"
      endpoint="/gate-passes"
      entityName="Gate Pass"
      entityType="GATE_PASS"
      columns={[
        { key: 'passNumber', label: 'Pass Number' },
        { key: 'type', label: 'Type' },
        { key: 'date', label: 'Date', render: (r) => new Date(r.date as string).toLocaleDateString() },
        { key: 'vehicleNumber', label: 'Vehicle' },
        { key: 'status', label: 'Status' },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'poId', label: 'PO (optional)', type: 'select', optionsEndpoint: '/purchase-orders' },
        { name: 'invoiceId', label: 'Invoice (optional)', type: 'select', optionsEndpoint: '/invoices' },
        { name: 'passNumber', label: 'Pass Number', type: 'text', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: enumToOptions(GatePassType), defaultValue: GatePassType.INWARD, dropdownType: 'GATE_PASS_TYPE' },
        { name: 'vehicleNumber', label: 'Vehicle Number', type: 'text' },
        { name: 'driverName', label: 'Driver Name', type: 'text' },
        { name: 'carrierName', label: 'Carrier Name', type: 'text' },
        { name: 'items', label: `Items — ${LINE_ITEMS_HINT}`, type: 'textarea', required: true },
      ]}
      buildPayload={(form) => ({
        poId: form.poId || undefined,
        invoiceId: form.invoiceId || undefined,
        passNumber: form.passNumber,
        type: form.type,
        vehicleNumber: form.vehicleNumber || undefined,
        driverName: form.driverName || undefined,
        carrierName: form.carrierName || undefined,
        items: parseLineItems(String(form.items ?? '')),
      })}
    />
  );
}
