/**
 * Fase 2 — las reglas de cobranza, probadas sin base de datos.
 *
 * `src/lib/cobranza.ts` es pura a propósito: estas son las reglas que el aging
 * y el saldo de cobro calculan, y son exactamente las que estaban repetidas y
 * en conflicto por el servidor, el cliente y tres pantallas.
 */
import { describe, it, expect } from 'vitest';
import {
  diasDeCredito,
  fechaVencimientoDe,
  sumarDias,
  diasDesde,
  diasVencidoDe,
  saldoDe,
  round2,
  estaVencida,
  estaSaldada,
  esAnulada,
  bucketDe,
  agingPorFacturas,
  dso,
} from '../src/lib/cobranza';

const HOY = '2026-10-01';
const ref = new Date(`${HOY}T12:00:00Z`);

describe('días de crédito por condición de pago', () => {
  it('Contado vence el mismo día', () => {
    expect(diasDeCredito('Contado')).toBe(0);
    expect(diasDeCredito('contado')).toBe(0);
    expect(diasDeCredito('  CONTADO  ')).toBe(0);
  });

  it('reconoce los plazos explícitos', () => {
    expect(diasDeCredito('Credito 8')).toBe(8);
    expect(diasDeCredito('Credito 15')).toBe(15);
    expect(diasDeCredito('Credito 30')).toBe(30);
    expect(diasDeCredito('Credito 60')).toBe(60);
    expect(diasDeCredito('Credito 90')).toBe(90);
  });

  it('"Credito" a secas no inventa un plazo', () => {
    // La app solo ofrece Contado/Credito: crédito es cuenta abierta, sin
    // vencimiento fijo. Se vence el mismo día en vez de suponer 30.
    expect(diasDeCredito('Credito')).toBe(0);
  });

  it('un texto sin plazo cae a 0, no a un plazo inventado', () => {
    expect(diasDeCredito('Contra entrega')).toBe(0);
    expect(diasDeCredito('')).toBe(0);
    expect(diasDeCredito(null)).toBe(0);
    expect(diasDeCredito(undefined)).toBe(0);
  });
});

describe('sumarDias', () => {
  it('suma sobre fechas cortas', () => {
    expect(sumarDias('2026-10-01', 30)).toBe('2026-10-31');
    expect(sumarDias('2026-10-01', 0)).toBe('2026-10-01');
  });

  it('cruza el año', () => {
    expect(sumarDias('2026-12-20', 30)).toBe('2027-01-19');
  });

  it('acepta ISO completo, como se guarda facturas.fecha', () => {
    expect(sumarDias('2026-08-20T00:00:00.000Z', 0)).toBe('2026-08-20');
    expect(sumarDias('2026-08-20T00:00:00.000Z', 30)).toBe('2026-09-19');
  });

  it('no corre el día por desfase de zona horaria', () => {
    // Mediodía UTC: un timestamp a medianoche en UTC-6 sigue siendo el día anterior.
    expect(sumarDias('2026-10-01T05:00:00.000Z', 0)).toBe('2026-10-01');
  });
});

describe('fechaVencimientoDe', () => {
  it('prefiere la fecha_vencimiento explícita', () => {
    expect(fechaVencimientoDe({
      fecha: '2026-08-20T00:00:00.000Z',
      fechaVencimiento: '2026-09-19',
      condicion_pago: 'Credito 30',
    })).toBe('2026-09-19');
  });

  it('la deriva de fecha + crédito si no hay explícita', () => {
    expect(fechaVencimientoDe({
      fecha: '2026-08-20T00:00:00.000Z',
      condicion_pago: 'Credito 30',
    })).toBe('2026-09-19');
  });
});

describe('diasDesde — nunca negativo', () => {
  it('cuenta hacia atrás por día calendario', () => {
    expect(diasDesde('2026-09-19', ref)).toBe(12);
    expect(diasDesde('2026-10-01', ref)).toBe(0);
  });

  it('no se adelanta por la hora del día', () => {
    // A las 01:31 del 01-oct solo han pasado 41 días y 13 h desde el 20-ago,
    // pero la respuesta es 42 días calendario. Con `ceil` sobre un anclaje a
    // mediodíaUtc salía 43 y corría el bucket de aging de la factura.
    const madrugada = new Date('2026-10-01T01:31:00Z');
    expect(diasDesde('2026-08-20', madrugada)).toBe(42);
    expect(diasDesde('2026-09-21', madrugada)).toBe(10);
  });

  it('es simétrico con la zona horaria', () => {
    // La misma fecha contada desde dos horas distintas del día da lo mismo.
    const manana = new Date('2026-10-01T23:45:00Z');
    expect(diasDesde('2026-08-20', manana)).toBe(42);
  });

  it('una fecha futura da 0, no negativo', () => {
    // El `Math.abs` que tenía `Cobranza.tsx` hacía esto positivo y la factura
    // caía en "vencida" con fecha de vencimiento por delante.
    expect(diasDesde('2026-12-25', ref)).toBe(0);
    expect(diasDesde('2026-10-02', ref)).toBe(0);
  });
});

describe('diasVencidoDe', () => {
  it('mide desde el vencimiento, no desde la emisión', () => {
    // Emitida hace 42 días con 30 de crédito: 12 días de atraso, no 42.
    const f = { fecha: '2026-08-20T00:00:00.000Z', fechaVencimiento: '2026-09-19' };
    expect(diasVencidoDe(f, ref)).toBe(12);
  });

  it('una factura a crédito sin plazo vence el día de emisión', () => {
    const f = { fecha: '2026-08-20T00:00:00.000Z', condicion_pago: 'Credito' };
    expect(diasVencidoDe(f, ref)).toBe(42);
  });

  it('aún no vencida da 0', () => {
    const f = { fecha: '2026-09-20T00:00:00.000Z', fechaVencimiento: '2026-10-20' };
    expect(diasVencidoDe(f, ref)).toBe(0);
  });
});

describe('saldoDe — el total menos lo pagado', () => {
  it('descuenta lo pagado', () => {
    expect(saldoDe({ total: 1000 }, 400)).toBe(600);
    expect(saldoDe({ total: 1000 }, 1000)).toBe(0);
  });

  it('nunca queda negativo', () => {
    expect(saldoDe({ total: 1000 }, 1200)).toBe(0);
  });

  it('una factura anulada no debe nada', () => {
    expect(saldoDe({ total: 1000, estado: 'Anulada' }, 0)).toBe(0);
    expect(saldoDe({ total: 1000, estado: 'Anulada' }, 500)).toBe(0);
  });

  it('una factura Pagada sin pagos tampoco debe nada', () => {
    // Estado y `pagos` tienen que coincidir: si `estado = 'Pagada'` llegara sin
    // filas en `pagos` (sembradas o importadas), `total - 0` le daría saldo y
    // el cobro la aceptaría otra vez.
    expect(saldoDe({ total: 500, estado: 'Pagada' }, 0)).toBe(0);
  });

  it('ignora el ruido de coma flotante', () => {
    expect(saldoDe({ total: 0.1 }, 0)).toBe(0.1);
    expect(saldoDe({ total: 100.005 }, 0)).toBe(100.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('estados saldados', () => {
  it('Pagada y Anulada están saldadas', () => {
    expect(estaSaldada('Pagada')).toBe(true);
    expect(estaSaldada('Anulada')).toBe(true);
    expect(estaSaldada('Pendiente')).toBe(false);
  });

  it('solo Anulada se marca como tal', () => {
    expect(esAnulada('Anulada')).toBe(true);
    expect(esAnulada('Pagada')).toBe(false);
  });
});

describe('estaVencida', () => {
  const base = { fecha: '2026-08-20T00:00:00.000Z', fechaVencimiento: '2026-09-19', total: 1000, estado: 'Pendiente' };

  it('pendiente, vencida y con saldo', () => {
    expect(estaVencida(base, 0, ref)).toBe(true);
  });

  it('aún no vencida no está vencida', () => {
    expect(estaVencida({ ...base, fechaVencimiento: '2026-11-01' }, 0, ref)).toBe(false);
  });

  it('sin saldo no está vencida', () => {
    expect(estaVencida(base, 1000, ref)).toBe(false);
  });

  it('pagada o anulada nunca están vencidas', () => {
    expect(estaVencida({ ...base, estado: 'Pagada' }, 0, ref)).toBe(false);
    expect(estaVencida({ ...base, estado: 'Anulada' }, 0, ref)).toBe(false);
  });
});

describe('bucketDe', () => {
  it('reparte por días de atraso cumplidos', () => {
    expect(bucketDe(0)).toBe('alDia');
    expect(bucketDe(1)).toBe('d1_30');
    expect(bucketDe(30)).toBe('d1_30');
    expect(bucketDe(31)).toBe('d31_60');
    expect(bucketDe(60)).toBe('d31_60');
    expect(bucketDe(61)).toBe('d60');
  });
});

describe('agingPorFacturas', () => {
  const vencida = (dias: number, total: number, id: string) => ({
    id,
    total,
    estado: 'Pendiente',
    fecha: '2026-08-20T00:00:00.000Z',
    fechaVencimiento: sumarDias(HOY, -dias),
  });

  it('una cartera sin nada vencido no suma a vencido', () => {
    // El bug: el aging sumaba `total` de facturas pendientes aunque no
    // hubieran vencido, así que "vencido" incluía dinero que aún no se debía.
    const r = agingPorFacturas([
      { id: 'a', total: 500, estado: 'Pendiente', fecha: '2026-09-28T00:00:00.000Z', fechaVencimiento: '2026-10-28' },
    ], new Map(), ref);
    expect(r.carteraTotal).toBe(500);
    expect(r.vencidoTotal).toBe(0);
    expect(r.alDia).toBe(500);
    expect(r.d1_30).toBe(0);
  });

  it('reparte cada saldo en su bucket', () => {
    const r = agingPorFacturas([
      vencida(10, 100, 'a'),
      vencida(45, 200, 'b'),
      vencida(90, 400, 'c'),
    ], new Map(), ref);
    expect(r.d1_30).toBe(100);
    expect(r.d31_60).toBe(200);
    expect(r.d60).toBe(400);
    expect(r.vencidoTotal).toBe(700);
    expect(r.carteraTotal).toBe(700);
  });

  it('suma el saldo, no el total, cuando hay pagos parciales', () => {
    const r = agingPorFacturas([
      vencida(10, 1000, 'a'),
    ], new Map([['a', 750]]), ref);
    expect(r.d1_30).toBe(250);
    expect(r.vencidoTotal).toBe(250);
  });

  it('ignora pagadas y anuladas', () => {
    const r = agingPorFacturas([
      vencida(10, 100, 'a'),
      { ...vencida(10, 900, 'b'), estado: 'Pagada' },
      { ...vencida(10, 900, 'c'), estado: 'Anulada' },
    ], new Map(), ref);
    expect(r.carteraTotal).toBe(100);
  });

  it('una cartera vacía no rompe', () => {
    const r = agingPorFacturas([], new Map(), ref);
    expect(r).toMatchObject({ alDia: 0, d1_30: 0, d31_60: 0, d60: 0, vencidoTotal: 0, carteraTotal: 0 });
  });
});

describe('dso', () => {
  it('promedia los atrasos de lo que está vencido', () => {
    const f = (dias: number, id: string) => ({
      id, total: 100, estado: 'Pendiente',
      fecha: '2026-08-20T00:00:00.000Z', fechaVencimiento: sumarDias(HOY, -dias),
    });
    expect(dso([f(10, 'a'), f(20, 'b')], new Map(), ref)).toBe(15);
  });

  it('no cuenta lo que aún no vence', () => {
    const f = (id: string) => ({
      id, total: 100, estado: 'Pendiente',
      fecha: '2026-09-30T00:00:00.000Z', fechaVencimiento: '2026-12-30',
    });
    expect(dso([f('a'), f('b')], new Map(), ref)).toBe(0);
  });

  it('una cartera vacía da 0', () => {
    expect(dso([], new Map(), ref)).toBe(0);
  });
});
