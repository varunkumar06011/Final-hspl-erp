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
npm test                   # backend vitest only (no frontend tests exist)
```

Backend (from `backend/`):

```bash
npx vitest run tests/otp-service.test.ts                 # single test file
npx vitest run -t "name pattern"                         # single test by name
npx vitest run --exclude "**/e2e-real-*.test.ts"         # skip tests needing live Postgres
npx vitest run --config vitest.real.config.ts            # real-DB e2e (e2e-full-lifecycle + tests/scenarios), serial
npx prisma migrate dev                                   # create/apply migrations locally
```

Unit/logic tests mock Prisma; only the `e2e-real-*` / `vitest.real.config.ts` suites need Postgres at localhost:5432 (see `backend/tests/README.md`).

## Architecture

**Shared package (`shared/`)** is the contract between the two apps: enums (`UserRole`, approval statuses), `Permission` + `hasPermission`, `APPROVAL_CONFIG`/`APPROVER_ROLES`, socket events, and Zod schemas. Both apps alias `@hospital-erp/shared` directly to `../shared` source (vitest and vite configs), but the backend `build` compiles it first. Changing a role/permission/schema here affects both sides.

**Backend (`backend/src`)**: Express + Prisma (PostgreSQL) + Socket.io. `app.ts` builds the app (helmet, rate limit, `/health` with DB check), `index.ts` starts the server and the quotation-aging scheduler. All routes are mounted in `routes/index.ts` under `/api`.
- Auth: `middleware/auth.ts` verifies Firebase ID tokens (phone OTP login) and maps to a Prisma `User`; also enforces the Terms-accepted gate (`TERMS_NOT_ACCEPTED`). Outside production, `Bearer dev-token` (or `dev-token:<userId>`) resolves to a seeded user and skips the terms gate.
- Authorization: `rbacMiddleware(Permission)` checks role permissions from `shared`. Data is multi-project; handlers scope by `requireProjectId(req)` (`req.user.projectId`) — always filter queries by project.
- `utils/crudFactory.ts` (`createCrudRouter`) generates standard CRUD routers (auth, RBAC, Zod validation, search/sort/amount/date filters, audit logging) from a config with `transformCreate/afterCreate/...` hooks. Many `*.routes.ts` files use it; prefer it for simple entities.
- `services/approval.service.ts` is the generic multi-step approval engine keyed by `entityType` + `entityId`, with policies (`HEAD_GROUPS`, `PO_SINGLE_APPROVER`, `ANY_APPROVERS`, ...). Other services: audit logging, sequence numbers, PDF generation (pdfkit), OCR (tesseract/Gemini) for invoices, push (Firebase) notifications, storage (local or Supabase via `STORAGE_MODE`).
- Deployment: Railway (`railway.json`); `npm start` runs `prisma migrate deploy` before `node dist/index.js`.

**Frontend (`frontend/src`)**: React 18 + Vite + MUI + React Query + Zustand. One file per screen in `pages/`; routing in `App.tsx`. `config/api.ts` is the shared axios instance (bearer token from `localStorage.firebaseToken`, global 401 → clear token and redirect to login, offline handling via `stores/networkStore`). `stores/authStore.ts` holds the user. Also packaged for iOS via Capacitor (`frontend/ios`, `capacitor.config.ts`, `.github/workflows/ios-build.yml`); storage access is wrapped in try/catch because iOS WebKit can block it. Vercel config in `frontend/vercel.json`.

## Notes

- Env vars: backend `.env` (`DATABASE_URL`, Firebase admin creds, `SUPABASE_*`, `STORAGE_MODE`, `JWT_SECRET`, `FRONTEND_URL`); frontend `.env.local` (`VITE_API_URL`, Firebase web config). `.env` files are gitignored.
- `backend/` contains many stray scratch files (`_prodtest*.txt`, `_checkdata.js`, `nul`); ignore them.
- `QA_Test_Plan.md` has manual/API/E2E test cases and role/user setup; DB backup/DR procedures are in `docs/`.
