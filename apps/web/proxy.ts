import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { loadReaderArtifact } from "./lib/reader/artifact";
import { API_ROOT, resolveRoute } from "./lib/reader/projection";

/**
 * Per-request Content Security Policy with a fresh nonce. Next.js reads the
 * nonce from the request's policy header and attaches it to every framework
 * and route script it emits, so production pages need neither
 * `'unsafe-inline'` nor `'unsafe-eval'`. Development keeps `'unsafe-eval'`
 * for React's debugging source maps only. The proxy runs for every route
 * (there is no prefetch exemption: the reader uses plain links), overwrites
 * the internal headers a client could otherwise spoof, and rewrites unknown
 * API reference routes to a server-rendered 404 so the not-found page is real
 * HTML rather than a client-rendered error shell.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = randomBytes(16).toString("base64");
  const policy = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("content-security-policy-report-only");
  requestHeaders.set("content-security-policy", policy);
  // Layouts cannot read the URL; the pathname drives active navigation state
  // and the theme form's return path.
  const pathname = request.nextUrl.pathname;
  requestHeaders.set("x-specra-pathname", pathname);
  const target = await notFoundRewrite(request, pathname);
  const response =
    target === undefined
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : NextResponse.rewrite(target, {
          request: { headers: requestHeaders },
          status: 404,
        });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const NOT_FOUND_ROUTE = "/not-found";

async function notFoundRewrite(
  request: NextRequest,
  pathname: string,
): Promise<URL | undefined> {
  if (pathname === NOT_FOUND_ROUTE)
    return new URL(NOT_FOUND_ROUTE, request.url);
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

export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
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
