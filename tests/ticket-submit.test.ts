import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { proxy } from "../src/proxy";
import { classifyRouteAccess, decideProxyAccess } from "../src/lib/route-policy";
import { resolveTicketSubmitToken } from "../src/lib/security";
import {
  handleTicketSubmit,
  MAX_SUBMIT_BYTES,
  SUBMIT_RATE_LIMIT,
  TICKET_ASSIGNEES,
  type SubmittedRequest,
  type TicketCreateData,
  type TicketSubmitDependencies,
} from "../src/lib/ticket-submit";

// Test-only placeholder credentials (not real secrets).
const SUBMIT_TOKEN = "test-submit-token-0123456789abcdef0123456789";
const INTERNAL_SECRET = "test-internal-secret-fedcba9876543210fedcba98";
const ENV = {
  TICKET_SUBMIT_TOKEN: SUBMIT_TOKEN,
  INTERNAL_API_SECRET: INTERNAL_SECRET,
  HERMES_PRIMARY_BOARD: "mission-control",
};

const URL_SUBMIT = "http://localhost/api/hermes/submit";

function submitRequest(
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${SUBMIT_TOKEN}` },
): Request {
  return new Request(URL_SUBMIT, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Investigate flaky reconcile job",
    body: "Seen twice overnight.\n- check the mirror lock",
    assignee: "atlas",
    idempotencyKey: "codex-run-000123",
    ...overrides,
  };
}

type Store = {
  rows: Array<SubmittedRequest & { data: TicketCreateData }>;
  creates: number;
  logs: Array<Record<string, unknown>>;
};

function memoryDeps(
  store: Store = { rows: [], creates: 0, logs: [] },
  overrides: Partial<TicketSubmitDependencies> = {},
): TicketSubmitDependencies & { store: Store } {
  return {
    store,
    env: ENV,
    log: (entry) => store.logs.push(entry),
    findByIdempotencyKey: async (key) =>
      store.rows.find((row) => row.data.idempotencyKey === key) ?? null,
    recentSubmissions: async (submitter, since) => {
      const recent = store.rows
        .filter((row) => row.data.submitter === submitter && new Date(row.createdAt) >= since)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return { count: recent.length, oldest: recent[0] ? new Date(recent[0].createdAt) : null };
    },
    create: async (data) => {
      store.creates += 1;
      const row = {
        id: `request-${store.creates}`,
        kind: data.kind,
        status: data.status,
        title: data.title,
        createdAt: new Date(),
        data,
      };
      store.rows.push(row);
      return row;
    },
    ...overrides,
  };
}

// ─── Handler authentication ────────────────────────────────────────────────

test("submit rejects missing, wrong, and non-bearer credentials without writing", async () => {
  const cases: Array<Record<string, string>> = [
    {},
    { authorization: "Bearer wrong-token-wrong-token-wrong-token-00" },
    { authorization: `Bearer ${SUBMIT_TOKEN}x` },
    { authorization: `Bearer ${SUBMIT_TOKEN.slice(0, -1)}` },
    { authorization: `Basic ${SUBMIT_TOKEN}` },
    { authorization: SUBMIT_TOKEN },
  ];
  for (const headers of cases) {
    const deps = memoryDeps();
    const response = await handleTicketSubmit(submitRequest(validBody(), headers), deps);
    assert.equal(response.status, 401, JSON.stringify(headers));
    assert.equal(deps.store.creates, 0);
  }
});

test("submit rejects INTERNAL_API_SECRET in every form", async () => {
  const forms: Array<Record<string, string>> = [
    { "x-internal-secret": INTERNAL_SECRET },
    { authorization: `Bearer ${INTERNAL_SECRET}` },
  ];
  for (const headers of forms) {
    const deps = memoryDeps();
    const response = await handleTicketSubmit(submitRequest(validBody(), headers), deps);
    assert.equal(response.status, 401);
    assert.equal(deps.store.creates, 0);
  }
});

test("submit fails closed when the token is unset, short, or equal to the internal secret", async () => {
  for (const env of [
    { INTERNAL_API_SECRET: INTERNAL_SECRET },
    { TICKET_SUBMIT_TOKEN: "short", INTERNAL_API_SECRET: INTERNAL_SECRET },
    { TICKET_SUBMIT_TOKEN: SUBMIT_TOKEN, INTERNAL_API_SECRET: SUBMIT_TOKEN },
  ]) {
    assert.equal(resolveTicketSubmitToken(env), null);
    const deps = memoryDeps(undefined, { env });
    const response = await handleTicketSubmit(submitRequest(validBody()), deps);
    assert.equal(response.status, 401);
    assert.equal(deps.store.creates, 0);
  }
});

// ─── Proxy scoping ─────────────────────────────────────────────────────────

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function proxied(path: string, method: string, headers: Record<string, string>) {
  return proxy(new NextRequest(`http://localhost${path}`, { method, headers }));
}

const PROXY_ENV = {
  ...ENV,
  NEXTAUTH_SECRET: "test-nextauth-secret",
  NEXT_PUBLIC_MODULE_OVERRIDES: "",
};

test("the submit token is refused on every other route, including approval", async () => {
  for (const nodeEnv of ["production", "development"]) {
    await withEnv({ ...PROXY_ENV, NODE_ENV: nodeEnv }, async () => {
      for (const [method, path] of [
        ["PATCH", "/api/hermes/requests/request-1"],
        ["GET", "/api/hermes/requests"],
        ["POST", "/api/hermes/dispatch"],
        ["POST", "/api/hermes/tasks"],
        ["POST", "/api/hermes/tasks/task-1/action"],
        ["GET", "/api/hermes/health"],
        ["GET", "/api/mc/projects"],
        ["GET", "/api/auth/session"],
        ["GET", "/api/garden"],
        ["GET", "/api/not-a-route"],
        ["GET", "/hermes"],
        ["GET", "/login"],
        ["GET", "/"],
      ]) {
        const response = await proxied(path, method, {
          authorization: `Bearer ${SUBMIT_TOKEN}`,
        });
        assert.equal(response.status, 403, `${nodeEnv} ${method} ${path}`);
      }
    });
  }
});

test("the submit token cannot ride along with the internal secret elsewhere", async () => {
  await withEnv({ ...PROXY_ENV, NODE_ENV: "production" }, async () => {
    const response = await proxied("/api/hermes/requests/request-1", "PATCH", {
      authorization: `Bearer ${SUBMIT_TOKEN}`,
      "x-internal-secret": INTERNAL_SECRET,
    });
    assert.equal(response.status, 403);
  });
});

test("the proxy admits only the submit token on the submit route, even in development", async () => {
  for (const nodeEnv of ["production", "development"]) {
    await withEnv({ ...PROXY_ENV, NODE_ENV: nodeEnv }, async () => {
      const allowed = await proxied("/api/hermes/submit", "POST", {
        authorization: `Bearer ${SUBMIT_TOKEN}`,
      });
      assert.equal(allowed.status, 200, nodeEnv);
      assert.equal(allowed.headers.get("x-middleware-next"), "1");

      const rejected: Array<Record<string, string>> = [
        {},
        { "x-internal-secret": INTERNAL_SECRET },
        { authorization: `Bearer ${INTERNAL_SECRET}` },
        { authorization: "Bearer not-the-token" },
      ];
      for (const headers of rejected) {
        const response = await proxied("/api/hermes/submit", "POST", headers);
        assert.equal(response.status, 401, `${nodeEnv} ${JSON.stringify(headers)}`);
      }
    });
  }
});

test("the internal secret still works on its routes and route policy is consistent", async () => {
  await withEnv({ ...PROXY_ENV, NODE_ENV: "production" }, async () => {
    const response = await proxied("/api/hermes/requests", "GET", {
      "x-internal-secret": INTERNAL_SECRET,
    });
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  const submit = classifyRouteAccess("/api/hermes/submit", "");
  assert.equal(submit.auth, "ticket-submit");
  const everything = { isDevelopment: true, hasInternalSecret: true, isAuthenticated: true };
  assert.equal(decideProxyAccess(submit, everything), "unauthorized");
  assert.equal(
    decideProxyAccess(submit, { ...everything, hasTicketSubmitToken: true }),
    "allow",
  );
  assert.equal(
    decideProxyAccess(classifyRouteAccess("/api/hermes/requests/x", ""), {
      ...everything,
      hasTicketSubmitToken: true,
    }),
    "forbidden",
  );
  assert.equal(classifyRouteAccess("/api/hermes/submit/extra", "").kind, "unknown");
});

// ─── Request shape ─────────────────────────────────────────────────────────

test("a valid submission queues an approval-gated kanban.create on the server board", async () => {
  const deps = memoryDeps();
  const response = await handleTicketSubmit(submitRequest(validBody({ assignee: "Atlas" })), deps);
  assert.equal(response.status, 201);

  const json = await response.json();
  assert.equal(json.replayed, false);
  assert.deepEqual(Object.keys(json.request).sort(), ["createdAt", "id", "kind", "status", "title"]);
  assert.equal(json.request.status, "awaiting_approval");

  const [row] = deps.store.rows;
  assert.equal(row.data.kind, "kanban.create");
  assert.equal(row.data.status, "awaiting_approval");
  assert.equal(row.data.sideEffecting, true);
  assert.equal(row.data.origin, "codex");
  assert.equal(row.data.submitter, "codex");
  assert.equal(row.data.idempotencyKey, "codex:codex-run-000123");
  assert.deepEqual(JSON.parse(row.data.prompt ?? ""), {
    board: "mission-control",
    body: "Seen twice overnight.\n- check the mirror lock",
    assignee: "atlas",
    initialStatus: "blocked",
    submitter: "codex",
  });

  assert.deepEqual(deps.store.logs.at(-1), {
    submitter: "codex",
    outcome: "created",
    requestId: "request-1",
    idempotencyKey: "codex-run-000123",
  });
});

test("callers cannot choose kind, status, board, origin, or other fields", async () => {
  for (const extra of [
    { kind: "oneshot" },
    { status: "approved" },
    { board: "other-board" },
    { origin: "web" },
    { prompt: "rm -rf /" },
    { sideEffecting: false },
  ]) {
    const deps = memoryDeps();
    const response = await handleTicketSubmit(submitRequest(validBody(extra)), deps);
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.equal(deps.store.creates, 0);
  }
});

test("assignee allowlist matches the bridge allowlist", () => {
  // Keep in sync with KANBAN_CREATE_ASSIGNEES in hermes-bridge/lib/command-builder.mjs.
  assert.deepEqual([...TICKET_ASSIGNEES], ["atlas", "weaver", "amber", "claude", "artemis"]);
});

test("body and assignee are optional", async () => {
  const deps = memoryDeps();
  const response = await handleTicketSubmit(
    submitRequest({ title: "Minimal ticket", idempotencyKey: "minimal-0001" }),
    deps,
  );
  assert.equal(response.status, 201);
  assert.deepEqual(JSON.parse(deps.store.rows[0].data.prompt ?? ""), {
    board: "mission-control",
    initialStatus: "blocked",
    submitter: "codex",
  });
});

// ─── Idempotency ───────────────────────────────────────────────────────────

test("the same idempotencyKey returns the existing request and never duplicates", async () => {
  const deps = memoryDeps();
  const first = await handleTicketSubmit(submitRequest(validBody()), deps);
  const second = await handleTicketSubmit(
    submitRequest(validBody({ title: "A different title" })),
    deps,
  );
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  const [a, b] = [await first.json(), await second.json()];
  assert.equal(b.replayed, true);
  assert.equal(b.request.id, a.request.id);
  assert.equal(b.request.title, "Investigate flaky reconcile job");
  assert.equal(deps.store.creates, 1);

  const third = await handleTicketSubmit(
    submitRequest(validBody({ idempotencyKey: "codex-run-000124" })),
    deps,
  );
  assert.equal(third.status, 201);
  assert.equal(deps.store.creates, 2);
});

test("a concurrent insert that loses the unique race returns the winner", async () => {
  const winner: SubmittedRequest = {
    id: "request-winner",
    kind: "kanban.create",
    status: "awaiting_approval",
    title: "Investigate flaky reconcile job",
    createdAt: new Date(),
  };
  let lookups = 0;
  const deps = memoryDeps(undefined, {
    findByIdempotencyKey: async () => (lookups++ === 0 ? null : winner),
    create: async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    },
  });
  const response = await handleTicketSubmit(submitRequest(validBody()), deps);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.request.id, "request-winner");
  assert.equal(json.replayed, true);
});

// ─── Validation and limits ─────────────────────────────────────────────────

test("validation limits for title, body, assignee, and idempotencyKey", async () => {
  const accepted = [
    validBody({ title: "x".repeat(200) }),
    validBody({ body: "y".repeat(4_000) }),
    validBody({ body: null, assignee: null }),
    validBody({ idempotencyKey: "a".repeat(128) }),
    validBody({ idempotencyKey: "abcd1234" }),
    ...["atlas", "weaver", "amber", "claude", "artemis"].map((assignee) => validBody({ assignee })),
  ];
  for (const [index, body] of accepted.entries()) {
    const response = await handleTicketSubmit(submitRequest(body), memoryDeps());
    assert.equal(response.status, 201, `accepted #${index}`);
  }

  const rejected: unknown[] = [
    validBody({ title: undefined }),
    validBody({ title: "   " }),
    validBody({ title: 42 }),
    validBody({ title: "x".repeat(201) }),
    validBody({ title: "line one\nline two" }),
    validBody({ title: "--help" }),
    validBody({ body: "y".repeat(4_001) }),
    validBody({ body: 7 }),
    validBody({ body: "nul\u0000byte" }),
    validBody({ assignee: "root" }),
    validBody({ assignee: ["atlas"] }),
    validBody({ idempotencyKey: undefined }),
    validBody({ idempotencyKey: "short" }),
    validBody({ idempotencyKey: "a".repeat(129) }),
    validBody({ idempotencyKey: "has spaces in it" }),
    validBody({ idempotencyKey: "-leading-dash" }),
    [validBody()],
    "null",
    "{not json",
  ];
  for (const [index, body] of rejected.entries()) {
    const deps = memoryDeps();
    const response = await handleTicketSubmit(submitRequest(body), deps);
    assert.equal(response.status, 400, `rejected #${index}`);
    assert.equal(deps.store.creates, 0);
  }
});

test("oversized and non-JSON requests are refused before parsing", async () => {
  const huge = JSON.stringify(validBody({ body: "z".repeat(MAX_SUBMIT_BYTES) }));
  const declared = await handleTicketSubmit(submitRequest(huge), memoryDeps());
  assert.equal(declared.status, 413);

  // No content-length: the streamed body is capped while reading.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(huge));
      controller.close();
    },
  });
  const streamed = await handleTicketSubmit(
    new Request(URL_SUBMIT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SUBMIT_TOKEN}` },
      body: stream,
      duplex: "half",
    } as RequestInit),
    memoryDeps(),
  );
  assert.equal(streamed.status, 413);

  const wrongType = await handleTicketSubmit(
    submitRequest(validBody(), {
      authorization: `Bearer ${SUBMIT_TOKEN}`,
      "content-type": "text/plain",
    }),
    memoryDeps(),
  );
  assert.equal(wrongType.status, 415);
});

test("submissions are rate limited per hour while replays still resolve", async () => {
  const deps = memoryDeps();
  for (let index = 0; index < SUBMIT_RATE_LIMIT; index += 1) {
    const response = await handleTicketSubmit(
      submitRequest(validBody({ idempotencyKey: `rate-limit-${index}` })),
      deps,
    );
    assert.equal(response.status, 201);
  }

  const limited = await handleTicketSubmit(
    submitRequest(validBody({ idempotencyKey: "rate-limit-over" })),
    deps,
  );
  assert.equal(limited.status, 429);
  const retryAfter = Number(limited.headers.get("retry-after"));
  assert.ok(retryAfter > 0 && retryAfter <= 3600);
  assert.equal(deps.store.creates, SUBMIT_RATE_LIMIT);

  const replay = await handleTicketSubmit(
    submitRequest(validBody({ idempotencyKey: "rate-limit-0" })),
    deps,
  );
  assert.equal(replay.status, 200);

  // An hour later the window has moved on.
  const later = memoryDeps(deps.store, {
    now: () => new Date(Date.now() + 60 * 60 * 1000 + 1_000),
  });
  const after = await handleTicketSubmit(
    submitRequest(validBody({ idempotencyKey: "rate-limit-later" })),
    later,
  );
  assert.equal(after.status, 201);
});
