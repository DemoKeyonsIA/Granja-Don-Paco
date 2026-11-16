import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';
import { requestAs } from './helpers/request-as';

let app: Express;
let client: any;
const DB_PATH = path.resolve(process.cwd(), '.test-e2e-clientes-crm.db');

const D = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString();

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);

  for (const [id, name, email, role] of [
    ['u-ven', 'Vendedor Test', 'vendedor@test.com', 'Vendedor'],
    ['u-adm', 'Admin Test', 'admin@test.com', 'Admin'],
  ]) {
    await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: [id, name, email, role] });
  }

  // Catálogo con precios: base para mix 360 (vía detallesFactura) y excepciones.
  await client.execute({
    sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['p-huevos-grande', 'Huevos - Grande', 'Cartón 30 unidades', 'cartones', 16000, 'Huevos', 'Activo', D(0)]
  });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — MÓDULO CLIENTES CRM: cartera enriquecida, análisis por periodo, perfil 360, excepciones y CRUD', () => {
  const adminRequest = () => requestAs(app, 'u-adm');
  let a: any; // campeón: paga puntual, mucho volumen
  let b: any; // atraso leve
  let c: any; // crónico, sobre el límite

  it('C1 — CRUD: crear clientes con condiciones y límites; búsqueda; edición', async () => {
    const ca = await adminRequest().post('/api/clientes').send({ nombre: 'Pulpería La Central', ruta: 'Ruta 10', condicion_pago: 'Credito', limite_credito: 500000, telefono: '8701-2234', tipo_documento: 'Fisica', documento_id: '3-0455-7890' });
    expect(ca.status).toBe(201);
    a = { id: ca.body.id, nombre: 'Pulpería La Central' };

    const cb = await adminRequest().post('/api/clientes').send({ nombre: 'Restaurante El Fogón', ruta: 'Cacique', condicion_pago: 'Credito', limite_credito: 400000 });
    expect(cb.status).toBe(201);
    b = { id: cb.body.id, nombre: 'Restaurante El Fogón' };

    const cc = await adminRequest().post('/api/clientes').send({ nombre: 'Super Mercadito La Fortuna', ruta: 'Cacique', condicion_pago: 'Credito', limite_credito: 450000 });
    expect(cc.status).toBe(201);
    c = { id: cc.body.id, nombre: 'Super Mercadito La Fortuna' };

    const clientes = (await adminRequest().get('/api/clientes')).body;
    expect(clientes).toHaveLength(3);

    // Edición
    const up = await adminRequest().put(`/api/clientes/${c.id}`).send({ condicion_pago: 'Credito', limite_credito: 450000, notas: 'Cliente con historial de morosidad' });
    expect(up.status).toBe(200);
  });

  it('C2 — Ventas directas: algunes facturas pagadas, créditos en distintos estados de envejecimiento', async () => {
    // a (campeón): 6 facturas pagadas recientes + 1 a crédito al día
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post('/api/ventas').set('x-user-id', 'u-ven').send({
        factura: { clienteId: a.id, fecha: D(i), condicion_pago: 'Contado', estado: 'Pagada', subtotal: 64000, descuento: 0, total: 64000, vendedorId: 'u-ven', metodo_pago: 'Efectivo' },
        detalles: [{ producto: 'Huevos - Grande', cantidad: 4, precio_unitario: 16000, subtotal: 64000 }]
      });
      expect(res.status).toBe(200);
    }

    // b: 3 a crédito pendientes, la más vieja hace 12 días (atraso leve)
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/ventas').set('x-user-id', 'u-ven').send({
        factura: { clienteId: b.id, fecha: D(12 - i), condicion_pago: 'Credito', estado: i === 0 ? 'Pendiente' : 'Pagada', subtotal: 64000, descuento: 0, total: 64000, vendedorId: 'u-ven', metodo_pago: 'Efectivo' },
        detalles: [{ producto: 'Huevos - Grande', cantidad: 4, precio_unitario: 16000, subtotal: 64000 }]
      });
      expect(res.status).toBe(200);
    }

    // c: solo 1 factura a crédito vieja (hace 42 días → crónico) con uso de línea alto
    const vc = await request(app).post('/api/ventas').set('x-user-id', 'u-ven').send({
      factura: { clienteId: c.id, fecha: D(42), condicion_pago: 'Credito', estado: 'Pendiente', subtotal: 320000, descuento: 0, total: 320000, vendedorId: 'u-ven', metodo_pago: 'Efectivo' },
      detalles: [{ producto: 'Huevos - Grande', cantidad: 20, precio_unitario: 16000, subtotal: 320000 }]
    });
    expect(vc.status).toBe(200);
  });

  it('C3 — CARTERA: endpoint enriquecido con segmento, score, comportamiento y uso de línea', async () => {
    const res = await adminRequest().get('/api/clientes/cartera');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);

    const porA = res.body.clientes.find((x: any) => x.id === a.id);
    expect(porA.pedidos90d).toBe(6);
    expect(porA.comportamiento).toBe('Puntual');
    expect(porA.riesgo).toBe('Bajo');
    expect(porA.vencido).toBe(0);
    expect(porA.ultimaCompra).toBeTruthy();

    const porB = res.body.clientes.find((x: any) => x.id === b.id);
    expect(porB.pedidos90d).toBe(3);
    expect(['Puntual', 'Atraso leve']).toContain(porB.comportamiento);
    expect(porB.segmento).toBeDefined();

    const porC = res.body.clientes.find((x: any) => x.id === c.id);
    expect(porC.comportamiento).toBe('Crónico');
    expect(porC.riesgo).toBe('Alto');
    expect(porC.diasVencido).toBe(42);
    expect(porC.score).toBeGreaterThan(porA.score);
  });

  it('C4 — ANÁLISIS: KPIs por periodo, aging, worklist y segmentación con datos reales', async () => {
    const res = await adminRequest().get('/api/clientes/analisis');
    expect(res.status).toBe(200);
    expect(res.body.totalClientes).toBe(3);
    expect(res.body.ventaDelMes).toBeGreaterThan(0);
    expect(res.body.carteraTotal).toBeGreaterThan(0);
    expect(res.body.aging).toMatchObject({ alDia: expect.any(Number), d1_30: expect.any(Number), d31_60: expect.any(Number), d60: expect.any(Number) });
    expect(res.body.porSegmento).toHaveLength(3);
    expect(res.body.worklist.length).toBeGreaterThan(0);
    const top = res.body.topVenta[0];
    expect(top.nombre).toBe(a.nombre);
    expect(res.body.topVenta).toHaveLength(3);
    expect(res.body.cei).toBe(86);
    expect(res.body.clientesEnRiesgo).toBeGreaterThanOrEqual(1);
  });

  it('C5 — PERFIL 360: kpis, facturas con envejecimiento, documentos, mix y excepciones', async () => {
    const facturaVinculada = (await client.execute({ sql: `SELECT id FROM facturas WHERE cliente_id = ? ORDER BY fecha LIMIT 1`, args: [b.id] })).rows[0] as any;
    await client.execute({ sql: `INSERT INTO camiones (id, nombre, capacidad_cartones) VALUES (?, ?, ?)`, args: ['crm-truck', 'CRM Test', 100] });
    await client.execute({ sql: `INSERT INTO guias_despacho (id, consecutivo, camion_id, fecha, total_cartones, estado) VALUES (?, ?, ?, ?, ?, ?)`, args: ['crm-guide', 'CRM-GD-001', 'crm-truck', D(0), 7, 'Cerrada'] });
    const fechaTicket = D(0);
    const ticketValues = (id: string, consecutivo: string, total: number, cartones: number, facturaId: string | null) => [
      id, consecutivo, 'crm-truck', 'crm-guide', 'u-ven', fechaTicket, b.id, null, 'Huevos - Grande', cartones,
      16000, total, 0, total, 'Efectivo', 'Emitida', facturaId, null,
    ];
    await client.execute({
      sql: `INSERT INTO ventas_ruta (id, tiquete_consecutivo, camion_id, guia_id, vendedor_id, fecha_hora, cliente_id, etiqueta_id, producto, cartones, precio_unitario, subtotal, descuento, total, cobro, estado, factura_id, resolucion_precio_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ticketValues('crm-ticket-invoiced', 'TQ-CRM-001', 64000, 4, facturaVinculada.id),
    });
    await client.execute({
      sql: `INSERT INTO ventas_ruta (id, tiquete_consecutivo, camion_id, guia_id, vendedor_id, fecha_hora, cliente_id, etiqueta_id, producto, cartones, precio_unitario, subtotal, descuento, total, cobro, estado, factura_id, resolucion_precio_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ticketValues('crm-ticket-standalone', 'TQ-CRM-002', 48000, 3, null),
    });
    const res = await adminRequest().get(`/api/clientes/${b.id}/360`);
    expect(res.status).toBe(200);
    expect(res.body.cliente.nombre).toBe('Restaurante El Fogón');
    expect(res.body.kpis.facturasAbiertas).toBe(1);
    expect(res.body.kpis.vencidas).toBeGreaterThanOrEqual(1);
    expect(res.body.facturas.length).toBe(3);
    expect(res.body.facturas.every((f: any) => f.consecutivo.startsWith('FAC'))).toBe(true);

    const docs = res.body.documentos;
    expect(docs.length).toBe(4); // 3 facturas + 1 tiquete no consolidado
    expect(docs.filter((d: any) => d.tipo === 'Factura')).toHaveLength(3);
    expect(docs.filter((d: any) => d.tipo === 'Tiquete').map((d: any) => d.consecutivo)).toEqual(['TQ-CRM-002']);
    expect(res.body.tiquetes).toHaveLength(2); // conserva el documento asociado para auditoría
    expect(res.body.kpis.pedidos30d).toBe(4); // 3 facturas + 1 compra en ruta no consolidada
    expect(res.body.kpis.ticketProm).toBe(60000);
    expect(res.body.kpis.venta12m).toBe(240000); // no suma otra vez el tiquete ya facturado
    expect(res.body.mix.find((x: any) => x.producto === 'Huevos - Grande').unidades).toBe(15);

    const c360 = await adminRequest().get(`/api/clientes/${c.id}/360`);
    expect(c360.status).toBe(200);
    expect(c360.body.facturas[0].diasVencido).toBeGreaterThan(30); // crónica
    expect(c360.body.mix).toEqual(expect.any(Array));

    // 404 para cliente inexistente
    const nf = await adminRequest().get('/api/clientes/no-existe/360');
    expect(nf.status).toBe(404);
  });

  it('C6 — Excepciones de precio: crear, listar por cliente, ver en 360 y eliminar', async () => {
    const fechaInicio = new Date().toISOString().slice(0, 10);
    const fin = new Date(); fin.setDate(fin.getDate() + 30);
    const fechaFin = fin.toISOString().slice(0, 10);
    const finRuta = new Date(); finRuta.setDate(finRuta.getDate() + 5);
    const fechaFinRuta = finRuta.toISOString().slice(0, 10);
    const listaRuta = await request(app).post('/api/precios/listas').set('x-user-id', 'u-adm').send({
      nombre: 'Tarifa Cacique', tipo: 'Ruta', rutaAsociada: 'Cacique', fechaInicio, fechaFin: fechaFinRuta,
    });
    expect(listaRuta.status).toBe(201);
    const bandaRuta = await request(app).post('/api/precios/detalle').set('x-user-id', 'u-adm').send({
      listaId: listaRuta.body.id, producto: 'Huevos - Grande', precioUnitario: 12000, precioMinimo: 11000, precioMaximo: 13000,
    });
    expect(bandaRuta.status).toBe(201);
    const rutaSolapada = await request(app).post('/api/precios/listas').set('x-user-id', 'u-adm').send({
      nombre: 'Tarifa Cacique duplicada', tipo: 'Ruta', rutaAsociada: 'Cacique', fechaInicio, fechaFin: fechaFinRuta,
    });
    expect(rutaSolapada.status).toBe(409);
    const finSiguiente = new Date(finRuta); finSiguiente.setDate(finSiguiente.getDate() + 1);
    const rutaSiguiente = await request(app).post('/api/precios/listas').set('x-user-id', 'u-adm').send({
      nombre: 'Tarifa Cacique siguiente', tipo: 'Ruta', rutaAsociada: 'Cacique', fechaInicio: finSiguiente.toISOString().slice(0, 10),
    });
    expect(rutaSiguiente.status).toBe(201);
    const precioRuta = await adminRequest().get(`/api/precios/lookup?producto=${encodeURIComponent('Huevos - Grande')}&clienteId=${b.id}`);
    expect(precioRuta.body).toMatchObject({ precio: 12000, precioMinimo: 11000, precioMaximo: 13000, listaUsada: 'Tarifa Cacique' });
    const noAdmin = await request(app).post('/api/precio-excepciones').set('x-user-id', 'u-ven').send({
      clienteId: a.id, productoId: 'p-huevos-grande', precioExcepcion: 15000,
      justificacion: 'Volumen alto', fechaInicio, fechaFin,
    });
    expect(noAdmin.status).toBe(403);
    const listaNoAdmin = await request(app).post('/api/precios/listas').set('x-user-id', 'u-ven').send({ nombre: 'Lista no autorizada', tipo: 'Global' });
    expect(listaNoAdmin.status).toBe(403);
    const detalleNoAdmin = await request(app).post('/api/precios/detalle').set('x-user-id', 'u-ven').send({ listaId: 'no-existe', producto: 'Huevos - Grande', precioUnitario: 1000 });
    expect(detalleNoAdmin.status).toBe(403);
    const cambioNoAdmin = await request(app).post('/api/precios/cambiar').set('x-user-id', 'u-ven').send({ listaId: 'no-existe', producto: 'Huevos - Grande', precioNuevo: 1000 });
    expect(cambioNoAdmin.status).toBe(403);
    const res = await request(app).post('/api/precio-excepciones').send({
      clienteId: a.id, productoId: 'p-huevos-grande', precioExcepcion: 15000,
      justificacion: 'Volumen alto', fechaInicio, fechaFin, aprobadoPor: 'Nombre falsificado'
    }).set('x-user-id', 'u-adm');
    expect(res.status).toBe(201);

    const precioAplicado = await adminRequest().get(`/api/precios/lookup?producto=${encodeURIComponent('Huevos - Grande')}&clienteId=${a.id}`);
    expect(precioAplicado.status).toBe(200);
    expect(precioAplicado.body).toMatchObject({ precio: 15000, precioMinimo: 15000, precioMaximo: 15000 });

    const solapada = await request(app).post('/api/precio-excepciones').set('x-user-id', 'u-adm').send({
      clienteId: a.id, productoId: 'p-huevos-grande', precioExcepcion: 14500,
      justificacion: 'Intento de vigencia duplicada', fechaInicio, fechaFin,
    });
    expect(solapada.status).toBe(409);

    const lista = await adminRequest().get(`/api/precio-excepciones/${a.id}`);
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(1);

    const perfil = await adminRequest().get(`/api/clientes/${a.id}/360`);
    expect(perfil.body.excepciones).toHaveLength(1);
    expect(perfil.body.excepciones[0]).toMatchObject({ producto: 'Huevos - Grande', precioBase: 16000, precioExcepcion: 15000, aprobadoPor: 'Admin Test', fechaInicio, fechaFin, estado: 'Activa', estadoVigencia: 'Vigente' });

    const del = await request(app).delete(`/api/precio-excepciones/${lista.body[0].id}`).set('x-user-id', 'u-adm');
    expect(del.status).toBe(200);
    const despues = await adminRequest().get(`/api/precio-excepciones/${a.id}`);
    expect(despues.body).toHaveLength(1);
    expect(despues.body[0].estado).toBe('Inactiva');
  });

  it('C7 — El CRUD mínimo sigue vivo: eliminar cuenta y la cartera la refleja', async () => {
    // Un cliente sin movimiento queda como C en cartera; lo eliminamos para validar el ciclo completo.
    const extra = await adminRequest().post('/api/clientes').send({ nombre: 'Cliente Descartable', ruta: 'Ruta 10', condicion_pago: 'Contado' });
    expect(extra.status).toBe(201);

    const antes = await adminRequest().get('/api/clientes/cartera');
    expect(antes.body.total).toBe(4);

    const del = await adminRequest().delete(`/api/clientes/${extra.body.id}`);
    expect(del.status).toBe(200);

    const despues = await adminRequest().get('/api/clientes/cartera');
    expect(despues.body.total).toBe(3);
  });
});
