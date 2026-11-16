import { eq, and, gt } from "drizzle-orm";
import * as schema from "./schema.sqlite";
import { CREATE_TABLES } from "./ddl";
import { clasificarDiferencia } from "../lib/opcionesRecepcion";
import { hashPassword } from "../lib/password";
import { fechaVencimientoDe } from "../lib/cobranza";
import { aplicarIndicesDeConsulta } from "./query-indexes";

export async function backfillRecepcionesDesperdicio(db: any) {
  try {
    const conDiferencia = await db.select().from(schema.recepciones).where(gt(schema.recepciones.diferencia, 0));
    if (conDiferencia.length === 0) return;

    let procesadas = 0;
    let reclasificadas = 0;

    // Fase 1 — reclasificar históricos: el backfill anterior registró TODAS las diferencias como
    // desperdicio. Ahora el motivo se clasifica:
    //   - 'alerta' (posible robo): se elimina el desperdicio incorrecto y se marca la recepción.
    //   - 'desperdicio': simplemente se completa la clasificación (el registro ya es correcto).
    for (const r of conDiferencia) {
      if (r.tipoDiferencia) continue;
      const opcion = clasificarDiferencia(r.motivoDiferencia);
      if (!opcion) continue;
      if (opcion.tipo === 'alerta') {
        const despBackfill = await db.select().from(schema.desperdicios).where(and(
          eq(schema.desperdicios.origen, 'Recepción Bodega'),
          eq(schema.desperdicios.observaciones, `Backfill: recepción ${r.id}`)
        )).limit(1);
        if (despBackfill.length > 0) {
          await db.delete(schema.desperdicios).where(eq(schema.desperdicios.id, despBackfill[0].id));
        }
      }
      await db.update(schema.recepciones).set({ tipoDiferencia: opcion.tipo }).where(eq(schema.recepciones.id, r.id));
      reclasificadas++;
    }

    // Fase 2 — backfill de recepciones que aún no tienen su movimiento de pérdida
    for (const r of conDiferencia) {
      const yaRegistrado = await db.select().from(schema.movimientosInventario).where(and(
        eq(schema.movimientosInventario.referencia_id, r.id),
        eq(schema.movimientosInventario.tipo, 'Pérdida en Tránsito')
      )).limit(1);
      if (yaRegistrado.length > 0) continue;

      // Producto de la recepción: de su propio movimiento 'Recepción Bodega', o del 'Traslado'
      let producto: string | null = null;
      const movRecepcion = await db.select().from(schema.movimientosInventario).where(and(
        eq(schema.movimientosInventario.referencia_id, r.id),
        eq(schema.movimientosInventario.tipo, 'Recepción Bodega')
      )).limit(1);
      if (movRecepcion.length > 0) {
        producto = movRecepcion[0].producto;
      } else if (r.trasladoId) {
        const movTraslado = await db.select().from(schema.movimientosInventario).where(and(
          eq(schema.movimientosInventario.referencia_id, r.trasladoId),
          eq(schema.movimientosInventario.tipo, 'Traslado')
        )).limit(1);
        if (movTraslado.length > 0) producto = movTraslado[0].producto;
      }
      if (!producto) continue;

      const opcion = clasificarDiferencia(r.motivoDiferencia);
      const tipo = opcion?.tipo ?? 'desperdicio';

      // Desperdicio SOLO si no es posible robo; el movimiento de pérdida se registra siempre (kárdex)
      if (tipo === 'desperdicio') {
        let impacto = 0;
        try {
          const cat = await db.select().from(schema.productosCatalogo).where(eq(schema.productosCatalogo.nombre, producto)).limit(1);
          if (cat.length > 0 && cat[0].precio_base) {
            impacto = Number((r.diferencia * Number(cat[0].precio_base)).toFixed(2));
          }
        } catch { /* sin precio → 0 */ }
        await db.insert(schema.desperdicios).values({
          id: crypto.randomUUID(),
          origen: 'Recepción Bodega',
          producto,
          lote: null,
          cantidad: r.diferencia,
          motivo: r.motivoDiferencia || 'Diferencia en recepción',
          responsable: r.responsableRecepcion || 'Bodeguero Actual',
          fecha: r.fechaRecepcion,
          impactoFinanciero: impacto,
          observaciones: `Backfill: recepción ${r.id}`
        });
      }

      await db.update(schema.recepciones).set({ tipoDiferencia: tipo }).where(eq(schema.recepciones.id, r.id));
      await db.insert(schema.movimientosInventario).values({
        id: crypto.randomUUID(),
        producto,
        cantidad: r.diferencia,
        tipo: 'Pérdida en Tránsito',
        origen: 'Granja',
        destino: 'Desperdicio',
        fecha: r.fechaRecepcion,
        referencia_id: r.id
      });
      procesadas++;
    }
    if (procesadas > 0) {
      console.log(`[Backfill] ${procesadas} recepción(es) con diferencia → movimiento de pérdida registrado retroactivamente`);
    }
    if (reclasificadas > 0) {
      console.log(`[Backfill] ${reclasificadas} recepción(es) reclasificada(s) como posible robo (se quitó el desperdicio incorrecto)`);
    }
  } catch (e: any) {
    console.error('[Backfill] Error procesando recepciones:', e.message);
  }
}


export async function initializeDatabase(client: any, dbInstance: any) {
  // Ensure all tables exist (DDL canónico compartido con los tests)
  const createTables = CREATE_TABLES;
  
  for (const sql of createTables) {
    await client.execute(sql);
  }

  // Bases demo antiguas pueden tener depositos_caja sin la columna nueva.
  // Los índices de idempotencia se crean después de migrar columnas, no en el
  // DDL inicial, porque CREATE TABLE IF NOT EXISTS no actualiza tablas existentes.
  const depositoCols = (await client.execute("PRAGMA table_info(depositos_caja)")).rows.map((r: any) => String(r.name));
  if (!depositoCols.includes('idempotency_key')) {
    await client.execute("ALTER TABLE depositos_caja ADD COLUMN idempotency_key TEXT");
  }
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_depositos_caja_idempotency_key ON depositos_caja(idempotency_key) WHERE idempotency_key IS NOT NULL");

  // Recepciones y remisiones conservan sus columnas históricas de cartones,
  // pero los movimientos nuevos guardan explícitamente las cantidades kg.
  const migracionesPeso: Record<string, Record<string, string>> = {
    guias_remision: { cantidad_kg_esperada: 'REAL', unidad: "TEXT NOT NULL DEFAULT 'cartones'" },
    recepciones: { cantidad_kg_esperada: 'REAL', cantidad_kg_recibida: 'REAL', diferencia_kg: 'REAL' },
  };
  for (const [tabla, columnas] of Object.entries(migracionesPeso)) {
    const existentes = new Set((await client.execute(`PRAGMA table_info(${tabla})`)).rows.map((r: any) => String(r.name)));
    for (const [columna, tipo] of Object.entries(columnas)) {
      if (!existentes.has(columna)) await client.execute(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`);
    }
  }
  const etiquetaColsKg = new Set((await client.execute('PRAGMA table_info(etiquetas)')).rows.map((r: any) => String(r.name)));
  if (!etiquetaColsKg.has('unidad')) await client.execute("ALTER TABLE etiquetas ADD COLUMN unidad TEXT NOT NULL DEFAULT 'cartones'");

  // Auto-migrate: asociación opcional de gastos a guía y medio de pago, más
  // desglose de efectivo usado por la ruta en los cierres nuevos.
  const gastosCols = (await client.execute("PRAGMA table_info(gastos)")).rows.map((r: any) => String(r.name));
  if (!gastosCols.includes('guia_id')) await client.execute("ALTER TABLE gastos ADD COLUMN guia_id TEXT");
  if (!gastosCols.includes('medio_pago')) await client.execute("ALTER TABLE gastos ADD COLUMN medio_pago TEXT NOT NULL DEFAULT 'Efectivo'");
  const cierresCajaCols = (await client.execute("PRAGMA table_info(cierres_caja_ruta)")).rows.map((r: any) => String(r.name));
  if (!cierresCajaCols.includes('gastos_efectivo')) await client.execute("ALTER TABLE cierres_caja_ruta ADD COLUMN gastos_efectivo REAL NOT NULL DEFAULT 0");

  // Auto-migrate: etiqueta de reemplazo ligada a reempaques en cuarentena.
  const cuarentenaCols = (await client.execute("PRAGMA table_info(inventario_cuarentena)")).rows.map((r: any) => String(r.name));
  if (!cuarentenaCols.includes('etiquetas_reemplazo_json')) {
    await client.execute("ALTER TABLE inventario_cuarentena ADD COLUMN etiquetas_reemplazo_json TEXT");
  }

  // Auto-migrate: users — roles
  const userColNames = (await client.execute("PRAGMA table_info(users)")).rows.map((r: any) => r.name);
  if (!userColNames.includes('roles')) {
    await client.execute("ALTER TABLE users ADD COLUMN roles TEXT DEFAULT ''");
  }
  if (!userColNames.includes('password_hash')) {
    await client.execute("ALTER TABLE users ADD COLUMN password_hash TEXT");
  }
  if (!userColNames.includes('activo')) {
    await client.execute("ALTER TABLE users ADD COLUMN activo INTEGER DEFAULT 1");
  }

  // Seed default admin user if users table is empty
  const demoHash = hashPassword('1234');
  const demoUsers = [
    { id: '1', name: 'Administrador', email: 'admin@granja.com', role: 'Admin', roles: 'Admin' },
    { id: '2', name: 'Comercial Central', email: 'facturacion@granja.com', role: 'Comercial', roles: 'Comercial' },
    { id: '3', name: 'Comercial Ruta 1', email: 'vendedor@granja.com', role: 'Comercial', roles: 'Comercial' },
    { id: '6', name: 'Socio Inversor', email: 'socio@granja.com', role: 'Socio', roles: 'Socio' },
    { id: '7', name: 'Bodeguero Principal', email: 'bodega@granja.com', role: 'Bodeguero', roles: 'Bodeguero' },
    { id: '8', name: 'Encargado de Galerón', email: 'despacho@granja.com', role: 'Despachador', roles: 'Despachador' },
    { id: '9', name: 'Comercial Reparto Demo', email: 'camionero@granja.com', role: 'Comercial', roles: 'Comercial' },
  ];
  for (const u of demoUsers) {
    await client.execute({
      sql: `INSERT INTO users (id, name, email, role, roles, password_hash, activo) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, roles = excluded.roles, password_hash = excluded.password_hash, activo = 1`,
      args: [u.id, u.name, u.email, u.role, u.roles, demoHash]
    });
  }
  // Renombrar rol Despachador → Encargado de Galerón (BD persistente)
  await client.execute({ sql: `UPDATE users SET name = 'Encargado de Galerón' WHERE email = 'despacho@granja.com' AND name = 'Despachador'` });
  // Usuarios preexistentes sin password → demo '1234'
  await client.execute({ sql: `UPDATE users SET password_hash = ? WHERE password_hash IS NULL`, args: [demoHash] });
  // Usuarios preexistentes sin roles → roles = role
  await client.execute({ sql: `UPDATE users SET roles = role WHERE roles IS NULL OR roles = ''` });
  // Migración de perfiles operativos antiguos a Comercial; preserva otros roles.
  const usuariosRoles = await client.execute('SELECT id, role, roles FROM users');
  const aliasesComercial = new Set(['vendedor', 'facturador', 'camionero']);
  for (const row of usuariosRoles.rows as any[]) {
    const roleActual = String(row.role || '').trim();
    const rolesActuales = String(row.roles || roleActual).split(',').map((r: string) => r.trim()).filter(Boolean);
    const rolesNormalizados = Array.from(new Set(rolesActuales.map((r: string) => aliasesComercial.has(r.toLowerCase()) ? 'Comercial' : r)));
    const roleNormalizado = aliasesComercial.has(roleActual.toLowerCase()) ? 'Comercial' : roleActual;
    const rolesCsv = rolesNormalizados.join(',');
    if (roleNormalizado !== roleActual || rolesCsv !== String(row.roles || '')) {
      await client.execute({ sql: 'UPDATE users SET role = ?, roles = ? WHERE id = ?', args: [roleNormalizado, rolesCsv, row.id] });
    }
  }
  console.log('Demo users seeded (password 1234)');

  // Seed default camión for Camionero Demo if camiones table is empty
  const camionCount = await client.execute('SELECT COUNT(*) as count FROM camiones');
  if (camionCount.rows[0].count === 0) {
    await client.execute({
      sql: `INSERT INTO camiones (id, nombre, placa, camionero_id, capacidad_cartones, estado) VALUES (?, ?, ?, ?, 500, 'Activo')`,
      args: [crypto.randomUUID(), 'Camión Jhon', 'ABC-123', '9']
    });
    console.log('Default camión seeded');
  }

  // Auto-migrate: add new columns to galerones if missing
  const galeronCols = await client.execute("PRAGMA table_info(galerones)");
  const galeronColNames = galeronCols.rows.map((r: any) => r.name);
  if (!galeronColNames.includes('aves_en_produccion')) {
    await client.execute("ALTER TABLE galerones ADD COLUMN aves_en_produccion INTEGER DEFAULT 0");
  }
  if (!galeronColNames.includes('tipo_galeron')) {
    await client.execute("ALTER TABLE galerones ADD COLUMN tipo_galeron TEXT DEFAULT 'Productora'");
  }
  if (!galeronColNames.includes('produccion_diaria_esperada')) {
    await client.execute("ALTER TABLE galerones ADD COLUMN produccion_diaria_esperada INTEGER DEFAULT 0");
  }
  if (!galeronColNames.includes('notas')) {
    await client.execute("ALTER TABLE galerones ADD COLUMN notas TEXT");
  }

  // Auto-migrate: camiones — camionero_id
  const camionCols = (await client.execute("PRAGMA table_info(camiones)")).rows.map((r: any) => r.name);
  if (!camionCols.includes('camionero_id')) {
    await client.execute("ALTER TABLE camiones ADD COLUMN camionero_id TEXT");
  }

  // Auto-migrate: traslados — camion_id, creado_por_id, confirmado_por_id, motivo_rechazo
  const trasladoColNames = (await client.execute("PRAGMA table_info(traslados)")).rows.map((r: any) => r.name);
  const trasladoMigraciones: Record<string, string> = {
    carga_id: "ALTER TABLE traslados ADD COLUMN carga_id TEXT",
    vehiculo: "ALTER TABLE traslados ADD COLUMN vehiculo TEXT",
    camion_id: "ALTER TABLE traslados ADD COLUMN camion_id TEXT",
    creado_por_id: "ALTER TABLE traslados ADD COLUMN creado_por_id TEXT",
    confirmado_por_id: "ALTER TABLE traslados ADD COLUMN confirmado_por_id TEXT",
    motivo_rechazo: "ALTER TABLE traslados ADD COLUMN motivo_rechazo TEXT",
  };
  for (const [col, sql] of Object.entries(trasladoMigraciones)) {
    if (!trasladoColNames.includes(col)) {
      await client.execute(sql);
    }
  }

  // Auto-migrate: etiquetas — columnas F1 (guia_remision_id / peso_bodega)
  const etiquetaCols = await client.execute("PRAGMA table_info(etiquetas)");
  const etiquetaColNames = etiquetaCols.rows.map((r: any) => r.name);
  if (!etiquetaColNames.includes('guia_remision_id')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN guia_remision_id TEXT");
  }
  if (!etiquetaColNames.includes('peso_bodega')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN peso_bodega REAL");
  }
  if (!etiquetaColNames.includes('guia_despacho_id')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN guia_despacho_id TEXT");
  }
  if (!etiquetaColNames.includes('fecha_recepcion')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN fecha_recepcion TEXT");
  }
  if (!etiquetaColNames.includes('tipo_carton')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN tipo_carton TEXT");
  }
  if (!etiquetaColNames.includes('peso_origen')) await client.execute("ALTER TABLE etiquetas ADD COLUMN peso_origen TEXT");
  if (!etiquetaColNames.includes('saldo_kg')) await client.execute("ALTER TABLE etiquetas ADD COLUMN saldo_kg REAL");
  if (!etiquetaColNames.includes('peso_registrado_por')) await client.execute("ALTER TABLE etiquetas ADD COLUMN peso_registrado_por TEXT");
  if (!etiquetaColNames.includes('peso_registrado_en')) await client.execute("ALTER TABLE etiquetas ADD COLUMN peso_registrado_en TEXT");

  const guiaKgColNames = (await client.execute("PRAGMA table_info(guias_despacho)")).rows.map((r: any) => r.name);
  if (!guiaKgColNames.includes('total_kg')) await client.execute("ALTER TABLE guias_despacho ADD COLUMN total_kg REAL");
  const guiaDetalleCols = (await client.execute("PRAGMA table_info(guias_despacho_detalle)")).rows.map((r: any) => r.name);
  if (!guiaDetalleCols.includes('cantidad_kg')) await client.execute("ALTER TABLE guias_despacho_detalle ADD COLUMN cantidad_kg REAL");

  // Auto-migrate: productos_catalogo — vida útil (FEFO) y días de aviso
  const productoColNames = (await client.execute("PRAGMA table_info(productos_catalogo)")).rows.map((r: any) => r.name);
  if (!productoColNames.includes('vida_util_dias')) {
    await client.execute("ALTER TABLE productos_catalogo ADD COLUMN vida_util_dias INTEGER DEFAULT 28");
  }
  if (!productoColNames.includes('dias_aviso_vencimiento')) {
    await client.execute("ALTER TABLE productos_catalogo ADD COLUMN dias_aviso_vencimiento INTEGER DEFAULT 7");
  }
  const movimientosCols = (await client.execute('PRAGMA table_info(movimientos_inventario)')).rows.map((r: any) => r.name);
  if (!movimientosCols.includes('unidad')) await client.execute('ALTER TABLE movimientos_inventario ADD COLUMN unidad TEXT');
  // Auto-migrate: desperdicios — vínculos a ruta/guía/camión/vendedor (patrones)
  const desperdicioCols = await client.execute("PRAGMA table_info(desperdicios)");
  const desperdicioColNames = desperdicioCols.rows.map((r: any) => r.name);
  const desperdicioMigraciones: Record<string, string> = {
    ruta_id: "ALTER TABLE desperdicios ADD COLUMN ruta_id TEXT",
    guia_despacho_id: "ALTER TABLE desperdicios ADD COLUMN guia_despacho_id TEXT",
    camion_id: "ALTER TABLE desperdicios ADD COLUMN camion_id TEXT",
    vendedor_id: "ALTER TABLE desperdicios ADD COLUMN vendedor_id TEXT",
  };
  for (const [col, sql] of Object.entries(desperdicioMigraciones)) {
    if (!desperdicioColNames.includes(col)) {
      await client.execute(sql);
    }
  }

  // recepciones — tipo_diferencia (desperdicio | alerta)
  const recepcionCols = await client.execute("PRAGMA table_info(recepciones)");
  const recepcionColNames = recepcionCols.rows.map((r: any) => r.name);
  if (!recepcionColNames.includes("tipo_diferencia")) {
    await client.execute("ALTER TABLE recepciones ADD COLUMN tipo_diferencia TEXT");
  }

  // Auto-migrate: clientes — columnas F2 (prioridad / ventana entrega / frecuencia / demanda)
  const clienteCols = await client.execute("PRAGMA table_info(clientes)");
  const clienteColNames = clienteCols.rows.map((r: any) => r.name);
  const clienteMigraciones: Record<string, string> = {
    prioridad: "ALTER TABLE clientes ADD COLUMN prioridad TEXT DEFAULT 'Normal'",
    ventana_entrega_ini: 'ALTER TABLE clientes ADD COLUMN ventana_entrega_ini TEXT',
    ventana_entrega_fin: 'ALTER TABLE clientes ADD COLUMN ventana_entrega_fin TEXT',
    dias_frecuencia: 'ALTER TABLE clientes ADD COLUMN dias_frecuencia TEXT',
    demanda_promedio_cartones: 'ALTER TABLE clientes ADD COLUMN demanda_promedio_cartones INTEGER DEFAULT 0',
  };
  for (const [col, sql] of Object.entries(clienteMigraciones)) {
    if (!clienteColNames.includes(col)) {
      await client.execute(sql);
    }
  }

  // Auto-migrate: rutas — columnas F2 (capacidad / centroide)
  const rutaCols = await client.execute("PRAGMA table_info(rutas)");
  const rutaColNames = rutaCols.rows.map((r: any) => r.name);
  const rutaMigraciones: Record<string, string> = {
    capacidad_max_cartones: 'ALTER TABLE rutas ADD COLUMN capacidad_max_cartones INTEGER',
    centroide_lat: 'ALTER TABLE rutas ADD COLUMN centroide_lat REAL',
    centroide_lng: 'ALTER TABLE rutas ADD COLUMN centroide_lng REAL',
  };
  for (const [col, sql] of Object.entries(rutaMigraciones)) {
    if (!rutaColNames.includes(col)) {
      await client.execute(sql);
    }
  }

  // Auto-migrate: facturas — columnas F2 (guia_id / camion_id)
  const facturaCols = await client.execute("PRAGMA table_info(facturas)");
  const facturaColNames = facturaCols.rows.map((r: any) => r.name);
  if (!facturaColNames.includes('guia_id')) {
    await client.execute("ALTER TABLE facturas ADD COLUMN guia_id TEXT");
  }
  if (!facturaColNames.includes('camion_id')) {
    await client.execute("ALTER TABLE facturas ADD COLUMN camion_id TEXT");
  }

  // Auto-migrate: cobranza — fecha_vencimiento + tabla pagos.
  // El aging se medía desde `fecha`, así que una factura a 30 días de crédito
  // figuraba vencida desde el día 1. `fecha_vencimiento` se rellena con la
  // fecha + los días que implica su `condicion_pago`.
  if (!facturaColNames.includes('fecha_vencimiento')) {
    await client.execute("ALTER TABLE facturas ADD COLUMN fecha_vencimiento TEXT");
  }
  await client.execute(`CREATE TABLE IF NOT EXISTS pagos (
    id TEXT PRIMARY KEY,
    factura_id TEXT NOT NULL REFERENCES facturas(id),
    fecha TEXT NOT NULL,
    monto REAL NOT NULL,
    metodo TEXT,
    usuario_id TEXT,
    nota TEXT,
    idempotency_key TEXT
  )`);
  const pagoColNames = (await client.execute("PRAGMA table_info(pagos)")).rows.map((r: any) => String(r.name));
  if (!pagoColNames.includes('idempotency_key')) {
    await client.execute("ALTER TABLE pagos ADD COLUMN idempotency_key TEXT");
  }
  await client.execute("CREATE INDEX IF NOT EXISTS idx_pagos_factura ON pagos(factura_id)");
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_idempotency_key ON pagos(idempotency_key) WHERE idempotency_key IS NOT NULL");
  const columnasDocumentoFiscal = (await client.execute("PRAGMA table_info(facturas_electronicas)")).rows.map((r: any) => String(r.name));
  if (columnasDocumentoFiscal.length > 0 && !columnasDocumentoFiscal.includes('idempotency_key')) {
    await client.execute("ALTER TABLE facturas_electronicas ADD COLUMN idempotency_key TEXT");
  }
  if (columnasDocumentoFiscal.length > 0 && !columnasDocumentoFiscal.includes('idempotency_payload')) {
    await client.execute("ALTER TABLE facturas_electronicas ADD COLUMN idempotency_payload TEXT");
  }
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_electronicas_idempotency_key ON facturas_electronicas(idempotency_key) WHERE idempotency_key IS NOT NULL");
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_electronicas_factura_tipo_idem ON facturas_electronicas(factura_id, tipo_documento) WHERE idempotency_key IS NOT NULL");
  const precioDetalleCols = (await client.execute("PRAGMA table_info(precios_detalle)")).rows.map((r: any) => String(r.name));
  if (!precioDetalleCols.includes('precio_minimo')) await client.execute("ALTER TABLE precios_detalle ADD COLUMN precio_minimo REAL");
  if (!precioDetalleCols.includes('precio_maximo')) await client.execute("ALTER TABLE precios_detalle ADD COLUMN precio_maximo REAL");
  const precioExcepcionCols = (await client.execute("PRAGMA table_info(precio_excepciones_cliente)")).rows.map((r: any) => String(r.name));
  if (precioExcepcionCols.length > 0 && !precioExcepcionCols.includes('fecha_inicio')) await client.execute("ALTER TABLE precio_excepciones_cliente ADD COLUMN fecha_inicio TEXT");
  if (precioExcepcionCols.length > 0 && !precioExcepcionCols.includes('fecha_fin')) await client.execute("ALTER TABLE precio_excepciones_cliente ADD COLUMN fecha_fin TEXT");
  // Backfill: solo facturas que aún no tienen vencimiento explícito.
  // El plazo lo decide `diasDeCredito`, no un CASE en SQL: dos copias de la
  // misma regla se apartan (un `LIKE '%8%'` antes que `%15%` le daba 8 días a
  // un "Credito 18").
  const facturasParaVencer = await client.execute(
    `SELECT id, fecha, condicion_pago FROM facturas
     WHERE (fecha_vencimiento IS NULL OR fecha_vencimiento = '') AND fecha IS NOT NULL`
  );
  for (const fila of facturasParaVencer.rows) {
    const f = fila as any;
    const vencimiento = fechaVencimientoDe({
      fecha: String(f.fecha),
      fechaVencimiento: null,
      condicion_pago: f.condicion_pago ?? null,
    });
    if (vencimiento) {
      await client.execute({
        sql: `UPDATE facturas SET fecha_vencimiento = ? WHERE id = ?`,
        args: [vencimiento, f.id],
      });
    }
  }

  // Auto-migrate: gastos con clave de idempotencia para reintentos del formulario.
  const columnasGastos = (await client.execute("PRAGMA table_info(gastos)")).rows.map((r: any) => String(r.name));
  if (columnasGastos.length > 0 && !columnasGastos.includes('idempotency_key')) {
    await client.execute("ALTER TABLE gastos ADD COLUMN idempotency_key TEXT");
  }
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_gastos_idempotency_key ON gastos(idempotency_key) WHERE idempotency_key IS NOT NULL");

  // Auto-migrate: guias_despacho — columna F3 (fin_dia_fecha)
  const guiaCols = await client.execute("PRAGMA table_info(guias_despacho)");
  const guiaColNames = guiaCols.rows.map((r: any) => r.name);
  if (!guiaColNames.includes('fin_dia_fecha')) {
    await client.execute("ALTER TABLE guias_despacho ADD COLUMN fin_dia_fecha TEXT");
  }
  if (!guiaColNames.includes('colchon_extra_json')) {
    await client.execute("ALTER TABLE guias_despacho ADD COLUMN colchon_extra_json TEXT");
  }

  // Auto-migrate: campos para registrar la aceptación física de Bodega.
  // No se cambia el estado de retornos históricos: deben verificarse en UI.
  const retornoCols = (await client.execute("PRAGMA table_info(retornos_camion)")).rows.map((r: any) => r.name);
  const retornoColumnasNuevas: Array<[string, string]> = [
    ['cantidad_aceptada', 'REAL'], ['unidad', "TEXT NOT NULL DEFAULT 'cartones'"], ['aceptado_por', 'TEXT'], ['aceptado_en', 'TEXT'],
    ['condicion', 'TEXT'], ['tipo', "TEXT DEFAULT 'sobrante'"],
  ];
  for (const [nombre, definicion] of retornoColumnasNuevas) {
    if (!retornoCols.includes(nombre)) await client.execute(`ALTER TABLE retornos_camion ADD COLUMN ${nombre} ${definicion}`);
  }

  // Snapshot de unidad/factor para que una edición futura del catálogo no
  // reinterprete la merma que ya fue reportada.
  const columnasExistentesDesperdicio = (await client.execute("PRAGMA table_info(desperdicios)")).rows.map((r: any) => r.name);
  const columnasMerma: Array<[string, string]> = [
    ['unidad', "TEXT NOT NULL DEFAULT 'cartones'"], ['factor_kg_por_carton', 'REAL'], ['cantidad_cartones', 'REAL'],
  ];
  for (const [nombre, definicion] of columnasMerma) {
    if (!columnasExistentesDesperdicio.includes(nombre)) await client.execute(`ALTER TABLE desperdicios ADD COLUMN ${nombre} ${definicion}`);
  }

  // Snapshot de la regla comercial aplicada por línea; mantiene el precio
  // histórico aunque después cambien listas, bandas o excepciones.
  const columnasVentaRuta = (await client.execute('PRAGMA table_info(ventas_ruta)')).rows.map((r: any) => r.name);
  if (!columnasVentaRuta.includes('unidad')) await client.execute("ALTER TABLE ventas_ruta ADD COLUMN unidad TEXT NOT NULL DEFAULT 'kg'");
  if (!columnasVentaRuta.includes('cantidad_inventario')) await client.execute('ALTER TABLE ventas_ruta ADD COLUMN cantidad_inventario REAL');
  for (const tabla of ['detalles_factura', 'ventas_ruta']) {
    const columnas = (await client.execute(`PRAGMA table_info(${tabla})`)).rows.map((r: any) => r.name);
    if (!columnas.includes('resolucion_precio_json')) {
      await client.execute(`ALTER TABLE ${tabla} ADD COLUMN resolucion_precio_json TEXT`);
    }
  }

  // Se usa una tabla nueva para tiquetes de ruta en kg, en vez de reinterpretar
  // ventas históricas que almacenan cartones sin peso por unidad confiable.
  await client.execute(`CREATE TABLE IF NOT EXISTS ventas_ruta_kg (
    id TEXT PRIMARY KEY, tiquete_consecutivo TEXT NOT NULL UNIQUE,
    camion_id TEXT NOT NULL REFERENCES camiones(id), guia_id TEXT NOT NULL REFERENCES guias_despacho(id),
    vendedor_id TEXT NOT NULL REFERENCES users(id), fecha_hora TEXT NOT NULL,
    cliente_id TEXT REFERENCES clientes(id), etiqueta_id TEXT REFERENCES etiquetas(id), producto TEXT NOT NULL, cantidad_kg REAL NOT NULL,
    cantidad_inventario REAL NOT NULL, unidad_inventario TEXT NOT NULL,
    precio_kg REAL NOT NULL, subtotal REAL NOT NULL, descuento REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL, cobro TEXT NOT NULL DEFAULT 'Efectivo', estado TEXT NOT NULL DEFAULT 'Emitida',
    factura_id TEXT, resolucion_precio_json TEXT, etiquetas_asignadas_json TEXT, anulado_en TEXT, anulado_por TEXT
  )`);
  const ventasKgCols = (await client.execute("PRAGMA table_info(ventas_ruta_kg)")).rows.map((r: any) => r.name);
  if (!ventasKgCols.includes('etiqueta_id')) await client.execute('ALTER TABLE ventas_ruta_kg ADD COLUMN etiqueta_id TEXT');
  if (!ventasKgCols.includes('etiquetas_asignadas_json')) await client.execute('ALTER TABLE ventas_ruta_kg ADD COLUMN etiquetas_asignadas_json TEXT');

  // Seed default product catalog if empty
  const existingProducts = await client.execute('SELECT COUNT(*) as count FROM productos_catalogo');
  if (existingProducts.rows[0].count === 0) {
    const now = new Date().toISOString();
    const defaultProducts = [
      { id: crypto.randomUUID(), nombre: 'Huevos Extra Grandes', descripcion: 'Huevos de tamaño extra grande (≥70g)', unidad: 'cartones', precio_base: 18500, categoria: 'Huevos', estado: 'Activo', fecha_creacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Grandes', descripcion: 'Huevos de tamaño grande (60-69g)', unidad: 'cartones', precio_base: 16000, categoria: 'Huevos', estado: 'Activo', fecha_creacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Medianos', descripcion: 'Huevos de tamaño mediano (50-59g)', unidad: 'cartones', precio_base: 13500, categoria: 'Huevos', estado: 'Activo', fecha_creacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Pequeños', descripcion: 'Huevos de tamaño pequeño (<50g)', unidad: 'cartones', precio_base: 11000, categoria: 'Huevos', estado: 'Activo', fecha_creacion: now },
      { id: crypto.randomUUID(), nombre: 'Gallinaza', descripcion: 'Excremento de gallina procesado, fertilizante', unidad: 'sacos', precio_base: 3500, categoria: 'Subproductos', estado: 'Activo', fecha_creacion: now },
    ];
    for (const p of defaultProducts) {
      await client.execute({ sql: 'INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [p.id, p.nombre, p.descripcion, p.unidad, p.precio_base, p.categoria, p.estado, p.fecha_creacion] });
    }
    console.log('Default product catalog seeded');
  }

  // Seed default carton types if empty
  const existingTiposCarton = await client.execute('SELECT COUNT(*) as count FROM tipos_carton');
  if (existingTiposCarton.rows[0].count === 0) {
    const now = new Date().toISOString();
    const defaultTipos = [
      { nombre: 'Cartón de 30 huevos', unidades: 30 },
      { nombre: 'Cartón de 12 huevos', unidades: 12 },
      { nombre: 'Cartón de 6 huevos', unidades: 6 },
    ];
    for (const t of defaultTipos) {
      await client.execute({ sql: 'INSERT INTO tipos_carton (id, nombre, unidades, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?)', args: [crypto.randomUUID(), t.nombre, t.unidades, 'Activo', now] });
    }
    console.log('Default carton types seeded');
  }

  // Backfill idempotente: desperdicio retroactivo para recepciones previas al fix
  await backfillRecepcionesDesperdicio(dbInstance);

  // Se crean al final para que las migraciones de columnas legacy ya hayan corrido.
  await aplicarIndicesDeConsulta(client);

}
