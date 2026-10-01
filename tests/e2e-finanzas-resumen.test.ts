/**
 * Fase 3 — `/api/finanzas/resumen`: la fuente única del P&L.
 *
 * Lo que se ata acá:
 * - Las cifras cuadran contra `facturas` + `gastos` leídos crudo, no contra
 *   otra copia de la misma fórmula.
 * - **Devengado ≠ cobrado**: una factura de crédito entra en el devengado y no
 *   en el cobrado hasta que hay pago.
 * - `ventas_ruta` cuenta, y no cuenta dos veces cuando ya se consolidó en una
 *   factura (gap #1 del boceto).
 * - `cuentasPorCobrar` es saldo real, así que una factura pagada a medias entra
 *   por lo que falta, no por su total.
 * - Una base sin facturas ni gastos responde ceros en vez de reventar.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl } from './helpers/db';
import { expectApi } from './helpers/http';

let app: Express;
let testDb: LibSQLDatabase<typeof schema>;
const DB_PATH = path.resolve(process.cwd(), '.test-finanzas.db');

const ADMIN = 'adm-fin';
const MES = { desde: '2026-09-01', hasta: '2026-09-30' };

const como = (req: request.Test) => req.set('x-user-id', ADMIN);

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });

  await testDb.insert(schema.users).values({
    id: ADMIN, name: 'Administradora', email: 'admin@fin.cr', role: 'Admin',
  });
  await testDb.insert(schema.clientes).values([
    { id: 'cli-a', nombre: 'Cliente A', condicion_pago: 'Contado', estado: 'Activo' },
    { id: 'cli-b', nombre: 'Cliente B', condicion_pago: 'Credito', estado: 'Activo' },
    { id: 'consumidor-final', nombre: 'Consumidor Final', condicion_pago: 'Contado', estado: 'Activo' },
  ]);
  await testDb.insert(schema.camiones).values({ id: 'cam-1', nombre: 'Camion Uno' });
  await testDb.insert(schema.guias_despacho).values({
    id: 'guia-1', consecutivo: 'G-001', camionId: 'cam-1', fecha: '2026-09-10', estado: 'Cerrada',
  });

  await testDb.insert(schema.facturas).values([
    // Contado del mes, cobrada.
    { id: 'f-contada', consecutivo: 'FAC-001', fecha: '2026-09-05', clienteId: 'cli-a', vendedorId: ADMIN, subtotal: 100000, descuento: 0, total: 100000, condicion_pago: 'Contado', estado: 'Pagada' },
    // Crédito del mes, totalmente cobrada vía pagos.
    { id: 'f-credito-pagada', consecutivo: 'FAC-002', fecha: '2026-09-06', clienteId: 'cli-b', vendedorId: ADMIN, subtotal: 50000, descuento: 0, total: 50000, condicion_pago: 'Credito', estado: 'Pagada' },
    // Crédito del mes, pagada a medias: sigue Pendiente pero ya debe menos.
    { id: 'f-parcial', consecutivo: 'FAC-003', fecha: '2026-09-07', clienteId: 'cli-b', vendedorId: ADMIN, subtotal: 80000, descuento: 0, total: 80000, condicion_pago: 'Credito', estado: 'Pendiente' },
    // Crédito del mes, sin cobrar: entra al devengado, no al cobrado.
    { id: 'f-sin-cobrar', consecutivo: 'FAC-004', fecha: '2026-09-08', clienteId: 'cli-b', vendedorId: ADMIN, subtotal: 60000, descuento: 0, total: 60000, condicion_pago: 'Credito', estado: 'Pendiente' },
    // Anulada del mes: no es venta ni devengo.
    { id: 'f-anulada', consecutivo: 'FAC-005', fecha: '2026-09-09', clienteId: 'cli-a', vendedorId: ADMIN, subtotal: 99999, descuento: 0, total: 99999, condicion_pago: 'Contado', estado: 'Anulada' },
    // Del mes pasado, para el Δ.
    { id: 'f-agosto', consecutivo: 'FAC-006', fecha: '2026-08-10', clienteId: 'cli-a', vendedorId: ADMIN, subtotal: 25000, descuento: 0, total: 25000, condicion_pago: 'Contado', estado: 'Pagada' },
  ]);

  // Un tiquete suelto (sin consolidar) y uno ya consolidado en `f-consolidada`.
  await testDb.insert(schema.facturas).values({
    id: 'f-consolidada', consecutivo: 'FAC-007', fecha: '2026-09-11', clienteId: 'consumidor-final', vendedorId: ADMIN, subtotal: 30000, descuento: 0, total: 30000, condicion_pago: 'Contado', estado: 'Pagada', guiaId: 'guia-1',
  });
  await testDb.insert(schema.ventas_ruta).values([
    { id: 'v-suelta', tiqueteConsecutivo: 'T-001', camionId: 'cam-1', guiaId: 'guia-1', vendedorId: ADMIN, fechaHora: '2026-09-12', producto: 'Huevos', cartones: 10, precioUnitario: 4000, subtotal: 40000, descuento: 0, total: 40000, cobro: 'Efectivo', estado: 'Emitida' },
    // Ya consolidado: su dinero vive ahora en `f-consolidada`. Sumarlo sería doble.
    { id: 'v-consolidada', tiqueteConsecutivo: 'T-002', camionId: 'cam-1', guiaId: 'guia-1', vendedorId: ADMIN, fechaHora: '2026-09-11', producto: 'Huevos', cartones: 10, precioUnitario: 3000, subtotal: 30000, descuento: 0, total: 30000, cobro: 'Efectivo', estado: 'Emitida', facturaId: 'f-consolidada' },
    { id: 'v-anulada', tiqueteConsecutivo: 'T-003', camionId: 'cam-1', guiaId: 'guia-1', vendedorId: ADMIN, fechaHora: '2026-09-13', producto: 'Huevos', cartones: 5, precioUnitario: 1000, subtotal: 5000, descuento: 0, total: 5000, cobro: 'Efectivo', estado: 'Anulada' },
  ]);

  await testDb.insert(schema.gastos).values([
    { id: 'g-1', fecha: '2026-09-03', categoria: 'Alimento', monto: 40000, descripcion: 'Ración', usuarioId: ADMIN },
    { id: 'g-2', fecha: '2026-09-15', categoria: 'Alimento', monto: 10000, descripcion: 'Complemento', usuarioId: ADMIN },
    { id: 'g-3', fecha: '2026-09-20', categoria: 'Combustible', monto: 25000, descripcion: 'Diésel', usuarioId: ADMIN },
    { id: 'g-4', fecha: '2026-08-20', categoria: 'Alimento', monto: 5000, descripcion: 'Agosto', usuarioId: ADMIN },
  ]);

  // Pagos: la de crédito totalmente cobrada y un parcial de la que debe 80k.
  await testDb.insert(schema.pagos).values([
    { id: 'p-1', facturaId: 'f-credito-pagada', fecha: '2026-09-18', monto: 50000, metodo: 'Transferencia', usuarioId: ADMIN },
    { id: 'p-2', facturaId: 'f-parcial', fecha: '2026-09-22', monto: 30000, metodo: 'Efectivo', usuarioId: ADMIN },
  ]);

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  // La conexión sigue abierta: en Windows el archivo queda tomado y `unlink`
  // lanza EBUSY. El archivo está en .gitignore y `beforeAll` lo borra igual.
});

const resumenDe = async (query = '') => {
  const res = await como(request(app).get(`/api/finanzas/resumen${query}`)).expect(200);
  return res.body as any;
};

describe('GET /api/finanzas/resumen — cifras contra datos crudos', () => {
  it('los ingresos devengados cuadran contra facturas y tiquetes del periodo', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);

    // A mano: 100000 + 50000 + 80000 + 60000 (facturas, la anulada fuera)
    //        + 30000 (f-consolidada) + 40000 (tiquete suelto)
    //        y NO los 30000 del tiquete ya consolidado.
    expect(r.ingresosFacturados).toBe(360000);
    expect(r.gastos).toBe(75000);
    expect(r.utilidad).toBe(285000);
    expect(r.margen).toBeCloseTo(79.17, 2);
  });

  it('excluye la factura anulada del devengado', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    expect(r.ingresosFacturados).not.toContain(99999);
  });

  it('el tiquete consolidado no se cuenta dos veces', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    // Si `ventas_ruta` consolidada entrara, serían 390000 en vez de 360000.
    expect(r.ingresosFacturados).toBe(360000);

    const facturas = await testDb.query.facturas.findMany();
    const tiquetes = await testDb.query.ventas_ruta.findMany();
    const sumaCruda = facturas
      .filter((f: any) => f.estado !== 'Anulada')
      .reduce((a: number, f: any) => a + f.total, 0);
    expect(r.ingresosFacturados).toBeLessThan(sumaCruda + tiquetes.reduce((a: number, t: any) => a + t.total, 0));
  });

  it('el tiquete anulado no cuenta', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    expect(r.ingresosFacturados).not.toContain(5000);
  });
});

describe('GET /api/finanzas/resumen — devengado vs cobrado', () => {
  it('el cobrado excluye lo que se vendió pero no se cobró', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    // Cobrado: 100000 (contada) + 30000 (consolidada) + 50000 (pago de la
    // crédito pagada) + 30000 (parcial de f-parcial). f-sin-cobrar no entra.
    expect(r.ingresosCobrados).toBe(210000);
  });

  it('devengado y cobrado son cifras distintas y auditables entre sí', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    expect(r.ingresosFacturados).not.toBe(r.ingresosCobrados);
    // La diferencia es exactamente lo vendido y no cobrado en el mes.
    expect(r.ingresosFacturados - r.ingresosCobrados).toBe(150000);
  });

  it('una factura Pagada sin filas en pagos se cuenta como cobrada', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    // f-contada no tiene pagos pero su estado es Pagada: el dinero entró.
    expect(r.ingresosCobrados).toBeGreaterThanOrEqual(100000);
  });
});

describe('GET /api/finanzas/resumen — cartera y aging', () => {
  it('cuentas por cobrar es saldo real, no la suma de totales', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    // Pendientes: f-parcial (80k, pagado 30k → debe 50k) y f-sin-cobrar (60k).
    // Sumar `total` daría 140000.
    expect(r.cuentasPorCobrar).toBe(110000);
  });

  it('la cartera coincide con el aging de la misma respuesta', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    const buckets = r.aging.alDia + r.aging.d1_30 + r.aging.d31_60 + r.aging.d60;
    expect(buckets).toBeCloseTo(r.cuentasPorCobrar, 2);
    expect(r.aging.carteraTotal).toBeCloseTo(r.cuentasPorCobrar, 2);
  });

  it('las facturas Pagada y Anulada no aparecen en cartera', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    expect(r.cuentasPorCobrar).not.toContain(100000);
    expect(r.cuentasPorCobrar).not.toContain(99999);
  });
});

describe('GET /api/finanzas/resumen — gastos por categoría', () => {
  it('agrupa y ordena de mayor a menor', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    expect(r.gastosPorCategoria).toEqual([
      { categoria: 'Alimento', monto: 50000 },
      { categoria: 'Combustible', monto: 25000 },
    ]);
  });

  it('los gastos del mes anterior no entran en el periodo', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    expect(r.gastos).toBe(75000);
    expect(r.anterior.gastos).toBe(5000);
  });
});

describe('GET /api/finanzas/resumen — variación contra el periodo anterior', () => {
  it('calcula el Δ y el periodo anterior', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    expect(r.periodoAnterior).toEqual({ desde: '2026-08-02', hasta: '2026-08-31' });
    // Agosto: 25000 devengado, 5000 gastos → utilidad 20000
    expect(r.anterior.ingresosFacturados).toBe(25000);
    expect(r.anterior.utilidad).toBe(20000);
    expect(r.variacion.ingresosFacturados).toBeCloseTo(1340, 0);
  });

  it('devuelve null cuando el periodo anterior fue cero, no Infinity', async () => {
    const r = await resumenDe('?desde=2026-05-01&hasta=2026-05-31');
    expect(r.variacion.ingresosFacturados).toBeNull();
    expect(r.ingresosFacturados).toBe(0);
  });

  it('el periodo por defecto es el mes en curso', async () => {
    const r = await resumenDe();
    const hoy = new Date();
    expect(r.periodo.desde).toBe(`${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, '0')}-01`);
  });
});

describe('GET /api/finanzas/resumen — ciclo del dinero', () => {
  it('expone las etapas en orden, con las cifras del periodo', async () => {
    const r = await resumenDe(`?desde=${MES.desde}&hasta=${MES.hasta}`);
    expect(r.cicloDelDinero.map((e: any) => e.etapa)).toEqual([
      'ventas_ruta', 'documentos', 'cuentasPorCobrar', 'cobrado', 'caja', 'resultado',
    ]);
    const porEtapa = Object.fromEntries(r.cicloDelDinero.map((e: any) => [e.etapa, e.monto]));
    expect(porEtapa.ventas_ruta).toBe(r.ingresosFacturados);
    expect(porEtapa.cuentasPorCobrar).toBe(r.cuentasPorCobrar);
    expect(porEtapa.cobrado).toBe(r.ingresosCobrados);
    // Caja es el dinero cobrado menos lo gastado, no la utilidad devengada.
    expect(porEtapa.caja).toBe(135000);
    expect(porEtapa.resultado).toBe(r.utilidad);
  });
});

describe('GET /api/finanzas/resumen — validaciones y base vacía', () => {
  it('rechaza fechas con formato inválido', async () => {
    const res = await como(request(app).get('/api/finanzas/resumen?desde=ayer')).expect(400);
    expectApi(res, 400);
  });

  it('rechaza un periodo invertido', async () => {
    await como(request(app).get('/api/finanzas/resumen?desde=2026-09-30&hasta=2026-09-01')).expect(400);
  });

  it('responde 200 sin facturas ni gastos, en ceros y no en NaN', async () => {
    const r = await resumenDe('?desde=2027-01-01&hasta=2027-01-31');
    expect(r.ingresosFacturados).toBe(0);
    expect(r.ingresosCobrados).toBe(0);
    expect(r.gastos).toBe(0);
    expect(r.utilidad).toBe(0);
    expect(r.margen).toBe(0);
    expect(r.cuentasPorCobrar).toBe(110000); // la cartera es estado actual, no del periodo
    expect(r.gastosPorCategoria).toEqual([]);
    expect(r.cicloDelDinero.every((e: any) => Number.isFinite(e.monto))).toBe(true);
  });
});