/**
 * Sube las imágenes de cartas (images/cards/<set>/<id>.jpg en disco) a
 * tools/images/cards/<set>/<id>.jpg en R2. Uso puntual (no es parte del CLI).
 *
 * Dry-run por default. Requiere --apply para escribir.
 *
 *   npx tsx scripts/upload-card-images.ts <carpeta-local> [--apply] [--force] [--concurrency=8]
 *
 * <carpeta-local> debe contener subcarpetas por set (la carpeta "cards", no su padre).
 */
import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { R2 } from "@l5a/core";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function parseArgs(argv: string[]) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
  const kv = Object.fromEntries(
    argv.filter((a) => a.startsWith("--") && a.includes("=")).map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v];
    }),
  );
  const localDir = args[0];
  if (!localDir) {
    console.error("uso: npx tsx scripts/upload-card-images.ts <carpeta-local> [--apply] [--force] [--concurrency=8] [--limit=N]");
    process.exit(1);
  }
  return {
    localDir,
    apply: flags.has("--apply"),
    force: flags.has("--force"),
    concurrency: Number(kv.concurrency ?? 8),
    limit: kv.limit ? Number(kv.limit) : undefined,
  };
}

async function walkFiles(dir: string): Promise<{ set: string; file: string; abs: string }[]> {
  const sets = await readdir(dir, { withFileTypes: true });
  const out: { set: string; file: string; abs: string }[] = [];
  for (const s of sets) {
    if (!s.isDirectory()) continue;
    const setDir = join(dir, s.name);
    const files = await readdir(setDir, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile()) continue;
      out.push({ set: s.name, file: f.name, abs: join(setDir, f.name) });
    }
  }
  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

async function main() {
  const { localDir, apply, force, concurrency, limit } = parseArgs(process.argv.slice(2));

  let entries = await walkFiles(localDir);
  if (entries.length === 0) {
    console.error(`no se encontraron archivos en ${localDir}`);
    process.exit(1);
  }
  console.log(`${entries.length} archivos locales en ${new Set(entries.map((e) => e.set)).size} sets`);
  if (limit) {
    entries = entries.slice(0, limit);
    console.log(`--limit=${limit}: usando solo los primeros ${entries.length}`);
  }

  const r2 = R2.fromEnv();

  let toUpload = 0;
  let toSkip = 0;
  let totalBytes = 0;

  const plan = await mapWithConcurrency(entries, concurrency, async (e) => {
    const key = `tools/images/cards/${e.set}/${e.file}`;
    const st = await stat(e.abs);
    if (!force) {
      const remoteSize = await r2.headSize(key);
      if (remoteSize === st.size) {
        toSkip++;
        return { key, abs: e.abs, size: st.size, skip: true };
      }
    }
    toUpload++;
    totalBytes += st.size;
    return { key, abs: e.abs, size: st.size, skip: false };
  });

  console.log(`plan: ${toUpload} para subir (${(totalBytes / 1024 / 1024).toFixed(1)} MB), ${toSkip} ya están (mismo tamaño) — modo ${force ? "force" : "normal"}`);

  if (!apply) {
    console.log("dry-run: no se subió nada. Repetí con --apply para escribir en R2.");
    if (toUpload > 0) {
      console.log("ejemplo de lo que se subiría:");
      for (const p of plan.filter((p) => !p.skip).slice(0, 5)) console.log(`  ${p.abs} → ${p.key}`);
    }
    return;
  }

  const pending = plan.filter((p) => !p.skip);
  let done = 0;
  await mapWithConcurrency(pending, concurrency, async (p) => {
    const ext = extname(p.abs).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const body = await readFile(p.abs);
    await r2.putBlob(p.key, body, contentType);
    done++;
    if (done % 200 === 0 || done === pending.length) console.log(`  ${done}/${pending.length} subidas`);
  });

  console.log(`listo: ${pending.length} imágenes subidas a tools/images/cards/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
