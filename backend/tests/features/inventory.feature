Feature: Inventory Management — Stock Tracking
  As a supervisor
  I want to track stock levels of materials, record stock in/out transactions, and get alerts when stock is low
  So that the project never runs out of critical materials

  Background:
    Given the logged-in user is "Ravi" with role "SUPERVISOR" in project "Apollo Hospital Chennai"
    And the user has the MANAGE_INVENTORY permission

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Create a new inventory item
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a new inventory item for cement
    When Ravi goes to "Add Inventory Item" and enters:
      | field          | value       |
      | name           | OPC Cement  |
      | unit           | BAG         |
      | currentStock   | 0           |
      | minStockLevel  | 50          |
      | location       | Store Room A |
    And clicks "Save"
    Then the backend creates the inventory item with currentStock 0 and minStockLevel 50
    And the item appears in the inventory list

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Inventory item requires a unit
  # ─────────────────────────────────────────────────────────────────
  Scenario: Inventory item creation fails without a unit
    When Ravi enters a name "Sand" but no unit
    Then the backend responds with HTTP 400 Bad Request
    And the error message says unit is required

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Record a stock-IN transaction (materials received)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor records 100 bags of cement received from a delivery
    Given an inventory item "OPC Cement" exists with currentStock 0
    When Ravi records an IN transaction:
      | field      | value |
      | itemId     | OPC Cement |
      | type       | IN    |
      | quantity   | 100   |
      | notes      | Received from PO-001 |
    Then the backend updates the currentStock to 100
    And the transaction is logged in the inventory transaction history

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Record a stock-OUT transaction (materials used on site)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor records 30 bags of cement used for the foundation pour
    Given an inventory item "OPC Cement" exists with currentStock 100
    When Ravi records an OUT transaction with quantity 30
    Then the backend updates the currentStock to 70
    And the transaction is logged

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Record a stock-ADJUST transaction (correction after physical count)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor adjusts stock after a physical count reveals a discrepancy
    Given an inventory item "OPC Cement" shows currentStock 70 in the system
    But a physical count shows only 65 bags
    When Ravi records an ADJUST transaction with quantity -5
    Then the backend updates the currentStock to 65
    And the transaction notes should explain the adjustment reason

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Zero-quantity transaction is rejected
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor tries to record a transaction with quantity 0
    When Ravi tries to record an IN transaction with quantity 0
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Quantity cannot be zero"
    And no stock change is made

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Invalid transaction type is rejected
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor tries to record a transaction with an invalid type
    When Ravi tries to record a transaction with type "TRANSFER"
    Then the backend responds with HTTP 400 Bad Request
    And the error message indicates the type must be IN, OUT, or ADJUST

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Low stock alert
  # ─────────────────────────────────────────────────────────────────
  Scenario: Stock drops below the minimum level — item is flagged as low stock
    Given an inventory item "OPC Cement" has currentStock 45 and minStockLevel 50
    When the stock drops to 45 (after an OUT transaction)
    Then the item is flagged as "below minimum stock level" in the inventory list
    And the frontend shows a warning badge next to the item

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Search inventory by name
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor searches for "cement" in the inventory list
    Given 10 inventory items exist, 3 with "cement" in the name
    When Ravi types "cement" in the search box
    Then only the 3 matching items are shown

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Filter inventory by category
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor filters inventory by category "Electrical"
    Given inventory items exist in categories "Cement", "Electrical", "Plumbing"
    When Ravi filters by category "Electrical"
    Then only electrical items are shown

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: View transaction history for an item
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor views the full transaction history for "OPC Cement"
    Given "OPC Cement" has had 5 transactions (2 IN, 2 OUT, 1 ADJUST)
    When Ravi views the transaction history for the item
    Then all 5 transactions are listed in chronological order
    And each transaction shows the type, quantity, notes, and timestamp
