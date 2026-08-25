Feature: Gate Pass — Material Entry/Exit with OTP and Video Evidence
  As a supervisor
  I want to create gate passes for incoming and outgoing materials, verify them with OTP, and record video evidence
  So that every material movement through the gate is tracked and verifiable

  Background:
    Given the logged-in user is "Ravi" with role "SUPERVISOR" in project "Apollo Hospital Chennai"
    And the user has the CREATE_GATE_PASS permission
    And an approved PO "PO-001" exists for vendor "Ultra Cement Supplies"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 1: Create a gate pass for an incoming delivery
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates a gate pass for a cement delivery
    Given PO "PO-001" is approved and a truck is arriving with 100 bags of cement
    When Ravi goes to "Create Gate Pass" and selects:
      | field           | value             |
      | poId            | PO-001            |
      | otpRequestedFor | Nagarjuna (PROJECT_HEAD) |
    And clicks "Create Gate Pass"
    Then the backend creates a gate pass with status "PENDING"
    And an OTP "1234" is generated and stored against the gate pass
    And the OTP is valid for 10 minutes
    And a push notification is sent to Nagarjuna with the OTP

  # ─────────────────────────────────────────────────────────────────
  # Scenario 2: Security guard verifies the OTP at the gate
  # ─────────────────────────────────────────────────────────────────
  Scenario: Guard enters the correct OTP and the gate pass is approved
    Given a gate pass "GP-001" exists with status "PENDING" and OTP "1234"
    When the security guard opens the gate pass on their device
    And the guard authenticates with Firebase (sends their ID token)
    And enters the OTP "1234"
    Then the backend verifies the OTP matches
    And the gate pass status changes to "APPROVED"
    And the OTP is consumed (cannot be reused)
    And the truck is allowed to enter

  # ─────────────────────────────────────────────────────────────────
  # Scenario 3: Guard enters the wrong OTP
  # ─────────────────────────────────────────────────────────────────
  Scenario: Guard enters a wrong OTP — gate pass stays pending, OTP is not consumed
    Given a gate pass "GP-001" exists with OTP "1234"
    When the guard enters "9999"
    Then the backend rejects the verification
    And the gate pass remains "PENDING"
    And the OTP is still valid (not consumed) — the guard can retry

  # ─────────────────────────────────────────────────────────────────
  # Scenario 4: OTP expires after 10 minutes
  # ─────────────────────────────────────────────────────────────────
  Scenario: Truck arrives late — the OTP has expired
    Given a gate pass "GP-002" was created 15 minutes ago with OTP "1234"
    When the guard enters "1234"
    Then the backend rejects the verification because the OTP has expired
    And the gate pass remains "PENDING"
    And the OTP is deleted from the store
    And the supervisor must request a new gate pass with a fresh OTP

  # ─────────────────────────────────────────────────────────────────
  # Scenario 5: OTP brute-force protection — 5 wrong attempts
  # ─────────────────────────────────────────────────────────────────
  Scenario: Someone tries to guess the OTP 5 times and gets locked out
    Given a gate pass "GP-003" exists with OTP "1234"
    When the guard enters wrong OTPs "1111", "2222", "3333", "4444", "5555" (5 attempts)
    Then after the 5th wrong attempt, the OTP is deleted
    And even the correct OTP "1234" no longer works
    And the supervisor must request a new gate pass

  # ─────────────────────────────────────────────────────────────────
  # Scenario 6: OTP with trailing whitespace is accepted
  # ─────────────────────────────────────────────────────────────────
  Scenario: Guard enters the OTP with a trailing space (mobile keyboard added it)
    Given a gate pass "GP-004" exists with OTP "1234"
    When the guard enters "  1234  " (with spaces before and after)
    Then the backend trims the whitespace and verifies "1234"
    And the gate pass is approved

  # ─────────────────────────────────────────────────────────────────
  # Scenario 7: Camera captures an entry video clip
  # ─────────────────────────────────────────────────────────────────
  Scenario: RTSP camera records a 15-second video when the truck enters
    Given the camera is configured with RTSP URL "rtsp://192.168.1.100/stream"
    And the clip duration is set to 15 seconds
    When the gate pass "GP-001" is approved
    Then the backend uses ffmpeg to capture a 15-second video from the RTSP stream
    And the video is stored in the "gate-pass-videos" bucket
    And the file path is saved on the gate pass record as the "entry" clip
    And the filename includes the gate pass ID and "entry" (e.g. GP-001-entry-1234567890.mp4)

  # ─────────────────────────────────────────────────────────────────
  # Scenario 8: No camera — supervisor uploads a video manually
  # ─────────────────────────────────────────────────────────────────
  Scenario: No camera configured — supervisor uploads a video from their phone
    Given no CAMERA_RTSP_URL is configured
    When the gate pass "GP-005" is approved
    And Ravi uploads a video file "entry-clip.mp4" from their phone
    Then the backend stores the uploaded video in the "gate-pass-videos" bucket
    And the file path is saved on the gate pass record as the "entry" clip

  # ─────────────────────────────────────────────────────────────────
  # Scenario 9: Camera not configured — system detects this and shows upload UI
  # ─────────────────────────────────────────────────────────────────
  Scenario: Frontend detects no camera and shows the upload button instead
    Given no CAMERA_RTSP_URL is configured
    When the frontend calls the camera status endpoint
    Then the response says isCameraConfigured = false
    And the frontend shows "Upload Video" instead of "Camera will record automatically"

  # ─────────────────────────────────────────────────────────────────
  # Scenario 10: Gate pass for outward material (returning excess materials)
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor creates an outward gate pass for returning excess cement
    Given 20 excess bags of cement need to be returned to the vendor
    When Ravi creates an outward gate pass with type "OUTWARD"
    And an OTP is generated for the PROJECT_HEAD
    When the guard verifies the OTP
    Then the gate pass is approved and the truck is allowed to leave
    And an exit video clip is recorded

  # ─────────────────────────────────────────────────────────────────
  # Scenario 11: Cancel a gate pass
  # ─────────────────────────────────────────────────────────────────
  Scenario: Supervisor cancels a gate pass before the truck arrives
    Given a gate pass "GP-006" exists with status "PENDING" and an active OTP
    When Ravi cancels the gate pass
    Then the gate pass status changes to "REJECTED"
    And the OTP is cleared from the store
    And the OTP can no longer be used to verify this gate pass

  # ─────────────────────────────────────────────────────────────────
  # Scenario 12: Gate pass OTP verification requires Firebase authentication
  # ─────────────────────────────────────────────────────────────────
  Scenario: Guard must authenticate with Firebase before the OTP is accepted
    Given a gate pass "GP-007" exists with OTP "1234"
    When the guard tries to verify without sending a Firebase ID token
    Then the backend responds with HTTP 400 Bad Request
    And the error message says "Firebase ID token is required"
    And the OTP is not verified
