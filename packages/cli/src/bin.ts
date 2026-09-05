#!/usr/bin/env node

import process from "node:process";

import { runCli } from "./cli.js";

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
