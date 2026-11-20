export type VentaRutaParaResumen = {
  id: string;
  estado: string;
  cartones?: number | string | null;
  total?: number | string | null;
  cobro?: string | null;
  pagos?: Array<{ monto?: number | string | null; metodo?: string | null }>;
};

export type RetornoRutaParaResumen = {
  ventaRutaId?: string | null;
  cartones?: number | string | null;
};

const redondearDinero = (monto: number) => Math.round((monto + Number.EPSILON) * 100) / 100;

/** Resume cobros emitidos de ruta, descontando retornos asociados a cada venta. */
export function resumenDineroVentasRuta(ventas: VentaRutaParaResumen[], retornos: RetornoRutaParaResumen[]) {
  const emitidas = ventas.filter((venta) => venta.estado === 'Emitida');
  const devueltosPorVenta = new Map<string, number>();
  for (const retorno of retornos) {
    if (!retorno.ventaRutaId) continue;
    devueltosPorVenta.set(retorno.ventaRutaId,
      (devueltosPorVenta.get(retorno.ventaRutaId) || 0) + Number(retorno.cartones || 0));
  }

  const totalNeto = (venta: VentaRutaParaResumen) => {
    const cantidad = Number(venta.cartones || 0);
    const devueltos = Math.min(cantidad, devueltosPorVenta.get(venta.id) || 0);
    return cantidad > 0 ? Number(venta.total || 0) * (1 - devueltos / cantidad) : 0;
  };

  let efectivo = 0;
  let credito = 0;
  let transferencia = 0;
  for (const venta of emitidas) {
    const neto = totalNeto(venta);
    const pagos = Array.isArray(venta.pagos) ? venta.pagos.filter((pago) => Number(pago.monto) > 0) : [];
    if (pagos.length) {
      const totalRecibido = pagos.reduce((suma, pago) => suma + Number(pago.monto || 0), 0);
      const factorNeto = Number(venta.total) > 0 ? neto / Number(venta.total) : 0;
      for (const pago of pagos) {
        const montoNeto = Number(pago.monto || 0) * factorNeto;
        const metodo = String(pago.metodo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        if (metodo === 'efectivo') efectivo += montoNeto;
        else transferencia += montoNeto;
      }
      credito += Math.max(0, neto - Math.min(neto, totalRecibido * factorNeto));
    } else if (venta.cobro === 'Credito') credito += neto;
    else if (['Transferencia', 'SINPE', 'Tarjeta', 'Cheque', 'Otro'].includes(String(venta.cobro))) transferencia += neto;
    else if (venta.cobro === 'Mixto') credito += neto;
    else efectivo += neto;
  }

  return {
    efectivo: redondearDinero(efectivo),
    credito: redondearDinero(credito),
    transferencia: redondearDinero(transferencia),
    totalGenerado: redondearDinero(efectivo + credito + transferencia),
  };
}
