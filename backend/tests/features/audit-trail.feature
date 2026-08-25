Feature: Audit Trail — Tracking Every Action
  As a project head or auditor
  I want every create, update, delete, approve, and reject action to be logged with who did it and when
  So that there is a complete trail of accountability for every change in the system

  Background:
    Given the project "Apollo Hospital Chennai" is active
    And the audit log service is running

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Creating a vendor logs a CREATE action
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a vendor — an audit log entry is created
    Given the logged-in user is "Ravi" with id "user-1"
    When Ravi creates a vendor "Ultra Cement Supplies"
    Then an audit log entry is created with:
      | field       | value                    |
      | userId      | user-1                   |
      | action      | CREATE                   |
      | entityType  | VENDOR                   |
      | entityId    | (the new vendor's ID)    |
      | projectId   | Apollo Hospital Chennai  |
      | newValue    | {name: "Ultra Cement Supplies", status: "ACTIVE"} |
      | timestamp   | (current timestamp)      |

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Updating a vendor logs an UPDATE action with old and new values
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor updates a vendor's phone — audit log captures old and new values
    Given a vendor "Ultra Cement Supplies" exists with phone "+912266554433"
    And the logged-in user is "Ravi" with id "user-1"
    When Ravi changes the phone to "+912277889900"
    Then an audit log entry is created with:
      | field       | value                    |
      | userId      | user-1                   |
      | action      | UPDATE                   |
      | entityType  | VENDOR                   |
      | oldValue    | {phone: "+912266554433"} |
      | newValue    | {phone: "+912277889900"} |
    And the old value is preserved so an auditor can see what changed

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Deleting a vendor logs a DELETE action
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head deletes a vendor — audit log records the deletion
    Given the logged-in user is "Nagarjuna" with id "user-2"
    And a vendor "Old Vendor" exists
    When Nagarjuna deletes the vendor
    Then an audit log entry is created with action "DELETE" and entityType "VENDOR"
    And the entityId points to the deleted vendor

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Approving a payment logs an APPROVE action
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head approves a payment — audit log records the approval
    Given the logged-in user is "Nagarjuna" with id "user-2"
    When Nagarjuna approves a payment request "PR-001"
    Then an audit log entry is created with:
      | field       | value            |
      | userId      | user-2           |
      | action      | APPROVE          |
      | entityType  | PAYMENT_REQUEST  |
      | entityId    | PR-001           |

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Rejecting a payment logs a REJECT action
  # ─────────────────────────────────────────────────────────────────
  Scenario: Head of Construction rejects a payment — audit log records the rejection
    Given the logged-in user is "Suresh" with id "user-3"
    When Suresh rejects a payment request "PR-002"
    Then an audit log entry is created with action "REJECT" and entityType "PAYMENT_REQUEST"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Audit log entries include the correct timestamp
  # ─────────────────────────────────────────────────────────────────
  Scenario: Audit log entry timestamp is the current time
    Given the current time is "2026-08-23T14:30:00Z"
    When any audited action is performed
    Then the audit log entry's timestamp is within 1 second of the current time
    And the timestamp can be used to reconstruct the exact sequence of events

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: View audit logs filtered by project
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head views all audit logs for "Apollo Hospital Chennai"
    Given 50 audit log entries exist: 30 for "Apollo Hospital Chennai" and 20 for "City Hospital Mumbai"
    And the logged-in user is "Nagarjuna" in project "Apollo Hospital Chennai"
    When Nagarjuna goes to the Audit Log page
    Then only the 30 entries for "Apollo Hospital Chennai" are shown
    And the 20 entries for "City Hospital Mumbai" are NOT visible (project isolation)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: View audit logs filtered by entity type
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head filters audit logs to see only VENDOR-related changes
    Given audit log entries exist for VENDOR, QUOTATION, PO, INVOICE, and PAYMENT_REQUEST
    When Nagarjuna filters by entityType "VENDOR"
    Then only VENDOR-related audit entries are shown

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Audit logs are paginated
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head views the second page of audit logs
    Given 25 audit log entries exist for the project
    When Nagarjuna requests page 2 with pageSize 10
    Then entries 11–20 are shown
    And the pagination metadata shows total=25, page=2, pageSize=10

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Audit logs include the user's name and role
  # ─────────────────────────────────────────────────────────────────
  Scenario: Auditor views an audit log entry and sees who performed the action
    Given an audit log entry was created by "Ravi" (SUPERVISOR)
    When the auditor views the entry
    Then the entry shows:
      | field    | value     |
      | userName | Ravi      |
      | userRole | SUPERVISOR |
    And the auditor can see exactly who made the change and what their role was
