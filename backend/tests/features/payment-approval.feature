Feature: Payment Approval Workflow — Multi-Step Approval Before Payment
  As a project head or admin
  I want payment requests to go through a multi-step approval process before any money is disbursed
  So that no single person can authorize a payment alone, preventing fraud and errors

  Background:
    Given the project "Apollo Hospital Chennai" is active
    And the approval workflow requires at least 2 distinct approvals from different approver roles
    And the 4 approver roles in order are:
      | step | role                  |
      | 1    | PROJECT_HEAD          |
      | 2    | HEAD_OF_CONSTRUCTION  |
      | 3    | ADMIN                 |
      | 4    | ADMIN_2               |

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Create a payment request from a verified invoice
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a payment request for a verified invoice
    Given a verified invoice "INV-001" exists for vendor "Ultra Cement Supplies" with total 44840
    And the logged-in user is "Ravi" with role "SUPERVISOR"
    When Ravi creates a payment request with:
      | field          | value      |
      | invoiceId      | INV-001    |
      | vendorId       | Ultra Cement Supplies |
      | requestNumber  | PR-001     |
      | amount         | 44840      |
      | paymentMode    | BANK_TRANSFER |
    Then the backend creates the payment request with status "PENDING"
    And a 4-step approval workflow is initiated
    And push notifications are sent to all PROJECT_HEAD users

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Payment request requires a request number
  # ─────────────────────────────────────────────────────────────────
  Scenario: Payment request creation fails without a request number
    When Ravi creates a payment request without a requestNumber
    Then the backend responds with HTTP 400 Bad Request
    And the error message says requestNumber is required

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Payment amount must be positive
  # ─────────────────────────────────────────────────────────────────
  Scenario: Payment request creation fails with a negative amount
    When Ravi creates a payment request with amount -1000
    Then the backend responds with HTTP 400 Bad Request
    And the error message says the amount must be at least 0

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: First approval advances to APPROVAL_1
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head approves the payment (step 1 of 2)
    Given a payment request "PR-001" exists with status "PENDING"
    And the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna approves with comment "Approved for payment"
    And checks the acknowledgement checkbox
    Then the payment status changes to "APPROVAL_1"
    And 1 of 2 required approvals is done
    And push notifications are sent to HEAD_OF_CONSTRUCTION users

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Second approval from a different role → APPROVED
  # ─────────────────────────────────────────────────────────────────
  Scenario: Head of Construction approves the payment (step 2 → fully approved)
    Given payment request "PR-001" has been approved by PROJECT_HEAD (1 of 2 done)
    And the logged-in user is "Suresh" with role "HEAD_OF_CONSTRUCTION"
    When Suresh approves with comment "Approved"
    And checks the acknowledgement checkbox
    Then the payment status changes to "APPROVED"
    And 2 of 2 required approvals are done
    And the payment is now ready to be recorded as paid

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Same person cannot approve both steps
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head tries to approve step 2 (which requires HEAD_OF_CONSTRUCTION)
    Given payment request "PR-001" has been approved by "Nagarjuna" at step 1
    And the logged-in user is still "Nagarjuna"
    When Nagarjuna tries to approve step 2
    Then the backend rejects the request
    And the error message says "Only HEAD_OF_CONSTRUCTION can approve this step"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Wrong role cannot approve
  # ─────────────────────────────────────────────────────────────────
  Scenario: ADMIN tries to approve step 1 (which requires PROJECT_HEAD)
    Given a payment request "PR-002" exists with a pending step 1
    And the logged-in user is "Admin3" with role "ADMIN"
    When Admin3 tries to approve step 1
    Then the backend rejects the request
    And the error message says "Only PROJECT_HEAD can approve this step"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: First rejection does not fully reject
  # ─────────────────────────────────────────────────────────────────
  Scenario: One rejection is not enough to reject the payment
    Given a payment request "PR-003" exists
    And "Nagarjuna" (PROJECT_HEAD) rejects it with reason "Need to verify invoice again"
    Then the payment is NOT fully rejected (1 of 2 required rejections)
    And the payment status stays in its current state

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Two distinct rejections fully reject the payment
  # ─────────────────────────────────────────────────────────────────
  Scenario: Two rejections from different roles fully reject the payment
    Given payment request "PR-003" has been rejected by "Nagarjuna" (PROJECT_HEAD)
    And "Suresh" (HEAD_OF_CONSTRUCTION) rejects it with reason "Agreed, hold the payment"
    Then the payment status changes to "REJECTED"
    And no money can be disbursed for this request
    And the supervisor must create a new payment request if they want to retry

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Cannot approve after rejection
  # ─────────────────────────────────────────────────────────────────
  Scenario: Admin tries to approve a payment that has already been rejected
    Given payment request "PR-003" has been fully rejected
    And the logged-in user is "Admin3" with role "ADMIN"
    When Admin3 tries to approve step 3
    Then the backend rejects the request
    And the error message says "Workflow is already rejected"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Record a payment after approval
  # ─────────────────────────────────────────────────────────────────
  Scenario: Admin records a bank transfer payment for an approved payment request
    Given a payment request "PR-001" has status "APPROVED" with amount 44840
    And the logged-in user is "Admin3" with role "ADMIN"
    When Admin3 records a payment with:
      | field      | value              |
      | amount     | 44840              |
      | mode       | BANK_TRANSFER      |
      | reference  | NEFT-2026-08-23-001 |
    Then the payment status changes to "PAID"
    And the payment record shows the full amount has been paid
    And an audit log entry is created with action "APPROVE"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 12: Partial payment
  # ─────────────────────────────────────────────────────────────────
  Scenario: Admin records a partial payment (first installment)
    Given a payment request "PR-004" has status "APPROVED" with amount 100000
    And the logged-in user is "Admin3" with role "ADMIN"
    When Admin3 records a payment of 50000 via BANK_TRANSFER
    Then the payment status changes to "PARTIALLY_PAID"
    And the remaining balance is 50000
    And a second payment can be recorded later for the remaining amount

  # ─────────────────────────────────────────────────────────────────
  # Scenario 13: Create an expense (non-invoice payment)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a direct expense for site travel costs
    Given the logged-in user is "Ravi" with role "SUPERVISOR"
    When Ravi creates an expense with:
      | field         | value           |
      | description   | Site travel     |
      | amount        | 2000            |
      | category      | TRAVEL          |
      | paymentMode   | CASH            |
    Then the backend creates the expense record
    And the expense appears in the expense report

  # ─────────────────────────────────────────────────────────────────
  # Scenario 14: Approval action requires acknowledgement
  # ─────────────────────────────────────────────────────────────────
  Scenario: Approver tries to approve without checking the acknowledgement
    Given a payment request "PR-001" exists with a pending step 1
    And the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna tries to approve without checking the acknowledgement checkbox
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Acknowledgement is required"
    And the approval is not recorded

  # ─────────────────────────────────────────────────────────────────
  # Scenario 15: Get the full approval state with step history
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head views the full approval history of a payment request
    Given a payment request "PR-001" has been approved by PROJECT_HEAD at step 1
    When Nagarjuna views the approval state
    Then the response includes:
      | step | status    | approverUserId | comments              | decidedAt       |
      | 1    | APPROVED  | Nagarjuna      | Approved for payment  | (timestamp)     |
      | 2    | PENDING   | null           | null                  | null            |
      | 3    | PENDING   | null           | null                  | null            |
      | 4    | PENDING   | null           | null                  | null            |
    And each approved step includes the approver's name and role
