# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Updated only three locked Express transitive packages: `body-parser` 2.3.0 → 2.4.0, `proxy-addr` 2.0.7 → 2.0.8 and `qs` 6.16.0 → 6.16.1. Preserved direct dependency ranges, unrelated platform metadata and CI thresholds. A clean install passed the production dependency audit with zero findings; full development-tool auditing remains separate. Recorded fresh verification and limitations in `docs/DEPENDENCY_SECURITY_CLOSEOUT_2026-10-29.md`.

### Added

- Restricted new pilot consent, capture resume and observation writes to the explicit pilot build, including stale tickets and asynchronous completion. Ordinary builds retain business actions and existing pilot export/withdrawal management without pilot reason prompts. Clarified product-usability-only purpose, browser/origin data-loss boundaries and pending remote/JSON collection decisions in `docs/PILOT_EXPOSURE_POLICY_2026-10-29.md`. Preserved the pre-policy 53-file state in a local WIP commit; no push, deployment or participant launch is claimed.

- Added an actual pilot-artifact cooking-to-manual-export browser check, preserving unknown usage without consuming stock and excluding source/private fixture fields. Revalidated the existing local pilot and documented the current source/deployment mismatch, cloud-selected SEO config check and reauthentication gate in `docs/PILOT_PREVIEW_RESUME_2026-10-17.md`; no remote release or participant launch is claimed.

- Added optional fixed-choice reasons for saved meal replacement, skipping and explicitly reported uncooked past confirmed meals. Kept one-time reasons in the consent-gated local pilot export rather than recipe snapshots or lasting preferences, with strict v2 change events and backward-compatible v1 reading. Preserved unanswered choices, failed-save truth, business writes when feedback is invalid, and keyboard focus after replacement. Documented pilot decision criteria, OCR measurement and Preview access/rollback gates in the 2026-10-04 pilot records.

- Added an explicit local-only pilot build policy: new weekly meal candidates are limited to six conditionally source-quantity-reviewed dinners, while ordinary builds and stored historical plans retain the full catalog. Added review-scope notices and kept unmeasured process inputs and original quantities intact. Recorded the approved policy in `docs/PILOT_MENU_REVIEW_POLICY_2026-09-29.md`; this does not constitute full cooking/nutrition review or a deployed participant pilot.
- Added `build:pilot` with isolated build inputs, separate `dist-pilot` output and client guards against backend, analytics, ads, external AI and remote correction learning. Added an exclusive-output Preview config generator without changing production `vercel.json`; reject Production targets and dotenv-only pilot activation. Preserved local OCR/manual export and documented remote routing, participant URL and rollback checks still required in `docs/PILOT_LOCAL_BUILD_2026-09-29.md`.

- Preserved the 204 pending files in 17 ordered, hash-verified functional commits and retained main's AdSense/exercise documents. Fresh precommit checks passed 2,989 unit/integration tests, 107 browser tests, 48 overlapping built-preview tests, lint and build; recorded release gates separately in `docs/RELEASE_CLOSEOUT_2026-09-29.md` without claiming remote CI, deployment or real-user pilot completion.

- Recorded six real query/commit/rollback checks of the current root Prisma adapter in two fresh, private-socket PostgreSQL 16 fixtures. Preserved the initial sandbox failure and the fifth original SQL migration's missing-pgvector failure; this is not full schema, RLS, Prisma migration-engine, auth or deployment validation. No application/dependency changes; see `docs/PRD_V3_LOCAL_POSTGRES_2026-09-29.md`.

- Connected the public About page to guest weekly planning and recipe browsing, and aligned the header, footer and home/About metadata around 오늘뭐먹지 (FridgeMate), weekly dinners, shopping and actual cooking. Preserved the existing preferred site name/alternate names, private-route noindex, data policies and source recipe markup. Added real HTML/client-preview consistency and guest introduction/privacy browser coverage. Public HTTP/search observations are separate from deployment, ranking or conversion claims; see `docs/PRD_V3_PUBLIC_INTRO_2026-09-28.md`.
- Connected the opt-in local meal-plan pilot at `/pilot`: explicit consent/resume/withdrawal, manual browser-scoped JSON download, and a paused/unknown observation notice without enabling general analytics or automatic uploads. Recorded real plan, shopping, receipt, cooking and consumption outcomes in a separate bounded collector; preserved stable retry identities, atomic correction batches, legacy consent/history, 35-day expiry and business success when observation fails. Kept known outcomes within incomplete observation intervals without treating missing data as non-use. See `docs/PRD_V3_PILOT_CONNECTION_2026-09-28.md`; real participants, release QA and reviewed-menu expansion remain pending.
- Added explicitly confirmed local OCR correction recovery without clearing inventory, meal plans, current review edits or server records. Kept inspection read-only, scoped one-use confirmation to the inspected source, removed guest legacy data before the current map, and reported changed/unavailable/partially verified resets without claiming success. Preserved existing account cleanup and normal learning contracts; localStorage checks are not an atomic cross-tab transaction. See `docs/PRD_V3_CORRECTION_RECOVERY_2026-09-28.md`.
- Prioritized a guest-accessible weekly-plan entry on the home screen while preserving optional manual/OCR entry and public recipe exploration. Distinguished unregistered ingredients from physical absence and labelled shopping/change previews as calculations against registered inventory, without changing quantities or persistence. Added first-entry and unknown-package/OCR-failure browser coverage. See `docs/PRD_V3_FIRST_PLAN_2026-09-28.md`; atomic OCR replacement/retry and pilot collection remain separate work.
- Added atomic actual-consumption correction with an explicit before/after stock review. Kept the initial cooking fact/time and later receipts, linked inverse/replacement history without rewriting it, and made subsequent reversal use only the latest consumption. Protected zero-use correction, idempotent retries, stock/slot conflicts, all-store rollback and account/focus acknowledgement boundaries. No schema, dependency, sync or deployment change. See `docs/PRD_V3_CONSUMPTION_CORRECTION_2026-09-28.md` for verification and remaining PRD work.
- Added overdue-confirmed meal holds (AT-18), all-week confirmation notices, explicit forward-only resolution moves, and scoped restoration of drafts that conflict after midnight. Kept original recipe quantities, future draft edits, actual stock and existing history intact. Separated overdue confirmations from new purchase options and invalidated stale day-dependent views without discarding acknowledged writes. See `docs/PRD_V3_OVERDUE_AND_CONSENT_2026-09-28.md` for current-stock hold semantics, tests and remaining PRD work.
- Guarded analytics dispatch by consent generation, cancelled withdrawn queued work, attempted in-flight aborts, and synchronized other-tab withdrawal without reviving failed local choices. Also guarded auth/sync metadata storage getters during startup; this does not cover every settings write or erase already accepted server events. No deployment or pilot collection was enabled.
- Added local pilot consent/withdrawal storage, strict single-browser export validation and explicit offline analysis mode. IndexedDB v7 preserves the six operational stores and adds an isolated pilot store; startup expiry checks all existing account/guest databases after 35 days without blocking application use. Local aliases are explicitly not unique accounts. Collection and consent/download UI remain unconnected; observation-loss handling is still required. See `docs/PRD_V2_PILOT_CONTROLS.md` for boundaries and verification.
- Added a strict purpose-specific pseudonymous pilot-file contract, offline aggregate-only KPI calculator and exclusive-file CLI with a synthetic worked example. Distinguished account/guest scopes, cooking versus consumption reversal, observation gaps, mature cohorts, 72-hour boundaries and historical cutoffs. Added an isolated Chromium benchmark of actual generation/replacement/future-shopping calculations with source hashes and raw samples; the current 22-template catalog does not satisfy the 30-reviewed-template target. No collection, consent UI, central analytics, dependency change or deployment was enabled. See `docs/PRD_V2_PILOT_FOUNDATION.md` for test-first evidence, measured scope and remaining B5 work.
- Added explicit date moves/cross-week swaps and remaining-week readjustment with unsaved before/after menu, quantity and whole-future-shopping comparisons. Confirmed all affected weeks atomically, retained prior confirmations, protected locked/cooked/skipped/past meals, and left physical stock and shopping records unchanged. Rejected stale snapshots, contradictory cooking history and excluded-ingredient conflicts, including the existing draft-confirmation path. Added pantry-change race protection and test-first domain/storage/UI coverage; see `docs/PRD_V2_PLAN_CHANGES.md` for final verification, preserved intermediate failures and remaining PRD scope. No deployment occurred.
- Connected weekly cooking to explicit actual-usage review, unknown-usage recording, completed-meal display and separate stock/cooking reversal confirmations, including history after plan deletion. Added a single-transaction read workspace, scoped stale-response protection, dependent-view refresh after acknowledged writes, and keyboard focus recovery without duplicate error alerts. Verified 1,819 unit/integration cases, all 47 browser cases without retries, lint, build and 113 public routes; retained test-first failures and initial browser test-procedure errors in `docs/PRD_V2_COOKING_UI.md`. Local-only; no deployment or full PRD completion is claimed.
- Added atomic local cooking/actual-consumption recording, idempotent replay, separate stock and cooking reversals, unknown-usage propagation, immutable event-link validation, and completed-meal protection including plan deletion/recreation. Reused IndexedDB v6 without a migration or dependency change. Test-first integration plus fault injection verifies later receipts, account isolation and rollback; UI commands and AT-07/08/14 end-to-end completion remain pending. See `docs/PRD_V2_COOKING_STORAGE.md`; this is not deployed.
- Added pure measured-consumption and inverse-delta preparation, guarded by current quantity reviews, scoped source/revision checks, compatible units and nonnegative stock. Added 58 test-first cases; storage, cooking UI and idempotent application remain pending. Recovered the partial PRD worktree into a new isolated checkout, retained source snapshots, and revalidated 1,529 unit/integration cases, 42 browser cases, lint and build. See `docs/PRD_V2_CONSUMPTION_PREPARATION.md`; no production deployment occurred.
- Added explicit purchase receiving from immutable shopping notes: user-confirmed actual amounts, unknown-package preservation, one receipt per scoped purchase note, and atomic stock/quantity/event writes in IndexedDB v6. Refreshed inventory and invalidated stale meal-shopping previews after receipt; preserved purchased stock and history after skipped dinners. Extended account cleanup to six stores. Final checks passed 1,471 unit/integration cases, an unchanged full browser recheck of 42 cases, lint and build; two initial browser timeouts and earlier test-setup failures remain recorded in `docs/PRD_V2_PURCHASE_RECEIVING.md`. Cooking, measured consumption and inverse-event undo remain pending.
- Expanded the source-compared whole-bowl catalog from two to six dinners using four more visually checked MFDS book spreads. Preserved original one-person rows, preparation states and every unmeasured soaking/boiling/slurry input. Added reviewed taste-exclusion names without changing global aliases, scoring weights or quantitative identity; versioned the expanded catalog and exclusion engine. Generation, persistence, read-only allocation and mobile reload passed 1,438 unit/integration and 41 browser cases plus lint/build. See `docs/PRD_V2_DINNER_EXPANSION.md` for evidence, intermediate failures and remaining PRD scope; this is not cooking or nutrition certification.
- Added source-separated manual shopping and immutable purchase notes to the ingredient and weekly-plan screens, backed by IndexedDB v5. Preserved notes/checks after plan changes, enforced scoped revision checks and idempotent purchase-note retries, and extended atomic account cleanup to five stores. Notes do not receive stock or reduce shortages. With the source-reference follow-up, final checks passed 1,410 unit/integration and 39 browser cases plus lint/build; mobile sizing, earlier failures and remaining boundaries are recorded in `docs/PRD_V2_SHOPPING_NOTES.md`. Actual receiving follows above; measured consumption remains pending.
- Connected two source-compared whole-bowl dinners to generation, replacement, serving details, persisted confirmations and quantity-aware shopping. Preserved the sixteen unverified editorial templates and original one-person rows; retained unmeasured process water as unresolved demand. Recorded generation versions/minimal replay input, rejected malformed detail records, and distinguished original recipe amounts from selected servings. All 1,350 unit/integration and 38 browser tests pass; see `docs/PRD_V2_REVIEWED_DINNERS.md`. This is not full PRD completion, cooking/nutrition certification or deployment.
- Added local inventory quantity confirmation with separate IndexedDB v4 records, atomic raw-change invalidation, source/revision conflict checks, scoped save/revoke UI and same-transaction meal-shopping projection. Connected atomic account cleanup including corrupt review records, rejected unsafe precision and malformed scope/unit inputs, and preserved raw inventory and repurchase notes. That phase passed 1,307 unit/integration tests; see `docs/PRD_V2_INVENTORY_QUANTITY.md`. Purchasing and measured consumption remain pending; dinner integration follows above.
- Added a read-only meal shopping preview backed by one scoped inventory/plan snapshot and chronological allocation across all future confirmed weeks. Separated verified shortages, unresolved source rows and unselected options without writing inventory or repurchase notes. Added uncertainty propagation, expiry/identity/unit/precision checks, snapshot isolation and browser coverage. Existing raw quantity labels and the 16 unreviewed dinner compositions remain unverified; subsequent quantity-confirmation integration is recorded above.
- Added an isolated PRD v2 quantity-contract module and test-first coverage for reviewed serving conversion, compatible source-row sums, unknown quantities, partial totals, and precision limits. Existing recipe sources, recommendation rules, inventory, and UI are unchanged; quantitative catalog review and shopping integration remain pending.
- Added four separately source-compared MFDS recipe components with pinned source snapshots, book-page serving evidence, preserved ingredient purposes and unresolved amounts, and fail-closed source-drift checks. These are not complete quantified dinner templates and are not yet connected to generation, stock, or shopping. Added full-row transcription and source-reference regression checks.
- Separated weekly meal-plan drafts from explicit confirmations using a versioned record in the existing local store. Preserved legacy plans as unconfirmed drafts, archived replaced confirmations, and enforced exact revision checks. Added confirmation/replacement UI with read-only current-plan summaries, keyboard focus recovery, race/corruption guards, and browser regression coverage. Confirmation does not allocate or consume inventory; quantity-aware shopping remains pending.
- Added the dated AdSense follow-up and separate recommendation-exercise archive notes, clarified historical versus current release status, and linked the records without importing the intentionally failing practice code into main.
- Added explicit public recipe quick picks from the best ingredient matches, repeat exclusion, filter resets, and exact preparation links without inventory writes; includes component and desktop/mobile journey coverage.

- Restored 100 public recipe details, six ingredient hubs, two guides, and 113 prerendered routes on the latest security baseline. Added ingredient exploration before signup or inventory registration, exact recipe links, and an opt-in preparation checklist without automatic inventory writes.
- Added reviewed selection, preparation, and substitution notes for six recipes, comparisons for tofu and mushroom hubs, and two complete leftover-ingredient examples. Added desktop/mobile public-flow coverage and a deployment verifier that compares live page bodies, metadata, links, sitemap entries, and real 404 responses with the current build.
- Added a local-first weekly dinner planner at `/meal-plan` with 16 source-qualified menu compositions, 1–2-person preferences, ingredient exclusions, meal-date expiry matching, replacements, locks, skipped-day restoration, and non-quantitative food-group guidance.
- Added scoped IndexedDB v3 meal-plan storage with ingredient- and daily-menu-preserving upgrades, blocked-tab recovery, stale-write rejection, account-deletion cleanup, and explicit local-only/no-inventory-deduction boundaries.
- Added meal-plan domain, persistence, hook and browser regression coverage; kept the new personal route out of public SEO output and documented deferred shopping, measured consumption and nutrition work.

- Added a reproducible MFDS/MAFRA recipe dataset validation script and an evidence-backed source-selection report for Korean home-cooking candidates.
- Added a cost-controlled daily production database backup workflow that validates the pinned Supabase owner/TLS target, verifies a custom-format dump, encrypts it to an offline recovery key, uploads only ciphertext with a checksum, and expires GitHub artifacts after 14 days.
- Added a read-only Free-plan backup preflight that validates the exact Supabase project and session/direct host, requires an empty encrypted output directory outside the repository, detects missing CLI/Docker prerequisites, and never prints the database URL or password.
- Added a local-first daily menu decision loop with Korean calendar dates, one menu per user/day, explicit completion and cancellation, guest import, IndexedDB persistence, and retryable server writes.
- Added authenticated pantry ownership and lightweight preference storage, structured preference-aware recommendation reasons, and bounded idempotent product-event ingestion.
- Extended recommendation events with select, dismiss, external-open, and completion actions, client-generated idempotency keys, safe catalog recipe links, and aggregate funnel/join auditing in the training export.
- Added staging-only Cloudflare configuration guidance and a semantic release/rollback runbook that forbids production user-data copies and keeps AdSense disabled.

### Changed

- Extracted account privacy UI and recipe request validation, and shared the existing linked-store and embedding-check transaction plumbing without changing public APIs, authorization, scoring, schema, or transaction semantics. Added 42 behavior-preservation tests; the final 2,246 unit/integration and 52 browser cases pass. Recorded audit coverage and three independently reproduced pre-existing error-boundary issues separately in `docs/CODEBASE_REFACTOR_2026-09-28.md`.
- Separated weekly meal editing/display from the page workspace and centralized existing pilot timestamp/retention/version primitives without changing state keys, transaction boundaries, error contracts, or product behavior. Compared the current implementation with the supplied PRD v3; overdue-plan holds, atomic consumption corrections and first-entry gaps remain explicit follow-up work rather than being silently included in this refactor. See `docs/PRD_V3_ALIGNMENT_AND_REFACTOR.md`.
- Updated recipe-search documentation to separate historical staged-backfill checkpoints from the final 1,166-current-vector state.

### Fixed

- Keep a skipped legacy dinner unchanged, and show the candidate-policy limitation rather than a restore-success notice, when the pilot has no eligible replacement under the user's exclusions.

- Bound the consent E2E analytics interceptor to HTTPS Google hostnames, and opened offline pilot inputs nonblocking before descriptor validation to avoid a pathname-check/FIFO-open race. Added reproduced spoof-URL and real FIFO regressions while retaining file/link/size/read-integrity/output protections. Recorded the distinct CodeQL result gate and the existing Preview-to-production redirect limitation; deployment settings are unchanged.

- Scoped three asynchronous overdue/cooking integration-test waits to their owning regions, retaining exact accessible names/messages, global uniqueness checks, real IndexedDB, StrictMode, original deadlines and all stock/reload assertions. Recorded timing probes, missing/duplicate-output controls and intermediate failures separately; this is test-query overhead reduction, not a runtime behavior or deployment change. See `docs/PRD_V3_OVERDUE_TEST_DIAGNOSTICS_2026-09-29.md`.
- Guarded account export downloads and privacy form state by browser page lifetime and authentication generation, including same-account re-entry and lazy route transitions. Blocked synchronous login/signup submissions and abandoned-page completion navigation while retaining explicit failure retries and normal authenticated redirects. Server-side requests and cookies already in flight are not cancelled by these UI guards.
- Added keyboard main-content navigation and photo selection, accurate current-route semantics, persistent named status feedback, field-specific cooking errors, and guarded post-save focus restoration. Prevented competing account privacy submissions and moved analytics consent out of the mobile content overlay without changing consent/storage policy. All 2,956 unit/integration tests, 101 development browser cases, 45 overlapping built-preview cases, lint and build pass; real devices, assistive technology and full accessibility conformance remain unverified. See `docs/PRD_V3_ACCESSIBILITY_2026-09-28.md`.

- Made browser fixtures finish IndexedDB preparation before app startup and reject failed writes or blocked deletion instead of marking setup successful. Added two browser regressions, a separate built-artifact preview gate, and explicit offline Prisma validation/generation in CI. A fresh macOS dependency install passes all 2,922 unit/integration tests, 91 development-server browser tests, 35 overlapping built-preview cases, lint and build. App implementation, dependency versions, lockfile and schema are unchanged in this phase; Linux CI and actual database queries remain unverified. See `docs/PRD_V3_CLEAN_INSTALL_2026-09-28.md`.

- Distinguished inventory read failures from empty stock, connected explicit recovery on home/menu/inventory screens, and locked failed or missing edit lookups while preserving failed-save input. Protected scoped/partial snapshots and overlapping rollbacks; fenced stale authenticated retries, account actions, guest imports and manual sync dispatch around observed account transitions. Added 104 unit/integration and 7 browser regressions; all 2,922 unit/integration tests, 89 browser tests, lint, build and 113 public routes pass. See `docs/PRD_V3_INVENTORY_AUTH_2026-09-28.md` for evidence, restoration and limits, including already-started work and late server cookies; this is not an operational deployment or complete account-isolation proof.

- Preserved saved pantry/preferences on local write failure, exposed unreadable settings without overwriting their raw data, and added explicit retry feedback in both recipe-page pantry branches and account preferences. Removed I/O from React state updaters, blocked duplicate submissions, and rejected stale local response application after account or storage changes. Kept remote failure distinct from acknowledged saves whose local cache update failed. See `docs/PRD_V3_PERSONALIZATION_STORAGE_2026-09-28.md` for verification and remaining API retry/whole-app storage boundaries; no deployment occurred.

- Made reviewed OCR additions, explicitly selected replacements and quantity-review invalidation atomic in the existing local stores. Kept prepared request IDs/timestamps for acknowledgement retries, rejected stale replacement snapshots, and fenced account/file responses and duplicate submissions. Added in-place inventory rechecking and a fully readable mobile replacement warning. Inventory acknowledgement precedes best-effort learning and analytics; separate image parses are not globally deduplicated. See `docs/PRD_V3_OCR_ATOMIC_IMPORT_2026-09-28.md` for regression evidence and remaining work.
- Propagated shopping-save failures to preserve drafts and show truthful status; isolated corrupt/unavailable OCR correction storage from inventory saves without overwriting damaged source data; and blocked new analytics in the current document when consent persistence or cleanup fails. Added test-first utility, real-storage UI and browser regressions while preserving normal flows. See `docs/PRD_V3_STABILITY_2026-09-28.md` for evidence and limits; this does not enable pilot collection or change meal allocation, schema, dependencies or deployment.
- Refreshed inventory after an acknowledged purchase receipt even when a focus event invalidates the receipt form, while preserving account/reset/unmount stale-response guards. Added real-storage regression coverage for the committed-stock/stale-parent discrepancy.
- Separated shopping row IDs from complete plan-version/slot references so long future schedules no longer exceed the identifier cap. Verified 104 weeks/728 arithmetic-fixture dinners, immutable pre-edit purchase evidence, nested input capture, malformed-reference rejection and unchanged legacy purchase retries without a database migration or new dependency.
- Stabilized menu-decision service tests with a controlled clock and sync-window boundary coverage; production date validation is unchanged.

- Restored the reviewed-local-file public recipe import after catalog recovery regressed to direct network writes, retaining pinned regular-file checks and bounding network previews.
- Restricted deployment reports to comparison summaries without remote strings, required exclusive new JSON files, and bounded response bodies and same-origin redirects.

- Distinguished empty inventory, pantry-only ownership, missing required groups, unknown ingredients, and missing seasonings in recommendation readiness. Preserved supplemental seasoning lists and source identifiers through recommendation adapters, and limited internal links to verified catalog identities.
- Pinned the production backup job to PostgreSQL 17 client binaries so `pg_dump` matches the Supabase PostgreSQL 17 server instead of aborting with the Ubuntu runner's default PostgreSQL 16 client.
- Split the pending event-retention indexes into single-statement concurrent migrations, separated Ingredient CHECK validation from its short nullable-column lock, made Supabase function hardening fail closed on owner mismatch, and ignored common plaintext database-dump artifacts.
- Moved shared client rate limits ahead of access-token and revocation checks, then kept per-user limits after authentication so forged or anonymous requests cannot trigger unbounded security-store work.
- Made logout verify and revoke both cookie and Bearer access tokens independently so an invalid Bearer value cannot hide a valid cookie token, and hardened product-event property normalization against inherited or attacker-selected object keys.
- Pinned reviewed recipe input and the fixed public-catalog output to verified regular-file handles, rejecting symlinked directories and hard links so path swaps cannot redirect reads or writes.
- Normalized the Cloudflare training-crawler WAF rule with `lower(http.user_agent)` for GPTBot, CCBot, and Google-Extended, closing lowercase and mixed-case User-Agent bypasses while preserving search-crawler access.
- Replaced attacker-controlled unknown URL segments in request telemetry with fixed `/api/unknown` or `/unknown` groups so 404 probes cannot inject personal data or unbounded labels into platform logs.
- Removed per-request reads and deletes of legacy raw Redis auth keys so login email, client addresses, and token IDs never re-enter Redis commands after opaque-key migration.
- Clear the in-memory analytics event buffer, Google Analytics loader, `dataLayer`, `gtag`, and readable GA cookies when consent is withdrawn, in addition to deleting local identifiers and denying future storage.
- Added end-to-end deadlines for OpenAI and Anthropic requests, sanitized provider failures without reading error bodies, and gave the operator embedding backfill a bounded per-attempt timeout.
- Made MFDS recipe seeding and ingredient parsing dry-run by default, gated writes behind an exact Supabase project-ref confirmation, restricted source fetches and redirects to the trusted HTTPS origin with bounded schema validation, and moved parser dry runs and training exports to anon-only public reads.
- Scrubbed ingredient business payload immediately when creating server or IndexedDB deletion tombstones, made deletion terminal across sync and concurrent writes, sanitized legacy tombstones at every outbound boundary, and added a dry-run-first bounded manual backfill for existing rows without introducing physical tombstone purge.
- Hardened public-recipe imports, cookie parsing, analytics identifiers, recipe/SEO text parsing, upload previews, and bounded auth/ingredient validation against the corresponding CodeQL findings; public recipe updates now require a reviewed local JSON handoff before the source artifact is written.
- Enforced the per-account ingredient storage cap with a transaction-scoped advisory lock, aligned the Durable Object limit validator with the 20,000/hour shared-client write budget, and retained privacy-safe nested failure codes for operational diagnosis.
- Added a normalized per-account hourly login budget after the existing IP and IP/email limits, and capped body-less semantic recommendation work at 50 stored ingredients with a default weighted cost of five.
- Cleared and deleted account-scoped IndexedDB databases and import-correction learning keys from the browser, detected blocked deletion by another tab, and kept the cleanup warning visible after redirecting to login.
- Kept successful account deletion at 204 with expired cookies when post-commit access-token revocation fails, while recording only bounded non-sensitive failure metadata.
- Bounded each account's refresh-session history to 24 records, preserved recent rotation records for reuse detection, acquired the per-user lock before session inserts to avoid concurrent-login deadlocks, pruned existing excess history in migration, and added a tenant-scoped RLS delete policy plus a per-user refresh budget.
- Moved Cloudflare access-token revocation from eventually consistent Workers KV to per-token SQLite Durable Objects, made a missing binding fail closed, and added alarm cleanup so logout state and rate-limit rows expire without accumulating indefinitely.
- Hardened the import-correction embedding backfill with both feature gates, privacy-checked field reconstruction, default dry-run behavior, and explicit target-host confirmation before external calls or database writes.
- Defined 90-day raw product-event and 180-day recommendation-event policies, added server-time indexes and a dry-run-first capped manual maintenance task with target-host acknowledgement, aggregate-only logs and legacy ownerless-event cleanup, and matched training exports to a 180-day window. Recurring enforcement remains an explicit deployment follow-up.
- Applied the shared ingredient read budget to single-record lookups and aligned JWT expiration with the exact `exp` boundary.
- Bounded legacy and AI recipe request arrays and string fields, and made paid semantic/AI rate limits charge by ingredient workload instead of treating oversized work as one request.
- Added weighted, shared user and client limits to both import-correction embedding endpoints so one 30-item request consumes 30 units and alternating suggestion/save calls cannot bypass the budget.
- Made session restoration fail closed, stopped persisting server identity in `localStorage`, and fenced failed logouts so an uncleared HttpOnly session cannot silently sign the next browser user back in.
- Completed the checkpointed stale-vector rollout and the 188-row normalization refresh with zero failures; production now verifies at 1,166 current embeddings, no missing/stale/duplicate/orphan rows, and `vector(1536)`.
- Normalized catalog artifacts such as dimension/fraction suffixes, section prefixes, and common Korean ingredient aliases; the final stored-vector home-meal evaluation reached 95% candidate recall and 75% reranked Hit@5.
- Namespaced recommendation event recipe keys as `local:<id>` or `catalog:<uuid>` so future CTR aggregation can distinguish bundled and production recipes.
- Made Cloudflare login and signup throttles use the real `CF-Connecting-IP` value, and added persistent per-user and per-client limits to the paid AI suggestion endpoint.
- Checkpointed all 1,166 production recipe embeddings, replaced exactly the 18 stale Korean home-meal fixture targets with one API request and zero failures, then verified `current=226`, `missing=0`, `stale=940`, duplicate/orphan counts of zero, `vector(1536)`, and fixture freshness at 20/20 current.
- Added a guarded `--target-fixture` recipe embedding mode that resolves fixture IDs against the catalog, rejects missing/name-mismatched/duplicate targets, requires an explicit production write cap, and dry-ran the Korean home-meal fixture at exactly 2 current and 18 stale rows with zero API calls or writes.
- Re-ran both stored-production-vector quality fixtures after the first 25-row stale replacement: the fixed ten-query gate passed at Hit@5 9/10, while the Korean home-meal gate stopped further rollout at Hit@5 2/20 because 18 of its 20 target vectors were stale.
- Completed the first separately approved 25-row stale embedding replacement with zero failures, then verified `current=208`, `missing=0`, `stale=958`, full 1,166-row coverage, duplicate/orphan counts of zero, and `vector(1536)`.
- Completed the final separately approved 13-row missing embedding batch with zero failures, then verified full 1,166-row coverage, `current=183`, `missing=0`, `stale=983`, duplicate/orphan counts of zero, and `vector(1536)`.
- Completed the sixth separately approved 25-row missing embedding batch with zero failures, then verified 1,153 embeddings, `current=170`, `missing=13`, `stale=983`, duplicate/orphan counts of zero, and `vector(1536)`.
- Completed the fifth separately approved 25-row missing embedding batch with zero failures, then verified 1,128 embeddings, `current=145`, `missing=38`, `stale=983`, duplicate/orphan counts of zero, and `vector(1536)`.
- Completed the fourth separately approved 25-row missing embedding batch with zero failures, then verified 1,103 embeddings, `current=120`, `missing=63`, `stale=983`, duplicate/orphan counts of zero, and `vector(1536)`.
- Completed the third separately approved 25-row missing embedding batch with zero failures, then verified 1,078 embeddings, `current=95`, `missing=88`, `stale=983`, duplicate/orphan counts of zero, and `vector(1536)`.
- Completed the second separately approved 25-row missing embedding batch with zero failures, then verified 1,053 embeddings, `current=70`, `missing=113`, `stale=983`, duplicate/orphan counts of zero, and `vector(1536)`.
- Completed the first approved 25-row full-catalog missing embedding batch with zero failures, then verified 1,028 embeddings, `current=45`, `missing=138`, `stale=983`, duplicate/orphan counts of zero, and `vector(1536)`.
- Added a guarded `--all` backfill mode that reads the live catalog count and refuses production execution without an explicit finite `--max-writes` cap.
- Detected that production had grown from 1,146 to 1,166 recipes, removed the verifier's hardcoded catalog limit, and corrected staged backfill expectations so 20 new catalog rows cannot be silently omitted.
- Confirmed through aggregate-only checks that the 20-row increase is the intentional ingredient-complete `curated_home_v1` catalog source, not duplicate or orphaned recipe data.
- Made recipe embedding summaries print the effective `maxWrites` cap so full-catalog dry-runs cannot obscure the separately approved production write boundary.
- Created and checksum-verified a fresh protected checkpoint of all 1,003 stored production recipe embeddings after the limited stale replacement, with zero production writes and zero embedding API calls.
- Hardened recipe embedding operations with multi-input API batches, bounded retry/backoff, UUID keyset resume state, token/cost/throughput summaries, and a verified gzip checkpoint manifest with SHA-256.
- Restored the three production-only recipe catalog migration files from verified schema statements, realigned Prisma migration-name history without running a deployment, and documented the two unrecoverable original-format checksum differences.
- Completed a checkpointed ten-row missing recipe embedding backfill and verified the write cap, `vector(1536)` integrity, duplicate/orphan counts, stored-vector ordering, ingredient joins, and canonicalized semantic reranking.
- Completed a separately checkpointed ten-row stale embedding replacement with no failures, exact write-bound verification, and 10/10 stored-vector self retrieval without spending additional query-embedding API calls.
- Added a read-only stored-vector evaluation mode that embeds only the fixed ten fixture queries, and verified production retrieval at Hit@1 9/10 and Hit@5 10/10 with one API request and zero database writes.
- Prerendered public pages with route-specific crawler-visible HTML and forced functional, account, ingredient, and import routes out of search indexes at the response-header level.
- Added an explicit `--max-writes` cap to recipe embedding backfills so a full catalog scan can still guarantee a limited number of production upserts.
- Raised the fixed semantic recipe retrieval fixture from 6/10 to 9/10 Hit@5 by placing normalized ingredient sections before menu metadata in candidate embedding text, without changing the embedding model, vector dimensions, candidate pool, or fixture ground truth.
- Added target similarity and query-versus-candidate ingredient classification evidence to the read-only recipe search quality report.
- Added deterministic runtime ingredient classification so empty production categories no longer make every seasoning, liquid, garnish, optional item, or uncertain item a core requirement.
- Replaced noisy recipe embedding bodies with bounded classification-aware text and aligned semantic query text with the same normalized search-ingredient sections.
- Made the recipe embedding command write-free by default and separated missing/stale backfill modes from in-memory quality evaluation.
- Aligned the Prisma recipe catalog models with the production UUID/Supabase table shape and changed pgvector retrieval to join `recipe_embeddings` with `recipes` instead of querying the nonexistent `recipes.embedding` column.
- Made DB-backed hybrid recommendations load only retrieved production recipe UUIDs and their canonical ingredient rows, with a recent-catalog fallback when vector retrieval is unavailable.
- Made equal sync timestamps keep the existing server value and reject timestamps more than five minutes in the future before any batch write.
- Replaced Playwright's Windows-leaking `webServer` child-process path with explicit in-process Vite startup and teardown.
- Hardened production auth cookies with `SameSite=Lax` and `__Host-` names, and reject cookie-authenticated state changes whose `Origin` or fallback `Referer` is missing or untrusted.
- Rate-limited recommendation event ingestion by authenticated user/client address and replaced arbitrary analytics metadata with a bounded allowlisted schema.
- Reduced public health responses to a static liveness signal so database connectivity and runtime timestamps are not exposed to unauthenticated callers.
- Expire legacy auth-cookie names during the `__Host-` cookie cutover, and key recommendation-event limits by user ID for authenticated traffic or client address for anonymous traffic.
- Added forced PostgreSQL RLS policies for ingredient and OCR correction data, a non-bypass application role, and transaction-local user scoping for every runtime access to those tables.
- Scoped account lookup, refresh sessions, recommendation events, and recipe reads for the non-bypass runtime role instead of granting blanket access to RLS-enabled support tables.

### Added

- Added an evidence-based PC/mobile production sync drill covering propagation, idempotency, newest-edit conflicts, offline stale writes, tombstone protection, and disposable-account cleanup.
- Added a production database backup and restore runbook with explicit evidence gates, separate-project restoration, aggregate validation, RLS/runtime-role checks, and tenant-isolation smoke tests.
- Added a scheduled production uptime workflow that validates the minimized public health response every 15 minutes and can also be run manually.
- Added authenticated self-service JSON data export and password-confirmed account deletion with scoped RLS delete policies, attempt limits, cookie expiry, and current-device account-cache cleanup.
- Added weekly Dependabot updates, pinned-action CodeQL analysis, production dependency audits, and full-history Gitleaks scanning for pushes, pull requests, and scheduled security checks.
- Added a rate-limited, authenticated `/api/recipes/recommendations/semantic` endpoint behind `SEMANTIC_RECIPE_API_ENABLED`, with bounded inputs, rule fallback, and the existing impression/click event path.
- Added candidate-pool recall and production-equivalent 70/30 reranking metrics to the recipe search evaluator without changing the retrieval model or vector dimensions.
- Added optional Naver Search Advisor and Bing Webmaster Tools ownership-verification meta tags with token validation, build-time assertions, and deployment checklists alongside the existing Google Search Console support.
- Added six source-backed ingredient recipe hubs, two fridge-use guides, complete internal linking for all 100 public recipes, and 113-route prerender/sitemap verification.
- Added consent-gated GA4 delivery behind the existing analytics interface, including SPA page views, identifier filtering, accessible allow/deny controls, and revocable footer settings.
- Added optional Search Console HTML-tag verification and strengthened the WebSite entity with natural `오늘 뭐 먹지` and `FridgeMate` alternate names without adding typo keywords to visible copy.
- Added a read-only recipe embedding verifier that checks staged expected counts, current/missing/stale coverage, model/dimensions, vector type, duplicate keys, and orphan rows without API calls or row-level output.
- Added metadata-only request identifiers, failure and latency telemetry, client-side error correlation, and optional embedding token/cost metrics without logging prompts, request bodies, user IDs, or vectors.
- Added a separate 20-recipe Korean home-meal search fixture with realistic three-to-five-ingredient queries, expiring ingredients, alias coverage, category balance, Hit@5 rate, owned-ingredient ratio, and missing-ingredient metrics.
- Added 100 source-backed Food Safety Korea recipe detail pages with stable slugs, ingredients, cooking steps, nutrition, images, canonical URLs, sitemap entries, and truthful `Recipe` JSON-LD.
- Added a safe public-recipe export command that is read-only by default, strips raw source payloads, upgrades image URLs to HTTPS, and writes only with an explicit `--write` flag.
- Added truthful page-level JSON-LD, `llms.txt`, private-route crawler exclusions, and a post-build SEO output verification gate.
- Added a fixed ten-recipe semantic retrieval fixture, an all-catalog read-only evaluation command, Hit@1/Hit@5/MRR metrics, and a vector-free JSON quality report.
- Added first-pass conflict-aware manual ingredient sync with stable `clientId` matching, persisted pending create/update/delete states, and server deletion tombstones.
- Added a record-level ingredient sync API and complete sync-state pull endpoint while preserving authenticated user scoping and PostgreSQL RLS boundaries.
- Added backward-compatible IndexedDB sync metadata migration and conflict, deletion, failure, idempotency, tenant-isolation, and local-only regression coverage.
- Added separate-browser-context sync E2E coverage for propagation, conflicts, offline recovery, deletion, idempotency, and account isolation.
- Added a mobile category select to the ingredient filters while keeping wrapped category buttons on larger screens.
- Added route-specific titles, descriptions, canonical URLs, search-index controls, and a Not Found page with production 404 routing.
- Added a Cloudflare Workers Express entry point, Prisma PostgreSQL driver adapter support for Hyperdrive, and optional Workers KV auth security storage.
- Added disabled-by-default AdSense head injection, responsive ad units, generated `ads.txt`, and a public privacy information page.
- Added public service and contact pages, finalized the privacy contact, and published `robots.txt` and `sitemap.xml` for search crawlers.
- Added recommendation event persistence for impression and click feature snapshots, plus a training-data export script for future ML ranking experiments.
- Added an account-page server pull action so authenticated users can replace the local device cache with their server ingredient list.
- Added a shared horizontal recommendation row component and a lazy DB recommendation hook that waits for viewport entry before calling the recommendation API.
- Added a v1 release QA checklist covering environment security, MFDS recipe seed boundaries, auth, guest import, manual sync, deployment, and smoke scenarios.
- User-scoped OCR import correction storage with optional pgvector embeddings for similarity-based review suggestions.
- Backend import correction APIs and OpenAI embedding configuration while preserving local import correction fallback.
- Script for backfilling missing import correction embeddings after enabling OpenAI embeddings.
- OCR import now detects source type before parsing and routes Coupang, Kurly, receipt, and generic shopping text separately.
- Receipt OCR parsing now extracts grocery item rows from mobile and mart receipts before falling back to generic OCR parsing.
- OCR import candidates now include confidence and review metadata, with receipt garbage filtering for obvious non-product lines.
- Added a dedicated receipt text parser that reconstructs product name, unit price, quantity, total price, and discounts from pasted or OCR-extracted receipt text.
- OCR import now supports directly pasting receipt OCR text into the review flow without re-running image OCR.
- Added a Food Safety Korea recipe XML parser that keeps recipe names, raw ingredient text, tags, optional nutrition, and generated external search links without storing manual steps.
- Added Supabase SQL and a Node seed script for importing MFDS `COOKRCP01` public recipe source rows into a `recipes` table.
- Added a Supabase `recipe_ingredients` SQL script and MFDS ingredient parsing CLI for splitting seeded recipe ingredient text into normalized chunks.
- Added a recipe parser training export script that writes JSONL baseline labels for future ML-assisted parsing.
- Added recipe ingredient parsing and fridge-to-menu match scoring utilities for ingredient-based recipe recommendations.
- Added recipe raw import storage, batch LLM ingredient normalization fallback, embedding text generation, OpenAI embedding service scaffolding, pgvector search, and hybrid recipe ranking.
- Added manual ingredient sync from the account page, including dirty/syncing/synced/error UI state and persisted last sync time.
- Added a replace-style ingredient sync endpoint for saving the current local IndexedDB snapshot to the server on demand.
- Added duplicate ingredient cleanup on the ingredients page, keeping the newest purchase-date item in each duplicate group.
- Added ingredient `clientId` sync identity so repeated manual syncs upsert existing server rows instead of creating duplicates.
- Frontend Sentry initialization behind `VITE_SENTRY_DSN` for optional production error monitoring.
- GitHub Actions CI workflow for lint, test, and build jobs with artifact upload.
- Vitest coverage across recommendation logic, OCR parsing, IndexedDB, import learning, and `useIngredients`.
- Global connection status feedback with online/offline and fallback notices.
- Sync strategy scaffold documenting the current `last-write-wins` approach.
- Playwright E2E scaffolding for local-only CRUD, auth, API fallback, and OCR review flows.
- Added a v1 stabilization plan that pauses new taxonomy, pgvector, and recipe-ranking expansion until deployment basics are solid.
- Added E2E coverage for guest-to-user import, manual sync, deletion sync, and expired-session handling.
- Added `docs/BUSINESS_ROADMAP.md` to document product positioning, monetization, KPI focus, and exit options.
- Added `docs/ANALYTICS_EVENTS.md` to define activation, OCR, retention, recommendation, and monetization event tracking.
- Added a lightweight analytics layer with session, auth, ingredient, OCR, and recommendation instrumentation hooks.

### Changed

- Held Prisma, ESLint, React, and Tailwind major updates plus React Hooks plugin minor updates in Dependabot so breaking migrations are handled explicitly instead of opening version-only PRs that fail CI.

- Split browser routes into lazy chunks while keeping a synchronous SEO render entry, reducing the initial minified JavaScript chunk from about 623 KB to 160 KB and removing the Vite 500 KB warning.
- Moved GitHub Actions CI and its official checkout, Node setup, and artifact upload actions to the Node.js 24 generation.
- Replaced destructive whole-snapshot ingredient backup with newest-`updatedAt` record changes; manual backup and pull now merge without overwriting newer pending local work.
- Simplified recommendation cards so matching, owned ingredients, and missing items are easier to scan.
- Strengthened typography hierarchy, text contrast, card borders, and restrained accent colors across core app screens.
- Reduced oversized corner radii and removed decorative gradients from operational screens.
- Separated AdSense ownership verification from ad serving, disabled Google-served ads during policy review, and removed the global Auto ads loader from non-content routes.
- Added the production AdSense publisher verification script to the document head while keeping ad units disabled by default.
- Split account-page manual sync into explicit server backup and server pull actions with confirmation prompts.
- Refactored the recipes page into a two-row layout: instant local seed recommendations first, lazy DB-backed AI recommendations second.
- Home and recipe-page recommendation previews now use the DB-backed recommendation API first in authenticated backend mode, then fall back to local seed recipes for network or server failures.
- DB-backed hybrid recipe scoring now counts owned pantry staples the same way the local recommendation engine does.
- Refreshed the README around the current v1 deployment gate, MFDS seed completion, auth/manual-sync behavior, and v2 recipe boundaries.
- Grouped the pantry staple checklist into Korean home-cooking basics and a collapsed extra seasonings section.
- Moved header account actions to the top-right area, restyled ingredient filters as a category toolbar, and made the manual memo field auto-grow.
- Removed the internal storage scope display from the account page.
- Simplified recipe recommendation cards around ingredient match rate, owned ingredients, missing ingredients, missing seasonings, and external search buttons.
- Simplified the public recipe catalog shape so `MANUAL01~20`, `MANUAL_IMG01~20`, and recipe body content are not imported or stored.
- Recipe recommendation API now tries DB-backed hybrid recommendations first and falls back to seed recipes when the recipe catalog or vector search is unavailable.
- Expanded import category and storage options so receipt parsing can suggest more specific classes such as `라면/면류`, `간식`, `양념/소스`, and `상온`.
- Added Prisma `directUrl` configuration and Supabase pooler examples for hosted PostgreSQL connections.
- Updated README and AGENTS documentation to match the current local-first + optional backend architecture.
- Changed ingredient CRUD to local-first IndexedDB writes; server writes now happen only when the user manually syncs from the account page.
- Manual ingredient sync now upserts by `clientId` and removes server rows that are no longer present in the local snapshot.
- Guest ingredient import now copies guest items into the authenticated local scope without automatically uploading them to the server.
- Routed pantry-owned staples into recommendation scoring instead of keeping them UI-only.
- Tightened deployment guidance around environment variables, smoke checks, and core journey verification.
- Reworked the deployment checklist around v1 manual sync, auth cookies, Vercel, Railway, and Supabase verification.
- Linked the business roadmap from the README so product and go-to-market direction are easier to find.
- Linked the analytics event spec from the README so KPI instrumentation has a documented source of truth.
- Hardened auth handling with normalized email uniqueness, shorter JWT defaults, logout token revocation, and rate-limited signup/login.
- Added Redis-backed auth throttling and token revocation with in-memory fallback for single-instance development.
- Auth security storage now falls back to memory if Redis becomes unavailable during runtime.
- Switched auth to `httpOnly` access/refresh cookies with refresh-token rotation and frontend user-only session persistence.
- Polished the app UI with a denser header, shorter page heroes, dashboard hierarchy cleanup, ingredient search, and more action-focused ingredient cards.
- Simplified recipe, OCR import, and auth screen copy so the next step is clearer on mobile and desktop.

### Fixed
- Ingredient updates and deletes now apply `id` and authenticated `userId` together in the database mutation, preventing unscoped writes and returning the same `404` for missing or foreign records.
- Removed the authenticated-but-unprivileged recipe catalog import HTTP route; global recipe imports now remain restricted to trusted local or CI seeding workflows.
- Refresh-token rotation now atomically consumes the previous database session before issuing a replacement, rejects concurrent reuse, and revokes the user's remaining refresh sessions when reuse is detected.
- Login and signup throttling now uses per-key SQLite Durable Objects on Cloudflare, keeps Redis atomic counters on production Node, and fails closed instead of falling back to per-instance memory when persistent auth storage fails.
- Cloudflare database requests now use a single connection per request, and recommendation events are queued in the browser to avoid exhausting the Supabase session pool.
- Hybrid recipe recommendations now continue without alias expansion when the optional ingredient alias catalog is unavailable.
- Server-side failures now record sanitized request and error metadata in private runtime logs while keeping generic 500 responses for clients.
- Refresh requests without a session cookie now return `401` before opening a database query.
- Manual ingredient sync now uses the authenticated API request path so a 401 can refresh the session and retry once.
- Recipe recommendations no longer count recipes as "buy one more" when no core ingredients are currently owned.
- Recommendation scoring now treats owned pantry staples as available ingredients.
- Fallback and syncing state now surface clearer user feedback in the UI.
- Session restore now keeps authenticated local fallback available during transient server failures.
- Sync reconciliation now drops stale clean cache entries and preserves newer local cache entries as pending updates.
- Ingredient deletion no longer triggers an automatic server delete; deleted items are removed from the server only on the next manual replace sync.

## [1.5.0] - 2026-04-03
### Added
- Express + Prisma backend scaffold with ingredient CRUD and recipe recommendation routes.
- Pantry staple ownership UI and shopping list panel.
- Import correction learning for repeated OCR imports.
- Stronger local-first ingredient workflows and backend persistence fallback.

### Changed
- Enhanced recipe recommendation flows and grouping behavior.
- Simplified shopping list behavior and pantry state handling.
- Simplified OCR retry behavior and expanded import normalization knowledge.

### Documentation
- Improved README presentation and added live demo-oriented polish.

## [1.0.0] - 2026-03-31
### Added
- Initial FridgeMate MVP.
- Ingredient CRUD, expiry tracking, filtering, sorting, and IndexedDB persistence.
- First-pass local recipe recommendation flow.
