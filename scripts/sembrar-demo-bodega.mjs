import { createRequire } from 'node:module';

// Datos sintéticos idempotentes para enseñar las vistas de existencias,
// entradas y control de Bodega. No borra ni reemplaza datos locales.
const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('local.db');
db.configure('busyTimeout', 5000);

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (error) {
    if (error) reject(error); else resolve({ changes: this.changes, lastID: this.lastID });
  });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
});
const days = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const now = () => new Date().toISOString();

try {
  await run('BEGIN IMMEDIATE');
  const farm = await get("SELECT id, nombre FROM granjas ORDER BY nombre LIMIT 1");
  const truck = await get("SELECT id, nombre FROM camiones WHERE nombre = 'Camión Ruta 10' LIMIT 1")
    || await get('SELECT id, nombre FROM camiones ORDER BY nombre LIMIT 1');
  const admin = await get("SELECT id FROM users WHERE id IN ('1','admin-001') ORDER BY CASE id WHEN '1' THEN 0 ELSE 1 END LIMIT 1");
  if (!farm || !truck || !admin) throw new Error('Faltan granja, camión o administrador para sembrar Bodega demo.');

  const lotes = [
    { id: 'DEMO-BOD-LOTE-GRANDE-01', tag: 'DEMO-BOD-GRANDE-01', producto: 'Huevos - Grande', kg: 18, vence: 4, lote: 'DEMO-GRANDE-NOV-01', clasificacion: 'Grande' },
    { id: 'DEMO-BOD-LOTE-MEDIANO-01', tag: 'DEMO-BOD-MEDIANO-01', producto: 'Huevos - Mediano', kg: 21, vence: 15, lote: 'DEMO-MEDIANO-NOV-01', clasificacion: 'Mediano' },
    { id: 'DEMO-BOD-LOTE-PEQUENO-01', tag: 'DEMO-BOD-PEQUENO-01', producto: 'Huevos - Pequeño', kg: 12, vence: 24, lote: 'DEMO-PEQUENO-NOV-01', clasificacion: 'Pequeño' },
  ];

  for (const lote of lotes) {
    await run(`INSERT OR IGNORE INTO etiquetas
      (id, codigo_unico, producto, cantidad, peso_bruto, peso_neto, saldo_kg,
       fecha_produccion, fecha_empaque, fecha_vencimiento, granja_origen,
       galeron_origen, clasificacion, tara, estado, ubicacion_actual, lote,
       peso_bodega, fecha_recepcion, unidad, peso_origen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EnBodega',
        'Bodega Central', ?, ?, ?, 'kg', 'kg')`,
    [lote.id, lote.tag, lote.producto, lote.kg, lote.kg + 0.4, lote.kg, lote.kg,
      days(-1), days(-1), days(lote.vence), farm.nombre, 'Galerón 2', lote.clasificacion,
      0.4, lote.lote, lote.kg, now()]);

    await run(`INSERT OR IGNORE INTO inventario
      (id, producto, cantidad, unidad, ubicacion, lote, fecha_caducidad, ultima_actualizacion)
      VALUES (?, ?, ?, 'kg', 'Bodega Central', ?, ?, ?)`,
    [`${lote.id}-INV`, lote.producto, lote.kg, lote.lote, days(lote.vence), now()]);

    await run(`INSERT OR IGNORE INTO movimientos_inventario
      (id, producto, cantidad, unidad, tipo, origen, destino, fecha, referencia_id)
      VALUES (?, ?, ?, 'kg', 'Entrada Demo', ?, 'Bodega Central', ?, ?)`,
    [`${lote.id}-MOV`, lote.producto, lote.kg, `Producción · ${farm.nombre}`, now(), lote.lote]);
  }

  // Un traslado en kilos, enlazado a la entidad de traslado y al kardex para
  // que la recepción pueda completarse desde la misma interfaz.
  const trasladoId = 'DEMO-BOD-TRASLADO-KG-20261114';
  await run(`INSERT OR IGNORE INTO traslados
    (id, camion_id, granja_origen_id, bodega_destino_id, fecha_salida,
     responsable_entrega, responsable_transporte, estado, vehiculo, observaciones)
    VALUES (?, ?, ?, 'Bodega Central', ?, 'Encargado de granja · demo',
     'Chofer demo', 'EnTransito', ?, 'Traslado de demostración; cantidad expresada en kg.')`,
  [trasladoId, truck.id, farm.id, now(), truck.nombre]);
  await run(`INSERT OR IGNORE INTO movimientos_inventario
    (id, producto, cantidad, tipo, origen, destino, fecha, referencia_id, unidad)
    VALUES (?, 'Huevos - Mediano', 14, 'Traslado', ?, 'Bodega Central', ?, ?, 'kg')`,
  [`${trasladoId}-MOV`, farm.nombre, now(), trasladoId]);

  // Retorno parcial visible en Control. La reserva de 2.5 kg en el camión
  // permite que el botón de aceptación funcione durante la demostración.
  const guiaId = 'DEMO-BOD-GUIA-RETORNO-20261114';
  const retornoId = 'DEMO-BOD-RETORNO-PENDIENTE-20261114';
  await run(`INSERT OR IGNORE INTO guias_despacho
    (id, consecutivo, camion_id, ruta_id, fecha, responsable_carga,
     responsable_transporte, total_cartones, total_kg, peso_salida, estado, recibido_en)
    VALUES (?, 'GD-DEMO-BOD-RET-20261114', ?, 'demo-ruta-bodega', ?,
      'Bodega demo', 'Chofer demo', 0, 2.5, 2.5, 'Cerrada', ?)`,
  [guiaId, truck.id, now(), now()]);
  await run(`INSERT OR IGNORE INTO inventario
    (id, producto, cantidad, unidad, ubicacion, lote, ultima_actualizacion)
    VALUES (?, 'Huevos - Mediano', 2.5, 'kg', ?, 'DEMO-MEDIANO-NOV-01', ?)`,
  [`${retornoId}-CAMION`, truck.nombre, now()]);
  await run(`INSERT OR IGNORE INTO retornos_camion
    (id, guia_id, fecha, responsable, producto, cartones, unidad,
     cantidad_aceptada, peso, estado, tipo)
    VALUES (?, ?, ?, 'Chofer demo', 'Huevos - Mediano', 2.5, 'kg', 0, 2.5,
      'PendienteBodega', 'sobrante')`,
  [retornoId, guiaId, now()]);

  await run(`INSERT OR IGNORE INTO auditoria
    (id, usuario_id, accion, modulo, referencia_id, valores_antes,
     valores_despues, motivo, fecha)
    VALUES ('DEMO-BOD-AUDITORIA-20261114', ?, 'Crear', 'Bodega',
      'DEMO-BODEGA-20261114', NULL, ?,
      'Carga sintética idempotente para demostración; no representa operaciones reales.', ?)`,
  [admin.id, JSON.stringify({ lots: lotes.map(l => l.lote), transferKg: 14, returnKg: 2.5 }), now()]);

  await run('COMMIT');
  const summary = await Promise.all([
    get("SELECT producto, unidad, SUM(cantidad) AS kg FROM inventario WHERE ubicacion='Bodega Central' AND unidad='kg' GROUP BY producto, unidad"),
    get("SELECT COUNT(*) AS total FROM traslados WHERE id=? AND estado='EnTransito'", [trasladoId]),
    get("SELECT COUNT(*) AS total FROM retornos_camion WHERE id=? AND estado='PendienteBodega'", [retornoId]),
  ]);
  console.log(JSON.stringify({ lotsAdded: lotes.length, kgInTransit: 14, pendingReturnKg: 2.5, bodegaKgByProduct: summary[0], inTransitTransfers: summary[1]?.total, pendingReturns: summary[2]?.total }, null, 2));
} catch (error) {
  await run('ROLLBACK').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  db.close();
}
