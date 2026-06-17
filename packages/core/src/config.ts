import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AppConfig } from "./types";

const PackageDefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["filters", "database", "rules", "images", "changelog"]),
  source: z.string().min(1),
});

const AppConfigSchema = z.object({
  app: z.string().min(1),
  baseUrl: z.string().url(),
  poolPrefix: z.string().min(1).default("pool"),
  channels: z.array(z.string().min(1)).min(1),
  packages: z.array(PackageDefSchema).min(1),
});

export function loadConfig(path: string): AppConfig {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const cfg = AppConfigSchema.parse(raw);
  // normalizar baseUrl para que siempre termine en "/"
  if (!cfg.baseUrl.endsWith("/")) cfg.baseUrl += "/";
  // ids únicos
  const ids = new Set<string>();
  for (const p of cfg.packages) {
    if (ids.has(p.id)) throw new Error(`paquete duplicado en config: ${p.id}`);
    ids.add(p.id);
  }
  return cfg;
}
