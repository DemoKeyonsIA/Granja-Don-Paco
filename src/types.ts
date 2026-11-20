/** Camionero queda como alias de lectura para sesiones anteriores; la BD lo migra a Comercial. */
export type Role = 'Admin' | 'Socio' | 'Comercial' | 'Despachador' | 'Bodeguero' | 'Camionero';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  roles?: Role[];
}

export interface Cliente {
  id: string;
  nombre: string;
  tipo_documento?: string;
  documento_id?: string;
  actividad_economica?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  provincia?: string;
  canton?: string;
  distrito?: string;
  latitud?: number;
  longitud?: number;
  ruta: string;
  condicion_pago: 'Contado' | 'Credito';
  precio_especial: number | null;
  limite_credito?: number;
  saldo_pendiente?: number;
  promedio_compra: number;
  estado?: string;
  notas?: string;
  fecha_creacion?: string;
}

export interface InventarioItem {
  id: string;
  producto: 'Aves' | 'Huevos' | 'Alimento' | string;
  cantidad: number;
  unidad: 'kg' | 'unidades' | 'sacos' | string;
  ubicacion: 'Bodega Central' | 'Camión Ruta 1' | 'Camión Ruta 2' | string;
  lote?: string;
  fecha_caducidad?: string;
  ultima_actualizacion: string;
}

export interface MovimientoInventario {
  id: string;
  tipo: 'Entrada' | 'Salida' | 'Traslado';
  producto: string;
  cantidad: number;
  unidad: string;
  origen?: string;
  destino?: string;
  fecha: string;
  usuarioId: string;
  fotoUrl?: string;
}

export interface DetalleFactura {
  producto: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Factura {
  id: string;
  consecutivo: string;
  fecha: string;
  clienteId: string;
  vendedorId: string;
  detalles: DetalleFactura[];
  subtotal: number;
  descuento: number;
  total: number;
  condicion_pago: 'Contado' | 'Credito';
  metodo_pago?: 'Efectivo' | 'SINPE' | 'Transferencia' | 'Tarjeta' | 'Cheque' | 'Plataforma Digital' | 'Otro' | 'Mixto';
  estado: 'Pagada' | 'Pendiente' | 'Anulada';
  pagado?: number;
  saldoPendiente?: number;
  fechaVencimiento?: string | null;
}

export interface ControlRuta {
  id: string;
  vendedorId: string;
  ruta: string;
  fecha: string;
  horaSalida?: string;
  pesoSalida?: number; // Kilos iniciales
  cartonesSalida?: number; // Cartones iniciales
  horaEntrada?: string;
  pesoEntrada?: number; // Kilos sobrantes reportados
  cartonesEntrada?: number; // Cartones sobrantes reportados
  cartonesVendidos?: number; // Calculado de facturas
  kilosVendidos?: number; // Calculado de facturas
  mermaCartones?: number; // cartonesSalida - cartonesVendidos - cartonesEntrada
  mermaKilos?: number;
  estado: 'Pendiente' | 'En Ruta' | 'Finalizado';
}

export interface PesajeAves {
  id: string;
  galeron: string;
  fecha: string;
  edad_semanas: number;
  peso_promedio: number; // gramos
  uniformidad: number; // porcentaje
  peso_estandar?: number;
  observaciones?: string;
}

export interface TareaMantenimiento {
  id: string;
  galeron: string;
  fecha_programada: string;
  tipo: 'Preventivo' | 'Correctivo' | 'Mejora';
  categoria: 'Bebederos' | 'Comederos' | 'Iluminación' | 'Ventilación' | 'Estructura' | 'Otros';
  descripcion: string;
  estado: 'Pendiente' | 'En Progreso' | 'Completado';
  responsableId: string;
}

export interface SolucionLimpieza {
  id: string;
  producto: string;
  inventario_actual: number;
  unidad: 'Litros' | 'Galones' | 'kg' | string;
  dilucion_estandar: string;
  ultimo_uso: string;
}

export interface Ruta {
  id: string;
  nombre: string;
  vendedor_asignado?: string;
  vendedores?: string;
  camion_id?: string;
  cliente_ids?: string;
  dias_frecuencia?: string;
  kilometraje_aprox?: number;
  estado: string;
}

export interface Traslado {
  id: string;
  granjaOrigenId?: string;
  bodegaDestinoId?: string;
  fechaSalida: string;
  fechaLlegada?: string;
  responsableEntrega?: string;
  responsableTransporte?: string;
  estado: string;
  observaciones?: string;
}

export interface Recepcion {
  id: string;
  trasladoId?: string;
  fechaRecepcion: string;
  cantidadEsperada: number;
  cantidadRecibida: number;
  diferencia: number;
  motivoDiferencia?: string;
  tipoDiferencia?: 'desperdicio' | 'alerta' | 'sobrante' | null;
  responsableRecepcion?: string;
  estado: string;
  esPosibleRobo?: boolean;
}

export interface Etiqueta {
  id: string;
  codigoUnico: string;
  producto: string;
  cantidad: number;
  pesoBruto?: number;
  pesoNeto?: number;
  fechaProduccion?: string;
  fechaEmpaque?: string;
  fechaVencimiento?: string;
  granjaOrigen?: string;
  galeronOrigen?: string;
  clasificacion?: string;
  tara?: number;
  estado: string;
  ubicacionActual?: string;
  lote?: string;
  guiaRemisionId?: string;
  pesoBodega?: number;
}

export interface FacturaElectronica {
  id: string;
  facturaId: string;
  tipoDocumento: 'Factura' | 'Tiquete' | 'NotaCredito';
  consecutivo: string;
  clave?: string;
  fechaEmision: string;
  emisorNombre: string;
  emisorCedula: string;
  emisorCorreo?: string;
  receptorNombre?: string;
  receptorCedula?: string;
  receptorCorreo?: string;
  subtotal: number;
  descuento?: number;
  impuestos?: number;
  total: number;
  condicionPago: string;
  medioPago?: string;
  estado: 'Borrador' | 'Pendiente' | 'Enviado' | 'Aceptado' | 'Rechazado' | 'Error';
  xmlGenerado?: string;
  xmlFirmado?: string;
  respuestaHacienda?: string;
  numeroConsecutivo?: string;
  fechaEnvio?: string;
  fechaRespuesta?: string;
  motivoRechazo?: string;
  notasCreditoId?: string;
  ambiente: 'Pruebas' | 'Produccion';
  proveedor?: string;
}

export interface PesoPorPunto {
  id: string;
  referenciaId?: string;
  tipoReferencia: 'Traslado' | 'Recepcion' | 'Carga' | 'Venta' | 'Retorno';
  producto: string;
  cantidadUnidades: number;
  unidad: string;
  pesoEsperado: number;
  pesoReal: number;
  diferencia: number;
  basculaUtilizada?: string;
  responsable: string;
  fecha: string;
  ubicacion: string;
  observaciones?: string;
  estado: string;
}

// ==================== PHASE 4 TYPES ====================

export interface Vacunacion {
  id: string;
  granjaId: string;
  galeronId?: string;
  loteId?: string;
  tipoVacuna: string;
  proveedor?: string;
  dosis?: string;
  metodoAplicacion?: string;
  fechaProgramada: string;
  fechaAplicada?: string;
  responsable: string;
  estado: 'Programada' | 'Aplicada' | 'Vencida' | 'Reprogramada' | 'Cancelada';
  evidencia?: string;
  observaciones?: string;
  reaccionIncidencia?: string;
  proximaFecha?: string;
  fechaCreacion: string;
}

export interface InventarioAlimento {
  id: string;
  tipoAlimento: string;
  proveedor?: string;
  loteAlimento?: string;
  siloUbicacion?: string;
  cantidadRecibida: number;
  cantidadActual: number;
  unidad: string;
  galeronAsociado?: string;
  loteAvesAsociado?: string;
  fechaIngreso: string;
  responsable: string;
  referenciaDocumentoOrigen?: string;
  fechaDocumentoOrigen?: string;
  montoDocumentoOrigen?: number;
  monedaDocumentoOrigen?: string;
  merma: number;
  estado: string;
}

export interface ConsumoAlimento {
  id: string;
  inventarioAlimentoId?: string;
  galeronId?: string;
  loteAvesId?: string;
  cantidadConsumida: number;
  unidad: string;
  fecha: string;
  tipoMovimiento?: string;
  responsable: string;
  observaciones?: string;
}

export interface ActivoMantenimiento {
  id: string;
  nombre: string;
  tipo: string;
  granjaId?: string;
  galeronId?: string;
  ubicacion?: string;
  estado: string;
  fechaUltimoMantenimiento?: string;
  proximoMantenimiento?: string;
  responsable?: string;
}

export interface OrdenMantenimiento {
  id: string;
  activoId: string;
  tipo: string;
  fechaProgramada: string;
  fechaEjecutada?: string;
  responsable: string;
  estado: string;
  insumosUsados?: string;
  costo: number;
  evidencia?: string;
  observaciones?: string;
  proximaFecha?: string;
  checklist?: string;
}

export interface Desperdicio {
  id: string;
  origen: string;
  producto: string;
  etiquetaId?: string;
  lote?: string;
  cantidad: number;
  unidad?: string;
  factorKgPorCarton?: number | null;
  cantidadCartones?: number | null;
  peso?: number;
  motivo: string;
  responsable: string;
  evidencia?: string;
  aprobacion?: string;
  impactoFinanciero: number;
  fecha: string;
  observaciones?: string;
  rutaId?: string;
  guiaId?: string;
  camionId?: string;
  vendedorId?: string;
}

export interface ListaPrecios {
  id: string;
  nombre: string;
  tipo: string;
  rutaAsociada?: string;
  clienteId?: string;
  estado: string;
  fechaInicio: string;
  fechaFin?: string;
  aprobadoPor?: string;
}

export interface PrecioDetalle {
  id: string;
  listaId: string;
  producto: string;
  precioUnitario: number;
  precioMinimo?: number | null;
  precioMaximo?: number | null;
  descuentoMaximo: number;
  unidad: string;
}

export interface HistorialPrecio {
  id: string;
  producto: string;
  precioAnterior?: number;
  precioNuevo: number;
  tipoLista: string;
  listaId?: string;
  cambioPor: string;
  motivo?: string;
  fecha: string;
}

export interface Auditoria {
  id: string;
  usuarioId: string;
  accion: string;
  modulo: string;
  referenciaId?: string;
  valoresAntes?: string;
  valoresDespues?: string;
  motivo?: string;
  fecha: string;
}

// ==================== PHASE 5 TYPES ====================

export interface Aprobacion {
  id: string;
  tipo: string;
  modulo: string;
  referenciaId?: string;
  solicitudUsuario: string;
  descripcion: string;
  datos?: string;
  estado: 'Pendiente' | 'Aprobado' | 'Rechazado';
  aprobadoPor?: string;
  motivoRechazo?: string;
  fechaSolicitud: string;
  fechaResolucion?: string;
}


