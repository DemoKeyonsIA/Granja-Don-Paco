import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { requestAs } from './helpers/request-as';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
const authRequest = () => requestAs(app, 'u-log');
let client: any;
const DB_PATH = path.resolve(process.cwd(), '.test-e2e-ciclo.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);

  // Actores del proceso
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

  const testDb = drizzle(client, { schema });
  await testDb.insert(schema.productosCatalogo).values({
    id: 'prod-huevo-grande', nombre: 'Huevos - Grande', descripcion: 'Huevo vendido por peso',
    unidad: 'kg', kgPorCarton: 1.9, precioBase: 1000, categoria: 'Huevos', estado: 'Activo',
    fechaCreacion: new Date().toISOString(),
  });
  await testDb.insert(schema.listas_precios).values({ id: 'lista-kg', nombre: 'Precio general por kg', tipo: 'Global', estado: 'Activa', fechaInicio: '2026-01-01' });
  await testDb.insert(schema.precios_detalle).values({ id: 'precio-kg', listaId: 'lista-kg', producto: 'Huevos - Grande', precioUnitario: 1000, precioMinimo: 900, precioMaximo: 1100, descuentoMaximo: 0, unidad: 'kg' });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

const PRECIO_KG = 1000;

async function getInventario() {
  return (await authRequest().get('/api/inventario')).body;
}

async function getEtiquetas() {
  return (await authRequest().get('/api/etiquetas')).body;
}

describe('E2E — CUSTODIA COMPLETA DEL HUEVO: del cartón en el galerón hasta la confirmación del retorno en bodega', () => {
  let granjaId: string;
  let galeronId: string;
  let rutaId: string;
  let camionId: string;
  let clienteEfvoId: string;
  let clienteCreditoId: string;
  let guiaRemisionId: string;
  let guiaDespachoId: string;
  let eA: any;
  let eB: any;
  let eC: any;
  let venta1: any;
  let venta2: any;

  it('P0 — Prepara el mundo: granja+galerón, lote, rutas, clientes y camión', async () => {
    await authRequest().post('/api/granjas/wizard').send({
      nombre: 'Granja Ciclo E2E',
      ubicacion: 'Heredia, CR',
      tipo_produccion: 'Postura',
      encargadoId: 'u-enc',
      galerones: [{ nombre: 'Galerón Norte', capacidad_maxima: 5000 }]
    }).expect(201);

    const granjas = (await authRequest().get('/api/granjas')).body;
    const g = granjas.find((x: any) => x.nombre === 'Granja Ciclo E2E');
    expect(g).toBeDefined();
    granjaId = g.id;

    const galerones = (await authRequest().get('/api/galerones')).body;
    const gal = galerones.find((x: any) => x.granjaId === granjaId);
    expect(gal).toBeDefined();
    galeronId = gal.id;

    const loteRes = await authRequest().post('/api/lotes').send({
      galeronId, fecha_ingreso: new Date().toISOString(),
      cantidad_inicial: 4500, linea_genetica: 'Hy-Line Brown', estado: 'Activo'
    });
    expect(loteRes.status).toBe(200);

    const rutaRes = await authRequest().post('/api/rutas').send({ nombre: 'Ruta Heredia Norte', vendedor_asignado: 'u-ven' });
    expect(rutaRes.status).toBe(201);
    const rutas = (await authRequest().get('/api/rutas')).body;
    rutaId = rutas.find((r: any) => r.nombre === 'Ruta Heredia Norte').id;

    const c1 = await authRequest().post('/api/clientes').send({ nombre: 'Pulpería El Valle', ruta: 'Ruta Heredia Norte', condicion_pago: 'Contado' });
    clienteEfvoId = c1.body.id;
    const c2 = await authRequest().post('/api/clientes').send({ nombre: 'Supermercado La Aurora', ruta: 'Ruta Heredia Norte', condicion_pago: 'Credito', limite_credito: 500000 });
    clienteCreditoId = c2.body.id;

    const cam = await authRequest().post('/api/logistica/camiones').send({
      nombre: 'Camión 23', placa: 'CR-023', ruta_defecto: 'Ruta Heredia Norte',
      vendedor_id: 'u-ven', camionero_id: 'u-ven', capacidad_cartones: 200
    });
    expect(cam.status).toBe(201);
    camionId = cam.body.id;
  });

  it('E1 — El ENCARGADO DE GALERÓN registra los cartones recolectados en el galerón', async () => {
    const res = await authRequest()
      .post('/api/produccion/recoleccion')
      .send({ galeron: 'Galerón Norte', detalles: [{ tamano: 'Grande', cantidadKg: 120 }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const inv = await getInventario();
    const granja = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja');
    expect(granja).toBeDefined();
    expect(granja).toMatchObject({ cantidad: 120, unidad: 'kg' });

    const mov = (await authRequest().get('/api/inventario/movimientos')).body;
    expect(mov.some((m: any) => m.tipo === 'Entrada Producción' && m.cantidad === 120 && m.unidad === 'kg')).toBe(true);
  });

  it('E2 — El ENCARGADO DE GALERÓN emite la remisión hacia bodega', async () => {
    const res = await authRequest()
      .post('/api/operaciones/remision')
      .send({ granjaId, producto: 'Huevos - Grande', cantidadKg: 100, lote: 'L-CICLO-01', responsable: 'u-enc', transporte: 'Camión 23' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja')).toMatchObject({ cantidad: 20, unidad: 'kg' });
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'EnTransito')).toMatchObject({ cantidad: 100, unidad: 'kg' });
  });

  it('E3 — El JEFE DE BODEGA recibe la remisión: conteo + báscula, diferencia controlada', async () => {
    const list = (await authRequest().get('/api/operaciones/remisiones')).body;
    const guia = list.find((g: any) => g.cantidadKgEsperada === 100 && g.unidad === 'kg');
    expect(guia).toBeDefined();
    expect(guia.estado).toBe('EnTransito');
    expect(guia.consecutivo).toMatch(/^GR-/);
    guiaRemisionId = guia.id;

    const res = await authRequest()
      .post('/api/operaciones/recepcion-remision')
      .send({
        guiaId: guia.id, cantidadKg: 98, pesoBruto: 98,
        motivoDiferencia: '2 kg de huevo quebrado en traslado', responsable: 'u-jef'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const inv = await getInventario();
    // La diferencia controlada (2) salió del tránsito como pérdida: ya no hay stock fantasma EnTransito
    const transito = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'EnTransito');
    expect(transito).toBeUndefined();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central')).toMatchObject({ cantidad: 98, unidad: 'kg' });

    // El kárdex registra la pérdida en tránsito (se equilibra con el desperdicio)
    const mov = (await authRequest().get('/api/inventario/movimientos')).body;
    const perdida = mov.find((m: any) => m.tipo === 'Pérdida en Tránsito' && m.cantidad === 2 && m.unidad === 'kg');
    expect(perdida).toBeDefined();

    // La diferencia (2) queda controlada como desperdicio de recepción
    const desp = (await authRequest().get('/api/desperdicios')).body;
    const d = desp.find((x: any) => x.cantidad === 2);
    expect(d).toBeDefined();
    expect(d.origen).toMatch(/^Remisión GR-/);
    expect(d.motivo).toContain('huevo quebrado');
  });

  it('E4 — El BODEGUERO alista galerones: nace la etiqueta QR (identidad del cartón)', async () => {
    const res = await authRequest()
      .post('/api/operaciones/alistamiento')
      .send({
        guiaId: guiaRemisionId, producto: 'Huevos - Grande', cantidadKg: 90, kgPorEtiqueta: 30, unidad: 'kg',
        granjaOrigen: 'Granja Ciclo E2E', lote: 'L-CICLO-01', clasificacion: 'Grado A',
        pesoBruto: 90, responsable: 'u-bod'
      });
    expect(res.status).toBe(201);
    expect(res.body.etiquetas).toHaveLength(3);

    const etiq = await getEtiquetas();
    const nuevas = etiq.filter((e: any) => e.estado === 'EnBodega' && e.lote === 'L-CICLO-01');
    expect(nuevas).toHaveLength(3);
    expect(nuevas.every((e: any) => e.cantidad === 30 && e.unidad === 'kg')).toBe(true);
    expect(nuevas.every((e: any) => e.ubicacionActual === 'Bodega Central')).toBe(true);
    expect(nuevas.every((e: any) => e.guiaRemisionId === guiaRemisionId)).toBe(true);
    [eA, eB, eC] = nuevas;

    const rems = (await authRequest().get('/api/operaciones/remisiones')).body;
    expect(rems.find((g: any) => g.id === guiaRemisionId).estado).toBe('Alistada');
    for (const etiqueta of [eA, eB]) {
      await authRequest().post(`/api/etiquetas/${etiqueta.id}/peso-neto`)
        .send({ pesoKg: 30, origen: 'Manual' }).expect(200);
    }
  });

  it('E5 — LOGÍSTICA carga el camión en bodega (guía de despacho)', async () => {
    const res = await authRequest()
      .post('/api/logistica/guias')
      .set('x-user-id', 'u-log')
      .send({
        camionId, rutaId, etiquetasIds: [eA.id, eB.id],
        responsablesCarga: 'u-bod', responsableTransporte: 'u-cam', pesoSalida: 60
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);

    const guias = (await authRequest().get('/api/logistica/guias')).body;
    const guia = guias.find((g: any) => g.camionId === camionId && g.estado === 'Cargada');
    expect(guia).toBeDefined();
    guiaDespachoId = guia.id;
    expect(guia.totalKg).toBe(60);
    expect(guia.camionNombre).toBe('Camión 23');
    expect(guia.totalEtiquetas).toBe(2);

    const etiq = await getEtiquetas();
    const ea = etiq.find((e: any) => e.id === eA.id);
    const eb = etiq.find((e: any) => e.id === eB.id);
    const ec = etiq.find((e: any) => e.id === eC.id);
    expect(ea).toMatchObject({ estado: 'Cargada', ubicacionActual: 'Camión 23' });
    expect(eb).toMatchObject({ estado: 'Cargada', ubicacionActual: 'Camión 23' });
    expect(ec.estado).toBe('EnBodega');

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central')).toMatchObject({ cantidad: 38, unidad: 'kg' });
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 23')).toMatchObject({ cantidad: 60, unidad: 'kg' });

    const mov = (await authRequest().get('/api/inventario/movimientos')).body;
    expect(mov.some((m: any) => m.tipo === 'Carga Camión' && m.referencia_id === guiaDespachoId)).toBe(true);
  });

  it('E6 — El CAMIONERO confirma la salida: la guía pasa a EnRuta', async () => {
    const res = await authRequest()
      .post(`/api/logistica/guias/${guiaDespachoId}/marcar-en-ruta`)
      .set('x-user-id', 'u-ven');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const guias = (await authRequest().get('/api/logistica/guias')).body;
    expect(guias.find((g: any) => g.id === guiaDespachoId).estado).toBe('EnRuta');
  });

  it('E7 — El VENDEDOR entrega en ruta: TQ-0001 efectivo (etiqueta A) y TQ-0002 crédito (etiqueta B)', async () => {
    const v1 = await authRequest()
      .post('/api/logistica/caja/venta')
      .set('x-user-id', 'u-ven')
      .send({
        guiaId: guiaDespachoId, clienteId: clienteEfvoId, etiquetaId: eA.id,
        producto: 'Huevos - Grande', cantidadKg: 30, precioUnitario: PRECIO_KG, cobro: 'Efectivo'
      });
    expect(v1.status).toBe(201);
    expect(v1.body.tiqueteConsecutivo).toBe('TQ-0001');
    expect(v1.body.etiquetaId).toBe(eA.id);
    venta1 = v1.body;

    const v2 = await authRequest()
      .post('/api/logistica/caja/venta')
      .set('x-user-id', 'u-ven')
      .send({
        guiaId: guiaDespachoId, clienteId: clienteCreditoId, etiquetaId: eB.id,
        producto: 'Huevos - Grande', cantidadKg: 30, precioUnitario: PRECIO_KG, cobro: 'Credito'
      });
    expect(v2.status).toBe(201);
    expect(v2.body.tiqueteConsecutivo).toBe('TQ-0002');
    venta2 = v2.body;

    const etiq = await getEtiquetas();
    expect(etiq.find((e: any) => e.id === eA.id).estado).toBe('Entregada');
    expect(etiq.find((e: any) => e.id === eB.id).estado).toBe('Entregada');

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 23').cantidad).toBe(0);

    const clientes = (await authRequest().get('/api/clientes')).body;
    expect(clientes.find((c: any) => c.id === clienteCreditoId).saldo_pendiente).toBe(PRECIO_KG * 30);
  });

  it('E8 — El cliente devuelve el pedido a crédito (TQ-0002): el VENDEDOR registra la devolución', async () => {
    const res = await authRequest()
      .post('/api/logistica/caja/devolucion')
      .set('x-user-id', 'u-ven')
      .send({ guiaId: guiaDespachoId, etiquetaId: eB.id, ventaRutaId: venta2.ventaId, cantidadKg: 30, responsable: 'u-ven' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.tiqueteAnulado).toBe('TQ-0002');

    const etiq = await getEtiquetas();
    expect(etiq.find((e: any) => e.id === eB.id)).toMatchObject({ estado: 'Retornada', ubicacionActual: 'Camión 23' });

    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 23')).toMatchObject({ cantidad: 30, unidad: 'kg' });

    const clientes = (await authRequest().get('/api/clientes')).body;
    expect(clientes.find((c: any) => c.id === clienteCreditoId).saldo_pendiente).toBe(0);

    const ret = await client.execute({ sql: `SELECT estado, cartones FROM retornos_camion WHERE guia_id = ?`, args: [guiaDespachoId] });
    expect(ret.rows).toHaveLength(1);
    expect(ret.rows[0].estado).toBe('PendienteBodega');
    expect(ret.rows[0].cartones).toBe(30);
  });

  it('E9 — El VENDEDOR cierra la caja del día en ruta', async () => {
    const res = await authRequest()
      .post('/api/logistica/caja/fin-dia')
      .send({ guiaId: guiaDespachoId, responsable: 'u-ven' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CajaCerrada');
    expect(res.body.cuadre.tiquetesEmitidos).toBe(1);
    expect(res.body.cuadre.tiquetesAnulados).toBe(1);
    expect(res.body.cuadre.cartonesVendidos).toBe(30);
    expect(res.body.cuadre.cartonesRetornados).toBe(30);
    expect(res.body.cuadre.restanteCamion).toBe(30);
    expect(res.body.cuadre.mermaPreliminar).toBe(0);
    expect(res.body.cuadre.totalEfectivo).toBe(PRECIO_KG * 30);
  });

  it('E10 — El JEFE DE BODEGA cuadra en central (preview sin mutar): retorna pendiente requiere aceptación', async () => {
    const res = await authRequest().get(`/api/logistica/cuadre-central?guiaId=${guiaDespachoId}`).set('x-user-id', 'u-jef');
    expect(res.status).toBe(200);
    expect(res.body.puedeCuadrar).toBe(false);
    expect(res.body.requiereAprobacion).toBe(true);

    const c = res.body.cuadre;
    expect(c.cargado).toBe(60);
    expect(c.vendidos).toBe(30);
    expect(c.retornados).toBe(30);
    expect(c.retornoPendiente).toBe(30);
    expect(c.tieneRetornosPendientes).toBe(true);
    expect(c.cartonesReingresar).toBe(30);
    expect(c.restanteCamion).toBe(30);
    expect(c.merma).toBe(0);
    expect(c.efectivo).toBe(PRECIO_KG * 30);
    expect(c.detalleRetornos).toHaveLength(1);
    expect(c.etiquetasReingresar.map((e: any) => e.etiquetaId)).toEqual([eB.id]);
  });

  it('E11 — BODEGA acepta el retorno y luego el JEFE DE BODEGA cuadra la guía', async () => {
    const pendientes = await authRequest().get(`/api/logistica/retornos/pendientes?guiaId=${guiaDespachoId}`);
    const retornoId = pendientes.body[0]?.id;
    const aceptacion = await authRequest().post('/api/logistica/bodega/retorno/aceptar')
      .set('x-user-id', 'u-bod').send({ retornoId, responsable: 'u-bod', cantidadAceptada: 30, peso: 30 });
    expect(aceptacion.status).toBe(200);
    const res = await authRequest()
      .post('/api/logistica/cuadre-central')
      .set('x-user-id', 'u-jef')
      .send({ guiaId: guiaDespachoId, responsable: 'u-jef', pesoLlegada: 30 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('Cerrada');
    expect(res.body.message).toContain('retornos conciliados');
    expect(res.body.retornosRecibidos).toBe(1);
    expect(res.body.etiquetasReingresadas).toBe(0);
    expect(res.body.desperdicios).toHaveLength(0);
    expect(res.body.aprobacion).toBeNull();

    // Etiqueta devuelta reingresa a la bodega
    const etiq = await getEtiquetas();
    expect(etiq.find((e: any) => e.id === eB.id)).toMatchObject({ estado: 'EnBodega', ubicacionActual: 'Bodega Central' });

    // Retorno confirmado con peso de llegada (aceptado por Bodega en el mismo cuadre)
    const ret = await client.execute({ sql: `SELECT estado, peso FROM retornos_camion WHERE guia_id = ?`, args: [guiaDespachoId] });
    expect(ret.rows[0].estado).toBe('AceptadoBodega');
    expect(ret.rows[0].peso).toBe(30);

    // Inventario en kg: bodega 22.8 restantes + 18 kg aceptados = 40.8 kg
    const inv = await getInventario();
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión 23').cantidad).toBe(0);
    expect(inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central')).toMatchObject({ cantidad: 68, unidad: 'kg' });

    // Guía cerrada y reconciliada
    const guias = (await authRequest().get('/api/logistica/guias')).body;
    expect(guias.find((g: any) => g.id === guiaDespachoId).estado).toBe('Cerrada');

    // Solo queda el desperdicio controlado de la recepción (2 ct); el cuadre no generó merma
    const desp = (await authRequest().get('/api/desperdicios')).body;
    expect(desp).toHaveLength(1);
    expect(desp[0].cantidad).toBe(2);
  });

  it('T1 — Cadena de custodia: la etiqueta devuelta (B) registra todos los eventos con su actor', async () => {
    const res = await authRequest().get(`/api/etiquetas/trazabilidad/${encodeURIComponent(eB.codigoUnico)}`);
    expect(res.status).toBe(200);
    expect(res.body.etiqueta.codigoUnico).toBe(eB.codigoUnico);

    const trazas = res.body.traza.map((t: any) => ({ evento: t.tipoEvento, usuario: t.usuarioId, ubicacion: t.ubicacion }));
    expect(trazas.map((t: any) => t.evento)).toEqual(['Alistamiento', 'Pesada', 'Cargada', 'Entregada', 'Retornada', 'RetornoAceptadoBodega']);
    expect(trazas[0].usuario).toBe('u-bod');    // bodeguero alistó
    expect(trazas[2].usuario).toBe('u-log');    // logística cargó
    expect(trazas[3].usuario).toBe('u-ven');    // comercial entregó
    expect(trazas[4].usuario).toBe('u-ven');    // comercial registró devolución
    expect(trazas[5].usuario).toBe('u-bod');    // bodeguero aceptó físicamente el retorno
    expect(trazas[5].ubicacion).toBe('Bodega Central');
    expect(res.body.guia).toBeTruthy();
    expect(res.body.guia.consecutivo).toMatch(/^GR-/);

    // El despacho (GD-) que transportó la etiqueta queda expuesto en la trazabilidad
    expect(res.body.despacho).toBeTruthy();
    expect(res.body.despacho.consecutivo).toMatch(/^GD-/);
    expect(res.body.despacho.camion.nombre).toBe('Camión 23');
    expect(res.body.despacho.ruta.nombre).toBe('Ruta Heredia Norte');
    expect(res.body.despacho.estado).toBe('Cerrada');
  });

  it('T2 — Cadena de custodia: la etiqueta vendida (A) se detiene en Entregada', async () => {
    const res = await authRequest().get(`/api/etiquetas/trazabilidad/${encodeURIComponent(eA.codigoUnico)}`);
    expect(res.status).toBe(200);
    const trazas = res.body.traza.map((t: any) => t.tipoEvento);
    expect(trazas).toEqual(['Alistamiento', 'Pesada', 'Cargada', 'Entregada']);
  });

  it('T3 — El kárdex de inventario registra la cadena completa de movimientos', async () => {
    const mov = (await authRequest().get('/api/inventario/movimientos')).body;
    const tipos = [...new Set(mov.map((m: any) => m.tipo))];
    expect(tipos).toContain('Entrada Producción');
    expect(tipos).toContain('Remisión');
    expect(tipos).toContain('Pérdida en Tránsito');
    expect(tipos).toContain('Recepción Bodega');
    expect(tipos).toContain('Carga Camión');
    expect(tipos).toContain('Venta');
    expect(tipos).toContain('Retorno Camión');
  });

  it('T4 — El control de pesos queda conectado en cada punto de custodia', async () => {
    const res = await authRequest().get('/api/pesos');
    expect(res.status).toBe(200);
    const pesos: any[] = res.body;

    const tipos = pesos.map((p: any) => p.tipoReferencia);
    expect(tipos).toContain('Recepción de Remisión');
    expect(tipos).toContain('Alistamiento');
    expect(tipos).toContain('Carga Camión');
    expect(tipos).toContain('Cuadre Central');

    // Recepción: conteo de 98 cartones y peso real de 58.8 kg
    const recep = pesos.find((p: any) => p.tipoReferencia === 'Recepción de Remisión');
    expect(recep.pesoReal).toBe(98);
    expect(recep.cantidadUnidades).toBe(98);

    // Alistamiento: peso del lote alistado
    expect(pesos.find((p: any) => p.tipoReferencia === 'Alistamiento').pesoReal).toBe(90);

    // Carga: peso andén (3 etiquetas × 18) vs báscula de salida → conforme
    const carga = pesos.find((p: any) => p.tipoReferencia === 'Carga Camión');
    expect(carga.pesoEsperado).toBe(60);
    expect(carga.pesoReal).toBe(60);
    expect(carga.estado).toBe('Conforme');

    // Cuadre central: pesoSalida (36) vs pesoLlegada (28.5) → bandera de diferencia real
    const cuadre = pesos.find((p: any) => p.tipoReferencia === 'Cuadre Central');
    expect(cuadre.pesoEsperado).toBe(60);
    expect(cuadre.pesoReal).toBe(30);
    expect(cuadre.estado).toBe('ConDiferencia');
  });
});
