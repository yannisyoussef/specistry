import { NextResponse, type NextRequest } from "next/server";

import { THEME_COOKIE, safeReturnPath } from "../../lib/theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Stores the theme choice in a cookie and returns to the originating page. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData().catch(() => undefined);
  const mode = form?.get("mode");
  const returnTo = safeReturnPath(form?.get("return"));
  // A relative Location keeps the browser on the host it used (127.0.0.1 or
  // localhost), so the cookie set here is sent with the redirected request.
  const response = new NextResponse(null, {
    headers: { location: returnTo },
    status: 303,
  });
  if (mode === "system") {
    response.cookies.set(THEME_COOKIE, "", { maxAge: 0, path: "/" });
  } else if (mode === "light" || mode === "dark") {
    response.cookies.set(THEME_COOKIE, mode, {
      httpOnly: true,
      maxAge: ONE_YEAR_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}
