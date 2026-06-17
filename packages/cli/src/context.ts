import { join } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  loadConfig,
  readVersions,
  readLock,
  readRegistry,
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
    lock: string;
    registry: string;
    dist: string;
  };
  config: AppConfig;
  versions: Versions;
  lock: Lock;
  registry: Registry;
}

/** Carga toda la config + estado de una app. El repoRoot es el cwd. */
export function loadContext(app: string): Ctx {
  const repoRoot = process.cwd();
  const appDir = join(repoRoot, "apps", app);
  const paths = {
    config: join(appDir, "app.config.json"),
    versions: join(appDir, "versions.json"),
    lock: join(appDir, "channels.lock.json"),
    registry: join(appDir, "registry.json"),
    dist: join(appDir, "dist"),
  };
  if (!existsSync(paths.config)) {
    throw new Error(
      `no encuentro ${paths.config}. ¿Estás corriendo el comando desde la raíz del repo y existe la app "${app}"?`,
    );
  }
  return {
    app,
    repoRoot,
    appDir,
    paths,
    config: loadConfig(paths.config),
    versions: readVersions(paths.versions),
    lock: readLock(paths.lock),
    registry: readRegistry(paths.registry),
  };
}

/**
 * Commitea y pushea SOLO los archivos de estado de la app (config, versions,
 * lock, registry). Se usa tras un --apply para mantener git y el dashboard en
 * sync. Nunca tira el comando: si git falla, avisa (el bucket ya está actualizado).
 */
export function commitState(ctx: Ctx, message: string): void {
  const files = [ctx.paths.config, ctx.paths.versions, ctx.paths.lock, ctx.paths.registry];
  const git = (args: string[]) => execFileSync("git", args, { cwd: ctx.repoRoot, encoding: "utf8" });
  try {
    git(["add", ...files]);
    if (!git(["diff", "--cached", "--name-only"]).trim()) {
      console.log("  (git) sin cambios de estado para commitear");
      return;
    }
    git(["commit", "-m", message]);
    console.log("  ✓ git commit del estado");
    git(["push"]);
    console.log("  ✓ git push — el dashboard se redeploya solo");
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr || e.message || String(err)).trim();
    console.error(`  ⚠ el commit/push de git falló (el bucket YA quedó actualizado): ${detail}`);
  }
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
