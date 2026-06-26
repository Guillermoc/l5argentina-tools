import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Rule, RulesEmitResult, RulesListResponse } from "../types";
import { appConfig } from "../generated/companion";

type Filter = "all" | "banned" | "note" | "label";

const EMPTY: Rule = {
  title: "",
  maxCopies: null,
  banned: false,
  preferredPrinting: null,
  note: null,
  label: null,
  highlight: null,
};

async function postRules(path: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data?.error, data };
}

export default function Rules() {
  const [state, setState] = useState<RulesListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [titles, setTitles] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<Rule>(EMPTY);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rules");
      setState((await res.json()) as RulesListResponse);
    } catch (e) {
      setState({ rules: [], hasCreds: true, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // índice de nombres de carta para validar/autocompletar (best-effort)
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(appConfig.baseUrl + "_state/card-titles.json", { cache: "no-cache" });
        if (!res.ok) return;
        const doc = (await res.json()) as { titles: string[] };
        setTitles(new Set(doc.titles ?? []));
      } catch {
        /* sin índice: validación blanda */
      }
    })();
  }, []);

  const rules = state?.rules ?? [];
  const byTitle = useMemo(() => new Set(rules.map((r) => r.title)), [rules]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (q && !r.title.toLowerCase().includes(q)) return false;
      if (filter === "banned") return r.banned;
      if (filter === "note") return Boolean(r.note);
      if (filter === "label") return Boolean(r.label?.text);
      return true;
    });
  }, [rules, search, filter]);

  const titleKnown = titles == null ? null : draft.title.trim() === "" ? null : titles.has(draft.title.trim());
  const isEditing = editingTitle != null;
  const isDuplicate = !isEditing && draft.title.trim() !== "" && byTitle.has(draft.title.trim());

  const startEdit = (r: Rule) => {
    setDraft({ ...r });
    setEditingTitle(r.title);
  };
  const resetForm = () => {
    setDraft(EMPTY);
    setEditingTitle(null);
  };

  const save = useCallback(async () => {
    if (!draft.title.trim()) return;
    setBusy(true);
    const out = await postRules("/api/rules", {
      op: "upsert",
      rule: draft,
      requireNew: !isEditing,
    });
    setBusy(false);
    if (!out.ok) {
      window.alert(`No se pudo guardar: ${out.data.error ?? "error"}`);
      return;
    }
    resetForm();
    await load();
  }, [draft, isEditing, load]);

  const remove = useCallback(
    async (r: Rule) => {
      if (!window.confirm(`¿Borrar la regla de "${r.title}"?`)) return;
      setBusy(true);
      const out = await postRules("/api/rules", { op: "delete", title: r.title });
      setBusy(false);
      if (!out.ok) {
        window.alert(`Error: ${out.data.error ?? "error"}`);
        return;
      }
      if (editingTitle === r.title) resetForm();
      await load();
    },
    [editingTitle, load],
  );

  const importFile = useCallback(
    async (file: File) => {
      let parsed: { rules?: unknown };
      try {
        let text = await file.text();
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
        parsed = JSON.parse(text);
      } catch {
        window.alert("El archivo no es un JSON válido.");
        return;
      }
      const incoming = Array.isArray(parsed.rules) ? (parsed.rules as Rule[]) : null;
      if (!incoming) {
        window.alert('El JSON tiene que tener la forma { "rules": [ … ] }.');
        return;
      }
      if (!window.confirm(`Importar ${incoming.length} reglas de "${file.name}"?\n\nLas cartas que ya existan se sobrescriben (upsert por título).`))
        return;
      setBusy(true);
      const out = await postRules("/api/rules", { op: "import", rules: incoming });
      setBusy(false);
      if (!out.ok) {
        window.alert(`No se pudo importar: ${out.data.error ?? "error"}`);
        return;
      }
      const d = out.data;
      window.alert(`Importadas ${d.imported} reglas (dedupe: ${d.deduped}, inválidas: ${d.invalid}).`);
      await load();
    },
    [load],
  );

  const importFromDebug = useCallback(async () => {
    if (
      !window.confirm(
        "Importar las reglas publicadas en debug a tu editor?\n\nLas cartas que ya tengas cargadas se sobrescriben con lo de debug (upsert por título).",
      )
    )
      return;
    setBusy(true);
    const out = await postRules("/api/rules/import-channel", { channel: "debug" });
    setBusy(false);
    if (!out.ok) {
      window.alert(`No se pudo importar: ${out.data.error ?? "error"}`);
      return;
    }
    const d = out.data;
    window.alert(`Importadas ${d.imported} reglas de ${d.source ?? "debug"} (dedupe: ${d.deduped}, inválidas: ${d.invalid}).`);
    await load();
  }, [load]);

  const refreshTitles = useCallback(async () => {
    if (!window.confirm("Regenerar el índice de nombres desde el cards_db que hay en debug?")) return;
    setBusy(true);
    const out = await postRules("/api/rules/refresh-titles", {});
    setBusy(false);
    if (!out.ok) {
      window.alert(`No se pudo regenerar: ${out.data.error ?? "error"}`);
      return;
    }
    window.alert(`Índice regenerado: ${out.data.count} cartas.`);
    try {
      const res = await fetch(appConfig.baseUrl + "_state/card-titles.json", { cache: "no-cache" });
      if (res.ok) setTitles(new Set(((await res.json()) as { titles: string[] }).titles ?? []));
    } catch {
      /* ignore */
    }
  }, []);

  const emit = useCallback(async () => {
    const version = window.prompt(
      `Emitir versión de reglas al buzón (${rules.length} reglas).\nNúmero de versión (ej. 2.1.2):`,
    );
    if (!version) return;
    const plan = await postRules("/api/rules/emit", { version, apply: false });
    if (!plan.ok) {
      window.alert(`No se puede emitir: ${plan.data.error ?? "error"}`);
      return;
    }
    const p = plan.data as RulesEmitResult;
    if (!window.confirm(`Generar ${p.key}\n\n${p.count} reglas · ${p.sizeBytes} bytes\n\nSe sube al buzón. ¿Confirmás?`))
      return;
    setBusy(true);
    const out = await postRules("/api/rules/emit", { version, apply: true });
    setBusy(false);
    if (!out.ok) {
      window.alert(`Error al emitir: ${out.data.error ?? "error"}`);
      return;
    }
    window.alert(`Listo: ${out.data.key} en el buzón. Andá a "Canales → Buzón" para enviarlo a debug.`);
  }, [rules.length]);

  if (state && !state.hasCreds) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
        Para el editor de reglas hay que configurar las credenciales D1 (<code>D1_DATABASE_ID</code> y{" "}
        <code>D1_API_TOKEN</code> en el proyecto de Pages, o en el <code>.env</code> de la raíz en dev).
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Reglas</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {rules.length} regla(s){titles ? ` · ${titles.size} cartas en el índice` : " · índice de cartas no disponible"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <button
            onClick={() => void importFromDebug()}
            disabled={busy}
            title="importar el rules-*.json publicado en debug"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-50"
          >
            Importar de debug
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="importar reglas desde un archivo rules-*.json"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-50"
          >
            Importar JSON
          </button>
          <button
            onClick={() => void refreshTitles()}
            disabled={busy}
            title="regenera _state/card-titles.json desde el cards_db en debug"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-700 disabled:opacity-50"
          >
            Refrescar índice
          </button>
          <button
            onClick={() => void emit()}
            disabled={busy || rules.length === 0}
            className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25 disabled:opacity-50"
          >
            Emitir versión → buzón
          </button>
        </div>
      </div>

      {/* formulario alta/edición */}
      <RuleForm
        draft={draft}
        setDraft={setDraft}
        isEditing={isEditing}
        isDuplicate={isDuplicate}
        titleKnown={titleKnown}
        titles={titles}
        busy={busy}
        onSave={save}
        onCancel={resetForm}
      />

      {/* búsqueda + filtros */}
      <div className="mb-3 mt-5 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por carta…"
          className="w-56 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500"
        />
        {(["all", "banned", "note", "label"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition ${
              filter === f
                ? "bg-sky-500/20 text-sky-200 ring-sky-400/40"
                : "bg-slate-800 text-slate-400 ring-slate-700 hover:bg-slate-700"
            }`}
          >
            {f === "all" ? "Todas" : f === "banned" ? "Baneadas" : f === "note" ? "Con nota" : "Con label"}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">{filtered.length} mostradas</span>
      </div>

      {/* tabla */}
      {state?.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Error: {state.error}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Carta</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Modificadores</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.title} className="border-t border-slate-800/70 hover:bg-slate-800/20">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-200">{r.title}</span>
                      {titles && !titles.has(r.title) && (
                        <span title="no está en el índice de cartas" className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-400/30">
                          ⚠ no encontrada
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.banned && <Tag color="#FF0000">BANNED</Tag>}
                      {r.maxCopies != null && (
                        <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[11px] text-slate-300">
                          max {r.maxCopies}
                        </span>
                      )}
                      {r.preferredPrinting && (
                        <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[11px] text-slate-300">
                          ed. {r.preferredPrinting}
                        </span>
                      )}
                      {r.label?.text && <Tag color={r.label.color}>{r.label.text}</Tag>}
                      {r.note && (
                        <span title={r.note} className="max-w-xs truncate rounded bg-slate-700/50 px-1.5 py-0.5 text-[11px] text-slate-400">
                          📝 {r.note}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => startEdit(r)}
                        className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-700"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => void remove(r)}
                        disabled={busy}
                        className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 ring-1 ring-rose-500/30 transition hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        Borrar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">
                    {rules.length === 0 ? "No hay reglas todavía. Agregá una arriba." : "Nada coincide con el filtro."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1"
      style={{ backgroundColor: `${color}22`, color, borderColor: `${color}55` }}
    >
      {children}
    </span>
  );
}

function RuleForm({
  draft,
  setDraft,
  isEditing,
  isDuplicate,
  titleKnown,
  titles,
  busy,
  onSave,
  onCancel,
}: {
  draft: Rule;
  setDraft: (r: Rule) => void;
  isEditing: boolean;
  isDuplicate: boolean;
  titleKnown: boolean | null;
  titles: Set<string> | null;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  // autocomplete: hasta 50 coincidencias del input actual (datalist liviano)
  const suggestions = useMemo(() => {
    if (!titles) return [];
    const q = draft.title.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: string[] = [];
    for (const t of titles) {
      if (t.toLowerCase().includes(q)) {
        out.push(t);
        if (out.length >= 50) break;
      }
    }
    return out;
  }, [titles, draft.title]);

  const set = (patch: Partial<Rule>) => setDraft({ ...draft, ...patch });
  const canSave = draft.title.trim() !== "" && !isDuplicate && !busy;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 text-sm font-medium text-slate-300">
        {isEditing ? `Editando: ${draft.title}` : "Agregar regla"}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Carta (title)</span>
          <input
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            disabled={isEditing}
            list="card-titles"
            placeholder="Nombre exacto de la carta"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500 disabled:opacity-60"
          />
          <datalist id="card-titles">
            {suggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {isDuplicate && <span className="text-[11px] text-rose-400">ya existe una regla para esta carta</span>}
          {!isDuplicate && titleKnown === false && (
            <span className="text-[11px] text-amber-400">⚠ no está en el índice de cartas</span>
          )}
          {!isDuplicate && titleKnown === true && <span className="text-[11px] text-emerald-400">✓ carta encontrada</span>}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">maxCopies (vacío = sin override; 0 = prohibida)</span>
          <input
            type="number"
            value={draft.maxCopies ?? ""}
            onChange={(e) => set({ maxCopies: e.target.value === "" ? null : Number(e.target.value) })}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(draft.banned)}
            onChange={(e) => set({ banned: e.target.checked })}
            className="size-4 rounded"
          />
          <span className="text-sm text-slate-300">Baneada</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">preferredPrinting (código de edición)</span>
          <input
            value={draft.preferredPrinting ?? ""}
            onChange={(e) => set({ preferredPrinting: e.target.value || null })}
            placeholder="ej. SE"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs text-slate-500">note (texto bajo la imagen)</span>
          <input
            value={draft.note ?? ""}
            onChange={(e) => set({ note: e.target.value || null })}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500"
          />
        </label>

        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-slate-500">label (texto sobre la carta)</span>
            <input
              value={draft.label?.text ?? ""}
              onChange={(e) =>
                set({ label: e.target.value ? { text: e.target.value, color: draft.label?.color ?? "#000000" } : null })
              }
              placeholder="ej. Errata"
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-slate-500"
            />
          </label>
          <input
            type="color"
            value={draft.label?.color ?? "#000000"}
            onChange={(e) => set({ label: { text: draft.label?.text ?? "", color: e.target.value } })}
            title="color del label"
            className="h-9 w-10 rounded ring-1 ring-slate-700"
          />
        </div>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">highlight (borde en el carrusel)</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.highlight?.color ?? "#000000"}
                onChange={(e) => set({ highlight: { color: e.target.value } })}
                className="h-9 w-10 rounded ring-1 ring-slate-700"
              />
              {draft.highlight && (
                <button
                  onClick={() => set({ highlight: null })}
                  className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-400 ring-1 ring-slate-700 hover:bg-slate-700"
                >
                  quitar
                </button>
              )}
            </div>
          </label>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="rounded-lg bg-sky-500/15 px-3 py-1.5 text-sm font-medium text-sky-300 ring-1 ring-sky-400/30 transition hover:bg-sky-500/25 disabled:opacity-50"
        >
          {busy ? "Guardando…" : isEditing ? "Guardar cambios" : "Agregar"}
        </button>
        {isEditing && (
          <button
            onClick={onCancel}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-700"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
