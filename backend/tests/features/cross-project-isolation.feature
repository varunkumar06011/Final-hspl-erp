Feature: Cross-Project Isolation — Users Can Only See Their Own Project's Data
  As the system administrator
  I want users to only see and modify data for the project they're assigned to
  So that Hospital A's staff cannot see Hospital B's vendors, quotations, POs, or payments

  Background:
    Given two projects exist:
      | project                  | users                          |
      | Apollo Hospital Chennai  | Ravi (SUPERVISOR), Nagarjuna (PROJECT_HEAD) |
      | City Hospital Mumbai     | Karan (SUPERVISOR), Vikram (PROJECT_HEAD)   |

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: User in Project A cannot list Project B's vendors
  # ─────────────────────────────────────────────────────────────────
  Scenario: Ravi (Apollo Chennai) tries to list vendors — only sees Apollo's vendors
    Given the logged-in user is "Ravi" with projectId "Apollo Hospital Chennai"
    And "Apollo Hospital Chennai" has 5 vendors
    And "City Hospital Mumbai" has 3 vendors
    When Ravi calls GET /api/vendors
    Then the backend filters by Ravi's projectId
    And only the 5 Apollo vendors are returned
    And the 3 City Hospital vendors are NOT visible

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: User in Project A cannot create a vendor in Project B
  # ─────────────────────────────────────────────────────────────────
  Scenario: Ravi tries to create a vendor with a different projectId in the body
    Given the logged-in user is "Ravi" with projectId "Apollo Hospital Chennai"
    When Ravi sends a POST /api/vendors request with body.projectId = "City Hospital Mumbai"
    Then the backend ignores the body.projectId
    And uses Ravi's authenticated projectId ("Apollo Hospital Chennai") instead
    And the vendor is created under "Apollo Hospital Chennai"
    And no vendor is created under "City Hospital Mumbai"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: User in Project A cannot view Project B's payment requests
  # ─────────────────────────────────────────────────────────────────
  Scenario: Ravi tries to view a payment request that belongs to City Hospital Mumbai
    Given a payment request "PR-Mumbai-001" exists in "City Hospital Mumbai"
    And the logged-in user is "Ravi" with projectId "Apollo Hospital Chennai"
    When Ravi calls GET /api/payments/PR-Mumbai-001
    Then the backend filters by Ravi's projectId
    And the payment request is not found (404)
    And Ravi cannot see any details about City Hospital's payments

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: User in Project A cannot approve Project B's workflows
  # ─────────────────────────────────────────────────────────────────
  Scenario: Nagarjuna (Apollo) tries to approve a quotation from City Hospital Mumbai
    Given a quotation "Q-Mumbai-001" exists in "City Hospital Mumbai"
    And the logged-in user is "Nagarjuna" with projectId "Apollo Hospital Chennai"
    When Nagarjuna tries to approve "Q-Mumbai-001"
    Then the backend rejects the request (the quotation is not in Nagarjuna's project)
    And Nagarjuna cannot affect City Hospital's approval workflow

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Audit logs are project-scoped
  # ─────────────────────────────────────────────────────────────────
  Scenario: Ravi views audit logs — only sees Apollo's entries
    Given 30 audit entries exist for "Apollo Hospital Chennai"
    And 20 audit entries exist for "City Hospital Mumbai"
    And the logged-in user is "Ravi" with projectId "Apollo Hospital Chennai"
    When Ravi calls GET /api/audit
    Then only the 30 Apollo entries are returned
    And the 20 City Hospital entries are NOT visible

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Dashboard data is project-scoped
  # ─────────────────────────────────────────────────────────────────
  Scenario: Ravi views the dashboard — only sees Apollo's financials
    Given "Apollo Hospital Chennai" has committed 500000 in POs
    And "City Hospital Mumbai" has committed 800000 in POs
    And the logged-in user is "Ravi" with projectId "Apollo Hospital Chennai"
    When Ravi views the dashboard
    Then the committed amount shows 500000 (Apollo's POs only)
    And City Hospital's 800000 is NOT included

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Push notifications are project-scoped
  # ─────────────────────────────────────────────────────────────────
  Scenario: Payment request in Apollo triggers push only to Apollo's approvers
    Given "Nagarjuna" (PROJECT_HEAD, Apollo) has a registered device
    And "Vikram" (PROJECT_HEAD, City Hospital) has a registered device
    When a payment request is created in "Apollo Hospital Chennai"
    Then a push notification is sent to Nagarjuna's device
    But NO push notification is sent to Vikram's device
    Because Vikram is in a different project

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Service layer must never accept projectId from the request body
  # ─────────────────────────────────────────────────────────────────
  Scenario: Contract — no service should read projectId from req.body or req.query
    Given the codebase follows the project isolation contract
    Then every service query must use req.user.projectId (from the authenticated session)
    And no service should accept projectId from req.body or req.query
    And this prevents a Project A user from creating entities under Project B

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Inventory is project-scoped
  # ─────────────────────────────────────────────────────────────────
  Scenario: Ravi lists inventory — only sees Apollo's items
    Given "Apollo Hospital Chennai" has 10 inventory items
    And "City Hospital Mumbai" has 7 inventory items
    And the logged-in user is "Ravi" with projectId "Apollo Hospital Chennai"
    When Ravi calls GET /api/inventory
    Then only the 10 Apollo items are returned

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Gate passes are project-scoped
  # ─────────────────────────────────────────────────────────────────
  Scenario: Ravi tries to view a gate pass from City Hospital Mumbai
    Given a gate pass "GP-Mumbai-001" exists in "City Hospital Mumbai"
    And the logged-in user is "Ravi" with projectId "Apollo Hospital Chennai"
    When Ravi calls GET /api/gate-passes/GP-Mumbai-001
    Then the backend returns 404 Not Found
    And Ravi cannot see City Hospital's gate pass details or OTPs

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: A user with projectId=null (platform admin) — special case
  # ─────────────────────────────────────────────────────────────────
  Scenario: Platform admin with no project assignment tries to list vendors
    Given the logged-in user is "SuperAdmin" with role "ADMIN" and projectId=null
    When SuperAdmin calls GET /api/vendors
    Then the backend returns an empty list (no project to filter by)
    And SuperAdmin must be assigned to a specific project to see its data
