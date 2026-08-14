/**
 * Lo poquito de Node que usan los tests.
 *
 * Se ejecutan con `npx tsx`, o sea dentro de Node, y lo único que tocan de él es
 * `process.exitCode` para avisar de que algo ha fallado. Declararlo aquí evita
 * traerse el paquete de tipos entero de Node —varios megas de definiciones— solo
 * por una línea, y de paso deja de salir en rojo en el editor.
 *
 * Si algún día un test necesita leer o escribir ficheros, entonces sí tocará
 * instalar `@types/node` en condiciones.
 */

declare const process: { exitCode?: number };
