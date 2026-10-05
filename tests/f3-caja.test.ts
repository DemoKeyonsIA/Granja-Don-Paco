import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { expectApi } from './helpers/http';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
let client: any;
const DB_PATH = path.resolve(process.cwd(), '.test-f3.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);

  // Seed
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Despachador', 'despacho@test.com', 'Despachador'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['3', 'Vendedor', 'vendedor@test.com', 'Vendedor'] });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, latitud, longitud, ruta, condicion_pago, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['c1', 'Cliente A', 10.1, -84.1, 'R1', 'Contado', 'Activo']
  });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, latitud, longitud, ruta, condicion_pago, estado, limite_credito, saldo_pendiente, ventana_entrega_ini, ventana_entrega_fin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['c2', 'Cliente B', 10.0, -84.0, 'R1', 'Credito', 'Activo', 2000000, 0, '07:00', '08:00']
  });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, latitud, longitud, ruta, condicion_pago, estado, limite_credito, saldo_pendiente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['c3', 'Cliente Sin Límite', 10.2, -84.2, 'R1', 'Credito', 'Activo', 1000, 0]
  });
  await client.execute({
    sql: `INSERT INTO rutas (id, nombre, cliente_ids, centroide_lat, centroide_lng, capacidad_max_cartones, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['r1', 'Ruta 1', JSON.stringify(['c1', 'c2', 'c3']), 10.1, -84.1, 500, 'Activa']
  });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['i1', 'Huevos - Grande', 200, 'cartones', 'Bodega Central', new Date().toISOString()]
  });
  for (const [id, codigo, cantidad] of [['e1', 'ETQ-F3-001', 30], ['e2', 'ETQ-F3-002', 40], ['e3', 'ETQ-F3-003', 50]] as const) {
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, codigo, 'Huevos - Grande', cantidad, 'EnBodega', 'Bodega Central', 'L-F3-01', 20]
    });
  }
  await client.execute({
    sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['p1', 'Huevos - Grande', '', 'cartones', 16000, 'Huevos', 'Activo', new Date().toISOString()]
  });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('F3 — Caja del vendedor: ventas en ruta, tiquetes, retornos, tablero y fin de día', () => {
  let guia: any;
  let v2: any;

  it('Preparación: crear camión y guía con 3 etiquetas (120 cartones)', async () => {
    const cam = await request(app).post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 5', placa: 'CR-555', ruta_defecto: 'Ruta 1', capacidad_cartones: 150 });
    expect(cam.status).toBe(201);

    const gu = await request(app).post('/api/logistica/guias')
      .send({
        camionId: cam.body.id,
        rutaId: 'r1',
        etiquetasIds: ['e1', 'e2', 'e3'], // 30 + 40 + 50 = 120
        responsablesCarga: 'Bodeguero',
        responsableTransporte: 'Vendedor'
      });
    expect(gu.status).toBe(201);

    const list = await request(app).get('/api/logistica/guias');
    guia = list.body[0];
    expect(guia.totalCartones).toBe(120);
    expect(guia.camionNombre).toBe('Camión Ruta 5');
  });

  it('Venta en caja: emite TQ-0001, descuenta el camión correcto y marca la etiqueta Entregada', async () => {
    const res = await request(app).post('/api/logistica/caja/venta')
      .send({
        guiaId: guia.id,
        clienteId: 'c1',
        etiquetaId: 'e1',
        producto: 'Huevos - Grande',
        cartones: 30,
        precioUnitario: 16000,
        cobro: 'Efectivo'
      });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteConsecutivo).toBe('TQ-0001');
    expect(res.body.total).toBe(480000);
    expect(res.body.etiquetaId).toBe('e1'); // la respuesta incluye etiquetaId para la devolución desde UI

    const inv = await request(app).get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 5' && i.producto === 'Huevos - Grande');
    expect(camion.cantidad).toBe(90); // 120 - 30 vendidos

    const etiquetas = await request(app).get('/api/etiquetas');
    const e1 = etiquetas.body.find((e: any) => e.id === 'e1');
    expect(e1.estado).toBe('Entregada');
    expect(e1.ubicacionActual).toBe('Camión Ruta 5');
  });

  it('Tiquete consecutivo TQ-0002 con cobro crédito: aumenta saldo del cliente', async () => {
    const res = await request(app).post('/api/logistica/caja/venta')
      .send({
        guiaId: guia.id,
        clienteId: 'c2',
        etiquetaId: 'e2',
        producto: 'Huevos - Grande',
        cartones: 40,
        precioUnitario: 16000,
        cobro: 'Credito'
      });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteConsecutivo).toBe('TQ-0002');
    expect(res.body.fechaHora).toBeTruthy();
    v2 = res.body;

    const saldo = await request(app).get('/api/clientes');
    const c2 = saldo.body.find((c: any) => c.id === 'c2');
    expect(c2.saldo_pendiente).toBe(640000);

    const inv = await request(app).get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 5' && i.producto === 'Huevos - Grande');
    expect(camion.cantidad).toBe(50); // 90 - 40
  });

  it('Venta parcial (sin etiqueta) con precio automático del catálogo → TQ-0003', async () => {
    const res = await request(app).post('/api/logistica/caja/venta')
      .send({
        guiaId: guia.id,
        clienteId: 'c1',
        producto: 'Huevos - Grande',
        cartones: 10, // precio autoconf (16000 del catálogo)
        cobro: 'Efectivo'
      });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteConsecutivo).toBe('TQ-0003');
    expect(res.body.total).toBe(160000);

    const inv = await request(app).get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 5' && i.producto === 'Huevos - Grande');
    expect(camion.cantidad).toBe(40);
  });

  it('Venta sin stock suficiente en el camión → error', async () => {
    const res = await request(app).post('/api/logistica/caja/venta')
      .send({
        guiaId: guia.id,
        clienteId: 'c1',
        producto: 'Huevos - Grande',
        cartones: 9999,
        precioUnitario: 16000,
        cobro: 'Efectivo'
      });
    expectApi(res, 400, 'Venta sin stock en camión');
    expect(res.body.error).toContain('Stock insuficiente');
  });

  it('Venta de guía inexistente → 404', async () => {
    const res = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: 'no-existe', producto: 'Huevos - Grande', cartones: 1, cobro: 'Efectivo' });
    expect(res.status).toBe(404);
  });

  it('Devolución: anula TQ-0002, libera inventario al camión, etiqueta Retornada y revierte saldo crédito', async () => {
    const res = await request(app).post('/api/logistica/caja/devolucion')
      .send({ guiaId: guia.id, etiquetaId: 'e2', ventaRutaId: v2.ventaId, responsable: 'Vendedor' });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteAnulado).toBe('TQ-0002');

    const inv = await request(app).get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 5' && i.producto === 'Huevos - Grande');
    expect(camion.cantidad).toBe(80); // 40 + 40 devueltos

    const etiquetas = await request(app).get('/api/etiquetas');
    const e2 = etiquetas.body.find((e: any) => e.id === 'e2');
    expect(e2.estado).toBe('Retornada');

    const saldo = await request(app).get('/api/clientes');
    const c2 = saldo.body.find((c: any) => c.id === 'c2');
    expect(c2.saldo_pendiente).toBe(0);
  });

  it('Venta a crédito que excede el límite → rechazada', async () => {
    const res = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guia.id, clienteId: 'c3', producto: 'Huevos - Grande', cartones: 1, precioUnitario: 16000, cobro: 'Credito' });
    expectApi(res, 400, 'Crédito excedido');
    expect(res.body.error).toContain('excede límite de crédito');
  });

  it('Tablero: estados/horas, cartones, $, retornos, merma y sin saltos de secuencia', async () => {
    const res = await request(app).get('/api/logistica/tablero');
    expect(res.status).toBe(200);
    const linea = res.body.guias.find((g: any) => g.guiaId === guia.id);
    expect(linea).toBeTruthy();
    expect(linea.camionNombre).toBe('Camión Ruta 5');
    // Tras devolución: vendidos 30 + 10 = 40 (TQ-0002 anulado no cuenta)
    expect(linea.cartonesVendidos).toBe(40);
    expect(linea.tiquetesEmitidos).toBe(2);
    expect(linea.tiquetesAnulados).toBe(1);
    expect(linea.totalEfectivo).toBe(640000);
    expect(linea.totalCredito).toBe(0);
    expect(linea.cartonesRetornados).toBe(40);
    expect(linea.restanteCamion).toBe(80);
    expect(linea.mermaPreliminar).toBe(0); // 120 - 40 - 80
    expect(linea.avance).toBe(33);
    // Sin huecos: TQ-0002 existe (anulado registrado)
    expect(linea.saltosSecuencia.length).toBe(0);
    expect(linea.clientesAtendidos.length).toBe(2); // c1 (2 tiquetes) + c2 no atendido (anulado)
    expect(linea.clientesAtendidos[0].hora).toBeTruthy();
  });

  it('Venta sin header de usuario: asigna vendedor de respaldo (FK users) y rango de tiquete disjunto por camión', async () => {
    // Etiqueta extra EnBodega para un 2º camión
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['e4', 'ETQ-F3-004', 'Huevos - Grande', 20, 'EnBodega', 'Bodega Central', 'L-F3-01', 15]
    });
    const cam = await request(app).post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta F3-2', capacidad_cartones: 150 });
    expect(cam.status).toBe(201);
    const gu = await request(app).post('/api/logistica/guias')
      .send({ camionId: cam.body.id, etiquetasIds: ['e4'], responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expect(gu.status).toBe(201);

    // Recuperar la guía creada (el POST no devuelve id; se busca por camión)
    const activas = await request(app).get('/api/logistica/guias-activas');
    const guia2 = activas.body.find((x: any) => x.camionId === cam.body.id);
    expect(guia2).toBeTruthy();

    // Sin header x-user-id y sin vendedorId → el backend debe caer al Vendedor demo ('3')
    const ven = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guia2.id, clienteId: 'c1', etiquetaId: 'e4', producto: 'Huevos - Grande', cartones: 20, precioUnitario: 16000, cobro: 'Efectivo' });
    expect(ven.status).toBe(201);
    expect(ven.body.tiqueteConsecutivo).toBe('TQ-5002'); // rango disjunto del 2º camión

    const row = await client.execute({ sql: `SELECT vendedor_id FROM ventas_ruta WHERE tiquete_consecutivo = ?`, args: ['TQ-5002'] });
    expect(row.rows[0].vendedor_id).toBe('3');
  });

  it('Fin de día: devuelve cuadre provisional y bloquea nuevas ventas', async () => {
    const res = await request(app).post('/api/logistica/caja/fin-dia')
      .send({ guiaId: guia.id, responsable: 'Vendedor' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CajaCerrada');
    expect(res.body.cuadre.tiquetesEmitidos).toBe(2);
    expect(res.body.cuadre.tiquetesAnulados).toBe(1);
    expect(res.body.cuadre.cartonesVendidos).toBe(40);
    expect(res.body.cuadre.cartonesRetornados).toBe(40);
    expect(res.body.cuadre.mermaPreliminar).toBe(0);
    expect(res.body.cuadre.totalEfectivo).toBe(640000);

    // Ventas bloqueadas
    const venta = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guia.id, clienteId: 'c1', producto: 'Huevos - Grande', cartones: 1, precioUnitario: 16000, cobro: 'Efectivo' });
    expect(venta.status).toBe(409);
  });
});