import { R2Writer, hasR2Env } from "./r2write";
import type { R2Env } from "../types";

const REPORTS_PREFIX = "tools/reports/";
const INDEX_KEY = `${REPORTS_PREFIX}index.json`;
const CONTENT_TYPE_JSON = "application/json; charset=utf-8";
const CACHE_MANIFEST = "public, max-age=60, must-revalidate";

export interface ReviewSubmitInput {
  /** `<tipo>-<set>`, matchea `reports[].analisis` en el índice (NO el nombre de archivo). */
  analisis: string;
  fecha_reporte?: string;
  db?: string;
  decisions: Record<string, unknown>;
}

type Reply = { status: number; body: unknown };

const err = (status: number, message: string): Reply => ({ status, body: { error: message } });

interface IndexReportEntry {
  file: string;
  analisis: string;
  set: string;
  fecha: string;
  [k: string]: unknown;
}

interface ReportsIndex {
  reports: IndexReportEntry[];
  actualizado?: string;
  sets?: unknown;
  [k: string]: unknown;
}

/** Escribe las decisiones de una revisión al bucket y marca la entrada del
 *  índice como "revisado" (lectura-modificación-escritura, preservando los
 *  campos que no le pertenecen: `sets`, `aplicado`). */
export async function runSubmitReview(
  input: ReviewSubmitInput,
  env: Partial<R2Env> | undefined,
): Promise<Reply> {
  const analisis = (input?.analisis ?? "").trim();
  if (!analisis) return err(400, "falta analisis");
  if (!input?.decisions || typeof input.decisions !== "object") {
    return err(400, "faltan decisions");
  }
  if (!hasR2Env(env)) return err(503, "faltan credenciales R2 en el entorno");

  const decididas = Object.keys(input.decisions).length;
  if (decididas === 0) return err(400, "no hay decisiones para enviar");

  const writer = new R2Writer(env);
  const decisionsFile = `decisions/${analisis}-review.json`;
  const decisionsKey = `${REPORTS_PREFIX}${decisionsFile}`;
  const decisionsBody = JSON.stringify(
    {
      analisis,
      fecha_reporte: input.fecha_reporte,
      db: input.db,
      exportado: new Date().toISOString(),
      decisions: input.decisions,
    },
    null,
    1,
  ) + "\n";
  await writer.putText(decisionsKey, decisionsBody, CONTENT_TYPE_JSON, CACHE_MANIFEST);

  const raw = await writer.getBytes(INDEX_KEY);
  const idx = JSON.parse(new TextDecoder().decode(raw)) as ReportsIndex;
  const candidates = (idx.reports ?? []).filter((r) => r.analisis === analisis);
  if (!candidates.length) {
    return err(404, `no hay reporte con analisis "${analisis}" en el índice`);
  }
  candidates.sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));
  const entry = candidates[0]!;
  const fecha = new Date().toISOString().slice(0, 10);
  entry.review = { file: decisionsFile, fecha, decididas };
  idx.actualizado = new Date().toISOString();
  await writer.putText(INDEX_KEY, JSON.stringify(idx, null, 1) + "\n", CONTENT_TYPE_JSON, CACHE_MANIFEST);

  return { status: 200, body: { ok: true, decisionsKey, decididas, analisis, fecha } };
}
