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

export interface RegistryEntry {
  sha256: string;
  sizeBytes: number;
  url: string;
  type: string;
  ext: string;
}

/** Libro mayor: cada (paquete, versión) → dónde vive. Vive en _state/registry.json. */
export type Registry = Record<string, Record<string, RegistryEntry>>;

/** Credenciales R2 (S3) que el Worker/dev usan para ESCRIBIR (promover). */
export interface R2Env {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
}

/** Credenciales para hablar con D1 vía su HTTP API (mismo patrón que R2: creds en
 *  env, fetch idéntico en dev y prod). El account reusa R2_ACCOUNT_ID si no se
 *  setea uno propio. */
export interface D1Env {
  D1_DATABASE_ID: string;
  D1_API_TOKEN: string;
  /** id de cuenta Cloudflare; si falta, se usa R2_ACCOUNT_ID. */
  D1_ACCOUNT_ID?: string;
  R2_ACCOUNT_ID?: string;
}

// --- Reglas (editor online; backend D1) ---

/** Una regla = una carta y sus modificadores. `title` matchea el `name` de la
 *  carta en la DB. Forma usada por la API y la UI (camelCase); en D1 las columnas
 *  son snake_case. Al emitir el JSON se omiten los campos vacíos. */
export interface Rule {
  title: string;
  /** override del límite de copia; 0 = prohibida, 999 = sin límite. null = sin override. */
  maxCopies?: number | null;
  banned?: boolean;
  /** código de edición cuya imagen usar. */
  preferredPrinting?: string | null;
  note?: string | null;
  /** texto corto dibujado sobre la imagen. */
  label?: { text: string; color: string } | null;
  /** color del borde en el carrusel. */
  highlight?: { color: string } | null;
  updatedAt?: string;
}

export interface RulesListResponse {
  rules: Rule[];
  hasCreds: boolean;
  /** true si el título ya no existe en card-titles (la app deja editar igual, con aviso). */
  error?: string;
}

/** Plan/resultado de emitir una versión al buzón (snapshot del D1 → JSON). */
export interface RulesEmitResult {
  version: string;
  count: number;
  key: string;
  sizeBytes: number;
  applied: boolean;
  error?: string;
}

// --- Buzón (inbox): archivos pendientes de enviar a debug ---

export interface InboxItem {
  /** id del paquete, derivado del nombre del archivo (inbox/<pkgId>.<ext>). */
  pkgId: string;
  ext: string;
  /** tipo resuelto desde app.config.json, o null si el pkgId no es un paquete conocido. */
  type: string | null;
  known: boolean;
  sizeBytes: number;
  lastModified: string;
  key: string;
  /** versión que ese paquete tiene HOY en debug (si la hay). */
  currentDebug?: string;
  /** versión sugerida al enviar (la del nombre si la trae; si no, bump de la actual). */
  suggestedVersion: string;
  /** true si suggestedVersion salió del nombre del archivo (no de un bump). */
  versionFromName: boolean;
}

export interface InboxListResponse {
  items: InboxItem[];
  hasCreds: boolean;
  error?: string;
}

export interface InboxSendResult {
  pkgId: string;
  from?: string;
  to: string;
  poolKey: string;
  sizeBytes: number;
  applied: boolean;
  error?: string;
  /** si era cards_db, error al regenerar card-titles.json (best-effort, no bloquea). */
  titlesError?: string;
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
  /** Lock leído en vivo de _state/ en R2 (no del bundle de git). Para el drift. */
  expectedLock: ExpectedLock;
}
