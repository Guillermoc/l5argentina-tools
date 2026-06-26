import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InboxItem, InboxListResponse } from "../types";
import { fmtBytes, timeAgo } from "../lib/format";

async function postInbox(body: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch("/api/inbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data?.error, data };
}

export default function Inbox({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<InboxListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inbox");
      const data = (await res.json()) as InboxListResponse;
      setState(data);
      setVersions((prev) => {
        const next = { ...prev };
        for (const it of data.items ?? []) if (next[it.key] == null) next[it.key] = it.suggestedVersion;
        return next;
      });
    } catch (e) {
      setState({ items: [], hasCreds: true, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const send = useCallback(
    async (item: InboxItem) => {
      const version = (versions[item.key] ?? item.suggestedVersion).trim();
      const plan = await postInbox({ op: "send", key: item.key, version, apply: false });
      if (!plan.ok) {
        window.alert(`No se puede enviar: ${plan.data.error ?? "error"}`);
        return;
      }
      const p = plan.data;
      const msg =
        `Enviar "${item.pkgId}" a debug\n\n` +
        `versión: ${p.from ?? "—"} → ${p.to}\n` +
        `${fmtBytes(p.sizeBytes)} → ${p.poolKey}\n\n¿Confirmás?`;
      if (!window.confirm(msg)) return;
      setBusy(item.key);
      const out = await postInbox({ op: "send", key: item.key, version, apply: true });
      setBusy(null);
      if (!out.ok) {
        window.alert(`Error al enviar: ${out.data.error ?? "error"}`);
        return;
      }
      await reload();
      onChanged?.();
    },
    [versions, reload, onChanged],
  );

  const discard = useCallback(
    async (item: InboxItem) => {
      if (!window.confirm(`¿Descartar "${item.pkgId}" del buzón? (no toca lo ya publicado)`)) return;
      setBusy(item.key);
      const out = await postInbox({ op: "discard", key: item.key });
      setBusy(null);
      if (!out.ok) window.alert(`Error: ${out.data.error ?? "error"}`);
      else await reload();
    },
    [reload],
  );

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Buzón → debug</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Adjuntá un archivo, revisá la versión y envialo a debug.
          </p>
        </div>
        <button
          onClick={() => void reload()}
          disabled={loading}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {state && !state.hasCreds ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          Para usar el buzón hay que configurar las credenciales R2 (env vars <code>R2_*</code> en el
          proyecto de Pages, o el <code>.env</code> de la raíz en dev).
        </div>
      ) : (
        <>
          <FileUploader onUploaded={reload} />
          <InboxList
            items={state?.items ?? []}
            loading={loading}
            error={state?.error}
            busy={busy}
            versions={versions}
            setVersion={(key, v) => setVersions((s) => ({ ...s, [key]: v }))}
            onSend={send}
            onDiscard={discard}
          />
        </>
      )}
    </section>
  );
}

function FileUploader({ onUploaded }: { onUploaded: () => void | Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "x-l5a-filename": encodeURIComponent(file.name) },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        window.alert(`No se pudo subir: ${data.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await onUploaded();
    } catch (e) {
      window.alert(`Error de red al subir: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [file, onUploaded]);

  return (
    <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-200 hover:file:cursor-pointer hover:file:bg-slate-700"
        />
        <button
          onClick={() => void upload()}
          disabled={!file || busy}
          className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {busy ? "Subiendo…" : "Subir al buzón"}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        El nombre define el paquete y la versión:{" "}
        <code className="text-slate-400">&lt;paquete&gt;-&lt;X.Y.Z&gt;.&lt;ext&gt;</code> (p. ej.{" "}
        <code className="text-slate-400">cards_db-2.3.0.zip</code>). Si omitís la versión, se sugiere
        una. Para archivos muy grandes, usá <code className="text-slate-400">l5a inbox put</code>.
      </p>
    </div>
  );
}

function InboxList({
  items,
  loading,
  error,
  busy,
  versions,
  setVersion,
  onSend,
  onDiscard,
}: {
  items: InboxItem[];
  loading: boolean;
  error?: string;
  busy: string | null;
  versions: Record<string, string>;
  setVersion: (key: string, v: string) => void;
  onSend: (item: InboxItem) => void;
  onDiscard: (item: InboxItem) => void;
}) {
  const sorted = useMemo(() => items, [items]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
        Error al leer el buzón: {error}
      </div>
    );
  }
  if (!loading && sorted.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
        El buzón está vacío. Adjuntá un archivo arriba (nombrado{" "}
        <code className="text-slate-400">&lt;paquete&gt;-&lt;X.Y.Z&gt;.&lt;ext&gt;</code>) para
        empezar.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/80">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Archivo</th>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Tamaño</th>
            <th className="px-4 py-3 text-left font-medium text-slate-400">En debug</th>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Nueva versión</th>
            <th className="px-4 py-3 text-right font-medium text-slate-400">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((it) => (
            <tr key={it.key} className="border-t border-slate-800/70 hover:bg-slate-800/20">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-200">{it.pkgId}</span>
                  {!it.known && (
                    <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-medium text-rose-300 ring-1 ring-rose-500/30">
                      desconocido
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {it.type ?? "?"} · .{it.ext} · {timeAgo(it.lastModified)}
                </div>
              </td>
              <td className="px-4 py-2.5 text-slate-300">{fmtBytes(it.sizeBytes)}</td>
              <td className="px-4 py-2.5 font-mono text-slate-400">{it.currentDebug ?? "—"}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <input
                    value={versions[it.key] ?? it.suggestedVersion}
                    onChange={(e) => setVersion(it.key, e.target.value)}
                    disabled={!it.known}
                    className="w-24 rounded-lg bg-slate-800 px-2 py-1 font-mono text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500 disabled:opacity-50"
                  />
                </div>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => onSend(it)}
                    disabled={!it.known || busy === it.key}
                    title={it.known ? "publicar en debug" : "paquete desconocido: no se puede enviar"}
                    className="rounded-lg bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-300 ring-1 ring-sky-400/30 transition hover:bg-sky-500/25 disabled:opacity-50"
                  >
                    {busy === it.key ? "Enviando…" : "Enviar a debug ↓"}
                  </button>
                  <button
                    onClick={() => onDiscard(it)}
                    disabled={busy === it.key}
                    className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-50"
                  >
                    Descartar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
