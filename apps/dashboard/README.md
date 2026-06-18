# @l5a/dashboard

Dashboard **solo-lectura** del estado de los 3 canales del bucket (debug / staging /
production). Muestra una matriz de versiones por canal, la **salud** de cada archivo
(existe / tamaño correcto / roto), el **drift** respecto de lo declarado en git, y el
indicador **↑ para promover** (cuando un canal tiene una versión menor que su canal anterior).

Fase 1 del panel de control (las acciones de escritura — promover, novedades — vienen después).

## Cómo está armado

```
Navegador → Cloudflare Pages (esta SPA)
                │  GET /api/status
                ▼
        Pages Function (functions/api/status.ts)
                │  baja los 3 manifest.json + HEAD de cada archivo
                ▼
        R2 público (r2.dev)
```

- **`functions/api/status.ts`** — Pages Function: baja los manifests del lado servidor
  (sin CORS) y devuelve el estado agregado.
- **`src/lib/status.ts`** — la lógica de fetch + chequeo de salud. La usan la Function,
  el dev server de Vite y el smoke test (mismo código en los 3 lados).
- **`src/generated/companion.ts`** — generado por `scripts/gen.mjs` desde
  `apps/companion/app.config.json` + `channels.lock.json`. Es lo que permite comparar
  "lo publicado" (bucket en vivo) contra "lo declarado en git" → detección de drift.
- **`src/App.tsx`** — la UI (React + Tailwind).

Salud en 3 niveles: 🟢 existe y el tamaño coincide · 🟡 existe pero el tamaño declarado
no coincide · 🔴 roto (404 / fuera de origen).

## Desarrollo local

```bash
npm install
npm run dev        # http://localhost:5173 — incluye /api/status (sin wrangler)
```

`npm run dev` corre `gen` automáticamente y sirve `/api/status` con la misma lógica que
producción, así que ves datos reales del bucket en vivo.

Otros comandos:

```bash
npm run gen          # regenera src/generated/companion.ts desde apps/companion
npm run typecheck
npm run build        # tsc + vite build → dist/
npm run pages:dev    # build + wrangler pages dev dist  (runtime real de Pages)

# smoke test de la lógica contra el bucket real (desde la raíz del repo):
npx tsx apps/dashboard/scripts/smoke.ts
```

## Deploy a Cloudflare Pages (gratis)

1. En el dashboard de Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**,
   elegí el repo.
2. Configuración de build:
   - **Root directory:** `apps/dashboard`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Variable de entorno:** `NODE_VERSION = 22`
3. Pages detecta solo la carpeta `functions/` y publica `/api/status`. Cada push a `main`
   redeploya; cada rama tiene su preview.

### Proteger el panel (recomendado)

Como muestra el estado interno de los canales, conviene ponerlo detrás de login con
**Cloudflare Access** (Zero Trust, gratis hasta 50 usuarios): **Zero Trust → Access →
Applications → Add → Self-hosted**, apuntando al dominio del Pages, con una policy de
"emails permitidos" o login con Google/GitHub. Cero código.

## Notas

- Es **solo lectura**: nunca escribe en R2 ni necesita credenciales. Solo baja archivos públicos.
- El drift se calcula contra el `channels.lock.json` que estaba en git **al momento del build**.
  Si cambiás el lock, redeployá (o se redeploya solo al pushear) para refrescar la referencia.
