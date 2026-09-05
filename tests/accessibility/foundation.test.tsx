// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import FoundationPage from "../../apps/web/app/page";

describe("foundation page accessibility", () => {
  it("has no automated axe violations", async () => {
    const { container } = render(<FoundationPage />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
