# Hospital Construction ERP — QA Test Plan

**Project:** Hospital Construction ERP
**Version:** 1.0
**Date:** September 2026
**Prepared for:** QA Team

---

## Table of Contents

1. [Environment Setup](#1-environment-setup)
2. [Test Users & Roles](#2-test-users--roles)
3. [Manual Test Cases](#3-manual-test-cases)
4. [API Test Cases with curl](#4-api-test-cases-with-curl)
5. [E2E Test Cases](#5-e2e-test-cases)
6. [Responsive Test Cases](#6-responsive-test-cases)
7. [Security Test Cases](#7-security-test-cases)
8. [Performance Test Cases](#8-performance-test-cases)

---

## 1. Environment Setup

| Item | Value |
|---|---|
| Frontend URL | `http://localhost:5174` |
| Backend URL | `http://localhost:4000/api` |
| Health Check | `GET http://localhost:4000/health` |
| Database | PostgreSQL (Prisma ORM) |
| Storage | Supabase (logo/attachments) |
| Dev Token | `Authorization: Bearer dev-token` (local dev only — resolves to first active user) |

### Prerequisites
- Backend running on port 4000
- Frontend running on port 5174
- Database seeded with test data
- At least 2 bank accounts, 3 vendors, 2 quotations, 2 POs, 2 invoices, 2 payments

### Quick Health Check

```bash
curl http://localhost:4000/health
```

**Actual Response:**
```json
{"status":"ok","timestamp":"2026-09-06T07:44:34.995Z","db":"up"}
```

---

## 2. Test Users & Roles

### Active Users in System

| Name | Phone | Role | Can Approve? |
|---|---|---|---|
| Kaushal Sir | 9999999999 | SUPERVISOR | No |
| SHAFI | +917816054608 | ACCOUNTANT | No |
| Srinivas Sir | +91999999906 | ACCOUNTS_HEAD | Yes |
| Akhil | +919381872579 | SUPERVISOR | No |
| Nagarjuna Sir | +917386861234 | PROJECT_HEAD | Yes (Payment Step 1) |
| Kaushal Sir | +919030845925 | ADMIN | Yes |
| Vinod Sir | +919550237788 | ADMIN_2 | Yes |
| Ashok Sir | +919247817812 | HEAD_OF_CONSTRUCTION | Yes (Payment Step 2) |

**Approver Roles:** PROJECT_HEAD, HEAD_OF_CONSTRUCTION, ACCOUNTS_HEAD, ADMIN, ADMIN_2

### Test PINs
- Vinod Sir (+919550237788): PIN `1234`
- Other users: Contact admin for PINs or use `dev-token` for API testing

---

## 3. Manual Test Cases

### 3.1 Authentication

| ID | TC-AUTH-001 |
|---|---|
| **Title** | Login with valid phone + PIN |
| **Steps** | 1. Open `http://localhost:5174/login` 2. Enter phone `9550237788` 3. Click Continue 4. Enter PIN `1234` 5. Click Sign In |
| **Expected** | Redirected to Dashboard. Header shows "Vinod Sir" with ADMIN_2 role badge. |
| **Actual Behavior** | User object stored in localStorage. JWT token stored. Redirect to `/` (Dashboard). |
| **Priority** | P0 |

| ID | TC-AUTH-002 |
|---|---|
| **Title** | Login with invalid phone (less than 10 digits) |
| **Steps** | 1. Open login page 2. Enter phone `123` 3. Observe Continue button |
| **Expected** | Continue button disabled. Phone field only accepts 10 digits. |
| **Actual Behavior** | Input strips non-digits, caps at 10 chars. Button disabled until 10 digits entered. |
| **Priority** | P0 |

| ID | TC-AUTH-003 |
|---|---|
| **Title** | Login with wrong PIN |
| **Steps** | 1. Enter valid phone 2. Click Continue 3. Enter wrong PIN `9999` 4. Click Sign In |
| **Expected** | Error: "Incorrect PIN. 4 attempt(s) remaining." |
| **Actual Behavior** | API returns 401 with attempt counter. Error shown in Alert on login card. |
| **Priority** | P0 |

| ID | TC-AUTH-004 |
|---|---|
| **Title** | Sign up new user |
| **Steps** | 1. Click Sign Up tab 2. Enter full name 3. Enter new phone 4. Click Continue 5. Enter OTP 6. Set 4-digit PIN |
| **Expected** | New user created with role SUPERVISOR by default. Redirected to dashboard. |
| **Priority** | P1 |

| ID | TC-AUTH-005 |
|---|---|
| **Title** | Logout |
| **Steps** | 1. Click user avatar in header 2. Click Logout |
| **Expected** | Redirected to `/login`. `firebaseToken` and `user` cleared from localStorage. |
| **Priority** | P0 |

| ID | TC-AUTH-006 |
|---|---|
| **Title** | Auto-logout disabled |
| **Steps** | 1. Login 2. Leave app idle for 20+ minutes 3. Return and interact |
| **Expected** | User remains logged in. No auto-logout. (Previously 15 min, now disabled.) |
| **Priority** | P1 |

| ID | TC-AUTH-007 |
|---|---|
| **Title** | Protected route redirect |
| **Steps** | 1. Logout 2. Navigate to `http://localhost:5174/vendors` |
| **Expected** | Redirected to `/login`. |
| **Actual Behavior** | ProtectedRoute checks localStorage for token. If absent, redirects to /login. |
| **Priority** | P0 |

| ID | TC-AUTH-008 |
|---|---|
| **Title** | Login page logo display |
| **Steps** | 1. Open login page 2. Verify logo image visible above title |
| **Expected** | V Grand Health Care logo displayed (96-112px). Title "Hospital Construction ERP" below. |
| **Priority** | P2 |

---

### 3.2 Dashboard

| ID | TC-DASH-001 |
|---|---|
| **Title** | Dashboard KPI cards display |
| **Steps** | 1. Login 2. Navigate to Dashboard |
| **Expected** | KPI cards visible: Budget Heads (₹17,90,90,000), Pending Payments (0), Pending Quotations (1), Pending POs (1), Pending Invoices (0), Pending Quotation Value (₹3,50,000). |
| **Actual Behavior** | Cards fetch from `GET /dashboard/summary`. Values animate on load. |
| **Priority** | P0 |

| ID | TC-DASH-002 |
|---|---|
| **Title** | Click Pending Payments card |
| **Steps** | 1. Login as approver 2. Click "Pending Payments" KPI card |
| **Expected** | PendingItemsDialog opens. Fetches `GET /payments?status=PENDING&pageSize=50`. Lists pending payments with code, vendor, amount, date, status chip. |
| **Actual Behavior** | Currently 0 pending payments — dialog shows "No pending payments" empty state. |
| **Priority** | P0 |

| ID | TC-DASH-003 |
|---|---|
| **Title** | Click Pending Quotations card |
| **Steps** | 1. Login as approver 2. Click "Pending Quotations" card |
| **Expected** | Dialog opens. Fetches `GET /quotations?pageSize=50`, filters client-side for SUBMITTED + UNDER_REVIEW. |
| **Actual Behavior** | Shows 1 pending quotation: VGH-Q002 from Mr. Design & Draft, ₹3,50,000, SUBMITTED. |
| **Priority** | P0 |

| ID | TC-DASH-004 |
|---|---|
| **Title** | Click Pending POs card |
| **Steps** | 1. Login as approver 2. Click "Pending POs" card |
| **Expected** | Dialog opens. Fetches `GET /purchase-orders?status=PENDING_APPROVAL&pageSize=50`. |
| **Actual Behavior** | Shows 1 pending PO: VGH-PO001 from Sand Tirupathi Rao, ₹3,10,000, PENDING_APPROVAL. Approve/Reject buttons visible for ADMIN/ADMIN_2. |
| **Priority** | P0 |

| ID | TC-DASH-005 |
|---|---|
| **Title** | Click Pending Invoices card |
| **Steps** | 1. Login as approver 2. Click "Pending Invoices" card |
| **Expected** | Dialog opens. Fetches `GET /invoices?verificationStatus=PENDING&pageSize=50`. |
| **Actual Behavior** | Currently 0 pending invoices — empty state shown. |
| **Priority** | P0 |

| ID | TC-DASH-006 |
|---|---|
| **Title** | Approve from dashboard dialog |
| **Steps** | 1. Open pending PO dialog 2. Click Approve 3. Enter comments 4. Check acknowledgement 5. Confirm |
| **Expected** | Calls `POST /purchase-orders/{id}/approve`. Record removed from list. Dashboard count refreshes via React Query invalidation. |
| **Actual Behavior** | ApprovalActionDialog opens with comments textarea + acknowledgement checkbox. On success, toast shown, query invalidated. |
| **Priority** | P0 |

| ID | TC-DASH-007 |
|---|---|
| **Title** | Reject from dashboard dialog |
| **Steps** | 1. Open pending dialog 2. Click Reject 3. Enter reason 4. Check acknowledgement 5. Confirm |
| **Expected** | Calls `POST /purchase-orders/{id}/reject`. Record removed. Dashboard count refreshes. |
| **Priority** | P0 |

| ID | TC-DASH-008 |
|---|---|
| **Title** | View record from dashboard dialog |
| **Steps** | 1. Open pending dialog 2. Click View (eye icon) on a record |
| **Expected** | Dialog closes. Navigates to entity page with `?id={id}` query param. |
| **Priority** | P1 |

| ID | TC-DASH-009 |
|---|---|
| **Title** | Non-approver sees no approve/reject buttons |
| **Steps** | 1. Login as SUPERVISOR (Kaushal Sir, 9999999999) 2. Open pending dialog |
| **Expected** | Only View button visible. No Approve/Reject buttons. `canUserApprove()` returns false. |
| **Priority** | P0 |

| ID | TC-DASH-010 |
|---|---|
| **Title** | Money Flow section (desktop ≥900px) |
| **Steps** | 1. View Money Flow card on dashboard at 1440px |
| **Expected** | SVG Sankey diagram: Total Budget (₹17.9Cr, blue) → Committed (₹0, orange) + Remaining (₹17.9Cr, green) → Paid (₹0, light green) + Outstanding (₹0, red). Tooltips on hover. |
| **Priority** | P1 |

| ID | TC-DASH-011 |
|---|---|
| **Title** | Money Flow section (mobile <900px) |
| **Steps** | 1. View dashboard at 375px |
| **Expected** | Stacked vertical flow bars (not SVG). Total Budget → Committed + Remaining → Paid + Outstanding. All values visible, no clipping. |
| **Priority** | P0 |

---

### 3.3 Vendors

| ID | TC-VEN-001 |
|---|---|
| **Title** | List vendors |
| **Steps** | 1. Navigate to /vendors |
| **Expected** | Table shows: name, vendor code, phone, materials, status, actions. Currently 2 vendors: Mr. Design & Draft (VGH-002), Sand Tirupathi Rao (VGH-001). |
| **Priority** | P0 |

| ID | TC-VEN-002 |
|---|---|
| **Title** | Create vendor |
| **Steps** | 1. Click Add Vendor 2. Fill name, phone, address 3. Add materials 4. Click Create |
| **Expected** | Vendor created. Appears in table. Success toast. Ledger auto-created if vendor is a sundry creditor. |
| **Priority** | P0 |

| ID | TC-VEN-003 |
|---|---|
| **Title** | Edit vendor |
| **Steps** | 1. Click edit icon 2. Change name 3. Click Update |
| **Expected** | Vendor updated in table. |
| **Priority** | P0 |

| ID | TC-VEN-004 |
|---|---|
| **Title** | Delete vendor |
| **Steps** | 1. Click delete icon 2. Confirm |
| **Expected** | Vendor soft-deleted. Removed from table. |
| **Priority** | P0 |

| ID | TC-VEN-005 |
|---|---|
| **Title** | Search vendors |
| **Steps** | 1. Type "Sand" in search 2. Press Enter |
| **Expected** | Table filters to matching vendors. API param: `?search=Sand`. |
| **Priority** | P1 |

---

### 3.4 Quotations

| ID | TC-QUO-001 |
|---|---|
| **Title** | Create quotation |
| **Steps** | 1. Navigate to /quotations 2. Click Create 3. Select vendor 4. Add line items 5. Submit |
| **Expected** | Quotation created with status SUBMITTED. Currently 2 quotations: VGH-Q001 (APPROVED, ₹3,10,000), VGH-Q002 (SUBMITTED, ₹3,50,000). |
| **Priority** | P0 |

| ID | TC-QUO-002 |
|---|---|
| **Title** | Approve quotation |
| **Steps** | 1. Login as ADMIN/ADMIN_2 2. Open SUBMITTED quotation 3. Click Approve 4. Comments + acknowledge 5. Confirm |
| **Expected** | Status → APPROVED. Approval workflow step updated. |
| **Priority** | P0 |

| ID | TC-QUO-003 |
|---|---|
| **Title** | Reject quotation |
| **Steps** | 1. Login as approver 2. Open SUBMITTED quotation 3. Click Reject 4. Reason + acknowledge 5. Confirm |
| **Expected** | Status → REJECTED. |
| **Priority** | P0 |

| ID | TC-QUO-004 |
|---|---|
| **Title** | Non-approver cannot approve |
| **Steps** | 1. Login as SUPERVISOR 2. Open quotation |
| **Expected** | No Approve/Reject buttons. Only View. |
| **Priority** | P0 |

---

### 3.5 Purchase Orders

| ID | TC-PO-001 |
|---|---|
| **Title** | Create PO from approved quotation |
| **Steps** | 1. Navigate to /pos 2. Click Create PO 3. Select approved quotation 4. Select budget head 5. Set payment type 6. Submit |
| **Expected** | PO created with PENDING_APPROVAL. PO number auto-generated (e.g., VGH-PO001). Currently 1 PO: VGH-PO001 (PENDING_APPROVAL, ₹3,10,000). |
| **Priority** | P0 |

| ID | TC-PO-002 |
|---|---|
| **Title** | Approve PO |
| **Steps** | 1. Login as ADMIN or ADMIN_2 2. Open pending PO 3. Approve 4. Comments + acknowledge 5. Confirm |
| **Expected** | Status → APPROVED. Backend checks `PO_APPROVER_ROLES = [PROJECT_HEAD, ACCOUNTS_HEAD, ADMIN, ADMIN_2]`. |
| **Actual Behavior** | If user already approved, returns 400: "You have already approved this purchase order". |
| **Priority** | P0 |

| ID | TC-PO-003 |
|---|---|
| **Title** | Reject PO |
| **Steps** | 1. Login as approver 2. Open pending PO 3. Reject 4. Reason + acknowledge 5. Confirm |
| **Expected** | Status → REJECTED. |
| **Priority** | P0 |

| ID | TC-PO-004 |
|---|---|
| **Title** | Edit unapproved PO |
| **Steps** | 1. Open PENDING_APPROVAL PO 2. Click Edit 3. Modify items 4. Save |
| **Expected** | PO items updated. Edit reason recorded. |
| **Priority** | P1 |

---

### 3.6 Invoices

| ID | TC-INV-001 |
|---|---|
| **Title** | Create invoice |
| **Steps** | 1. Navigate to /invoices 2. Click Create 3. Select vendor, PO (optional) 4. Enter invoice number, amount 5. Submit |
| **Expected** | Invoice created with verificationStatus PENDING. Currently 0 invoices in system. |
| **Priority** | P0 |

| ID | TC-INV-002 |
|---|---|
| **Title** | Verify (approve) invoice |
| **Steps** | 1. Login as approver 2. Open PENDING invoice 3. Approve 4. Comments + acknowledge 5. Confirm |
| **Expected** | verificationStatus → VERIFIED. |
| **Priority** | P0 |

| ID | TC-INV-003 |
|---|---|
| **Title** | Reject invoice |
| **Steps** | 1. Open PENDING invoice 2. Reject 3. Reason + acknowledge 4. Confirm |
| **Expected** | verificationStatus → REJECTED. |
| **Priority** | P0 |

---

### 3.7 Payments

| ID | TC-PAY-001 |
|---|---|
| **Title** | Create payment request from invoice |
| **Steps** | 1. Navigate to /payments 2. Click Create Payment 3. Select verified invoice 4. Enter amount 5. Submit |
| **Expected** | Payment created with status PENDING. Currently 0 payments in system. |
| **Priority** | P0 |

| ID | TC-PAY-002 |
|---|---|
| **Title** | Create expense payment |
| **Steps** | 1. Click Create Expense 2. Enter description, amount, category 3. Submit |
| **Expected** | Expense payment created with status PENDING and type EXPENSE. |
| **Priority** | P0 |

| ID | TC-PAY-003 |
|---|---|
| **Title** | Approve payment (Step 1 — PROJECT_HEAD) |
| **Steps** | 1. Login as Nagarjuna Sir (+917386861234) 2. Open pending payment 3. Approve 4. Confirm |
| **Expected** | Step 1 approved. If multi-step, still PENDING for step 2. |
| **Priority** | P0 |

| ID | TC-PAY-004 |
|---|---|
| **Title** | Approve payment (Step 2 — HEAD_OF_CONSTRUCTION) |
| **Steps** | 1. Login as Ashok Sir (+919247817812) 2. Open payment approved at step 1 3. Approve 4. Confirm |
| **Expected** | Fully approved. Status → APPROVED. |
| **Priority** | P0 |

| ID | TC-PAY-005 |
|---|---|
| **Title** | Record payment execution |
| **Steps** | 1. Open approved payment 2. Click Record Payment 3. Enter amount, mode, reference 4. Submit |
| **Expected** | Payment recorded. Bank/cash account balance updated. Journal voucher auto-created. |
| **Priority** | P0 |

| ID | TC-PAY-006 |
|---|---|
| **Title** | Reject payment |
| **Steps** | 1. Open pending payment 2. Reject 3. Reason + acknowledge 4. Confirm |
| **Expected** | Status → REJECTED. |
| **Priority** | P0 |

---

### 3.8 Bank Accounts

| ID | TC-BANK-001 |
|---|---|
| **Title** | List bank accounts |
| **Steps** | 1. Navigate to /bank-accounts |
| **Expected** | Currently 1 account: V GRAND HEALTHCARE PVT LTD, STATE BANK OF INDIA, A/c 45466639113, Current Balance ₹1,34,20,100. |
| **Priority** | P0 |

| ID | TC-BANK-002 |
|---|---|
| **Title** | Create bank account |
| **Steps** | 1. Click Add 2. Enter account name, bank name, account number, IFSC, opening balance 3. Submit |
| **Expected** | Bank account created. Ledger auto-created under BANK group. |
| **Priority** | P0 |

| ID | TC-BANK-003 |
|---|---|
| **Title** | Deposit to bank account |
| **Steps** | 1. Click Deposit 2. Enter amount, source (cash/other bank) 3. Submit |
| **Expected** | Bank balance increases. Source account decreases. Transaction recorded. |
| **Priority** | P0 |

| ID | TC-BANK-004 |
|---|---|
| **Title** | Withdraw from bank account |
| **Steps** | 1. Click Withdraw 2. Enter amount, destination 3. Submit |
| **Expected** | Bank balance decreases. Destination increases. |
| **Priority** | P0 |

| ID | TC-BANK-005 |
|---|---|
| **Title** | View bank statement |
| **Steps** | 1. Click Statement icon 2. Apply date filters 3. View transactions |
| **Expected** | Statement shows transactions. Opening/Closing balance displayed. |
| **Priority** | P0 |

| ID | TC-BANK-006 |
|---|---|
| **Title** | Export bank statement as PDF |
| **Steps** | 1. Open bank statement 2. Click Export 3. Select PDF |
| **Expected** | PDF downloads with account name, bank, date range, balances, all transactions. |
| **Priority** | P0 |

| ID | TC-BANK-007 |
|---|---|
| **Title** | Export bank statement as Excel |
| **Steps** | 1. Open bank statement 2. Click Export 3. Select Excel |
| **Expected** | CSV file downloads. Opens in Excel with structured data. |
| **Priority** | P0 |

| ID | TC-BANK-008 |
|---|---|
| **Title** | Print bank statement |
| **Steps** | 1. Open bank statement 2. Click Print |
| **Expected** | Browser print dialog opens. Only statement printed (no app UI). |
| **Priority** | P0 |

---

### 3.9 Ledger Statement

| ID | TC-LED-001 |
|---|---|
| **Title** | View ledger statement |
| **Steps** | 1. Navigate to /ledgers 2. Click statement icon on "STATE BANK OF INDIA - A/c 45466639113" |
| **Expected** | Dialog opens: title "Ledger Statement — STATE BANK OF INDIA - A/c 45466639113", BANK badge, From/To date filters, Opening Balance ₹0, Closing Balance ₹1,24,00,100, transactions table. |
| **Actual Behavior** | Fetches `GET /accounting-reports/ledger-statement/{ledgerId}?page=1&pageSize=200`. Shows receipts (VGH-RCPT0001, etc.) with debit amounts. |
| **Priority** | P0 |

| ID | TC-LED-002 |
|---|---|
| **Title** | Filter ledger statement by date range |
| **Steps** | 1. Open ledger statement 2. Set From: 2026-09-01, To: 2026-09-30 3. View results |
| **Expected** | Only transactions in September shown. Opening Balance: ₹1,34,20,100 (balance before Sep 1). Closing Balance: ₹1,34,20,100 (no transactions in range). |
| **Actual Behavior** | API params: `startDate=2026-09-01&endDate=2026-09-30`. Returns 0 records for this range. |
| **Priority** | P0 |

| ID | TC-LED-003 |
|---|---|
| **Title** | Export ledger statement as PDF |
| **Steps** | 1. Open ledger statement 2. Set date range 3. Click Export 4. Select PDF |
| **Expected** | PDF downloads. Filename: `Ledger_Statement_STATE_BANK_OF_INDIA_A_c_45466639113_{from}_to_{to}.pdf`. Contains: ledger name, group, From/To dates, opening balance, closing balance, all rows. |
| **Actual Behavior** | Uses jsPDF + autoTable. Landscape A4. Header row with gray background. Page numbers in footer. |
| **Priority** | P0 |

| ID | TC-LED-004 |
|---|---|
| **Title** | Export ledger statement as Excel |
| **Steps** | 1. Open ledger statement 2. Set date range 3. Click Export 4. Select Excel |
| **Expected** | CSV file downloads with UTF-8 BOM. Filename: `Ledger_Statement_..._{from}_to_{to}.csv`. Opens in Excel. Debit/Credit are plain numbers (not currency strings). Dates as DD-MM-YYYY. |
| **Priority** | P0 |

| ID | TC-LED-005 |
|---|---|
| **Title** | Print ledger statement |
| **Steps** | 1. Open ledger statement 2. Set date range 3. Click Print |
| **Expected** | Browser print dialog opens. Hidden iframe with print CSS. White background, dark text, striped rows. Table headers repeat across pages. No app navigation/buttons/overlay printed. |
| **Priority** | P0 |

| ID | TC-LED-006 |
|---|---|
| **Title** | Export format selection dialog |
| **Steps** | 1. Open ledger statement 2. Click Export |
| **Expected** | Small dialog: "Export Ledger Statement" / "Choose export format" / [PDF] [Excel] / [Cancel]. No export until format selected. |
| **Priority** | P1 |

| ID | TC-LED-007 |
|---|---|
| **Title** | Ledger export respects date range |
| **Steps** | 1. Set From: 2026-09-01, To: 2026-09-15 2. Export PDF 3. Open PDF |
| **Expected** | PDF shows "From: 01-09-2026" and "To: 15-09-2026". Only transactions in that range. |
| **Priority** | P0 |

| ID | TC-LED-008 |
|---|---|
| **Title** | Export with no transactions in range |
| **Steps** | 1. Set a date range with no transactions 2. Export PDF |
| **Expected** | PDF generates with opening/closing balance and empty table. No error. |
| **Priority** | P1 |

| ID | TC-LED-009 |
|---|---|
| **Title** | Export loading state |
| **Steps** | 1. Click Export 2. Select PDF |
| **Expected** | Buttons show CircularProgress spinner. Disabled during generation. Dialog cannot close while busy. |
| **Priority** | P2 |

| ID | TC-LED-010 |
|---|---|
| **Title** | Export error handling |
| **Steps** | 1. Simulate error (e.g., empty data) 2. Try to export |
| **Expected** | Error Alert shown in dialog. No corrupted file. User can retry. |
| **Priority** | P1 |

---

### 3.10 Other Modules

| ID | TC-CASH-001 |
|---|---|
| **Title** | List cash accounts |
| **Steps** | 1. Navigate to /cash-accounts |
| **Expected** | Currently 1 account: Main Cash, Balance ₹0. |
| **Priority** | P0 |

| ID | TC-BUD-001 |
|---|---|
| **Title** | List budget heads |
| **Steps** | 1. Navigate to /budget-heads |
| **Expected** | Currently 25 budget heads. Examples: PERMISSIONS (₹1,50,00,000), HR & LABOUR (₹3,00,00,000), IRON (₹1,50,00,000), CEMENT (₹1,35,00,000), GRAVEL (₹35,00,000). |
| **Priority** | P0 |

| ID | TC-LED-LIST-001 |
|---|---|
| **Title** | List ledgers |
| **Steps** | 1. Navigate to /ledgers |
| **Expected** | Currently 51 ledgers. Groups: BANK, CAPITAL_ACCOUNT, CASH, etc. First: STATE BANK OF INDIA - A/c 45466639113 (BANK, ₹1,34,20,100). |
| **Priority** | P0 |

| ID | TC-USR-001 |
|---|---|
| **Title** | List users (admin only) |
| **Steps** | 1. Login as ADMIN 2. Navigate to /users |
| **Expected** | Currently 10 users (8 active, 2 inactive). Shows name, phone, role, status. |
| **Priority** | P0 |

| ID | TC-SET-001 |
|---|---|
| **Title** | View settings |
| **Steps** | 1. Navigate to /settings |
| **Expected** | Hospital: V Grand Health Care Pvt Ltd. Total Budget: ₹17,90,90,000. Logo uploaded. |
| **Priority** | P0 |

---

## 4. API Test Cases with curl

> **Note:** Replace `dev-token` with actual JWT token for role-specific testing.
> To get a real JWT: `curl -X POST http://localhost:4000/api/auth/pin-login -H "Content-Type: application/json" -d '{"phone":"+919550237788","pin":"1234"}'`

### 4.1 Authentication APIs

#### TC-API-AUTH-001: Health Check (Public)

```bash
curl http://localhost:4000/health
```

**Expected Response (200):**
```json
{"status":"ok","timestamp":"2026-09-06T07:44:34.995Z","db":"up"}
```

---

#### TC-API-AUTH-002: Check PIN (Authenticated)

```bash
curl "http://localhost:4000/api/auth/check-pin?phone=%2B919550237788" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{"hasPin": true}
```

**Actual Behavior — Phone not registered (404):**
```bash
curl "http://localhost:4000/api/auth/check-pin?phone=9550237788" \
  -H "Authorization: Bearer dev-token"
```
```json
{"error":"Phone number not registered"}
```
> Note: Phone must include `+91` prefix for registered users.

---

#### TC-API-AUTH-003: PIN Login (Public)

```bash
curl -X POST http://localhost:4000/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919550237788","pin":"1234"}'
```

**Expected Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI3MWRmNzFiZS1lN2I3LTQ4OTktOThjMy02NzY4NGUzNDhiN2YiLCJpYXQiOjE3ODg2ODg4NjMsImV4cCI6MTc4OTI5MzY2M30.N2G3wVsWGWAuoszeY0cLceIy8szlkAwWc2-xao0jaic",
  "user": {
    "id": "71df71be-e7b7-4899-98c3-67684e348b7f",
    "firebaseUid": "pending-+919000000004",
    "phone": "+919550237788",
    "name": "Vinod Sir",
    "role": "ADMIN_2",
    "projectId": "78996889-e6d1-4f54-aa5e-8f62f5027394",
    "isActive": true
  }
}
```

---

#### TC-API-AUTH-004: PIN Login — Wrong PIN

```bash
curl -X POST http://localhost:4000/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919550237788","pin":"9999"}'
```

**Expected Response (401):**
```json
{"error":"Incorrect PIN. 4 attempt(s) remaining."}
```

---

#### TC-API-AUTH-005: No Auth Token

```bash
curl http://localhost:4000/api/vendors
```

**Expected Response (401):**
```json
{"error":"No authorization token provided"}
```

---

#### TC-API-AUTH-006: List Users (Admin Only)

```bash
curl http://localhost:4000/api/auth/users \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "data": [
    {"id":"69e5468a-...","phone":"9999999999","name":"Kaushal Sir","role":"SUPERVISOR","isActive":true},
    {"id":"8e75a510-...","phone":"+917816054608","name":"SHAFI","role":"ACCOUNTANT","isActive":true},
    {"id":"71df71be-...","phone":"+919550237788","name":"Vinod Sir","role":"ADMIN_2","isActive":true}
  ],
  "pagination": {"page":1,"pageSize":20,"total":10,"totalPages":1}
}
```

---

### 4.2 Dashboard API

#### TC-API-DASH-001: Get Dashboard Summary

```bash
curl http://localhost:4000/api/dashboard/summary \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "project": {"totalBudget":"179090000","name":"V Grand Health Care Pvt Ltd","status":"ACTIVE"},
  "totalBudget": 179090000,
  "committed": 0,
  "paid": 0,
  "remaining": 179090000,
  "pendingPayments": 0,
  "pendingQuotations": 1,
  "pendingQuotationValue": 350000,
  "pendingPOs": 1,
  "pendingInvoices": 0,
  "openIssues": 0,
  "lowStockItems": 0,
  "totalExpenseAmount": 0
}
```

---

### 4.3 Vendor APIs

#### TC-API-VEN-001: List Vendors

```bash
curl "http://localhost:4000/api/vendors?page=1&pageSize=20" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "data": [
    {"id":"...","name":"Mr. Design & Draft","vendorCode":"VGH-002","phone":"8522852506","isActive":true},
    {"id":"...","name":"Sand Tirupathi Rao","vendorCode":"VGH-001","phone":"9390420823","isActive":true}
  ],
  "pagination": {"page":1,"pageSize":20,"total":2,"totalPages":1}
}
```

---

#### TC-API-VEN-002: Create Vendor

```bash
curl -X POST http://localhost:4000/api/vendors \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Vendor QA","phone":"9876543210","address":"Test Address","materials":[{"name":"Test Material","unit":"KG"}]}'
```

**Expected Response (201):**
```json
{"id":"...","name":"Test Vendor QA","vendorCode":"VGH-003","phone":"9876543210","isActive":true}
```

---

#### TC-API-VEN-003: Create Vendor — Validation Error (Missing Name)

```bash
curl -X POST http://localhost:4000/api/vendors \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response (400):**
```json
{"error":"Validation failed","details":[{"path":"body.name","message":"Required"}]}
```

---

#### TC-API-VEN-004: Search Vendors

```bash
curl "http://localhost:4000/api/vendors?page=1&pageSize=20&search=Sand" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):** Only vendors matching "Sand" in name/code/phone.

---

### 4.4 Quotation APIs

#### TC-API-QUO-001: List Quotations

```bash
curl "http://localhost:4000/api/quotations?page=1&pageSize=20" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "data": [
    {"id":"baf1f9a2-...","quotationNumber":"VGH-Q002","status":"SUBMITTED","grandTotal":"350000","vendor":{"name":"Mr. Design & Draft"}},
    {"id":"2548380f-...","quotationNumber":"VGH-Q001","status":"APPROVED","grandTotal":"310000","vendor":{"name":"Sand Tirupathi Rao"}}
  ],
  "pagination": {"page":1,"pageSize":20,"total":2,"totalPages":1}
}
```

---

#### TC-API-QUO-002: List Quotations with Status Filter

```bash
curl "http://localhost:4000/api/quotations?page=1&pageSize=20&status=SUBMITTED" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):** Only quotations with status SUBMITTED (1 result: VGH-Q002).

---

#### TC-API-QUO-003: Approve Quotation

```bash
curl -X POST http://localhost:4000/api/quotations/{quotation_id}/approve \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{"comments":"Approved from QA test","acknowledged":true}'
```

**Expected Response (200):** Updated quotation with APPROVED status.
**If not approver (403):** `{"error":"Insufficient permissions"}`
**If already approved (400):** `{"error":"No pending approval step for your role, or you may have already approved"}`

---

#### TC-API-QUO-004: Reject Quotation

```bash
curl -X POST http://localhost:4000/api/quotations/{quotation_id}/reject \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Rejected from QA test","acknowledged":true}'
```

**Expected Response (200):** Updated quotation with REJECTED status.

---

### 4.5 Purchase Order APIs

#### TC-API-PO-001: List POs with Status Filter

```bash
curl "http://localhost:4000/api/purchase-orders?status=PENDING_APPROVAL&page=1&pageSize=50" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "data": [
    {
      "id":"c5e3bb21-90e1-41de-922c-5c98438edab1",
      "poNumber":"VGH-PO001",
      "status":"PENDING_APPROVAL",
      "grandTotal":"310000",
      "vendor":{"name":"Sand Tirupathi Rao","vendorCode":"VGH-001"},
      "approvalWorkflow":{"status":"VERIFICATION","steps":[
        {"approverRole":"ADMIN","status":"PENDING"},
        {"approverRole":"ADMIN_2","status":"PENDING"}
      ]}
    }
  ],
  "pagination": {"page":1,"pageSize":50,"total":1,"totalPages":1}
}
```

> **Important:** The API endpoint is `/purchase-orders`, NOT `/pos`. The `/pos` is only the frontend route.

---

#### TC-API-PO-002: Approve PO

```bash
curl -X POST http://localhost:4000/api/purchase-orders/c5e3bb21-90e1-41de-922c-5c98438edab1/approve \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{"comments":"Approved","acknowledged":true}'
```

**Expected Response (200):** PO with status APPROVED.

**If already approved by this user (400):**
```json
{"error":"No pending approval step for your role, or you may have already approved"}
```

**If non-approver role (403):**
```json
{"error":"Only Project Head, Accounts Head or Admin 2 can approve purchase orders"}
```

---

#### TC-API-PO-003: Reject PO

```bash
curl -X POST http://localhost:4000/api/purchase-orders/{po_id}/reject \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Rejected","acknowledged":true}'
```

---

#### TC-API-PO-004: Invalid UUID in Path

```bash
curl http://localhost:4000/api/purchase-orders/not-a-uuid \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (500):**
```json
{"error":"Internal server error"}
```
> Note: This returns 500 (Prisma UUID parse error) instead of a clean 400 validation error. This is a known issue — the route does not have UUID validation middleware on the path param.

---

### 4.6 Invoice APIs

#### TC-API-INV-001: List Invoices

```bash
curl "http://localhost:4000/api/invoices?page=1&pageSize=20" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{"data":[],"pagination":{"page":1,"pageSize":20,"total":0,"totalPages":0}}
```

---

#### TC-API-INV-002: List Invoices with Verification Status Filter

```bash
curl "http://localhost:4000/api/invoices?verificationStatus=PENDING&page=1&pageSize=50" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):** Only invoices with verificationStatus PENDING.

---

#### TC-API-INV-003: Create Invoice

```bash
curl -X POST http://localhost:4000/api/invoices \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"vendorId":"776c6585-634a-4666-ae26-f3dc9224f66b","invoiceNumber":"INV-QA-001","amount":50000,"invoiceDate":"2026-09-06"}'
```

**Expected Response (201):** Invoice with verificationStatus PENDING.

---

#### TC-API-INV-004: Approve (Verify) Invoice

```bash
curl -X POST http://localhost:4000/api/invoices/{invoice_id}/approve \
  -H "Authorization: Bearer {approver_token}" \
  -H "Content-Type: application/json" \
  -d '{"comments":"Verified","acknowledged":true}'
```

**Expected Response (200):** Invoice with verificationStatus VERIFIED.

---

### 4.7 Payment APIs

#### TC-API-PAY-001: List Payments

```bash
curl "http://localhost:4000/api/payments?page=1&pageSize=20" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{"data":[],"pagination":{"page":1,"pageSize":20,"total":0,"totalPages":0}}
```

---

#### TC-API-PAY-002: List Payments with Status Filter

```bash
curl "http://localhost:4000/api/payments?status=PENDING&page=1&pageSize=50" \
  -H "Authorization: Bearer dev-token"
```

---

#### TC-API-PAY-003: Create Payment Request

```bash
curl -X POST http://localhost:4000/api/payments \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"invoiceId":"{invoice_id}","vendorId":"{vendor_id}","requestNumber":"PR-QA-001","amount":50000}'
```

**Expected Response (201):** Payment with status PENDING.

---

#### TC-API-PAY-004: Create Expense

```bash
curl -X POST http://localhost:4000/api/payments/expense \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"description":"QA test expense","amount":5000,"category":"Testing"}'
```

**Expected Response (201):** Expense payment with status PENDING, type EXPENSE.

---

#### TC-API-PAY-005: Approve Payment

```bash
curl -X POST http://localhost:4000/api/payments/{payment_id}/approve \
  -H "Authorization: Bearer {project_head_token}" \
  -H "Content-Type: application/json" \
  -d '{"comments":"Approved step 1","acknowledged":true}'
```

**Expected Response (200):** Payment with step 1 approved.
**If wrong role (403):** `{"error":"Insufficient permissions"}`

---

### 4.8 Bank Account APIs

#### TC-API-BANK-001: List Bank Accounts

```bash
curl http://localhost:4000/api/bank-accounts \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "data": [
    {
      "id":"5ea29e57-e86a-40b4-b157-1fae73b33abb",
      "accountName":"V GRAND HEALTHCARE PVT LTD",
      "bankName":"STATE BANK OF INDIA",
      "accountNumber":"45466639113",
      "ifscCode":"SBIN0004246",
      "openingBalance":"0",
      "currentBalance":"13420100",
      "isActive":true
    }
  ],
  "pagination": {"page":1,"pageSize":20,"total":1,"totalPages":1}
}
```

---

#### TC-API-BANK-002: Bank Deposit

```bash
curl -X POST http://localhost:4000/api/bank-accounts/{bank_id}/deposit \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"amount":10000,"sourceCashAccountId":"{cash_account_id}"}'
```

**Expected Response (200):** Updated bank balance. Transaction recorded.

---

### 4.9 Ledger & Accounting APIs

#### TC-API-LED-001: List Ledgers

```bash
curl "http://localhost:4000/api/ledgers?page=1&pageSize=20" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "data": [
    {"id":"49e58a6e-...","name":"STATE BANK OF INDIA - A/c 45466639113","group":"BANK","currentBalance":"13420100"},
    {"id":"...","name":"Challa Kapil Karthik","group":"CAPITAL_ACCOUNT","currentBalance":"-10000"}
  ],
  "pagination": {"page":1,"pageSize":20,"total":51,"totalPages":3}
}
```

---

#### TC-API-LED-002: List Ledgers with Group Filter

```bash
curl "http://localhost:4000/api/ledgers?group=BANK&page=1&pageSize=20" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):** Only BANK group ledgers (1 result: SBI account).

---

#### TC-API-LED-003: Get Ledger Statement

```bash
curl "http://localhost:4000/api/accounting-reports/ledger-statement/49e58a6e-c7d8-43a1-93c7-c0871bb5fbe4?page=1&pageSize=200" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "ledger": {"name":"STATE BANK OF INDIA - A/c 45466639113","group":"BANK","isDebitNature":true},
  "openingBalance": 0,
  "closingBalance": 12400100,
  "data": [
    {"id":"...","voucherNumber":"VGH-RCPT0001","voucherType":"RECEIPT","debit":4400000,"credit":0,"balance":4400000,"description":"..."},
    {"id":"...","voucherNumber":"VGH-RCPT0002","voucherType":"RECEIPT","debit":100,"credit":0,"balance":4400100}
  ]
}
```

---

#### TC-API-LED-004: Get Ledger Statement with Date Filter

```bash
curl "http://localhost:4000/api/accounting-reports/ledger-statement/49e58a6e-c7d8-43a1-93c7-c0871bb5fbe4?startDate=2026-09-01&endDate=2026-09-30&page=1&pageSize=200" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "ledger": {"name":"STATE BANK OF INDIA - A/c 45466639113","group":"BANK","isDebitNature":true},
  "openingBalance": 13420100,
  "closingBalance": 13420100,
  "data": []
}
```
> Note: Opening balance is the balance BEFORE the start date. No transactions in September, so closing = opening.

---

#### TC-API-LED-005: Ledger Statement — Invalid Ledger ID

```bash
curl "http://localhost:4000/api/accounting-reports/ledger-statement/5ea29e57-e86a-40b4-b157-1fae73b33abb" \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (404):**
```json
{"error":"Ledger not found"}
```
> Note: This ID is the bank account ID, not the ledger ID. The ledger ID is different.

---

### 4.10 Settings APIs

#### TC-API-SET-001: Get Settings

```bash
curl http://localhost:4000/api/settings \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):**
```json
{
  "id":"78996889-e6d1-4f54-aa5e-8f62f5027394",
  "name":"V Grand Health Care Pvt Ltd",
  "totalBudget":"179090000",
  "status":"ACTIVE",
  "officeAddress":"1st floor, Opp: KB Restaurant Lane...",
  "hospitalAddress":"Old Bypass, Near Housing Board Colony...",
  "gstNumber":"",
  "logoUrl":"logos/1788681879512-VGRAND HEALTH CARE_logo.png"
}
```

---

#### TC-API-SET-002: Get Logo (Public — No Auth)

```bash
curl http://localhost:4000/api/settings/logo
```

**Expected Response (200):** Image blob (image/png).
**If no logo (404):** `{"error":"No logo uploaded"}`

---

#### TC-API-SET-003: Update Settings

```bash
curl -X PUT http://localhost:4000/api/settings \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"V Grand Health Care Pvt Ltd","totalBudget":180000000}'
```

**Expected Response (200):** Updated settings object.

---

### 4.11 Other APIs

#### TC-API-BUD-001: List Budget Heads

```bash
curl http://localhost:4000/api/budget-heads \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):** 25 budget heads including PERMISSIONS (₹1.5Cr), HR & LABOUR (₹3Cr), IRON (₹1.5Cr), CEMENT (₹1.35Cr), GRAVEL (₹35L).

---

#### TC-API-CASH-001: List Cash Accounts

```bash
curl http://localhost:4000/api/cash-accounts \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (200):** 1 cash account: Main Cash, Balance ₹0.

---

### 4.12 Validation & Error Handling

#### TC-API-VAL-001: No Auth Token

```bash
curl http://localhost:4000/api/vendors
```

**Expected Response (401):**
```json
{"error":"No authorization token provided"}
```

---

#### TC-API-VAL-002: Missing Required Body Field

```bash
curl -X POST http://localhost:4000/api/vendors \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response (400):**
```json
{"error":"Validation failed","details":[{"path":"body.name","message":"Required"}]}
```

---

#### TC-API-VAL-003: Invalid UUID in Path

```bash
curl http://localhost:4000/api/purchase-orders/not-a-uuid \
  -H "Authorization: Bearer dev-token"
```

**Expected Response (500):**
```json
{"error":"Internal server error"}
```
> Known issue: Should be 400 with validation error. Prisma throws UUID parse error.

---

#### TC-API-VAL-004: Insufficient Permissions

```bash
# Login as SUPERVISOR first, then:
curl http://localhost:4000/api/auth/users \
  -H "Authorization: Bearer {supervisor_token}"
```

**Expected Response (403):**
```json
{"error":"Insufficient permissions. Required: MANAGE_USERS"}
```

---

## 5. E2E Test Cases

### TC-E2E-001: Full Procurement Flow
**Priority:** P0

**Steps:**
1. Login as SUPERVISOR (9999999999)
2. Create a vendor "QA Test Vendor"
3. Create a quotation with 3 line items
4. Logout → Login as ADMIN (+919030845925)
5. Approve the quotation
6. Create a PO from the approved quotation
7. Logout → Login as ADMIN_2 (+919550237788)
8. Approve the PO
9. Create an invoice against the PO
10. Verify the invoice
11. Create a payment request
12. Logout → Login as PROJECT_HEAD (+917386861234) → approve payment step 1
13. Logout → Login as HEAD_OF_CONSTRUCTION (+919247817812) → approve payment step 2
14. Record the payment
15. Verify bank balance updated

**Expected:** Full flow completes. Each status transition correct. Audit log captures all actions.

---

### TC-E2E-002: Dashboard Approval Flow
**Priority:** P0

**Steps:**
1. Login as ADMIN_2 (Vinod Sir, +919550237788, PIN 1234)
2. Click "Pending POs" KPI card
3. Verify dialog opens with VGH-PO001 (₹3,10,000)
4. Click Approve
5. Enter "Approved from dashboard" as comments
6. Check acknowledgement box
7. Click Confirm
8. Verify PO removed from dialog list
9. Close dialog
10. Verify dashboard pending PO count decreased to 0
11. Navigate to /pos — verify VGH-PO001 shows APPROVED

**Expected:** Approval from dashboard works. Count syncs. PO page reflects status.

---

### TC-E2E-003: Ledger Statement Export Flow
**Priority:** P0

**Steps:**
1. Login as ACCOUNTANT
2. Navigate to /ledgers
3. Click statement icon on "STATE BANK OF INDIA - A/c 45466639113"
4. Set From: 2026-08-01, To: 2026-08-31
5. Verify transactions load (opening: ₹0, closing: ₹1,24,00,100)
6. Click Export → select PDF
7. Verify PDF downloads: `Ledger_Statement_STATE_BANK_OF_INDIA_A_c_45466639113_01-08-2026_to_31-08-2026.pdf`
8. Open PDF — verify ledger name, date range, opening/closing balance, all rows
9. Click Export → select Excel
10. Open CSV in Excel — verify structured data, numeric amounts
11. Click Print
12. Verify print dialog — only statement visible, no app UI

**Expected:** All three export methods produce correct output matching on-screen data.

---

### TC-E2E-004: Bank Deposit → Balance → Statement

**Steps:**
1. Login as ACCOUNTANT
2. Navigate to /bank-accounts
3. Note SBI current balance (₹1,34,20,100)
4. Click Deposit → ₹10,000 from Main Cash
5. Submit
6. Verify SBI balance → ₹1,34,30,100
7. Verify Main Cash balance → -₹10,000
8. Click Statement on SBI
9. Verify deposit transaction appears
10. Export as PDF — verify deposit row included

**Expected:** Deposit updates both accounts. Statement reflects transaction.

---

### TC-E2E-005: Multi-User Approval Workflow

**Steps:**
1. Login as ACCOUNTANT — create payment request
2. Logout → Login as PROJECT_HEAD — approve step 1
3. Verify payment still PENDING (needs step 2)
4. Logout → Login as HEAD_OF_CONSTRUCTION — approve step 2
5. Verify payment APPROVED
6. Record payment
7. Login as ADMIN — view audit log
8. Verify both approval actions logged with timestamps

**Expected:** Multi-step approval works. Each approver only approves their step.

---

## 6. Responsive Test Cases

### Test Viewports: 1440px, 1024px, 768px, 480px, 390px, 375px, 360px

| ID | Title | Steps | Expected | Priority |
|---|---|---|---|---|
| TC-RES-001 | No horizontal overflow | Open each page at each viewport | No page-level horizontal scrollbar | P0 |
| TC-RES-002 | Tables → cards on mobile | Open /vendors at 375px | Stacked cards with label/value pairs. Headers hidden. Actions horizontal. | P0 |
| TC-RES-003 | Money Flow mobile | Dashboard at 375px | Stacked vertical flow bars. All values visible. No clipping. | P0 |
| TC-RES-004 | Money Flow desktop | Dashboard at 1440px | SVG Sankey diagram. All nodes/links/labels visible. | P1 |
| TC-RES-005 | Login on mobile | /login at 375px | Card fits viewport. Logo (96px), inputs, buttons visible. No overflow. | P0 |
| TC-RES-006 | Dialogs on mobile | Open ledger statement at 375px | Full-screen dialog. Content scrollable. Buttons accessible. | P0 |
| TC-RES-007 | Header on mobile | View header at 375px | Title truncates. Icons accessible. No overlap. Drawer works. | P0 |
| TC-RES-008 | Pending dialog on mobile | Open pending PO dialog at 375px | Records stack vertically. Buttons accessible. No overflow. | P0 |
| TC-RES-009 | Tabs scroll on mobile | Page with tabs at 375px | Tabs scroll horizontally. Labels readable. | P1 |
| TC-RES-010 | Forms on mobile | Vendor create form at 375px | Fields full-width. No overflow. Submit accessible. | P0 |

---

## 7. Security Test Cases

| ID | Title | Steps | Expected | Priority |
|---|---|---|---|---|
| TC-SEC-001 | SQL injection | `GET /vendors?search=' OR 1=1--` | Prisma parameterized queries prevent injection. No SQL error. | P0 |
| TC-SEC-002 | XSS in input | Create vendor with name `<script>alert(1)</script>` | Stored as text. React escapes it. Not executed. | P0 |
| TC-SEC-003 | Invalid token | `Authorization: Bearer invalidtoken123` | 401 response. Frontend redirects to /login. | P0 |
| TC-SEC-004 | Cross-project access | User from Project A tries to access Project B data | All queries filtered by user's projectId. Cannot access other project. | P0 |
| TC-SEC-005 | Role-based access | Login as SITE_SUPERVISOR, try /payments | 403 or hidden from navigation. Only gate-passes accessible. | P0 |
| TC-SEC-006 | Self-approval prevention | User who created PO tries to approve it | Backend rejects. | P0 |
| TC-SEC-007 | Double approval | User approves PO, tries again | 400: "You have already approved this purchase order" | P0 |

### Security curl Examples

#### SQL Injection Test:
```bash
curl "http://localhost:4000/api/vendors?search=%27%20OR%201%3D1--" \
  -H "Authorization: Bearer dev-token"
```
**Expected:** Returns empty or normal results. No SQL error leaked.

#### XSS Test:
```bash
curl -X POST http://localhost:4000/api/vendors \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"<script>alert(1)</script>","phone":"1234567890"}'
```
**Expected:** Vendor created with literal name `<script>alert(1)</script>`. Not executed in browser.

---

## 8. Performance Test Cases

| ID | Title | Steps | Expected | Priority |
|---|---|---|---|---|
| TC-PERF-001 | Dashboard load | Login, measure dashboard load | < 3 seconds on normal connection | P1 |
| TC-PERF-002 | Large list pagination | Page with 100+ records, navigate pages | Each page < 2 seconds | P1 |
| TC-PERF-003 | PDF export 200+ rows | Ledger statement with 200+ transactions, export PDF | Generates < 5 seconds. Multiple pages. | P1 |
| TC-PERF-004 | Concurrent users | 5 users login simultaneously | All work without errors | P2 |

---

## Appendix A: Test Data Summary (Current System State)

| Entity | Count | Details |
|---|---|---|
| Vendors | 2 | Mr. Design & Draft (VGH-002), Sand Tirupathi Rao (VGH-001) |
| Quotations | 2 | VGH-Q001 (APPROVED, ₹3.1L), VGH-Q002 (SUBMITTED, ₹3.5L) |
| Purchase Orders | 1 | VGH-PO001 (PENDING_APPROVAL, ₹3.1L) |
| Invoices | 0 | — |
| Payments | 0 | — |
| Bank Accounts | 1 | SBI, A/c 45466639113, Balance ₹1.34Cr |
| Cash Accounts | 1 | Main Cash, Balance ₹0 |
| Ledgers | 51 | BANK, CAPITAL_ACCOUNT, CASH, etc. |
| Budget Heads | 25 | PERMISSIONS, HR & LABOUR, IRON, CEMENT, etc. |
| Users | 10 | 8 active, 2 inactive |
| Total Budget | ₹17,90,90,000 | V Grand Health Care Pvt Ltd |

---

## Appendix B: Bug Report Template

```
Bug ID: BUG-XXX
Title: [Short description]
Severity: P0/P1/P2/P3
Module: [Auth/Dashboard/Vendors/POs/etc.]
Reported by: [Name]
Date: [YYYY-MM-DD]

Environment:
- Browser: [Chrome/Firefox/Safari/Edge]
- Device: [Desktop/Mobile/Tablet]
- Viewport: [e.g., 375px]
- User role: [e.g., ADMIN]

Steps to reproduce:
1.
2.
3.

Expected result:

Actual result:

Screenshot/Video: [Attach]

API response (if applicable):
- Endpoint:
- curl command:
- Status code:
- Response body:
```

---

**End of Test Plan**
