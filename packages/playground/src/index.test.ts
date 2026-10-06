import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocumentationArtifact } from "@specistry/model";
import { parseSnippetsArtifact } from "@specistry/snippets";
import { describe, expect, it } from "vitest";

import {
  parsePlaygroundArtifact,
  projectPlayground,
  serializePlaygroundArtifact,
} from "./index.js";
import { PLAYGROUND_HARD_LIMITS } from "./types.js";

/**
 * SPEC-009 §19–§21, §29–§31, §52: the policy projection. Only configured,
 * approved, exact-origin environments become destinations; the artifact is
 * disabled without an opt-in or without a usable environment; limits are
 * clamped; the output is deterministic and round-trips through the strict
 * parser.
 */

const fixture = fileURLToPath(
  new URL(
    "../../../tests/fixtures/reader/testinbox/.specistry/artifacts/",
    import.meta.url,
  ),
);
const artifact = parseDocumentationArtifact(
  readFileSync(path.join(fixture, "documentation.json"), "utf8"),
);
const snippets = parseSnippetsArtifact(
  readFileSync(path.join(fixture, "snippets.json"), "utf8"),
);

const base = {
  approved: ["local"],
  artifact,
  enabled: true,
  responseLimitBytes: 262_144,
  snippets,
  timeoutMs: 5_000,
};

describe("projectPlayground", () => {
  it("approves only the configured loopback environment as an exact origin", () => {
    const policy = projectPlayground(base);
    expect(policy.diagnostics).toEqual([]);
    expect(policy.artifact.enabled).toBe(true);
    expect(policy.artifact.environments).toEqual([
      {
        baseUrl: "http://127.0.0.1:47391/v1",
        id: "local",
        label: "Local",
        loopback: true,
        origin: "http://127.0.0.1:47391",
      },
    ]);
    expect(Object.keys(policy.artifact.operations)).toHaveLength(25);
    expect(policy.artifact.limits).toEqual({
      ...PLAYGROUND_HARD_LIMITS,
      responseBytes: 262_144,
      timeoutMs: 5_000,
    });
  });

  it("keeps example-only environments out of the policy", () => {
    const policy = projectPlayground({ ...base, approved: ["sandbox"] });
    expect(
      policy.artifact.environments.map((environment) => environment.id),
    ).toEqual(["sandbox"]);
    expect(policy.artifact.environments[0]?.origin).toBe(
      "https://sandbox.testinbox.email",
    );
    expect(JSON.stringify(policy.artifact.environments)).not.toContain(
      "api.testinbox.email",
    );
  });

  it("is disabled without opt-in even when environments are approved", () => {
    const policy = projectPlayground({ ...base, enabled: false });
    expect(policy.artifact.enabled).toBe(false);
    expect(policy.diagnostics).toEqual([]);
    expect(Object.keys(policy.artifact.operations)).toHaveLength(25);
  });

  it("is disabled with a diagnostic when no approved environment exists", () => {
    const policy = projectPlayground({ ...base, approved: ["staging"] });
    expect(policy.artifact.enabled).toBe(false);
    expect(policy.artifact.environments).toEqual([]);
    expect(policy.diagnostics).toEqual([
      { code: "PLAYGROUND_ENVIRONMENT_NOT_FOUND", subject: "staging" },
    ]);
  });

  it("rejects an environment whose base URL is not an exact allowed origin", () => {
    const hostile = {
      ...snippets,
      environments: [
        ...snippets.environments,
        { baseUrl: "http://api.example.com/v1", id: "plain", label: "Plain" },
        {
          baseUrl: "https://user:pw@api.example.com/v1",
          id: "creds",
          label: "Creds",
        },
      ],
    };
    const policy = projectPlayground({
      ...base,
      approved: ["plain", "creds"],
      snippets: hostile,
    });
    expect(policy.artifact.enabled).toBe(false);
    expect(policy.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "PLAYGROUND_ENVIRONMENT_ORIGIN_INVALID",
      "PLAYGROUND_ENVIRONMENT_ORIGIN_INVALID",
    ]);
  });

  it("clamps limits to the hard maximums", () => {
    const policy = projectPlayground({
      ...base,
      responseLimitBytes: 1e9,
      timeoutMs: 1e9,
    });
    expect(policy.artifact.limits.responseBytes).toBe(
      PLAYGROUND_HARD_LIMITS.responseBytes,
    );
    expect(policy.artifact.limits.timeoutMs).toBe(
      PLAYGROUND_HARD_LIMITS.timeoutMs,
    );
  });

  it("reports operations the browser cannot execute only when enabled", () => {
    const enabled = projectPlayground(base);
    const unsupported = Object.entries(enabled.artifact.operations).filter(
      ([, form]) => form.capability.state === "unsupported",
    );
    expect(
      enabled.diagnostics
        .filter(
          (diagnostic) =>
            diagnostic.code === "PLAYGROUND_OPERATION_UNSUPPORTED",
        )
        .map((diagnostic) => diagnostic.subject),
    ).toEqual(unsupported.map(([key]) => key));
    const disabled = projectPlayground({ ...base, enabled: false });
    expect(
      disabled.diagnostics.some(
        (diagnostic) => diagnostic.code === "PLAYGROUND_OPERATION_UNSUPPORTED",
      ),
    ).toBe(false);
  });

  it("projects the TestInbox capability matrix as documented", () => {
    const { operations } = projectPlayground(base).artifact;
    const state = (id: string) =>
      operations[`openapi.yaml~${id}`]?.capability.state;
    expect(state("getInbox")).toBe("executable");
    expect(state("createWebhook")).toBe("partial"); // API key + mTLS alternative unusable, OAuth usable
    expect(state("downloadAttachment")).toBe("partial"); // optional cookie parameter
    expect(
      operations["openapi.yaml~createWebhook"]?.auth.map(
        (alternative) => alternative.supported,
      ),
    ).toEqual([false, true]);
  });

  it("is deterministic and round-trips through the strict parser", () => {
    const first = serializePlaygroundArtifact(projectPlayground(base).artifact);
    const second = serializePlaygroundArtifact(
      projectPlayground(base).artifact,
    );
    expect(first).toBe(second);
    expect(serializePlaygroundArtifact(parsePlaygroundArtifact(first))).toBe(
      first,
    );
  });
});
