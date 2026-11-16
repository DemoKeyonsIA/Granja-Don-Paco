/**
 * Fase 3 — reglas puras de finanzas.
 *
 * Estas funciones son la definición única del P&L; los tests e2e verifican que
 * los endpoints las usan, y estos verifican que la definición es correcta en los
 * bordes donde un `>` o un `??` mal puesto cambian el número.
 */
import { describe, it, expect } from 'vitest';
import {
  fmtCRC, tiqueteConsolidado, signoFacturaDe,
  ingresosFacturadosDe, ingresosCobradosDe,
  cuentasPorCobrarDe, gastosDe, gastosPorCategoriaDe,
  utilidadYMargenDe, variacionDe,
  dentroDePeriodo, periodoAnteriorDe, mesEnCursoDe, cicloDelDineroDe,
} from '../src/lib/finanzas';

const TODAS = { desde: '2026-09-01', hasta: '2026-09-30' };

describe('tiqueteConsolidado', () => {
  it('es consolidado solo con facturaId real', () => {
    expect(tiqueteConsolidado({ facturaId: 'f-1' })).toBe(true);
    expect(tiqueteConsolidado({ facturaId: null })).toBe(false);
    expect(tiqueteConsolidado({ facturaId: undefined })).toBe(false);
    expect(tiqueteConsolidado({ facturaId: '' })).toBe(false);
    expect(tiqueteConsolidado({ facturaId: '   ' })).toBe(false);
  });
});

describe('ingresosFacturadosDe — devengado', () => {
  it('cuenta facturas de crédito aunque no se hayan cobrado', () => {
    const r = ingresosFacturadosDe(
      [{ fecha: '2026-09-10', total: 100000, estado: 'Pendiente' }],
      [],
      TODAS,
    );
    expect(r).toBe(100000);
  });

  it('excluye anuladas de facturas y de tiquetes', () => {
    expect(ingresosFacturadosDe(
      [{ fecha: '2026-09-10', total: 5000, estado: 'Anulada' }], [], TODAS,
    )).toBe(0);
    expect(ingresosFacturadosDe(
      [], [{ fechaHora: '2026-09-10', total: 7000, estado: 'Anulada' }], TODAS,
    )).toBe(0);
  });

  it('no cuenta dos veces un tiquete ya consolidado', () => {
    const tiquetes = [
      { fechaHora: '2026-09-10', total: 10000, estado: 'Emitida', facturaId: 'f-x' },
      { fechaHora: '2026-09-10', total: 20000, estado: 'Emitida' },
    ];
    // Solo el suelto: la factura equivalente ya está en el otro lado.
    expect(ingresosFacturadosDe([], tiquetes, TODAS)).toBe(20000);
  });

  it('excluye lo que cae fuera del periodo', () => {
    const facturas = [
      { fecha: '2026-08-31', total: 1000, estado: 'Pagada' },
      { fecha: '2026-09-01', total: 2000, estado: 'Pagada' },
      { fecha: '2026-09-30', total: 3000, estado: 'Pagada' },
      { fecha: '2026-10-01', total: 4000, estado: 'Pagada' },
    ];
    expect(ingresosFacturadosDe(facturas, [], TODAS)).toBe(5000);
  });

  it('sin periodo cuenta todo', () => {
    const facturas = [
      { fecha: '2020-01-01', total: 1000, estado: 'Pagada' },
      { fecha: '2030-01-01', total: 2000, estado: 'Pagada' },
    ];
    expect(ingresosFacturadosDe(facturas, [])).toBe(3000);
  });

  it('una nota de crédito se excluye del devengado, no se suma ni se resta', () => {
    // Convención R3 (`server.ts:4294`): la NC lleva su propio estado y no se
    // cuenta. Antes se guardaba como `Pagada` con monto positivo y eso era doble
    // ingreso; el filtro por `Pagada` la tapaba sin querer. Al pasar a contar
    // todo lo no anulado, si no se excluye explícitamente, la NC suma.
    const facturas = [
      { fecha: '2026-09-10', total: 480000, estado: 'Pagada' },
      { fecha: '2026-09-10', total: 480000, estado: 'NotaCredito' },
    ];
    expect(ingresosFacturadosDe(facturas, [], TODAS)).toBe(480000);
    expect(signoFacturaDe({ fecha: '2026-09-10', total: 1, estado: 'NotaCredito' })).toBe(0);
    expect(signoFacturaDe({ fecha: '2026-09-10', total: 1, estado: 'Anulada' })).toBe(0);
    expect(signoFacturaDe({ fecha: '2026-09-10', total: 1, estado: 'Pagada' })).toBe(1);
  });

  it('una NC no entra en cartera ni se trata como cobro', () => {
    // Una devolución no genera deuda a favor del cliente.
    const facturas = [{ id: 'nc-1', fecha: '2026-09-10', total: 500000, estado: 'NotaCredito' }];
    expect(cuentasPorCobrarDe(facturas)).toBe(0);
    expect(ingresosCobradosDe(facturas, [], TODAS)).toBe(0);
  });

  it('suma facturas y tiquetes sueltos', () => {
    expect(ingresosFacturadosDe(
      [{ fecha: '2026-09-10', total: 10000, estado: 'Pagada' }],
      [{ fechaHora: '2026-09-11', total: 5000, estado: 'Emitida' }],
      TODAS,
    )).toBe(15000);
  });
});

describe('ingresosCobradosDe — efectivo', () => {
  it('no incluye lo vendido y no cobrado', () => {
    expect(ingresosCobradosDe(
      [{ id: 'f-1', fecha: '2026-09-10', total: 50000, estado: 'Pendiente' }],
      [],
      TODAS,
    )).toBe(0);
  });

  it('cuenta tiquetes de ruta cobrados una vez y excluye crédito, anulados y consolidados', () => {
    const tiquetes = [
      { fechaHora: '2026-09-10T10:00:00.000Z', total: 12000, estado: 'Emitida', cobro: 'Transferencia' },
      { fechaHora: '2026-09-10T11:00:00.000Z', total: 9000, estado: 'Emitida', cobro: 'Credito' },
      { fechaHora: '2026-09-10T12:00:00.000Z', total: 5000, estado: 'Anulada', cobro: 'Efectivo' },
      { fechaHora: '2026-09-10T13:00:00.000Z', total: 7000, estado: 'Emitida', cobro: 'Efectivo', facturaId: 'f-1' },
    ];
    expect(ingresosCobradosDe([], [], TODAS, tiquetes)).toBe(12000);
  });

  it('cuenta los pagos del periodo sobre facturas de crédito', () => {
    const facturas = [{ id: 'f-1', fecha: '2026-09-02', total: 90000, estado: 'Pendiente' }];
    const pagos = [{ facturaId: 'f-1', fecha: '2026-09-20', monto: 40000 }];
    expect(ingresosCobradosDe(facturas, pagos, TODAS)).toBe(40000);
  });

  it('no cuenta dos veces una factura Pagada que además tiene pagos', () => {
    // El estado ya reconoce el total; sumar el pago lo contaría de nuevo.
    const facturas = [{ id: 'f-1', fecha: '2026-09-02', total: 90000, estado: 'Pagada' }];
    const pagos = [{ facturaId: 'f-1', fecha: '2026-09-20', monto: 90000 }];
    expect(ingresosCobradosDe(facturas, pagos, TODAS)).toBe(90000);
  });

  it('cuenta un pago sin factura local: el dinero entró', () => {
    const pagos = [{ facturaId: null, fecha: '2026-09-20', monto: 15000 }];
    expect(ingresosCobradosDe([], pagos, TODAS)).toBe(15000);
  });

  it('excluye pagos fuera del periodo', () => {
    const facturas = [{ id: 'f-1', fecha: '2026-09-02', total: 90000, estado: 'Pendiente' }];
    const pagos = [{ facturaId: 'f-1', fecha: '2026-10-05', monto: 40000 }];
    expect(ingresosCobradosDe(facturas, pagos, TODAS)).toBe(0);
  });
});

describe('cuentasPorCobrarDe', () => {
  it('descuenta lo pagado de las facturas pendientes', () => {
    const facturas = [
      { id: 'f-1', fecha: '2026-09-01', total: 80000, estado: 'Pendiente' },
      { id: 'f-2', fecha: '2026-09-01', total: 60000, estado: 'Pendiente' },
    ];
    const pagado = new Map([['f-1', 30000]]);
    // 50000 + 60000. Sumar `total` daría 140000.
    expect(cuentasPorCobrarDe(facturas, pagado)).toBe(110000);
  });

  it('excluye Pagada y Anulada', () => {
    const facturas = [
      { id: 'f-1', fecha: '2026-09-01', total: 10000, estado: 'Pagada' },
      { id: 'f-2', fecha: '2026-09-01', total: 20000, estado: 'Anulada' },
      { id: 'f-3', fecha: '2026-09-01', total: 30000, estado: 'Pendiente' },
    ];
    expect(cuentasPorCobrarDe(facturas)).toBe(30000);
  });

  it('nunca es negativo si el pago excede el total', () => {
    const facturas = [{ id: 'f-1', fecha: '2026-09-01', total: 10000, estado: 'Pendiente' }];
    expect(cuentasPorCobrarDe(facturas, new Map([['f-1', 15000]]))).toBe(0);
  });

  it('sin facturas da 0', () => {
    expect(cuentasPorCobrarDe([])).toBe(0);
  });
});

describe('gastosDe y gastosPorCategoriaDe', () => {
  const gastos = [
    { fecha: '2026-09-05', categoria: 'Alimento', monto: 40000 },
    { fecha: '2026-09-20', categoria: 'Alimento', monto: 10000 },
    { fecha: '2026-09-15', categoria: 'Combustible', monto: 25000 },
    { fecha: '2026-08-01', categoria: 'Alimento', monto: 999 },
  ];

  it('filtra por periodo', () => {
    expect(gastosDe(gastos, TODAS)).toBe(75000);
    expect(gastosDe(gastos)).toBe(75999);
  });

  it('agrupa por categoría y ordena de mayor a menor', () => {
    expect(gastosPorCategoriaDe(gastos, TODAS)).toEqual([
      { categoria: 'Alimento', monto: 50000 },
      { categoria: 'Combustible', monto: 25000 },
    ]);
  });

  it('agrupa los sin categoría en un solo grupo', () => {
    for (const categoria of ['', '   ', undefined as any]) {
      expect(gastosPorCategoriaDe([{ fecha: '2026-09-01', categoria, monto: 100 }], TODAS)).toEqual([
        { categoria: 'Sin categoría', monto: 100 },
      ]);
    }
  });

  it('da 0 y lista vacía sin gastos', () => {
    expect(gastosDe([])).toBe(0);
    expect(gastosPorCategoriaDe([])).toEqual([]);
  });
});

describe('utilidadYMargenDe', () => {
  it('calcula utilidad y margen', () => {
    expect(utilidadYMargenDe(100000, 60000)).toEqual({ utilidad: 40000, margen: 40 });
  });

  it('con cero ingresos el margen es 0, no NaN ni Infinity', () => {
    expect(utilidadYMargenDe(0, 50000)).toEqual({ utilidad: -50000, margen: 0 });
  });

  it('sostiene una pérdida con margen negativo', () => {
    expect(utilidadYMargenDe(100000, 150000)).toEqual({ utilidad: -50000, margen: -50 });
  });
});

describe('variacionDe', () => {
  it('calcula el porcentaje', () => {
    expect(variacionDe(150, 100)).toBe(50);
    expect(variacionDe(50, 100)).toBe(-50);
    expect(variacionDe(100, 100)).toBe(0);
  });

  it('devuelve null con periodo anterior en cero, no Infinity', () => {
    expect(variacionDe(100, 0)).toBeNull();
  });

  it('maneja un anterior negativo sin girar el signo', () => {
    // (-50000 → -20000) es una mejora; con `anterior` sin valor absoluto daba -60.
    expect(variacionDe(-20000, -50000)).toBe(60);
  });
});

describe('dentroDePeriodo', () => {
  it('compara solo la parte de día', () => {
    expect(dentroDePeriodo('2026-09-15T23:59:59Z', TODAS)).toBe(true);
    expect(dentroDePeriodo('2026-09-01', TODAS)).toBe(true);
    expect(dentroDePeriodo('2026-09-30', TODAS)).toBe(true);
    expect(dentroDePeriodo('2026-08-31', TODAS)).toBe(false);
    expect(dentroDePeriodo('2026-10-01', TODAS)).toBe(false);
  });

  it('una fecha vacía no cae dentro de nada', () => {
    expect(dentroDePeriodo('', TODAS)).toBe(false);
    expect(dentroDePeriodo(null as any, TODAS)).toBe(false);
  });
});

describe('periodoAnteriorDe', () => {
  it('devuelve el rango inmediatamente previo, del mismo largo', () => {
    const p = periodoAnteriorDe(TODAS);
    expect(p.desde).toBe('2026-08-02');
    expect(p.hasta).toBe('2026-08-31');
    expect(dentroDePeriodo('2026-08-15', p)).toBe(true);
  });

  it('cruza el año correctamente', () => {
    // 31 días que terminan el 31-dic: del 1-dic al 31-dic.
    const p = periodoAnteriorDe({ desde: '2026-01-01', hasta: '2026-01-31' });
    expect(p).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
  });

  it('el rango anterior tiene los mismos días que el original', () => {
    const largos = [
      { desde: '2026-09-01', hasta: '2026-09-30' },
      { desde: '2026-02-01', hasta: '2026-02-28' },
      { desde: '2026-01-01', hasta: '2026-01-31' },
    ];
    for (const p of largos) {
      const a = periodoAnteriorDe(p);
      const dias = (r: typeof p) =>
        Math.round((Date.parse(`${r.hasta}T00:00:00Z`) - Date.parse(`${r.desde}T00:00:00Z`)) / 86400000) + 1;
      // Un mes de 31 contra uno de 30 siempre "gana" por un día sin esto.
      expect(dias(a)).toBe(dias(p));
    }
  });

  it('no se solapa con el periodo original', () => {
    const p = periodoAnteriorDe(TODAS);
    expect(dentroDePeriodo(TODAS.desde, p)).toBe(false);
    expect(dentroDePeriodo(TODAS.hasta, p)).toBe(false);
  });
});

describe('mesEnCursoDe', () => {
  it('devuelve el mes completo, con el último día real', () => {
    expect(mesEnCursoDe(new Date('2026-02-15T12:00:00Z'))).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(mesEnCursoDe(new Date('2028-02-15T12:00:00Z'))).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
    expect(mesEnCursoDe(new Date('2026-04-01T00:00:00Z'))).toEqual({ desde: '2026-04-01', hasta: '2026-04-30' });
  });
});

describe('cicloDelDineroDe', () => {
  it('expone las 6 etapas con las cifras que recibe', () => {
    const nodos = cicloDelDineroDe({
      ingresosFacturados: 100000, ingresosCobrados: 60000,
      cuentasPorCobrar: 50000, gastos: 30000, utilidad: 70000,
    });
    expect(nodos).toHaveLength(6);
    const porEtapa = Object.fromEntries(nodos.map(n => [n.etapa, n.monto]));
    expect(porEtapa.ventas_ruta).toBe(100000);
    expect(porEtapa.cuentasPorCobrar).toBe(50000);
    expect(porEtapa.cobrado).toBe(60000);
    // La caja es el efectivo, no el devengado: 60k cobrado − 30k gastados.
    expect(porEtapa.caja).toBe(30000);
    expect(porEtapa.resultado).toBe(70000);
  });

  it('la caja puede ser negativa si se gasta más de lo que se cobra', () => {
    const nodos = cicloDelDineroDe({
      ingresosFacturados: 100000, ingresosCobrados: 20000,
      cuentasPorCobrar: 80000, gastos: 50000, utilidad: 50000,
    });
    const caja = nodos.find(n => n.etapa === 'caja')!;
    expect(caja.monto).toBe(-30000);
  });
});

describe('fmtCRC', () => {
  it('formatea colones sin decimales', () => {
    const s = fmtCRC(1234567);
    expect(s).toContain('₡');
    // `es-CR` separa los miles con espacio (U+00A0), no con punto: las pruebas
    // no deben depender de cuál de los dos sea, solo de que los dígitos estén.
    expect(s.replace(/\D/g, '')).toBe('1234567');
    expect(s).not.toContain('.');
  });

  it('nulo, undefined y cero dan 0 en vez de romper', () => {
    for (const v of [null, undefined, 0, NaN]) {
      expect(fmtCRC(v as any)).toMatch(/0/);
    }
  });
});
