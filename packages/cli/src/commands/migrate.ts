import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  planMigrate,
  manifestFromPlan,
  validateManifest,
  registryPut,
  writeRegistry,
  writeLock,
  contentType,
  manifestKey,
  R2,
  type MigratePlanItem,
} from "@l5a/core";
import { loadContext, fmtBytes, commitState } from "../context";

interface MigrateOpts {
  channel: string;
  apply?: boolean;
  commit?: boolean;
  adopt?: boolean;
}

const ICON: Record<MigratePlanItem["action"], string> = {
  copy: "⇄",
  upload: "↑",
  skip: "·",
  blocked: "✗",
};

function stripBytes(i: MigratePlanItem) {
  const { bytes, ...rest } = i;
  return rest;
}

/**
 * Migra un canal a la pool. Por defecto solo PLANIFICA: genera dist/ (manifest
 * preview + plan.json + artefactos nuevos) sin tocar R2. Con --apply ejecuta:
 * copia server-side lo que ya está en vivo, sube lo nuevo, y publica el manifest.
 */
export async function migrateCommand(app: string, opts: MigrateOpts): Promise<void> {
  const ctx = loadContext(app);
  const channel = opts.channel;
  if (!ctx.config.channels.includes(channel)) {
    throw new Error(`canal desconocido: ${channel}. Válidos: ${ctx.config.channels.join(", ")}`);
  }

  const mode = opts.adopt ? "adopt: versiones en vivo del canal" : "versiones de versions.json";
  console.log(`\nmigrate · app "${app}" → canal "${channel}"  (${mode})${opts.apply ? "" : "  · plan / dry-run"}\n`);
  console.log("  bajando manifest en vivo y midiendo lo que ya existe…\n");

  const plan = await planMigrate({
    appDir: ctx.appDir,
    config: ctx.config,
    versions: ctx.versions,
    registry: ctx.registry,
    channel,
    adopt: opts.adopt,
  });
  const manifest = manifestFromPlan(ctx.config, plan);

  // tabla
  let copyBytes = 0;
  let uploadBytes = 0;
  for (const it of plan.items) {
    const size = it.sizeBytes ?? 0;
    if (it.action === "copy") copyBytes += size;
    if (it.action === "upload") uploadBytes += size;
    const detail =
      it.action === "copy"
        ? `copia server-side  ${it.fromKey} → ${it.poolKey}`
        : it.action === "upload"
          ? `sube desde local   → ${it.poolKey}`
          : it.action === "skip"
            ? "ya en el registry"
            : it.message ?? "";
    console.log(
      `  ${ICON[it.action]} ${it.id.padEnd(12)} ${it.version.padEnd(8)} ${fmtBytes(size).padStart(9)}  ${detail}`,
    );
  }

  const blocked = plan.items.filter((i) => i.action === "blocked");
  const copies = plan.items.filter((i) => i.action === "copy").length;
  const uploads = plan.items.filter((i) => i.action === "upload").length;
  console.log(
    `\n  ${copies} copia(s) server-side (${fmtBytes(copyBytes)}, 0 de subida) · ${uploads} subida(s) desde local (${fmtBytes(uploadBytes)})`,
  );

  // escribir preview en dist/
  const dist = ctx.paths.dist;
  mkdirSync(join(dist, channel), { recursive: true });
  writeFileSync(join(dist, "plan.json"), JSON.stringify(plan.items.map(stripBytes), null, 2) + "\n", "utf8");
  writeFileSync(join(dist, channel, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  for (const it of plan.items) {
    if (it.action === "upload" && it.bytes && it.poolKey) {
      const f = join(dist, it.poolKey);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, it.bytes);
    }
  }
  console.log(`\n  preview escrita en apps/${app}/dist/ (plan.json + ${channel}/manifest.json + artefactos nuevos)`);

  const manifestErrors = validateManifest(manifest, ctx.config.baseUrl);
  if (blocked.length || manifestErrors.length) {
    if (blocked.length)
      console.error(`\n  ✗ bloqueado: ${blocked.map((b) => `${b.id} (${b.message})`).join("; ")}`);
    if (manifestErrors.length) console.error("  ✗ " + manifestErrors.join("\n  ✗ "));
    console.error("");
    process.exit(1);
  }

  if (!opts.apply) {
    console.log(`\n  (dry-run) revisá el dist/. Para ejecutar: l5a migrate -c ${channel}${opts.adopt ? " --adopt" : ""} --apply\n`);
    return;
  }

  // APPLY
  console.log("\n  aplicando contra R2…");
  const r2 = R2.fromEnv();
  for (const it of plan.items) {
    if (it.action === "copy") {
      await r2.copy(it.fromKey!, it.poolKey!);
      console.log(`    ⇄ copiado ${it.poolKey}`);
    } else if (it.action === "upload") {
      await r2.putBlob(it.poolKey!, it.bytes!, contentType(it.ext!));
      console.log(`    ↑ subido   ${it.poolKey}`);
    }
    if (it.action !== "blocked") {
      registryPut(ctx.registry, it.id, it.version, {
        sha256: it.sha256 ?? "",
        sizeBytes: it.sizeBytes!,
        url: it.url!,
        type: it.type,
        ext: it.ext!,
      });
      (ctx.lock.channels[channel] ??= {})[it.id] = it.version;
    }
  }
  await r2.putManifest(manifestKey(channel), JSON.stringify(manifest, null, 2) + "\n");
  writeRegistry(ctx.paths.registry, ctx.registry);
  writeLock(ctx.paths.lock, ctx.lock);

  console.log(`\n  ✓ canal "${channel}" migrado a la pool. manifest + registry + lock actualizados.`);
  if (opts.commit) commitState(ctx, `chore(deploy): migrate ${channel} → pool`);
  console.log("");
}
