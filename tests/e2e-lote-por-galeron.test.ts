import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { requestAs } from './helpers/request-as';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';
import { expectApi } from './helpers/http';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
const DB_PATH = path.resolve(process.cwd(), '.test-lote-galeron.db');

const GRANJA = 'g-granja';
const GALERON = 'g-galeron-1';
const HOY = new Date().toISOString().split('T')[0];

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });

  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['u-admin', 'Administrador', 'admin@granja.com', 'Admin'] });
  await client.execute({ sql: `INSERT INTO granjas (id, nombre, ubicacion, encargado_id) VALUES (?, ?, ?, ?)`, args: [GRANJA, 'Concepcion', 'Rionegro', 'u-admin'] });
  // El galerón arranca con aves pero sin lote: es el estado real que rompió la UI.
  await client.execute({
    sql: `INSERT INTO galerones (id, granja_id, nombre, capacidad_maxima, estado, tipo_galeron, aves_en_produccion, produccion_diaria_esperada) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [GALERON, GRANJA, 'Galerón 1', 5000, 'Activo', 'Productora', 3000, 0],
  });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — El lote se declara dentro del galerón', () => {
  it('un galerón con aves y sin lote no reporta lotes activos', async () => {
    const res = await requestAs(app, 'u-admin').get(`/api/granjas/${GRANJA}/detalle`);
    expectApi(res, 200);
    expect(res.body.resumen.avesTotal).toBe(3000);
    expect(res.body.resumen.totalLotes).toBe(0);
    expect(res.body.galerones[0].lotes).toHaveLength(0);
    expect(res.body.galerones[0].lotesActivos).toBe(0);
  });

  it('crea el lote desde el galerón y el detalle lo muestra', async () => {
    const res = await requestAs(app, 'u-admin').post('/api/lotes').send({
      galeronId: GALERON,
      fecha_ingreso: HOY,
      cantidad_inicial: 3000,
      linea_genetica: 'Hy-Line W36',
      estado: 'Activo',
    });
    expectApi(res, 200);

    const det = await requestAs(app, 'u-admin').get(`/api/granjas/${GRANJA}/detalle`);
    expectApi(det, 200);
    expect(det.body.resumen.totalLotes).toBe(1);
    expect(det.body.galerones[0].lotesActivos).toBe(1);
    expect(det.body.galerones[0].lotes[0].linea_genetica).toBe('Hy-Line W36');
    expect(det.body.galerones[0].lotes[0].cantidad_inicial).toBe(3000);
  });

  it('el lote creado aparece en /api/lotes', async () => {
    const res = await requestAs(app, 'u-admin').get('/api/lotes');
    expectApi(res, 200);
    expect(res.body.map((l: any) => l.linea_genetica)).toContain('Hy-Line W36');
  });

  it('el centinela NO_LOTE_ACTIVO nunca aparece en las lecturas', async () => {
    // Se inserta a mano el centinela, con estado Activo como lo dejaba el bug.
    await testDb.insert(schema.lotes_aves).values({
      id: 'NO_LOTE_ACTIVO',
      galeronId: GALERON,
      fecha_ingreso: HOY,
      cantidad_inicial: 0,
      linea_genetica: 'Sin lote activo',
      estado: 'Activo',
    });

    const lotes = await requestAs(app, 'u-admin').get('/api/lotes');
    expect(lotes.body.map((l: any) => l.id)).not.toContain('NO_LOTE_ACTIVO');

    const det = await requestAs(app, 'u-admin').get(`/api/granjas/${GRANJA}/detalle`);
    // Sigue habiendo 1 solo lote: el centinela no se suma al lote real.
    expect(det.body.resumen.totalLotes).toBe(1);
    expect(det.body.galerones[0].lotesActivos).toBe(1);
    expect(det.body.galerones[0].lotes).toHaveLength(1);

    const dash = await requestAs(app, 'u-admin').get('/api/dashboard/produccion-detalle');
    expect(dash.body.resumen.totalLotes).toBe(1);
    // Y las aves salen del galerón, no de la suma de lotes.
    expect(dash.body.resumen.totalAves).toBe(3000);
    expect(dash.body.porGranja[0].aves).toBe(3000);
  });

  it('finalizar el lote lo saca del activo y lo deja en el historial', async () => {
    const lotes = await requestAs(app, 'u-admin').get('/api/lotes');
    const real = lotes.body.find((l: any) => l.linea_genetica === 'Hy-Line W36');

    const res = await requestAs(app, 'u-admin').delete(`/api/lotes/${real.id}`);
    expectApi(res, 200);

    const det = await requestAs(app, 'u-admin').get(`/api/granjas/${GRANJA}/detalle`);
    expect(det.body.resumen.totalLotes).toBe(0);
    expect(det.body.galerones[0].lotesActivos).toBe(0);
    // Sigue en la lista del galerón para que se vea el historial.
    expect(det.body.galerones[0].lotes).toHaveLength(1);
  });
});