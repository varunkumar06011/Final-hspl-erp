# Backend Test Suite

This directory contains the automated test suite for the Hospital Construction ERP backend.
Tests are written with [Vitest](https://vitest.dev/) and run with `npm test` (from the repo root)
or `npx vitest run` (from `backend/`).

## How to run the tests

```bash
# From the repo root — runs every workspace's test script
npm test
# From backend/ — runs only the backend tests
cd backend
npx vitest run                          # all tests
npx vitest run tests/otp-service.test.ts   # one file
npx vitest run --exclude "**/e2e-real-*.test.ts"  # skip tests that need a live Postgres
npx vitest                               # watch mode (re-runs on file change)
```

## Test categories
The suite is split into three kinds of tests:

| Kind | Needs a database? | Speed | Example files |
|------|-------------------|-------|---------------|
| **Unit tests** | No (mocks/in-memory) | Fast (<1s) | `otp-service`, `storage-service`, `ocr-service`, `push-service`, `camera-service`, `schema-validation`, `auth-schemas` |
| **Logic / contract tests** | No | Fast | `approval-engine`, `rbac-adversarial`, `cross-project`, `acknowledgement-validation`, `audit-trail` |
| **E2E integration tests** | Yes (Postgres) | Slow | `e2e-vendor-po-invoice`, `e2e-real-vendor-po-invoice` |

The unit and logic tests run anywhere — they mock Prisma and external services so no infrastructure is required.
The E2E tests spin up the real Express app and hit it with `supertest`; the `e2e-real-*` variant connects to a live database at `localhost:5432`.

---

## File-by-file guide

### `otp-service.test.ts` — Gate-pass OTP generation & verification

**What it covers:** the in-memory OTP store used by the gate-pass flow.
The OTP service is responsible for issuing a 4-digit code when a supervisor requests a gate pass,
and verifying that code (with the security guard's Firebase ID token) when the truck arrives.

| Behavior verified | Why it matters |
|-------------------|----------------|
| `generateOtp` returns the fallback code `1234` and stores it | Until Firebase SMS OTP is wired up, every gate pass uses the same fallback code. The test pins this contract so we notice when production OTP generation is enabled. |
| `verifyOtp` succeeds with the correct code | The happy path — a guard types in the right code and the gate pass is approved. |
| `verifyOtp` fails for an unknown gate pass | Prevents guessing codes against gate passes that were never issued. |
| `verifyOtp` fails with a wrong code but keeps the OTP alive | A typo shouldn't burn the OTP — the user gets to retry. |
| `verifyOtp` trims whitespace from the input | Mobile keyboards often add a trailing space; the guard shouldn't be rejected for that. |
| `verifyOtp` fails after the 10-minute expiry | Stale OTPs must not be reusable — a truck that arrived an hour late needs a new code. |
| `verifyOtp` locks out after 5 failed attempts | Brute-force protection — 5 wrong guesses and the OTP is deleted. |
| A successful verification consumes the OTP | One OTP = one entry. Reusing it for a second truck must fail. |
| `clearOtp` removes a stored OTP | Used when a gate pass is cancelled or rejected. |
| `clearOtp` is a no-op for unknown IDs | Defensive — calling clear twice shouldn't throw. |

---

### `storage-service.test.ts` — File storage (local mode)

**What it covers:** the `LocalStorageService` used when `STORAGE_MODE=local`.
This is the storage backend for vendor attachments, site photos, gate-pass video clips, and OCR document uploads.

| Behavior verified | Why it matters |
|-------------------|----------------|
| `upload` writes the file to disk and returns correct metadata | Every attachment endpoint depends on `upload` returning a `filePath` to store in the DB. |
| `getFile` reads back the exact bytes uploaded | Round-trip integrity — a photo uploaded today must come back byte-for-byte when viewed next month. |
| `upload` generates a unique filename per call | Two files named `report.pdf` uploaded in the same second must not overwrite each other. |
| `deleteFile` removes the file | Used when an attachment is deleted or a gate pass is cancelled. |
| `deleteFile` doesn't throw if the file is already gone | Idempotent deletion — the caller doesn't need to check existence first. |
| `getSignedUrl` returns the path directly in local mode | In local mode there's no signing — the API serves the file itself. The test documents this contract. |
| `serveFile` streams the buffer with the stored content-type | The browser needs the right `Content-Type` to render images/PDFs inline. |
| `serveFile` falls back to `application/octet-stream` for null mime types | Older DB rows may have a null mime type — they should still download. |

---

### `schema-validation.test.ts` — Zod request schemas

**What it covers:** every Zod schema in `shared/schemas/modules.ts` that validates incoming API requests.
These schemas are the **contract between the frontend and backend** — if they accept bad data, the DB fills with garbage;
if they reject good data, users can't do their jobs.

| Behavior verified | Why it matters |
|-------------------|----------------|
| Vendor: minimal valid input works; empty name rejected; invalid email rejected; empty-string email accepted | Vendors are the root entity — bad vendor data cascades into every PO and invoice. |
| Vendor: rating clamped to 0–5 | A 6-star rating would break the UI badge component. |
| Vendor: pagination coerces strings and caps at 100 | Frontend sends query params as strings; a malicious `pageSize=99999` must be capped to protect the DB. |
| Quotation: items accepted as a JSON string (multipart forms) | The mobile app uploads quotations as `multipart/form-data` with items as a JSON string field. |
| Quotation: empty items array rejected | A quotation with zero line items is meaningless. |
| Quotation: invalid JSON string rejected | A malformed `items` field must produce a 400, not a 500. |
| PO: requires a valid `quotationId` and acknowledgement | POs can only be created from approved quotations; the acknowledgement checkbox is a legal CYA. |
| Invoice: `advancePaid > totalAmount` rejected | A vendor can't be paid more in advance than the invoice is worth. |
| Invoice: `taxAmount` defaults to 0 | Older frontend versions don't send `taxAmount` — the default prevents a null in the DB. |
| Payment request: negative amount rejected | Payments must be positive. |
| Gate pass: requires `poId` and `otpRequestedFor` | A gate pass without a PO and a recipient is invalid. |
| Gate pass OTP verification: requires `idToken` | The guard must authenticate with Firebase before verifying the OTP. |
| Inventory transaction: zero quantity rejected | An IN/OUT transaction with quantity 0 is a no-op and would corrupt stock levels. |
| Inventory transaction: invalid type rejected | Only `IN`, `OUT`, `ADJUST` are valid. |
| Phase: defaults to `NOT_STARTED` and budget 0 | New phases start with sensible defaults so the frontend doesn't have to send them. |
| Activity: `progressPercent` clamped to 0–100 | 150% progress would break the progress bar. |
| Issue: requires at least one `addressTo` user | An issue addressed to nobody is an issue nobody sees. |
| Issue: severity defaults to `MEDIUM` | If the user doesn't pick a severity, we default rather than reject. |
| Document: requires at least one `resolveTo` user | Same logic as issues — a document must be assigned to someone. |
| Contract: `advancePercent` and `retentionPercent` clamped to 0–100 | Percentages can't exceed 100. |
| Staff: `type` must be `COMPANY` or `LABOUR` | The attendance module splits reports by these two types. |
| Attendance: requires at least one record | Marking attendance with zero records is a no-op. |
| Project settings: rejects empty hospital name | The hospital name appears on every PDF export — it can't be blank. |

---

### `ocr-service.test.ts` — OCR document extraction (local extraction + Gemini structuring)

**What it covers:** the `extractFromFile` function that extracts structured data from quotation
or invoice images/PDFs using local extraction followed by Gemini 2.5 Flash structuring. Digital
PDFs use pdfjs-dist text extraction; images/scanned PDFs use Tesseract.js plus the original image
for Gemini vision. The conservative regex parser remains the no-API fallback. This powers the
"Scan quotation / Scan invoice" auto-fill buttons in the frontend.

| Behavior verified | Why it matters |
|-------------------|----------------|
| Unsupported file types rejected with a helpful message | Users upload Word docs by mistake — the error tells them what's accepted. |
| Variable-layout image is sent to Gemini vision for structuring | Gemini sees the original table geometry instead of trusting potentially reordered OCR columns. |
| Local extraction and parser remain available without Gemini | The app still returns conservative partial data when no API key is configured or Gemini fails. |
| Missing `GEMINI_API_KEY` returns regex result as-is | Graceful degradation — the app still works without the fallback configured. |
| Gemini API errors return regex result, not a crash | If the fallback fails, partial data is better than no data. |
| Corrupt PDF produces a friendly "Failed to read PDF" message | A scanned image renamed to `.pdf` will fail to parse — the user is told to upload a photo instead. |

### `ocr-parser.test.ts` — Local regex document parser

**What it covers:** the `parseDocumentText` function that extracts vendor name, document number,
dates, line items, and totals from raw text using regex rules — no API calls.

| Behavior verified | Why it matters |
|-------------------|----------------|
| Amount parsing handles Indian/Western/European formats, currency symbols | Vendor documents use varying number formats — all must parse correctly. |
| Date normalization handles DD/MM/YYYY, YYYY-MM-DD, "DD MMM YYYY", 2-digit years | Dates appear in many formats across vendor templates. |
| Quotation extraction: vendor, number, date, line items, GST, totals | The full quotation auto-fill flow. |
| Invoice extraction: vendor, number, dates, CGST+SGST sum, grand total | GST invoices split tax into CGST/SGST — must be summed. |
| Confidence check identifies empty/garbage local parses | Helps diagnose when the no-API fallback cannot confidently structure a document. |
| Pipe-separated and space-separated columns both parsed | Different vendors use different table formats. |

---

### `push-service.test.ts` — Firebase Cloud Messaging push notifications

**What it covers:** the push notification service that sends approval requests to approvers' phones.
When a supervisor creates a payment request, every approver in the project gets a push notification
asking them to approve or reject it.

| Behavior verified | Why it matters |
|-------------------|----------------|
| `saveSubscription` creates a new active subscription | A user opening the app for the first time registers their device token. |
| `saveSubscription` upserts an existing token | If a user logs in on a different account on the same device, the token is re-bound rather than duplicated. |
| `removeSubscription` deletes a specific user+token pair | A user logging out should stop getting notifications on that device. |
| `removeSubscriptionByToken` deletes by token only | Used for cleanup when FCM says a token is permanently invalid. |
| `getSubscriptionStatus` reports enabled/disabled | The frontend shows a bell icon toggle based on this. |
| `notifyApprovers` sends to all approver devices in the project | The core feature — every approver gets pinged. |
| `notifyApprovers` skips Firebase when there are no approvers | Don't waste an API call (and risk a 500) when there's nobody to notify. |
| `notifyApprovers` skips Firebase when approvers have no subscriptions | Approvers exist but haven't installed the app yet — silently skip. |
| Invalid FCM tokens are cleaned up after a partial failure | FCM returns error codes for dead tokens; we delete them so we never send to them again. |
| Firebase send failures are swallowed | A push failure must not break the approval workflow — the request still succeeds. |

---

### `auth-schemas.test.ts` — Authentication & user management schemas

**What it covers:** the Zod schemas in `shared/schemas/auth.ts` that gate every auth endpoint.
Auth is the most security-sensitive part of the app — a loose schema here means an attacker can
create accounts with bad roles or bypass PIN validation.

| Behavior verified | Why it matters |
|-------------------|----------------|
| `verifyTokenSchema` requires an `idToken` | Every authenticated request starts with a Firebase ID token. |
| `registerTokenSchema` requires a non-empty name | A self-registered supervisor must provide their name (used in audit logs). |
| `pinLoginSchema` requires a 10+ digit phone and exactly 4-digit PIN | PIN login is the fallback when Firebase OTP is down — the PIN must be exactly 4 digits. |
| `setPinSchema` and `changePinSchema` enforce the same 4-digit rule | Consistency — every PIN in the system is 4 digits. |
| `checkPinSchema` requires a phone in the query | The login flow checks whether a phone has a PIN before showing the PIN screen. |
| `createUserSchema` requires a valid phone, name, role, and projectId | Pre-provisioned users (created by a Project Head) must have all four fields. |
| `createUserSchema` rejects phones with spaces or dashes | Phone numbers are stored in E.164 format — spaces would break Firebase lookups. |
| `updateUserSchema` requires a uuid `params.id` | Prevents updating a non-existent user. |
| `listUsersSchema` coerces pagination and caps at 100 | Same protection as vendor listing. |
| `userResponseSchema` validates the response shape | The frontend relies on this shape to render the user profile screen. |
| `userResponseSchema` accepts a null `projectId` | An admin without a project assignment has `projectId: null`. |

---

### `camera-service.test.ts` — RTSP camera configuration & video upload

**What it covers:** the camera service that captures video clips from an RTSP camera at the site gate
when a gate pass is created (entry clip) and when the truck leaves (exit clip).
In production this uses ffmpeg; in dev/test, supervisors upload a video file instead.

| Behavior verified | Why it matters |
|-------------------|----------------|
| `isCameraConfigured` returns false when `CAMERA_RTSP_URL` is unset | The frontend uses this to decide between "capture from camera" and "upload video" UI. |
| `isCameraConfigured` returns true when the URL is set | When a camera is connected, the gate pass flow uses ffmpeg automatically. |
| `getCameraConfig` returns the configured URL and duration | The clip duration is configurable (default 15s). |
| `getCameraConfig` defaults duration to 15 when unset | A sensible default so the .env doesn't need to set it. |
| `captureFromU ploadedFile` uploads the buffer and returns the path | The dev-mode fallback — a supervisor uploads a video from their phone. |
| The filename includes the gate-pass ID and clip type (entry/exit) | So we can later find the entry and exit clips for a given gate pass. |

---

### Pre-existing test files (not created in this session)

These files were already in the repo before this session. They are documented here for completeness.

| File | What it covers |
|------|----------------|
| `auth-guard.test.ts` | The auth middleware: only pre-provisioned users can log in; inactive users get 403; invalid tokens get 401; self-registration creates a SUPERVISOR; privileged role assignment is conflict-checked. |
| `approval-engine.test.ts` | The multi-step approval workflow: initiation creates 4 steps (one per approver role); two distinct approvals mark the workflow APPROVED; the same person can't approve twice; wrong roles are rejected; two distinct rejections mark it REJECTED; `getState` returns the full step history. |
| `rbac-adversarial.test.ts` | The role-based access control matrix: PROJECT_HEAD can manage users, SUPERVISOR can't; only ADMIN and PROJECT_HEAD can approve step 1; only ADMIN_2 and HEAD_OF_CONSTRUCTION can approve step 2; only PROJECT_HEAD can edit the budget; unauthenticated requests get 401. |
| `cross-project.test.ts` | Project isolation: every role has `VIEW_FINANCIALS` (scoped at the service layer by `projectId`); `MANAGE_USERS` is restricted to the four head roles; documents the contract that the service layer must always filter by the authenticated user's `projectId`. |
| `acknowledgement-validation.test.ts` | The "I acknowledge this action is legally binding" checkbox: every create (quotation, PO, invoice) and every approval/rejection action requires `acknowledged: true`; the schema accepts `'true'` from multipart forms and `true` from JSON bodies. |
| `audit-trail.test.ts` | The audit log service: every CRUD action creates an `AuditLog` entry with the correct action type, entity, user, and timestamp; `getAuditLogs` returns paginated results filtered by project. |
| `seed-safety.test.ts` | The seed script refuses to run in production (`NODE_ENV=production` → exit 1 with "REFUSING TO SEED") so nobody accidentally wipes a prod database. |
| `e2e-vendor-po-invoice.test.ts` | Mock-based end-to-end flow: create vendor → quotation → approve → PO → approve → invoice → verify → dashboard. Uses a mocked Prisma. |
| `e2e-real-vendor-po-invoice.test.ts` | Real-DB end-to-end flow: same as above but against a live Postgres. Requires `localhost:5432` to be running. |

---

## Conventions
- **No database required** for unit/logic tests. Prisma is mocked with `vi.mock('../src/config/prisma', ...)`.
- **In-memory stores** (Maps/arrays) are used inside the mock factories so tests can assert on state.
- **`beforeEach` clears mocks and stores** to keep tests independent.
- **Test names are written as plain-English specifications** — read the `it(...)` string and you should understand what the test guarantees without reading the body.
- **Comments explain the *why*, not the *what*** — the code shows what; the comment explains why this behavior matters to the business.
