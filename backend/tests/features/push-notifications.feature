Feature: Push Notifications — Approval Request Alerts
  As an approver (Project Head, Head of Construction, Admin, or Admin_2)
  I want to receive push notifications on my phone when an approval is pending
  So that I can approve or reject requests promptly without constantly checking the app

  Background:
    Given the project "Apollo Hospital Chennai" is active
    And Firebase Cloud Messaging (FCM) is configured for push notifications

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: User registers their device for push notifications
  # ─────────────────────────────────────────────────────────────────
  Scenario: User opens the app for the first time and the device is registered
    Given the user "Nagarjuna" has logged in on a new phone
    When the app obtains an FCM token from Firebase
    And sends the token to the backend's subscription endpoint
    Then the backend saves the token as an active push subscription for Nagarjuna
    And Nagarjuna will now receive push notifications on this device

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Same device, different user (token is re-bound)
  # ─────────────────────────────────────────────────────────────────
  Scenario: User logs out and another user logs in on the same device
    Given the device has FCM token "device-token-1" registered for "Nagarjuna"
    When "Suresh" logs in on the same device
    And the app sends the same FCM token "device-token-1" with Suresh's session
    Then the backend updates the subscription to point to Suresh (not Nagarjuna)
    And there is only one subscription for token "device-token-1" (no duplicate)
    And Nagarjuna no longer receives notifications on this device
    And Suresh now receives notifications on this device

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: User unregisters their device on logout
  # ─────────────────────────────────────────────────────────────────
  Scenario: User logs out and the device subscription is removed
    Given "Nagarjuna" has a push subscription for token "device-token-1"
    When Nagarjuna logs out
    And the app calls the unsubscribe endpoint with the token
    Then the backend deletes the subscription
    And Nagarjuna no longer receives push notifications on this device

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: Check subscription status
  # ─────────────────────────────────────────────────────────────────
  Scenario: User checks if push notifications are enabled
    Given "Nagarjuna" has 2 active push subscriptions (phone + tablet)
    When the app calls the subscription status endpoint
    Then the response shows enabled=true and subscriptionCount=2
    And the frontend shows the notification bell icon as "on"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: Check subscription status when no devices are registered
  # ─────────────────────────────────────────────────────────────────
  Scenario: User with no registered devices checks subscription status
    Given "New User" has never registered a device
    When the app calls the subscription status endpoint
    Then the response shows enabled=false and subscriptionCount=0
    And the frontend shows the notification bell icon as "off"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: Approval request triggers push to all approvers
  # ─────────────────────────────────────────────────────────────────
  Scenario: Payment request is created — all PROJECT_HEAD users get a push
    Given "Nagarjuna" (PROJECT_HEAD) has a registered device with token "device-A"
    And "Another Head" (PROJECT_HEAD) has a registered device with token "device-B"
    When a supervisor creates a payment request in project "Apollo Hospital Chennai"
    Then the backend finds all active PROJECT_HEAD users in the project
    And sends a push notification to both "device-A" and "device-B"
    And the notification contains:
      | field        | value                          |
      | title        | Approval needed                |
      | body         | Please review                  |
      | type         | approval_request               |
      | approvalId   | (the approval workflow ID)     |
      | entityType   | PAYMENT_REQUEST                |
      | entityId     | (the payment request ID)       |
      | url          | /approvals/(id)                |
    And tapping the notification opens the approval detail screen in the app

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: No approvers in the project — no push is sent
  # ─────────────────────────────────────────────────────────────────
  Scenario: Payment request created but no ADMIN users exist in the project
    Given no users with role "ADMIN" exist in project "Apollo Hospital Chennai"
    When a payment request is created and the next step requires ADMIN approval
    Then the backend logs "No approvers found" and does NOT call Firebase
    And no push notification is sent (nothing would be delivered anyway)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: Approvers exist but have no registered devices
  # ─────────────────────────────────────────────────────────────────
  Scenario: Approvers exist but haven't installed the app on any device
    Given "Nagarjuna" (PROJECT_HEAD) exists but has no push subscriptions
    When a payment request is created
    Then the backend finds Nagarjuna as an approver
    But the token list is empty
    And the backend logs "No push subscriptions" and does NOT call Firebase
    And no push notification is sent

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Invalid FCM tokens are cleaned up after a failure
  # ─────────────────────────────────────────────────────────────────
  Scenario: User uninstalled the app — FCM returns "token not registered"
    Given "Nagarjuna" has token "valid-token" and "Old Token" (from a phone he no longer uses)
    When a push is sent to both tokens
    And FCM responds with success for "valid-token" but failure for "Old Token"
    And the error code for "Old Token" is "messaging/registration-token-not-registered"
    Then the backend deletes the "Old Token" subscription from the database
    And future push notifications will only be sent to "valid-token"
    And "Old Token" is never tried again (saves FCM quota)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Firebase is down — the approval workflow still works
  # ─────────────────────────────────────────────────────────────────
  Scenario: FCM service is down — push fails but the approval request succeeds
    Given "Nagarjuna" has a registered device
    When a payment request is created and the backend tries to send a push
    And Firebase throws an error "FCM down"
    Then the backend catches the error and logs it
    But the payment request is still created successfully
    And the approval workflow is still initiated
    And Nagarjuna can still see the pending approval when he opens the app manually
    And the app does not crash or show an error to the supervisor who created the request

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Multi-device user gets push on all devices
  # ─────────────────────────────────────────────────────────────────
  Scenario: Approver has both a phone and a tablet — both get the notification
    Given "Nagarjuna" (PROJECT_HEAD) has token "phone-token" and "tablet-token"
    When a payment request is created
    Then the backend sends the push to both "phone-token" and "tablet-token"
    And Nagarjuna sees the notification on both devices
