import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import {
  classifyRouteAccess,
  decideAuthentication,
  decideRouteAvailability,
  type AuthenticationDecision,
  type RouteAccess,
} from "@/lib/route-policy";
import { hasValidInternalSecret } from "@/lib/security";

function unavailableResponse(route: RouteAccess) {
  if (route.requestType === "api") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function authenticationResponse(
  decision: AuthenticationDecision,
  request: NextRequest,
) {
  if (decision === "allow") return NextResponse.next();
  if (decision === "unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export async function proxy(request: NextRequest) {
  const route = classifyRouteAccess(
    request.nextUrl.pathname,
    process.env.NEXT_PUBLIC_MODULE_OVERRIDES,
  );

  // Route availability is authoritative and is resolved before every auth bypass.
  const availability = decideRouteAvailability(route);
  if (availability === "allow") return NextResponse.next();
  if (availability === "not_found") return unavailableResponse(route);

  if (process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }

  if (hasValidInternalSecret(request.headers)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  return authenticationResponse(
    decideAuthentication(route, {
      isDevelopment: false,
      hasInternalSecret: false,
      isAuthenticated: Boolean(token),
    }),
    request,
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
