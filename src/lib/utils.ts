import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeStandalonePathname(value: string): string {
  const withoutQuery = value.split("?")[0]?.split("#")[0] || "/"
  const normalized = withoutQuery.replace(/\/+$/, "")
  return normalized || "/"
}

export function isStandaloneAppRoute(pathname: string): boolean {
  const normalized = normalizeStandalonePathname(pathname)
  return (
    normalized === "/connect-local"
    || normalized.startsWith("/connect-local/")
    || normalized === "/install-local"
  )
}
