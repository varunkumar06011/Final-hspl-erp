# Simulation Test Cases (Gherkin Feature Files)

This directory contains **plain-English simulation test cases** written in
[Gherkin](https://cucumber.io/docs/gherkin/) format. Each `.feature` file
describes real-world business scenarios that the Hospital Construction ERP
must handle, written so that anyone — developers, QA engineers, project
managers, and clients — can read and understand them.

## How to read a feature file

Every feature file follows this structure:

```gherkin
Feature: <what this feature is about>
  As a <role>
  I want <capability>
  So that <business value>

  Background:
    Given <preconditions that apply to every scenario in this file>

  Scenario: <a plain-English description of the situation>
    Given <the starting state>
    When <the user does something>
    Then <this should happen>
    And <this too>
```

- **Given** = the starting state (what's already true before the test)
- **When** = the action the user takes
- **Then** = the expected result
- **And** = additional conditions (continues the previous Given/When/Then)

You don't need to be a developer to understand these. Just read the
`Scenario:` title and the `Given/When/Then` lines like a story.

## Feature files in this directory

| File | Scenarios | What it simulates |
|------|-----------|-------------------|
| `auth.feature` | 14 | Login via Firebase OTP, PIN login fallback, self-registration, pre-provisioned user creation, deactivation, duplicate role prevention |
| `vendor-management.feature` | 11 | Creating vendors with materials, updating, blacklisting, reactivating, search/pagination, validation rules |
| `quotation-flow.feature` | 13 | Creating quotations, the 4-step approval workflow, same-person-can't-approve-twice, rejection rules, converting to PO |
| `purchase-order-flow.feature` | 11 | Creating POs from approved quotations, approval, partial/full delivery, cancellation, dashboard committed amount |
| `invoice-verification.feature` | 12 | Creating invoices, advance-paid validation, the verification workflow, rejection, stock status, direct invoices |
| `payment-approval.feature` | 15 | Payment requests, multi-step approval, partial payments, expenses, acknowledgement requirement, approval history |
| `gate-pass.feature` | 12 | Gate pass creation, OTP generation/verification/expiry/lockout, RTSP camera capture, manual video upload, cancellation |
| `inventory.feature` | 11 | Stock item creation, IN/OUT/ADJUST transactions, zero-quantity rejection, low-stock alerts, search/filter, transaction history |
| `site-operations.feature` | 13 | Before/during/after site photos, raising issues with addressees, scheduling and conducting inspections, checklists, re-inspections |
| `attendance.feature` | 11 | Adding company/labour staff, marking daily attendance, date-range reports, filtering by type/active status, deactivation |
| `push-notifications.feature` | 11 | Device subscription management, multi-device support, approval notifications, invalid token cleanup, Firebase-down resilience |
| `ocr-scanning.feature` | 10 | Photographing quotations/invoices for auto-fill, PDF scanning, unsupported file types, blurry photos, rate limits, compression |
| `audit-trail.feature` | 10 | CREATE/UPDATE/DELETE/APPROVE/REJECT logging, old+new value capture, project-scoped filtering, pagination, user attribution |
| `rbac-permissions.feature` | 11 | The permission matrix — who can do what: user management, budget editing, payment approval steps 1 & 2, unauthenticated denial |
| `cross-project-isolation.feature` | 11 | Project A users cannot see/affect Project B's data — vendors, payments, audit logs, dashboard, push, inventory, gate passes |

**Total: 165 simulation scenarios across 15 feature files.**

## How these relate to the automated tests

These feature files are **specifications**, not executable tests. They describe
*what* the system should do in plain English. The automated Vitest tests in the
parent directory (`*.test.ts`) verify *that* the system actually does it.

| Feature file | Corresponding test file(s) |
|--------------|---------------------------|
| `auth.feature` | `auth-guard.test.ts`, `auth-schemas.test.ts` |
| `vendor-management.feature` | `schema-validation.test.ts` (vendor schemas) |
| `quotation-flow.feature` | `approval-engine.test.ts`, `schema-validation.test.ts`, `e2e-vendor-po-invoice.test.ts` |
| `purchase-order-flow.feature` | `approval-engine.test.ts`, `e2e-vendor-po-invoice.test.ts` |
| `invoice-verification.feature` | `schema-validation.test.ts`, `e2e-vendor-po-invoice.test.ts` |
| `payment-approval.feature` | `approval-engine.test.ts`, `schema-validation.test.ts`, `acknowledgement-validation.test.ts` |
| `gate-pass.feature` | `otp-service.test.ts`, `camera-service.test.ts` |
| `inventory.feature` | `schema-validation.test.ts` (inventory schemas) |
| `site-operations.feature` | `schema-validation.test.ts` (issue/inspection schemas) |
| `attendance.feature` | `schema-validation.test.ts` (staff/attendance schemas) |
| `push-notifications.feature` | `push-service.test.ts` |
| `ocr-scanning.feature` | `ocr-service.test.ts` |
| `audit-trail.feature` | `audit-trail.test.ts` |
| `rbac-permissions.feature` | `rbac-adversarial.test.ts`, `cross-project.test.ts` |
| `cross-project-isolation.feature` | `cross-project.test.ts` |

## Can these be automated?

Yes. These Gherkin files are structured so they can be connected to
[Cucumber](https://cucumber.io/) or [CodeceptJS BDD](https://codecept.io/bdd/)
for end-to-end automated testing. Each `Given/When/Then` step would map to a
step-definition function that calls the API and asserts on the response.

To set this up in the future:

```bash
npm install --save-dev @cucumber/cucumber
# Create step definitions in tests/step-definitions/
# Run: npx cucumber-js tests/features/
```

## Glossary

| Term | Meaning |
|------|---------|
| **Project Head** | The top-level manager of a hospital construction project (can do everything) |
| **Head of Construction** | The construction lead (approves at step 2, can't edit budget) |
| **ADMIN** | An administrative approver (approves at step 1, can manage users) |
| **ADMIN_2** | A second administrative approver (approves at step 2, can manage users) |
| **Supervisor** | A site supervisor (creates vendors/quotations/POs, can't approve payments or manage users) |
| **Gate Pass** | A document authorizing a truck to enter/exit the site with materials |
| **OTP** | One-time password (4 digits) used to verify a gate pass at the gate |
| **PO** | Purchase Order — an official order to a vendor for materials |
| **Quotation** | A vendor's price quote for materials, which must be approved before becoming a PO |
| **Acknowledgement** | A legally-binding checkbox the user must check before creating or approving anything |
