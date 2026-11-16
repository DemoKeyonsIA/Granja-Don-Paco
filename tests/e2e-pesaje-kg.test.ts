import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import * as schema from '../src/db/schema';
import { abrirClienteDePrueba, ejecutarDdl } from './helpers/db';
import { requestAs } from './helpers/request-as';

let app: Express;
let client: any;
const admin = () => requestAs(app, 'kg-admin');
const comercial = () => requestAs(app, 'kg-comercial');
const bodega = () => requestAs(app, 'kg-bodega');
const DB_PATH = path.resolve(process.cwd(), '.test-pesaje-kg.db');

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);

  const ahora = new Date().toISOString();
  for (const [id, nombre, rol] of [
    ['kg-admin', 'Admin Demo', 'Admin'],
    ['kg-comercial', 'Comercial Reparto', 'Camionero'],
    ['kg-bodega', 'Bodeguero Demo', 'Bodeguero'],
  ]) {
    await client.execute({ sql: 'INSERT INTO users (id,name,email,role) VALUES (?,?,?,?)', args: [id, nombre, `${id}@demo.test`, rol] });
  }
  await client.execute({ sql: "INSERT INTO clientes (id,nombre,condicion_pago,estado) VALUES ('kg-cliente','Cliente Kg','Contado','Activo')" });
  await client.execute({ sql: "INSERT INTO productos_catalogo (id,nombre,descripcion,unidad,precio_base,categoria,estado,fecha_creacion) VALUES ('kg-prod','Huevo Kg','Huevo vendido por peso','kg',1000,'Huevos','Activo',?)", args: [ahora] });
  await client.execute({ sql: "INSERT INTO listas_precios (id,nombre,tipo,estado,fecha_inicio) VALUES ('kg-lista','General Kg','Global','Activa','2026-01-01')" });
  await client.execute({ sql: "INSERT INTO precios_detalle (id,lista_id,producto,precio_unitario,precio_minimo,precio_maximo,descuento_maximo,unidad) VALUES ('kg-precio','kg-lista','Huevo Kg',1000,900,1100,0,'kg')" });
  await client.execute({ sql: "INSERT INTO camiones (id,nombre,placa,camionero_id,vendedor_id,capacidad_cartones,estado) VALUES ('kg-camion','Camion Kg','KG-001','kg-comercial','kg-comercial',500,'Activo')" });
  await client.execute({ sql: "INSERT INTO inventario (id,producto,cantidad,unidad,ubicacion,ultima_actualizacion) VALUES ('kg-stock-bodega','Huevo Kg',20,'kg','Bodega Central',?)", args: [ahora] });
  await client.execute({ sql: "INSERT INTO etiquetas (id,codigo_unico,producto,cantidad,estado,ubicacion_actual) VALUES ('kg-etiqueta','ETQ-KG-001','Huevo Kg',1,'Generada','Granja')" });

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch { /* cleanup best effort */ }
});

describe('E2E — custodia medida en kg', () => {
  it('pesa, carga, vende, registra merma y devolución, recibe sobrante y cuadra en kg', async () => {
    const peso = await bodega().post('/api/etiquetas/kg-etiqueta/peso-neto')
      .send({ pesoKg: 20, origen: 'Manual' }).expect(200);
    expect(peso.body).toMatchObject({ pesoKg: 20, origen: 'Manual' });
    const etiquetaPesada = (await bodega().get('/api/etiquetas')).body.find((e: any) => e.id === 'kg-etiqueta');
    expect(etiquetaPesada).toMatchObject({ pesoNeto: 20, pesoOrigen: 'Manual', pesoRegistradoPor: 'kg-bodega' });

    await bodega().post('/api/bodega/ingresar-etiquetas').send({ codigos: ['ETQ-KG-001'], usuarioId: 'kg-bodega' }).expect(200);
    const guiaResp = await admin().post('/api/logistica/guias').send({
      camionId: 'kg-camion', etiquetasIds: ['kg-etiqueta'], responsablesCarga: 'kg-bodega', responsableTransporte: 'Comercial',
    }).expect(201);
    expect(guiaResp.body.totalKg).toBe(20);
    const guiaId = String((await client.execute({ sql: 'SELECT id FROM guias_despacho ORDER BY fecha DESC LIMIT 1' })).rows[0].id);

    const merma = await comercial().post('/api/logistica/merma').send({
      guiaId,
      etiquetaId: 'kg-etiqueta', cantidad: 0.2, unidad: 'kg', motivo: 'Huevo quebrado', responsable: 'Comercial',
    }).expect(201);
    expect(merma.body).toMatchObject({ cantidad: 0.2, unidad: 'kg', kgAutoritativo: true });

    const venta = await comercial().post('/api/logistica/caja/venta').send({
      guiaId, clienteId: 'kg-cliente', etiquetaId: 'kg-etiqueta', producto: 'Huevo Kg', cantidadKg: 8, precioUnitario: 1000, cobro: 'Efectivo',
    }).expect(201);
    expect(venta.body).toMatchObject({ cantidadKg: 8, unidad: 'kg', etiquetaId: 'kg-etiqueta' });

    const devolucion = await comercial().post('/api/logistica/caja/devolucion').send({
      guiaId, etiquetaId: 'kg-etiqueta', ventaRutaId: venta.body.ventaId, cantidadKg: 2, responsable: 'Comercial',
    }).expect(201);
    expect(devolucion.body).toMatchObject({ cantidadKg: 2, unidad: 'kg', estado: 'PendienteBodega' });

    await bodega().post('/api/logistica/bodega/retorno/aceptar').send({
      retornoId: devolucion.body.retornoId, responsable: 'Bodeguero',
    }).expect(200);

    await comercial().post('/api/logistica/caja/fin-dia').send({ guiaId, responsable: 'Comercial' }).expect(200);
    const sobrante = await bodega().post('/api/logistica/bodega/retorno/aceptar-sobrante').send({
      guiaId, responsable: 'Bodeguero', conteoPorProducto: [{ producto: 'Huevo Kg', cantidad: 11.8 }],
    }).expect(200);
    expect(sobrante.body.aceptados[0]).toMatchObject({ cantidad: 11.8, unidad: 'kg' });

    const cuadre = await bodega().get(`/api/logistica/cuadre-central?guiaId=${guiaId}`).expect(200);
    expect(cuadre.body.cuadre).toMatchObject({ cargado: 20, vendidos: 6, merma: 0.2, retornoAceptado: 13.8, saldoNoExplicado: 0, puedeCerrarSinDiferencia: true });
    const cierre = await admin().post('/api/logistica/cuadre-central').send({ guiaId, responsable: 'Admin' }).expect(200);
    expect(cierre.body.estado).toBe('Cerrada');

    const inventario = await bodega().get('/api/inventario');
    expect(inventario.body.find((i: any) => i.ubicacion === 'Camion Kg' && i.producto === 'Huevo Kg').cantidad).toBe(0);
    expect(inventario.body.find((i: any) => i.ubicacion === 'Bodega Central' && i.producto === 'Huevo Kg')).toMatchObject({ cantidad: 13.8, unidad: 'kg' });
  });
});
