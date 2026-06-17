// Smoke test: corre la lógica de /api/status contra el bucket REAL.
// Uso: npx tsx apps/dashboard/scripts/smoke.ts   (desde la raíz del repo)
import { fetchStatus } from "../src/lib/status";
import { appConfig } from "../src/generated/companion";

const data = await fetchStatus(appConfig);
for (const ch of data.channels) {
  if (!ch.ok) {
    console.log(`✗ ${ch.channel}: ${ch.error}`);
    continue;
  }
  const errors = ch.packages.filter((p) => p.health.level === "error");
  const warns = ch.packages.filter((p) => p.health.level === "warn");
  console.log(
    `${ch.channel}: ${ch.packages.length} paquetes · ${errors.length} rotos · ${warns.length} tamaño-distinto`,
  );
  for (const e of errors) console.log(`    ✗ ${e.id} → ${e.health.error ?? "HTTP " + e.health.httpStatus}`);
  for (const w of warns)
    console.log(`    ⚠ ${w.id} → real ${w.health.actualSize} ≠ declarado ${w.sizeBytes}`);
}
console.log(`\nfetchedAt: ${data.fetchedAt}`);
