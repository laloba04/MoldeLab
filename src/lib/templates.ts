/**
 * Plantillas: dibujos listos para empezar sin buscar una foto.
 *
 * Son siluetas negras sobre blanco, hechas con formas simples a propósito: así
 * el vectorizado las coge limpias y salen filos perfectos. Cada una se dibuja
 * en un lienzo y se entrega como si fuera una imagen subida, de modo que el
 * resto de la app —vista previa incluida— funciona igual que con una foto.
 */

export interface Template {
  id: string;
  label: string;
  /** El cuerpo del SVG (viewBox 0 0 100 100), en negro. */
  art: string;
}

// Estrella de 5 puntas: puntos calculados, radio exterior 42 e interior 17.
const STAR =
  'M50 8 L60 36.2 L89.9 37 L66.2 55.3 L74.7 84 L50 67 L25.3 84 ' +
  'L33.8 55.3 L10.1 37 L40 36.2 Z';

// Flor: seis pétalos alrededor de un centro, todos círculos que se funden.
const FLOWER = [0, 60, 120, 180, 240, 300]
  .map((a) => {
    const r = (a * Math.PI) / 180;
    return `<circle cx="${(50 + 22 * Math.cos(r)).toFixed(1)}" cy="${(50 + 22 * Math.sin(r)).toFixed(1)}" r="15"/>`;
  })
  .join('') + '<circle cx="50" cy="50" r="16"/>';

export const TEMPLATES: Template[] = [
  {
    id: 'corazon',
    label: 'Corazón',
    art: '<path d="M50 88 C20 62 8 42 8 28 A20 20 0 0 1 50 22 A20 20 0 0 1 92 28 C92 42 80 62 50 88 Z"/>',
  },
  { id: 'estrella', label: 'Estrella', art: `<path d="${STAR}"/>` },
  { id: 'flor', label: 'Flor', art: FLOWER },
  {
    id: 'mariposa',
    label: 'Mariposa',
    art:
      '<ellipse cx="30" cy="36" rx="22" ry="18"/>' +
      '<ellipse cx="70" cy="36" rx="22" ry="18"/>' +
      '<ellipse cx="34" cy="64" rx="16" ry="20"/>' +
      '<ellipse cx="66" cy="64" rx="16" ry="20"/>' +
      '<ellipse cx="50" cy="50" rx="5" ry="27"/>',
  },
  {
    id: 'nube',
    label: 'Nube',
    art:
      '<rect x="18" y="52" width="64" height="22" rx="11"/>' +
      '<circle cx="35" cy="52" r="16"/>' +
      '<circle cx="52" cy="44" r="20"/>' +
      '<circle cx="68" cy="52" r="15"/>',
  },
  {
    id: 'luna',
    label: 'Luna',
    // La media luna: un círculo negro y otro blanco encima que le muerde un
    // lado. Más simple que restar con fill-rule, y sale limpio al vectorizar.
    art: '<circle cx="48" cy="50" r="38"/><circle cx="64" cy="44" r="32" fill="#fff"/>',
  },
  {
    id: 'trebol',
    label: 'Trébol',
    art:
      '<circle cx="50" cy="34" r="17"/>' +
      '<circle cx="34" cy="52" r="17"/>' +
      '<circle cx="66" cy="52" r="17"/>' +
      '<rect x="47" y="54" width="6" height="30" rx="3"/>',
  },
  {
    id: 'gato',
    label: 'Gato',
    art:
      '<path d="M28 42 L24 16 L47 34 Z"/>' +
      '<path d="M72 42 L76 16 L53 34 Z"/>' +
      '<circle cx="50" cy="56" r="27"/>',
  },
];

/** El SVG completo (fondo blanco + dibujo negro), listo para pintar. */
function svgOf(t: Template): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#fff"/>' +
    `<g fill="#111">${t.art}</g></svg>`
  );
}

/** El SVG como data URL, para enseñar la miniatura sin pintar nada. */
export function templatePreview(t: Template): string {
  return `data:image/svg+xml,${encodeURIComponent(svgOf(t))}`;
}

/**
 * Pinta la plantilla en un lienzo y la devuelve como PNG, del mismo modo que
 * saldría de subir una foto. Con margen alrededor para que el contorno no roce
 * el borde (ahí el vectorizado se corta).
 */
export function templateToBlob(t: Template): Promise<Blob> {
  const SIZE = 600;
  const pad = 60;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('sin contexto 2D'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, pad, pad, SIZE - pad * 2, SIZE - pad * 2);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('sin blob'))), 'image/png');
    };
    img.onerror = () => reject(new Error('no se pudo pintar la plantilla'));
    img.src = templatePreview(t);
  });
}
