import { eq, sql } from 'drizzle-orm';
import * as schema from './schema';
import { hashPassword } from '../lib/password';

/** Seeds the fresh demo database after Drizzle has applied the schema. */
export async function initializeNeonDatabase(db: any) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS proformas (id TEXT PRIMARY KEY, consecutivo TEXT NOT NULL UNIQUE, fecha TEXT NOT NULL, vence_en TEXT, cliente_id TEXT REFERENCES clientes(id), vendedor_id TEXT NOT NULL REFERENCES users(id), guia_id TEXT, detalles_json TEXT NOT NULL, subtotal DOUBLE PRECISION NOT NULL, descuento DOUBLE PRECISION NOT NULL DEFAULT 0, total DOUBLE PRECISION NOT NULL, notas TEXT, estado TEXT NOT NULL DEFAULT 'Vigente', factura_id TEXT)`);
  await db.execute(sql`ALTER TABLE proformas ADD COLUMN IF NOT EXISTS guia_id TEXT`);
  const now = new Date().toISOString();
  await db.execute(sql`CREATE TABLE IF NOT EXISTS inventario_insumos (id TEXT PRIMARY KEY, producto TEXT NOT NULL, categoria TEXT NOT NULL, cantidad_recibida DOUBLE PRECISION NOT NULL, cantidad_actual DOUBLE PRECISION NOT NULL, unidad TEXT NOT NULL, ubicacion TEXT NOT NULL, lote TEXT, proveedor TEXT, gasto_id TEXT, monto_compra DOUBLE PRECISION, producto_huevo TEXT, kg_por_unidad DOUBLE PRECISION, creado_por TEXT NOT NULL, creado_en TEXT NOT NULL)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS movimientos_insumos (id TEXT PRIMARY KEY, insumo_id TEXT NOT NULL, tipo TEXT NOT NULL, cantidad DOUBLE PRECISION NOT NULL, unidad TEXT NOT NULL, referencia_id TEXT, kg_huevo DOUBLE PRECISION, registrado_por TEXT NOT NULL, fecha TEXT NOT NULL, observacion TEXT)`);
  await db.execute(sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS actividad_economica TEXT`);
  for (const [column, type] of Object.entries({ referencia_documento_origen: 'TEXT', fecha_documento_origen: 'TEXT', monto_documento_origen: 'DOUBLE PRECISION', moneda_documento_origen: 'TEXT' })) await db.execute(sql.raw(`ALTER TABLE inventario_alimento ADD COLUMN IF NOT EXISTS ${column} ${type}`));
  await db.execute(sql`ALTER TABLE consumo_alimento ADD COLUMN IF NOT EXISTS tipo_movimiento TEXT NOT NULL DEFAULT 'Consumo'`);
  await db.execute(sql`ALTER TABLE produccion_diaria ADD COLUMN IF NOT EXISTS registrado_por TEXT`);
  await db.execute(sql`ALTER TABLE produccion_diaria ADD COLUMN IF NOT EXISTS responsable TEXT`);
  await db.execute(sql`ALTER TABLE desperdicios ADD COLUMN IF NOT EXISTS registrado_por TEXT`);
  await db.execute(sql`ALTER TABLE retornos_camion ADD COLUMN IF NOT EXISTS registrado_por TEXT`);
  await db.execute(sql`ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS registrado_por TEXT`);
  await db.execute(sql`ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS lote TEXT`);

  // Foundation tables for the general ledger. Automatic posting remains off
  // until the customer accountant approves the account mapping and policies.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS cuentas_contables (id TEXT PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, tipo TEXT NOT NULL, naturaleza TEXT NOT NULL, cuenta_padre_id TEXT, permite_movimiento BOOLEAN NOT NULL DEFAULT TRUE, estado TEXT NOT NULL DEFAULT 'Activa', revision_estado TEXT NOT NULL DEFAULT 'Pendiente CPA', revision_vigencia TEXT, revision_revisor_nombre TEXT, revision_revisor_credencial TEXT, revision_evidencia TEXT, revision_actualizado_en TEXT, revision_actualizado_por TEXT, es_efectivo_equivalente BOOLEAN NOT NULL DEFAULT FALSE, clasificacion_flujo TEXT, creado_en TEXT NOT NULL)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS cuentas_contables_historial (id TEXT PRIMARY KEY, cuenta_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, cambiado_por TEXT, cambiado_en TEXT NOT NULL)`);
  await db.execute(sql`ALTER TABLE facturas_electronicas ADD COLUMN IF NOT EXISTS datos_fiscal_snapshot TEXT`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS configuracion_fiscal_emisor (id TEXT PRIMARY KEY, razon_social TEXT NOT NULL DEFAULT '', identificacion_tipo TEXT NOT NULL DEFAULT '', identificacion TEXT NOT NULL DEFAULT '', actividad_economica TEXT NOT NULL DEFAULT '', nombre_comercial TEXT, correo TEXT, telefono TEXT, provincia TEXT, canton TEXT, distrito TEXT, barrio TEXT, otras_senas TEXT, moneda_presentacion TEXT NOT NULL DEFAULT 'CRC', estado_revision TEXT NOT NULL DEFAULT 'Pendiente', referencia_evidencia TEXT, revisor_nombre TEXT, revisor_credencial TEXT, actualizado_por TEXT, actualizado_en TEXT)`);
  for (const [column, type] of Object.entries({ revision_estado: "TEXT NOT NULL DEFAULT 'Pendiente CPA'", revision_vigencia: 'TEXT', revision_revisor_nombre: 'TEXT', revision_revisor_credencial: 'TEXT', revision_evidencia: 'TEXT', revision_actualizado_en: 'TEXT', revision_actualizado_por: 'TEXT' })) await db.execute(sql.raw(`ALTER TABLE cuentas_contables ADD COLUMN IF NOT EXISTS ${column} ${type}`));
  await db.execute(sql`ALTER TABLE cuentas_contables ADD COLUMN IF NOT EXISTS es_efectivo_equivalente BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE cuentas_contables ADD COLUMN IF NOT EXISTS clasificacion_flujo TEXT`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS periodos_contables (id TEXT PRIMARY KEY, fecha_inicio TEXT NOT NULL, fecha_fin TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'Abierto', creado_por TEXT NOT NULL, creado_en TEXT NOT NULL, cerrado_por TEXT, cerrado_en TEXT)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS secuencias_contables (id TEXT PRIMARY KEY, ultimo INTEGER NOT NULL DEFAULT 0)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS asientos_contables (id TEXT PRIMARY KEY, consecutivo INTEGER NOT NULL UNIQUE, fecha TEXT NOT NULL, periodo_id TEXT NOT NULL REFERENCES periodos_contables(id), descripcion TEXT NOT NULL, referencia_tipo TEXT, referencia_id TEXT, estado TEXT NOT NULL DEFAULT 'Borrador', creado_por TEXT NOT NULL, creado_en TEXT NOT NULL, contabilizado_por TEXT, contabilizado_en TEXT, reversa_de_id TEXT, idempotency_key TEXT, idempotency_payload TEXT)`);
  await db.execute(sql`INSERT INTO secuencias_contables (id, ultimo) VALUES ('asiento', 0) ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`UPDATE secuencias_contables SET ultimo = GREATEST(ultimo, (SELECT COALESCE(MAX(consecutivo), 0) FROM asientos_contables)) WHERE id = 'asiento'`);
  await db.execute(sql`ALTER TABLE asientos_contables ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  await db.execute(sql`ALTER TABLE asientos_contables ADD COLUMN IF NOT EXISTS idempotency_payload TEXT`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_asientos_contables_idempotency_key ON asientos_contables(idempotency_key) WHERE idempotency_key IS NOT NULL`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_asientos_contables_reversa ON asientos_contables(reversa_de_id) WHERE reversa_de_id IS NOT NULL`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS lineas_asiento_contable (id TEXT PRIMARY KEY, asiento_id TEXT NOT NULL REFERENCES asientos_contables(id), cuenta_id TEXT NOT NULL REFERENCES cuentas_contables(id), descripcion TEXT NOT NULL DEFAULT '', debito DOUBLE PRECISION NOT NULL DEFAULT 0, credito DOUBLE PRECISION NOT NULL DEFAULT 0, tercero_id TEXT, granja_id TEXT, galeron_id TEXT, lote_id TEXT, producto_id TEXT, ruta_id TEXT, vendedor_id TEXT)`);
  for (const column of ['granja_id', 'galeron_id', 'lote_id', 'producto_id', 'ruta_id', 'vendedor_id']) await db.execute(sql.raw(`ALTER TABLE lineas_asiento_contable ADD COLUMN IF NOT EXISTS ${column} TEXT`));
  await db.execute(sql`CREATE TABLE IF NOT EXISTS politicas_contables (id TEXT PRIMARY KEY, clave TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, norma_referencia TEXT NOT NULL, pregunta TEXT NOT NULL, criterio TEXT, justificacion TEXT, estado TEXT NOT NULL DEFAULT 'Pendiente', fecha_vigencia TEXT, revisor_nombre TEXT, revisor_credencial TEXT, evidencia_aprobacion TEXT, actualizado_por TEXT, actualizado_en TEXT)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS politicas_contables_historial (id TEXT PRIMARY KEY, clave TEXT NOT NULL, estado TEXT NOT NULL, snapshot_json TEXT NOT NULL, cambiado_por TEXT, cambiado_en TEXT NOT NULL)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS notas_estados_financieros (id TEXT PRIMARY KEY, periodo_desde TEXT NOT NULL, periodo_hasta TEXT NOT NULL, clave TEXT NOT NULL, reemplaza_nota_id TEXT, titulo TEXT NOT NULL, contenido TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'Borrador', version INTEGER NOT NULL DEFAULT 1, evidencia_referencia TEXT, revisor_nombre TEXT, revisor_credencial TEXT, creado_por TEXT NOT NULL, creado_en TEXT NOT NULL, actualizado_por TEXT NOT NULL, actualizado_en TEXT NOT NULL)`);
  await db.execute(sql`ALTER TABLE notas_estados_financieros ADD COLUMN IF NOT EXISTS reemplaza_nota_id TEXT`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_notas_estados_reemplaza_unico ON notas_estados_financieros(reemplaza_nota_id) WHERE reemplaza_nota_id IS NOT NULL`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS mapeos_cuentas_contables (id TEXT PRIMARY KEY, clave TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, cuenta_debito_id TEXT, cuenta_credito_id TEXT, dimensiones_json TEXT NOT NULL DEFAULT '[]', tratamiento_fiscal TEXT, estado TEXT NOT NULL DEFAULT 'Pendiente', no_aplica_justificacion TEXT, fecha_vigencia TEXT, revisor_nombre TEXT, revisor_credencial TEXT, evidencia_aprobacion TEXT, actualizado_por TEXT, actualizado_en TEXT)`);
  for (const [column, type] of Object.entries({ cabys_codigo: 'TEXT', cabys_descripcion: 'TEXT', tratamiento_fiscal: 'TEXT', tarifa_impuesto: 'DOUBLE PRECISION', exoneracion_referencia: 'TEXT', fiscal_vigente_desde: 'TEXT', fiscal_vigente_hasta: 'TEXT', fiscal_estado: "TEXT NOT NULL DEFAULT 'Pendiente'", fiscal_aprobacion_referencia: 'TEXT', fiscal_revisor_nombre: 'TEXT', fiscal_revisor_credencial: 'TEXT', fiscal_aprobado_en: 'TEXT' })) await db.execute(sql.raw(`ALTER TABLE productos_catalogo ADD COLUMN IF NOT EXISTS ${column} ${type}`));

  // Keep the per-ticket FEFO allocation for transparent returns and traceability.
  await db.execute(sql`ALTER TABLE ventas_ruta_kg ADD COLUMN IF NOT EXISTS etiquetas_asignadas_json TEXT`);

  {
    // The login screen's demo shortcuts always use 1234. Reset only these
    // explicitly seeded demo identities on initialization so persisted Neon
    // rows cannot keep an outdated hash after a deployment.
    const passwordHash = hashPassword('1234');
    const demoUsers = [
      { id: '1', name: 'Administrador', email: 'admin@granja.com', role: 'Admin', roles: 'Admin' },
      { id: '2', name: 'Comercial Central', email: 'facturacion@granja.com', role: 'Comercial', roles: 'Comercial' },
      { id: '3', name: 'Comercial Ruta 1', email: 'vendedor@granja.com', role: 'Comercial', roles: 'Comercial' },
      { id: '6', name: 'Socio Inversor', email: 'socio@granja.com', role: 'Socio', roles: 'Socio' },
      { id: '7', name: 'Bodeguero Principal', email: 'bodega@granja.com', role: 'Bodeguero', roles: 'Bodeguero' },
      { id: '8', name: 'Encargado de Galerón', email: 'despacho@granja.com', role: 'Despachador', roles: 'Despachador' },
      { id: '9', name: 'Comercial Reparto Demo', email: 'camionero@granja.com', role: 'Comercial', roles: 'Comercial' },
    ];

    for (const user of demoUsers) {
      await db.insert(schema.users).values({
        ...user,
        password_hash: passwordHash,
        activo: true,
      }).onConflictDoNothing();
      await db.update(schema.users).set({
        name: user.name,
        role: user.role,
        roles: user.roles,
        password_hash: passwordHash,
        activo: true,
      }).where(eq(schema.users.email, user.email));
    }
  }

  const products = await db.select({ id: schema.productosCatalogo.id }).from(schema.productosCatalogo).limit(1);
  if (!products.length) {
    await db.insert(schema.productosCatalogo).values([
      { id: crypto.randomUUID(), nombre: 'Huevos Extra Grandes', descripcion: 'Huevos de tamaño extra grande (≥70g)', unidad: 'kg', precioBase: 18500, categoria: 'Huevos', estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Grandes', descripcion: 'Huevos de tamaño grande (60-69g)', unidad: 'kg', precioBase: 16000, categoria: 'Huevos', estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Medianos', descripcion: 'Huevos de tamaño mediano (50-59g)', unidad: 'kg', precioBase: 13500, categoria: 'Huevos', estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Pequeños', descripcion: 'Huevos de tamaño pequeño (<50g)', unidad: 'kg', precioBase: 11000, categoria: 'Huevos', estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Gallinaza', descripcion: 'Excremento de gallina procesado, fertilizante', unidad: 'sacos', precioBase: 3500, categoria: 'Subproductos', estado: 'Activo', fechaCreacion: now },
    ]).onConflictDoNothing();
  }

  const cartonTypes = await db.select({ id: schema.tiposCarton.id }).from(schema.tiposCarton).limit(1);
  if (!cartonTypes.length) {
    await db.insert(schema.tiposCarton).values([
      { id: crypto.randomUUID(), nombre: 'Cartón de 30 huevos', unidades: 30, estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Cartón de 12 huevos', unidades: 12, estado: 'Activo', fechaCreacion: now },
      { id: crypto.randomUUID(), nombre: 'Cartón de 6 huevos', unidades: 6, estado: 'Activo', fechaCreacion: now },
    ]).onConflictDoNothing();
  }

  // Small, clearly synthetic operating dataset so the hosted demo opens with
  // useful screens. Never copy the local SQLite database into the demo.
  await db.insert(schema.clientes).values([
      { id: 'DEMO-CLI-001', nombre: 'Mini Súper La Esquina', tipo_documento: 'Juridica', documento_id: '3-101-900001', telefono: '8888-0101', email: 'esquina@example.test', direccion: 'Centro de Naranjo', provincia: 'Alajuela', canton: 'Naranjo', ruta: 'Ruta Occidente', condicion_pago: 'Contado', limite_credito: 0, saldo_pendiente: 0, estado: 'Activo', fecha_creacion: now },
      { id: 'DEMO-CLI-002', nombre: 'Abastecedor El Molino', tipo_documento: 'Juridica', documento_id: '3-101-900002', telefono: '8888-0102', email: 'molino@example.test', direccion: 'San Ramón', provincia: 'Alajuela', canton: 'San Ramón', ruta: 'Ruta Occidente', condicion_pago: 'Crédito', limite_credito: 250000, saldo_pendiente: 78000, estado: 'Activo', fecha_creacion: now },
      { id: 'DEMO-CLI-003', nombre: 'Soda La Granja', tipo_documento: 'Fisica', documento_id: '1-1111-0003', telefono: '8888-0103', direccion: 'Palmares', provincia: 'Alajuela', canton: 'Palmares', ruta: 'Ruta Palmares', condicion_pago: 'Contado', limite_credito: 0, saldo_pendiente: 0, estado: 'Activo', fecha_creacion: now },
      { id: 'DEMO-CLI-004', nombre: 'Pulpería San Miguel', tipo_documento: 'Fisica', documento_id: '1-1111-0004', telefono: '8888-0104', direccion: 'San Carlos', provincia: 'Alajuela', canton: 'San Carlos', ruta: 'Ruta Norte', condicion_pago: 'Crédito', limite_credito: 180000, saldo_pendiente: 42000, estado: 'Activo', fecha_creacion: now },
      { id: 'DEMO-CLI-005', nombre: 'Restaurante Buen Día', tipo_documento: 'Juridica', documento_id: '3-101-900005', telefono: '8888-0105', direccion: 'Grecia', provincia: 'Alajuela', canton: 'Grecia', ruta: 'Ruta Occidente', condicion_pago: 'Contado', limite_credito: 0, saldo_pendiente: 0, estado: 'Activo', fecha_creacion: now },
  ]).onConflictDoNothing();

  const hasDemoFarm = await db.select({ id: schema.granjas.id }).from(schema.granjas).where(eq(schema.granjas.id, 'DEMO-FARM-001')).limit(1);
  if (!hasDemoFarm.length) {
    await db.insert(schema.granjas).values({ id: 'DEMO-FARM-001', nombre: 'Granja Demostración Occidente', ubicacion: 'Naranjo, Alajuela', tipo_produccion: 'Ponedoras', encargadoId: '8', estado: 'Activo' }).onConflictDoNothing();
    await db.insert(schema.galerones).values({ id: 'DEMO-GAL-001', granjaId: 'DEMO-FARM-001', nombre: 'Galerón Las Lomas', capacidad_maxima: 9000, aves_en_produccion: 7500, tipo_galeron: 'Productora', produccion_diaria_esperada: 6500, estado: 'Activo' }).onConflictDoNothing();
    await db.insert(schema.lotes_aves).values({ id: 'DEMO-BIRDLOT-001', galeronId: 'DEMO-GAL-001', fecha_ingreso: '2025-08-01', cantidad_inicial: 7500, linea_genetica: 'Hy-Line Brown (demo)', estado: 'Activo' }).onConflictDoNothing();
  }

  const hasDemoStock = await db.select({ id: schema.inventario.id }).from(schema.inventario).where(eq(schema.inventario.id, 'DEMO-STOCK-001')).limit(1);
  if (!hasDemoStock.length) {
    await db.insert(schema.inventario).values([
      { id: 'DEMO-STOCK-001', producto: 'Huevos Grandes', cantidad: 224, unidad: 'kg', ubicacion: 'Bodega Central', lote: 'DEMO-GRANDE-20261116', fecha_caducidad: '2026-12-14', ultima_actualizacion: now },
      { id: 'DEMO-STOCK-002', producto: 'Huevos Medianos', cantidad: 86.5, unidad: 'kg', ubicacion: 'Bodega Central', lote: 'DEMO-MEDIANO-20261115', fecha_caducidad: '2026-12-13', ultima_actualizacion: now },
      { id: 'DEMO-STOCK-003', producto: 'Huevos Extra Grandes', cantidad: 52, unidad: 'kg', ubicacion: 'Bodega Central', lote: 'DEMO-EXTRA-20261115', fecha_caducidad: '2026-12-13', ultima_actualizacion: now },
    ]).onConflictDoNothing();
  }

  await db.insert(schema.camiones).values([
    { id: 'DEMO-TRUCK-001', nombre: 'Camión Ruta Occidente', placa: 'DEMO-001', camioneroId: '3', ruta_defecto: 'Ruta Occidente', capacidad_cartones: 350, estado: 'Activo' },
    { id: 'DEMO-TRUCK-002', nombre: 'Camión Ruta Norte', placa: 'DEMO-002', camioneroId: '9', ruta_defecto: 'Ruta Norte', capacidad_cartones: 300, estado: 'Activo' },
    { id: 'DEMO-TRUCK-003', nombre: 'Camión Ruta Palmares', placa: 'DEMO-003', camioneroId: '9', ruta_defecto: 'Ruta Palmares', capacidad_cartones: 200, estado: 'Activo' },
  ]).onConflictDoNothing();
  await db.insert(schema.rutas).values([
    { id: 'DEMO-ROUTE-001', nombre: 'Ruta Occidente', vendedor_asignado: '3', camion_id: 'DEMO-TRUCK-001', cliente_ids: 'DEMO-CLI-001,DEMO-CLI-002,DEMO-CLI-005', dias_frecuencia: 'Lunes,Miércoles,Viernes', kilometraje_aprox: 68, estado: 'Activa', capacidad_max_cartones: 350 },
    { id: 'DEMO-ROUTE-002', nombre: 'Ruta Norte', vendedor_asignado: '9', camion_id: 'DEMO-TRUCK-002', cliente_ids: 'DEMO-CLI-004', dias_frecuencia: 'Martes,Jueves', kilometraje_aprox: 92, estado: 'Activa', capacidad_max_cartones: 300 },
    { id: 'DEMO-ROUTE-003', nombre: 'Ruta Palmares', vendedor_asignado: '9', camion_id: 'DEMO-TRUCK-003', cliente_ids: 'DEMO-CLI-003', dias_frecuencia: 'Lunes a Sábado', kilometraje_aprox: 34, estado: 'Activa', capacidad_max_cartones: 200 },
  ]).onConflictDoNothing();

  // Asegura que las asignaciones demo sigan siendo coherentes aunque la ruta ya
  // existiera antes de este seed: el acceso de vendedor se filtra por camionero.
  await db.update(schema.camiones).set({ camioneroId: '3', ruta_defecto: 'Ruta Occidente' }).where(eq(schema.camiones.id, 'DEMO-TRUCK-001'));
  await db.update(schema.camiones).set({ camioneroId: '9', ruta_defecto: 'Ruta Norte' }).where(eq(schema.camiones.id, 'DEMO-TRUCK-002'));
  await db.update(schema.camiones).set({ camioneroId: '9', ruta_defecto: 'Ruta Palmares' }).where(eq(schema.camiones.id, 'DEMO-TRUCK-003'));
  await db.update(schema.rutas).set({ vendedor_asignado: '3', camion_id: 'DEMO-TRUCK-001', cliente_ids: 'DEMO-CLI-001,DEMO-CLI-002,DEMO-CLI-005' }).where(eq(schema.rutas.id, 'DEMO-ROUTE-001'));
  await db.update(schema.rutas).set({ vendedor_asignado: '9', camion_id: 'DEMO-TRUCK-002', cliente_ids: 'DEMO-CLI-004' }).where(eq(schema.rutas.id, 'DEMO-ROUTE-002'));
  await db.update(schema.rutas).set({ vendedor_asignado: '9', camion_id: 'DEMO-TRUCK-003', cliente_ids: 'DEMO-CLI-003' }).where(eq(schema.rutas.id, 'DEMO-ROUTE-003'));

  // Precios autorizados para que el vendedor pueda completar una venta demo.
  await db.insert(schema.listas_precios).values({
    id: 'DEMO-PRICE-ROUTE-OCCIDENTE', nombre: 'Demo · Ruta Occidente por kilo', tipo: 'Ruta',
    rutaAsociada: 'Ruta Occidente', estado: 'Activa', fechaInicio: now.slice(0, 10), aprobadoPor: '1',
  }).onConflictDoNothing();
  await db.insert(schema.listas_precios).values({
    id: 'DEMO-PRICE-ROUTE-PALMARES', nombre: 'Demo · Ruta Palmares por kilo', tipo: 'Ruta',
    rutaAsociada: 'Ruta Palmares', estado: 'Activa', fechaInicio: now.slice(0, 10), aprobadoPor: '1',
  }).onConflictDoNothing();
  const preciosRutaDemo = [
    ['DEMO-PRICE-ROUTE-OCCIDENTE', 'Huevos Grandes', 1200, 1100, 1350],
    ['DEMO-PRICE-ROUTE-OCCIDENTE', 'Huevos Medianos', 1050, 980, 1180],
    ['DEMO-PRICE-ROUTE-PALMARES', 'Huevos Grandes', 1200, 1100, 1350],
    ['DEMO-PRICE-ROUTE-PALMARES', 'Huevos Medianos', 1050, 980, 1180],
  ] as const;
  for (const [listaId, producto, precioUnitario, precioMinimo, precioMaximo] of preciosRutaDemo) {
    await db.insert(schema.precios_detalle).values({
      id: `${listaId}-${producto.replace(/[^A-Za-z0-9]+/g, '-')}`, listaId, producto,
      precioUnitario, precioMinimo, precioMaximo, descuentoMaximo: 0, unidad: 'kg',
    }).onConflictDoNothing();
  }

  // Dos guías dejan lista la interacción del Comercial: una carga por iniciar
  // y una ruta ya iniciada. Se crean una sola vez para no reponer stock vendido.
  const guiasDemoVendedor = [
    {
      id: 'DEMO-GUIA-VENDEDOR-OCCIDENTE', consecutivo: 'GD-DEMO-OCCIDENTE-001', camionId: 'DEMO-TRUCK-001', rutaId: 'DEMO-ROUTE-001',
      vendedorId: '3', responsableTransporte: 'Comercial Ruta 1', estado: 'Cargada', clientes: ['DEMO-CLI-001', 'DEMO-CLI-002', 'DEMO-CLI-005'],
      cargas: [
        { etiquetaId: 'DEMO-ETQ-RUTA-OCC-GRANDE-01', codigo: 'DEMO-RUTA-OCC-GRANDE-01', producto: 'Huevos Grandes', kg: 20, lote: 'DEMO-OCC-GRANDE-20261116', caduca: '2026-12-14' },
        { etiquetaId: 'DEMO-ETQ-RUTA-OCC-MEDIANO-01', codigo: 'DEMO-RUTA-OCC-MEDIANO-01', producto: 'Huevos Medianos', kg: 12, lote: 'DEMO-OCC-MEDIANO-20261116', caduca: '2026-12-13' },
      ],
    },
    {
      id: 'DEMO-GUIA-VENDEDOR-PALMARES', consecutivo: 'GD-DEMO-PALMARES-001', camionId: 'DEMO-TRUCK-003', rutaId: 'DEMO-ROUTE-003',
      vendedorId: '9', responsableTransporte: 'Comercial Reparto Demo', estado: 'EnRuta', clientes: ['DEMO-CLI-003'],
      cargas: [
        { etiquetaId: 'DEMO-ETQ-RUTA-PAL-GRANDE-01', codigo: 'DEMO-RUTA-PAL-GRANDE-01', producto: 'Huevos Grandes', kg: 8, lote: 'DEMO-PAL-GRANDE-20261116', caduca: '2026-12-14' },
        { etiquetaId: 'DEMO-ETQ-RUTA-PAL-MEDIANO-01', codigo: 'DEMO-RUTA-PAL-MEDIANO-01', producto: 'Huevos Medianos', kg: 8, lote: 'DEMO-PAL-MEDIANO-20261116', caduca: '2026-12-13' },
      ],
    },
  ];
  const clientesDemo = await db.query.clientes.findMany();
  for (const guiaDemo of guiasDemoVendedor) {
    await db.transaction(async (tx: any) => {
      const ahora = new Date().toISOString();
      const truck = await tx.query.camiones.findFirst({ where: eq(schema.camiones.id, guiaDemo.camionId) });
      const creada = await tx.insert(schema.guias_despacho).values({
        id: guiaDemo.id, consecutivo: guiaDemo.consecutivo, camionId: guiaDemo.camionId, rutaId: guiaDemo.rutaId,
        fecha: ahora, horaCarga: ahora.slice(11, 19), responsableCarga: 'Bodeguero demo',
        responsableTransporte: guiaDemo.responsableTransporte, vendedorId: guiaDemo.vendedorId,
        clientesIds: JSON.stringify(guiaDemo.clientes), totalCartones: guiaDemo.cargas.reduce((s, c) => s + c.kg, 0),
        totalKg: guiaDemo.cargas.reduce((s, c) => s + c.kg, 0), pesoSalida: guiaDemo.cargas.reduce((s, c) => s + c.kg, 0),
        estado: guiaDemo.estado, recibidoEn: guiaDemo.estado === 'EnRuta' ? ahora : null,
        rutaOrdenJson: JSON.stringify(guiaDemo.clientes.map((clienteId, index) => ({
          clienteId,
          orden: index + 1,
          nombre: clientesDemo.find((cliente: any) => cliente.id === clienteId)?.nombre || clienteId,
        }))),
      }).onConflictDoNothing().returning({ id: schema.guias_despacho.id });
      if (!creada.length) return;
      if (!truck) throw new Error(`No existe el camión demo ${guiaDemo.camionId}`);

      for (const [indice, carga] of guiaDemo.cargas.entries()) {
        const stockBodegaId = carga.producto === 'Huevos Grandes' ? 'DEMO-STOCK-001' : 'DEMO-STOCK-002';
        const saldoBodega = await tx.query.inventario.findFirst({ where: eq(schema.inventario.id, stockBodegaId) });
        if (!saldoBodega || Number(saldoBodega.cantidad) < carga.kg) throw new Error(`Stock demo insuficiente de ${carga.producto} para ${guiaDemo.consecutivo}`);
        await tx.update(schema.inventario).set({ cantidad: Number(saldoBodega.cantidad) - carga.kg, ultima_actualizacion: ahora }).where(eq(schema.inventario.id, saldoBodega.id));

        const etiqueta = {
          id: carga.etiquetaId, codigoUnico: carga.codigo, producto: carga.producto, cantidad: carga.kg, unidad: 'kg',
          pesoBruto: carga.kg + 0.4, pesoNeto: carga.kg, saldoKg: carga.kg, pesoOrigen: 'Manual',
          pesoRegistradoPor: '7', pesoRegistradoEn: ahora, fechaProduccion: now.slice(0, 10), fechaEmpaque: now.slice(0, 10),
          fechaVencimiento: carga.caduca, granjaOrigen: 'Granja Demostración Occidente', galeronOrigen: 'Galerón Las Lomas',
          clasificacion: carga.producto.includes('Medianos') ? 'Mediano' : 'Grande', tara: 0.4,
          estado: 'Cargada', ubicacionActual: truck.nombre, lote: carga.lote, pesoBodega: carga.kg,
          guiaDespachoId: guiaDemo.id, fechaRecepcion: ahora,
        };
        await tx.insert(schema.etiquetas).values(etiqueta).onConflictDoNothing();
        await tx.insert(schema.guias_despacho_detalle).values({
          id: `${guiaDemo.id}-DET-${String(indice + 1).padStart(2, '0')}`, guiaId: guiaDemo.id,
          etiquetaId: carga.etiquetaId, producto: carga.producto, cartones: carga.kg, cantidadKg: carga.kg,
          pesoAnden: carga.kg + 0.4, estadoSalida: 'checked',
        }).onConflictDoNothing();
        const stockCamion = await tx.query.inventario.findMany({ where: eq(schema.inventario.ubicacion, truck.nombre) });
        const stockProducto = stockCamion.find((x: any) => x.producto === carga.producto && x.unidad === 'kg');
        if (stockProducto) await tx.update(schema.inventario).set({ cantidad: Number(stockProducto.cantidad) + carga.kg, ultima_actualizacion: ahora }).where(eq(schema.inventario.id, stockProducto.id));
        else await tx.insert(schema.inventario).values({
          id: `${guiaDemo.id}-INV-${String(indice + 1).padStart(2, '0')}`, producto: carga.producto, cantidad: carga.kg,
          unidad: 'kg', ubicacion: truck.nombre, lote: carga.lote, fecha_caducidad: carga.caduca, ultima_actualizacion: ahora,
        }).onConflictDoNothing();
        await tx.insert(schema.movimientosInventario).values({
          id: `${guiaDemo.id}-MOV-${String(indice + 1).padStart(2, '0')}`, producto: carga.producto, cantidad: carga.kg,
          unidad: 'kg', tipo: 'Despacho demo a ruta', origen: 'Bodega Central', destino: truck.nombre,
          fecha: ahora, referencia_id: guiaDemo.id,
        }).onConflictDoNothing();
        await tx.insert(schema.traza_etiqueta).values({
          id: `${guiaDemo.id}-TRAZA-${String(indice + 1).padStart(2, '0')}`, etiquetaId: carga.etiquetaId,
          tipoEvento: 'Carga de ruta', ubicacion: truck.nombre, documentoRef: guiaDemo.consecutivo,
          usuarioId: '7', fecha: ahora, observaciones: 'Carga sintética de demostración; inventario expresado en kg.',
        }).onConflictDoNothing();
      }
    });
  }

  // Rehidrata los nombres en guías demo ya existentes (por ejemplo, si una
  // versión previa las creó con solo el ID y el orden de cada parada).
  for (const guiaDemo of guiasDemoVendedor) {
    await db.update(schema.guias_despacho).set({
      vendedorId: guiaDemo.vendedorId,
      responsableTransporte: guiaDemo.responsableTransporte,
      rutaOrdenJson: JSON.stringify(guiaDemo.clientes.map((clienteId, index) => ({
        clienteId,
        orden: index + 1,
        nombre: clientesDemo.find((cliente: any) => cliente.id === clienteId)?.nombre || clienteId,
      }))),
      clientesIds: JSON.stringify(guiaDemo.clientes),
    }).where(eq(schema.guias_despacho.id, guiaDemo.id));
  }

  // Keep the initial administrator active for the demo after an interrupted seed.
  await db.update(schema.users).set({ activo: true }).where(eq(schema.users.email, 'admin@granja.com'));

  // Synthetic closed-route history makes the seller's quantity/price assistant
  // demonstrable without changing the stock on the active route.
  const guiaHistorialDemoId = 'DEMO-GUIA-HISTORIAL-SUGERENCIAS';
  await db.insert(schema.guias_despacho).values({
    id: guiaHistorialDemoId, consecutivo: 'GD-DEMO-HISTORIAL-SUGERENCIAS',
    camionId: 'DEMO-TRUCK-001', rutaId: 'DEMO-ROUTE-001', fecha: now,
    vendedorId: '3', responsableTransporte: 'Historial sintético de demostración',
    clientesIds: JSON.stringify(['DEMO-CLI-001']), totalCartones: 0, totalKg: 0,
    estado: 'Cerrada', finDiaFecha: now,
  }).onConflictDoNothing();
  await db.update(schema.guias_despacho).set({ estado: 'Cerrada' }).where(eq(schema.guias_despacho.id, guiaHistorialDemoId));

  const pedidosDemo = [
    { id: 'DEMO-HIST-VENTA-001', consecutivo: 'TQ-DEMO-HIST-0001', dias: 18, producto: 'Huevos Grandes', kg: 10, precio: 1180 },
    { id: 'DEMO-HIST-VENTA-002', consecutivo: 'TQ-DEMO-HIST-0002', dias: 12, producto: 'Huevos Grandes', kg: 12, precio: 1200 },
    { id: 'DEMO-HIST-VENTA-003', consecutivo: 'TQ-DEMO-HIST-0003', dias: 5, producto: 'Huevos Grandes', kg: 14, precio: 1250 },
    { id: 'DEMO-HIST-VENTA-004', consecutivo: 'TQ-DEMO-HIST-0004', dias: 15, producto: 'Huevos Medianos', kg: 6, precio: 1020 },
    { id: 'DEMO-HIST-VENTA-005', consecutivo: 'TQ-DEMO-HIST-0005', dias: 4, producto: 'Huevos Medianos', kg: 8, precio: 1080 },
  ];
  for (const pedido of pedidosDemo) {
    const subtotal = pedido.kg * pedido.precio;
    await db.insert(schema.ventas_ruta_kg).values({
      id: pedido.id, tiqueteConsecutivo: pedido.consecutivo, camionId: 'DEMO-TRUCK-001',
      guiaId: guiaHistorialDemoId, vendedorId: '3',
      fechaHora: new Date(Date.now() - pedido.dias * 86400000).toISOString(),
      clienteId: 'DEMO-CLI-001', producto: pedido.producto, cantidadKg: pedido.kg,
      cantidadInventario: pedido.kg, unidadInventario: 'kg', precioKg: pedido.precio,
      subtotal, descuento: 0, total: subtotal, cobro: 'Efectivo', estado: 'Emitida',
      resolucionPrecioJson: JSON.stringify({ demo: true, nota: 'Pedido histórico sintético para demostrar sugerencias; no es una venta real.' }),
    }).onConflictDoNothing();
  }
}
