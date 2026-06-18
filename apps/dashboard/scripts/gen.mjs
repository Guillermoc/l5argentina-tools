// Genera src/generated/companion.ts a partir de apps/companion/app.config.json
// (la lista/orden de paquetes + baseUrl). El estado (lock/registry) NO se empaqueta:
// el dashboard lo lee EN VIVO de _state/ en R2. Lo corren los hooks predev/prebuild.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const companionDir = join(here, "..", "..", "companion");
const outDir = join(here, "..", "src", "generated");

const config = readFileSync(join(companionDir, "app.config.json"), "utf8").trim();

const out = `// AUTO-GENERADO por scripts/gen.mjs desde apps/companion/app.config.json — NO editar a mano.
import type { AppConfig } from "../types";

export const appConfig: AppConfig = ${config};
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "companion.ts"), out, "utf8");
console.log("✓ src/generated/companion.ts");
