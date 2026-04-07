import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

export function getParentRelPath(relPath: string): string {
  const index = relPath.lastIndexOf("/")
  return index === -1 ? "" : relPath.slice(0, index)
}

export function joinAbsolutePath(workspaceRoot: string, relPath: string): string {
  return relPath ? `${workspaceRoot}/${relPath}` : workspaceRoot
}
