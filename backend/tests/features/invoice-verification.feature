Feature: Invoice Verification — Vendor Billing
  As a supervisor or approver
  I want to create vendor invoices against delivered POs, verify them through an approval workflow, and reject incorrect ones
  So that we only pay for what was actually delivered and verified

  Background:
    Given the logged-in user is "Ravi" with role "SUPERVISOR" in project "Apollo Hospital Chennai"
    And the user has the VERIFY_INVOICE permission
    And an approved PO "PO-001" exists for vendor "Ultra Cement Supplies" with total 38000

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Create an invoice for a delivered PO
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a vendor invoice against a delivered PO
    Given PO "PO-001" has status "DELIVERED"
    When Ravi goes to "Create Invoice" and enters:
      | field          | value      |
      | vendorId       | Ultra Cement Supplies |
      | poId           | PO-001     |
      | invoiceNumber  | INV-2026-001 |
      | amount         | 38000      |
      | taxAmount      | 6840       |
      | totalAmount    | 44840      |
      | deliveryDate   | 2026-08-23 |
    And checks the acknowledgement checkbox
    And clicks "Submit Invoice"
    Then the backend creates the invoice with verification status "PENDING"
    And a 4-step approval workflow is initiated with minApprovers=2
    And push notifications are sent to PROJECT_HEAD users

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Invoice creation requires acknowledgement
  # ─────────────────────────────────────────────────────────────────
  Scenario: Invoice creation fails without the acknowledgement checkbox
    When Ravi tries to create an invoice without checking the acknowledgement
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Acknowledgement is required"
    And no invoice is created

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Advance paid cannot exceed the total amount
  # ─────────────────────────────────────────────────────────────────
  Scenario: Invoice creation fails when advance paid is more than the total
    When Ravi enters an invoice with:
      | field          | value  |
      | totalAmount    | 10000  |
      | advancePaid    | 15000  |
    And checks the acknowledgement
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Advance paid (15000) cannot exceed invoice total (10000)"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: 100% advance is allowed
  # ─────────────────────────────────────────────────────────────────
  Scenario: Invoice with 100% advance payment is accepted
    When Ravi enters an invoice with totalAmount 10000 and advancePaid 10000
    And checks the acknowledgement
    Then the backend creates the invoice successfully
    And the advancePaid is recorded as 10000

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Tax amount defaults to 0 if not provided
  # ─────────────────────────────────────────────────────────────────
  Scenario: Invoice creation without taxAmount defaults to 0
    When Ravi enters an invoice with amount 10000 and totalAmount 10000 (no taxAmount)
    And checks the acknowledgement
    Then the backend creates the invoice with taxAmount = 0

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: First verification approval
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head verifies the invoice (first of 2 required approvals)
    Given an invoice "INV-001" exists with verification status "PENDING"
    And the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna approves the invoice with comment "Invoice matches the PO"
    Then the invoice verification status remains "PENDING" (not yet fully verified)
    And 1 of 2 required approvals is done

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Second verification approval → invoice is VERIFIED
  # ─────────────────────────────────────────────────────────────────
  Scenario: Head of Construction verifies the invoice (second approval → VERIFIED)
    Given an invoice "INV-001" has been approved by PROJECT_HEAD (1 of 2 done)
    And the logged-in user is "Suresh" with role "HEAD_OF_CONSTRUCTION"
    When Suresh approves the invoice with comment "Verified"
    Then the invoice verification status changes to "VERIFIED"
    And the invoice is now eligible for a payment request

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Invoice is rejected after two distinct rejections
  # ─────────────────────────────────────────────────────────────────
  Scenario: Invoice is rejected when the amounts don't match the delivery
    Given an invoice "INV-002" exists with verification status "PENDING"
    When "Nagarjuna" (PROJECT_HEAD) rejects it with reason "Amount doesn't match PO"
    And "Suresh" (HEAD_OF_CONSTRUCTION) rejects it with reason "Agreed, invoice is incorrect"
    Then the invoice verification status changes to "REJECTED"
    And no payment request can be created from this invoice
    And the vendor must submit a corrected invoice

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Same person cannot verify twice
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head tries to approve both verification steps
    Given an invoice "INV-001" has been approved by "Nagarjuna" at step 1
    And the logged-in user is still "Nagarjuna"
    When Nagarjuna tries to approve step 2
    Then the backend rejects the request
    And the error message says "Only HEAD_OF_CONSTRUCTION can approve this step"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: List invoices filtered by verification status
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor lists all pending-verification invoices
    Given 4 invoices exist: 2 PENDING, 1 VERIFIED, 1 REJECTED
    When Ravi goes to the invoice list and filters by verificationStatus "PENDING"
    Then only the 2 pending invoices are shown

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Update invoice stock status
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor updates the stock status of an invoice to "RECEIVED"
    Given an invoice "INV-001" exists with stockStatus "PENDING"
    When Ravi updates the stock status to "RECEIVED"
    Then the invoice stockStatus changes to "RECEIVED"
    And the inventory is updated to reflect the received materials

  # ─────────────────────────────────────────────────────────────────
  # Scenario 12: Create an invoice without a PO (direct invoice)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a direct invoice (no PO linked) for a cash purchase
    When Ravi creates an invoice with:
      | field          | value           |
      | vendorId       | Ultra Cement Supplies |
      | invoiceNumber  | CASH-INV-001    |
      | amount         | 5000            |
      | taxAmount      | 900             |
      | totalAmount    | 5900            |
    And does NOT specify a poId
    And checks the acknowledgement
    Then the backend creates the invoice without a linked PO
    And the invoice goes through the same verification workflow
