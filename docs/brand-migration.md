# Specistry brand migration

Beginning with **0.1.0-rc.3**, the canonical product name is **Specistry**
(SPECification + regISTRY), the executable is `specistry`, the sole public npm
package is `@specistry/cli`, and the repository is
`yannisyoussef/specistry`. The tagline is “Documentation you can build on.”

The owner chose to replace **Specra** because an unrelated existing
developer-documentation product already uses that identity. This avoids
ecosystem and user confusion before stable 1.0 and npm distribution.

Historical releases retain their original names. **Specra 0.1.0-rc.2**, its
tag, artifacts, SBOM, checksums, provenance and distribution ledger are
unchanged. Earlier ADRs and completed reviews retain their contemporary names;
current reference documentation describes Specistry.

This is a product-name change, not a relicensing event. The owner and Licensor
remain **INFINITY VENTURES**, legal form **SASU**. BUSL-1.1, the Additional Use
Grant, future Apache-2.0 license and per-version Change Date three years after
first public distribution remain unchanged. External legal review is
`not-recorded`.

RC3 makes a clean pre-1.0 cutover: replace `specra` with `specistry`,
`specra.config.ts` with `specistry.config.ts`, `.specra/` with `.specistry/`,
`@specra/*` imports with `@specistry/*`, and `SPECRA_*` variables with
`SPECISTRY_*`. Rebuild generated documentation with the new executable;
preserve any original RC2 artifacts separately. RC3 provides no old-name aliases.

Only the qualified CLI artifact is publishable; all source workspace packages
and bundled internal packages remain private. The owner has confirmed ownership
and publishing authority for npm scope `specistry`; first npm publication is
pending owner authentication and the remaining release gates. The GitHub
repository rename followed reviewed, green `develop` → `master` promotion on
2026-10-06. Original GitHub links redirect to `yannisyoussef/specistry`, and
historical RC2 release identities and asset fingerprints were verified unchanged.
