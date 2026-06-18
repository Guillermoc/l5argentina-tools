import type { AppConfig, PackageDef } from "./types";

/** Clave del blob en el pool content-addressed dentro del bucket. */
export function poolKey(
  config: AppConfig,
  pkg: Pick<PackageDef, "id" | "type">,
  version: string,
  ext: string,
): string {
  return `${config.poolPrefix}/${pkg.type}/${pkg.id}/${version}/${pkg.id}.${ext}`;
}

/** URL pública (absoluta) de un blob del pool. */
export function poolUrl(config: AppConfig, key: string): string {
  return config.baseUrl + key;
}

/** Clave del manifest de un canal. */
export function manifestKey(channel: string): string {
  return `${channel}/manifest.json`;
}

/** Claves del estado de deploy (registry + lock) dentro del bucket.
 *  El estado vive en R2 (no en git): lectura pública, escritura con credenciales. */
export const STATE_KEYS = {
  registry: "_state/registry.json",
  lock: "_state/channels.lock.json",
} as const;

const MIME: Record<string, string> = {
  json: "application/json; charset=utf-8",
  zip: "application/zip",
  md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
};

export function contentType(ext: string): string {
  return MIME[ext] ?? "application/octet-stream";
}
