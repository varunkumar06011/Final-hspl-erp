import EntityPage from '../components/EntityPage';
import { VendorCategory } from '@hospital-erp/shared';
import { enumToOptions } from '../utils/enumOptions';

const REFERENCE_BY_OPTIONS = [
  { value: 'Nagarjuna Sir', label: 'Nagarjuna Sir' },
  { value: 'Ashok Sir', label: 'Ashok Sir' },
  { value: 'Kaushal Anna', label: 'Kaushal Anna' },
  { value: 'Vinod Anna', label: 'Vinod Anna' },
];

export default function VendorsPage() {
  return (
    <EntityPage
      title="Vendors"
      endpoint="/vendors"
      entityName="Vendor"
      entityType="VENDOR"
      columns={[
        { key: 'vendorCode', label: 'Vendor ID' },
        { key: 'name', label: 'Name', render: (r) => `${r.vendorCode ?? ''} - ${String(r.name ?? '')}` },
        { key: 'contactPersonName', label: 'Contact Person' },
        { key: 'phone', label: 'Phone' },
        { key: 'contactPersonPhone', label: 'Contact Phone' },
        { key: 'gstNumber', label: 'GST' },
        { key: 'category', label: 'Category', render: (r) => String(r.category).replace(/_/g, ' ') },
        { key: 'referenceBy', label: 'Reference By' },
      ]}
      fields={[
        { name: 'vendorCode', label: 'Vendor ID', type: 'text', readonly: true },
        { name: 'name', label: 'Vendor Name', type: 'text', required: true },
        { name: 'contactPersonName', label: 'Contact Person Name', type: 'text' },
        { name: 'phone', label: 'Phone No', type: 'text' },
        { name: 'contactPersonPhone', label: 'Contact Person Phone No', type: 'text' },
        { name: 'gstNumber', label: 'GST No', type: 'text' },
        { name: 'category', label: 'Category', type: 'select', options: enumToOptions(VendorCategory), defaultValue: VendorCategory.OTHER, dropdownType: 'VENDOR_CATEGORY' },
        { name: 'materials', label: 'Materials', type: 'materials-list' },
        { name: 'referenceBy', label: 'Reference By', type: 'select-with-other', options: REFERENCE_BY_OPTIONS },
        { name: 'email', label: 'Email', type: 'text' },
        { name: 'panNumber', label: 'PAN Number', type: 'text' },
        { name: 'bankName', label: 'Bank Name', type: 'text' },
        { name: 'bankAccountNumber', label: 'Account Number', type: 'text' },
        { name: 'ifscCode', label: 'IFSC Code', type: 'text' },
        { name: 'address', label: 'Address', type: 'textarea' },
      ]}
      buildPayload={(form) => ({
        name: form.name,
        contactPersonName: form.contactPersonName || undefined,
        contactPersonPhone: form.contactPersonPhone || undefined,
        phone: form.phone || undefined,
        gstNumber: form.gstNumber || undefined,
        category: form.category,
        materials: (form.materials as Array<{ name: string; pricePerUnit?: number }> | undefined)
          ?.filter((m) => m.name && m.name.trim() !== '')
          .map((m) => ({
            name: m.name,
            pricePerUnit: m.pricePerUnit || undefined,
          })),
        referenceBy: form.referenceBy || undefined,
        email: form.email || undefined,
        panNumber: form.panNumber || undefined,
        bankName: form.bankName || undefined,
        bankAccountNumber: form.bankAccountNumber || undefined,
        ifscCode: form.ifscCode || undefined,
        address: form.address || undefined,
      })}
    />
  );
}
