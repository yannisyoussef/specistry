// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseDocumentationArtifact } from "@specra/model";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { HomePage } from "../../apps/web/components/reader/list-pages";
import { Shell } from "../../apps/web/components/reader/shell";
import { createReaderIndex } from "../../apps/web/lib/reader/projection";

const artifact = parseDocumentationArtifact(
  readFileSync(
    path.join(
      process.cwd(),
      "tests/fixtures/reader/testinbox/.specra/artifacts/documentation.json",
    ),
    "utf8",
  ),
);

describe("home page accessibility", () => {
  it("has no automated axe violations inside the reader shell", async () => {
    const index = createReaderIndex(artifact);
    const { container } = render(
      <Shell currentPath="/" index={index} mode="system">
        <HomePage index={index} />
      </Shell>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
