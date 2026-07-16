// Genera src/generated/companion.ts a partir de apps/companion/app.config.json
// (la lista/orden de paquetes + baseUrl). El estado (lock/registry) NO se empaqueta:
// el dashboard lo lee EN VIVO de _state/ en R2. Lo corren los hooks predev/prebuild.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const companionDir = join(here, "..", "..", "companion");
const outDir = join(here, "..", "src", "generated");
const reviewsDir = join(here, "..", "public", "reviews");

const config = readFileSync(join(companionDir, "app.config.json"), "utf8").trim();

const out = `// AUTO-GENERADO por scripts/gen.mjs desde apps/companion/app.config.json — NO editar a mano.
import type { AppConfig } from "../types";

export const appConfig: AppConfig = ${config};
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "companion.ts"), out, "utf8");
console.log("✓ src/generated/companion.ts");

// Manifest de las páginas estáticas public/reviews/versions-<set>.html (revisión de
// Current, generadas por make-versions-report.mjs en L5Argentina DB Test). Traen sus
// datos embebidos (no salen del bucket), así que reviews/index.html no las puede
// detectar por fetch al índice de tools/reports/: se listan acá en build/dev time.
const VERSIONS_RE = /^versions-(.+)\.html$/;
const files = readdirSync(reviewsDir)
  .map((f) => VERSIONS_RE.exec(f))
  .filter(Boolean)
  .map((m) => ({ set: m[1], file: m[0] }))
  .sort((a, b) => a.set.localeCompare(b.set));

writeFileSync(
  join(reviewsDir, "versions-manifest.json"),
  JSON.stringify({ files, generatedAt: new Date().toISOString() }, null, 1) + "\n",
  "utf8",
);
console.log(`✓ public/reviews/versions-manifest.json (${files.length} set${files.length === 1 ? "" : "s"})`);
