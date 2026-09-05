import type { Metadata } from "next";

import { API_ROOT } from "../lib/reader/projection";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Page not found",
};

export default function NotFound() {
  return (
    <article className="document__column">
      <div className="page-header">
        <p className="eyebrow">404</p>
        <h1 className="page-title">Page not found</h1>
        <p className="lede">
          There is no documentation at this address. The operation may have been
          renamed or removed from the contract.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href={API_ROOT}>
            API reference
          </a>
          <a className="button" href="/">
            Home
          </a>
        </div>
      </div>
    </article>
  );
}
