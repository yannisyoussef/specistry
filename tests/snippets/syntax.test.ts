import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Syntax validation of the committed goldens (SPEC-008 §53, §109): every
 * cURL example passes `bash -n`, every JavaScript example passes
 * `node --check`, every TypeScript example type-checks against the DOM lib,
 * every Python example parses with `ast`, and every Java example compiles
 * with `javac` when a JDK is present (CI's Ubuntu image ships one). This is
 * a lexer/parser gate, not proof that a request succeeds.
 */

const goldenRoot = path.join(process.cwd(), "packages/snippets/goldens");
const goldens = readdirSync(goldenRoot).sort();
const scratch = mkdtempSync(path.join(tmpdir(), "specra-snippets-syntax-"));

afterAll(() => rmSync(scratch, { force: true, recursive: true }));

function has(binary: string): boolean {
  try {
    execFileSync(binary, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    try {
      execFileSync(binary, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

function byLanguage(language: string): readonly string[] {
  return goldens.filter((name) => name.endsWith(`.${language}.txt`));
}

describe("generated code is syntactically valid", () => {
  it("cURL: bash -n accepts every example", () => {
    for (const name of byLanguage("curl")) {
      const file = path.join(scratch, `${name}.sh`);
      writeFileSync(file, readFileSync(path.join(goldenRoot, name)));
      expect(
        () => execFileSync("bash", ["-n", file], { stdio: "pipe" }),
        name,
      ).not.toThrow();
    }
  });

  it("JavaScript: node --check accepts every example as an ES module", () => {
    for (const name of byLanguage("javascript")) {
      const file = path.join(scratch, `${name}.mjs`);
      writeFileSync(file, readFileSync(path.join(goldenRoot, name)));
      expect(
        () =>
          execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }),
        name,
      ).not.toThrow();
    }
  });

  it("TypeScript: every example type-checks against lib.dom with strict settings", () => {
    const files = byLanguage("typescript").map((name) => {
      const file = path.join(scratch, `${name.replace(/\.txt$/, "")}.ts`);
      // Top-level await needs a module; an export keeps each file separate.
      writeFileSync(
        file,
        `${readFileSync(path.join(goldenRoot, name), "utf8")}\nexport {};\n`,
      );
      return file;
    });
    const program = ts.createProgram(files, {
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      module: ts.ModuleKind.ESNext,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map(
        (diagnostic) =>
          `${diagnostic.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
      );
    expect(diagnostics).toEqual([]);
  });

  it.skipIf(!has("python3"))("Python: ast.parse accepts every example", () => {
    for (const name of byLanguage("python")) {
      const file = path.join(scratch, `${name}.py`);
      writeFileSync(file, readFileSync(path.join(goldenRoot, name)));
      expect(
        () =>
          execFileSync(
            "python3",
            [
              "-c",
              `import ast,sys; ast.parse(open(sys.argv[1], encoding='utf8').read())`,
              file,
            ],
            { stdio: "pipe" },
          ),
        name,
      ).not.toThrow();
    }
  });

  it.skipIf(!has("javac"))(
    "Java: javac compiles every example inside a method",
    () => {
      for (const name of byLanguage("java")) {
        const source = readFileSync(path.join(goldenRoot, name), "utf8");
        const imports = source
          .split("\n")
          .filter((line) => line.startsWith("import "));
        const body = source
          .split("\n")
          .filter((line) => !line.startsWith("import "))
          .join("\n");
        const directory = path.join(
          scratch,
          name.replace(/[^A-Za-z0-9]/g, "_"),
        );
        execFileSync("mkdir", ["-p", directory]);
        writeFileSync(
          path.join(directory, "Example.java"),
          `${imports.join("\n")}\n\npublic class Example {\n  public static void main(String[] args) throws Exception {\n${body}\n  }\n}\n`,
        );
        expect(
          () =>
            execFileSync(
              "javac",
              ["-d", directory, path.join(directory, "Example.java")],
              { stdio: "pipe" },
            ),
          name,
        ).not.toThrow();
      }
    },
  );
});
