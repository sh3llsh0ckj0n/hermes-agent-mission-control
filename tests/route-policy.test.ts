import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  classifyRouteAccess,
  decideProxyAccess,
} from "../src/lib/route-policy";
import { hasValidInternalSecret } from "../src/lib/security";

const noAuth = {
  isDevelopment: false,
  hasInternalSecret: false,
  isAuthenticated: false,
};

function decision(pathname: string, overrides = "", options = noAuth) {
  return decideProxyAccess(classifyRouteAccess(pathname, overrides), options);
}

test("enabled core pages and standalone login remain available", () => {
  for (const pathname of ["/", "/hermes", "/memory-wiki", "/tasks"]) {
    const route = classifyRouteAccess(pathname, "");
    assert.equal(route.kind, "module-page", pathname);
    assert.equal(route.available, true, pathname);
  }

  assert.equal(decision("/login"), "allow");
});

test("disabled page routes and their nested paths fail closed", () => {
  for (const pathname of [
    "/ideas",
    "/ideas/archive",
    "/agents",
    "/content-os",
    "/youtube",
    "/longform/drafts/123",
    "/articles",
    "/client-pulse",
    "/garden",
    "/watchlist-radar",
  ]) {
    assert.equal(decision(pathname), "not_found", pathname);
  }
});

test("X match routes inherit the X module state", () => {
  for (const pathname of [
    "/x",
    "/x-content",
    "/x-content/drafts/123",
    "/x-analytics",
    "/x-analytics/history",
  ]) {
    const route = classifyRouteAccess(pathname, "");
    assert.deepEqual(route.moduleIds, ["x"], pathname);
    assert.equal(decision(pathname), "not_found", pathname);
  }
});

test("disabled module APIs return unavailable decisions including Garden", () => {
  for (const pathname of [
    "/api/ideas",
    "/api/agents",
    "/api/agent-chat",
    "/api/articles/generate-titles",
    "/api/client-pulse",
    "/api/garden",
    "/api/garden/nested",
    "/api/longform/generate",
    "/api/trends/update",
    "/api/watchlist-radar",
    "/api/x-analytics",
    "/api/x-content/feedback",
    "/api/youtube/scripts",
  ]) {
    const route = classifyRouteAccess(pathname, "");
    assert.equal(route.kind, "module-api", pathname);
    assert.equal(decision(pathname), "not_found", pathname);
  }
});

test("module availability precedes development and internal-secret bypasses", () => {
  const disabled = classifyRouteAccess("/api/garden", "");
  const headers = new Headers({ "x-internal-secret": "test-secret" });
  const validInternalSecret = hasValidInternalSecret(headers, "test-secret");

  assert.equal(validInternalSecret, true);
  assert.equal(
    decideProxyAccess(disabled, {
      isDevelopment: false,
      hasInternalSecret: validInternalSecret,
      isAuthenticated: true,
    }),
    "not_found",
  );
  assert.equal(
    decideProxyAccess(disabled, {
      isDevelopment: true,
      hasInternalSecret: false,
      isAuthenticated: false,
    }),
    "not_found",
  );
});

test("system auth APIs and enabled Hermes APIs remain available", () => {
  assert.equal(decision("/api/auth/session"), "allow");

  for (const pathname of [
    "/api/hermes/activity",
    "/api/hermes/briefing",
    "/api/hermes/cost",
    "/api/hermes/crons",
    "/api/hermes/dispatch",
    "/api/hermes/health",
    "/api/hermes/memory",
    "/api/hermes/requests",
    "/api/hermes/requests/request-1",
    "/api/hermes/tasks",
  ]) {
    const route = classifyRouteAccess(pathname, "");
    assert.equal(route.kind, "module-api", pathname);
    assert.equal(route.available, true, pathname);
  }
});

test("unknown application and API routes are not treated as enabled modules", () => {
  for (const pathname of [
    "/not-a-real-module",
    "/api/not-a-real-module",
    "/api/tasks",
  ]) {
    const route = classifyRouteAccess(pathname, "");
    assert.equal(route.kind, "unknown", pathname);
    assert.equal(route.available, false, pathname);
    assert.equal(decideProxyAccess(route, {
      isDevelopment: true,
      hasInternalSecret: true,
      isAuthenticated: true,
    }), "not_found", pathname);
  }
});

test("module overrides enable owned routes and invalid values fail safely", () => {
  assert.equal(decision("/ideas", "+ideas", noAuth), "login");
  assert.equal(decision("/api/ideas", "+ideas", noAuth), "unauthorized");

  // The exact base endpoint is shared by Content OS, X, and Watchlist.
  assert.equal(decision("/api/x-content", "+content", noAuth), "unauthorized");
  assert.equal(decision("/api/x-content/feedback", "+content", noAuth), "not_found");
  assert.equal(decision("/api/watchlist-radar", "+x", noAuth), "unauthorized");

  assert.equal(decision("/agents", "agents=maybe"), "not_found");
  assert.equal(decision("/api/agents", "unknown=true,+broken"), "not_found");

  assert.equal(decision("/hermes", "-hermes"), "not_found");
  assert.equal(decision("/api/hermes/cost", "-hermes"), "not_found");
});

test("production authentication decisions preserve API and page semantics", () => {
  assert.equal(decision("/api/garden"), "not_found");
  assert.equal(decision("/api/hermes/health"), "unauthorized");
  assert.equal(decision("/hermes"), "login");

  assert.equal(
    decision("/hermes", "", { ...noAuth, isAuthenticated: true }),
    "allow",
  );
  assert.equal(
    decision("/api/hermes/health", "", {
      ...noAuth,
      hasInternalSecret: true,
    }),
    "allow",
  );
});

test("Next.js uses proxy.ts exclusively", () => {
  assert.equal(existsSync(new URL("../src/middleware.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/proxy.ts", import.meta.url)), true);
});
