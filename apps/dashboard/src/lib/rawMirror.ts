import { unzipSync } from "fflate";
import type { R2Env } from "../types";
import { R2Writer, hasR2Env } from "./r2write";

// Mantiene tools/ (el mirror crudo sin comprimir que ya leen L5Argentina Review e image-audit, y
// que scripts/publish/publish-raw.mjs de L5Argentina DB subía a mano) igual a lo que acaba de
// quedar en debug. Reemplaza ese paso manual para filters/rules/cards_db: ahora es un efecto de
// "enviar a debug" en vez de un tercer camino que puede desincronizarse solo. Solo se dispara
// desde el dashboard — el CLI (`l5a inbox send`) no lo llama todavía.
const RAW_KEY_BY_PKG: Record<string, string> = {
  filters: "tools/filters.json",
  rules: "tools/rules.json",
  cards_db: "tools/cards.json",
};
const CACHE_RAW = "public, max-age=60, must-revalidate";

/** Baja lo que acaba de quedar en debug para `pkgId` y lo escribe sin comprimir en tools/. Best-
 *  effort: quien llama decide qué hacer si tira error (no aborta el envío a debug). */
export async function refreshRawMirror(
  pkgId: string,
  poolUrl: string,
  env: Partial<R2Env> | undefined,
): Promise<void> {
  const rawKey = RAW_KEY_BY_PKG[pkgId];
  if (!rawKey || !hasR2Env(env)) return;

  const res = await fetch(poolUrl);
  if (!res.ok) throw new Error(`no se pudo bajar ${poolUrl}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  let jsonBytes: Uint8Array = bytes;
  if (pkgId === "cards_db") {
    const files = unzipSync(bytes);
    const jsonName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".json"));
    if (!jsonName) throw new Error("el zip de cards_db no contiene un .json");
    jsonBytes = files[jsonName]!;
  }

  await new R2Writer(env).putBytes(rawKey, jsonBytes, "application/json; charset=utf-8", CACHE_RAW);
}
