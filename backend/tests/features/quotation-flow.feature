Feature: Quotation Flow — From Vendor Quotation to Approved
  As a supervisor
  I want to create quotations from vendor price lists, get them approved, and convert them to purchase orders
  So that the procurement process is transparent and auditable

  Background:
    Given the logged-in user is "Ravi" with role "SUPERVISOR" in project "Apollo Hospital Chennai"
    And the user has the CREATE_QUOTATION permission
    And a vendor "Ultra Cement Supplies" exists with the following materials:
      | name           | unit | pricePerUnit |
      | OPC Cement 53  | BAG  | 380          |
      | PPC Cement     | BAG  | 350          |

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Create a quotation from a vendor's price list
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a quotation for 100 bags of cement
    Given Ravi is on the "Create Quotation" screen
    When Ravi selects vendor "Ultra Cement Supplies"
    And adds the following line items:
      | materialName   | quantity | unit | unitPrice |
      | OPC Cement 53  | 100      | BAG  | 380       |
    And checks the "I acknowledge this quotation is accurate" checkbox
    And clicks "Submit Quotation"
    Then the backend creates the quotation with status "SUBMITTED"
    And a 4-step approval workflow is automatically initiated with the following approver roles:
      | step | approverRole           |
      | 1    | PROJECT_HEAD           |
      | 2    | HEAD_OF_CONSTRUCTION   |
      | 3    | ADMIN                  |
      | 4    | ADMIN_2                |
    And the workflow requires at least 2 distinct approvals
    And push notifications are sent to all PROJECT_HEAD users in the project

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Quotation creation requires acknowledgement
  # ─────────────────────────────────────────────────────────────────
  Scenario: Quotation creation fails if the acknowledgement checkbox is not checked
    Given Ravi is on the "Create Quotation" screen
    When Ravi selects vendor "Ultra Cement Supplies"
    And adds line items:
      | materialName   | quantity | unitPrice |
      | OPC Cement 53  | 50       | 380       |
    And does NOT check the acknowledgement checkbox
    And clicks "Submit Quotation"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Acknowledgement is required"
    And no quotation or approval workflow is created

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Quotation with items sent as JSON string (multipart form)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Mobile app uploads a quotation with attachments (multipart form with JSON items)
    Given Ravi is on the mobile app's "Scan Quotation" screen
    When Ravi photographs a paper quotation and the OCR extracts the line items
    And the app sends a multipart/form-data request with:
      | field          | value                                                        |
      | vendorId       | (UUID of Ultra Cement Supplies)                              |
      | items          | [{"materialName":"OPC Cement 53","quantity":100,"unitPrice":380}] (as JSON string) |
      | acknowledged   | "true"                                                       |
      | attachment     | quotation-photo.jpg (file)                                   |
    Then the backend parses the JSON string into an items array
    And creates the quotation with 1 line item
    And stores the attachment file

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Quotation with zero line items is rejected
  # ─────────────────────────────────────────────────────────────────
  Scenario: Quotation creation fails when no line items are added
    Given Ravi is on the "Create Quotation" screen
    When Ravi selects vendor "Ultra Cement Supplies" and adds no line items
    And checks the acknowledgement checkbox
    And clicks "Submit Quotation"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "At least one line item is required"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Quotation with materials not supplied by the vendor
  # ─────────────────────────────────────────────────────────────────
  Scenario: Quotation creation fails when a material is not in the vendor's price list
    Given Ravi is on the "Create Quotation" screen
    When Ravi selects vendor "Ultra Cement Supplies"
    And adds a line item for "Steel Rods" (which the vendor does not supply)
    And clicks "Submit Quotation"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Steel Rods is not supplied by this vendor"
    And no quotation is created

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: First approval advances the quotation to APPROVAL_1
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head approves the quotation (first of 2 required approvals)
    Given a quotation "Q-001" exists with status "SUBMITTED" and a pending approval workflow
    And the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna goes to the quotation detail page and clicks "Approve"
    And checks the acknowledgement checkbox
    And enters the comment "Price looks good, approved"
    Then the backend marks step 1 as APPROVED by Nagarjuna
    And the quotation status changes to "APPROVAL_1"
    And the workflow is not yet fully approved (1 of 2 required approvals done)
    And push notifications are sent to HEAD_OF_CONSTRUCTION users for the next step

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Second approval from a different role fully approves the quotation
  # ─────────────────────────────────────────────────────────────────
  Scenario: Head of Construction approves the quotation (second approval → fully approved)
    Given a quotation "Q-001" has been approved by PROJECT_HEAD (1 of 2 approvals done)
    And the logged-in user is "Suresh" with role "HEAD_OF_CONSTRUCTION"
    When Suresh goes to the quotation detail page and clicks "Approve"
    And checks the acknowledgement checkbox
    And enters the comment "Approved for procurement"
    Then the backend marks step 2 as APPROVED by Suresh
    And the quotation status changes to "APPROVED"
    And the workflow is fully approved (2 of 2 required approvals done)
    And the quotation can now be converted into a Purchase Order

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Same person cannot approve twice
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head tries to approve a second step (same person, different step)
    Given a quotation "Q-001" has been approved by "Nagarjuna" (PROJECT_HEAD) at step 1
    And the logged-in user is still "Nagarjuna"
    When Nagarjuna tries to approve step 2 (which requires HEAD_OF_CONSTRUCTION)
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Only HEAD_OF_CONSTRUCTION can approve this step"
    And the quotation status remains "APPROVAL_1" (unchanged)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Wrong role cannot approve a step
  # ─────────────────────────────────────────────────────────────────
  Scenario: ADMIN tries to approve step 1 (which requires PROJECT_HEAD)
    Given a quotation "Q-002" exists with a pending step 1 requiring PROJECT_HEAD
    And the logged-in user is "Admin3" with role "ADMIN"
    When Admin3 tries to approve step 1
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Only PROJECT_HEAD can approve this step"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Rejection requires two distinct rejections
  # ─────────────────────────────────────────────────────────────────
  Scenario: One rejection is not enough — the quotation stays in the current state
    Given a quotation "Q-003" exists with a pending approval workflow
    And the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    When Nagarjuna rejects the quotation with reason "Price too high"
    Then the backend marks step 1 as REJECTED
    But the quotation is NOT fully rejected (only 1 of 2 required rejections)
    And the quotation status remains in its current state (not "REJECTED")

  Scenario: Two distinct rejections from different roles fully reject the quotation
    Given a quotation "Q-003" has been rejected by "Nagarjuna" (PROJECT_HEAD) at step 1
    And the logged-in user is "Suresh" with role "HEAD_OF_CONSTRUCTION"
    When Suresh rejects the quotation with reason "Also rejecting — find a cheaper vendor"
    Then the backend marks step 2 as REJECTED
    And the quotation status changes to "REJECTED"
    And no further approvals or rejections can be made on this quotation
    And the quotation cannot be converted to a Purchase Order

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Cannot approve after the workflow is rejected
  # ─────────────────────────────────────────────────────────────────
  Scenario: Admin tries to approve a quotation that has already been rejected
    Given a quotation "Q-003" has been fully rejected (2 rejections)
    And the logged-in user is "Admin3" with role "ADMIN"
    When Admin3 tries to approve step 3
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Workflow is already rejected"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 12: Convert an approved quotation to a Purchase Order
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor converts an approved quotation into a Purchase Order
    Given a quotation "Q-001" has status "APPROVED"
    And the logged-in user is "Ravi" with role "SUPERVISOR"
    When Ravi goes to the quotation detail page and clicks "Convert to PO"
    And checks the acknowledgement checkbox
    Then the backend creates a new Purchase Order linked to the quotation
    And the quotation status changes to "CONVERTED_TO_PO"
    And the Purchase Order has its own 4-step approval workflow with minApprovers=2
    And push notifications are sent to all PROJECT_HEAD users for PO approval

  # ─────────────────────────────────────────────────────────────────
  # Scenario 13: Cannot convert a non-approved quotation to a PO
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor tries to convert a SUBMITTED (not yet approved) quotation to a PO
    Given a quotation "Q-004" has status "SUBMITTED" (not yet approved)
    And the logged-in user is "Ravi" with role "SUPERVISOR"
    When Ravi clicks "Convert to PO"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Quotation must be APPROVED before converting to a PO"
    And no Purchase Order is created
