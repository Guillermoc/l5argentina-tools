import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildArtifact } from "./pack";
import { sha256 } from "./hash";
import { poolKey as mkPoolKey, poolUrl } from "./paths";
import type {
  AppConfig,
  Manifest,
  ManifestEntry,
  PackageType,
  Registry,
  Versions,
} from "./types";

export type MigrateAction = "copy" | "upload" | "skip" | "blocked";

export interface MigratePlanItem {
  id: string;
  type: PackageType;
  version: string;
  action: MigrateAction;
  sizeBytes?: number;
  ext?: string;
  poolKey?: string;
  url?: string;
  /** copy: clave de origen dentro del bucket (lo que ya está en vivo). */
  fromKey?: string;
  /** upload: artefacto en memoria (no se serializa al plan.json). */
  bytes?: Uint8Array;
  sha256?: string;
  message?: string;
}

export interface MigratePlan {
  channel: string;
  baseUrl: string;
  items: MigratePlanItem[];
}

function extFromUrl(url: string): string {
  const clean = url.split("?")[0]!.split("#")[0]!;
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1]!.toLowerCase() : "bin";
}

async function fetchLiveManifest(baseUrl: string, channel: string): Promise<Manifest | null> {
  try {
    const res = await fetch(`${baseUrl}${channel}/manifest.json`, {
      headers: { "cache-control": "no-cache" },
    });
    if (!res.ok) return null;
    return (await res.json()) as Manifest;
  } catch {
    return null;
  }
}

async function headSize(url: string): Promise<number | undefined> {
  try {
    const h = await fetch(url, { method: "HEAD" });
    if (!h.ok) return undefined;
    const n = Number(h.headers.get("content-length"));
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Planifica la migración de un canal a la pool. Solo usa fetch público (no
 * necesita credenciales R2). Para cada paquete, en su versión objetivo:
 *  - skip   : ya está en el registry (migrado).
 *  - copy   : esos bytes YA existen en vivo a esa versión → copia server-side.
 *  - upload : no están en vivo (nuevo/cambiado) → se sube desde la fuente local.
 *  - blocked: no está en vivo y tampoco hay fuente local.
 */
export async function planMigrate(opts: {
  appDir: string;
  config: AppConfig;
  versions: Versions;
  registry: Registry;
  channel: string;
  /** Si true, la versión objetivo de cada paquete es la que el canal tiene HOY
   *  en vivo (no versions.json), y nunca se sube desde local: solo copia/skip.
   *  Sirve para "acomodar" un canal a la pool conservando sus versiones. */
  adopt?: boolean;
}): Promise<MigratePlan> {
  const { appDir, config, versions, registry, channel, adopt } = opts;
  const baseUrl = config.baseUrl;
  const live = await fetchLiveManifest(baseUrl, channel);
  const liveById = new Map((live?.packages ?? []).map((p) => [p.id, p]));
  const items: MigratePlanItem[] = [];

  for (const pkg of config.packages) {
    const liveEntry = liveById.get(pkg.id);
    // versión objetivo: en modo adopt es la que está HOY en vivo; si no, versions.json.
    const version = adopt ? liveEntry?.version : versions[pkg.id];
    if (!version) {
      items.push({
        id: pkg.id, type: pkg.type, version: "?", action: "blocked",
        message: adopt ? "no está en el canal en vivo" : "sin versión en versions.json",
      });
      continue;
    }

    // ya en el registry → nada que hacer
    const reg = registry[pkg.id]?.[version];
    if (reg) {
      items.push({
        id: pkg.id, type: pkg.type, version, action: "skip",
        sizeBytes: reg.sizeBytes, ext: reg.ext, url: reg.url,
        poolKey: reg.url.startsWith(baseUrl) ? reg.url.slice(baseUrl.length) : undefined,
      });
      continue;
    }

    // ¿existe en vivo a esta misma versión? → copia server-side
    if (liveEntry && liveEntry.version === version && liveEntry.url.startsWith(baseUrl)) {
      const size = await headSize(liveEntry.url);
      if (size !== undefined) {
        const ext = extFromUrl(liveEntry.url);
        const key = mkPoolKey(config, pkg, version, ext);
        items.push({
          id: pkg.id, type: pkg.type, version, action: "copy",
          sizeBytes: size, ext, poolKey: key, url: poolUrl(config, key),
          fromKey: liveEntry.url.slice(baseUrl.length),
        });
        continue;
      }
    }

    // en modo adopt no se sube desde local: si no se pudo copiar, queda bloqueado
    if (adopt) {
      items.push({ id: pkg.id, type: pkg.type, version, action: "blocked", message: "no se pudo adoptar el objeto en vivo (¿404?)" });
      continue;
    }

    // si no, subir desde la fuente local
    const sourceAbs = join(appDir, pkg.source);
    if (!existsSync(sourceAbs)) {
      items.push({ id: pkg.id, type: pkg.type, version, action: "blocked", message: `no está en vivo y falta la fuente local: ${pkg.source}` });
      continue;
    }
    const art = buildArtifact(sourceAbs);
    const key = mkPoolKey(config, pkg, version, art.ext);
    items.push({
      id: pkg.id, type: pkg.type, version, action: "upload",
      sizeBytes: art.bytes.length, ext: art.ext, poolKey: key, url: poolUrl(config, key),
      bytes: art.bytes, sha256: sha256(art.bytes),
    });
  }

  return { channel, baseUrl, items };
}

/** Manifest que tendría el canal según el plan (orden de la config). */
export function manifestFromPlan(config: AppConfig, plan: MigratePlan): Manifest {
  const order = new Map(config.packages.map((p, i) => [p.id, i]));
  const entries: ManifestEntry[] = plan.items
    .filter((i) => i.action !== "blocked" && i.url && i.sizeBytes !== undefined)
    .map((i) => ({ id: i.id, type: i.type, version: i.version, url: i.url!, sizeBytes: i.sizeBytes! }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { packages: entries };
}
