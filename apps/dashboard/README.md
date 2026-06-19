# @l5a/dashboard

**Panel de control** del bucket (canales debug / staging / production). Muestra una matriz de
versiones por canal, la **salud** de cada archivo (existe / tamaño correcto / roto), el **drift**
respecto del estado en `_state/`, y el indicador **↑ para promover** (cuando un canal tiene una
versión menor que su canal anterior). Permite **promover entre canales con un botón** y tiene el
**buzón → debug**: adjuntar un archivo y enviarlo a debug.

## Cómo está armado

```
Navegador → Cloudflare Pages (esta SPA)
   GET  /api/status  ─────────────►  Pages Function: baja los 3 manifest.json + HEAD
   POST /api/promote ─────────────►  Pages Function: reescribe manifest + _state/ (R2)
   GET  /api/inbox   ─────────────►  Pages Function: lista el buzón (inbox/) vía S3
   POST /api/inbox   ─────────────►  Pages Function: enviar a debug / descartar
   POST /api/upload  ─────────────►  Pages Function: sube el archivo adjunto al buzón
                                     (lee R2 público; escribe/lista vía S3 con credenciales)
```

- **`functions/api/status.ts`** — baja los manifests + el lock de `_state/` (en vivo) y devuelve
  el estado agregado. Sin credenciales (todo lectura pública).
- **`functions/api/promote.ts`** — promueve un canal: reescribe `<to>/manifest.json` y
  `_state/channels.lock.json`. Necesita credenciales R2 (env vars del proyecto de Pages).
- **`functions/api/inbox.ts`** — `GET` lista el buzón; `POST` envía a debug (copia server-side a
  la pool + registry + lock + manifest) o descarta. Necesita credenciales R2.
- **`functions/api/upload.ts`** — recibe el archivo adjunto (mismo origen → sin CORS) y lo escribe
  al buzón. El nombre define paquete + versión (`<pkgId>-<X.Y.Z>.<ext>`). Necesita credenciales R2.
- **`src/lib/status.ts`** / **`promote.ts`** / **`inbox.ts`** — la lógica; la usan las Functions y
  el dev server de Vite (mismo código en los dos lados).
- **`src/lib/r2write.ts`** — escritor/lector R2 vía `aws4fetch` (Node y Workers): put/putBytes/
  list/copy/delete.
- **`src/generated/companion.ts`** — generado por `scripts/gen.mjs` desde
  `apps/companion/app.config.json` (lista/orden de paquetes). El estado (lock/registry) NO se
  empaqueta: se lee EN VIVO de `_state/` en R2.

Salud en 3 niveles: 🟢 existe y el tamaño coincide · 🟡 existe pero el tamaño declarado no
coincide · 🔴 roto (404 / fuera de origen).

## Desarrollo local

```bash
npm install
npm run dev        # http://localhost:5173 — sirve /api/status, /api/promote, /api/inbox, /api/upload
```

`npm run dev` corre `gen` y sirve las APIs con la misma lógica que producción. Para que
**/api/promote**, **/api/inbox** y **/api/upload** funcionen en dev, lee las credenciales R2 del
`.env` de la raíz del repo.

Otros comandos:

```bash
npm run gen          # regenera src/generated/companion.ts desde apps/companion/app.config.json
npm run typecheck
npm run build        # tsc + vite build → dist/
npm run pages:dev    # build + wrangler pages dev dist  (runtime real de Pages)
```

## Deploy a Cloudflare Pages (gratis)

1. **Workers & Pages → Create → Pages → Connect to Git**, elegí el repo.
2. Build:
   - **Root directory:** `apps/dashboard`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Environment variables** (Settings → Environment variables):
   - `NODE_VERSION = 22`
   - **Para promover y para el buzón** (escritura/listado en R2), agregá las credenciales — las del
     `.env`, marcando las dos últimas como **Secret/encrypted**:
     - `R2_ACCOUNT_ID`
     - `R2_ACCESS_KEY_ID`
     - `R2_SECRET_ACCESS_KEY` 🔒
     - `R2_BUCKET`

   Sin estas variables, la **matriz de estado** funciona igual (lectura pública), pero **promover**
   y el **buzón** devuelven "faltan credenciales R2". Ojo: el buzón las necesita **incluso para
   listar** (r2.dev no permite listar el bucket; el listado va por la API S3 firmada).
4. Pages detecta solo la carpeta `functions/` y publica `/api/status`, `/api/promote`, `/api/inbox`
   y `/api/upload`. Cada push a `main` redeploya.

### Proteger el panel (imprescindible)

Como **escribe** en el bucket, tiene que estar detrás de login: **Cloudflare Access** (Zero Trust),
apuntando al dominio del Pages (y al `*.pages.dev`), con una policy de quién entra. Ya configurado
para `admin.l5argentina.com.ar`.

## Notas

- El estado (registry + lock) vive en R2 (`_state/`); el dashboard lo lee en vivo, así que el drift
  y la matriz **se refrescan solos** (sin redeploy).
- Promover desde el panel es equivalente a `l5a promote`: no copia bytes (pool compartido), solo
  reescribe el manifest del destino y el lock.
