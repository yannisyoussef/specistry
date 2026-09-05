#!/usr/bin/env node

import process from "node:process";

import { runCli } from "./cli.js";

// A consumer that closes its end of stdout or stderr early (for example a
// pipeline head) must not turn a finished validation into a stack trace.
const ignoreClosedPipe = (error: NodeJS.ErrnoException): void => {
  if (error.code !== "EPIPE") throw error;
};
process.stdout.on("error", ignoreClosedPipe);
process.stderr.on("error", ignoreClosedPipe);

const controller = new AbortController();
const cancel = (): void => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

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
