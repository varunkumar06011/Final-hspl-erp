Feature: Purchase Order Flow — From Approval to Delivery
  As a supervisor
  I want to create purchase orders from approved quotations, get them approved, and track delivery
  So that the project has a clear record of what was ordered, who approved it, and what was delivered

  Background:
    Given the logged-in user is "Ravi" with role "SUPERVISOR" in project "Apollo Hospital Chennai"
    And the user has the CREATE_PO permission
    And an approved quotation "Q-001" exists for vendor "Ultra Cement Supplies"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Create a PO from an approved quotation
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a Purchase Order from an approved quotation
    Given the quotation "Q-001" has status "APPROVED"
    When Ravi goes to the quotation and clicks "Convert to PO"
    And checks the acknowledgement checkbox
    Then the backend creates a Purchase Order with:
      | field        | value                    |
      | vendorId     | Ultra Cement Supplies    |
      | quotationId  | Q-001                    |
      | status       | PENDING_APPROVAL         |
    And the quotation status changes to "CONVERTED_TO_PO"
    And a 4-step approval workflow is created for the PO with minApprovers=2
    And push notifications are sent to PROJECT_HEAD users

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: PO creation requires acknowledgement
  # ─────────────────────────────────────────────────────────────────
  Scenario: PO creation fails without the acknowledgement checkbox
    When Ravi tries to create a PO without checking the acknowledgement
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Acknowledgement is required"
    And no PO is created

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: PO approval — first approval
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head approves the PO (first of 2 required approvals)
    Given a PO "PO-001" exists with status "PENDING_APPROVAL"
    And the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna approves the PO with comment "Go ahead"
    Then the PO status changes to "APPROVAL_1"
    And the workflow is not yet fully approved (1 of 2 done)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: PO approval — second approval fully approves
  # ─────────────────────────────────────────────────────────────────
  Scenario: Head of Construction approves the PO (second approval → fully approved)
    Given a PO "PO-001" has been approved by PROJECT_HEAD (1 of 2 done)
    And the logged-in user is "Suresh" with role "HEAD_OF_CONSTRUCTION"
    When Suresh approves the PO with comment "Approved"
    Then the PO status changes to "APPROVED"
    And the workflow is fully approved (2 of 2 done)
    And the PO is now ready for delivery and gate pass creation

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Same person cannot approve the PO twice
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head tries to approve both steps of the same PO
    Given a PO "PO-001" has been approved by "Nagarjuna" at step 1
    And the logged-in user is still "Nagarjuna"
    When Nagarjuna tries to approve step 2
    Then the backend rejects the request
    And the error message says "Only HEAD_OF_CONSTRUCTION can approve this step"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: PO is rejected after two distinct rejections
  # ─────────────────────────────────────────────────────────────────
  Scenario: PO is fully rejected after two approvers reject it
    Given a PO "PO-002" exists with a pending approval workflow
    When "Nagarjuna" (PROJECT_HEAD) rejects it with reason "Budget exceeded"
    And "Suresh" (HEAD_OF_CONSTRUCTION) rejects it with reason "Agreed, cancel this PO"
    Then the PO status changes to "REJECTED"
    And no gate pass can be created from this PO
    And no invoice can be created against this PO

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Cancel an approved PO
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head cancels an approved PO that is no longer needed
    Given a PO "PO-003" has status "APPROVED"
    And the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna cancels the PO with reason "Vendor went out of business"
    Then the PO status changes to "CANCELLED"
    And no further gate passes or invoices can be created from this PO
    And an audit log entry records the cancellation

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: PO is marked as partially delivered
  # ─────────────────────────────────────────────────────────────────
  Scenario: First delivery arrives — PO is marked as PARTIALLY_DELIVERED
    Given a PO "PO-001" has status "APPROVED" with 100 bags of cement ordered
    And a gate pass was created and approved for the first delivery of 50 bags
    When the delivery is recorded in the system
    Then the PO status changes to "PARTIALLY_DELIVERED"
    And the PO shows 50 of 100 bags delivered

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: PO is marked as fully delivered
  # ─────────────────────────────────────────────────────────────────
  Scenario: Final delivery arrives — PO is marked as DELIVERED
    Given a PO "PO-001" has status "PARTIALLY_DELIVERED" with 50 of 100 bags delivered
    And a second gate pass was created and approved for the remaining 50 bags
    When the final delivery is recorded
    Then the PO status changes to "DELIVERED"
    And the PO shows 100 of 100 bags delivered
    And the PO is now ready for invoice creation

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: List POs filtered by status
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor lists all approved POs
    Given 5 POs exist: 2 APPROVED, 2 PENDING_APPROVAL, 1 DELIVERED
    When Ravi goes to the PO list and filters by status "APPROVED"
    Then only the 2 approved POs are shown
    And the total count is 2

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Dashboard shows committed amount from approved POs
  # ─────────────────────────────────────────────────────────────────
  Scenario: Dashboard reflects the total committed budget from approved POs
    Given 3 POs are approved with values 50000, 30000, and 20000
    When Ravi views the dashboard
    Then the "Committed Amount" card shows 100000
    And the amount is calculated from all POs with status APPROVED or DELIVERED
