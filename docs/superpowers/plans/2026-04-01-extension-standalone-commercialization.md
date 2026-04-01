# Extension Standalone Commercialization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the browser extension as a sellable standalone product that also integrates cleanly with Leadiya CRM, while preserving no-backend operation via Google Sheets/Webhook/CSV export.

**Architecture:** Keep one extraction core in `apps/extension`, standardize sink delivery behind a strict transport contract, and introduce runtime product profiles (CRM, Standalone, Offline). Add deterministic reliability and observability in the extension, then harden API contracts and release process.

**Tech Stack:** WXT (MV3), React, TypeScript, Chrome APIs (`storage`, `tabs`, `identity`, `downloads`), Hono API, BullMQ, Postgres/Drizzle, Vitest.

---

## PRD Scope Boundaries

### In Scope (v1 Commercial Standalone)
- Single extension package that supports:
  - CRM mode (`/api/leads/bulk`)
  - Standalone sink mode (Sheets + Webhook)
  - Offline/export mode (CSV/JSON only)
- Guided onboarding wizard for sink/profile setup and connection tests.
- Deterministic bulk scraping semantics (`maxPages` and progress behavior are unambiguous).
- Resilient delivery pipeline (retry/backoff/dead-letter + visible per-sink errors).
- Diagnostic bundle and support-ready logs.
- Basic license enforcement hook (feature flags by entitlement) without changing extraction core.

### Out of Scope (v1)
- Multi-browser parity beyond current WXT target.
- Full team workspace/roles in extension UI.
- Marketplace of third-party sinks.
- Deep CRM pipeline automation changes outside ingest contract.
- Full legal copy drafting (privacy policy, ToS text) beyond engineering checklists.

### Success Metrics
- New user connects Sheets-only flow and exports usable leads in <= 10 minutes.
- >= 95% successful sink delivery in nominal network conditions with no silent drops.
- Duplicate insert rate reduced versus current baseline for repeated card visits/autopilot.
- Support can diagnose failed runs from user-provided diagnostics without reproduction.

---

## Technical Spec (Implementation-Oriented)

## Chunk 1: Product Modes and Capability Flags

### Task 1: Introduce product profile model in extension settings

**Files:**
- Modify: `apps/extension/lib/sink-settings.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/lib/lead-types.ts`
- Test: `apps/extension/src/lead-queue.test.ts`

- [ ] **Step 1: Write failing tests for profile-aware settings defaults**

Create tests that assert default profiles:
- `crm` enables API sink by default.
- `standalone` enables Sheets/Webhook guidance defaults.
- `offline` enables local export path with network sinks disabled.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run -w apps/extension test -- lead-queue`
Expected: FAIL due to missing profile-aware behavior.

- [ ] **Step 3: Implement minimal profile model**

Add `productProfile: 'crm' | 'standalone' | 'offline'` and normalize persisted storage reads.

- [ ] **Step 4: Wire profile selector in popup settings**

Add profile selector and derive sink toggles from explicit user choice (do not auto-flip user overrides after first save).

- [ ] **Step 5: Run tests and typecheck**

Run:
- `npm run -w apps/extension test`
- `npm run -w apps/extension build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/lib/sink-settings.ts apps/extension/entrypoints/popup/App.tsx apps/extension/lib/lead-types.ts apps/extension/src/lead-queue.test.ts
git commit -m "feat(extension): add standalone product profiles and defaults"
```

### Task 2: Add capability flags (entitlement-ready)

**Files:**
- Create: `apps/extension/lib/capabilities.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Test: `apps/extension/src/capabilities.test.ts`

- [ ] **Step 1: Write failing tests for capability gating**
- [ ] **Step 2: Implement static capability resolver (`free`, `pro`, `business`)**
- [ ] **Step 3: Gate premium actions in popup with clear UX messaging**
- [ ] **Step 4: Run tests/build**
- [ ] **Step 5: Commit**

---

## Chunk 2: Sink Contract and Delivery Reliability

### Task 3: Define strict sink transport contract

**Files:**
- Create: `apps/extension/lib/sinks/transport.ts`
- Modify: `apps/extension/lib/sinks/flush-sinks.ts`
- Modify: `apps/extension/lib/lead-types.ts`
- Test: `apps/extension/src/sinks-transport.test.ts`

- [ ] **Step 1: Write failing contract tests**

Assert each sink returns per-item outcomes:
- `delivered`
- `retryable_error`
- `fatal_error`

- [ ] **Step 2: Implement typed result contract**
- [ ] **Step 3: Refactor existing sink functions to contract**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

### Task 4: Add retry/backoff and dead-letter queue

**Files:**
- Modify: `apps/extension/entrypoints/background.ts`
- Create: `apps/extension/lib/sinks/retry-policy.ts`
- Create: `apps/extension/lib/sinks/dead-letter.ts`
- Test: `apps/extension/src/sinks-retry.test.ts`

- [ ] **Step 1: Write failing tests for backoff and max-attempt behavior**
- [ ] **Step 2: Implement exponential backoff with jitter per sink**
- [ ] **Step 3: Move exhausted items to dead-letter storage**
- [ ] **Step 4: Expose dead-letter counts/status in `getStatus`**
- [ ] **Step 5: Run tests/build**
- [ ] **Step 6: Commit**

### Task 5: Add manual retry/dead-letter controls in popup

**Files:**
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/background.ts`
- Test: `apps/extension/src/popup-actions.test.ts`

- [ ] **Step 1: Write failing tests for retry/dead-letter actions**
- [ ] **Step 2: Add background actions (`retryDeadLetters`, `clearDeadLetters`)**
- [ ] **Step 3: Add popup controls + confirmation dialogs**
- [ ] **Step 4: Run tests/build**
- [ ] **Step 5: Commit**

---

## Chunk 3: Extraction and Bulk Determinism

### Task 6: Make bulk pagination semantics deterministic

**Files:**
- Modify: `apps/extension/entrypoints/content.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/lib/search-pagination.ts`
- Test: `apps/extension/src/content-pagination.test.ts`
- Test: `apps/extension/src/search-pagination.test.ts`

- [ ] **Step 1: Write failing tests for `maxPages` behavior**

Define expected behavior:
- exact page budget consumed
- deterministic stop conditions
- stable dedup of firm links across pages

- [ ] **Step 2: Implement single source of truth for pagination strategy**
- [ ] **Step 3: Ensure progress reporting aligns with link discovery and extraction**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

### Task 7: Harden extraction confidence and duplicate prevention

**Files:**
- Modify: `apps/extension/entrypoints/content.ts`
- Modify: `apps/extension/lib/lead-queue.ts`
- Modify: `apps/extension/lib/lead-types.ts`
- Test: `apps/extension/src/phones.test.ts`
- Test: `apps/extension/src/content-pagination.test.ts`

- [ ] **Step 1: Write failing tests for enhanced fingerprint/idempotency key**
- [ ] **Step 2: Add extraction metadata (confidence, extractionVersion)**
- [ ] **Step 3: Improve dedup key composition (name+url stem+geo/city fallback)**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

---

## Chunk 4: CRM/API Contract Hardening

### Task 8: Return per-item ingest results from `/api/leads/bulk`

**Files:**
- Modify: `apps/api/src/routes/leads.ts`
- Modify: `apps/api/src/leads-bulk.test.ts`
- Modify: `apps/extension/lib/sinks/flush-sinks.ts`

- [ ] **Step 1: Write failing API tests for per-item response schema**

Expected item result shape:
- lead fingerprint/id
- status: `inserted | updated | duplicate | rejected`
- message/error code when relevant

- [ ] **Step 2: Implement response schema and route behavior**
- [ ] **Step 3: Use per-item outcomes in extension sink event logging**
- [ ] **Step 4: Run tests**

Run:
- `npm run -w apps/api test -- leads-bulk`
- `npm run -w apps/extension test`

- [ ] **Step 5: Commit**

### Task 9: Strengthen extension-to-API auth mode handling

**Files:**
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `apps/extension/lib/sinks/flush-sinks.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Test: `apps/api/src/*auth*.test.ts` (or create if missing)

- [ ] **Step 1: Write failing tests for service-key and token pathways**
- [ ] **Step 2: Add explicit auth mode config (service key vs bearer token)**
- [ ] **Step 3: Ensure UX explains auth requirement when API rejects requests**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

---

## Chunk 5: Onboarding, Diagnostics, and Supportability

### Task 10: Build onboarding wizard

**Files:**
- Create: `apps/extension/entrypoints/popup/components/OnboardingWizard.tsx`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/background.ts`
- Test: `apps/extension/src/onboarding-wizard.test.tsx`

- [ ] **Step 1: Write failing tests for onboarding path by profile**
- [ ] **Step 2: Implement wizard steps**
  - mode select
  - sink setup
  - connection test
  - first scrape checklist
- [ ] **Step 3: Persist onboarding state and skip logic**
- [ ] **Step 4: Run tests/build**
- [ ] **Step 5: Commit**

### Task 11: Add diagnostics bundle export

**Files:**
- Modify: `apps/extension/entrypoints/background.ts`
- Create: `apps/extension/lib/diagnostics.ts`
- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Test: `apps/extension/src/diagnostics.test.ts`

- [ ] **Step 1: Write failing tests for diagnostics payload**
- [ ] **Step 2: Include version, profile, sink status, error history, dead-letter stats**
- [ ] **Step 3: Add JSON download action (support ticket ready)**
- [ ] **Step 4: Run tests/build**
- [ ] **Step 5: Commit**

---

## Chunk 6: Security and Permissions Cleanup

### Task 12: Minimize extension permissions and document rationale

**Files:**
- Modify: `apps/extension/wxt.config.ts`
- Modify: `apps/extension/.env.example`
- Create: `docs/security/EXTENSION_PERMISSIONS.md`
- Test: `apps/extension/.output/chrome-mv3/manifest.json` (verification artifact after build)

- [ ] **Step 1: Inventory currently used Chrome APIs and host access**
- [ ] **Step 2: Remove unnecessary permissions and narrow host permissions**
- [ ] **Step 3: Build and validate runtime behavior still passes smoke tests**
- [ ] **Step 4: Document each permission and justification**
- [ ] **Step 5: Commit**

---

## Jira-Ready Tickets (Epics and Stories)

### Epic E1: Product Modes and Entitlements
- EXT-101 Product profile model (`crm|standalone|offline`)
- EXT-102 Capability gating framework (`free|pro|business`)
- EXT-103 Settings migration for legacy users
- EXT-104 UX copy and profile onboarding prompts

### Epic E2: Delivery Reliability
- EXT-201 Sink transport contract with per-item outcomes
- EXT-202 Retry policy with exponential backoff/jitter
- EXT-203 Dead-letter queue and retry controls
- EXT-204 Delivery observability in popup and diagnostics

### Epic E3: Extraction Determinism
- EXT-301 Deterministic multi-page bulk semantics
- EXT-302 Progress model and cancellation reliability
- EXT-303 Enhanced duplicate prevention key
- EXT-304 Extraction confidence metadata

### Epic E4: CRM/API Contract
- API-401 `/api/leads/bulk` per-item response contract
- API-402 Auth mode clarity for extension clients
- API-403 Extension sink handling of per-item API outcomes

### Epic E5: Onboarding and Support
- EXT-501 Mode-first onboarding wizard
- EXT-502 Sink connection test suite in UI
- EXT-503 Diagnostics bundle export
- EXT-504 First-run success checklist

### Epic E6: Security and Release
- EXT-601 Permission minimization and manifest hardening
- EXT-602 Security review checklist for sinks/auth
- EXT-603 Packaging and release automation baseline
- EXT-604 Chrome Web Store submission assets and notes

---

## Release Checklist (Ship Gate)

### Functional
- [ ] Manual scrape works on firm pages across supported 2GIS domains.
- [ ] Bulk scrape respects configured `maxPages` deterministically.
- [ ] Autopilot does not create unacceptable duplicate rate under route churn.
- [ ] CRM mode ingestion succeeds end-to-end with clear user feedback.
- [ ] Standalone mode works with Sheets-only and Webhook-only configurations.
- [ ] Offline mode exports complete CSV/JSON from queue.

### Reliability
- [ ] Network failure triggers retry/backoff behavior (verified by tests).
- [ ] Dead-letter items are visible and retryable.
- [ ] No silent drop paths in sink delivery.
- [ ] Status telemetry and event logs reflect real state transitions.

### Security
- [ ] Manifest permissions reviewed and minimized.
- [ ] Sensitive tokens/keys handling reviewed.
- [ ] Webhook signing documented and tested.
- [ ] API auth rejection paths return actionable UI messages.

### Quality
- [ ] Extension unit/integration tests pass.
- [ ] API tests for `/api/leads/bulk` contract pass.
- [ ] Typecheck/build passes for `apps/extension` and `apps/api`.
- [ ] Smoke tests run on a clean Chrome profile.

### Product/Docs/Ops
- [ ] Onboarding flow copy finalized for CRM and standalone personas.
- [ ] User docs added: quickstart (CRM, standalone, offline).
- [ ] Troubleshooting doc includes diagnostics bundle instructions.
- [ ] Versioning/changelog prepared.
- [ ] Rollback plan documented.

---

## Execution Order Recommendation

1. E2 Delivery Reliability  
2. E3 Extraction Determinism  
3. E4 CRM/API Contract  
4. E1 Product Modes and Entitlements  
5. E5 Onboarding and Support  
6. E6 Security and Release

This order reduces data loss/dup risk first, then productizes packaging and go-to-market readiness.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-01-extension-standalone-commercialization.md`. Ready to execute?
