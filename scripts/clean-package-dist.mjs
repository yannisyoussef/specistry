import { rmSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

const packageDirectory = resolve(process.cwd());
const parentDirectory = basename(dirname(packageDirectory));

if (parentDirectory !== "packages") {
  throw new Error(
    "Refusing to clean build output outside a workspace package.",
  );
}

const outputDirectory = resolve(packageDirectory, "dist");
if (!outputDirectory.startsWith(`${packageDirectory}${sep}`)) {
  throw new Error("Resolved build output escaped the package directory.");
}

rmSync(outputDirectory, { force: true, recursive: true });
