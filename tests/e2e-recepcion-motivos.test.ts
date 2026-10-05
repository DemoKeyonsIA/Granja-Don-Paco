import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
let backfill: (db: any) => Promise<void>;
const DB_PATH = path.resolve(process.cwd(), '.test-recepcion-motivos.db');

const encargadoId = 'desp-001';
let granjaId = '';

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
  backfill = mod.backfillRecepcionesDesperdicio;

  const wiz = await request(app).post('/api/granjas/wizard').send({
    nombre: 'Granja Motivos',
    ubicacion: 'Alajuela',
    tipo_produccion: 'Postura',
    encargadoId: encargadoId,
    galerones: [{ nombre: 'Galerón Motivos', capacidad_maxima: 1000 }]
  });
  expect(wiz.status).toBe(201);

  granjaId = (await request(app).get('/api/granjas')).body.find((g: any) => g.nombre === 'Granja Motivos').id;
  expect(granjaId).toBeTruthy();

  const stock = await request(app).post('/api/produccion/recoleccion').send({
    galeron: 'Galerón Motivos',
    detalles: [{ producto: 'Huevos - Mediano', cantidad: 500 }]
  });
  expect(stock.status).toBe(200);
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

describe('E2E — Clasificación del motivo de diferencia en recepción (desperdicio vs posible robo)', () => {
  it('motivo de cartón roto/caído → se registra DESPERDICIO (no alerta de robo)', async () => {
    const trasladoId = await crearCarga(100);
    const rec = await request(app).post('/api/operaciones/recepcion').send({
      trasladoId,
      cantidadEsperada: 100,
      cantidadRecibida: 80,
      motivoDiferencia: 'quebrados',
      producto: 'Huevos - Mediano',
      responsableRecepcion: 'Bodeguero Test'
    });
    expect(rec.status).toBe(200);
    expect(rec.body.esPosibleRobo).toBe(false);

    const desperdicios = (await request(app).get('/api/desperdicios')).body;
    const desp = desperdicios.find((d: any) => d.producto === 'Huevos - Mediano');
    expect(desp).toBeDefined();
    expect(desp.cantidad).toBe(20);
    expect(desp.motivo).toBe('Cartón de huevos que se rompieron o se cayeron');

    const recepciones = (await request(app).get('/api/operaciones/recepciones')).body;
    const r = recepciones.filter((x: any) => x.trasladoId === trasladoId).pop();
    expect(r.tipoDiferencia).toBe('desperdicio');
    expect(r.esPosibleRobo).toBe(false);
  });

  it('motivo de cartón que no aparece → NO es desperdicio, es POSIBLE ROBO', async () => {
    const before = (await request(app).get('/api/desperdicios')).body.filter((d: any) => d.producto === 'Huevos - Mediano').length;
    const trasladoId = await crearCarga(60);
    const rec = await request(app).post('/api/operaciones/recepcion').send({
      trasladoId,
      cantidadEsperada: 60,
      cantidadRecibida: 40,
      motivoDiferencia: 'no-aparece',
      producto: 'Huevos - Mediano',
      responsableRecepcion: 'Bodeguero Test'
    });
    expect(rec.status).toBe(200);
    expect(rec.body.esPosibleRobo).toBe(true);

    // No se registra desperdicio por un faltante que no apareció
    const despues = (await request(app).get('/api/desperdicios')).body.filter((d: any) => d.producto === 'Huevos - Mediano').length;
    expect(despues).toBe(before);

    // El kárdex sí equilibra: el faltante sale como pérdida en tránsito
    const movimientos = (await request(app).get('/api/inventario/movimientos')).body;
    const perdidas = movimientos.filter((m: any) => m.tipo === 'Pérdida en Tránsito' && m.producto === 'Huevos - Mediano');
    expect(perdidas.length).toBeGreaterThan(0);

    const recepciones = (await request(app).get('/api/operaciones/recepciones')).body;
    const r = recepciones.filter((x: any) => x.trasladoId === trasladoId).pop();
    expect(r.tipoDiferencia).toBe('alerta');
    expect(r.esPosibleRobo).toBe(true);
  });

  it('dashboard/enterprise emite alerta "Posible robo de huevos" para el faltante', async () => {
    const res = await request(app).get('/api/dashboard/enterprise');
    expect(res.status).toBe(200);
    const alerta = res.body.alertas.find((a: any) => a.tipo === 'Posible robo de huevos');
    expect(alerta).toBeDefined();
    expect(alerta.detalle).toContain('40');
  });

  it('recepción con remisión y diferencia-peso → alerta, no desperdicio', async () => {
    const before = (await request(app).get('/api/desperdicios')).body.filter((d: any) => d.producto === 'Huevos - Mediano').length;
    const guia = await request(app).post('/api/operaciones/remision').send({
      granjaId,
      producto: 'Huevos - Mediano',
      cartones: 50,
      responsable: 'Encargado Test'
    });
    expect(guia.status).toBe(201);
    const guiaId = (await request(app).get('/api/operaciones/remisiones')).body.find((g: any) => g.producto === 'Huevos - Mediano' && g.estado === 'EnTransito').id;

    const rec = await request(app).post('/api/operaciones/recepcion-remision').send({
      guiaId,
      cantidadRecibida: 30,
      motivoDiferencia: 'diferencia-peso',
      responsable: 'Bodeguero Test'
    });
    expect(rec.status).toBe(200);

    const despues = (await request(app).get('/api/desperdicios')).body.filter((d: any) => d.producto === 'Huevos - Mediano').length;
    expect(despues).toBe(before);

    const recepciones = (await request(app).get('/api/operaciones/recepciones')).body;
    const r = recepciones.filter((x: any) => x.guiaRemisionId === guiaId).pop();
    expect(r.tipoDiferencia).toBe('alerta');
    expect(r.esPosibleRobo).toBe(true);
  });

  it('backfill reclasifica históricos con motivo de faltante como posible robo', async () => {
    // Simula una recepción del backfill anterior (tipoDiferencia null, desperdicio incorrecto creado)
    const recepcionId = crypto.randomUUID();
    await testDb.insert(schema.recepciones).values({
      id: recepcionId,
      trasladoId: 'traslado-hist-alerta',
      fechaRecepcion: '2026-09-14T10:00:00.000Z',
      cantidadEsperada: 30,
      cantidadRecibida: 25,
      diferencia: 5,
      motivoDiferencia: 'no-aparece',
      responsableRecepcion: 'Bodeguero Anterior',
      estado: 'ConDiferencia'
    });
    const despId = crypto.randomUUID();
    await testDb.insert(schema.desperdicios).values({
      id: despId,
      origen: 'Recepción Bodega',
      producto: 'Huevos - Mediano',
      cantidad: 5,
      motivo: 'no-aparece',
      responsable: 'Bodeguero Anterior',
      fecha: '2026-09-14T10:00:00.000Z',
      observaciones: `Backfill: recepción ${recepcionId}`
    });
    await testDb.insert(schema.movimientosInventario).values({
      id: crypto.randomUUID(),
      producto: 'Huevos - Mediano',
      cantidad: 5,
      tipo: 'Pérdida en Tránsito',
      origen: 'Granja',
      destino: 'Desperdicio',
      fecha: '2026-09-14T10:00:00.000Z',
      referencia_id: recepcionId
    });

    await backfill(testDb);

    const desp = (await testDb.select().from(schema.desperdicios)).find((d: any) => d.id === despId);
    expect(desp).toBeUndefined();

    const recs = await testDb.select().from(schema.recepciones);
    const r = recs.find((x: any) => x.id === recepcionId);
    expect(r.tipoDiferencia).toBe('alerta');
  });

  it('resumen de desperdicios cuenta la ventana de la última jornada (7 días)', async () => {
    const trasladoId = await crearCarga(40);
    await request(app).post('/api/operaciones/recepcion').send({
      trasladoId,
      cantidadEsperada: 40,
      cantidadRecibida: 36,
      motivoDiferencia: 'quebrados',
      producto: 'Huevos - Mediano',
      responsableRecepcion: 'Bodeguero Test'
    });

    const res = await request(app).get('/api/desperdicios/resumen');
    expect(res.status).toBe(200);
    const porOrigen = res.body.porOrigen as Record<string, number>;
    expect(Number(porOrigen['Recepción Bodega'] || 0)).toBeGreaterThanOrEqual(4);
    expect(res.body.totalRegistros).toBeGreaterThanOrEqual(1);
  });
});