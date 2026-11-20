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
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['2', 'Bodeguero', 'bodeguero@test.com', 'Bodeguero'] });
  await client.execute({ sql: `INSERT INTO clientes (id, nombre, documento_id, ruta, condicion_pago, estado, limite_credito, saldo_pendiente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: ['c1', 'Cliente A', '1-101-101', 'R1', 'Contado', 'Activo', 0, 0] });
  await client.execute({ sql: `INSERT INTO clientes (id, nombre, documento_id, ruta, condicion_pago, estado, limite_credito, saldo_pendiente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: ['c2', 'Cliente B', '2-202-202', 'R1', 'Credito', 'Activo', 5000000, 0] });
  await client.execute({ sql: `INSERT INTO rutas (id, nombre, cliente_ids, centroide_lat, centroide_lng, capacidad_max_cartones, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: ['r1', 'Ruta 1', JSON.stringify(['c1', 'c2']), 10.1, -84.1, 500, 'Activa'] });
  await client.execute({ sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`, args: ['i1', 'Huevos - Grande', 200, 'kg', 'Bodega Central', new Date().toISOString()] });
  const etiquetas = [['e10', 'ETQ-CN-010', 30], ['e11', 'ETQ-CN-011', 30], ['e12', 'ETQ-CN-012', 30], ['e13', 'ETQ-CN-013', 30], ['e14', 'ETQ-CN-014', 30]] as const;
  for (const [id, codigo, cantidad] of etiquetas) {
    await client.execute({ sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega, peso_neto, saldo_kg, peso_origen, peso_registrado_por, peso_registrado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [id, codigo, 'Huevos - Grande', cantidad, 'EnBodega', 'Bodega Central', 'L-CN-01', cantidad, cantidad, cantidad, 'Manual', '9', new Date().toISOString()] });
  }
  await client.execute({ sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: ['p1', 'Huevos - Grande', '', 'kg', 16000, 'Huevos', 'Activo', new Date().toISOString()] });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

const costo = (n: number) => n * 16000;

async function crearCamion(nombre: string) {
  const cam = await requestAs(app, '9').post('/api/logistica/camiones').send({ nombre, placa: 'CR-000', ruta_defecto: 'Ruta 1', capacidad_cartones: 150 });
  expect(cam.status).toBe(201);
  return cam.body;
}

async function crearGuia(camionId: string, etiquetas: string[]) {
  const gu = await requestAs(app, '9').post('/api/logistica/guias')
    .send({ camionId, rutaId: 'r1', etiquetasIds: etiquetas, responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
  expect(gu.status).toBe(201);
  const list = await requestAs(app, '9').get('/api/logistica/guias');
  const guia = list.body.find((g: any) => g.camionId === camionId);
  const salida = await requestAs(app, '9').post(`/api/logistica/guias/${guia.id}/marcar-en-ruta`);
  expect(salida.status).toBe(200);
  return guia;
}

describe('F4 — Facturación inmediata por tiquete y NC por devolución aceptada', () => {
  it('Preparación: guía 90ct, 3 tiquetes (c1 efvo, c2 crédito, c1 efvo), devolución y cuadre que cierra', async () => {
    const cam = await crearCamion('Camión Consolidación');
    refs.guia = await crearGuia(cam.id, ['e10', 'e11', 'e12']);
    expect(refs.guia.totalCartones).toBe(90);

    const v1 = await requestAs(app, '9').post('/api/logistica/caja/venta').send({ guiaId: refs.guia.id, clienteId: 'c1', etiquetaId: 'e10', producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Efectivo' });
    expect(v1.status).toBe(201); refs.v1 = v1.body;
    const v2 = await requestAs(app, '9').post('/api/logistica/caja/venta').send({ guiaId: refs.guia.id, clienteId: 'c2', etiquetaId: 'e11', producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Credito' });
    expect(v2.status).toBe(201); refs.v2 = v2.body;
    const v3 = await requestAs(app, '9').post('/api/logistica/caja/venta').send({ guiaId: refs.guia.id, clienteId: 'c1', etiquetaId: 'e12', producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Efectivo' });
    expect(v3.status).toBe(201); refs.v3 = v3.body;

    // Devolución del primer tiquete (efectivo) → queda Anulada
    const dev = await requestAs(app, '9').post('/api/logistica/caja/devolucion')
      .send({ guiaId: refs.guia.id, etiquetaId: refs.v1.etiquetaId, ventaRutaId: refs.v1.ventaId, responsable: 'Vendedor' });
    expect(dev.status).toBe(201);

    const fd = await requestAs(app, '9').post('/api/logistica/caja/fin-dia').send({ guiaId: refs.guia.id, responsable: 'Vendedor' });
    expect(fd.body.cuadre.mermaPreliminar).toBe(0);
    expect(fd.body.cuadre.tiquetesEmitidos).toBe(2);

    const retornos = await requestAs(app, '9').get(`/api/logistica/retornos/pendientes?guiaId=${refs.guia.id}`);
    for (const retorno of retornos.body) {
      const recibido = await requestAs(app, '9').post('/api/logistica/bodega/retorno/aceptar')
        .set('x-user-id', '2').send({ retornoId: retorno.id, responsable: 'Bodeguero' });
      expect(recibido.status).toBe(200);
    }

    const cuadre = await requestAs(app, '9').post('/api/logistica/cuadre-central').set('x-user-id', '9')
      .send({ guiaId: refs.guia.id, responsable: 'Despachador' });
    expect(cuadre.status).toBe(200);
    expect(cuadre.body.estado).toBe('Cerrada');
  });

  it('Venta emite una factura por tiquete y la recepción del retorno crea NC simulada vinculada', async () => {
    const docs = await requestAs(app, '9').get('/api/facturacion/documentos');
    const facturasRuta = docs.body.filter((d: any) => d.tipoDocumento === 'Factura');
    const nc = docs.body.find((d: any) => d.tipoDocumento === 'NotaCredito' && d.notasCreditoId === refs.v1.facturaId);
    expect(facturasRuta).toHaveLength(3); // una factura inmediata por venta, incluida la que se devolvió
    expect(nc).toMatchObject({ estado: 'Borrador', total: costo(30), notasCreditoId: refs.v1.facturaId });
    const original = await client.execute({ sql: `SELECT subtotal, precio_unitario FROM detalles_factura WHERE factura_id = ?`, args: [refs.v2.facturaId] });
    expect(Number(original.rows[0].precio_unitario)).toBe(16000);

    const res = await requestAs(app, '9').post('/api/facturacion/consolidar-ruta').set('x-user-id', '9').send({ guiaId: refs.guia.id });
    expect(res.status).toBe(409);
    expect((res.body.error as string)).toContain('ya fue consolidada');
  });

  it('Rutas del día: la guía aparece consolidada con su facturación', async () => {
    const rd = await requestAs(app, '9').get('/api/facturacion/rutas-dia');
    expect(rd.status).toBe(200);
    const ruta = rd.body.rutas.find((r: any) => r.guiaId === refs.guia.id);
    expect(ruta).toBeTruthy();
    expect(ruta.estado).toBe('Cerrada');
    expect(ruta.consolidada).toBe(true);
    expect(ruta.nFacturas).toBe(3); // incluye la factura del tiquete luego devuelto; la NC la referencia
    expect(ruta.tiquetesEmitidos).toBe(2);
    expect(ruta.retornos).toBe(1);
    expect(ruta.totalGenerado).toBe(costo(60));
  });

  it('Guía no cerrada (sin cuadre) → 409; consolidar dos veces → 409', async () => {
    const cam = await crearCamion('Camión No Cuadrado');
    const guiaAbierta = await crearGuia(cam.id, ['e13']);
    const res1 = await requestAs(app, '9').post('/api/facturacion/consolidar-ruta').set('x-user-id', '9').send({ guiaId: guiaAbierta.id });
    expect(res1.status).toBe(409);
    expect((res1.body.error as string)).toContain('cerrada');

    const res2 = await requestAs(app, '9').post('/api/facturacion/consolidar-ruta').set('x-user-id', '9').send({ guiaId: refs.guia.id });
    expect(res2.status).toBe(409);
    expect((res2.body.error as string)).toContain('ya fue consolidada');
  });

  it('Guía cerrada sin ventas → 400', async () => {
    const cam = await crearCamion('Camión Sin Ventas');
    const guiaVacia = await crearGuia(cam.id, ['e14']); // cargada pero sin ventas en caja
    await requestAs(app, '9').post('/api/logistica/caja/fin-dia').send({ guiaId: guiaVacia.id, responsable: 'Vendedor' });
    const recibido = await requestAs(app, '9').post('/api/logistica/bodega/retorno/aceptar-sobrante').set('x-user-id', '2')
      .send({ guiaId: guiaVacia.id, responsable: 'Bodeguero', conteoPorProducto: [{ producto: 'Huevos - Grande', cantidad: 30 }] });
    expect(recibido.status).toBe(200);
    const cuadre = await requestAs(app, '9').post('/api/logistica/cuadre-central').set('x-user-id', '9')
      .send({ guiaId: guiaVacia.id, responsable: 'Despachador' });
    expect(cuadre.status).toBe(200);
    expect(cuadre.body.estado).toBe('Cerrada');

    const res = await requestAs(app, '9').post('/api/facturacion/consolidar-ruta').set('x-user-id', '9').send({ guiaId: guiaVacia.id });
    expect(res.status).toBe(400);
    expect((res.body.error as string)).toContain('No hay ventas');
  });
});
