import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Basic Auth gate for the deployed app (Next 16 "proxy", formerly middleware).
 *
 * Active only when BOTH BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set —
 * locally they stay unset so dev is frictionless; on Vercel they're
 * configured as env vars. The app itself is single-user (lib/auth.ts stub),
 * so this is the outer door, not per-user auth.
 */
export function proxy(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !password) return NextResponse.next();

  const auth = request.headers.get("authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = atob(encoded);
      const sep = decoded.indexOf(":");
      if (
        sep !== -1 &&
        decoded.slice(0, sep) === user &&
        decoded.slice(sep + 1) === password
      ) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="daily-tracker"' },
  });
}
