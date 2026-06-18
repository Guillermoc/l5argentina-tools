import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  loadConfig,
  readVersions,
  readRemoteState,
  type AppConfig,
  type Lock,
  type Registry,
  type Versions,
} from "@l5a/core";

export interface Ctx {
  app: string;
  repoRoot: string;
  appDir: string;
  paths: {
    config: string;
    versions: string;
    dist: string;
  };
  config: AppConfig;
  versions: Versions;
  /** Estado leído de R2 (_state/). registry + lock viven en el bucket, no en git. */
  lock: Lock;
  registry: Registry;
}

/**
 * Carga config + versions (locales, git) y el estado (registry + lock) desde R2
 * (público, sin credenciales). El repoRoot es el cwd.
 */
export async function loadContext(app: string): Promise<Ctx> {
  const repoRoot = process.cwd();
  const appDir = join(repoRoot, "apps", app);
  const paths = {
    config: join(appDir, "app.config.json"),
    versions: join(appDir, "versions.json"),
    dist: join(appDir, "dist"),
  };
  if (!existsSync(paths.config)) {
    throw new Error(
      `no encuentro ${paths.config}. ¿Estás corriendo el comando desde la raíz del repo y existe la app "${app}"?`,
    );
  }
  const config = loadConfig(paths.config);
  const { registry, lock } = await readRemoteState(config.baseUrl, app);
  return {
    app,
    repoRoot,
    appDir,
    paths,
    config,
    versions: readVersions(paths.versions),
    lock,
    registry,
  };
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return "?";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
