import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

type NeonDatabase = ReturnType<typeof drizzle<typeof schema>>;

let pool: Pool | null = null;
let database: NeonDatabase | null = null;

export function getNeonDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL no está configurada. Conecta Neon en el entorno de Vercel.');
  }

  if (!pool || !database) {
    pool = new Pool({ connectionString, max: 1 });
    database = drizzle({ client: pool, schema });
  }

  return { client: pool, db: database };
}
