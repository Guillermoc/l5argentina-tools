# Estructura del bucket R2

Referencia de cómo está organizado el bucket **`l5r-cards`** (Cloudflare R2) que sirve este
tooling. Base pública (solo lectura): `https://pub-4ab8e43f10604d7fa0f9402a8259a855.r2.dev/`.

El bucket aloja **dos apps con esquemas de manifest distintos**: la app de cartas (*companion*)
y el *launcher* (`sunandmoon/`, otra app). El dashboard maneja **ambas** (pestañas *Canales* y
*Launcher*).

## Prefijos top-level

```
pool/<tipo>/<id>/<versión>/<id>.<ext>   blobs content-addressed, compartidos por los 3 canales
_state/registry.json                    libro mayor: (paquete,versión) → url/size/sha256/type/ext
_state/channels.lock.json               qué versión hay en cada canal
_state/card-titles.json                 índice de nombres de carta (valida el editor de reglas)
inbox/<pkgId>-<X.Y.Z>.<ext>             buzón: archivos pendientes de enviar a debug
debug/      staging/      production/    un manifest.json por canal (lo que lee la app)
sunandmoon/                             launcher (OTRA app, otro esquema — ver abajo)
sunandmoon/inbox/<stem>-<X.Y.Z>.<ext>   buzón del launcher (pestaña Launcher del dashboard)
```

- **`pool/`** — cada blob vive una sola vez, identificado por tipo/id/versión, e **inmutable**
  (si cambia el contenido, sube la versión). Los manifests de canal lo apuntan. Deduplica las
  imágenes (antes ~960 MB triplicados por canal). Cache: `immutable`.
- **`_state/`** — el **estado** del deploy, vive en R2 (no en git): lectura pública vía r2.dev,
  escritura con credenciales S3, cache `no-store`. Lo escriben el CLI y el dashboard.
  `card-titles.json` es un derivado regenerable del `cards_db` en debug (lo reescribe el buzón al
  enviar una base nueva, o el botón "Refrescar índice"); lo consume el editor de reglas del dashboard.
- **`inbox/`** — área de paso (ver [COMMANDS.md](COMMANDS.md#inbox--el-buzón)). El nombre define
  paquete + versión: `inbox/cards_db-2.3.0.zip` → `cards_db` v`2.3.0`.
- **`<canal>/manifest.json`** — el índice que consume la app. Cache `max-age=60`.
- **Archivos viejos por-canal** (`<canal>/cards-*.zip`, `<canal>/cardImages/…`, `filters-*.json`,
  `rules-*.json`, `changelog*.md`): **huérfanos** anteriores a la pool. Seguros de borrar; limpieza
  manual pendiente (ver [MIGRATION.md](MIGRATION.md)). `gc` **no** los toca (solo mira `pool/`).
- **Raíz del bucket:** aparecieron `manifest.json` y `database-2.0.1.zip` sueltos, de origen
  desconocido (¿launcher viejo?). Revisar antes de tocarlos.

## App de canales (companion)

Carpetas `debug/`, `staging/`, `production/`, cada una con su `manifest.json`:

- **Forma del manifest:** array plano `packages[]` de `{ id, type, version, url (absoluta), sizeBytes,
  sha256 }`. La app deduplica por **`version`**, no por URL ni por `sha256`.
- **Tipos de paquete:** `filters`, `database` (cards_db), `rules`, `changelog`, e `images`
  (8 sets: promo, lotus, samurai, celestial, emperor, ivory, 20F, samuraiEx).
- **Sub-features** `news/`, `history/`, `tournament/`, `rulebooks/`: features con su **propio
  sub-manifest**, fuera del `packages[]` principal. **No están vacías** — `production/history/`
  tiene contenido real (`history/manifest.json` + 9 PDFs en `history/docs/`). El tooling **todavía
  no las maneja**; no borrarlas.

## Launcher (`sunandmoon/`)

Otra app, **otro esquema**. Lo maneja la pestaña **Launcher** del dashboard:

- Manifest (`sunandmoon/manifest.json`): `{ schema, launcher{ latest_version, notes }, databases[],
  images{} }`. Carpeta **plana**: sin pool, canales, registry ni lock.
- Usa **`file`** (ruta **relativa** same-origin) + **`sha256`** + `size`. **Rechaza URLs externas**
  (todo same-origin del propio manifest).
- Tres partes versionadas: `launcher` (el `.exe`: solo versión + notas), `database` (una sola base,
  `databases[0]`) e `images` (objeto único). El `.exe` se publica por **GitHub Releases**, no en el
  bucket; en la pestaña solo se declara su versión.
- **Buzón** en `sunandmoon/inbox/`. Al **publicar** un zip, el dashboard recalcula `sha256` + `size`,
  copia server-side a `sunandmoon/<stem>-<X.Y.Z>.<ext>` y reescribe el manifest (solo el slot tocado).
  La versión anterior queda **huérfana** (limpieza manual, igual que companion).

## Reglas de oro (qué NO romper)

- **No** cambiar el Public Dev URL ni pasar las URLs del manifest de companion a **relativas**
  (la app vive de URLs absolutas; romperías a los ~25 usuarios).
- **No** borrar `pool/`, las sub-features (`*/history|news|tournament|rulebooks/`) ni `sunandmoon/`.
- Solo campos **aditivos** en el manifest de companion (la app debe ignorar lo desconocido antes
  de sumar campos nuevos).

Ver también [COMO-FUNCIONA.md](COMO-FUNCIONA.md) (modelo funcional) y [../CLAUDE.md](../CLAUDE.md).
