# Support policy

Specra is pre-release. Only the current release candidate is supported during
evaluation; there is no long-term-support line or service-level agreement.

- Use GitHub issues for reproducible, non-sensitive defects and documentation
  gaps. Include the Specra version, Node version, platform, command, stable
  diagnostic codes, and a minimized source with secrets removed.
- Use GitHub discussions for adoption and design questions when enabled.
- Use the repository's **Security → Report a vulnerability** flow for suspected
  vulnerabilities. Never post exploit details, private contracts, credentials,
  request bodies, or sensitive artifacts in a public issue.
- Upgrade one release candidate at a time, rebuild candidates, run quality and
  diff gates, and keep a known-good immutable release available for rollback.

The response target in `SECURITY.md` is a target, not a contractual guarantee.
Forks and downstream images set their own support policy.
