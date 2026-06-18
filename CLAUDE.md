# CLAUDE.md — contexto para agentes de IA

Guía para asistentes de IA (Claude Code y compatibles) que trabajen en este repo. Para humanos,
empezá por [README.md](README.md), [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md) y
[docs/COMMANDS.md](docs/COMMANDS.md).

## Qué es

Tooling (CLI + dashboard) para gestionar el bucket **Cloudflare R2** de **L5Argentina (L5A)**,
un buscador de cartas fanmade de Legend of the Five Rings. El bucket es un CDN de solo-lectura
que sirve datos a las apps; este repo es la **fuente de verdad** y el bucket es output regenerable.

## Arquitectura en 30 segundos

- **Canales** `debug → staging → production`. Se publica/prueba en debug y se **promueve** hacia adelante.
- **Pool content-addressed**: cada blob vive una vez en `pool/<tipo>/<id>/<versión>/`; los manifests
  de cada canal lo apuntan. Las apps deduplican por **`version`**, no por URL.
- **Config/inputs en git**: `apps/<app>/app.config.json` (declara paquetes + orden) y `versions.json`
  (versión fuente de cada paquete).
- **Estado en R2, NO en git** (`_state/` en el bucket): `registry.json` (libro mayor:
  (paquete,versión) → url/size/hash) y `channels.lock.json` (qué versión hay en cada canal). Lectura
  pública (r2.dev), escritura con credenciales S3. Lo escriben el CLI y el dashboard.
- **Fuentes**: livianas en `apps/<app>/content/` (git); pesadas en `apps/<app>/assets/` (gitignored,
  solo lo que estés cambiando — el resto vive en R2).

## Layout

```
packages/core   motor TS: config, hash, pack (zip determinista), manifest, registry, r2, migrate, build
packages/cli    comando `l5a` (commander) — comandos en src/commands/
apps/companion  datos/estado de la app de cartas (no tiene código)
apps/dashboard  panel web React+Vite+Tailwind v4, deploy a Cloudflare Pages (proyecto standalone)
docs/           COMO-FUNCIONA (funcional), COMMANDS (referencia), MIGRATION
```

## Cómo correr / verificar

Raíz (CLI):
```bash
npm install
npm run typecheck                 # tsc --noEmit (debe quedar limpio)
npm run l5a -- <comando>          # corre el CLI vía tsx (sin build step)
```

Dashboard (proyecto aparte, su propio `package.json`/`node_modules`):
```bash
cd apps/dashboard && npm install
npm run dev                       # vite + /api/status y /api/promote local (sin wrangler)
npm run build                     # tsc --noEmit && vite build
```

- **Node 22+**, TypeScript ESM, `moduleResolution: Bundler`, imports sin extensión.
- El CLI corre con **tsx** (no se compila). El core se importa como workspace `@l5a/core`.
- El dashboard **NO** es workspace (es standalone). `scripts/gen.mjs` genera
  `src/generated/companion.ts` SOLO desde `app.config.json` (lista/orden de paquetes); el estado
  (lock/registry) lo lee EN VIVO de `_state/` en R2. Las Pages Functions (`functions/api/*`) y el
  dev middleware (`vite.config.ts`) comparten la lógica de `src/lib/` (status, promote, r2write).
- **Promover desde el dashboard** escribe en R2 vía `aws4fetch` con credenciales que en producción
  salen de las **env vars del proyecto de Pages** (`R2_*`), y en dev del `.env` de la raíz.

## Convenciones

- Mensajes de commit y comentarios de código en **español** (es el idioma del proyecto).
- No introducir dependencias pesadas sin razón. El core usa `@aws-sdk/client-s3`, `fflate`, `zod`.
- Los comandos que escriben R2 (`publish`, `promote`, `migrate --apply`, `gc --apply`) son
  **operaciones sobre datos en vivo** (la app la usan ~25 usuarios). Patrón obligatorio: **dry-run
  primero, mostrar el plan, y pedir confirmación explícita antes del `--apply`/escritura**.

## Gotchas (aprendidos a los golpes)

- **Zip determinista**: `fflate` rechaza mtime fuera de 1980-2099. Se usa una fecha fija con
  componentes **locales** (`new Date(2000,0,1)`), no UTC, para que sea reproducible en cualquier
  huso (la máquina está en Argentina, UTC-3). Ver `packages/core/src/pack.ts`.
- **Migración byte-idéntica**: el espejo local del bucket puede estar DESINCRONIZADO con lo vivo.
  Para migrar sin riesgo, `migrate` copia **server-side** lo que ya existe en R2 (no re-sube) y
  solo sube lo genuinamente nuevo. La fuente de verdad de los bytes pesados es **R2**, no el espejo.
- **Tamaños**: los manifests viejos (hechos a mano) tenían `sizeBytes` mal; el tooling los calcula
  bien. La app deduplica por versión, así que corregir tamaños no dispara re-descargas.

## NO hacer

- ❌ Commitear `assets/`, `dist/`, `.env`, ni `apps/dashboard/src/generated/` (todos gitignored).
- ❌ Tocar `sunandmoon/` en el bucket (es de otra app, el launcher).
- ❌ Borrar en el bucket las sub-features `*/history/`, `*/news/`, `*/tournament/`, `*/rulebooks/`
  (tienen contenido real con su propio sub-manifest; el tooling todavía no las maneja).
- ❌ Cambiar el Public Dev URL del bucket ni pasar las URLs del manifest a relativas (la app vive
  de eso; rompería a los usuarios actuales).
- ❌ Pushear o hacer cambios outward-facing sin que el usuario lo pida.
