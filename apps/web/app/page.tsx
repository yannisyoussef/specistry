export default function FoundationPage() {
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <a aria-label="Specra home" className="wordmark" href="/">
          Specra
        </a>
        <span className="phase">Engineering foundation</span>
      </header>
      <main id="content" tabIndex={-1}>
        <p className="eyebrow">Specification → Developer experience</p>
        <h1>Documentation infrastructure your team controls.</h1>
        <p className="lede">
          Specra turns API contracts, authored guides, and product configuration
          into an accessible, self-hosted developer experience.
        </p>
        <section aria-labelledby="phase-heading" className="status-card">
          <h2 id="phase-heading">SPEC-000</h2>
          <p>
            The architectural and engineering foundation is in place. Product
            slices follow review.
          </p>
        </section>
      </main>
      <footer>Specra is product-agnostic by design.</footer>
    </>
  );
}
