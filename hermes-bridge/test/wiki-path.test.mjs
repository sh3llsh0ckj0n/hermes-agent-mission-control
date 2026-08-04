import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createWikiPathGuard } from "../lib/wiki-path.mjs";

function fixture(t) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-wiki-path-"));
  const wikiRoot = path.join(temporaryRoot, "wiki");
  fs.mkdirSync(path.join(wikiRoot, "facts"), { recursive: true });
  fs.writeFileSync(path.join(wikiRoot, "facts", "valid.md"), "# valid");
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  return { temporaryRoot, wikiRoot, guard: createWikiPathGuard(wikiRoot) };
}

test("valid nested markdown paths resolve beneath the canonical wiki root", (t) => {
  const { wikiRoot, guard } = fixture(t);
  const result = guard.resolveMarkdownPath("facts/nested/example.md");

  assert.equal(result.relativePath, "facts/nested/example.md");
  assert.equal(result.absolutePath, path.join(wikiRoot, "facts", "nested", "example.md"));
});

test("wiki paths reject traversal, encoded traversal, and mixed separators", (t) => {
  const { guard } = fixture(t);
  for (const unsafe of [
    "../outside.md",
    "%2e%2e%2foutside.md",
    "%2e%2e%5coutside.md",
    "..\\outside.md",
    "facts\\..\\outside.md",
    "%252e%252e%252foutside.md",
  ]) {
    assert.throws(() => guard.resolveMarkdownPath(unsafe), /unsafe|Absolute|escapes/i);
  }
});

test("wiki paths reject Windows paths, POSIX absolute paths, null bytes, and other extensions", (t) => {
  const { guard } = fixture(t);
  for (const unsafe of [
    "C:\\Windows\\system32\\drivers\\etc\\hosts.md",
    "\\\\server\\share\\note.md",
    "/etc/passwd.md",
    "facts/note.txt",
    "facts/\0note.md",
  ]) {
    assert.throws(() => guard.resolveMarkdownPath(unsafe));
  }
});

test("wiki paths reject sibling-prefix bypasses", (t) => {
  const { guard } = fixture(t);
  assert.throws(
    () => guard.resolveMarkdownPath("../wiki-backup/stolen.md"),
    /unsafe|escapes/i,
  );
});

test("wiki paths reject symbolic-link traversal", (t) => {
  const { temporaryRoot, wikiRoot, guard } = fixture(t);
  const outside = path.join(temporaryRoot, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.md"), "# secret");
  const link = path.join(wikiRoot, "linked");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      t.skip("symbolic links are not permitted in this test environment");
      return;
    }
    throw error;
  }

  assert.throws(
    () => guard.resolveMarkdownPath("linked/secret.md", { mustExist: true }),
    /Symbolic links|outside/i,
  );

  fs.unlinkSync(link);
  try {
    fs.symlinkSync(
      path.join(temporaryRoot, "missing-target"),
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") return;
    throw error;
  }
  assert.throws(
    () => guard.resolveMarkdownPath("linked/new.md"),
    /Symbolic links/i,
  );
});
