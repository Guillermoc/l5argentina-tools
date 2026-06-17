# L5Argentina Tools

Tooling para sincronizar y gestionar el bucket **Cloudflare R2** de **L5Argentina (L5A)**.

El bucket es un CDN de **solo lectura** que sirve datos a las apps. Este repo es la
**fuente de verdad de la receta** (qué versiones, qué config, qué hay en cada canal);
el bucket es **output regenerable**. Las imágenes y zips pesados (con copyright)
**nunca van a git**: viven solo en R2, y git guarda únicamente su referencia.

> ¿Primera vez acá? Leé **[docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md)** — explica a nivel
> funcional qué guarda el proyecto, dónde, y cómo mueve las cosas, sin tecnicismos.

## Modelo

- **Canales**: `debug` → `staging` → `production`. Se construye en debug, se prueba,
  y se **promueve el mismo blob** (mismo `sha256`) hacia arriba ("build once, promote bytes").
- **Pool content-addressed**: los blobs viven una sola vez en `pool/<type>/<id>/<version>/`
  y los manifests de cada canal los apuntan. Deduplica las imágenes (hoy triplicadas).
- **`channels.lock.json`** (en git) = estado declarado de cada canal. El `git diff` de una
  promoción es el registro de auditoría.
- **`registry.json`** = libro mayor de cada `(paquete, versión)` publicada y su URL/hash/size.
- El **`manifest.json`** que consume la app mantiene su forma actual (URLs absolutas), así
  que **no hay que tocar la app** ni los usuarios existentes.

## Estructura

```
apps/companion/
  app.config.json      declara los paquetes, tipos y canales
  versions.json        versión actual de la fuente de cada paquete (lo bumpeás vos)
  channels.lock.json   qué versión está en cada canal
  registry.json        libro mayor de versiones publicadas
  content/             fuentes LIVIANAS (json, md) → SÍ van a git
  assets/              fuentes PESADAS (imágenes, zips) → NO van a git (gitignored)
  dist/                artefactos generados (gitignored)
packages/core/         motor (build, hash, pack determinista, manifest, registry, R2)
packages/cli/          comando `l5a`
```

## Uso

```bash
npm install
cp .env.example .env          # completar credenciales R2

npm run l5a -- build          # construye artefactos a dist/
npm run l5a -- status         # matriz de versiones por canal
npm run l5a -- publish -c debug          # publica la fuente actual a debug
npm run l5a -- promote debug staging     # promueve debug → staging (no copia bytes)
npm run l5a -- verify -c production       # chequea el canal contra el bucket en vivo
npm run l5a -- gc                         # lista huérfanos del pool (--apply para borrar)
```

Todos los comandos aceptan `-a <app>` (default `companion`).

### Flujo típico: cambiar una imagen

1. Reemplazás las imágenes en `apps/companion/assets/images/celestial/`.
2. Bumpeás `"celestial"` en `versions.json` (p. ej. `1.0` → `1.1`).
3. `npm run l5a -- publish -c debug` → sube `pool/.../celestial/1.1/`, debug pasa a 1.1.
   Staging y production siguen en 1.0; sus usuarios no re-descargan nada.
4. Probás debug. OK.
5. `npm run l5a -- promote debug staging` → staging apunta al mismo blob 1.1 (0 bytes copiados).

## Estados de `build`

- `＋ new` — versión nueva, artefacto listo para publicar.
- `· existing` — esa versión ya está publicada con el mismo hash; nada que subir.
- `? missing` — falta la fuente local (típico de imágenes en `assets/` aún no presentes).
- `✗ drift` — el contenido cambió pero la versión ya está publicada con otro hash → bumpeá la versión.

## Migración del estado actual

El bucket hoy tiene los archivos en carpetas por canal (`debug/cardImages/...`) en vez del
pool. La migración (no disruptiva, conserva las versiones → sin re-descargas) se documenta en
[docs/MIGRATION.md](docs/MIGRATION.md).

## Backlog

- Formulario web de novedades (Cloudflare Pages + Worker).
- Agregar `sha256` al manifest de companion (requiere confirmar/actualizar la app).
- Sumar el launcher `sunandmoon` como segunda app.
