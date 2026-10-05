import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
const DB_PATH = path.resolve(process.cwd(), '.test-operaciones-cargas.db');

const CAMPONAMENTO_ID = 'cam-001';
const OTRO_CAMIONERO_ID = 'cam-002';
const ENCARGADO_ID = 'desp-001';
const GRANJA_CARGA_ID = 'granja-carga-1';
const GALERON_CARGA_ID = 'galeron-carga-1';
const CAMION_SIN_ASIGNAR = 'camion-sin-asignar';

let camionAsignadoId = '';
let granjaId = '';
let galeronId = '';

async function crearStock(producto: string, cantidad: number) {
  const res = await request(app)
    .post('/api/produccion/recoleccion')
    .send({
      galeron: 'Galerón Cargas',
      detalles: [{ producto, cantidad }]
    });
  expect(res.status).toBe(200);
}

async function crearTraslado(cargaId: string, producto: string, cantidad: number, opts: { camionId?: string | null } = {}) {
  const body: any = {
    granjaId,
    producto,
    cantidad,
    unidad: 'cartones',
    responsable: 'Encargado de Galerón',
    cargaId,
    creadoPorId: ENCARGADO_ID
  };
  if (opts.camionId !== undefined) body.camionId = opts.camionId;
  const res = await request(app).post('/api/operaciones/traslado').send(body);
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  const testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);

  // Granja + galerón vía wizard
  const wiz = await request(app).post('/api/granjas/wizard').send({
    nombre: 'Granja Cargas',
    ubicacion: 'Heredia',
    tipo_produccion: 'Postura',
    encargadoId: ENCARGADO_ID,
    galerones: [{ nombre: 'Galerón Cargas', capacidad_maxima: 1000 }]
  });
  expect(wiz.status).toBe(201);

  const granjas = (await request(app).get('/api/granjas')).body;
  granjaId = granjas.find((g: any) => g.nombre === 'Granja Cargas').id;
  const galerones = (await request(app).get('/api/galerones')).body;
  galeronId = galerones.find((g: any) => g.granjaId === granjaId && g.nombre === 'Galerón Cargas').id;
  expect(granjaId).toBeTruthy();
  expect(galeronId).toBeTruthy();

  // Camión asignado al camionero CAMPONAMENTO_ID
  const cam = await request(app).post('/api/camiones').send({
    nombre: 'Camión Asignado',
    placa: 'C-001',
    camioneroId: CAMPONAMENTO_ID,
    capacidadCartones: 500,
    estado: 'Activo'
  });
  expect(cam.status).toBe(201);
  camionAsignadoId = cam.body.id;

  // Stock en Granja para los traslados
  await crearStock('Huevos - Grande', 500);
  await crearStock('Huevos - Mediano', 300);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — Cargas de encargado de galerón visibles para el camionero', () => {
  it('carga con camión asignado al camionero aparece', async () => {
    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Grande', 100, { camionId: camionAsignadoId });

    const res = await request(app).get(`/api/operaciones/cargas?camioneroId=${CAMPONAMENTO_ID}`);
    expect(res.status).toBe(200);
    const carga = res.body.find((c: any) => c.cargaId === cargaId);
    expect(carga).toBeDefined();
    expect(carga.estado).toBe('Pendiente');
    expect(carga.items).toHaveLength(1);
  });

  it('REGRESIÓN — carga SIN camión (o camión inexistente) también debe salir al camionero', async () => {
    // Escena del bug reportado: encargado registra traslados sin seleccionar camión
    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Grande', 100, { camionId: null });
    await crearTraslado(cargaId, 'Huevos - Mediano', 50, { camionId: null });

    // Y el caso real de producción: camión id que ya no existe en la tabla camiones
    const cargaId2 = crypto.randomUUID();
    await crearTraslado(cargaId2, 'Huevos - Grande', 25, { camionId: 'camion-borrado-o-inexistente' });

    const res = await request(app).get(`/api/operaciones/cargas?camioneroId=${CAMPONAMENTO_ID}`);
    expect(res.status).toBe(200);

    const carga = res.body.find((c: any) => c.cargaId === cargaId);
    expect(carga).toBeDefined();
    expect(carga.items).toHaveLength(2);
    expect(carga.estado).toBe('Pendiente');

    const carga2 = res.body.find((c: any) => c.cargaId === cargaId2);
    expect(carga2).toBeDefined();
    expect(carga2.estado).toBe('Pendiente');
  });

  it('no pierde la asignación: carga en camión de otro camionero no sale para este', async () => {
    const cam = await request(app).post('/api/camiones').send({
      nombre: 'Camión Otro',
      placa: 'C-002',
      camioneroId: OTRO_CAMIONERO_ID,
      capacidadCartones: 500,
      estado: 'Activo'
    });
    expect(cam.status).toBe(201);

    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Grande', 30, { camionId: cam.body.id });

    const mios = (await request(app).get(`/api/operaciones/cargas?camioneroId=${CAMPONAMENTO_ID}`)).body;
    expect(mios.find((c: any) => c.cargaId === cargaId)).toBeUndefined();

    const otros = (await request(app).get(`/api/operaciones/cargas?camioneroId=${OTRO_CAMIONERO_ID}`)).body;
    expect(otros.find((c: any) => c.cargaId === cargaId)).toBeDefined();
  });

  it('el camionero puede confirmar la carga sin camión', async () => {
    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Grande', 40, { camionId: null });

    const list = (await request(app).get(`/api/operaciones/cargas?camioneroId=${CAMPONAMENTO_ID}`)).body;
    const carga = list.find((c: any) => c.cargaId === cargaId);
    expect(carga).toBeDefined();

    const res = await request(app)
      .post(`/api/operaciones/carga/${carga.cargaId}/confirmar`)
      .send({ camioneroId: CAMPONAMENTO_ID });
    expect(res.status).toBe(200);

    const traslados = (await request(app).get('/api/operaciones/traslados')).body;
    const pendiente = traslados.find((t: any) => t.cargaId === cargaId);
    expect(pendiente.estado).toBe('EnTransito');
  });
});