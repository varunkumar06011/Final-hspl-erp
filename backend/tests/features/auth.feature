Feature: Authentication and User Management
  As a hospital construction ERP user
  I want to securely log in and manage my account
  So that only authorized people can access project data

  Background:
    Given the Hospital Construction ERP backend is running
    And Firebase phone authentication is configured

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: First-time login by a pre-provisioned user
  # ─────────────────────────────────────────────────────────────────
  Scenario: Pre-provisioned user logs in for the first time with Firebase OTP
    Given a user named "Ravi Kumar" with phone "+919876543210" has been pre-provisioned by the Project Head
    And the user's role is "SUPERVISOR" in project "Apollo Hospital Chennai"
    And the user's account is active
    When Ravi opens the mobile app and enters his phone number "+919876543210"
    And Firebase sends an OTP to Ravi's phone
    And Ravi enters the correct OTP
    Then Firebase verifies the OTP and issues an ID token
    When the app sends the ID token to the backend for verification
    Then the backend finds Ravi's pre-provisioned account
    And the backend responds with HTTP 200 and Ravi's profile including:
      | field      | value                    |
      | name       | Ravi Kumar               |
      | phone      | +919876543210            |
      | role       | SUPERVISOR               |
      | projectId  | Apollo Hospital Chennai  |
      | isActive   | true                     |
    And the app navigates Ravi to the Supervisor dashboard

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Unregistered phone number tries to log in
  # ─────────────────────────────────────────────────────────────────
  Scenario: Stranger with an unregistered phone number cannot log in
    Given no user account exists for phone "+919999999999"
    When a stranger opens the app and enters "+919999999999"
    And Firebase sends an OTP and the stranger enters it correctly
    When the app sends the ID token to the backend
    Then the backend responds with HTTP 403 Forbidden
    And the error message says "Not authorized — contact your Project Head to be added"
    And no new user account is created in the database
    And the stranger cannot access any project data

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Inactive user tries to log in
  # ─────────────────────────────────────────────────────────────────
  Scenario: Deactivated user (e.g. an ex-employee) cannot log in
    Given a user named "Old Employee" with phone "+918888888888" exists
    And the user's account has been deactivated by the Project Head
    When the ex-employee opens the app and enters "+918888888888"
    And Firebase verifies the OTP
    When the app sends the ID token to the backend
    Then the backend responds with HTTP 403 Forbidden
    And the error message says "Your account is inactive — contact your Project Head"
    And the ex-employee cannot see any project data

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Invalid/expired Firebase token
  # ─────────────────────────────────────────────────────────────────
  Scenario: App sends an expired Firebase token
    Given a user named "Test User" with phone "+919000000001" exists and is active
    When the app sends an expired Firebase ID token to the backend
    Then the backend responds with HTTP 401 Unauthorized
    And the error message says "Invalid or expired token"
    And the app shows the login screen again

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: No token sent at all
  # ─────────────────────────────────────────────────────────────────
  Scenario: API endpoint is called without any authorization header
    When a request is made to "/api/vendors" without an Authorization header
    Then the backend responds with HTTP 401 Unauthorized
    And the error message says "No authorization header provided"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Self-registration of a new Supervisor
  # ─────────────────────────────────────────────────────────────────
  Scenario: New worker self-registers as a Supervisor after Firebase phone verification
    Given the project "Apollo Hospital Chennai" is currently active
    And no user account exists for phone "+919111111111"
    When the worker opens the app and enters "+919111111111"
    And Firebase verifies the OTP and issues an ID token
    And the worker enters their name "New Supervisor" and submits the registration form
    When the app sends the ID token and name to the backend's self-registration endpoint
    Then the backend creates a new user account with:
      | field      | value            |
      | phone      | +919111111111    |
      | name       | New Supervisor   |
      | role       | SUPERVISOR       |
      | projectId  | Apollo Hospital Chennai |
      | isActive   | true             |
    And the backend responds with HTTP 201 Created
    And the new Supervisor can now log in and see the Supervisor dashboard

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: PIN login (fallback when Firebase OTP is down)
  # ─────────────────────────────────────────────────────────────────
  Scenario: User logs in with phone + PIN when Firebase OTP service is down
    Given a user named "Priya" with phone "+919222222222" has set a 4-digit PIN "4821"
    And Firebase OTP service is temporarily unavailable
    When Priya opens the app and the app detects Firebase OTP is down
    Then the app shows the PIN login screen
    When Priya enters her phone "+919222222222" and PIN "4821"
    Then the backend verifies the PIN against the database
    And the backend responds with HTTP 200 and Priya's profile
    And Priya is logged in and can see her dashboard

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Wrong PIN during PIN login
  # ─────────────────────────────────────────────────────────────────
  Scenario: User enters the wrong PIN during PIN login
    Given a user named "Priya" with phone "+919222222222" has set a 4-digit PIN "4821"
    When Priya enters her phone "+919222222222" and PIN "9999"
    Then the backend responds with HTTP 401 Unauthorized
    And the error message says "Invalid PIN"
    And Priya is not logged in

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Setting a PIN for the first time
  # ─────────────────────────────────────────────────────────────────
  Scenario: User sets a 4-digit PIN after successful Firebase OTP verification
    Given a user named "New User" with phone "+919333333333" has logged in via Firebase OTP
    And the user has not set a PIN yet
    When the user goes to Settings and enters a new PIN "5678"
    And confirms the PIN by entering "5678" again
    Then the backend stores the hashed PIN against the user's account
    And the user can now use PIN login as a fallback in the future

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Changing the PIN
  # ─────────────────────────────────────────────────────────────────
  Scenario: User changes their PIN from the settings screen
    Given a user named "Priya" has an existing PIN "4821"
    When Priya goes to Settings → Change PIN
    And enters her old PIN "4821"
    And enters her new PIN "9101"
    Then the backend verifies the old PIN matches
    And the backend updates the PIN to "9101"
    And the old PIN "4821" no longer works for PIN login

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Changing PIN with wrong old PIN
  # ─────────────────────────────────────────────────────────────────
  Scenario: User enters the wrong old PIN when trying to change their PIN
    Given a user named "Priya" has an existing PIN "4821"
    When Priya goes to Settings → Change PIN
    And enters the wrong old PIN "0000"
    And enters a new PIN "9101"
    Then the backend responds with HTTP 401 Unauthorized
    And the error message says "Old PIN is incorrect"
    And the PIN remains "4821" (unchanged)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 12: Project Head creates a new pre-provisioned user
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head pre-provisions a new ADMIN user before they join
    Given the logged-in user is "Nagarjuna" with role "PROJECT_HEAD" in project "Apollo Hospital Chennai"
    When Nagarjuna goes to User Management → Add User
    And enters the new user's details:
      | field      | value             |
      | name       | Suresh            |
      | phone      | +919444444444     |
      | role       | ADMIN             |
      | projectId  | Apollo Hospital Chennai |
    Then the backend creates a new user account with isActive=true
    And the new user appears in the user list
    When Suresh later opens the app and logs in via Firebase OTP with "+919444444444"
    Then Suresh is matched to the pre-provisioned account and gets the ADMIN role

  # ─────────────────────────────────────────────────────────────────
  # Scenario 13: Preventing duplicate privileged role assignment
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head cannot assign PROJECT_HEAD role to a second person in the same project
    Given the project "Apollo Hospital Chennai" already has an active user with role "PROJECT_HEAD"
    And the logged-in user is "Nagarjuna" (the current PROJECT_HEAD)
    When Nagarjuna tries to promote another user "Suresh" to "PROJECT_HEAD"
    Then the backend responds with HTTP 409 Conflict
    And the error message says "An active PROJECT_HEAD already exists for this project"
    And Suresh's role is not changed

  # ─────────────────────────────────────────────────────────────────
  # Scenario 14: Deactivating a user (e.g. employee left the company)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Project Head deactivates a user who has left the company
    Given the logged-in user is "Nagarjuna" with role "PROJECT_HEAD"
    And a user "Old Employee" with phone "+918888888888" is currently active
    When Nagarjuna goes to User Management and toggles "Old Employee" to inactive
    Then the backend sets isActive=false for that user
    And "Old Employee" can no longer log in (gets 403 on next login attempt)
    And "Old Employee" no longer receives push notifications
