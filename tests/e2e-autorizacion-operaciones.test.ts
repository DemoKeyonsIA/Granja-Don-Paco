import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import * as schema from '../src/db/schema.sqlite';
import { abrirClienteDePrueba, ejecutarDdl } from './helpers/db';

let app: Express;
const DB_PATH = path.resolve(process.cwd(), '.test-autorizacion-operaciones.db');

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({
    sql: 'INSERT INTO users (id,name,email,role,roles) VALUES (?,?,?,?,?)',
    args: ['u-admin-f7', 'Admin Demo', 'admin@f7.test', 'Admin', 'Admin'],
  });
  await client.execute({
    sql: 'INSERT INTO users (id,name,email,role,roles) VALUES (?,?,?,?,?)',
    args: ['u-socio-f7', 'Socio Demo', 'socio@f7.test', 'Socio', 'Socio'],
  });
  await client.execute({
    sql: 'INSERT INTO users (id,name,email,role,roles) VALUES (?,?,?,?,?)',
    args: ['u-comercial-f7', 'Comercial Demo', 'comercial@f7.test', 'Camionero', 'Camionero'],
  });
  await client.execute({
    sql: 'INSERT INTO users (id,name,email,role,roles) VALUES (?,?,?,?,?)',
    args: ['u-bodega-f7', 'Bodeguero Demo', 'bodega@f7.test', 'Bodeguero', 'Bodeguero'],
  });
  await client.execute({
    sql: 'INSERT INTO users (id,name,email,role,roles) VALUES (?,?,?,?,?)',
    args: ['u-despacho-f7', 'Despacho Demo', 'despacho@f7.test', 'Despachador', 'Despachador'],
  });

  const mod = await import('../server');
  app = await mod.createApp(true, drizzle(client, { schema }));
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch { /* cleanup del helper */ }
});

describe('Fase 7 — permisos backend para perfiles demo', () => {
  it('exige identidad y permite consultar producción según perfil', async () => {
    await request(app).get('/api/granjas').expect(401);
    await request(app).get('/api/granjas').set('x-user-id', 'u-admin-f7').expect(200);
    // El Socio ve dashboards y CRM, no los maestros operativos de granja.
    await request(app).get('/api/granjas').set('x-user-id', 'u-socio-f7').expect(403);
    await request(app).get('/api/granjas').set('x-user-id', 'u-comercial-f7').expect(403);
  });

  it('reserva los maestros de granjas/lotes al administrador', async () => {
    await request(app).post('/api/granjas').set('x-user-id', 'u-socio-f7').send({ nombre: 'No autorizada' }).expect(403);
    await request(app).post('/api/granjas').set('x-user-id', 'u-comercial-f7').send({ nombre: 'No autorizada' }).expect(403);
    // 400 confirma que el perfil Admin pasó autorización y llegó a validación del formulario.
    await request(app).post('/api/granjas').set('x-user-id', 'u-admin-f7').send({}).expect(400);
  });

  it('solo Encargado de Galerón y Admin pueden registrar recolección', async () => {
    await request(app).post('/api/produccion/recoleccion').send({}).expect(401);
    await request(app).post('/api/produccion/recoleccion').set('x-user-id', 'u-socio-f7').send({}).expect(403);
    await request(app).post('/api/produccion/recoleccion').set('x-user-id', 'u-despacho-f7').send({}).expect(400);
  });

  it('separa escritura de despacho y recepción en los flujos de bodega', async () => {
    await request(app).post('/api/operaciones/traslado').set('x-user-id', 'u-despacho-f7').send({}).expect(400);
    await request(app).post('/api/operaciones/traslado').set('x-user-id', 'u-bodega-f7').send({}).expect(403);
    await request(app).post('/api/operaciones/recepcion').set('x-user-id', 'u-bodega-f7').send({}).expect(400);
    await request(app).post('/api/operaciones/recepcion').set('x-user-id', 'u-comercial-f7').send({}).expect(403);
    await request(app).post('/api/bodega/ingresar-etiquetas').set('x-user-id', 'u-bodega-f7').send({ codigos: [] }).expect(400);
    await request(app).post('/api/bodega/ingresar-etiquetas').set('x-user-id', 'u-socio-f7').send({ codigos: [] }).expect(403);
  });

  it('mantiene al Camionero unificado con Comercial y limita confirmación a su perfil', async () => {
    const cargas = await request(app).get('/api/operaciones/cargas').set('x-user-id', 'u-comercial-f7').expect(200);
    expect(cargas.body).toEqual([]);
    await request(app).post('/api/operaciones/carga/carga-inexistente/confirmar')
      .set('x-user-id', 'u-comercial-f7').send({}).expect(404);
    await request(app).post('/api/operaciones/carga/carga-inexistente/confirmar')
      .set('x-user-id', 'u-socio-f7').send({}).expect(403);
  });

  it('permite al Admin ver el tablero operativo y mantiene CRM de Socio solo lectura', async () => {
    await request(app).get('/api/logistica/tablero').set('x-user-id', 'u-admin-f7').expect(200);
    await request(app).get('/api/clientes').set('x-user-id', 'u-socio-f7').expect(200);
    await request(app).get('/api/clientes/analisis').set('x-user-id', 'u-socio-f7').expect(200);
    await request(app).get('/api/clientes/analisis').set('x-user-id', 'u-comercial-f7').expect(403);
    await request(app).post('/api/clientes').set('x-user-id', 'u-socio-f7').send({ nombre: 'No autorizado' }).expect(403);
  });

  it('protege auditoría y evita falsificar el actor del evento', async () => {
    await request(app).get('/api/auditoria').expect(401);
    await request(app).get('/api/auditoria').set('x-user-id', 'u-socio-f7').expect(403);
    await request(app).get('/api/auditoria').set('x-user-id', 'u-admin-f7').expect(200);
    await request(app).get('/api/logistica/auditoria').set('x-user-id', 'u-comercial-f7').expect(403);
    await request(app).post('/api/auditoria').set('x-user-id', 'u-socio-f7')
      .send({ accion: 'Crear', modulo: 'Precios', usuarioId: 'u-admin-f7' }).expect(403);
    const creado = await request(app).post('/api/auditoria').set('x-user-id', 'u-admin-f7')
      .send({ accion: 'Crear', modulo: 'Precios', usuarioId: 'u-socio-f7' }).expect(201);
    const eventos = (await request(app).get('/api/auditoria').set('x-user-id', 'u-admin-f7')).body;
    expect(eventos.find((e: any) => e.id === creado.body.id).usuarioId).toBe('u-admin-f7');
  });

  it('aplica permisos por contexto a asistentes de IA y funciones de campo', async () => {
    const post = (path: string, actor: string, body: any = {}) => request(app).post(path).set('x-user-id', actor).send(body);
    await post('/api/chat/estela', 'u-socio-f7').expect(403);
    await post('/api/chat/estela', 'u-admin-f7').expect(400);
    await post('/api/ai/ceres', 'u-socio-f7').expect(403);
    await post('/api/ai/ceres', 'u-despacho-f7').expect(400);
    await post('/api/ai/vega', 'u-comercial-f7').expect(400);
    await post('/api/ai/vega', 'u-bodega-f7').expect(403);
    await post('/api/ai/nash', 'u-socio-f7').expect(400);
    await post('/api/ai/nash', 'u-comercial-f7').expect(403);
    await post('/api/ai/houston', 'u-despacho-f7').expect(400);
    await post('/api/ai/magnetar', 'u-socio-f7').expect(400);
    await post('/api/ai/nova', 'u-comercial-f7').expect(403);
    await post('/api/ai/nova', 'u-admin-f7').expect(400);
    await post('/api/ai/tales', 'u-comercial-f7').expect(400);
    await post('/api/extract', 'u-comercial-f7').expect(400);
    await post('/api/extract', 'u-bodega-f7').expect(403);
    await post('/api/predict-load', 'u-comercial-f7').expect(400);
    await post('/api/predict-load', 'u-socio-f7').expect(403);
  });
});
