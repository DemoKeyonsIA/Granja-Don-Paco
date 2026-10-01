import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { ejecutarDdl } from './helpers/db';

let app: Express;
const DB_PATH = path.resolve(process.cwd(), '.test-auth.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);
  const testDb = drizzle(client, { schema });
  await client.execute({
    sql: `INSERT INTO users (id, name, email, role, password_hash, activo) VALUES (?, ?, ?, ?, ?, 1)`,
    args: ['1', 'Administrador', 'admin@granja.com', 'Admin', hashPassword('1234')]
  });
  await client.execute({
    sql: `INSERT INTO users (id, name, email, role, password_hash, activo) VALUES (?, ?, ?, ?, ?, 0)`,
    args: ['9', 'Ex Empleado', 'inactivo@granja.com', 'Vendedor', hashPassword('1234')]
  });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('AUTH — login real por token', () => {
  let token: string;

  it('hashPassword/verifyPassword — cifra y valida', () => {
    const h = hashPassword('1234');
    expect(h).toContain(':');
    expect(verifyPassword('1234', h)).toBe(true);
    expect(verifyPassword('otra', h)).toBe(false);
    expect(verifyPassword('1234', '')).toBe(false);
  });

  it('login ok devuelve token y usuario', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@granja.com', password: '1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toMatchObject({ id: '1', name: 'Administrador', role: 'Admin', email: 'admin@granja.com' });
    token = res.body.token;
  });

  it('login acepta email case-insensitive', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ADMIN@GRANJA.COM', password: '1234' });
    expect(res.status).toBe(200);
  });

  it('GET /api/auth/me con token válido', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@granja.com');
  });

  it('login con password incorrecta → 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@granja.com', password: 'mala' });
    expect(res.status).toBe(401);
  });

  it('login con email desconocido → 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nadie@granja.com', password: '1234' });
    expect(res.status).toBe(401);
  });

  it('login sin datos → 400', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('usuario inactivo no puede entrar', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'inactivo@granja.com', password: '1234' });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me sin token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('token inválido → 401', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token-falso');
    expect(res.status).toBe(401);
  });

  it('logout invalida el token', async () => {
    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
  });

  it('GET /api/users no expone password_hash', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const admin = res.body.find((u: any) => u.id === '1');
    expect(admin).toBeDefined();
    expect(admin.passwordHash).toBeUndefined();
    expect(admin.password_hash).toBeUndefined();
  });
});