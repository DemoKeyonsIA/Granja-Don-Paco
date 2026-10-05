/**
 * Fase 2 — la cobranza mide contra el vencimiento y el saldo real.
 *
 * El aging juntaba `total` de facturas a crédito y loONY como vencido aunque no
 * hubieran vencido, y el "días de atraso" salía de la fecha de emisión. Aquí
 * el mismo escenario se comprueba por la API.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';
import { expectApi } from './helpers/http';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
const DB_PATH = path.resolve(process.cwd(), '.test-cobranza-aging.db');

const ADMIN = 'adm-ca';
const CLIENTE = 'cli-cartera';

const como = (req: request.Test) => req.set('x-user-id', ADMIN);

/** Fecha con días de desplazamiento respecto a hoy, en ISO corto. */
const dias = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });

  await testDb.insert(schema.users).values({
    id: ADMIN, name: 'Administradora', email: 'admin@ca.cr', role: 'Admin',
  });
  await testDb.insert(schema.clientes).values({
    id: CLIENTE, nombre: 'Cliente Cartera', condicion_pago: 'Credito', limite_credito: 900000,
  });

  // Una factura a 30 días emitida hace 40: vence hace 10 → 10 días de
  // atraso. Una segunda que vence hace 20 → 20 de atraso. Y una que vence hoy.
  const facturas: any[] = [
    { id: 'f-30-10', total: 100, atraso: 10, plazo: 30, emitidaHace: 40 },
    { id: 'f-30-20', total: 200, atraso: 20, plazo: 30, emitidaHace: 50 },
    { id: 'f-futura', total: 300, atraso: 0, plazo: 30, emitidaHace: 5 },
  ];
  for (const f of facturas) {
    await testDb.insert(schema.facturas).values({
      id: f.id,
      consecutivo: `FAC-${f.id.toUpperCase()}`,
      fecha: dias(-f.emitidaHace),
      fechaVencimiento: dias(-f.atraso),
      clienteId: CLIENTE,
      vendedorId: ADMIN,
      subtotal: f.total,
      descuento: 0,
      total: f.total,
      condicion_pago: `Credito ${f.plazo}`,
      estado: 'Pendiente',
    });
  }

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('vencimiento', () => {
  it('una factura trae su fecha_vencimiento ya resuelta', async () => {
    const res = await como(request(app).get('/api/facturas'));
    const f = res.body.find((x: any) => x.id === 'f-30-10');
    expect(f.fechaVencimiento).toBe(dias(-10));
  });

  it('la factura nueva calcula su vencimiento al crearse', async () => {
    // Emitida hoy a 30 días → vence en 30. `POST /api/ventas` no devuelve la
    // factura, así que se localiza por diferencia entre antes y después.
    const antes: string[] = (await como(request(app).get('/api/facturas'))).body.map((x: any) => x.id);

    const res = await como(request(app).post('/api/ventas')).send({
      factura: {
        clienteId: CLIENTE, fecha: new Date().toISOString(), condicion_pago: 'Credito 30', estado: 'Pendiente',
        subtotal: 100, descuento: 0, total: 100, vendedorId: ADMIN,
      },
      detalles: [{ producto: 'Huevos', cantidad: 10, precio_unitario: 10, subtotal: 100 }],
    });
    expectApi(res, 200, 'crear venta a 30 días');

    const despues = (await como(request(app).get('/api/facturas'))).body;
    const nueva = despues.find((f: any) => !antes.includes(f.id));
    expect(nueva).toBeDefined();
    expect(nueva.fechaVencimiento).toBe(dias(30));
  });
});

describe('GET /api/clientes/analisis — aging por vencimiento', () => {
  it('el "vencido" no suma lo que aún no vence', async () => {
    const res = await como(request(app).get('/api/clientes/analisis'));
    expectApi(res, 200, 'análisis');
    const { aging, carteraTotal, vencidoTotal } = res.body;

    // Lo vencido: f-30-10 (100) + f-30-20 (200) = 300.
    // f-futura (300) está en la cartera pero no vencida.
    expect(vencidoTotal).toBe(300);
    expect(carteraTotal).toBeGreaterThanOrEqual(600);
    expect(aging.d1_30).toBe(300);
    expect(aging.d31_60).toBe(0);
    expect(aging.d60).toBe(0);
  });

  it('el aging cuadra con el vencido total', async () => {
    const res = await como(request(app).get('/api/clientes/analisis'));
    const { aging, vencidoTotal } = res.body;
    const sumaVencidos = aging.d1_30 + aging.d31_60 + aging.d60;
    expect(sumaVencidos).toBe(vencidoTotal);
  });

  it('el DSO promedia el atraso de lo vencido', async () => {
    const res = await como(request(app).get('/api/clientes/analisis'));
    // (10 + 20) / 2 = 15 días de atraso promedio.
    expect(res.body.dso).toBe(15);
  });
});

describe('cartera — saldo real tras un pago parcial', () => {
  it('pagar parte baja el saldo del aging, no lo deja igual', async () => {
    // Paga la mitad de f-30-10 (100 → 50 pagado, 50 de atraso).
    const r = await como(request(app).post('/api/pagos')).send({ facturaId: 'f-30-10', monto: 50 });
    expectApi(r, 200, 'pago parcial');

    const res = await como(request(app).get('/api/clientes/analisis'));
    const { aging, vencidoTotal } = res.body;
    // f-30-10 aporta 50 (antes 100), f-30-20 sigue 200.
    expect(aging.d1_30).toBe(250);
    expect(vencidoTotal).toBe(250);
  });

  it('saldar la factura la saca del aging', async () => {
    await como(request(app).post('/api/pagos')).send({ facturaId: 'f-30-10', monto: 50 });
    const res = await como(request(app).get('/api/clientes/analisis'));
    const { aging, vencidoTotal } = res.body;
    // f-30-10 ya no debe nada; solo queda f-30-20 (200).
    expect(aging.d1_30).toBe(200);
    expect(vencidoTotal).toBe(200);
  });
});
