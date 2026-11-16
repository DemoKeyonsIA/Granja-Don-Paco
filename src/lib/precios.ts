/** Resolución pura de precio comercial. Mantiene la precedencia en un único lugar. */
export interface PrecioResolution {
  precio: number;
  precioMinimo: number;
  precioMaximo: number;
  descuentoMaximo: number;
  listaUsada: string;
}

export interface DatosResolucionPrecio {
  listas: any[];
  detalles: any[];
  clientes: any[];
  excepciones: any[];
  catalogo: any[];
  fecha?: string;
}

function vigente(desde: unknown, hasta: unknown, hoy: string): boolean {
  const inicio = desde ? String(desde).slice(0, 10) : null;
  const fin = hasta ? String(hasta).slice(0, 10) : null;
  return (!inicio || inicio <= hoy) && (!fin || fin >= hoy);
}

function deDetalle(detalle: any, nombreLista: string): PrecioResolution {
  const precio = Number(detalle.precioUnitario);
  const descuentoMaximo = Number(detalle.descuentoMaximo || 0);
  return {
    precio,
    precioMinimo: detalle.precioMinimo == null ? precio * (1 - descuentoMaximo / 100) : Number(detalle.precioMinimo),
    precioMaximo: detalle.precioMaximo == null ? precio : Number(detalle.precioMaximo),
    descuentoMaximo,
    listaUsada: nombreLista,
  };
}

/**
 * Precedencia: excepción aprobada cliente/producto → lista cliente/producto →
 * precio especial legado del cliente → lista ruta → lista global → catálogo.
 */
export function resolverPrecioParaProducto(
  producto: string,
  clienteId: string | undefined,
  ruta: string | undefined,
  datos: DatosResolucionPrecio,
): PrecioResolution | null {
  const hoy = datos.fecha || new Date().toISOString().slice(0, 10);
  const activas = datos.listas.filter(l => l.estado === 'Activa'
    && (!l.fechaInicio || String(l.fechaInicio).slice(0, 10) <= hoy)
    && (!l.fechaFin || String(l.fechaFin).slice(0, 10) >= hoy))
    .sort((a, b) => String(b.fechaInicio || '').localeCompare(String(a.fechaInicio || '')) || String(a.id || '').localeCompare(String(b.id || '')));
  const cliente = clienteId ? datos.clientes.find(c => c.id === clienteId) : undefined;

  if (clienteId) {
    const catalog = datos.catalogo.find(c => c.nombre === producto);
    if (catalog) {
      const excepcion = datos.excepciones.find(e => e.clienteId === clienteId && e.productoId === catalog.id
        && e.estado === 'Activa' && vigente(e.fechaInicio, e.fechaFin, hoy));
      if (excepcion) {
        const precio = Number(excepcion.precioExcepcion);
        return { precio, precioMinimo: precio, precioMaximo: precio, descuentoMaximo: 0, listaUsada: `Excepción: ${excepcion.justificacion || 'Sin justificación'}` };
      }
    }

    const listaCliente = activas.find(l => l.tipo === 'Cliente' && l.clienteId === clienteId);
    const detalleCliente = listaCliente && datos.detalles.find(d => d.listaId === listaCliente.id && d.producto === producto);
    if (detalleCliente) return deDetalle(detalleCliente, listaCliente.nombre);

    if (cliente?.precio_especial != null && Number(cliente.precio_especial) > 0) {
      const precio = Number(cliente.precio_especial);
      return { precio, precioMinimo: precio, precioMaximo: precio, descuentoMaximo: 0, listaUsada: 'Precio Especial Cliente' };
    }
  }

  if (ruta) {
    const listaRuta = activas.find(l => l.tipo === 'Ruta' && l.rutaAsociada === ruta);
    const detalleRuta = listaRuta && datos.detalles.find(d => d.listaId === listaRuta.id && d.producto === producto);
    if (detalleRuta) return deDetalle(detalleRuta, listaRuta.nombre);
  }

  for (const lista of activas.filter(l => l.tipo === 'Global')) {
    const detalle = datos.detalles.find(d => d.listaId === lista.id && d.producto === producto);
    if (detalle) return deDetalle(detalle, lista.nombre);
  }

  const catalog = datos.catalogo.find(c => c.nombre === producto);
  if (!catalog) return null;
  const precio = Number(catalog.precioBase);
  return { precio, precioMinimo: precio, precioMaximo: precio, descuentoMaximo: 0, listaUsada: 'Precio Base Catálogo' };
}
