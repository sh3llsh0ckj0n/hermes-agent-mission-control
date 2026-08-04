# Hermes Bridge

The bridge is an outbound-only Node.js service between mission control, a
shared PostgreSQL database, and the local Hermes CLI. It mirrors local Hermes
state into the dashboard and atomically claims approved `AgentRequest` work.
It does not expose an inbound network port.

```text
website ── AgentRequest ──> PostgreSQL <── atomic claim ── bridge ──> Hermes CLI
website <── mirror tables ─ PostgreSQL <── local state ─── bridge <── Hermes CLI
```

## Safety model

- Queue claims run in a PostgreSQL transaction using `FOR UPDATE SKIP LOCKED`
  and `UPDATE ... RETURNING`. A request is marked `running` with `startedAt`
  in the same atomic operation.
- Only classified read-only work may be claimed from `queued`. All local,
  external, privileged, and destructive writes require `approved`.
- Unknown request kinds fail closed. The bridge derives `sideEffecting`; it
  never trusts the value supplied by a browser or API caller.
- Wiki access is limited to relative `.md` files under `HERMES_WIKI`.
  Traversal, absolute paths, null bytes, unsupported extensions, and symbolic
  links are rejected before reads, writes, directory creation, or Git commands.
- Child processes run without a shell, with argument arrays, timeouts, and
  bounded output. Side-effecting work is never retried automatically.
- Structured JSON logs redact credential-like fields and PostgreSQL URL
  credentials.

## Requirements

- Node.js 22 or newer
- Direct PostgreSQL access from the bridge host
- Hermes CLI `>=0.17.0 <0.21.0`
- Git, if memory-wiki writes are enabled
- A dedicated operating-system account and a least-privilege database role

The database role needs only the tables used by the bridge:
`AgentRequest`, `AgentEvent`, `HermesTask`, `HermesMemory`, and `DataStore`.
Grant only the required `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges.
Do not use a database owner or migration role for the service.

## Install

```sh
cd hermes-bridge
npm ci
npm test
npm run check
```

The committed lockfile makes deployment installs reproducible.

## Secure environment file

Create `/etc/hermes-bridge/hermes-bridge.env` as root, replace every
placeholder, and make it readable only by root and the bridge group:

```sh
sudo install -d -o root -g hermes-bridge -m 0750 /etc/hermes-bridge
sudo install -o root -g hermes-bridge -m 0640 /dev/null \
  /etc/hermes-bridge/hermes-bridge.env
sudoedit /etc/hermes-bridge/hermes-bridge.env
```

Example contents (fake values only):

```dotenv
DATABASE_URL=postgresql://bridge_user:replace_me@db.example.invalid:5432/hermes
BRIDGE_DB_TLS_MODE=verify-full
BRIDGE_DB_CA_FILE=/etc/hermes-bridge/postgres-ca.pem
BRIDGE_INSTANCE_ID=mission-control-bridge-01
HERMES_BIN=/usr/local/bin/hermes
HERMES_MIN_VERSION=0.17.0
HERMES_MAX_VERSION_EXCLUSIVE=0.21.0
HERMES_BOARD=default
HERMES_WIKI=/var/lib/hermes-bridge/wiki
BRIDGE_POLL_MS=5000
BRIDGE_MIRROR_MS=30000
BRIDGE_RUN_TIMEOUT_MS=240000
BRIDGE_CLAIM_BATCH_SIZE=1
BRIDGE_MAX_RETRY_ATTEMPTS=3
BRIEF_HOUR=8
```

Do not put the environment file in this repository, a systemd unit, shell
history, or process arguments.

## PostgreSQL TLS

Remote databases default to `BRIDGE_DB_TLS_MODE=verify-full`, which uses
certificate verification. Set `BRIDGE_DB_CA_FILE` when the database uses a
private certificate authority. Loopback development databases default to
unencrypted transport.

`BRIDGE_DB_TLS_MODE=disable` is an explicit development-only opt-out.
The bridge refuses that setting when `NODE_ENV=production`. Connection
strings are never included in bridge log metadata.

## Hermes CLI compatibility

Startup runs only `hermes --version`; it does not execute agent work. The
bridge supports Hermes `>=0.17.0 <0.21.0` and fails before polling if the
executable is absent, the version is unparseable, or the version is outside
that range. The exclusive upper bound prevents an unreviewed future
compatibility line from starting.

Current command assumptions:

- `hermes --version`
- `hermes -z <prompt>`
- `hermes status`
- `hermes insights [--days 7]`
- `hermes kanban --board <board> list --json`
- `hermes kanban --board <board> create --json --idempotency-key <key> <title>`
- `hermes cron list --all`
- `hermes cron create <schedule> <prompt>`
- `hermes cron <edit|pause|resume|run|remove> <id-or-name>`

Validate these shapes against a new Hermes release before changing
`HERMES_MIN_VERSION` or `HERMES_MAX_VERSION_EXCLUSIVE`.

## systemd installation

Review `hermes-bridge.service.example`, especially the paths and
`ReadWritePaths`, then install it:

```sh
sudo cp hermes-bridge.service.example /etc/systemd/system/hermes-bridge.service
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-bridge
sudo systemctl status hermes-bridge
```

The example runs as `hermes-bridge`, reads the protected environment file,
writes only to the configured service data path, and sends JSON logs to the
system journal. If Hermes is installed under a different account, adjust the
service user and filesystem permissions deliberately.

Logs:

```sh
journalctl -u hermes-bridge
journalctl -u hermes-bridge -f
```

The existing launchd plist is retained as a macOS template and uses Node 22's
`--env-file` support. Put the same environment values in
`~/.config/hermes-bridge/env`, set mode `0600`, and edit only the non-secret
paths in the copied plist. Do not place a real database URL directly in the
plist or repository.

## Lifecycle, retries, and failures

`BRIDGE_INSTANCE_ID` identifies every structured log and startup event. If it
is omitted, the bridge generates a runtime identifier from sanitized host,
process, and random metadata.

`SIGINT` and `SIGTERM` stop new polling, interrupt an active CLI process,
record a categorized failure when possible, close the PostgreSQL pool, and
exit. Claimed requests are never returned to `queued`, preventing a second
bridge from replaying uncertain side effects after a crash.

Read-only work may retry transient CLI failures or timeouts up to
`BRIDGE_MAX_RETRY_ATTEMPTS` with exponential backoff. Validation failures,
unsafe paths, approval failures, rejected work, and all side-effecting work
receive one attempt. Errors stored on requests are categorized and truncated.

## Troubleshooting

- `Hermes executable was not found`: set `HERMES_BIN` to the executable path
  and verify the service user can execute it.
- `incompatible`: verify the installed Hermes version and the command shapes
  above. Do not bypass the check without reviewing compatibility.
- TLS or certificate error: keep `verify-full`; install the correct CA file
  and set `BRIDGE_DB_CA_FILE`.
- Permission denied in the wiki: give the service user access only to
  `HERMES_WIKI`; do not run the bridge as root.
- Requests remain `awaiting_approval`: approve them in mission control.
- Requests remain `running` after a crash: review the stored event/error and
  the external system before deciding manually whether replay is safe.
- No mirrored data: inspect `journalctl`, database grants, and the read-only
  CLI commands. Do not run schema migrations from the bridge host.
