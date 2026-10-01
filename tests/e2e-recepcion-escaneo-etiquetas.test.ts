import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl } from './helpers/db';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
const DB_PATH = path.resolve(process.cwd(), '.test-recepcion-escaneo.db');

const encargadoId = 'desp-esc';
const BODEGUERO = 'Bodeguero Escaner';
let granjaId = '';
let trasladoId = '';
let codigoOK = '';
let codigoOK2 = '';

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);

  const wiz = await request(app).post('/api/granjas/wizard').send({
    nombre: 'Granja Escaneo',
    ubicacion: 'Alajuela',
    tipo_produccion: 'Postura',
    encargadoId: encargadoId,
    galerones: [{ nombre: 'Galerón Escaneo', capacidad_maxima: 1000 }]
  });
  expect(wiz.status).toBe(201);

  granjaId = (await request(app).get('/api/granjas')).body.find((g: any) => g.nombre === 'Granja Escaneo').id;
  expect(granjaId).toBeTruthy();

  const stock = await request(app).post('/api/produccion/recoleccion').send({
    galeron: 'Galerón Escaneo',
    detalles: [{ producto: 'Huevos - Mediano', cantidad: 400 }]
  });
  expect(stock.status).toBe(200);

  // Generar 2 etiquetas (estado Generada) que se vienen con la carga
  const et1 = await request(app).post('/api/etiquetas/generar').send({
    producto: 'Huevos - Mediano', cantidad: 30, granjaOrigen: 'Granja Escaneo', lote: 'L-ESC'
  });
  expect(et1.status).toBe(201);
  codigoOK = et1.body.codigoUnico;

  const et2 = await request(app).post('/api/etiquetas/generar').send({
    producto: 'Huevos - Mediano', cantidad: 30, granjaOrigen: 'Granja Escaneo', lote: 'L-ESC'
  });
  expect(et2.status).toBe(201);
  codigoOK2 = et2.body.codigoUnico;
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

async function crearCarga(cantidad: number): Promise<string> {
  const res = await request(app).post('/api/operaciones/traslado').send({
    granjaId,
    producto: 'Huevos - Mediano',
    cantidad,
    unidad: 'cartones',
    responsable: 'Encargado de Galerón',
    cargaId: crypto.randomUUID(),
    creadoPorId: encargadoId
  });
  expect(res.status).toBe(200);
  const traslados = (await request(app).get('/api/operaciones/traslados')).body;
  const t = traslados.filter((x: any) => x.granjaOrigenId === granjaId).pop();
  return t.id;
}

describe('E2E — Recepción por escaneo de etiquetas: confirma la carga del camión y marca EnBodega', () => {
  it('Escaneo de etiquetas válidas al recibir: se marcan EnBodega con traza Recibida', async () => {
    trasladoId = await crearCarga(60);
    const rec = await request(app).post('/api/operaciones/recepcion')
      .set('x-user-id', '1')
      .send({
        trasladoId,
        cantidadEsperada: 60,
        cantidadRecibida: 60,
        producto: 'Huevos - Mediano',
        responsableRecepcion: BODEGUERO,
        etiquetasCodigos: [codigoOK, codigoOK2]
      });
    expect(rec.status).toBe(200);
    expect(rec.body.etiquetasIngresadas).toEqual([codigoOK, codigoOK2]);

    for (const codigo of [codigoOK, codigoOK2]) {
      const traza = await request(app).get(`/api/etiquetas/trazabilidad/${codigo}`);
      expect(traza.status).toBe(200);
      expect(traza.body.etiqueta.estado).toBe('EnBodega');
      expect(traza.body.etiqueta.ubicacionActual).toBe('Bodega Central');
      expect(traza.body.etiqueta.fechaRecepcion).toBeTruthy();
      const eventos = traza.body.traza.map((t: any) => t.tipoEvento);
      expect(eventos).toContain('Generada');
      expect(eventos).toContain('Recibida');
      const recibida = traza.body.traza.find((t: any) => t.tipoEvento === 'Recibida');
      expect(String(recibida.observaciones)).toContain(BODEGUERO);
    }
  });

  it('Re-escaneo de una etiqueta ya EnBodega → 400', async () => {
    const t2 = await crearCarga(60);
    const rec = await request(app).post('/api/operaciones/recepcion').send({
      trasladoId: t2,
      cantidadEsperada: 60,
      cantidadRecibida: 60,
      producto: 'Huevos - Mediano',
      responsableRecepcion: BODEGUERO,
      etiquetasCodigos: [codigoOK]
    });
    expect(rec.status).toBe(400);
    expect(String(rec.body.error)).toContain('ya fue recibida');
  });

  it('Etiqueta inexistente → 400 y la recepción no se registra', async () => {
    const antes = (await request(app).get('/api/operaciones/recepciones')).body.length;
    const t3 = await crearCarga(30);
    const rec = await request(app).post('/api/operaciones/recepcion').send({
      trasladoId: t3,
      cantidadEsperada: 30,
      cantidadRecibida: 30,
      producto: 'Huevos - Mediano',
      responsableRecepcion: BODEGUERO,
      etiquetasCodigos: ['ETQ-NO-EXISTE-1234']
    });
    expect(rec.status).toBe(400);
    expect(String(rec.body.error)).toContain('no encontrada');
    const despues = (await request(app).get('/api/operaciones/recepciones')).body.length;
    expect(despues).toBe(antes);
  });

  it('Etiqueta de otro producto → 400 (no contamina el inventario de Huevos)', async () => {
    const otra = await request(app).post('/api/etiquetas/generar').send({
      producto: 'Huevos - Grande', cantidad: 30, granjaOrigen: 'Granja Escaneo', lote: 'L-ESC'
    });
    const t4 = await crearCarga(30);
    const rec = await request(app).post('/api/operaciones/recepcion').send({
      trasladoId: t4,
      cantidadEsperada: 30,
      cantidadRecibida: 30,
      producto: 'Huevos - Mediano',
      responsableRecepcion: BODEGUERO,
      etiquetasCodigos: [otra.body.codigoUnico]
    });
    expect(rec.status).toBe(400);
    expect(String(rec.body.error)).toContain('corresponde a');
  });
});