# Reconciliation preview — RigSpecs

- Mode: **preview** (read-only; no Kanban or database writes)
- Reconciled at: 2026-10-04T01:58:21.800Z
- Engine: mc-reconcile/1
- Boards: rigspecs-production-integrity
- Receipts loaded: 10; binding entries: 0

## Summary

| Category | Count |
| --- | --- |
| Already correct (receipt evidence agrees) | 0 |
| Stale — safe deterministic repair | 0 |
| Reconciliation required (task) | 0 |
| Waiting approval | 2 |
| Archived | 7 |
| Already correct (done; task-cited artifacts) | 11 |
| Kanban-only (no linked evidence) | 28 |
| Orphan receipts | 10 |
| Total RECONCILIATION_REQUIRED items | 10 |

## Stale cards / safe deterministic repairs

None. No card has authoritative evidence that contradicts it unambiguously.

## RECONCILIATION_REQUIRED

| Item | Type | Subject | Kanban / MC | Why | Recommended resolution |
| --- | --- | --- | --- | --- | --- |
| rr_091d4ed72fb20fbd769daa8a70fb844c | orphan_receipt | Approval B B2-B7 execution (sha256:d686076db77d…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |
| rr_40a95e06b9b0197b8fe9549eae66881a | orphan_receipt | Quarantine execution (2026-09-12) (sha256:e31b09ab17ad…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |
| rr_52610172a51405514b7accfdd088c5ed | orphan_receipt | Containment execution (2026-09-15) (sha256:2454d442b25f…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |
| rr_71e0f40695e6716137024b3d27f04e9b | orphan_receipt | Approval B admin pre-activation gate (2026-09-16) (sha256:506a374b0c30…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |
| rr_9ac8e4f4b0413283e773fb4815cf2373 | orphan_receipt | Approval B admin pre-activation gate (2026-09-18) (sha256:2079adccad97…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |
| rr_9ffdc7283a9a858db5de1db083991ac2 | orphan_receipt | Correction batches 4 and 5 execution (sha256:3118f74d0ce8…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |
| rr_a66d63a9f57312fd8e93fcee55dfb513 | orphan_receipt | Approval B extensions denial gate (sha256:8ff78d6d6ea7…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |
| rr_c595592c9fc00f1ffcfd3e2589ac57c6 | orphan_receipt | Integrity purchase module deployment (sha256:b963039d54f3…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |
| rr_ea2403f39fd8cce1c0652065ee79546a | orphan_receipt | Approval B extensions capability window (sha256:8e7ac8bb95ec…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |
| rr_f985ab5c1ec4e98bf9c62a249aa0b853 | orphan_receipt | Audit access window (2026-09-12) (sha256:830d50e88d55…) | — | Receipt is not bound to any task by embedded identity, run metadata, or an approved binding | Bind it to the exact task it executed (or create a task for it) in the binding file; titles are not used |

## Receipts

| Receipt id | Label | Result | QC | Finished | Integrity | Action req. | Linked |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sha256:2079adccad97148f99608b5568237cca589c35d03c7537737879204be241e4c7` | Approval B admin pre-activation gate (2026-09-18) | PASS | — | 2026-09-18T00:00:00.000Z | unverified (none) | no | orphan |
| `sha256:2454d442b25f7a063f39b0cb3374457b6b4e758c736ddb9a995a42e63e8b269d` | Containment execution (2026-09-15) | PASS | — | 2026-09-15T01:04:12.046Z | unverified (none) | no | orphan |
| `sha256:3118f74d0ce88b25e413f664a4699aa9b3d05f12202860488f1b17f507d5602f` | Correction batches 4 and 5 execution | PASS | — | 2026-09-15T12:01:53.161Z | unverified (none) | no | orphan |
| `sha256:506a374b0c30ac472f353101fe5acfad4f7454b1e587921da87eee30f6abc6d9` | Approval B admin pre-activation gate (2026-09-16) | FAIL | — | 2026-09-16T00:00:00.000Z | unverified (none) | no | orphan |
| `sha256:830d50e88d55ce3094ca8b0520aff96e70d90a2d54622b3eb789b3ba73e08ec1` | Audit access window (2026-09-12) | FAIL (FAILED_RECONTAINED) | — | 2026-09-12T18:40:36.023Z | unverified (none) | no | orphan |
| `sha256:8e7ac8bb95ec27811ab38ce3ce9dd2c3a4761b248f801813fd10296408f79742` | Approval B extensions capability window | FAIL (EXTENSIONS_CAPABILITY_WINDOW_BLOCKED) | — | 2026-09-16T00:00:00.000Z | unverified (none) | no | orphan |
| `sha256:8ff78d6d6ea7f0320a6fe548524d0019c403f7fc21e4e91e7e13d4c7e5aebbdd` | Approval B extensions denial gate | PASS (EXTENSIONS_DENIAL_GATE_PASSED) | — | 2026-09-16T00:00:00.000Z | unverified (none) | no | orphan |
| `sha256:b963039d54f3f19504afc690233f9013685c25557151b4125c97bcc9c9c7c922` | Integrity purchase module deployment | UNKNOWN | — | 2026-09-15T00:00:00.000Z | unverified (none) | no | orphan |
| `sha256:d686076db77d781e1cf0826cfe5524f4ee5e6f0809ddf8a8f4156effe6af91e5` | Approval B B2-B7 execution | PASS | CONCERNS | 2026-09-18T00:00:00.000Z | verified (sha256sums) | YES | orphan |
| `sha256:e31b09ab17adf616ec8d95f53eb39ccd57223c61f27fec1fd6de76bb421dc1e1` | Quarantine execution (2026-09-12) | PASS | — | 2026-09-13T02:31:49.377Z | unverified (none) | no | orphan |

## Waiting approval

- rigspecs-production-integrity/t_13b6c099 — [BLOCKED — NEEDS JONATHAN] PB-02 \u2014 Read-only database access validation (Kanban blocked; approval rigspecs-approval-a: unrecorded)
- rigspecs-production-integrity/t_2014dc2c — [BLOCKED — NEEDS JONATHAN] PB-06 | Approval A — passwordless SELECT-only role (Kanban blocked; approval rigspecs-approval-a: unrecorded)

## Already correct

- rigspecs-production-integrity/t_23da2c52 — PB-01 \u2014 Canonical metric dictionary (Kanban done; its completed run cites 1 artifact(s))
- rigspecs-production-integrity/t_37648f34 — PI-07 — Unified evidence packages and correction batch for approval (Kanban done; its completed run cites 2 artifact(s))
- rigspecs-production-integrity/t_40e666e0 — PI-02A — Canonical identity schema and integrity rules (Kanban done; its completed run cites 8 artifact(s))
- rigspecs-production-integrity/t_4346d615 — PI-02B — First-batch canonical identity freeze gate (Kanban done; its completed run cites 8 artifact(s))
- rigspecs-production-integrity/t_4c464b92 — PB-04 \u2014 Public route and sitemap audit (Kanban done; its completed run cites 2 artifact(s))
- rigspecs-production-integrity/t_768aa366 — PI-05R — First-batch vendor destination audit (Kanban done; its completed run cites 8 artifact(s))
- rigspecs-production-integrity/t_76e85bc7 — PI-01R — Public published-product inventory snapshot (Kanban done; its completed run cites 4 artifact(s))
- rigspecs-production-integrity/t_8857b8c7 — PB-05 \u2014 Repository validation report (Kanban done; its completed run cites 2 artifact(s))
- rigspecs-production-integrity/t_b0cb4240 — PI-06R — First-batch official image identity audit (Kanban done; its completed run cites 10 artifact(s))
- rigspecs-production-integrity/t_b191f0e7 — PI-04 — First-batch exact fitment evidence research (Kanban done; its completed run cites 2 artifact(s))
- rigspecs-production-integrity/t_ea4eb955 — PI-03R — Initial risk scoring, top-25 queue, and first batch (Kanban done; its completed run cites 6 artifact(s))

## Kanban-only cards (no linked execution evidence)

| Task | Idempotency key | Kanban | Title |
| --- | --- | --- | --- |
| rigspecs-production-integrity/t_05105aab | ws-03 | blocked | [ON HOLD / DEFERRED] WS-03 \u2014 Catalog Integrity |
| rigspecs-production-integrity/t_0765750f | — | done | Inventory trade-secret and patentable-mechanism candidates (names only) |
| rigspecs-production-integrity/t_078bba55 | — | done | Inventory public IP assets: copyrightable works and trademark candidates |
| rigspecs-production-integrity/t_0b947b36 | — | done | Locate and record the RigSpecs IP Protection Project brief source |
| rigspecs-production-integrity/t_1521cff2 | ws-07 | blocked | [ON HOLD / DEFERRED] WS-07 \u2014 Vendor Links and Pricing |
| rigspecs-production-integrity/t_1fddf35d | ws-01 | blocked | [ON HOLD / DEFERRED] WS-01 \u2014 Production Baseline |
| rigspecs-production-integrity/t_287c0671 | — | done | Inventory database/compilation rights in the product/fitment catalog |
| rigspecs-production-integrity/t_2f69cfc5 | — | done | PB-07 \| Approval B Readiness Review (read-only) |
| rigspecs-production-integrity/t_31435e61 | — | todo | IP-03 \| [READ-ONLY] Public usage and evidence collection |
| rigspecs-production-integrity/t_422df5b5 | ws-05 | blocked | [ON HOLD / DEFERRED] WS-05 \u2014 Product Fitment Verification |
| rigspecs-production-integrity/t_4c512fb3 | ws-06 | blocked | [ON HOLD / DEFERRED] WS-06 \u2014 Product Images |
| rigspecs-production-integrity/t_4f7d34ea | ws-12 | blocked | [ON HOLD / DEFERRED] WS-12 \u2014 Production Release Queue |
| rigspecs-production-integrity/t_51db0e83 | ws-10 | blocked | [ON HOLD / DEFERRED] WS-10 \u2014 SEO and Conversion |
| rigspecs-production-integrity/t_6a319f57 | — | blocked | [STALE — REVIEW FOR ARCHIVE] P0 \| [READ-ONLY] Unprotected/irreplaceable files on Vol1 |
| rigspecs-production-integrity/t_6b24cc04 | ws-11 | blocked | [ON HOLD / DEFERRED] WS-11 \u2014 Monitoring and Recurring Audits |
| rigspecs-production-integrity/t_6eb97d15 | — | blocked | [STALE — REVIEW FOR ARCHIVE] P0 \| [READ-ONLY] Vol1 space reclamation options ranked |
| rigspecs-production-integrity/t_75c431b0 | — | triage | IP-01 \| [READ-ONLY] RigSpecs IP asset inventory |
| rigspecs-production-integrity/t_7982ce5f | pb-03 | done | PB-03 \u2014 Production baseline query pack |
| rigspecs-production-integrity/t_84c7501d | — | done | Consolidate IP asset inventory into JSON + Markdown evidence package |
| rigspecs-production-integrity/t_851aadd5 | — | blocked | [STALE — REVIEW FOR ARCHIVE] P0 \| [READ-ONLY] da2 replacement plan |
| rigspecs-production-integrity/t_a1047fbb | ws-08 | blocked | [ON HOLD / DEFERRED] WS-08 \u2014 Affiliate Programs |
| rigspecs-production-integrity/t_a43e5c7d | ws-02 | blocked | [ON HOLD / DEFERRED] WS-02 \u2014 Documentation Reconciliation |
| rigspecs-production-integrity/t_ae8b4a1b | — | done | P0 \| [IN-FLIGHT] Amber Vol1 investigation dispatch |
| rigspecs-production-integrity/t_af51cbb2 | ws-09 | blocked | [ON HOLD / DEFERRED] WS-09 \u2014 Engineering Improvements |
| rigspecs-production-integrity/t_beffaffb | — | todo | IP-04 \| [READ-ONLY] Public-material-only trade-secret and patent candidate notes |
| rigspecs-production-integrity/t_c1bf0d47 | dr-01 | blocked | [BLOCKED — AGENT/DEPENDENCY] DR-01 \u2014 Documentation drift report |
| rigspecs-production-integrity/t_d714996e | ws-04 | blocked | [ON HOLD / DEFERRED] WS-04 \u2014 Vehicle Specification Verification |
| rigspecs-production-integrity/t_f7275353 | — | blocked | IP-02 \| [READ-ONLY] USPTO factual requirements with primary citations |

## Tasks without a stable idempotency key

- rigspecs-production-integrity/t_0765750f — Inventory trade-secret and patentable-mechanism candidates (names only)
- rigspecs-production-integrity/t_078bba55 — Inventory public IP assets: copyrightable works and trademark candidates
- rigspecs-production-integrity/t_0b947b36 — Locate and record the RigSpecs IP Protection Project brief source
- rigspecs-production-integrity/t_287c0671 — Inventory database/compilation rights in the product/fitment catalog
- rigspecs-production-integrity/t_2f69cfc5 — PB-07 | Approval B Readiness Review (read-only)
- rigspecs-production-integrity/t_31435e61 — IP-03 | [READ-ONLY] Public usage and evidence collection
- rigspecs-production-integrity/t_6a319f57 — [STALE — REVIEW FOR ARCHIVE] P0 | [READ-ONLY] Unprotected/irreplaceable files on Vol1
- rigspecs-production-integrity/t_6eb97d15 — [STALE — REVIEW FOR ARCHIVE] P0 | [READ-ONLY] Vol1 space reclamation options ranked
- rigspecs-production-integrity/t_75c431b0 — IP-01 | [READ-ONLY] RigSpecs IP asset inventory
- rigspecs-production-integrity/t_84c7501d — Consolidate IP asset inventory into JSON + Markdown evidence package
- rigspecs-production-integrity/t_851aadd5 — [STALE — REVIEW FOR ARCHIVE] P0 | [READ-ONLY] da2 replacement plan
- rigspecs-production-integrity/t_ae8b4a1b — P0 | [IN-FLIGHT] Amber Vol1 investigation dispatch
- rigspecs-production-integrity/t_beffaffb — IP-04 | [READ-ONLY] Public-material-only trade-secret and patent candidate notes
- rigspecs-production-integrity/t_f7275353 — IP-02 | [READ-ONLY] USPTO factual requirements with primary citations

All tasks still carry the Hermes task id, which is the primary stable identity (`<board>/<id>`).

## Project state (derived)

```json
{
  "integrity_locked_current": 3,
  "integrity_locked_target": 10,
  "target_reached": false,
  "contained_products": 7,
  "published_products": 83,
  "promoted_catalog_count": 3,
  "revenue_ready_count": 0,
  "revenue_eligible_count": 3,
  "batch_status": "WAITING_APPROVAL",
  "indexing_status": "BLOCKED",
  "pending_approvals": 1,
  "critical_blockers": [
    "Approval B: reconciliation required",
    "TLS verify-full remediation: action required"
  ],
  "metrics_as_of": "2026-09-15T01:33:29.669948+00:00"
}
```

| Milestone | Status | Detail |
| --- | --- | --- |
| Production Trust | WAITING_APPROVAL | {"done":5,"total":7,"waiting":2,"blocked":0,"reconciliationRequired":0,"missingTasks":0} |
| Approval B | RECONCILIATION_REQUIRED | {"evidenceId":"sha256:d686076db77d781e1cf0826cfe5524f4ee5e6f0809ddf8a8f4156effe6af91e5","evidenceResult":"PASS","qcVerdict":"CONCERNS","finishedAt":"2026-09-18T00:00:00.000Z"} |
| TLS verify-full remediation | ACTION_REQUIRED | {"evidenceId":"sha256:d686076db77d781e1cf0826cfe5524f4ee5e6f0809ddf8a8f4156effe6af91e5","note":"The B2-B7 receipt records sslmode=require (not verify-full) and requires a decision on a verify-full re-run."} |
| Batch 6 | WAITING_APPROVAL | {"approvalId":"rigspecs-batch-6","packageSha256":"cc4045edf2e5a483217d33828a7f1004dd11948e1f4b5c8bcc9746db9d720b34","packageMatches":true} |
| Integrity Locked | IN_PROGRESS | {"current":3,"target":10} |
| Promoted Catalog | MEASURED | {"value":3} |
| Launch / Indexing | BLOCKED | {"launchEnabled":false,"blockers":["Launch target not reached (3 / 10)","No launch/indexing approval granted"],"approvalId":"rigspecs-launch-indexing"} |
| Revenue Readiness | MEASURED | {"value":0} |
| Affiliate Actions | NOT_STARTED | {"approvalId":"rigspecs-affiliate-enrollment","packageSha256":null,"packageMatches":null} |
| IP Protection | BLOCKED | {"done":5,"total":9,"waiting":0,"blocked":1,"reconciliationRequired":0,"missingTasks":0} |

## Load problems

None.
