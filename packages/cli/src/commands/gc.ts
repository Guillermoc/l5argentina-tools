import { R2 } from "@l5a/core";
import { loadContext } from "../context";

/**
 * Recolecta basura del pool: lista los blobs bajo el prefijo del pool y borra
 * los que NINGÚN canal referencia (según lock + registry). Dry-run por defecto.
 */
export async function gcCommand(app: string, opts: { apply?: boolean }): Promise<void> {
  const ctx = await loadContext(app);

  // claves del pool referenciadas por algún canal
  const referenced = new Set<string>();
  for (const channel of Object.keys(ctx.lock.channels)) {
    const state = ctx.lock.channels[channel]!;
    for (const [id, version] of Object.entries(state)) {
      const entry = ctx.registry[id]?.[version];
      if (!entry) continue;
      if (entry.url.startsWith(ctx.config.baseUrl)) {
        const key = entry.url.slice(ctx.config.baseUrl.length);
        if (key.startsWith(ctx.config.poolPrefix + "/")) referenced.add(key);
      }
    }
  }

  const r2 = R2.fromEnv();
  const listed = await r2.list(ctx.config.poolPrefix + "/");
  const orphans = listed.filter((k) => !referenced.has(k));

  console.log(`\ngc · app "${app}"  (pool: ${ctx.config.poolPrefix}/)\n`);
  console.log(`  ${listed.length} blob(s) en el pool, ${referenced.size} referenciado(s), ${orphans.length} huérfano(s)\n`);
  for (const k of orphans) console.log(`  ${opts.apply ? "borrando" : "huérfano"}: ${k}`);

  if (orphans.length === 0) {
    console.log(`  nada para limpiar.\n`);
    return;
  }
  if (!opts.apply) {
    console.log(`\n  (dry-run) volvé a correr con --apply para borrar.\n`);
    return;
  }
  await r2.deleteMany(orphans);
  console.log(`\n  ✓ ${orphans.length} blob(s) borrados.\n`);
}
