Feature: Attendance and Labour Management
  As a supervisor
  I want to manage staff and labour records, mark daily attendance, and generate attendance reports
  So that I can track who is on site and calculate payroll accurately

  Background:
    Given the logged-in user is "Ravi" with role "SUPERVISOR" in project "Apollo Hospital Chennai"
    And the user has the MANAGE_LABOUR permission

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Add a new company staff member
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor adds a new company engineer to the staff list
    When Ravi goes to "Add Staff" and enters:
      | field       | value           |
      | name        | Rajesh Kumar    |
      | type        | COMPANY         |
      | role        | Site Engineer   |
      | phone       | +919555555555   |
      | baseSalary  | 45000           |
    And clicks "Save"
    Then the staff member is created with type "COMPANY" and active=true
    And they appear in the staff list

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Add a new labour worker
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor adds a new daily wage labour worker
    When Ravi goes to "Add Staff" and enters:
      | field       | value        |
      | name        | Bheem        |
      | type        | LABOUR       |
      | role        | Mason        |
      | baseSalary  | 800          |
    And clicks "Save"
    Then the staff member is created with type "LABOUR"
    And they appear in the labour list (separate from company staff)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Staff type must be COMPANY or LABOUR
  # ─────────────────────────────────────────────────────────────────
  Scenario: Staff creation fails with an invalid type
    When Ravi tries to add staff with type "CONTRACTOR"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says type must be COMPANY or LABOUR

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Mark daily attendance for all workers
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor marks attendance for 10 workers on a given day
    Given 10 staff members exist (5 COMPANY, 5 LABOUR)
    When Ravi goes to "Mark Attendance" for date 2026-08-23
    And marks 8 as present and 2 as absent:
      | staffId    | present | notes        |
      | Staff-1    | true    |              |
      | Staff-2    | true    |              |
      | Staff-3    | false   | Sick leave   |
      | Staff-4    | true    |              |
      | ...        | ...     |              |
    And clicks "Submit Attendance"
    Then the backend saves all attendance records for 2026-08-23
    And each record has the staffId, present status, and notes

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Attendance requires at least one record
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor tries to submit attendance with no records
    When Ravi opens "Mark Attendance" and submits with an empty records list
    Then the backend responds with HTTP 400 Bad Request
    And the error message says at least one record is required

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: View attendance for a specific date range
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor views attendance from Aug 1 to Aug 23
    Given attendance has been marked for 20 days (Aug 1–20)
    When Ravi filters attendance by startDate 2026-08-01 and endDate 2026-08-23
    Then all attendance records in that date range are shown
    And the report shows each worker's total present days and absent days

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Filter staff by type (COMPANY vs LABOUR)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor views only the labour workers
    Given 5 COMPANY staff and 8 LABOUR staff exist
    When Ravi filters the staff list by type "LABOUR"
    Then only the 8 labour workers are shown

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Filter staff by active/inactive status
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor views only active staff
    Given 10 active staff and 3 inactive (left the project) staff exist
    When Ravi filters by active "true"
    Then only the 10 active staff are shown

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Update a staff member's salary
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor updates Rajesh's salary from 45000 to 50000
    Given a staff member "Rajesh Kumar" exists with baseSalary 45000
    When Ravi edits the salary to 50000
    Then the backend updates the baseSalary to 50000

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Deactivate a staff member who left the project
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor deactivates a labour worker who left the site
    Given a labour worker "Bheem" is currently active
    When Ravi toggles Bheem's active status to false
    Then Bheem is marked as inactive
    And Bheem no longer appears in the default staff list (which shows only active)
    And Bheem's historical attendance records are preserved

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Attendance report grouped by type
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head views a monthly attendance summary grouped by COMPANY vs LABOUR
    Given the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    And attendance has been marked for August 2026
    When Nagarjuna views the monthly attendance report
    Then the report shows two sections: "Company Staff" and "Labour"
    And each section shows each worker's total present days, absent days, and attendance percentage
