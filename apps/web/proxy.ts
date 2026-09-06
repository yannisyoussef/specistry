import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { loadReaderArtifact } from "./lib/reader/artifact";
import { DOCS_ROOT, findPage } from "./lib/reader/content";
import { API_ROOT, resolveRoute } from "./lib/reader/projection";
import {
  loadReaderCatalog,
  loadReaderRelease,
  readerMode,
  resolveVersionRoute,
  versionOfPath,
} from "./lib/reader/release";

/**
 * Per-request Content Security Policy with a fresh nonce. Next.js reads the
 * nonce from the request's policy header and attaches it to every framework
 * and route script it emits, so production pages need neither
 * `'unsafe-inline'` nor `'unsafe-eval'`. Development keeps `'unsafe-eval'`
 * for React's debugging source maps only. The proxy runs for every route
 * (there is no prefetch exemption: the reader uses plain links), overwrites
 * the internal headers a client could otherwise spoof, and rewrites unknown
 * API reference and authored routes to a server-rendered 404 so the not-found page is real
 * HTML rather than a client-rendered error shell.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = randomBytes(16).toString("base64");
  const pathname = request.nextUrl.pathname;
  const releases = (await readerMode()) === "releases";
  // Least-privilege networking (SPEC-009, SPEC-010 §44): only API routes of
  // the current release may connect to that release's approved origins;
  // historical pages and every other route keep `connect-src 'self'`. The
  // origins come from the digest-checked artifact, never from the request.
  const connectOrigins = await connectOriginsFor(pathname, releases);
  const policy = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    connectOrigins,
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("content-security-policy-report-only");
  requestHeaders.set("content-security-policy", policy);
  // Layouts cannot read the URL; the pathname drives active navigation state
  // and the theme form's return path.
  requestHeaders.set("x-specra-pathname", pathname);
  if (releases && isDocumentationRoute(pathname)) {
    // Version resolution happens before any component loads (SPEC-010 §5):
    // aliases redirect, frozen redirects redirect, unknown versions 404.
    const resolution = await resolveVersionRoute(pathname);
    if (resolution.kind === "redirect") {
      const location = new URL(resolution.location, request.url);
      // Only non-secret selector state travels with an alias (SPEC-010 §113).
      location.search = request.nextUrl.search;
      const redirect = NextResponse.redirect(location, resolution.status);
      redirect.headers.set("Content-Security-Policy", policy);
      redirect.headers.set("Cache-Control", "no-store");
      return redirect;
    }
    if (resolution.kind === "not-found") {
      const response = NextResponse.rewrite(
        new URL(NOT_FOUND_ROUTE, request.url),
        {
          request: { headers: requestHeaders },
          status: 404,
        },
      );
      response.headers.set("Content-Security-Policy", policy);
      return response;
    }
  }
  const target = releases
    ? undefined
    : await notFoundRewrite(request, pathname);
  const response =
    target === undefined
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : NextResponse.rewrite(target, {
          request: { headers: requestHeaders },
          status: 404,
        });
  // Documentation assets are opaque files served with their own restrictive
  // policy by the route handler; every page gets the nonce policy.
  if (!pathname.startsWith("/assets/")) {
    response.headers.set("Content-Security-Policy", policy);
  }
  return response;
}

export const NOT_FOUND_ROUTE = "/not-found";

async function notFoundRewrite(
  request: NextRequest,
  pathname: string,
): Promise<URL | undefined> {
  if (pathname === NOT_FOUND_ROUTE)
    return new URL(NOT_FOUND_ROUTE, request.url);
  if (pathname.startsWith(`${DOCS_ROOT}/`)) {
    // Authored routes: only pages the build emitted exist. `/docs` itself
    // redirects to the homepage in the route handler.
    const { content } = await loadReaderArtifact();
    return findPage(content, pathname) === undefined
      ? new URL(NOT_FOUND_ROUTE, request.url)
      : undefined;
  }
  if (pathname !== API_ROOT && !pathname.startsWith(`${API_ROOT}/`)) {
    return undefined;
  }
  const segments = pathname
    .slice(API_ROOT.length)
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return undefined;
  const { artifact, index } = await loadReaderArtifact();
  return resolveRoute(index, artifact, segments) === undefined
    ? new URL(NOT_FOUND_ROUTE, request.url)
    : undefined;
}

function isApiRoute(pathname: string): boolean {
  return pathname === API_ROOT || pathname.startsWith(`${API_ROOT}/`);
}

function isDocumentationRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === DOCS_ROOT ||
    pathname.startsWith(`${DOCS_ROOT}/`) ||
    isApiRoute(pathname)
  );
}

async function connectOriginsFor(
  pathname: string,
  releases: boolean,
): Promise<readonly string[]> {
  if (!isApiRoute(pathname)) return [];
  if (!releases) return (await loadReaderArtifact()).playground?.origins ?? [];
  const version = await versionOfPath(pathname);
  const catalog = await loadReaderCatalog();
  if (
    version === undefined ||
    catalog === undefined ||
    version !== catalog.catalog.current
  ) {
    return [];
  }
  return (await loadReaderRelease(version)).playground?.origins ?? [];
}

/** Exact origins only: `scheme://host[:port]` with no path, wildcard, or scheme-only source. */
// An exact origin: HTTPS anywhere, plain HTTP only on loopback (SPEC-009).
const EXACT_ORIGIN =
  /^(?:https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?|https:\/\/\[[0-9A-Fa-f:.]+\](?::\d{1,5})?|http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?)$/;

export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  connectOrigins: readonly string[] = [],
): string {
  const connect = [
    "'self'",
    ...[...new Set(connectOrigins)]
      .filter((origin) => EXACT_ORIGIN.test(origin) && !origin.includes("*"))
      .sort(),
  ];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connect.join(" ")}`,
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self'",
    "manifest-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "worker-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
