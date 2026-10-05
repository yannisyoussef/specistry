import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const command = process.argv[2];
if (!new Set(["build", "dev", "start"]).has(command)) {
  console.error("Expected one of: build, dev, start.");
  process.exit(2);
}

if (command === "build") {
  const check = spawnSync(
    process.execPath,
    [new URL("./check-reader-artifact.mjs", import.meta.url).pathname],
    { stdio: "inherit" },
  );
  if (check.status !== 0) process.exit(check.status ?? 1);
}

const environment = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const result =
  command === "start"
    ? spawnSync(
        process.execPath,
        [path.resolve(".next/standalone/apps/web/server.js")],
        { env: environment, stdio: "inherit" },
      )
    : spawnSync("next", [command], {
        env: environment,
        shell: process.platform === "win32",
        stdio: "inherit",
      });

if (result.error !== undefined) throw result.error;
if (command === "build" && result.status === 0) {
  const target = path.resolve(".next/standalone/apps/web/.next/static");
  mkdirSync(target, { recursive: true });
  cpSync(path.resolve(".next/static"), target, { recursive: true });
}
process.exit(result.status ?? 1);
