#!/usr/bin/env node

import process from "node:process";

// A consumer that closes its end of stdout or stderr early (for example a
// pipeline head) must not turn a finished validation into a stack trace.
const ignoreClosedPipe = (error: NodeJS.ErrnoException): void => {
  if (error.code !== "EPIPE") throw error;
};
process.stdout.on("error", ignoreClosedPipe);
process.stderr.on("error", ignoreClosedPipe);

// Cancellation must be deterministic from the first millisecond: the signal
// handlers are installed before the CLI module graph (parsers, highlighter)
// loads, so a SIGINT that arrives during start-up still exits with 130
// instead of the default signal death.
const controller = new AbortController();
const cancel = (): void => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

const { runCli } = await import("./cli.js");

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    signal: controller.signal,
    stderr: process.stderr,
    stdout: process.stdout,
  });
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
