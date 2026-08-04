import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MODULES,
  getEnabledModules,
  getNavigationGroups,
  parseModuleOverrides,
  resolveModules,
} from "../src/config/modules";

test("core Hermes modules are enabled by default", () => {
  assert.deepEqual(
    getEnabledModules("").map((module) => module.id),
    ["home", "hermes", "memory-wiki", "tasks"],
  );
});

test("module overrides support explicit and shorthand values", () => {
  const resolved = resolveModules("+agents,ideas=on,-tasks,youtube=false");
  const enabled = new Set(resolved.filter((module) => module.enabled).map((module) => module.id));

  assert.equal(enabled.has("agents"), true);
  assert.equal(enabled.has("ideas"), true);
  assert.equal(enabled.has("tasks"), false);
  assert.equal(enabled.has("youtube"), false);
});

test("invalid module configuration is ignored safely", () => {
  const parsed = parseModuleOverrides("unknown=true,tasks=maybe,broken");

  assert.deepEqual(parsed.overrides, {});
  assert.deepEqual(parsed.invalidEntries, ["unknown=true", "tasks=maybe", "broken"]);
  assert.deepEqual(
    resolveModules("unknown=true,tasks=maybe,broken").map(({ id, enabled }) => ({ id, enabled })),
    DEFAULT_MODULES.map(({ id, enabled }) => ({ id, enabled })),
  );
});

test("disabled modules do not appear in navigation data", () => {
  const navigationIds = getNavigationGroups("")
    .flatMap((group) => group.items)
    .map((module) => module.id);

  assert.deepEqual(navigationIds, ["home", "hermes", "memory-wiki", "tasks"]);
  assert.equal(navigationIds.includes("agents"), false);
  assert.equal(navigationIds.includes("x"), false);
});

test("the default visible shell contains no creator-specific names", () => {
  const visibleShell = getEnabledModules("")
    .flatMap((module) => [module.id, module.label, module.route, module.category ?? ""])
    .join(" ")
    .toLowerCase();

  for (const creatorTerm of ["max", "sage", "knox", "nova", "pixel", "creator hq", "trading"]) {
    assert.equal(visibleShell.includes(creatorTerm), false, `unexpected default-shell term: ${creatorTerm}`);
  }
});
