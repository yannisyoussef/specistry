import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content Security Policy with a fresh nonce. Next.js reads the
 * nonce from this header and attaches it to every framework and route script
 * it emits, so production pages need neither `'unsafe-inline'` nor
 * `'unsafe-eval'`. Development keeps `'unsafe-eval'` for React's debugging
 * source maps only. Static assets are excluded by the matcher and keep the
 * fixed headers from `next.config.ts`.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = randomBytes(16).toString("base64");
  const policy = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  // Layouts cannot read the URL; the pathname drives active navigation state
  // and the theme form's return path.
  requestHeaders.set("x-specra-pathname", request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
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
    "img-src 'self' data:",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}'`,
    "upgrade-insecure-requests",
  ].join("; ");
}

export const config = {
  matcher: [
    {
      missing: [
        { key: "next-router-prefetch", type: "header" },
        { key: "purpose", type: "header", value: "prefetch" },
      ],
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
