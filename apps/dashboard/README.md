# @l5a/dashboard

**Panel de control** del bucket (canales debug / staging / production). Muestra una matriz de
versiones por canal, la **salud** de cada archivo (existe / tamaño correcto / roto), el **drift**
respecto del estado en `_state/`, y el indicador **↑ para promover** (cuando un canal tiene una
versión menor que su canal anterior). Además permite **promover entre canales con un botón**.

## Cómo está armado

```
Navegador → Cloudflare Pages (esta SPA)
   GET /api/status   ─────────────►  Pages Function: baja los 3 manifest.json + HEAD
   POST /api/promote ─────────────►  Pages Function: reescribe manifest + _state/ (R2)
                                     (lee R2 público para leer; escribe vía S3 con credenciales)
```

- **`functions/api/status.ts`** — baja los manifests + el lock de `_state/` (en vivo) y devuelve
  el estado agregado. Sin credenciales (todo lectura pública).
- **`functions/api/promote.ts`** — promueve un canal: reescribe `<to>/manifest.json` y
  `_state/channels.lock.json`. Necesita credenciales R2 (env vars del proyecto de Pages).
- **`src/lib/status.ts`** / **`src/lib/promote.ts`** — la lógica; la usan la Function y el dev
  server de Vite (mismo código en los dos lados).
- **`src/lib/r2write.ts`** — escritor R2 vía `aws4fetch` (funciona en Node y en Workers).
- **`src/generated/companion.ts`** — generado por `scripts/gen.mjs` desde
  `apps/companion/app.config.json` (lista/orden de paquetes). El estado (lock/registry) NO se
  empaqueta: se lee EN VIVO de `_state/` en R2.

Salud en 3 niveles: 🟢 existe y el tamaño coincide · 🟡 existe pero el tamaño declarado no
coincide · 🔴 roto (404 / fuera de origen).

## Desarrollo local

```bash
npm install
npm run dev        # http://localhost:5173 — sirve /api/status y /api/promote (sin wrangler)
```

`npm run dev` corre `gen` y sirve las APIs con la misma lógica que producción. Para que
**/api/promote** funcione en dev, lee las credenciales R2 del `.env` de la raíz del repo.

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
   - **Para los botones de promover** (escritura R2), agregá las credenciales — las del `.env`,
     marcando las dos últimas como **Secret/encrypted**:
     - `R2_ACCOUNT_ID`
     - `R2_ACCESS_KEY_ID`
     - `R2_SECRET_ACCESS_KEY` 🔒
     - `R2_BUCKET`

   Sin estas variables, el panel funciona igual (lectura), pero al promover devuelve un error
   "faltan credenciales R2".
4. Pages detecta solo la carpeta `functions/` y publica `/api/status` + `/api/promote`. Cada push
   a `main` redeploya.

### Proteger el panel (imprescindible)

Como **escribe** en el bucket, tiene que estar detrás de login: **Cloudflare Access** (Zero Trust),
apuntando al dominio del Pages (y al `*.pages.dev`), con una policy de quién entra. Ya configurado
para `admin.l5argentina.com.ar`.

## Notas

- El estado (registry + lock) vive en R2 (`_state/`); el dashboard lo lee en vivo, así que el drift
  y la matriz **se refrescan solos** (sin redeploy).
- Promover desde el panel es equivalente a `l5a promote`: no copia bytes (pool compartido), solo
  reescribe el manifest del destino y el lock.
