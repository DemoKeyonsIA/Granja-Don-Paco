/**
 * Fase 7 — los cinco grupos del hub de Operaciones tienen respaldo de datos.
 *
 * El hub de escritorio no es una pantalla nueva: es la misma operación que ya
 * existía repartida en tres sitios (Granja como módulo, Bodega y Despacho dentro
 * de Logística, Caja Ruta como tab suelto). Mover cuerpos de sitio no mueve datos,
 * así que este archivo ata lo único que la fase sí cambia: que cada grupo tenga
 * su endpoint, que responda, y que la cifra del primer tab no contradiga a la del
 * grupo que la calcula.
 *
 * La última parte es la que vale: `Resumen del día` lee `stockBodegaCentral` de
 * `/api/dashboard/enterprise` mientras Bodega calcula su stock total desde
 * `/api/bodega/stock`. Son dos lecturas del mismo ledger. Si dejan de cuadrar, el
 * hub abre con un número que el siguiente tab contradice, y ese es el defecto que
 * hace que la gente deje de confiar en el resumen.
 *
 * Lo que aquí NO se comprueba es autorización por rol: casi ninguno de estos
 * endpoints lleva middleware de rol —solo Office lo tiene—, así que un 200 aquí
 * no significa "el que puede entrar puede ver". La matriz de la Fase 7 vive en
 * `nav-config.test.ts` y `nav-render.test.tsx`, que es donde el shell filtra.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';
import { expectApi } from './helpers/http';

let app: Express;
let testDb: LibSQLDatabase<typeof schema>;
const DB_PATH = path.resolve(process.cwd(), '.test-operaciones-hub.db');

const ADMIN = 'adm-fase7';
const HOY = new Date().toISOString().split('T')[0];

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });

  await testDb.insert(schema.users).values({ id: ADMIN, name: 'Admin', email: 'admin@fase7.cr', role: 'Admin' });
  await testDb.insert(schema.clientes).values([
    { id: 'cli-1', nombre: 'Cliente Uno', condicion_pago: 'Contado', estado: 'Activo' },
    { id: 'cli-2', nombre: 'Cliente Dos', condicion_pago: 'Credito', estado: 'Activo' },
  ]);
  // El ledger que leen Bodega y el resumen del día: 900 en bodega central y 400
  // en granja, que todavía no está en bodega.
  await testDb.insert(schema.inventario).values([
    { id: 'i-bc-1', producto: 'Huevos - Grande', cantidad: 600, unidad: 'cartones', ubicacion: 'Bodega Central', ultima_actualizacion: HOY },
    { id: 'i-bc-2', producto: 'Huevos - Mediano', cantidad: 300, unidad: 'cartones', ubicacion: 'Bodega Central', ultima_actualizacion: HOY },
    { id: 'i-gr-1', producto: 'Huevos - Grande', cantidad: 400, unidad: 'cartones', ubicacion: 'Granja', ultima_actualizacion: HOY },
  ]);
  await testDb.insert(schema.guias_despacho).values({
    id: 'g-1', consecutivo: 'GD-1', fecha: HOY, camionId: null, rutaId: null,
    estado: 'Cargada', totalCartones: 500,
  });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch { /* la base ya no importa */ }
});

describe('cada grupo del hub tiene su endpoint', () => {
  it('Granja: las cuatro vistas de la sub-fila responden', async () => {
    // La sub-fila no es decorativa: cada una de sus cuatro entradas monta una
    // pantalla que pide sus datos al montar. Si uno no responde, la fila ofrece un
    // tab que se abre en blanco.
    for (const ruta of ['/api/granjas', '/api/galerones', '/api/vacunaciones', '/api/alimento', '/api/activos']) {
      expectApi(await request(app).get(ruta), 200, ruta);
    }
  });

  it('Bodega: existencias y control leen el mismo stock', async () => {
    expectApi(await request(app).get('/api/bodega/stock'), 200);
    expectApi(await request(app).get('/api/etiquetas'), 200);
    // Control necesita además las recepciones, que es de donde salen las alertas
    // de faltante. Sin ellas, la vista abre sin poder explicar un descuadre.
    expectApi(await request(app).get('/api/operaciones/recepciones'), 200);
  });

  it('Despacho: remisiones y tablero de guías responden', async () => {
    expectApi(await request(app).get('/api/operaciones/remisiones'), 200);
    expectApi(await request(app).get('/api/logistica/tablero'), 200);
  });

  it('Ventas: Caja Ruta encuentra la guía pendiente', async () => {
    // Es el grupo que absorbió el tab `caja` de Logística, así que su primera
    // pantalla tiene que ser la misma que era.
    const res = await request(app).get('/api/logistica/guias-activas');
    expectApi(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    expectApi(await request(app).get('/api/logistica/camiones'), 200);
  });
});

describe('Resumen del día y Bodega no se contradicen', () => {
  it('las cinco cifras que lee el primer tab existen y son números', async () => {
    const res = await request(app).get('/api/dashboard/enterprise');
    expectApi(res, 200);
    // Si falta una, `ResumenDelDia` se oculta entero en vez de pintar ceros: es el
    // comportamiento que `tests/ui/operaciones-ia.test.tsx` fija. Aquí se ata el
    // otro lado del contrato, que el endpoint sí las manda.
    for (const clave of ['cartonesProducidos', 'stockBodegaCentral', 'totalAvesVivas', 'rutasActivas', 'desperdiciosHoy']) {
      expect(typeof res.body[clave], clave).toBe('number');
      expect(Number.isFinite(res.body[clave]), clave).toBe(true);
    }
  });

  it('el stock de bodega del resumen es el mismo que ve el grupo Bodega', async () => {
    const resumen = (await request(app).get('/api/dashboard/enterprise')).body;
    const stock = (await request(app).get('/api/bodega/stock')).body;
    // 600 + 300 en Bodega Central. El item en Granja queda fuera de los dos: no
    // está en bodega, y si apareciera en alguno de los dos sería un error.
    expect(resumen.stockBodegaCentral).toBe(900);
    expect(stock.kpis.stockTotal).toBe(900);
    expect(resumen.stockBodegaCentral).toBe(stock.kpis.stockTotal);
    expect(stock.productos.reduce((a: number, p: any) => a + Number(p.total), 0)).toBe(900);
  });
});
