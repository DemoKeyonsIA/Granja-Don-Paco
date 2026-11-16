import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { requestAs } from './helpers/request-as';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { expectApi } from './helpers/http';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
const authRequest = () => requestAs(app, '1');
let client: any;
let guiasRef: any = {};
const DB_PATH = path.resolve(process.cwd(), '.test-f4.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `CREATE TRIGGER pesar_etiquetas_insert AFTER INSERT ON etiquetas BEGIN UPDATE etiquetas SET peso_neto = NEW.cantidad, peso_origen = 'Manual', peso_registrado_por = '1', peso_registrado_en = datetime('now') WHERE id = NEW.id; END` });

  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@test.com', 'Admin'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['3', 'Vendedor', 'vendedor@test.com', 'Vendedor'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['2', 'Bodeguero', 'bodeguero@test.com', 'Bodeguero'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['4', 'Segundo administrador', 'admin2@test.com', 'Admin'] });
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
    args: ['i1', 'Huevos - Grande', 300, 'kg', 'Bodega Central', new Date().toISOString()]
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
    sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['e10', 'ETQ-F4-010', 'Huevos - Grande', 30, 'EnBodega', 'Bodega Central', 'L-F4-01', 20]
  });
  await client.execute({
    sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, kg_por_carton, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['p1', 'Huevos - Grande', '', 'kg', 1.9, 16000, 'Huevos', 'Activo', new Date().toISOString()]
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

async function crearGuia(camionId: string, etiquetas: string[]) {
  const gu = await authRequest().post('/api/logistica/guias')
    .send({ camionId, rutaId: 'r1', etiquetasIds: etiquetas, responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
  expect(gu.status).toBe(201);
  const list = await authRequest().get('/api/logistica/guias');
  return list.body.find((g: any) => g.camionId === camionId);
}

async function estadoGuia(guiaId: string) {
  const list = await authRequest().get('/api/logistica/guias');
  return list.body.find((g: any) => g.id === guiaId)?.estado;
}

function costo(cantidadKg: number) { return cantidadKg * 16000; }

describe('F4 — Cuadre en central: reconciliación, retornos con peso, merma con aprobación y liberación del camión', () => {
  it('el preview requiere acceso de Bodega y el cierre requiere aprobación administrativa', async () => {
    const vistaAnonima = await request(app).get('/api/logistica/cuadre-central').query({ guiaId: 'inexistente' });
    expect(vistaAnonima.status).toBe(401);
    const cierreAnonimo = await request(app).post('/api/logistica/cuadre-central').send({ guiaId: 'inexistente' });
    expect(cierreAnonimo.status).toBe(401);
    const cierreVendedor = await authRequest().post('/api/logistica/cuadre-central').set('x-user-id', '3').send({ guiaId: 'inexistente' });
    expect(cierreVendedor.status).toBe(403);
    const aprobacionVendedor = await authRequest().put('/api/aprobaciones/no-existe').set('x-user-id', '3').send({ estado: 'Aprobado' });
    expect(aprobacionVendedor.status).toBe(403);
    const aprobacionesAnonimas = await request(app).get('/api/aprobaciones');
    expect(aprobacionesAnonimas.status).toBe(401);
  });

  it('Preparación: guía 100ct, 2 ventas (efectivo + crédito), devolución y fin de día', async () => {
    const cam = await crearCamion('Camión Ruta F4-1');
    guiasRef.g1 = await crearGuia(cam.id, ['e1', 'e2', 'e3']); // 30+30+40 = 100
    expect(guiasRef.g1.totalCartones).toBe(100);

    const v1 = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g1.id, clienteId: 'c1', etiquetaId: 'e1', producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Efectivo' });
    expect(v1.status).toBe(201);
    expect(v1.body.tiqueteConsecutivo).toBe('TQ-0001');

    const v2 = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g1.id, clienteId: 'c2', etiquetaId: 'e2', producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Credito' });
    expect(v2.status).toBe(201);
    expect(v2.body.tiqueteConsecutivo).toBe('TQ-0002');

    const dev = await authRequest().post('/api/logistica/caja/devolucion')
      .send({ guiaId: guiasRef.g1.id, etiquetaId: v2.body.etiquetaId, ventaRutaId: v2.body.ventaId, responsable: 'Administrador' });
    expect(dev.status).toBe(201);

    const fd = await authRequest().post('/api/logistica/caja/fin-dia')
      .send({ guiaId: guiasRef.g1.id, responsable: 'Administrador' });
    expect(fd.status).toBe(200);
    expect(fd.body.estado).toBe('CajaCerrada');
    expect(fd.body.cuadre.mermaPreliminar).toBe(0);
    expect(fd.body.cuadre.tiquetesEmitidos).toBe(1);
  });

  it('Preview del cuadre: cuadre doble (cartones y dinero) con retorno pendiente de Bodega', async () => {
    const res = await authRequest().get(`/api/logistica/cuadre-central?guiaId=${guiasRef.g1.id}`).set('x-user-id', '1');
    expect(res.status).toBe(200);
    const c = res.body.cuadre;
    expect(res.body.requiereAprobacion).toBe(true);
    expect(c.cargado).toBe(100);
    expect(c.vendidos).toBe(30);
    expect(c.retornados).toBe(30);
    expect(c.retornoPendiente).toBe(30);
    expect(c.tieneRetornosPendientes).toBe(true);
    expect(res.body.puedeCuadrar).toBe(false);
    expect(c.cartonesReingresar).toBe(70); // e2 retornada 30 + e3 cargada 40
    expect(c.restanteCamion).toBe(70);
    expect(c.merma).toBe(0);
    expect(c.efectivo).toBe(costo(30));
    expect(c.credito).toBe(0); // la venta de crédito fue anulada con la devolución
    expect(c.totalGenerado).toBe(costo(30));
    expect(c.detalleRetornos).toHaveLength(1);
    expect(c.etiquetasReingresar.map((e: any) => e.etiquetaId).sort()).toEqual(['e2', 'e3']);

    const cierreBloqueado = await authRequest().post('/api/logistica/cuadre-central').set('x-user-id', '1')
      .send({ guiaId: guiasRef.g1.id, responsable: 'Despachador' });
    expect(cierreBloqueado.status).toBe(409);
    expect(cierreBloqueado.body.error).toContain('aceptación física');
    const sinMutacion = await client.execute({ sql: `SELECT estado, cantidad_aceptada FROM retornos_camion WHERE guia_id = ?`, args: [guiasRef.g1.id] });
    expect(sinMutacion.rows[0].estado).toBe('PendienteBodega');
    expect(Number(sinMutacion.rows[0].cantidad_aceptada)).toBe(0);
  });

  it('Cuadre exacto: cierra la guía, reingresa etiquetas e inventario, retornos aceptados por Bodega, camión liberado', async () => {
    // Obtener retornos pendientes
    const pendientes = await authRequest().get(`/api/logistica/retornos/pendientes?guiaId=${guiasRef.g1.id}`);
    const list = Array.isArray(pendientes.body) ? pendientes.body : (pendientes.body?.retornos || pendientes.body?.data || []);
    const retId = list?.[0]?.id;
    const vendedorSinPermiso = await authRequest().post('/api/logistica/bodega/retorno/aceptar').set('x-user-id', '3')
      .send({ retornoId: retId, responsable: 'Administrador' });
    expect(vendedorSinPermiso.status).toBe(403);
    const aceptacion = await authRequest().post('/api/logistica/bodega/retorno/aceptar')
      .set('x-user-id', '2').send({ retornoId: retId, responsable: 'Bodeguero', peso: 28.5 });
    expect(aceptacion.status).toBe(200);
    const aceptadoPor = await client.execute({ sql: `SELECT aceptado_por FROM retornos_camion WHERE id = ?`, args: [retId] });
    expect(aceptadoPor.rows[0].aceptado_por).toBe('2');
    const trazaRetorno = await client.execute({ sql: `SELECT tipo_evento, usuario_id FROM traza_etiqueta WHERE etiqueta_id = ? AND tipo_evento = 'RetornoAceptadoBodega'`, args: ['e2'] });
    expect(trazaRetorno.rows[0]).toMatchObject({ tipo_evento: 'RetornoAceptadoBodega', usuario_id: '2' });
    const sobranteRecibido = await authRequest().post('/api/logistica/bodega/retorno/aceptar-sobrante').set('x-user-id', '2')
      .send({ guiaId: guiasRef.g1.id, responsable: 'Bodeguero', conteoPorProducto: [{ producto: 'Huevos - Grande', cantidad: 40 }] });
    expect(sobranteRecibido.status).toBe(200);
    expect(sobranteRecibido.body.totalAceptado).toBe(40);
    const res = await authRequest().post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g1.id, responsable: 'Despachador', pesoLlegada: 28.5 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('Cerrada');
    expect(res.body.retornosRecibidos).toBe(2); // devolución de cliente + sobrante físico
    expect(res.body.etiquetasReingresadas).toBe(0); // Bodega las recibió antes de solicitar el cuadre
    expect(res.body.desperdicios).toHaveLength(0);
    expect(res.body.aprobacion).toBeNull();

    const etiquetas = await authRequest().get('/api/etiquetas');
    const porEstado = (id: string) => ({ estado: etiquetas.body.find((e: any) => e.id === id)?.estado, loc: etiquetas.body.find((e: any) => e.id === id)?.ubicacionActual });
    expect(porEstado('e1').estado).toBe('Entregada');
    expect(porEstado('e2')).toMatchObject({ estado: 'EnBodega', loc: 'Bodega Central' });
    expect(porEstado('e3')).toMatchObject({ estado: 'EnBodega', loc: 'Bodega Central' });

    const g1 = await authRequest().get(`/api/logistica/guias/${guiasRef.g1.id}`);
    expect(g1.status).toBe(200);

    // Retorno aceptado por Bodega en el mismo cuadre
    const ret = await client.execute({ sql: `SELECT estado, peso FROM retornos_camion WHERE guia_id = ?`, args: [guiasRef.g1.id] });
    expect(ret.rows[0].estado).toBe('AceptadoBodega');
    expect(Number(ret.rows[0].peso)).toBeCloseTo(28.5);

    // Inventario: camión 0, bodega 300 - 100 + 70 = 270
    const inv = await authRequest().get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta F4-1');
    const bodega = inv.body.find((i: any) => i.ubicacion === 'Bodega Central');
    expect(camion.cantidad).toBe(0);
    expect(bodega.cantidad).toBe(270);

    const desc = await authRequest().get('/api/desperdicios');
    expect(desc.body.length).toBe(0);

    // Camión liberado: nueva guía permitida
    const nuevaGuia = await authRequest().post('/api/logistica/guias')
      .send({ camionId: (await authRequest().get('/api/logistica/camiones')).body.find((c: any) => c.nombre === 'Camión Ruta F4-1').id, rutaId: 'r1', etiquetasIds: ['e7'], responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expect(nuevaGuia.status).toBe(201);
  });

  it('Cuadre sin fin de día → 409 (el vendedor debe cerrar la caja primero)', async () => {
    const cam = await crearCamion('Camión Ruta F4-2');
    await client.execute({ sql: 'UPDATE camiones SET camionero_id = ? WHERE id = ?', args: ['3', cam.id] });
    guiasRef.g2 = await crearGuia(cam.id, ['e4', 'e5']);
    const prev = await authRequest().get(`/api/logistica/cuadre-central?guiaId=${guiasRef.g2.id}`).set('x-user-id', '1');
    expect(prev.status).toBe(409);
    const res = await authRequest().post('/api/logistica/cuadre-central').set('x-user-id', '1').send({ guiaId: guiasRef.g2.id, responsable: 'Despachador' });
    expect(res.status).toBe(409);
  });

  it('Merma excesiva: CerradaConDiferencia + aprobación + bloqueo, y se libera al aprobar', async () => {
    // Vender completo la guía de 30
    const cam = (await authRequest().get('/api/logistica/camiones')).body.find((c: any) => c.nombre === 'Camión Ruta F4-2');
    const guias = await authRequest().get('/api/logistica/guias');
    const g2 = guias.body.find((g: any) => g.id === guiasRef.g2.id);
    const etiquetas = await authRequest().get('/api/etiquetas');
    const etq = (Array.isArray(g2?.etiquetasIds) && g2.etiquetasIds[0]) || etiquetas.body?.find((e: any) => e?.estado === 'Cargada' && e?.ubicacionActual === 'Camión Ruta F4-2')?.id || 'e4';
    const v = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g2.id, clienteId: 'c1', etiquetaId: etq, producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Efectivo' });
    expect(v.status).toBe(201);
    expect(v.body.tiqueteConsecutivo).toBe('TQ-5002');
    const merma = await authRequest().post('/api/logistica/merma').send({ guiaId: guiasRef.g2.id, etiquetaId: 'e5', cantidad: 30, unidad: 'kg', motivo: 'Quebrado Camión', responsable: 'Administrador' });
    expect(merma.status).toBe(201);
    const fd = await authRequest().post('/api/logistica/caja/fin-dia').send({ guiaId: guiasRef.g2.id, responsable: 'Administrador' });
    expect(fd.body.cuadre.mermaPreliminar).toBe(30);

    const res = await authRequest().post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g2.id, responsable: 'Despachador', mermaMotivo: 'Quebrado Camión' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CerradaConDiferencia');
    expect(res.body.aprobacion?.tipo).toBe('MermaDescuadre');
    expect(res.body.aprobacion.estado).toBe('Pendiente');
    expect(res.body.desperdicios).toEqual([{ producto: 'Huevos - Grande', cantidad: 30, motivo: 'Quebrado Camión', impactoFinanciero: 0 }]);
    expect(res.body.cuadre.merma).toBe(30);

    // Bloqueo del siguiente despacho mientras no se apruebe
    const bloqueada = await authRequest().post('/api/logistica/guias')
      .send({ camionId: cam.id, rutaId: 'r1', etiquetasIds: ['e8'], responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expectApi(bloqueada, 409, 'Despacho bloqueado por guía activa');
    expect(bloqueada.body.error).toContain('ya tiene una guía activa');

    // Solicitud en aprobaciones
    const aps = await authRequest().get('/api/aprobaciones').set('x-user-id', '1');
    const ap = aps.body.find((a: any) => a.id === res.body.aprobacion.id);
    expect(ap.state || ap.estado).toBe('Pendiente');
    expect(JSON.parse(ap.datos).cuadre.merma).toBe(30);

    // Aprobación → guía Cerrada → camión liberado
    const apr = await authRequest().put(`/api/aprobaciones/${ap.id}`).set('x-user-id', '1').send({ estado: 'Aprobado', aprobadoPor: 'falso' });
    expect(apr.status).toBe(200);
    expect(apr.body.aprobadoPor).toBe('1');
    expect(await estadoGuia(guiasRef.g2.id)).toBe('Cerrada');

    const libre = await authRequest().post('/api/logistica/guias')
      .send({ camionId: cam.id, rutaId: 'r1', etiquetasIds: ['e8'], responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expect(libre.status).toBe(201);
  });

  it('Merma dentro de la tolerancia (param): cierra normal y registra el desperdicio', async () => {
    const cam = await crearCamion('Camión Ruta F4-3');
    await client.execute({ sql: 'UPDATE camiones SET camionero_id = ? WHERE id = ?', args: ['3', cam.id] });
    guiasRef.g3 = await crearGuia(cam.id, ['e6']);
    const v = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g3.id, clienteId: 'c1', etiquetaId: 'e6', producto: 'Huevos - Grande', cantidadKg: 26.2, cobro: 'Efectivo' });
    expect(v.status).toBe(201);

    const merma = await authRequest().post('/api/logistica/merma').send({ guiaId: guiasRef.g3.id, etiquetaId: 'e6', cantidad: 3.8, unidad: 'kg', motivo: 'Quebrado Camión', responsable: 'Administrador' });
    expect(merma.status).toBe(201);
    await authRequest().post('/api/logistica/caja/fin-dia').send({ guiaId: guiasRef.g3.id, responsable: 'Administrador' });

    const res = await authRequest().post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g3.id, responsable: 'Despachador', mermaMotivo: 'Quebrado Camión', toleranciaMerma: 0.10 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CerradaConDiferencia');
    expect(res.body.aprobacion?.tipo).toBe('MermaDescuadre');
    expect(res.body.cuadre.merma).toBe(3.8);

    const desc = await authRequest().get('/api/desperdicios');
    expect(desc.body.some((d: any) => d.cantidad === 3.8 && d.unidad === 'kg' )).toBe(true);
  });

  it('Descuadre físico (stock en camión ≠ reingresos) → CerradaConDiferencia + AjusteInventario', async () => {
    const cam = await crearCamion('Camión Ruta F4-4');
    guiasRef.g4 = await crearGuia(cam.id, ['e9']);
    const v = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g4.id, clienteId: 'c1', etiquetaId: 'e9', producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Efectivo' });
    expect(v.status).toBe(201);

    // Stock fantasma de 10ct en el camión (robado/dañado sin registrar): reingreso 0 vs restante 10
    await client.execute({ sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ['ghost', 'Huevos - Grande', 10, 'kg', 'Camión Ruta F4-4', new Date().toISOString()] });
    await authRequest().post('/api/logistica/caja/fin-dia').send({ guiaId: guiasRef.g4.id, responsable: 'Administrador' });

    const recibidoFantasma = await authRequest().post('/api/logistica/bodega/retorno/aceptar-sobrante').set('x-user-id', '2')
      .send({ guiaId: guiasRef.g4.id, responsable: 'Bodeguero', conteoPorProducto: [{ producto: 'Huevos - Grande', cantidad: 10 }] });
    expect(recibidoFantasma.status).toBe(200);
    expect(recibidoFantasma.body.totalAceptado).toBe(10);

    const res = await authRequest().post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g4.id, responsable: 'Despachador' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CerradaConDiferencia');
    expect(res.body.aprobacion.tipo).toBe('DiferenciaCuadre');
    expect(Math.abs(res.body.cuadre.saldoNoExplicado)).toBe(10);
    expect(await estadoGuia(guiasRef.g4.id)).toBe('CerradaConDiferencia');
    const aprobada = await authRequest().put(`/api/aprobaciones/${res.body.aprobacion.id}`).set('x-user-id', '1')
      .send({ estado: 'Aprobado', aprobadoPor: 'usuario-falso' });
    expect(aprobada.status).toBe(200);
    expect(aprobada.body.aprobadoPor).toBe('1');
    expect(await estadoGuia(guiasRef.g4.id)).toBe('Cerrada');
  });

  it('Venta parcial: Bodega confirma el sobrante antes del cierre y la etiqueta vuelve a Bodega', async () => {
    const cam = await crearCamion('Camión Ruta F4-5');
    await client.execute({ sql: 'UPDATE camiones SET camionero_id = ? WHERE id = ?', args: ['3', cam.id] });
    guiasRef.g5 = await crearGuia(cam.id, ['e10']); // 30
    const v = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guiasRef.g5.id, clienteId: 'c1', etiquetaId: 'e10', producto: 'Huevos - Grande', cantidadKg: 10, cobro: 'Efectivo' });
    expect(v.status).toBe(201);

    const etiquetas = await authRequest().get('/api/etiquetas');
    const e9 = etiquetas.body.find((e: any) => e.id === 'e10');
    expect(e9.estado).toBe('Cargada');
    expect(e9.saldoKg).toBe(20); // restante del galerón

    await authRequest().post('/api/logistica/caja/fin-dia').send({ guiaId: guiasRef.g5.id, responsable: 'Administrador' });

    const prev = await authRequest().get(`/api/logistica/cuadre-central?guiaId=${guiasRef.g5.id}`).set('x-user-id', '1');
    expect(prev.body.requiereAprobacion).toBe(false);
    expect(prev.body.cuadre.cartonesReingresar).toBe(20);
    expect(prev.body.cuadre.restanteCamion).toBe(20);
    expect(prev.body.cuadre.merma).toBe(0);
    expect(prev.body.cuadre.descuadreFisico).toBe(0);
    expect(prev.body.puedeCuadrar).toBe(false);

    const sobrante = await authRequest().post('/api/logistica/bodega/retorno/aceptar-sobrante').set('x-user-id', '2')
      .send({ guiaId: guiasRef.g5.id, responsable: 'Bodeguero', conteoPorProducto: [{ producto: 'Huevos - Grande', cantidad: 19, motivoDiferencia: 'Falta 1 kg en conteo' }] });
    expect(sobrante.status).toBe(409);
    expect(sobrante.body.diferenciaPendiente).toBe(true);
    const stockSinMover = await authRequest().get('/api/inventario');
    expect(stockSinMover.body.find((i: any) => i.ubicacion === 'Camión Ruta F4-5').cantidad).toBe(20);
    const diferenciasPendientes = await authRequest().get('/api/aprobaciones').set('x-user-id', '1');
    const diferenciaConteo = diferenciasPendientes.body.find((a: any) => a.tipo === 'DiferenciaConteoBodega' && a.referenciaId === guiasRef.g5.id && a.estado === 'Pendiente');
    expect(diferenciaConteo).toBeTruthy();
    const aprobarConteoSinPolitica = await authRequest().put(`/api/aprobaciones/${diferenciaConteo.id}`).set('x-user-id', '1').send({ estado: 'Aprobado' });
    expect(aprobarConteoSinPolitica.status).toBe(409);
    const mismoContador = await authRequest().post(`/api/logistica/bodega/reconteos/${diferenciaConteo.id}`).set('x-user-id', '2')
      .send({ responsable: 'Bodeguero', conteoPorProducto: [{ producto: 'Huevos - Grande', cantidad: 19 }] });
    expect(mismoContador.status).toBe(409);
    const reconteo = await authRequest().post(`/api/logistica/bodega/reconteos/${diferenciaConteo.id}`).set('x-user-id', '1')
      .send({ responsable: 'Administrador contador', conteoPorProducto: [{ producto: 'Huevos - Grande', cantidad: 19, motivoDiferencia: 'Conteo independiente confirma faltante' }] });
    expect(reconteo.status).toBe(200);
    expect(reconteo.body.requiereAprobacion).toBe(true);
    const aprobarPorContador = await authRequest().put(`/api/aprobaciones/${diferenciaConteo.id}`).set('x-user-id', '1').send({ estado: 'Aprobado' });
    expect(aprobarPorContador.status).toBe(403);
    const aprobarAjuste = await authRequest().put(`/api/aprobaciones/${diferenciaConteo.id}`).set('x-user-id', '4').send({ estado: 'Aprobado' });
    expect(aprobarAjuste.status).toBe(200);
    const inventarioTrasAjuste = await authRequest().get('/api/inventario');
    expect(inventarioTrasAjuste.body.find((i: any) => i.ubicacion === 'Camión Ruta F4-5').cantidad).toBe(0);
    expect(inventarioTrasAjuste.body.find((i: any) => i.ubicacion === 'Cuarentena Bodega').cantidad).toBe(19);
    const etiquetaNueva = await authRequest().post('/api/etiquetas/generar').send({ producto: 'Huevos - Grande', cantidad: 19, pesoNeto: 19, pesoOrigen: 'Manual', ubicacion: 'Planta de reempaque' });
    expect(etiquetaNueva.status).toBe(201);
    const vincularReempaque = await authRequest().post(`/api/logistica/bodega/cuarentena/${(await authRequest().get('/api/logistica/bodega/cuarentena').set('x-user-id', '4')).body.find((c: any) => c.aprobacionId === diferenciaConteo.id).id}/etiquetas-reemplazo`)
      .set('x-user-id', '4').send({ etiquetaIds: [etiquetaNueva.body.id], motivo: 'Reempaque por faltante confirmado y conteo verificado' });
    expect(vincularReempaque.status).toBe(200);
    expect(vincularReempaque.body.etiquetasNuevas[0].codigoUnico).toBe(etiquetaNueva.body.codigoUnico);
    const casoCuarentena = (await authRequest().get('/api/logistica/bodega/cuarentena').set('x-user-id', '4')).body.find((c: any) => c.aprobacionId === diferenciaConteo.id);
    const liberarReempaque = await authRequest().post(`/api/logistica/bodega/cuarentena/${casoCuarentena.id}/liberar`)
      .set('x-user-id', '4').send({ motivo: 'Etiquetas nuevas y cantidad física verificadas' });
    expect(liberarReempaque.status).toBe(200);
    expect(liberarReempaque.body.etiquetasLiberadas).toBe(1);

    const res = await authRequest().post('/api/logistica/cuadre-central')
      .set('x-user-id', '1')
      .send({ guiaId: guiasRef.g5.id, responsable: 'Despachador' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CerradaConDiferencia');
    expect(res.body.cuadre.vendidos).toBe(10);
    expect(res.body.cuadre.cartonesReingresar).toBe(0); // los 20 kg se segregaron en cuarentena antes del reempaque
    expect(res.body.cuadre.retornoAceptado).toBe(19);
    expect(res.body.cuadre.ajustesInventarioAprobados).toContainEqual({ producto: 'Huevos - Grande', unidad: 'kg', diferenciaFirmada: -1 });

    const et2 = await authRequest().get('/api/etiquetas');
    const e9b = et2.body.find((e: any) => e.id === 'e10');
    expect(e9b.estado).toBe('ReemplazadaReempaque');
    const etiquetaReempacada = et2.body.find((e: any) => e.id === etiquetaNueva.body.id);
    expect(etiquetaReempacada.estado).toBe('EnBodega');
    expect(etiquetaReempacada.ubicacionActual).toBe('Bodega Central');
    expect(e9b.saldoKg).toBe(20);
  });

  it('Merma en kg usa el factor guardado, descuenta stock y cierra con custodia en cero', async () => {
    await client.execute({ sql: `UPDATE inventario SET cantidad = cantidad + 30 WHERE ubicacion = 'Bodega Central' AND producto = 'Huevos - Grande'` });
    await client.execute({ sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['e11', 'ETQ-F4-011', 'Huevos - Grande', 30, 'EnBodega', 'Bodega Central', 'L-F4-01', 20] });
    const cam = await crearCamion('Camión Ruta F4-6');
    await client.execute({ sql: 'UPDATE camiones SET camionero_id = ? WHERE id = ?', args: ['3', cam.id] });
    const guia = await crearGuia(cam.id, ['e11']);
    const venta = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e11', producto: 'Huevos - Grande', cantidadKg: 26.2, cobro: 'Efectivo' });
    expect(venta.status).toBe(201);

    const merma = await authRequest().post('/api/logistica/merma').send({
      guiaId: guia.id, etiquetaId: 'e11', cantidad: 3.8, unidad: 'kg', motivo: 'Quebrado Camión', responsable: 'Administrador',
    });
    expect(merma.status).toBe(201);
    expect(merma.body).toMatchObject({ cantidad: 3.8, unidad: 'kg', etiquetaAgotada: true });
    const fin = await authRequest().post('/api/logistica/caja/fin-dia').send({ guiaId: guia.id, responsable: 'Administrador' });
    expect(fin.status).toBe(200);
    const preview = await authRequest().get(`/api/logistica/cuadre-central?guiaId=${guia.id}`).set('x-user-id', '1');
    expect(preview.body.cuadre).toMatchObject({ cargado: 30, vendidos: 26.2, merma: 3.8, restanteCamion: expect.closeTo(0, 8), saldoNoExplicado: 0 });

    const cerrar = await authRequest().post('/api/logistica/cuadre-central').set('x-user-id', '1')
      .send({ guiaId: guia.id, responsable: 'Despachador', toleranciaMerma: 0.1 });
    expect(cerrar.status).toBe(200);
    expect(cerrar.body.estado).toBe('CerradaConDiferencia');
    const etiqueta = (await authRequest().get('/api/etiquetas')).body.find((e: any) => e.id === 'e11');
    expect(etiqueta.estado).toBe('Mermada');
    const fila = (await client.execute({ sql: `SELECT cantidad, unidad, factor_kg_por_carton, cantidad_cartones FROM desperdicios WHERE id = ?`, args: [merma.body.id] })).rows[0] as any;
    expect(fila).toMatchObject({ cantidad: 3.8, unidad: 'kg', cantidad_cartones: null });
  });
});
