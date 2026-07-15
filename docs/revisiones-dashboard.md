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

## Qué construir

Una página `public/reviews/index.html` (o sección del dashboard, a criterio) que:

1. **Lista los reportes** del índice, agrupados por set, mostrando: tipo de
   análisis, set, fecha, y el resumen `ok / casi / diff` con color (verde si
   `casi+diff+error == 0`, naranja/rojo si hay pendientes).
2. **Selectores/filtros**: por tipo de análisis (títulos / keywords / futuros)
   y por set. Con pocos reportes alcanza una lista; los selectores importan
   cuando haya decenas.
3. **Abrir en revisión**: cada entrada linkea a la página de revisión que
   corresponda con `?report=<url del reporte>`.
4. **Mobile-first**: esto se usa desde el teléfono fuera de casa — tarjetas
   apiladas, tipografía legible, targets táctiles grandes.

## Retoques a las páginas de revisión existentes (mismo PR)

- **Responsive**: hoy `.row` es flex horizontal con imagen de 220px — en
  pantallas angostas (< ~700px) apilar: imagen arriba (ancho completo,
  máx ~350px), campos abajo. Botones con altura táctil cómoda.
- **Volver al índice**: link arriba para volver al selector.
- (Las decisiones se exportan como descarga de archivo; en el celu funciona,
  el JSON queda en Descargas y se aplica después desde la PC. Un endpoint de
  guardado server-side queda explícitamente FUERA de esta spec.)

## Restricciones

- Solo assets estáticos + fetch al índice público: sin backend nuevo, sin
  dependencias nuevas, sin credenciales en el cliente.
- Mantener el estilo visual de `woh-review.html` (variables CSS, tema
  claro/oscuro automático).
- El bucket es público: los reportes no contienen nada sensible (nombres de
  cartas y lecturas del modelo) y debe seguir siendo así.

## Criterio de aceptación

Desde el teléfono: abrir el dashboard → sección revisiones → ver el reporte de
keywords de ALitS con su "150 ok / 15 a revisar" → tocarlo → revisar las 15
cartas viendo imagen + DB + lectura → exportar decisiones. Sin pasos manuales
de URLs.
