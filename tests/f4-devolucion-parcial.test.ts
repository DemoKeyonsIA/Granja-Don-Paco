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
const authRequest = () => requestAs(app, '1');
let client: any;
const DB_PATH = path.resolve(process.cwd(), '.test-f4-devolucion-parcial.db');

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `CREATE TRIGGER pesar_etiquetas_insert AFTER INSERT ON etiquetas BEGIN UPDATE etiquetas SET peso_neto = NEW.cantidad, peso_origen = 'Manual', peso_registrado_por = '1', peso_registrado_en = datetime('now') WHERE id = NEW.id; END` });

  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@test.com', 'Admin'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['3', 'Vendedor', 'vendedor@test.com', 'Vendedor'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['2', 'Bodeguero', 'bodeguero@test.com', 'Bodeguero'] });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, latitud, longitud, ruta, condicion_pago, estado, limite_credito, saldo_pendiente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['c1', 'Cliente A', 10.1, -84.1, 'R1', 'Contado', 'Activo', 0, 0]
  });
  await client.execute({
    sql: `INSERT INTO rutas (id, nombre, cliente_ids, centroide_lat, centroide_lng, capacidad_max_cartones, estado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['r1', 'Ruta 1', JSON.stringify(['c1']), 10.1, -84.1, 500, 'Activa']
  });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['i1', 'Huevos - Grande', 300, 'kg', 'Bodega Central', new Date().toISOString()]
  });
  for (const [id, codigo, cantidad] of [['e1', 'ETQ-DP-001', 30], ['e2', 'ETQ-DP-002', 30]] as const) {
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, codigo, 'Huevos - Grande', cantidad, 'EnBodega', 'Bodega Central', 'L-DP', 20]
    });
  }
  await client.execute({
    sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['p1', 'Huevos - Grande', '', 'kg', 16000, 'Huevos', 'Activo', new Date().toISOString()]
  });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

async function crearCamion(nombre: string) {
  const cam = await authRequest().post('/api/logistica/camiones').send({ nombre, placa: 'CR-000', ruta_defecto: 'Ruta 1', capacidad_cartones: 150 });
  expect(cam.status).toBe(201);
  return cam.body;
}

async function crearGuia(camionId: string, etiquetasIds: string[]) {
  const gu = await authRequest().post('/api/logistica/guias')
    .send({ camionId, rutaId: 'r1', etiquetasIds, responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
  expect(gu.status).toBe(201);
  const list = await authRequest().get('/api/logistica/guias');
  const guia = list.body.find((g: any) => g.camionId === camionId);
  const salida = await authRequest().post(`/api/logistica/guias/${guia.id}/marcar-en-ruta`);
  expect(salida.status).toBe(200);
  return guia;
}

describe('F4 — Devolución de venta parcial: restaura el galerón y NO crea descuadre falso', () => {
  it('Venta parcial + devolución del tiquete restaura la etiqueta a su cantidad íntegra y el cuadre cierra sin descuadre', async () => {
    const cam = await crearCamion('Camión Ruta DP-1');
    await client.execute({ sql: 'UPDATE camiones SET camionero_id = ? WHERE id = ?', args: ['3', cam.id] });
    const guia = await crearGuia(cam.id, ['e1']); // 30

    // Venta parcial: 10 de los 30 cartones del galerón
    const v = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e1', producto: 'Huevos - Grande', cantidadKg: 10, cobro: 'Efectivo' });
    expect(v.status).toBe(201);

    // La etiqueta quedó Cargada con el restante (20)
    let et = await authRequest().get('/api/etiquetas');
    let e1 = et.body.find((x: any) => x.id === 'e1');
    expect(e1.estado).toBe('Cargada');
    expect(e1.saldoKg).toBe(20);

    // Antes de la devolución, el camión tiene 20ct (30cargados - 10vendidos)
    let inv = await authRequest().get('/api/inventario');
    let camionInv = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta DP-1');
    expect(camionInv.cantidad).toBe(20);

    // Devolución del tiquete de 10: DEBE devolver 10 al camión (no el restante 20 del galerón)
    const dev = await authRequest().post('/api/logistica/caja/devolucion')
      .send({ guiaId: guia.id, etiquetaId: 'e1', ventaRutaId: v.body.ventaId, cantidadKg: 10, responsable: 'Vendedor' });
    expect(dev.status).toBe(201);
    expect(dev.body.cantidadKg).toBe(10);

    // La etiqueta vuelve a representar los 30 cartones bajo custodia del camión.
    et = await authRequest().get('/api/etiquetas');
    e1 = et.body.find((x: any) => x.id === 'e1');
    expect(e1.estado).toBe('Cargada');
    expect(e1.saldoKg).toBe(30);

    // Camión vuelve a 30 (20 + 10 devueltos) — sin doble conteo
    inv = await authRequest().get('/api/inventario');
    camionInv = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta DP-1');
    expect(camionInv.cantidad).toBe(30);

    // Bodega acepta los 10 cartones devueltos; el restante no vendido sigue en camión.
    const pendientes = await authRequest().get(`/api/logistica/retornos/pendientes?guiaId=${guia.id}`);
    const retornoId = pendientes.body[0].id;
    const aceptacionesSimultaneas = await Promise.all([
      authRequest().post('/api/logistica/bodega/retorno/aceptar').set('x-user-id', '2').send({ retornoId, responsable: 'Bodeguero' }),
      authRequest().post('/api/logistica/bodega/retorno/aceptar').set('x-user-id', '2').send({ retornoId, responsable: 'Bodeguero' }),
    ]);
    expect(aceptacionesSimultaneas.map(r => r.status)).toEqual([200, 200]);
    inv = await authRequest().get('/api/inventario');
    expect(inv.body.find((i: any) => i.ubicacion === 'Bodega Central').cantidad).toBe(280); // retorno de 10 kg recibido; 20 kg siguen bajo custodia del camión
    const aceptacionReintentada = await authRequest().post('/api/logistica/bodega/retorno/aceptar')
      .set('x-user-id', '2').send({ retornoId, cantidadAceptada: 10, responsable: 'Bodeguero' });
    expect(aceptacionReintentada.status).toBe(200);
    expect(aceptacionReintentada.body.idempotente).toBe(true);
    inv = await authRequest().get('/api/inventario');
    expect(inv.body.find((i: any) => i.ubicacion === 'Bodega Central').cantidad).toBe(280); // la repetición no duplica el ingreso

    // Fin de día y cuadre: sin merma, sin descuadre, SIN aprobación
    const fd = await authRequest().post('/api/logistica/caja/fin-dia').send({ guiaId: guia.id, responsable: 'Vendedor' });
    expect(fd.status).toBe(200);

    const prev = await authRequest().get(`/api/logistica/cuadre-central?guiaId=${guia.id}`).set('x-user-id', '1');
    expect(prev.status).toBe(200);
    expect(prev.body.requiereAprobacion).toBe(false);
    expect(prev.body.cuadre.retornados).toBe(10);
    expect(prev.body.cuadre.cartonesReingresar).toBe(20); // sobrante nunca vendido
    expect(prev.body.cuadre.restanteCamion).toBe(20);
    expect(prev.body.cuadre.merma).toBe(0);
    expect(prev.body.cuadre.descuadreFisico).toBe(0);
    expect(prev.body.puedeCuadrar).toBe(false);

    const sobrante = await authRequest().post('/api/logistica/bodega/retorno/aceptar-sobrante').set('x-user-id', '2')
      .send({ guiaId: guia.id, responsable: 'Bodeguero', conteoPorProducto: [{ producto: 'Huevos - Grande', cantidad: 20 }] });
    expect(sobrante.status).toBe(200);
    expect(sobrante.body.totalAceptado).toBe(20);

    const prevTrasAceptacion = await authRequest().get(`/api/logistica/cuadre-central?guiaId=${guia.id}`).set('x-user-id', '1');
    expect(prevTrasAceptacion.status).toBe(200);
    expect(prevTrasAceptacion.body.requiereAprobacion).toBe(false);
    expect(prevTrasAceptacion.body.cuadre.saldoNoExplicado).toBe(0);
    expect(prevTrasAceptacion.body.cuadre.saldoBajoCustodiaCamion).toBe(0);

    const res = await authRequest().post('/api/logistica/cuadre-central').set('x-user-id', '1')
      .set('x-user-id', '1')
      .send({ guiaId: guia.id, responsable: 'Despachador' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('Cerrada');
    expect(res.body.aprobacion).toBeNull();
    expect(res.body.etiquetasReingresadas).toBe(0); // Bodega ya confirmó esta etiqueta

    const etiquetas = await authRequest().get('/api/etiquetas');
    expect(etiquetas.body.find((x: any) => x.id === 'e1')).toMatchObject({ estado: 'EnBodega', ubicacionActual: 'Bodega Central', saldoKg: 20 });
  });

  it('Doble devolución sobre la misma etiqueta → 400 (no infla el stock del camión)', async () => {
    const cam = await crearCamion('Camión Ruta DP-2');
    await client.execute({ sql: 'UPDATE camiones SET camionero_id = ? WHERE id = ?', args: ['3', cam.id] });
    const guia = await crearGuia(cam.id, ['e2']); // 30
    const v = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e2', producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Efectivo' });
    expect(v.status).toBe(201);

    const dev1 = await authRequest().post('/api/logistica/caja/devolucion')
      .send({ guiaId: guia.id, etiquetaId: 'e2', ventaRutaId: v.body.ventaId, responsable: 'Vendedor' });
    expect(dev1.status).toBe(201);

    const retorno = (await authRequest().get(`/api/logistica/retornos/pendientes?guiaId=${guia.id}`)).body[0];
    const rechazado = await authRequest().post('/api/logistica/bodega/retorno/aceptar').set('x-user-id', '2')
      .send({ retornoId: retorno.id, rechazado: true, responsable: 'Bodeguero' });
    expect(rechazado.status).toBe(200);
    expect(rechazado.body.estado).toBe('RechazadoBodega');
    const reaceptado = await authRequest().post('/api/logistica/bodega/retorno/aceptar').set('x-user-id', '2')
      .send({ retornoId: retorno.id, cantidadAceptada: 30, responsable: 'Bodeguero' });
    expect(reaceptado.status).toBe(200);
    expect(reaceptado.body.estado).toBe('AceptadoBodega');
    const stockBodega = await authRequest().get('/api/inventario');
    expect(stockBodega.body.find((i: any) => i.ubicacion === 'Bodega Central').cantidad).toBe(300);
    const reaceptadoDuplicado = await authRequest().post('/api/logistica/bodega/retorno/aceptar').set('x-user-id', '2')
      .send({ retornoId: retorno.id, cantidadAceptada: 30, responsable: 'Bodeguero' });
    expect(reaceptadoDuplicado.status).toBe(200);
    expect(reaceptadoDuplicado.body.idempotente).toBe(true);
    expect((await authRequest().get('/api/inventario')).body.find((i: any) => i.ubicacion === 'Bodega Central').cantidad).toBe(300);

    const dev2 = await authRequest().post('/api/logistica/caja/devolucion')
      .send({ guiaId: guia.id, etiquetaId: 'e2', ventaRutaId: v.body.ventaId, responsable: 'Vendedor' });
    expect(dev2.status).toBe(400);

    // La devolución aceptada por Bodega sale del camión y entra una sola vez.
    const inv = await authRequest().get('/api/inventario');
    expect(inv.body.find((i: any) => i.ubicacion === 'Camión Ruta DP-2').cantidad).toBe(0);

    // La venta ya anulada no se puede devolver de nuevo
    const dev3 = await authRequest().post('/api/logistica/caja/devolucion')
      .send({ guiaId: guia.id, etiquetaId: 'e2', ventaRutaId: v.body.ventaId, responsable: 'Vendedor' });
    expect(dev3.status).toBe(400);
  });
});
