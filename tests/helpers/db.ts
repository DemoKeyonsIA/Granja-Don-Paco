import { afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import fs from 'fs';
import { CREATE_TABLES } from '../../src/db/ddl';
import { aplicarIndicesDeConsulta } from '../../src/db/query-indexes';

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
  await aplicarIndicesDeConsulta(client);
}

/**
 * Cliente de libsql para un archivo de base de pruebas, con teardown garantizado.
 *
 * Treinta y un archivos de test abrían un `createClient` dentro de `beforeAll` y
 * nunca lo cerraban: la variable era local, así que su `afterAll` no podía
 * llegar a ella, y solo se dedicaba a borrar el `.db`. El handle nativo quedaba
 * vivo con el archivo borrado por debajo, y eso mataba al worker de Vitest de
 * forma intermitente — "Worker exited unexpectedly", más o menos una de cada tres
 * corridas, solo con `--pool=forks` (con `threads`, nunca). El síntoma no apuntaba
 * a ningún test en concreto, que es lo que lo hacía tan difícil de cazar.
 *
 * `abrirClienteDePrueba` deja el cliente registrado a nivel de módulo y el
 * `afterAll` de este archivo lo cierra y borra su base.
 *
 * Sobre el orden: Vitest ejecuta los `afterAll` al revés del registro, así que el
 * `afterAll` del propio test corre ANTES que este y su `unlinkSync` se lleva el
 * EBUSY de un archivo todavía abierto (por eso lo tenía envuelto en try/catch y por
 * eso los `.db` se acumulaban en el directorio). Aquí se cierra primero y se borra
 * después, con `force` para que una base ya borrada no rompa el teardown. El borrado
 * previo del test queda como no-op: es el helper quien deja el directorio limpio.
 */
const clientesAbiertos = new Map<any, string>();

export function abrirClienteDePrueba(url: string): any {
  const client = createClient({ url });
  const ruta = url.startsWith('file:') ? url.slice('file:'.length) : '';
  clientesAbiertos.set(client, ruta);
  return client;
}

/**
 * Cierra todo lo abierto por `abrirClienteDePrueba` y borra sus archivos.
 * Idempotente: se puede llamar a mano sin romper nada.
 */
export async function cerrarClientesDePrueba(): Promise<void> {
  for (const [client, ruta] of clientesAbiertos) {
    try { client.close(); } catch { /* ya cerrada */ }
    if (ruta) {
      // El addon nativo necesita un tick para soltar el archivo. Sin esto, borrar el
      // `.db` puede ganarle la carrera a `close()` y devolver EBUSY.
      await new Promise((r) => setTimeout(r, 50));
      try {
        fs.rmSync(ruta, { force: true });
        fs.rmSync(`${ruta}-journal`, { force: true });
      } catch { /* EBUSY */ }
    }
  }
  clientesAbiertos.clear();
}

try {
  // Solo dentro de Vitest. `helpers/db` también lo importa
  // `scripts/generar-fixtures-vistas.ts`, que corre en un Node normal donde no hay
  // suite: ahí `afterAll` lanza "Vitest failed to find the current suite", y el
  // teardown del generador lo hace el propio script.
  afterAll(async () => {
    await cerrarClientesDePrueba();
  });
} catch {
  // importado fuera de Vitest: quien abrió el cliente con
  // `abrirClienteDePrueba` es responsable de llamar a `cerrarClientesDePrueba()`.
}
