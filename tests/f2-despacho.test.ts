import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { expectApi } from './helpers/http';
import { ejecutarDdl } from './helpers/db';

let app: Express;
const DB_PATH = path.resolve(process.cwd(), '.test-f2.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);

  // Seed
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Despachador', 'despacho@test.com', 'Despachador'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['3', 'Vendedor', 'vendedor@test.com', 'Vendedor'] });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, latitud, longitud, ruta, condicion_pago, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['c1', 'Cliente A', 10.1, -84.1, 'R1', 'Contado', 'Activo']
  });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, latitud, longitud, ruta, condicion_pago, estado, prioridad, ventana_entrega_ini, ventana_entrega_fin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['c2', 'Cliente B', 10.0, -84.0, 'R1', 'Contado', 'Activo', 'VIP', '07:00', '08:00']
  });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, latitud, longitud, ruta, condicion_pago, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['c3', 'Cliente C', 10.2, -84.2, 'R1', 'Credito', 'Activo']
  });
  await client.execute({
    sql: `INSERT INTO rutas (id, nombre, cliente_ids, centroide_lat, centroide_lng, capacidad_max_cartones, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['r1', 'Ruta 1', JSON.stringify(['c1', 'c2', 'c3']), 10.1, -84.1, 100, 'Activa']
  });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['i1', 'Huevos - Grande', 120, 'cartones', 'Bodega Central', new Date().toISOString()]
  });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['i2', 'Huevos - Grande', 5, 'cartones', 'Camión Ruta 1', new Date().toISOString()]
  });
  // Etiquetas EnBodega listas para cargar
  for (const [id, codigo, cantidad] of [['e1', 'ETQ-F2-001', 30], ['e2', 'ETQ-F2-002', 40], ['e3', 'ETQ-F2-003', 50]] as const) {
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, codigo, 'Huevos - Grande', cantidad, 'EnBodega', 'Bodega Central', 'L-F2-01', 20]
    });
  }

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('F2 — Despacho: camión, guía de despacho, venta y cierre', () => {
  it('Crear camión y listarlo con su guía activa', async () => {
    const crear = await request(app).post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 2', placa: 'CR-222', ruta_defecto: 'Ruta 1', capacidad_cartones: 100 });
    expect(crear.status).toBe(201);

    const list = await request(app).get('/api/logistica/camiones');
    expect(list.body.length).toBe(1);
    expect(list.body[0].guiaActivaId).toBeNull();

    const dup = await request(app).post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 2', capacidad_cartones: 100 });
    expect(dup.status).toBe(400);
  });

  it('Crear guía de despacho marca etiquetas Cargada y mueve Bodega → Camión', async () => {
    const listCam = await request(app).get('/api/logistica/camiones');
    const camion = listCam.body[0];

    const res = await request(app).post('/api/logistica/guias')
      .send({
        camionId: camion.id,
        rutaId: 'r1',
        etiquetasIds: ['e1', 'e2'], // 30 + 40 = 70 cartones
        responsablesCarga: 'Bodeguero',
        responsableTransporte: 'Vendedor',
        pesoSalida: 45
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Etiquetas Cargada con guía de despacho
    const etiquetas = await request(app).get('/api/etiquetas');
    const e1 = etiquetas.body.find((e: any) => e.id === 'e1');
    const e2 = etiquetas.body.find((e: any) => e.id === 'e2');
    expect(e1.estado).toBe('Cargada');
    expect(e1.guiaDespachoId).toBeTruthy();
    expect(e1.ubicacionActual).toBe('Camión Ruta 2');
    expect(e2.estado).toBe('Cargada');

    // Stock Bodega → Camión
    const inv = await request(app).get('/api/inventario');
    const bodega = inv.body.find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevos - Grande');
    const stockCamion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 2' && i.producto === 'Huevos - Grande');
    expect(bodega.cantidad).toBe(50);
    expect(stockCamion.cantidad).toBe(70);
  });

  it('Guía activa por camión: no permite una segunda', async () => {
    const listCam = await request(app).get('/api/logistica/camiones');
    const camion = listCam.body[0];

    const res = await request(app).post('/api/logistica/guias')
      .send({ camionId: camion.id, etiquetasIds: ['e3'] });
    expectApi(res, 409, 'Guía activa por camión');
    expect(res.body.error).toContain('guía activa');
  });

  it('No permite cargar etiquetas fuera de EnBodega', async () => {
    await request(app).post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 3', placa: 'CR-333', capacidad_cartones: 100 });
    const listCam = await request(app).get('/api/logistica/camiones');
    const camion3 = listCam.body.find((c: any) => c.nombre === 'Camión Ruta 3');

    // e3 sigue EnBodega → sí carga; e1 ya Cargada + e2 ya Cargada → rechaza
    const res = await request(app).post('/api/logistica/guias')
      .send({ camionId: camion3.id, etiquetasIds: ['e1', 'e3'] });
    expectApi(res, 400, 'Etiquetas no cargables');
    expect(res.body.error).toContain('no cargables');
  });

  it('No permite exceder la capacidad del camión', async () => {
    await request(app).post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 4', placa: 'CR-444', capacidad_cartones: 30 });
    const listCam = await request(app).get('/api/logistica/camiones');
    const camion4 = listCam.body.find((c: any) => c.nombre === 'Camión Ruta 4');

    // e3 (50) > capacidad 30 → excede
    const res = await request(app).post('/api/logistica/guias')
      .send({ camionId: camion4.id, etiquetasIds: ['e3'] });
    expectApi(res, 400, 'Exceso de capacidad');
    expect(res.body.error).toContain('Excede capacidad');
  });

  it('GET /api/logistica/guias/:id incluye detalle con etiquetas y orden de recorrido', async () => {
    const res = await request(app).get('/api/logistica/guias');
    const guia = res.body[0];

    const det = await request(app).get(`/api/logistica/guias/${guia.id}`);
    expect(det.status).toBe(200);
    expect(det.body.consecutivo).toMatch(/^GD-\d{8}-/);
    expect(det.body.camionNombre).toBe('Camión Ruta 2');
    expect(det.body.detalle.length).toBe(2);
    expect(det.body.rutaOrden.length).toBe(3);
    expect(det.body.rutaOrden[0].clienteId).toBeTruthy();
  });

  it('/api/logistica/guias-activas solo devuelve guías abiertas', async () => {
    const res = await request(app).get('/api/logistica/guias-activas');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('Venta en ruta con guiaId descuenta del camión correcto (fix bug hardcodeado)', async () => {
    const guias = await request(app).get('/api/logistica/guias');
    const guia = guias.body[0];

    const res = await request(app).post('/api/ventas')
      .set('x-user-id', '3')
      .send({
        factura: {
          id: 'f1', consecutivo: 'F-0001', fecha: new Date().toISOString(),
          clienteId: 'c1', vendedorId: '3',
          subtotal: 160000, descuento: 0, total: 160000,
          condicion_pago: 'Contado', metodo_pago: 'Efectivo', estado: 'Pagada',
          guiaId: guia.id
        },
        detalles: [
          { producto: 'Huevos - Grande', cantidad: 10, precio_unitario: 16000, subtotal: 160000, etiquetaId: 'e1' }
        ]
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const inv = await request(app).get('/api/inventario');
    const camion2 = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 2' && i.producto === 'Huevos - Grande');
    const camion1 = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 1' && i.producto === 'Huevos - Grande');
    expect(camion2.cantidad).toBe(60); // 70 - 10 vendidos
    expect(camion1.cantidad).toBe(5); // i2 sembrada: el descuento fue solo del Camión Ruta 2

    // La factura queda ligada a la guía y la etiqueta a Entregada
    const factura = await request(app).get('/api/facturas');
    expect(factura.body[0].guiaId).toBe(guia.id);
    const etiquetas = await request(app).get('/api/etiquetas');
    expect(etiquetas.body.find((e: any) => e.id === 'e1').estado).toBe('Entregada');
  });

  it('Venta sin guiaId usa fallback Camión Ruta 1 (compatibilidad)', async () => {
    await request(app).post('/api/ventas').set('x-user-id', '3').send({
      factura: {
        id: 'f2', consecutivo: 'F-0002', fecha: new Date().toISOString(),
        clienteId: 'c1', vendedorId: '3',
        subtotal: 16000, descuento: 0, total: 16000,
        condicion_pago: 'Contado', metodo_pago: 'Efectivo', estado: 'Pagada'
      },
      detalles: [{ producto: 'Huevos - Grande', cantidad: 1, precio_unitario: 16000, subtotal: 16000 }]
    });

    const inv = await request(app).get('/api/inventario');
    const camion1 = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 1' && i.producto === 'Huevos - Grande');
    expect(camion1.cantidad).toBe(4); // 5 - 1 del fallback histórico
  });

  it('Marcar EnRuta requiere estado Cargada', async () => {
    const guias = await request(app).get('/api/logistica/guias');
    const guia = guias.body[0];

    const mal = await request(app).post(`/api/logistica/guias/${guia.id}/marcar-en-ruta`);
    expect(mal.status).toBe(200); // estaba Cargada → OK
    const guias2 = await request(app).get('/api/logistica/guias');
    expect(guias2.body[0].estado).toBe('EnRuta');

    const doble = await request(app).post(`/api/logistica/guias/${guia.id}/marcar-en-ruta`);
    expect(doble.status).toBe(400);
  });

  it('Cierre de guía: retorna sobrante a Bodega y cuadra sin merma', async () => {
    const guias = await request(app).get('/api/logistica/guias');
    const guia = guias.body[0];
    expect(guia.totalVendido).toBe(10);

    const res = await request(app).post(`/api/logistica/guias/${guia.id}/cerrar`)
      .send({ pesoLlegada: 40, responsable: 'Despachador' });
    expect(res.status).toBe(200);
    // Cuadre: cargado 70 - vendido 10 - restante 60 = 0 merma
    expect(res.body.cuadre.merma).toBe(0);
    expect(res.body.cuadre.totalCargado).toBe(70);
    expect(res.body.cuadre.totalVendido).toBe(10);
    expect(res.body.cuadre.restanteCartones).toBe(60);

    // Etiquetas no vendidas → Retornada
    const etiquetas = await request(app).get('/api/etiquetas');
    const e2 = etiquetas.body.find((e: any) => e.id === 'e2');
    expect(e2.estado).toBe('Retornada');
    expect(e2.ubicacionActual).toBe('Bodega Central');

    // Camión vacío, Bodega restaurada
    const inv = await request(app).get('/api/inventario');
    const camion2 = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 2' && i.producto === 'Huevos - Grande');
    const bodega = inv.body.find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevos - Grande');
    expect(camion2.cantidad).toBe(0);
    expect(bodega.cantidad).toBe(110); // 50 + 60 retornados

    const guias2 = await request(app).get('/api/logistica/guias');
    expect(guias2.body[0].estado).toBe('Cerrada');
  });

  it('Guía cerrada desaparece de guías-activas y libera el camión', async () => {
    const activas = await request(app).get('/api/logistica/guias-activas');
    expect(activas.body.length).toBe(0);

    const camiones = await request(app).get('/api/logistica/camiones');
    expect(camiones.body.find((c: any) => c.nombre === 'Camión Ruta 2').guiaActivaId).toBeNull();
  });
});