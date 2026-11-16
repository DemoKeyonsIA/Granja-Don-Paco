import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';
import { expectApi } from './helpers/http';
import { requestAs } from './helpers/request-as';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
const admin = () => requestAs(app, '1');
const DB_PATH = path.resolve(process.cwd(), '.test-bodega-fefo.db');

const DIAS = 86400000;
const iso = (offsetDias: number) => new Date(Date.now() + offsetDias * DIAS).toISOString();

async function insertarEtiqueta(over: Partial<typeof schema.etiquetas.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  const row = {
    id,
    codigoUnico: `ETQ-TEST-${id.slice(0, 8).toUpperCase()}`,
    producto: 'Huevos - Grande',
    cantidad: 30,
    estado: 'EnBodega',
    ubicacionActual: 'Bodega Central',
    fechaProduccion: iso(-5),
    fechaEmpaque: iso(-5),
    ...over,
  } as any;
  await testDb.insert(schema.etiquetas).values(row);
  return row;
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);

  // Catálogo con vida útil configurable: "Huevos Grandes" debe mapear con "Huevos - Grande".
  await testDb.insert(schema.productosCatalogo).values({
    id: 'prod-grandes',
    nombre: 'Huevos Grandes',
    descripcion: '',
    unidad: 'cartones',
    precioBase: 16000,
    categoria: 'Huevos',
    estado: 'Activo',
    fechaCreacion: new Date().toISOString(),
    vidaUtilDias: 10,
    diasAvisoVencimiento: 3,
  } as any);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — Bodega FEFO (vida útil configurable, stock y trazabilidad por cartón)', () => {
  it('calcula fecha de vencimiento con la vida útil del producto (match normalizado)', async () => {
    const res = await admin().post('/api/etiquetas/generar').send({ producto: 'Huevos - Grande', cantidad: 30 });
    expectApi(res, 201);
    const etiqueta = (await testDb.select().from(schema.etiquetas)).find((e: any) => e.id === res.body.id);
    expect(etiqueta?.fechaVencimiento).toBeTruthy();
    const dias = Math.round((new Date(etiqueta!.fechaVencimiento as string).getTime() - new Date(etiqueta!.fechaEmpaque as string).getTime()) / DIAS);
    expect(dias).toBe(10);
  });

  it('permite override explícito de fechaVencimiento al generar', async () => {
    const vence = iso(45);
    const res = await admin().post('/api/etiquetas/generar').send({ producto: 'Huevos - Grande', cantidad: 12, fechaVencimiento: vence });
    expectApi(res, 201);
    const etiqueta = (await testDb.select().from(schema.etiquetas)).find((e: any) => e.id === res.body.id);
    expect(etiqueta?.fechaVencimiento).toBe(vence);
  });

  it('usa la vida útil actualizada del catálogo (PUT)', async () => {
    await admin().put('/api/productos-catalogo/prod-grandes').send({ vidaUtilDias: 5, diasAvisoVencimiento: 2 });
    const res = await admin().post('/api/etiquetas/generar').send({ producto: 'Huevos - Grande', cantidad: 6 });
    expectApi(res, 201);
    const etiqueta = (await testDb.select().from(schema.etiquetas)).find((e: any) => e.id === res.body.id);
    const dias = Math.round((new Date(etiqueta!.fechaVencimiento as string).getTime() - new Date(etiqueta!.fechaEmpaque as string).getTime()) / DIAS);
    expect(dias).toBe(5);
    // Restaurar
    await admin().put('/api/productos-catalogo/prod-grandes').send({ vidaUtilDias: 10, diasAvisoVencimiento: 3 });
  });

  it('/api/bodega/stock agrupa por producto, calcula KPIs y ordena la cola FEFO', async () => {
    // Limpiar etiquetas previas para aislar el escenario
    const previas = await testDb.select().from(schema.etiquetas);
    for (const e of previas) await testDb.delete(schema.etiquetas).where(eq(schema.etiquetas.id, (e as any).id));

    const vencida = await insertarEtiqueta({ cantidad: 30, fechaVencimiento: iso(-2) });
    const pronta = await insertarEtiqueta({ cantidad: 10, fechaVencimiento: iso(2) });
    const ok = await insertarEtiqueta({ cantidad: 50, fechaVencimiento: iso(20) });
    await insertarEtiqueta({ cantidad: 5, fechaVencimiento: null });
    // Stock agregado sin etiqueta en bodega
    await testDb.insert(schema.inventario).values({
      id: crypto.randomUUID(), producto: 'Huevos - Grande', cantidad: 100, unidad: 'cartones',
      ubicacion: 'Bodega Central', lote: null, fecha_caducidad: null, ultima_actualizacion: new Date().toISOString(),
    });

    const res = await admin().get('/api/bodega/stock');
    expectApi(res, 200);
    const { kpis, productos, colaFEFO } = res.body;

    // 1 etiqueta = 1 cartón: vencidos/por-vencer cuentan cartones, no unidades.
    expect(kpis.vencidos).toBe(1);
    expect(kpis.porVencer).toBe(1);
    // Stock total = ledger de inventario en la bodega (entradas de granja − salidas a ruta).
    expect(kpis.stockTotal).toBe(100);
    expect(kpis.etiquetas).toBe(4);
    // Cartones con stock físico que todavía NO tienen etiqueta individual.
    expect(kpis.porEtiquetar).toBe(96);
    expect(kpis.etiquetasPorIngresar).toBeUndefined();

    const grupo = productos.find((p: any) => p.key === 'huevos grande');
    expect(grupo).toBeTruthy();
    // La vista suma etiquetas y saldo agregado no etiquetado sin duplicar las mismas unidades.
    expect(grupo.total).toBe(100);
    expect(grupo.etiquetados).toBe(4);
    expect(grupo.agregado).toBe(96);
    expect(grupo.estado).toBe('vencido');

    // FEFO: primero la vencida, luego la próxima, y los sin-fecha al final.
    expect(colaFEFO[0].id).toBe(vencida.id);
    expect(colaFEFO[0].ordenFEFO).toBe(1);
    expect(colaFEFO[1].id).toBe(pronta.id);
    expect(colaFEFO[2].id).toBe(ok.id);
    expect(colaFEFO[colaFEFO.length - 1].dias).toBeNull();
  });

  it('ingresar-etiquetas pasa a EnBodega, fija fecha de recepción y registra traza', async () => {
    const etiqueta = await insertarEtiqueta({ estado: 'Generada', ubicacionActual: 'Granja', fechaVencimiento: iso(15) });

    const res = await admin().post('/api/bodega/ingresar-etiquetas').send({
      codigos: [etiqueta.codigoUnico, 'ETQ-NO-EXISTE'],
      ubicacion: 'Bodega Central',
      usuarioId: 'Bodeguero Test',
    });
    expectApi(res, 200);
    expect(res.body.ingresadas).toHaveLength(1);
    expect(res.body.errores).toHaveLength(1);

    const actualizada = (await testDb.select().from(schema.etiquetas)).find((e: any) => e.id === etiqueta.id);
    expect(actualizada?.estado).toBe('EnBodega');
    expect(actualizada?.ubicacionActual).toBe('Bodega Central');
    expect(actualizada?.fechaRecepcion).toBeTruthy();

    const traza = await testDb.select().from(schema.traza_etiqueta);
    const evento = traza.find((t: any) => t.etiquetaId === etiqueta.id && t.tipoEvento === 'Recibida');
    expect(evento).toBeTruthy();
    expect(evento?.ubicacion).toBe('Bodega Central');

    // Ya debe aparecer en el stock
    const stock = await admin().get('/api/bodega/stock');
    expect(stock.body.colaFEFO.some((l: any) => l.id === etiqueta.id)).toBe(true);
  });

  it('persiste el tipo de cartón de la etiqueta (1 etiqueta = 1 cartón)', async () => {
    const res = await admin().post('/api/etiquetas/generar').send({ producto: 'Huevos - Grande', cantidad: 24, tipoCarton: 'Cartón de 24 huevos' });
    expectApi(res, 201);
    const etiqueta = (await testDb.select().from(schema.etiquetas)).find((e: any) => e.id === res.body.id);
    expect(etiqueta?.tipoCarton).toBe('Cartón de 24 huevos');

    // Al ingresarla a bodega, la cola FEFO la cuenta como 1 cartón (no las 24 unidades).
    await admin().post('/api/bodega/ingresar-etiquetas').send({ codigos: [etiqueta!.codigoUnico], ubicacion: 'Bodega Central' });
    const stock = await admin().get('/api/bodega/stock');
    const kpis = stock.body.kpis;
    expect(kpis.etiquetas).toBeGreaterThanOrEqual(1);
    expect(stock.body.colaFEFO.find((l: any) => l.id === etiqueta.id)?.cantidad).toBe(1);
    expect(stock.body.colaFEFO.find((l: any) => l.id === etiqueta.id)?.tipoCarton).toBe('Cartón de 24 huevos');
  });

  it('catálogo de tipos de cartón: alta, listado y baja', async () => {
    const previas = await testDb.select().from(schema.tiposCarton);
    for (const t of previas) await testDb.delete(schema.tiposCarton).where(eq(schema.tiposCarton.id, (t as any).id));

    const mal = await admin().post('/api/tipos-carton').send({ nombre: '', unidades: 30 });
    expectApi(mal, 400);

    const creado = await admin().post('/api/tipos-carton').send({ nombre: 'Cartón de 24 huevos', unidades: 24 });
    expectApi(creado, 201);

    const lista = await admin().get('/api/tipos-carton');
    expectApi(lista, 200);
    const tipo = lista.body.find((t: any) => t.id === creado.body.id);
    expect(tipo?.nombre).toBe('Cartón de 24 huevos');
    expect(tipo?.unidades).toBe(24);

    await admin().delete(`/api/tipos-carton/${creado.body.id}`);
    const lista2 = await admin().get('/api/tipos-carton');
    expect(lista2.body.find((t: any) => t.id === creado.body.id)).toBeUndefined();
  });

  it('registra el evento de origen "Generada" en la traza (single y lote)', async () => {
    const single = await admin().post('/api/etiquetas/generar').send({ producto: 'Huevos - Grande', cantidad: 30, ubicacion: 'Granja Norte', lote: 'L-77' });
    expectApi(single, 201);

    const lote = await admin().post('/api/etiquetas/generar-lote').send({
      etiquetas: [
        { producto: 'Huevos - Grande', cantidad: 30, ubicacion: 'Granja Sur' },
        { producto: 'Huevos - Grande', cantidad: 30 },
      ],
    });
    expectApi(lote, 201);

    const traza = await testDb.select().from(schema.traza_etiqueta);
    const evSingle = traza.find((t: any) => t.etiquetaId === single.body.id && t.tipoEvento === 'Generada');
    expect(evSingle).toBeTruthy();
    expect(evSingle?.ubicacion).toBe('Granja Norte');
    expect(evSingle?.observaciones).toBe('Lote L-77');

    for (const e of lote.body.etiquetas) {
      const ev = traza.find((t: any) => t.etiquetaId === e.id && t.tipoEvento === 'Generada');
      expect(ev).toBeTruthy();
    }

    // La línea de tiempo debe arrancar en "Generada" y continuar con "Recibida" al ingresar.
    const codigo = single.body.codigoUnico;
    await admin().post('/api/bodega/ingresar-etiquetas').send({ codigos: [codigo], ubicacion: 'Bodega Central' });
    const traz = await admin().get(`/api/etiquetas/trazabilidad/${codigo}`);
    expectApi(traz, 200);
    const tipos = [...traz.body.traza]
      .sort((a: any, b: any) => String(a.fecha).localeCompare(String(b.fecha)))
      .map((t: any) => t.tipoEvento);
    expect(tipos).toEqual(['Generada', 'Recibida']);
  });
});
