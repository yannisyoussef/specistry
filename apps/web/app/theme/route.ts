import { NextResponse, type NextRequest } from "next/server";

import { THEME_COOKIE, safeReturnPath } from "../../lib/theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Stores the theme choice in a cookie and returns to the originating page. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    return new NextResponse(null, { status: 403 });
  }
  const form = await request.formData().catch(() => undefined);
  const mode = form?.get("mode");
  const returnTo = safeReturnPath(form?.get("return"));
  // A relative Location keeps the browser on the host it used (127.0.0.1 or
  // localhost), so the cookie set here is sent with the redirected request.
  const response = new NextResponse(null, {
    headers: { location: returnTo },
    status: 303,
  });
  const secure =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:";
  if (mode === "system") {
    response.cookies.set(THEME_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure,
    });
  } else if (mode === "light" || mode === "dark") {
    response.cookies.set(THEME_COOKIE, mode, {
      httpOnly: true,
      maxAge: ONE_YEAR_SECONDS,
      path: "/",
      sameSite: "lax",
      secure,
    });
  }
  return response;
}

/** Rejects cross-site form posts; `Sec-Fetch-Site` is authoritative when sent. */
function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}
