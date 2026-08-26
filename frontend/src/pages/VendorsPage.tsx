import EntityPage from '../components/EntityPage';
import { formatDate, STATUS_COLORS } from '../utils/enumOptions';

export default function VendorsPage() {
  return (
    <EntityPage
      title="Vendors"
      endpoint="/vendors"
      entityName="Vendor"
      entityType="VENDOR"
      columns={[
        { key: 'vendorCode', label: 'Vendor ID' },
        { key: 'name', label: 'Vendor Name' },
        { key: 'category', label: 'Category' },
        { key: 'gstNumber', label: 'GST No' },
        { key: 'createdAt', label: 'Date', render: (r) => formatDate(r.createdAt) },
        { key: 'phone', label: 'Phone' },
        { key: 'referenceBy', label: 'Referred By' },
        { key: 'totalBilled', label: 'Total Bill', render: (r) => `₹${Number(r.totalBilled ?? 0).toLocaleString('en-IN')}` },
        { key: 'totalPaid', label: 'Paid', render: (r) => `₹${Number(r.totalPaid ?? 0).toLocaleString('en-IN')}` },
        { key: 'outstanding', label: 'Outstanding', render: (r) => `₹${Number(r.outstanding ?? 0).toLocaleString('en-IN')}` },
        { key: 'status', label: 'Status' },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'name', label: 'Vendor Name', type: 'text', required: true },
        { name: 'phone', label: 'Phone', type: 'text' },
        { name: 'gstNumber', label: 'GST Number', type: 'text' },
        { name: 'category', label: 'Vendor Category', type: 'select', required: true, dropdownType: 'VENDOR_CATEGORY', createOptionLabel: 'New Category', options: [
          { value: 'LABOUR_SUPPLIER', label: 'Labour Supplier' },
          { value: 'ELECTRICAL_CONTRACTOR', label: 'Electrical Contractor' },
          { value: 'WOOD_WORK_CONTRACTOR', label: 'Wood Work Contractor' },
          { value: 'MACHINERY_SUPPLIER', label: 'Machinery Supplier' },
          { value: 'TOOL_SUPPLIER', label: 'Tool Supplier' },
          { value: 'MATERIAL_SUPPLIER', label: 'Material Supplier' },
          { value: 'SUBCONTRACTOR', label: 'Subcontractor' },
          { value: 'SERVICE_PROVIDER', label: 'Service Provider' },
          { value: 'EQUIPMENT_SUPPLIER', label: 'Equipment Supplier' },
          { value: 'OTHER', label: 'Other' },
        ], defaultValue: 'LABOUR_SUPPLIER' },
        { name: 'referenceBy', label: 'Referred By', type: 'select', options: [
          { value: 'Nagarjuna Sir', label: 'Nagarjuna Sir' },
          { value: 'Ashok Sir', label: 'Ashok Sir' },
          { value: 'Kaushal Sir', label: 'Kaushal Sir' },
          { value: 'Vinod Sir', label: 'Vinod Sir' },
        ] },
        { name: 'materials', label: 'Materials Supplied', type: 'materials-list' },
        { name: 'panNumber', label: 'PAN Number', type: 'text' },
        { name: 'bankName', label: 'Bank Name', type: 'text' },
        { name: 'bankAccountNumber', label: 'Account Number', type: 'text' },
        { name: 'ifscCode', label: 'IFSC Code', type: 'text' },
        { name: 'address', label: 'Address', type: 'textarea' },
        { name: 'email', label: 'Email', type: 'text' },
      ]}
    />
  );
}
