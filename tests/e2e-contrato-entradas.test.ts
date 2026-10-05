import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';

/**
 * Un body que el servidor puede describir no es un error del servidor.
 *
 * Estos tests existen porque cuatro endpoints compartían el mismo defecto: dejaban
 * que un dato faltante o con la forma equivocada llegara hasta SQLite, y SQLite
 * contestaba NOT NULL, o un `findFirst` recibía `undefined`, o un array acababa en
 * una columna TEXT. El resultado era siempre 500 con el volcado del SQL dentro, que
 * no dice nada útil a quien lo recibe, y en un caso (`produccion/recoleccion`) no
 * había ni 500: guardaba la producción en la granja equivocada y devolvía 200.
 */

let app: Express;
let client: ReturnType<typeof abrirClienteDePrueba>;
const DB_PATH = path.resolve(process.cwd(), '.test-contrato-entradas.db');

const comoAdmin = (req: request.Test) => req.set('x-user-id', '1');

/** Dos granjas con un galerón del MISMO nombre: es lo que hace única esta prueba. */
async function crearDosGranjas() {
  for (const [nombre, encargadoId] of [
    ['Granja Norte', 'enc-1'],
    ['Granja Sur', 'enc-2'],
  ]) {
    const res = await comoAdmin(request(app).post('/api/granjas/wizard')).send({
      nombre,
      ubicacion: 'Alajuela',
      tipo_produccion: 'Postura',
      encargadoId,
      galerones: [{ nombre: 'Galerón Central', capacidad_maxima: 1000 }],
    });
    expect(res.status, `wizard de ${nombre}`).toBe(201);
  }
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  for (const [id, name, role] of [
    ['1', 'Administrador', 'Admin'],
    ['enc-1', 'Encargado Uno', 'Encargado'],
    ['enc-2', 'Encargado Dos', 'Encargado'],
  ]) {
    await client.execute({
      sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`,
      args: [id, name, `${id}@granja.com`, role],
    });
  }
  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
  await crearDosGranjas();
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

const ventaMinima = {
  factura: { clienteId: 'consumidor-final', condicion_pago: 'Contado', metodo_pago: 'Efectivo' },
  detalles: [{ producto: 'Huevos', cantidad: 12, precio_unitario: 500 }],
};

describe('POST /api/ventas', () => {
  const incompletos: [string, unknown][] = [
    ['factura vacía', { factura: {}, detalles: [] }],
    ['sin cliente ni condición', { factura: { total: 10 }, detalles: [{ cantidad: 1 }] }],
    ['línea sin producto', { factura: { clienteId: 'consumidor-final', condicion_pago: 'Contado' }, detalles: [{ cantidad: 1, precio_unitario: 1 }] }],
    ['línea sin cantidad', { factura: { clienteId: 'consumidor-final', condicion_pago: 'Contado' }, detalles: [{ producto: 'Huevos', precio_unitario: 1 }] }],
    ['sin detalles', { factura: { clienteId: 'consumidor-final', condicion_pago: 'Contado' }, detalles: [] }],
    ['detalles no es lista', { factura: { clienteId: 'consumidor-final', condicion_pago: 'Contado' }, detalles: 'Huevos' }],
  ];

  it.each(incompletos)('responde 400 sin SQL y nombra lo que falta: %s', async (_nombre, body) => {
    const res = await comoAdmin(request(app).post('/api/ventas')).send(body as any);
    expect(res.status).toBe(400);
    // El mensaje tiene que ser accionable: decir qué campo, no "Failed query".
    expect(res.body.error).not.toMatch(/Failed query|SQLITE/i);
    expect(String(res.body.error)).toMatch(/Faltan datos|inválidos/i);
  });

  it('acepta el body mínimo y deriva fecha y totales', async () => {
    const res = await comoAdmin(request(app).post('/api/ventas')).send(ventaMinima);
    expect(res.status).toBe(200);

    const facturas = (await comoAdmin(request(app).get('/api/facturas'))).body;
    const lista = Array.isArray(facturas) ? facturas : facturas.facturas;
    const guardada = lista[lista.length - 1];
    expect(guardada.fecha, 'la fecha la pone el servidor').toBeTruthy();
    expect(guardada.descuento).toBe(0);
    expect(guardada.estado).toBe('Pendiente');
    expect(Number(guardada.total)).toBe(6000); // 12 × 500
    expect(Number(guardada.subtotal)).toBe(6000);
    expect(guardada.consecutivo).toMatch(/^FAC-/);
  });

  it('rechaza con 400 una línea sin precio y sin lista que lo resuelva', async () => {
    const res = await comoAdmin(request(app).post('/api/ventas')).send({
      factura: { clienteId: 'consumidor-final', condicion_pago: 'Contado' },
      detalles: [{ producto: 'Producto Sin Precio', cantidad: 3 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/precio/i);
  });

  it('rechaza con 400 un cliente que no existe', async () => {
    const res = await comoAdmin(request(app).post('/api/ventas')).send({
      factura: { clienteId: 'no-existe', condicion_pago: 'Contado' },
      detalles: [{ producto: 'Huevos', cantidad: 1, precio_unitario: 1 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/no existe/i);
  });
});

describe('POST /api/granjas/wizard', () => {
  it('rechaza con 400 galerones que no son objetos', async () => {
    const res = await comoAdmin(request(app).post('/api/granjas/wizard')).send({
      nombre: 'Granja Rara',
      ubicacion: 'Alajuela',
      tipo_produccion: 'Postura',
      encargadoId: 'enc-1',
      galerones: ['Galerón Uno'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/Failed query|SQLITE/i);
    expect(String(res.body.error)).toMatch(/galerones\[0\]/);
  });

  it('rechaza con 400 un galerón sin nombre', async () => {
    const res = await comoAdmin(request(app).post('/api/granjas/wizard')).send({
      nombre: 'Granja Rara 2',
      encargadoId: 'enc-1',
      galerones: [{ capacidad_maxima: 100 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/galerones\[0\]\.nombre/);
  });

  it('guarda capacidad 0 en vez de NaN cuando no viene', async () => {
    const res = await comoAdmin(request(app).post('/api/granjas/wizard')).send({
      nombre: 'Granja Sin Capacidad',
      encargadoId: 'enc-1',
      galerones: [{ nombre: 'Galerón Sin Capacidad' }],
    });
    expect(res.status).toBe(201);
    const galerones = (await comoAdmin(request(app).get('/api/galerones'))).body;
    const creado = galerones.find((g: any) => g.nombre === 'Galerón Sin Capacidad');
    expect(creado).toBeTruthy();
    expect(Number.isInteger(creado.capacidad_maxima)).toBe(true);
    expect(creado.capacidad_maxima).toBe(0);
  });

  it('acepta la granja sin galerones', async () => {
    const res = await comoAdmin(request(app).post('/api/granjas/wizard')).send({
      nombre: 'Granja Sin Galerones',
      encargadoId: 'enc-1',
    });
    expect(res.status).toBe(201);
  });
});

/** Las granjas del seed junto al galerón homónimo que cada una recibió. */
async function galeronesPorGranja() {
  const granjas = (await comoAdmin(request(app).get('/api/granjas'))).body;
  const galerones = (await comoAdmin(request(app).get('/api/galerones'))).body;
  return granjas.map((g: any) => ({
    granja: g,
    galeron: galerones.find((x: any) => x.granjaId === g.id && x.nombre === 'Galerón Central'),
  })).filter(p => p.galeron);
}

describe('POST /api/produccion/recoleccion', () => {
  it('cada granja registra en SU galerón, no en el del vecino', async () => {
    const pares = await galeronesPorGranja();
    expect(pares.length).toBeGreaterThanOrEqual(2);
    // Con el nombre repetido, un `findFirst(nombre)` global mandaba todo al primero.
    expect(pares[0].galeron.nombre).toBe(pares[1].galeron.nombre);
    expect(pares[0].galeron.id).not.toBe(pares[1].galeron.id);

    for (const { granja, galeron } of pares) {
      const res = await comoAdmin(request(app).post('/api/produccion/recoleccion')).send({
        galeron: galeron.nombre,
        galeronId: galeron.id,
        granjaId: granja.id,
        detalles: [{ tamano: 'Grande', cantidad: 10 }],
      });
      expect(res.status, `recolección de ${granja.nombre}`).toBe(200);
    }

    const rows = (await client.execute({
      sql: 'SELECT galeron_id AS galeronId, granja_id AS granjaId FROM produccion_diaria',
    })).rows;
    for (const { granja, galeron } of pares) {
      const suyas = rows.filter((r: any) => r.galeronId === galeron.id);
      expect(suyas.length, `${granja.nombre} debería tener producción`).toBeGreaterThan(0);
      expect(
        suyas.every((r: any) => r.granjaId === granja.id),
        `${granja.nombre} no debe tener filas de otra granja`,
      ).toBe(true);
    }
  });

  it('rechaza un nombre de galerón ambiguo sin granjaId', async () => {
    const res = await comoAdmin(request(app).post('/api/produccion/recoleccion')).send({
      galeron: 'Galerón Central',
      detalles: [{ producto: 'Huevos', cantidad: 1 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/granjas/i);
  });

  it('acepta nombre + granjaId y guarda en el galerón de esa granja', async () => {
    const sur = (await galeronesPorGranja()).find(p => p.granja.nombre === 'Granja Sur')!;
    const res = await comoAdmin(request(app).post('/api/produccion/recoleccion')).send({
      galeron: sur.galeron.nombre,
      granjaId: sur.granja.id,
      detalles: [{ producto: 'Huevos', cantidad: 5 }],
    });
    expect(res.status).toBe(200);
    const rows = (await client.execute({
      sql: 'SELECT galeron_id AS galeronId, granja_id AS granjaId, cantidad FROM produccion_diaria WHERE cantidad = 5',
    })).rows;
    expect(rows.length).toBe(1);
    expect(rows[0].galeronId).toBe(sur.galeron.id);
    expect(rows[0].granjaId).toBe(sur.granja.id);
  });

  it('rechaza un galerón que pertenece a otra granja', async () => {
    const pares = await galeronesPorGranja();
    const norte = pares.find(p => p.granja.nombre === 'Granja Norte')!;
    const sur = pares.find(p => p.granja.nombre === 'Granja Sur')!;
    const res = await comoAdmin(request(app).post('/api/produccion/recoleccion')).send({
      galeron: norte.galeron.nombre,
      galeronId: norte.galeron.id,
      granjaId: sur.granja.id,
      detalles: [{ producto: 'Huevos', cantidad: 5 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/no pertenece/i);
  });

  it('responde 400 y no 500 cuando el galerón no existe', async () => {
    const res = await comoAdmin(request(app).post('/api/produccion/recoleccion')).send({
      galeron: 'No Existe',
      detalles: [{ producto: 'Huevos', cantidad: 5 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/no encontrado/i);
  });

  it('rechaza un body sin detalles', async () => {
    const res = await comoAdmin(request(app).post('/api/produccion/recoleccion')).send({
      galeron: 'Galerón Central',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/produccion/historial', () => {
  /**
   * El otro lado de la recolección: lo que se acaba de escribir tiene que poder
   * leerse. Este filtro sonaba roto en la UI, no en el servidor.
   *
   * `Granjas.tsx` pide `?desde=<input type="date">&hasta=<input type="date">`, o
   * sea fechas cortas, mientras `produccion_diaria.fecha` es un timestamp ISO
   * completo. La comparación era de textos y `'2026-10-04T12:00:00.000Z' <=
   * '2026-10-04'` da falso: el rango de un solo día salía siempre vacío, y el
   * usuario veía un historial vacío el mismo día que había registrado producción.
   */
  it('el rango de un solo día incluye lo que se registró hoy', async () => {
    const sur = (await galeronesPorGranja()).find(p => p.granja.nombre === 'Granja Sur')!;
    const res = await comoAdmin(request(app).post('/api/produccion/recoleccion')).send({
      galeronId: sur.galeron.id,
      granjaId: sur.granja.id,
      detalles: [{ producto: 'Huevos', cantidad: 7 }],
    });
    expect(res.status).toBe(200);

    const hoy = new Date().toISOString().slice(0, 10);
    const delDia = await request(app)
      .get(`/api/produccion/historial?granjaId=${sur.granja.id}&desde=${hoy}&hasta=${hoy}`);
    expect(delDia.status).toBe(200);
    expect(delDia.body.some((p: any) => Number(p.cantidad) === 7)).toBe(true);
  });

  it('un rango que no incluye hoy no inventa registros', async () => {
    const sur = (await galeronesPorGranja()).find(p => p.granja.nombre === 'Granja Sur')!;
    const anteayer = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const res = await request(app).get(
      `/api/produccion/historial?granjaId=${sur.granja.id}&desde=${anteayer}&hasta=${anteayer}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => Number(p.cantidad) === 7)).toBe(false);
  });
});

describe('POST/PUT /api/ordenes-mantenimiento', () => {
  let activoId = '';

  beforeAll(async () => {
    const res = await comoAdmin(request(app).post('/api/activos')).send({
      nombre: 'Comedor', tipo: 'Equipo',
    });
    expect(res.status).toBe(201);
    activoId = res.body.id;
  });

  const base = () => ({
    activoId,
    tipo: 'Preventiva',
    responsable: 'Alguien',
    fechaProgramada: new Date().toISOString(),
  });

  // Las dos columnas son TEXT que guardan JSON, así que el array es la forma
  // natural de mandarlas. Antes se insertaban crudas y el bind convertía
  // `[{ item, ok }]` en la cadena "[object Object]", con 500 de por medio.
  const conJson = [
    ['checklist de strings', { checklist: ['a', 'b'] }],
    ['checklist de objetos', { checklist: [{ item: 'a', ok: false }] }],
    ['insumos de strings', { insumosUsados: ['aceite'] }],
    ['insumos de objetos', { insumosUsados: [{ insumoId: 'i1', cantidad: 2 }] }],
    ['ambos', { checklist: [{ item: 'a', ok: true }], insumosUsados: [{ insumoId: 'i1', cantidad: 1 }] }],
  ] as const;

  it.each(conJson)('acepta %s y lo guarda como JSON legible', async (_nombre, extra) => {
    const res = await comoAdmin(request(app).post('/api/ordenes-mantenimiento'))
      .send({ ...base(), ...extra });
    expect(res.status).toBe(201);

    const ordenes = (await comoAdmin(request(app).get('/api/ordenes-mantenimiento'))).body;
    const guardada = ordenes.find((o: any) => o.id === res.body.id);
    expect(guardada).toBeTruthy();
    // Lo que sale por GET tiene que poder parsearse: si se guardó "[object Object]"
    // el dato está corrupto aunque el status sea 201.
    for (const campo of ['checklist', 'insumosUsados'] as const) {
      if (guardada[campo] === null) continue;
      expect(() => JSON.parse(guardada[campo]), `${campo} debe ser JSON válido`).not.toThrow();
    }
  });

  it('acepta texto JSON que ya venía serializado', async () => {
    const res = await comoAdmin(request(app).post('/api/ordenes-mantenimiento')).send({
      ...base(),
      checklist: JSON.stringify([{ item: 'a', ok: false }]),
    });
    expect(res.status).toBe(201);
  });

  // Un objeto suelto o un número también se serializan sin quejarse, pero no hay
  // código que los vuelva a leer: quedaban guardados como texto que nadie puede
  // interpretar. Se rechazan en vez de dejar basura en la columna.
  const noJson = [
    ['objeto en checklist', { checklist: { item: 'a' } }],
    ['número en insumosUsados', { insumosUsados: 7 }],
    ['booleano en checklist', { checklist: true }],
  ] as const;

  it.each(noJson)('el POST rechaza %s con 400', async (_nombre, extra) => {
    const res = await comoAdmin(request(app).post('/api/ordenes-mantenimiento'))
      .send({ ...base(), ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array o un texto/);
  });

  it('el PUT también rechaza un valor que no sea array ni texto', async () => {
    const creada = await comoAdmin(request(app).post('/api/ordenes-mantenimiento')).send(base());
    expect(creada.status).toBe(201);
    const res = await comoAdmin(request(app).put(`/api/ordenes-mantenimiento/${creada.body.id}`))
      .send({ insumosUsados: { insumoId: 'i1' } });
    expect(res.status).toBe(400);
  });

  it('el PUT también serializa insumosUsados', async () => {
    const creada = await comoAdmin(request(app).post('/api/ordenes-mantenimiento')).send(base());
    expect(creada.status).toBe(201);
    const res = await comoAdmin(request(app).put(`/api/ordenes-mantenimiento/${creada.body.id}`))
      .send({ estado: 'Completado', insumosUsados: [{ insumoId: 'i1', cantidad: 3 }] });
    expect(res.status).toBe(200);

    const ordenes = (await comoAdmin(request(app).get('/api/ordenes-mantenimiento'))).body;
    const guardada = ordenes.find((o: any) => o.id === creada.body.id);
    expect(() => JSON.parse(guardada.insumosUsados)).not.toThrow();
    expect(JSON.parse(guardada.insumosUsados)).toEqual([{ insumoId: 'i1', cantidad: 3 }]);
  });

  it('rechaza con 400 los campos obligatorios que falten', async () => {
    for (const campo of ['activoId', 'tipo', 'fechaProgramada', 'responsable']) {
      const body: any = base();
      delete body[campo];
      const res = await comoAdmin(request(app).post('/api/ordenes-mantenimiento')).send(body);
      expect(res.status, `sin ${campo}`).toBe(400);
    }
  });

  it('el PUT de una orden inexistente responde 404', async () => {
    const res = await comoAdmin(request(app).put('/api/ordenes-mantenimiento/no-existe'))
      .send({ estado: 'Completado' });
    expect(res.status).toBe(404);
  });
});
