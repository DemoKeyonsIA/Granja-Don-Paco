import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';
import { ETIQUETA_TIPO_DIFERENCIA } from '../src/lib/opcionesRecepcion';
import { requestAs } from './helpers/request-as';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
let backfill: (db: any) => Promise<void>;
const admin = () => requestAs(app, '1');
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

  const wiz = await admin().post('/api/granjas/wizard').send({
    nombre: 'Granja Motivos',
    ubicacion: 'Alajuela',
    tipo_produccion: 'Postura',
    encargadoId: encargadoId,
    galerones: [{ nombre: 'Galerón Motivos', capacidad_maxima: 1000 }]
  });
  expect(wiz.status).toBe(201);

  granjaId = (await admin().get('/api/granjas')).body.find((g: any) => g.nombre === 'Granja Motivos').id;
  expect(granjaId).toBeTruthy();

  const stock = await admin().post('/api/produccion/recoleccion').send({
    galeron: 'Galerón Motivos',
    detalles: [
      { producto: 'Huevos - Mediano', cantidad: 500 },
      { producto: 'Huevos - Grande', cantidad: 500 },
    ]
  });
  expect(stock.status).toBe(200);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

async function crearCarga(cantidad: number): Promise<string> {
  const res = await admin().post('/api/operaciones/traslado').send({
    granjaId,
    producto: 'Huevos - Mediano',
    cantidad,
    unidad: 'cartones',
    responsable: 'Encargado de Galerón',
    cargaId: crypto.randomUUID(),
    creadoPorId: encargadoId
  });
  expect(res.status).toBe(200);
  const traslados = (await admin().get('/api/operaciones/traslados')).body;
  const t = traslados.filter((x: any) => x.granjaOrigenId === granjaId).pop();
  const correccion = await admin().post(`/api/operaciones/traslados/${t.id}/corregir-peso-kg`)
    .send({ pesoKg: cantidad, motivo: 'Peso confirmado en báscula de prueba' });
  expect(correccion.status).toBe(201);
  return t.id;
}

describe('E2E — Clasificación del motivo de diferencia en recepción (desperdicio vs diferencia por investigar)', () => {
  it('motivo de cartón roto/caído → se registra DESPERDICIO (no alerta por investigar)', async () => {
    const trasladoId = await crearCarga(100);
    const rec = await admin().post('/api/operaciones/recepcion').send({
      trasladoId,
      cantidadKgEsperada: 100,
      cantidadKgRecibida: 80,
      motivoDiferencia: 'quebrados',
      producto: 'Huevos - Mediano',
      responsableRecepcion: 'Bodeguero Test'
    });
    expect(rec.status).toBe(200);
    expect(rec.body.esPosibleRobo).toBe(false);

    const desperdicios = (await admin().get('/api/desperdicios')).body;
    const desp = desperdicios.find((d: any) => d.producto === 'Huevos - Mediano');
    expect(desp).toBeDefined();
    expect(desp.cantidad).toBe(20);
    expect(desp.motivo).toBe('Kilos de huevo rotos o dañados');

    const recepciones = (await admin().get('/api/operaciones/recepciones')).body;
    const r = recepciones.filter((x: any) => x.trasladoId === trasladoId).pop();
    expect(r.tipoDiferencia).toBe('desperdicio');
    expect(r.esPosibleRobo).toBe(false);
  });

  it('motivo de cartón que no aparece → NO es desperdicio, queda como diferencia por investigar', async () => {
    const before = (await admin().get('/api/desperdicios')).body.filter((d: any) => d.producto === 'Huevos - Mediano').length;
    const trasladoId = await crearCarga(60);
    const rec = await admin().post('/api/operaciones/recepcion').send({
      trasladoId,
      cantidadKgEsperada: 60,
      cantidadKgRecibida: 40,
      motivoDiferencia: 'no-aparece',
      producto: 'Huevos - Mediano',
      responsableRecepcion: 'Bodeguero Test'
    });
    expect(rec.status).toBe(200);
    expect(rec.body.esPosibleRobo).toBe(true);

    // No se registra desperdicio por un faltante que no apareció
    const despues = (await admin().get('/api/desperdicios')).body.filter((d: any) => d.producto === 'Huevos - Mediano').length;
    expect(despues).toBe(before);

    // El kárdex sí equilibra: el faltante sale como pérdida en tránsito
    const movimientos = (await admin().get('/api/inventario/movimientos')).body;
    const perdidas = movimientos.filter((m: any) => m.tipo === 'Pérdida en Tránsito' && m.producto === 'Huevos - Mediano');
    expect(perdidas.length).toBeGreaterThan(0);

    const recepciones = (await admin().get('/api/operaciones/recepciones')).body;
    const r = recepciones.filter((x: any) => x.trasladoId === trasladoId).pop();
    expect(r.tipoDiferencia).toBe('alerta');
    expect(r.esPosibleRobo).toBe(true);
  });

  it('dashboard/enterprise emite la alerta de diferencia sin acusar a nadie', async () => {
    // El rótulo viene de ETIQUETA_TIPO_DIFERENCIA, la misma fuente que la UI, para
    // que el tablero y la pantalla no puedan divergir. Y no puede volver a decir
    // "robo": la recepción registra un hecho de conteo, no una conclusión.
    const res = await admin().get('/api/dashboard/enterprise');
    expect(res.status).toBe(200);
    const alerta = res.body.alertas.find((a: any) => a.tipo === ETIQUETA_TIPO_DIFERENCIA.alerta);
    expect(alerta).toBeDefined();
    expect(alerta.detalle).toContain('40');
    const tipos = res.body.alertas.map((a: any) => String(a.tipo).toLowerCase());
    expect(tipos.some((t: string) => /robo|robado|steal/.test(t))).toBe(false);
  });

  it('recepción con remisión y diferencia-peso → alerta, no desperdicio', async () => {
    const before = (await admin().get('/api/desperdicios')).body.filter((d: any) => d.producto === 'Huevos - Grande').length;
    const inventarioGrande = (await admin().get('/api/inventario')).body.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja');
    const conciliacion = await admin().post('/api/operaciones/inventario/granja/conciliar-kg').send({
      inventarioId: inventarioGrande.id, cantidadKg: 250, motivo: 'Conteo físico de prueba en báscula'
    });
    expect(conciliacion.status).toBe(200);
    const guia = await admin().post('/api/operaciones/remision').send({
      granjaId,
      producto: 'Huevos - Grande',
      cantidadKg: 50,
      responsable: 'Encargado Test'
    });
    expect(guia.status).toBe(201);
    const guiaId = (await admin().get('/api/operaciones/remisiones')).body.find((g: any) => g.producto === 'Huevos - Grande' && g.estado === 'EnTransito').id;

    const rec = await admin().post('/api/operaciones/recepcion-remision').send({
      guiaId,
      cantidadKg: 30,
      motivoDiferencia: 'diferencia-peso',
      responsable: 'Bodeguero Test'
    });
    expect(rec.status).toBe(200);

    const despues = (await admin().get('/api/desperdicios')).body.filter((d: any) => d.producto === 'Huevos - Grande').length;
    expect(despues).toBe(before);

    const recepciones = (await admin().get('/api/operaciones/recepciones')).body;
    const r = recepciones.filter((x: any) => x.guiaRemisionId === guiaId).pop();
    expect(r.tipoDiferencia).toBe('alerta');
    expect(r.esPosibleRobo).toBe(true);
  });

  it('backfill reclasifica históricos con motivo de faltante como diferencia por investigar', async () => {
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
    await admin().post('/api/operaciones/recepcion').send({
      trasladoId,
      cantidadKgEsperada: 40,
      cantidadKgRecibida: 36,
      motivoDiferencia: 'quebrados',
      producto: 'Huevos - Mediano',
      responsableRecepcion: 'Bodeguero Test'
    });

    const res = await admin().get('/api/desperdicios/resumen');
    expect(res.status).toBe(200);
    const porOrigen = res.body.porOrigen as Record<string, number>;
    expect(Number(porOrigen['Recepción Bodega'] || 0)).toBeGreaterThanOrEqual(4);
    expect(res.body.totalRegistros).toBeGreaterThanOrEqual(1);
  });
});
