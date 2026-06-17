import type {
  AppConfig,
  ChannelStatus,
  Manifest,
  ManifestEntry,
  PackageHealth,
  PackageStatus,
  StatusResponse,
} from "../types";

type Cfg = Pick<AppConfig, "baseUrl" | "channels">;

/**
 * Baja los manifests de todos los canales en vivo y chequea la salud de cada
 * paquete. Usa solo `fetch`, así corre igual en Node, en el dev server de Vite
 * y en la Pages Function de Cloudflare.
 */
export async function fetchStatus(config: Cfg): Promise<StatusResponse> {
  const channels = await Promise.all(
    config.channels.map((c) => fetchChannel(config, c)),
  );
  return {
    fetchedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    channels,
  };
}

async function fetchChannel(config: Cfg, channel: string): Promise<ChannelStatus> {
  const url = `${config.baseUrl}${channel}/manifest.json`;
  try {
    const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) {
      return { channel, ok: false, error: `HTTP ${res.status}`, packages: [] };
    }
    const manifest = (await res.json()) as Manifest;
    const packages = await Promise.all(
      manifest.packages.map((p) => withHealth(config, p)),
    );
    return { channel, ok: true, packages };
  } catch (err) {
    return { channel, ok: false, error: (err as Error).message, packages: [] };
  }
}

async function withHealth(config: Cfg, p: ManifestEntry): Promise<PackageStatus> {
  const sameOrigin = p.url.startsWith(config.baseUrl);
  try {
    const head = await fetch(p.url, { method: "HEAD" });
    const len = Number(head.headers.get("content-length"));
    const actualSize = Number.isFinite(len) ? len : undefined;
    const sizeMatches = actualSize === undefined ? undefined : actualSize === p.sizeBytes;
    const reachable = head.ok;
    let level: PackageHealth["level"];
    if (!reachable || !sameOrigin) level = "error";
    else if (sizeMatches === false) level = "warn";
    else level = "ok";
    const health: PackageHealth = {
      level,
      reachable,
      sameOrigin,
      httpStatus: head.status,
      actualSize,
      sizeMatches,
    };
    return { ...p, health };
  } catch (err) {
    return {
      ...p,
      health: { level: "error", reachable: false, sameOrigin, error: (err as Error).message },
    };
  }
}
