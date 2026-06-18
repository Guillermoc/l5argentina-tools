# Migración: de carpetas-por-canal al pool

El bucket tenía los artefactos repartidos en cada canal (`debug/cards-2.1.0.zip`,
`production/cardImages/celestial-1.0.zip`, …), con cada imagen **triplicada** (una copia por
canal). El modelo nuevo usa un **pool compartido** (`pool/<type>/<id>/<version>/`) que los tres
canales apuntan. **Esta migración ya se hizo** (junio 2026); este doc queda como referencia.

## Principio (por qué no rompe a los usuarios)

El `manifest.json` que ve la app no cambia de forma; solo cambian las **URLs** (de
`/debug/cardImages/...` a `/pool/...`). Como la app decide bajar comparando **`version`** y no la
URL, reescribir las URLs **con las mismas versiones** no dispara descargas. Los archivos viejos
quedan intactos hasta limpiarlos.

## Cómo se hizo

El comando `migrate` automatiza todo: para cada paquete decide **copiar server-side** lo que ya
está en R2 (R2→R2, sin gastar ancho de banda) y **subir** solo lo genuinamente nuevo. Siempre con
dry-run primero (genera `dist/` para revisar) y `--apply` para ejecutar.

1. **debug** se migró con las versiones de `versions.json` (incluyó subir `cards_db 2.2.0` nuevo y
   el `changelog` que faltaba; el resto se copió server-side):
   ```bash
   npm run l5a -- migrate -c debug            # dry-run: revisar dist/
   npm run l5a -- migrate -c debug --apply
   npm run l5a -- verify -c debug
   ```

2. **staging** y **production** se migraron con **`--adopt`**, que usa las versiones que cada canal
   tenía HOY en vivo (no las de debug), conservando su estado. Como las imágenes 1.0 ya estaban en
   la pool (de debug), se **reusaron** (dedup); solo se copiaron las versiones propias más viejas
   (`cards_db 1.2.38`, `rules 2.1.0`, `changelog 2.1.0`):
   ```bash
   npm run l5a -- migrate -c staging --adopt --apply
   npm run l5a -- verify -c staging
   npm run l5a -- migrate -c production --adopt --apply
   npm run l5a -- verify -c production
   ```

Resultado: los 3 canales en la pool, tamaños corregidos, orden de paquetes nuevo, imágenes
deduplicadas. Impacto a usuarios ~nulo (staging/production conservaron sus versiones).

## Pendiente: limpieza de huérfanos

Tras migrar, quedaron en el bucket los **archivos viejos por canal** (~2,9 GB) que ningún manifest
referencia: `<canal>/cards-*.zip|json`, `<canal>/cardImages/`, `<canal>/filters-*.json`,
`<canal>/rules-*.json`, `<canal>/changelog*.md`.

**Seguro de borrar** esos archivos. **NO borrar**:

- `<canal>/manifest.json` (el índice nuevo),
- las sub-features `<canal>/history/`, `news/`, `tournament/`, `rulebooks/` (contenido real con su
  propio sub-manifest — ej. `production/history/` tiene PDFs),
- `pool/` (todo) ni `sunandmoon/` (otra app),
- los archivos sueltos de la raíz (`manifest.json`, `database-2.0.1.zip`) de origen a confirmar.

> `gc` solo limpia huérfanos **dentro de `pool/`**. Para borrar los archivos viejos por canal hay
> que hacerlo a mano o extender `gc` a un modo "todo el bucket" (con dry-run) que preserve lo de
> arriba. Pendiente.
