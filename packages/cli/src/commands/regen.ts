import { R2, buildManifest, validateManifest, writeRemoteRegistry, manifestKey, sha256 } from "@l5a/core";
import { loadContext, fmtBytes } from "../context";

interface RegenOpts {
  apply?: boolean;
}

/**
 * Backfill de sha256 en el registry (versiones publicadas antes de que el
 * tooling lo calculara, vía buzón/migrate) + regeneración del manifest.json
 * de cada canal para que incluya el sha256 de cada paquete. Dry-run por
 * defecto: no toca R2 hasta --apply.
 */
export async function regenCommand(app: string, opts: RegenOpts): Promise<void> {
  const ctx = await loadContext(app);

  const missing: { pkgId: string; version: string; url: string; sizeBytes: number }[] = [];
  for (const [pkgId, versions] of Object.entries(ctx.registry)) {
    for (const [version, entry] of Object.entries(versions)) {
      if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
        missing.push({ pkgId, version, url: entry.url, sizeBytes: entry.sizeBytes });
      }
    }
  }

  const channels = ctx.config.channels.filter((c) => Object.keys(ctx.lock.channels[c] ?? {}).length > 0);

  console.log(`\nregen · app "${app}"${opts.apply ? "" : " (dry-run)"}\n`);
  console.log(`  ${missing.length} versión(es) en el registry sin sha256 (se recalculan bajando el blob):`);
  for (const m of missing) console.log(`    ? ${m.pkgId}@${m.version}  ${fmtBytes(m.sizeBytes)}`);
  console.log(`\n  se reescribirían ${channels.length} manifest(s): ${channels.join(", ") || "(ninguno con paquetes)"}\n`);

  if (!opts.apply) {
    console.log(`  (dry-run) agregá --apply para calcular los sha256 faltantes y regenerar los manifest.json.\n`);
    return;
  }

  const r2 = R2.fromEnv();

  for (const m of missing) {
    if (!m.url.startsWith(ctx.config.baseUrl)) {
      console.error(`    ✗ ${m.pkgId}@${m.version}: url fuera de origen (${m.url}), no se puede bajar`);
      continue;
    }
    const key = m.url.slice(ctx.config.baseUrl.length);
    const bytes = await r2.getBytes(key);
    const hash = sha256(bytes);
    ctx.registry[m.pkgId]![m.version]!.sha256 = hash;
    console.log(`    ✓ ${m.pkgId}@${m.version}  sha256=${hash.slice(0, 12)}…`);
  }
  if (missing.length) {
    await writeRemoteRegistry(r2, ctx.registry);
    console.log(`\n  ✓ registry actualizado en R2.`);
  }

  for (const channel of channels) {
    const state = ctx.lock.channels[channel]!;
    const manifest = buildManifest(ctx.config, state, ctx.registry);
    const errors = validateManifest(manifest, ctx.config.baseUrl);
    if (errors.length) {
      console.error(`\n  ✗ manifest de "${channel}" inválido:\n` + errors.map((e) => "      - " + e).join("\n") + "\n");
      process.exit(1);
    }
    await r2.putManifest(manifestKey(channel), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`    ✓ ${channel}/manifest.json regenerado (${manifest.packages.length} paquetes)`);
  }

  console.log(`\n  ✓ listo.\n`);
}
