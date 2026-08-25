Feature: Vendor Management
  As a supervisor or project head
  I want to create and manage vendors (material suppliers, subcontractors)
  So that I can track who supplies goods and services to the construction project

  Background:
    Given the logged-in user is "Ravi" with role "SUPERVISOR" in project "Apollo Hospital Chennai"
    And the user has the CREATE_VENDOR permission

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Create a new material supplier
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a new material supplier vendor
    Given Ravi is on the "Add Vendor" screen
    When Ravi enters the vendor details:
      | field              | value                    |
      | name               | Ultra Cement Supplies    |
      | contactPersonName  | Mr. Patel                |
      | contactPersonPhone | +919812345678            |
      | category           | MATERIAL_SUPPLIER        |
      | gstNumber          | 27ABCDE1234F1Z5          |
      | phone              | +912266554433            |
      | email              | orders@ultracement.in    |
      | address            | 123 Industrial Estate, Mumbai |
    And Ravi clicks "Save Vendor"
    Then the backend creates the vendor with status "ACTIVE" and rating 0
    And the vendor appears in the vendor list
    And an audit log entry is created with action "CREATE" for entity "VENDOR"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Create a vendor with materials (price list)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a vendor with a list of materials they supply
    Given Ravi is on the "Add Vendor" screen
    When Ravi enters the vendor name "Ultra Cement Supplies"
    And adds the following materials:
      | name           | unit | pricePerUnit |
      | OPC Cement 53  | BAG  | 380          |
      | PPC Cement     | BAG  | 350          |
      | White Cement   | BAG  | 450          |
    And clicks "Save Vendor"
    Then the vendor is created with 3 materials in its price list
    And when Ravi later creates a quotation from this vendor, the materials dropdown shows all 3 items

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Reject a vendor with an empty name
  # ─────────────────────────────────────────────────────────────────
  Scenario: Vendor creation fails when the name is left blank
    Given Ravi is on the "Add Vendor" screen
    When Ravi leaves the vendor name empty and clicks "Save Vendor"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says the name is required
    And no vendor is created in the database

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Reject a vendor with an invalid email
  # ─────────────────────────────────────────────────────────────────
  Scenario: Vendor creation fails when the email is malformed
    Given Ravi is on the "Add Vendor" screen
    When Ravi enters the vendor name "Test Vendor" and email "not-an-email"
    And clicks "Save Vendor"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says the email format is invalid

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Empty string email is accepted (means "no email")
  # ─────────────────────────────────────────────────────────────────
  Scenario: Vendor creation accepts an empty string for email (treated as no email)
    Given Ravi is on the "Add Vendor" screen
    When Ravi enters the vendor name "Local Supplier" and leaves email as an empty string
    And clicks "Save Vendor"
    Then the backend creates the vendor successfully
    And the vendor's email field is stored as an empty string

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Update a vendor's contact details
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor updates a vendor's phone number and contact person
    Given a vendor "Ultra Cement Supplies" exists with phone "+912266554433"
    When Ravi edits the vendor and changes the phone to "+912277889900"
    And changes the contact person to "Mr. Shah"
    And clicks "Save Changes"
    Then the backend updates the vendor record
    And an audit log entry is created with action "UPDATE" containing both the old and new values
    And the vendor list shows the updated phone number

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: List vendors with search and pagination
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor searches for a vendor by name and paginates the results
    Given 25 vendors exist in project "Apollo Hospital Chennai"
    And 3 of them have "cement" in their name
    When Ravi goes to the vendor list and types "cement" in the search box
    Then the backend returns only the 3 vendors matching "cement"
    And the results are paginated with page 1 and pageSize 20
    And the total count is 3

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Blacklist a vendor who delivered poor-quality materials
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head blacklists a vendor after repeated quality issues
    Given the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    And a vendor "Bad Quality Bricks" exists with status "ACTIVE"
    When Nagarjuna goes to the vendor detail page and clicks "Blacklist"
    And confirms the blacklisting
    Then the backend updates the vendor status to "BLACKLISTED"
    And an audit log entry is created with action "UPDATE"
    And the vendor can no longer be selected when creating new quotations or POs
    And the vendor appears with a red "BLACKLISTED" badge in the vendor list

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Reactivate an inactive vendor
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head reactivates a previously inactive vendor
    Given a vendor "Old Supplier" exists with status "INACTIVE"
    When the Project Head changes the vendor status to "ACTIVE"
    Then the vendor is available again for new quotations and POs
    And an audit log entry records the status change

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Vendor rating is clamped to 0–5
  # ─────────────────────────────────────────────────────────────────
  Scenario: Vendor creation rejects a rating above 5
    Given Ravi is on the "Add Vendor" screen
    When Ravi enters the vendor name "Test" and rating 6
    And clicks "Save Vendor"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says the rating must be between 0 and 5

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Pagination is capped at 100 per page
  # ─────────────────────────────────────────────────────────────────
  Scenario: Malicious client requests pageSize=99999 to overload the server
    When a request is made to "/api/vendors?pageSize=99999"
    Then the backend responds with HTTP 400 Bad Request
    And the error message says pageSize must be at most 100
    And the server does not load all vendors at once
