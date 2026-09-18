# Gateway anti-hotlink para tools/ (iniciado desde L5Argentina DB)

**Qué es:** un Worker de Cloudflare nuevo (`images-gateway`, vive en
`L5Argentina DB/cloudflare/images-gateway/`, no acá) que pone un chequeo de
`Referer` delante del prefijo `tools/` del bucket `l5r-cards`. Nace de `DAT-17`
del roadmap de DB: el problema no es que bajen imágenes puntuales (eso sigue
siendo público y gratis), sino que alguien arme una app web propia embebiendo
`tools/images/` como si fuera su repositorio de arte — un `<img src>` desde un
dominio ajeno manda `Referer`, un fetch de script/CI no. El Worker deja pasar
lo segundo y bloquea lo primero.

**Qué NO cambia:** el Public Dev URL de R2 (`pub-....r2.dev`) sigue intacto para
companion/app/launcher — ver "Reglas de oro" en `docs/BUCKET.md`. Esto es una
puerta nueva y separada, solo para `tools/`. `rawMirror.ts` sigue escribiendo
`tools/cards.json` / `tools/rules.json` / `tools/filters.json` exactamente
igual que hoy; lo único que cambia es *por dónde se lee* ese prefijo.

## Estado

Desplegado. URL del Worker: `https://l5a-tools-gateway.guillermoecarranza.workers.dev`
(sin Custom Domain, `*.workers.dev` gratuito). Confirmado con `curl`: 200 sin
Referer, 403 con Referer ajeno.

## Migración de URLs (hecha, 2026-09-18)

Los 9 archivos que armaban la URL de imagen pegando
`https://pub-4ab8e43f10604d7fa0f9402a8259a855.r2.dev/tools/` a mano ahora apuntan
a `https://l5a-tools-gateway.guillermoecarranza.workers.dev/` (el Worker antepone
`tools` internamente, así que el resto del path no cambia):

- `apps/dashboard/public/artistas.html`
- `apps/dashboard/public/reviews/index.html`
- `apps/dashboard/public/reviews/reglas-review.html`
- `apps/dashboard/public/reviews/setnum-review.html`
- `apps/dashboard/public/reviews/versions-HaT.html`
- `apps/dashboard/public/reviews/keyword-review.html`
- `apps/dashboard/public/reviews/title-review.html`
- `apps/dashboard/public/reviews/woh-review.html`
- `docs/revisiones-dashboard.md`

Todos corren en `admin.l5argentina.com.ar` (o sus previews `*.pages.dev`), que
está en la whitelist de `Referer` del Worker.

## Convención a partir de ahora

Cualquier código nuevo de este repo que arme URLs de imagen para `tools/images/`
(o cualquier otro sub-path de `tools/`) va contra
`https://l5a-tools-gateway.guillermoecarranza.workers.dev/<path-sin-"tools/">`,
**no** contra el r2.dev directo. El r2.dev directo sigue siendo la única puerta
para companion/app/launcher (canales `pool/`, fuera de `tools/`) — ver "Reglas de
oro" en `docs/BUCKET.md`. Esto es solo para lo que cuelga de `tools/`.
