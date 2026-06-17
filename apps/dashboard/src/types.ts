// Tipos del dashboard. Espejo liviano de la forma de los manifests/config de
// apps/companion (el dashboard no depende del runtime de @l5a/core).

export interface AppConfig {
  app: string;
  baseUrl: string;
  poolPrefix: string;
  channels: string[];
  packages: { id: string; type: string; source: string }[];
}

export interface ExpectedLock {
  app: string;
  channels: Record<string, Record<string, string>>;
}

export interface ManifestEntry {
  id: string;
  type: string;
  version: string;
  url: string;
  sizeBytes: number;
}

export interface Manifest {
  packages: ManifestEntry[];
}

export type HealthLevel = "ok" | "warn" | "error";

export interface PackageHealth {
  /** ok = existe y el tamaño coincide; warn = existe pero el tamaño declarado
   *  no coincide; error = no se pudo bajar o está fuera de origen. */
  level: HealthLevel;
  reachable: boolean;
  sameOrigin: boolean;
  httpStatus?: number;
  actualSize?: number;
  sizeMatches?: boolean;
  error?: string;
}

export type PackageStatus = ManifestEntry & { health: PackageHealth };

export interface ChannelStatus {
  channel: string;
  /** true si se pudo bajar el manifest del canal. */
  ok: boolean;
  error?: string;
  packages: PackageStatus[];
}

export interface StatusResponse {
  fetchedAt: string;
  baseUrl: string;
  channels: ChannelStatus[];
}
