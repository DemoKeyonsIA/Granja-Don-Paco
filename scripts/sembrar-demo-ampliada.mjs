import { createRequire } from 'node:module';

// Datos sintéticos para el entorno demo local. No crea comprobantes electrónicos
// ni altera el guía abierto: las facturas se etiquetan DEMO y no son fiscales.
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
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
});
const dateDaysAgo = days => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
};
const dateDaysAhead = days => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const dateOnlyDaysAgo = days => dateDaysAgo(days).slice(0, 10);
const uuid = id => `DEMO-EXP-${id}`;

try {
  await run('BEGIN IMMEDIATE');

  const clients = await all('SELECT id, nombre FROM clientes');
  const clientId = name => clients.find(c => c.nombre === name)?.id;
  const admin = await get("SELECT id FROM users WHERE id IN ('1','admin-001') ORDER BY CASE id WHEN '1' THEN 0 ELSE 1 END LIMIT 1");
  const seller = await get("SELECT id FROM users WHERE role = 'Comercial' ORDER BY id LIMIT 1");
  const farm = await get("SELECT id FROM granjas WHERE nombre = 'Concepcion' LIMIT 1");
  const house = await get("SELECT id FROM galerones WHERE nombre = 'Galerón 2' LIMIT 1")
    || await get("SELECT id FROM galerones WHERE nombre = 'Galeron 2' LIMIT 1");
  if (!clientId('Cliente Demostración') || !clientId('Pulpería Don José') || !clientId('Tienda La Esquina') || !admin || !seller || !farm || !house) {
    throw new Error('Faltan registros base de demo (clientes, usuario, granja o galerón).');
  }

  // Perfil de crédito para mostrar saldos, vencimientos, riesgo y cobros.
  await run("UPDATE clientes SET condicion_pago='Credito', limite_credito=50000, saldo_pendiente=20000 WHERE id=?", [clientId('Pulpería Don José')]);
  await run("UPDATE clientes SET condicion_pago='Credito', limite_credito=50000, saldo_pendiente=25000 WHERE id=?", [clientId('Mini Super San Ramón')]);
  await run("UPDATE clientes SET condicion_pago='Credito', limite_credito=80000, saldo_pendiente=65000 WHERE id=?", [clientId('Tienda Mar y Sol')]);

  const invoices = [
    { key: 'A-01', client: 'Cliente Demostración', days: 10, total: 120000, payment: 'Contado', state: 'Pagada' },
    { key: 'B-01', client: 'Pulpería Don José', days: 52, total: 75000, payment: 'Credito 30 días', state: 'Pagada' },
    { key: 'B-02', client: 'Pulpería Don José', days: 33, total: 75000, payment: 'Credito 30 días', state: 'Pagada' },
    { key: 'B-03', client: 'Pulpería Don José', days: 20, total: 30000, payment: 'Credito 15 días', state: 'Emitida', paid: 10000 },
    { key: 'C-01', client: 'Tienda La Esquina', days: 12, total: 45000, payment: 'Contado', state: 'Pagada' },
    { key: 'C-02', client: 'Mini Super San Ramón', days: 65, total: 55000, payment: 'Credito 30 días', state: 'Emitida', paid: 30000 },
    { key: 'C-03', client: 'Tienda Mar y Sol', days: 74, total: 65000, payment: 'Credito 15 días', state: 'Emitida', paid: 0 },
    { key: 'C-04', client: 'Abastecedor La Unión', days: 25, total: 98000, payment: 'Contado', state: 'Pagada' },
  ];
  for (const invoice of invoices) {
    const id = uuid(`FACT-${invoice.key}`);
    const issued = dateDaysAgo(invoice.days);
    const due = new Date(issued);
    due.setDate(due.getDate() + (invoice.payment === 'Contado' ? 0 : Number(invoice.payment.match(/\d+/)?.[0] || 0)));
    await run(`INSERT OR IGNORE INTO facturas
      (id, consecutivo, fecha, cliente_id, vendedor_id, subtotal, descuento, total, condicion_pago, metodo_pago, estado, fecha_vencimiento)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [id, `DEMO-${new Date().getFullYear()}-${invoice.key}`, issued, clientId(invoice.client), seller.id,
      invoice.total, invoice.total, invoice.payment, invoice.payment === 'Contado' ? 'Efectivo' : null, invoice.state, due.toISOString().slice(0, 10)]);
    await run(`INSERT OR IGNORE INTO detalles_factura (id, factura_id, producto, cantidad, precio_unitario, subtotal, resolucion_precio_json)
      VALUES (?, ?, 'Huevos Grandes', ?, 1200, ?, ?)`,
    [uuid(`DET-${invoice.key}`), id, invoice.total / 1200, invoice.total,
      JSON.stringify({ unidad: 'kg', precioKg: 1200, demo: true, origenPrecio: 'Política demo' })]);
    if (invoice.state === 'Pagada' || invoice.paid > 0) {
      await run(`INSERT OR IGNORE INTO pagos (id, factura_id, fecha, monto, metodo, usuario_id, nota, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(`PAGO-${invoice.key}`), id, issued, invoice.state === 'Pagada' ? invoice.total : invoice.paid,
        invoice.payment === 'Contado' ? 'Efectivo' : 'Transferencia', admin.id,
        invoice.state === 'Pagada' ? 'Pago completo · dato demo' : 'Abono parcial · dato demo', uuid(`IDEM-PAGO-${invoice.key}`)]);
    }
  }

  // Ejemplo de política individual por kilo con banda de negociación.
  const clientPriceListId = uuid('LISTA-PRECIO-JOSE');
  const started = dateOnlyDaysAgo(1);
  await run(`INSERT OR IGNORE INTO listas_precios
    (id, nombre, tipo, cliente_id, estado, fecha_inicio, fecha_fin, aprobado_por)
    VALUES (?, 'Demo cartera · precio por kilo', 'Cliente', ?, 'Activa', ?, ?, ?)`,
  [clientPriceListId, clientId('Pulpería Don José'), started, dateDaysAhead(45), admin.id]);
  await run(`INSERT OR IGNORE INTO precios_detalle
    (id, lista_id, producto, precio_unitario, precio_minimo, precio_maximo, descuento_maximo, unidad)
    VALUES (?, ?, 'Huevos Grandes', 1180, 1100, 1300, 0, 'kg')`,
  [uuid('PRECIO-JOSE'), clientPriceListId]);

  // Lote activo y producción diaria en kg para mostrar desempeño del plantel.
  const birdLotId = uuid('LOTE-AVES-ISA-BROWN');
  await run(`INSERT OR IGNORE INTO lotes_aves (id, galeron_id, fecha_ingreso, cantidad_inicial, linea_genetica, estado)
    VALUES (?, ?, ?, 4500, 'Hy-Line Brown · demo', 'Activo')`,
  [birdLotId, house.id, dateOnlyDaysAgo(125)]);
  const production = [];
  for (let day = 0; day < 14; day++) {
    for (const [product, kg] of [['Huevos - Grande', 148], ['Huevos - Mediano', 24]]) {
      const id = uuid(`PROD-${day}-${product.includes('Mediano') ? 'M' : 'G'}`);
      await run(`INSERT OR IGNORE INTO produccion_diaria
        (id, lote_id, granja_id, galeron_id, fecha, tipo_producto, cantidad, unidad, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'kg', 'Disponible')`,
      [id, birdLotId, farm.id, house.id, dateOnlyDaysAgo(day), product, kg]);
      production.push(id);
    }
  }

  // Registro de salud, alimento y mantenimiento con estados distintos.
  await run(`INSERT OR IGNORE INTO vacunaciones
    (id, granja_id, galeron_id, lote_id, tipo_vacuna, proveedor, dosis, metodo_aplicacion, fecha_programada, fecha_aplicada, responsable, estado, observaciones, proxima_fecha, fecha_creacion)
    VALUES (?, ?, ?, ?, 'Newcastle + Bronquitis', 'Proveedor veterinario demo', '1 dosis por ave', 'Agua de bebida', ?, ?, 'Encargado de Galerón', 'Aplicada', 'Registro demostrativo del lote.', ?, ?)`,
  [uuid('VACUNA-APLICADA'), farm.id, house.id, birdLotId, dateOnlyDaysAgo(20), dateOnlyDaysAgo(20), dateDaysAhead(70), dateDaysAgo(20)]);
  await run(`INSERT OR IGNORE INTO vacunaciones
    (id, granja_id, galeron_id, lote_id, tipo_vacuna, proveedor, dosis, metodo_aplicacion, fecha_programada, responsable, estado, observaciones, fecha_creacion)
    VALUES (?, ?, ?, ?, 'Refuerzo Newcastle', 'Proveedor veterinario demo', 'Según ficha técnica', 'Agua de bebida', ?, 'Encargado de Galerón', 'Programada', 'Próxima actividad · registro demo.', ?)`,
  [uuid('VACUNA-PROGRAMADA'), farm.id, house.id, birdLotId, dateDaysAhead(5), dateDaysAgo(1)]);

  const feedId = uuid('ALIMENTO-LOTE-ISA');
  await run(`INSERT OR IGNORE INTO inventario_alimento
    (id, tipo_alimento, proveedor, lote_alimento, silo_ubicacion, cantidad_recibida, cantidad_actual, unidad, galeron_asociado, lote_aves_asociado, fecha_ingreso, responsable, merma, estado)
    VALUES (?, 'Producción', 'Alimentos del Valle · demo', 'ALIM-DEMO-26-11', 'Silo 2', 5500, 2350, 'kg', ?, ?, ?, 'Encargado de Galerón', 0, 'Activo')`,
  [feedId, house.id, birdLotId, dateOnlyDaysAgo(7)]);
  for (let day = 0; day < 7; day++) {
    await run(`INSERT OR IGNORE INTO consumo_alimento
      (id, inventario_alimento_id, galeron_id, lote_aves_id, cantidad_consumida, unidad, fecha, responsable, observaciones)
      VALUES (?, ?, ?, ?, 450, 'kg', ?, 'Encargado de Galerón', 'Consumo diario registrado · dato demo.')`,
    [uuid(`CONSUMO-${day}`), feedId, house.id, birdLotId, dateOnlyDaysAgo(day)]);
  }

  const assetId = uuid('ACTIVO-VENTILACION-G2');
  await run(`INSERT OR IGNORE INTO activos_mantenimiento
    (id, nombre, tipo, granja_id, galeron_id, ubicacion, estado, fecha_ultimo_mantenimiento, proximo_mantenimiento, responsable)
    VALUES (?, 'Ventilación · Galerón 2', 'Ventilación', ?, ?, 'Galerón 2', 'Operativo', ?, ?, 'Mantenimiento demo')`,
  [assetId, farm.id, house.id, dateOnlyDaysAgo(12), dateDaysAhead(8)]);
  await run(`INSERT OR IGNORE INTO ordenes_mantenimiento
    (id, activo_id, tipo, fecha_programada, fecha_ejecutada, responsable, estado, costo, observaciones, proxima_fecha, checklist)
    VALUES (?, ?, 'Preventivo', ?, ?, 'Equipo de mantenimiento', 'Completado', 18500, 'Limpieza y revisión del sistema; registro demo.', ?, ?)`,
  [uuid('ORDEN-MANTENIMIENTO-COMPLETADA'), assetId, dateOnlyDaysAgo(12), dateOnlyDaysAgo(12), dateDaysAhead(8), JSON.stringify([{ item: 'Limpieza', ok: true }, { item: 'Motor', ok: true }])]);
  await run(`INSERT OR IGNORE INTO ordenes_mantenimiento
    (id, activo_id, tipo, fecha_programada, responsable, estado, costo, observaciones)
    VALUES (?, ?, 'Inspección', ?, 'Equipo de mantenimiento', 'Pendiente', 0, 'Revisar vibración leve; actividad de ejemplo.')`,
  [uuid('ORDEN-MANTENIMIENTO-PENDIENTE'), assetId, dateDaysAhead(2)]);
  await run(`INSERT OR IGNORE INTO mantenimientos (id, galeron_id, fecha, tipo, descripcion, estado)
    VALUES (?, ?, ?, 'Preventivo', 'Lavado y desinfección programada · demo', 'Completado')`,
  [uuid('MANTENIMIENTO-GALERON'), house.id, dateOnlyDaysAgo(12)]);

  // Lote de producto con etiquetas y movimiento de bodega que cuadran en kg.
  const eggLot = 'DEMO-HUEVO-GAL2-2026';
  for (let i = 1; i <= 2; i++) {
    const tagId = uuid(`ETIQUETA-BODEGA-${i}`);
    const tagCode = `DEMO-BOD-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(i).padStart(2, '0')}`;
    await run(`INSERT OR IGNORE INTO etiquetas
      (id, codigo_unico, producto, cantidad, peso_bruto, peso_neto, fecha_produccion, fecha_empaque, fecha_vencimiento, granja_origen, galeron_origen, clasificacion, tara, estado, ubicacion_actual, lote, peso_bodega, fecha_recepcion, unidad, peso_origen, saldo_kg)
      VALUES (?, ?, 'Huevos - Grande', 25, 25.4, 25, ?, ?, ?, 'Concepcion', 'Galerón 2', 'Grande', 0.4, 'EnBodega', 'Bodega Central', ?, 25, ?, 'kg', 25, 25)`,
    [tagId, tagCode, dateOnlyDaysAgo(1), dateOnlyDaysAgo(1), dateDaysAhead(27), eggLot, dateDaysAgo(1)]);
  }
  await run(`INSERT OR IGNORE INTO inventario (id, producto, cantidad, unidad, ubicacion, lote, ultima_actualizacion)
    VALUES (?, 'Huevos - Grande', 50, 'kg', 'Bodega Central', ?, ?)`,
  [uuid('INVENTARIO-BODEGA-KG'), eggLot, new Date().toISOString()]);
  await run(`INSERT OR IGNORE INTO movimientos_inventario (id, producto, cantidad, unidad, tipo, origen, destino, fecha, referencia_id)
    VALUES (?, 'Huevos - Grande', 50, 'kg', 'Entrada Producción', 'Granja', 'Bodega Central', ?, ?)`,
  [uuid('MOVIMIENTO-BODEGA-KG'), dateDaysAgo(1), eggLot]);
  await run(`INSERT OR IGNORE INTO desperdicios
    (id, origen, producto, lote, cantidad, unidad, peso, motivo, responsable, aprobacion, impacto_financiero, fecha, observaciones)
    VALUES (?, 'Granja', 'Huevos - Grande', ?, 2, 'kg', 2, 'Quebrado Granja', 'Encargado de Galerón', 'Registrada', 2400, ?, 'Merma registrada explícitamente · caso demo.')`,
  [uuid('MERMA-GRANJA'), eggLot, dateDaysAgo(1)]);

  // Gastos recientes para que los paneles financieros muestren egresos.
  const expenses = [
    ['Combustible', 42000, 'Combustible de reparto · gasto demo', 'Efectivo', 1],
    ['Alimento', 18500, 'Compra complementaria de alimento · gasto demo', 'Transferencia', 2],
    ['Mantenimiento', 12500, 'Materiales para mantenimiento preventivo · gasto demo', 'Transferencia', 5],
  ];
  for (const [category, amount, description, method, days] of expenses) {
    const key = category.toUpperCase();
    await run(`INSERT OR IGNORE INTO gastos (id, fecha, categoria, monto, descripcion, usuario_id, medio_pago, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuid(`GASTO-${key}`), dateDaysAgo(days), category, amount, description, admin.id, method, uuid(`GASTO-KEY-${key}`)]);
  }

  await run(`INSERT OR IGNORE INTO auditoria
    (id, usuario_id, accion, modulo, referencia_id, valores_antes, valores_despues, motivo, fecha)
    VALUES (?, ?, 'Crear', 'Demo', ?, NULL, ?, 'Carga sintética para demostración; no representa operaciones reales.', ?)`,
  [uuid('AUDITORIA-CARGA'), admin.id, uuid('CARGA-AMPLIADA'), JSON.stringify({ invoices: invoices.length, productionRows: production.length, unit: 'kg' }), new Date().toISOString()]);

  await run('COMMIT');
  const counts = {};
  for (const table of ['facturas', 'detalles_factura', 'pagos', 'lotes_aves', 'produccion_diaria', 'vacunaciones', 'inventario_alimento', 'consumo_alimento', 'ordenes_mantenimiento', 'etiquetas', 'movimientos_inventario', 'desperdicios', 'gastos']) {
    const row = await get(`SELECT COUNT(*) AS total FROM ${table}`);
    counts[table] = row.total;
  }
  console.log(JSON.stringify({ insertedInvoices: invoices.length, counts }, null, 2));
} catch (error) {
  await run('ROLLBACK').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  db.close();
}
