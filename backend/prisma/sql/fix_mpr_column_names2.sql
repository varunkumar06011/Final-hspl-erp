-- Rename additional MPR columns from snake_case to camelCase
ALTER TABLE material_purchase_requests RENAME COLUMN contact_person TO contactPerson;
ALTER TABLE material_purchase_requests RENAME COLUMN contact_number TO contactNumber;
ALTER TABLE material_purchase_requests RENAME COLUMN billing_address TO billingAddress;
ALTER TABLE material_purchase_requests RENAME COLUMN state_code TO stateCode;

ALTER TABLE material_purchase_request_items RENAME COLUMN material_code TO materialCode;
ALTER TABLE material_purchase_request_items RENAME COLUMN required_date TO requiredDate;
