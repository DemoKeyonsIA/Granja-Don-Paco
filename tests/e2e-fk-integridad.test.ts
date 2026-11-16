import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import { abrirClienteDePrueba } from './helpers/db';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { CREATE_TABLES } from '../src/db/ddl';

let app: Express;
const DB_PATH = path.resolve(process.cwd(), '.test-fk-on.db');

/**
 * El resto de la suite corre con `PRAGMA foreign_keys = OFF` (helper
 * `desactivarFks`) porque los seeds insertan en cualquier orden. Este archivo
 * valida lo contrario: con las FK ACTIVAS del DDL canónico, el backend debe
 * poder insertar con el orden real de sus endpoints sin violar referencias,
 * y los id inexistentes deben rechazarse con 400 (no 500 por FK violation).
 */
beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  for (const sql of CREATE_TABLES) {
    await client.execute(sql);
  }

  const fk = await client.execute('PRAGMA foreign_keys');
  expect((fk.rows[0] as any).foreign_keys).toBe(1);

  await client.execute({
    sql: `INSERT INTO users (id, name, email, role, password_hash, activo) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['1', 'Administrador', 'admin@fk.com', 'Admin', 'x', 1]
  });
  await client.execute({
    sql: `INSERT INTO users (id, name, email, role, password_hash, activo) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['3', 'Vendedor', 'vendedor@fk.com', 'Comercial', 'x', 1]
  });
  await client.execute({
    sql: `INSERT INTO clientes (id, nombre, ruta, condicion_pago, estado) VALUES (?, ?, ?, ?, ?)`,
    args: ['c1', 'Cliente FK', 'R1', 'Contado', 'Activo']
  });
  await client.execute({
    sql: `INSERT INTO camiones (id, nombre, capacidad_cartones, vendedor_id, estado) VALUES (?, ?, ?, ?, ?)`,
    args: ['cam1', 'Camión Ruta 1', 200, '3', 'Activo']
  });
  await client.execute({
    sql: `INSERT INTO rutas (id, nombre, cliente_ids, capacidad_max_cartones, estado) VALUES (?, ?, ?, ?, ?)`,
    args: ['r1', 'Ruta 1', '["c1"]', 200, 'Activa']
  });
  await client.execute({
    sql: `INSERT INTO guias_despacho (id, consecutivo, camion_id, ruta_id, fecha, estado, total_cartones) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['g1', 'GD-FK-001', 'cam1', 'r1', new Date().toISOString(), 'Preparada', 0]
  });
  await client.execute({
    sql: `INSERT INTO inventario (id, producto, cantidad, unidad, ubicacion, ultima_actualizacion) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['inv1', 'Huevos - Grande', 100, 'cartones', 'Camión Ruta 1', new Date().toISOString()]
  });
  await client.execute({
    sql: `INSERT INTO productos_catalogo (id, nombre, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ['p-grande', 'Huevos - Grande', 'cartones', 16000, 'Huevos', 'Activo', new Date().toISOString()]
  });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('Integridad FK del DDL canónico (PRAGMA foreign_keys = ON)', () => {
  it('factura con vendedor/cliente/camión reales inserta sin violar FK', async () => {
    const res = await request(app).post('/api/ventas').set('x-user-id', '1').send({
      factura: {
        id: 'f1', consecutivo: 'FAC-FK-001', fecha: new Date().toISOString(),
        clienteId: 'c1', vendedorId: '3',
        subtotal: 160000, descuento: 0, total: 160000,
        condicion_pago: 'Contado', metodo_pago: 'Efectivo', estado: 'Pagada',
        guiaId: 'g1'
      },
      detalles: [{ producto: 'Huevos - Grande', cantidad: 10, precio_unitario: 16000, subtotal: 160000 }]
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('vendedor inexistente → 400 (antes: 500 por violación de FK)', async () => {
    const res = await request(app).post('/api/ventas').set('x-user-id', '1').send({
      factura: {
        id: 'f2', consecutivo: 'FAC-FK-002', fecha: new Date().toISOString(),
        clienteId: 'c1', vendedorId: 'NO-EXISTE',
        subtotal: 0, descuento: 0, total: 0,
        condicion_pago: 'Contado', estado: 'Pagada'
      },
      detalles: []
    });
    expect(res.status).toBe(400);
  });

  it('cliente inexistente → 400 (FK NOT NULL en facturas)', async () => {
    const res = await request(app).post('/api/ventas').set('x-user-id', '1').send({
      factura: {
        id: 'f3', consecutivo: 'FAC-FK-003', fecha: new Date().toISOString(),
        clienteId: 'NO-EXISTE', vendedorId: '3',
        subtotal: 0, descuento: 0, total: 0,
        condicion_pago: 'Contado', estado: 'Pagada'
      },
      detalles: []
    });
    expect(res.status).toBe(400);
  });
});
