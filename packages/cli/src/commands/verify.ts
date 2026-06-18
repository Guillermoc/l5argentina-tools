import { loadContext } from "../context";
import type { Manifest } from "@l5a/core";

/**
 * Verifica un canal contra el bucket EN VIVO: baja el manifest publicado y, por
 * cada paquete, chequea que la url sea same-origin, exista (HTTP 200) y que el
 * tamaño coincida con el declarado.
 */
export async function verifyCommand(app: string, opts: { channel?: string }): Promise<void> {
  const ctx = await loadContext(app);
  const channels = opts.channel ? [opts.channel] : ctx.config.channels;
  let failures = 0;

  for (const channel of channels) {
    const manifestUrl = `${ctx.config.baseUrl}${channel}/manifest.json`;
    console.log(`\nverify · ${channel}  (${manifestUrl})\n`);

    let manifest: Manifest;
    try {
      const res = await fetch(manifestUrl, { headers: { "cache-control": "no-cache" } });
      if (!res.ok) {
        console.error(`  ✗ no se pudo bajar el manifest (HTTP ${res.status})`);
        failures++;
        continue;
      }
      manifest = (await res.json()) as Manifest;
    } catch (err) {
      console.error(`  ✗ error bajando el manifest: ${(err as Error).message}`);
      failures++;
      continue;
    }

    for (const p of manifest.packages) {
      const tags: string[] = [];
      let ok = true;
      if (!p.url.startsWith(ctx.config.baseUrl)) {
        tags.push("URL fuera de origen");
        ok = false;
      }
      try {
        const head = await fetch(p.url, { method: "HEAD", headers: { "cache-control": "no-cache" } });
        if (!head.ok) {
          tags.push(`HTTP ${head.status}`);
          ok = false;
        } else {
          const len = Number(head.headers.get("content-length"));
          if (Number.isFinite(len) && len !== p.sizeBytes) {
            tags.push(`size ${len} ≠ ${p.sizeBytes}`);
            ok = false;
          }
        }
      } catch (err) {
        tags.push(`fetch: ${(err as Error).message}`);
        ok = false;
      }
      if (!ok) failures++;
      console.log(`  ${ok ? "✓" : "✗"} ${p.id.padEnd(12)} ${p.version.padEnd(8)} ${tags.join(", ")}`);
    }
  }

  console.log("");
  if (failures > 0) {
    console.error(`  ✗ ${failures} problema(s) encontrados.\n`);
    process.exit(1);
  }
  console.log(`  ✓ todo OK.\n`);
}
