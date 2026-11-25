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
const DB_PATH = path.resolve(process.cwd(), '.test-e2e-procesos.db');


const PRECIO_KG = 16000;

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
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
    args: ['p-huevos-grande', 'Huevos - Grande', 'Huevo vendido por peso', 'kg', PRECIO_KG, 'Huevos', 'Activo', new Date().toISOString()]
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
  return (await requestAs(app, 'u-log').get('/api/inventario')).body;
}

async function getEtiquetas() {
  return (await requestAs(app, 'u-log').get('/api/etiquetas')).body;
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
  let retornoE2EId: string;

  // ==================== HUEVO: CUSTODIA COMPLETA (común a toda la operación) ====================

  it('P0 — Mundo base: granja, galerón con aves, lote, ruta, clientes, camión y inventario real', async () => {
    await requestAs(app, 'u-log').post('/api/granjas/wizard').send({
      nombre: 'Granja Procesos',
      ubicacion: 'Alajuela, CR',
      tipo_produccion: 'Postura',
      encargadoId: 'u-enc',
      galerones: [{ nombre: 'Galerón Núcleo', capacidad_maxima: 6000 }]
    }).expect(201);

    const granjas = (await requestAs(app, 'u-log').get('/api/granjas')).body;
    granjaId = granjas.find((g: any) => g.nombre === 'Granja Procesos').id;

    const galerones = (await requestAs(app, 'u-log').get('/api/galerones')).body;
    const gal = galerones.find((g: any) => g.granjaId === granjaId);
    expect(gal).toBeDefined();
    galeronId = gal.id;

    // El galerón tiene aves en producción → llega al dashboard totalAvesVivas
    const put = await requestAs(app, 'u-log').put(`/api/galerones/${galeronId}`).send({ aves_en_produccion: 4500 });
    expect(put.status).toBe(200);

    const lotes = await requestAs(app, 'u-log').post('/api/lotes').send({
      galeronId, fecha_ingreso: new Date().toISOString(),
      cantidad_inicial: 4500, linea_genetica: 'ISA Brown', estado: 'Activo'
    });
    expect(lotes.status).toBe(200);
    const lotesList = (await requestAs(app, 'u-log').get('/api/lotes')).body;
    loteId = lotesList.find((l: any) => l.galeronId === galeronId && l.estado === 'Activo').id;

    const ruta = await requestAs(app, 'u-log').post('/api/rutas').send({ nombre: 'Ruta Núcleo', vendedor_asignado: 'u-ven' });
    expect(ruta.status).toBe(201);
    rutaId = (await requestAs(app, 'u-log').get('/api/rutas')).body.find((r: any) => r.nombre === 'Ruta Núcleo').id;

    cEfvo = (await requestAs(app, 'u-log').post('/api/clientes').send({ nombre: 'Pulpería El Ángel', ruta: 'Ruta Núcleo', condicion_pago: 'Contado' })).body;
    cCred = (await requestAs(app, 'u-log').post('/api/clientes').send({ nombre: 'Supermercado Don Pepito', ruta: 'Ruta Núcleo', condicion_pago: 'Credito', limite_credito: 1000000 })).body;

    const cam = await requestAs(app, 'u-log').post('/api/logistica/camiones').send({
      nombre: 'Camión 9', placa: 'CR-009', ruta_defecto: 'Ruta Núcleo',
      vendedor_id: 'u-ven', capacidad_cartones: 300
    });
    expect(cam.status).toBe(201);
    camionId = cam.body.id;

    // Un gasto real del día (diesel) → alimenta utilidadNeta del dashboard
    const gasto = await requestAs(app, 'u-log').post('/api/gastos').set('x-user-id', 'u-log').send({
      fecha: new Date().toISOString(), categoria: 'Diesel', monto: 50000,
      descripcion: 'Combustible ruta núcleo', usuarioId: 'u-log'
    });
    expect(gasto.body.success).toBe(true);
  });

  it('E1 — Recolección en el galerón: 120 kg de huevo al inventario de granja', async () => {
    const res = await requestAs(app, 'u-log').post('/api/produccion/recoleccion').send({
      galeron: 'Galerón Núcleo', detalles: [{ tamano: 'Grande', cantidadKg: 120 }]
    });
    expect(res.status).toBe(200);

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja').cantidad).toBe(120);
  });

  it('E2 — Remisión a bodega: 100 kg salen de la granja', async () => {
    const res = await requestAs(app, 'u-log').post('/api/operaciones/remision').send({
      granjaId, producto: 'Huevos - Grande', cantidadKg: 100, lote: 'L-PRO-01', responsable: 'u-enc', transporte: 'Camión 9'
    });
    expect(res.status).toBe(201);

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja').cantidad).toBe(20);
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'EnTransito').cantidad).toBe(100);
  });

  it('E3 — Recepción con báscula: 98 de 100, la diferencia queda como PÉRDIDA controlada con impacto real', async () => {
    const guias = (await requestAs(app, 'u-log').get('/api/operaciones/remisiones')).body;
    const guia = guias.find((g: any) => g.cantidadKgEsperada === 100);
    expect(guia).toBeDefined();
    guiaRemisionId = guia.id;

    const res = await requestAs(app, 'u-log').post('/api/operaciones/recepcion-remision').send({
      guiaId: guia.id, cantidadKg: 98, pesoBruto: 98,
      motivoDiferencia: '2 kg de huevo quebrado en traslado', responsable: 'u-jef'
    });
    expect(res.status).toBe(200);

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'EnTransito')).toBeUndefined();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central').cantidad).toBe(98);

    // La pérdida en tránsito queda con impacto financiero REAL (2 × precio catálogo)
    const desp = (await requestAs(app, 'u-log').get('/api/desperdicios')).body;
    const d = desp.find((x: any) => x.cantidad === 2);
    expect(d).toBeDefined();
    expect(d.origen).toMatch(/^Remisión GR-/);
    expect(d.impactoFinanciero).toBe(2 * PRECIO_KG);
  });

  it('E4 — Alistamiento: nacen etiquetas QR para el lote de 90 kg', async () => {
    const res = await requestAs(app, 'u-log').post('/api/operaciones/alistamiento').send({
      guiaId: guiaRemisionId, producto: 'Huevos - Grande', cantidadKg: 90, kgPorEtiqueta: 30,
      granjaOrigen: 'Granja Procesos', lote: 'L-PRO-01', clasificacion: 'Grado A',
      pesoBruto: 90, responsable: 'u-bod'
    });
    expect(res.status).toBe(201);
    expect(res.body.etiquetas).toHaveLength(3);

    const etiq = await getEtiquetas();
    [eA, eB, eC] = etiq.filter((e: any) => e.estado === 'EnBodega' && e.lote === 'L-PRO-01');
    expect(eA && eB && eC).toBeDefined();
    expect(etiq.filter((e: any) => e.estado === 'EnBodega' && e.lote === 'L-PRO-01').every((e: any) => e.cantidad === 30)).toBe(true);
  });

  it('E5 — Carga del camión: los 90 kg salen de bodega hacia el camión', async () => {
    const res = await requestAs(app, 'u-log').post('/api/logistica/guias').set('x-user-id', 'u-log').send({
      camionId, rutaId, etiquetasIds: [eA.id, eB.id, eC.id],
      responsablesCarga: 'u-bod', responsableTransporte: 'u-ven', pesoSalida: 90
    });
    expect(res.status).toBe(201);

    const guias = (await requestAs(app, 'u-log').get('/api/logistica/guias')).body;
    const guia = guias.find((g: any) => g.camionId === camionId && g.estado === 'Cargada');
    expect(guia).toBeDefined();
    guiaDespachoId = guia.id;
    expect(guia.totalKg).toBe(90);
    expect(guia.camionNombre).toBe('Camión 9');
    expect(guia.consecutivo).toMatch(/^GD-/);

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central').cantidad).toBe(8);
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 9').cantidad).toBe(90);
  });

  it('E6 — Confirma salida: la guía queda EnRuta', async () => {
    const res = await requestAs(app, 'u-log').post(`/api/logistica/guias/${guiaDespachoId}/marcar-en-ruta`).set('x-user-id', 'u-ven');
    expect(res.status).toBe(200);
    const guias = (await requestAs(app, 'u-log').get('/api/logistica/guias')).body;
    expect(guias.find((g: any) => g.id === guiaDespachoId).estado).toBe('EnRuta');
  });

  it('E7 — Tiquetes de venta en ruta: TQ-0001 efectivo, TQ-0002 y TQ-0003 crédito', async () => {
    const v1 = await requestAs(app, 'u-log').post('/api/logistica/caja/venta').set('x-user-id', 'u-ven').send({
      guiaId: guiaDespachoId, clienteId: cEfvo.id, etiquetaId: eA.id,
      producto: 'Huevos - Grande', cantidadKg: 30, precioUnitario: PRECIO_KG, cobro: 'Efectivo', vendedorId: 'u-ven'
    });
    expect(v1.status).toBe(201);
    expect(v1.body.tiqueteConsecutivo).toBe('TQ-0001');

    const v2 = await requestAs(app, 'u-log').post('/api/logistica/caja/venta').set('x-user-id', 'u-ven').send({
      guiaId: guiaDespachoId, clienteId: cCred.id, etiquetaId: eB.id,
      producto: 'Huevos - Grande', cantidadKg: 30, precioUnitario: PRECIO_KG, cobro: 'Credito', vendedorId: 'u-ven'
    });
    expect(v2.status).toBe(201);
    expect(v2.body.tiqueteConsecutivo).toBe('TQ-0002');
    venta2 = v2.body;

    const v3 = await requestAs(app, 'u-log').post('/api/logistica/caja/venta').set('x-user-id', 'u-ven').send({
      guiaId: guiaDespachoId, clienteId: cCred.id, etiquetaId: eC.id,
      producto: 'Huevos - Grande', cantidadKg: 30, precioUnitario: PRECIO_KG, cobro: 'Credito', vendedorId: 'u-ven'
    });
    expect(v3.status).toBe(201);
    expect(v3.body.tiqueteConsecutivo).toBe('TQ-0003');

    // Crédito acumulado en el cliente: 2 × 480.000
    const clientes = (await requestAs(app, 'u-log').get('/api/clientes')).body;
    expect(clientes.find((c: any) => c.id === cCred.id).saldo_pendiente).toBe(2 * PRECIO_KG * 30);
    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 9').cantidad).toBe(0);
  });

  it('E8 — Devolución TQ-0002: el cliente a crédito devuelve el pedido, el camión recupera del retorno', async () => {
    const res = await requestAs(app, 'u-log').post('/api/logistica/caja/devolucion').set('x-user-id', 'u-ven').send({
      guiaId: guiaDespachoId, etiquetaId: eB.id, ventaRutaId: venta2.ventaId, responsable: 'u-ven'
    });
    expect(res.status).toBe(201);
    expect(res.body.tiqueteAnulado).toBe('TQ-0002');
    // El retorno queda PENDIENTE hasta que Bodega lo acepte físicamente.
    expect(res.body.estado).toBe('PendienteBodega');
    retornoE2EId = res.body.retornoId;

    const clientes = (await requestAs(app, 'u-log').get('/api/clientes')).body;
    // La deuda no se revierte hasta que Bodega acepta físicamente el retorno.
    expect(clientes.find((c: any) => c.id === cCred.id).saldo_pendiente).toBe(2 * PRECIO_KG * 30);
    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 9').cantidad).toBe(30);
  });

  it('E9 — Fin de caja en ruta: cuadre con ventas y retorno pendiente', async () => {
    const res = await requestAs(app, 'u-log').post('/api/logistica/caja/fin-dia').send({ guiaId: guiaDespachoId, responsable: 'u-ven' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CajaCerrada');
    expect(res.body.cuadre.tiquetesEmitidos).toBe(2);
    expect(res.body.cuadre.tiquetesAnulados).toBe(1);
    expect(res.body.cuadre.cartonesVendidos).toBe(60);
    expect(res.body.cuadre.cartonesRetornados).toBe(30);
    expect(res.body.cuadre.restanteCamion).toBe(30);
    expect(res.body.cuadre.mermaPreliminar).toBe(0);
    expect(res.body.cuadre.totalEfectivo).toBe(PRECIO_KG * 30);
  });

  it('E10 — DASHBOARD LOGÍSTICA con datos reales en vivo (guía activa): ventas, efectivo, crédito y avance', async () => {
    const res = await requestAs(app, 'u-log').get('/api/logistica/tablero');
    expect(res.status).toBe(200);
    const linea = res.body.guias.find((g: any) => g.guiaId === guiaDespachoId);
    expect(linea).toBeDefined();
    expect(linea.finDiaFecha).toBeTruthy(); // caja cerrada (fin de día), guía aún activa para cuadre
    expect(linea.estadoLogico).toBe('CajaCerrada'); // el estado lógico de la API no depende del campo columna
    expect(linea.cartonesVendidos).toBe(60);
    expect(linea.cartonesRetornados).toBe(30);
    expect(linea.totalCargado).toBe(90);
    expect(linea.totalEfectivo).toBe(PRECIO_KG * 30);
    expect(linea.totalCredito).toBe(PRECIO_KG * 30);
    expect(linea.avance).toBe(67);
    expect(linea.tiquetesEmitidos).toBe(2);
    expect(linea.tiquetesAnulados).toBe(1);
    const atendidos = linea.clientesAtendidos;
    const atendidosTqs = atendidos.map((c: any) => c.codigoUnico || c.tiqueteConsecutivo);
    expect(atendidosTqs).toEqual(expect.arrayContaining(['TQ-0001', 'TQ-0003']));
    expect(linea.saltosSecuencia.length).toBe(0); // el tiquete devuelto se conserva en la secuencia
    expect(linea.detalleEtiquetas).toHaveLength(3);
  });

  it('E11 — Cuadre central (preview): kg = dinero + retornos pendientes de Bodega', async () => {
    const res = await requestAs(app, 'u-log').get(`/api/logistica/cuadre-central?guiaId=${guiaDespachoId}`).set('x-user-id', 'u-jef');
    expect(res.status).toBe(200);
    expect(res.body.puedeCuadrar).toBe(false);
    // El retorno está registrado pero Bodega todavía no lo aceptó: el cuadre exige
    // esa aceptación antes de cerrar sin diferencia.
    expect(res.body.requiereAprobacion).toBe(true);
    expect(res.body.cuadre.cargado).toBe(90);
    expect(res.body.cuadre.vendidos).toBe(60);
    expect(res.body.cuadre.retornados).toBe(30);
    expect(res.body.cuadre.retornoPendiente).toBe(30);
    expect(res.body.cuadre.tieneRetornosPendientes).toBe(true);
    expect(res.body.cuadre.restanteCamion).toBe(30);
    expect(res.body.cuadre.merma).toBe(0);
    expect(res.body.cuadre.efectivo).toBe(PRECIO_KG * 30);
    expect(res.body.cuadre.etiquetasReingresar.map((e: any) => e.etiquetaId)).toEqual([eB.id]);
  });

  it('E12 — Cuadre central (ejecución): guía CERADA, retorno reconciliado con peso de llegada', async () => {
    const retornoAceptado = await requestAs(app, 'u-log').post('/api/logistica/bodega/retorno/aceptar')
      .set('x-user-id', 'u-bod').send({ retornoId: retornoE2EId, responsable: 'u-bod', peso: 30 });
    expect(retornoAceptado.status).toBe(200);
    const res = await requestAs(app, 'u-log').post('/api/logistica/cuadre-central').set('x-user-id', 'u-jef').send({
      guiaId: guiaDespachoId, responsable: 'u-jef', pesoLlegada: 30
    });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('Cerrada');
    expect(res.body.retornosRecibidos).toBe(1);
    expect(res.body.etiquetasReingresadas).toBe(0); // Bodega recibió la etiqueta antes del cuadre

    const guiaDetalle = await requestAs(app, 'u-log').get(`/api/logistica/guias/${guiaDespachoId}`);
    expect(guiaDetalle.status).toBe(200);
    expect(guiaDetalle.body.estadoLogico).toBe('Cerrada');

    const etiq = await getEtiquetas();
    expect(etiq.find((e: any) => e.id === eB.id)).toMatchObject({ estado: 'EnBodega', ubicacionActual: 'Bodega Central' });

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 9').cantidad).toBe(0);
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central').cantidad).toBe(38);

    // Sin merma en cuadre: solo queda el desperdicio controlado de la recepción (2 ct)
    const desp = (await requestAs(app, 'u-log').get('/api/desperdicios')).body;
    expect(desp).toHaveLength(1);
    expect(desp[0].cantidad).toBe(2);
  });

  it('E13 — Pesos por punto de custodia conectados (recepción, alistamiento, carga, cuadre)', async () => {
    const pesos: any[] = (await requestAs(app, 'u-log').get('/api/pesos')).body;
    expect(pesos.find((p: any) => p.tipoReferencia === 'Recepción de Remisión').pesoReal).toBe(98);
    expect(pesos.find((p: any) => p.tipoReferencia === 'Alistamiento').pesoReal).toBe(90);
    const carga = pesos.find((p: any) => p.tipoReferencia === 'Carga Camión');
    expect(carga.pesoReal).toBe(90);
    expect(carga.estado).toBe('Conforme');
    const cuadre = pesos.find((p: any) => p.tipoReferencia === 'Cuadre Central');
    expect(cuadre.pesoEsperado).toBe(90);
    expect(cuadre.pesoReal).toBe(30);
    expect(cuadre.estado).toBe('ConDiferencia');
  });

  // ==================== MANTENIMIENTO DE LOS GALERONES ====================

  it('M1 — Mantenimiento del galerón registrado (limpieza periódica Completada)', async () => {
    const res = await requestAs(app, 'u-log').post('/api/mantenimientos').send({
      galeronId, fecha: new Date().toISOString(), tipo: 'Limpieza y desinfección',
      descripcion: 'Desinfección completa del galerón núcleo', estado: 'Completado'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const list = (await requestAs(app, 'u-log').get('/api/mantenimientos')).body;
    expect(list.find((m: any) => m.galeronId === galeronId && m.tipo === 'Limpieza y desinfección' && m.estado === 'Completado')).toBeDefined();
  });

  it('M2 — Registro del activo infraestructura (sistema de bebederos)', async () => {
    const res = await requestAs(app, 'u-log').post('/api/activos').send({
      nombre: 'Sistema de bebederos', tipo: 'Sistema Agua', granjaId, galeronId, ubicacion: 'Galerón Núcleo', responsable: 'u-enc'
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('M3 — Órdenes de mantenimiento: 2 vencidas y 1 próxima', async () => {
    const activo = (await requestAs(app, 'u-log').get('/api/activos')).body.find((a: any) => a.nombre === 'Sistema de bebederos');
    expect(activo).toBeDefined();

    const oa = await requestAs(app, 'u-log').post('/api/ordenes-mantenimiento').send({
      activoId: activo.id, tipo: 'Correctivo', fechaProgramada: AYER, responsable: 'u-enc',
      insumosUsados: JSON.stringify([{ item: 'Válvulas', cantidad: 4 }]), costo: 25000, observaciones: 'Válvula principal', checklist: JSON.stringify([{ item: 'Presión', ok: true }])
    });
    expect(oa.status).toBe(201);

    const ob = await requestAs(app, 'u-log').post('/api/ordenes-mantenimiento').send({
      activoId: activo.id, tipo: 'Preventivo', fechaProgramada: AYER, responsable: 'u-enc', costo: 10000
    });
    expect(ob.status).toBe(201);

    const oc = await requestAs(app, 'u-log').post('/api/ordenes-mantenimiento').send({
      activoId: activo.id, tipo: 'Inspección', fechaProgramada: MAS_3, responsable: 'u-enc', costo: 0
    });
    expect(oc.status).toBe(201);
  });

  it('M4 — Ejecutar la orden correctiva: pasa a Completada y sale de las vencidas', async () => {
    const ordenes = (await requestAs(app, 'u-log').get('/api/ordenes-mantenimiento')).body;
    const correctiva = ordenes.find((o: any) => o.tipo === 'Correctivo');
    const res = await requestAs(app, 'u-log').put(`/api/ordenes-mantenimiento/${correctiva.id}`).send({
      estado: 'Completado', fechaEjecutada: new Date().toISOString(), costo: 25000
    });
    expect(res.status).toBe(200);

    const now = (await requestAs(app, 'u-log').get('/api/ordenes-mantenimiento')).body;
    expect(now.find((o: any) => o.id === correctiva.id).estado).toBe('Completado');
  });

  it('M5 — Alertas de mantenimiento: vencidas y próximas quedan con datos reales', async () => {
    const res = await requestAs(app, 'u-log').get('/api/ordenes-mantenimiento/alertas');
    expect(res.status).toBe(200);
    expect(res.body.vencidas).toHaveLength(1);
    expect(res.body.vencidas[0].tipo).toBe('Preventivo');
    expect(res.body.proximas).toHaveLength(1);
    expect(res.body.proximas[0].tipo).toBe('Inspección');
  });

  // ==================== VACUNACIÓN ====================

  it('V1 — Programar Newcastle (vencida) e Influenza (próxima)', async () => {
    const v1 = await requestAs(app, 'u-log').post('/api/vacunaciones').send({
      granjaId, galeronId, loteId, tipoVacuna: 'Newcastle', proveedor: 'AgroVet', dosis: '0.2ml',
      metodoAplicacion: 'Inyectable', fechaProgramada: AYER, responsable: 'u-enc'
    });
    expect(v1.status).toBe(201);

    const v2 = await requestAs(app, 'u-log').post('/api/vacunaciones').send({
      granjaId, galeronId, loteId, tipoVacuna: 'Influenza Aviar', proveedor: 'AgroVet', dosis: '0.5ml',
      metodoAplicacion: 'Spray', fechaProgramada: MAS_3, responsable: 'u-enc'
    });
    expect(v2.status).toBe(201);

    const list = (await requestAs(app, 'u-log').get('/api/vacunaciones')).body;
    expect(list.find((v: any) => v.tipoVacuna === 'Newcastle').estado).toBe('Programada');
    expect(list.find((v: any) => v.tipoVacuna === 'Influenza Aviar').estado).toBe('Programada');
  });

  it('V2 — Aplicar la influenza: registra fecha, reacciones y próxima dosis', async () => {
    const list = (await requestAs(app, 'u-log').get('/api/vacunaciones')).body;
    const influenza = list.find((v: any) => v.tipoVacuna === 'Influenza Aviar');
    const res = await requestAs(app, 'u-log').put(`/api/vacunaciones/${influenza.id}`).send({
      estado: 'Aplicada', fechaAplicada: new Date().toISOString(), reaccionIncidencia: 'Sin reacciones', proximaFecha: MAS_3
    });
    expect(res.status).toBe(200);

    const now = (await requestAs(app, 'u-log').get('/api/vacunaciones')).body;
    expect(now.find((v: any) => v.tipoVacuna === 'Influenza Aviar').estado).toBe('Aplicada');
  });

  it('V3 — Alertas de vacunación: Newcastle sigue vencida, la aplicada ya no cuenta', async () => {
    const res = await requestAs(app, 'u-log').get('/api/vacunaciones/alertas');
    expect(res.status).toBe(200);
    expect(res.body.vencidas.map((v: any) => v.tipoVacuna)).toEqual(['Newcastle']);
    expect(res.body.totalProgramadas).toBe(1);
  });

  // ==================== FACTURAS Y TIQUETES ====================

  it('F1 — Venta y factura ya nacen juntas; la consolidación heredada evita duplicar', async () => {
    const res = await requestAs(app, 'u-log').post('/api/facturacion/consolidar-ruta')
      .set('x-user-id', 'u-jef').send({ guiaId: guiaDespachoId });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('ya fue consolidada');

    const facturas = (await requestAs(app, 'u-log').get('/api/facturas')).body;
    const notas = facturas.filter((f: any) => f.estado === 'NotaCredito');
    expect(facturas.filter((f: any) => f.estado !== 'NotaCredito')).toHaveLength(3);
    expect(notas).toHaveLength(1);
    expect(notas[0].total).toBe(PRECIO_KG * 30);

    // Cada una de las tres ventas quedó facturada en su registro; la cuarta
    // factura local es la NC simulada generada al aceptar el retorno en Bodega.
    const docs = (await requestAs(app, 'u-log').get('/api/facturacion/documentos')).body;
    expect(docs.filter((d: any) => d.tipoDocumento === 'Factura')).toHaveLength(3);
    expect(docs.filter((d: any) => d.tipoDocumento === 'NotaCredito')).toHaveLength(1);
  });

  it('F2 — DASHBOARD EMPRESARIAL con datos reales (antes del cobro): ingresos, cuentas por cobrar, alertas', async () => {
    const res = await requestAs(app, 'u-log').get('/api/dashboard/enterprise');
    expect(res.status).toBe(200);

    // Tres ventas originales menos la NC que revierte la devolución aceptada.
    expect(res.body.ingresosHoy).toBe(2 * PRECIO_KG * 30);
    // Cobrado: solo la venta de contado; la NC no simula una salida de efectivo.
    expect(res.body.ingresosCobradosHoy).toBe(PRECIO_KG * 30);
    expect(res.body.gastosHoy).toBe(50000);                               // diesel real
    expect(res.body.utilidadNeta).toBe(2 * PRECIO_KG * 30 - 50000);
    expect(res.body.cartonesProducidos).toBe(120);                        // recolección real
    expect(res.body.stockBodegaCentral).toBe(38);                         // 98 - 90 + 30 retorno
    expect(res.body.totalAvesVivas).toBe(4500);                           // aves del galerón
    expect(res.body.facturasEmitidas).toBe(4);                            // 3 facturas de venta + NC de devolución
    expect(res.body.clientesActivos).toBe(2);
    expect(res.body.rutasActivas).toBe(1);
    expect(res.body.cuentasPorCobrar).toBe(PRECIO_KG * 30);            // factura a crédito pendiente
    expect(res.body.desperdiciosHoy).toBe(1);                             // pérdida de recepción
    expect(res.body.impactoDesperdicioHoy).toBe(2 * PRECIO_KG);        // impacto financiero REAL
    expect(res.body.vacunasVencidas).toBe(1);
    expect(res.body.mantenimientosVencidos).toBe(1);
    const alertas = res.body.alertas.map((a: any) => a.tipo);
    expect(alertas).toContain('Vacuna vencida');
    expect(alertas).toContain('Mantenimiento vencido');
  });

  it('F3 — Cobro de la factura a crédito: el dashboard mueve ingresos y salda cuentas por cobrar', async () => {
    const facturas = (await requestAs(app, 'u-log').get('/api/facturas')).body;
    const docs = (await requestAs(app, 'u-log').get('/api/facturacion/documentos')).body;
    const facturaDevueltaId = docs.find((d: any) => d.tipoDocumento === 'NotaCredito')?.notasCreditoId;
    const facCred = facturas.find((f: any) => f.clienteId === cCred.id && f.estado === 'Pendiente' && f.id !== facturaDevueltaId);
    expect(facCred).toBeDefined();

    // Registrar un cobro exige sesión: la ruta ahora valida permisos, así que el
// pago va firmado y no permitido "a cualquiera" como antes.
    const res = await requestAs(app, 'u-log').post('/api/pagos').set('x-user-id', 'u-log').send({
      facturaId: facCred.id, metodoPago: 'Efectivo', monto: PRECIO_KG * 30
    });
    expect(res.status).toBe(200);
    expect(res.body.factura.estado).toBe('Pagada');

    const clientes = (await requestAs(app, 'u-log').get('/api/clientes')).body;
    expect(clientes.find((c: any) => c.id === cCred.id).saldo_pendiente).toBe(0);

    const d = (await requestAs(app, 'u-log').get('/api/dashboard/enterprise')).body;
    expect(d.ingresosHoy).toBe(2 * PRECIO_KG * 30); // devengado: las dos facturas
    // Ya cobrado: con el crédito pagado, ambas son efectivo del día.
    expect(d.ingresosCobradosHoy).toBe(2 * PRECIO_KG * 30);
    expect(d.cuentasPorCobrar).toBe(0);
    expect(d.utilidadNeta).toBe(2 * PRECIO_KG * 30 - 50000);
  });

  it('F4 — Una venta de ruta requiere devolución física; no admite nota de crédito directa', async () => {
    const facturas = (await requestAs(app, 'u-log').get('/api/facturas')).body;
    const facEfvo = facturas.find((f: any) => f.clienteId === cEfvo.id && f.estado === 'Pagada' && f.estado !== 'NotaCredito');
    expect(facEfvo).toBeDefined();

    const res = await requestAs(app, 'u-log').post('/api/facturacion/nota-credito')
      .set('x-user-id', 'u-jef').send({
      facturaIdOriginal: facEfvo.id, motivo: 'Devolución parcial por huevo quebrado', monto: 64000
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('devolución física');

    const docs = (await requestAs(app, 'u-log').get('/api/facturacion/documentos')).body;
    expect(docs.some((d: any) => d.tipoDocumento === 'NotaCredito' && d.notasCreditoId === facEfvo.id)).toBe(false);
  });

  it('GOLDEN — Snapshot final de dashboards con valores exactos y guard anti-desperdicio en 0', async () => {
    // Desperdicios: guard anti-regresión — ningún desperdicio de sistema con impactoFinanciero en 0
    // (si el producto tiene precio activo, el impacto SIEMPRE debe computarse, nunca hardcodearse).
    const desperdicios = (await requestAs(app, 'u-log').get('/api/desperdicios')).body;
    expect(desperdicios).toHaveLength(1);
    for (const d of desperdicios) {
      expect(d.impactoFinanciero).toBeGreaterThan(0);
    }
    expect(desperdicios[0]).toMatchObject({ cantidad: 2, impactoFinanciero: 2 * PRECIO_KG });

    // Dashboard empresarial: snapshot inmutable tras el flujo completo
    const d = (await requestAs(app, 'u-log').get('/api/dashboard/enterprise')).body;
    // Solo se netea la devolución física aceptada; el test anterior confirma
    // que una venta de ruta no admite NC directa sin validar el retorno.
    expect(d.ingresosHoy).toBe(2 * PRECIO_KG * 30);           // devengado del día
    expect(d.gastosHoy).toBe(50000);
    expect(d.utilidadNeta).toBe(2 * PRECIO_KG * 30 - 50000);
    expect(d.cartonesProducidos).toBe(120);
    expect(d.stockBodegaCentral).toBe(38);
    expect(d.totalAvesVivas).toBe(4500);
    expect(d.facturasEmitidas).toBe(4);                            // 3 facturas de venta + NC de devolución física
    expect(d.clientesActivos).toBe(2);
    expect(d.rutasActivas).toBe(1);
    expect(d.cuentasPorCobrar).toBe(0);
    expect(d.desperdiciosHoy).toBe(1);
    expect(d.impactoDesperdicioHoy).toBe(2 * PRECIO_KG);

    // Guía consolidada: el estado lógico de la API es 'Cerrada' (no depende del campo columna)
    const guias = (await requestAs(app, 'u-log').get('/api/logistica/guias')).body;
    const cerrada = guias.find((g: any) => g.id === guiaDespachoId);
    expect(cerrada.estado).toBe('Cerrada');
    expect(cerrada.estadoLogico).toBe('Cerrada');
  });
});
