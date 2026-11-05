import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

import { classifyDatabaseFailure, logMissionControlFailure } from "../src/lib/mc-diagnostics";
import { withMissionControl } from "../src/lib/mission-control";

const SECRET = "SELECT password FROM users WHERE token = 'super-secret'";

test("prisma timeout codes are labeled without copying the driver message", () => {
  for (const code of ["P1008", "P2024"]) {
    const error = new Prisma.PrismaClientKnownRequestError(SECRET, {
      code,
      clientVersion: "test",
    });
    const classified = classifyDatabaseFailure(error);
    assert.equal(classified.category, "timeout");
    assert.equal(classified.prismaCode, code);
    assert.equal(JSON.stringify(classified).includes(SECRET), false);
  }
});

test("schema-pending and startup failures keep their existing categories", () => {
  const missing = new Prisma.PrismaClientKnownRequestError("table missing", {
    code: "P2021",
    clientVersion: "test",
  });
  assert.equal(classifyDatabaseFailure(missing).category, "schema_pending");

  const init = new Prisma.PrismaClientInitializationError("bad url postgresql://user:password@db", "test");
  const classified = classifyDatabaseFailure(init);
  assert.equal(classified.category, "unavailable");
  assert.equal(JSON.stringify(classified).includes("password"), false);
});

test("unknown failures stay unknown instead of being called timeouts", () => {
  assert.equal(classifyDatabaseFailure(new Error("something timed out: " + SECRET)).category, "unknown");
  const other = new Prisma.PrismaClientKnownRequestError(SECRET, {
    code: "P2028",
    clientVersion: "test",
  });
  assert.deepEqual(classifyDatabaseFailure(other), { category: "unknown", prismaCode: "P2028" });
});

test("route logs omit queries, paths, and the driver message", () => {
  const error = new Prisma.PrismaClientKnownRequestError(SECRET + " /home/jonny/kanban.db", {
    code: "P1008",
    clientVersion: "test",
  });
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    logMissionControlFailure("GET /api/mc/overview", error);
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.event, "mission_control_read_failure");
  assert.equal(entry.route, "GET /api/mc/overview");
  assert.equal(entry.category, "timeout");
  assert.equal(entry.prismaCode, "P1008");
  assert.equal(lines[0].includes(SECRET), false);
  assert.equal(lines[0].includes("/home/"), false);
  assert.equal(lines[0].includes("meta"), false);
});

test("mission control reads return a sanitized 500 for an unclassified failure", async () => {
  const response = await withMissionControl(
    async () => {
      throw new Prisma.PrismaClientKnownRequestError(SECRET, {
        code: "P2028",
        clientVersion: "test",
      });
    },
    { route: "GET /api/mc/overview" },
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, "MC_READ_FAILED");
  assert.equal(body.category, "unknown");
  assert.equal(JSON.stringify(body).includes(SECRET), false);
  assert.equal(JSON.stringify(body).includes("P2028"), false);
});

test("a prisma timeout code is labeled on the PalmOS overview route and still fails", async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const response = await withMissionControl(
      async () => {
        throw new Prisma.PrismaClientKnownRequestError(SECRET, {
          code: "P1008",
          clientVersion: "test",
        });
      },
      { route: "GET /api/mc/overview" },
    );
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.category, "timeout");
    assert.equal(body.code, "MC_READ_FAILED");
    assert.equal(JSON.stringify(body).includes(SECRET), false);
  } finally {
    console.error = original;
  }
  assert.match(lines.join("\n"), /GET \/api\/mc\/overview/);
  assert.equal(lines.join("\n").includes(SECRET), false);
});
