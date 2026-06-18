import { readFileSync, writeFileSync } from "node:fs";
import { STATE_KEYS } from "./paths";
import type { Lock, Registry, RegistryEntry, Versions } from "./types";
import type { R2 } from "./r2";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

// --- versions.json: sigue siendo local (git); es un input que edita el humano ---
export const readVersions = (p: string) => readJson<Versions>(p);
export const writeVersions = (p: string, v: Versions) => writeJson(p, v);

export function registryPut(
  registry: Registry,
  pkgId: string,
  version: string,
  entry: RegistryEntry,
): void {
  (registry[pkgId] ??= {})[version] = entry;
}

// --- estado de deploy (registry + lock): vive en R2 (_state/), no en git ---
// Lectura: pública vía r2.dev (sin credenciales). Escritura: vía S3 (credenciales).

export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Lee registry + lock del bucket (públicos). Si no existen aún, devuelve vacíos. */
export async function readRemoteState(
  baseUrl: string,
  app: string,
): Promise<{ registry: Registry; lock: Lock }> {
  const registry = (await fetchJson<Registry>(baseUrl + STATE_KEYS.registry)) ?? {};
  const lock = (await fetchJson<Lock>(baseUrl + STATE_KEYS.lock)) ?? { app, channels: {} };
  return { registry, lock };
}

export const writeRemoteRegistry = (r2: R2, registry: Registry) =>
  r2.putJson(STATE_KEYS.registry, registry);
export const writeRemoteLock = (r2: R2, lock: Lock) => r2.putJson(STATE_KEYS.lock, lock);
