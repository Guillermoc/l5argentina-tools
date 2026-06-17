import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildArtifact } from "./pack";
import { sha256 } from "./hash";
import { poolKey, poolUrl } from "./paths";
import type { AppConfig, Registry, Versions } from "./types";

export type BuildStatus = "new" | "existing" | "missing" | "drift";

export interface BuildItem {
  id: string;
  type: AppConfig["packages"][number]["type"];
  version: string;
  status: BuildStatus;
  sha256?: string;
  sizeBytes?: number;
  ext?: string;
  key?: string;
  url?: string;
  /** ruta del artefacto generado en dist/ (solo para status "new"). */
  artifactPath?: string;
  /** bytes en memoria (solo para status "new"), para subir sin releer disco. */
  bytes?: Uint8Array;
  message?: string;
}

export interface BuildOptions {
  appDir: string;
  config: AppConfig;
  versions: Versions;
  registry: Registry;
}

/**
 * Construye (en memoria) los artefactos de cada paquete a partir de la fuente
 * y la versión declarada en versions.json. No toca R2 ni escribe estado: es puro.
 *
 * Para cada paquete:
 *  - missing : la fuente no existe localmente (típico de imágenes en assets/ aún no presentes).
 *  - drift   : la versión ya está en el registry con OTRO hash → hay que bumpear la versión.
 *  - existing: esa (versión) ya está publicada con el mismo hash → nada que subir.
 *  - new     : versión nueva → artefacto listo para publicar.
 */
export function buildAll(opts: BuildOptions): BuildItem[] {
  const { appDir, config, versions, registry } = opts;
  const items: BuildItem[] = [];

  for (const pkg of config.packages) {
    const version = versions[pkg.id];
    if (!version) {
      items.push({
        id: pkg.id,
        type: pkg.type,
        version: "?",
        status: "missing",
        message: `sin versión en versions.json`,
      });
      continue;
    }

    const sourceAbs = join(appDir, pkg.source);
    if (!existsSync(sourceAbs)) {
      items.push({
        id: pkg.id,
        type: pkg.type,
        version,
        status: "missing",
        message: `fuente ausente: ${pkg.source}`,
      });
      continue;
    }

    const art = buildArtifact(sourceAbs);
    const hash = sha256(art.bytes);
    const key = poolKey(config, pkg, version, art.ext);
    const url = poolUrl(config, key);

    const existing = registry[pkg.id]?.[version];
    if (existing) {
      if (existing.sha256 && existing.sha256 !== hash) {
        items.push({
          id: pkg.id,
          type: pkg.type,
          version,
          status: "drift",
          sha256: hash,
          sizeBytes: art.bytes.length,
          ext: art.ext,
          message: `el contenido cambió pero la versión ${version} ya está publicada con otro hash — bumpeá la versión`,
        });
        continue;
      }
      items.push({
        id: pkg.id,
        type: pkg.type,
        version,
        status: "existing",
        sha256: existing.sha256 || hash,
        sizeBytes: existing.sizeBytes,
        ext: existing.ext,
        key,
        url: existing.url,
      });
      continue;
    }

    items.push({
      id: pkg.id,
      type: pkg.type,
      version,
      status: "new",
      sha256: hash,
      sizeBytes: art.bytes.length,
      ext: art.ext,
      key,
      url,
      bytes: art.bytes,
    });
  }

  return items;
}
