/**
 * Corre el seed REAL de Office (src/lib/officeSeed) contra el server de
 * desarrollo y despues verifica el estado resultante. No replica los payloads:
 * importa los datos del modulo, asi que lo que se comprueba es exactamente lo
 * que la app siembra.
 *
 *   npx tsx scripts/sembrar-office.ts            # siembra si esta vacio
 *   npx tsx scripts/sembrar-office.ts --reset    # borra lo simulado y re-siembra
 *
 * Por que el reset toca la base y no la API: no existe
 * `DELETE /api/office/documentos/:id` (solo hay de cuentas y de
 * vinculaciones), asi que por API los documentos viejos se quedan y el
 * resiembra se encima encima. Agregar un endpoint de borrado al producto solo
 * para acomodar un script seria cambiar el software por la herramienta.
 *
 * El borrado esta acotado a los artefactos del seed (los dos emails y los
 * nombres de archivo de la simulacion) y va en transaccion: si alguien ya
 * metio datos reales de Drive, este script no los toca.
 */
import { createClient } from '@libsql/client';
import {
  CUENTAS_INICIALES, MENSAJES_INICIALES, REGLAS_INICIALES, DOCUMENTOS_INICIALES,
  sembrarOfficeInicial,
} from '../src/lib/officeSeed';

const BASE = process.env.BASE || 'http://localhost:5174';
const DB = process.env.DB || 'local.db';

const EMPRES = CUENTAS_INICIALES.map((c) => c.email);
const ARCHIVOS = DOCUMENTOS_INICIALES.map((d) => d.archivoNombre);
const HILOS = MENSAJES_INICIALES.map((m) => m.th);

const marcar = (n: number) => Array(n).fill('?').join(',');

async function resetSimulacion() {
  const c = createClient({ url: `file:${DB}` });
  const en = (arr: string[]) => arr.map(() => '?').join(',');
  // El borrado de mensajes va por `thread_id`: los `threadId` del seed son los
  // unicos que este script conoce, y borrar por `remitente_email` cruzaria los
  // campos (ahi vive un correo, no un hilo).
  const res = await c.batch([
    { sql: `delete from office_drive_index where archivo_nombre in (${en(ARCHIVOS)})`, args: ARCHIVOS },
    { sql: `delete from office_messages where thread_id in (${en(HILOS)})`, args: HILOS },
    { sql: `delete from office_links where nombre_cuenta in (${en(EMPRES)})`, args: EMPRES },
    { sql: `delete from office_accounts where email in (${en(EMPRES)})`, args: EMPRES },
  ], 'write');
  const total = res.reduce((n, x) => n + x.rowsAffected, 0);
  console.log(`  borradas ${total} fila(s) de la simulacion en ${DB}`);
  c.close();
}

async function login(): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@granja.com', password: '1234' }),
  });
  if (!r.ok) throw new Error(`login ${r.status}: ${await r.text()}`);
  const j: any = await r.json();
  console.log(`sesion: ${j.user.name} (${j.user.role})`);
  return j.token;
}

const main = async () => {
  const token = await login();
  const real = globalThis.fetch;
  const authFetch = (url: any, init: any = {}) =>
    real(String(url).startsWith('/') ? `${BASE}${url}` : url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
  const get = async (p: string) => (await authFetch(p)).json();

  if (process.argv.includes('--reset')) {
    console.log('\n-- reset --');
    await resetSimulacion();
    const quedan = (await get('/api/office/cuentas')) as any[];
    console.log(`  cuentas tras el reset: ${quedan.length}`);
  }

  console.log('\n-- sembrando --');
  const hubo = await sembrarOfficeInicial(authFetch);
  console.log(hubo ? 'sembrado' : 'ya habia cuentas: no se hizo nada');

  const cuentas: any[] = await get('/api/office/cuentas');
  const mensajes: any[] = await get('/api/office/mensajes');
  const docs: any[] = await get('/api/office/documentos');
  const arbol: any = await get('/api/office/arbol');
  const vinculos: any[] = await get('/api/office/vinculaciones');
  const resumen: any = await get('/api/office/resumen');

  console.log('\n== CUENTAS ==');
  for (const c of cuentas) console.log(` ${c.email.padEnd(26)} ${c.etiqueta.padEnd(16)} ${c.provider}  scope="${c.scope}"  ${c.estado}`);

  console.log('\n== MENSAJES ==');
  for (const m of mensajes) console.log(` ${m.leido ? ' ' : 'U'} ${String(m.remitente).padEnd(20)} ${m.asunto.slice(0, 38).padEnd(40)} adj=${m.adjuntoCount} hilo=${m.threadId}`);

  console.log('\n== DOCUMENTOS ==');
  for (const d of docs) console.log(` ${d.huerfano ? 'H' : ' '} ${d.archivoNombre.padEnd(32)} ${String(d.archivoTipo).padEnd(4)} ${(d.carpeta || '').padEnd(30)} hilo=${d.threadId || '-'}`);

  console.log('\n== VINCULACIONES ==');
  for (const v of vinculos) console.log(` ${v.nombreCuenta.padEnd(26)} ${String(v.criterioTipo).padEnd(7)} ${String(v.criterioValor).padEnd(10)} -> ${v.carpeta || '(sin carpeta)'}  accountId=${v.accountId ? 'ok' : 'NULO'}`);

  console.log('\n== ARBOL DE CARPETAS ==');
  for (const n of arbol.arbol) console.log(` ${n.carpeta.padEnd(32)} ${n.total} archivo(s), ${n.huerfanos} huerfano(s)`);
  for (const s of arbol.sinCarpeta) console.log(` (sin carpeta) ${s.nombreCuenta}`);

  console.log('\n== RESUMEN ==');
  console.log(' ', JSON.stringify(resumen));

  // ---- Chequeos: contra el estado ESPERADO, no solo consistencia interna.
  // Una version anterior de estos chequeos daba "OK" con 0 mensajes y 8
  // huerfanos, porque solo verificaba que lo que habia era coherente consigo
  // mismo. Un estado vacio es coherente consigo mismo y esta roto.
  const problemas: string[] = [];
  const eq = (que: string, real_: number, esperado: number) => {
    if (real_ !== esperado) problemas.push(`${que}: se esperaban ${esperado} y hay ${real_}`);
  };

  eq('cuentas', cuentas.length, CUENTAS_INICIALES.length);
  eq('mensajes', mensajes.length, MENSAJES_INICIALES.length);
  eq('documentos', docs.length, DOCUMENTOS_INICIALES.length);
  eq('vinculaciones', vinculos.length, REGLAS_INICIALES.length);

  for (const e of EMPRES) {
    if (!cuentas.some((c) => c.email === e)) problemas.push(`falta la cuenta ${e}`);
  }
  for (const c of cuentas) {
    if (c.provider !== 'google') problemas.push(`${c.email} no quedo como provider google`);
    if (!c.scope) problemas.push(`${c.email} quedo sin scope: no se ve como Gmail conectada`);
  }
  for (const v of vinculos) {
    if (!v.accountId) problemas.push(`regla "${v.nombreCuenta}" quedo sin accountId`);
  }

  const hilos = new Set(mensajes.map((m) => m.threadId));
  for (const m of mensajes) {
    const conDocs = docs.filter((d) => d.threadId === m.threadId).length;
    if (m.adjuntoCount > 0 && conDocs === 0) problemas.push(`"${m.asunto}" dice ${m.adjuntoCount} adjunto(s) pero no tiene ningun documento`);
  }
  const deHilo = docs.filter((d) => !d.huerfano);
  const huerfanos = docs.filter((d) => d.huerfano);
  eq('documentos de hilo', deHilo.length, DOCUMENTOS_INICIALES.filter((d) => d.threadId).length);
  eq('documentos huerfanos', huerfanos.length, DOCUMENTOS_INICIALES.filter((d) => !d.threadId).length);
  for (const d of deHilo) {
    if (!hilos.has(d.threadId)) problemas.push(`${d.archivoNombre} dice "de hilo" pero su hilo no existe`);
  }
  for (const d of huerfanos) {
    if (d.threadId) problemas.push(`${d.archivoNombre} esta marcado huerfano pero tiene hilo`);
  }
  // Cada carpeta de la simulacion tiene que existir en el arbol.
  for (const carpeta of new Set(DOCUMENTOS_INICIALES.map((d) => d.carpeta))) {
    if (!arbol.arbol.some((n: any) => n.carpeta === carpeta)) problemas.push(`la carpeta ${carpeta} no aparece en el arbol`);
  }

  console.log('\n== CHEQUEOS ==');
  console.log(` mensajes con adjuntos: ${mensajes.filter((m) => m.adjuntoCount > 0).length}`);
  console.log(` documentos de hilo:    ${deHilo.length}`);
  console.log(` documentos huerfanos:  ${huerfanos.length}`);
  console.log('');
  if (problemas.length) {
    console.log('FALLOS:');
    for (const p of problemas) console.log('  - ' + p);
    process.exit(1);
  }
  console.log('OK: la simulacion esta sembrada y completa.');
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
