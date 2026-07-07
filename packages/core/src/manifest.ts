import type { AppConfig, Manifest, Registry } from "./types";

/**
 * Genera el manifest.json de un canal a partir de su estado (pkgId -> version)
 * y el registry (que sabe dónde vive cada versión). Mantiene el orden de los
 * paquetes declarado en la config y la forma exacta que la app ya consume.
 */
export function buildManifest(
  config: AppConfig,
  channelState: Record<string, string>,
  registry: Registry,
): Manifest {
  const packages = [];
  for (const pkg of config.packages) {
    const version = channelState[pkg.id];
    if (!version) continue; // paquete no presente en este canal
    const entry = registry[pkg.id]?.[version];
    if (!entry) {
      throw new Error(
        `no hay entrada en registry para ${pkg.id}@${version}; publicá/adoptá esa versión primero`,
      );
    }
    packages.push({
      id: pkg.id,
      type: pkg.type,
      version,
      url: entry.url,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
    });
  }
  return { packages };
}

/** Valida que un manifest cumpla el contrato que espera la app. */
export function validateManifest(manifest: Manifest, baseUrl: string): string[] {
  const errors: string[] = [];
  for (const p of manifest.packages) {
    if (!p.url.startsWith(baseUrl)) {
      errors.push(`${p.id}@${p.version}: url fuera de origen (${p.url})`);
    }
    if (!Number.isFinite(p.sizeBytes) || p.sizeBytes <= 0) {
      errors.push(`${p.id}@${p.version}: sizeBytes inválido (${p.sizeBytes})`);
    }
    if (!/^[0-9a-f]{64}$/.test(p.sha256)) {
      errors.push(`${p.id}@${p.version}: sha256 inválido (${p.sha256 || "vacío"})`);
    }
  }
  return errors;
}
