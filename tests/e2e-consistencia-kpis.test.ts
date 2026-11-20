/**
 * Fase 3 — el test que no existía: el mismo número, en todas las pantallas.
 *
 * El P&L se calculaba cinco veces en el código y las cinco copias discrepaban.
 * `Finanzas.tsx` usaba facturas `Pagada` de todo el historial,
 * `reportes/financiero` hacía lo mismo pero con `cuentasPorCobrar` como
 * `SUM(total)` de las pendientes, y `dashboard/enterprise` usaba `SUM(total)`
 * también. Con una factura pagada a medias, el KPI de cartera y el aging de la
 * misma pantalla no cuadraban.
 *
 * Acá no se prueba que cada función esté bien en aislamiento: se prueba que las
 * cuatro superficies de HTTP devuelven lo mismo para los mismos datos.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
let testDb: LibSQLDatabase<typeof schema>;
const DB_PATH = path.resolve(process.cwd(), '.test-consistencia.db');

const ADMIN = 'adm-cons';
const MES = { desde: '2026-09-01', hasta: '2026-09-30' };
const QMES = `desde=${MES.desde}&hasta=${MES.hasta}`;

const como = (req: request.Test) => req.set('x-user-id', ADMIN);

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });

  await testDb.insert(schema.users).values({
    id: ADMIN, name: 'Administradora', email: 'admin@cons.cr', role: 'Admin',
  });
  await testDb.insert(schema.clientes).values([
    { id: 'cli-1', nombre: 'Cliente Uno', condicion_pago: 'Contado', estado: 'Activo' },
    { id: 'cli-2', nombre: 'Cliente Dos', condicion_pago: 'Credito', estado: 'Activo' },
  ]);

  await testDb.insert(schema.facturas).values([
    { id: 'f-1', consecutivo: 'FAC-001', fecha: '2026-09-04', clienteId: 'cli-1', vendedorId: ADMIN, subtotal: 120000, descuento: 0, total: 120000, condicion_pago: 'Contado', estado: 'Pagada' },
    { id: 'f-2', consecutivo: 'FAC-002', fecha: '2026-09-06', clienteId: 'cli-2', vendedorId: ADMIN, subtotal: 90000, descuento: 0, total: 90000, condicion_pago: 'Credito', estado: 'Pagada' },
    // La que hace discrepar: sigue `Pendiente` pero ya se pagó 40k.
    { id: 'f-3', consecutivo: 'FAC-003', fecha: '2026-09-10', clienteId: 'cli-2', vendedorId: ADMIN, subtotal: 60000, descuento: 0, total: 60000, condicion_pago: 'Credito', estado: 'Pendiente' },
    // Otra a medias, con pago parcial: la que ninguna pantallaOld contaba bien.
    { id: 'f-4', consecutivo: 'FAC-004', fecha: '2026-09-12', clienteId: 'cli-2', vendedorId: ADMIN, subtotal: 40000, descuento: 0, total: 40000, condicion_pago: 'Credito', estado: 'Pendiente' },
    { id: 'f-5', consecutivo: 'FAC-005', fecha: '2026-09-14', clienteId: 'cli-1', vendedorId: ADMIN, subtotal: 77777, descuento: 0, total: 77777, condicion_pago: 'Contado', estado: 'Anulada' },
  ]);

  await testDb.insert(schema.gastos).values([
    { id: 'g-1', fecha: '2026-09-05', categoria: 'Alimento', monto: 45000, descripcion: 'Ración', usuarioId: ADMIN },
    { id: 'g-2', fecha: '2026-09-19', categoria: 'Combustible', monto: 15000, descripcion: 'Diésel', usuarioId: ADMIN },
  ]);

  await testDb.insert(schema.pagos).values([
    { id: 'p-1', facturaId: 'f-2', fecha: '2026-09-16', monto: 90000, metodo: 'Transferencia', usuarioId: ADMIN },
    { id: 'p-2', facturaId: 'f-3', fecha: '2026-09-21', monto: 40000, metodo: 'Efectivo', usuarioId: ADMIN },
    { id: 'p-3', facturaId: 'f-4', fecha: '2026-09-23', monto: 10000, metodo: 'Efectivo', usuarioId: ADMIN },
  ]);

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  // La conexión sigue abierta; en Windows `unlink` da EBUSY. El archivo está
  // en .gitignore y `beforeAll` lo borra.
});

const get = async (url: string) => (await como(request(app).get(url)).expect(200)).body as any;

describe('Los mismos números en todas las pantallas', () => {
  it('cuentas por cobrar: resumen = reporte = dashboard = aging', async () => {
    const [resumen, reporte, dashboard, analisis] = await Promise.all([
      get(`/api/finanzas/resumen?${QMES}`),
      get(`/api/reportes/financiero?${QMES}`),
      get('/api/dashboard/enterprise'),
      get('/api/clientes/analisis'),
    ]);

    // f-3 debe 20000 (60k − 40k) y f-4 debe 30000 (40k − 10k).
    const esperado = 50000;
    expect(resumen.cuentasPorCobrar).toBe(esperado);
    expect(reporte.cuentasPorCobrar).toBe(esperado);
    expect(dashboard.cuentasPorCobrar).toBe(esperado);
    expect(analisis.carteraTotal).toBe(esperado);

    // Y las cuatro son el mismo número, no cuatro que casualmente se parecen.
    const valores = [resumen.cuentasPorCobrar, reporte.cuentasPorCobrar, dashboard.cuentasPorCobrar, analisis.carteraTotal];
    expect(new Set(valores).size).toBe(1);
  });

  it('el aging de analítica y el de resumen son idénticos', async () => {
    const [resumen, analisis] = await Promise.all([
      get(`/api/finanzas/resumen?${QMES}`),
      get('/api/clientes/analisis'),
    ]);
    // `resumen.aging` trae los cuatro buckets más `vencidoTotal` y
    // `carteraTotal`, que en analítica son campos aparte del objeto.
    const buckets = ['alDia', 'd1_30', 'd31_60', 'd60'] as const;
    for (const b of buckets) {
      expect((analisis.aging as any)[b]).toBe((resumen.aging as any)[b]);
    }
    expect(analisis.vencidoTotal).toBe(resumen.aging.vencidoTotal);
    expect(analisis.carteraTotal).toBe(resumen.aging.carteraTotal);
  });

  it('utilidad y margen: resumen y reporte coinciden con las cifras del periodo', async () => {
    const [resumen, reporte] = await Promise.all([
      get(`/api/finanzas/resumen?${QMES}`),
      get(`/api/reportes/financiero?${QMES}`),
    ]);

    // Devengado de septiembre: 120000 + 90000 + 60000 + 40000 = 310000.
    // (f-5 está anulada y no cuenta.) Gastos: 45000 + 15000 = 60000.
    expect(resumen.ingresosFacturados).toBe(310000);
    expect(resumen.gastos).toBe(60000);
    expect(resumen.utilidad).toBe(250000);
    expect(resumen.margen).toBeCloseTo(80.65, 2);

    // El reporte financial ahora es el mismo cálculo, sin su propia fórmula.
    expect(reporte.totalVentas).toBe(resumen.ingresosFacturados);
    expect(reporte.totalGastos).toBe(resumen.gastos);
    expect(reporte.utilidadNeta).toBe(resumen.utilidad);
    expect(reporte.margen).toBeCloseTo(resumen.margen, 2);
  });

  it('el margen es número en ambas, no el string que devolvía el reporte', async () => {
    const reporte = await get('/api/reportes/financiero');
    expect(typeof reporte.margen).toBe('number');
    // Antes venía como `"80.6"` (string) y la UI lo interpolaba sin control.
    expect(Number.isNaN(Number(reporte.margen))).toBe(false);
  });

  it('ingresos cobrados: resumen y reporte dicen lo mismo', async () => {
    const [resumen, reporte] = await Promise.all([
      get(`/api/finanzas/resumen?${QMES}`),
      get(`/api/reportes/financiero?${QMES}`),
    ]);
    expect(reporte.ingresosCobrados).toBe(resumen.ingresosCobrados);
  });

  it('la factura anulada no aparece en ninguna superficie', async () => {
    const [resumen, reporte, dashboard] = await Promise.all([
      get(`/api/finanzas/resumen?${QMES}`),
      get('/api/reportes/financiero'),
      get('/api/dashboard/enterprise'),
    ]);
    for (const v of [resumen.ingresosFacturados, reporte.totalVentas, resumen.cuentasPorCobrar]) {
      expect(v).not.toContain(77777);
    }
    expect(dashboard.ingresosHoy).not.toContain(77777);
  });

  it('los pagos parciales no inflan la cartera en ninguna pantalla', async () => {
    // Si alguien volviera a `SUM(total)` de las Pendiente, daría 100000
    // (60000 + 40000) en vez de 50000.
    const valores = await Promise.all([
      get(`/api/finanzas/resumen?${QMES}`),
      get('/api/reportes/financiero'),
      get('/api/dashboard/enterprise'),
      get('/api/clientes/analisis'),
    ]);
    for (const v of valores) {
      const cartera = v.cuentasPorCobrar ?? v.carteraTotal;
      expect(cartera).toBe(50000);
      expect(cartera).not.toBe(100000);
    }
  });
});

describe('El resumen no depende del día que corra', () => {
  it('el mismo periodo da el mismo resultado en dos llamadas seguidas', async () => {
    const a = await get(`/api/finanzas/resumen?${QMES}`);
    const b = await get(`/api/finanzas/resumen?${QMES}`);
    expect(b.ingresosFacturados).toBe(a.ingresosFacturados);
    expect(b.ingresosCobrados).toBe(a.ingresosCobrados);
    expect(b.gastos).toBe(a.gastos);
    expect(b.utilidad).toBe(a.utilidad);
    expect(b.cuentasPorCobrar).toBe(a.cuentasPorCobrar);
  });

  it('un periodo sin datos da ceros consistentes entre pantallas', async () => {
    const resumen = await get('/api/finanzas/resumen?desde=2027-03-01&hasta=2027-03-31');
    expect(resumen.ingresosFacturados).toBe(0);
    expect(resumen.ingresosCobrados).toBe(0);
    expect(resumen.gastos).toBe(0);
    expect(resumen.utilidad).toBe(0);
    // La cartera es estado actual: sigue reflejando lo que se debe.
    expect(resumen.cuentasPorCobrar).toBe(50000);
  });
});
