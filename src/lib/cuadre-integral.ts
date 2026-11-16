/**
 * Fuente única de cálculo del cuadre integral de ruta.
 *
 * Reglas de negocio (Fase 2 — Cuadre integral):
 *  - El cuadre se calcula por guía + producto + unidad base. No se suman
 *    cartones de productos distintos como si fueran intercambiables.
 *  - `cargaConfirmada`: cartones realmente cargados en el camión para la guía.
 *  - `ventaNetaDocumentada`: cantidades que siguen documentadas como vendidas.
 *    Un tiquete totalmente anulado sale de este término; su retorno físico
 *    aceptado entra una sola vez en `retornoAceptado`.
 *  - `mermaRegistrada`: SOLO merma reportada explícitamente (producto, cantidad,
 *    motivo, responsable, guía). Nunca se deriva del residuo.
 *  - `devolucionVinculada`: devoluciones ligadas a una venta (ventaRutaId presente),
 *    separadas del sobrante nunca vendido.
 *  - `retornoAceptado`: cartones aceptados FÍSICAMENTE por Bodega (estado
 *    AceptadoBodega). Un retorno Registrado/PendienteBodega NO repone existencias.
 *  - `saldoBajoCustodiaCamion`: existencia contada que sigue físicamente en el camión.
 *  - `saldoNoExplicado = cargaConfirmada - ventaNetaDocumentada - mermaRegistrada - retornoAceptado - saldoBajoCustodiaCamion`.
 *    Se representa como diferencia pendiente (positiva o negativa) con producto y
 *    cantidad concretos. Nunca se convierte en merma automáticamente.
 */

export type EstadoRetorno = 'Registrado' | 'PendienteBodega' | 'AceptadoBodega' | 'RechazadoBodega' | 'Recibido' | 'Cerrado';

export interface MovimientoProducto {
  producto: string;
  unidad: string;
  cantidad: number;
  /** Peso neto medido, no derivado de una cantidad de empaques. */
  kgAutoritativo?: boolean;
}

export interface VentaEmitidaMov extends MovimientoProducto {
  ventaRutaId?: string;
}

export interface DevolucionMov extends MovimientoProducto {
  ventaRutaId?: string | null;
  estado: EstadoRetorno;
  tipo?: 'parcial' | 'completo' | 'sobrante';
  /** cantidad aceptada por Bodega (si difiere de la registrada, manda esta al aceptar). */
  cantidadAceptada?: number | null;
}

export interface MermaMov extends MovimientoProducto {
  motivo: string;
  responsable: string;
  /** Factor capturado al registrar el movimiento. null significa que no estaba configurado. */
  kgPorCartonSnapshot?: number | null;
}

export interface AjusteInventarioMov extends MovimientoProducto {
  /** Delta firmado aprobado: positivo = excedente, negativo = faltante validado. */
  diferenciaFirmada: number;
}

export interface EntradaCuadre {
  guiaId: string;
  cargadoPorProducto: MovimientoProducto[];
  ventasEmitidas: VentaEmitidaMov[];
  devoluciones: DevolucionMov[];
  mermaRegistrada: MermaMov[];
  ajustesAprobados?: AjusteInventarioMov[];
  /**
   * Sobrante NUNCA vendido que el camión entrega físicamente al cuadrar
   * (inventario contado en el camión que reingresa a Bodega en el mismo acto).
   * Se cuenta como retorno físico aceptado en ese momento. No confundir con
   * un retorno registrado por el vendedor y aún no aceptado (esos van en
   * `devoluciones` con estado PendienteBodega).
   */
  sobranteFisicoCamion?: MovimientoProducto[];
  /** Conversión a cartones únicamente cuando el catálogo declara el factor. */
  factoresKgPorCarton?: Array<{ producto: string; kgPorCarton: number | null | undefined }>;
}

export interface LineaCuadre {
  producto: string;
  unidad: string;
  cargado: number;
  vendidoNeto: number;
  mermaRegistrada: number;
  devolucionVinculadaVenta: number;
  devolucionSobrante: number;
  retornoAceptado: number;
  retornoPendiente: number;
  retornoRechazado: number;
  sobranteFisicoCamion: number;
  saldoBajoCustodiaCamion: number;
  saldoNoExplicado: number;
  ajusteInventarioAprobado: number;
}

export interface DiferenciaPendiente {
  producto: string;
  unidad: string;
  tipo: 'positivo' | 'negativo';
  cantidad: number;
  descripcion: string;
}

export interface CuadreIntegral {
  guiaId: string;
  porProducto: LineaCuadre[];
  totalCargado: number;
  totalVendidoNeto: number;
  totalMermaRegistrada: number;
  totalRetornoAceptado: number;
  totalRetornoPendiente: number;
  totalRetornoRechazado: number;
  totalSobranteFisicoCamion: number;
  totalSaldoBajoCustodiaCamion: number;
  totalDevolucionVinculada: number;
  totalDevolucionSobrante: number;
  totalSaldoNoExplicado: number;
  totalAjusteInventarioAprobado: number;
  /** true si hay saldo no explicado != 0 (diferencia pendiente). */
  tieneDiferencias: boolean;
  /** cantidad total de diferencias pendientes (valor absoluto, suma). */
  totalDiferenciaPendiente: number;
  /** true si hay retornos pendientes de aceptación en Bodega. */
  tieneRetornosPendientes: boolean;
  /** Solo se puede cerrar SIN diferencia cuando el saldo no explicado es 0. */
  puedeCerrarSinDiferencia: boolean;
  diferencias: DiferenciaPendiente[];
  /** Movimientos en kg sin factor de catálogo; requieren resolución antes del cierre. */
  conversionesPendientes: Array<{ producto: string; cantidadKg: number }>;
}

const EPS = 0.0001;
const clave = (producto: string, unidad: string) => `${producto}||${unidad || 'cartones'}`;

function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Calcula el cuadre integral por guía + producto + unidad.
 * Función pura: no toca base de datos. Es la única fuente de verdad para
 * caja (fin de día), tablero de ruta, auditoría y cierre en central.
 */
export function calcularCuadreIntegral(entrada: EntradaCuadre): CuadreIntegral {
  const factores = new Map((entrada.factoresKgPorCarton || []).map(f => [f.producto, Number(f.kgPorCarton)]));
  const conversionesPendientes = new Map<string, number>();
  const normalizar = <T extends MovimientoProducto>(movimientos: T[]): T[] => movimientos.map(m => {
    if (String(m.unidad).trim().toLowerCase() !== 'kg') return m;
    if (m.kgAutoritativo) return m;
    const tieneSnapshot = Object.prototype.hasOwnProperty.call(m, 'kgPorCartonSnapshot');
    const factor = tieneSnapshot ? Number((m as any).kgPorCartonSnapshot) : factores.get(m.producto);
    if (factor && Number.isFinite(factor) && factor > 0) {
      return { ...m, unidad: 'cartones', cantidad: Number(m.cantidad) / factor };
    }
    conversionesPendientes.set(m.producto, (conversionesPendientes.get(m.producto) || 0) + (Number(m.cantidad) || 0));
    return m;
  });
  const carga = normalizar(entrada.cargadoPorProducto);
  const ventasNormalizadas = normalizar(entrada.ventasEmitidas);
  const devolucionesNormalizadas = normalizar(entrada.devoluciones);
  const mermaNormalizada = normalizar(entrada.mermaRegistrada);
  const ajustesNormalizados = normalizar(entrada.ajustesAprobados || []);
  const sobranteNormalizado = normalizar(entrada.sobranteFisicoCamion || []);
  const productos = new Map<string, { producto: string; unidad: string; cargado: number }>();
  for (const c of carga) {
    const cantidad = Number(c.cantidad) || 0;
    if (cantidad === 0) continue;
    const k = clave(c.producto, c.unidad);
    const existente = productos.get(k);
    if (existente) existente.cargado += cantidad;
    else productos.set(k, { producto: c.producto, unidad: c.unidad || 'cartones', cargado: cantidad });
  }

  // Incluir productos que aparezcan en ventas/merma/devoluciones aunque no estén
  // en el detalle de carga (p. ej. extra de ruta o ajustes), para no perderlos.
  const registrarSiFalta = (producto: string, unidad: string) => {
    const k = clave(producto, unidad);
    if (!productos.has(k)) productos.set(k, { producto, unidad: unidad || 'cartones', cargado: 0 });
  };
  ventasNormalizadas.forEach(v => registrarSiFalta(v.producto, v.unidad));
  devolucionesNormalizadas.forEach(d => registrarSiFalta(d.producto, d.unidad));
  mermaNormalizada.forEach(m => registrarSiFalta(m.producto, m.unidad));
  ajustesNormalizados.forEach(m => registrarSiFalta(m.producto, m.unidad));
  sobranteNormalizado.forEach(s => registrarSiFalta(s.producto, s.unidad));

  const porProducto: LineaCuadre[] = [];

  for (const { producto, unidad, cargado } of productos.values()) {
    const enProducto = <T extends MovimientoProducto>(arr: T[]) =>
      arr.filter(m => m.producto === producto && (m.unidad || 'cartones') === unidad);

    const ventas = enProducto(ventasNormalizadas);

    const mermaRegistrada = enProducto(mermaNormalizada).reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
    const ajusteInventarioAprobado = enProducto(ajustesNormalizados).reduce((s, m) => s + (Number(m.diferenciaFirmada) || 0), 0);

    const devs = enProducto(devolucionesNormalizadas);
    // El endpoint conserva el tiquete Emitido si la devolución es parcial y
    // lo anula al devolverse completo. Para ventas aún emitidas, descontamos
    // solo sus retornos parciales; una venta anulada ya no está en `ventas` y
    // su retorno aceptado se cuenta exclusivamente en retornoAceptado.
    const ventasPorId = new Map(ventas.filter(v => v.ventaRutaId).map(v => [v.ventaRutaId!, v]));
    const retornosParcialesPorVenta = new Map<string, number>();
    for (const d of devs) {
      if (d.ventaRutaId && ventasPorId.has(d.ventaRutaId)) {
        retornosParcialesPorVenta.set(d.ventaRutaId, (retornosParcialesPorVenta.get(d.ventaRutaId) || 0) + (Number(d.cantidad) || 0));
      }
    }
    const vendidoNeto = ventas.reduce((s, v) => s + Math.max(0, (Number(v.cantidad) || 0) - (v.ventaRutaId ? (retornosParcialesPorVenta.get(v.ventaRutaId) || 0) : 0)), 0);
    const devolucionVinculadaVenta = devs
      .filter(d => d.ventaRutaId)
      .reduce((s, d) => s + (Number(d.cantidad) || 0), 0);
    const devolucionSobrante = devs
      .filter(d => !d.ventaRutaId)
      .reduce((s, d) => s + (Number(d.cantidad) || 0), 0);

    const retornoAceptado = devs
      .reduce((s, d) => s + (Number(d.cantidadAceptada) || (d.estado === 'AceptadoBodega' ? Number(d.cantidad) || 0 : 0)), 0);
    const retornoPendiente = devs
      .filter(d => ['Registrado', 'PendienteBodega'].includes(d.estado))
      .reduce((s, d) => s + Math.max(0, (Number(d.cantidad) || 0) - (Number(d.cantidadAceptada) || 0)), 0);
    const retornoRechazado = devs
      .filter(d => d.estado === 'RechazadoBodega')
      .reduce((s, d) => s + Math.max(0, (Number(d.cantidad) || 0) - (Number(d.cantidadAceptada) || 0)), 0);

    // Sobrante nunca vendido que el camión entrega físicamente al cuadrar.
    const retornoEnCamionPendiente = devs
      .filter(d => ['Registrado', 'PendienteBodega', 'RechazadoBodega'].includes(d.estado))
      .reduce((s, d) => s + Math.max(0, (Number(d.cantidad) || 0) - (Number(d.cantidadAceptada) || 0)), 0);
    // Las devoluciones pendientes siguen dentro del stock del camión, pero no
    // se consideran sobrante vendible. Las devoluciones aceptadas ya salieron
    // del camión y se contabilizan en `retornoAceptado`.
    const stockCamion = enProducto(sobranteNormalizado)
      .reduce((s, x) => s + (Number(x.cantidad) || 0), 0);
    const saldoBajoCustodiaCamion = stockCamion;
    const sobranteFisicoCamion = Math.max(0, saldoBajoCustodiaCamion - retornoEnCamionPendiente);

    // La existencia contada en el camión está explicada por custodia, pero la
    // condición de cierre la mantiene bloqueada hasta la aceptación de Bodega.
    const explicado = vendidoNeto + mermaRegistrada + retornoAceptado + saldoBajoCustodiaCamion;
    const saldoNoExplicado = redondear(cargado - explicado + ajusteInventarioAprobado);

    porProducto.push({
      producto,
      unidad,
      cargado: redondear(cargado),
      vendidoNeto: redondear(vendidoNeto),
      mermaRegistrada: redondear(mermaRegistrada),
      devolucionVinculadaVenta: redondear(devolucionVinculadaVenta),
      devolucionSobrante: redondear(devolucionSobrante),
      retornoAceptado: redondear(retornoAceptado),
      retornoPendiente: redondear(retornoPendiente),
      retornoRechazado: redondear(retornoRechazado),
      sobranteFisicoCamion: redondear(sobranteFisicoCamion),
      saldoBajoCustodiaCamion: redondear(saldoBajoCustodiaCamion),
      saldoNoExplicado,
      ajusteInventarioAprobado: redondear(ajusteInventarioAprobado),
    });
  }

  const sum = (sel: (l: LineaCuadre) => number) => redondear(porProducto.reduce((s, l) => s + sel(l), 0));

  const diferencias: DiferenciaPendiente[] = porProducto
    .filter(l => Math.abs(l.saldoNoExplicado) > EPS)
    .map(l => ({
      producto: l.producto,
      unidad: l.unidad,
      tipo: l.saldoNoExplicado > 0 ? 'positivo' : 'negativo',
      cantidad: Math.abs(l.saldoNoExplicado),
      descripcion: l.saldoNoExplicado > 0
        ? `Faltan ${Math.abs(l.saldoNoExplicado)} ${l.unidad} de ${l.producto} por explicar (carga − venta neta − merma registrada − retorno aceptado − saldo bajo custodia)`
        : `Sobran ${Math.abs(l.saldoNoExplicado)} ${l.unidad} de ${l.producto} sin origen (excedente no explicado)`,
    }));

  const totalSaldoNoExplicado = sum(l => l.saldoNoExplicado);
  const totalAjusteInventarioAprobado = sum(l => l.ajusteInventarioAprobado);
  const totalRetornoPendiente = sum(l => l.retornoPendiente);
  const totalRetornoRechazado = sum(l => l.retornoRechazado);
  // Los productos NO son intercambiables: hay diferencia si CUALQUIER línea por
  // producto tiene saldo no explicado, aunque los saldos opuestos se anulen al sumar.
  const tieneDiferencias = diferencias.length > 0;

  return {
    guiaId: entrada.guiaId,
    porProducto,
    totalCargado: sum(l => l.cargado),
    totalVendidoNeto: sum(l => l.vendidoNeto),
    totalMermaRegistrada: sum(l => l.mermaRegistrada),
    totalRetornoAceptado: sum(l => l.retornoAceptado),
    totalRetornoPendiente,
    totalRetornoRechazado,
    totalSobranteFisicoCamion: sum(l => l.sobranteFisicoCamion),
    totalSaldoBajoCustodiaCamion: sum(l => l.saldoBajoCustodiaCamion),
    totalDevolucionVinculada: sum(l => l.devolucionVinculadaVenta),
    totalDevolucionSobrante: sum(l => l.devolucionSobrante),
    totalSaldoNoExplicado,
    totalAjusteInventarioAprobado,
    tieneDiferencias,
    totalDiferenciaPendiente: redondear(diferencias.reduce((s, d) => s + d.cantidad, 0)),
    tieneRetornosPendientes: totalRetornoPendiente > EPS,
    puedeCerrarSinDiferencia: !tieneDiferencias && totalRetornoPendiente <= EPS && totalRetornoRechazado <= EPS
      && sum(l => l.saldoBajoCustodiaCamion) <= EPS && conversionesPendientes.size === 0,
    diferencias,
    conversionesPendientes: Array.from(conversionesPendientes, ([producto, cantidadKg]) => ({ producto, cantidadKg: redondear(cantidadKg) })),
  };
}
