import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const packageDirectory = path.resolve(process.cwd());
if (path.basename(packageDirectory) !== "cli") {
  throw new Error("Refusing to modify an executable outside packages/cli.");
}

const executable = path.join(packageDirectory, "dist", "bin.js");
const source = await readFile(executable, "utf8");
if (!source.startsWith("#!/usr/bin/env node\n")) {
  throw new Error(
    "The compiled Specistry executable is missing its Node shebang.",
  );
}
await chmod(executable, 0o755);
