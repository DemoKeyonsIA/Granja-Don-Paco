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
let guiasRef: any = {};
const DB_PATH = path.resolve(process.cwd(), '.test-f4.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);

  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Despachador', 'despacho@test.com', 'Despachador'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['3', 'Vendedor', 'vendedor@test.com', 'Vendedor'] });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, latitud, longitud, ruta, condicion_pago, estado, limite_credito, saldo_pendiente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['c1', 'Cliente A', 10.1, -84.1, 'R1', 'Contado', 'Activo', 0, 0]
  });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, latitud, longitud, ruta, condicion_pago, estado, limite_credito, saldo_pendiente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['c2', 'Cliente B', 10.0, -84.0, 'R1', 'Credito', 'Activo', 5000000, 0]
  });
  await client.execute({
    sql: `INSERT INTO rutas (id, nombre, cliente_ids, centroide_lat, centroide_lng, capacidad_max_cartones, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['r1', 'Ruta 1', JSON.stringify(['c1', 'c2']), 10.1, -84.1, 500, 'Activa']
  });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['i1', 'Huevos - Grande', 300, 'cartones', 'Bodega Central', new Date().toISOString()]
  });
  const etiquetas = [
    ['e1', 'ETQ-F4-001', 30], ['e2', 'ETQ-F4-002', 30], ['e3', 'ETQ-F4-003', 40],
    ['e4', 'ETQ-F4-004', 30], ['e5', 'ETQ-F4-005', 30], ['e6', 'ETQ-F4-006', 30],
    ['e7', 'ETQ-F4-007', 30], ['e8', 'ETQ-F4-008', 30], ['e9', 'ETQ-F4-009', 30],
  ] as const;
  for (const [id, codigo, cantidad] of etiquetas) {
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, codigo, 'Huevos - Grande', cantidad, 'EnBodega', 'Bodega Central', 'L-F4-01', 20]
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

async function estadoGuia(guiaId: string) {
  const list = await request(app).get('/api/logistica/guias');
  return list.body.find((g: any) => g.id === guiaId)?.estado;
}

function costo(cartones: number) { return cartones * 16000; }

describe('F4 — Cuadre en central: reconciliación, retornos con peso, merma con aprobación y liberación del camión', () => {
  it('Preparación: guía 100ct, 2 ventas (efectivo + crédito), devolución y fin de día', async () => {
    const cam = await crearCamion('Camión Ruta F4-1');
    guiasRef.g1 = await crearGuia(cam.id, ['e1', 'e2', 'e3']); // 30+30+40 = 100
    expect(guiasRef.g1.totalCartones).toBe(100);

    const v1 = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g1.id, clienteId: 'c1', etiquetaId: 'e1', producto: 'Huevos - Grande', cartones: 30, cobro: 'Efectivo' });
    expect(v1.status).toBe(201);
    expect(v1.body.tiqueteConsecutivo).toBe('TQ-0001');

    const v2 = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g1.id, clienteId: 'c2', etiquetaId: 'e2', producto: 'Huevos - Grande', cartones: 30, cobro: 'Credito' });
    expect(v2.status).toBe(201);
    expect(v2.body.tiqueteConsecutivo).toBe('TQ-0002');

    const dev = await request(app).post('/api/logistica/caja/devolucion')
      .send({ guiaId: guiasRef.g1.id, etiquetaId: v2.body.etiquetaId, ventaRutaId: v2.body.ventaId, responsable: 'Vendedor' });
    expect(dev.status).toBe(201);

    const fd = await request(app).post('/api/logistica/caja/fin-dia')
      .send({ guiaId: guiasRef.g1.id, responsable: 'Vendedor' });
    expect(fd.status).toBe(200);
    expect(fd.body.estado).toBe('CajaCerrada');
    expect(fd.body.cuadre.mermaPreliminar).toBe(0);
    expect(fd.body.cuadre.tiquetesEmitidos).toBe(1);
  });

  it('Preview del cuadre: cuadre doble (cartones y dinero) sin mutación', async () => {
    const res = await request(app).get(`/api/logistica/cuadre-central?guiaId=${guiasRef.g1.id}`);
    expect(res.status).toBe(200);
    const c = res.body.cuadre;
    expect(res.body.requiereAprobacion).toBe(false);
    expect(c.cargado).toBe(100);
    expect(c.vendidos).toBe(30);
    expect(c.retornados).toBe(30);
    expect(c.cartonesReingresar).toBe(70); // e2 retornada 30 + e3 cargada 40
    expect(c.restanteCamion).toBe(70);
    expect(c.merma).toBe(0);
    expect(c.descuadreFisico).toBe(0);
    expect(c.efectivo).toBe(costo(30));
    expect(c.credito).toBe(0); // la venta de crédito fue anulada con la devolución
    expect(c.totalGenerado).toBe(costo(30));
    expect(c.detalleRetornos).toHaveLength(1);
    expect(c.etiquetasReingresar.map((e: any) => e.etiquetaId).sort()).toEqual(['e2', 'e3']);
  });

  it('Cuadre exacto: cierra la guía, reingresa etiquetas e inventario, retornos Recibidos, camión liberado', async () => {
    const res = await request(app).post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g1.id, responsable: 'Despachador', pesoLlegada: 28.5 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('Cerrada');
    expect(res.body.retornosRecibidos).toBe(1);
    expect(res.body.etiquetasReingresadas).toBe(2);
    expect(res.body.desperdicios).toHaveLength(0);
    expect(res.body.aprobacion).toBeNull();

    const etiquetas = await request(app).get('/api/etiquetas');
    const porEstado = (id: string) => ({ estado: etiquetas.body.find((e: any) => e.id === id)?.estado, loc: etiquetas.body.find((e: any) => e.id === id)?.ubicacionActual });
    expect(porEstado('e1').estado).toBe('Entregada');
    expect(porEstado('e2')).toMatchObject({ estado: 'EnBodega', loc: 'Bodega Central' });
    expect(porEstado('e3')).toMatchObject({ estado: 'EnBodega', loc: 'Bodega Central' });

    const g1 = await request(app).get(`/api/logistica/guias/${guiasRef.g1.id}`);
    expect(g1.status).toBe(200);

    // Retorno Recibido con peso de llegada
    const ret = await client.execute({ sql: `SELECT estado, peso FROM retornos_camion WHERE guia_id = ?`, args: [guiasRef.g1.id] });
    expect(ret.rows[0].estado).toBe('Recibido');
    expect(ret.rows[0].peso).toBe(28.5);

    // Inventario: camión 0, bodega 300 - 100 + 70 = 270
    const inv = await request(app).get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta F4-1');
    const bodega = inv.body.find((i: any) => i.ubicacion === 'Bodega Central');
    expect(camion.cantidad).toBe(0);
    expect(bodega.cantidad).toBe(270);

    const desc = await request(app).get('/api/desperdicios');
    expect(desc.body.length).toBe(0);

    // Camión liberado: nueva guía permitida
    const nuevaGuia = await request(app).post('/api/logistica/guias')
      .send({ camionId: (await request(app).get('/api/logistica/camiones')).body.find((c: any) => c.nombre === 'Camión Ruta F4-1').id, rutaId: 'r1', etiquetasIds: ['e7'], responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expect(nuevaGuia.status).toBe(201);
  });

  it('Cuadre sin fin de día → 409 (el vendedor debe cerrar la caja primero)', async () => {
    const cam = await crearCamion('Camión Ruta F4-2');
    guiasRef.g2 = await crearGuia(cam.id, ['e4']);
    const prev = await request(app).get(`/api/logistica/cuadre-central?guiaId=${guiasRef.g2.id}`);
    expect(prev.status).toBe(409);
    const res = await request(app).post('/api/logistica/cuadre-central').send({ guiaId: guiasRef.g2.id, responsable: 'Despachador' });
    expect(res.status).toBe(409);
  });

  it('Merma excesiva: CerradaConDiferencia + aprobación + bloqueo, y se libera al aprobar', async () => {
    // Vender completo la guía de 30 y simular 30ct de merma (cargado 60)
    const cam = (await request(app).get('/api/logistica/camiones')).body.find((c: any) => c.nombre === 'Camión Ruta F4-2');
    const v = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g2.id, clienteId: 'c1', etiquetaId: 'e4', producto: 'Huevos - Grande', cartones: 30, cobro: 'Efectivo' });
    expect(v.status).toBe(201);
    expect(v.body.tiqueteConsecutivo).toBe('TQ-5002'); // rango disjunto del 2º camión

    await client.execute({ sql: `UPDATE guias_despacho SET total_cartones = 60 WHERE id = ?`, args: [guiasRef.g2.id] });
    const fd = await request(app).post('/api/logistica/caja/fin-dia').send({ guiaId: guiasRef.g2.id, responsable: 'Vendedor' });
    expect(fd.body.cuadre.mermaPreliminar).toBe(30);

    const res = await request(app).post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g2.id, responsable: 'Despachador', mermaMotivo: 'Quebrado Camión' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CerradaConDiferencia');
    expect(res.body.aprobacion.tipo).toBe('MermaDescuadre');
    expect(res.body.aprobacion.estado).toBe('Pendiente');
    expect(res.body.desperdicios).toEqual([{ producto: 'Huevos - Grande', cantidad: 30, motivo: 'Quebrado Camión', impactoFinanciero: 480000 }]);
    expect(res.body.cuadre.merma).toBe(30);

    // Bloqueo del siguiente despacho mientras no se apruebe
    const bloqueada = await request(app).post('/api/logistica/guias')
      .send({ camionId: cam.id, rutaId: 'r1', etiquetasIds: ['e8'], responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expectApi(bloqueada, 409, 'Despacho bloqueado por guía activa');
    expect(bloqueada.body.error).toContain('ya tiene una guía activa');

    // Solicitud en aprobaciones
    const aps = await request(app).get('/api/aprobaciones');
    const ap = aps.body.find((a: any) => a.id === res.body.aprobacion.id);
    expect(ap.state || ap.estado).toBe('Pendiente');
    expect(JSON.parse(ap.datos).cuadre.merma).toBe(30);

    // Aprobación → guía Cerrada → camión liberado
    const apr = await request(app).put(`/api/aprobaciones/${ap.id}`).send({ estado: 'Aprobado', aprobadoPor: '1' });
    expect(apr.status).toBe(200);
    expect(await estadoGuia(guiasRef.g2.id)).toBe('Cerrada');

    const libre = await request(app).post('/api/logistica/guias')
      .send({ camionId: cam.id, rutaId: 'r1', etiquetasIds: ['e8'], responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expect(libre.status).toBe(201);
  });

  it('Merma dentro de la tolerancia (param): cierra normal y registra el desperdicio', async () => {
    const cam = await crearCamion('Camión Ruta F4-3');
    guiasRef.g3 = await crearGuia(cam.id, ['e5']);
    const v = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g3.id, clienteId: 'c1', etiquetaId: 'e5', producto: 'Huevos - Grande', cartones: 30, cobro: 'Efectivo' });
    expect(v.status).toBe(201);

    // Cargado 32 → merma 2ct (6.25% < 10% tolerancia enviada)
    await client.execute({ sql: `UPDATE guias_despacho SET total_cartones = 32 WHERE id = ?`, args: [guiasRef.g3.id] });
    await request(app).post('/api/logistica/caja/fin-dia').send({ guiaId: guiasRef.g3.id, responsable: 'Vendedor' });

    const res = await request(app).post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g3.id, responsable: 'Despachador', mermaMotivo: 'Quebrado Camión', toleranciaMerma: 0.10 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('Cerrada');
    expect(res.body.aprobacion).toBeNull();
    expect(res.body.desperdicios).toEqual([{ producto: 'Huevos - Grande', cantidad: 2, motivo: 'Quebrado Camión', impactoFinanciero: 32000 }]);

    const desc = await request(app).get('/api/desperdicios');
    expect(desc.body.some((d: any) => d.cantidad === 2 && d.estado === undefined || d.cantidad === 2)).toBe(true);
  });

  it('Descuadre físico (stock en camión ≠ reingresos) → CerradaConDiferencia + AjusteInventario', async () => {
    const cam = await crearCamion('Camión Ruta F4-4');
    guiasRef.g4 = await crearGuia(cam.id, ['e6']);
    const v = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g4.id, clienteId: 'c1', etiquetaId: 'e6', producto: 'Huevos - Grande', cartones: 30, cobro: 'Efectivo' });
    expect(v.status).toBe(201);

    // Stock fantasma de 10ct en el camión (robado/dañado sin registrar): reingreso 0 vs restante 10
    await client.execute({ sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['ghost', 'Huevos - Grande', 10, 'cartones', 'Camión Ruta F4-4', new Date().toISOString()] });
    await request(app).post('/api/logistica/caja/fin-dia').send({ guiaId: guiasRef.g4.id, responsable: 'Vendedor' });

    const res = await request(app).post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g4.id, responsable: 'Despachador' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CerradaConDiferencia');
    expect(res.body.aprobacion.tipo).toBe('AjusteInventario');
    expect(res.body.cuadre.descuadreFisico).toBe(10);
    expect(await estadoGuia(guiasRef.g4.id)).toBe('CerradaConDiferencia');
  });

  it('Venta parcial: la etiqueta queda Cargada con el restante y el cuadre la reingresa sin descuadre', async () => {
    const cam = await crearCamion('Camión Ruta F4-5');
    guiasRef.g5 = await crearGuia(cam.id, ['e9']); // 30
    const v = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g5.id, clienteId: 'c1', etiquetaId: 'e9', producto: 'Huevos - Grande', cartones: 10, cobro: 'Efectivo' });
    expect(v.status).toBe(201);

    const etiquetas = await request(app).get('/api/etiquetas');
    const e9 = etiquetas.body.find((e: any) => e.id === 'e9');
    expect(e9.estado).toBe('Cargada');
    expect(e9.cantidad).toBe(20); // restante del galerón

    await request(app).post('/api/logistica/caja/fin-dia').send({ guiaId: guiasRef.g5.id, responsable: 'Vendedor' });

    const prev = await request(app).get(`/api/logistica/cuadre-central?guiaId=${guiasRef.g5.id}`);
    expect(prev.body.requiereAprobacion).toBe(false);
    expect(prev.body.cuadre.cartonesReingresar).toBe(20);
    expect(prev.body.cuadre.restanteCamion).toBe(20);
    expect(prev.body.cuadre.merma).toBe(0);
    expect(prev.body.cuadre.descuadreFisico).toBe(0);

    const res = await request(app).post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g5.id, responsable: 'Despachador' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('Cerrada');
    expect(res.body.cuadre.vendidos).toBe(10);
    expect(res.body.cuadre.cartonesReingresar).toBe(20);

    const et2 = await request(app).get('/api/etiquetas');
    const e9b = et2.body.find((e: any) => e.id === 'e9');
    expect(e9b.estado).toBe('EnBodega');
    expect(e9b.ubicacionActual).toBe('Bodega Central');
    expect(e9b.cantidad).toBe(20);
  });
});