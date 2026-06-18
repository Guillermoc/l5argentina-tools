import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAll, type BuildItem } from "@l5a/core";
import { loadContext, fmtBytes } from "../context";

export interface BuildResult {
  items: BuildItem[];
  hasDrift: boolean;
  hasMissing: boolean;
}

/** Ejecuta el build y, salvo dryRun, escribe los artefactos nuevos en dist/. */
export async function runBuild(app: string, opts: { write?: boolean } = {}): Promise<BuildResult> {
  const ctx = await loadContext(app);
  const items = buildAll({
    appDir: ctx.appDir,
    config: ctx.config,
    versions: ctx.versions,
    registry: ctx.registry,
  });

  if (opts.write) {
    mkdirSync(ctx.paths.dist, { recursive: true });
    const summary: Record<string, unknown>[] = [];
    for (const it of items) {
      if (it.status === "new" && it.bytes && it.ext) {
        const file = join(ctx.paths.dist, `${it.id}-${it.version}.${it.ext}`);
        writeFileSync(file, it.bytes);
        it.artifactPath = file;
      }
      summary.push({
        id: it.id,
        type: it.type,
        version: it.version,
        status: it.status,
        sha256: it.sha256,
        sizeBytes: it.sizeBytes,
        url: it.url,
      });
    }
    writeFileSync(
      join(ctx.paths.dist, "build.json"),
      JSON.stringify(summary, null, 2) + "\n",
      "utf8",
    );
  }

  return {
    items,
    hasDrift: items.some((i) => i.status === "drift"),
    hasMissing: items.some((i) => i.status === "missing"),
  };
}

const ICON: Record<BuildItem["status"], string> = {
  new: "＋",
  existing: "·",
  missing: "?",
  drift: "✗",
};

export async function buildCommand(app: string, opts: { write?: boolean }): Promise<void> {
  const { items, hasDrift } = await runBuild(app, { write: opts.write !== false });

  console.log(`\nbuild · app "${app}"\n`);
  for (const it of items) {
    const size = it.sizeBytes ? fmtBytes(it.sizeBytes) : "";
    const line = `  ${ICON[it.status]} ${it.id.padEnd(12)} ${it.version.padEnd(8)} ${it.status.padEnd(9)} ${size.padStart(8)}`;
    console.log(it.message ? `${line}   — ${it.message}` : line);
  }

  const news = items.filter((i) => i.status === "new").length;
  const missing = items.filter((i) => i.status === "missing").length;
  console.log(
    `\n  ${news} nuevo(s), ${missing} ausente(s). ${opts.write !== false ? "Artefactos en apps/" + app + "/dist/." : "(dry-run, no se escribió dist)"}\n`,
  );

  if (hasDrift) {
    console.error(
      "  ✗ hay paquetes con DRIFT (contenido cambiado sin bumpear versión). Corregí versions.json.\n",
    );
    process.exit(1);
  }
}
