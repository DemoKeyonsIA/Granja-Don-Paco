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
let client: any;
const DB_PATH = path.resolve(process.cwd(), '.test-e2e-procesos.db');


const COSTO_CARTON = 16000;

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);

  const actores = [
    ['u-enc', 'Encargado Galerón', 'enc@test.com', 'Encargado'],
    ['u-bod', 'Bodeguero', 'bodeguero@test.com', 'Bodeguero'],
    ['u-log', 'Logística', 'logistica@test.com', 'Admin'],
    ['u-cam', 'Camionero', 'camionero@test.com', 'Camionero'],
    ['u-ven', 'Vendedor', 'vendedor@test.com', 'Vendedor'],
    ['u-jef', 'Jefe Bodega', 'jefebodega@test.com', 'Admin'],
  ];
  for (const [id, name, email, role] of actores) {
    await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: [id, name, email, role] });
  }

  // Precio base real del cartón → los desperdicios de sistema calculan impacto financiero
  await client.execute({
    sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['p-huevos-grande', 'Huevos - Grande', 'Cartón 30 unidades', 'cartones', COSTO_CARTON, 'Huevos', 'Activo', new Date().toISOString()]
  });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

const HOY = new Date().toISOString().split('T')[0];
const AYER = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const MAS_3 = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

async function getInventario() {
  return (await request(app).get('/api/inventario')).body;
}

async function getEtiquetas() {
  return (await request(app).get('/api/etiquetas')).body;
}

describe('E2E — TODOS LOS PROCESOS: custodia + mantenimiento de galerones + vacunación + facturas y tiquetes + dashboards con datos reales', () => {
  let granjaId: string;
  let galeronId: string;
  let loteId: string;
  let rutaId: string;
  let camionId: string;
  let cEfvo: any;
  let cCred: any;
  let guiaRemisionId: string;
  let guiaDespachoId: string;
  let eA: any;
  let eB: any;
  let eC: any;
  let venta2: any;

  // ==================== HUEVO: CUSTODIA COMPLETA (común a toda la operación) ====================

  it('P0 — Mundo base: granja, galerón con aves, lote, ruta, clientes, camión y inventario real', async () => {
    await request(app).post('/api/granjas/wizard').send({
      nombre: 'Granja Procesos',
      ubicacion: 'Alajuela, CR',
      tipo_produccion: 'Postura',
      encargadoId: 'u-enc',
      galerones: [{ nombre: 'Galerón Núcleo', capacidad_maxima: 6000 }]
    }).expect(201);

    const granjas = (await request(app).get('/api/granjas')).body;
    granjaId = granjas.find((g: any) => g.nombre === 'Granja Procesos').id;

    const galerones = (await request(app).get('/api/galerones')).body;
    const gal = galerones.find((g: any) => g.granjaId === granjaId);
    expect(gal).toBeDefined();
    galeronId = gal.id;

    // El galerón tiene aves en producción → llega al dashboard totalAvesVivas
    const put = await request(app).put(`/api/galerones/${galeronId}`).send({ aves_en_produccion: 4500 });
    expect(put.status).toBe(200);

    const lotes = await request(app).post('/api/lotes').send({
      galeronId, fecha_ingreso: new Date().toISOString(),
      cantidad_inicial: 4500, linea_genetica: 'ISA Brown', estado: 'Activo'
    });
    expect(lotes.status).toBe(200);
    const lotesList = (await request(app).get('/api/lotes')).body;
    loteId = lotesList.find((l: any) => l.galeronId === galeronId && l.estado === 'Activo').id;

    const ruta = await request(app).post('/api/rutas').send({ nombre: 'Ruta Núcleo', vendedor_asignado: 'u-ven' });
    expect(ruta.status).toBe(201);
    rutaId = (await request(app).get('/api/rutas')).body.find((r: any) => r.nombre === 'Ruta Núcleo').id;

    cEfvo = (await request(app).post('/api/clientes').send({ nombre: 'Pulpería El Ángel', ruta: 'Ruta Núcleo', condicion_pago: 'Contado' })).body;
    cCred = (await request(app).post('/api/clientes').send({ nombre: 'Supermercado Don Pepito', ruta: 'Ruta Núcleo', condicion_pago: 'Credito', limite_credito: 1000000 })).body;

    const cam = await request(app).post('/api/logistica/camiones').send({
      nombre: 'Camión 9', placa: 'CR-009', ruta_defecto: 'Ruta Núcleo',
      vendedor_id: 'u-ven', capacidad_cartones: 300
    });
    expect(cam.status).toBe(201);
    camionId = cam.body.id;

    // Un gasto real del día (diesel) → alimenta utilidadNeta del dashboard
    const gasto = await request(app).post('/api/gastos').send({
      fecha: new Date().toISOString(), categoria: 'Diesel', monto: 50000,
      descripcion: 'Combustible ruta núcleo', usuarioId: 'u-log'
    });
    expect(gasto.body.success).toBe(true);
  });

  it('E1 — Recolección en el galerón: 120 cartones Grandes al inventario de granja', async () => {
    const res = await request(app).post('/api/produccion/recoleccion').send({
      galeron: 'Galerón Núcleo', detalles: [{ tamano: 'Grande', cantidad: 120 }]
    });
    expect(res.status).toBe(200);

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja').cantidad).toBe(120);
  });

  it('E2 — Remisión a bodega: 100 cartones salen de la granja', async () => {
    const res = await request(app).post('/api/operaciones/remision').send({
      granjaId, producto: 'Huevos - Grande', cartones: 100, lote: 'L-PRO-01', responsable: 'u-enc', transporte: 'Camión 9'
    });
    expect(res.status).toBe(201);

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja').cantidad).toBe(20);
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'EnTransito').cantidad).toBe(100);
  });

  it('E3 — Recepción con báscula: 98 de 100, la diferencia queda como PÉRDIDA controlada con impacto real', async () => {
    const guias = (await request(app).get('/api/operaciones/remisiones')).body;
    const guia = guias.find((g: any) => g.cartonesEsperados === 100);
    expect(guia).toBeDefined();
    guiaRemisionId = guia.id;

    const res = await request(app).post('/api/operaciones/recepcion-remision').send({
      guiaId: guia.id, cantidadRecibida: 98, pesoBruto: 58.8,
      motivoDiferencia: '2 cartones con huevo quebrado en traslado', responsable: 'u-jef'
    });
    expect(res.status).toBe(200);

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'EnTransito')).toBeUndefined();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central').cantidad).toBe(98);

    // La pérdida en tránsito queda con impacto financiero REAL (2 × precio catálogo)
    const desp = (await request(app).get('/api/desperdicios')).body;
    const d = desp.find((x: any) => x.cantidad === 2);
    expect(d).toBeDefined();
    expect(d.origen).toMatch(/^Remisión GR-/);
    expect(d.impactoFinanciero).toBe(2 * COSTO_CARTON);
  });

  it('E4 — Alistamiento: nacen 3 etiquetas QR de 30 cartones', async () => {
    const res = await request(app).post('/api/operaciones/alistamiento').send({
      guiaId: guiaRemisionId, producto: 'Huevos - Grande', cartones: 90,
      granjaOrigen: 'Granja Procesos', lote: 'L-PRO-01', clasificacion: 'Grado A',
      pesoBruto: 54, responsable: 'u-bod'
    });
    expect(res.status).toBe(201);
    expect(res.body.etiquetas).toHaveLength(3);

    const etiq = await getEtiquetas();
    [eA, eB, eC] = etiq.filter((e: any) => e.estado === 'EnBodega' && e.lote === 'L-PRO-01');
    expect(eA && eB && eC).toBeDefined();
    expect(etiq.filter((e: any) => e.estado === 'EnBodega' && e.lote === 'L-PRO-01').every((e: any) => e.cantidad === 30)).toBe(true);
  });

  it('E5 — Carga del camión: los 90 cartones salen de bodega hacia el camión', async () => {
    const res = await request(app).post('/api/logistica/guias').set('x-user-id', 'u-log').send({
      camionId, rutaId, etiquetasIds: [eA.id, eB.id, eC.id],
      responsablesCarga: 'u-bod', responsableTransporte: 'u-cam', pesoSalida: 54
    });
    expect(res.status).toBe(201);

    const guias = (await request(app).get('/api/logistica/guias')).body;
    const guia = guias.find((g: any) => g.camionId === camionId && g.estado === 'Cargada');
    expect(guia).toBeDefined();
    guiaDespachoId = guia.id;
    expect(guia.totalCartones).toBe(90);
    expect(guia.camionNombre).toBe('Camión 9');
    expect(guia.consecutivo).toMatch(/^GD-/);

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central').cantidad).toBe(8);
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 9').cantidad).toBe(90);
  });

  it('E6 — Confirma salida: la guía queda EnRuta', async () => {
    const res = await request(app).post(`/api/logistica/guias/${guiaDespachoId}/marcar-en-ruta`).set('x-user-id', 'u-cam');
    expect(res.status).toBe(200);
    const guias = (await request(app).get('/api/logistica/guias')).body;
    expect(guias.find((g: any) => g.id === guiaDespachoId).estado).toBe('EnRuta');
  });

  it('E7 — Tiquetes de venta en ruta: TQ-0001 efectivo, TQ-0002 y TQ-0003 crédito', async () => {
    const v1 = await request(app).post('/api/logistica/caja/venta').set('x-user-id', 'u-ven').send({
      guiaId: guiaDespachoId, clienteId: cEfvo.id, etiquetaId: eA.id,
      producto: 'Huevos - Grande', cartones: 30, precioUnitario: COSTO_CARTON, cobro: 'Efectivo', vendedorId: 'u-ven'
    });
    expect(v1.status).toBe(201);
    expect(v1.body.tiqueteConsecutivo).toBe('TQ-0001');

    const v2 = await request(app).post('/api/logistica/caja/venta').set('x-user-id', 'u-ven').send({
      guiaId: guiaDespachoId, clienteId: cCred.id, etiquetaId: eB.id,
      producto: 'Huevos - Grande', cartones: 30, precioUnitario: COSTO_CARTON, cobro: 'Credito', vendedorId: 'u-ven'
    });
    expect(v2.status).toBe(201);
    expect(v2.body.tiqueteConsecutivo).toBe('TQ-0002');
    venta2 = v2.body;

    const v3 = await request(app).post('/api/logistica/caja/venta').set('x-user-id', 'u-ven').send({
      guiaId: guiaDespachoId, clienteId: cCred.id, etiquetaId: eC.id,
      producto: 'Huevos - Grande', cartones: 30, precioUnitario: COSTO_CARTON, cobro: 'Credito', vendedorId: 'u-ven'
    });
    expect(v3.status).toBe(201);
    expect(v3.body.tiqueteConsecutivo).toBe('TQ-0003');

    // Crédito acumulado en el cliente: 2 × 480.000
    const clientes = (await request(app).get('/api/clientes')).body;
    expect(clientes.find((c: any) => c.id === cCred.id).saldo_pendiente).toBe(2 * COSTO_CARTON * 30);
    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 9').cantidad).toBe(0);
  });

  it('E8 — Devolución TQ-0002: el cliente a crédito devuelve el pedido, el camión recupera del retorno', async () => {
    const res = await request(app).post('/api/logistica/caja/devolucion').set('x-user-id', 'u-ven').send({
      guiaId: guiaDespachoId, etiquetaId: eB.id, ventaRutaId: venta2.ventaId, responsable: 'u-ven'
    });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteAnulado).toBe('TQ-0002');

    const clientes = (await request(app).get('/api/clientes')).body;
    expect(clientes.find((c: any) => c.id === cCred.id).saldo_pendiente).toBe(COSTO_CARTON * 30);
    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 9').cantidad).toBe(30);
  });

  it('E9 — Fin de caja en ruta: cuadre con 2 emitidos, 1 anulado y retorno', async () => {
    const res = await request(app).post('/api/logistica/caja/fin-dia').send({ guiaId: guiaDespachoId, responsable: 'u-ven' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CajaCerrada');
    expect(res.body.cuadre.tiquetesEmitidos).toBe(2);
    expect(res.body.cuadre.tiquetesAnulados).toBe(1);
    expect(res.body.cuadre.cartonesVendidos).toBe(60);
    expect(res.body.cuadre.cartonesRetornados).toBe(30);
    expect(res.body.cuadre.restanteCamion).toBe(30);
    expect(res.body.cuadre.mermaPreliminar).toBe(0);
    expect(res.body.cuadre.totalEfectivo).toBe(COSTO_CARTON * 30);
  });

  it('E10 — DASHBOARD LOGÍSTICA con datos reales en vivo (guía activa): ventas, efectivo, crédito y avance', async () => {
    const res = await request(app).get('/api/logistica/tablero');
    expect(res.status).toBe(200);
    const linea = res.body.guias.find((g: any) => g.guiaId === guiaDespachoId);
    expect(linea).toBeDefined();
    expect(linea.finDiaFecha).toBeTruthy(); // caja cerrada (fin de día), guía aún activa para cuadre
    expect(linea.estadoLogico).toBe('CajaCerrada'); // el estado lógico de la API no depende del campo columna
    expect(linea.cartonesVendidos).toBe(60);
    expect(linea.cartonesRetornados).toBe(30);
    expect(linea.totalCargado).toBe(90);
    expect(linea.totalEfectivo).toBe(COSTO_CARTON * 30);
    expect(linea.totalCredito).toBe(COSTO_CARTON * 30);
    expect(linea.avance).toBe(67);
    expect(linea.tiquetesEmitidos).toBe(2);
    expect(linea.tiquetesAnulados).toBe(1);
    const atendidos = linea.clientesAtendidos;
    const atendidosTqs = atendidos.map((c: any) => c.codigoUnico || c.tiqueteConsecutivo);
    expect(atendidosTqs).toEqual(expect.arrayContaining(['TQ-0001', 'TQ-0003']));
    expect(linea.saltosSecuencia.length).toBe(0); // TQ-0001 y TQ-0003 sin huecos: el anulado no cuenta como salto
    expect(linea.detalleEtiquetas).toHaveLength(3);
  });

  it('E11 — Cuadre central (preview): cartones = dinero + retornos, sin aprobación', async () => {
    const res = await request(app).get(`/api/logistica/cuadre-central?guiaId=${guiaDespachoId}`);
    expect(res.status).toBe(200);
    expect(res.body.puedeCuadrar).toBe(true);
    expect(res.body.requiereAprobacion).toBe(false);
    expect(res.body.cuadre.cargado).toBe(90);
    expect(res.body.cuadre.vendidos).toBe(60);
    expect(res.body.cuadre.retornados).toBe(30);
    expect(res.body.cuadre.cartonesReingresar).toBe(30);
    expect(res.body.cuadre.restanteCamion).toBe(30);
    expect(res.body.cuadre.merma).toBe(0);
    expect(res.body.cuadre.efectivo).toBe(COSTO_CARTON * 30);
    expect(res.body.cuadre.etiquetasReingresar.map((e: any) => e.etiquetaId)).toEqual([eB.id]);
  });

  it('E12 — Cuadre central (ejecución): guía CERADA, retorno reconciliado con peso de llegada', async () => {
    const res = await request(app).post('/api/logistica/cuadre-central').set('x-user-id', 'u-jef').send({
      guiaId: guiaDespachoId, responsable: 'u-jef', pesoLlegada: 28.5
    });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('Cerrada');
    expect(res.body.retornosRecibidos).toBe(1);
    expect(res.body.etiquetasReingresadas).toBe(1);

    const guiaDetalle = await request(app).get(`/api/logistica/guias/${guiaDespachoId}`);
    expect(guiaDetalle.status).toBe(200);
    expect(guiaDetalle.body.estadoLogico).toBe('Cerrada');

    const etiq = await getEtiquetas();
    expect(etiq.find((e: any) => e.id === eB.id)).toMatchObject({ estado: 'EnBodega', ubicacionActual: 'Bodega Central' });

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 9').cantidad).toBe(0);
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central').cantidad).toBe(38);

    // Sin merma en cuadre: solo queda el desperdicio controlado de la recepción (2 ct)
    const desp = (await request(app).get('/api/desperdicios')).body;
    expect(desp).toHaveLength(1);
    expect(desp[0].cantidad).toBe(2);
  });

  it('E13 — Pesos por punto de custodia conectados (recepción, alistamiento, carga, cuadre)', async () => {
    const pesos: any[] = (await request(app).get('/api/pesos')).body;
    expect(pesos.find((p: any) => p.tipoReferencia === 'Recepción de Remisión').pesoReal).toBe(58.8);
    expect(pesos.find((p: any) => p.tipoReferencia === 'Alistamiento').pesoReal).toBe(54);
    const carga = pesos.find((p: any) => p.tipoReferencia === 'Carga Camión');
    expect(carga.pesoReal).toBe(54);
    expect(carga.estado).toBe('Conforme');
    const cuadre = pesos.find((p: any) => p.tipoReferencia === 'Cuadre Central');
    expect(cuadre.pesoEsperado).toBe(54);
    expect(cuadre.pesoReal).toBe(28.5);
    expect(cuadre.estado).toBe('ConDiferencia');
  });

  // ==================== MANTENIMIENTO DE LOS GALERONES ====================

  it('M1 — Mantenimiento del galerón registrado (limpieza periódica Completada)', async () => {
    const res = await request(app).post('/api/mantenimientos').send({
      galeronId, fecha: new Date().toISOString(), tipo: 'Limpieza y desinfección',
      descripcion: 'Desinfección completa del galerón núcleo', estado: 'Completado'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const list = (await request(app).get('/api/mantenimientos')).body;
    expect(list.find((m: any) => m.galeronId === galeronId && m.tipo === 'Limpieza y desinfección' && m.estado === 'Completado')).toBeDefined();
  });

  it('M2 — Registro del activo infraestructura (sistema de bebederos)', async () => {
    const res = await request(app).post('/api/activos').send({
      nombre: 'Sistema de bebederos', tipo: 'Sistema Agua', granjaId, galeronId, ubicacion: 'Galerón Núcleo', responsable: 'u-enc'
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('M3 — Órdenes de mantenimiento: 2 vencidas y 1 próxima', async () => {
    const activo = (await request(app).get('/api/activos')).body.find((a: any) => a.nombre === 'Sistema de bebederos');
    expect(activo).toBeDefined();

    const oa = await request(app).post('/api/ordenes-mantenimiento').send({
      activoId: activo.id, tipo: 'Correctivo', fechaProgramada: AYER, responsable: 'u-enc',
      insumosUsados: JSON.stringify([{ item: 'Válvulas', cantidad: 4 }]), costo: 25000, observaciones: 'Válvula principal', checklist: JSON.stringify([{ item: 'Presión', ok: true }])
    });
    expect(oa.status).toBe(201);

    const ob = await request(app).post('/api/ordenes-mantenimiento').send({
      activoId: activo.id, tipo: 'Preventivo', fechaProgramada: AYER, responsable: 'u-enc', costo: 10000
    });
    expect(ob.status).toBe(201);

    const oc = await request(app).post('/api/ordenes-mantenimiento').send({
      activoId: activo.id, tipo: 'Inspección', fechaProgramada: MAS_3, responsable: 'u-enc', costo: 0
    });
    expect(oc.status).toBe(201);
  });

  it('M4 — Ejecutar la orden correctiva: pasa a Completada y sale de las vencidas', async () => {
    const ordenes = (await request(app).get('/api/ordenes-mantenimiento')).body;
    const correctiva = ordenes.find((o: any) => o.tipo === 'Correctivo');
    const res = await request(app).put(`/api/ordenes-mantenimiento/${correctiva.id}`).send({
      estado: 'Completado', fechaEjecutada: new Date().toISOString(), costo: 25000
    });
    expect(res.status).toBe(200);

    const now = (await request(app).get('/api/ordenes-mantenimiento')).body;
    expect(now.find((o: any) => o.id === correctiva.id).estado).toBe('Completado');
  });

  it('M5 — Alertas de mantenimiento: vencidas y próximas quedan con datos reales', async () => {
    const res = await request(app).get('/api/ordenes-mantenimiento/alertas');
    expect(res.status).toBe(200);
    expect(res.body.vencidas).toHaveLength(1);
    expect(res.body.vencidas[0].tipo).toBe('Preventivo');
    expect(res.body.proximas).toHaveLength(1);
    expect(res.body.proximas[0].tipo).toBe('Inspección');
  });

  // ==================== VACUNACIÓN ====================

  it('V1 — Programar Newcastle (vencida) e Influenza (próxima)', async () => {
    const v1 = await request(app).post('/api/vacunaciones').send({
      granjaId, galeronId, loteId, tipoVacuna: 'Newcastle', proveedor: 'AgroVet', dosis: '0.2ml',
      metodoAplicacion: 'Inyectable', fechaProgramada: AYER, responsable: 'u-enc'
    });
    expect(v1.status).toBe(201);

    const v2 = await request(app).post('/api/vacunaciones').send({
      granjaId, galeronId, loteId, tipoVacuna: 'Influenza Aviar', proveedor: 'AgroVet', dosis: '0.5ml',
      metodoAplicacion: 'Spray', fechaProgramada: MAS_3, responsable: 'u-enc'
    });
    expect(v2.status).toBe(201);

    const list = (await request(app).get('/api/vacunaciones')).body;
    expect(list.find((v: any) => v.tipoVacuna === 'Newcastle').estado).toBe('Programada');
    expect(list.find((v: any) => v.tipoVacuna === 'Influenza Aviar').estado).toBe('Programada');
  });

  it('V2 — Aplicar la influenza: registra fecha, reacciones y próxima dosis', async () => {
    const list = (await request(app).get('/api/vacunaciones')).body;
    const influenza = list.find((v: any) => v.tipoVacuna === 'Influenza Aviar');
    const res = await request(app).put(`/api/vacunaciones/${influenza.id}`).send({
      estado: 'Aplicada', fechaAplicada: new Date().toISOString(), reaccionIncidencia: 'Sin reacciones', proximaFecha: MAS_3
    });
    expect(res.status).toBe(200);

    const now = (await request(app).get('/api/vacunaciones')).body;
    expect(now.find((v: any) => v.tipoVacuna === 'Influenza Aviar').estado).toBe('Aplicada');
  });

  it('V3 — Alertas de vacunación: Newcastle sigue vencida, la aplicada ya no cuenta', async () => {
    const res = await request(app).get('/api/vacunaciones/alertas');
    expect(res.status).toBe(200);
    expect(res.body.vencidas.map((v: any) => v.tipoVacuna)).toEqual(['Newcastle']);
    expect(res.body.totalProgramadas).toBe(1);
  });

  // ==================== FACTURAS Y TIQUETES ====================

  it('F1 — Consolidar la ruta cerrada → facturas FAC expedidas en línea con los tiquetes', async () => {
    const res = await request(app).post('/api/facturacion/consolidar-ruta')
      .set('x-user-id', 'u-jef').send({ guiaId: guiaDespachoId });
    expect(res.status).toBe(200);

    const facturas = (await request(app).get('/api/facturas')).body;
    const facEfvo = facturas.find((f: any) => f.consecutivo === 'FAC-000001');
    const facCred = facturas.find((f: any) => f.consecutivo === 'FAC-000002');
    const ncr = facturas.find((f: any) => f.consecutivo.startsWith('NCR-'));
    expect(facEfvo).toMatchObject({ clienteId: cEfvo.id, condicion_pago: 'Contado', estado: 'Pagada', total: COSTO_CARTON * 30 });
    expect(facCred).toMatchObject({ clienteId: cCred.id, condicion_pago: 'Credito', estado: 'Pendiente', total: COSTO_CARTON * 30 });
    // La devolución (TQ-0002) emite la nota de crédito receptora (no suma ingresos)
    expect(ncr).toMatchObject({ estado: 'NotaCredito', total: COSTO_CARTON * 30 });
    expect(facturas).toHaveLength(3);

    // Documentos electrónicos generados: 2 facturas (FE) + 1 nota de crédito (NC)
    const docs = (await request(app).get('/api/facturacion/documentos')).body;
    expect(docs.filter((d: any) => d.tipoDocumento === 'Factura')).toHaveLength(2);
    expect(docs.filter((d: any) => d.tipoDocumento === 'NotaCredito')).toHaveLength(1);
  });

  it('F2 — DASHBOARD EMPRESARIAL con datos reales (antes del cobro): ingresos, cuentas por cobrar, alertas', async () => {
    const res = await request(app).get('/api/dashboard/enterprise');
    expect(res.status).toBe(200);

    // Devengado: las dos facturas del día (contado + crédito), con la nota de
    // crédito excluida por su estado `NotaCredito` (convención R3).
    expect(res.body.ingresosHoy).toBe(2 * COSTO_CARTON * 30);
    // Cobrado: solo la de contado, porque la de crédito sigue sin pagarse.
    expect(res.body.ingresosCobradosHoy).toBe(COSTO_CARTON * 30);
    expect(res.body.gastosHoy).toBe(50000);                               // diesel real
    expect(res.body.utilidadNeta).toBe(2 * COSTO_CARTON * 30 - 50000);
    expect(res.body.cartonesProducidos).toBe(120);                        // recolección real
    expect(res.body.stockBodegaCentral).toBe(38);                         // 98 - 90 + 30 retorno
    expect(res.body.totalAvesVivas).toBe(4500);                           // aves del galerón
    expect(res.body.facturasEmitidas).toBe(3);                            // 2 FAC + 1 factura NCR
    expect(res.body.clientesActivos).toBe(2);
    expect(res.body.rutasActivas).toBe(1);
    expect(res.body.cuentasPorCobrar).toBe(COSTO_CARTON * 30);            // factura a crédito pendiente
    expect(res.body.desperdiciosHoy).toBe(1);                             // pérdida de recepción
    expect(res.body.impactoDesperdicioHoy).toBe(2 * COSTO_CARTON);        // impacto financiero REAL
    expect(res.body.vacunasVencidas).toBe(1);
    expect(res.body.mantenimientosVencidos).toBe(1);
    const alertas = res.body.alertas.map((a: any) => a.tipo);
    expect(alertas).toContain('Vacuna vencida');
    expect(alertas).toContain('Mantenimiento vencido');
  });

  it('F3 — Cobro de la factura a crédito: el dashboard mueve ingresos y salda cuentas por cobrar', async () => {
    const facturas = (await request(app).get('/api/facturas')).body;
    const facCred = facturas.find((f: any) => f.consecutivo === 'FAC-000002');

    // Registrar un cobro exige sesión: la ruta ahora valida permisos, así que el
// pago va firmado y no permitido "a cualquiera" como antes.
    const res = await request(app).post('/api/pagos').set('x-user-id', 'u-log').send({
      facturaId: facCred.id, metodoPago: 'Efectivo', monto: COSTO_CARTON * 30
    });
    expect(res.status).toBe(200);
    expect(res.body.factura.estado).toBe('Pagada');

    const clientes = (await request(app).get('/api/clientes')).body;
    expect(clientes.find((c: any) => c.id === cCred.id).saldo_pendiente).toBe(0);

    const d = (await request(app).get('/api/dashboard/enterprise')).body;
    expect(d.ingresosHoy).toBe(2 * COSTO_CARTON * 30); // devengado: las dos facturas
    // Ya cobrado: con el crédito pagado, ambas son efectivo del día.
    expect(d.ingresosCobradosHoy).toBe(2 * COSTO_CARTON * 30);
    expect(d.cuentasPorCobrar).toBe(0);
    expect(d.utilidadNeta).toBe(2 * COSTO_CARTON * 30 - 50000);
  });

  it('F4 — Nota de crédito directa sobre una factura: genera documento NC', async () => {
    const facturas = (await request(app).get('/api/facturas')).body;
    const facEfvo = facturas.find((f: any) => f.consecutivo === 'FAC-000001');

    const res = await request(app).post('/api/facturacion/nota-credito')
      .set('x-user-id', 'u-jef').send({
      facturaIdOriginal: facEfvo.id, motivo: 'Devolución parcial por huevo quebrado', monto: 64000
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.consecutivo).toMatch(/^NC-/);

    const docs = (await request(app).get('/api/facturacion/documentos')).body;
    const nc = docs.find((d: any) => d.tipoDocumento === 'NotaCredito' && d.notasCreditoId === facEfvo.id);
    expect(nc).toBeDefined();
    expect(nc.total).toBe(64000);
  });

  it('GOLDEN — Snapshot final de dashboards con valores exactos y guard anti-desperdicio en 0', async () => {
    // Desperdicios: guard anti-regresión — ningún desperdicio de sistema con impactoFinanciero en 0
    // (si el producto tiene precio activo, el impacto SIEMPRE debe computarse, nunca hardcodearse).
    const desperdicios = (await request(app).get('/api/desperdicios')).body;
    expect(desperdicios).toHaveLength(1);
    for (const d of desperdicios) {
      expect(d.impactoFinanciero).toBeGreaterThan(0);
    }
    expect(desperdicios[0]).toMatchObject({ cantidad: 2, impactoFinanciero: 2 * COSTO_CARTON });

    // Dashboard empresarial: snapshot inmutable tras el flujo completo
    const d = (await request(app).get('/api/dashboard/enterprise')).body;
    // R3: la NC directa NO suma ingreso (estado NotaCredito, excluida del libro).
    expect(d.ingresosHoy).toBe(2 * COSTO_CARTON * 30);                  // devengado del día
    expect(d.gastosHoy).toBe(50000);
    expect(d.utilidadNeta).toBe(2 * COSTO_CARTON * 30 - 50000);
    expect(d.cartonesProducidos).toBe(120);
    expect(d.stockBodegaCentral).toBe(38);
    expect(d.totalAvesVivas).toBe(4500);
    expect(d.facturasEmitidas).toBe(4);                            // 2 FAC + NCR devolución + NC directa
    expect(d.clientesActivos).toBe(2);
    expect(d.rutasActivas).toBe(1);
    expect(d.cuentasPorCobrar).toBe(0);
    expect(d.desperdiciosHoy).toBe(1);
    expect(d.impactoDesperdicioHoy).toBe(2 * COSTO_CARTON);

    // Guía consolidada: el estado lógico de la API es 'Cerrada' (no depende del campo columna)
    const guias = (await request(app).get('/api/logistica/guias')).body;
    const cerrada = guias.find((g: any) => g.id === guiaDespachoId);
    expect(cerrada.estado).toBe('Cerrada');
    expect(cerrada.estadoLogico).toBe('Cerrada');
  });
});