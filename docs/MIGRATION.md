# Migración: de carpetas-por-canal al pool

Hoy el bucket tiene los artefactos físicos repartidos en cada canal
(`debug/cards-2.1.0.zip`, `production/cardImages/celestial-1.0.zip`, …). El modelo
nuevo usa un **pool compartido** (`pool/<type>/<id>/<version>/`) que los tres canales
apuntan. Esta es la guía para migrar **sin que los ~25 usuarios re-descarguen nada**.

## Principio

El `manifest.json` que ve la app no cambia de forma; solo cambian las **URLs** a las
que apunta (de `/debug/cardImages/...` a `/pool/...`). Como la app decide bajar comparando
**`version`** y no la URL, reescribir las URLs **con las mismas versiones** no dispara
descargas. Los archivos viejos quedan intactos hasta que `verify` confirme y `gc` limpie.

## Paso a paso

1. **Conseguir los bytes de todas las versiones vivas.** Mirá `channels.lock.json`: las
   versiones referenciadas hoy son las de debug (las más nuevas) más las de staging/production
   (algunas más viejas: `cards_db 1.2.38`, `rules 2.1.0`, `changelog 2.1.0`). Todas existen en
   el espejo local del bucket (`L5Argentina Bucket/<canal>/...`).

2. **Poblar `assets/`** con las fuentes de las versiones **actuales** (las de `versions.json`):
   - `assets/cards/` → contenido de la base de cartas (se empaqueta a zip).
   - `assets/images/<edición>/` → imágenes sueltas de cada set.

3. **Publicar debug:**
   ```bash
   npm run l5a -- publish -c debug
   ```
   Sube al pool las versiones actuales y reescribe `debug/manifest.json` apuntando al pool.

4. **Adoptar las versiones viejas que aún viven en staging/production** (las que no coinciden
   con la fuente actual). Para cada una hay que subir su blob al pool y registrarla. Hasta tener
   el comando `l5a adopt` (backlog), se hace puntualmente: subir el archivo viejo al pool con la
   misma `(type/id/version)` y agregar su entrada a `registry.json`. Luego:
   ```bash
   npm run l5a -- promote debug staging --dry-run   # revisar el diff
   ```

5. **Verificar y limpiar:**
   ```bash
   npm run l5a -- verify              # los 3 canales contra el bucket en vivo
   npm run l5a -- gc                  # listar huérfanos del pool (--apply para borrar)
   ```
   Los archivos viejos en `debug/cardImages/...` etc. quedan fuera del pool; se borran a mano
   o con una pasada de limpieza una vez confirmado que ningún manifest los referencia.

> Recomendación: hacer la migración primero en **debug**, verificar con la app real, y recién
> después tocar staging/production.
