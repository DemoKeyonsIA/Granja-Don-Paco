import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
let client: any;
let refs: any = {};
const DB_PATH = path.resolve(process.cwd(), '.test-consolidacion.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);

  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Despachador', 'despacho@test.com', 'Despachador'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['3', 'Vendedor', 'vendedor@test.com', 'Vendedor'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['9', 'Facturador', 'facturador@test.com', 'Admin'] });
  await client.execute({ sql: `INSERT INTO clientes (id, nombre, documento_id, ruta, condicion_pago, estado, limite_credito, saldo_pendiente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: ['c1', 'Cliente A', '1-101-101', 'R1', 'Contado', 'Activo', 0, 0] });
  await client.execute({ sql: `INSERT INTO clientes (id, nombre, documento_id, ruta, condicion_pago, estado, limite_credito, saldo_pendiente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: ['c2', 'Cliente B', '2-202-202', 'R1', 'Credito', 'Activo', 5000000, 0] });
  await client.execute({ sql: `INSERT INTO rutas (id, nombre, cliente_ids, centroide_lat, centroide_lng, capacidad_max_cartones, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: ['r1', 'Ruta 1', JSON.stringify(['c1', 'c2']), 10.1, -84.1, 500, 'Activa'] });
  await client.execute({ sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`, args: ['i1', 'Huevos - Grande', 200, 'cartones', 'Bodega Central', new Date().toISOString()] });
  const etiquetas = [['e10', 'ETQ-CN-010', 30], ['e11', 'ETQ-CN-011', 30], ['e12', 'ETQ-CN-012', 30], ['e13', 'ETQ-CN-013', 30], ['e14', 'ETQ-CN-014', 30]] as const;
  for (const [id, codigo, cantidad] of etiquetas) {
    await client.execute({ sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [id, codigo, 'Huevos - Grande', cantidad, 'EnBodega', 'Bodega Central', 'L-CN-01', 20] });
  }
  await client.execute({ sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: ['p1', 'Huevos - Grande', '', 'cartones', 16000, 'Huevos', 'Activo', new Date().toISOString()] });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

const costo = (n: number) => n * 16000;

async function crearCamion(nombre: string) {
  const cam = await request(app).post('/api/logistica/camiones').send({ nombre, placa: 'CR-000', ruta_defecto: 'Ruta 1', capacidad_cartones: 150 });
  expect(cam.status).toBe(201);
  return cam.body;
}

async function crearGuia(camionId: string, etiquetas: string[]) {
  const gu = await request(app).post('/api/logistica/guias')
    .send({ camionId, rutaId: 'r1', etiquetasIds: etiquetas, responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
  expect(gu.status).toBe(201);
  const list = await request(app).get('/api/logistica/guias');
  return list.body.find((g: any) => g.camionId === camionId);
}

describe('F4 — Consolidación de ruta → facturación electrónica (factura por cliente + NC por devolución)', () => {
  it('Preparación: guía 90ct, 3 tiquetes (c1 efvo, c2 crédito, c1 efvo), devolución y cuadre que cierra', async () => {
    const cam = await crearCamion('Camión Consolidación');
    refs.guia = await crearGuia(cam.id, ['e10', 'e11', 'e12']);
    expect(refs.guia.totalCartones).toBe(90);

    const v1 = await request(app).post('/api/logistica/caja/venta').send({ guiaId: refs.guia.id, clienteId: 'c1', etiquetaId: 'e10', producto: 'Huevos - Grande', cartones: 30, cobro: 'Efectivo' });
    expect(v1.status).toBe(201); refs.v1 = v1.body;
    const v2 = await request(app).post('/api/logistica/caja/venta').send({ guiaId: refs.guia.id, clienteId: 'c2', etiquetaId: 'e11', producto: 'Huevos - Grande', cartones: 30, cobro: 'Credito' });
    expect(v2.status).toBe(201); refs.v2 = v2.body;
    const v3 = await request(app).post('/api/logistica/caja/venta').send({ guiaId: refs.guia.id, clienteId: 'c1', etiquetaId: 'e12', producto: 'Huevos - Grande', cartones: 30, cobro: 'Efectivo' });
    expect(v3.status).toBe(201); refs.v3 = v3.body;

    // Devolución del primer tiquete (efectivo) → queda Anulada
    const dev = await request(app).post('/api/logistica/caja/devolucion')
      .send({ guiaId: refs.guia.id, etiquetaId: refs.v1.etiquetaId, ventaRutaId: refs.v1.ventaId, responsable: 'Vendedor' });
    expect(dev.status).toBe(201);

    const fd = await request(app).post('/api/logistica/caja/fin-dia').send({ guiaId: refs.guia.id, responsable: 'Vendedor' });
    expect(fd.body.cuadre.mermaPreliminar).toBe(0);
    expect(fd.body.cuadre.tiquetesEmitidos).toBe(2);

    const cuadre = await request(app).post('/api/logistica/cuadre-central')
      .set('x-user-id', '1').send({ guiaId: refs.guia.id, responsable: 'Despachador' });
    expect(cuadre.status).toBe(200);
    expect(cuadre.body.estado).toBe('Cerrada');
  });

  it('Consolidar: una factura por cliente (contado + crédito) y NC por la devolución, tiquetes enlazados', async () => {
    const res = await request(app).post('/api/facturacion/consolidar-ruta')
      .set('x-user-id', '9')
      .send({ guiaId: refs.guia.id, emisorNombre: 'Granja Don Paco', emisorCedula: '3-101-000000' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emitidas).toBe(2);
    expect(res.body.anuladas).toBe(1);
    // 2 facturas (c2 crédito, c1 efectivo) + 1 NC
    expect(res.body.facturas).toHaveLength(2);
    expect(res.body.documentos).toHaveLength(3);

    const factContado = res.body.facturas.find((f: any) => f.cliente === 'Cliente A');
    const factCredito = res.body.facturas.find((f: any) => f.cliente === 'Cliente B');
    expect(factContado.total).toBe(costo(30));
    expect(factCredito.total).toBe(costo(30));
    expect(factCredito.condicion).toBe('Credito');

    const docs = await request(app).get('/api/facturacion/documentos');
    const feC2 = docs.body.find((d: any) => d.tipoDocumento === 'Factura' && d.receptorNombre === 'Cliente B');
    const feC1 = docs.body.find((d: any) => d.tipoDocumento === 'Factura' && d.receptorNombre === 'Cliente A');
    const nc = docs.body.find((d: any) => d.tipoDocumento === 'NotaCredito');
    expect(feC2).toMatchObject({ estado: 'Borrador', condicionPago: 'Credito', medioPago: 'Credito', total: costo(30) });
    expect(feC1).toMatchObject({ estado: 'Borrador', condicionPago: 'Contado', total: costo(30) });
    expect(nc).toMatchObject({ estado: 'Borrador', total: costo(30) });
    expect(nc.notasCreditoId).toBe(refs.v1.ventaId);

    // Facturas en el libro: c1 Pagada, c2 Pendiente, NC fuera de ingresos
    const facturas = await request(app).get('/api/facturas');
    const fC1 = facturas.body.find((f: any) => f.clienteId === 'c1' && f.estado !== 'NotaCredito');
    const fC2 = facturas.body.find((f: any) => f.clienteId === 'c2');
    const fNC = facturas.body.find((f: any) => f.estado === 'NotaCredito');
    expect(fC1).toMatchObject({ estado: 'Pagada', condicion_pago: 'Contado', metodo_pago: 'Efectivo', total: costo(30) });
    expect(fC2).toMatchObject({ estado: 'Pendiente', condicion_pago: 'Credito', metodo_pago: 'Credito', total: costo(30) });
    expect(fNC.total).toBe(costo(30));

    // Tiquetes vinculados a la factura consolidada
    const ventas = await client.execute({ sql: `SELECT tiquete_consecutivo, factura_id FROM ventas_ruta WHERE guia_id = ?`, args: [refs.guia.id] });
    const link = (t: string) => ventas.rows.find((v: any) => v.tiquete_consecutivo === t)?.factura_id;
    expect(link('TQ-0002')).toBe(fC2.id); // crédito vivo
    expect(link('TQ-0003')).toBe(fC1.id); // efectivo vivo
    expect(link('TQ-0001')).toBeNull(); // anulada no se factura
  });

  it('Rutas del día: la guía aparece consolidada con su facturación', async () => {
    const rd = await request(app).get('/api/facturacion/rutas-dia');
    expect(rd.status).toBe(200);
    const ruta = rd.body.rutas.find((r: any) => r.guiaId === refs.guia.id);
    expect(ruta).toBeTruthy();
    expect(ruta.estado).toBe('Cerrada');
    expect(ruta.consolidada).toBe(true);
    expect(ruta.nFacturas).toBe(2);
    expect(ruta.tiquetesEmitidos).toBe(2);
    expect(ruta.retornos).toBe(1);
    expect(ruta.totalGenerado).toBe(costo(60));
  });

  it('Guía no cerrada (sin cuadre) → 409; consolidar dos veces → 409', async () => {
    const cam = await crearCamion('Camión No Cuadrado');
    const guiaAbierta = await crearGuia(cam.id, ['e13']);
    const res1 = await request(app).post('/api/facturacion/consolidar-ruta').set('x-user-id', '9').send({ guiaId: guiaAbierta.id });
    expect(res1.status).toBe(409);
    expect((res1.body.error as string)).toContain('cerrada');

    const res2 = await request(app).post('/api/facturacion/consolidar-ruta').set('x-user-id', '9').send({ guiaId: refs.guia.id });
    expect(res2.status).toBe(409);
    expect((res2.body.error as string)).toContain('ya fue consolidada');
  });

  it('Guía cerrada sin ventas → 400', async () => {
    const cam = await crearCamion('Camión Sin Ventas');
    const guiaVacia = await crearGuia(cam.id, ['e14']); // cargada pero sin ventas en caja
    await request(app).post('/api/logistica/caja/fin-dia').send({ guiaId: guiaVacia.id, responsable: 'Vendedor' });
    const cuadre = await request(app).post('/api/logistica/cuadre-central')
      .set('x-user-id', '1').send({ guiaId: guiaVacia.id, responsable: 'Despachador' });
    expect(cuadre.status).toBe(200);
    expect(cuadre.body.estado).toBe('Cerrada');

    const res = await request(app).post('/api/facturacion/consolidar-ruta').set('x-user-id', '9').send({ guiaId: guiaVacia.id });
    expect(res.status).toBe(400);
    expect((res.body.error as string)).toContain('No hay ventas');
  });
});