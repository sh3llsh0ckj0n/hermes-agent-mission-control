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

/*
 * "session" routes accept a NextAuth session or INTERNAL_API_SECRET.
 * "ticket-submit" routes accept only TICKET_SUBMIT_TOKEN, and that token is
 * accepted nowhere else.
 */
export type RouteAuthMode = "session" | "ticket-submit";

export interface RouteAccess {
  kind: RouteAccessKind;
  requestType: RouteRequestType;
  moduleIds: readonly ModuleId[];
  available: boolean;
  auth: RouteAuthMode;
}

interface ApiOwnership {
  path: string;
  match: "exact" | "prefix" | "task-action";
  moduleIds: readonly ModuleId[];
  auth?: RouteAuthMode;
}

export const TICKET_SUBMIT_PATH = "/api/hermes/submit";

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
  // Submit-only ticket intake for an outside router; see RouteAuthMode.
  { path: TICKET_SUBMIT_PATH, match: "exact", moduleIds: ["hermes"], auth: "ticket-submit" },
  { path: "/api/hermes/tasks", match: "exact", moduleIds: ["home", "hermes", "tasks"] },
  { path: "/api/hermes/tasks", match: "task-action", moduleIds: ["hermes", "tasks"] },
  // Mission Control normalized state (read-only): projects, tasks, receipts, reconciliation.
  { path: "/api/mc", match: "prefix", moduleIds: ["home", "hermes"] },

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

function matchesPath(
  pathname: string,
  path: string,
  match: "exact" | "prefix" | "task-action",
) {
  if (match === "exact") return pathname === path;
  if (match === "prefix") return pathname === path || pathname.startsWith(`${path}/`);
  if (match !== "task-action" || !pathname.startsWith(`${path}/`)) return false;

  const segments = pathname.slice(path.length + 1).split("/");
  return segments.length === 2 && Boolean(segments[0]) && segments[1] === "action";
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
    return { kind: "system", requestType, moduleIds: [], available: true, auth: "session" };
  }

  if (pathname === "/login") {
    return {
      kind: "standalone",
      requestType: "page",
      moduleIds: [],
      available: true,
      auth: "session",
    };
  }

  if (requestType === "api") {
    const ownership = API_ROUTE_OWNERSHIP.find((entry) =>
      matchesPath(pathname, entry.path, entry.match),
    );
    if (!ownership) {
      return { kind: "unknown", requestType, moduleIds: [], available: false, auth: "session" };
    }
    return {
      kind: "module-api",
      requestType,
      moduleIds: ownership.moduleIds,
      available: moduleAvailability(ownership.moduleIds, rawOverrides),
      auth: ownership.auth ?? "session",
    };
  }

  const definition = DEFAULT_MODULES.find((module) =>
    [module.route, ...(module.matchRoutes ?? [])].some((route) =>
      matchesPath(pathname, route, route === "/" ? "exact" : "prefix"),
    ),
  );
  if (!definition) {
    return { kind: "unknown", requestType, moduleIds: [], available: false, auth: "session" };
  }

  return {
    kind: "module-page",
    requestType,
    moduleIds: [definition.id],
    available: moduleAvailability([definition.id], rawOverrides),
    auth: "session",
  };
}

export type RouteAvailabilityDecision = "allow" | "not_found" | "authenticate";
export type AuthenticationDecision = "allow" | "unauthorized" | "forbidden" | "login";
export type ProxyAccessDecision = Exclude<RouteAvailabilityDecision, "authenticate"> | AuthenticationDecision;

export function decideRouteAvailability(route: RouteAccess): RouteAvailabilityDecision {
  if (route.kind === "system" || route.kind === "standalone") return "allow";
  return route.available ? "authenticate" : "not_found";
}

export interface AuthenticationOptions {
  isDevelopment: boolean;
  hasInternalSecret: boolean;
  isAuthenticated: boolean;
  /** The request presents a valid TICKET_SUBMIT_TOKEN bearer credential. */
  hasTicketSubmitToken?: boolean;
}

/**
 * The submit token is scoped to the submit route. Presenting it on any other
 * route (system, unknown, disabled, or session-authenticated) is refused
 * outright, even alongside another credential.
 */
export function isTicketSubmitTokenOutOfScope(
  route: RouteAccess,
  hasTicketSubmitToken: boolean | undefined,
): boolean {
  return Boolean(hasTicketSubmitToken) && route.auth !== "ticket-submit";
}

export function decideAuthentication(
  route: RouteAccess,
  options: AuthenticationOptions,
): AuthenticationDecision {
  // The submit route trusts only its own token: no development bypass, no
  // internal secret, no session.
  if (route.auth === "ticket-submit") {
    return options.hasTicketSubmitToken ? "allow" : "unauthorized";
  }
  if (isTicketSubmitTokenOutOfScope(route, options.hasTicketSubmitToken)) {
    return "forbidden";
  }
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
  options: AuthenticationOptions,
): ProxyAccessDecision {
  if (isTicketSubmitTokenOutOfScope(route, options.hasTicketSubmitToken)) {
    return "forbidden";
  }
  const availability = decideRouteAvailability(route);
  return availability === "authenticate"
    ? decideAuthentication(route, options)
    : availability;
}
