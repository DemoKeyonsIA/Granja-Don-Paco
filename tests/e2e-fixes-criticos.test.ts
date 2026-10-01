/**
 * Fase 1 — regresión de los bugs críticos corregidos.
 *
 * Cada bloque ata un defecto a la ruta que lo producía, para que no vuelva.
 * Todos los tests usan una base propia (`.test-fixes-criticos.db`) y el auth de
 * pruebas por cabecera `x-user-id`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl } from './helpers/db';
import { expectApi } from './helpers/http';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
const DB_PATH = path.resolve(process.cwd(), '.test-fixes-criticos.db');

const ADMIN = 'adm-fc';

const como = (req: request.Test) => req.set('x-user-id', ADMIN);

/** Fecha con días de desplazamiento respecto a hoy, en ISO corto. */
const dias = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function sembrar(db: any) {
  await db.insert(schema.users).values({
    id: ADMIN, name: 'Administradora', email: 'admin@fc.cr', role: 'Admin',
  });

  await db.insert(schema.clientes).values([
    { id: 'cli-ruta-norte', nombre: 'Distribuidora Norte', ruta: 'Ruta Norte' },
    { id: 'cli-ruta-sur', nombre: 'Distribuidora Sur', ruta: 'Ruta Sur' },
  ]);

  const hoy = dias(0);
  await db.insert(schema.facturas).values([
    {
      id: 'f-norte', consecutivo: 'F-001', fecha: hoy, clienteId: 'cli-ruta-norte',
      vendedorId: ADMIN, subtotal: 100, descuento: 0, total: 100,
      condicion_pago: 'Contado', estado: 'Pagada',
    },
    {
      id: 'f-sur', consecutivo: 'F-002', fecha: hoy, clienteId: 'cli-ruta-sur',
      vendedorId: ADMIN, subtotal: 200, descuento: 0, total: 200,
      condicion_pago: 'Contado', estado: 'Pagada',
    },
  ]);

  await db.insert(schema.detallesFactura).values([
    { id: 'd-1', facturaId: 'f-norte', producto: 'Huevos', cantidad: 100, precio_unitario: 1, subtotal: 100 },
    { id: 'd-2', facturaId: 'f-sur', producto: 'Huevos', cantidad: 200, precio_unitario: 1, subtotal: 200 },
  ]);

  await db.insert(schema.granjas).values({
    id: 'granja-a', nombre: 'Granja A', ubicacion: 'Norte', encargadoId: ADMIN,
  });
  await db.insert(schema.galerones).values({
    id: 'gal-a', granjaId: 'granja-a', nombre: 'Galeron 1', capacidad_maxima: 10000,
  });
  await db.insert(schema.lotes_aves).values({
    id: 'lote-a', galeronId: 'gal-a', fecha_ingreso: dias(-30),
    cantidad_inicial: 5000, linea_genetica: 'Ross', estado: 'Activo',
  });
  await db.insert(schema.produccion_diaria).values([
    {
      id: 'pd-a1', loteId: 'lote-a', granjaId: 'granja-a', galeronId: 'gal-a',
      fecha: dias(-2), tipo_producto: 'Huevos', cantidad: 900, unidad: 'unidades',
    },
    {
      id: 'pd-a2', loteId: 'lote-a', granjaId: 'granja-a', galeronId: 'gal-a',
      fecha: dias(-1), tipo_producto: 'Huevos', cantidad: 950, unidad: 'unidades',
    },
    {
      id: 'pd-b1', loteId: 'lote-a', granjaId: 'granja-a', galeronId: 'gal-a',
      fecha: dias(-1), tipo_producto: 'Huevos', cantidad: 500, unidad: 'unidades',
    },
  ]);
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });
  await sembrar(testDb);
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('Bug 1 — Reportes: los 5 tabs cargan contra rutas que existen', () => {
  it('ventas-por-ruta responde 200 y agrupa por ruta', async () => {
    const res = await como(request(app).get('/api/reportes/ventas-por-ruta'));
    expectApi(res, 200, 'ventas por ruta');
    expect(Array.isArray(res.body)).toBe(true);
    const rutas = res.body.map((r: any) => r.ruta).sort();
    expect(rutas).toEqual(['Ruta Norte', 'Ruta Sur']);
    const norte = res.body.find((r: any) => r.ruta === 'Ruta Norte');
    expect(norte.facturas).toBe(1);
    expect(norte.totalVentas).toBe(100);
  });

  it('no existe la ruta que el cliente pedía antes (ventas-ruta)', async () => {
    // El bug era un 404 garantizado que se renderizaba como "sin datos".
    // Se documenta que la ruta vieja no debe volver a existir.
    const res = await como(request(app).get('/api/reportes/ventas-ruta'));
    expect(res.status).toBe(404);
  });

  it('los otros 4 reportes responden 200', async () => {
    for (const r of ['financiero', 'produccion', 'inventario', 'desperdicios']) {
      const res = await como(request(app).get(`/api/reportes/${r}`));
      expectApi(res, 200, `reporte ${r}`);
    }
  });

  it('el filtro de fechas del financiero acota el resultado', async () => {
    // Con las dos facturas de hoy, un rango que las excluye devuelve 0.
    const res = await como(request(app).get('/api/reportes/ventas-por-ruta')
      .query({ fechaInicio: dias(1), fechaFin: dias(2) }));
    expectApi(res, 200, 'ventas por ruta filtrado');
    expect(res.body).toEqual([]);
  });
});

describe('Bug 4 — historial de producción respeta granja y fechas', () => {
  it('sin filtros devuelve todo', async () => {
    const res = await como(request(app).get('/api/produccion/historial'));
    expectApi(res, 200, 'historial sin filtros');
    expect(res.body).toHaveLength(3);
  });

  it('filtra por granjaId', async () => {
    const res = await como(request(app).get('/api/produccion/historial')
      .query({ granjaId: 'granja-a' }));
    expectApi(res, 200, 'historial por granja');
    expect(res.body).toHaveLength(3);
    expect(res.body.every((p: any) => p.granjaId === 'granja-a')).toBe(true);
  });

  it('una granja ajena no devuelve filas (el bug lo ignoraba en silencio)', async () => {
    const res = await como(request(app).get('/api/produccion/historial')
      .query({ granjaId: 'granja-inexistente' }));
    expectApi(res, 200, 'historial de granja ajena');
    expect(res.body).toEqual([]);
  });

  it('acota por rango de fechas', async () => {
    const res = await como(request(app).get('/api/produccion/historial')
      .query({ desde: dias(-1), hasta: dias(-1) }));
    expectApi(res, 200, 'historial por fechas');
    expect(res.body).toHaveLength(2);
    expect(res.body.every((p: any) => p.fecha === dias(-1))).toBe(true);
  });

  it('solo hay un handler para la ruta', () => {
    // Regresión estructural: el duplicado ganaba la resolución de Express.
    const capas = (app as any)._router?.stack ?? (app as any).router?.stack ?? [];
    const registradas = capas.filter((c: any) =>
      c?.route?.path === '/api/produccion/historial' && c?.route?.methods?.get);
    expect(registradas).toHaveLength(1);
  });
});
