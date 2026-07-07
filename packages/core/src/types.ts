export type PackageType =
  | "filters"
  | "database"
  | "rules"
  | "images"
  | "changelog";

/** Definición declarativa de un paquete en app.config.json */
export interface PackageDef {
  id: string;
  type: PackageType;
  /** Ruta a la fuente, relativa al directorio de la app. Puede ser un archivo (se publica tal cual) o una carpeta (se empaqueta en zip determinista). */
  source: string;
}

export interface AppConfig {
  app: string;
  /** Base pública del bucket (r2.dev), termina en "/". */
  baseUrl: string;
  /** Prefijo del pool content-addressed dentro del bucket. */
  poolPrefix: string;
  channels: string[];
  packages: PackageDef[];
}

/** versions.json: versión actual de la fuente de cada paquete. */
export type Versions = Record<string, string>;

/** channels.lock.json: estado declarado de cada canal (pkgId -> version). */
export interface Lock {
  app: string;
  channels: Record<string, Record<string, string>>;
}

/** registry.json: libro mayor de cada (paquete, versión) publicada y dónde vive. */
export type Registry = Record<string, Record<string, RegistryEntry>>;

export interface RegistryEntry {
  sha256: string;
  sizeBytes: number;
  url: string;
  type: PackageType;
  ext: string;
}

/** Entrada del manifest.json que consume la app. */
export interface ManifestEntry {
  id: string;
  type: PackageType;
  version: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface Manifest {
  packages: ManifestEntry[];
}
