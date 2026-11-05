# P2 proposal: approval security hardening

Status: proposal only. This document does not change routes, the proxy, the database, the JSON ledger, or Kanban.

Reconcile this proposal with `ops/DESIGN-bridge-approval-validation.md` on Jonny's machine before any implementation. That file was not in this workspace, so the two documents may disagree. The git JSON ledger described below stays authoritative either way.

## Problem

Three current behaviors let a caller change approval state without a bound human decision.

1. `src/proxy.ts` accepts `x-internal-secret` when it equals `INTERNAL_API_SECRET`, after the route-availability check and before session authentication. The check does not look at the HTTP method. Any available page or API, including `PATCH /api/hermes/requests/[id]`, is allowed when the secret matches. Disabled modules still 404 first. In `NODE_ENV=development` the proxy allows the request even without the secret.
2. `PATCH /api/hermes/requests/[id]` sets `status` to `approved` for `action: "approve"` without reading a session, storing an approver, or binding a package hash. The handler does not call `getServerSession` or `isEmailAllowed`.
3. `action: "edit"` writes `status: "approved"` and, in the same `agentRequest.update`, may replace `prompt` and `title`. Edit and approve are one operation.

These paths are Hermes `AgentRequest` decisions. They are not RigSpecs project approvals. RigSpecs authority is `hermes-bridge/config/approvals/rigspecs.json`. `McApproval` is the bridge's mirror. A write to `McApproval` is not a grant.

## Goals

- `INTERNAL_API_SECRET` cannot approve, reject, or edit a request.
- Every mutation requires an authenticated, allowlisted Google session.
- The approver identity comes from that session, not from the body.
- A decision binds the exact bytes being approved.
- Edit and approve are separate operations.
- The JSON ledger remains the only authority for RigSpecs execution.
- If a signed decision needs a database carrier, that table is append-only and non-authoritative.

## Non-goals

- No approve or reject buttons on `/hermes/approvals`.
- No change to `isGranted` in `hermes-bridge/lib/reconcile.mjs` that would trust `McApproval` or a new carrier table.
- No migration applied from this proposal.
- No production deploy.

## 1. Stop the internal secret from mutating

In `src/proxy.ts`, `hasValidInternalSecret` may continue to authenticate explicitly listed read-only machine routes if operations still need it. It must not authenticate any mutating method.

Proposed rule, applied before the session check:

| Request | `INTERNAL_API_SECRET` |
|---|---|
| `GET`/`HEAD` of an allowlisted read route | May allow, if that route is on a reviewed list |
| `POST`, `PUT`, `PATCH`, `DELETE`, or any other method | Ignore the secret and require a session |
| `/api/hermes/requests` and `/api/hermes/requests/[id]` | Never allow via the secret, including `GET` if the response contains prompts |

The development bypass (`NODE_ENV === "development"` then `NextResponse.next()`) must not apply to mutating methods. Local development can use a real allowlisted session. A missing session on a mutation returns 401.

Handlers must repeat the check. The proxy is not the only gate. Each mutation route calls the same helper and returns 401 when the session is missing or the email is not allowlisted, even if a proxy bug let the request through.

`decideApprovalAccess` in the read-only viewer is the session shape to reuse: trim and lowercase the email, fail closed on an empty allowlist, and do not accept the internal secret as an argument.

## 2. Separate edit from approve

Replace the single `PATCH` action switch with two operations.

### Edit

`PATCH /api/hermes/requests/[id]`

- Session required.
- Allowed only while status is `awaiting_approval`, or `queued` when the server-owned policy says approval is required.
- Body may include `title` and `prompt` only.
- Does not set `status`, `decidedAt`, or `approver`.
- Unknown fields are ignored, including `action`, `status`, `sideEffecting`, and `approver`.
- Response returns the edited row still waiting.

### Decide

`POST /api/hermes/requests/[id]/decision`

- Session required.
- Body is `{ "decision": "approve" | "reject", "packageSha256": "<64 lowercase hex>" }`.
- No `title` or `prompt` fields. If they are present, respond 400 and write nothing.
- Approver email and the Google subject (`token.sub`) are copied from the session.
- `packageSha256` must equal `sha256(utf8(title) || "\n" || utf8(prompt))` of the row as stored at decision time. The client-supplied hash is compared to a server-computed hash. A mismatch returns 409 and does not decide.
- Approve sets `status: "approved"`, `decidedAt`, `approverEmail`, `approverSub`, and `approvedPayloadSha256` in one update that also re-checks the status in the `WHERE` clause (`awaiting_approval` or the queued-and-required case). Zero rows updated means 409.
- Reject sets `status: "rejected"` with the same identity columns and the same hash binding, so the rejection refers to a specific payload.
- A later edit of an approved row is refused. Changing the prompt requires a new request.

The bridge, before it claims an approved request, recomputes that payload hash and refuses the claim when it differs from `approvedPayloadSha256`. That check belongs in `hermes-bridge` queue claim code and is part of this proposal's implementation scope, not this document's branch.

## 3. RigSpecs packages stay on the JSON ledger

Execution gating stays in `isGranted`:

- `status` must be `granted`.
- When the gate carries a package hash, `package_sha256` must equal that hash and the current file hash.
- A changed package does not stay granted.

`McApproval.packageMatches` and `McApproval.status` remain display copies written by `hermes-bridge/lib/mc-persist.mjs`. The web app must not insert or update `McApproval`. The read-only package view already refuses to call a grant valid from mirrored status alone.

A human grant of a RigSpecs package is a change to `hermes-bridge/config/approvals/rigspecs.json` that sets, together:

- `status: "granted"`
- `approver`
- `decided_at`
- `package_sha256` equal to the sealed package that was reviewed

Anything else continues to block execution, matching the comment already in that file. Promotion into the ledger is a reviewed git change. It is not an API call.

## 4. Carrier table, only if a signed decision must be stored before the git commit

Do not add this table unless a product decision says the website must record a human signature before someone updates the JSON ledger. The table does not grant anything.

### Schema

```sql
CREATE TABLE "ApprovalDecision" (
  "id"                TEXT PRIMARY KEY,
  "projectId"         TEXT NOT NULL,
  "approvalId"        TEXT NOT NULL,
  "packageSha256"     TEXT NOT NULL,
  "decision"          TEXT NOT NULL,
  "statement"         TEXT NOT NULL,
  "approverEmail"     TEXT NOT NULL,
  "approverSub"       TEXT NOT NULL,
  "sessionIssuedAt"   TIMESTAMPTZ NOT NULL,
  "ledgerCommit"      TEXT,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "ApprovalDecision_packageSha256_hex"
    CHECK ("packageSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ApprovalDecision_decision_kind"
    CHECK ("decision" IN ('grant', 'reject')),
  CONSTRAINT "ApprovalDecision_statement_len"
    CHECK (char_length("statement") BETWEEN 8 AND 500),
  CONSTRAINT "ApprovalDecision_id_form"
    CHECK ("id" ~ '^dec_[0-9a-f-]{36}$')
);

CREATE INDEX "ApprovalDecision_approval_created_idx"
  ON "ApprovalDecision" ("projectId", "approvalId", "createdAt");

REVOKE ALL ON TABLE "ApprovalDecision" FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE "ApprovalDecision" TO hermes_web;
GRANT SELECT ON TABLE "ApprovalDecision" TO hermes_bridge;
```

`hermes_web` is insert-only at the privilege level plus the trigger below, because PostgreSQL has no insert-only grant that also blocks later updates by the table owner. The trigger is the control that matters:

```sql
CREATE OR REPLACE FUNCTION "approval_decision_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ApprovalDecision is append-only';
END;
$$;

CREATE TRIGGER "ApprovalDecision_no_update"
  BEFORE UPDATE OR DELETE ON "ApprovalDecision"
  FOR EACH ROW
  EXECUTE FUNCTION "approval_decision_append_only"();
```

`ledgerCommit` is the exception that makes a carrier point at the git commit which copied it into the ledger. Allow only that column to move from null to a 40-hex commit id, once:

```sql
CREATE OR REPLACE FUNCTION "approval_decision_commit_link"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."ledgerCommit" IS NOT NULL THEN
    RAISE EXCEPTION 'ledger commit already recorded';
  END IF;
  IF NEW."ledgerCommit" IS NULL OR NEW."ledgerCommit" !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'ledger commit must be a git sha';
  END IF;
  IF (to_jsonb(NEW) - 'ledgerCommit') <> (to_jsonb(OLD) - 'ledgerCommit') THEN
    RAISE EXCEPTION 'only ledgerCommit may change';
  END IF;
  RETURN NEW;
END;
$$;
```

Use this function instead of the blanket append-only trigger if commit linking is required. Otherwise keep the blanket trigger and leave `ledgerCommit` unused.

### Security model

- Insert is allowed only from the web server after `decideApprovalAccess` succeeds.
- `approverEmail` and `approverSub` are taken from the JWT. The body cannot set them.
- `packageSha256` must equal the pinned hash the operator was shown, and the server recomputes it only from ledger data already loaded for display. The body hash is a confirmation, not the source of truth.
- `decision` is `grant` or `reject`. There is no edit verb.
- The bridge's reconcile and claim paths do not read this table.
- `isGranted` stays false until `rigspecs.json` contains the matching `granted` entry.
- A row here is evidence that a person signed a statement. It becomes an approval only when a reviewed commit copies `approver`, `decided_at`, and `package_sha256` into the JSON ledger.
- `McApproval` is still overwritten from that ledger on the next reconcile. Inserting into `ApprovalDecision` does not update `McApproval`.
- `anon` and `authenticated` have no privileges, same posture as the Mission Control tables.
- The service role used by the website is `hermes_web`, not the migration owner.

No SQL file in `prisma/migrations` should be added until this proposal is reconciled with Jonny's design note and explicitly approved. Applying it is out of scope.

## 5. Implementation order, when approved

1. Add session checks and the split edit/decide routes for `AgentRequest`, with the payload hash column on `AgentRequest` (an existing table; this is a real migration and needs its own approval).
2. Teach the bridge claim path to refuse an approved request whose payload hash moved.
3. Remove `INTERNAL_API_SECRET` from every mutating proxy decision, and from the development bypass for those methods.
4. Only then, and only if still required, add `ApprovalDecision` and a manual playbook for copying a signed row into `rigspecs.json`.

Do not ship step 4 as a substitute for steps 1–3.

## Open point

`ops/DESIGN-bridge-approval-validation.md` was not available here. Before implementation, compare its carrier shape, hash rule, and ledger promotion steps with sections 3 and 4 and keep the stricter rule where they differ. The JSON ledger remains authoritative in that reconciliation.
