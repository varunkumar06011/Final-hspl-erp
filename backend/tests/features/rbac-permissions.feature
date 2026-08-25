Feature: Role-Based Access Control (RBAC) — Who Can Do What
  As the system administrator
  I want each role to have a specific set of permissions
  So that users can only perform actions appropriate to their role (least privilege)

  Background:
    Given the project "Apollo Hospital Chennai" has the following users:
      | name       | role                  | active |
      | Ravi       | SUPERVISOR            | true   |
      | Nagarjuna  | PROJECT_HEAD          | true   |
      | Suresh     | HEAD_OF_CONSTRUCTION  | true   |
      | Admin3     | ADMIN                 | true   |
      | Admin4     | ADMIN_2               | true   |

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: SUPERVISOR can create vendors and quotations
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor tries to create a vendor — allowed
    Given the logged-in user is "Ravi" with role "SUPERVISOR"
    When Ravi calls POST /api/vendors
    Then the RBAC middleware allows the request (calls next())
    And the request reaches the vendor controller

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: SUPERVISOR cannot manage users
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor tries to access user management — denied
    Given the logged-in user is "Ravi" with role "SUPERVISOR"
    When Ravi calls GET /api/auth/users
    Then the RBAC middleware blocks the request with HTTP 403 Forbidden
    And the error message says "Insufficient permissions"
    And the request does not reach the user controller

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: PROJECT_HEAD can manage users
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head tries to access user management — allowed
    Given the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna calls GET /api/auth/users
    Then the RBAC middleware allows the request

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Only PROJECT_HEAD and ADMIN can approve payment step 1
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head tries to approve payment step 1 — allowed
    Given the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna tries to approve at step 1
    Then the RBAC middleware allows the request

  Scenario: Admin tries to approve payment step 1 — allowed
    Given the logged-in user is "Admin3" with role "ADMIN"
    When Admin3 tries to approve at step 1
    Then the RBAC middleware allows the request

  Scenario: Head of Construction tries to approve payment step 1 — denied
    Given the logged-in user is "Suresh" with role "HEAD_OF_CONSTRUCTION"
    When Suresh tries to approve at step 1
    Then the RBAC middleware blocks the request with HTTP 403

  Scenario: Admin_2 tries to approve payment step 1 — denied
    Given the logged-in user is "Admin4" with role "ADMIN_2"
    When Admin4 tries to approve at step 1
    Then the RBAC middleware blocks the request with HTTP 403

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Only HEAD_OF_CONSTRUCTION and ADMIN_2 can approve step 2
  # ─────────────────────────────────────────────────────────────────
  Scenario: Head of Construction tries to approve payment step 2 — allowed
    Given the logged-in user is "Suresh" with role "HEAD_OF_CONSTRUCTION"
    When Suresh tries to approve at step 2
    Then the RBAC middleware allows the request

  Scenario: Admin_2 tries to approve payment step 2 — allowed
    Given the logged-in user is "Admin4" with role "ADMIN_2"
    When Admin4 tries to approve at step 2
    Then the RBAC middleware allows the request

  Scenario: Admin tries to approve payment step 2 — denied
    Given the logged-in user is "Admin3" with role "ADMIN"
    When Admin3 tries to approve at step 2
    Then the RBAC middleware blocks the request with HTTP 403

  Scenario: Project Head tries to approve payment step 2 — denied
    Given the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna tries to approve at step 2
    Then the RBAC middleware blocks the request with HTTP 403

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Only PROJECT_HEAD can edit the budget
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head tries to edit the project budget — allowed
    Given the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna tries to edit the budget
    Then the RBAC middleware allows the request

  Scenario: Admin tries to edit the project budget — denied
    Given the logged-in user is "Admin3" with role "ADMIN"
    When Admin3 tries to edit the budget
    Then the RBAC middleware blocks the request with HTTP 403

  Scenario: Head of Construction tries to edit the project budget — denied
    Given the logged-in user is "Suresh" with role "HEAD_OF_CONSTRUCTION"
    When Suresh tries to edit the budget
    Then the RBAC middleware blocks the request with HTTP 403

  Scenario: Admin_2 tries to edit the project budget — denied
    Given the logged-in user is "Admin4" with role "ADMIN_2"
    When Admin4 tries to edit the budget
    Then the RBAC middleware blocks the request with HTTP 403

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Every role can view financials (scoped to their project)
  # ─────────────────────────────────────────────────────────────────
  Scenario: All five roles can view the financial dashboard
    Given the project has users with all 5 roles
    When each user tries to view the financial dashboard
    Then all five are allowed (RBAC passes)
    But each user only sees data for their own project (enforced at the service layer)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: MANAGE_USERS is available to the four heads but not Supervisors
  # ─────────────────────────────────────────────────────────────────
  Scenario: Permission matrix — MANAGE_USERS
    Given the permission matrix is defined
    Then "SUPERVISOR" does NOT have MANAGE_USERS
    And "PROJECT_HEAD" has MANAGE_USERS
    And "HEAD_OF_CONSTRUCTION" has MANAGE_USERS
    And "ADMIN" has MANAGE_USERS
    And "ADMIN_2" has MANAGE_USERS

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Unauthenticated request gets 401
  # ─────────────────────────────────────────────────────────────────
  Scenario: No user attached to the request — RBAC returns 401
    Given the request has no authenticated user (req.user is undefined)
    When the RBAC middleware checks any permission
    Then the middleware responds with HTTP 401 Unauthorized
    And the error message says "Authentication required"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: All roles can create gate passes and manage inventory
  # ─────────────────────────────────────────────────────────────────
  Scenario: All five roles can create gate passes
    Given the project has users with all 5 roles
    When each user tries to create a gate pass
    Then all five are allowed (CREATE_GATE_PASS is granted to every role)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: All roles can view the audit log
  # ─────────────────────────────────────────────────────────────────
  Scenario: All five roles can view the audit log (for their own project)
    Given the project has users with all 5 roles
    When each user tries to view the audit log
    Then all five are allowed (VIEW_AUDIT_LOG is granted to every role)
    But each user only sees audit entries for their own project
