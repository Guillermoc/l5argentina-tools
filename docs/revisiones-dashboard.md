# Spec: selector de revisiones en el dashboard de Tools

**Para:** repo `l5argentina-tools` (dashboard, Cloudflare Pages)
**Contexto:** las auditorías de imágenes (`L5Argentina DB Test\image-audit\`) generan
reportes JSON y los suben automáticamente al bucket R2 bajo `tools/reports/`,
junto con un índice. Ya existen las páginas de revisión
`public/reviews/title-review.html` y `public/reviews/keyword-review.html`, que
aceptan `?report=<url>`. Falta la pieza que las une: un **selector de reportes**
usable desde el celular, fuera de casa.

## Datos disponibles (ya en producción, lectura pública)

- Índice: `https://pub-4ab8e43f10604d7fa0f9402a8259a855.r2.dev/tools/reports/index.json`

```json
{
 "reports": [
  { "file": "keywords-ALitS-2026-07-15.json",
    "analisis": "keywords-ALitS", "set": "ALitS", "fecha": "2026-07-15",
    "db": "cards-3.3.0.json", "total": 165, "ok": 150, "casi": 1, "diff": 14, "error": 0 }
 ],
 "actualizado": "..."
}
```

- Cada reporte: `.../tools/reports/<file>`. El prefijo del nombre indica el tipo
  de análisis: `audit-*` = títulos → abre `title-review.html`;
  `keywords-*` = keywords → abre `keyword-review.html`.
  (Regla general: el campo `analisis` es `<tipo>-<set>`.)

## Modelo de estados (decidido 2026-07-15)

Cada par **(set × análisis)** tiene un estado, visible en el índice:

1. **Pendiente** — sin reporte. El índice trae `sets` (todos los sets con su
   cantidad de imágenes) para poder listarlos.
2. **Analizado** — hay reporte en `tools/reports/` (entrada en `index.json`).
3. **Revisado** — hay decisiones en `tools/reports/decisions/<analisis>-review.json`
   y la entrada del índice tiene `review: { file, fecha, decididas }`.
4. **Aplicado** — la entrada tiene `aplicado: { fecha }`. Lo marca Guillermo
   desde la PC (`mark-applied.mjs`) después de aplicar localmente.

**Explícitamente FUERA de alcance**: nada modifica la base de cartas de forma
automática — ni PRs ni aplicación server-side. Las decisiones se acumulan en el
bucket; aplicarlas es un paso manual local (`apply-*-review.mjs`, acepta la URL
del bucket), cuando Guillermo quiera.

## Qué construir

### 1. Índice = grilla de estado (`public/reviews/index.html`)

- Una **fila por set** (universo: `index.sets`), una **celda por análisis**
  (títulos, keywords, futuros — derivar los tipos de los `analisis` presentes).
- Semáforo por celda: gris = pendiente · azul = analizado (mostrar `ok/diff`) ·
  naranja = revisado sin aplicar · verde = aplicado.
- Tap en celda con reporte → la página de revisión correspondiente con
  `?report=<url>`. Filtros por tipo de análisis y por estado.
- **Mobile-first**: se usa desde el teléfono fuera de casa.

### 2. Envío de decisiones server-side (nueva Pages Function)

- `POST /api/reviews` con el JSON de decisiones. La function (mismo patrón
  aws4fetch que promote/upload) escribe
  `tools/reports/decisions/<analysis>-review.json` y actualiza la entrada del
  índice con `review: { file, fecha, decididas: N }`.
- En las páginas de revisión, reemplazar/acompañar "Exportar decisiones" con
  **"Enviar decisiones"**, habilitado SOLO cuando todas las marcadas están
  decididas (regla: revisiones completas, sin parciales). Mantener la descarga
  local como alternativa.

### 3. Retoques a las páginas de revisión

- Responsive (ya aplicado: apilar en < 700px, targets táctiles).
- Link "volver al índice" (ya aplicado).

## Restricciones

- Sin credenciales en el cliente (la Function nueva usa env vars server-side,
  mismo patrón que promote/upload). Sin dependencias nuevas en las páginas.
- Al actualizar `index.json` desde la Function: leer-modificar-escribir
  preservando campos ajenos (`sets`, `aplicado`); matchear entradas por el
  campo `analisis` (no por nombre de archivo: los reportes de títulos se
  llaman `audit-*` pero su `analisis` es `titulos-*`).
- Mantener el estilo visual de `woh-review.html` (variables CSS, tema
  claro/oscuro automático).
- El bucket es público: los reportes no contienen nada sensible (nombres de
  cartas y lecturas del modelo) y debe seguir siendo así.

## Criterio de aceptación

Desde el teléfono: abrir el dashboard → grilla de sets → ver ALitS con títulos
en azul "163 ok / 2 a revisar" → tocarlo → decidir las 2 cartas viendo imagen +
DB + lectura → al decidir la última se habilita "Enviar decisiones" → enviar →
la celda pasa a naranja. Días después, en la PC: `apply-title-review.mjs` con la
URL de las decisiones + `mark-applied.mjs` → la celda pasa a verde. Sin pasos
manuales de URLs en el teléfono.
