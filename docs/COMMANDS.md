# Referencia de comandos — CLI `l5a`

Se invoca con `npm run l5a -- <comando> [opciones]`. Opción global **`-a, --app <app>`**
(default `companion`) — elige la app dentro de `apps/`.

El CLI lee la config local de `apps/<app>/` (`app.config.json`, `versions.json`) y el **estado**
(`registry` + `lock`) de **R2** (`_state/`, lectura pública). Las credenciales `.env` se usan solo
para **escribir** (publish / promote / migrate --apply / gc --apply). Tras un deploy, el estado se
guarda en R2 automáticamente — **no hace falta `git push`** (el dashboard lo lee en vivo).

Convenciones de flags:

- **`--dry-run`** — planifica y muestra qué haría, sin tocar R2 (en `publish`, `promote`).
- **`--apply`** — ejecuta de verdad (en `migrate` y `gc`, que por defecto son dry-run).
- **`--adopt`** — en `migrate`, usa las versiones que el canal tiene HOY en vivo (no `versions.json`).

---

## `build`

Construye los artefactos de cada paquete desde su `source` y los deja en `dist/`. **No toca R2.**
Empaqueta carpetas en zip **determinista** (mismo contenido → mismo hash) y calcula sha256 + tamaño.

```bash
npm run l5a -- build
npm run l5a -- build --no-write     # solo muestra el plan, no escribe dist/
```

Estados por paquete:

| | |
|---|---|
| `＋ new` | versión nueva, artefacto listo para publicar |
| `· existing` | esa versión ya está en el registry con el mismo hash; nada que subir |
| `? missing` | falta la fuente local (típico de imágenes en `assets/` no presentes) |
| `✗ drift` | el contenido cambió pero la versión ya está publicada con OTRO hash → bumpeá la versión |

---

## `status`

Matriz de versiones por canal, leída del estado en R2 (`_state/channels.lock.json`, público).
Marca con `◂ difiere` los paquetes cuya versión no es igual en todos los canales.

```bash
npm run l5a -- status
```

---

## `publish`

Publica las versiones **de `versions.json`** a un canal (normalmente `debug`): construye desde
las fuentes locales, sube al pool los blobs nuevos, actualiza el estado (`_state/registry.json` +
`_state/channels.lock.json` en R2) y sube el `manifest.json` del canal.

```bash
npm run l5a -- publish -c debug
npm run l5a -- publish -c debug --dry-run     # ver el plan sin tocar R2
```

- Sube **solo** los blobs que no existen ya en el pool.
- Aborta si falta una fuente o si hay drift (no deja el canal a medias).

---

## `migrate`

Migra un canal a la pool de la forma más eficiente: para cada paquete en su versión objetivo,
decide automáticamente:

- **copy** — esos bytes YA existen en R2 a esa versión → **copia server-side** (R2→R2, 0 de subida).
- **upload** — es nuevo/cambiado → lo sube desde la fuente local.
- **skip** — ya está en el registry (migrado).

Por defecto es **dry-run**: genera `dist/` (plan.json + manifest preview + artefactos nuevos)
para revisar. Con `--apply` ejecuta.

```bash
npm run l5a -- migrate -c debug                # dry-run: arma dist/ para revisar
npm run l5a -- migrate -c debug --apply        # ejecuta (escribe pool + manifest + estado en R2)
```

**`--adopt`** — usa las versiones que el canal tiene **HOY en vivo** (no `versions.json`) y nunca
sube desde local: solo copia/reusa. Sirve para "acomodar" un canal a la pool **conservando sus
versiones actuales** (útil para staging/production, que suelen estar detrás de debug).

```bash
npm run l5a -- migrate -c staging --adopt              # dry-run
npm run l5a -- migrate -c staging --adopt --apply
```

---

## `promote <from> <to>`

Mueve un canal hacia adelante en el pipeline (debug → staging → production). Como el pool es
compartido, **no copia bytes**: solo reescribe el `manifest.json` de `<to>` apuntando a las
versiones de `<from>`, y actualiza el lock.

```bash
npm run l5a -- promote debug staging
npm run l5a -- promote debug staging --only cards_db,rules    # solo algunos paquetes
npm run l5a -- promote debug staging --dry-run                 # ver el diff
npm run l5a -- promote staging production
```

Requiere que las versiones a promover estén en el `registry.json` (es decir, ya publicadas).

---

## `verify`

Baja el `manifest.json` del canal **en vivo** y chequea, por paquete: que la URL sea same-origin,
que el archivo exista (HTTP 200) y que el tamaño real coincida con el declarado.

```bash
npm run l5a -- verify              # los 3 canales
npm run l5a -- verify -c production
```

Sale con código ≠ 0 si encuentra algún problema. No necesita credenciales R2 (usa fetch público).

---

## `gc`

Recolecta basura del **pool**: lista los blobs bajo `pool/` y borra los que ningún canal
referencia (según `channels.lock.json` + `registry.json`). **Dry-run por defecto.**

```bash
npm run l5a -- gc            # lista huérfanos del pool
npm run l5a -- gc --apply    # los borra
```

> Nota: `gc` solo mira el prefijo `pool/`. Los archivos viejos por canal (`debug/cards-*.zip`,
> `debug/cardImages/…`, etc.) anteriores a la pool **no** los toca — ver [MIGRATION.md](MIGRATION.md).

---

## `regen`

Recalcula el `sha256` de las versiones del `registry.json` que no lo tienen (bajando el blob del
pool y hasheándolo) y regenera el `manifest.json` de cada canal para que incluya el `sha256` de
cada paquete. **Dry-run por defecto.**

```bash
npm run l5a -- regen            # ve qué falta y qué manifests se reescribirían
npm run l5a -- regen --apply    # calcula los sha256 faltantes y sube los manifest.json
```

> Solo hace falta correrlo una vez para poner al día versiones publicadas antes de que el
> tooling calculara el sha256 (buzón/`migrate`). De ahí en adelante, `publish`/`promote`/`inbox
> send`/`migrate` ya escriben el `sha256` real en cada manifest nuevo.

---

## `inbox` — el buzón

El **buzón** es la carpeta `inbox/` del bucket: un área de paso para archivos pendientes de
publicar. Desde el **dashboard** se **adjunta un archivo** y se sube al buzón (mismo origen, sin
CORS); los **pesados** que no convenga subir por el panel se dejan ahí con `inbox put` (o desde el
panel de Cloudflare/rclone). Después se **envían a debug**: el blob se copia server-side a la pool,
se actualiza el estado (`registry` + `lock` de debug) y se reescribe `debug/manifest.json`. Al
enviar, el archivo se borra del buzón (ya vive inmutable en la pool).

**Nombre del archivo = `inbox/<pkgId>-<X.Y.Z>.<ext>`** (guión + tres números). La versión se
**parsea del nombre** (p. ej. `inbox/cards_db-2.3.0.zip` → versión `2.3.0`). Si el nombre no trae
versión (`inbox/cards_db.zip`), se **sugiere** un bump de la que tiene debug y la confirmás al
enviar. Puede haber **varias versiones del mismo paquete** a la vez (cada archivo es una fila).

```bash
npm run l5a -- inbox ls                                   # qué hay (+ versión del nombre/sugerida)
npm run l5a -- inbox put cards_db ./cards_db-2.3.0.zip    # sube un pesado (toma la versión del nombre)
npm run l5a -- inbox send cards_db                        # dry-run (si hay una sola versión)
npm run l5a -- inbox send cards_db --version 2.3.0 --apply   # envía a debug
npm run l5a -- inbox rm cards_db [--version 2.3.0]        # descarta (todas, o una)
```

- `send` es **dry-run por defecto**; agregá `--apply` para escribir.
- La versión sale del nombre; `--version` la sobreescribe (y desambigua si hay varias).
- Rechaza enviar a una versión que ya está en el registry (las versiones son **inmutables**).
- Desde acá solo se entra a **debug**; para llevarlo a staging/production se usa `promote`.
- Lo mismo se hace desde el dashboard (sección **Buzón → debug**): formulario para texto y, por
  cada archivo, la versión ya viene precargada (del nombre o sugerida) y "Enviar a debug".
