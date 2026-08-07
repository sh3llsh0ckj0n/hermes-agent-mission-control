import {
  DEFAULT_MODULES,
  resolveModules,
  type ModuleId,
} from "@/config/modules";

export type RouteRequestType = "page" | "api";
export type RouteAccessKind =
  | "system"
  | "standalone"
  | "module-page"
  | "module-api"
  | "unknown";

export interface RouteAccess {
  kind: RouteAccessKind;
  requestType: RouteRequestType;
  moduleIds: readonly ModuleId[];
  available: boolean;
}

interface ApiOwnership {
  path: string;
  match: "exact" | "prefix";
  moduleIds: readonly ModuleId[];
}

/*
 * API ownership is based on repository call sites and handler responsibilities.
 * Exact rules precede prefixes so shared endpoints do not expose sibling APIs.
 */
export const API_ROUTE_OWNERSHIP: readonly ApiOwnership[] = [
  { path: "/api/hermes/activity", match: "exact", moduleIds: ["home", "hermes"] },
  { path: "/api/hermes/briefing", match: "exact", moduleIds: ["home", "hermes"] },
  { path: "/api/hermes/cost", match: "exact", moduleIds: ["hermes"] },
  { path: "/api/hermes/crons", match: "exact", moduleIds: ["home", "hermes"] },
  { path: "/api/hermes/dispatch", match: "exact", moduleIds: ["hermes"] },
  { path: "/api/hermes/health", match: "exact", moduleIds: ["home", "hermes"] },
  { path: "/api/hermes/memory", match: "exact", moduleIds: ["hermes", "memory-wiki"] },
  { path: "/api/hermes/requests", match: "prefix", moduleIds: ["home", "hermes"] },
  { path: "/api/hermes/tasks", match: "exact", moduleIds: ["home", "hermes", "tasks"] },

  // The base endpoint is read by Content OS and X, and written by Watchlist.
  { path: "/api/x-content", match: "exact", moduleIds: ["content", "x", "watchlist"] },
  { path: "/api/x-content", match: "prefix", moduleIds: ["x"] },

  { path: "/api/agent-bus", match: "prefix", moduleIds: ["agents"] },
  { path: "/api/agent-chat", match: "prefix", moduleIds: ["agents"] },
  { path: "/api/agents", match: "prefix", moduleIds: ["agents"] },
  { path: "/api/articles", match: "prefix", moduleIds: ["articles"] },
  { path: "/api/cache/clear", match: "exact", moduleIds: ["client-pulse"] },
  { path: "/api/client-pulse", match: "prefix", moduleIds: ["client-pulse"] },
  { path: "/api/cron/x-stats", match: "exact", moduleIds: ["x"] },
  { path: "/api/garden", match: "prefix", moduleIds: ["garden"] },

  // These unreferenced legacy aggregators expose creator/content data.
  { path: "/api/home", match: "exact", moduleIds: ["content"] },
  { path: "/api/score", match: "exact", moduleIds: ["content"] },

  { path: "/api/ideas", match: "prefix", moduleIds: ["ideas"] },
  { path: "/api/longform", match: "prefix", moduleIds: ["longform"] },
  { path: "/api/scrape-metrics", match: "exact", moduleIds: ["longform"] },
  { path: "/api/trends", match: "prefix", moduleIds: ["x"] },
  // The X composite page embeds the standalone Watchlist Radar page.
  { path: "/api/watchlist-radar", match: "prefix", moduleIds: ["watchlist", "x"] },
  { path: "/api/x-analytics", match: "prefix", moduleIds: ["x"] },

  // Longform is the only page that invokes this cross-named helper.
  { path: "/api/youtube-scrape", match: "exact", moduleIds: ["longform"] },
  { path: "/api/youtube", match: "prefix", moduleIds: ["youtube"] },
] as const;

const PUBLIC_SYSTEM_PATHS = new Set([
  "/favicon.ico",
  "/file.svg",
  "/globe.svg",
  "/hermy-hq-banner.svg",
  "/next.svg",
  "/robots.txt",
  "/sitemap.xml",
  "/vercel.svg",
  "/window.svg",
]);

function matchesPath(pathname: string, path: string, match: "exact" | "prefix") {
  return pathname === path || (match === "prefix" && pathname.startsWith(`${path}/`));
}

function isSystemPath(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    PUBLIC_SYSTEM_PATHS.has(pathname)
  );
}

function moduleAvailability(
  moduleIds: readonly ModuleId[],
  rawOverrides: string | null | undefined,
) {
  const enabled = new Map(
    resolveModules(rawOverrides).map((module) => [module.id, module.enabled]),
  );
  return moduleIds.some((moduleId) => enabled.get(moduleId) === true);
}

export function classifyRouteAccess(
  pathname: string,
  rawOverrides: string | null | undefined = process.env.NEXT_PUBLIC_MODULE_OVERRIDES,
): RouteAccess {
  const requestType: RouteRequestType = pathname.startsWith("/api/") ? "api" : "page";

  if (isSystemPath(pathname)) {
    return { kind: "system", requestType, moduleIds: [], available: true };
  }

  if (pathname === "/login") {
    return { kind: "standalone", requestType: "page", moduleIds: [], available: true };
  }

  if (requestType === "api") {
    const ownership = API_ROUTE_OWNERSHIP.find((entry) =>
      matchesPath(pathname, entry.path, entry.match),
    );
    if (!ownership) {
      return { kind: "unknown", requestType, moduleIds: [], available: false };
    }
    return {
      kind: "module-api",
      requestType,
      moduleIds: ownership.moduleIds,
      available: moduleAvailability(ownership.moduleIds, rawOverrides),
    };
  }

  const definition = DEFAULT_MODULES.find((module) =>
    [module.route, ...(module.matchRoutes ?? [])].some((route) =>
      matchesPath(pathname, route, route === "/" ? "exact" : "prefix"),
    ),
  );
  if (!definition) {
    return { kind: "unknown", requestType, moduleIds: [], available: false };
  }

  return {
    kind: "module-page",
    requestType,
    moduleIds: [definition.id],
    available: moduleAvailability([definition.id], rawOverrides),
  };
}

export type RouteAvailabilityDecision = "allow" | "not_found" | "authenticate";
export type AuthenticationDecision = "allow" | "unauthorized" | "login";
export type ProxyAccessDecision = Exclude<RouteAvailabilityDecision, "authenticate"> | AuthenticationDecision;

export function decideRouteAvailability(route: RouteAccess): RouteAvailabilityDecision {
  if (route.kind === "system" || route.kind === "standalone") return "allow";
  return route.available ? "authenticate" : "not_found";
}

export function decideAuthentication(
  route: RouteAccess,
  options: {
    isDevelopment: boolean;
    hasInternalSecret: boolean;
    isAuthenticated: boolean;
  },
): AuthenticationDecision {
  if (
    options.isDevelopment ||
    options.hasInternalSecret ||
    options.isAuthenticated
  ) {
    return "allow";
  }
  return route.requestType === "api" ? "unauthorized" : "login";
}

export function decideProxyAccess(
  route: RouteAccess,
  options: {
    isDevelopment: boolean;
    hasInternalSecret: boolean;
    isAuthenticated: boolean;
  },
): ProxyAccessDecision {
  const availability = decideRouteAvailability(route);
  return availability === "authenticate"
    ? decideAuthentication(route, options)
    : availability;
}
