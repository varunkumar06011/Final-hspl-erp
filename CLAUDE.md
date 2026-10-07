# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Hospital Construction ERP: an npm-workspaces monorepo (`shared`, `backend`, `frontend`) covering procurement (MPR → quotation → PO → goods receipt → invoice → payment), finance/accounting (ledgers, vouchers, journal vouchers, budgets, bank/cash accounts), inventory/assets, site operations, and audit. The app root is `Final-hspl-erp/` (the outer `hospital-erp/` folder only wraps it).

## Commands

Run from the repo root (`Final-hspl-erp/`) unless noted.

```bash
npm run dev:backend        # tsx watch, API on :4000
npm run dev:frontend       # Vite on :5174 (proxies /api -> localhost:4000)
npm run build              # builds shared, then backend (prisma generate + tsc), then frontend
npm run typecheck          # tsc --noEmit in every workspace
npm run lint               # eslint . --ext .ts,.tsx
npm run format             # prettier (single quotes, semi, width 100, trailing commas)
npm run seed               # backend/prisma/seed.ts
npm test                   # backend vitest only (no frontend tests exist) -- see warning below
npm run i18n:check         # frontend en/te locale key check (run before finishing UI work)
```

Backend (from `backend/`):

```bash
npx vitest run tests/otp-service.test.ts                 # single test file
npx vitest run -t "name pattern"                         # single test by name
npx vitest run --exclude "**/e2e-real-*.test.ts"         # skip tests needing live Postgres
npx vitest run --config vitest.real.config.ts            # real-DB e2e (e2e-full-lifecycle + tests/scenarios), serial
npx prisma migrate dev                                   # create/apply migrations locally
```

**Warning:** the default `vitest.config.ts` includes every `tests/**/*.test.ts`, so a bare `npm test` / `vitest run` also runs `e2e-full-lifecycle` and `tests/scenarios`, which hit the real (shared hosted) DB. Run named test files instead.

Unit/logic tests mock Prisma; only the `e2e-real-*` / `vitest.real.config.ts` suites need Postgres at localhost:5432 (see `backend/tests/README.md`).

Requires Node 22.x (`.nvmrc`, `engines`). CI lives in `.github/workflows/` (`ios-build.yml`, `database-backup.yml`); there is no CI job for lint/typecheck/tests, so run `npm run typecheck`, `npm run lint` and the relevant vitest files yourself.

## Architecture

**Shared package (`shared/`)** is the contract between the two apps: enums (`UserRole`, approval statuses), `Permission` + `hasPermission`, `APPROVAL_CONFIG`/`APPROVER_ROLES`, socket events, and Zod schemas. Both apps alias `@hospital-erp/shared` directly to `../shared` source (vitest and vite configs), but the backend `build` compiles it first. Changing a role/permission/schema here affects both sides.

**Backend (`backend/src`)**: Express + Prisma (PostgreSQL) + Socket.io. `app.ts` builds the app (helmet, rate limit, `/health` with DB check), `index.ts` starts the server and the quotation-aging scheduler. All routes are mounted in `routes/index.ts` under `/api`.
- Auth: `middleware/auth.ts` verifies Firebase ID tokens (phone OTP login) and maps to a Prisma `User`; also enforces the Terms-accepted gate (`TERMS_NOT_ACCEPTED`). Outside production, `Bearer dev-token` (or `dev-token:<userId>`) resolves to a seeded user and skips the terms gate.
- Authorization: `rbacMiddleware(Permission)` checks role permissions from `shared`. Data is multi-project; handlers scope by `requireProjectId(req)` (`req.user.projectId`) — always filter queries by project.
- `utils/crudFactory.ts` (`createCrudRouter`) generates standard CRUD routers (auth, RBAC, Zod validation, search/sort/amount/date filters, audit logging) from a config with `transformCreate/afterCreate/...` hooks. Many `*.routes.ts` files use it; prefer it for simple entities.
- `services/approval.service.ts` is the generic multi-step approval engine keyed by `entityType` + `entityId`, with policies (`HEAD_GROUPS`, `PO_SINGLE_APPROVER`, `ANY_APPROVERS`, ...). Other services: audit logging, sequence numbers, in-app chat (`chat.service.ts` + `socket.ts`), PDF generation (pdfkit), OCR (tesseract + OpenAI) for invoices, push (Firebase) notifications, storage (local or Supabase via `STORAGE_MODE`).
- Deployment: Railway (`railway.json`); `npm start` runs `prisma migrate deploy` before `node dist/index.js`.

**Frontend (`frontend/src`)**: React 18 + Vite + MUI + React Query + Zustand. One file per screen in `pages/`; routing in `App.tsx`. `config/api.ts` is the shared axios instance (bearer token from `localStorage.firebaseToken`, global 401 → clear token and redirect to login, offline handling via `stores/networkStore`). `stores/authStore.ts` holds the user. Also packaged for iOS via Capacitor (`frontend/ios`, `capacitor.config.ts`, `.github/workflows/ios-build.yml`); storage access is wrapped in try/catch because iOS WebKit can block it. Vercel config in `frontend/vercel.json`.

## Notes

- Data model: `backend/prisma/schema.prisma` (~1700 lines) is the single source of truth for every entity and relation; read it before touching a query or writing a migration. Migrations live in `backend/prisma/migrations/`; assorted one-off scripts (backfills, `sql/`) also sit under `backend/prisma/`.
- Env vars: backend `.env` (`DATABASE_URL`, Firebase admin creds, `SUPABASE_*`, `STORAGE_MODE`, `JWT_SECRET`, `FRONTEND_URL`); frontend `.env.local` (`VITE_API_URL`, Firebase web config). `.env` files are gitignored.
- `backend/` contains many stray scratch files (`_prodtest*.txt`, `_checkdata.js`, `nul`); ignore them.
- `QA_Test_Plan.md` has manual/API/E2E test cases and role/user setup; DB backup/DR procedures are in `docs/`.

## Multi-project

One database hosts several completely separate projects (hospitals). Users, roles, PINs and logins are shared; **data is not**.

- The login page asks which project to enter first (`GET /projects/public`), and the app JWT carries a signed `projectId` claim. `authMiddleware` resolves `req.user.projectId` from it (falling back to `User.projectId` for old tokens or archived projects), so every handler keeps using `requireProjectId(req)`. `POST /auth/switch-project` re-issues the token; `useSwitchProject` + `utils/sessionCleanup.ts` clear caches and reload.
- Any ADMIN-type role (`Permission.MANAGE_PROJECTS`) creates/edits/archives projects on the Projects page (`/projects`). A new project starts empty.
- `Project.code` (e.g. `VGH`) prefixes every document number (`VGH-PO001`, `ABC-PO001`). Always generate numbers with `generateProjectSequenceNumber` / `generateVoucherNumber(type, projectId)` / `getProjectCode`, never a hard-coded prefix. The globally unique columns (`vendorCode`, `invoiceCode`, `paymentCode`, `jvNumber`, `assetId`) stay safe only because prefixes differ per project.
- Because users are shared, user lookups (approver roles, admins, push recipients) are **not** filtered by project; business rows always are. Never take a project id from the request body/query for data access.
- The backend `.env` points at the shared hosted database. Do not run `prisma db push`, `migrate reset`, seeds or the real-DB test suites against it; migrations are additive files applied with `prisma migrate deploy`.

## Global search

`GET /api/search?q=` (used by the top-bar search dialog) is backed by a read-only, in-memory index per project in `backend/src/services/search/`. It never writes to the database.

- **What is indexed comes from `schema.prisma`, not from a list.** `schemaGraph.ts` reads Prisma's model metadata: every table with `projectId` becomes a searchable record, every table without one that hangs off such a record (PO items, quotation items…) is folded into its parent's document, and comments/attachments fold into whatever record their `entityType`/`entityId` points at. New tables and columns are searchable after the migration with no code change.
- **`registry.ts` is the only manual part**: where a result opens (`path`), who may see it (`permission`, mirror the module's list endpoint), and `EXCLUDED_MODELS` for tables kept out on purpose. A table with no registry entry is still indexed but is shown to admin roles only and has no link; add a one-line entry when its page exists. `tests/search-schema.test.ts` fails if a new table is neither indexable nor excluded.
- Search is typo/partial-word tolerant, every typed word must match (best partial match otherwise), amounts and dates are matched in any common spelling, and a record is also found through the record it points at (a PO via its vendor's name). Records a role cannot see never lend text to others.
- Freshness: writes through this server refresh the affected record immediately (Prisma `$use` hook, plus a `$transaction` wrapper); a 60 s timestamp poll covers other writers; a 10 min id reconcile catches hard deletes; indexes rebuild after 3 h and idle projects are evicted. `SEARCH_WARMUP=false` skips the start-up warm-up.

## Internationalization (English / Telugu)

The frontend is bilingual via `react-i18next` (`frontend/src/i18n/`). A language toggle sits in the AppShell top bar and on the login page; the choice persists in `localStorage` (`appLanguage`).

- Never hardcode visible English in JSX. Use `useTranslation('<ns>')` and add the key to **both** `frontend/src/i18n/locales/en/<ns>.json` and `te/<ns>.json` (shared strings live in `locales/en.json` / `te.json`).
- Enum/status values go through `enumLabel()`, roles through `roleLabel()`, ledger groups through `ledgerGroupLabel()` (all in `utils/enumOptions.ts`). Use `dateLocale()` for `toLocaleString`/`toLocaleDateString`.
- Run `npm run i18n:check` before finishing UI work. It fails on en/te key mismatches or missing keys, and warns on hardcoded English (`--strict` makes warnings fail).
- Out of scope by design: PDF/CSV/print output, WhatsApp share text, legal pages, backend-supplied strings.

## AI assistant "Miko" (Telugu / English chat)

The assistant is branded **Miko** (UI strings in the `assistant` i18n namespace, system prompt in `engine.ts`). A chat drawer (`AssistantDrawer.tsx`, robot icon in the AppShell top bar) that reads records and prepares creates. Backend: `backend/src/services/assistant/` + `routes/assistant.routes.ts`, tests in `tests/assistant.test.ts`.

- **It never touches the database directly.** Every tool call is an HTTP call to this server's own `/api` carrying the user's own bearer token (`internalApi.ts`), so RBAC, project scoping, validation, approvals, sequence numbers and audit all apply unchanged. Loopback calls carry a per-process secret header so the rate limiter in `app.ts` skips them.
- **Create-only, by construction.** `tools.ts` is the whole capability list: read tools (`list_records`, `get_record`, `search_records`) and create tools (vendor, MPR, quotation, PO, goods receipt, invoice, stock entry). There is deliberately no approve/reject/pay/delete/cancel/update tool; a test fails if one is added. Adding a capability is a code change in `tools.ts`.
- **Propose → confirm.** A create tool validates args with the shared Zod schema, resolves labels via the API, and stores a `PENDING` row in `assistant_actions`; nothing is saved until the user confirms (`POST /assistant/actions/:id/confirm`), which replays it through the normal endpoint (adding `acknowledged: true` where the endpoint demands it). Proposals are per-user/project, expire after 30 min, and are claimed atomically (`EXECUTING`) so a double-click cannot create twice.
- Chat is stateless server-side: the client sends back the opaque `history` (sanitised in `sanitizeHistory`). Provider is OpenAI via `openai.ts` (model fixed to `gpt-5-mini` in code; `ASSISTANT_REASONING_EFFORT`, default `low`). The history stays in the neutral Gemini-shaped `ChatContent` format and is translated to Chat Completions messages there. OCR structuring (`services/ocr-openai.ts`, also fixed to `gpt-5-mini`) uses the same `OPENAI_API_KEY`.
- Env: `OPENAI_API_KEY` (funded account), optional `ASSISTANT_ENABLED`, `ASSISTANT_DAILY_LIMIT` (messages/user/day, default 150), `ASSISTANT_INTERNAL_URL` (default `http://127.0.0.1:$PORT`).
- **Photos always become one draft MPR / service request.** With a photo attached, `engine.ts` only allows `create_mpr` and keeps just `requestType`, vendor (`vendorId`, or `newVendor` which the MPR route creates inline), the items' name/qty/unit/rate and `description`; everything else is dropped. The photo is attached to the DRAFT on confirm (never submitted) and the Supervisor named Akhil is notified (`notify.ts`) to review, edit and submit it.
- UI labels for confirmation cards/tables are keys (`assistant` i18n namespace), not backend strings; add a key to both `en`/`te` when adding a tool field or list column.

## Per-user module access

Admin 1, Admin 2 and super admins can switch any module on or off per user (Module Access page, `/api/module-access`, `module-access.routes.ts`). Users keep their role's default sidebar until overridden.

- Rules live in `shared/access.ts` (module registry, role defaults, override resolution, grants, API write-block rule). Overrides are stored in the `users.moduleAccess` JSON column.
- `authMiddleware` folds module grants into the user's permissions and rejects writes into a switched-off module with `MODULE_DISABLED`. Admin 1 / Admin 2 / super admins are never restricted.
- The sidebar, route guard, top bar, transaction register and global search all honour the overrides, and open sessions refresh via a socket event. When adding a module, register it in `shared/access.ts`.

## Procurement flow notes

- **Auto PO.** A quotation raised from an approved MPR is auto-approved, and `services/po-from-quotation.service.ts` immediately creates its PO as `PENDING_APPROVAL` (payment type `AFTER_DELIVERY`, no budget head). Nobody presses "Generate PO". Budget head and payment type are set afterwards with `POST /purchase-orders/:id/change-budget-head` and `/change-payment-type`; both work while pending and after approval and **never** send the PO back for approval (an approved PO that had no head is committed to the budget when the head is first set).
- **Super admin (`'*'`).** `findApprovableStep`, `isWorkflowOpenToRole` and `isModuleEnabled` (all in `shared/`) honour the override: any step, any order, every module. One approval by a super admin settles the whole workflow (`approvalService.approve` chains through the remaining steps, each audited as an override). Frontend pages must pass `user.extraPermissions` to `hasPermission` / `canOverrideApprovals`.
- **Notifications.** The person who approved/rejected is excluded from the push about their own action (`excludeUserId` on `notifyAllHeads` / `notifyApprovers`).
- **Contracts live inside Purchase Orders** (Contracts tab, `?tab=contracts`; `GET /purchase-orders?kind=contract`). Sub-POs are numbered `<contract>-SUB01`. The old `/contracts` page redirects there; the standalone `contracts` module has no page of its own any more.
- **Approval timing.** `components/ApprovalTiming.tsx` shows how long the Project Head / Head of Construction took, then how long the admins took (admin clock starts at the head's approval).
- **Repeat shipments.** MPR list/get responses carry `shipmentNo` / `shipmentFlags`: same vendor + same material (by name) requested again is the 2nd, 3rd... shipment.
- **Materials.** `GET /material-purchase-requests/material-catalog` feeds the material type-ahead; MPR create/update (`canonicalizeMaterialCodes`) forces a material that already exists to reuse its existing code.
- **Fuzzy search.** `shared/fuzzy.ts` (`fuzzyFilter`) tolerates typos and spelling variants (lakshmi/laxmi). Vendor pickers use `components/VendorAutocomplete.tsx`; `createCrudRouter` takes `fuzzyFields` to retry a list search fuzzily when nothing matches. `hooks/useUrlState.ts` batches same-tick writes (react-router's functional `setSearchParams` otherwise drops the first one: this was why list searches did nothing).

## Locked documents

General documents (Documents → General) can be PIN-locked. The uploader sets a personal 6-digit **document PIN** (`users.documentPinHash`, separate from the login PIN; change needs the old PIN, or the login PIN to reset). A locked document (`documents.isLocked`) is masked in the list (no name for others, no description/file/people) until `POST /documents/:id/unlock` is called with the uploader's PIN; that returns a 15-minute token (own secret, not a login token) sent back as `x-doc-unlocks` (list) / `x-doc-unlock` (file). The `Document` model is excluded from global search so locked names cannot leak.
