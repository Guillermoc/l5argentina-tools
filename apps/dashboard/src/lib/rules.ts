import type { D1Env, ExpectedLock, R2Env, Registry, Rule, RulesEmitResult, RulesListResponse } from "../types";
import { appConfig } from "../generated/companion";
import { D1Client, hasD1Env } from "./d1";
import { runUploadFile } from "./inbox";

/** Paquete y tipo de las reglas en el manifest (ver apps/companion/app.config.json). */
const RULES_PKG = "rules";

type Reply = { status: number; body: unknown };
const err = (status: number, message: string): Reply => ({ status, body: { error: message } });

// --- esquema ---

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS rules (
  title              TEXT PRIMARY KEY,
  max_copies         INTEGER,
  banned             INTEGER NOT NULL DEFAULT 0,
  preferred_printing TEXT,
  note               TEXT,
  label_text         TEXT,
  label_color        TEXT,
  highlight_color    TEXT,
  updated_at         TEXT NOT NULL,
  pending            INTEGER NOT NULL DEFAULT 1
)`;

async function ensureSchema(db: D1Client): Promise<void> {
  await db.query(CREATE_TABLE);
  // `pending` (1 = cambió desde la última emisión) se agregó después; en tablas
  // ya creadas, sumamos la columna. Si ya existe, D1 tira y lo ignoramos.
  try {
    await db.query("ALTER TABLE rules ADD COLUMN pending INTEGER NOT NULL DEFAULT 1");
  } catch {
    /* la columna ya existe */
  }
}

// --- mapeo D1 <-> Rule ---

interface Row {
  title: string;
  max_copies: number | null;
  banned: number;
  preferred_printing: string | null;
  note: string | null;
  label_text: string | null;
  label_color: string | null;
  highlight_color: string | null;
  updated_at: string;
  pending: number;
}

function rowToRule(r: Row): Rule {
  return {
    title: r.title,
    maxCopies: r.max_copies,
    banned: Boolean(r.banned),
    preferredPrinting: r.preferred_printing,
    note: r.note,
    label: r.label_text ? { text: r.label_text, color: r.label_color ?? "#000000" } : null,
    highlight: r.highlight_color ? { color: r.highlight_color } : null,
    updatedAt: r.updated_at,
    pending: Boolean(r.pending),
  };
}

/** Objeto mínimo para el JSON publicado: solo los campos que aplican (igual que
 *  los archivos rules-*.json hechos a mano). */
function ruleToOutput(r: Rule): Record<string, unknown> {
  const o: Record<string, unknown> = { title: r.title };
  if (r.maxCopies != null) o.maxCopies = r.maxCopies;
  if (r.banned) o.banned = true;
  if (r.preferredPrinting) o.preferredPrinting = r.preferredPrinting;
  if (r.note) o.note = r.note;
  if (r.label?.text) o.label = { text: r.label.text, color: r.label.color || "#000000" };
  if (r.highlight?.color) o.highlight = { color: r.highlight.color };
  return o;
}

// --- lectura ---

export async function listRules(env: Partial<D1Env> | undefined): Promise<RulesListResponse> {
  if (!hasD1Env(env)) {
    return { rules: [], hasCreds: false, error: "faltan credenciales D1 (configurá D1_DATABASE_ID y D1_API_TOKEN)" };
  }
  const db = new D1Client(env);
  await ensureSchema(db);
  const rows = await db.query<Row>("SELECT * FROM rules ORDER BY title COLLATE NOCASE");
  return { rules: rows.map(rowToRule), hasCreds: true };
}

// --- escritura ---

export interface RuleUpsertInput {
  op: "upsert";
  rule: Rule;
  /** si true, falla cuando el título ya existe (alta nueva, no edición). */
  requireNew?: boolean;
}
export interface RuleDeleteInput {
  op: "delete";
  title: string;
}
export interface RuleImportInput {
  op: "import";
  rules: Rule[];
}
export type RulesInput = RuleUpsertInput | RuleDeleteInput | RuleImportInput;

/** Columnas de una fila en orden, para los INSERT (incluido el multi-row). */
function ruleParams(rule: Rule, now: string, pending: number): unknown[] {
  return [
    rule.title,
    rule.maxCopies,
    rule.banned ? 1 : 0,
    rule.preferredPrinting,
    rule.note,
    rule.label?.text ?? null,
    rule.label?.color ?? null,
    rule.highlight?.color ?? null,
    now,
    pending,
  ];
}

const UPSERT_TAIL = `
ON CONFLICT(title) DO UPDATE SET
  max_copies = excluded.max_copies,
  banned = excluded.banned,
  preferred_printing = excluded.preferred_printing,
  note = excluded.note,
  label_text = excluded.label_text,
  label_color = excluded.label_color,
  highlight_color = excluded.highlight_color,
  updated_at = excluded.updated_at,
  pending = excluded.pending`;

const COLS = "title, max_copies, banned, preferred_printing, note, label_text, label_color, highlight_color, updated_at, pending";
const ROW_PLACEHOLDER = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"; // 10 columnas

/** Importa un lote: normaliza, dedupe por título (gana el último — SQLite no deja
 *  que un mismo título aparezca dos veces en un INSERT con ON CONFLICT), y hace
 *  upsert en chunks (multi-row) para no pasarse del límite de parámetros.
 *  `pending`: 1 = quedan como cambios sin emitir (import desde archivo); 0 = ya
 *  publicadas (import desde un canal). `reset`: vacía la tabla antes (reemplazo total). */
async function importRules(
  db: D1Client,
  input: Rule[],
  { pending, reset = false }: { pending: number; reset?: boolean },
): Promise<Reply> {
  const byTitle = new Map<string, Rule>();
  let invalid = 0;
  for (const raw of input ?? []) {
    const rule = normalizeRule(raw);
    if (!rule) {
      invalid++;
      continue;
    }
    byTitle.set(rule.title, rule);
  }
  const unique = [...byTitle.values()];
  if (unique.length === 0) return err(400, "no hay reglas válidas para importar");

  if (reset) await db.query("DELETE FROM rules");

  const now = new Date().toISOString();
  // D1 limita a 100 los parámetros por query → 9 filas × 10 columnas = 90 (bajo el tope)
  const CHUNK = 9;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => ROW_PLACEHOLDER).join(", ");
    const params = chunk.flatMap((r) => ruleParams(r, now, pending));
    await db.query(`INSERT INTO rules (${COLS}) VALUES ${placeholders}${UPSERT_TAIL}`, params);
  }
  return { status: 200, body: { ok: true, imported: unique.length, deduped: input.length - unique.length, invalid } };
}

function normalizeRule(input: Rule | undefined): Rule | null {
  const title = (input?.title ?? "").trim();
  if (!title) return null;
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };
  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s ? s : null;
  };
  return {
    title,
    maxCopies: num(input?.maxCopies),
    banned: Boolean(input?.banned),
    preferredPrinting: str(input?.preferredPrinting),
    note: str(input?.note),
    label: input?.label?.text ? { text: input.label.text.trim(), color: input.label.color || "#000000" } : null,
    highlight: input?.highlight?.color ? { color: input.highlight.color } : null,
  };
}

export async function runRules(input: RulesInput, env: Partial<D1Env> | undefined): Promise<Reply> {
  if (!hasD1Env(env)) return err(503, "faltan credenciales D1 en el entorno (configurá D1_DATABASE_ID y D1_API_TOKEN)");
  const db = new D1Client(env);
  await ensureSchema(db);

  switch (input?.op) {
    case "upsert": {
      const rule = normalizeRule(input.rule);
      if (!rule) return err(400, "la regla necesita un título (nombre de carta)");
      if (input.requireNew) {
        const exists = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM rules WHERE title = ?", [rule.title]);
        if ((exists[0]?.n ?? 0) > 0) {
          return err(409, `ya existe una regla para "${rule.title}" — editala en vez de duplicarla`);
        }
      }
      await db.query(
        `INSERT INTO rules (${COLS}) VALUES ${ROW_PLACEHOLDER}${UPSERT_TAIL}`,
        ruleParams(rule, new Date().toISOString(), 1),
      );
      return { status: 200, body: { ok: true, rule } };
    }
    case "import":
      return importRules(db, input.rules, { pending: 1 });
    case "delete": {
      const title = (input.title ?? "").trim();
      if (!title) return err(400, "falta el título a borrar");
      await db.query("DELETE FROM rules WHERE title = ?", [title]);
      return { status: 200, body: { ok: true, title } };
    }
    default:
      return err(400, "operación desconocida (op: upsert | delete | import)");
  }
}

// --- importar desde un canal (lo publicado en debug/staging/production) ---

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    if (res.ok) return (await res.json()) as T;
  } catch {
    /* ignore */
  }
  return null;
}

/** Importa a D1 el `rules-*.json` que hay publicado en un canal (default debug).
 *  Resuelve versión (lock) → URL (registry) → baja el JSON → upsert en lote. */
export async function importRulesFromChannel(
  channel: string,
  env: Partial<D1Env> | undefined,
): Promise<Reply> {
  if (!hasD1Env(env)) return err(503, "faltan credenciales D1 en el entorno");
  const base = appConfig.baseUrl;
  const [lock, registry] = await Promise.all([
    fetchJson<ExpectedLock>(base + "_state/channels.lock.json"),
    fetchJson<Registry>(base + "_state/registry.json"),
  ]);
  const version = lock?.channels?.[channel]?.[RULES_PKG];
  if (!version) return err(404, `no hay ${RULES_PKG} publicado en ${channel}`);
  const url = registry?.[RULES_PKG]?.[version]?.url;
  if (!url) return err(404, `no encuentro la URL de ${RULES_PKG}@${version} en el registry`);
  const doc = await fetchJson<{ rules: Rule[] }>(url);
  if (!doc?.rules) return err(502, `no pude leer ${url}`);

  const db = new D1Client(env);
  await ensureSchema(db);
  // reset: el editor pasa a ser EXACTAMENTE lo de ese canal; ya está publicado → pending 0
  const reply = await importRules(db, doc.rules, { pending: 0, reset: true });
  if (reply.status === 200 && reply.body && typeof reply.body === "object") {
    (reply.body as Record<string, unknown>).source = `${channel}@${version}`;
  }
  return reply;
}

// --- emitir: snapshot del D1 → JSON → buzón (inbox/rules-X.Y.Z.json) ---

const VERSION_RE = /^\d+(\.\d+)+$/;

export async function emitRules(
  version: string,
  apply: boolean,
  env: Partial<D1Env & R2Env> | undefined,
): Promise<Reply> {
  if (!hasD1Env(env)) return err(503, "faltan credenciales D1 en el entorno");
  if (!VERSION_RE.test(version ?? "")) return err(400, `versión inválida: "${version}" (usá algo tipo 2.1.2)`);

  const db = new D1Client(env);
  await ensureSchema(db);
  const rows = await db.query<Row>("SELECT * FROM rules ORDER BY title COLLATE NOCASE");
  if (rows.length === 0) return err(400, "no hay reglas para emitir");

  const doc = { rules: rows.map(rowToRule).map(ruleToOutput) };
  const json = JSON.stringify(doc, null, 2) + "\n";
  const bytes = new TextEncoder().encode(json);
  const key = `${RULES_PKG}-${version}.json`;

  const result: RulesEmitResult = {
    version,
    count: rows.length,
    key: `inbox/${key}`,
    sizeBytes: bytes.byteLength,
    applied: false,
  };
  if (!apply) return { status: 200, body: result };

  // sube el snapshot al buzón reusando el flujo existente (de ahí → debug → promover)
  const up = await runUploadFile(key, bytes, env);
  if (up.status >= 400) return up;
  // el snapshot incluye TODAS las filas → ya no hay nada pendiente de emitir
  await db.query("UPDATE rules SET pending = 0 WHERE pending = 1");
  result.applied = true;
  return { status: 200, body: result };
}
