import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  roles: text('roles').notNull().default(''), // CSV: 'Despachador,Camionero'
  password_hash: text('password_hash'),
  activo: integer('activo', { mode: 'boolean' }).default(true),
});

export const sesiones = sqliteTable('sesiones', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  token: text('token').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const clientes = sqliteTable('clientes', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull(),
  tipo_documento: text('tipo_documento').default('Fisica'),
  documento_id: text('documento_id'),
  actividad_economica: text('actividad_economica'),
  telefono: text('telefono'),
  email: text('email'),
  direccion: text('direccion'),
  provincia: text('provincia'),
  canton: text('canton'),
  distrito: text('distrito'),
  latitud: real('latitud'),
  longitud: real('longitud'),
  ruta: text('ruta'),
  condicion_pago: text('condicion_pago').notNull().default('Contado'),
  precio_especial: real('precio_especial'),
  limite_credito: real('limite_credito').default(0),
  saldo_pendiente: real('saldo_pendiente').default(0),
  promedio_compra: integer('promedio_compra').default(0),
  estado: text('estado').default('Activo'),
  notas: text('notas'),
  fecha_creacion: text('fecha_creacion'),
  prioridad: text('prioridad').default('Normal'), // VIP, Alta, Normal
  ventana_entrega_ini: text('ventana_entrega_ini'),
  ventana_entrega_fin: text('ventana_entrega_fin'),
  dias_frecuencia: text('dias_frecuencia'),
  demanda_promedio_cartones: integer('demanda_promedio_cartones').default(0),
});

export const rutas = sqliteTable('rutas', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull(),
  vendedor_asignado: text('vendedor_asignado'),
  vendedores: text('vendedores'),
  camion_id: text('camion_id').references(() => camiones.id),
  cliente_ids: text('cliente_ids'),
  dias_frecuencia: text('dias_frecuencia'),
  kilometraje_aprox: real('kilometraje_aprox'),
  estado: text('estado').default('Activa'),
  capacidad_max_cartones: integer('capacidad_max_cartones'),
  centroide_lat: real('centroide_lat'),
  centroide_lng: real('centroide_lng'),
});

export const camiones = sqliteTable('camiones', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull().unique(),
  placa: text('placa'),
  camioneroId: text('camionero_id').references(() => users.id),
  ruta_defecto: text('ruta_defecto'),
  vendedor_id: text('vendedor_id'),
  capacidad_cartones: integer('capacidad_cartones').notNull().default(500),
  estado: text('estado').default('Activo'),
});

export const guias_despacho = sqliteTable('guias_despacho', {
  id: text('id').primaryKey(),
  consecutivo: text('consecutivo').notNull().unique(),
  camionId: text('camion_id').references(() => camiones.id),
  rutaId: text('ruta_id'),
  fecha: text('fecha').notNull(),
  horaCarga: text('hora_carga'),
  responsableCarga: text('responsable_carga'),
  responsableTransporte: text('responsable_transporte'),
  vendedorId: text('vendedor_id').references(() => users.id),
  clientesIds: text('clientes_ids'),
  /** Etiquetas reservadas como colchón extra, con producto y cantidad capturados al cargar. */
  colchonExtraJson: text('colchon_extra_json'),
  totalCartones: real('total_cartones').notNull().default(0), // cantidad almacenada en kg para guías nuevas
  totalKg: real('total_kg'), // null en guías históricas; peso neto confirmado de cargas nuevas
  pesoSalida: real('peso_salida'),
  pesoLlegada: real('peso_llegada'),
  estado: text('estado').notNull().default('Preparada'), // Preparada, Cargada, EnRuta, Cerrada, Anulada
  firmasJson: text('firmas_json'),
  rutaOrdenJson: text('ruta_orden_json'),
  recibidoEn: text('recibido_en'),
  finDiaFecha: text('fin_dia_fecha'),
});

export const guias_despacho_detalle = sqliteTable('guias_despacho_detalle', {
  id: text('id').primaryKey(),
  guiaId: text('guia_id').notNull().references(() => guias_despacho.id),
  etiquetaId: text('etiqueta_id').references(() => etiquetas.id),
  producto: text('producto').notNull(),
  cartones: real('cartones').notNull(), // cantidad en kg; nombre legado de columna
  cantidadKg: real('cantidad_kg'), // null en detalles históricos
  pesoAnden: real('peso_anden'),
  estadoSalida: text('estado_salida').default('checked'),
});

// ==================== PHASE F3 — CAJA DEL VENDEDOR ====================

export const consecutivos = sqliteTable('consecutivos', {
  id: text('id').primaryKey(),
  tipo: text('tipo').notNull(), // 'TIQUETE'
  entidad: text('entidad'), // camionId (null = global)
  prefijo: text('prefijo').notNull().default('TQ'),
  rangoDesde: integer('rango_desde').notNull().default(1),
  rangoHasta: integer('rango_hasta').notNull().default(999999),
  ultimo: integer('ultimo').notNull().default(0),
});

export const ventas_ruta = sqliteTable('ventas_ruta', {
  id: text('id').primaryKey(),
  tiqueteConsecutivo: text('tiquete_consecutivo').notNull().unique(),
  camionId: text('camion_id').notNull().references(() => camiones.id),
  guiaId: text('guia_id').notNull().references(() => guias_despacho.id),
  vendedorId: text('vendedor_id').notNull().references(() => users.id),
  fechaHora: text('fecha_hora').notNull(), // hora del servidor
  clienteId: text('cliente_id').references(() => clientes.id),
  etiquetaId: text('etiqueta_id').references(() => etiquetas.id),
  producto: text('producto').notNull(),
  cartones: real('cartones').notNull(), // nombre histórico de columna; a partir de F7 almacena kg
  unidad: text('unidad').notNull().default('kg'),
  cantidadInventario: real('cantidad_inventario'),
  precioUnitario: real('precio_unitario').notNull(),
  subtotal: real('subtotal').notNull(),
  descuento: real('descuento').notNull().default(0),
  total: real('total').notNull(),
  cobro: text('cobro').notNull().default('Efectivo'), // Efectivo, Credito
  estado: text('estado').notNull().default('Emitida'), // Emitida, Anulada
  facturaId: text('factura_id'),
  resolucionPrecioJson: text('resolucion_precio_json'),
  imprimido: integer('imprimido', { mode: 'boolean' }).notNull().default(false),
  anuladoEn: text('anulado_en'),
  anuladoPor: text('anulado_por'),
});

/** Tiquetes de ruta en kg. La tabla histórica ventas_ruta conserva cartones. */
export const ventas_ruta_kg = sqliteTable('ventas_ruta_kg', {
  id: text('id').primaryKey(),
  tiqueteConsecutivo: text('tiquete_consecutivo').notNull().unique(),
  camionId: text('camion_id').notNull().references(() => camiones.id),
  guiaId: text('guia_id').notNull().references(() => guias_despacho.id),
  vendedorId: text('vendedor_id').notNull().references(() => users.id),
  fechaHora: text('fecha_hora').notNull(),
  clienteId: text('cliente_id').references(() => clientes.id),
  etiquetaId: text('etiqueta_id').references(() => etiquetas.id),
  producto: text('producto').notNull(),
  cantidadKg: real('cantidad_kg').notNull(),
  cantidadInventario: real('cantidad_inventario').notNull(),
  unidadInventario: text('unidad_inventario').notNull(),
  precioKg: real('precio_kg').notNull(),
  subtotal: real('subtotal').notNull(),
  descuento: real('descuento').notNull().default(0),
  total: real('total').notNull(),
  cobro: text('cobro').notNull().default('Efectivo'),
  estado: text('estado').notNull().default('Emitida'),
  facturaId: text('factura_id'),
  resolucionPrecioJson: text('resolucion_precio_json'),
  etiquetasAsignadasJson: text('etiquetas_asignadas_json'),
  anuladoEn: text('anulado_en'),
  anuladoPor: text('anulado_por'),
});

export const retornos_camion = sqliteTable('retornos_camion', {
  id: text('id').primaryKey(),
  guiaId: text('guia_id').notNull().references(() => guias_despacho.id),
  etiquetaId: text('etiqueta_id').references(() => etiquetas.id),
  ventaRutaId: text('venta_ruta_id'),
  fecha: text('fecha').notNull(),
  responsable: text('responsable').notNull(),
  registradoPor: text('registrado_por'),
  producto: text('producto').notNull(),
  cartones: real('cartones').notNull(), // cantidad en unidad declarada en etiquetas_json
  unidad: text('unidad').notNull().default('cartones'),
  cantidadAceptada: real('cantidad_aceptada'),
  etiquetasJson: text('etiquetas_json'), // JSON array de [{etiquetaId, codigoUnico, producto, cartones}]
  peso: real('peso'),
  estado: text('estado').notNull().default('Registrado'), // Registrado | PendienteBodega | AceptadoBodega | RechazadoBodega | Recibido | Cerrado
  aceptadoPor: text('aceptado_por'),
  aceptadoEn: text('aceptado_en'),
  condicion: text('condicion'),
  tipo: text('tipo').default('sobrante'), // parcial | completo | sobrante
});

export const inventario = sqliteTable('inventario', {
  id: text('id').primaryKey(),
  producto: text('producto').notNull(),
  cantidad: real('cantidad').notNull(),
  unidad: text('unidad').notNull(),
  ubicacion: text('ubicacion').notNull(),
  lote: text('lote'),
  fecha_caducidad: text('fecha_caducidad'),
  ultima_actualizacion: text('ultima_actualizacion').notNull(),
});

/** Insumos operativos comprados o ingresados manualmente, separados del huevo. */
export const inventario_insumos = sqliteTable('inventario_insumos', {
  id: text('id').primaryKey(),
  producto: text('producto').notNull(),
  categoria: text('categoria').notNull(),
  cantidadRecibida: real('cantidad_recibida').notNull(),
  cantidadActual: real('cantidad_actual').notNull(),
  unidad: text('unidad').notNull(),
  ubicacion: text('ubicacion').notNull(),
  lote: text('lote'),
  proveedor: text('proveedor'),
  gastoId: text('gasto_id'),
  montoCompra: real('monto_compra'),
  productoHuevo: text('producto_huevo'),
  kgPorUnidad: real('kg_por_unidad'),
  creadoPor: text('creado_por').notNull(),
  creadoEn: text('creado_en').notNull(),
});
export const movimientos_insumos = sqliteTable('movimientos_insumos', {
  id: text('id').primaryKey(), insumoId: text('insumo_id').notNull(), tipo: text('tipo').notNull(), cantidad: real('cantidad').notNull(), unidad: text('unidad').notNull(), referenciaId: text('referencia_id'), kgHuevo: real('kg_huevo'), registradoPor: text('registrado_por').notNull(), fecha: text('fecha').notNull(), observacion: text('observacion'),
});

/** Conteo físico en cuarentena separado del stock disponible y del saldo libro. */
export const inventario_cuarentena = sqliteTable('inventario_cuarentena', {
  id: text('id').primaryKey(),
  aprobacionId: text('aprobacion_id').notNull().references(() => aprobaciones.id),
  guiaId: text('guia_id').notNull().references(() => guias_despacho.id),
  producto: text('producto').notNull(),
  cantidadSistema: real('cantidad_sistema').notNull(),
  cantidad: real('cantidad').notNull(),
  unidad: text('unidad').notNull(),
  estado: text('estado').notNull().default('PendienteAprobacion'),
  creadoPor: text('creado_por').notNull(),
  creadoEn: text('creado_en').notNull(),
  liberado: real('liberado').notNull().default(0),
  liberadoPor: text('liberado_por'),
  liberadoEn: text('liberado_en'),
  motivoResolucion: text('motivo_resolucion'),
  etiquetasReemplazoJson: text('etiquetas_reemplazo_json'),
});

export const facturas = sqliteTable('facturas', {
  id: text('id').primaryKey(),
  consecutivo: text('consecutivo').notNull(),
  fecha: text('fecha').notNull(),
  /**
   * Vencimiento real de la factura. Antes el aging se medía desde `fecha`, así
   * que una factura a 30 días de crédito ya figuraba vencida desde el día 1.
   * Se rellena al migrar y al crear la factura; si queda null se deriva de
   * `fecha` + `condicion_pago` (ver `src/lib/cobranza.ts`).
   */
  fechaVencimiento: text('fecha_vencimiento'),
  clienteId: text('cliente_id').notNull().references(() => clientes.id),
  vendedorId: text('vendedor_id').notNull().references(() => users.id),
  subtotal: real('subtotal').notNull(),
  descuento: real('descuento').notNull(),
  total: real('total').notNull(),
  condicion_pago: text('condicion_pago').notNull(),
  metodo_pago: text('metodo_pago'),
  estado: text('estado').notNull(),
  guiaId: text('guia_id'),
  camionId: text('camion_id'),
});

export const detallesFactura = sqliteTable('detalles_factura', {
  id: text('id').primaryKey(),
  facturaId: text('factura_id').notNull().references(() => facturas.id),
  producto: text('producto').notNull(),
  cantidad: real('cantidad').notNull(),
  precio_unitario: real('precio_unitario').notNull(),
  subtotal: real('subtotal').notNull(),
  resolucionPrecioJson: text('resolucion_precio_json'),
});

/**
 * Historial de pagos aplicados a una factura.
 *
 * Antes `POST /api/pagos` ponía `estado = 'Pagada'` sin registrar nada: un pago
 * parcial marcaba la factura entera como pagada y no quedaba rastro. El saldo
 * pendiente es ahora `facturas.total - SUM(pagos.monto)`, no `facturas.total`.
 */
export const pagos = sqliteTable('pagos', {
  id: text('id').primaryKey(),
  facturaId: text('factura_id').notNull().references(() => facturas.id),
  fecha: text('fecha').notNull(),
  monto: real('monto').notNull(),
  metodo: text('metodo'),
  /** Usuario que registró el pago. Sin FK: el registro de pagos es append-only. */
  usuarioId: text('usuario_id'),
  nota: text('nota'),
  /** Llave para ignorar reintentos de red del mismo cobro. */
  idempotencyKey: text('idempotency_key'),
});

export const gastos = sqliteTable('gastos', {
  id: text('id').primaryKey(),
  fecha: text('fecha').notNull(),
  categoria: text('categoria').notNull(),
  monto: real('monto').notNull(),
  descripcion: text('descripcion').notNull(),
  usuarioId: text('usuario_id').notNull().references(() => users.id),
  idempotencyKey: text('idempotency_key'),
  guiaId: text('guia_id').references(() => guias_despacho.id),
  medioPago: text('medio_pago').notNull().default('Efectivo'),
});

/** Cierre monetario de cada guía. Conserva el valor esperado, el conteo físico
 * del efectivo y la diferencia para que el cierre de ruta sea auditable. */
export const cierres_caja_ruta = sqliteTable('cierres_caja_ruta', {
  id: text('id').primaryKey(),
  guiaId: text('guia_id').notNull().unique().references(() => guias_despacho.id),
  vendedorId: text('vendedor_id').notNull(),
  fecha: text('fecha').notNull(),
  efectivoEsperado: real('efectivo_esperado').notNull().default(0),
  gastosEfectivo: real('gastos_efectivo').notNull().default(0),
  efectivoContado: real('efectivo_contado'),
  creditoDocumentado: real('credito_documentado').notNull().default(0),
  diferencia: real('diferencia'),
  estado: text('estado').notNull().default('PendienteConteo'),
  aprobacionId: text('aprobacion_id'),
  creadoEn: text('creado_en').notNull(),
});

export const depositos_caja = sqliteTable('depositos_caja', {
  id: text('id').primaryKey(),
  cierreId: text('cierre_id').notNull().unique().references(() => cierres_caja_ruta.id),
  montoEsperado: real('monto_esperado').notNull(),
  montoDepositado: real('monto_depositado').notNull(),
  referencia: text('referencia').notNull(),
  comprobante: text('comprobante'),
  registradoPor: text('registrado_por').notNull(),
  fecha: text('fecha').notNull(),
  estado: text('estado').notNull().default('Conciliado'),
  aprobacionId: text('aprobacion_id'),
  idempotencyKey: text('idempotency_key'),
});

export const granjas = sqliteTable('granjas', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull(),
  ubicacion: text('ubicacion').notNull(),
  tipo_produccion: text('tipo_produccion'),
  encargadoId: text('encargado_id').notNull().references(() => users.id),
  estado: text('estado').default('Activo'),
});

export const galerones = sqliteTable('galerones', {
  id: text('id').primaryKey(),
  granjaId: text('granja_id').notNull().references(() => granjas.id),
  nombre: text('nombre').notNull(),
  capacidad_maxima: integer('capacidad_maxima').notNull(),
  aves_en_produccion: integer('aves_en_produccion').default(0),
  tipo_galeron: text('tipo_galeron').default('Productora'), // Productora, Crianza, Vacía
  produccion_diaria_esperada: integer('produccion_diaria_esperada').default(0),
  notas: text('notas'),
  fecha_ultimo_mantenimiento: text('fecha_ultimo_mantenimiento'),
  estado: text('estado').default('Activo'),
});

export const lotes_aves = sqliteTable('lotes_aves', {
  id: text('id').primaryKey(),
  galeronId: text('galeron_id').notNull().references(() => galerones.id),
  fecha_ingreso: text('fecha_ingreso').notNull(),
  cantidad_inicial: integer('cantidad_inicial').notNull(),
  linea_genetica: text('linea_genetica').notNull(),
  estado: text('estado').notNull(), // Activo / Finalizado
});

export const mantenimientos = sqliteTable('mantenimientos', {
  id: text('id').primaryKey(),
  galeronId: text('galeron_id').notNull().references(() => galerones.id),
  fecha: text('fecha').notNull(),
  tipo: text('tipo').notNull(), // Preventivo/Correctivo
  descripcion: text('descripcion').notNull(),
  estado: text('estado').notNull(), // Pendiente/Completado
});

export const movimientosInventario = sqliteTable('movimientos_inventario', {
  id: text('id').primaryKey(),
  producto: text('producto').notNull(),
  cantidad: real('cantidad').notNull(),
  unidad: text('unidad').notNull().default('kg'),
  tipo: text('tipo').notNull(), // 'Entrada Producción' o 'Traslado' o 'Venta' o 'Ajuste'
  origen: text('origen').notNull(),
  destino: text('destino').notNull(),
  fecha: text('fecha').notNull(),
  referencia_id: text('referencia_id'),
  registradoPor: text('registrado_por'),
  lote: text('lote'),
});

export const produccion_diaria = sqliteTable('produccion_diaria', {
  id: text('id').primaryKey(),
  loteId: text('lote_id').notNull().references(() => lotes_aves.id),
  granjaId: text('granja_id').references(() => granjas.id),
  galeronId: text('galeron_id').references(() => galerones.id),
  fecha: text('fecha').notNull(),
  registradoPor: text('registrado_por'),
  responsable: text('responsable'),
  tipo_producto: text('tipo_producto').notNull(),
  cantidad: integer('cantidad').notNull(),
  unidad: text('unidad').notNull(),
  estado: text('estado').default('Disponible'), // Disponible, EnTransito, Recibido, Facturado
});

export const traslados = sqliteTable('traslados', {
  id: text('id').primaryKey(),
  cargaId: text('carga_id'),
  vehiculo: text('vehiculo'),
  camionId: text('camion_id').references(() => camiones.id),
  creadoPorId: text('creado_por_id').references(() => users.id),
  confirmadoPorId: text('confirmado_por_id'),
  granjaOrigenId: text('granja_origen_id').references(() => granjas.id),
  bodegaDestinoId: text('bodega_destino_id'), // Simplificado para bodega central
  fechaSalida: text('fecha_salida').notNull(),
  fechaLlegada: text('fecha_llegada'),
  responsableEntrega: text('responsable_entrega'),
  responsableTransporte: text('responsable_transporte'),
  estado: text('estado').default('Pendiente'), // Pendiente, EnTransito, Recibido, RecibidoConDiferencia, Rechazada, Anulado
  motivoRechazo: text('motivo_rechazo'),
  observaciones: text('observaciones'),
});

export const recepciones = sqliteTable('recepciones', {
  id: text('id').primaryKey(),
  trasladoId: text('traslado_id').references(() => traslados.id),
  guiaRemisionId: text('guia_remision_id'),
  fechaRecepcion: text('fecha_recepcion').notNull(),
  cantidadEsperada: integer('cantidad_esperada').notNull(),
  cantidadRecibida: integer('cantidad_recibida').notNull(),
  diferencia: integer('diferencia').default(0),
  pesoBruto: real('peso_bruto'),
  cantidadKgEsperada: real('cantidad_kg_esperada'),
  cantidadKgRecibida: real('cantidad_kg_recibida'),
  diferenciaKg: real('diferencia_kg'),
  motivoDiferencia: text('motivo_diferencia'),
  tipoDiferencia: text('tipo_diferencia'), // 'desperdicio' | 'alerta' (diferencia por investigar)
  responsableRecepcion: text('responsable_recepcion'),
  estado: text('estado').notNull(), // Conforme, ConDiferencia
});

// Borradores de recepción para permitir pausar y retomar el conteo sin alterar
// inventario; el stock solo cambia al confirmar la recepción final.
export const bodega_recepcion_borradores = sqliteTable('bodega_recepcion_borradores', {
  id: text('id').primaryKey(),
  tipo: text('tipo').notNull(),
  referenciasJson: text('referencias_json').notNull(),
  datosJson: text('datos_json').notNull().default('{}'),
  iniciadoPor: text('iniciado_por'),
  iniciadoEn: text('iniciado_en').notNull(),
  actualizadoEn: text('actualizado_en').notNull(),
});

export const incidentes = sqliteTable('incidentes', {
  id: text('id').primaryKey(),
  granjaId: text('granja_id').references(() => granjas.id),
  galeronId: text('galeron_id').references(() => galerones.id),
  categoria: text('categoria').notNull(),
  severidad: text('severidad').notNull().default('Media'), // Alta, Media, Baja
  descripcion: text('descripcion').notNull(),
  cantidadAfectada: integer('cantidad_afectada'),
  causaProbable: text('causa_probable'),
  equipoAfectado: text('equipo_afectado'),
  accionTomada: text('accion_tomada'),
  estado: text('estado').notNull().default('Reportado'), // Reportado, EnRevision, Resuelto, Descartado
  reportadoPorId: text('reportado_por_id').notNull().references(() => users.id),
  reportadoPorNombre: text('reportado_por_nombre'),
  fecha: text('fecha').notNull(),
  resueltoPor: text('resuelto_por'),
  resumen: text('resumen'),
});

export const guias_remision = sqliteTable('guias_remision', {
  id: text('id').primaryKey(),
  consecutivo: text('consecutivo').notNull().unique(),
  granjaId: text('granja_id').references(() => granjas.id),
  fecha: text('fecha').notNull(),
  producto: text('producto').notNull(),
  cartonesEsperados: integer('cartones_esperados').notNull(),
  cantidadKgEsperada: real('cantidad_kg_esperada'),
  unidad: text('unidad').notNull().default('cartones'),
  lote: text('lote'),
  responsable: text('responsable').notNull(),
  transporte: text('transporte'),
  estado: text('estado').default('Emitida'), // Emitida, EnTransito, Recibida, RecibidaConDiferencia, Alistada, Anulada
  recibidoEn: text('recibido_en'),
});

export const traza_etiqueta = sqliteTable('traza_etiqueta', {
  id: text('id').primaryKey(),
  etiquetaId: text('etiqueta_id').notNull().references(() => etiquetas.id),
  tipoEvento: text('tipo_evento').notNull(),
  ubicacion: text('ubicacion'),
  documentoRef: text('documento_ref'),
  usuarioId: text('usuario_id'),
  fecha: text('fecha').notNull(),
  observaciones: text('observaciones'),
});

export const etiquetas = sqliteTable('etiquetas', {
  id: text('id').primaryKey(),
  codigoUnico: text('codigo_unico').notNull().unique(),
  producto: text('producto').notNull(),
  cantidad: real('cantidad').notNull(),
  unidad: text('unidad').notNull().default('cartones'),
  pesoBruto: real('peso_bruto'),
  pesoNeto: real('peso_neto'),
  saldoKg: real('saldo_kg'), // saldo medido bajo custodia; null en etiquetas históricas
  pesoOrigen: text('peso_origen'), // Manual por ahora; reservado para integración de báscula
  pesoRegistradoPor: text('peso_registrado_por'),
  pesoRegistradoEn: text('peso_registrado_en'),
  fechaProduccion: text('fecha_produccion'),
  fechaEmpaque: text('fecha_empaque'),
  fechaVencimiento: text('fecha_vencimiento'),
  granjaOrigen: text('granja_origen'),
  galeronOrigen: text('galeron_origen'),
  clasificacion: text('clasificacion'), // Grade A, Grade B, etc.
  tara: real('tara'),
  estado: text('estado').default('Generada'), // Generada, EnBodega, Cargada, Entregada, Retornada, Merma
  ubicacionActual: text('ubicacion_actual'),
  lote: text('lote'),
  guiaRemisionId: text('guia_remision_id'),
  pesoBodega: real('peso_bodega'),
  guiaDespachoId: text('guia_despacho_id'),
  fechaRecepcion: text('fecha_recepcion'),
  tipoCarton: text('tipo_carton'),
});

export const tiposCarton = sqliteTable('tipos_carton', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull(),
  unidades: integer('unidades').notNull(),
  estado: text('estado').notNull().default('Activo'),
  fechaCreacion: text('fecha_creacion').notNull(),
});

export const facturas_electronicas = sqliteTable('facturas_electronicas', {
  id: text('id').primaryKey(),
  facturaId: text('factura_id').notNull().references(() => facturas.id),
  tipoDocumento: text('tipo_documento').notNull(), // Factura, Tiquete, NotaCredito
  consecutivo: text('consecutivo').notNull(),
  clave: text('clave'),
  fechaEmision: text('fecha_emision').notNull(),
  emisorNombre: text('emisor_nombre').notNull(),
  emisorCedula: text('emisor_cedula').notNull(),
  emisorCorreo: text('emisor_correo'),
  receptorNombre: text('receptor_nombre'),
  receptorCedula: text('receptor_cedula'),
  receptorCorreo: text('receptor_correo'),
  subtotal: real('subtotal').notNull(),
  descuento: real('descuento').default(0),
  impuestos: real('impuestos').default(0),
  total: real('total').notNull(),
  condicionPago: text('condicion_pago').notNull(),
  medioPago: text('medio_pago'),
  estado: text('estado').notNull().default('Borrador'), // Borrador, Pendiente, Enviado, Aceptado, Rechazado, Error
  xmlGenerado: text('xml_generado'),
  xmlFirmado: text('xml_firmado'),
  respuestaHacienda: text('respuesta_hacienda'),
  numeroConsecutivo: text('numero_consecutivo'),
  fechaEnvio: text('fecha_envio'),
  fechaRespuesta: text('fecha_respuesta'),
  motivoRechazo: text('motivo_rechazo'),
  notasCreditoId: text('notas_credito_id'),
  ambiente: text('ambiente').default('Pruebas'), // Pruebas, Produccion
  proveedor: text('proveedor'), // Facel, FacturaYA, FACBOX, HaciendaDirect, etc.
  idempotencyKey: text('idempotency_key'),
  idempotencyPayload: text('idempotency_payload'),
  datosFiscalSnapshot: text('datos_fiscal_snapshot'),
});

export const configuracionFiscalEmisor = sqliteTable('configuracion_fiscal_emisor', {
  id: text('id').primaryKey(),
  razonSocial: text('razon_social').notNull().default(''),
  identificacionTipo: text('identificacion_tipo').notNull().default(''),
  identificacion: text('identificacion').notNull().default(''),
  actividadEconomica: text('actividad_economica').notNull().default(''),
  nombreComercial: text('nombre_comercial'),
  correo: text('correo'),
  telefono: text('telefono'),
  provincia: text('provincia'),
  canton: text('canton'),
  distrito: text('distrito'),
  barrio: text('barrio'),
  otrasSenas: text('otras_senas'),
  monedaPresentacion: text('moneda_presentacion').notNull().default('CRC'),
  estadoRevision: text('estado_revision').notNull().default('Pendiente'),
  referenciaEvidencia: text('referencia_evidencia'),
  revisorNombre: text('revisor_nombre'),
  revisorCredencial: text('revisor_credencial'),
  actualizadoPor: text('actualizado_por'),
  actualizadoEn: text('actualizado_en'),
});

export const pesos_por_punto = sqliteTable('pesos_por_punto', {
  id: text('id').primaryKey(),
  referenciaId: text('referencia_id'), // ID del traslado, recepcion, carga, venta, etc.
  tipoReferencia: text('tipo_referencia').notNull(), // Traslado, Recepcion, Carga, Venta, Retorno
  producto: text('producto').notNull(),
  cantidadUnidades: integer('cantidad_unidades').notNull(),
  unidad: text('unidad').notNull(), // cartones, kg, etc.
  pesoEsperado: real('peso_esperado').notNull(),
  pesoReal: real('peso_real').notNull(),
  diferencia: real('diferencia').default(0),
  basculaUtilizada: text('bascula_utilizada'),
  responsable: text('responsable').notNull(),
  fecha: text('fecha').notNull(),
  ubicacion: text('ubicacion').notNull(), // Granja, Bodega Central, Camion, Cliente
  observaciones: text('observaciones'),
  estado: text('estado').default('Conforme'), // Conforme, ConDiferencia, Aprobado, Rechazado
});

// ==================== PHASE 4 — SALUD AVÍCOLA ====================

export const vacunaciones = sqliteTable('vacunaciones', {
  id: text('id').primaryKey(),
  granjaId: text('granja_id').notNull().references(() => granjas.id),
  galeronId: text('galeron_id').references(() => galerones.id),
  loteId: text('lote_id').references(() => lotes_aves.id),
  tipoVacuna: text('tipo_vacuna').notNull(),
  proveedor: text('proveedor'),
  dosis: text('dosis'),
  metodoAplicacion: text('metodo_aplicacion'), // Inyectable, Oral, Agua, Spray
  fechaProgramada: text('fecha_programada').notNull(),
  fechaAplicada: text('fecha_aplicada'),
  responsable: text('responsable').notNull(),
  estado: text('estado').notNull().default('Programada'), // Programada, Aplicada, Vencida, Reprogramada, Cancelada
  evidencia: text('evidencia'),
  observaciones: text('observaciones'),
  reaccionIncidencia: text('reaccion_incidencia'),
  proximaFecha: text('proxima_fecha'),
  fechaCreacion: text('fecha_creacion').notNull(),
});

// ==================== PHASE 4 — ALIMENTO / SILOS ====================

export const inventario_alimento = sqliteTable('inventario_alimento', {
  id: text('id').primaryKey(),
  tipoAlimento: text('tipo_alimento').notNull(), // Inicial, Crecimiento, Producción, Premix
  proveedor: text('proveedor'),
  loteAlimento: text('lote_alimento'),
  siloUbicacion: text('silo_ubicacion'), // Silo 1, Silo 2, Bodega Alimento
  cantidadRecibida: real('cantidad_recibida').notNull(),
  cantidadActual: real('cantidad_actual').notNull(),
  unidad: text('unidad').notNull(), // kg, sacos
  galeronAsociado: text('galeron_asociado'),
  loteAvesAsociado: text('lote_aves_asociado'),
  fechaIngreso: text('fecha_ingreso').notNull(),
  responsable: text('responsable').notNull(),
  referenciaDocumentoOrigen: text('referencia_documento_origen'),
  fechaDocumentoOrigen: text('fecha_documento_origen'),
  montoDocumentoOrigen: real('monto_documento_origen'),
  monedaDocumentoOrigen: text('moneda_documento_origen'),
  merma: real('merma').default(0),
  estado: text('estado').default('Activo'), // Activo, Agotado, Vencido
});

export const consumo_alimento = sqliteTable('consumo_alimento', {
  id: text('id').primaryKey(),
  inventarioAlimentoId: text('inventario_alimento_id').references(() => inventario_alimento.id),
  galeronId: text('galeron_id').references(() => galerones.id),
  loteAvesId: text('lote_aves_id').references(() => lotes_aves.id),
  cantidadConsumida: real('cantidad_consumida').notNull(),
  unidad: text('unidad').notNull(),
  fecha: text('fecha').notNull(),
  tipoMovimiento: text('tipo_movimiento').notNull().default('Consumo'),
  responsable: text('responsable').notNull(),
  observaciones: text('observaciones'),
});

// ==================== PHASE 4 — MANTENIMIENTO MEJORADO ====================

export const activos_mantenimiento = sqliteTable('activos_mantenimiento', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull(),
  tipo: text('tipo').notNull(), // Galerón, Silo, Sistema Agua, Eléctrico, Ventilación, Cerca, Equipo Recolect, Vehículo, Herramienta, Báscula, Estante, Andén
  granjaId: text('granja_id').references(() => granjas.id),
  galeronId: text('galeron_id').references(() => galerones.id),
  ubicacion: text('ubicacion'),
  estado: text('estado').default('Operativo'), // Operativo, En Mantenimiento, Inactivo
  fechaUltimoMantenimiento: text('fecha_ultimo_mantenimiento'),
  proximoMantenimiento: text('proximo_mantenimiento'),
  responsable: text('responsable'),
});

export const ordenes_mantenimiento = sqliteTable('ordenes_mantenimiento', {
  id: text('id').primaryKey(),
  activoId: text('activo_id').notNull().references(() => activos_mantenimiento.id),
  tipo: text('tipo').notNull(), // Preventivo, Correctivo, Limpieza, Inspección, Calibración
  fechaProgramada: text('fecha_programada').notNull(),
  fechaEjecutada: text('fecha_ejecutada'),
  responsable: text('responsable').notNull(),
  estado: text('estado').notNull().default('Pendiente'), // Pendiente, EnProgreso, Completado, Vencido
  insumosUsados: text('insumos_usados'), // JSON array of items
  costo: real('costo').default(0),
  evidencia: text('evidencia'),
  observaciones: text('observaciones'),
  proximaFecha: text('proxima_fecha'),
  checklist: text('checklist'), // JSON: [{item, ok, observacion}]
});

// ==================== PHASE 4 — DESPERDICIO / MERMA ====================

export const desperdicios = sqliteTable('desperdicios', {
  id: text('id').primaryKey(),
  origen: text('origen').notNull(), // Granja, Bodega, Camión, Cliente
  producto: text('producto').notNull(),
  etiquetaId: text('etiqueta_id'),
  lote: text('lote'),
  cantidad: integer('cantidad').notNull(),
  unidad: text('unidad').notNull().default('cartones'),
  factorKgPorCarton: real('factor_kg_por_carton'),
  cantidadCartones: real('cantidad_cartones'),
  peso: real('peso'),
  motivo: text('motivo').notNull(), // Quebrado Granja, Quebrado Bodega, Quebrado Camión, Rechazo Cliente, Vencido, Sucio, Diferencia Peso, Ajuste Administrativo
  responsable: text('responsable').notNull(),
  registradoPor: text('registrado_por'),
  evidencia: text('evidencia'),
  aprobacion: text('aprobacion'),
  impactoFinanciero: real('impacto_financiero').default(0),
  fecha: text('fecha').notNull(),
  observaciones: text('observaciones'),
  rutaId: text('ruta_id').references(() => rutas.id),
  guiaId: text('guia_despacho_id').references(() => guias_despacho.id),
  camionId: text('camion_id').references(() => camiones.id),
  vendedorId: text('vendedor_id').references(() => users.id),
});

// ==================== PHASE 4 — PRECIOS / POLÍTICAS COMERCIALES ====================

export const listas_precios = sqliteTable('listas_precios', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull(), // Lista Global, Lista Ruta X, etc.
  tipo: text('tipo').notNull(), // Global, Ruta, Cliente
  rutaAsociada: text('ruta_asociada'),
  clienteId: text('cliente_id').references(() => clientes.id),
  estado: text('estado').default('Activa'), // Activa, Inactiva
  fechaInicio: text('fecha_inicio').notNull(),
  fechaFin: text('fecha_fin'),
  aprobadoPor: text('aprobado_por'),
});

export const precios_detalle = sqliteTable('precios_detalle', {
  id: text('id').primaryKey(),
  listaId: text('lista_id').notNull().references(() => listas_precios.id),
  producto: text('producto').notNull(),
  precioUnitario: real('precio_unitario').notNull(),
  precioMinimo: real('precio_minimo'),
  precioMaximo: real('precio_maximo'),
  descuentoMaximo: real('descuento_maximo').default(0),
  unidad: text('unidad').default('cartones'),
});

export const historial_precios = sqliteTable('historial_precios', {
  id: text('id').primaryKey(),
  producto: text('producto').notNull(),
  precioAnterior: real('precio_anterior'),
  precioNuevo: real('precio_nuevo').notNull(),
  tipoLista: text('tipo_lista').notNull(),
  listaId: text('lista_id'),
  cambioPor: text('cambio_por').notNull(),
  motivo: text('motivo'),
  fecha: text('fecha').notNull(),
});

// ==================== PHASE 5 — APROBACIONES ====================

export const aprobaciones = sqliteTable('aprobaciones', {
  id: text('id').primaryKey(),
  tipo: text('tipo').notNull(), // DiferenciaPeso, NotaCredito, AjusteInventario, CambioPrecio, DescuentoNoAutorizado, AnulacionFactura
  modulo: text('modulo').notNull(),
  referenciaId: text('referencia_id'),
  solicitudUsuario: text('solicitud_usuario').notNull(),
  descripcion: text('descripcion').notNull(),
  datos: text('datos'), // JSON: contexto de la solicitud
  estado: text('estado').notNull().default('Pendiente'), // Pendiente, Aprobado, Rechazado
  aprobadoPor: text('aprobado_por'),
  motivoRechazo: text('motivo_rechazo'),
  fechaSolicitud: text('fecha_solicitud').notNull(),
  fechaResolucion: text('fecha_resolucion'),
});

export const auditoria = sqliteTable('auditoria', {
  id: text('id').primaryKey(),
  usuarioId: text('usuario_id').notNull(),
  accion: text('accion').notNull(), // Crear, Editar, Anular, Aprobar
  modulo: text('modulo').notNull(), // Factura, Inventario, Precio, Mantenimiento, Vacunación, etc.
  referenciaId: text('referencia_id'),
  valoresAntes: text('valores_antes'), // JSON
  valoresDespues: text('valores_despues'), // JSON
  motivo: text('motivo'),
  fecha: text('fecha').notNull(),
});

// Base de contabilidad general. No se generan asientos automáticos hasta que
// las políticas contables y el mapeo de cuentas sean aprobados por Contabilidad.
export const cuentasContables = sqliteTable('cuentas_contables', {
  id: text('id').primaryKey(),
  codigo: text('codigo').notNull().unique(),
  nombre: text('nombre').notNull(),
  tipo: text('tipo').notNull(), // Activo | Pasivo | Patrimonio | Ingreso | Costo | Gasto
  naturaleza: text('naturaleza').notNull(), // Deudora | Acreedora
  cuentaPadreId: text('cuenta_padre_id'),
  permiteMovimiento: integer('permite_movimiento').notNull().default(1),
  estado: text('estado').notNull().default('Activa'),
  revisionEstado: text('revision_estado').notNull().default('Pendiente CPA'),
  revisionVigencia: text('revision_vigencia'),
  revisionRevisorNombre: text('revision_revisor_nombre'),
  revisionRevisorCredencial: text('revision_revisor_credencial'),
  revisionEvidencia: text('revision_evidencia'),
  revisionActualizadoEn: text('revision_actualizado_en'),
  revisionActualizadoPor: text('revision_actualizado_por'),
  esEfectivoEquivalente: integer('es_efectivo_equivalente').notNull().default(0),
  clasificacionFlujo: text('clasificacion_flujo'),
  creadoEn: text('creado_en').notNull(),
});

export const cuentasContablesHistorial = sqliteTable('cuentas_contables_historial', {
  id: text('id').primaryKey(),
  cuentaId: text('cuenta_id').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  cambiadoPor: text('cambiado_por'),
  cambiadoEn: text('cambiado_en').notNull(),
});

export const periodosContables = sqliteTable('periodos_contables', {
  id: text('id').primaryKey(),
  fechaInicio: text('fecha_inicio').notNull(),
  fechaFin: text('fecha_fin').notNull(),
  estado: text('estado').notNull().default('Abierto'), // Abierto | Cerrado
  creadoPor: text('creado_por').notNull(),
  creadoEn: text('creado_en').notNull(),
  cerradoPor: text('cerrado_por'),
  cerradoEn: text('cerrado_en'),
});

export const secuenciasContables = sqliteTable('secuencias_contables', {
  id: text('id').primaryKey(),
  ultimo: integer('ultimo').notNull().default(0),
});

export const asientosContables = sqliteTable('asientos_contables', {
  id: text('id').primaryKey(),
  consecutivo: integer('consecutivo').notNull().unique(),
  fecha: text('fecha').notNull(),
  periodoId: text('periodo_id').notNull().references(() => periodosContables.id),
  descripcion: text('descripcion').notNull(),
  referenciaTipo: text('referencia_tipo'),
  referenciaId: text('referencia_id'),
  estado: text('estado').notNull().default('Borrador'), // Borrador | Contabilizado | Reversado
  creadoPor: text('creado_por').notNull(),
  creadoEn: text('creado_en').notNull(),
  contabilizadoPor: text('contabilizado_por'),
  contabilizadoEn: text('contabilizado_en'),
  reversaDeId: text('reversa_de_id'),
  idempotencyKey: text('idempotency_key'),
  idempotencyPayload: text('idempotency_payload'),
});

export const lineasAsientoContable = sqliteTable('lineas_asiento_contable', {
  id: text('id').primaryKey(),
  asientoId: text('asiento_id').notNull().references(() => asientosContables.id),
  cuentaId: text('cuenta_id').notNull().references(() => cuentasContables.id),
  descripcion: text('descripcion').notNull().default(''),
  debito: real('debito').notNull().default(0),
  credito: real('credito').notNull().default(0),
  terceroId: text('tercero_id'),
  granjaId: text('granja_id'),
  galeronId: text('galeron_id'),
  loteId: text('lote_id'),
  productoId: text('producto_id'),
  rutaId: text('ruta_id'),
  vendedorId: text('vendedor_id'),
});

export const politicasContables = sqliteTable('politicas_contables', {
  id: text('id').primaryKey(),
  clave: text('clave').notNull().unique(),
  nombre: text('nombre').notNull(),
  normaReferencia: text('norma_referencia').notNull(),
  pregunta: text('pregunta').notNull(),
  criterio: text('criterio'),
  justificacion: text('justificacion'),
  estado: text('estado').notNull().default('Pendiente'),
  fechaVigencia: text('fecha_vigencia'),
  revisorNombre: text('revisor_nombre'),
  revisorCredencial: text('revisor_credencial'),
  evidenciaAprobacion: text('evidencia_aprobacion'),
  actualizadoPor: text('actualizado_por'),
  actualizadoEn: text('actualizado_en'),
});

export const politicasContablesHistorial = sqliteTable('politicas_contables_historial', {
  id: text('id').primaryKey(),
  clave: text('clave').notNull(),
  estado: text('estado').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  cambiadoPor: text('cambiado_por'),
  cambiadoEn: text('cambiado_en').notNull(),
});

export const notasEstadosFinancieros = sqliteTable('notas_estados_financieros', {
  id: text('id').primaryKey(),
  periodoDesde: text('periodo_desde').notNull(),
  periodoHasta: text('periodo_hasta').notNull(),
  clave: text('clave').notNull(),
  reemplazaNotaId: text('reemplaza_nota_id'),
  titulo: text('titulo').notNull(),
  contenido: text('contenido').notNull(),
  estado: text('estado').notNull().default('Borrador'),
  version: integer('version').notNull().default(1),
  evidenciaReferencia: text('evidencia_referencia'),
  revisorNombre: text('revisor_nombre'),
  revisorCredencial: text('revisor_credencial'),
  creadoPor: text('creado_por').notNull(),
  creadoEn: text('creado_en').notNull(),
  actualizadoPor: text('actualizado_por').notNull(),
  actualizadoEn: text('actualizado_en').notNull(),
});

export const mapeosCuentasContables = sqliteTable('mapeos_cuentas_contables', {
  id: text('id').primaryKey(),
  clave: text('clave').notNull().unique(),
  nombre: text('nombre').notNull(),
  cuentaDebitoId: text('cuenta_debito_id'),
  cuentaCreditoId: text('cuenta_credito_id'),
  dimensionesJson: text('dimensiones_json').notNull().default('[]'),
  tratamientoFiscal: text('tratamiento_fiscal'),
  estado: text('estado').notNull().default('Pendiente'),
  noAplicaJustificacion: text('no_aplica_justificacion'),
  fechaVigencia: text('fecha_vigencia'),
  revisorNombre: text('revisor_nombre'),
  revisorCredencial: text('revisor_credencial'),
  evidenciaAprobacion: text('evidencia_aprobacion'),
  actualizadoPor: text('actualizado_por'),
  actualizadoEn: text('actualizado_en'),
});

export const productosCatalogo = sqliteTable('productos_catalogo', {
  id: text('id').primaryKey(),
  nombre: text('nombre').notNull(),
  descripcion: text('descripcion').notNull().default(''),
    unidad: text('unidad').notNull().default('kg'),
    kgPorCarton: real('kg_por_carton').notNull().default(0),
    precioBase: real('precio_base').notNull().default(0),
  categoria: text('categoria').notNull().default('Huevos'),
  estado: text('estado').notNull().default('Activo'),
  fechaCreacion: text('fecha_creacion').notNull(),
  vidaUtilDias: integer('vida_util_dias').default(28),
  diasAvisoVencimiento: integer('dias_aviso_vencimiento').default(7),
  cabysCodigo: text('cabys_codigo'),
  cabysDescripcion: text('cabys_descripcion'),
  tratamientoFiscal: text('tratamiento_fiscal'),
  tarifaImpuesto: real('tarifa_impuesto'),
  exoneracionReferencia: text('exoneracion_referencia'),
  fiscalVigenteDesde: text('fiscal_vigente_desde'),
  fiscalVigenteHasta: text('fiscal_vigente_hasta'),
  fiscalEstado: text('fiscal_estado').notNull().default('Pendiente'),
  fiscalAprobacionReferencia: text('fiscal_aprobacion_referencia'),
  fiscalRevisorNombre: text('fiscal_revisor_nombre'),
  fiscalRevisorCredencial: text('fiscal_revisor_credencial'),
  fiscalAprobadoEn: text('fiscal_aprobado_en'),
});

export const precioExcepcionesCliente = sqliteTable('precio_excepciones_cliente', {
  id: text('id').primaryKey(),
  clienteId: text('cliente_id').notNull().references(() => clientes.id),
  productoId: text('producto_id').notNull().references(() => productosCatalogo.id),
  precioExcepcion: real('precio_excepcion').notNull(),
  justificacion: text('justificacion').notNull().default(''),
  aprobadoPor: text('aprobado_por').notNull().default(''),
  fechaCreacion: text('fecha_creacion').notNull(),
  fechaInicio: text('fecha_inicio'),
  fechaFin: text('fecha_fin'),
  estado: text('estado').notNull().default('Activa'),
});

// ===== Módulo Office (correo + documentos) =====
// Provider 'local': no requiere OAuth ni credenciales externas. El shape es el
// mismo que usaría el provider 'google' (boceto §7), de modo que cambiar de
// proveedor no obliga a tocar la UI.

export const officeAccounts = sqliteTable('office_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  email: text('email').notNull(),
  etiqueta: text('etiqueta').notNull(),          // Gerencia, Proveedores, Contabilidad, Ventas
  color: text('color').default('#1E40AF'),
  provider: text('provider').notNull().default('local'), // local | google
  scope: text('scope').default(''),
  estado: text('estado').notNull().default('Conectada'), // Conectada | Desconectada | Error
  lastSync: text('last_sync'),
});

export const officeMessages = sqliteTable('office_messages', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => officeAccounts.id),
  threadId: text('thread_id').notNull(),
  remitente: text('remitente').notNull(),
  remitenteEmail: text('remitente_email').notNull(),
  asunto: text('asunto').notNull(),
  preview: text('preview').default(''),
  labelIds: text('label_ids').default(''),
  recibidos: integer('recibidos').notNull().default(0),
  leido: integer('leido').notNull().default(0),
  adjuntoCount: integer('adjunto_count').notNull().default(0),
  fecha: text('fecha').notNull(),
});

export const officeLinks = sqliteTable('office_links', {
  id: text('id').primaryKey(),
  accountId: text('account_id').references(() => officeAccounts.id),
  nombreCuenta: text('nombre_cuenta').notNull().default(''),
  driveFolderId: text('drive_folder_id'),
  carpeta: text('carpeta'),                        // ej. Drive/Finanzas/Proveedores
  criterioTipo: text('criterio_tipo').notNull().default('manual'), // label | from | subject | manual
  criterioValor: text('criterio_valor').default(''),
  automatico: integer('automatico').notNull().default(1),
  estado: text('estado').notNull().default('Activa'),
  creadoPor: text('creado_por').references(() => users.id),
  fechaCreacion: text('fecha_creacion').notNull(),
});

export const officeDriveIndex = sqliteTable('office_drive_index', {
  id: text('id').primaryKey(),
  archivoNombre: text('archivo_nombre').notNull(),
  archivoTipo: text('archivo_tipo').notNull().default('PDF'),
  archivoBytes: integer('archivo_bytes').default(0),
  linkId: text('link_id').references(() => officeLinks.id),
  carpeta: text('carpeta'),
  threadId: text('thread_id'),
  messageId: text('message_id').references(() => officeMessages.id),
  origen: text('origen').notNull().default('manual'), // hilo | manual
  fecha: text('fecha').notNull(),
});
