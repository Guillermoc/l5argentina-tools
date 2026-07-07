# L5Argentina Tools

Tooling para sincronizar y gestionar el bucket **Cloudflare R2** de **L5Argentina (L5A)** —
el CDN de solo-lectura que sirve datos (cartas, imágenes, reglas, filtros, novedades) a las
apps de L5A.

Monorepo TypeScript con dos piezas:

- **CLI `l5a`** — construye, publica, promueve y verifica el contenido del bucket.
- **Dashboard** (`apps/dashboard/`) — panel web en Cloudflare Pages con el estado de los 3 canales.

> **¿Primera vez acá?** Leé **[docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md)** (explicación
> funcional, sin tecnicismos) y la **[referencia de comandos](docs/COMMANDS.md)**.

---

## Idea central

Separación al estilo "app web": **el código vive en git**; **el contenido y el estado viven
online** (en R2). git guarda el CLI, el dashboard y la config/inputs (`app.config.json`,
`versions.json`). El **estado de deploy** (`registry` + `lock`: qué versión hay en cada canal)
vive en **R2** (`_state/`), no en git. Las imágenes y zips pesados (con copyright) viven solo en R2.

- **Canales**: `debug` → `staging` → `production`. Se construye/prueba en debug y se
  **promueve** hacia adelante. "Build once, promote bytes": lo que probaste es lo que sale.
- **Pool content-addressed**: cada blob vive una sola vez en `pool/<tipo>/<id>/<versión>/` y
  los 3 canales lo apuntan. Las imágenes (~960 MB) quedan **deduplicadas** (no triplicadas).
- **Estado en R2** (`_state/registry.json`, `_state/channels.lock.json`): lectura pública,
  escritura con credenciales. Lo escriben tanto el CLI como el dashboard (botones de promover).
- **`manifest.json`** por canal = el índice que lee la app: `{ id, type, version, url, sizeBytes, sha256 }`.
  La app decide qué bajar comparando **`version`** (no la URL), así que mover archivos a la pool
  **no dispara re-descargas**.

- **Canales**: `debug` → `staging` → `production`. Se construye/prueba en debug y se
  **promueve** hacia adelante. "Build once, promote bytes": lo que probaste es lo que sale.
- **Pool content-addressed**: cada blob vive una sola vez en `pool/<tipo>/<id>/<versión>/` y
  los 3 canales lo apuntan. Las imágenes (~960 MB) quedan **deduplicadas** (no triplicadas).
- **`manifest.json`** por canal = el índice que lee la app: `{ id, type, version, url, sizeBytes, sha256 }`.
  La app decide qué bajar comparando **`version`** (no la URL), así que mover archivos a la pool
  **no dispara re-descargas**.

## Estructura del repo

```
apps/
  companion/                 la app de cartas (canales debug/staging/production)
    app.config.json          declara los paquetes (id, type, source) y el orden  [git]
    versions.json            versión actual de la fuente de cada paquete  [git, vos lo editás]
    content/                 fuentes LIVIANAS (filters.json, rules.json, changelog.md) → git
    assets/                  fuentes PESADAS (zips de imágenes/base) → NO git (gitignored)
    dist/                    artefactos generados / preview → NO git (gitignored)
                             (el ESTADO — registry + lock — vive en R2 _state/, no acá)
  dashboard/                 panel web (React + Vite + Cloudflare Pages)
packages/
  core/                      motor: build, hash, pack determinista, manifest, registry, R2, migrate
  cli/                       el comando `l5a`
docs/                        COMO-FUNCIONA, COMMANDS, BUCKET, MIGRATION
.env                         credenciales R2 (gitignored)
```

## Setup

```bash
npm install
cp .env.example .env     # completar credenciales R2 (Account API token, Object Read & Write)
```

Requiere **Node 22+**. El CLI corre con `tsx` (sin paso de build).

## Comandos (resumen)

```bash
npm run l5a -- <comando> [-a <app>]   # -a default: companion
```

| Comando | Qué hace |
|---|---|
| `build` | Construye los artefactos desde las fuentes a `dist/` (no escribe en R2). |
| `status` | Matriz de versiones por canal (lee el estado de R2). |
| `publish -c <canal>` | Publica las versiones de `versions.json` a un canal (sube lo nuevo al pool). |
| `migrate -c <canal>` | Migra un canal a la pool: **copia server-side** lo que ya está en R2 y sube solo lo nuevo. |
| `promote <from> <to>` | Apunta el manifest de `<to>` a las versiones de `<from>` (0 bytes — pool compartido). |
| `verify [-c <canal>]` | Chequea un canal contra el bucket en vivo (links, tamaños, same-origin). |
| `gc` | Lista/borra blobs del pool que ningún canal referencia. |
| `inbox <ls\|put\|send\|rm>` | Buzón: subir/listar archivos pendientes y enviarlos a debug. |

Flags transversales: `--dry-run` (planificar sin tocar R2), `--apply` (ejecutar, en `migrate`/`gc`),
`--adopt` (en `migrate`, usa las versiones que el canal tiene HOY en vivo). El estado (registry +
lock) se guarda **solo en R2** automáticamente; no hace falta `git push` tras un deploy. **Detalle
completo en [docs/COMMANDS.md](docs/COMMANDS.md).**

## Flujos típicos

**Actualizar un set de imágenes (o la base):**
1. Dejás el zip nuevo en `apps/companion/assets/images/<id>.zip` (o `assets/cards_db.zip`).
2. Bumpeás esa versión en `versions.json` (ej. `1.0` → `1.1`).
3. `npm run l5a -- publish -c debug` → sube solo ese blob al pool, debug pasa a la versión nueva.
4. Probás debug con la app.
5. Promovés desde el **dashboard** (botón ↑) o por CLI: `npm run l5a -- promote debug staging`.
6. Cuando estés seguro: `npm run l5a -- promote staging production` (o el botón).

**Editar contenido liviano (reglas, filtros, changelog):** igual, pero la fuente está en
`content/` (y sí va a git).

## Dashboard

`apps/dashboard/` es el **panel de control** (gratis en Cloudflare Pages, protegido con Cloudflare
Access). Muestra:

- la **matriz de versiones** por canal en vivo;
- la **salud** de cada archivo (existe / tamaño correcto / roto);
- el **drift** vs. el estado en `_state/`;
- el indicador **↑ para promover** (cuando un canal tiene una versión menor que su canal anterior);

y permite **promover entre canales** con un botón (pide confirmación mostrando el diff, y escribe el
manifest + el estado en R2 — lo mismo que `l5a promote`). También tiene el **buzón → debug**:
adjuntás un archivo (nombrado `<paquete>-<X.Y.Z>.<ext>`) y lo enviás a debug desde el panel.

> Para que los **botones de promover** funcionen en producción, el proyecto de Pages necesita las
> credenciales R2 como **environment variables** (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
> `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). Ver [apps/dashboard/README.md](apps/dashboard/README.md).

En producción: **https://admin.l5argentina.com.ar**. Local: `cd apps/dashboard && npm install && npm run dev`.

## Estado actual

Los 3 canales ya están migrados a la pool. Pendiente (ver [docs/MIGRATION.md](docs/MIGRATION.md)
y el backlog): limpieza de archivos huérfanos viejos por canal, sub-features
(news/history/tournament/rulebooks), formulario web de novedades, y sumar el launcher
`sunandmoon` como segunda app.
