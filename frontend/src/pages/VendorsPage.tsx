import EntityPage from '../components/EntityPage';
import { VendorCategory, VendorStatus } from '@hospital-erp/shared';
import { enumToOptions, STATUS_COLORS } from '../utils/enumOptions';

export default function VendorsPage() {
  return (
    <EntityPage
      title="Vendors"
      endpoint="/vendors"
      entityName="Vendor"
      entityType="VENDOR"
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category', render: (r) => String(r.category).replace(/_/g, ' ') },
        { key: 'phone', label: 'Phone' },
        { key: 'gstNumber', label: 'GST' },
        { key: 'rating', label: 'Rating' },
        { key: 'status', label: 'Status' },
      ]}
      statusKey="status"
      statusColors={STATUS_COLORS}
      fields={[
        { name: 'name', label: 'Vendor Name', type: 'text', required: true },
        { name: 'category', label: 'Category', type: 'select', options: enumToOptions(VendorCategory), defaultValue: VendorCategory.OTHER, dropdownType: 'VENDOR_CATEGORY' },
        { name: 'phone', label: 'Phone', type: 'text' },
        { name: 'email', label: 'Email', type: 'text' },
        { name: 'gstNumber', label: 'GST Number', type: 'text' },
        { name: 'panNumber', label: 'PAN Number', type: 'text' },
        { name: 'bankName', label: 'Bank Name', type: 'text' },
        { name: 'bankAccountNumber', label: 'Account Number', type: 'text' },
        { name: 'ifscCode', label: 'IFSC Code', type: 'text' },
        { name: 'address', label: 'Address', type: 'textarea' },
        { name: 'status', label: 'Status', type: 'select', options: enumToOptions(VendorStatus), defaultValue: VendorStatus.ACTIVE },
        { name: 'rating', label: 'Rating (0-5)', type: 'number', defaultValue: 0 },
      ]}
    />
  );
}
