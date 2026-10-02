import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl } from './helpers/db';

let app: Express;
const DB_PATH = path.resolve(process.cwd(), '.test-cobertura-gaps.db');

const ENCARGADO_ID = 'gap-encargado';
const CAMIONERO_ID = 'gap-camionero';
const OTRO_CAMIONERO_ID = 'gap-camionero-2';

let granjaId = '';
let galeronId = '';

async function crearStock(producto: string, cantidad: number) {
  const res = await request(app)
    .post('/api/produccion/recoleccion')
    .send({ galeron: 'Galerón Gaps', detalles: [{ producto, cantidad }] });
  expect(res.status).toBe(200);
}

async function crearTraslado(cargaId: string, producto: string, cantidad: number, camionId: string | null) {
  const res = await request(app).post('/api/operaciones/traslado').send({
    granjaId,
    producto,
    cantidad,
    unidad: 'cartones',
    responsable: 'Encargado de Galerón',
    cargaId,
    creadoPorId: ENCARGADO_ID,
    camionId: camionId || null
  });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  const testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);

  const wiz = await request(app).post('/api/granjas/wizard').send({
    nombre: 'Granja Gaps',
    ubicacion: 'Alajuela',
    tipo_produccion: 'Postura',
    encargadoId: ENCARGADO_ID,
    galerones: [{ nombre: 'Galerón Gaps', capacidad_maxima: 1000 }]
  });
  expect(wiz.status).toBe(201);

  const granjas = (await request(app).get('/api/granjas')).body;
  granjaId = granjas.find((g: any) => g.nombre === 'Granja Gaps').id;
  const galerones = (await request(app).get('/api/galerones')).body;
  galeronId = galerones.find((g: any) => g.granjaId === granjaId && g.nombre === 'Galerón Gaps').id;
  expect(granjaId).toBeTruthy();
  expect(galeronId).toBeTruthy();
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — Gaps de cobertura: PUT/DELETE camiones', () => {
  let id = '';

  it('PUT /api/camiones/:id edita nombre y estado', async () => {
    const crea = await request(app).post('/api/camiones').send({
      nombre: 'Camión Gap Edit',
      placa: 'G-001',
      camioneroId: CAMIONERO_ID,
      capacidadCartones: 400,
      estado: 'Activo'
    });
    expect(crea.status).toBe(201);
    id = crea.body.id;

    const res = await request(app).put(`/api/camiones/${id}`).send({ placa: 'G-999', estado: 'EnMantenimiento' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lista = (await request(app).get('/api/camiones')).body;
    const editado = lista.find((c: any) => c.id === id);
    expect(editado.placa).toBe('G-999');
    expect(editado.estado).toBe('EnMantenimiento');
  });

  it('PUT /api/camiones/:id con id inexistente responde 404', async () => {
    const res = await request(app).put('/api/camiones/no-existe').send({ estado: 'Activo' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/camiones/:id elimina el camión y 404 si no existe', async () => {
    const res = await request(app).delete(`/api/camiones/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lista = (await request(app).get('/api/camiones')).body;
    expect(lista.find((c: any) => c.id === id)).toBeUndefined();

    const noExiste = await request(app).delete('/api/camiones/no-existe');
    expect(noExiste.status).toBe(404);
  });
});

describe('E2E — Gaps de cobertura: PUT/DELETE clientes', () => {
  let id = '';

  it('PUT /api/clientes/:id edita los datos del cliente', async () => {
    const crea = await request(app).post('/api/clientes').send({
      nombre: 'Cliente Gap',
      tipo_documento: 'Fisica',
      telefono: '88888888',
      condicion_pago: 'Contado'
    });
    expect(crea.status).toBe(201);
    id = crea.body.id;

    const res = await request(app).put(`/api/clientes/${id}`).send({
      nombre: 'Cliente Gap Editado',
      email: 'cliente@gap.com',
      limite_credito: 50000,
      estado: 'Activo'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lista = (await request(app).get('/api/clientes')).body;
    const editado = lista.find((c: any) => c.id === id);
    expect(editado.nombre).toBe('Cliente Gap Editado');
    expect(editado.email).toBe('cliente@gap.com');
    expect(Number(editado.limite_credito)).toBe(50000);
  });

  it('DELETE /api/clientes/:id elimina el cliente', async () => {
    const res = await request(app).delete(`/api/clientes/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lista = (await request(app).get('/api/clientes')).body;
    expect(lista.find((c: any) => c.id === id)).toBeUndefined();
  });
});

describe('E2E — Gaps de cobertura: PUT rutas', () => {
  let id = '';

  it('PUT /api/rutas/:id edita ruta y asigna cliente', async () => {
    const crea = await request(app).post('/api/rutas').send({ nombre: 'Ruta Gap' });
    expect(crea.status).toBe(201);
    id = crea.body.id;

    const res = await request(app).put(`/api/rutas/${id}`).send({
      nombre: 'Ruta Gap Editado',
      vendedor_asignado: 'gap-vendedor',
      cliente_ids: ['cli-1', 'cli-2'],
      dias_frecuencia: 'Lunes, Jueves',
      kilometraje_aprox: 45,
      estado: 'Inactiva'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lista = (await request(app).get('/api/rutas')).body;
    const editada = lista.find((r: any) => r.id === id);
    expect(editada.nombre).toBe('Ruta Gap Editado');
    expect(JSON.parse(editada.cliente_ids)).toEqual(['cli-1', 'cli-2']);
    expect(editada.estado).toBe('Inactiva');
  });

  // Antes este caso solo pedía "que no rompa": la ruta hacía update sobre un id
  // inexistente y devolvía 200, así que un cliente que editaba una ruta ya
  // borrada creía que el cambio se había guardado.
  it('PUT /api/rutas/:id con id inexistente responde 404', async () => {
    const res = await request(app).put('/api/rutas/no-existe').send({ nombre: 'Nada' });
    expect(res.status).toBe(404);
  });
});

describe('E2E — Gaps de cobertura: PUT mantenimientos', () => {
  it('PUT /api/mantenimientos/:id cambia el estado del mantenimiento', async () => {
    const crea = await request(app).post('/api/mantenimientos').send({
      galeronId,
      fecha: new Date().toISOString().split('T')[0],
      tipo: 'Preventivo',
      descripcion: 'Mantenimiento gap coverage',
      estado: 'Pendiente'
    });
    expect(crea.status).toBe(200);

    const lista = (await request(app).get('/api/mantenimientos')).body;
    const mant = lista.find((m: any) => m.galeronId === galeronId && m.descripcion === 'Mantenimiento gap coverage');
    expect(mant).toBeDefined();

    const res = await request(app).put(`/api/mantenimientos/${mant.id}`).send({ estado: 'Completado' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lista2 = (await request(app).get('/api/mantenimientos')).body;
    expect(lista2.find((m: any) => m.id === mant.id).estado).toBe('Completado');
  });
});

describe('E2E — Gaps de cobertura: DELETE galerones', () => {
  let id = '';

  it('DELETE /api/galerones/:id archiva el galerón', async () => {
    const crea = await request(app).post('/api/galerones').send({
      granjaId,
      nombre: 'Galerón Gap Borrar',
      capacidad_maxima: 500
    });
    expect(crea.status).toBe(200);
    const lista = (await request(app).get('/api/galerones')).body;
    id = lista.find((g: any) => g.nombre === 'Galerón Gap Borrar').id;

    const res = await request(app).delete(`/api/galerones/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lista2 = (await request(app).get('/api/galerones')).body;
    expect(lista2.find((g: any) => g.id === id).estado).toBe('Archivado');
  });

  it('DELETE /api/galerones/:id con id inexistente responde 404', async () => {
    const res = await request(app).delete('/api/galerones/no-existe');
    expect(res.status).toBe(404);
  });
});

describe('E2E — Gaps de cobertura: módulo incidentes (SaludAvícola)', () => {
  let incidenteId = '';

  it('POST /api/incidentes valida datos obligatorios', async () => {
    const sinGranja = await request(app).post('/api/incidentes').send({ categoria: 'Mortalidad', descripcion: 'Diez caracteres o más' });
    expect(sinGranja.status).toBe(400);

    const sinCategoria = await request(app).post('/api/incidentes').send({ granjaId, descripcion: 'Diez caracteres o más' });
    expect(sinCategoria.status).toBe(400);

    const descCorta = await request(app).post('/api/incidentes').send({ granjaId, categoria: 'Mortalidad', descripcion: 'Corto' });
    expect(descCorta.status).toBe(400);

    const sinCantidad = await request(app).post('/api/incidentes').send({ granjaId, categoria: 'Mortalidad', descripcion: 'Diez caracteres o más' });
    expect(sinCantidad.status).toBe(400);
  });

  it('POST + GET + PATCH de incidentes completa el flujo', async () => {
    const crea = await request(app).post('/api/incidentes').send({
      granjaId,
      galeronId,
      categoria: 'Mortalidad',
      severidad: 'Alta',
      descripcion: 'Mortalidad alta detectada en el galerón durante la revisión',
      cantidadAfectada: 12,
      causaProbable: 'Calor excesivo',
      reportadoPorId: ENCARGADO_ID,
      reportadoPorNombre: 'Encargado Gaps'
    });
    expect(crea.status).toBe(201);
    incidenteId = crea.body.id;

    const lista = (await request(app).get('/api/incidentes')).body;
    const inc = lista.find((i: any) => i.id === incidenteId);
    expect(inc).toBeDefined();
    expect(inc.estado).toBe('Reportado');
    expect(inc.granjaNombre).toBe('Granja Gaps');
    expect(inc.galeronNombre).toBe('Galerón Gaps');

    const soloActivos = (await request(app).get('/api/incidentes?soloActivos=true')).body;
    expect(soloActivos.find((i: any) => i.id === incidenteId)).toBeDefined();

    const patch = await request(app).patch(`/api/incidentes/${incidenteId}`).send({
      estado: 'Resuelto',
      resumen: 'Se ventiló el galerón y se separaron las aves afectadas',
      resueltoPor: 'Encargado Gaps'
    });
    expect(patch.status).toBe(200);
    expect(patch.body.success).toBe(true);

    const lista2 = (await request(app).get('/api/incidentes')).body;
    const resuelto = lista2.find((i: any) => i.id === incidenteId);
    expect(resuelto.estado).toBe('Resuelto');
    expect(resuelto.resumen).toContain('Se ventiló');

    const noActivos = (await request(app).get('/api/incidentes?soloActivos=true')).body;
    expect(noActivos.find((i: any) => i.id === incidenteId)).toBeUndefined();
  });

  it('PATCH /api/incidentes/:id con id inexistente responde 404', async () => {
    const res = await request(app).patch('/api/incidentes/no-existe').send({ estado: 'Resuelto' });
    expect(res.status).toBe(404);
  });
});

describe('E2E — Gaps de cobertura: GET /api/precios/detalle/:listaId', () => {
  it('devuelve solo los items de la lista consultada', async () => {
    const listaA = 'lista-gap-a';
    const listaB = 'lista-gap-b';

    await request(app).post('/api/precios/detalle').send({ listaId: listaA, producto: 'Huevos - Especial GAP', precioUnitario: 2500 });
    await request(app).post('/api/precios/detalle').send({ listaId: listaA, producto: 'Huevos - Mini GAP', precioUnitario: 2200 });
    await request(app).post('/api/precios/detalle').send({ listaId: listaB, producto: 'Huevos - Omega GAP', precioUnitario: 3000 });

    const res = await request(app).get(`/api/precios/detalle/${listaA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((p: any) => p.listaId === listaA)).toBe(true);
    expect(res.body.map((p: any) => p.producto).sort()).toEqual(['Huevos - Especial GAP', 'Huevos - Mini GAP']);

    const inexistente = await request(app).get('/api/precios/detalle/lista-no-existe');
    expect(inexistente.status).toBe(200);
    expect(inexistente.body).toHaveLength(0);
  });
});

describe('E2E — Gaps de cobertura: GET /api/dashboard/produccion-detalle', () => {
  it('responde el detalle de producción con resumen por granja', async () => {
    await crearStock('Huevos - Grande', 60);

    const res = await request(app).get('/api/dashboard/produccion-detalle');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('porGranja');
    expect(res.body).toHaveProperty('resumen');

    const granja = res.body.porGranja.find((g: any) => g.id === granjaId);
    expect(granja).toBeDefined();
    expect(granja.nombre).toBe('Granja Gaps');
    expect(granja.galerones.length).toBeGreaterThan(0);
    expect(Number(res.body.resumen.totalCartones)).toBeGreaterThanOrEqual(60);
  });
});

describe('E2E — Gaps de cobertura: GET /api/desperdicios/patrones', () => {
  it('agrupa desperdicios por ruta, vendedor, producto, motivo y tendencia', async () => {
    const crea = await request(app).post('/api/desperdicios').send({
      origen: 'Recepcion',
      producto: 'Huevos - Grande GAP',
      cantidad: 15,
      motivo: 'Golpeados',
      responsable: 'Bodeguero Gaps',
      impactoFinanciero: 15000
    });
    expect(crea.status).toBe(201);

    const res = await request(app).get('/api/desperdicios/patrones');
    expect(res.status).toBe(200);
    expect(res.body.totales.registros).toBeGreaterThanOrEqual(1);
    expect(res.body.totales.cartones).toBeGreaterThanOrEqual(15);
    expect(res.body.totales.impacto).toBeGreaterThanOrEqual(15000);

    const porMotivo = res.body.porMotivo.find((m: any) => m.motivo === 'Golpeados');
    expect(porMotivo).toBeDefined();
    expect(Number(porMotivo.cartones)).toBe(15);

    const porProducto = res.body.porProducto.find((p: any) => p.producto === 'Huevos - Grande GAP');
    expect(porProducto).toBeDefined();
    expect(Number(porProducto.registros)).toBe(1);
  });

  it('respeta el filtro por fechas', async () => {
    const ayer = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
    const manana = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const res = await request(app)
      .get(`/api/desperdicios/patrones?fechaInicio=${ayer}&fechaFin=${manana}`);
    expect(res.status).toBe(200);
    expect(res.body.totales.registros).toBeGreaterThanOrEqual(1);

    const vacio = await request(app)
      .get(`/api/desperdicios/patrones?fechaInicio=2030-01-01&fechaFin=2031-01-01`);
    expect(vacio.status).toBe(200);
    expect(vacio.body.totales.registros).toBe(0);
  });
});

describe('E2E — Gaps de cobertura: rechazo de carga (camionero)', () => {
  let camionId = '';

  it('el creador NO puede rechazar su propia carga', async () => {
    const cam = await request(app).post('/api/camiones').send({
      nombre: 'Camión Gap Rechazo',
      placa: 'G-R-01',
      camioneroId: CAMIONERO_ID,
      capacidadCartones: 300,
      estado: 'Activo'
    });
    expect(cam.status).toBe(201);
    camionId = cam.body.id;

    await crearStock('Huevos - Mediano', 120);
    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Mediano', 40, camionId);

    const res = await request(app)
      .post(`/api/operaciones/carga/${cargaId}/rechazar`)
      .send({ camioneroId: ENCARGADO_ID, motivo: 'Carga incompleta' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('no puede');
  });

  it('rechazo válido pasa la carga a Rechazada y guarda el motivo', async () => {
    const cargaId = crypto.randomUUID();
    await crearTraslado(cargaId, 'Huevos - Mediano', 30, camionId);

    const sinMotivo = await request(app)
      .post(`/api/operaciones/carga/${cargaId}/rechazar`)
      .send({ camioneroId: OTRO_CAMIONERO_ID });
    expect(sinMotivo.status).toBe(400);

    const res = await request(app)
      .post(`/api/operaciones/carga/${cargaId}/rechazar`)
      .send({ camioneroId: OTRO_CAMIONERO_ID, motivo: 'Producto dañado en el viaje' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const traslados = (await request(app).get('/api/operaciones/traslados')).body;
    const t = traslados.find((x: any) => x.cargaId === cargaId);
    expect(t).toBeDefined();
    expect(t.estado).toBe('Rechazada');
    expect(t.motivoRechazo).toBe('Producto dañado en el viaje');
  });

  it('rechazar una carga inexistente responde 404', async () => {
    const res = await request(app)
      .post('/api/operaciones/carga/no-existe/rechazar')
      .send({ camioneroId: OTRO_CAMIONERO_ID, motivo: 'X' });
    expect(res.status).toBe(404);
  });
});