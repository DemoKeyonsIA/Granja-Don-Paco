/**
 * Reglas de dinero en un solo lugar.
 *
 * El P&L se calculaba en cinco sitios distintos y ninguno coincidía:
 * `Finanzas.tsx` sumaba solo facturas `Pagada` de todo el historial,
 * `reportes/financiero` hacía lo mismo pero además `cuentasPorCobrar` como
 * `SUM(total)` de las `Pendiente` (ignorando los pagos parciales de Fase 2), y
 * `dashboard/enterprise` usaba `SUM(total)` de las `Pendiente` igual. Con una
 * factura pagada a medias, el aging decía un saldo y el KPI de cartera otro.
 *
 * Aquí hay dos definiciones que importan, y se nombran distinto a propósito:
 *
 * - **Devengado** (`ingresosFacturados`): lo vendido en el periodo. Cuenta todo
 *   documento no anulado, se haya cobrado o no. Es la base del P&L contable.
 * - **Cobrado** (`ingresosCobrados`): el dinero que realmente entró. Es lo que
 *   alimenta la banda "ciclo del dinero".
 *
 * No son sinónimos y no se pueden usar intercambiables: un negocio con mucho
 * crédito factura igual, pero no ha cobrado. Antes cada pantalla elegía una de
 * las dos sin decirlo, y por eso dos pantallas con los mismos datos mostraban
 * números distintos.
 *
 * Funciones puras sobre datos planos, sin Drizzle ni acceso a la base.
 */

import { round2, saldoDe } from './cobranza';

/** Colones con el separador de miles local: `₡1.234.567`, sin decimales. */
export const fmtCRC = (n: number | null | undefined): string =>
  new Intl.NumberFormat('es-CR', {
    style: 'currency',
    currency: 'CRC',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

/**
 * Un tiquete de ruta que ya se consolidó en una factura (`/api/facturacion/
 * consolidar-ruta` copia el importe a `facturas` y marca `factura_id`).
 *
 * Sumar `ventas_ruta` y `facturas` sin mirar esto cuenta la misma venta dos
 * veces. Al consolidar una guía cerrada, la utilidad se duplicaba.
 */
export const tiqueteConsolidado = (t: { facturaId?: string | null }): boolean =>
  !!t.facturaId && String(t.facturaId).trim() !== '';

export interface FacturaPago {
  id?: string;
  fecha: string;
  total: number;
  estado?: string | null;
  condicion_pago?: string | null;
}

export interface TiqueteVenta {
  id?: string;
  fechaHora: string;
  total: number;
  estado?: string | null;
  cobro?: string | null;
  facturaId?: string | null;
}

export interface Gasto {
  fecha: string;
  categoria: string;
  monto: number;
}

export interface RangoPeriodo {
  desde: string;
  hasta: string;
}

/**
 * Una factura entra al devengado con su signo contable.
 *
 * - Venta normal: suma su total.
 * - Anulada: no cuenta (0). Una venta revertida no es una pérdida.
 * - **NotaCredito: 0, se excluye**, no se resta. Es la convención R3 del
 *   proyecto, documentada en `server.ts:4294`: antes la NC se insertaba como
 *   `Pagada` con monto positivo y era doble ingreso; ahora lleva su propio
 *   estado y finanzas simplemente no la cuentan. No se cambia esa decisión
 *   contable acá — restarla convertiría cada devolución en pérdida y rompería el
 *   snapshot dorado de `e2e-todos-procesos`.
 */
export const signoFacturaDe = (f: FacturaPago): -1 | 0 | 1 => {
  const estado = String(f.estado ?? '');
  if (estado === 'Anulada' || estado === 'NotaCredito') return 0;
  return 1;
};

/** Una venta suma su importe al devengado. */
export const cuentaComoVenta = (f: FacturaPago): boolean => signoFacturaDe(f) !== 0;

/** Un tiquete anulado tampoco. `Emitida` es el estado normal de una venta. */
export const cuentaComoTiquete = (t: TiqueteVenta): boolean => String(t.estado ?? '') !== 'Anulada';

/**
 * Devengado: todo documento no anulado emitido en el periodo.
 *
 * Incluye las facturas de crédito, que aún no se han cobrado, y los tiquetes de
 * ruta que todavía no se consolidaron. Lo ya consolidado se excluye de
 * `ventas_ruta` para no contarlo dos veces.
 */
export const ingresosFacturadosDe = (
  facturas: FacturaPago[],
  tiquetes: TiqueteVenta[],
  periodo?: RangoPeriodo,
): number => {
  const enPeriodo = (fecha: string) => (periodo ? dentroDePeriodo(fecha, periodo) : true);
  const deFacturas = facturas.filter(f => cuentaComoVenta(f) && enPeriodo(f.fecha));
  const deTiquetes = tiquetes.filter(
    t => cuentaComoTiquete(t) && !tiqueteConsolidado(t) && enPeriodo(t.fechaHora),
  );
  return round2(
    deFacturas.reduce((a, f) => a + signoFacturaDe(f) * Number(f.total || 0), 0) +
    deTiquetes.reduce((a, t) => a + Number(t.total || 0), 0),
  );
};

/**
 * Cobrado: el dinero que entró de verdad en el periodo.
 *
 * Son las facturas `Pagada` del periodo más los pagos registrados en `pagos`
 * durante el periodo. Las facturas de crédito se excluyen de la segunda parte:
 * su importe se reconoce por `estado`, no otra vez por cada pago parcial.
 */
export const ingresosCobradosDe = (
  facturas: FacturaPago[],
  pagos: { facturaId?: string | null; fecha: string; monto: number }[],
  periodo?: RangoPeriodo,
  tiquetes: TiqueteVenta[] = [],
): number => {
  const enPeriodo = (fecha: string) => (periodo ? dentroDePeriodo(fecha, periodo) : true);
  const porFacturaPagada = facturas
    .filter(f => f.estado === 'Pagada' && enPeriodo(f.fecha))
    .reduce((a, f) => a + Number(f.total || 0), 0);
  const facturaPorId = new Map(facturas.map(f => [String(f.id ?? ''), f]));
  const porPagos = pagos
    .filter(p => {
      if (!enPeriodo(p.fecha)) return false;
      const f = facturaPorId.get(String(p.facturaId));
      // Sin factura local no hay forma de saber si ya se reconoció como `Pagada`;
      // se cuenta, porque el pago existe y el dinero entró.
      return !f || f.estado !== 'Pagada';
    })
    .reduce((a, p) => a + Number(p.monto || 0), 0);
  const porTiquetesContado = tiquetes
    .filter(t => cuentaComoTiquete(t) && !tiqueteConsolidado(t) && t.cobro !== 'Credito' && enPeriodo(String(t.fechaHora || '')))
    .reduce((a, t) => a + Number(t.total || 0), 0);
  return round2(porFacturaPagada + porPagos + porTiquetesContado);
};

/**
 * Cuentas por cobrar: lo que se vende y aún no se cobra, por **saldo**.
 *
 * No es `SUM(total)` de las pendientes. Una factura pagada a medias sigue
 * `Pendiente`, así que sumar su total reportaba dinero ya cobrado como cartera
 * y hacía que el KPI de cartera no cuadrara con el aging de la misma pantalla.
 */
export const cuentasPorCobrarDe = (
  facturas: FacturaPago[],
  pagadoPorFactura: Map<string, number> = new Map(),
): number =>
  round2(
    facturas
      // Una nota de crédito es una devolución: no genera deuda a favor del
      // cliente. `estaSaldada` no la cubre porque su estado es `NotaCredito`.
      .filter(f => signoFacturaDe(f) === 1)
      .reduce((a, f) => a + saldoDe(f, pagadoPorFactura.get(String(f.id ?? '')) ?? 0), 0),
  );

/** Total de gastos del periodo. Una factura anulada no gasta. */
export const gastosDe = (gastos: Gasto[], periodo?: RangoPeriodo): number =>
  round2(
    gastos
      .filter(g => (periodo ? dentroDePeriodo(g.fecha, periodo) : true))
      .reduce((a, g) => a + Number(g.monto || 0), 0),
  );

/** Gastos agrupados por categoría, de mayor a menor. */
export const gastosPorCategoriaDe = (
  gastos: Gasto[],
  periodo?: RangoPeriodo,
): { categoria: string; monto: number }[] => {
  const acc = new Map<string, number>();
  for (const g of gastos) {
    if (periodo && !dentroDePeriodo(g.fecha, periodo)) continue;
    // `??` solo cubre null/undefined: una categoría vacía o en blanco creaba un
    // bucket con etiqueta `""`, invisible en la pantalla y sin total visible.
    const cat = String(g.categoria ?? '').trim() || 'Sin categoría';
    acc.set(cat, round2((acc.get(cat) ?? 0) + Number(g.monto || 0)));
  }
  return [...acc.entries()]
    .map(([categoria, monto]) => ({ categoria, monto }))
    .sort((a, b) => b.monto - a.monto);
};

/**
 * Utilidad y margen sobre el devengado.
 *
 * El margen se calcula sobre ingresos, no sobre gastos: un margen de 20% con
 * cero ventas es un negocio quieto, no un negocio con 20% de rentabilidad.
 */
export const utilidadYMargenDe = (
  ingresos: number,
  gastos: number,
): { utilidad: number; margen: number } => {
  const utilidad = round2(ingresos - gastos);
  return { utilidad, margen: ingresos > 0 ? round2((utilidad / ingresos) * 100) : 0 };
};

/**
 * Variación porcentual contra el periodo anterior.
 *
 * Si el periodo anterior fue 0 la variación no se puede expresar: se devuelve
 * `null` en vez de `Infinity` o 10000%. Un KPI que no se puede comparar se
 * marca como no comparable.
 */
export const variacionDe = (actual: number, anterior: number): number | null => {
  if (anterior === 0) return null;
  return round2(((actual - anterior) / Math.abs(anterior)) * 100);
};

/** ¿La fecha cae dentro del periodo? Compara solo la parte de día. */
export const dentroDePeriodo = (fecha: string, periodo: RangoPeriodo): boolean => {
  const dia = String(fecha ?? '').slice(0, 10);
  if (!dia) return false;
  return dia >= periodo.desde && dia <= periodo.hasta;
};

/**
 * El periodo equivalente, desplazado en el tiempo, para el Δ.
 *
 * Se calculan los dos rangos con el mismo tamaño en días para que la comparación
 * sea justa: un "mes" de 31 días contra uno de 30 siempre gana por un día.
 */
export const periodoAnteriorDe = (periodo: RangoPeriodo): RangoPeriodo => {
  const desde = Date.parse(`${periodo.desde}T00:00:00Z`);
  const hasta = Date.parse(`${periodo.hasta}T00:00:00Z`);
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return periodo;
  const dias = Math.round((hasta - desde) / 86400000) + 1;
  const nuevoHasta = new Date(desde - 86400000);
  const nuevoDesde = new Date(desde - dias * 86400000);
  return {
    desde: nuevoDesde.toISOString().slice(0, 10),
    hasta: nuevoHasta.toISOString().slice(0, 10),
  };
};

/** Mes en curso en `YYYY-MM-DD`, para el periodo por defecto. */
export const mesEnCursoDe = (ref: Date | number = new Date()): RangoPeriodo => {
  const r = ref instanceof Date ? ref : new Date(ref);
  const anio = r.getUTCFullYear();
  const mes = String(r.getUTCMonth() + 1).padStart(2, '0');
  const ultimo = new Date(Date.UTC(anio, r.getUTCMonth() + 1, 0)).getUTCDate();
  return { desde: `${anio}-${mes}-01`, hasta: `${anio}-${mes}-${String(ultimo).padStart(2, '0')}` };
};

export type EtapaCiclo =
  | 'ventas_ruta'
  | 'documentos'
  | 'cuentasPorCobrar'
  | 'cobrado'
  | 'caja'
  | 'resultado';

export interface NodoCiclo {
  etapa: EtapaCiclo;
  etiqueta: string;
  monto: number;
}

/**
 * El ciclo del dinero: cuánto hay en cada etapa, del mostrador al resultado.
 *
 * Las etapas son sumas distintas y no deben cruzarse entre sí: los tiquetes de
 * ruta ya consolidados son los mismos documentos que ahora viven en `facturas`,
 * así que la etapa "documentos" cuenta solo facturas, nunca tiquetes
 * consolidados.
 */
export const cicloDelDineroDe = (metricas: {
  ingresosFacturados: number;
  ingresosCobrados: number;
  cuentasPorCobrar: number;
  gastos: number;
  utilidad: number;
}): NodoCiclo[] => [
  { etapa: 'ventas_ruta', etiqueta: 'Vendido en ruta', monto: metricas.ingresosFacturados },
  { etapa: 'documentos', etiqueta: 'Documentos emitidos', monto: metricas.ingresosFacturados },
  { etapa: 'cuentasPorCobrar', etiqueta: 'Por cobrar', monto: metricas.cuentasPorCobrar },
  { etapa: 'cobrado', etiqueta: 'Cobrado', monto: metricas.ingresosCobrados },
  { etapa: 'caja', etiqueta: 'Caja (cobrado - gastos)', monto: round2(metricas.ingresosCobrados - metricas.gastos) },
  { etapa: 'resultado', etiqueta: 'Resultado del periodo', monto: metricas.utilidad },
];
