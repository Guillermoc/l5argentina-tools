import { appConfig } from "../generated/companion";
import type { ExpectedLock, Manifest, ManifestEntry, R2Env, Registry } from "../types";
import { R2Writer, hasR2Env } from "./r2write";

const CACHE_MANIFEST = "public, max-age=60, must-revalidate";
const CACHE_STATE = "no-store";

export interface PromoteInput {
  from: string;
  to: string;
  only?: string[];
  apply?: boolean;
}

export interface PromoteChange {
  id: string;
  from: string;
  to: string;
}

export interface PromoteResult {
  from: string;
  to: string;
  changes: PromoteChange[];
  applied: boolean;
  error?: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    if (res.ok) return (await res.json()) as T;
  } catch {
    /* ignore */
  }
  return null;
}

export function buildManifest(channelState: Record<string, string>, registry: Registry): Manifest {
  const packages: ManifestEntry[] = [];
  for (const pkg of appConfig.packages) {
    const v = channelState[pkg.id];
    if (!v) continue;
    const entry = registry[pkg.id]?.[v];
    if (!entry) continue;
    packages.push({ id: pkg.id, type: pkg.type, version: v, url: entry.url, sizeBytes: entry.sizeBytes });
  }
  return { packages };
}

/**
 * Promueve de un canal a otro. Con `apply:false` solo devuelve el plan (qué
 * cambiaría). Con `apply:true` reescribe el manifest del destino y el lock en
 * _state/ (no copia bytes: la pool es compartida). Reusa la lógica del CLI.
 */
export async function runPromote(
  input: PromoteInput,
  env: Partial<R2Env> | undefined,
): Promise<{ status: number; body: PromoteResult | { error: string } }> {
  const { from, to } = input;
  if (!appConfig.channels.includes(from) || !appConfig.channels.includes(to)) {
    return { status: 400, body: { error: `canal desconocido (válidos: ${appConfig.channels.join(", ")})` } };
  }

  const base = appConfig.baseUrl;
  const registry = (await fetchJson<Registry>(base + "_state/registry.json")) ?? {};
  const lock =
    (await fetchJson<ExpectedLock>(base + "_state/channels.lock.json")) ??
    ({ app: appConfig.app, channels: {} } as ExpectedLock);

  const fromState = lock.channels[from] ?? {};
  const toState = { ...(lock.channels[to] ?? {}) };
  const ids = appConfig.packages
    .map((p) => p.id)
    .filter((id) => !input.only || input.only.includes(id));

  const changes: PromoteChange[] = [];
  for (const id of ids) {
    const v = fromState[id];
    if (!v) continue;
    if (toState[id] !== v) {
      changes.push({ id, from: toState[id] ?? "—", to: v });
      toState[id] = v;
    }
  }

  if (changes.length === 0) {
    return { status: 200, body: { from, to, changes, applied: false } };
  }

  const missing = changes.filter((c) => !registry[c.id]?.[c.to]);
  if (missing.length) {
    return {
      status: 409,
      body: { from, to, changes, applied: false, error: `versiones no publicadas: ${missing.map((m) => `${m.id}@${m.to}`).join(", ")}` },
    };
  }

  // plan (dry-run)
  if (!input.apply) {
    return { status: 200, body: { from, to, changes, applied: false } };
  }

  // apply: requiere credenciales R2
  if (!hasR2Env(env)) {
    return {
      status: 503,
      body: { from, to, changes, applied: false, error: "faltan credenciales R2 en el entorno del Worker (configurá las env vars en Cloudflare Pages)" },
    };
  }

  const manifest = buildManifest(toState, registry);
  const writer = new R2Writer(env);
  await writer.putText(`${to}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n", "application/json; charset=utf-8", CACHE_MANIFEST);
  lock.channels[to] = toState;
  await writer.putText("_state/channels.lock.json", JSON.stringify(lock, null, 2) + "\n", "application/json; charset=utf-8", CACHE_STATE);

  return { status: 200, body: { from, to, changes, applied: true } };
}
