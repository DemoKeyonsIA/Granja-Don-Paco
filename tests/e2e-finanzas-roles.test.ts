/**
 * Fase 4 — `/api/reportes/flujo-caja` y la superficie de servidor de Finanzas.
 *
 * Lo que se ata acá:
 * - El alias nuevo devuelve **exactamente** lo mismo que `/api/finanzas/resumen`.
 *   Es la única defensa real contra dos pantallas mostrando P&L distintos: si
 *   divergen, el reporte duplicó el cálculo y hay que borrar el duplicado, no
 *   la prueba.
 * - Los dos nombres de parámetro de fecha sirven. `Reportes.tsx` manda
 *   `fechaInicio`/`fechaFin`; el resumen nació con `desde`/`hasta`. Aceptar solo
 *   uno hacía que el filtro de fechas de Analítica no filtrara, sin avisar.
 *
 * Sobre roles: la matriz de la Fase 4 (Admin/Socio/Comercial) vive en el cliente
 * —`src/nav/modulos.ts` y el shell—, porque el server no autentica. Eso no se
 * re-verifica en un test HTTP fingiendo un header que nadie lee: está en
 * `tests/ui/finanzas-ia.test.tsx`, que sí monta la app con un usuario real.
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
const DB_PATH = path.resolve(process.cwd(), '.test-finanzas-roles.db');

const ADMIN = 'adm-fin-roles';
const MES = { desde: '2026-09-01', hasta: '2026-09-30' };

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });

  await testDb.insert(schema.users).values({ id: ADMIN, name: 'Admin', email: 'admin@roles.cr', role: 'Admin' });
  await testDb.insert(schema.clientes).values([
    { id: 'cli-a', nombre: 'Cliente A', condicion_pago: 'Contado', estado: 'Activo' },
    { id: 'cli-b', nombre: 'Cliente B', condicion_pago: 'Credito', estado: 'Activo' },
  ]);
  await testDb.insert(schema.facturas).values([
    { id: 'f-pagada', consecutivo: 'FAC-001', fecha: '2026-09-05', clienteId: 'cli-a', vendedorId: ADMIN, subtotal: 100000, descuento: 0, total: 100000, condicion_pago: 'Contado', estado: 'Pagada' },
    { id: 'f-pendiente', consecutivo: 'FAC-002', fecha: '2026-09-08', clienteId: 'cli-b', vendedorId: ADMIN, subtotal: 60000, descuento: 0, total: 60000, condicion_pago: 'Credito', estado: 'Pendiente' },
  ]);
  await testDb.insert(schema.gastos).values([
    { id: 'g-1', fecha: '2026-09-09', categoria: 'Diésel', monto: 25000, descripcion: 'Combustible', usuarioId: ADMIN },
  ]);

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch { /* la base ya no importa */ }
});

describe('GET /api/reportes/flujo-caja', () => {
  it('responde 200 con la forma del ciclo', async () => {
    const res = await request(app).get('/api/reportes/flujo-caja').query(MES);
    expectApi(res, 200);
    expect(Array.isArray(res.body.cicloDelDinero)).toBe(true);
    expect(res.body.cicloDelDinero.map((n: any) => n.etapa)).toEqual([
      'ventas_ruta', 'documentos', 'cuentasPorCobrar', 'cobrado', 'caja', 'resultado',
    ]);
  });

  it('es el mismo cuerpo que /api/finanzas/resumen, cifra por cifra', async () => {
    const [resumen, flujo] = await Promise.all([
      request(app).get('/api/finanzas/resumen').query(MES),
      request(app).get('/api/reportes/flujo-caja').query(MES),
    ]);
    expectApi(resumen, 200);
    expectApi(flujo, 200);
    // Comparación profunda, no campo por campo: si el reporte inventa una clave
    // nueva, aquí se nota.
    expect(flujo.body).toEqual(resumen.body);
  });

  it('el filtro de fechas funciona con el nombre que manda la pantalla', async () => {
    const mes = await request(app).get('/api/reportes/flujo-caja').query(MES);
    expectApi(mes, 200);

    // Un rango sin facturas ni gastos: los flujos del mes valen cero, pero el saldo
    // por cobrar sigue ahí. Una factura de septiembre no deja de deber existir en
    // enero; lo que no existe en enero es la venta.
    const vacio = await request(app).get('/api/reportes/flujo-caja').query({
      fechaInicio: '2026-01-01', fechaFin: '2026-01-31',
    });
    expectApi(vacio, 200);
    expect(vacio.body.ingresosFacturados).toBe(0);
    expect(vacio.body.cicloDelDinero).toHaveLength(6);
    const montoDe = (cuerpo: any, etapa: string) =>
      cuerpo.cicloDelDinero.find((n: any) => n.etapa === etapa)?.monto;
    for (const etapa of ['ventas_ruta', 'documentos', 'cobrado', 'caja', 'resultado']) {
      expect(montoDe(vacio.body, etapa), `${etapa} en enero`).toBe(0);
    }
    expect(montoDe(vacio.body, 'cuentasPorCobrar')).toBe(60000);
  });

  it('el rango cambia el resultado, o sea que el filtro se aplica de verdad', async () => {
    const septiembre = await request(app).get('/api/reportes/flujo-caja').query(MES);
    const agosto = await request(app).get('/api/reportes/flujo-caja').query({
      fechaInicio: '2026-08-01', fechaFin: '2026-08-31',
    });
    expectApi(septiembre, 200);
    expectApi(agosto, 200);
    expect(septiembre.body.ingresosFacturados).toBeGreaterThan(0);
    expect(agosto.body.ingresosFacturados).toBe(0);
  });

  it('rechaza fechas mal escritas en vez de devolver el mes en curso', async () => {
    const res = await request(app).get('/api/reportes/flujo-caja').query({ desde: 'septiembre', hasta: '2026-09-30' });
    expectApi(res, 400);
  });

  it('rechaza un rango al revés', async () => {
    const res = await request(app).get('/api/reportes/flujo-caja').query({
      desde: '2026-09-30', hasta: '2026-09-01',
    });
    expectApi(res, 400);
  });
});

describe('Documentos y gastos siguen respondiendo igual', () => {
  it('las facturas del modulo siguen listadas por GET /api/facturas', async () => {
    const res = await request(app).get('/api/facturas');
    expectApi(res, 200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('un gasto nuevo entra por POST /api/gastos y aparece en el resumen', async () => {
    const res = await request(app).post('/api/gastos').send({
      fecha: '2026-09-20', categoria: 'Viáticos', monto: 7500, descripcion: 'Gasto de prueba', usuarioId: ADMIN,
    });
    expectApi(res, 200);

    const resumen = await request(app).get('/api/finanzas/resumen').query(MES);
    expectApi(resumen, 200);
    expect(resumen.body.gastos).toBeGreaterThanOrEqual(32500);
  });
});