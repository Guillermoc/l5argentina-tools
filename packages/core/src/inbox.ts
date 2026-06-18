import type { PackageType } from "./types";

/** Prefijo del buzón dentro del bucket: archivos pendientes de enviar a debug. */
export const INBOX_PREFIX = "inbox";

/** Paquetes de texto editables online (los pesados van por la carpeta del bucket). */
export const EDITABLE_TYPES: ReadonlySet<PackageType> = new Set(["changelog", "rules", "filters"]);

const EXT_BY_TYPE: Record<PackageType, string> = {
  changelog: "md",
  rules: "json",
  filters: "json",
  database: "zip",
  images: "zip",
};

/** Extensión esperada para el artefacto de un tipo de paquete. */
export const extForType = (type: PackageType): string => EXT_BY_TYPE[type];

/** Versión embebida en un nombre: la convención es `<algo>-<X.Y.Z>` (2+ números). */
const VERSION_RE = /^(.+)-(\d+(?:\.\d+)+)$/;

/** Clave del archivo del buzón: inbox/<pkgId>.<ext> o inbox/<pkgId>-<version>.<ext>. */
export const inboxKey = (pkgId: string, ext: string, version?: string): string =>
  `${INBOX_PREFIX}/${pkgId}${version ? `-${version}` : ""}.${ext}`;

/** Saca la versión del final de un nombre (sin extensión): "cards_db-2.3.0" → {base, version}. */
export function splitVersion(stem: string): { base: string; version?: string } {
  const m = stem.match(VERSION_RE);
  return m ? { base: m[1]!, version: m[2]! } : { base: stem };
}

/** Descompone una clave del buzón en pkgId + ext + version (parseada del nombre, si la hay). */
export function parseInboxKey(key: string): { pkgId: string; ext: string; version?: string } | null {
  const prefix = INBOX_PREFIX + "/";
  if (!key.startsWith(prefix)) return null;
  const name = key.slice(prefix.length);
  if (!name || name.includes("/")) return null;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const { base, version } = splitVersion(name.slice(0, dot));
  return { pkgId: base, ext: name.slice(dot + 1), version };
}

/** Sugerencia de próxima versión: bumpea el último segmento numérico. */
export function bumpVersion(v?: string): string {
  if (!v) return "1.0.0";
  const parts = v.split(".");
  const last = parts.length - 1;
  const n = parseInt(parts[last]!, 10);
  if (Number.isNaN(n)) return v;
  parts[last] = String(n + 1);
  return parts.join(".");
}
