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
let client: ReturnType<typeof abrirClienteDePrueba>;
const DB_PATH = path.resolve(process.cwd(), '.test-operaciones-cargas.db');

const CAMPONAMENTO_ID = 'cam-001';
const OTRO_CAMIONERO_ID = 'cam-002';
const ENCARGADO_ID = 'desp-001';
const BODEGUERO_ID = 'bodega-001';
const GRANJA_CARGA_ID = 'granja-carga-1';
const GALERON_CARGA_ID = 'galeron-carga-1';
const CAMION_SIN_ASIGNAR = 'camion-sin-asignar';

let camionAsignadoId = '';
let granjaId = '';
let galeronId = '';

async function crearStock(producto: string, cantidad: number) {
  const res = await requestAs(app, '1')
    .post('/api/produccion/recoleccion')
    .send({
      galeron: 'Galerón Cargas',
      detalles: [{ producto, cantidad }]
    });
  expect(res.status).toBe(200);
}

async function crearTraslado(cargaId: string, producto: string, cantidad: number, opts: { camionId?: string | null } = {}) {
  const body: any = {
    granjaId,
    producto,
    cantidad,
    unidad: 'cartones',
    responsable: 'Encargado de Galerón',
    cargaId,
    creadoPorId: ENCARGADO_ID
  };
  if (opts.camionId !== undefined) body.camionId = opts.camionId;
  const res = await requestAs(app, '1').post('/api/operaciones/traslado').send(body);
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  await client.execute({ sql: 'INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)', args: [CAMPONAMENTO_ID, 'Camionero Uno', 'cam1@demo.test', 'Camionero'] });
  await client.execute({ sql: 'INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)', args: [OTRO_CAMIONERO_ID, 'Camionero Dos', 'cam2@demo.test', 'Camionero'] });
  await client.execute({ sql: 'INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)', args: [ENCARGADO_ID, 'Encargado', 'desp@demo.test', 'Despachador'] });
  await client.execute({ sql: 'INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)', args: [BODEGUERO_ID, 'Bodeguero', 'bodega@demo.test', 'Bodeguero'] });
  const testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);

  // Granja + galerón vía wizard
  const wiz = await requestAs(app, '1').post('/api/granjas/wizard').send({
    nombre: 'Granja Cargas',
    ubicacion: 'Heredia',
    tipo_produccion: 'Postura',
    encargadoId: ENCARGADO_ID,
    galerones: [{ nombre: 'Galerón Cargas', capacidad_maxima: 1000 }]
  });
  expect(wiz.status).toBe(201);

  const granjas = (await requestAs(app, '1').get('/api/granjas')).body;
  granjaId = granjas.find((g: any) => g.nombre === 'Granja Cargas').id;
  const galerones = (await requestAs(app, '1').get('/api/galerones')).body;
  galeronId = galerones.find((g: any) => g.granjaId === granjaId && g.nombre === 'Galerón Cargas').id;
  expect(granjaId).toBeTruthy();
  expect(galeronId).toBeTruthy();

  // Camión asignado al camionero CAMPONAMENTO_ID
  const cam = await requestAs(app, '1').post('/api/logistica/camiones').send({
    nombre: 'Camión Asignado',
    placa: 'C-001',
    camionero_id: CAMPONAMENTO_ID,
    capacidad_cartones: 500,
    estado: 'Activo'
  });
  expect(cam.status).toBe(201);
  camionAsignadoId = cam.body.id;

  // Stock en Granja para los traslados
  await crearStock('Huevos - Grande', 500);
  await crearStock('Huevos - Mediano', 300);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — Cargas de encargado de galerón visibles para el camionero', () => {
  it('reintentar producción y traslado no duplica inventario; un contenido distinto se rechaza', async () => {
    const cargaId = crypto.randomUUID();
    const stockGranjaAntes = (await requestAs(app, '1').get('/api/inventario')).body
      .filter((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja')
      .reduce((total: number, i: any) => total + Number(i.cantidad), 0);

    const recoleccion = {
      galeron: 'Galerón Cargas', galeronId, granjaId, cargaId,
      detalles: [{ producto: 'Huevos - Grande', cantidad: 20 }]
    };
    expect((await requestAs(app, '1').post('/api/produccion/recoleccion').send(recoleccion)).status).toBe(200);
    const recoleccionReintentada = await requestAs(app, '1').post('/api/produccion/recoleccion').send(recoleccion);
    expect(recoleccionReintentada.status).toBe(200);
    expect(recoleccionReintentada.body.duplicada).toBe(true);

    const recoleccionModificada = await requestAs(app, '1').post('/api/produccion/recoleccion').send({
      ...recoleccion, detalles: [{ producto: 'Huevos - Grande', cantidad: 21 }]
    });
    expect(recoleccionModificada.status).toBe(409);

    const traslado = {
      granjaId, producto: 'Huevos - Grande', cantidad: 20, unidad: 'cartones',
      responsable: 'Encargado de Galerón', cargaId, creadoPorId: ENCARGADO_ID,
    };
    expect((await requestAs(app, '1').post('/api/operaciones/traslado').send(traslado)).status).toBe(200);
    const trasladoReintentado = await requestAs(app, '1').post('/api/operaciones/traslado').send(traslado);
    expect(trasladoReintentado.status).toBe(200);
    expect(trasladoReintentado.body.duplicada).toBe(true);

    const trasladoModificado = await requestAs(app, '1').post('/api/operaciones/traslado').send({ ...traslado, cantidad: 19 });
    expect(trasladoModificado.status).toBe(409);

    const stockGranjaDespues = (await requestAs(app, '1').get('/api/inventario')).body
      .filter((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja')
      .reduce((total: number, i: any) => total + Number(i.cantidad), 0);
    expect(stockGranjaDespues).toBe(stockGranjaAntes);
    expect((await requestAs(app, '1').get('/api/operaciones/traslados')).body.filter((t: any) => t.cargaId === cargaId)).toHaveLength(1);
  });

  it('carga con camión asignado al camionero aparece', async () => {
    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Grande', 100, { camionId: camionAsignadoId });

    const res = await requestAs(app, CAMPONAMENTO_ID).get(`/api/operaciones/cargas?camioneroId=${CAMPONAMENTO_ID}`);
    expect(res.status).toBe(200);
    const carga = res.body.find((c: any) => c.cargaId === cargaId);
    expect(carga).toBeDefined();
    expect(carga.estado).toBe('Pendiente');
    expect(carga.items).toHaveLength(1);
  });

  it('una carga SIN camión (o con un id inexistente) no se libera a ningún camionero', async () => {
    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Grande', 100, { camionId: null });
    await crearTraslado(cargaId, 'Huevos - Mediano', 50, { camionId: null });

    // Y el caso real de producción: camión id que ya no existe en la tabla camiones
    const cargaId2 = crypto.randomUUID();
    await crearTraslado(cargaId2, 'Huevos - Grande', 25, { camionId: 'camion-borrado-o-inexistente' });

    const res = await requestAs(app, CAMPONAMENTO_ID).get(`/api/operaciones/cargas?camioneroId=${CAMPONAMENTO_ID}`);
    expect(res.status).toBe(200);

    expect(res.body.find((c: any) => c.cargaId === cargaId)).toBeUndefined();

    const carga2 = res.body.find((c: any) => c.cargaId === cargaId2);
    expect(carga2).toBeUndefined();
  });

  it('no pierde la asignación: carga en camión de otro camionero no sale para este', async () => {
    const cam = await requestAs(app, '1').post('/api/logistica/camiones').send({
      nombre: 'Camión Otro',
      placa: 'C-002',
      camionero_id: OTRO_CAMIONERO_ID,
      capacidad_cartones: 500,
      estado: 'Activo'
    });
    expect(cam.status).toBe(201);

    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Grande', 30, { camionId: cam.body.id });

    const mios = (await requestAs(app, CAMPONAMENTO_ID).get(`/api/operaciones/cargas?camioneroId=${CAMPONAMENTO_ID}`)).body;
    expect(mios.find((c: any) => c.cargaId === cargaId)).toBeUndefined();

    const otros = (await requestAs(app, OTRO_CAMIONERO_ID).get(`/api/operaciones/cargas?camioneroId=${OTRO_CAMIONERO_ID}`)).body;
    expect(otros.find((c: any) => c.cargaId === cargaId)).toBeDefined();
  });

  it('el camionero no puede confirmar una carga sin asignación a su camión', async () => {
    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Grande', 40, { camionId: null });

    const res = await requestAs(app, CAMPONAMENTO_ID)
      .post(`/api/operaciones/carga/${cargaId}/confirmar`)
      .send({ camioneroId: CAMPONAMENTO_ID });
    expect(res.status).toBe(403);

    const traslados = (await requestAs(app, '1').get('/api/operaciones/traslados')).body;
    const pendiente = traslados.find((t: any) => t.cargaId === cargaId);
    expect(pendiente.estado).toBe('Pendiente');
  });

  it('Admin corrige un traslado histórico a kg y Bodega recibe sin perder el original', async () => {
    const cargaId = crypto.randomUUID();
    const trasladoCreado = await requestAs(app, '1').post('/api/operaciones/traslado').send({
      granjaId, producto: 'Huevos - Grande', cantidad: 12, unidad: 'cartones',
      responsable: 'Encargado de Galerón', cargaId, creadoPorId: ENCARGADO_ID,
    });
    expect(trasladoCreado.status).toBe(200);
    const trasladoId = trasladoCreado.body.trasladoId;

    const noAdmin = await requestAs(app, BODEGUERO_ID)
      .post(`/api/operaciones/traslados/${trasladoId}/corregir-peso-kg`)
      .send({ pesoKg: 51.25, motivo: 'Pesaje de prueba báscula patio' });
    expect(noAdmin.status).toBe(403);

    const corregido = await requestAs(app, '1')
      .post(`/api/operaciones/traslados/${trasladoId}/corregir-peso-kg`)
      .send({ pesoKg: 51.25, motivo: 'Pesaje de prueba báscula patio' });
    expect(corregido.status).toBe(201);
    expect(corregido.body.original).toEqual({ cantidad: 12, unidad: 'cartones' });
    expect(corregido.body.corregido).toEqual({ cantidad: 51.25, unidad: 'kg' });
    expect(corregido.body.inventarioAjustado).toBe(false);

    const corregidoDoble = await requestAs(app, '1')
      .post(`/api/operaciones/traslados/${trasladoId}/corregir-peso-kg`)
      .send({ pesoKg: 52, motivo: 'Segundo pesaje de prueba' });
    expect(corregidoDoble.status).toBe(409);

    const kardex = await requestAs(app, '1').get('/api/inventario/movimientos');
    expect(kardex.status).toBe(200);
    const movimiento = kardex.body.find((m: any) => m.referencia_id === trasladoId && m.tipo === 'Traslado');
    expect(movimiento).toMatchObject({ cantidad: 51.25, unidad: 'kg', cantidadOriginal: 12, unidadOriginal: 'cartones', pesoKgCorregido: true });
    expect(kardex.body.some((m: any) => m.tipo === 'Corrección Unidad Traslado' && m.referencia_id === trasladoId)).toBe(false);

    const recepcion = await requestAs(app, BODEGUERO_ID).post('/api/operaciones/recepcion').send({
      trasladoId, cantidadKgEsperada: 51.25, cantidadKgRecibida: 51.25,
      producto: 'Huevos - Grande', responsableRecepcion: 'Bodeguero de prueba',
    });
    expect(recepcion.status).toBe(200);
    const bodega = (await requestAs(app, '1').get('/api/inventario')).body
      .find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central');
    expect(bodega).toMatchObject({ cantidad: 51.25, unidad: 'kg' });

    const recepcionReintentada = await requestAs(app, BODEGUERO_ID).post('/api/operaciones/recepcion').send({
      trasladoId, cantidadKgEsperada: 51.25, cantidadKgRecibida: 51.25,
      producto: 'Huevos - Grande', responsableRecepcion: 'Bodeguero de prueba',
    });
    expect(recepcionReintentada.status).toBe(200);
    expect(recepcionReintentada.body.duplicada).toBe(true);
    const bodegaDespuesReintento = (await requestAs(app, '1').get('/api/inventario')).body
      .find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central');
    expect(bodegaDespuesReintento.cantidad).toBe(51.25);
  });

  it('registra recepción de 0 kg con motivo sin sumar inventario ni generar etiquetas recibidas', async () => {
    const cargaId = crypto.randomUUID();
    const trasladoCreado = await requestAs(app, '1').post('/api/operaciones/traslado').send({
      granjaId, producto: 'Huevos - Mediano', cantidad: 10, unidad: 'cartones',
      responsable: 'Encargado de Galerón', cargaId, creadoPorId: ENCARGADO_ID,
    });
    expect(trasladoCreado.status).toBe(200);
    const trasladoId = trasladoCreado.body.trasladoId;
    expect((await requestAs(app, '1').post(`/api/operaciones/traslados/${trasladoId}/corregir-peso-kg`)
      .send({ pesoKg: 50, motivo: 'Pesaje verificado de la carga' })).status).toBe(201);

    const before = (await requestAs(app, '1').get('/api/inventario')).body
      .filter((i: any) => i.producto === 'Huevos - Mediano' && i.ubicacion === 'Bodega Central')
      .reduce((sum: number, i: any) => sum + Number(i.cantidad), 0);
    const recepcion = await requestAs(app, BODEGUERO_ID).post('/api/operaciones/recepcion').send({
      trasladoId, cantidadKgEsperada: 50, cantidadKgRecibida: 0,
      motivoDiferencia: 'No aparece producto; requiere investigación',
      producto: 'Huevos - Mediano', responsableRecepcion: 'Bodeguero de prueba',
    });
    expect(recepcion.status).toBe(200);
    expect(recepcion.body.tipoDiferencia).toBe('alerta');

    const after = (await requestAs(app, '1').get('/api/inventario')).body
      .filter((i: any) => i.producto === 'Huevos - Mediano' && i.ubicacion === 'Bodega Central')
      .reduce((sum: number, i: any) => sum + Number(i.cantidad), 0);
    expect(after).toBe(before);
    const recepciones = (await requestAs(app, '1').get('/api/operaciones/recepciones')).body;
    expect(recepciones.find((r: any) => r.trasladoId === trasladoId)).toMatchObject({ cantidadKgEsperada: 50, cantidadKgRecibida: 0, diferenciaKg: 50 });
    const movimientos = (await requestAs(app, '1').get('/api/inventario/movimientos')).body;
    expect(movimientos.some((m: any) => m.tipo === 'Recepción Bodega' && m.referencia_id === recepcion.body.recepcionId)).toBe(false);
    expect(movimientos.some((m: any) => m.tipo === 'Pérdida en Tránsito' && m.referencia_id === recepcion.body.recepcionId && Number(m.cantidad) === 50)).toBe(true);
  });

  it('solo Admin concilia a kg un saldo histórico después del conteo físico y deja auditoría', async () => {
    const producto = 'Huevos - Conciliación Demo';
    await crearStock(producto, 24);
    const saldoAntes = (await requestAs(app, '1').get('/api/inventario')).body
      .find((i: any) => i.producto === producto && i.ubicacion === 'Granja');
    expect(saldoAntes).toBeDefined();
    expect(saldoAntes.unidad).not.toBe('kg');

    const sinPermiso = await requestAs(app, BODEGUERO_ID).post('/api/operaciones/inventario/granja/conciliar-kg').send({
      inventarioId: saldoAntes.id, cantidadKg: 18.75, motivo: 'Pesaje documentado de prueba'
    });
    expect(sinPermiso.status).toBe(403);

    const conciliacion = await requestAs(app, '1').post('/api/operaciones/inventario/granja/conciliar-kg').send({
      inventarioId: saldoAntes.id, cantidadKg: 18.75, motivo: 'Báscula granja demo, referencia PES-204'
    });
    expect(conciliacion.status).toBe(200);
    expect(conciliacion.body.antes).toMatchObject({ cantidad: 24, unidad: saldoAntes.unidad });
    expect(conciliacion.body.despues).toMatchObject({ cantidad: 18.75, unidad: 'kg' });

    const saldoDespues = (await requestAs(app, '1').get('/api/inventario')).body.find((i: any) => i.id === saldoAntes.id);
    expect(saldoDespues).toMatchObject({ cantidad: 18.75, unidad: 'kg', ubicacion: 'Granja' });
    const ajuste = (await requestAs(app, '1').get('/api/inventario/movimientos')).body
      .find((m: any) => m.referencia_id === saldoAntes.id && m.tipo === 'Ajuste Conteo Físico');
    expect(ajuste).toMatchObject({ cantidad: 18.75, unidad: 'kg', destino: 'Granja' });

    const auditoria = await client.execute({ sql: 'SELECT valores_antes, valores_despues, motivo FROM auditoria WHERE referencia_id = ? AND modulo = ?', args: [saldoAntes.id, 'InventarioGranja'] });
    expect(auditoria.rows).toHaveLength(1);
    expect(JSON.parse(String(auditoria.rows[0].valores_antes))).toMatchObject({ cantidad: 24, unidad: saldoAntes.unidad });
    expect(JSON.parse(String(auditoria.rows[0].valores_despues))).toMatchObject({ cantidad: 18.75, unidad: 'kg' });
    expect(auditoria.rows[0].motivo).toBe('Báscula granja demo, referencia PES-204');
  });
});
