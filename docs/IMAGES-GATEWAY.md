# Gateway anti-hotlink para tools/ (en progreso, iniciado desde L5Argentina DB)

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

Construido y documentado del lado de DB (código del Worker + instrucciones de
deploy en `L5Argentina DB/cloudflare/images-gateway/README.md`). El deploy en sí
(`wrangler login` + `wrangler deploy`, servicios gratuitos de Cloudflare) lo
corre el dueño del proyecto a mano — no automatizado todavía.

## Lo que falta ajustar de este lado (Tools) una vez que el Worker esté desplegado

Hoy hay **9 archivos** que arman URLs de imagen pegando
`https://pub-4ab8e43f10604d7fa0f9402a8259a855.r2.dev/tools/` a mano. Una vez que
el Worker tenga URL propia (`https://l5a-tools-gateway.<subdominio>.workers.dev/`
o un Custom Domain), estos deberían apuntar ahí en lugar del r2.dev directo —
si no, siguen expuestos al hotlinking igual que antes, el Worker no los protege
solo:

- `apps/dashboard/public/artistas.html`
- `apps/dashboard/public/reviews/index.html`
- `apps/dashboard/public/reviews/reglas-review.html`
- `apps/dashboard/public/reviews/setnum-review.html`
- `apps/dashboard/public/reviews/versions-HaT.html`
- `apps/dashboard/public/reviews/keyword-review.html`
- `apps/dashboard/public/reviews/title-review.html`
- `apps/dashboard/public/reviews/woh-review.html`
- `docs/revisiones-dashboard.md` (mención en docs, no código — revisar si vale
  actualizar la referencia)

Todos estos corren en `admin.l5argentina.com.ar` (o sus previews `*.pages.dev`),
que ya está en la whitelist de `Referer` del Worker — el cambio de URL no debería
romper nada, solo cambia de dónde sirve el byte.

**No urgente, no bloquea nada existente** — el Worker funciona igual si estos
archivos se migran después. Queda anotado acá para no perderlo, no para hacerlo
ya.
