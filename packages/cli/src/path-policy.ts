import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type ProjectPathKind = "absolute" | "invalid" | "relative" | "traversal";

export function classifyProjectPath(value: string): ProjectPathKind {
  if (value.length === 0 || value.includes("\0")) return "invalid";
  if (
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  ) {
    return "absolute";
  }
  if (value.split(/[\\/]+/).includes("..")) return "traversal";
  return "relative";
}

export function isPathWithin(
  root: string,
  candidate: string,
  style: "posix" | "win32" = path.sep === "\\" ? "win32" : "posix",
): boolean {
  const implementation = style === "win32" ? path.win32 : path.posix;
  const normalizedRoot = implementation.resolve(root);
  const normalizedCandidate = implementation.resolve(candidate);
  const relative = implementation.relative(normalizedRoot, normalizedCandidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${implementation.sep}`) &&
      relative !== ".." &&
      !implementation.isAbsolute(relative))
  );
}

export async function resolveProjectRoot(
  root: string,
  cwd: string,
): Promise<string | undefined> {
  if (
    root.length === 0 ||
    (path.sep !== "\\" &&
      path.win32.isAbsolute(root) &&
      !path.posix.isAbsolute(root))
  ) {
    return undefined;
  }
  try {
    const resolved = await realpath(path.resolve(cwd, root));
    return (await stat(resolved)).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

export type ExistingPathResult =
  | { readonly ok: true; readonly path: string }
  | {
      readonly kind: "invalid" | "missing" | "outside" | "wrong-type";
      readonly ok: false;
    };

export async function resolveExistingProjectPath(
  projectRoot: string,
  projectPath: string,
  expected: "directory" | "file",
): Promise<ExistingPathResult> {
  if (classifyProjectPath(projectPath) !== "relative") {
    return { kind: "outside", ok: false };
  }
  const lexical = path.resolve(projectRoot, toHostPath(projectPath));
  if (!isPathWithin(projectRoot, lexical)) {
    return { kind: "outside", ok: false };
  }
  let resolved: string;
  try {
    resolved = await realpath(lexical);
  } catch (error) {
    return {
      kind: isMissing(error) ? "missing" : "invalid",
      ok: false,
    };
  }
  if (!isPathWithin(projectRoot, resolved)) {
    return { kind: "outside", ok: false };
  }
  try {
    const metadata = await stat(resolved);
    const matches =
      expected === "directory" ? metadata.isDirectory() : metadata.isFile();
    return matches
      ? { ok: true, path: resolved }
      : { kind: "wrong-type", ok: false };
  } catch {
    return { kind: "invalid", ok: false };
  }
}

export async function resolveFutureProjectPath(
  projectRoot: string,
  projectPath: string,
): Promise<ExistingPathResult> {
  if (classifyProjectPath(projectPath) !== "relative") {
    return { kind: "outside", ok: false };
  }
  const candidate = path.resolve(projectRoot, toHostPath(projectPath));
  if (!isPathWithin(projectRoot, candidate)) {
    return { kind: "outside", ok: false };
  }

  let ancestor = candidate;
  for (;;) {
    try {
      await lstat(ancestor);
      break;
    } catch (error) {
      if (!isMissing(error)) return { kind: "invalid", ok: false };
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return { kind: "invalid", ok: false };
      ancestor = parent;
    }
  }

  try {
    const realAncestor = await realpath(ancestor);
    if (!isPathWithin(projectRoot, realAncestor)) {
      return { kind: "outside", ok: false };
    }
    if (!(await stat(realAncestor)).isDirectory()) {
      return { kind: "wrong-type", ok: false };
    }
    const tail = path.relative(ancestor, candidate);
    const resolved = path.resolve(realAncestor, tail);
    return isPathWithin(projectRoot, resolved)
      ? { ok: true, path: resolved }
      : { kind: "outside", ok: false };
  } catch {
    return { kind: "invalid", ok: false };
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "ENOENT"
  );
}

function toHostPath(projectPath: string): string {
  return projectPath.split(/[\\/]+/).join(path.sep);
}
