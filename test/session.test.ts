/**
 * Lo que se guarda en el navegador tiene que salir limpio.
 *
 * El almacén del navegador lo puede tocar cualquiera: una extensión, la consola,
 * otra pestaña. Así que al LEER no se puede dar por bueno lo que hay, y al
 * ESCRIBIR no se puede reenviar tal cual lo que venga de fuera — aunque se haya
 * comprobado que vale. Comprobar y reenviar deja pasar el valor ajeno: hay que
 * devolver el nuestro. Es lo que se cuela sin verse, y por lo que el análisis de
 * seguridad ha bajado la nota dos veces.
 *
 * Se prueba con un almacén de mentira, que es lo único que le falta a Node.
 */

// El almacén de mentira se monta ANTES de importar nada, porque los módulos lo
// buscan al cargarse. Por eso los imports son dinámicos y hace falta esta línea
// para que TypeScript trate el fichero como módulo y admita `await` arriba.
export {};

const guardado = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => guardado.get(k) ?? null,
  setItem: (k: string, v: string) => void guardado.set(k, v),
  removeItem: (k: string) => void guardado.delete(k),
  clear: () => guardado.clear(),
};

const { loadSession, saveSession } = await import('../src/lib/session');
const { cleanParams } = await import('../src/lib/presets');
const { DEFAULTS } = await import('../src/types');
const { FONT_STYLES } = await import('../src/lib/font');

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
}

/** ¿Queda algún carácter de control? Se mira por código, sin escribir ninguno
 *  en el propio fichero. */
function tieneControl(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

const CONTROL = String.fromCharCode(0) + String.fromCharCode(7) + String.fromCharCode(27);

console.log('MoldeLab — auditoría de lo que se guarda en el navegador\n');

// --- Leer basura del almacén -------------------------------------------------

guardado.set(
  'moldelab-sesion',
  JSON.stringify({
    params: {
      product: '../../etc/passwd',
      textContent: `hola${CONTROL}mundo`,
      targetWidthMm: Number.MAX_VALUE * 2,
    },
    mark: `Taller${CONTROL}`,
    markStyle: 'no-existe-esta-fuente',
    markSize: 9999,
    markArc: 'sí',
  }),
);

const s = loadSession();

check('un producto inventado no pasa', s.params?.product === DEFAULTS.product,
  `salió «${s.params?.product}»`);
check('los caracteres de control se caen del texto',
  !tieneControl(s.params?.textContent ?? ''), JSON.stringify(s.params?.textContent));
check('un número imposible no pasa', Number.isFinite(s.params?.targetWidthMm ?? NaN),
  String(s.params?.targetWidthMm));
check('los caracteres de control se caen de la marca',
  !tieneControl(s.mark ?? ''), JSON.stringify(s.mark));
check('una tipografía que no existe no pasa',
  FONT_STYLES.some((f) => f.id === s.markStyle), String(s.markStyle));
check('un tamaño desbocado se recorta', (s.markSize ?? 0) <= 16, String(s.markSize));
check('un booleano que no lo es no pasa', s.markArc === undefined, String(s.markArc));

// --- Y al escribir, lo guardado es NUESTRO, no lo que llegó ------------------
//
// Aquí está lo sutil. `lista.some(x => x.id === raw) ? raw : 'redonda'` comprueba
// perfectamente, pero lo que guarda es el valor de fuera. Se le cuela un objeto
// que se PARECE a una cadena válida —un String envuelto, un objeto con toString—
// y acaba en el almacén. Buscándolo y devolviendo el de nuestra lista, no.

console.log('');
{
  // Un objeto que pasa cualquier comparación con «cartel», pero no es la cadena.
  const disfrazada = new String('cartel') as unknown as never;
  saveSession({
    params: DEFAULTS,
    mark: 'Taller',
    markStyle: disfrazada,
    markArc: false,
    markSize: 6,
  });

  const crudo = JSON.parse(guardado.get('moldelab-sesion') ?? '{}');
  check(
    'la tipografía guardada es una cadena nuestra, no el objeto que llegó',
    typeof crudo.markStyle === 'string' && FONT_STYLES.some((f) => f.id === crudo.markStyle),
    `salió ${typeof crudo.markStyle} «${crudo.markStyle}»`,
  );

  const limpio = cleanParams({ ...DEFAULTS, textContent: `Ana${CONTROL}Luz` });
  check('cleanParams reconstruye el texto sin controles',
    limpio.textContent === 'AnaLuz', JSON.stringify(limpio.textContent));
}

console.log(failures ? `\n${failures} fallo(s).` : '\nTodo correcto.');
process.exitCode = failures ? 1 : 0;
