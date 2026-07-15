# MoldeLab

Convierte una imagen en un cortador, sello o eyector listo para imprimir en 3D. Todo el procesado ocurre en el navegador: la imagen no sale del ordenador y no hace falta backend.

```
npm install
npm run dev        # http://localhost:5173
npm run build

npx tsx test/geometry.test.ts   # manifold, normales, volumen, tamaño del STL
npx tsx test/catalog.test.ts    # los 40 productos, uno a uno
npx tsx test/threemf.test.ts    # el 3MF por dentro: OPC, índices, soldadura
```

## Catálogo

40 productos en 4 categorías. Cada uno declara **qué controles enseña** y **qué sólidos construye**; la interfaz se dibuja sola a partir de eso. Añadir un producto es añadir una entrada en `src/lib/catalog.ts`, no tocar la UI.

**Repostería (12)** · Cortador · Cortador con estampa · Sello · Sello con mango · Plantilla · Topper de tarta · Eyector silueta / redondo / cuadrado · Multicortador · Placa de entrenamiento · Molde de impronta

**Llaveros (10)** · Silueta · Con relieve · Calado · **De texto** · **Imagen + texto** · **En capas** · **Matrícula** · **Articulado** (bisagra viva) · Chapa redonda · Chapa rectangular

**Letreros (6)** · De pie · De pared · Calado · **Letra grande** (texto → peana) · **Curvo** (texto en arco) · **En capas de color**

**Personalizados (12)** · Extrusión · Placa con relieve · Placa grabada · Solo contorno · Posavasos · Marcapáginas · **Guía para alambre** · **Placa para colorear** · **Placa QR** · **Abridor con sello** · **Caja con tapa** · **Rompecabezas**

### Fuentes: texto y QR no tocan el pipeline

El pipeline solo entiende `ImageData`. El texto (recto o en arco) y el QR se **rasterizan a un canvas** en `src/lib/sources.ts` y entran por la misma puerta que un PNG subido. Los generadores nunca saben de dónde salió el dibujo — un "llavero de texto" es literalmente el llavero silueta alimentado con texto rasterizado. Cero código de texto en la geometría.

El QR usa `qrcode-generator` con corrección M y zona de silencio de 2 módulos; cada módulo son bloques de píxeles y marching squares fusiona los adyacentes él solo.

### Booleana 2D: la pieza que faltaba

El puzzle y el articulado necesitan **intersección**, no solo offset: recortar la silueta con una rejilla de celdas. `intersect()` en `clipper.ts` lo resuelve en 2D antes de extruir. La clave del puzzle es que cada arista interior es UNA geometría canónica: la celda de un lado la recorre tal cual (lengüeta) y la del otro la recorre invertida (muesca) — no existen dos versiones de la misma arista que puedan discrepar, así que las piezas encajan por construcción, más un rebaje de 0,12 mm por lado de juego.

El articulado usa bisagras vivas: puentes de 0,6 mm de alto (3 capas) entre segmentos rígidos. Un pasador de verdad exigiría holguras 3D; la bisagra viva se imprime plana y dobla miles de veces.

Los productos "en capas" exportan **una pieza por banda de umbral**: se cambia de filamento en el cambio de capa del laminador y sale a colores.

## Cómo funciona

El pipeline entero está en `src/lib/` y no depende de React. Se puede sacar a un worker, a Node o a una CLI sin tocar nada.

```
imagen
  │
  ├─ binarize        umbral sobre alfa (si lo hay) o luminancia
  ├─ cleanupMask     cierre morfológico: tapa poros, une trazos rotos
  ├─ fillEnclosed    flood fill desde el borde → silueta maciza
  │
  ├─ traceContours   marching squares → segmentos → lazos cerrados
  ├─ simplify        Douglas-Peucker
  ├─ smooth          Chaikin
  ├─ resample        puntos cada 1,2 mm
  ├─ anidamiento     par = isla (CCW), impar = agujero (CW)
  │
  └─ generadores     cutter / stamp / ejector → Mesh → STL binario
```

Se separa en dos fases a propósito. `vectorize()` es lo caro y solo se rehace cuando cambia algo del contorno. `buildPieces()` es barato y se rehace con cada movimiento de un slider. Por eso la vista previa va fluida aunque la imagen sea grande.

## Las cuatro decisiones que sostienen todo lo demás

**1. El cortador es un loft, no una lista de casos.**
La pared se describe como un perfil vertical: una lista de anillos `(z, offset exterior, offset interior)`. La pestaña ancha de abajo, la pared recta y el filo fino de arriba son solo entradas de esa lista. Añadir una nueva forma de pared es añadir un anillo, no escribir código nuevo de mallado. `src/lib/generators/cutter.ts`.

**2. Hay dos offsets, y cada uno se usa donde toca.**
- *Por normales* (`polygon.ts`): conserva la correspondencia 1:1 entre puntos, que es lo que necesita el loft. Rápido. En un ángulo muy agudo se autointersecta.
- *Clipper* (`clipper.ts`): resuelve las autointersecciones de verdad, pero cambia el número de puntos y puede partir un polígono en varios.

El cortador y el tubo del eyector usan el primero: aunque el contorno se cruce, la malla sigue cerrada. Todo lo que pasa por earcut (placa del sello, cara del émbolo) usa el segundo, porque a earcut un polígono cruzado le rompe la triangulación y deja la pieza abierta.

**3. El ángulo de salida del relieve se hace apilando prismas, no inclinando paredes.**
Inclinar la pared exige offsetear la cara superior, y eso rompe la correspondencia 1:1 del loft. En su lugar el relieve son tres prismas rectos cada vez más pequeños. A 0,2 mm de capa la escalera resultante es exactamente lo que iba a imprimir la máquina de todas formas, y cada escalón cierra por su cuenta.

**4. No hay booleanas 3D en ningún sitio.**
Restar un dibujo de una placa (grabado, estarcido, calado) no se hace con una booleana de mallas, sino en 2D: el trazo entra como *agujero* del polígono antes de extruir, y Clipper resuelve el resultado. Para el grabado en hueco la placa se parte en dos capas y solo la de arriba lleva el trazo restado. Las piezas que sí se solapan (placa + relieve + anilla) se exportan solapadas: el laminador las funde, y cada sólido cierra por separado.

## Qué se comprueba en los tests

Un STL con las normales del revés se ve bien en pantalla y sale inimprimible. Así que `test/geometry.test.ts` no mira píxeles: audita la malla.

- **Manifold**: cada arista dirigida aparece exactamente una vez en cada sentido. Cero aristas sueltas.
- **Cerrado**: la suma de normales ponderadas por área da ~0.
- **Orientación**: el volumen con signo es positivo → las normales miran hacia fuera.
- **Volumen**: un cortador recto tiene que medir perímetro × pared × altura. Sale al 0,0 %.
- **STL**: el archivo pesa exactamente 84 + 50 × triángulos bytes.

El sello y el émbolo son uniones de sólidos que se solapan (placa + relieve + tirador). Eso es válido: el laminador los une. Lo que se audita es que **cada sólido cierre por separado**.

`catalog.test.ts` pasa los 40 productos por una silueta real (una estrella de cinco puntas con un agujero) y comprueba que ninguno devuelva geometría vacía, con NaN, con volumen negativo o con triángulos degenerados. Un producto roto que la interfaz sigue enseñando es peor que un producto que no existe.

## Parámetros que importan de verdad

| Parámetro | Por qué |
|---|---|
| `bladeThickness` 0,4 mm | Un filo de una sola línea de extrusión. Más fino no se imprime; más grueso aplasta la masa en vez de cortarla. |
| `wallThickness` 1,2 mm | Tres perímetros con boquilla de 0,4. Aguanta que lo aprietes con la mano. |
| `flangeWidth` 1,6 mm | La pestaña de abajo es lo que evita que el cortador se despegue de la cama a mitad de impresión. |
| `ejectorClearance` 0,35 mm | Menos y el émbolo se agarrota; más y la masa se cuela por los lados. |
| `simplify` 0,15 mm | Por debajo de la resolución de la boquilla, más puntos solo engordan el STL. |

## Estructura

```
src/
  types.ts               parámetros y tipos del dominio
  lib/
    image.ts             binarizado, morfología, flood fill
    contours.ts          marching squares
    polygon.ts           área, orientación, RDP, Chaikin, offset por normales
    clipper.ts           offsets robustos y saneado
    mesh.ts              loft, cap, extrusión, cilindro
    stl.ts               exportador STL binario + ZIP
    threemf.ts           exportador 3MF (soldadura de vértices + OPC)
    pipeline.ts          orquestador
    shapes.ts            círculo, rectángulo redondeado, estadio, anilla, púas
    sources.ts           texto, texto en arco, imagen+texto y QR → ImageData
    catalog.ts           el registro de los 26 productos
    generators/
      cutter.ts          perfil vertical + tubos
      stamp.ts           placa + relieve escalonado
      ejector.ts         cuerpo + émbolo, en silueta / redondo / cuadrado
      catalog-parts.ts   estarcido, topper, llaveros, letreros, placas, rejilla
      extra-parts.ts     capas, articulado, guía alambre, colorear, abridor, caja, puzzle, matrícula
  components/
    Viewer.tsx           R3F, cama de impresión, vista despiezada
    Controls.tsx         catálogo, buscador y controles dinámicos
  App.tsx
test/
  geometry.test.ts       auditoría de mallas
  catalog.test.ts        los 40 productos
  threemf.test.ts        el 3MF descomprimido y verificado por dentro
```

## Marca de agua

Dos marcas, en dos sitios distintos:

- **En el visor** (`Viewer.tsx`): un overlay HTML sobre el canvas, no dentro de la escena 3D — así se lee nítido y no gira con el modelo. Firma en pantalla, nada más.
- **Grabada en la pieza** (`watermark.ts`): geometría real que viaja dentro del STL y del 3MF. El texto se rasteriza a canvas, se vectoriza con el mismo marching squares del pipeline (las tripas de la "a" y la "o" se detectan como agujeros), y se hunde 0,6 mm en la base de la pieza. Se aplica al final, sobre las piezas ya construidas, y solo a las que tienen base plana donde grabar: un cortador (hueco) se salta, una placa o un llavero no. Es lo último que toca la geometría — firma del taller, no parte del diseño.

## Formatos de salida

**3MF (por defecto).** Un 3MF es un ZIP OPC con un XML dentro. Frente al STL trae las dos cosas que aquí importan: **unidades** (`unit="millimeter"` — se acabó el cortador de 7 cm importado como 7 m) y **varios objetos por archivo** (cortador + sello, caja + tapa: entran nombrados y separados en el laminador). Las mallas internas son sopa de triángulos; el 3MF exige vértices indexados, así que `threemf.ts` los **suelda**: cuantización a 1 µm y deduplicación por clave. Cada vértice compartido se escribe una vez en vez de seis, y el XML comprime de maravilla — el mismo modelo pesa ~6x menos que en STL.

**STL.** El clásico, por compatibilidad. Binario, al byte: 84 + 50×triángulos. Si el producto tiene varias piezas salen en un ZIP (nivel 0: el STL binario no comprime).

**Descargas.** Guardar un archivo desde el navegador falla de tres maneras distintas, y `save.ts` las ataca en orden:

1. **`showSaveFilePicker`** (Chrome/Edge): el diálogo nativo de "Guardar como". Es la única vía que suele funcionar dentro de previews embebidos, porque el permiso lo da el usuario en el diálogo, no el iframe.
2. **Ancla + blob** con revoke a 10 s: revocar la URL justo después del `click()` aborta la descarga en Firefox/Safari. Su trampa: en un iframe con sandbox sin `allow-downloads` el click se ignora **en silencio** — no hay excepción que capturar.
3. Por eso, si la app detecta que corre **embebida** (`window.self !== window.top`) y el picker no está disponible, no finge: avisa de que el preview bloquea descargas y de que hay que abrirla en una pestaña propia. Un banner lo advierte ya al arrancar.

## Limitaciones conocidas

- El cortador usa offset por normales, así que en una punta con un ángulo muy cerrado la pared puede plegarse sobre sí misma. La malla sigue siendo válida y el laminador la resuelve, pero el resultado es feo. Subir `simplify` o `smooth` lo arregla. Detectarlo automáticamente y avisar en la interfaz está a medias: `offsetError()` en `clipper.ts` ya compara ambos offsets, falta cablearlo a un aviso.
- La peana del letrero de pie hace la ranura partiendo el bloque en dos, no restando un prisma. Funciona, pero la inclinación (`standAngle`) desplaza la ranura en vez de girarla de verdad.
- El multicortador reparte las copias en rejilla sin comprobar que quepan en la cama.
- El abridor impreso en PLA es decorativo: el hint ya lo dice, PETG macizo o nada.
- El QR impreso se escanea bien a partir de ~60 mm con módulos de relieve alto y buen contraste de filamento; por debajo depende del móvil.

## Siguientes pasos

- **Mover `vectorize()` a un Web Worker.** Con imágenes de 700 px la UI se congela al mover un slider. Es deuda técnica, no una feature: cuanto más código de generadores haya, más caro será moverlo.
- Colocación automática de piezas en la cama, con detección de colisiones.
- Cablear `offsetError()` a un aviso cuando el contorno tiene picos que el offset no puede resolver.
