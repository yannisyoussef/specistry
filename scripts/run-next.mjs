import { spawnSync } from "node:child_process";
import process from "node:process";

const command = process.argv[2];
if (!new Set(["build", "dev", "start"]).has(command)) {
  console.error("Expected one of: build, dev, start.");
  process.exit(2);
}

const result = spawnSync("next", [command], {
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);
