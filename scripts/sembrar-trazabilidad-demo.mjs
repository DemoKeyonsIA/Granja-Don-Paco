import { createRequire } from 'node:module';

// Agrega eventos sintéticos e idempotentes a etiquetas DEMO-BOD existentes.
// No cambia inventario, estados de etiqueta ni operaciones reales.
const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('local.db');
db.configure('busyTimeout', 5000);

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
});
const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (error) {
    if (error) reject(error); else resolve({ changes: this.changes });
  });
});
const horasAtras = horas => new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();

try {
  await run('BEGIN IMMEDIATE');
  const etiquetas = await all(
    `SELECT id, codigo_unico AS codigo, producto, lote, granja_origen AS granja
     FROM etiquetas WHERE codigo_unico LIKE 'DEMO-BOD-%' ORDER BY codigo_unico LIMIT 3`
  );
  if (etiquetas.length === 0) throw new Error('No hay etiquetas DEMO-BOD. Ejecuta primero scripts/sembrar-demo-bodega.mjs.');
  const admin = await all("SELECT id FROM users WHERE id IN ('1','admin-001') ORDER BY CASE id WHEN '1' THEN 0 ELSE 1 END LIMIT 1");
  if (!admin[0]) throw new Error('No se encontró el usuario administrador para asociar los eventos demo.');

  const secuencia = [
    { clave: 'GENERADA', tipo: 'Generada', ubicacion: e => `Granja ${e.granja || 'Concepción'}`, horas: 40, doc: e => e.lote || 'DEMO-LOTE', detalle: 'DEMO · Etiqueta creada en origen.' },
    { clave: 'TRASLADO', tipo: 'En tránsito', ubicacion: () => 'Camión Ruta 10', horas: 30, doc: e => `REM-DEMO-${e.codigo.slice(-2)}`, detalle: 'DEMO · Salida de granja rumbo a Bodega Central.' },
    { clave: 'RECEPCION', tipo: 'Recibida en bodega', ubicacion: () => 'Bodega Central', horas: 27, doc: e => `REC-DEMO-${e.codigo.slice(-2)}`, detalle: 'DEMO · Recepción física confirmada en kilogramos.' },
    { clave: 'PESAJE', tipo: 'Pesada', ubicacion: () => 'Bodega Central', horas: 26, doc: e => `PESO-DEMO-${e.codigo.slice(-2)}`, detalle: 'DEMO · Peso neto verificado antes del almacenamiento.' },
  ];

  let insertados = 0;
  for (const etiqueta of etiquetas) {
    for (const evento of secuencia) {
      const resultado = await run(
        `INSERT OR IGNORE INTO traza_etiqueta
          (id, etiqueta_id, tipo_evento, ubicacion, documento_ref, usuario_id, fecha, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `DEMO-TRAZA-${etiqueta.id}-${evento.clave}`,
          etiqueta.id,
          evento.tipo,
          evento.ubicacion(etiqueta),
          evento.doc(etiqueta),
          admin[0].id,
          horasAtras(evento.horas),
          evento.detalle,
        ]
      );
      insertados += resultado.changes;
    }
  }
  await run('COMMIT');
  console.log(JSON.stringify({ etiquetas: etiquetas.map(e => ({ codigo: e.codigo, lote: e.lote, producto: e.producto })), eventosAgregados: insertados, eventosPorEtiqueta: secuencia.length }, null, 2));
} catch (error) {
  await run('ROLLBACK').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  db.close();
}
