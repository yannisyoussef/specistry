# Security policy

Specra is pre-release and does not yet publish supported release lines. Report suspected vulnerabilities with the repository's **Security → Report a vulnerability** form. If private vulnerability reporting is not enabled on a fork, contact its owners privately before sharing details. Do not open a public issue containing exploit details or credentials.

Include the affected commit or version, reproduction steps with secrets removed, impact, and any proposed mitigation. Maintainers target an acknowledgement within three business days, then coordinate severity, remediation, and disclosure. This is a response target, not a guarantee for unmaintained forks.

Never include real bearer tokens, API keys, cookies, passwords, private specifications, or sensitive request/response payloads in reports, fixtures, logs, screenshots, or CI artifacts.

The authoritative design analysis is the [threat model](docs/security/threat-model.md). Security-relevant architecture changes require threat-model and ADR updates.
