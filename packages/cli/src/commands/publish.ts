import { writeRegistry, writeLock, registryPut, buildAll, buildManifest, validateManifest, contentType, manifestKey, R2 } from "@l5a/core";
import { loadContext, fmtBytes } from "../context";

interface PublishOpts {
  channel: string;
  dryRun?: boolean;
}

/**
 * Publica las versiones actuales de la fuente (versions.json) a un canal
 * (normalmente debug): sube los blobs nuevos al pool, actualiza el registry,
 * fija el lock del canal y sube el manifest.json regenerado.
 */
export async function publishCommand(app: string, opts: PublishOpts): Promise<void> {
  const ctx = loadContext(app);
  const channel = opts.channel;
  if (!ctx.config.channels.includes(channel)) {
    throw new Error(`canal desconocido: ${channel}. Válidos: ${ctx.config.channels.join(", ")}`);
  }

  const items = buildAll({
    appDir: ctx.appDir,
    config: ctx.config,
    versions: ctx.versions,
    registry: ctx.registry,
  });

  // estado que tendría el canal = versión actual de la fuente para cada paquete
  const channelState: Record<string, string> = {};
  const toUpload = items.filter((i) => i.status === "new");
  const drift = items.filter((i) => i.status === "drift");
  const blockers: string[] = [];

  for (const it of items) {
    if (it.status === "drift") continue; // ya es blocker
    const resolvable =
      it.status === "new" ||
      it.status === "existing" ||
      Boolean(ctx.registry[it.id]?.[it.version]); // missing pero ya en registry
    if (!resolvable) {
      blockers.push(`${it.id}@${it.version} (${it.message ?? "no resoluble"})`);
      continue;
    }
    channelState[it.id] = it.version;
  }

  console.log(`\npublish · app "${app}" → canal "${channel}"${opts.dryRun ? " (dry-run)" : ""}\n`);
  console.log(`  blobs nuevos a subir: ${toUpload.length}`);
  for (const it of toUpload) {
    console.log(`    ＋ ${it.id}@${it.version}  ${fmtBytes(it.sizeBytes ?? 0)}  → ${it.key}`);
  }

  if (drift.length) {
    console.error(`\n  ✗ DRIFT en: ${drift.map((d) => d.id).join(", ")} — bumpeá versions.json.\n`);
    process.exit(1);
  }
  if (blockers.length) {
    console.error(`\n  ✗ no puedo armar el manifest de "${channel}", faltan fuentes/registry:`);
    for (const b of blockers) console.error(`      - ${b}`);
    console.error(`\n    (poné los assets faltantes o adoptá esas versiones primero)\n`);
    process.exit(1);
  }

  // armar y validar el manifest ANTES de tocar R2
  const manifest = buildManifest(ctx.config, channelState, ctx.registry);
  // las entradas nuevas todavía no están en registry: agregarlas en memoria para validar
  for (const it of toUpload) {
    registryPut(ctx.registry, it.id, it.version, {
      sha256: it.sha256!,
      sizeBytes: it.sizeBytes!,
      url: it.url!,
      type: it.type,
      ext: it.ext!,
    });
  }
  const fresh = buildManifest(ctx.config, channelState, ctx.registry);
  const errors = validateManifest(fresh, ctx.config.baseUrl);
  if (errors.length) {
    console.error("\n  ✗ manifest inválido:\n" + errors.map((e) => "      - " + e).join("\n"));
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(`\n  manifest "${channel}" tendría ${fresh.packages.length} paquetes. (dry-run, no se subió nada)\n`);
    return;
  }

  const r2 = R2.fromEnv();
  for (const it of toUpload) {
    if (await r2.exists(it.key!)) {
      console.log(`    · ${it.key} ya existe, no se re-sube`);
    } else {
      await r2.putBlob(it.key!, it.bytes!, contentType(it.ext!));
      console.log(`    ✓ subido ${it.key}`);
    }
  }

  ctx.lock.channels[channel] = channelState;
  await r2.putManifest(manifestKey(channel), JSON.stringify(fresh, null, 2) + "\n");

  writeRegistry(ctx.paths.registry, ctx.registry);
  writeLock(ctx.paths.lock, ctx.lock);

  console.log(`\n  ✓ publicado. manifest ${channel}/manifest.json + estado actualizado.\n`);
}
