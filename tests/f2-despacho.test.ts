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
const DB_PATH = path.resolve(process.cwd(), '.test-f2.db');
let client: any;


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);

  // Seed
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Despachador', 'despacho@test.com', 'Despachador'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['admin-f2', 'Administrador', 'admin-f2@test.com', 'Admin'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['2', 'Bodeguero', 'bodega@test.com', 'Bodeguero'] });
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
    sql: `INSERT INTO rutas (id, nombre, vendedor_asignado, cliente_ids, centroide_lat, centroide_lng, capacidad_max_cartones, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['r1', 'Ruta 1', '3', JSON.stringify(['c1', 'c2', 'c3']), 10.1, -84.1, 100, 'Activa']
  });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['i1', 'Huevos - Grande', 120, 'kg', 'Bodega Central', new Date().toISOString()]
  });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['i2', 'Huevos - Grande', 5, 'kg', 'Camión Ruta 1', new Date().toISOString()]
  });
  await client.execute({
    sql: `INSERT INTO productos_catalogo (id, nombre, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['p-grande', 'Huevos - Grande', 'kg', 16000, 'Huevos', 'Activo', new Date().toISOString()]
  });
  // Etiquetas EnBodega listas para cargar
  for (const [id, codigo, cantidad] of [['e1', 'ETQ-F2-001', 30], ['e2', 'ETQ-F2-002', 40], ['e3', 'ETQ-F2-003', 50]] as const) {
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega, peso_neto, saldo_kg, peso_origen, peso_registrado_por, peso_registrado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, codigo, 'Huevos - Grande', cantidad, 'EnBodega', 'Bodega Central', 'L-F2-01', cantidad, cantidad, cantidad, 'Manual', 'admin-f2', new Date().toISOString()]
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
    const crear = await requestAs(app, 'admin-f2').post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 2', placa: 'CR-222', ruta_defecto: 'Ruta 1', capacidad_cartones: 100 });
    expect(crear.status).toBe(201);

    const list = await requestAs(app, 'admin-f2').get('/api/logistica/camiones');
    expect(list.body.length).toBe(1);
    expect(list.body[0].guiaActivaId).toBeNull();

    const dup = await requestAs(app, 'admin-f2').post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 2', capacidad_cartones: 100 });
    expect(dup.status).toBe(400);
  });

  it('Crear guía de despacho marca etiquetas Cargada y mueve Bodega → Camión', async () => {
    const listCam = await requestAs(app, 'admin-f2').get('/api/logistica/camiones');
    const camion = listCam.body[0];

    const res = await requestAs(app, 'admin-f2').post('/api/logistica/guias')
      .send({
        camionId: camion.id,
        rutaId: 'r1',
        vendedorId: '3',
        clienteIds: ['c1', 'c2', 'c3'],
        etiquetasIds: ['e1', 'e2'], // 30 + 40 = 70 kg
        colchonEtiquetaIds: ['e2'], // 40 kg de reserva incluidos en la carga
        responsablesCarga: 'Bodeguero',
        responsableTransporte: 'Vendedor',
        pesoSalida: 45
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.colchonKg).toBe(40);
    expect(res.body.colchonPorProducto).toEqual([{ etiquetaId: 'e2', producto: 'Huevos - Grande', unidad: 'kg', cantidad: 40 }]);

    const guiaCreada = (await requestAs(app, 'admin-f2').get('/api/logistica/guias')).body[0];
    expect(guiaCreada.colchonCartones).toBe(40); // nombre legado; la cantidad representa kg
    expect(guiaCreada.colchonExtra).toEqual(res.body.colchonPorProducto);

    // Etiquetas Cargada con guía de despacho
    const etiquetas = await requestAs(app, 'admin-f2').get('/api/etiquetas');
    const e1 = etiquetas.body.find((e: any) => e.id === 'e1');
    const e2 = etiquetas.body.find((e: any) => e.id === 'e2');
    expect(e1.estado).toBe('Cargada');
    expect(e1.guiaDespachoId).toBeTruthy();
    expect(e1.ubicacionActual).toBe('Camión Ruta 2');
    expect(e2.estado).toBe('Cargada');

    // Stock Bodega → Camión
    const inv = await requestAs(app, 'admin-f2').get('/api/inventario');
    const bodega = inv.body.find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevos - Grande');
    const stockCamion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 2' && i.producto === 'Huevos - Grande');
    expect(bodega.cantidad).toBe(50);
    expect(stockCamion.cantidad).toBe(70);
  });

  it('Guía activa por camión: no permite una segunda', async () => {
    const listCam = await requestAs(app, 'admin-f2').get('/api/logistica/camiones');
    const camion = listCam.body[0];

    const res = await requestAs(app, 'admin-f2').post('/api/logistica/guias')
      .send({ camionId: camion.id, etiquetasIds: ['e3'] });
    expectApi(res, 409, 'Guía activa por camión');
    expect(res.body.error).toContain('guía activa');
  });

  it('No permite cargar etiquetas fuera de EnBodega', async () => {
    await requestAs(app, 'admin-f2').post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 3', placa: 'CR-333', capacidad_cartones: 100 });
    const listCam = await requestAs(app, 'admin-f2').get('/api/logistica/camiones');
    const camion3 = listCam.body.find((c: any) => c.nombre === 'Camión Ruta 3');

    // e3 sigue EnBodega → sí carga; e1 ya Cargada + e2 ya Cargada → rechaza
    const res = await requestAs(app, 'admin-f2').post('/api/logistica/guias')
      .send({ camionId: camion3.id, etiquetasIds: ['e1', 'e3'] });
    expectApi(res, 400, 'Etiquetas no cargables');
    expect(res.body.error).toContain('no cargables');
  });

  it('No permite exceder la capacidad del camión', async () => {
    await requestAs(app, 'admin-f2').post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 4', placa: 'CR-444', capacidad_cartones: 30 });
    const listCam = await requestAs(app, 'admin-f2').get('/api/logistica/camiones');
    const camion4 = listCam.body.find((c: any) => c.nombre === 'Camión Ruta 4');

    // e3 (50) > capacidad 30 → excede
    const res = await requestAs(app, 'admin-f2').post('/api/logistica/guias')
      .send({ camionId: camion4.id, etiquetasIds: ['e3'] });
    expectApi(res, 400, 'Exceso de capacidad');
    expect(res.body.error).toContain('Excede capacidad');
  });

  it('GET /api/logistica/guias/:id incluye detalle con etiquetas y orden de recorrido', async () => {
    const res = await requestAs(app, 'admin-f2').get('/api/logistica/guias');
    const guia = res.body[0];

    const det = await requestAs(app, 'admin-f2').get(`/api/logistica/guias/${guia.id}`);
    expect(det.status).toBe(200);
    expect(det.body.consecutivo).toMatch(/^GD-\d{8}-/);
    expect(det.body.camionNombre).toBe('Camión Ruta 2');
    expect(det.body.detalle.length).toBe(2);
    expect(det.body.rutaOrden.length).toBe(3);
    expect(det.body.rutaOrden[0].clienteId).toBeTruthy();
  });

  it('/api/logistica/guias-activas solo devuelve guías abiertas', async () => {
    const res = await requestAs(app, 'admin-f2').get('/api/logistica/guias-activas');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('Venta en ruta con guiaId descuenta del camión correcto (fix bug hardcodeado)', async () => {
    const guias = await requestAs(app, 'admin-f2').get('/api/logistica/guias');
    const guia = guias.body[0];
    const salida = await requestAs(app, 'admin-f2').post(`/api/logistica/guias/${guia.id}/marcar-en-ruta`);
    expect(salida.status).toBe(200);

    const res = await requestAs(app, 'admin-f2').post('/api/ventas')
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

    const inv = await requestAs(app, 'admin-f2').get('/api/inventario');
    const camion2 = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 2' && i.producto === 'Huevos - Grande');
    const camion1 = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 1' && i.producto === 'Huevos - Grande');
    expect(camion2.cantidad).toBe(60); // 70 - 10 vendidos
    expect(camion1.cantidad).toBe(5); // i2 sembrada: el descuento fue solo del Camión Ruta 2

    // La factura queda ligada a la guía. La venta es parcial (10 de 30), así que
    // el galerón conserva el restante (como en la caja en ruta) para que el
    // cuadre central lo reingrese en vez de contarlo como merma.
    const factura = await requestAs(app, 'admin-f2').get('/api/facturas');
    expect(factura.body[0].guiaId).toBe(guia.id);
    const etiquetas = await requestAs(app, 'admin-f2').get('/api/etiquetas');
    const e1 = etiquetas.body.find((e: any) => e.id === 'e1');
    expect(e1.estado).toBe('Cargada');
    expect(e1.saldoKg).toBe(20);
  });

  it('rechaza una venta de Comercial sin guía activa y no altera inventario', async () => {
    const venta = await requestAs(app, 'admin-f2').post('/api/ventas').set('x-user-id', '3').send({
      factura: {
        id: 'f2', consecutivo: 'F-0002', fecha: new Date().toISOString(),
        clienteId: 'c1', vendedorId: '3',
        subtotal: 16000, descuento: 0, total: 16000,
        condicion_pago: 'Contado', metodo_pago: 'Efectivo', estado: 'Pagada'
      },
      detalles: [{ producto: 'Huevos - Grande', cantidad: 1, precio_unitario: 16000, subtotal: 16000 }]
    });
    expect(venta.status).toBe(409);
    expect(venta.body.error).toContain('ruta activa');

    const inv = await requestAs(app, 'admin-f2').get('/api/inventario');
    const camion1 = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 1' && i.producto === 'Huevos - Grande');
    expect(camion1.cantidad).toBe(5);
  });

  it('Marcar EnRuta requiere estado Cargada', async () => {
    const guias = await requestAs(app, 'admin-f2').get('/api/logistica/guias');
    const guia = guias.body[0];

    const mal = await requestAs(app, 'admin-f2').post(`/api/logistica/guias/${guia.id}/marcar-en-ruta`);
    expect(mal.status).toBe(400); // la prueba de venta anterior ya la puso EnRuta
    const guias2 = await requestAs(app, 'admin-f2').get('/api/logistica/guias');
    expect(guias2.body[0].estado).toBe('EnRuta');

    const doble = await requestAs(app, 'admin-f2').post(`/api/logistica/guias/${guia.id}/marcar-en-ruta`);
    expect(doble.status).toBe(400);
  });

  // Desde G3 el cierre de guía no es un camino aparte: la caja cierra el día
  // y después central cuadra con el endpoint completo (`/cuadre-central`). El
  // endpoint ligero que cerraba sin cuadrar (`/guias/:id/cerrar`) se eliminó.
  it('Cierre de guía: retorna sobrante a Bodega y cuadra sin merma', async () => {
    const guias = await requestAs(app, 'admin-f2').get('/api/logistica/guias');
    const guia = guias.body[0];
    expect(guia.totalVendido).toBe(10);

    await requestAs(app, 'admin-f2').post('/api/logistica/caja/fin-dia')
      .send({ guiaId: guia.id, responsable: 'Vendedor' });

    const aceptacion = await requestAs(app, 'admin-f2').post('/api/logistica/bodega/retorno/aceptar-sobrante')
      .set('x-user-id', '2')
      .send({ guiaId: guia.id, responsable: 'Bodeguero', conteoPorProducto: [{ producto: 'Huevos - Grande', cantidad: 60 }] });
    expect(aceptacion.status).toBe(200);

    const res = await requestAs(app, 'admin-f2').post(`/api/logistica/cuadre-central`)
      .set('x-user-id', 'admin-f2')
      .send({ guiaId: guia.id, pesoLlegada: 40, responsable: 'Despachador' });
    expect(res.status).toBe(200);
    // Cuadre: cargado 70 - vendido 10 - reingresado 60 = 0 merma
    expect(res.body.estado).toBe('CerradaConDiferencia');
    expect(res.body.cuadre.merma).toBe(0);
    expect(res.body.cuadre.cargado).toBe(70);
    expect(res.body.cuadre.vendidos).toBe(10);
    expect(res.body.cuadre.cartonesReingresar).toBe(0); // el sobrante ya fue aceptado físicamente por Bodega

    // Etiquetas no vendidas → EnBodega (el cuadre central las reingresa)
    const etiquetas = await requestAs(app, 'admin-f2').get('/api/etiquetas');
    const e2 = etiquetas.body.find((e: any) => e.id === 'e2');
    expect(e2.estado).toBe('EnBodega');
    expect(e2.ubicacionActual).toBe('Bodega Central');

    // Camión vacío, Bodega restaurada
    const inv = await requestAs(app, 'admin-f2').get('/api/inventario');
    const camion2 = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 2' && i.producto === 'Huevos - Grande');
    const bodega = inv.body.find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevos - Grande');
    expect(camion2.cantidad).toBe(0);
    expect(bodega.cantidad).toBe(110); // 50 + 60 retornados

    const guias2 = await requestAs(app, 'admin-f2').get('/api/logistica/guias');
    expect(guias2.body[0].estado).toBe('CerradaConDiferencia');
  });

  it('Guía cerrada con diferencia sigue en revisión y no libera el camión', async () => {
    const activas = await requestAs(app, 'admin-f2').get('/api/logistica/guias-activas');
    expect(activas.body.length).toBe(1);

    const camiones = await requestAs(app, 'admin-f2').get('/api/logistica/camiones');
    expect(camiones.body.find((c: any) => c.nombre === 'Camión Ruta 2').guiaActivaId).toBeTruthy();
  });

  it('Guía con vendedor de la ruta y clientes a visitar (subset)', async () => {
    const camiones = await requestAs(app, 'admin-f2').get('/api/logistica/camiones');
    const camion3 = camiones.body.find((c: any) => c.nombre === 'Camión Ruta 3');

    const res = await requestAs(app, 'admin-f2').post('/api/logistica/guias')
      .send({
        camionId: camion3.id,
        rutaId: 'r1',
        etiquetasIds: ['e3'], // 50 cartones
        vendedorId: '3',
        clienteIds: ['c1', 'c3'] // subset de la ruta (c2 queda excluido)
      });
    expect(res.status).toBe(201);

    const guias = await requestAs(app, 'admin-f2').get('/api/logistica/guias');
    const guia = guias.body.find((g: any) => g.camionNombre === 'Camión Ruta 3');
    expect(guia).toBeTruthy();

    const det = await requestAs(app, 'admin-f2').get(`/api/logistica/guias/${guia.id}`);
    expect(det.status).toBe(200);
    expect(det.body.vendedorId).toBe('3');
    // Solo los clientes seleccionados aparecen en el orden y en clientesRuta
    expect(det.body.rutaOrden.length).toBe(2);
    expect(det.body.clientesRuta.map((c: any) => c.clienteId).sort()).toEqual(['c1', 'c3']);
    expect(det.body.clientesRuta.map((c: any) => c.clienteId)).not.toContain('c2');
  });

  it('Rechaza vendedor de la ruta que no es vendedor', async () => {
    const camiones = await requestAs(app, 'admin-f2').get('/api/logistica/camiones');
    const camion3 = camiones.body.find((c: any) => c.nombre === 'Camión Ruta 3');

    const res = await requestAs(app, 'admin-f2').post('/api/logistica/guias')
      .send({
        camionId: camion3.id,
        rutaId: 'r1',
        etiquetasIds: ['e3'],
        vendedorId: '1' // Despachador, no vendedor
      });
    expectApi(res, 400, 'Vendedor de ruta inválido');
    expect(res.body.error).toContain('no es un vendedor');
  });

  it('clientes con provincia/cantón/distrito: el orden de la ruta respeta la geografía', async () => {
    // Clientes SIN coordenadas pero con geografía: el orden debe ser
    // provincia → cantón → distrito, no el orden en que se enviaron.
    await client.execute({
      sql: `INSERT INTO clientes (id, nombre, ruta, condicion_pago, estado, provincia, canton, distrito) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['g1', 'Geo Alajuela B', 'R1', 'Contado', 'Activo', 'Alajuela', 'San Carlos', 'Pital']
    });
    await client.execute({
      sql: `INSERT INTO clientes (id, nombre, ruta, condicion_pago, estado, provincia, canton, distrito) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['g2', 'Geo San José A', 'R1', 'Contado', 'Activo', 'San José', 'Escazú', 'San Rafael']
    });
    await client.execute({
      sql: `INSERT INTO clientes (id, nombre, ruta, condicion_pago, estado, provincia, canton, distrito) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['g3', 'Geo Alajuela A', 'R1', 'Contado', 'Activo', 'Alajuela', 'Central', 'San Rafael']
    });
    await client.execute({ sql: `UPDATE rutas SET cliente_ids = ? WHERE id = ?`, args: [JSON.stringify(['c1', 'c2', 'c3', 'g1', 'g2', 'g3']), 'r1'] });

    await requestAs(app, 'admin-f2').post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 5', placa: 'CR-555', capacidad_cartones: 100 });
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['e4', 'ETQ-F2-004', 'Huevos - Grande', 10, 'EnBodega', 'Bodega Central', 'L-F2-02', 20]
    });

    const camiones = await requestAs(app, 'admin-f2').get('/api/logistica/camiones');
    const camion5 = camiones.body.find((c: any) => c.nombre === 'Camión Ruta 5');

    const res = await requestAs(app, 'admin-f2').post('/api/logistica/guias')
      .send({
        camionId: camion5.id,
        rutaId: 'r1',
        etiquetasIds: ['e4'],
        clienteIds: ['g1', 'g2', 'g3'] // desordenado a propósito
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const guias = await requestAs(app, 'admin-f2').get('/api/logistica/guias');
    const guia = guias.body.find((g: any) => g.camionNombre === 'Camión Ruta 5');
    const det = await requestAs(app, 'admin-f2').get(`/api/logistica/guias/${guia.id}`);
    expect(det.status).toBe(200);

    // Sin coordenadas el orden es geográfico (provincia → cantón → distrito),
    // alfabético: Alajuela/Central (g3) < Alajuela/San Carlos (g1) < San José (g2).
    expect(det.body.rutaOrden.map((c: any) => c.clienteId)).toEqual(['g3', 'g1', 'g2']);
  });

  it('POST /api/clientes guarda provincia/cantón/distrito', async () => {
    const res = await requestAs(app, 'admin-f2').post('/api/clientes')
      .send({ nombre: 'Cliente Geo', direccion: 'Urb. X', provincia: 'Heredia', canton: 'Barva', distrito: 'San Pedro' });
    expect(res.status).toBe(201);

    const lista = await requestAs(app, 'admin-f2').get('/api/clientes');
    const creado = lista.body.find((c: any) => c.nombre === 'Cliente Geo');
    expect(creado.provincia).toBe('Heredia');
    expect(creado.canton).toBe('Barva');
    expect(creado.distrito).toBe('San Pedro');

    const upd = await requestAs(app, 'admin-f2').put(`/api/clientes/${creado.id}`)
      .send({ provincia: 'Limón', canton: 'Talamanca', distrito: 'Bratsi' });
    expect(upd.status).toBe(200);
    const lista2 = await requestAs(app, 'admin-f2').get('/api/clientes');
    const editado = lista2.body.find((c: any) => c.id === creado.id);
    expect(editado.provincia).toBe('Limón');
    expect(editado.canton).toBe('Talamanca');
    expect(editado.distrito).toBe('Bratsi');
  });
});
