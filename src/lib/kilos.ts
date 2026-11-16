/**
 * Conversión entre la unidad de almacenamiento de un producto (cartón, saco…)
 * y kilos.
 *
 * El factor vive en `productos_catalogo.kg_por_carton`. Un factor en 0 significa
 * "este producto todavía no tiene conversión": en ese caso devolvemos null y la
 * pantalla debe mostrar la unidad original en vez de inventar kilos.
 */

export const KG_POR_CARTON_POR_DEFECTO = 0;

export function factorKilos(kgPorUnidad: number | null | undefined): number | null {
  const f = Number(kgPorUnidad);
  return Number.isFinite(f) && f > 0 ? f : null;
}

/** Convierte una cantidad de la unidad original a kilos. null si no hay factor. */
export function aKilos(cantidad: number | null | undefined, kgPorUnidad: number | null | undefined): number | null {
  const f = factorKilos(kgPorUnidad);
  if (f === null) return null;
  const c = Number(cantidad);
  return Number.isFinite(c) ? c * f : null;
}

/** Convierte kilos a la unidad original. null si no hay factor. */
export function desdeKilos(kilos: number | null | undefined, kgPorUnidad: number | null | undefined): number | null {
  const f = factorKilos(kgPorUnidad);
  if (f === null) return null;
  const k = Number(kilos);
  return Number.isFinite(k) ? k / f : null;
}

/** Redondea a 2 decimales para mostrar, sin perder exactitud en el cálculo. */
export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Rótulo del factor según la unidad real del producto:
 * "1,9 kg por cartón" / "25 kg por saco". Si no hay factor, no hay rótulo.
 */
export function rotuloFactor(kgPorUnidad: number | null | undefined, unidad: string): string | null {
  const f = factorKilos(kgPorUnidad);
  if (f === null) return null;
  const por = unidad === 'cartones' ? 'cartón' : unidad.replace(/s$/, '');
  return `${redondear2(f)} kg por ${por}`;
}

/* ─── Casar nombres ────────────────────────────────────────────────────────
   El inventario llama los productos "Huevos - Grande" y el catálogo los llama
   "Huevos Grandes". Sin este puente no hay forma de saber cuánto pesa un
   cartón de lo que hay en Granja.
   ───────────────────────────────────────────────────────────────────────── */

const limpiar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const ARTICULOS = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'para', 'los', 'las', 'un', 'una', 'huevos', 'huevo']);

const singular = (t: string) => (t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t);

const rasgos = (nombre: string) =>
  limpiar(nombre).split(' ').filter(t => t && !ARTICULOS.has(t)).map(singular);

export interface ProductoCatalogoParaKilos {
  nombre: string;
  unidad?: string | null;
  kgPorCarton?: number | null;
}

/** Devuelve el producto del catálogo que corresponde al nombre operativo. */
export function productoCatalogoPara(nombreInventario: string, catalogo: ProductoCatalogoParaKilos[]): ProductoCatalogoParaKilos | null {
  const propio = rasgos(nombreInventario);
  if (!propio.length) return null;
  return catalogo.find(p => limpiar(p.nombre) === limpiar(nombreInventario)) ?? catalogo.find(p => {
    const c = rasgos(p.nombre);
    return c.length === propio.length && c.every((t, i) => t === propio[i]);
  }) ?? null;
}

/**
 * Kilos que pesa una unidad del producto nombrado como lo nombra el inventario.
 * Devuelve null cuando no hay factor (la pantalla debe avisar, no inventar).
 */
export function factorPara(nombreInventario: string, catalogo: ProductoCatalogoParaKilos[]): number | null {
  const coincidencia = productoCatalogoPara(nombreInventario, catalogo);
  return coincidencia ? factorKilos(coincidencia.kgPorCarton) : null;
}

/** Singular de la unidad para mensajes: cartones→cartón, sacos→saco. */
export function singularUnidad(unidad: string): string {
  if (unidad === 'cartones') return 'cartón';
  if (unidad === 'sacos') return 'saco';
  if (unidad === 'unidades') return 'unidad';
  if (unidad === 'kg') return 'kg';
  return unidad.replace(/s$/, '');
}

/**
 * Cantidad que hay que descontar del inventario para mover lo indicado.
 * `cantidad` viene en `unidad` ('kg' o la unidad de origen del producto).
 */
export function aUnidadOrigen(
  cantidad: number,
  unidad: 'kg' | string,
  kgPorUnidad: number | null | undefined,
): number | null {
  const c = Number(cantidad);
  if (!Number.isFinite(c) || c <= 0) return null;
  if (unidad !== 'kg') return c;
  const f = factorKilos(kgPorUnidad);
  if (f === null) return null;
  return c / f;
}
