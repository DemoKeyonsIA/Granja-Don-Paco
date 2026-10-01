import { CREATE_TABLES } from '../../src/db/ddl';

/**
 * Los seeds de los tests insertan filas en cualquier orden, mientras que el
 * servidor de producción crea las filas padre siempre antes. La paridad que
 * protege este helper es la de COLUMNAS con el schema (que era la fuente de
 * los 500 por DDL incompleto), no el chequeo de foreign keys.
 *
 * En @libsql/client cada `client.transaction()` cierra la conexión actual y la
 * siguiente operación abre una NUEVA conexión donde `PRAGMA foreign_keys`
 * vuelve a su valor por defecto (ON). Por eso un solo PRAGMA al iniciar no
 * basta: se reaplica antes de cada execute y de cada transaction.
 */
export function desactivarFks(client: any): void {
  const origExecute = client.execute.bind(client);
  const origTransaction = client.transaction.bind(client);
  client.execute = async (stmt: any, ...args: any[]) => {
    try {
      await origExecute('PRAGMA foreign_keys = OFF;');
    } catch {
      // conexión en uso; se ignora
    }
    return origExecute(stmt, ...args);
  };
  client.transaction = async (...args: any[]) => {
    try {
      await origExecute('PRAGMA foreign_keys = OFF;');
    } catch {
      // conexión en uso; se ignora
    }
    return origTransaction(...args);
  };
}

export async function ejecutarDdl(client: any): Promise<void> {
  desactivarFks(client);
  for (const sql of CREATE_TABLES) {
    await client.execute(sql);
  }
}