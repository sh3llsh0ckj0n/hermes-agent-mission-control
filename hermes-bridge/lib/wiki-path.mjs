import fs from "node:fs";
import path from "node:path";

import { UnsafePathError, ValidationError } from "./errors.mjs";

function decodePath(value) {
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      throw new UnsafePathError("Wiki path contains invalid percent encoding");
    }
  }
  return decoded;
}

function isOutside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function pathEntryExists(candidate, fsImpl) {
  try {
    fsImpl.lstatSync(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

function existingAncestor(candidate, root, fsImpl) {
  let current = candidate;
  while (current !== root && !pathEntryExists(current, fsImpl)) {
    current = path.dirname(current);
  }
  return current;
}

export function createWikiPathGuard(configuredRoot, { fsImpl = fs } = {}) {
  if (typeof configuredRoot !== "string" || !configuredRoot.trim()) {
    throw new ValidationError("HERMES_WIKI must be a non-empty path");
  }
  if (configuredRoot.includes("\0")) {
    throw new ValidationError("HERMES_WIKI contains a null byte");
  }

  const absoluteRoot = path.resolve(configuredRoot);
  const canonicalRoot = fsImpl.existsSync(absoluteRoot)
    ? fsImpl.realpathSync(absoluteRoot)
    : absoluteRoot;

  function resolveMarkdownPath(callerPath, { mustExist = false } = {}) {
    if (typeof callerPath !== "string" || !callerPath.trim()) {
      throw new UnsafePathError("Wiki path must be a non-empty relative path");
    }
    if (callerPath.includes("\0")) {
      throw new UnsafePathError("Wiki path contains a null byte");
    }

    const decoded = decodePath(callerPath.trim());
    if (path.posix.isAbsolute(decoded) || path.win32.isAbsolute(decoded)) {
      throw new UnsafePathError("Absolute wiki paths are not allowed");
    }

    const normalizedSeparators = decoded.replaceAll("\\", "/");
    const segments = normalizedSeparators.split("/");
    if (
      segments.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.toLowerCase() === ".git",
      )
    ) {
      throw new UnsafePathError("Wiki path contains an unsafe segment");
    }
    if (path.posix.extname(normalizedSeparators).toLowerCase() !== ".md") {
      throw new UnsafePathError("Only markdown (.md) wiki files are allowed");
    }

    const lexicalCandidate = path.resolve(absoluteRoot, ...segments);
    if (isOutside(absoluteRoot, lexicalCandidate)) {
      throw new UnsafePathError("Wiki path escapes the configured root");
    }
    if (mustExist && !fsImpl.existsSync(lexicalCandidate)) {
      throw new UnsafePathError("Wiki path does not exist");
    }

    const ancestor = existingAncestor(lexicalCandidate, absoluteRoot, fsImpl);
    if (pathEntryExists(ancestor, fsImpl)) {
      const ancestorStat = fsImpl.lstatSync(ancestor);
      if (ancestorStat.isSymbolicLink()) {
        throw new UnsafePathError("Symbolic links are not allowed in wiki paths");
      }
      const realAncestor = fsImpl.realpathSync(ancestor);
      if (isOutside(canonicalRoot, realAncestor)) {
        throw new UnsafePathError("Wiki path traverses a symbolic link outside the root");
      }
    }

    let current = absoluteRoot;
    for (const segment of segments) {
      current = path.join(current, segment);
      if (!pathEntryExists(current, fsImpl)) break;
      if (fsImpl.lstatSync(current).isSymbolicLink()) {
        throw new UnsafePathError("Symbolic links are not allowed in wiki paths");
      }
      const realCurrent = fsImpl.realpathSync(current);
      if (isOutside(canonicalRoot, realCurrent)) {
        throw new UnsafePathError("Wiki path traverses outside the configured root");
      }
    }

    return {
      absolutePath: lexicalCandidate,
      relativePath: segments.join("/"),
      root: absoluteRoot,
      canonicalRoot,
    };
  }

  return Object.freeze({
    root: absoluteRoot,
    canonicalRoot,
    resolveMarkdownPath,
  });
}
