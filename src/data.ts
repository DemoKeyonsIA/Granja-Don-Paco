import { User, Cliente, InventarioItem, MovimientoInventario, PesajeAves, TareaMantenimiento, SolucionLimpieza } from './types';

export const mockUsers: User[] = [
  { id: '1', name: 'Administrador', email: 'admin@granja.com', role: 'Admin' },
  { id: '2', name: 'Comercial Central', email: 'facturacion@granja.com', role: 'Comercial' },
  { id: '3', name: 'Comercial Ruta 1', email: 'vendedor@granja.com', role: 'Comercial' },
  { id: '6', name: 'Socio Inversor', email: 'socio@granja.com', role: 'Socio' },
  { id: '7', name: 'Bodeguero Principal', email: 'bodega@granja.com', role: 'Bodeguero' },
  { id: '8', name: 'Encargado de Galerón', email: 'despacho@granja.com', role: 'Despachador' },
];

export const mockClientes: Cliente[] = [
  { id: '1', nombre: 'Pulpería La Central', ruta: 'Ruta 1', condicion_pago: 'Contado', precio_especial: null, promedio_compra: 25 },
  { id: '2', nombre: 'Supermercado El Sol', ruta: 'Ruta 1', condicion_pago: 'Credito', precio_especial: 1450, promedio_compra: 150 },
  { id: '3', nombre: 'Minisuper Los Ángeles', ruta: 'Ruta 2', condicion_pago: 'Contado', precio_especial: null, promedio_compra: 15 },
  { id: '4', nombre: 'Restaurante Buen Sabor', ruta: 'Ruta 2', condicion_pago: 'Credito', precio_especial: 1400, promedio_compra: 50 },
];

export const mockInventario: InventarioItem[] = [
  { id: '1', producto: 'Huevos - Grande', cantidad: 5000, unidad: 'cartones', ubicacion: 'Bodega Central', lote: 'L-20231015', fecha_caducidad: new Date(Date.now() + 86400000*30).toISOString(), ultima_actualizacion: new Date().toISOString() },
  { id: '2', producto: 'Huevos - Mediano', cantidad: 3000, unidad: 'cartones', ubicacion: 'Bodega Central', lote: 'L-20231016', fecha_caducidad: new Date(Date.now() + 86400000*31).toISOString(), ultima_actualizacion: new Date().toISOString() },
  { id: '3', producto: 'Aves (Pollo Entero)', cantidad: 1500, unidad: 'kg', ubicacion: 'Bodega Central', lote: 'P-23', fecha_caducidad: new Date(Date.now() + 86400000*5).toISOString(), ultima_actualizacion: new Date().toISOString() },
  { id: '4', producto: 'Huevos - Grande', cantidad: 300, unidad: 'cartones', ubicacion: 'Camión Ruta 1', lote: 'L-20231015', fecha_caducidad: new Date(Date.now() + 86400000*30).toISOString(), ultima_actualizacion: new Date().toISOString() },
  { id: '5', producto: 'Aves (Pollo Entero)', cantidad: 200, unidad: 'kg', ubicacion: 'Camión Ruta 1', lote: 'P-23', fecha_caducidad: new Date(Date.now() + 86400000*5).toISOString(), ultima_actualizacion: new Date().toISOString() },
];

export const mockMovimientos: MovimientoInventario[] = [
  { id: '1', tipo: 'Traslado', producto: 'Huevos - Grande', cantidad: 300, unidad: 'cartones', origen: 'Bodega Central', destino: 'Camión Ruta 1', fecha: new Date(Date.now() - 3600000).toISOString(), usuarioId: '1' },
  { id: '2', tipo: 'Traslado', producto: 'Aves (Pollo Entero)', cantidad: 200, unidad: 'kg', origen: 'Bodega Central', destino: 'Camión Ruta 1', fecha: new Date(Date.now() - 3600000).toISOString(), usuarioId: '1' }
];

export const rutasDisponibles = ['Camión Ruta 1', 'Camión Ruta 2', 'Camión Ruta 3', 'Mayoristas'];

export const mockControlesRuta: import('./types').ControlRuta[] = [
  {
    id: '1',
    vendedorId: '3', // Vendedor Ruta 1
    ruta: 'Ruta 1',
    fecha: new Date().toISOString().split('T')[0],
    horaSalida: '06:30',
    pesoSalida: 300,
    estado: 'En Ruta'
  },
  {
    id: '2',
    vendedorId: '3',
    ruta: 'Ruta 1',
    fecha: new Date(Date.now() - 86400000).toISOString().split('T')[0],
    horaSalida: '06:15',
    pesoSalida: 320,
    horaEntrada: '14:30',
    pesoEntrada: 15,
    estado: 'Finalizado'
  }
];

export const mockFacturas: import('./types').Factura[] = [
  {
    id: '1',
    consecutivo: 'FAC-0001',
    fecha: new Date(Date.now() - 86400000).toISOString(),
    clienteId: '1',
    vendedorId: '3',
    detalles: [{ producto: 'Aves', cantidad: 25, precio_unitario: 1600, subtotal: 40000 }],
    subtotal: 40000,
    descuento: 0,
    total: 40000,
    condicion_pago: 'Contado',
    metodo_pago: 'Efectivo',
    estado: 'Pagada'
  },
  {
    id: '2',
    consecutivo: 'FAC-0002',
    fecha: new Date(Date.now() - (86400000 * 5)).toISOString(), // 5 days ago
    clienteId: '2',
    vendedorId: '3',
    detalles: [{ producto: 'Aves', cantidad: 150, precio_unitario: 1450, subtotal: 217500 }],
    subtotal: 217500,
    descuento: 0,
    total: 217500,
    condicion_pago: 'Credito',
    estado: 'Pendiente'
  },
  {
    id: '3',
    consecutivo: 'FAC-0003',
    fecha: new Date(Date.now() - (86400000 * 18)).toISOString(), // 18 days ago (past due if limit is 15)
    clienteId: '4',
    vendedorId: '3',
    detalles: [{ producto: 'Huevos', cantidad: 50, precio_unitario: 2000, subtotal: 100000 }],
    subtotal: 100000,
    descuento: 0,
    total: 100000,
    condicion_pago: 'Credito',
    estado: 'Pendiente'
  }
];

export const mockPesajes: PesajeAves[] = [
  { id: '1', galeron: 'Galerón 1', fecha: new Date().toISOString(), edad_semanas: 32, peso_promedio: 1850, uniformidad: 85, peso_estandar: 1800 },
  { id: '2', galeron: 'Galerón 2', fecha: new Date(Date.now() - 86400000*7).toISOString(), edad_semanas: 18, peso_promedio: 1420, uniformidad: 90, peso_estandar: 1450 }
];

export const mockMantenimientos: TareaMantenimiento[] = [
  { id: '1', galeron: 'Galerón 1', fecha_programada: new Date().toISOString(), tipo: 'Preventivo', categoria: 'Bebederos', descripcion: 'Limpieza y purga de tuberías de niple', estado: 'Completado', responsableId: '4' },
  { id: '2', galeron: 'Galerón 2', fecha_programada: new Date(Date.now() + 86400000).toISOString(), tipo: 'Correctivo', categoria: 'Ventilación', descripcion: 'Reparar motor de extractor sur', estado: 'Pendiente', responsableId: '4' }
];

export const mockSoluciones: SolucionLimpieza[] = [
  { id: '1', producto: 'Amonio Cuaternario (5ta Gen)', inventario_actual: 15, unidad: 'Galones', dilucion_estandar: '2 ml / Litro de agua', ultimo_uso: new Date().toISOString() },
  { id: '2', producto: 'Cloro (Hipoclorito al 12%)', inventario_actual: 50, unidad: 'Litros', dilucion_estandar: '3 ml / Litro de agua', ultimo_uso: new Date().toISOString() },
  { id: '3', producto: 'Yodo Agrícola', inventario_actual: 5, unidad: 'Galones', dilucion_estandar: '5 ml / Litro de agua', ultimo_uso: new Date(Date.now() - 86400000*2).toISOString() }
];

