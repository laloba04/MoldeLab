/** Geometría 2D sobre polígonos cerrados (sin repetir el primer punto). */

import type { Pt } from '../types';

export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export const area = (pts: Pt[]) => Math.abs(signedArea(pts));

/** Fuerza sentido antihorario (ccw=true) u horario. */
export function orient(pts: Pt[], ccw: boolean): Pt[] {
  const isCcw = signedArea(pts) > 0;
  return isCcw === ccw ? pts : [...pts].reverse();
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Douglas-Peucker sobre un anillo cerrado. */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (tol <= 0 || pts.length < 4) return pts;

  const dist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };

  const keep = new Uint8Array(pts.length);
  keep[0] = 1;

  // Un anillo no tiene extremos: partimos por el punto más lejano al primero.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  keep[far] = 1;

  const stack: [number, number][] = [
    [0, far],
    [far, pts.length - 1],
  ];

  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = dist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }

  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}

/** Chaikin: redondea esquinas sin inflar el polígono. */
export function smooth(pts: Pt[], passes: number): Pt[] {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    if (cur.length < 4) break;
    const next: Pt[] = [];
    for (let i = 0, n = cur.length; i < n; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    cur = next;
  }
  return cur;
}

/** Reparte puntos a distancia máxima `step`. Evita paredes con tramos larguísimos. */
export function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push(a);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cuts = Math.floor(len / step);
    for (let k = 1; k <= cuts; k++) {
      const t = k / (cuts + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Quita puntos pegados, que revientan las normales del offset. */
export function dedupe(pts: Pt[], eps = 1e-4): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop();
    else break;
  }
  return out;
}

const MITER_LIMIT = 3;

/**
 * Desplaza el polígono `d` mm hacia fuera del material.
 *
 * Cada arista de un anillo CCW tiene su normal exterior en (dy, -dx). En cada
 * vértice se promedian las dos normales y se corrige la longitud con el factor
 * de inglete, limitado para que las puntas afiladas no salgan disparadas.
 * Un agujero va en CW, así que la misma fórmula lo desplaza hacia el lado
 * correcto sin tocar el signo.
 */
export function offset(pts: Pt[], d: number): Pt[] {
  const n = pts.length;
  if (n < 3 || d === 0) return pts;

  const normals: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    normals.push([dy / len, -dx / len]);
  }

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const n1 = normals[(i - 1 + n) % n];
    const n2 = normals[i];
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const mlen = Math.hypot(mx, my);

    if (mlen < 1e-6) {
      // Vértice de 180º (pico invertido): usa la normal de la arista saliente.
      out.push([pts[i][0] + n2[0] * d, pts[i][1] + n2[1] * d]);
      continue;
    }
    mx /= mlen;
    my /= mlen;

    const cos = mx * n2[0] + my * n2[1];
    const scale = Math.min(1 / Math.max(cos, 1e-3), MITER_LIMIT);
    out.push([pts[i][0] + mx * d * scale, pts[i][1] + my * d * scale]);
  }
  return out;
}

export function bounds(loops: Pt[][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of loops) {
    for (const [x, y] of l) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
