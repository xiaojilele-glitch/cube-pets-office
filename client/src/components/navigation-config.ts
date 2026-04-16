import {
  BriefcaseBusiness,
  FileSearch,
  FolderKanban,
  GitBranch,
  HelpCircle,
  LayoutGrid,
  type LucideIcon,
  Settings2,
  Shield,
} from "lucide-react";

export type PrimaryNavigationId = "office" | "tasks" | "more";
export type MoreNavigationId = "help";

export interface NavigationItem<TId extends string> {
  id: TId;
  icon: LucideIcon;
  href?: string;
}

export const LEGACY_COMMAND_CENTER_PATH = "/command-center";
export const LEGACY_COMMAND_CENTER_LEGACY_PATH = "/command-center/legacy";

export const PRIMARY_NAV_ITEMS: Array<NavigationItem<PrimaryNavigationId>> = [
  {
    id: "office",
    icon: BriefcaseBusiness,
    href: "/",
  },
  {
    id: "tasks",
    icon: FolderKanban,
    href: "/tasks",
  },
  {
    id: "more",
    icon: LayoutGrid,
  },
];

export const MORE_NAV_ITEMS: Array<NavigationItem<MoreNavigationId>> = [
  {
    id: "help",
    icon: HelpCircle,
  },
];

export function isLowFrequencyPath(path: string) {
  return (
    path.startsWith("/debug") || path.startsWith(LEGACY_COMMAND_CENTER_PATH)
  );
}

export function getPrimaryNavigationId(path: string): PrimaryNavigationId {
  if (path.startsWith("/tasks")) return "tasks";
  if (isLowFrequencyPath(path)) return "more";
  return "office";
}
