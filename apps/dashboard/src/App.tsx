import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChannelStatus, PackageStatus, StatusResponse } from "./types";
import { appConfig, expectedLock } from "./generated/companion";
import { fmtBytes, timeAgo, compareVersions } from "./lib/format";

type LiveIndex = Record<string, Record<string, PackageStatus>>;

function indexLive(data: StatusResponse | null) {
  const live: LiveIndex = {};
  const meta: Record<string, ChannelStatus> = {};
  for (const ch of data?.channels ?? []) {
    meta[ch.channel] = ch;
    live[ch.channel] = {};
    for (const p of ch.packages) live[ch.channel][p.id] = p;
  }
  return { live, meta };
}

function Dot({ color, title }: { color: string; title: string }) {
  return (
    <span
      title={title}
      className="inline-block size-2 rounded-full align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

function Chip({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone: "amber" | "rose" | "slate" | "sky";
  title?: string;
}) {
  const tones = {
    amber: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
    rose: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
    slate: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
    sky: "bg-sky-400/15 text-sky-300 ring-sky-400/30",
  } as const;
  return (
    <span
      title={title}
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export default function App() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`/api/status → HTTP ${res.status}`);
      setData((await res.json()) as StatusResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const channels = appConfig.channels;
  const { live, meta } = useMemo(() => indexLive(data), [data]);

  const rows = useMemo(() => {
    const ids = appConfig.packages.map((p) => p.id);
    const known = new Set(ids);
    for (const ch of data?.channels ?? [])
      for (const p of ch.packages)
        if (!known.has(p.id)) {
          known.add(p.id);
          ids.push(p.id);
        }
    const typeById = new Map(appConfig.packages.map((p) => [p.id, p.type]));
    return ids.map((id) => ({ id, type: typeById.get(id) ?? "?" }));
  }, [data]);

  /** Versión disponible en el canal anterior (upstream) si es mayor a la de este
   *  canal → hay algo para promover. Pipeline: debug → staging → production. */
  const promotableVersion = (ci: number, id: string): string | null => {
    const upstream = ci > 0 ? channels[ci - 1] : undefined;
    if (!upstream) return null;
    const here = live[channels[ci]!]?.[id];
    const up = live[upstream]?.[id];
    if (here && up && compareVersions(up.version, here.version) > 0) return up.version;
    return null;
  };

  const { driftCount, errorCount, warnCount, channelErrors, promoteCount } = useMemo(() => {
    let driftCount = 0;
    let errorCount = 0;
    let warnCount = 0;
    let channelErrors = 0;
    let promoteCount = 0;
    channels.forEach((ch, ci) => {
      if (meta[ch] && !meta[ch].ok) channelErrors++;
      const upstream = ci > 0 ? channels[ci - 1] : undefined;
      for (const row of rows) {
        const entry = live[ch]?.[row.id];
        const expected = expectedLock.channels[ch]?.[row.id];
        if (expected != null && entry && entry.version !== expected) driftCount++;
        if (entry?.health.level === "error") errorCount++;
        else if (entry?.health.level === "warn") warnCount++;
        const up = upstream ? live[upstream]?.[row.id] : undefined;
        if (entry && up && compareVersions(up.version, entry.version) > 0) promoteCount++;
      }
    });
    return { driftCount, errorCount, warnCount, channelErrors, promoteCount };
  }, [channels, rows, live, meta]);

  const allGood =
    !error && !loading && channelErrors === 0 && driftCount === 0 && errorCount === 0 && warnCount === 0;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">
            L5Argentina · Estado de canales
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{appConfig.baseUrl}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {data ? `actualizado ${timeAgo(data.fetchedAt)}` : loading ? "cargando…" : ""}
          </span>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </header>

      {/* resumen */}
      <div className="mb-5 flex flex-wrap gap-2">
        {error ? (
          <span className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-sm text-rose-300 ring-1 ring-rose-500/30">
            Error al cargar: {error}
          </span>
        ) : (
          <>
            {channelErrors > 0 && (
              <span className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-sm text-rose-300 ring-1 ring-rose-500/30">
                {channelErrors} canal(es) sin manifest
              </span>
            )}
            {driftCount > 0 && (
              <span className="rounded-lg bg-amber-400/15 px-3 py-1.5 text-sm text-amber-300 ring-1 ring-amber-400/30">
                {driftCount} con drift vs. git
              </span>
            )}
            {errorCount > 0 && (
              <span className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-sm text-rose-300 ring-1 ring-rose-500/30">
                {errorCount} archivo(s) rotos
              </span>
            )}
            {warnCount > 0 && (
              <span className="rounded-lg bg-amber-400/15 px-3 py-1.5 text-sm text-amber-300 ring-1 ring-amber-400/30">
                {warnCount} con tamaño distinto al declarado
              </span>
            )}
            {promoteCount > 0 && (
              <span className="rounded-lg bg-sky-400/15 px-3 py-1.5 text-sm text-sky-300 ring-1 ring-sky-400/30">
                ↑ {promoteCount} para promover
              </span>
            )}
            {allGood && promoteCount === 0 && (
              <span className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-300 ring-1 ring-emerald-500/30">
                ✓ Todo sano — sin drift, errores ni pendientes
              </span>
            )}
            {loading && !data && (
              <span className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300">
                Cargando estado…
              </span>
            )}
          </>
        )}
      </div>

      {/* matriz */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Paquete</th>
              {channels.map((ch) => (
                <th key={ch} className="px-4 py-3 text-left font-medium text-slate-300">
                  <span className="flex items-center gap-2">
                    {ch}
                    {meta[ch] && !meta[ch].ok ? (
                      <Dot color="#fb7185" title={`manifest no disponible: ${meta[ch].error ?? ""}`} />
                    ) : meta[ch] ? (
                      <Dot color="#34d399" title="manifest OK" />
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-800/70 hover:bg-slate-800/20">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-200">{row.id}</div>
                  <div className="text-xs text-slate-500">{row.type}</div>
                </td>
                {channels.map((ch, ci) => {
                  const entry = live[ch]?.[row.id];
                  const expected = expectedLock.channels[ch]?.[row.id];
                  const chOk = meta[ch]?.ok ?? false;

                  if (!chOk) {
                    return (
                      <td key={ch} className="px-4 py-2.5 text-slate-600">
                        —
                      </td>
                    );
                  }
                  if (!entry) {
                    return (
                      <td key={ch} className="px-4 py-2.5">
                        {expected != null ? (
                          <Chip tone="rose">falta (esperaba {expected})</Chip>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    );
                  }
                  const drift = expected != null && entry.version !== expected;
                  const h = entry.health;
                  const promo = promotableVersion(ci, row.id);
                  return (
                    <td key={ch} className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Dot
                          color={
                            h.level === "ok" ? "#34d399" : h.level === "warn" ? "#fbbf24" : "#fb7185"
                          }
                          title={
                            h.level === "ok"
                              ? "archivo OK"
                              : h.error
                                ? `error: ${h.error}`
                                : !h.sameOrigin
                                  ? "URL fuera de origen"
                                  : h.sizeMatches === false
                                    ? `tamaño real ${fmtBytes(h.actualSize)} ≠ declarado ${fmtBytes(entry.sizeBytes)}`
                                    : `HTTP ${h.httpStatus ?? "?"}`
                          }
                        />
                        <span className="font-mono text-slate-100">{entry.version}</span>
                        {promo && (
                          <Chip tone="sky" title={`hay ${promo} en ${channels[ci - 1]} para promover acá`}>
                            ↑ {promo}
                          </Chip>
                        )}
                        {drift && <Chip tone="amber">≠ {expected}</Chip>}
                        {h.level === "warn" && <Chip tone="amber">tamaño</Chip>}
                        {h.level === "error" && <Chip tone="rose">roto</Chip>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">{fmtBytes(entry.sizeBytes)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* leyenda */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <Dot color="#34d399" title="" /> archivo existe y coincide
        </span>
        <span className="flex items-center gap-1.5">
          <Dot color="#fb7185" title="" /> archivo con problema
        </span>
        <span className="flex items-center gap-1.5">
          <Chip tone="amber">≠ X</Chip> drift: lo publicado difiere de lo declarado en git
        </span>
        <span className="flex items-center gap-1.5">
          <Chip tone="sky">↑ X</Chip> hay una versión mayor en el canal anterior (para promover)
        </span>
      </div>
    </div>
  );
}
