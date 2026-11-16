import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { requestAs } from './helpers/request-as';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { hashPassword } from '../src/lib/password';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

let app: Express;
let client: any;
const state: any = {};
const DB_PATH = path.resolve(process.cwd(), '.test-e2e-smoke.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);

  const pHash = hashPassword('1234');
  const users = [
    ['1', 'Administrador', 'admin@granja.com', 'Admin'],
    ['2', 'Facturador Central', 'facturacion@granja.com', 'Facturador'],
    ['3', 'Vendedor Ruta', 'vendedor@granja.com', 'Vendedor'],
    ['6', 'Socio Inversor', 'socio@granja.com', 'Socio'],
    ['7', 'Bodeguero', 'bodega@granja.com', 'Bodeguero'],
    ['8', 'Despachador', 'despacho@granja.com', 'Despachador'],
    ['9', 'Camionero Demo', 'camionero@granja.com', 'Camionero'],
  ] as const;
  for (const [id, name, email, role] of users) {
    await client.execute({ sql: `INSERT INTO users (id, name, email, role, password_hash, activo) VALUES (?,?,?,?,?,1)`, args: [id, name, email, role, pHash] });
  }

  await client.execute({ sql: `INSERT INTO granjas (id, nombre, ubicacion, encargado_id) VALUES (?,?,?,?)`, args: ['g1', 'Granja Principal', 'Heredia', '1'] });
  await client.execute({ sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?,?,?,?,?,?)`, args: ['i-granja', 'Huevos - Grande', 400, 'kg', 'Granja', new Date().toISOString()] });
  await client.execute({ sql: `INSERT INTO clientes (id, nombre, documento_id, ruta, condicion_pago, estado, limite_credito, saldo_pendiente, latitud, longitud) VALUES (?,?,?,?,?,?,?,?,?,?)`, args: ['c1', 'Cliente A', '1-101-101', 'R1', 'Contado', 'Activo', 0, 0, 10.05, -84.15] });
  await client.execute({ sql: `INSERT INTO clientes (id, nombre, documento_id, ruta, condicion_pago, estado, limite_credito, saldo_pendiente, latitud, longitud) VALUES (?,?,?,?,?,?,?,?,?,?)`, args: ['c2', 'Cliente B', '2-202-202', 'R1', 'Credito', 'Activo', 5000000, 0, 10.15, -84.05] });
  await client.execute({ sql: `INSERT INTO rutas (id, nombre, cliente_ids, centroide_lat, centroide_lng, capacidad_max_cartones, estado) VALUES (?,?,?,?,?,?,?)`, args: ['r1', 'Ruta 1', JSON.stringify(['c1', 'c2']), 10.1, -84.1, 500, 'Activa'] });
  await client.execute({ sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?,?,?,?,?,?,?,?)`, args: ['p1', 'Huevos - Grande', '', 'kg', 16000, 'Huevos', 'Activo', new Date().toISOString()] });
  await client.execute({ sql: `UPDATE productos_catalogo SET unidad = 'kg' WHERE id = 'p1'` });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

const costo = (n: number) => n * 16000;

describe('E2E SMOKE — ciclo completo con login real (F0→F4)', () => {
  // ===================== F0 — Autenticación real =====================
  it('0.0 Los siete perfiles de demostración pueden iniciar sesión', async () => {
    const cuentas = [
      ['admin@granja.com', 'Admin'],
      ['facturacion@granja.com', 'Comercial'],
      ['vendedor@granja.com', 'Comercial'],
      ['socio@granja.com', 'Socio'],
      ['bodega@granja.com', 'Bodeguero'],
      ['despacho@granja.com', 'Despachador'],
      ['camionero@granja.com', 'Comercial'],
    ] as const;

    for (const [email, role] of cuentas) {
      const res = await requestAs(app, '1').post('/api/auth/login').send({ email, password: '1234' });
      expect(res.status, `login de ${email}`).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.role).toBe(role);
    }
  });

  it('0.1 Login real admin → token, /auth/me OK, login incorrecto 401', async () => {
    const res = await requestAs(app, '1').post('/api/auth/login').send({ email: 'admin@granja.com', password: '1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ id: '1', role: 'Admin' });
    state.token = res.body.token;

    const me = await requestAs(app, '1').get('/api/auth/me').set('Authorization', `Bearer ${state.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('admin@granja.com');

    const bad = await requestAs(app, '1').post('/api/auth/login').send({ email: 'admin@granja.com', password: 'mala' });
    expect(bad.status).toBe(401);
  });

  // ===================== F1 — Granja → Bodega → Etiquetas =====================
  it('1.1 Remisión granja: stock Granja → EnTransito', async () => {
    const res = await requestAs(app, '1').post('/api/operaciones/remision')
      .send({ granjaId: 'g1', producto: 'Huevos - Grande', cantidadKg: 120, responsable: 'Bodeguero', transporte: 'Camión' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const inv = await requestAs(app, '1').get('/api/inventario');
    expect(inv.body.find((i: any) => i.ubicacion === 'Granja' && i.producto === 'Huevos - Grande').cantidad).toBe(280);
    expect(inv.body.find((i: any) => i.ubicacion === 'EnTransito' && i.producto === 'Huevos - Grande').cantidad).toBe(120);
  });

  it('1.2 Recepción conforme → Bodega Central, guía Recibida', async () => {
    const list = await requestAs(app, '1').get('/api/operaciones/remisiones');
    state.remision = list.body.find((g: any) => g.granjaId === 'g1' && g.estado === 'EnTransito');
    expect(state.remision.consecutivo).toMatch(/^GR-\d{8}-/);

    const res = await requestAs(app, '1').post('/api/operaciones/recepcion-remision')
      .send({ guiaId: state.remision.id, cantidadKg: 120, pesoBruto: 72, responsable: 'Bodeguero' });
    expect(res.status).toBe(200);

    const inv = await requestAs(app, '1').get('/api/inventario');
    expect(inv.body.find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevos - Grande').cantidad).toBe(120);
    const updated = await requestAs(app, '1').get('/api/operaciones/remisiones');
    expect(updated.body.find((g: any) => g.id === state.remision.id).estado).toBe('Recibida');
  });

  it('1.3 Alistamiento → 2 etiquetas EnBodega, QR real PNG y trazabilidad con custodia', async () => {
    const res = await requestAs(app, '1').post('/api/operaciones/alistamiento')
      .send({ guiaId: state.remision.id, producto: 'Huevos - Grande', cantidadKg: 60, kgPorEtiqueta: 30, granjaOrigen: 'Granja Principal', lote: 'L-01', clasificacion: 'Grado A', pesoBruto: 36, responsable: 'Bodeguero' });
    expect(res.status).toBe(201);
    expect(res.body.etiquetas).toHaveLength(2);
    state.etiq = res.body.etiquetas;

    const etiq = await requestAs(app, '1').get('/api/etiquetas');
    const enBodega = etiq.body.filter((e: any) => e.estado === 'EnBodega');
    expect(enBodega).toHaveLength(2);
    expect(enBodega.every((e: any) => e.codigoUnico.includes('BOD'))).toBe(true);

    const qr = await requestAs(app, '1').get(`/api/etiquetas/${encodeURIComponent(enBodega[0].codigoUnico)}/qr.png`);
    expect(qr.status).toBe(200);
    expect(qr.headers['content-type']).toContain('image/png');
    expect(qr.body.length).toBeGreaterThan(100);

    const traza = await requestAs(app, '1').get(`/api/etiquetas/trazabilidad/${encodeURIComponent(enBodega[0].codigoUnico)}`);
    expect(traza.status).toBe(200);
    expect(traza.body.traza.length).toBeGreaterThanOrEqual(1);
    expect(traza.body.guia.consecutivo).toMatch(/^GR-/);
  });

  // ===================== F2 — Despacho con guía =====================
  it('2.1 Crear camión + guía de 60 cartones con orden de ruta', async () => {
    const cam = await requestAs(app, '1').post('/api/logistica/camiones')
      .send({ nombre: 'Camion Smoke', placa: 'CR-999', ruta_defecto: 'Ruta 1', vendedor_id: '1', capacidad_cartones: 150 });
    expect(cam.status).toBe(201);
    state.camion = cam.body;

    const gu = await requestAs(app, '1').post('/api/logistica/guias')
      .send({ camionId: state.camion.id, rutaId: 'r1', etiquetasIds: state.etiq.map((e: any) => e.id), responsablesCarga: 'Bodeguero', responsableTransporte: 'Vendedor' });
    expect(gu.status).toBe(201);

    const list = await requestAs(app, '1').get('/api/logistica/guias');
    state.guia = list.body.find((g: any) => g.camionId === state.camion.id);
    expect(state.guia.totalKg).toBe(60);
    expect(state.guia.consecutivo).toMatch(/^GD-/);

    const det = await requestAs(app, '1').get(`/api/logistica/guias/${state.guia.id}`);
    expect(det.status).toBe(200);
    expect(det.body.rutaOrden).toHaveLength(2);
    expect(det.body.detalle).toHaveLength(2);

    const activas = await requestAs(app, '1').get('/api/logistica/guias-activas');
    expect(activas.body.some((g: any) => g.id === state.guia.id)).toBe(true);
  });

  // ===================== F3 — Caja del vendedor =====================
  it('3.1 Ventas: TQ-0001 efectivo (c1) y TQ-0002 crédito (c2), descuento del camión', async () => {
    const v1 = await requestAs(app, '1').post('/api/logistica/caja/venta')
      .send({ guiaId: state.guia.id, clienteId: 'c1', etiquetaId: state.etiq[0].id, producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Efectivo' });
    expect(v1.status).toBe(201);
    expect(v1.body.tiqueteConsecutivo).toBe('TQ-0001');
    expect(v1.body.total).toBe(costo(30));
    state.v1 = v1.body;

    const v2 = await requestAs(app, '1').post('/api/logistica/caja/venta')
      .send({ guiaId: state.guia.id, clienteId: 'c2', etiquetaId: state.etiq[1].id, producto: 'Huevos - Grande', cantidadKg: 30, cobro: 'Credito' });
    expect(v2.status).toBe(201);
    expect(v2.body.tiqueteConsecutivo).toBe('TQ-0002');
    state.v2 = v2.body;

    const inv = await requestAs(app, '1').get('/api/inventario');
    expect(inv.body.find((i: any) => i.ubicacion === 'Camion Smoke' && i.producto === 'Huevos - Grande').cantidad).toBe(0);
  });

  it('3.2 Tablero en vivo: avance, horas, sin saltos de secuencia', async () => {
    const res = await requestAs(app, '1').get('/api/logistica/tablero');
    expect(res.status).toBe(200);
    const linea = res.body.guias.find((g: any) => g.guiaId === state.guia.id);
    expect(linea).toBeTruthy();
    expect(linea.cartonesVendidos).toBe(60);
    expect(linea.tiquetesEmitidos).toBe(2);
    expect(linea.tiquetesAnulados).toBe(0);
    expect(linea.totalEfectivo).toBe(costo(30));
    expect(linea.totalCredito).toBe(costo(30));
    expect(linea.saltosSecuencia.length).toBe(0);
    expect(linea.clientesAtendidos).toHaveLength(2);
    expect(linea.clientesAtendidos[0].hora).toBeTruthy();
  });

  it('3.3 Devolución TQ-0002 y fin de día (bloquea ventas, cuadre provisional)', async () => {
    const dev = await requestAs(app, '1').post('/api/logistica/caja/devolucion')
      .send({ guiaId: state.guia.id, etiquetaId: state.v2.etiquetaId, ventaRutaId: state.v2.ventaId, responsable: 'Vendedor' });
    expect(dev.status).toBe(201);
    expect(dev.body.tiqueteAnulado).toBe('TQ-0002');

    const etiq = await requestAs(app, '1').get('/api/etiquetas');
    expect(etiq.body.find((e: any) => e.id === state.etiq[1].id).estado).toBe('Retornada');

    const fd = await requestAs(app, '1').post('/api/logistica/caja/fin-dia')
      .send({ guiaId: state.guia.id, responsable: 'Vendedor' });
    expect(fd.status).toBe(200);
    expect(fd.body.estado).toBe('CajaCerrada');
    expect(fd.body.cuadre).toMatchObject({ tiquetesEmitidos: 1, tiquetesAnulados: 1, cartonesVendidos: 30, cartonesRetornados: 30, mermaPreliminar: 0, totalEfectivo: costo(30) });

    const venta = await requestAs(app, '1').post('/api/logistica/caja/venta')
      .send({ guiaId: state.guia.id, clienteId: 'c1', etiquetaId: state.etiq[0].id, producto: 'Huevos - Grande', cantidadKg: 1, precioUnitario: 16000, cobro: 'Efectivo' });
    expect(venta.status).toBe(409);
  });

  // ===================== F4 — Cuadre central + facturación =====================
  it('4.1 Preview del cuadre doble (cartones y dinero) sin mutar', async () => {
    const res = await requestAs(app, '1').get(`/api/logistica/cuadre-central?guiaId=${state.guia.id}`).set('Authorization', `Bearer ${state.token}`);
    expect(res.status).toBe(200);
    expect(res.body.requiereAprobacion).toBe(true);
    expect(res.body.puedeCuadrar).toBe(false);
    expect(res.body.cuadre).toMatchObject({
      cargado: 60, vendidos: 30, retornados: 30, cartonesReingresar: 30, restanteCamion: 30,
      merma: 0, descuadreFisico: 0, efectivo: costo(30), credito: 0, totalGenerado: costo(30)
    });
    expect(res.body.cuadre.detalleRetornos).toHaveLength(1);
  });

  it('4.2 Cuadre central: guía Cerrada, retorno con peso, etiquetas e inventario reingresados, camión liberado', async () => {
    const retornos = await requestAs(app, '1').get(`/api/logistica/retornos/pendientes?guiaId=${state.guia.id}`);
    const retorno = (Array.isArray(retornos.body) ? retornos.body : retornos.body.retornos)[0];
    const aceptacion = await requestAs(app, '1').post('/api/logistica/bodega/retorno/aceptar')
      .set('x-user-id', '7').send({ retornoId: retorno.id, responsable: 'Bodeguero' });
    expect(aceptacion.status).toBe(200);
    const res = await requestAs(app, '1').post('/api/logistica/cuadre-central').set('Authorization', `Bearer ${state.token}`)
      .send({ guiaId: state.guia.id, responsable: 'Despachador', pesoLlegada: 18 });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('Cerrada');
    expect(res.body.retornosRecibidos).toBe(1);
    expect(res.body.etiquetasReingresadas).toBe(0);
    expect(res.body.aprobacion).toBeNull();

    const etiq = await requestAs(app, '1').get('/api/etiquetas');
    expect(etiq.body.find((e: any) => e.id === state.etiq[0].id).estado).toBe('Entregada');
    expect(etiq.body.find((e: any) => e.id === state.etiq[1].id)).toMatchObject({ estado: 'EnBodega', ubicacionActual: 'Bodega Central' });

    const inv = await requestAs(app, '1').get('/api/inventario');
    expect(inv.body.find((i: any) => i.ubicacion === 'Camion Smoke' && i.producto === 'Huevos - Grande').cantidad).toBe(0);
    // 120 (recepción) - 60 (carga) + 30 devolución aceptada = 90.
    expect(inv.body.find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevos - Grande').cantidad).toBe(90);
  });

  it('4.3 Consolidar ruta: factura electrónica (c1) + nota de crédito (c2 anulada), tiquetes enlazados', async () => {
    const res = await requestAs(app, '1').post('/api/facturacion/consolidar-ruta')
      .set('x-user-id', '1')
      .send({ guiaId: state.guia.id, emisorNombre: 'Granja Don Paco', emisorCedula: '3-101-000000' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emitidas).toBe(1);
    expect(res.body.anuladas).toBe(1);
    expect(res.body.facturas).toHaveLength(1);
    expect(res.body.documentos).toHaveLength(2);

    const f = res.body.facturas[0];
    expect(f).toMatchObject({ cliente: 'Cliente A', total: costo(30), condicion: 'Contado' });

    const docs = await requestAs(app, '1').get('/api/facturacion/documentos');
    const fe = docs.body.find((d: any) => d.tipoDocumento === 'Factura' && d.receptorNombre === 'Cliente A');
    const nc = docs.body.find((d: any) => d.tipoDocumento === 'NotaCredito');
    expect(fe).toMatchObject({ estado: 'Borrador', condicionPago: 'Contado', total: costo(30) });
    expect(nc).toMatchObject({ estado: 'Borrador', total: costo(30) });
    expect(nc.notasCreditoId).toBe(state.v2.ventaId);

    const facturas = await requestAs(app, '1').get('/api/facturas');
    const fC1 = facturas.body.find((x: any) => x.clienteId === 'c1' && x.estado !== 'NotaCredito');
    const fNC = facturas.body.find((x: any) => x.estado === 'NotaCredito');
    expect(fC1).toMatchObject({ estado: 'Pagada', condicion_pago: 'Contado', metodo_pago: 'Efectivo', total: costo(30) });
    expect(fNC.total).toBe(costo(30));
    expect(facturas.body.some((x: any) => x.clienteId === 'c2' && x.estado !== 'NotaCredito')).toBe(false);
    expect(facturas.body.find((x: any) => x.clienteId === 'c2')?.estado).toBe('NotaCredito');

    const ventas = await client.execute({ sql: `
      SELECT tiquete_consecutivo, factura_id FROM ventas_ruta WHERE guia_id = ?
      UNION ALL
      SELECT tiquete_consecutivo, factura_id FROM ventas_ruta_kg WHERE guia_id = ?
    `, args: [state.guia.id, state.guia.id] });
    const link = (t: string) => ventas.rows.find((v: any) => v.tiquete_consecutivo === t)?.factura_id;
    expect(link('TQ-0001')).toBe(fC1.id);
    expect(link('TQ-0002')).toBeNull();
  });

  it('4.4 Rutas del día consolidada y doble consolidación bloqueada', async () => {
    const rd = await requestAs(app, '1').get('/api/facturacion/rutas-dia');
    expect(rd.status).toBe(200);
    const ruta = rd.body.rutas.find((r: any) => r.guiaId === state.guia.id);
    expect(ruta).toMatchObject({ estado: 'Cerrada', consolidada: true, nFacturas: 1, tiquetesEmitidos: 1, retornos: 1, vendidos: 30, totalGenerado: costo(30) });

    const res2 = await requestAs(app, '1').post('/api/facturacion/consolidar-ruta').set('x-user-id', '1').send({ guiaId: state.guia.id });
    expect(res2.status).toBe(409);
    expect((res2.body.error as string)).toContain('ya fue consolidada');
  });

  it('5 Inventario final concilia + auditoría registrada', async () => {
    const inv = await requestAs(app, '1').get('/api/inventario');
    const bodega = inv.body.find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevos - Grande');
    const camion = inv.body.find((i: any) => i.ubicacion === 'Camion Smoke' && i.producto === 'Huevos - Grande');
    // Conservación: 400 = Granja 280 + Bodega 90 + entregado a c1 (30); la etiqueta retornada (30) ya está en Bodega
    expect(bodega.cantidad).toBe(90);
    expect(camion.cantidad).toBe(0);

    const aud = await requestAs(app, '1').get('/api/auditoria');
    expect(Array.isArray(aud.body)).toBe(true);
    expect(aud.body.length).toBeGreaterThan(0);
    expect(aud.body.some((a: any) => a.modulo === 'ConsolidacionRuta' || a.modulo === 'Logistica')).toBe(true);
  });
});
