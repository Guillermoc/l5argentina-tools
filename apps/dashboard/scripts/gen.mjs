// Genera src/generated/companion.ts a partir de apps/companion (config + lock).
// Lo corre `npm run gen` (y los hooks predev/prebuild) para que el dashboard y la
// Pages Function compartan exactamente el estado declarado en git.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const companionDir = join(here, "..", "..", "companion");
const outDir = join(here, "..", "src", "generated");

const config = readFileSync(join(companionDir, "app.config.json"), "utf8").trim();
const lock = readFileSync(join(companionDir, "channels.lock.json"), "utf8").trim();

const out = `// AUTO-GENERADO por scripts/gen.mjs desde apps/companion — NO editar a mano.
import type { AppConfig, ExpectedLock } from "../types";

export const appConfig: AppConfig = ${config};

export const expectedLock: ExpectedLock = ${lock};
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "companion.ts"), out, "utf8");
console.log("✓ src/generated/companion.ts");
