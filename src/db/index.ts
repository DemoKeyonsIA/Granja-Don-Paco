import { drizzle } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import * as schema from './schema';
import path from 'path';

let _client: Client | null = null;

export function getDbClient(dbUrl?: string): Client {
  if (!_client) {
    const url = dbUrl || `file:${path.resolve(process.cwd(), 'local.db')}`;
    _client = createClient({ url });
  }
  return _client;
}

export function createTestDb() {
  const client = createClient({ url: ':memory:' });
  return drizzle(client, { schema });
}

export const sqliteClient = getDbClient();
export const db = drizzle(sqliteClient, { schema });
