# Mission Control reconciliation

Mission Control is the operational control plane between PalmOS (the human
front door), Hermes Kanban (the work ledger), and Hermes workers (execution).
This document covers the normalized state layer added in
`feat/mission-control-reconciliation`: identity, reconciliation rules, schema,
and what still needs explicit approval before anything runs in production.

## Authority

```text
execution receipt / verified evidence  >  Mission Control run state  >  Kanban card status
```

A Kanban label never overrides authoritative evidence. Evidence only becomes
authoritative for a task through **explicit identity** — never through a title.

```text
Hermes Kanban (SQLite, read-only) ─┐
execution receipts (files, hashed) ├─> bridge: reconcileProject() ─> Mc* tables ─> /api/mc/* ─> PalmOS
approval ledger + bindings (git)  ─┘          (pure, deterministic)     (append-only audit)
```

## Identity

| ID | Form | Source |
|---|---|---|
| `project_id` | `rigspecs` | `hermes-bridge/config/projects/<id>.json` |
| `task_id` | `<board>/<kanban id>`, e.g. `rigspecs-production-integrity/t_2014dc2c` | Hermes Kanban (unique across boards) |
| `run_id` | Kanban `task_runs.id` | Hermes Kanban |
| `receipt_id` | `sha256:<hex>` of the receipt bytes | computed; changes if one byte changes |
| `approval_id` | `rigspecs-batch-6` | `hermes-bridge/config/approvals/<id>.json` |
| `intent_id` | `rec_<32 hex>` (repair) / `rr_<32 hex>` (needs decision) | deterministic hash of the decision inputs |

Kanban `idempotency_key` (`pb-01`, `ws-03`, …) is kept as an alias but is not
required; the qualified Hermes task id is the primary identity.

### How evidence binds to a task

1. **Embedded** — an `mc-receipt/v1` JSON file names its own `project_id`,
   `task_id`, `run_id`. Discovered automatically under the project's evidence roots.
2. **Run metadata** — the task's own Kanban run carries the receipt id
   (`hermes kanban complete --metadata '{"mc_identity": {...}}'`).
3. **Approved binding** — for historical receipts with no identity, a
   git-tracked entry in `config/receipt-bindings/<project>.json` names the
   receipt by content hash. Only `status: "approved"` with `approved_by` and
   `approved_at` is authoritative. `proposed` is shown but never acts. A
   binding whose bytes changed stops matching (reported as
   `binding_receipt_missing`); it never transfers to new bytes.

Historical receipts are never rewritten.

### Worker contract (future receipts)

When a worker finishes a Kanban task that produced an execution receipt, it
should do both of the following (helper: `buildExecutionMetadata()` in
`hermes-bridge/lib/receipts.mjs`):

```sh
# 1. Write an mc-receipt.json next to the evidence
{ "schema": "mc-receipt/v1", "project_id": "rigspecs",
  "task_id": "rigspecs-production-integrity/t_xxxxxxxx", "run_id": "1234",
  "result": "PASS", "qc_verdict": "PASS", "action_required": false,
  "finished_at": "2026-10-03T12:00:00Z" }

# 2. Close the card with the identity on the closing run
hermes kanban --board rigspecs-production-integrity complete t_xxxxxxxx \
  --result "..." --metadata '{"mc_identity":{"schema":"mc-receipt/v1","project_id":"rigspecs","task_id":"rigspecs-production-integrity/t_xxxxxxxx","run_id":"1234","receipt_id":"sha256:..."}}'
```

Installing this contract in the Hermes worker skills on CT500 is a separate
change to Hermes configuration and has **not** been made.

## Reconciliation rules (`hermes-bridge/lib/reconcile.mjs`, `mc-reconcile/1`)

Per task, in order:

1. **Archived** → `archived`; history kept.
2. **Approval gate** (from the approval ledger): without a `granted` approval
   for the *current* package hash, the task is `WAITING_APPROVAL`. If Kanban or
   a receipt shows progress anyway → `RECONCILIATION_REQUIRED`. A Kanban status
   change never makes gated work executable.
3. No authoritative evidence → `kanban_only` (or `consistent` when Kanban is
   done and only *proposed* evidence agrees).
4. Evidence must be orderable (has `finished_at`) and unambiguous (no
   contradictory result at the same time).
5. Newest evidence must be trustworthy: `verified` against its integrity
   manifest, or pinned by an approved binding.
6. Newest `FAIL` → `FAILED`; if Kanban says done → `RECONCILIATION_REQUIRED`.
7. Newest result other than PASS/FAIL → `RECONCILIATION_REQUIRED`.
8. PASS with QC verdict ≠ PASS, or `action required` → `RECONCILIATION_REQUIRED`.
9. A Kanban run that ended blocked/crashed/failed **after** the receipt →
   `RECONCILIATION_REQUIRED` (newer contradictory evidence).
10. Kanban done → `consistent`. Otherwise → `stale_safe_repair` with a repair
    intent (`blocked|todo|ready|review → done`).

Project-level items: receipts bound to nothing → `orphan_receipt`; receipts
naming another project, an unknown task, or contradicting their binding →
`RECONCILIATION_REQUIRED`.

Same inputs always produce the same output and the same intent ids. Identical
receipt bytes at two paths are one receipt.

## Repair path (designed, not enabled)

`hermes-bridge/lib/repair-plan.mjs` defines the only mutation that will ever
exist, and nothing calls it in this release:

1. Re-run reconciliation on fresh state; the identical `intent_id` must still
   be produced (`verifyRepairPrecondition`), else refuse.
2. If the card's run metadata already carries the `intent_id` → no-op.
3. `hermes kanban comment` (explains the repair), then
   `hermes kanban complete --metadata '{"mc_reconciliation": {...}}'` with
   `intent_id, old_status, new_status, reason, authoritative_evidence_id,
   timestamp, reconciliation_version`. No edit, archive or delete commands.

Enabling it will need its own approval. Recommended shape: a new
`kanban.reconcile` AgentRequest kind (approval-required, like the other Kanban
writes) carrying one intent, executed only after the precondition check.
The bridge is not given general Kanban write authority.

`RECONCILE_MODE=apply` is accepted but degrades to preview in this release
(logged as `reconcile_apply_unavailable`).

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `HERMES_BOARDS` | unset → `[HERMES_BOARD]` | Comma-separated read-only mirror allowlist |
| `MC_PROJECTS` | unset → none | Projects to reconcile; their boards must be in the allowlist |
| `RECONCILE_MODE` | `preview` | `off` \| `preview` (`apply` → preview) |
| `BRIDGE_RECONCILE_MS` | `300000` | Reconciliation interval |

With none of these set, the bridge behaves exactly as before.

To enable the RigSpecs pilot later (requires the migration first):

```dotenv
HERMES_BOARDS=default,rigspecs-production-integrity
MC_PROJECTS=rigspecs
RECONCILE_MODE=preview
```

Read-only preview anywhere Hermes state is readable (no database needed):

```sh
node hermes-bridge/scripts/reconcile-preview.mjs --project rigspecs --out /tmp/preview
```

## APIs (read-only, same auth as `/api/hermes/*`)

| Route | Returns |
|---|---|
| `GET /api/mc/overview` | Every project summary + approvals waiting + bridge health (PalmOS reads this) |
| `GET /api/mc/projects` | Project summaries |
| `GET /api/mc/projects/:id` | Summary, full derived state, approvals, tasks needing reconciliation |
| `GET /api/mc/projects/:id/milestones` | Milestones |
| `GET /api/mc/tasks?project=&board=&classification=` | Normalized task state |
| `GET /api/mc/reconciliation?project=` | Audit ledger + required items + orphan receipts |
| `GET /api/mc/receipts?project=` | Receipts |
| `GET /api/mc/approvals?project=&status=` | Approval records |

Existing routes are reused for runs (`/api/hermes/requests`) and health
(`/api/hermes/health`). Before the migration is applied, `/api/mc/*` answers
`503 {"code":"MC_SCHEMA_PENDING"}` and PalmOS shows "not migrated yet".

Project page: `/hermes/projects/:id`.

## Events (`McEvent`)

Deterministic ids, inserted with `ON CONFLICT DO NOTHING`, so replay is safe:
`receipt.created`, `receipt.verified`, `kanban.status_changed`,
`reconciliation.required`, `project.milestone_changed`.

## Production migration (awaiting approval)

`prisma/migrations/1_mission_control_reconciliation/migration.sql` —
six new tables, ten indexes, grants, two append-only triggers. It changes no
existing table, column or row.

| Table | Purpose | `hermes_bridge` | `hermes_web` | `anon` / `authenticated` |
|---|---|---|---|---|
| `McProject` | project + derived state | SELECT, INSERT, UPDATE | SELECT | revoked |
| `McTaskState` | normalized task state | SELECT, INSERT, UPDATE | SELECT | revoked |
| `McReceipt` | receipts by content hash | SELECT, INSERT, UPDATE | SELECT | revoked |
| `McApproval` | approval records | SELECT, INSERT, UPDATE | SELECT | revoked |
| `McReconciliation` | audit ledger | SELECT, INSERT (append-only trigger) | SELECT | revoked |
| `McEvent` | event log | SELECT, INSERT (append-only trigger) | SELECT | revoked |

Rollback: `prisma/migrations/1_mission_control_reconciliation/rollback.sql`
(drops only these objects and the migration record).

Verified on a throwaway PostgreSQL 15 with Supabase-like roles and default
privileges: `prisma migrate deploy` applies cleanly; grants are as listed;
`hermes_bridge` cannot update/delete the ledger or delete state; the owner is
also blocked by the trigger; duplicate `(intentId, mode)` is rejected;
`hermes_web` cannot write; `anon` cannot read; rollback removes everything;
re-apply succeeds; `prisma migrate diff` shows no drift.

### Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Lock contention on existing tables | None | — | Only `CREATE` statements on new tables |
| Breaking the deployed web app | Low | Low | New routes only; existing queries unchanged; Prisma client tolerates extra tables |
| Bridge breaks after deploy | Low | Medium | Reconciliation is off unless `MC_PROJECTS` is set; schema check before any write |
| New tables exposed via the Supabase Data API | Mitigated | High | `anon`/`authenticated` revoked explicitly |
| Rollback loses the audit ledger | Medium (if rolled back after use) | Low | Export commands in `rollback.sql` |
| Supabase default ACL differs from expectation | Low | Low | Grants are guarded `DO` blocks; verify with the query below |

Post-apply verification (read-only):

```sql
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
FROM information_schema.role_table_grants
WHERE table_name LIKE 'Mc%' AND grantee NOT IN ('postgres','supabase_admin','service_role')
GROUP BY 1, 2 ORDER BY 1, 2;
```

### Pre-existing finding (not changed here)

All existing public tables (`AgentRequest`, `AgentEvent`, `HermesTask`,
`DataStore`, `HermesMemory`, …) have RLS disabled and full privileges for
`anon` and `authenticated` (Supabase defaults). If the Supabase Data API is
enabled for this project, the anon key could read and write them — including
inserting `approved` AgentRequests. Recommend a separate, approved change to
revoke those grants or enable RLS.
