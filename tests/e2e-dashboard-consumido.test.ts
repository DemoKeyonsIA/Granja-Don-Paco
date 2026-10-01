/**
 * Fase 5 — `/api/dashboard/enterprise` queda subordinado a `/api/finanzas/resumen`.
 *
 * El Centro de Mando desapareció del sidebar, pero su endpoint no: pasó a
 * alimentar la columna "Salud del negocio" de Resumen. El riesgo de eso es
 * concreto y es el que este archivo ata: si los dos endpoints siguen calculando
 * el dinero por su cuenta, la columna derecha puede contradecir a las cinco
 * tarjetas de la izquierda — que es exactamente el defecto que la Fase 3 cerró y
 * que el plan contabiliza como "11 cálculos del P&L, 4 definiciones incompatibles".
 *
 * Por eso aquí no se compara un componente contra otro: se compara el endpoint
 * viejo contra la fuente única, con el rango de hoy, y se exige igualdad exacta.
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
const DB_PATH = path.resolve(process.cwd(), '.test-dashboard-consumido.db');

const ADMIN = 'adm-fase5';
const HOY = new Date().toISOString().split('T')[0];

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });

  await testDb.insert(schema.users).values({ id: ADMIN, name: 'Admin', email: 'admin@fase5.cr', role: 'Admin' });
  await testDb.insert(schema.clientes).values([
    { id: 'cli-1', nombre: 'Cliente Uno', condicion_pago: 'Contado', estado: 'Activo' },
    { id: 'cli-2', nombre: 'Cliente Dos', condicion_pago: 'Credito', estado: 'Activo' },
  ]);
  await testDb.insert(schema.facturas).values([
    // Pagada del mismo día: cuenta como ingreso facturado y como cobrado.
    { id: 'f-hoy-pagada', consecutivo: 'FAC-H1', fecha: HOY, clienteId: 'cli-1', vendedorId: ADMIN, subtotal: 120000, descuento: 0, total: 120000, condicion_pago: 'Contado', estado: 'Pagada' },
    // Pendiente del mismo día: es ingreso devengado pero no caja. Es la que
    // separa `ingresosFacturados` de `ingresosCobrados`, y por eso hace falta.
    { id: 'f-hoy-credito', consecutivo: 'FAC-H2', fecha: HOY, clienteId: 'cli-2', vendedorId: ADMIN, subtotal: 80000, descuento: 0, total: 80000, condicion_pago: 'Credito', estado: 'Pendiente' },
  ]);
  await testDb.insert(schema.gastos).values([
    { id: 'g-hoy', fecha: HOY, categoria: 'Diésel', monto: 30000, descripcion: 'Combustible del día', usuarioId: ADMIN },
  ]);

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch { /* la base ya no importa */ }
});

const resumenDeHoy = async () => {
  const res = await request(app).get('/api/finanzas/resumen').query({ desde: HOY, hasta: HOY });
  expectApi(res, 200);
  return res.body;
};

describe('el endpoint del Centro de Mando sigue sirviendo a Resumen, sin recalcular el P&L', () => {
  it('responde 200 con las cifras operativas que el bloque necesita', async () => {
    const res = await request(app).get('/api/dashboard/enterprise');
    expectApi(res, 200);
    for (const clave of [
      'cartonesProducidos', 'stockBodegaCentral', 'totalAvesVivas', 'rutasActivas',
      'clientesActivos', 'desperdiciosHoy', 'impactoDesperdicioHoy',
    ]) {
      expect(typeof res.body[clave], clave).toBe('number');
    }
    expect(Array.isArray(res.body.alertas)).toBe(true);
  });

  it('ingresos: ingresosHoy es el ingresosFacturados de la fuente única', async () => {
    const [dash, resumen] = await Promise.all([
      request(app).get('/api/dashboard/enterprise'),
      resumenDeHoy(),
    ]);
    expectApi(dash, 200);
    expect(dash.body.ingresosHoy).toBe(resumen.ingresosFacturados);
  });

  it('gastos: gastosHoy es el gastos de la fuente única', async () => {
    const [dash, resumen] = await Promise.all([
      request(app).get('/api/dashboard/enterprise'),
      resumenDeHoy(),
    ]);
    expect(dash.body.gastosHoy).toBe(resumen.gastos);
  });

  it('utilidad: utilidadNeta es utilidad = ingresos − gastos, no un tercer cálculo', async () => {
    const [dash, resumen] = await Promise.all([
      request(app).get('/api/dashboard/enterprise'),
      resumenDeHoy(),
    ]);
    expect(dash.body.utilidadNeta).toBe(resumen.utilidad);
    expect(dash.body.utilidadNeta).toBe(resumen.ingresosFacturados - resumen.gastos);
  });

  it('cartera: cuentasPorCobrar coincide, y sigue siendo el saldo real', async () => {
    const [dash, resumen] = await Promise.all([
      request(app).get('/api/dashboard/enterprise'),
      resumenDeHoy(),
    ]);
    // 80000 es la factura de crédito a medias; la pagada no cuenta.
    expect(dash.body.cuentasPorCobrar).toBe(80000);
    expect(dash.body.cuentasPorCobrar).toBe(resumen.cuentasPorCobrar);
  });

  it('el devengado y el cobrado no se confunden entre sí', async () => {
    // La factura de crédito del día es ingreso pero no caja: si algún día el
    // endpoint vuelve a filtrar por `estado === 'Pagada'`, esta comparación lo
    // delata sin depender de que nadie mire la pantalla.
    const [dash, resumen] = await Promise.all([
      request(app).get('/api/dashboard/enterprise'),
      resumenDeHoy(),
    ]);
    expect(dash.body.ingresosHoy).toBeGreaterThan(dash.body.ingresosCobradosHoy);
    expect(dash.body.ingresosCobradosHoy).toBeLessThan(resumen.ingresosFacturados);
  });

  it('las alertas que ahora viven en la bandeja de Resumen siguen viniendo de acá', async () => {
    const res = await request(app).get('/api/dashboard/enterprise');
    expectApi(res, 200);
    for (const a of res.body.alertas) {
      expect(typeof a.tipo, 'tipo').toBe('string');
      expect(typeof a.detalle, 'detalle').toBe('string');
      expect(['Crítica', 'Alta'], `nivel "${a.nivel}"`).toContain(a.nivel);
    }
  });
});