"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getModuleForPath } from "@/config/modules";

export function Breadcrumbs() {
  const pathname = usePathname();
  
  // Don't show breadcrumbs on dashboard
  if (pathname === "/") return null;
  
  const currentLabel = getModuleForPath(pathname)?.label ?? "Page";
  
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--text-3)] mb-6">
      <Link 
        href="/" 
        className="hover:text-neutral-300 transition-colors"
      >
        Home
      </Link>
      <span>/</span>
      <span className="text-neutral-400">{currentLabel}</span>
    </div>
  );
}
