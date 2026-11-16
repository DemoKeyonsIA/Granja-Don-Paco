import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { requestAs } from './helpers/request-as';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
const DB_PATH = path.resolve(process.cwd(), '.test-movimientos-camion.db');
const guiaId = crypto.randomUUID();
const recepcionId = crypto.randomUUID();

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);

  const camionId = crypto.randomUUID();
  await testDb.insert(schema.camiones).values({
    id: camionId,
    nombre: 'Cami\u00f3n de Prueba',
    capacidad_cartones: 500,
    estado: 'Activo'
  });
  await testDb.insert(schema.guias_despacho).values({
    id: guiaId,
    consecutivo: 'GD-TEST-0001',
    camionId,
    fecha: new Date().toISOString(),
    totalCartones: 20,
    estado: 'EnRuta'
  });
  await testDb.insert(schema.movimientosInventario).values({
    id: crypto.randomUUID(),
    producto: 'Huevos - Grande',
    cantidad: 20,
    tipo: 'Carga Camión',
    origen: 'Bodega Central',
    destino: 'Camión',
    fecha: new Date().toISOString(),
    referencia_id: guiaId
  });
  await testDb.insert(schema.movimientosInventario).values({
    id: crypto.randomUUID(),
    producto: 'Huevos - Grande',
    cantidad: 15,
    tipo: 'Traslado',
    origen: 'Granja',
    destino: 'Bodega Central',
    fecha: new Date().toISOString(),
    referencia_id: 'no-es-guia'
  });
  await testDb.insert(schema.recepciones).values({
    id: recepcionId,
    fechaRecepcion: new Date().toISOString(),
    cantidadEsperada: 40,
    cantidadRecibida: 38,
    diferencia: 2,
    motivoDiferencia: 'Cartón roto',
    tipoDiferencia: 'desperdicio',
    responsableRecepcion: 'Bodeguero Test',
    estado: 'ConDiferencia'
  });
  await testDb.insert(schema.movimientosInventario).values({
    id: crypto.randomUUID(),
    producto: 'Huevos - Grande',
    cantidad: 2,
    tipo: 'Pérdida en Tránsito',
    origen: 'Granja',
    destino: 'Bodega Central',
    fecha: new Date().toISOString(),
    referencia_id: recepcionId
  });
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — Movimientos enriquecidos con camión para el árbol día → camión → eventos', () => {
  it('asigna el camión de su guía a los movimientos vinculados', async () => {
    const res = await requestAs(app, '1').get('/api/inventario/movimientos');
    expect(res.status).toBe(200);

    const movimientoGuia = res.body.find((m: any) => m.referencia_id === guiaId);
    expect(movimientoGuia).toBeDefined();
    expect(movimientoGuia.camionNombre).toBe('Cami\u00f3n de Prueba');
    expect(movimientoGuia.guiaId).toBe(guiaId);
    expect(movimientoGuia.consecutivo).toBe('GD-TEST-0001');
  });

  it('deja sin camión los movimientos no vinculados a una guía', async () => {
    const res = await requestAs(app, '1').get('/api/inventario/movimientos');
    const interno = res.body.find((m: any) => m.tipo === 'Traslado');
    expect(interno).toBeDefined();
    expect(interno.camionNombre).toBeNull();
    expect(interno.camionId).toBeNull();
  });

  it('enriquece los movimientos de recepción con motivo, diferencia y cantidades', async () => {
    const res = await requestAs(app, '1').get('/api/inventario/movimientos');
    const perdida = res.body.find((m: any) => m.referencia_id === recepcionId);
    expect(perdida).toBeDefined();
    expect(perdida.motivoDiferencia).toBe('Cartón roto');
    expect(perdida.tipoDiferencia).toBe('desperdicio');
    expect(perdida.diferencia).toBe(2);
    expect(perdida.cantidadRecibida).toBe(38);
    expect(perdida.cantidadEsperada).toBe(40);
    expect(perdida.reportadoPor).toBe('Bodeguero Test');
    expect(perdida.estado).toBe('ConDiferencia');
  });

  it('deja los campos de diferencia en null cuando el movimiento no viene de una recepción', async () => {
    const res = await requestAs(app, '1').get('/api/inventario/movimientos');
    const carga = res.body.find((m: any) => m.referencia_id === guiaId);
    expect(carga.motivoDiferencia).toBeNull();
    expect(carga.tipoDiferencia).toBeNull();
    expect(carga.diferencia).toBeNull();
  });
});