export type VentaRutaParaResumen = {
  id: string;
  estado: string;
  cartones?: number | string | null;
  total?: number | string | null;
  cobro?: string | null;
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

  const efectivo = emitidas.filter((venta) => venta.cobro === 'Efectivo')
    .reduce((suma, venta) => suma + totalNeto(venta), 0);
  const credito = emitidas.filter((venta) => venta.cobro === 'Credito')
    .reduce((suma, venta) => suma + totalNeto(venta), 0);
  const transferencia = emitidas.filter((venta) => ['Transferencia', 'SINPE'].includes(String(venta.cobro)))
    .reduce((suma, venta) => suma + totalNeto(venta), 0);

  return {
    efectivo: redondearDinero(efectivo),
    credito: redondearDinero(credito),
    transferencia: redondearDinero(transferencia),
    totalGenerado: redondearDinero(efectivo + credito + transferencia),
  };
}
