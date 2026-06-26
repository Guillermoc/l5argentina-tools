import { unzipSync } from "fflate";
import { appConfig } from "../generated/companion";
import type { ExpectedLock, R2Env, Registry } from "../types";
import { R2Writer, hasR2Env } from "./r2write";

/** Índice liviano de nombres de carta para validar el campo `title` de las reglas. */
export const CARD_TITLES_KEY = "_state/card-titles.json";
const CACHE_STATE = "no-store";

export interface CardTitlesDoc {
  count: number;
  updatedAt: string;
  source?: string;
  titles: string[];
}

/** Extrae los `name` de una carta del JSON dentro del zip de cards_db. Usa regex
 *  sobre el texto descomprimido (no JSON.parse de miles de objetos) para no
 *  pasarse del límite de CPU del free tier. */
export function extractTitlesFromZip(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes);
  const jsonName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".json"));
  if (!jsonName) throw new Error("el zip de cards_db no contiene un .json");
  let text = new TextDecoder("utf-8").decode(files[jsonName]!);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const seen = new Set<string>();
  const re = /"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    try {
      const name = JSON.parse(`"${m[1]}"`) as string; // des-escapa \u, \" etc.
      if (name) seen.add(name);
    } catch {
      /* ignora entradas raras */
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
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

/** URL del blob de cards_db que hay HOY en debug (de la pool), o null si no está. */
async function debugCardsDbUrl(): Promise<string | null> {
  const base = appConfig.baseUrl;
  const [lock, registry] = await Promise.all([
    fetchJson<ExpectedLock>(base + "_state/channels.lock.json"),
    fetchJson<Registry>(base + "_state/registry.json"),
  ]);
  const version = lock?.channels?.debug?.cards_db;
  if (!version) return null;
  return registry?.cards_db?.[version]?.url ?? null;
}

/** Baja el zip, extrae nombres y reescribe _state/card-titles.json. Best-effort:
 *  devuelve cuántos títulos quedaron, o tira si algo falla (el caller decide). */
export async function refreshCardTitlesFromUrl(
  url: string,
  env: Partial<R2Env> | undefined,
): Promise<number> {
  if (!hasR2Env(env)) throw new Error("faltan credenciales R2 para escribir card-titles");
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`no se pudo bajar cards_db (${url}): HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const titles = extractTitlesFromZip(bytes);
  const doc: CardTitlesDoc = {
    count: titles.length,
    updatedAt: new Date().toISOString(),
    source: url,
    titles,
  };
  await new R2Writer(env).putText(
    CARD_TITLES_KEY,
    JSON.stringify(doc) + "\n",
    "application/json; charset=utf-8",
    CACHE_STATE,
  );
  return titles.length;
}

/** Regenera card-titles desde el cards_db que hay en debug (bootstrap / a mano). */
export async function refreshCardTitlesFromDebug(env: Partial<R2Env> | undefined): Promise<number> {
  const url = await debugCardsDbUrl();
  if (!url) throw new Error("no hay cards_db en debug todavía");
  return refreshCardTitlesFromUrl(url, env);
}
