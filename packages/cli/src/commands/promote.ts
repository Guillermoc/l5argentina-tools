import { writeRemoteLock, buildManifest, validateManifest, manifestKey, R2 } from "@l5a/core";
import { loadContext } from "../context";

interface PromoteOpts {
  only?: string;
  dryRun?: boolean;
}

/**
 * Promueve versiones de un canal a otro (debug → staging → production).
 * Como el pool es compartido, NO copia bytes: solo apunta el manifest del canal
 * destino a las mismas versiones (mismos blobs, mismo sha256) y actualiza el lock.
 */
export async function promoteCommand(
  app: string,
  from: string,
  to: string,
  opts: PromoteOpts,
): Promise<void> {
  const ctx = await loadContext(app);
  for (const c of [from, to]) {
    if (!ctx.config.channels.includes(c)) {
      throw new Error(`canal desconocido: ${c}. Válidos: ${ctx.config.channels.join(", ")}`);
    }
  }
  const fromState = ctx.lock.channels[from] ?? {};
  const toState = { ...(ctx.lock.channels[to] ?? {}) };

  const onlyIds = opts.only ? opts.only.split(",").map((s) => s.trim()) : null;
  const ids = ctx.config.packages
    .map((p) => p.id)
    .filter((id) => (onlyIds ? onlyIds.includes(id) : true));

  const changes: { id: string; from: string; to: string }[] = [];
  for (const id of ids) {
    const v = fromState[id];
    if (!v) continue;
    if (toState[id] !== v) {
      changes.push({ id, from: toState[id] ?? "—", to: v });
      toState[id] = v;
    }
  }

  console.log(`\npromote · app "${app}"  ${from} → ${to}${opts.dryRun ? " (dry-run)" : ""}\n`);
  if (changes.length === 0) {
    console.log(`  nada para promover: "${to}" ya coincide con "${from}".\n`);
    return;
  }
  for (const c of changes) console.log(`  ${c.id.padEnd(12)} ${c.from}  →  ${c.to}`);

  // verificar que cada versión a promover exista en el registry (para regenerar el manifest)
  const missing = changes.filter((c) => !ctx.registry[c.id]?.[c.to]);
  if (missing.length) {
    console.error(
      `\n  ✗ estas versiones no están en el registry (publicá/adoptá primero): ` +
        missing.map((m) => `${m.id}@${m.to}`).join(", ") + "\n",
    );
    process.exit(1);
  }

  const manifest = buildManifest(ctx.config, toState, ctx.registry);
  const errors = validateManifest(manifest, ctx.config.baseUrl);
  if (errors.length) {
    console.error("\n  ✗ manifest inválido:\n" + errors.map((e) => "      - " + e).join("\n"));
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(`\n  (dry-run) se reescribiría ${to}/manifest.json con ${manifest.packages.length} paquetes. Sin copiar bytes.\n`);
    return;
  }

  const r2 = R2.fromEnv();
  await r2.putManifest(manifestKey(to), JSON.stringify(manifest, null, 2) + "\n");
  ctx.lock.channels[to] = toState;
  await writeRemoteLock(r2, ctx.lock);

  console.log(`\n  ✓ promovido. ${to}/manifest.json + estado (_state/) actualizados (0 bytes copiados).\n`);
}
