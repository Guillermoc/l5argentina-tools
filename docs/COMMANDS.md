# Referencia de comandos — CLI `l5a`

Se invoca con `npm run l5a -- <comando> [opciones]`. Opción global **`-a, --app <app>`**
(default `companion`) — elige la app dentro de `apps/`.

El CLI lee el estado de `apps/<app>/`: `app.config.json`, `versions.json`,
`channels.lock.json`, `registry.json`. Las credenciales R2 salen de `.env` (solo para los
comandos que escriben/leen R2).

Convenciones de flags:

- **`--dry-run`** — planifica y muestra qué haría, sin tocar R2 (en `publish`, `promote`).
- **`--apply`** — ejecuta de verdad (en `migrate` y `gc`, que por defecto son dry-run).
- **`--commit`** — tras un deploy exitoso, commitea y pushea **solo** los archivos de estado
  (`app.config.json`, `versions.json`, `channels.lock.json`, `registry.json`). El push redeploya
  el dashboard. Si git falla, avisa pero no tira el comando (el bucket ya quedó actualizado).

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

Matriz de versiones por canal, leída de `channels.lock.json` (no consulta R2). Marca con
`◂ difiere` los paquetes cuya versión no es igual en todos los canales.

```bash
npm run l5a -- status
```

---

## `publish`

Publica las versiones **de `versions.json`** a un canal (normalmente `debug`): construye desde
las fuentes locales, sube al pool los blobs nuevos, actualiza `registry.json` + `channels.lock.json`
y sube el `manifest.json` del canal.

```bash
npm run l5a -- publish -c debug
npm run l5a -- publish -c debug --dry-run     # ver el plan sin tocar R2
npm run l5a -- publish -c debug --commit       # + commitea/pushea el estado
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
npm run l5a -- migrate -c debug                      # dry-run: arma dist/ para revisar
npm run l5a -- migrate -c debug --apply --commit     # ejecuta + commitea el estado
```

**`--adopt`** — usa las versiones que el canal tiene **HOY en vivo** (no `versions.json`) y nunca
sube desde local: solo copia/reusa. Sirve para "acomodar" un canal a la pool **conservando sus
versiones actuales** (útil para staging/production, que suelen estar detrás de debug).

```bash
npm run l5a -- migrate -c staging --adopt              # dry-run
npm run l5a -- migrate -c staging --adopt --apply --commit
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
npm run l5a -- promote staging production --commit
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
