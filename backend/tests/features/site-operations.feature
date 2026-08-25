Feature: Site Operations — Photos, Issues, and Inspections
  As a supervisor
  I want to upload site photos, raise issues, and conduct inspections
  So that the construction progress is documented and quality problems are caught early

  Background:
    Given the logged-in user is "Ravi" with role "SUPERVISOR" in project "Apollo Hospital Chennai"

  # ═══════════════════════════════════════════════════════════════
  # SITE PHOTOS
  # ═══════════════════════════════════════════════════════════════

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Upload a "BEFORE" photo before starting work
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor uploads a "BEFORE" photo of the excavation site
    Given a phase "Foundation" exists
    When Ravi goes to "Upload Photo" and selects:
      | field      | value       |
      | phaseId    | Foundation  |
      | tag        | BEFORE      |
      | caption    | Excavation site before foundation work |
      | imageUrl   | (uploaded file path) |
    And clicks "Upload"
    Then the photo is saved with tag "BEFORE" and linked to the Foundation phase
    And the photo appears in the phase's photo gallery under the "Before" tab

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Upload a "DURING" photo showing progress
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor uploads a "DURING" photo of the foundation pour
    When Ravi uploads a photo with tag "DURING" and caption "Pouring concrete"
    Then the photo is saved with tag "DURING"
    And it appears in the "During" tab of the photo gallery

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Upload an "AFTER" photo showing completed work
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor uploads an "AFTER" photo of the completed foundation
    When Ravi uploads a photo with tag "AFTER" and caption "Foundation complete"
    Then the photo is saved with tag "AFTER"
    And the before/during/after photos can be viewed side by side

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Filter photos by tag
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head views all "BEFORE" photos for the project
    Given 15 photos exist: 5 BEFORE, 7 DURING, 3 AFTER
    When the Project Head filters photos by tag "BEFORE"
    Then only the 5 BEFORE photos are shown

  # ═══════════════════════════════════════════════════════════════
  # ISSUES
  # ═══════════════════════════════════════════════════════════════

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Raise a quality issue
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor raises a CRITICAL quality issue about cracked cement
    When Ravi goes to "Raise Issue" and enters:
      | field       | value                    |
      | category    | QUALITY                  |
      | severity    | CRITICAL                 |
      | title       | Cracked cement in foundation |
      | description | Large cracks visible after curing |
      | addressTo   | Nagarjuna (PROJECT_HEAD), Suresh (HEAD_OF_CONSTRUCTION) |
    And clicks "Submit"
    Then the issue is created with status "OPEN" and severity "CRITICAL"
    And push notifications are sent to Nagarjuna and Suresh
    And the issue appears in their "Issues Addressed To Me" list

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Issue requires at least one addressee
  # ─────────────────────────────────────────────────────────────────
  Scenario: Issue creation fails when no one is selected as "address to"
    When Ravi tries to create an issue with an empty addressTo list
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Select at least one person to address to"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Issue severity defaults to MEDIUM
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates an issue without selecting a severity
    When Ravi creates an issue without specifying severity
    Then the issue is created with severity "MEDIUM"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Update an issue's severity (escalate from MEDIUM to HIGH)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head escalates an issue from MEDIUM to HIGH severity
    Given an issue "ISS-001" exists with severity "MEDIUM"
    And the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna changes the severity to "HIGH"
    Then the issue severity is updated to "HIGH"
    And an audit log entry records the change

  # ═══════════════════════════════════════════════════════════════
  # INSPECTIONS
  # ═══════════════════════════════════════════════════════════════

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Schedule an inspection
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor schedules a slab inspection for next week
    When Ravi goes to "Schedule Inspection" and enters:
      | field          | value              |
      | name           | First floor slab inspection |
      | scheduledDate  | 2026-08-30         |
    And clicks "Schedule"
    Then the inspection is created with status "SCHEDULED"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Conduct an inspection with a checklist
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor conducts the slab inspection and fills the checklist
    Given an inspection "INS-001" exists with status "SCHEDULED"
    When Ravi opens the inspection and fills the checklist:
      | item                     | result |
      | Rebar spacing correct    | PASS   |
      | Concrete cover adequate  | PASS   |
      | Formwork plumb           | FAIL   |
      | Curing started           | N/A    |
    And enters defects:
      | description              | severity |
      | Formwork not plumb       | HIGH     |
    And enters corrective action "Realign formwork before next pour"
    And marks the inspection status as "DEFECTS_FOUND"
    Then the inspection is saved with the checklist, defects, and corrective action
    And the status changes to "DEFECTS_FOUND"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Inspection passes with no defects
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor conducts an inspection and everything passes
    Given an inspection "INS-002" exists with status "SCHEDULED"
    When Ravi fills the checklist with all PASS results
    And marks the status as "PASSED"
    Then the inspection status changes to "PASSED"
    And no defects are recorded

  # ─────────────────────────────────────────────────────────────────
  # Scenario 12: Re-inspection after corrective action
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor re-inspects after the formwork was fixed
    Given an inspection "INS-001" had status "DEFECTS_FOUND"
    And the corrective action was completed
    When Ravi re-inspects and the formwork is now plumb
    And marks the checklist item "Formwork plumb" as PASS
    And changes the status to "PASSED"
    Then the inspection status changes to "PASSED"
    And the phase can proceed to the next activity

  # ─────────────────────────────────────────────────────────────────
  # Scenario 13: List inspections filtered by status
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor lists all scheduled inspections
    Given 5 inspections exist: 2 SCHEDULED, 2 PASSED, 1 FAILED
    When Ravi filters by status "SCHEDULED"
    Then only the 2 scheduled inspections are shown
