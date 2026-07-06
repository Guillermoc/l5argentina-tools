import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LauncherInboxItem,
  LauncherPublishResult,
  LauncherSlotStatus,
  LauncherStatusResponse,
} from "../types";
import { fmtBytes, timeAgo } from "../lib/format";

async function postLauncher(body: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch("/api/launcher", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data?.error, data };
}

function Dot({ level }: { level: LauncherSlotStatus["health"]["level"] }) {
  const color = level === "ok" ? "#34d399" : level === "warn" ? "#fbbf24" : "#fb7185";
  return <span className="inline-block size-2 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

export default function Launcher() {
  const [state, setState] = useState<LauncherStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/launcher");
      const data = (await res.json()) as LauncherStatusResponse;
      setState(data);
      setVersions((prev) => {
        const next = { ...prev };
        for (const it of data.inbox ?? []) if (next[it.key] == null) next[it.key] = it.suggestedVersion;
        return next;
      });
    } catch (e) {
      setState({
        fetchedAt: new Date().toISOString(),
        baseUrl: "",
        hasCreds: true,
        ok: false,
        error: (e as Error).message,
        launcher: { latest_version: "—", notes: "" },
        slots: [],
        inbox: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const publish = useCallback(
    async (item: LauncherInboxItem) => {
      if (!item.slot) return;
      const version = (versions[item.key] ?? item.suggestedVersion).trim();
      const plan = await postLauncher({ op: "publish", key: item.key, slot: item.slot, version, apply: false });
      if (!plan.ok) {
        window.alert(`No se puede publicar: ${plan.data.error ?? "error"}`);
        return;
      }
      const p = plan.data as LauncherPublishResult;
      const msg =
        `Publicar "${item.file}" en ${item.slot}\n\n` +
        `versión: ${p.from ?? "—"} → ${p.to}\n` +
        `archivo: ${p.file} (${fmtBytes(p.sizeBytes)})\n` +
        (p.orphan ? `queda huérfano: ${p.orphan}\n` : "") +
        `\nSe recalcula sha256 y se reescribe sunandmoon/manifest.json.\n\n¿Confirmás?`;
      if (!window.confirm(msg)) return;
      setBusy(item.key);
      const out = await postLauncher({ op: "publish", key: item.key, slot: item.slot, version, apply: true });
      setBusy(null);
      if (!out.ok) {
        window.alert(`Error al publicar: ${out.data.error ?? "error"}`);
        return;
      }
      await reload();
    },
    [versions, reload],
  );

  const discard = useCallback(
    async (item: LauncherInboxItem) => {
      if (!window.confirm(`¿Descartar "${item.file}" del buzón? (no toca lo ya publicado)`)) return;
      setBusy(item.key);
      const out = await postLauncher({ op: "discard", key: item.key });
      setBusy(null);
      if (!out.ok) window.alert(`Error: ${out.data.error ?? "error"}`);
      else await reload();
    },
    [reload],
  );

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Launcher · Sun and Moon</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            App aparte del mismo bucket (<code className="text-slate-400">sunandmoon/</code>). Al
            publicar se recalcula sha256 + tamaño y se reescribe su manifest.
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

      {state && !state.ok && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          No se pudo leer el manifest del launcher: {state.error}
        </div>
      )}

      <LauncherCard state={state} busy={busy} setBusy={setBusy} onSaved={reload} />

      {/* slots (base + imágenes) */}
      <div className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Componente</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Versión</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Archivo</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">Tamaño</th>
              <th className="px-4 py-3 text-left font-medium text-slate-400">sha256</th>
            </tr>
          </thead>
          <tbody>
            {(state?.slots ?? []).map((s) => (
              <tr key={s.slot} className="border-t border-slate-800/70 hover:bg-slate-800/20">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Dot level={s.health.level} />
                    <span className="font-medium text-slate-200">{s.label}</span>
                  </div>
                  <div className="text-xs text-slate-500">{s.slot}</div>
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-100">{s.version}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{s.file}</td>
                <td className="px-4 py-2.5 text-slate-300">
                  {fmtBytes(s.size)}
                  {s.health.sizeMatches === false && (
                    <span className="ml-1.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-400/30">
                      real {fmtBytes(s.health.actualSize)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500" title={s.sha256}>
                  {s.sha256 ? `${s.sha256.slice(0, 12)}…` : "—"}
                </td>
              </tr>
            ))}
            {(!state || state.slots.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                  {loading ? "Cargando…" : "Sin datos del manifest."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* buzón → sunandmoon */}
      <div className="mt-8">
        <h3 className="mb-1 text-base font-semibold text-slate-100">Buzón → sunandmoon</h3>
        <p className="mb-3 text-xs text-slate-500">
          Adjuntá el zip (nombrado{" "}
          <code className="text-slate-400">database-&lt;X.Y.Z&gt;.zip</code> o{" "}
          <code className="text-slate-400">samuraiEx-&lt;X.Y.Z&gt;.zip</code>), revisá la versión y
          publicalo.
        </p>

        {state && !state.hasCreds ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            Para usar el buzón hay que configurar las credenciales R2 (env vars <code>R2_*</code> en el
            proyecto de Pages, o el <code>.env</code> de la raíz en dev). El estado de arriba se lee sin
            credenciales.
          </div>
        ) : (
          <>
            <FileUploader onUploaded={reload} />
            <InboxList
              items={state?.inbox ?? []}
              loading={loading}
              busy={busy}
              versions={versions}
              setVersion={(key, v) => setVersions((s) => ({ ...s, [key]: v }))}
              onPublish={publish}
              onDiscard={discard}
            />
          </>
        )}
      </div>
    </section>
  );
}

function LauncherCard({
  state,
  busy,
  setBusy,
  onSaved,
}: {
  state: LauncherStatusResponse | null;
  busy: string | null;
  setBusy: (v: string | null) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const seeded = useRef<string | null>(null);

  // Sembrar los inputs cuando llega el manifest (una vez por valor cargado).
  useEffect(() => {
    if (!state?.ok) return;
    const key = `${state.launcher.latest_version} ${state.launcher.notes}`;
    if (seeded.current === key) return;
    seeded.current = key;
    setVersion(state.launcher.latest_version);
    setNotes(state.launcher.notes);
  }, [state]);

  const dirty =
    state?.ok === true &&
    (version.trim() !== state.launcher.latest_version || notes.trim() !== state.launcher.notes);

  const save = useCallback(async () => {
    const plan = await postLauncher({ op: "set-launcher", latest_version: version.trim(), notes: notes.trim(), apply: false });
    if (!plan.ok) {
      window.alert(`No se puede guardar: ${plan.data.error ?? "error"}`);
      return;
    }
    const f = plan.data.from;
    if (!window.confirm(`Actualizar el launcher (.exe)\n\nversión: ${f.latest_version} → ${version.trim()}\nnotas: ${notes.trim() || "(vacías)"}\n\n¿Confirmás?`))
      return;
    setBusy("launcher");
    const out = await postLauncher({ op: "set-launcher", latest_version: version.trim(), notes: notes.trim(), apply: true });
    setBusy(null);
    if (!out.ok) window.alert(`Error al guardar: ${out.data.error ?? "error"}`);
    else await onSaved();
  }, [version, notes, setBusy, onSaved]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Launcher (.exe)</h3>
        <span className="text-xs text-slate-500">se publica por GitHub Releases · acá solo la versión</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">latest_version</span>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            disabled={!state?.ok || !state.hasCreds}
            className="w-28 rounded-lg bg-slate-800 px-2 py-1 font-mono text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500 disabled:opacity-50"
          />
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1">
          <span className="text-xs text-slate-500">notes</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!state?.ok || !state.hasCreds}
            className="w-full rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500 disabled:opacity-50"
          />
        </label>
        <button
          onClick={() => void save()}
          disabled={!dirty || !state?.hasCreds || busy === "launcher"}
          className="rounded-lg bg-sky-500/15 px-3 py-1.5 text-sm font-medium text-sky-300 ring-1 ring-sky-400/30 transition hover:bg-sky-500/25 disabled:opacity-50"
        >
          {busy === "launcher" ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
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
        headers: { "x-l5a-filename": encodeURIComponent(file.name), "x-l5a-target": "launcher" },
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
    </div>
  );
}

function InboxList({
  items,
  loading,
  busy,
  versions,
  setVersion,
  onPublish,
  onDiscard,
}: {
  items: LauncherInboxItem[];
  loading: boolean;
  busy: string | null;
  versions: Record<string, string>;
  setVersion: (key: string, v: string) => void;
  onPublish: (item: LauncherInboxItem) => void;
  onDiscard: (item: LauncherInboxItem) => void;
}) {
  if (!loading && items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
        El buzón está vacío. Adjuntá un zip arriba para empezar.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/80">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Archivo</th>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Slot</th>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Tamaño</th>
            <th className="px-4 py-3 text-left font-medium text-slate-400">Versión</th>
            <th className="px-4 py-3 text-right font-medium text-slate-400">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.key} className="border-t border-slate-800/70 hover:bg-slate-800/20">
              <td className="px-4 py-2.5">
                <div className="font-medium text-slate-200">{it.file}</div>
                <div className="text-xs text-slate-500">.{it.ext} · {timeAgo(it.lastModified)}</div>
              </td>
              <td className="px-4 py-2.5">
                {it.slot ? (
                  <span className="text-slate-300">{it.slot}</span>
                ) : (
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-medium text-rose-300 ring-1 ring-rose-500/30">
                    desconocido
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-slate-300">{fmtBytes(it.sizeBytes)}</td>
              <td className="px-4 py-2.5">
                <input
                  value={versions[it.key] ?? it.suggestedVersion}
                  onChange={(e) => setVersion(it.key, e.target.value)}
                  disabled={!it.known}
                  className="w-24 rounded-lg bg-slate-800 px-2 py-1 font-mono text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500 disabled:opacity-50"
                />
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => onPublish(it)}
                    disabled={!it.known || busy === it.key}
                    title={it.known ? "publicar y reconstruir el manifest" : "el nombre no matchea un slot (database- / samuraiEx-)"}
                    className="rounded-lg bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-300 ring-1 ring-sky-400/30 transition hover:bg-sky-500/25 disabled:opacity-50"
                  >
                    {busy === it.key ? "Publicando…" : "Publicar ↑"}
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
