import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, abrirClienteDePrueba } from './helpers/db';
import { expectApi } from './helpers/http';

let app: Express;
let testDb: ReturnType<typeof drizzle>;
const DB_PATH = path.resolve(process.cwd(), '.test-admin-users.db');

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — Admin Usuarios (CRUD con roles múltiples y estado)', () => {
  it('crea usuario con roles CSV y activo', async () => {
    const res = await request(app).post('/api/users').send({
      name: 'Juan Camionero', email: 'juan@granja.com', role: 'Camionero', roles: 'Despachador,Bodeguero', activo: true,
    });
    expectApi(res, 201);
    const u = (await testDb.select().from(schema.users)).find((x: any) => x.id === res.body.id);
    expect(u?.roles).toBe('Despachador,Bodeguero');
  });

  it('rechaza email duplicado', async () => {
    const res = await request(app).post('/api/users').send({ name: 'Dup', email: 'juan@granja.com', role: 'Camionero' });
    expect(res.status).toBe(400);
  });

  it('listar usuarios incluye roles y activo', async () => {
    const res = await request(app).get('/api/users');
    expectApi(res, 200);
    const juan = res.body.find((u: any) => u.email === 'juan@granja.com');
    expect(juan?.roles).toBe('Despachador,Bodeguero');
    expect(juan?.activo).toBe(true);
  });

  it('actualiza rol/estado y resetea clave', async () => {
    const u = (await testDb.select().from(schema.users)).find((x: any) => x.email === 'juan@granja.com');
    const res = await request(app).put(`/api/users/${u!.id}`).send({
      role: 'Despachador', roles: 'Camionero', activo: false, password: 'nueva123',
    });
    expectApi(res, 200);
    const after = (await testDb.select().from(schema.users)).find((x: any) => x.id === u!.id);
    expect(after?.role).toBe('Despachador');
    expect(after?.roles).toBe('Camionero');
    expect(after?.activo).toBe(false);
  });

  it('elimina un usuario', async () => {
    const u = (await testDb.select().from(schema.users)).find((x: any) => x.email === 'juan@granja.com');
    const res = await request(app).delete(`/api/users/${u!.id}`);
    expectApi(res, 200);
    const after = await testDb.select().from(schema.users);
    expect(after.some((x: any) => x.id === u!.id)).toBe(false);
  });

  it('NO elimina un usuario que es encargado de granja (409 + mensaje)', async () => {
    const maria = (await testDb.select().from(schema.users)).find((x: any) => x.email === 'admin@granja.com');
    await request(app).post('/api/granjas').send({
      nombre: 'Granja Linda', ubicacion: 'Cartago', encargadoId: maria!.id,
    });
    const res = await request(app).delete(`/api/users/${maria!.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('granja(s) a cargo');
    const after = await testDb.select().from(schema.users);
    expect(after.some((x: any) => x.id === maria!.id)).toBe(true);
  });
});