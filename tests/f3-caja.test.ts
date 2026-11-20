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
const authRequest = () => requestAs(app, 'admin-f3');
let client: any;
const DB_PATH = path.resolve(process.cwd(), '.test-f3.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `CREATE TRIGGER pesar_etiquetas_insert AFTER INSERT ON etiquetas BEGIN UPDATE etiquetas SET peso_neto = NEW.cantidad, peso_origen = 'Manual', peso_registrado_por = 'admin-f3', peso_registrado_en = datetime('now') WHERE id = NEW.id; END` });

  // Seed
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Despachador', 'despacho@test.com', 'Despachador'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['3', 'Vendedor', 'vendedor@test.com', 'Vendedor'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['2', 'Bodeguero', 'bodeguero@test.com', 'Bodeguero'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['admin-f3', 'Admin', 'admin-f3@test.com', 'Admin'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['admin-f3-2', 'Admin Dos', 'admin-f3-2@test.com', 'Admin'] });
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
    sql: `INSERT INTO rutas (id, nombre, cliente_ids, vendedor_asignado, centroide_lat, centroide_lng, capacidad_max_cartones, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['r1', 'Ruta 1', JSON.stringify(['c1', 'c2', 'c3']), '3', 10.1, -84.1, 500, 'Activa']
  });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['i1', 'Huevos - Grande', 200, 'kg', 'Bodega Central', new Date().toISOString()]
  });
  for (const [id, codigo, cantidad] of [['e1', 'ETQ-F3-001', 30], ['e2', 'ETQ-F3-002', 40], ['e3', 'ETQ-F3-003', 50]] as const) {
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, codigo, 'Huevos - Grande', cantidad, 'EnBodega', 'Bodega Central', 'L-F3-01', 20]
    });
  }
  await client.execute({
    sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['p1', 'Huevos - Grande', '', 'kg', 16000, 'Huevos', 'Activo', new Date().toISOString()]
  });
  await client.execute({
    sql: `INSERT INTO listas_precios (id, nombre, tipo, estado, fecha_inicio) VALUES (?, ?, ?, ?, ?)`,
    args: ['lp-global', 'Lista General Test', 'Global', 'Activa', '2026-01-01']
  });
  await client.execute({
    sql: `INSERT INTO precios_detalle (id, lista_id, producto, precio_unitario, precio_minimo, precio_maximo, descuento_maximo, unidad) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['pd-grande', 'lp-global', 'Huevos - Grande', 16000, 15000, 17000, 0, 'kg']
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
    const cam = await authRequest().post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta 5', placa: 'CR-555', ruta_defecto: 'Ruta 1', capacidad_cartones: 150 });
    expect(cam.status).toBe(201);
    await client.execute({ sql: 'UPDATE camiones SET camionero_id = ? WHERE id = ?', args: ['3', cam.body.id] });

    const gu = await authRequest().post('/api/logistica/guias')
      .send({
        camionId: cam.body.id,
        rutaId: 'r1',
        etiquetasIds: ['e1', 'e2', 'e3'], // 30 + 40 + 50 = 120
        responsablesCarga: 'Bodeguero',
        responsableTransporte: 'Vendedor'
      });
    expect(gu.status, JSON.stringify(gu.body)).toBe(201);

    const list = await authRequest().get('/api/logistica/guias');
    guia = list.body[0];
    expect(guia.totalCartones).toBe(120);
    expect(guia.camionNombre).toBe('Camión Ruta 5');
    const compraCartones = await authRequest().post('/api/gastos').send({ categoria: 'Insumos', monto: 10000, descripcion: 'Compra demo de 100 cartones', insumo: { producto: 'Cartones huevo grande', tipo: 'Cartones', cantidad: 100, unidad: 'cartones', ubicacion: 'Bodega', productoHuevo: 'Huevos - Grande', kgPorUnidad: 1.8 } });
    expect(compraCartones.status).toBe(200);
    const insumosIniciales = await client.execute({ sql: `SELECT cantidad_actual FROM inventario_insumos WHERE producto = ?`, args: ['Cartones huevo grande'] });
    expect(Number(insumosIniciales.rows[0].cantidad_actual)).toBe(100);
    const ventaAntesDeConfirmar = await authRequest().post('/api/logistica/caja/venta').send({
      guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e1', producto: 'Huevos - Grande', cantidadKg: 1, precioUnitario: 16000, cobro: 'Efectivo',
    });
    expect(ventaAntesDeConfirmar.status).toBe(409);
    expect(ventaAntesDeConfirmar.body.error).toContain('confirmar primero la carga');
    const gastoAntesDeIniciar = await requestAs(app, '3').post('/api/gastos').send({ categoria: 'Diésel', monto: 2000, descripcion: 'No debe guardarse antes de salir', guiaId: guia.id });
    expect(gastoAntesDeIniciar.status).toBe(409);
    expect(gastoAntesDeIniciar.body.error).toMatch(/cuando ya inició su ruta/i);
    const inicio = await requestAs(app, '3').post(`/api/logistica/guias/${guia.id}/marcar-en-ruta`);
    expect(inicio.status).toBe(200);
  });

  it('Venta en caja: emite TQ-0001, descuenta el camión correcto y marca la etiqueta Entregada', async () => {
    const res = await authRequest().post('/api/logistica/caja/venta')
      .send({
        guiaId: guia.id,
        clienteId: 'c1',
        etiquetaId: 'e1',
        producto: 'Huevos - Grande',
        cantidadKg: 30,
        precioUnitario: 16000,
        cobro: 'Efectivo'
      });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteConsecutivo).toBe('TQ-0001');
    expect(res.body.total).toBe(480000);
    expect(res.body.etiquetaId).toBe('e1'); // la respuesta incluye etiquetaId para la devolución desde UI
    expect(res.body.resolucionPrecio).toMatchObject({
      precioObjetivo: 16000,
      precioAplicado: 16000,
      precioMinimo: 15000,
      precioMaximo: 17000,
      regla: expect.any(String)
    });
    const snapshot = await client.execute({ sql: `SELECT resolucion_precio_json FROM ventas_ruta_kg WHERE id = ?`, args: [res.body.ventaId] });
    expect(JSON.parse(String(snapshot.rows[0].resolucion_precio_json))).toMatchObject({ precioAplicado: 16000, precioMinimo: 15000, precioMaximo: 17000 });

    const inv = await authRequest().get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 5' && i.producto === 'Huevos - Grande');
    expect(camion.cantidad).toBe(90); // 120 - 30 vendidos
    const cartonSaldo = await client.execute({ sql: `SELECT cantidad_actual FROM inventario_insumos WHERE producto = ?`, args: ['Cartones huevo grande'] });
    expect(Number(cartonSaldo.rows[0].cantidad_actual)).toBeCloseTo(100 - 30 / 1.8, 3);

    const etiquetas = await authRequest().get('/api/etiquetas');
    const e1 = etiquetas.body.find((e: any) => e.id === 'e1');
    expect(e1.estado).toBe('Entregada');
    expect(e1.ubicacionActual).toBe('Camión Ruta 5');
  });

  it('La venta en ruta rechaza precio manipulado y descuento fuera de la regla', async () => {
    await client.execute({ sql: `UPDATE precios_detalle SET descuento_maximo = 5 WHERE id = ?`, args: ['pd-grande'] });
    const precioManipulado = await authRequest().post('/api/logistica/caja/venta').send({
      guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e3', producto: 'Huevos - Grande', cantidadKg: 1, precioUnitario: 500, cobro: 'Efectivo'
    });
    expect(precioManipulado.status).toBe(409);
    expect(precioManipulado.body.error).toContain('Precio fuera del rango autorizado');

    const descuentoExcesivo = await authRequest().post('/api/logistica/caja/venta').send({
      guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e3', producto: 'Huevos - Grande', cantidadKg: 1, precioUnitario: 16000, descuento: 1001, cobro: 'Efectivo'
    });
    expect(descuentoExcesivo.status).toBe(409);
    expect(descuentoExcesivo.body.error).toContain('Descuento fuera del rango autorizado');

    const porcentajeExcedido = await authRequest().post('/api/logistica/caja/venta').send({
      guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e3', producto: 'Huevos - Grande', cantidadKg: 1, precioUnitario: 17000, descuento: 900, cobro: 'Efectivo'
    });
    expect(porcentajeExcedido.status).toBe(409); // 5% de ₡17 000 = ₡850, aunque el piso permitiría ₡2 000
    expect(porcentajeExcedido.body.error).toContain('Máximo permitido: ₡850');
    const facturaConDescuentoExcedido = await authRequest().post('/api/ventas').set('x-user-id', '3').send({
      factura: { clienteId: 'c1', condicion_pago: 'Contado', estado: 'Pagada', descuento: 900 },
      detalles: [{ producto: 'Huevos - Grande', cantidad: 1, precio_unitario: 17000 }],
    });
    expect(facturaConDescuentoExcedido.status).toBe(409);
    expect(facturaConDescuentoExcedido.body.error).toContain('Máximo permitido: ₡850');
    await client.execute({ sql: `UPDATE precios_detalle SET descuento_maximo = 0 WHERE id = ?`, args: ['pd-grande'] });
  });

  it('La banda comercial permite negociar dentro del rango y bloquea por debajo o encima', async () => {
    const lookup = await authRequest().get('/api/precios/lookup?producto=Huevos%20-%20Grande&clienteId=c1');
    expect(lookup.status).toBe(200);
    expect(lookup.body).toMatchObject({ precio: 16000, precioMinimo: 15000, precioMaximo: 17000 });

    const porDebajo = await authRequest().post('/api/logistica/caja/venta').send({
      guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e3', producto: 'Huevos - Grande', cantidadKg: 1, precioUnitario: 14999, cobro: 'Efectivo'
    });
    expect(porDebajo.status).toBe(409);
    expect(porDebajo.body.error).toContain('rango autorizado');

    const porEncima = await authRequest().post('/api/logistica/caja/venta').send({
      guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e3', producto: 'Huevos - Grande', cantidadKg: 1, precioUnitario: 17001, cobro: 'Efectivo'
    });
    expect(porEncima.status).toBe(409);
    expect(porEncima.body.error).toContain('rango autorizado');

    const dentroDeBanda = await authRequest().post('/api/logistica/caja/venta').send({
      guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e2', producto: 'Huevos - Grande', cantidadKg: 9999, precioUnitario: 16500, cobro: 'Efectivo'
    });
    expect(dentroDeBanda.status).toBe(400);
    expect(dentroDeBanda.body.error).toContain('Stock insuficiente en Camión');
  });

  it('Tiquete consecutivo TQ-0002 con cobro crédito: aumenta saldo del cliente', async () => {
    const res = await authRequest().post('/api/logistica/caja/venta')
      .send({
        guiaId: guia.id,
        clienteId: 'c2',
        etiquetaId: 'e2',
        producto: 'Huevos - Grande',
        cantidadKg: 40,
        precioUnitario: 16000,
        cobro: 'Credito'
      });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteConsecutivo).toBe('TQ-0002');
    expect(res.body.fechaHora).toBeTruthy();
    v2 = res.body;

    const saldo = await authRequest().get('/api/clientes');
    const c2 = saldo.body.find((c: any) => c.id === 'c2');
    expect(c2.saldo_pendiente).toBe(640000);

    const inv = await authRequest().get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 5' && i.producto === 'Huevos - Grande');
    expect(camion.cantidad).toBe(50); // 90 - 40
  });

  it('Venta parcial desde una etiqueta con precio automático del catálogo → TQ-0003', async () => {
    const res = await authRequest().post('/api/logistica/caja/venta')
      .send({
        guiaId: guia.id,
        clienteId: 'c1',
        etiquetaId: 'e3',
        producto: 'Huevos - Grande',
        cantidadKg: 10, // precio autoconf (16000 del catálogo)
        cobro: 'Efectivo'
      });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteConsecutivo).toBe('TQ-0003');
    expect(res.body.total).toBe(160000);

    const inv = await authRequest().get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 5' && i.producto === 'Huevos - Grande');
    expect(camion.cantidad).toBe(40);
  });

  it('Venta sobre el saldo de etiqueta → error', async () => {
    const res = await authRequest().post('/api/logistica/caja/venta')
      .send({
        guiaId: guia.id,
        clienteId: 'c1',
        etiquetaId: 'e2',
        producto: 'Huevos - Grande',
        cantidadKg: 9999,
        precioUnitario: 16000,
        cobro: 'Efectivo'
      });
    expectApi(res, 400, 'Venta sobre saldo etiqueta no asignada');
    expect(res.body.error).toContain('Stock insuficiente en Camión');
  });

  it('Venta de guía inexistente → 400', async () => {
    const res = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: 'no-existe', producto: 'Huevos - Grande', cantidadKg: 1, cobro: 'Efectivo' });
    expect(res.status).toBe(400);
  });

  it('Devolución: mantiene saldo hasta aceptación de Bodega y emite NC de demostración al recibir', async () => {
    const res = await authRequest().post('/api/logistica/caja/devolucion')
      .send({ guiaId: guia.id, etiquetaId: 'e2', ventaRutaId: v2.ventaId, cantidadKg: 40, responsable: 'Vendedor' });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteAnulado).toBe('TQ-0002');
    const ticketAntesDeRecibir = await client.execute({ sql: `SELECT estado FROM ventas_ruta_kg WHERE id = ?`, args: [v2.ventaId] });
    expect(ticketAntesDeRecibir.rows[0].estado).toBe('Anulada');

    const saldoAntesDeRecibir = await authRequest().get('/api/clientes');
    expect(saldoAntesDeRecibir.body.find((c: any) => c.id === 'c2').saldo_pendiente).toBe(640000);
    const pendientes = await authRequest().get(`/api/logistica/retornos/pendientes?guiaId=${guia.id}`);
    expect(pendientes.body).toHaveLength(1);
    const aceptado = await requestAs(app, '2').post('/api/logistica/bodega/retorno/aceptar')
      .send({ retornoId: pendientes.body[0].id });
    expect(aceptado.status).toBe(200);
    expect(aceptado.body.estado).toBe('AceptadoBodega');
    const reintentoAceptacion = await requestAs(app, '2').post('/api/logistica/bodega/retorno/aceptar')
      .send({ retornoId: pendientes.body[0].id });
    expect(reintentoAceptacion.status).toBe(200);
    expect(reintentoAceptacion.body.idempotente).toBe(true);

    const inv = await authRequest().get('/api/inventario');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camión Ruta 5' && i.producto === 'Huevos - Grande');
    expect(camion.cantidad).toBe(40); // el retorno aceptado ya se transfirió a Bodega

    const etiquetas = await authRequest().get('/api/etiquetas');
    const e2 = etiquetas.body.find((e: any) => e.id === 'e2');
    expect(e2.estado).toBe('EnBodega');
    const ticketTrasAceptar = await client.execute({ sql: `SELECT estado FROM ventas_ruta_kg WHERE id = ?`, args: [v2.ventaId] });
    expect(ticketTrasAceptar.rows[0].estado).toBe('Anulada');

    const saldo = await authRequest().get('/api/clientes');
    const c2 = saldo.body.find((c: any) => c.id === 'c2');
    expect(c2.saldo_pendiente).toBe(0);
    const docs = await authRequest().get('/api/facturacion/documentos');
    expect(docs.body.filter((doc: any) => doc.tipoDocumento === 'NotaCredito' && doc.notasCreditoId === v2.facturaId && doc.total === 640000)).toHaveLength(1);
  });

  it('Venta a crédito que excede el límite → rechazada', async () => {
    const res = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guia.id, clienteId: 'c3', etiquetaId: 'e3', producto: 'Huevos - Grande', cantidadKg: 1, precioUnitario: 16000, cobro: 'Credito' });
    expectApi(res, 409, 'Crédito excedido');
    expect(res.body.error).toContain('crédito disponible');
  });

  it('Tablero: estados/horas, cartones, $, retornos, merma y sin saltos de secuencia', async () => {
    const res = await authRequest().get('/api/logistica/tablero');
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
    expect(linea.restanteCamion).toBe(40);
    expect(linea.mermaPreliminar).toBe(0); // el residuo no se infiere como merma
    expect(linea.avance).toBe(33);
    // Sin huecos: TQ-0002 existe (anulado registrado)
    expect(linea.saltosSecuencia.length).toBe(0);
    expect(linea.clientesAtendidos.length).toBe(2); // c1 (2 tiquetes) + c2 no atendido (anulado)
    expect(linea.clientesAtendidos[0].hora).toBeTruthy();
  });

  it('Venta sin identidad se rechaza; un Comercial autenticado vende desde su camión asignado', async () => {
    // Etiqueta extra EnBodega para un 2º camión
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['e4', 'ETQ-F3-004', 'Huevos - Grande', 20, 'EnBodega', 'Bodega Central', 'L-F3-01', 15]
    });
    const cam = await authRequest().post('/api/logistica/camiones')
      .send({ nombre: 'Camión Ruta F3-2', capacidad_cartones: 150 });
    expect(cam.status).toBe(201);
    await client.execute({ sql: 'UPDATE camiones SET camionero_id = ? WHERE id = ?', args: ['3', cam.body.id] });
    const gu = await authRequest().post('/api/logistica/guias')
      .send({ camionId: cam.body.id, etiquetasIds: ['e4'], responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expect(gu.status).toBe(201);

    // Recuperar la guía creada (el POST no devuelve id; se busca por camión)
    const activas = await authRequest().get('/api/logistica/guias-activas');
    const guia2 = activas.body.find((x: any) => x.camionId === cam.body.id);
    expect(guia2).toBeTruthy();
    const inicio = await requestAs(app, '3').post(`/api/logistica/guias/${guia2.id}/marcar-en-ruta`);
    expect(inicio.status).toBe(200);

    // La identidad no se infiere desde el cuerpo ni se asigna como respaldo.
    const anonima = await request(app).post('/api/logistica/caja/venta')
      .send({ guiaId: guia2.id, clienteId: 'c1', etiquetaId: 'e4', producto: 'Huevos - Grande', cantidadKg: 20, precioUnitario: 16000, cobro: 'Efectivo' });
    expect(anonima.status).toBe(401);
    const ven = await requestAs(app, '3').post('/api/logistica/caja/venta')
      .send({ guiaId: guia2.id, clienteId: 'c1', etiquetaId: 'e4', producto: 'Huevos - Grande', cantidadKg: 20, precioUnitario: 16000, cobro: 'Efectivo' });
    expect(ven.status).toBe(201);
    expect(ven.body.tiqueteConsecutivo).toBe('TQ-5002'); // rango disjunto del 2º camión

    const row = await client.execute({ sql: `SELECT vendedor_id FROM ventas_ruta_kg WHERE tiquete_consecutivo = ?`, args: ['TQ-5002'] });
    expect(row.rows[0].vendedor_id).toBe('3');
  });

  it('Fin de día: devuelve cuadre provisional y bloquea nuevas ventas', async () => {
    const gasto = await authRequest().post('/api/gastos').set('x-user-id', '3').send({
      fecha: '2026-11-05', categoria: 'Diesel', monto: 40000, descripcion: 'Combustible de la ruta',
      guiaId: guia.id, medioPago: 'Efectivo',
    });
    expect(gasto.status).toBe(200);
    const res = await authRequest().post('/api/logistica/caja/fin-dia')
      .send({ guiaId: guia.id, responsable: 'Vendedor', efectivoContado: 600000 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CajaCerrada');
    expect(res.body.cuadre.tiquetesEmitidos).toBe(2);
    expect(res.body.cuadre.tiquetesAnulados).toBe(1);
    expect(res.body.cuadre.cartonesVendidos).toBe(40);
    expect(res.body.cuadre.cartonesRetornados).toBe(40);
    expect(res.body.cuadre.mermaPreliminar).toBe(0);
    expect(res.body.cuadre.totalEfectivo).toBe(640000);
    expect(res.body.cuadre.caja).toMatchObject({ efectivoEsperado: 600000, gastosEfectivo: 40000, efectivoContado: 600000, diferencia: 0, estado: 'Cuadrada' });

    // Ventas bloqueadas
    const venta = await authRequest().post('/api/logistica/caja/venta')
      .send({ guiaId: guia.id, clienteId: 'c1', etiquetaId: 'e3', producto: 'Huevos - Grande', cantidadKg: 1, precioUnitario: 16000, cobro: 'Efectivo' });
    expect(venta.status).toBe(409);
  });

  it('un vendedor no puede asociar un gasto a una guía asignada a otro vendedor', async () => {
    await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['vendedor-ajeno', 'Vendedor ajeno', 'ajeno@test.com', 'Vendedor'] });
    await client.execute({ sql: `INSERT INTO camiones (id, nombre, capacidad_cartones, camionero_id) VALUES (?, ?, ?, ?)`, args: ['camion-ajeno', 'Camión ajeno', 100, 'vendedor-ajeno'] });
    await client.execute({ sql: `INSERT INTO guias_despacho (id, consecutivo, camion_id, fecha, estado) VALUES (?, ?, ?, ?, ?)`, args: ['guia-ajena', 'GD-AJENA-001', 'camion-ajeno', '2026-11-19', 'EnRuta'] });
    const gasto = await requestAs(app, '3').post('/api/gastos').send({
      categoria: 'Diésel', monto: 5000, descripcion: 'Intento de gasto en ruta ajena', guiaId: 'guia-ajena', medioPago: 'Efectivo',
    });
    expect(gasto.status).toBe(403);
    expect(gasto.body.error).toMatch(/guía activa asignada a usted/i);
  });

  it('Diferencia de efectivo: se registra y solicita aprobación administrativa', async () => {
    await client.execute({
      sql: `INSERT INTO etiquetas (id, codigo_unico, producto, cantidad, estado, ubicacion_actual, lote, peso_bodega) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['e5', 'ETQ-F3-005', 'Huevos - Grande', 10, 'EnBodega', 'Bodega Central', 'L-F3-01', 5]
    });
    const cam = await authRequest().post('/api/logistica/camiones').send({ nombre: 'Camión Caja Diferencia', capacidad_cartones: 50, camioneroId: '3' });
    const creada = await authRequest().post('/api/logistica/guias').send({ camionId: cam.body.id, etiquetasIds: ['e5'], responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expect(creada.status).toBe(201);
    const activas = await authRequest().get('/api/logistica/guias-activas');
    const guiaDiferencia = activas.body.find((g: any) => g.camionId === cam.body.id);
    const inicio = await requestAs(app, '3').post(`/api/logistica/guias/${guiaDiferencia.id}/marcar-en-ruta`);
    expect(inicio.status).toBe(200);
    const transferencia = await authRequest().post('/api/logistica/caja/venta').set('x-user-id', '3').send({
      guiaId: guiaDiferencia.id, clienteId: 'c1', etiquetaId: 'e5', producto: 'Huevos - Grande', cantidadKg: 2, cobro: 'Transferencia',
    });
    expect(transferencia.status).toBe(201);
    const res = await authRequest().post('/api/logistica/caja/fin-dia').set('x-user-id', '3')
      .send({ guiaId: guiaDiferencia.id, responsable: 'Vendedor', efectivoContado: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.cuadre.totalTransferencia).toBe(32000);
    expect(res.body.cuadre.caja).toMatchObject({ efectivoEsperado: 0, efectivoContado: 1000, diferencia: 1000, estado: 'DiferenciaPendiente' });
    const aprobacion = await client.execute({ sql: `SELECT id, tipo, estado FROM aprobaciones WHERE referencia_id = ? AND tipo = 'DiferenciaCaja'`, args: [guiaDiferencia.id] });
    expect(aprobacion.rows).toHaveLength(1);
    expect(aprobacion.rows[0]).toMatchObject({ tipo: 'DiferenciaCaja', estado: 'Pendiente' });
    const resuelta = await authRequest().put(`/api/aprobaciones/${aprobacion.rows[0].id}`).set('x-user-id', 'admin-f3').send({ estado: 'Aprobado' });
    expect(resuelta.status).toBe(200);
    const cierre = await client.execute({ sql: `SELECT estado FROM cierres_caja_ruta WHERE guia_id = ?`, args: [guiaDiferencia.id] });
    expect(cierre.rows[0].estado).toBe('Aprobada');
    const cierreRow = await client.execute({ sql: `SELECT id FROM cierres_caja_ruta WHERE guia_id = ?`, args: [guiaDiferencia.id] });
    const deposito = await authRequest().post('/api/finanzas/depositos').set('x-user-id', 'admin-f3').send({ cierreId: cierreRow.rows[0].id, montoDepositado: 900, referencia: 'DEP-778', comprobante: 'https://demo.local/dep-778', idempotencyKey: 'dep-778' });
    expect(deposito.status).toBe(201);
    expect(deposito.body.deposito).toMatchObject({ montoEsperado: 1000, montoDepositado: 900, estado: 'DiferenciaPendiente', referencia: 'DEP-778' });
    const aprobacionDeposito = await client.execute({ sql: `SELECT id FROM aprobaciones WHERE tipo = 'DiferenciaDeposito' AND referencia_id = ?`, args: [guiaDiferencia.id] });
    const autoAprobacion = await authRequest().put(`/api/aprobaciones/${aprobacionDeposito.rows[0].id}`).set('x-user-id', 'admin-f3').send({ estado: 'Aprobado' });
    expect(autoAprobacion.status).toBe(403);
    const aprobada = await authRequest().put(`/api/aprobaciones/${aprobacionDeposito.rows[0].id}`).set('x-user-id', 'admin-f3-2').send({ estado: 'Aprobado' });
    expect(aprobada.status).toBe(200);
    const depositoActual = await client.execute({ sql: `SELECT estado FROM depositos_caja WHERE cierre_id = ?`, args: [cierreRow.rows[0].id] });
    expect(depositoActual.rows[0].estado).toBe('Conciliado');
  });

  it('calibra el factor de cartones con kg vendidos y conteo físico observado', async () => {
    const item = await client.execute({ sql: `SELECT id FROM inventario_insumos WHERE producto = ? LIMIT 1`, args: ['Cartones huevo grande'] });
    const calibracion = await authRequest().post(`/api/inventario-insumos/${item.rows[0].id}/calibrar`).send({ kgHuevo: 90, cartonesUsados: 50, observacion: 'Conteo físico semanal' });
    expect(calibracion.status).toBe(200);
    expect(calibracion.body.kgPorUnidad).toBe(1.8);
    const movimiento = await client.execute({ sql: `SELECT tipo FROM movimientos_insumos WHERE insumo_id = ? AND tipo = ?`, args: [item.rows[0].id, 'Calibración real'] });
    expect(movimiento.rows).toHaveLength(1);
  });

  it('permite al administrador ingresar insumos manualmente y registra el movimiento', async () => {
    const ingreso = await authRequest().post('/api/inventario-insumos').send({ producto: 'Alimento postura', categoria: 'Alimento', cantidad: 12, unidad: 'sacos', ubicacion: 'Bodega' });
    expect(ingreso.status).toBe(201);
    const saldo = await client.execute({ sql: `SELECT cantidad_actual FROM inventario_insumos WHERE id = ?`, args: [ingreso.body.id] });
    expect(Number(saldo.rows[0].cantidad_actual)).toBe(12);
    const movimiento = await client.execute({ sql: `SELECT tipo FROM movimientos_insumos WHERE insumo_id = ?`, args: [ingreso.body.id] });
    expect(movimiento.rows[0].tipo).toBe('IngresoManual');
  });
});
