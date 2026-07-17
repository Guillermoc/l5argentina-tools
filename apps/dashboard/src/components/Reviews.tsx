type ReviewLink = {
  id: string;
  title: string;
  description: string;
  href: string;
};

const REVIEWS: ReviewLink[] = [
  {
    id: "index",
    title: "Grilla de estado (sets × análisis)",
    description: "Set por fila, tipo de análisis por columna: pendiente / analizado / revisado / aplicado. Tocá una celda para revisar. Pensado para usar desde el celular.",
    href: "/reviews/index.html",
  },
  {
    id: "woh",
    title: "WoH — Revisión de Current",
    description: "Revisión carta por carta de qué printing debería ser el \"current\" entre todas las versiones de una carta con printing en War of Honor.",
    href: "/reviews/woh-review.html",
  },
  {
    id: "title",
    title: "Títulos — Revisión de auditoría de imágenes",
    description: "Cargá un reporte de image-audit/reports/. Para cada carta marcada: mirá la imagen, elegí la verdad (DB, lo leído por el modelo, o texto editado) y exportá las decisiones.",
    href: "/reviews/title-review.html",
  },
  {
    id: "keyword",
    title: "Keywords — Revisión de auditoría de imágenes",
    description: "Cargá un reporte keywords-*.json de image-audit/reports/. Para cada carta marcada: mirá la línea de keywords en la imagen y elegí la verdad. Las decisiones se exportan como JSON para apply-keyword-review.mjs.",
    href: "/reviews/keyword-review.html",
  },
  {
    id: "setnum",
    title: "Set+número — Revisión de auditoría de imágenes",
    description: "Cargá un reporte setnum-*.json de image-audit/reports/. Verifica que el set y número impresos en la carta coincidan con el nombre del archivo (todos los printings, no solo current). Marcá cada carta como falsa alarma o error real con nota.",
    href: "/reviews/setnum-review.html",
  },
  {
    id: "reglas",
    title: "Reglas — Revisión de auditoría de imágenes",
    description: "Cargá un reporte reglas-*.json de image-audit/reports/. Compara el texto de reglas de la DB (solo current) contra una transcripción del cuadro de texto — busca redacciones de otro printing o de otra carta. Marcá cada carta como falsa alarma o error real con nota.",
    href: "/reviews/reglas-review.html",
  },
];

export default function Reviews() {
  return (
    <div>
      <p className="mb-4 text-sm text-slate-400">
        Herramientas standalone de revisión. Cada una abre en una pestaña aparte; el progreso y el
        JSON de salida se manejan dentro de esa herramienta, no acá.
      </p>
      <ul className="flex flex-col gap-2">
        {REVIEWS.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3"
          >
            <div>
              <div className="font-medium text-slate-200">{r.title}</div>
              <div className="mt-0.5 text-xs text-slate-500">{r.description}</div>
            </div>
            <a
              href={r.href}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-lg bg-sky-500/15 px-3 py-1.5 text-sm font-medium text-sky-300 ring-1 ring-sky-400/30 transition hover:bg-sky-500/25"
            >
              Abrir →
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
