import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { requestAs } from './helpers/request-as';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { expectApi } from './helpers/http';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
const DB_PATH = path.resolve(process.cwd(), '.test-f1.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);

  // Seed: usuario, granja y stock inicial en Granja
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@test.com', 'Admin'] });
  await client.execute({ sql: `INSERT INTO granjas (id, nombre, ubicacion, encargado_id) VALUES (?, ?, ?, ?)`, args: ['g1', 'Granja Principal', 'Heredia', '1'] });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['i1', 'Huevos - Grande', 400, 'cartones', 'Granja', new Date().toISOString()]
  });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('F1 — Cadena granja → bodega (guías de remisión y alistamiento)', () => {
  it('Emitir guía de remisión mueve stock Granja → EnTransito', async () => {
    const res = await requestAs(app, '1').post('/api/operaciones/remision')
      .send({ granjaId: 'g1', producto: 'Huevos - Grande', cartones: 120, responsable: 'Bodeguero', transporte: 'Camión Ruta 1' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const inv = await requestAs(app, '1').get('/api/inventario');
    const granja = inv.body.find((i: any) => i.ubicacion === 'Granja' && i.producto === 'Huevos - Grande');
    const transito = inv.body.find((i: any) => i.ubicacion === 'EnTransito' && i.producto === 'Huevos - Grande');
    expect(granja.cantidad).toBe(280);
    expect(transito.cantidad).toBe(120);
  });

  it('Listar remisiones muestra la guía en tránsito con consecutivo', async () => {
    const res = await requestAs(app, '1').get('/api/operaciones/remisiones');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].estado).toBe('EnTransito');
    expect(res.body[0].consecutivo).toMatch(/^GR-\d{8}-/);
    expect(res.body[0].cartonesEsperados).toBe(120);
  });

  it('Rechaza remisión sin stock suficiente en granja', async () => {
    const res = await requestAs(app, '1').post('/api/operaciones/remision')
      .send({ granjaId: 'g1', producto: 'Huevos - Grande', cartones: 999, responsable: 'Bodeguero' });
    expectApi(res, 400, 'Remisión sin stock');
    expect(res.body.error).toContain('Stock insuficiente');
  });

  it('Recepción conforme: EnTransito → Bodega Central y guía Recibida', async () => {
    const list = await requestAs(app, '1').get('/api/operaciones/remisiones');
    const guia = list.body[0];

    const res = await requestAs(app, '1').post('/api/operaciones/recepcion-remision')
      .send({ guiaId: guia.id, cantidadRecibida: 120, pesoBruto: 72, responsable: 'Bodeguero' });
    expect(res.status).toBe(200);

    const inv = await requestAs(app, '1').get('/api/inventario');
    const transito = inv.body.find((i: any) => i.ubicacion === 'EnTransito' && i.producto === 'Huevos - Grande');
    const bodega = inv.body.find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevos - Grande');
    expect(transito).toBeUndefined();
    expect(bodega.cantidad).toBe(120);

    const updated = await requestAs(app, '1').get('/api/operaciones/remisiones');
    expect(updated.body[0].estado).toBe('Recibida');
    expect(updated.body[0].recibidoEn).toBeTruthy();
  });

  it('Recepción con diferencia genera desperdicio y guía ConDiferencia', async () => {
    const emit = await requestAs(app, '1').post('/api/operaciones/remision')
      .send({ granjaId: 'g1', producto: 'Huevos - Grande', cartones: 100, lote: 'L-02', responsable: 'Bodeguero' });
    expect(emit.status).toBe(201);

    const list = await requestAs(app, '1').get('/api/operaciones/remisiones');
    const guia = list.body.find((g: any) => g.cartonesEsperados === 100);

    const res = await requestAs(app, '1').post('/api/operaciones/recepcion-remision')
      .send({ guiaId: guia.id, cantidadRecibida: 95, pesoBruto: 57, motivoDiferencia: 'Merma en transporte' });
    expect(res.status).toBe(200);

    const updated = await requestAs(app, '1').get('/api/operaciones/remisiones');
    const rec = updated.body.find((g: any) => g.id === guia.id);
    expect(rec.estado).toBe('RecibidaConDiferencia');

    const bodega = (await requestAs(app, '1').get('/api/inventario')).body
      .find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevos - Grande');
    expect(bodega.cantidad).toBe(215);

    const desp = await requestAs(app, '1').get('/api/desperdicios');
    expect(desp.body.some((d: any) => d.cantidad === 5 && d.origen.includes('GR-'))).toBe(true);
  });

  it('No permite recibir dos veces la misma guía', async () => {
    const list = await requestAs(app, '1').get('/api/operaciones/remisiones');
    const guia = list.body.find((g: any) => g.estado === 'Recibida');
    const res = await requestAs(app, '1').post('/api/operaciones/recepcion-remision')
      .send({ guiaId: guia.id, cantidadRecibida: 120 });
    expectApi(res, 409, 'Recepción de guía ya recibida');
    expect(res.body.error).toContain('estado');
  });

  it('Alistamiento arma galerones de 30 cartones y emite etiquetas EnBodega', async () => {
    const list = await requestAs(app, '1').get('/api/operaciones/remisiones');
    const guia = list.body.find((g: any) => g.estado === 'Recibida');

    const res = await requestAs(app, '1').post('/api/operaciones/alistamiento')
      .send({ guiaId: guia.id, producto: 'Huevos - Grande', cartones: 60, granjaOrigen: 'Granja Principal', lote: 'L-01', clasificacion: 'Grado A', pesoBruto: 36, responsable: 'Bodeguero' });
    expect(res.status).toBe(201);
    expect(res.body.etiquetas.length).toBe(2);
    expect(res.body.etiquetas[0].cantidad).toBe(30);

    const etiq = await requestAs(app, '1').get('/api/etiquetas');
    const nuevas = etiq.body.filter((e: any) => e.estado === 'EnBodega');
    expect(nuevas.length).toBe(2);
    expect(nuevas.every((e: any) => e.ubicacionActual === 'Bodega Central')).toBe(true);
    expect(nuevas.every((e: any) => e.guiaRemisionId === guia.id)).toBe(true);
    expect(nuevas[0].codigoUnico).toMatch(/^ETQ-\d{8}-BOD-/);

    const updated = await requestAs(app, '1').get('/api/operaciones/remisiones');
    expect(updated.body.find((g: any) => g.id === guia.id).estado).toBe('Alistada');
  });

  it('Alistamiento rechaza sin stock en Bodega Central', async () => {
    const res = await requestAs(app, '1').post('/api/operaciones/alistamiento')
      .send({ producto: 'Huevos - Grande', cartones: 5000 });
    expectApi(res, 400, 'Alistamiento sin stock');
    expect(res.body.error).toContain('Stock insuficiente');
  });

  it('Trazabilidad incluye línea de custodia (traza) y la guía asociada', async () => {
    const etiq = await requestAs(app, '1').get('/api/etiquetas');
    const codigo = etiq.body.find((e: any) => e.estado === 'EnBodega').codigoUnico;

    const res = await requestAs(app, '1').get(`/api/etiquetas/trazabilidad/${encodeURIComponent(codigo)}`);
    expect(res.status).toBe(200);
    expect(res.body.etiqueta.codigoUnico).toBe(codigo);
    expect(res.body.traza.length).toBe(1);
    expect(res.body.traza[0].tipoEvento).toBe('Alistamiento');
    expect(res.body.traza[0].observaciones).toContain('30 cartones');
    expect(res.body.guia).toBeTruthy();
    expect(res.body.guia.consecutivo).toMatch(/^GR-/);
  });

  it('Traza no encontrada → 404 en trazabilidad', async () => {
    const res = await requestAs(app, '1').get('/api/etiquetas/trazabilidad/ETQ-00000000-BOD-1-1');
    expect(res.status).toBe(404);
  });

  it('QR de la etiqueta responde PNG', async () => {
    const etiq = await requestAs(app, '1').get('/api/etiquetas');
    const codigo = etiq.body.find((e: any) => e.estado === 'EnBodega').codigoUnico;

    const res = await requestAs(app, '1').get(`/api/etiquetas/${encodeURIComponent(codigo)}/qr.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.body.length).toBeGreaterThan(100);
  });

  it('QR de etiqueta inexistente → 404', async () => {
    const res = await requestAs(app, '1').get('/api/etiquetas/NO-EXISTE/qr.png');
    expect(res.status).toBe(404);
  });
});
