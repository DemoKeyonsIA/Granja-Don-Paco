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
const DB_PATH = path.resolve(process.cwd(), '.test-smoke.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  const testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('SMOKE — Todos los endpoints responden', () => {
  it('GET /api/inventario', async () => {
    const res = await request(app).get('/api/inventario');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/inventario/movimientos', async () => {
    const res = await request(app).get('/api/inventario/movimientos');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/facturas', async () => {
    const res = await request(app).get('/api/facturas');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/gastos', async () => {
    const res = await request(app).get('/api/gastos');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/gastos — crear gasto', async () => {
    const res = await request(app).post('/api/gastos').send({
      fecha: new Date().toISOString(),
      categoria: 'Diesel',
      monto: 15000,
      descripcion: 'Prueba smoke test',
      usuarioId: 'test-user-001'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/clientes', async () => {
    const res = await request(app).get('/api/clientes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/clientes — crear cliente', async () => {
    const res = await request(app).post('/api/clientes').send({
      nombre: 'Cliente Test',
      telefono: '8888-0000',
      ruta: 'Ruta Test',
      condicion_pago: 'Contado'
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/rutas', async () => {
    const res = await request(app).get('/api/rutas');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/rutas — crear ruta', async () => {
    const res = await request(app).post('/api/rutas').send({
      nombre: 'Ruta Test',
      vendedor_asignado: 'Vendedor Test'
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/granjas', async () => {
    const res = await request(app).get('/api/granjas');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/galerones', async () => {
    const res = await request(app).get('/api/galerones');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/lotes', async () => {
    const res = await request(app).get('/api/lotes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/mantenimientos', async () => {
    const res = await request(app).get('/api/mantenimientos');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/produccion/historial', async () => {
    const res = await request(app).get('/api/produccion/historial');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/produccion/historial con filtro granjaId', async () => {
    const res = await request(app).get('/api/produccion/historial?granjaId=any');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/granjas/wizard con solo nombre', async () => {
    const res = await request(app).post('/api/granjas/wizard').send({ nombre: 'Test Smoke Wizard' });
    expect(res.status).toBe(201);
  });

  it('POST /api/granjas/wizard falla sin nombre', async () => {
    const res = await request(app).post('/api/granjas/wizard').send({});
    expect(res.status).toBe(400);
  });

  it('PUT /api/lotes/:id falla con ID inexistente', async () => {
    const res = await request(app).put('/api/lotes/no-id').send({ cantidad_inicial: 100 });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/lotes/:id falla con ID inexistente', async () => {
    const res = await request(app).delete('/api/lotes/no-id');
    expect(res.status).toBe(404);
  });

  it('GET /api/granjas/:id/detalle falla con ID inexistente', async () => {
    const res = await request(app).get('/api/granjas/no-id/detalle');
    expect(res.status).toBe(404);
  });

  it('GET /api/operaciones/traslados', async () => {
    const res = await request(app).get('/api/operaciones/traslados');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/logistica/auditoria', async () => {
    const res = await request(app).get('/api/logistica/auditoria?ruta=Camión Ruta 1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('facturas');
    expect(res.body).toHaveProperty('totalCargado');
  });

  it('POST /api/clientes — falla sin nombre', async () => {
    const res = await request(app).post('/api/clientes').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/rutas — falla sin nombre', async () => {
    const res = await request(app).post('/api/rutas').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/produccion/recoleccion — falla sin galerón', async () => {
    const res = await request(app).post('/api/produccion/recoleccion').send({ galeron: null, detalles: [] });
    expect(res.status).toBe(400);
  });

  // Phase 3 Smoke Tests
  it('GET /api/facturacion/documentos', async () => {
    const res = await request(app).get('/api/facturacion/documentos');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/etiquetas', async () => {
    const res = await request(app).get('/api/etiquetas');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/pesos', async () => {
    const res = await request(app).get('/api/pesos');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/pesos/trazabilidad', async () => {
    const res = await request(app).get('/api/pesos/trazabilidad');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pesos');
    expect(res.body).toHaveProperty('resumen');
  });

  it('GET /api/pesos/conciliacion', async () => {
    const res = await request(app).get('/api/pesos/conciliacion');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('porUbicacion');
  });

  it('POST /api/facturacion/crear-documento — falla sin datos', async () => {
    const res = await request(app).post('/api/facturacion/crear-documento').set('x-user-id', '1').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/etiquetas/generar — falla sin producto', async () => {
    const res = await request(app).post('/api/etiquetas/generar').send({ cantidad: 10 });
    expect(res.status).toBe(400);
  });

  it('POST /api/pesos/registrar — falla sin datos', async () => {
    const res = await request(app).post('/api/pesos/registrar').send({});
    expect(res.status).toBe(400);
  });

  // Phase 4 Smoke Tests
  it('GET /api/vacunaciones', async () => {
    const res = await request(app).get('/api/vacunaciones');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/vacunaciones/alertas', async () => {
    const res = await request(app).get('/api/vacunaciones/alertas');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vencidas');
  });

  it('GET /api/alimento', async () => {
    const res = await request(app).get('/api/alimento');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/alimento/consumo', async () => {
    const res = await request(app).get('/api/alimento/consumo');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/alimento/alertas', async () => {
    const res = await request(app).get('/api/alimento/alertas');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bajoInventario');
  });

  it('GET /api/activos', async () => {
    const res = await request(app).get('/api/activos');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/ordenes-mantenimiento', async () => {
    const res = await request(app).get('/api/ordenes-mantenimiento');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/ordenes-mantenimiento/alertas', async () => {
    const res = await request(app).get('/api/ordenes-mantenimiento/alertas');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vencidas');
  });

  it('GET /api/desperdicios', async () => {
    const res = await request(app).get('/api/desperdicios');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/desperdicios/resumen', async () => {
    const res = await request(app).get('/api/desperdicios/resumen');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('porOrigen');
  });

  it('GET /api/precios/listas', async () => {
    const res = await request(app).get('/api/precios/listas');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/precios/historial', async () => {
    const res = await request(app).get('/api/precios/historial');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/dashboard/enterprise', async () => {
    const res = await request(app).get('/api/dashboard/enterprise');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ingresosHoy');
    expect(res.body).toHaveProperty('alertas');
  });

  it('GET /api/auditoria', async () => {
    const res = await request(app).get('/api/auditoria');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/vacunaciones — falla sin datos', async () => {
    const res = await request(app).post('/api/vacunaciones').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/alimento — falla sin datos', async () => {
    const res = await request(app).post('/api/alimento').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/desperdicios — falla sin datos', async () => {
    const res = await request(app).post('/api/desperdicios').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/ordenes-mantenimiento — falla sin datos', async () => {
    const res = await request(app).post('/api/ordenes-mantenimiento').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/precios/listas — falla sin datos', async () => {
    const res = await request(app).post('/api/precios/listas').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/auditoria — falla sin datos', async () => {
    const res = await request(app).post('/api/auditoria').send({});
    expect(res.status).toBe(400);
  });

  // Phase 5 Smoke Tests
  it('GET /api/aprobaciones', async () => {
    const res = await request(app).get('/api/aprobaciones');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/aprobaciones/pendientes', async () => {
    const res = await request(app).get('/api/aprobaciones/pendientes');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('items');
  });

  it('POST /api/aprobaciones — falla sin datos', async () => {
    const res = await request(app).post('/api/aprobaciones').send({});
    expect(res.status).toBe(400);
  });

  it('GET /api/precios/lookup — falla sin producto', async () => {
    const res = await request(app).get('/api/precios/lookup');
    expect(res.status).toBe(400);
  });

  it('GET /api/precios/lookup — producto inexistente', async () => {
    const res = await request(app).get('/api/precios/lookup?producto=NoExiste');
    expect(res.status).toBe(404);
  });

  it('GET /api/reportes/ventas-por-ruta', async () => {
    const res = await request(app).get('/api/reportes/ventas-por-ruta');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/reportes/produccion', async () => {
    const res = await request(app).get('/api/reportes/produccion');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/reportes/inventario', async () => {
    const res = await request(app).get('/api/reportes/inventario');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/reportes/desperdicios', async () => {
    const res = await request(app).get('/api/reportes/desperdicios');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/reportes/financiero', async () => {
    const res = await request(app).get('/api/reportes/financiero');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalVentas');
    expect(res.body).toHaveProperty('utilidadNeta');
    expect(res.body).toHaveProperty('margen');
  });

  it('GET /api/users', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/roles/permisos — Admin', async () => {
    const res = await request(app).get('/api/roles/permisos?role=Admin');
    expect(res.status).toBe(200);
    expect(res.body.view).toContain('*');
    expect(res.body.approve).toContain('*');
  });

  it('GET /api/roles/permisos — Vendedor', async () => {
    const res = await request(app).get('/api/roles/permisos?role=Vendedor');
    expect(res.status).toBe(200);
    expect(res.body.view).toContain('rutas_propias');
    expect(res.body.create).toContain('ventas');
  });

  it('GET /api/roles/permisos — rol inválido', async () => {
    const res = await request(app).get('/api/roles/permisos?role=FakeRole');
    expect(res.status).toBe(400);
  });

  it('POST /api/ventas — auto-aplica precio de lista', async () => {
    // Create a client first
    const clientRes = await request(app).post('/api/clientes').send({ nombre: 'Test Client Precio', ruta: 'Ruta 1' });
    expect(clientRes.status).toBe(201);
    const clientId = clientRes.body.id;

    // Create a price list
    const listaRes = await request(app).post('/api/precios/listas').send({ nombre: 'Lista Test', tipo: 'Global' });
    expect(listaRes.status).toBe(201);
    const listaId = listaRes.body.id;

    // Add price detail
    const detRes = await request(app).post('/api/precios/detalle').send({ listaId, producto: 'Huevos - Smoke TEST', precioUnitario: 2500 });
    expect(detRes.status).toBe(201);

    // Create venta with price=0 (should auto-apply from list)
    const ventaRes = await request(app).post('/api/ventas').set('x-user-id', '1').send({
      factura: { id: crypto.randomUUID(), consecutivo: 'FAC-TEST-001', fecha: new Date().toISOString(), clienteId: clientId, vendedorId: '1', subtotal: 0, descuento: 0, total: 0, condicion_pago: 'Contado', estado: 'Pagada' },
      detalles: [{ producto: 'Huevos - Smoke TEST', cantidad: 10, precio_unitario: 0, subtotal: 0 }]
    });
    expect(ventaRes.status).toBe(200);
    expect(ventaRes.body.preciosAplicados).toBeDefined();
    expect(ventaRes.body.preciosAplicados[0].precio).toBe(2500);
  });

  describe('Galerón — ocupación y aves_en_produccion', () => {
    let testGranjaId: string;
    let testGaleronId: string;

    it('POST /api/granjas/wizard — crea granja con galerón', async () => {
      const res = await request(app)
        .post('/api/granjas/wizard')
        .send({
          nombre: 'Granja Test Ocupación',
          ubicacion: 'Heredia',
          tipo_produccion: 'Postura',
          encargadoId: 'admin-001',
          galerones: [{ nombre: 'Galpón Ocupación', capacidad_maxima: 1000 }]
        });
      expect(res.status).toBe(201);

      const granjas = (await request(app).get('/api/granjas')).body;
      const g = granjas.find((x: any) => x.nombre === 'Granja Test Ocupación');
      expect(g).toBeDefined();
      testGranjaId = g.id;

      const galerones = (await request(app).get('/api/galerones')).body;
      const gal = galerones.find((x: any) => x.granjaId === testGranjaId && x.nombre === 'Galpón Ocupación');
      expect(gal).toBeDefined();
      expect(gal.capacidad_maxima).toBe(1000);
      expect(gal.aves_en_produccion).toBe(0);
      testGaleronId = gal.id;
    });

    it('PUT /api/galerones/:id — actualiza aves_en_produccion', async () => {
      const res = await request(app)
        .put(`/api/galerones/${testGaleronId}`)
        .send({ aves_en_produccion: 800 });
      expect(res.status).toBe(200);

      const galerones = (await request(app).get('/api/galerones')).body;
      const gal = galerones.find((x: any) => x.id === testGaleronId);
      expect(gal.aves_en_produccion).toBe(800);
    });

    it('GET /api/galerones — devuelve aves_en_produccion correcto', async () => {
      const galerones = (await request(app).get('/api/galerones')).body;
      const gal = galerones.find((x: any) => x.id === testGaleronId);
      expect(gal.aves_en_produccion).toBe(800);
      expect(gal.capacidad_maxima).toBe(1000);
    });

    it('GET /api/granjas/:id/detalle — calcula ocupación desde aves_en_produccion', async () => {
      const res = await request(app).get(`/api/granjas/${testGranjaId}/detalle`);
      expect(res.status).toBe(200);
      const gal = res.body.galerones.find((g: any) => g.id === testGaleronId);
      expect(gal).toBeDefined();
      expect(gal.aves).toBe(800);
      expect(gal.ocupacion).toBe(80);
      expect(res.body.resumen.avesTotal).toBe(800);
      expect(res.body.resumen.ocupacion).toBe(80);
    });

    it('PUT /api/galerones/:id — capacity 1200, aves 360 → 30%', async () => {
      await request(app)
        .put(`/api/galerones/${testGaleronId}`)
        .send({ capacidad_maxima: 1200, aves_en_produccion: 360 });

      const res = await request(app).get(`/api/granjas/${testGranjaId}/detalle`);
      const gal = res.body.galerones.find((g: any) => g.id === testGaleronId);
      expect(gal.aves).toBe(360);
      expect(gal.ocupacion).toBe(30);
    });

    it('PUT /api/galerones/:id — capacity 1000, aves 950 → 95%', async () => {
      await request(app)
        .put(`/api/galerones/${testGaleronId}`)
        .send({ capacidad_maxima: 1000, aves_en_produccion: 950 });

      const res = await request(app).get(`/api/granjas/${testGranjaId}/detalle`);
      const gal = res.body.galerones.find((g: any) => g.id === testGaleronId);
      expect(gal.aves).toBe(950);
      expect(gal.ocupacion).toBe(95);
    });
  });
});
