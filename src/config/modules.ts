import {
  Bot,
  BookOpen,
  ClipboardList,
  Cpu,
  FileText,
  Flower2,
  HeartPulse,
  Home,
  Lightbulb,
  Play,
  Radar,
  ScrollText,
  Twitter,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export const MODULE_IDS = [
  "home",
  "hermes",
  "memory-wiki",
  "tasks",
  "ideas",
  "agents",
  "content",
  "x",
  "youtube",
  "longform",
  "articles",
  "client-pulse",
  "garden",
  "watchlist",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];
export type ModuleCategory = "Core" | "Workspace" | "Content" | "Operations";

export interface AppModule {
  id: ModuleId;
  label: string;
  route: string;
  icon: LucideIcon;
  enabled: boolean;
  category?: ModuleCategory;
  matchRoutes?: readonly string[];
}

export const DEFAULT_MODULES: readonly AppModule[] = [
  { id: "home", label: "Home", route: "/", icon: Home, enabled: true, category: "Core" },
  { id: "hermes", label: "Hermes", route: "/hermes", icon: Cpu, enabled: true, category: "Core" },
  {
    id: "memory-wiki",
    label: "Memory Wiki",
    route: "/memory-wiki",
    icon: BookOpen,
    enabled: true,
    category: "Core",
  },
  { id: "tasks", label: "Tasks", route: "/tasks", icon: ClipboardList, enabled: true, category: "Core" },
  { id: "ideas", label: "Ideas", route: "/ideas", icon: Lightbulb, enabled: false, category: "Workspace" },
  { id: "agents", label: "Agents", route: "/agents", icon: Bot, enabled: false, category: "Workspace" },
  {
    id: "content",
    label: "Content OS",
    route: "/content-os",
    icon: Workflow,
    enabled: false,
    category: "Content",
  },
  {
    id: "x",
    label: "X",
    route: "/x",
    icon: Twitter,
    enabled: false,
    category: "Content",
    matchRoutes: ["/x-content", "/x-analytics"],
  },
  { id: "youtube", label: "YouTube", route: "/youtube", icon: Play, enabled: false, category: "Content" },
  {
    id: "longform",
    label: "Longform",
    route: "/longform",
    icon: ScrollText,
    enabled: false,
    category: "Content",
  },
  { id: "articles", label: "Articles", route: "/articles", icon: FileText, enabled: false, category: "Content" },
  {
    id: "client-pulse",
    label: "Client Pulse",
    route: "/client-pulse",
    icon: HeartPulse,
    enabled: false,
    category: "Operations",
  },
  { id: "garden", label: "Garden", route: "/garden", icon: Flower2, enabled: false, category: "Operations" },
  {
    id: "watchlist",
    label: "Watchlist Radar",
    route: "/watchlist-radar",
    icon: Radar,
    enabled: false,
    category: "Operations",
  },
] as const;

const MODULE_ID_SET = new Set<string>(MODULE_IDS);
const ENABLED_VALUES = new Set(["1", "true", "on", "enabled"]);
const DISABLED_VALUES = new Set(["0", "false", "off", "disabled"]);

export interface ParsedModuleOverrides {
  overrides: Partial<Record<ModuleId, boolean>>;
  invalidEntries: string[];
}

export function parseModuleOverrides(raw: string | null | undefined): ParsedModuleOverrides {
  const overrides: Partial<Record<ModuleId, boolean>> = {};
  const invalidEntries: string[] = [];

  for (const entry of raw?.split(",") ?? []) {
    const token = entry.trim();
    if (!token) continue;

    const shorthand = token.match(/^([+-])(.+)$/);
    const parts = shorthand ? [shorthand[2], shorthand[1] === "+" ? "true" : "false"] : token.split("=");
    const id = parts[0]?.trim();
    const value = parts[1]?.trim().toLowerCase();

    if (parts.length !== 2 || !id || !MODULE_ID_SET.has(id) || (!ENABLED_VALUES.has(value) && !DISABLED_VALUES.has(value))) {
      invalidEntries.push(token);
      continue;
    }

    overrides[id as ModuleId] = ENABLED_VALUES.has(value);
  }

  return { overrides, invalidEntries };
}

export function resolveModules(raw: string | null | undefined = process.env.NEXT_PUBLIC_MODULE_OVERRIDES): AppModule[] {
  const { overrides } = parseModuleOverrides(raw);
  return DEFAULT_MODULES.map((definition) => ({
    ...definition,
    enabled: overrides[definition.id] ?? definition.enabled,
  }));
}

export function getEnabledModules(raw?: string | null): AppModule[] {
  return resolveModules(raw).filter((definition) => definition.enabled);
}

export function getNavigationGroups(raw?: string | null): Array<{ name: ModuleCategory; items: AppModule[] }> {
  const groups = new Map<ModuleCategory, AppModule[]>();
  for (const definition of getEnabledModules(raw)) {
    const category = definition.category ?? "Workspace";
    const items = groups.get(category) ?? [];
    items.push(definition);
    groups.set(category, items);
  }
  return Array.from(groups, ([name, items]) => ({ name, items }));
}

export function getModuleForPath(pathname: string): AppModule | undefined {
  return DEFAULT_MODULES.find((definition) => {
    const routes = [definition.route, ...(definition.matchRoutes ?? [])];
    return routes.some((route) => pathname === route || (route !== "/" && pathname.startsWith(`${route}/`)));
  });
}

export const STANDALONE_ROUTES = ["/login"] as const;

export function isStandaloneRoute(pathname: string): boolean {
  return STANDALONE_ROUTES.includes(pathname as (typeof STANDALONE_ROUTES)[number]);
}
