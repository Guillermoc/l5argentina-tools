import { readFileSync, writeFileSync } from "node:fs";
import type { Lock, Registry, Versions } from "./types";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export const readVersions = (p: string) => readJson<Versions>(p);
export const readLock = (p: string) => readJson<Lock>(p);
export const readRegistry = (p: string) => readJson<Registry>(p);

export const writeLock = (p: string, v: Lock) => writeJson(p, v);
export const writeRegistry = (p: string, v: Registry) => writeJson(p, v);
export const writeVersions = (p: string, v: Versions) => writeJson(p, v);

export function registryPut(
  registry: Registry,
  pkgId: string,
  version: string,
  entry: Registry[string][string],
): void {
  (registry[pkgId] ??= {})[version] = entry;
}
