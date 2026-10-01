/**
 * Reglas de cobranza en un solo lugar.
 *
 * Antes estas reglas estaban repetidas y en conflicto: `Cobranza.tsx` medía la
 * antigüedad con `Math.abs`, `server.ts` la medía desde `fecha`, y el aging de
 * `/api/clientes/analisis` sumaba como "vencido" facturas que ni siquiera
 * habían vencido. Aquí queda una sola definición que usan servidor y cliente.
 *
 * Todo son funciones puras sobre datos planos: no dependen de Drizzle ni de la
 * base, para que se puedan probar sin levantarla.
 */

/** Días de crédito que implican cada `condicion_pago`. */
const DIAS_POR_CONDICION: { patron: RegExp; dias: number }[] = [
  { patron: /^\s*contado\s*$/i, dias: 0 },
  { patron: /\b8\b/, dias: 8 },
  { patron: /\b15\b/, dias: 15 },
  { patron: /\b30\b/, dias: 30 },
  { patron: /\b45\b/, dias: 45 },
  { patron: /\b60\b/, dias: 60 },
  { patron: /\b90\b/, dias: 90 },
];

/** Estados en los que una factura ya no debe nada. */
export const ESTADOS_SALDADOS = ['Pagada', 'Anulada'] as const;

/** Una factura anulada no debe dinero ni puede "revivirse" con un pago. */
export const esAnulada = (estado: string): boolean => estado === 'Anulada';

export const estaSaldada = (estado: string): boolean =>
  (ESTADOS_SALDADOS as readonly string[]).includes(estado);

/**
 * ¿La factura es crédito por cobrar?
 *
 * Acepta tanto `Credito` a secas como uno con plazo escrito (`Credito 30`), que
 * es justo la forma que `diasDeCredito` sabe interpretar. Con igualdad exacta,
 * una factura con plazo quedaba fuera de la cartera y del aging enteros.
 */
export const esCredito = (condicionPago: string | null | undefined): boolean =>
  /^\s*credito\b/i.test(String(condicionPago ?? ''));

/**
 * Días de crédito de una condición de pago.
 *
 * `Contado` vence el mismo día. Un texto no reconocido (p. ej. "Contra
 * entrega") cae a 0, que es el comportamiento previo: no se inventa un plazo
 * que nadie escribió.
 */
export const diasDeCredito = (condicionPago: string | null | undefined): number => {
  const texto = String(condicionPago ?? '').trim();
  if (!texto) return 0;
  return DIAS_POR_CONDICION.find(c => c.patron.test(texto))?.dias ?? 0;
};

/** Normaliza a `YYYY-MM-DD`, que es como se guardan las fechas en la base. */
export const aFechaCorta = (fecha: Date | string | number): string => {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

/**
 * Fecha de vencimiento de una factura: `fecha_vencimiento` si está, si no
 * derivada de `fecha` + `condicion_pago`.
 *
 * Normaliza a `YYYY-MM-DD` porque `facturas.fecha` se guarda como ISO completo
 * (`2026-08-20T00:00:00.000Z`) mientras `fecha_vencimiento` queda en fecha corta.
 */
export const fechaVencimientoDe = (factura: {
  fecha: string;
  fechaVencimiento?: string | null;
  condicion_pago?: string | null;
}): string => {
  const explicita = aFechaCorta(factura.fechaVencimiento ?? '');
  if (explicita) return explicita;
  return sumarDias(aFechaCorta(factura.fecha), diasDeCredito(factura.condicion_pago));
};

/** Suma días a una fecha `YYYY-MM-DD` sin cruzar husos. Acepta ISO completo. */
export const sumarDias = (fecha: string, dias: number): string => {
  const base = aFechaCorta(fecha);
  if (!base || !Number.isFinite(dias)) return '';
  // Se ancla a mediodía UTC para que un desfase de zona horaria no corra el día.
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/**
 * Días transcurridos desde `fechaCorta` hasta `ref`, nunca negativos.
 *
 * El `Math.max(0, ...)` es deliberado: una fecha que todavía no llega vale 0
 * días, no un número positivo. Con `Math.abs` — como estaba antes en
 * `Cobranza.tsx` — un vencimiento futuro reportaba antigüedad positiva y caía
 * en "vencida".
 *
 * Cuenta días calendario entre la fecha y la de referencia, y nunca devuelve
 * negativo: una fecha futura vale 0 días de atraso, no días negativos.
 */
export const diasDesde = (fecha: string | null | undefined, ref: Date | number = new Date()): number => {
  const base = aFechaCorta(fecha ?? '');
  if (!base) return 0;
  // Días calendario, no instantes. Comparar contra las 12:00 UTC y redondear
  // hacia arriba daba 43 días entre el 20-ago y el 01-oct, porque a las 01:31
  // ya no habían transcurrido 43 días completos, pero el redondeo los contaba.
  // La pregunta de negocio es "¿cuántos días lleva vencido", que es fecha - fecha.
  const desde = Date.parse(`${base}T00:00:00Z`);
  if (Number.isNaN(desde)) return 0;
  const hastaRef = ref instanceof Date ? ref : new Date(ref);
  if (Number.isNaN(hastaRef.getTime())) return 0;
  const hasta = Date.parse(`${aFechaCorta(hastaRef)}T00:00:00Z`);
  if (Number.isNaN(hasta)) return 0;
  return Math.max(0, Math.round((hasta - desde) / 86400000));
};

/** Días de atraso de una factura: 0 si aún no vence. */
export const diasVencidoDe = (factura: {
  fecha: string;
  fechaVencimiento?: string | null;
  condicion_pago?: string | null;
}, ref: Date | number = new Date()): number =>
  diasDesde(fechaVencimientoDe(factura), ref);

/**
 * Saldo pendiente de una factura: `total` menos lo pagado.
 *
 * `pagado` es la suma de `pagos.monto`. Se pasa explícitamente para que esta
 * función no tenga que leer la base y siga siendo testeable.
 *
 * Una factura marcada `Pagada` no debe nada aunque no tenga filas en `pagos`:
 * así quedaron las de datos sembrados e importados, donde el estado se ponía a
 * mano. Sin esta guarda, `total - 0` les devolvía saldo y `POST /api/pagos`
 * aceptaba cobrarlas otra vez.
 */
export const saldoDe = (factura: { total: number; estado?: string | null }, pagado: number = 0): number => {
  if (estaSaldada(String(factura.estado ?? ''))) return 0;
  return Math.max(0, round2(Number(factura.total || 0) - Number(pagado || 0)));
};

/** Redondeo monetario a 2 decimales, evitando el ruido de coma flotante. */
export const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Una factura está vencida si vence antes de `ref` y todavía debe dinero. */
export const estaVencida = (
  factura: { total: number; estado?: string | null; fecha: string; fechaVencimiento?: string | null; condicion_pago?: string | null },
  pagado: number,
  ref: Date | number = new Date(),
): boolean => {
  if (estaSaldada(String(factura.estado ?? ''))) return false;
  if (saldoDe(factura, pagado) <= 0) return false;
  return diasVencidoDe(factura, ref) > 0;
};

/**
 * Buckets del aging por días vencidos.
 *
 * Se conservan los cuatro nombres que ya consume `Clientes.tsx` (`alDia`,
 * `d1_30`, `d31_60`, `d60`). El boceto pide separar 61-90 de >90, pero partirlo
 * obliga a cambiar la etiqueta "60d+" de esa pantalla, así que queda como paso
 * aparte; hoy `d60` cubre ambos.
 */
export type BucketAging = 'alDia' | 'd1_30' | 'd31_60' | 'd60';

export interface AgingVacio {
  alDia: number;
  d1_30: number;
  d31_60: number;
  d60: number;
}

export const AGING_VACIO: AgingVacio = { alDia: 0, d1_30: 0, d31_60: 0, d60: 0 };

/**
 * Clasifica un saldo en su bucket de aging.
 *
 * `alDia` agrupa lo no vencido (incluye lo que vence hoy o mañana); los demás
 * buckets son por días de atraso ya cumplidos.
 */
export const bucketDe = (diasVencido: number): BucketAging => {
  if (diasVencido <= 0) return 'alDia';
  if (diasVencido <= 30) return 'd1_30';
  if (diasVencido <= 60) return 'd31_60';
  return 'd60';
};

/**
 * Aging por facturas. Suma el **saldo**, no el total, y solo de lo que sigue
 * debiendo: antes el aging sumaba `facturas.total` de facturas pendientes que
 * ni habían vencido, así que "vencido" y "% vencida" incluían dinero que aún
 * no se debía.
 */
export const agingPorFacturas = <T extends {
  total: number;
  estado?: string | null;
  fecha: string;
  fechaVencimiento?: string | null;
  condicion_pago?: string | null;
}>(
  facturas: T[],
  pagadoPorFactura: Map<string, number> = new Map(),
  ref: Date | number = new Date(),
): AgingVacio & { vencidoTotal: number; carteraTotal: number } => {
  const aging = { ...AGING_VACIO };
  let vencidoTotal = 0;
  let carteraTotal = 0;

  for (const f of facturas) {
    if (estaSaldada(String(f.estado ?? ''))) continue;
    const saldo = saldoDe(f, pagadoPorFactura.get(String((f as any).id ?? '')) ?? 0);
    if (saldo <= 0) continue;
    carteraTotal += saldo;
    const dias = diasVencidoDe(f, ref);
    if (dias > 0) vencidoTotal += saldo;
    aging[bucketDe(dias)] += saldo;
  }

  return {
    ...aging,
    vencidoTotal: round2(vencidoTotal),
    carteraTotal: round2(carteraTotal),
  };
};

/**
 * DSO: promedio de días de atraso entre las facturas con atraso.
 *
 * Se mide sobre vencimientos cumplidos. Una cartera sin nada vencido da 0, no el
 * promedio de ceros sobre facturas que aún no vencen.
 */
export const dso = <T extends {
  estado?: string | null;
  fecha: string;
  fechaVencimiento?: string | null;
  condicion_pago?: string | null;
}>(
  facturas: T[],
  pagadoPorFactura: Map<string, number> = new Map(),
  ref: Date | number = new Date(),
): number => {
  const atrasos = facturas
    .filter(f => !estaSaldada(String(f.estado ?? '')))
    .map(f => {
      const pagado = pagadoPorFactura.get(String((f as any).id ?? '')) ?? 0;
      return estaVencida(f as any, pagado, ref) ? diasVencidoDe(f, ref) : 0;
    })
    .filter(d => d > 0);
  if (atrasos.length === 0) return 0;
  return Math.round(atrasos.reduce((a, b) => a + b, 0) / atrasos.length);
};
