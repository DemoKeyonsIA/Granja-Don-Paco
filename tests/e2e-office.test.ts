import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema.sqlite';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';
import { expectApi } from './helpers/http';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
const DB_PATH = path.resolve(process.cwd(), '.test-office.db');

// IDs de los usuarios de prueba. El auth en tests se resuelve por x-user-id.
const ADMIN = 'adm-1';
const SOCIO = 'soc-1';
const COMERCIAL = 'com-1';
const CAMIONERO = 'cam-1';
const BODEGUERO = 'bod-1';

const como = (id: string, req: request.Test) => req.set('x-user-id', id);

async function crearUsuarios(db: any) {
  await db.insert(schema.users).values([
    { id: ADMIN, name: 'Administradora', email: 'admin@gdp.cr', role: 'Admin' },
    { id: SOCIO, name: 'Socio', email: 'socio@gdp.cr', role: 'Socio' },
    { id: COMERCIAL, name: 'Comercial', email: 'comercial@gdp.cr', role: 'Comercial' },
    { id: CAMIONERO, name: 'Camionero', email: 'camionero@gdp.cr', role: 'Camionero' },
    { id: BODEGUERO, name: 'Bodeguero', email: 'bodeguero@gdp.cr', role: 'Bodeguero' },
  ]);
}

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  testDb = drizzle(client, { schema });
  await crearUsuarios(testDb);
  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — Office (correo + documentos + vinculaciones)', () => {
  let cuentaId = '';
  let reglaId = '';

  it('Admin conecta una cuenta local', async () => {
    const res = await como(ADMIN, request(app).post('/api/office/cuentas')).send({
      email: 'proveedores@gdp.cr', etiqueta: 'Proveedores', color: '#B8860B',
    });
    expectApi(res, 201, 'conectar cuenta');
    expect(res.body.provider).toBe('local');
    expect(res.body.estado).toBe('Conectada');
    cuentaId = res.body.id;
  });

  it('rechaza email inválido y etiqueta faltante', async () => {
    const sinAt = await como(ADMIN, request(app).post('/api/office/cuentas')).send({ email: 'no-es-email', etiqueta: 'X' });
    expectApi(sinAt, 400);
    const sinEtiqueta = await como(ADMIN, request(app).post('/api/office/cuentas')).send({ email: 'otra@gdp.cr' });
    expectApi(sinEtiqueta, 400);
  });

  it('rechaza cuenta duplicada (case-insensitive)', async () => {
    const res = await como(ADMIN, request(app).post('/api/office/cuentas')).send({
      email: 'PROVEEDORES@Gdp.cr', etiqueta: 'Duplicada',
    });
    expectApi(res, 409);
  });

  it('Socio y Comercial ven la bandeja, pero no pueden conectar cuentas', async () => {
    const socioList = await como(SOCIO, request(app).get('/api/office/cuentas'));
    expectApi(socioList, 200, 'socio lista cuentas');
    expect(socioList.body.length).toBe(1);

    const comList = await como(COMERCIAL, request(app).get('/api/office/cuentas'));
    expectApi(comList, 200, 'comercial lista cuentas');

    const comPost = await como(COMERCIAL, request(app).post('/api/office/cuentas')).send({
      email: 'ventas@gdp.cr', etiqueta: 'Ventas',
    });
    expectApi(comPost, 403, 'comercial no conecta');
  });

  it('Bodeguero no accede a Office; Comercial (incluido el perfil Camionero legado) sí puede leer', async () => {
    const res = await como(BODEGUERO, request(app).get('/api/office/cuentas'));
    expectApi(res, 403);
    const camionero = await como(CAMIONERO, request(app).get('/api/office/cuentas'));
    expectApi(camionero, 200);
  });

  it('Admin crea una regla automática; no-admin no', async () => {
    const comIntent = await como(COMERCIAL, request(app).post('/api/office/vinculaciones')).send({
      nombreCuenta: 'proveedores@gdp.cr', carpeta: 'Drive/Finanzas/Proveedores', criterioTipo: 'subject', criterioValor: 'factura',
    });
    expectApi(comIntent, 403, 'comercial no crea reglas');

    const res = await como(ADMIN, request(app).post('/api/office/vinculaciones')).send({
      nombreCuenta: 'proveedores@gdp.cr', carpeta: 'Drive/Finanzas/Proveedores', criterioTipo: 'subject', criterioValor: 'factura',
    });
    expectApi(res, 201, 'admin crea regla');
    reglaId = res.body.id;
  });

  it('rechaza regla automática sin carpeta destino', async () => {
    const res = await como(ADMIN, request(app).post('/api/office/vinculaciones')).send({
      nombreCuenta: 'proveedores@gdp.cr', criterioTipo: 'subject', criterioValor: 'factura',
    });
    expectApi(res, 400);
  });

  it('ingesta un mensaje y lo aplica a la regla en la bandeja', async () => {
    const res = await como(ADMIN, request(app).post('/api/office/mensajes')).send({
      accountId: cuentaId, threadId: 'th-1', remitente: 'Huevos Pollo Feliz',
      remitenteEmail: 'facturacion@hpf.cr', asunto: 'Factura 0123 corregida',
      preview: 'Adjuntamos la factura', labelIds: 'facturas', recibidos: 3, leido: 0, adjuntoCount: 2,
    });
    expectApi(res, 201, 'ingesta mensaje');

    const lista = await como(SOCIO, request(app).get('/api/office/mensajes'));
    expectApi(lista, 200);
    const msg = lista.body.find((m: any) => m.threadId === 'th-1');
    expect(msg?.etiquetaCuenta).toBe('Proveedores');
    expect(msg?.carpeta).toBe('Drive/Finanzas/Proveedores');
    expect(msg?.reglaId).toBe(reglaId);
  });

  it('filtra la bandeja por texto y por adjuntos', async () => {
    await como(ADMIN, request(app).post('/api/office/mensajes')).send({
      accountId: cuentaId, threadId: 'th-2', remitente: 'Banco Nacional',
      remitenteEmail: 'notif@bncr.cr', asunto: 'Estado de cuenta', leido: 1, adjuntoCount: 0,
    });

    const q = await como(SOCIO, request(app).get('/api/office/mensajes?q=pollo'));
    expectApi(q, 200);
    expect(q.body.length).toBe(1);

    const conAdj = await como(SOCIO, request(app).get('/api/office/mensajes?conAdjuntos=true'));
    expectApi(conAdj, 200);
    expect(conAdj.body.every((m: any) => m.adjuntoCount > 0)).toBe(true);
  });

  it('abre el hilo con sus documentos y marca leído', async () => {
    const hilo = await como(SOCIO, request(app).get('/api/office/mensajes/th-1'));
    expectApi(hilo, 200);
    expect(hilo.body.hilo.length).toBe(1);
    expect(hilo.body.carpeta).toBe('Drive/Finanzas/Proveedores');

    const msgId = hilo.body.hilo[0].id;
    const leer = await como(SOCIO, request(app).post(`/api/office/mensajes/${msgId}/leer`)).send({});
    expectApi(leer, 200);
    expect(leer.body.leido).toBe(1);
  });

  it('sube un documento huérfano y lo vincula a un hilo', async () => {
    const subida = await como(ADMIN, request(app).post('/api/office/documentos')).send({
      archivoNombre: 'Factura 0123.pdf', archivoTipo: 'PDF', carpeta: 'Drive/Finanzas/Proveedores', bytes: 188416,
    });
    expectApi(subida, 201, 'subir documento');
    expect(subida.body.huerfano).toBe(true);

    const docId = subida.body.id;
    const vincular = await como(ADMIN, request(app).post(`/api/office/documentos/${docId}/vincular`)).send({ threadId: 'th-1' });
    expectApi(vincular, 200);
    expect(vincular.body.huerfano).toBe(false);
    expect(vincular.body.threadId).toBe('th-1');

    const hilo = await como(SOCIO, request(app).get('/api/office/mensajes/th-1'));
    expect(hilo.body.documentos.some((d: any) => d.id === docId)).toBe(true);
  });

  it('rechaza vincular a un hilo inexistente', async () => {
    const doc = await como(ADMIN, request(app).post('/api/office/documentos')).send({
      archivoNombre: 'Suelto.pdf', carpeta: 'Drive/Finanzas/Proveedores',
    });
    const res = await como(ADMIN, request(app).post(`/api/office/documentos/${doc.body.id}/vincular`)).send({ threadId: 'no-existe' });
    expectApi(res, 404);
  });

  it('árbol de carpetas cuenta archivos y huérfanos', async () => {
    await como(ADMIN, request(app).post('/api/office/documentos')).send({
      archivoNombre: 'Suelto 2.pdf', carpeta: 'Drive/Finanzas/Proveedores',
    });
    const res = await como(SOCIO, request(app).get('/api/office/arbol'));
    expectApi(res, 200);
    const nodo = res.body.arbol.find((a: any) => a.carpeta === 'Drive/Finanzas/Proveedores');
    expect(nodo.total).toBe(3);
    expect(nodo.huerfanos).toBe(2);
  });

  it('probar reglas es dry-run: reporta coincidencias y no escribe', async () => {
    const antes = (await testDb.select().from(schema.officeMessages)).length;
    const res = await como(ADMIN, request(app).post('/api/office/vinculaciones/probar'));
    expectApi(res, 200);
    expect(res.body.totalMensajes).toBe(antes);
    const regla = res.body.reglas.find((r: any) => r.id === reglaId);
    expect(regla.coincide).toBe(1);
    const despues = (await testDb.select().from(schema.officeMessages)).length;
    expect(despues).toBe(antes);
  });

  it('resumen reporta contadores coherentes', async () => {
    const res = await como(SOCIO, request(app).get('/api/office/resumen'));
    expectApi(res, 200);
    expect(res.body.cuentas).toBe(1);
    expect(res.body.mensajes).toBe(2);
    expect(res.body.reglas).toBe(1);
    expect(res.body.cuentasSinCarpeta).toBe(0);
    expect(res.body.documentosHuerfanos).toBe(2);
  });

  it('listar reglas y eliminarlas es solo Admin', async () => {
    // Vinculaciones pasó a ser un espacio de Office en la Fase 6, y Office es
    // visible para Socio y Comercial. El GET tiene que seguir siendo 403 para
    // ambos: es lo que hace que el espacio lleve `roles: ['Admin']` en la
    // configuración, y no solo la pantalla.
    const comList = await como(COMERCIAL, request(app).get('/api/office/vinculaciones'));
    expectApi(comList, 403);

    const socioList = await como(SOCIO, request(app).get('/api/office/vinculaciones'));
    expectApi(socioList, 403);

    const adminList = await como(ADMIN, request(app).get('/api/office/vinculaciones'));
    expectApi(adminList, 200);
    expect(adminList.body.length).toBe(1);

    const del = await como(ADMIN, request(app).delete(`/api/office/vinculaciones/${reglaId}`));
    expectApi(del, 200);
    const vacio = await como(ADMIN, request(app).get('/api/office/vinculaciones'));
    expect(vacio.body.length).toBe(0);
  });

  it('desconectar una cuenta borra sus mensajes y deja los documentos huérfanos (sin 500 por FK)', async () => {
    const res = await como(ADMIN, request(app).delete(`/api/office/cuentas/${cuentaId}`));
    expectApi(res, 200, 'desconectar cuenta');
    expect(res.body.mensajesEliminados).toBe(2);

    const mensajes = (await testDb.select().from(schema.officeMessages)).filter((m: any) => m.accountId === cuentaId);
    expect(mensajes.length).toBe(0);

    const docs = (await testDb.select().from(schema.officeDriveIndex)).filter((d: any) => d.threadId === 'th-1');
    expect(docs.length).toBe(0);
  });
});
