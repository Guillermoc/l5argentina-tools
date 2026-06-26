import { appConfig } from "../generated/companion";
import type {
  ExpectedLock,
  InboxItem,
  InboxListResponse,
  InboxSendResult,
  R2Env,
  Registry,
} from "../types";
import { R2Writer, hasR2Env, type R2Object } from "./r2write";
import { buildManifest } from "./promote";
import { refreshCardTitlesFromUrl } from "./cardTitles";

export const INBOX_PREFIX = "inbox/";

const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
const CACHE_MANIFEST = "public, max-age=60, must-revalidate";
const CACHE_STATE = "no-store";
const CACHE_INBOX = "no-store";

/** Canal de entrada del buzón: siempre se envía a debug (luego se promueve). */
const TARGET_CHANNEL = "debug";

const CONTENT_TYPE: Record<string, string> = {
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  zip: "application/zip",
};

const typeById = new Map(appConfig.packages.map((p) => [p.id, p.type]));

const contentTypeForExt = (ext: string): string => CONTENT_TYPE[ext] ?? "application/octet-stream";

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

/** Versión embebida en un nombre: convención `<algo>-<X.Y.Z>` (2+ números). */
const VERSION_RE = /^(.+)-(\d+(?:\.\d+)+)$/;

function parseInboxKey(key: string): { pkgId: string; ext: string; version?: string } | null {
  if (!key.startsWith(INBOX_PREFIX)) return null;
  const name = key.slice(INBOX_PREFIX.length);
  if (!name || name.includes("/")) return null; // ignora subcarpetas / el placeholder de carpeta
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const stem = name.slice(0, dot);
  const ext = name.slice(dot + 1);
  const m = stem.match(VERSION_RE);
  return m ? { pkgId: m[1]!, ext, version: m[2]! } : { pkgId: stem, ext };
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

async function readState(): Promise<{ registry: Registry; lock: ExpectedLock }> {
  const base = appConfig.baseUrl;
  const registry = (await fetchJson<Registry>(base + "_state/registry.json")) ?? {};
  const lock =
    (await fetchJson<ExpectedLock>(base + "_state/channels.lock.json")) ??
    ({ app: appConfig.app, channels: {} } as ExpectedLock);
  return { registry, lock };
}

function toItem(obj: R2Object, debugState: Record<string, string>): InboxItem | null {
  const parsed = parseInboxKey(obj.key);
  if (!parsed) return null;
  const { pkgId, ext, version } = parsed;
  const type = typeById.get(pkgId) ?? null;
  const currentDebug = debugState[pkgId];
  return {
    pkgId,
    ext,
    type,
    known: type != null,
    sizeBytes: obj.sizeBytes,
    lastModified: obj.lastModified,
    key: obj.key,
    currentDebug,
    // si el nombre trae versión, esa es la sugerida; si no, bumpeo la de debug
    suggestedVersion: version ?? bumpVersion(currentDebug),
    versionFromName: version != null,
  };
}

/** Lista el buzón con el contexto de debug (versión actual + sugerida por paquete). */
export async function listInbox(env: Partial<R2Env> | undefined): Promise<InboxListResponse> {
  if (!hasR2Env(env)) {
    return { items: [], hasCreds: false, error: "faltan credenciales R2 (configurá las env vars en Cloudflare Pages)" };
  }
  const writer = new R2Writer(env);
  const [objects, { lock }] = await Promise.all([writer.list(INBOX_PREFIX), readState()]);
  const debugState = lock.channels[TARGET_CHANNEL] ?? {};
  const items = objects
    .map((o) => toItem(o, debugState))
    .filter((i): i is InboxItem => i != null)
    .sort((a, b) => a.pkgId.localeCompare(b.pkgId) || a.key.localeCompare(b.key));
  return { items, hasCreds: true };
}

// --- acciones JSON (POST /api/inbox) ---

export interface InboxSendInput {
  op: "send";
  /** clave exacta del archivo en el buzón (permite varias versiones por paquete). */
  key: string;
  version: string;
  apply?: boolean;
}
export interface InboxDiscardInput {
  op: "discard";
  key: string;
}
export type InboxInput = InboxSendInput | InboxDiscardInput;

type Reply = { status: number; body: unknown };

const err = (status: number, message: string): Reply => ({ status, body: { error: message } });

export async function runInbox(input: InboxInput, env: Partial<R2Env> | undefined): Promise<Reply> {
  switch (input?.op) {
    case "send":
      return runSend(input, env);
    case "discard":
      return runDiscard(input, env);
    default:
      return err(400, "operación desconocida (op: send | discard)");
  }
}

/** Sube un archivo adjunto al buzón: inbox/<nombre>. El nombre define paquete+versión. */
export async function runUploadFile(
  rawName: string,
  bytes: ArrayBuffer | Uint8Array,
  env: Partial<R2Env> | undefined,
): Promise<Reply> {
  const name = (rawName ?? "").trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return err(400, "nombre de archivo inválido");
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return err(400, "el archivo necesita una extensión (p. ej. .json, .md, .zip)");
  if (!hasR2Env(env)) return err(503, "faltan credenciales R2 en el entorno");
  const ext = name.slice(dot + 1).toLowerCase();
  const key = `${INBOX_PREFIX}${name}`;
  const size = bytes instanceof Uint8Array ? bytes.byteLength : bytes.byteLength;
  await new R2Writer(env).putBytes(key, bytes, contentTypeForExt(ext), CACHE_INBOX);
  return { status: 200, body: { ok: true, key, sizeBytes: size } };
}

async function findByKey(writer: R2Writer, key: string): Promise<R2Object | null> {
  const objects = await writer.list(INBOX_PREFIX);
  return objects.find((o) => o.key === key) ?? null;
}

async function runSend(input: InboxSendInput, env: Partial<R2Env> | undefined): Promise<Reply> {
  const parsed = parseInboxKey(input.key);
  if (!parsed) return err(400, `clave de buzón inválida: "${input.key}"`);
  const { pkgId, ext } = parsed;
  const type = typeById.get(pkgId) ?? null;
  if (!type) {
    return err(400, `"${pkgId}" no es un paquete conocido (revisá app.config.json)`);
  }
  if (!/^\d+(\.\d+)*$/.test(input.version ?? "")) {
    return err(400, `versión inválida: "${input.version}" (usá algo tipo 2.1.2)`);
  }
  if (!hasR2Env(env)) {
    return err(503, "faltan credenciales R2 en el entorno del Worker (configurá las env vars en Cloudflare Pages)");
  }
  const writer = new R2Writer(env);
  const obj = await findByKey(writer, input.key);
  if (!obj) return err(404, `no existe "${input.key}" en el buzón`);

  const { registry, lock } = await readState();

  // inmutabilidad: no pisar una versión ya publicada
  if (registry[pkgId]?.[input.version]) {
    return err(409, `${pkgId}@${input.version} ya está publicada (las versiones son inmutables) — usá otra versión`);
  }

  const poolKey = `${appConfig.poolPrefix}/${type}/${pkgId}/${input.version}/${pkgId}.${ext}`;
  const url = appConfig.baseUrl + poolKey;
  const debugState = { ...(lock.channels[TARGET_CHANNEL] ?? {}) };
  const result: InboxSendResult = {
    pkgId,
    from: debugState[pkgId],
    to: input.version,
    poolKey,
    sizeBytes: obj.sizeBytes,
    applied: false,
  };

  if (!input.apply) {
    return { status: 200, body: result };
  }

  // 1) copia server-side inbox → pool (los bytes no pasan por el Worker)
  await writer.copy(obj.key, poolKey, contentTypeForExt(ext), CACHE_IMMUTABLE);

  // 2) registry: agrega la nueva (versión); sha256 vacío (no se hashea el blob acá)
  (registry[pkgId] ??= {})[input.version] = { sha256: "", sizeBytes: obj.sizeBytes, url, type, ext };

  // 3) lock: debug pasa a la nueva versión. manifest validado ANTES de tocar R2.
  debugState[pkgId] = input.version;
  lock.channels[TARGET_CHANNEL] = debugState;
  const manifest = buildManifest(debugState, registry);
  const bad = manifest.packages.filter((p) => !p.url.startsWith(appConfig.baseUrl) || !(p.sizeBytes > 0));
  if (bad.length) {
    return err(500, `manifest inválido tras enviar: ${bad.map((p) => p.id).join(", ")}`);
  }

  // se persiste el estado interno (_state/) antes del manifest que lee la app
  await writer.putText("_state/registry.json", JSON.stringify(registry, null, 2) + "\n", "application/json; charset=utf-8", CACHE_STATE);
  await writer.putText("_state/channels.lock.json", JSON.stringify(lock, null, 2) + "\n", "application/json; charset=utf-8", CACHE_STATE);
  await writer.putText(`${TARGET_CHANNEL}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n", "application/json; charset=utf-8", CACHE_MANIFEST);

  // 4) consumido: se saca del buzón (ya vive inmutable en la pool)
  await writer.delete(obj.key);

  // 5) si entró una base de cartas nueva, regeneramos el índice de nombres
  //    (card-titles.json) que usa el editor de reglas. Best-effort: no rompe el
  //    envío si falla (p. ej. límite de CPU al descomprimir).
  if (pkgId === "cards_db") {
    try {
      await refreshCardTitlesFromUrl(url, env);
    } catch (e) {
      result.titlesError = (e as Error).message;
    }
  }

  result.applied = true;
  return { status: 200, body: result };
}

async function runDiscard(input: InboxDiscardInput, env: Partial<R2Env> | undefined): Promise<Reply> {
  if (!hasR2Env(env)) return err(503, "faltan credenciales R2 en el entorno");
  if (!parseInboxKey(input.key)) return err(400, `clave de buzón inválida: "${input.key}"`);
  const writer = new R2Writer(env);
  await writer.delete(input.key);
  return { status: 200, body: { ok: true, key: input.key } };
}
