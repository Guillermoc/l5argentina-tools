# Cómo funciona l5a-tools (explicación funcional)

Este documento explica **qué hace** el proyecto y **cómo mueve la información**, en lenguaje
llano. No hace falta saber programar para entenderlo.

---

## 1. El problema que resuelve

Tenés una app (el buscador de cartas) que, para funcionar, necesita bajarse datos: el
catálogo de cartas, las imágenes, las reglas, los filtros, el changelog. Esos datos están
en un **bucket de Cloudflare R2**, que es básicamente un disco en la nube de **solo lectura**:
la app baja de ahí, nunca escribe.

El bucket tiene **tres versiones del mismo set de datos**, una por cada etapa de madurez:

- **debug** — donde probás cosas nuevas, puede romperse.
- **staging** — pre-producción, lo que está por salir.
- **production** — lo estable, lo que ven tus 25 usuarios reales.

Hasta ahora cargabas y movías esos archivos **a mano**: copiabas zips, editabas un índice
(`manifest.json`) escribiendo tamaños y versiones a dedo, y para "pasar algo de debug a
producción" copiabas carpetas. Es lento, y es fácil equivocarse (dejar un archivo viejo,
poner mal un tamaño, olvidarte de actualizar el índice).

**`l5a-tools` automatiza todo eso.** Vos editás los datos en tu compu, corrés un par de
comandos, y la herramienta se encarga de empaquetar, calcular todo, subir solo lo que cambió
y mover las cosas de una etapa a la otra sin errores.

---

## 2. La idea central: la app lee un "índice"

Lo más importante de entender es el **manifest.json**. Es un **índice** que vive en cada
canal del bucket. Cuando la app arranca, lo primero que hace es leer ese índice. El índice
dice, para cada "paquete" de datos:

- qué es (filtros, cartas, reglas, imágenes, changelog),
- qué **versión** tiene,
- de qué **URL** se baja,
- cuánto **pesa**.

La app compara la versión de cada paquete con la que ya tiene guardada. **Si la versión es la
misma, no baja nada.** Si cambió, baja solo ese paquete. Por eso el índice es el corazón de
todo: cambiar el índice es lo que le avisa a la app "hay algo nuevo".

> Regla de oro: **la app decide qué bajar mirando la versión, no la URL.** Esto va a explicar
> por qué podemos mover archivos de lugar sin que nadie re-descargue nada.

---

## 3. Qué se guarda y dónde

Hay **tres lugares** donde vive la información, y cada uno guarda algo distinto a propósito:

```
┌─────────────────────┐     ┌──────────────────────┐     ┌────────────────────────┐
│   Tu repo (git)     │     │  Tu compu (assets/)  │     │  Bucket R2 (la nube)   │
│  "la receta"        │     │  "los ingredientes   │     │  "el plato servido"    │
│                     │     │   pesados"           │     │                        │
│ · filters.json      │     │ · imágenes sueltas   │     │ · pool/ (los archivos) │
│ · rules.json        │     │ · base de cartas     │     │ · debug/manifest.json  │
│ · changelog.md      │     │                      │     │ · staging/manifest.json│
│ · qué versión hay   │     │  NO va a git         │     │ · production/manifest…  │
│   en cada canal     │     │  (pesado + copyright)│     │                        │
└─────────────────────┘     └──────────────────────┘     └────────────────────────┘
```

### a) El repo de git — "la receta"
Guarda lo **liviano y de texto**: los filtros, las reglas, el changelog, y sobre todo el
**estado declarado** (qué versión de cada cosa está en cada canal). Esto se beneficia de tener
historial: podés ver quién cambió qué y cuándo. **Las imágenes nunca van acá** (son pesadas y
tienen copyright).

### b) `assets/` en tu compu — "los ingredientes pesados"
Las imágenes de las cartas y la base, en crudo. Viven solo en tu máquina (y en el bucket),
nunca en git. La herramienta las lee de acá para empaquetarlas y subirlas.

### c) El bucket R2 — "el plato servido"
Lo que la app efectivamente consume: los archivos ya empaquetados (en una carpeta `pool/`,
que ya vamos a ver) y los tres índices `manifest.json`, uno por canal.

---

## 4. Los cuatro archivos de control

La herramienta se apoya en cuatro archivos (los tres primeros viven en git, son "la receta"):

| Archivo | Qué guarda | Analogía |
|---|---|---|
| **`app.config.json`** | La lista de paquetes que existen y de dónde sale cada uno. | El menú: qué platos hay. |
| **`versions.json`** | La versión **actual** de cada paquete (la que tenés en tu compu). Esto lo subís vos cuando cambiás algo. | "Esta es la receta nueva, versión 1.1." |
| **`channels.lock.json`** | Qué versión está **publicada en cada canal** (debug/staging/production). | La pizarra: "en producción servimos la 1.0, en debug probamos la 1.1." |
| **`registry.json`** | El **libro mayor**: cada versión que alguna vez se publicó, con su URL, tamaño y huella digital. | El archivo histórico de todo lo cocinado. |

Con estos cuatro, la herramienta siempre sabe: qué existe, qué tenés vos, qué hay en cada
canal, y dónde está cada cosa.

---

## 5. El "pool": guardar cada archivo una sola vez

Antes, cada canal tenía su **propia copia** de cada archivo. Como las imágenes son casi 1 GB
y son iguales en los tres canales, había **~3 GB de copias repetidas**. Un desperdicio.

El modelo nuevo usa un **pool**: una carpeta única (`pool/`) donde cada archivo se guarda
**una sola vez**, identificado por su tipo, su nombre y su versión:

```
pool/images/celestial/1.0/celestial.zip      ← una sola copia
pool/images/celestial/1.1/celestial.zip      ← la versión nueva, otra copia
pool/database/cards_db/2.1.0/cards_db.zip
...
```

Y los tres índices **apuntan** al pool. Por ejemplo, si debug usa la imagen celestial 1.1 y
producción todavía usa la 1.0, los dos archivos conviven en el pool y cada índice apunta al
que le corresponde:

```
debug/manifest.json       → celestial apunta a  pool/.../celestial/1.1/...
staging/manifest.json     → celestial apunta a  pool/.../celestial/1.0/...
production/manifest.json  → celestial apunta a  pool/.../celestial/1.0/...
```

**Ventaja enorme:** mover algo de un canal a otro ya no copia archivos pesados. Solo cambia a
qué versión del pool apunta el índice. Promover es casi instantáneo.

> Una propiedad clave: **cada archivo del pool es inmutable.** Una vez que `celestial/1.1`
> está ahí, nunca se modifica. Si cambiás la imagen, se crea `celestial/1.2`. Así, lo que
> probaste en debug es **exactamente los mismos bytes** que después llega a producción.

---

## 6. Los comandos: qué hace cada uno

La herramienta se usa con comandos cortos. Estos son los cinco que importan:

### `build` — "preparar"
Mira tus datos locales, los empaqueta (las carpetas de imágenes se comprimen en zip), y
calcula para cada uno su tamaño y su huella digital. **No sube nada**, solo prepara y te
muestra un resumen: qué es nuevo, qué ya estaba, qué falta.

Tiene una propiedad importante: el empaquetado es **reproducible**. El mismo contenido produce
siempre el mismo archivo idéntico. ¿Para qué sirve? Para que la herramienta sepa **de verdad**
si algo cambió o no. Si tocaste un archivo pero el contenido es igual, no genera una versión
nueva al pedo (y la app no re-descarga al pedo).

### `status` — "ver la pizarra"
Te muestra una tabla con qué versión de cada paquete está en cada canal. De un vistazo ves,
por ejemplo, que debug va adelantado y producción está más atrás:

```
  package    debug     staging   production
  -----------------------------------------
  cards_db   2.1.0     1.2.38    1.2.38     ◂ difiere
  rules      2.1.1     2.1.0     2.1.0      ◂ difiere
  celestial  1.0       1.0       1.0
```

### `publish` — "subir a un canal" (normalmente debug)
Toma tus datos actuales y los publica en un canal:
1. Sube al pool **solo los archivos nuevos** (los que ya estaban no se re-suben).
2. Regenera el índice de ese canal apuntando a esas versiones.
3. Anota en la pizarra (`channels.lock.json`) que ese canal ahora tiene esas versiones.

Antes de tocar nada, **arma y valida el índice**. Si falta algún ingrediente o algo está mal,
te avisa y **no sube nada a medias**.

### `promote` — "ascender de un canal a otro"
Esto es lo que reemplaza al "copiar carpetas a mano". Le decís, por ejemplo,
`promote debug staging`, y la herramienta:
1. Mira qué versiones tiene debug.
2. Reescribe el índice de staging para que apunte **a las mismas versiones** (mismos archivos
   del pool, ya están ahí, **no se copia ni un byte**).
3. Anota en la pizarra que staging ahora tiene esas versiones.

Como no mueve archivos pesados, es instantáneo. Y como apunta a los **mismos bytes** que ya
estaban en debug, tenés la garantía de que lo que probaste es idéntico a lo que asciende.

### `verify` — "controlar que todo esté sano"
Baja los índices reales del bucket (en vivo) y chequea, paquete por paquete, que cada archivo
exista de verdad, que pese lo que dice, y que las URLs sean del bucket correcto. Es tu red de
seguridad después de publicar o promover.

### `gc` — "limpieza" (basura del pool)
Con el tiempo quedan versiones viejas en el pool que ya **ningún canal usa**. `gc` las
encuentra y (si se lo pedís) las borra. Por defecto solo te las **muestra**, no borra nada,
para que revises antes.

---

## 7. El flujo completo, con un ejemplo

Querés actualizar las imágenes del set **celestial**. Así se ve de punta a punta:

```
1. Reemplazás las imágenes en  assets/images/celestial/   (en tu compu)
        │
2. Subís la versión en versions.json:   "celestial": "1.0"  →  "1.1"
        │
3. l5a publish -c debug
        │   · empaqueta celestial → calcula tamaño y huella
        │   · sube  pool/images/celestial/1.1/  (solo eso, lo demás ya estaba)
        │   · reescribe debug/manifest.json apuntando a 1.1
        │   · pizarra: debug.celestial = 1.1
        ▼
   ┌──────────────────────────────────────────────┐
   │ debug      → celestial 1.1   (NUEVO)          │
   │ staging    → celestial 1.0   (sin cambios)    │
   │ production → celestial 1.0   (sin cambios)    │
   └──────────────────────────────────────────────┘
   → Los usuarios de debug bajan la imagen nueva. Staging y producción ni se enteran.
        │
4. Probás en debug con la app real. Está todo bien.
        │
5. l5a promote debug staging
        │   · staging/manifest.json pasa a apuntar a celestial 1.1 (0 bytes copiados)
        │   · pizarra: staging.celestial = 1.1
        ▼
   ┌──────────────────────────────────────────────┐
   │ debug      → celestial 1.1                    │
   │ staging    → celestial 1.1   (mismos bytes    │
   │                               que probaste)   │
   │ production → celestial 1.0   (sin cambios)    │
   └──────────────────────────────────────────────┘
        │
6. Cuando estés seguro:  l5a promote staging production
        ▼
   Todos en 1.1. Los usuarios reales bajan la imagen nueva.
```

Cada uno de esos pasos queda registrado en git (en la pizarra), así que siempre podés ver
**qué se promovió y cuándo** — es tu registro de auditoría, sin esfuerzo.

---

## 8. Por qué los 25 usuarios no se ven afectados

Una pregunta clave: si reorganizamos todo esto, ¿hay que actualizar la app y molestar a los
usuarios? **No.** Porque:

- La app solo conoce el **índice** (`manifest.json`). Nunca sabe cómo organizamos los archivos
  por detrás (pool o no pool, da igual).
- El índice mantiene **exactamente la misma forma** de siempre, con URLs absolutas.
- Cuando movemos los archivos al pool **conservando las versiones**, la app ve la misma versión
  que ya tenía → **no baja nada**.
- Los archivos viejos se quedan en su lugar hasta que `verify` confirma que el índice nuevo
  está sano; recién ahí se limpian.

En resumen: la reorganización es **puro trabajo interno**; lo que la app ve sigue igual.

---

## 9. Resumen en una frase

> Vos editás los datos en tu compu y declarás versiones; `l5a-tools` empaqueta, calcula y sube
> **solo lo que cambió** al bucket, guardando cada archivo **una sola vez**, y te deja
> **ascender** los datos de debug a staging a producción con un comando, sin copiar archivos
> pesados y sin tocar la app.
