/**
 * Fase 2 — `POST /api/pagos` deja de ser un interruptor.
 *
 * Antes solo ponía `estado = 'Pagada'` con cualquier monto y sin registrar nada: un
 * pago parcial cerraba la factura entera y no quedaba historial. Aquí se ata
 * cada comportamiento al endpoint.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';
import { expectApi } from './helpers/http';

let app: Express;
// El genérico del schema hace falta para poder leer con `testDb.query`;
// `ReturnType<typeof drizzle>` lo deja en `{}`.
let testDb: LibSQLDatabase<typeof schema>;
const DB_PATH = path.resolve(process.cwd(), '.test-pagos.db');

const ADMIN = 'adm-pg';

const como = (req: request.Test) => req.set('x-user-id', ADMIN);

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });

  await testDb.insert(schema.users).values({
    id: ADMIN, name: 'Administradora', email: 'admin@pg.cr', role: 'Admin',
  });
  await testDb.insert(schema.clientes).values({
    id: 'cli-1', nombre: 'Cliente Uno', condicion_pago: 'Credito', limite_credito: 500000, saldo_pendiente: 1000,
  });
  await testDb.insert(schema.facturas).values([
    {
      id: 'f-1000', consecutivo: 'FAC-1000', fecha: '2026-09-01', clienteId: 'cli-1',
      vendedorId: ADMIN, subtotal: 1000, descuento: 0, total: 1000,
      condicion_pago: 'Credito', estado: 'Pendiente',
    },
    {
      id: 'f-anulada', consecutivo: 'FAC-1001', fecha: '2026-09-01', clienteId: 'cli-1',
      vendedorId: ADMIN, subtotal: 800, descuento: 0, total: 800,
      condicion_pago: 'Credito', estado: 'Anulada',
    },
    {
      id: 'f-ya-pagada', consecutivo: 'FAC-1002', fecha: '2026-09-01', clienteId: 'cli-1',
      vendedorId: ADMIN, subtotal: 500, descuento: 0, total: 500,
      condicion_pago: 'Credito', estado: 'Pagada',
    },
  ]);

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

const estadoDe = async (id: string) =>
  (await testDb.query.facturas.findFirst({ where: (await import('drizzle-orm')).eq(schema.facturas.id, id) }))?.estado;

describe('POST /api/pagos — validación', () => {
  it('exige facturaId', async () => {
    const res = await como(request(app).post('/api/pagos')).send({ monto: 10 });
    expectApi(res, 400, 'sin facturaId');
  });

  it('404 si la factura no existe', async () => {
    const res = await como(request(app).post('/api/pagos')).send({ facturaId: 'no-existe', monto: 10 });
    expectApi(res, 404, 'factura inexistente');
  });

  it('no revive una factura anulada', async () => {
    const res = await como(request(app).post('/api/pagos')).send({ facturaId: 'f-anulada', monto: 100 });
    expectApi(res, 409, 'factura anulada');
    expect(await estadoDe('f-anulada')).toBe('Anulada');
  });

  it('no vuelve a pagar una factura ya saldada', async () => {
    const res = await como(request(app).post('/api/pagos')).send({ facturaId: 'f-ya-pagada', monto: 100 });
    expectApi(res, 409, 'factura ya pagada');
  });

  it('rechaza un monto mayor que el saldo', async () => {
    const res = await como(request(app).post('/api/pagos')).send({ facturaId: 'f-1000', monto: 5000 });
    expectApi(res, 400, 'monto mayor al saldo');
  });

  it('rechaza un monto no numérico', async () => {
    const res = await como(request(app).post('/api/pagos')).send({ facturaId: 'f-1000', monto: 'abc' });
    expectApi(res, 400, 'monto inválido');
  });
});

describe('POST /api/pagos — pago parcial y saldo', () => {
  it('un pago parcial NO marca la factura como Pagada', async () => {
    const res = await como(request(app).post('/api/pagos')).send({
      facturaId: 'f-1000', monto: 250, metodoPago: 'Transferencia',
    });
    expectApi(res, 200, 'pago parcial');
    expect(res.body.pagado).toBe(250);
    expect(res.body.saldo).toBe(750);
    // El bug: antes cualquier monto la ponía en 'Pagada'.
    expect(await estadoDe('f-1000')).toBe('Pendiente');
    const listado = await como(request(app).get('/api/facturas'));
    expectApi(listado, 200, 'facturas con saldo actualizado');
    expect(listado.body.find((f: any) => f.id === 'f-1000')).toMatchObject({ pagado: 250, saldoPendiente: 750, estado: 'Pendiente' });
  });

  it('el pago queda registrado en el historial', async () => {
    const res = await como(request(app).get('/api/facturas/f-1000/pagos'));
    expectApi(res, 200, 'historial de pagos');
    expect(res.body.pagos).toHaveLength(1);
    expect(res.body.pagos[0]).toMatchObject({ monto: 250, metodo: 'Transferencia' });
    expect(res.body.pagado).toBe(250);
    expect(res.body.saldo).toBe(750);
  });

  it('una segunda cuota acumula y recién al cerrar queda Pagada', async () => {
    const r2 = await como(request(app).post('/api/pagos')).send({ facturaId: 'f-1000', monto: 250 });
    expectApi(r2, 200, 'segunda cuota');
    expect(r2.body.saldo).toBe(500);
    expect(await estadoDe('f-1000')).toBe('Pendiente');

    const r3 = await como(request(app).post('/api/pagos')).send({ facturaId: 'f-1000', monto: 500 });
    expectApi(r3, 200, 'cuota final');
    expect(r3.body.saldo).toBe(0);
    expect(await estadoDe('f-1000')).toBe('Pagada');
  });

  it('el historial muestra las tres cuotas contra el total', async () => {
    const res = await como(request(app).get('/api/facturas/f-1000/pagos'));
    expectApi(res, 200, 'historial completo');
    expect(res.body.pagos).toHaveLength(3);
    expect(res.body.pagado).toBe(1000);
    expect(res.body.saldo).toBe(0);
  });

  it('sin monto, paga el saldo completo', async () => {
    // Sin `monto` la cuota es laTOTAL pendiente. Se usa una factura aparte
    // porque f-1000 ya quedó saldada en el bloque anterior.
    await testDb.insert(schema.facturas).values({
      id: 'f-saldar', consecutivo: 'FAC-1003', fecha: '2026-09-10', clienteId: 'cli-1',
      vendedorId: ADMIN, subtotal: 700, descuento: 0, total: 700,
      condicion_pago: 'Credito', estado: 'Pendiente',
    });
    await testDb.insert(schema.pagos).values({
      id: 'pg-previo', facturaId: 'f-saldar', fecha: '2026-09-11', monto: 200, usuarioId: ADMIN,
    });

    const r = await como(request(app).post('/api/pagos')).send({ facturaId: 'f-saldar' });
    expectApi(r, 200, 'pago del saldo completo');
    expect(r.body.saldo).toBe(0);
    expect(await estadoDe('f-saldar')).toBe('Pagada');
  });

  it('el pago lo firma el usuario autenticado, no el del body', async () => {
    const fila = await testDb.query.pagos.findFirst({
      where: (await import('drizzle-orm')).eq(schema.pagos.facturaId, 'f-saldar'),
    });
    expect(fila!.usuarioId).toBe(ADMIN);
  });
});

describe('saldo del cliente', () => {
  it('baja por lo efectivamente pagado, no por el total de la factura', async () => {
    // cli-1 arrancaba con 1000 de saldo. Pagó 1000 contra f-1000 (3 cuotas de
    // 250 + 250 + 500) y f-anulada nunca se tocó.
    const cliente = await testDb.query.clientes.findFirst();
    expect(cliente!.saldo_pendiente).toBe(0);
  });
});

describe('POST /api/pagos — idempotencia', () => {
  it('reintentar con la misma llave devuelve el pago original sin descontar dos veces', async () => {
    await testDb.insert(schema.facturas).values({
      id: 'f-idempotente', consecutivo: 'FAC-IDEMP', fecha: '2026-09-12', clienteId: 'cli-1',
      vendedorId: ADMIN, subtotal: 300, descuento: 0, total: 300,
      condicion_pago: 'Credito', estado: 'Pendiente',
    });
    const primero = await como(request(app).post('/api/pagos')).set('Idempotency-Key', 'cobro-f-idempotente-1').send({
      facturaId: 'f-idempotente', monto: 100, metodoPago: 'SINPE',
    });
    const repetido = await como(request(app).post('/api/pagos')).set('Idempotency-Key', 'cobro-f-idempotente-1').send({
      facturaId: 'f-idempotente', monto: 100, metodoPago: 'SINPE',
    });
    expectApi(primero, 200, 'primer cobro');
    expectApi(repetido, 200, 'reintento seguro');
    expect(repetido.body.repetido).toBe(true);
    expect(repetido.body.pago.id).toBe(primero.body.pago.id);
    expect(repetido.body.saldo).toBe(200);
    const hist = await como(request(app).get('/api/facturas/f-idempotente/pagos'));
    expect(hist.body.pagos).toHaveLength(1);
    expect(hist.body.pagado).toBe(100);
  });

  it('rechaza reutilizar una llave para un pago diferente', async () => {
    const res = await como(request(app).post('/api/pagos')).set('Idempotency-Key', 'cobro-f-idempotente-1').send({
      facturaId: 'f-idempotente', monto: 50, metodoPago: 'Efectivo',
    });
    expectApi(res, 409, 'llave reutilizada con otra carga');
  });
});
