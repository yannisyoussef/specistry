import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

// After the child exits, a frame it wrote may still sit in the pipe; wait
// briefly for it rather than for every descendant to release the pipe ends.
const EXIT_GRACE_MS = 100;

/**
 * One bounded host process run. The host module is started in a fresh
 * detached process (its own group on POSIX) with V8 memory/stack hints,
 * stdout/stderr captured and capped, and a dedicated fd3 control channel on
 * which the host writes exactly one newline-terminated frame. The tree is
 * terminated after result, timeout, cancellation, overflow, or failure, and
 * parent `NODE_OPTIONS` are never re-evaluated by the child.
 */
export interface BoundedHostRequest {
  readonly hostModule: URL;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly maxOutputBytes: number;
  readonly maxFrameBytes: number;
  readonly memoryMiB: number;
  readonly stackKiB: number;
}

export type BoundedHostFailure = "cancelled" | "failed" | "timeout";

export type BoundedHostOutcome =
  | { readonly ok: true; readonly frame: Buffer }
  | { readonly ok: false; readonly reason: BoundedHostFailure };

/** Resolves a compiled host module next to the calling module (or its dist). */
export function hostModuleUrl(name: string, from: string): URL {
  return new URL(from.endsWith(".ts") ? `../dist/${name}` : `./${name}`, from);
}

export async function runBoundedHost(
  request: BoundedHostRequest,
): Promise<BoundedHostOutcome> {
  if (request.signal.aborted) return { ok: false, reason: "cancelled" };

  let child: ChildProcess;
  try {
    child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${request.memoryMiB}`,
        "--max-semi-space-size=16",
        `--stack-size=${request.stackKiB}`,
        fileURLToPath(request.hostModule),
        ...request.args,
      ],
      {
        detached: process.platform !== "win32",
        env: hostEnvironment(),
        stdio: ["ignore", "pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch {
    return { ok: false, reason: "failed" };
  }

  return await new Promise<BoundedHostOutcome>((resolve) => {
    const control = child.stdio[3] as Readable | null;
    if (control === null || child.stdout === null || child.stderr === null) {
      terminateProcessTree(child);
      resolve({ ok: false, reason: "failed" });
      return;
    }
    const controlStream = control;

    let outputBytes = 0;
    let frameBytes = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    let exited = false;
    let controlEnded = false;
    let exitGrace: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      finish({ ok: false, reason: "timeout" });
    }, request.timeoutMs);

    const onAbort = (): void => {
      finish({ ok: false, reason: "cancelled" });
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) {
      finish({ ok: false, reason: "cancelled" });
      return;
    }

    const countOutput = (chunk: Buffer | string): void => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > request.maxOutputBytes) {
        finish({ ok: false, reason: "failed" });
      }
    };
    const collectFrame = (chunk: Buffer): void => {
      frameBytes += chunk.byteLength;
      if (frameBytes > request.maxFrameBytes) {
        finish({ ok: false, reason: "failed" });
        return;
      }
      chunks.push(chunk);
      const terminator = chunk.indexOf(0x0a);
      if (terminator === -1) return;
      const frame = Buffer.concat(chunks, frameBytes);
      const end = frame.indexOf(0x0a);
      if (end !== frame.byteLength - 1) {
        finish({ ok: false, reason: "failed" });
        return;
      }
      finish({ frame: frame.subarray(0, end), ok: true });
    };
    child.stdout.on("data", countOutput);
    child.stderr.on("data", countOutput);
    controlStream.on("data", collectFrame);

    child.once("error", () => {
      finish({ ok: false, reason: "failed" });
    });
    // Settle on process exit, not on stream close: a descendant that inherited
    // the pipes would otherwise hold this promise open for its own lifetime.
    // The control channel can end before or after the exit event, so both
    // orders settle as soon as the other half is observed, and a descendant
    // holding the channel open is bounded by the grace period.
    const settleAfterExit = (): void => {
      if (exited && controlEnded) finish({ ok: false, reason: "failed" });
    };
    controlStream.once("end", () => {
      controlEnded = true;
      settleAfterExit();
    });
    child.once("exit", () => {
      if (settled) return;
      exited = true;
      exitGrace = setTimeout(() => {
        finish({ ok: false, reason: "failed" });
      }, EXIT_GRACE_MS);
      settleAfterExit();
    });

    function finish(outcome: BoundedHostOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(exitGrace);
      request.signal.removeEventListener("abort", onAbort);
      child.stdout?.removeListener("data", countOutput);
      child.stderr?.removeListener("data", countOutput);
      controlStream.removeListener("data", collectFrame);
      terminateProcessTree(child);
      // Release this side of every pipe so descendants that inherited the
      // other side cannot keep the caller's process alive, and let the parent
      // exit without waiting on the killed child handle.
      child.stdout?.destroy();
      child.stderr?.destroy();
      controlStream.destroy();
      child.unref();
      resolve(outcome);
    }
  });
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid !== undefined && process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const result = spawnSync(
      path.join(systemRoot, "System32", "taskkill.exe"),
      ["/pid", String(pid), "/t", "/f"],
      {
        stdio: "ignore",
        timeout: 1_000,
        windowsHide: true,
      },
    );
    if (result.error === undefined && result.status === 0) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // The child may have exited while taskkill was running.
    }
    return;
  }
  if (pid !== undefined) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // The group can already be gone or unavailable; fall back to the child.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Termination races are expected after early process failure.
  }
}

function hostEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  return environment;
}
