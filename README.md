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

El bucket es **output regenerable**; la **fuente de verdad de la receta** vive en este repo
(git). Las imágenes y zips pesados (con copyright) **nunca van a git**: viven solo en R2, y
git guarda únicamente su referencia (versión + tamaño + hash).

- **Canales**: `debug` → `staging` → `production`. Se construye/prueba en debug y se
  **promueve** hacia adelante. "Build once, promote bytes": lo que probaste es lo que sale.
- **Pool content-addressed**: cada blob vive una sola vez en `pool/<tipo>/<id>/<versión>/` y
  los 3 canales lo apuntan. Las imágenes (~960 MB) quedan **deduplicadas** (no triplicadas).
- **`manifest.json`** por canal = el índice que lee la app: `{ id, type, version, url, sizeBytes }`.
  La app decide qué bajar comparando **`version`** (no la URL), así que mover archivos a la pool
  **no dispara re-descargas**.

## Estructura del repo

```
apps/
  companion/                 la app de cartas (canales debug/staging/production)
    app.config.json          declara los paquetes (id, type, source) y el orden
    versions.json            versión actual de la fuente de cada paquete  [vos lo editás]
    channels.lock.json       qué versión está publicada en cada canal     [estado, en git]
    registry.json            libro mayor: cada (paquete, versión) → url/size/hash  [en git]
    content/                 fuentes LIVIANAS (filters.json, rules.json, changelog.md) → git
    assets/                  fuentes PESADAS (zips de imágenes/base) → NO git (gitignored)
    dist/                    artefactos generados / preview → NO git (gitignored)
  dashboard/                 panel web (React + Vite + Cloudflare Pages)
packages/
  core/                      motor: build, hash, pack determinista, manifest, registry, R2, migrate
  cli/                       el comando `l5a`
docs/                        COMO-FUNCIONA, COMMANDS, MIGRATION
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
| `build` | Construye los artefactos desde las fuentes a `dist/` (no toca R2). |
| `status` | Matriz de versiones por canal (lee `channels.lock.json`). |
| `publish -c <canal>` | Publica las versiones de `versions.json` a un canal (sube lo nuevo al pool). |
| `migrate -c <canal>` | Migra un canal a la pool: **copia server-side** lo que ya está en R2 y sube solo lo nuevo. |
| `promote <from> <to>` | Apunta el manifest de `<to>` a las versiones de `<from>` (0 bytes — pool compartido). |
| `verify [-c <canal>]` | Chequea un canal contra el bucket en vivo (links, tamaños, same-origin). |
| `gc` | Lista/borra blobs del pool que ningún canal referencia. |

Flags transversales: `--dry-run` (planificar sin tocar R2), `--apply` (ejecutar, en `migrate`/`gc`),
`--commit` (tras el deploy, commitea+pushea el estado y redeploya el dashboard), `--adopt` (en
`migrate`, usa las versiones que el canal tiene HOY en vivo). **Detalle completo en
[docs/COMMANDS.md](docs/COMMANDS.md).**

## Flujos típicos

**Actualizar un set de imágenes (o la base):**
1. Dejás el zip nuevo en `apps/companion/assets/images/<id>.zip` (o `assets/cards_db.zip`).
2. Bumpeás esa versión en `versions.json` (ej. `1.0` → `1.1`).
3. `npm run l5a -- publish -c debug --commit` → sube solo ese blob al pool, debug pasa a la versión nueva.
4. Probás debug con la app.
5. `npm run l5a -- promote debug staging --commit` → staging apunta al mismo blob (0 bytes).
6. Cuando estés seguro: `npm run l5a -- promote staging production --commit`.

**Editar contenido liviano (reglas, filtros, changelog):** igual, pero la fuente está en
`content/` (y sí va a git).

## Dashboard

`apps/dashboard/` es un panel **solo-lectura** (gratis en Cloudflare Pages, protegido con
Cloudflare Access) que muestra:

- la **matriz de versiones** por canal en vivo;
- la **salud** de cada archivo (existe / tamaño correcto / roto);
- el **drift** vs. lo declarado en git;
- el indicador **↑ para promover** (cuando un canal tiene una versión menor que su canal anterior).

En producción: **https://admin.l5argentina.com.ar**. Local: `cd apps/dashboard && npm install && npm run dev`.
Ver [apps/dashboard/README.md](apps/dashboard/README.md).

## Estado actual

Los 3 canales ya están migrados a la pool. Pendiente (ver [docs/MIGRATION.md](docs/MIGRATION.md)
y el backlog): limpieza de archivos huérfanos viejos por canal, sub-features
(news/history/tournament/rulebooks), `sha256` en el manifest, formulario web de novedades, y
sumar el launcher `sunandmoon` como segunda app.
