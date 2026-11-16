import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { requestAs } from './helpers/request-as';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
const DB_PATH = path.resolve(process.cwd(), '.test-recepcion-desperdicio.db');

const encargadoId = 'desp-001';
let granjaId = '';
let galeronId = '';
let backfill: (db: any) => Promise<void>;

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
  backfill = mod.backfillRecepcionesDesperdicio;

  const wiz = await requestAs(app, '1').post('/api/granjas/wizard').send({
    nombre: 'Granja Recepción',
    ubicacion: 'Heredia',
    tipo_produccion: 'Postura',
    encargadoId: encargadoId,
    galerones: [{ nombre: 'Galerón Recepción', capacidad_maxima: 1000 }]
  });
  expect(wiz.status).toBe(201);

  granjaId = (await requestAs(app, '1').get('/api/granjas')).body.find((g: any) => g.nombre === 'Granja Recepción').id;
  expect(granjaId).toBeTruthy();

  const stock = await requestAs(app, '1').post('/api/produccion/recoleccion').send({
    galeron: 'Galerón Recepción',
    detalles: [{ producto: 'Huevos - Grande', cantidad: 500 }]
  });
  expect(stock.status).toBe(200);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

async function crearCarga(cantidad: number): Promise<string> {
  const res = await requestAs(app, '1').post('/api/operaciones/traslado').send({
    granjaId,
    producto: 'Huevos - Grande',
    cantidad,
    unidad: 'cartones',
    responsable: 'Encargado de Galerón',
    cargaId: crypto.randomUUID(),
    creadoPorId: encargadoId
  });
  expect(res.status).toBe(200);
  const traslados = (await requestAs(app, '1').get('/api/operaciones/traslados')).body;
  const t = traslados.filter((x: any) => x.granjaOrigenId === granjaId).pop();
  const correccion = await requestAs(app, '1').post(`/api/operaciones/traslados/${t.id}/corregir-peso-kg`)
    .send({ pesoKg: cantidad, motivo: 'Peso confirmado en báscula de prueba' });
  expect(correccion.status).toBe(201);
  return t.id;
}

describe('E2E — Recepción en bodega con diferencia registra desperdicio y alerta', () => {
  it('recepción conforme no genera desperdicio', async () => {
    const trasladoId = await crearCarga(100);
    const res = await requestAs(app, '1').post('/api/operaciones/recepcion').send({
      trasladoId,
      cantidadKgEsperada: 100,
      cantidadKgRecibida: 100,
      motivoDiferencia: null,
      producto: 'Huevos - Grande',
      responsableRecepcion: 'Bodeguero Test'
    });
    expect(res.status).toBe(200);

    const desperdicios = (await requestAs(app, '1').get('/api/desperdicios')).body;
    expect(desperdicios.some((d: any) => d.producto === 'Huevos - Grande')).toBe(false);
  });

  it('REGRESIÓN — recepción con diferencia registra el desperdicio y la pérdida en tránsito', async () => {
    const trasladoId = await crearCarga(200);
    const rec = await requestAs(app, '1').post('/api/operaciones/recepcion').send({
      trasladoId,
      cantidadKgEsperada: 200,
      cantidadKgRecibida: 120,
      motivoDiferencia: 'Quebrado y sucio en tránsito',
      producto: 'Huevos - Grande',
      responsableRecepcion: 'Bodeguero Test'
    });
    expect(rec.status).toBe(200);

    const desperdicios = (await requestAs(app, '1').get('/api/desperdicios')).body;
    const desp = desperdicios.find((d: any) => d.producto === 'Huevos - Grande');
    expect(desp).toBeDefined();
    expect(desp.cantidad).toBe(80);
    expect(desp.motivo).toBe('Quebrado y sucio en tránsito');
    expect(desp.origen).toContain('Recepción');

    const movimientos = (await requestAs(app, '1').get('/api/inventario/movimientos')).body;
    const perdida = movimientos.find((m: any) => m.tipo === 'Pérdida en Tránsito' && m.producto === 'Huevos - Grande');
    expect(perdida).toBeDefined();
    expect(perdida.cantidad).toBe(80);
    expect(perdida.destino).toBe('Desperdicio');

    const traslados = (await requestAs(app, '1').get('/api/operaciones/traslados')).body;
    const t = traslados.find((x: any) => x.id === trasladoId);
    expect(t.estado).toBe('RecibidoConDiferencia');
  });

  it('REGRESIÓN — dashboard/enterprise emite alerta por recepción con diferencia', async () => {
    const res = await requestAs(app, '1').get('/api/dashboard/enterprise');
    expect(res.status).toBe(200);
    const alerta = res.body.alertas.find((a: any) => a.tipo === 'Diferencia en recepción');
    expect(alerta).toBeDefined();
    expect(alerta.detalle).toContain('120');
  });
});

describe('Backfill retroactivo — recepciones previas al fix', () => {
  it('registra el desperdicio y la pérdida en tránsito, y es idempotente', async () => {
    // Simula una recepción histórica (anterior al fix): diferencia sin movimiento de pérdida
    const recepcionId = crypto.randomUUID();
    await testDb.insert(schema.recepciones).values({
      id: recepcionId,
      trasladoId: 'traslado-historico',
      fechaRecepcion: '2026-09-14T10:00:00.000Z',
      cantidadEsperada: 50,
      cantidadRecibida: 44,
      diferencia: 6,
      motivoDiferencia: 'Quebrados históricos',
      responsableRecepcion: 'Bodeguero Anterior',
      estado: 'ConDiferencia'
    });
    await testDb.insert(schema.movimientosInventario).values({
      id: crypto.randomUUID(),
      producto: 'Huevos - Grande',
      cantidad: 44,
      tipo: 'Recepción Bodega',
      origen: 'Granja',
      destino: 'Bodega Central',
      fecha: '2026-09-14T10:00:00.000Z',
      referencia_id: recepcionId
    });

    await backfill(testDb);
    await backfill(testDb); // segunda corrida: no debe duplicar

    const todos = await testDb.select().from(schema.desperdicios);
    const delBackfill = todos.filter((d: any) => String(d.observaciones || '').includes('Backfill'));
    expect(delBackfill).toHaveLength(1);
    const desp = delBackfill[0];
    expect(desp.producto).toBe('Huevos - Grande');
    expect(desp.cantidad).toBe(6);
    expect(desp.motivo).toBe('Quebrados históricos');
    expect(desp.fecha).toBe('2026-09-14T10:00:00.000Z');

    const movs = await testDb.select().from(schema.movimientosInventario);
    const perdidas = movs.filter((m: any) => m.tipo === 'Pérdida en Tránsito' && m.referencia_id === recepcionId);
    expect(perdidas).toHaveLength(1);
    expect(perdidas[0].cantidad).toBe(6);
  });
});
