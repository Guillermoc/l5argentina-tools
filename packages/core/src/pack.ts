import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { zipSync, type Zippable } from "fflate";

/** Fecha fija para todas las entradas del zip → empaquetado reproducible.
 *  Se construye con componentes LOCALES y un año holgado dentro del rango DOS
 *  (1980-2099) para que el resultado sea idéntico en cualquier huso horario. */
const FIXED_MTIME = new Date(2000, 0, 1, 0, 0, 0);

export interface Artifact {
  bytes: Uint8Array;
  ext: string;
  /** true si se empaquetó una carpeta en zip; false si la fuente era un archivo. */
  packed: boolean;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * Produce el artefacto distribuible de una fuente.
 * - Archivo: se devuelve tal cual (passthrough).
 * - Carpeta: se empaqueta en un zip DETERMINISTA (entradas ordenadas, mtime fijo)
 *   para que el mismo contenido produzca siempre el mismo hash.
 */
export function buildArtifact(source: string): Artifact {
  if (!existsSync(source)) {
    throw new Error(`fuente no encontrada: ${source}`);
  }
  const st = statSync(source);
  if (st.isFile()) {
    const bytes = new Uint8Array(readFileSync(source));
    const ext = extname(source).replace(/^\./, "") || "bin";
    return { bytes, ext, packed: false };
  }

  const files = walk(source).sort();
  const zippable: Zippable = {};
  for (const file of files) {
    const rel = relative(source, file).split(sep).join("/");
    zippable[rel] = [
      new Uint8Array(readFileSync(file)),
      { level: 9, mtime: FIXED_MTIME },
    ];
  }
  const bytes = zipSync(zippable);
  return { bytes, ext: "zip", packed: true };
}
