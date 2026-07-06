import { appConfig } from "../generated/companion";
import type {
  LauncherInboxItem,
  LauncherManifest,
  LauncherPublishResult,
  LauncherSlot,
  LauncherSlotStatus,
  LauncherStatusResponse,
  PackageHealth,
  R2Env,
} from "../types";
import { R2Writer, hasR2Env, type R2Object } from "./r2write";
import { bumpVersion } from "./inbox";

// El launcher (Sun and Moon) vive en el MISMO bucket que companion pero con otro
// schema: carpeta plana `sunandmoon/`, manifest con `file` relativo + sha256 + size,
// sin pool/canales/registry. Esta lib arma ese manifest desde el dashboard.

const BASE_URL = appConfig.baseUrl;
export const LAUNCHER_PREFIX = "sunandmoon/";
export const LAUNCHER_INBOX_PREFIX = "sunandmoon/inbox/";
const MANIFEST_KEY = "sunandmoon/manifest.json";

const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
const CACHE_MANIFEST = "public, max-age=60, must-revalidate";
const CACHE_INBOX = "no-store";

const CONTENT_TYPE: Record<string, string> = {
  json: "application/json; charset=utf-8",
  zip: "application/zip",
};
const contentTypeForExt = (ext: string): string => CONTENT_TYPE[ext] ?? "application/octet-stream";

/** Slots versionados que maneja la pestaña. `stem` es el prefijo del nombre de
 *  archivo (`<stem>-<X.Y.Z>.zip`) — fijo por slot (decisión: una sola base). */
const SLOTS: { slot: LauncherSlot; stem: string; label: string }[] = [
  { slot: "database", stem: "database", label: "Base de datos" },
  { slot: "images", stem: "samuraiEx", label: "Imágenes" },
];
const slotByStem = new Map(SLOTS.map((s) => [s.stem, s.slot]));
const slotMeta = new Map(SLOTS.map((s) => [s.slot, s]));

/** Versión embebida en un nombre: convención `<stem>-<X.Y.Z>` (2+ números). */
const VERSION_RE = /^(.+)-(\d+(?:\.\d+)+)$/;

function parseInboxKey(key: string): { stem: string; ext: string; version?: string } | null {
  if (!key.startsWith(LAUNCHER_INBOX_PREFIX)) return null;
  const name = key.slice(LAUNCHER_INBOX_PREFIX.length);
  if (!name || name.includes("/")) return null; // ignora subcarpetas / placeholder
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const stem = name.slice(0, dot);
  const ext = name.slice(dot + 1).toLowerCase();
  const m = stem.match(VERSION_RE);
  return m ? { stem: m[1]!, ext, version: m[2]! } : { stem, ext };
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

/** Lee el manifest vivo por la URL pública (para el status; tolera que falte). */
async function readManifestPublic(): Promise<LauncherManifest | null> {
  return fetchJson<LauncherManifest>(BASE_URL + MANIFEST_KEY);
}

/** Lee el manifest por la API S3 autenticada (sin caché) — para el read-modify-write. */
async function readManifestAuthed(writer: R2Writer): Promise<LauncherManifest> {
  const bytes = await writer.getBytes(MANIFEST_KEY);
  return JSON.parse(new TextDecoder().decode(bytes)) as LauncherManifest;
}

/** sha256 en hex de un blob. `crypto.subtle` existe en Node 22 y en Workers. */
async function sha256hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Salud de un archivo del manifest: HEAD + comparación de tamaño (patrón de status.ts). */
async function checkFile(file: string, expectedSize: number): Promise<PackageHealth> {
  const url = BASE_URL + LAUNCHER_PREFIX + file;
  try {
    const head = await fetch(url, { method: "HEAD" });
    const len = Number(head.headers.get("content-length"));
    const actualSize = Number.isFinite(len) ? len : undefined;
    const sizeMatches = actualSize === undefined ? undefined : actualSize === expectedSize;
    const reachable = head.ok;
    const level: PackageHealth["level"] = !reachable ? "error" : sizeMatches === false ? "warn" : "ok";
    return { level, reachable, sameOrigin: true, httpStatus: head.status, actualSize, sizeMatches };
  } catch (err) {
    return { level: "error", reachable: false, sameOrigin: true, error: (err as Error).message };
  }
}

/** El entry (versión/file/sha256/size) del slot dentro del manifest. */
function slotEntry(manifest: LauncherManifest, slot: LauncherSlot) {
  return slot === "database" ? manifest.databases?.[0] : manifest.images;
}

function toInboxItem(obj: R2Object, currentVersions: Record<LauncherSlot, string | undefined>): LauncherInboxItem | null {
  const parsed = parseInboxKey(obj.key);
  if (!parsed) return null;
  const { stem, ext, version } = parsed;
  const slot = slotByStem.get(stem) ?? null;
  const current = slot ? currentVersions[slot] : undefined;
  return {
    key: obj.key,
    file: obj.key.slice(LAUNCHER_INBOX_PREFIX.length),
    ext,
    slot,
    known: slot != null,
    version,
    suggestedVersion: version ?? bumpVersion(current),
    sizeBytes: obj.sizeBytes,
    lastModified: obj.lastModified,
  };
}

/** Estado de la pestaña: manifest vivo (launcher + slots con salud) + buzón. El
 *  manifest se lee público (sin creds); el buzón necesita credenciales R2. */
export async function listLauncher(env: Partial<R2Env> | undefined): Promise<LauncherStatusResponse> {
  const manifest = await readManifestPublic();
  const base: Omit<LauncherStatusResponse, "hasCreds" | "inbox"> = {
    fetchedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    ok: manifest != null,
    error: manifest == null ? "no se pudo leer sunandmoon/manifest.json" : undefined,
    launcher: manifest?.launcher ?? { latest_version: "—", notes: "" },
    slots: [],
  };

  if (manifest) {
    base.slots = await Promise.all(
      SLOTS.map(async ({ slot, label }): Promise<LauncherSlotStatus> => {
        const e = slotEntry(manifest, slot);
        const health = e ? await checkFile(e.file, e.size) : ({ level: "error", reachable: false, sameOrigin: true, error: "slot ausente en el manifest" } as PackageHealth);
        return {
          slot,
          label: slot === "database" ? (manifest.databases?.[0]?.label ?? label) : label,
          version: e?.version ?? "—",
          file: e?.file ?? "—",
          sha256: e?.sha256 ?? "",
          size: e?.size ?? 0,
          health,
        };
      }),
    );
  }

  const currentVersions: Record<LauncherSlot, string | undefined> = {
    database: manifest ? slotEntry(manifest, "database")?.version : undefined,
    images: manifest ? slotEntry(manifest, "images")?.version : undefined,
  };

  if (!hasR2Env(env)) {
    return { ...base, hasCreds: false, inbox: [] };
  }
  const writer = new R2Writer(env);
  const objects = await writer.list(LAUNCHER_INBOX_PREFIX);
  const inbox = objects
    .map((o) => toInboxItem(o, currentVersions))
    .filter((i): i is LauncherInboxItem => i != null)
    .sort((a, b) => a.file.localeCompare(b.file));
  return { ...base, hasCreds: true, inbox };
}

// --- acciones JSON (POST /api/launcher) ---

export interface LauncherPublishInput {
  op: "publish";
  /** clave exacta del archivo en el buzón. */
  key: string;
  slot: LauncherSlot;
  version: string;
  apply?: boolean;
}
export interface LauncherDiscardInput {
  op: "discard";
  key: string;
}
export interface LauncherSetInput {
  op: "set-launcher";
  latest_version: string;
  notes: string;
  apply?: boolean;
}
export type LauncherInput = LauncherPublishInput | LauncherDiscardInput | LauncherSetInput;

type Reply = { status: number; body: unknown };
const err = (status: number, message: string): Reply => ({ status, body: { error: message } });

export async function runLauncher(input: LauncherInput, env: Partial<R2Env> | undefined): Promise<Reply> {
  switch (input?.op) {
    case "publish":
      return runPublish(input, env);
    case "discard":
      return runDiscard(input, env);
    case "set-launcher":
      return runSetLauncher(input, env);
    default:
      return err(400, "operación desconocida (op: publish | discard | set-launcher)");
  }
}

/** Sube un archivo adjunto al buzón del launcher: sunandmoon/inbox/<nombre>. */
export async function runUploadLauncherFile(
  rawName: string,
  bytes: ArrayBuffer | Uint8Array,
  env: Partial<R2Env> | undefined,
): Promise<Reply> {
  const name = (rawName ?? "").trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return err(400, "nombre de archivo inválido");
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return err(400, "el archivo necesita una extensión (p. ej. .zip)");
  if (!hasR2Env(env)) return err(503, "faltan credenciales R2 en el entorno");
  const ext = name.slice(dot + 1).toLowerCase();
  const key = `${LAUNCHER_INBOX_PREFIX}${name}`;
  const size = bytes.byteLength;
  await new R2Writer(env).putBytes(key, bytes, contentTypeForExt(ext), CACHE_INBOX);
  return { status: 200, body: { ok: true, key, sizeBytes: size } };
}

async function findByKey(writer: R2Writer, key: string): Promise<R2Object | null> {
  const objects = await writer.list(LAUNCHER_INBOX_PREFIX);
  return objects.find((o) => o.key === key) ?? null;
}

async function runPublish(input: LauncherPublishInput, env: Partial<R2Env> | undefined): Promise<Reply> {
  const parsed = parseInboxKey(input.key);
  if (!parsed) return err(400, `clave de buzón inválida: "${input.key}"`);
  const meta = slotMeta.get(input.slot);
  if (!meta) return err(400, `slot inválido: "${input.slot}" (usá database | images)`);
  if (!/^\d+(\.\d+)+$/.test(input.version ?? "")) {
    return err(400, `versión inválida: "${input.version}" (usá algo tipo 2.3.1)`);
  }
  if (!hasR2Env(env)) {
    return err(503, "faltan credenciales R2 en el entorno del Worker (configurá las env vars en Cloudflare Pages)");
  }
  const writer = new R2Writer(env);
  const obj = await findByKey(writer, input.key);
  if (!obj) return err(404, `no existe "${input.key}" en el buzón`);

  let manifest: LauncherManifest;
  try {
    manifest = await readManifestAuthed(writer);
  } catch (e) {
    return err(502, `no se pudo leer el manifest del launcher: ${(e as Error).message}`);
  }
  const current = slotEntry(manifest, input.slot);
  const ext = parsed.ext;
  const finalFile = `${meta.stem}-${input.version}.${ext}`;
  const finalKey = `${LAUNCHER_PREFIX}${finalFile}`;
  const orphan = current?.file && current.file !== finalFile ? current.file : undefined;

  const result: LauncherPublishResult = {
    slot: input.slot,
    from: current?.version,
    to: input.version,
    file: finalFile,
    sizeBytes: obj.sizeBytes,
    orphan,
    applied: false,
  };
  if (!input.apply) return { status: 200, body: result };

  // 1) bytes del buzón → sha256 + size reales
  const bytes = await writer.getBytes(obj.key);
  const sha256 = await sha256hex(bytes);
  const size = bytes.byteLength;

  // 2) manifest reconstruido en memoria (solo se toca este slot) y validado ANTES de escribir
  const next = applySlot(manifest, input.slot, { version: input.version, file: finalFile, sha256, size });
  const bad = validateManifest(next);
  if (bad) return err(500, `manifest inválido tras publicar: ${bad}`);

  // 3) el archivo primero (copia server-side), después el manifest que lo referencia
  await writer.copy(obj.key, finalKey, contentTypeForExt(ext), CACHE_IMMUTABLE);
  await writer.putText(MANIFEST_KEY, JSON.stringify(next, null, 2) + "\n", CONTENT_TYPE.json!, CACHE_MANIFEST);

  // 4) consumido: se saca del buzón
  await writer.delete(obj.key);

  result.sha256 = sha256;
  result.sizeBytes = size;
  result.applied = true;
  return { status: 200, body: result };
}

/** Devuelve una copia del manifest con el slot reemplazado (preserva el resto). */
function applySlot(
  manifest: LauncherManifest,
  slot: LauncherSlot,
  patch: { version: string; file: string; sha256: string; size: number },
): LauncherManifest {
  const next: LauncherManifest = JSON.parse(JSON.stringify(manifest));
  if (slot === "database") {
    const db = next.databases?.[0];
    if (db) Object.assign(db, patch);
    else next.databases = [{ id: "community", label: "Base Comunidad — Samurai Extended", ...patch }];
  } else {
    next.images = { ...next.images, ...patch };
  }
  return next;
}

/** Chequeo mínimo del manifest antes de persistir. Devuelve el problema, o null si está OK. */
function validateManifest(m: LauncherManifest): string | null {
  const entries = [m.databases?.[0], m.images];
  for (const e of entries) {
    if (!e) return "falta un slot";
    if (!e.file || !e.sha256 || !(e.size > 0)) return `entry incompleto (${e.file || "?"})`;
  }
  return null;
}

async function runSetLauncher(input: LauncherSetInput, env: Partial<R2Env> | undefined): Promise<Reply> {
  const version = (input.latest_version ?? "").trim();
  if (!/^\d+(\.\d+)+$/.test(version)) {
    return err(400, `versión de launcher inválida: "${input.latest_version}" (usá algo tipo 0.1.2)`);
  }
  const notes = (input.notes ?? "").trim();
  if (!hasR2Env(env)) return err(503, "faltan credenciales R2 en el entorno");
  const writer = new R2Writer(env);
  let manifest: LauncherManifest;
  try {
    manifest = await readManifestAuthed(writer);
  } catch (e) {
    return err(502, `no se pudo leer el manifest del launcher: ${(e as Error).message}`);
  }
  const from = manifest.launcher ?? { latest_version: "—", notes: "" };
  if (!input.apply) {
    return { status: 200, body: { from, to: { latest_version: version, notes }, applied: false } };
  }
  const next: LauncherManifest = { ...manifest, launcher: { latest_version: version, notes } };
  await writer.putText(MANIFEST_KEY, JSON.stringify(next, null, 2) + "\n", CONTENT_TYPE.json!, CACHE_MANIFEST);
  return { status: 200, body: { from, to: next.launcher, applied: true } };
}

async function runDiscard(input: LauncherDiscardInput, env: Partial<R2Env> | undefined): Promise<Reply> {
  if (!hasR2Env(env)) return err(503, "faltan credenciales R2 en el entorno");
  if (!parseInboxKey(input.key)) return err(400, `clave de buzón inválida: "${input.key}"`);
  await new R2Writer(env).delete(input.key);
  return { status: 200, body: { ok: true, key: input.key } };
}
