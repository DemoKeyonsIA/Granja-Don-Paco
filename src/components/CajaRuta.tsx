import React, { useState, useEffect, useCallback } from 'react';
import { Truck, PackageOpen, User as UserIcon, Banknote, CreditCard, ArrowLeftRight, RotateCcw, Printer, CheckCircle2, X, AlertTriangle, Minus, Plus, Eye } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { sessionHeaders } from '../lib/session';

interface CajaRutaProps {
  currentUser: User;
  initialGuideId?: string;
  onClose?: () => void;
  initialOpenClosure?: boolean;
}

const fmtCRC = (n: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n || 0);
const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });
const METODOS_PAGO_RUTA = ['Efectivo', 'Transferencia', 'SINPE', 'Tarjeta', 'Cheque', 'Plataforma Digital', 'Otro'];

type SugerenciaVenta = { producto: string; kilos: number; precio: number; pedidosAnalizados: number; precioMinimo: number; precioMaximo: number; metodo: string };

export default function CajaRuta({ currentUser, initialGuideId, onClose, initialOpenClosure = false }: CajaRutaProps) {
  const rolesUsuario = currentUser.roles?.length ? currentUser.roles : [currentUser.role];
  const puedeElegirGuia = rolesUsuario.some((role) => role === 'Admin' || role === 'Despachador');
  const [guias, setGuias] = useState<any[]>([]);
  const [camiones, setCamiones] = useState<any[]>([]);
  const [guiaId, setGuiaId] = useState<string>(initialGuideId || '');
  const [guia, setGuia] = useState<any>(null);
  const [stockCamion, setStockCamion] = useState<any[]>([]);
  const [politicaPrecio, setPoliticaPrecio] = useState<any>(null);
  const [preciosProductos, setPreciosProductos] = useState<Record<string, any>>({});
  const [sugerenciasVenta, setSugerenciasVenta] = useState<Record<string, SugerenciaVenta>>({});
  const [cargandoSugerencia, setCargandoSugerencia] = useState(false);
  const [precioNegociado, setPrecioNegociado] = useState(0);
  const [cargandoPrecio, setCargandoPrecio] = useState(false);
  const [loading, setLoading] = useState(false);

  // POS state
  const [clienteId, setClienteId] = useState<string>('');
  const [producto, setProducto] = useState<string>('');
  const [cantidadTexto, setCantidadTexto] = useState('1');
  const [descuentoTexto, setDescuentoTexto] = useState('0');
  const [pagosVenta, setPagosVenta] = useState<Array<{ metodo: string; monto: string }>>([{ metodo: 'Efectivo', monto: 'total' }]);
  const [tiquete, setTiquete] = useState<any>(null);
  const [previewTiqueteAbierto, setPreviewTiqueteAbierto] = useState(false);
  const [cierreRutaAbierto, setCierreRutaAbierto] = useState(initialOpenClosure);
  const [ventas, setVentas] = useState<any[]>([]);
  const [gastosRuta, setGastosRuta] = useState<any[]>([]);
  const [proformasRuta, setProformasRuta] = useState<any[]>([]);
  const [modoDevolucion, setModoDevolucion] = useState(false);
  const [devSel, setDevSel] = useState<any>(null);
  const [modoMerma, setModoMerma] = useState(false);
  const [etiquetaMerma, setEtiquetaMerma] = useState('');
  const [cantidadMerma, setCantidadMerma] = useState(0.1);
  const [unidadMerma, setUnidadMerma] = useState<'kg'>('kg');
  const [motivoMerma, setMotivoMerma] = useState('Quebrado Camión');
  const [cuadre, setCuadre] = useState<any>(null);
  const [efectivoContado, setEfectivoContado] = useState('');
  const [pasoVenta, setPasoVenta] = useState(1);
  const [tipoDocumentoRuta, setTipoDocumentoRuta] = useState<'Factura' | 'Tiquete' | 'Proforma'>('Factura');
  const [proformaOrigenIdRuta, setProformaOrigenIdRuta] = useState<string | null>(null);

  const fetchBase = useCallback(async () => {
    try {
      const [guiRes, camRes] = await Promise.all([
        fetch('/api/logistica/guias-activas', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/logistica/camiones', { headers: sessionHeaders(currentUser.id) })
      ]);
      const g = guiRes.ok ? await guiRes.json() : [];
      const c = camRes.ok ? await camRes.json() : [];
      setGuias(g);
      setCamiones(c);

      // El vendedor usa la guía que corresponde a su camión asignado. Solo
      // Administración y Despacho pueden cambiar la guía desde esta pantalla.
      if (initialGuideId && g.some((gg: any) => gg.id === initialGuideId)) {
        setGuiaId(initialGuideId);
      } else if (g.length > 0) {
        const camionesAsignados = c.filter((cam: any) => cam.camioneroId === currentUser.id || cam.camionero_id === currentUser.id || cam.vendedor_id === currentUser.id);
        const guiasVisibles = puedeElegirGuia ? g : g.filter((gg: any) => camionesAsignados.some((cam: any) => cam.id === gg.camionId));
        const prioridadEstado: Record<string, number> = { EnRuta: 0, Cargada: 1, Preparada: 2 };
        const elegida = guiasVisibles.slice().sort((a: any, b: any) => (prioridadEstado[a.estado] ?? 3) - (prioridadEstado[b.estado] ?? 3))[0];
        if (elegida) setGuiaId(elegida.id);
      }
    } catch { toast.error('Error al cargar datos de la caja.'); }
  }, [currentUser.id, initialGuideId, puedeElegirGuia]);

  const loadGuia = useCallback(async (id: string) => {
    if (!id) { setGuia(null); return; }
    try {
      const [detRes, invRes] = await Promise.all([
        fetch(`/api/logistica/guias/${id}`, { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/inventario', { headers: sessionHeaders(currentUser.id) })
      ]);
      if (detRes.ok) {
        const det = await detRes.json();
        setGuia(det);
        setVentas((det.ventas || []).slice().sort((a: any, b: any) => String(a.tiqueteConsecutivo).localeCompare(String(b.tiqueteConsecutivo))));
        setStockCamion((await invRes.json()).filter((i: any) => i.ubicacion === det.camionNombre));
        const gastosRes = await fetch(`/api/gastos/guia/${id}`, { headers: sessionHeaders(currentUser.id) }).catch(() => null);
        setGastosRuta(gastosRes?.ok ? await gastosRes.json() : []);
        const proformasRes = await fetch('/api/proformas', { headers: sessionHeaders(currentUser.id) }).catch(() => null);
        const proformasData = proformasRes?.ok ? await proformasRes.json() : [];
        setProformasRuta(Array.isArray(proformasData) ? proformasData.filter((proforma: any) => proforma.guiaId === id) : []);
      }
    } catch { toast.error('Error al cargar la guía.'); }
  }, [currentUser.id]);

  useEffect(() => { fetchBase(); }, [fetchBase]);
  useEffect(() => { loadGuia(guiaId); }, [guiaId, loadGuia]);
  useEffect(() => {
    if (!clienteId) {
      setPreciosProductos({});
      setPoliticaPrecio(null);
      setPrecioNegociado(0);
      setCargandoPrecio(false);
      return;
    }
    const controller = new AbortController();
    const productos = Array.from(new Set(stockCamion.filter((item: any) => Number(item.cantidad) > 0).map((item: any) => String(item.producto))));
    if (productos.length === 0) {
      setPreciosProductos({});
      setCargandoPrecio(false);
      return;
    }
    setCargandoPrecio(true);
    setPreciosProductos({});
    fetch('/api/precios/lookup-multiple', {
      method: 'POST',
      signal: controller.signal,
      headers: sessionHeaders(currentUser.id, true),
      body: JSON.stringify({ productos, clienteId }),
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No fue posible consultar los precios');
        setPreciosProductos(data || {});
      })
      .catch(error => { if (error.name !== 'AbortError') setPreciosProductos(Object.fromEntries(productos.map(nombre => [nombre, { error: error.message }]))); })
      .finally(() => { if (!controller.signal.aborted) setCargandoPrecio(false); });
    return () => controller.abort();
  }, [clienteId, currentUser.id, stockCamion]);

  useEffect(() => {
    if (!clienteId) { setSugerenciasVenta({}); setCargandoSugerencia(false); return; }
    const productos = Array.from(new Set(stockCamion.filter((item: any) => Number(item.cantidad) > 0).map((item: any) => String(item.producto))));
    if (productos.length === 0) { setSugerenciasVenta({}); return; }
    const controller = new AbortController();
    setSugerenciasVenta({});
    setCargandoSugerencia(true);
    fetch('/api/precios/recomendacion-ruta', {
      method: 'POST', signal: controller.signal,
      headers: sessionHeaders(currentUser.id, true),
      body: JSON.stringify({ clienteId, productos }),
    }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No fue posible preparar la sugerencia');
      const mapa: Record<string, SugerenciaVenta> = {};
      for (const item of data.recomendaciones || []) mapa[item.producto] = item;
      setSugerenciasVenta(mapa);
    }).catch(error => { if (error.name !== 'AbortError') setSugerenciasVenta({}); })
      .finally(() => { if (!controller.signal.aborted) setCargandoSugerencia(false); });
    return () => controller.abort();
  }, [clienteId, currentUser.id, stockCamion]);

  useEffect(() => {
    if (!clienteId || !producto) {
      setPoliticaPrecio(null);
      setPrecioNegociado(0);
      return;
    }
    const precio = preciosProductos[producto];
    if (!precio) return;
    setPoliticaPrecio(precio);
    setPrecioNegociado(Number(precio.precio) || 0);
  }, [clienteId, producto, preciosProductos]);
  useEffect(() => {
    if (!tiquete) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTiquete(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tiquete]);

  const imprimirTiquete = () => {
    const limpiar = () => document.body.classList.remove('print-route-ticket-only');
    window.addEventListener('afterprint', limpiar, { once: true });
    document.body.classList.add('print-route-ticket-only');
    window.print();
  };

  const productosDisponibles = stockCamion.filter((i: any) => Number(i.cantidad) > 0);
  const stockOrigen = Number(stockCamion.find((i: any) => i.producto === producto)?.cantidad || 0);
  const productoActivo = productosDisponibles.find((i: any) => i.producto === producto);
  // Comercial vende por kg y el saldo de ruta debe estar expresado en kg.
  // No inferimos conversión desde el registro de inventario: el pesaje es la fuente.
  const factorProducto = productoActivo?.unidad === 'kg' ? 1 : null;
  const stockProducto = factorProducto ? stockOrigen : 0;
  const cantidad = Number(cantidadTexto) || 0;
  const descuento = Number(descuentoTexto) || 0;
  const precioVenta = Number(precioNegociado || politicaPrecio?.precio) || 0;
  const precioAutorizado = Number(politicaPrecio?.precio) > 0 && !politicaPrecio?.error;
  const sugerenciaProducto = producto ? sugerenciasVenta[producto] : undefined;
  const cantidadTiquete = Number(tiquete?.cantidadKg ?? tiquete?.cartones ?? 0);
  const precioUnitarioTiquete = Number(tiquete?.precioUnitario || (Number(tiquete?.subtotal ?? tiquete?.total ?? 0) / (cantidadTiquete || 1)));
  const subtotal = Number(cantidad) * precioVenta;
  const total = Math.max(0, subtotal - descuento);
  const precioMinimo = Number(politicaPrecio?.precioMinimo ?? politicaPrecio?.precio ?? 0);
  const precioMaximo = Number(politicaPrecio?.precioMaximo ?? politicaPrecio?.precio ?? 0);
  const precioFueraDeRango = precioAutorizado && (precioVenta < precioMinimo || precioVenta > precioMaximo);
  const descuentoPorPiso = Math.max(0, subtotal - Number(cantidad) * precioMinimo);
  const descuentoPorcentaje = Math.max(0, subtotal * Math.max(0, Number(politicaPrecio?.descuentoMaximo || 0)) / 100);
  const descuentoPermitido = precioFueraDeRango ? 0 : Math.min(descuentoPorPiso, descuentoPorcentaje);

  const etiquetasDisponibles = (guia?.detalle || []).filter((e: any) => e.estadoEtiqueta === 'Cargada');
  const unidadRuta = 'kg';

  const resetPos = () => {
    setClienteId(''); setProducto(''); setCantidadTexto('1'); setDescuentoTexto('0'); setPagosVenta([{ metodo: 'Efectivo', monto: 'total' }]); setTipoDocumentoRuta('Factura'); setProformaOrigenIdRuta(null);
  };

  const vender = async () => {
    if (!guiaId) return toast.error('Seleccione una guía activa');
    if (!producto) return toast.error('Seleccione un producto');
    if (!clienteId) return toast.error('Seleccione un cliente');
    if (!precioAutorizado || precioVenta < precioMinimo || precioVenta > precioMaximo) return toast.error(`El precio debe estar entre ${fmtCRC(precioMinimo)} y ${fmtCRC(precioMaximo)} por kg.`);
    if (!cantidad || cantidad <= 0) return toast.error('Indique una cantidad');
    if (cantidad > stockProducto) return toast.error(`Solo quedan ${stockProducto.toFixed(2)} kg de ${producto} en el camión.`);
    const mediosPago = pagosVenta.map((pago) => ({ metodo: pago.metodo, monto: pago.monto === 'total' ? total : roundMoney(Number(pago.monto)) })).filter((pago) => pago.monto > 0);
    const montoRecibido = roundMoney(mediosPago.reduce((suma, pago) => suma + pago.monto, 0));
    const saldoCredito = Math.max(0, roundMoney(total - montoRecibido));
    if (tipoDocumentoRuta !== 'Proforma' && montoRecibido > roundMoney(total)) return toast.error('Los montos recibidos no pueden superar el total de la venta.');
    if (tipoDocumentoRuta !== 'Proforma' && saldoCredito > 0 && (!creditoDisponible || saldoCredito > Math.max(0, limiteCreditoCliente - saldoPendienteCliente))) return toast.error(mensajeCreditoNoDisponible);
    setLoading(true);
    try {
      if (tipoDocumentoRuta === 'Proforma') {
        const res = await fetch('/api/proformas', {
          method: 'POST', headers: sessionHeaders(currentUser.id, true),
          body: JSON.stringify({ clienteId, guiaId, detalles: [{ producto, cantidad, precio_unitario: precioVenta, subtotal: cantidad * precioVenta }], descuento }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar la proforma.');
        toast.success(`${data.consecutivo} guardada como proforma; no se registró venta ni se descontó inventario.`);
        resetPos(); setPasoVenta(1); await loadGuia(guiaId);
      } else {
      const res = await fetch('/api/logistica/caja/venta', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({
          guiaId, clienteId, tipoDocumento: tipoDocumentoRuta,
          producto, cantidadKg: cantidad, unidad: 'kg', precioUnitario: precioVenta, descuento: descuento || undefined, pagos: mediosPago,
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (proformaOrigenIdRuta && data.facturaId) {
          const conversion = await fetch(`/api/proformas/${proformaOrigenIdRuta}/convertir`, { method: 'POST', headers: sessionHeaders(currentUser.id, true), body: JSON.stringify({ facturaId: data.facturaId }) });
          if (!conversion.ok) toast.error('La venta quedó registrada, pero la proforma no se pudo marcar como convertida.');
          setProformaOrigenIdRuta(null);
        }
        setTiquete(data);
        setVentas(prev => [...prev, { ...data, estado: 'Emitida' }].sort((a: any, b: any) => String(a.tiqueteConsecutivo).localeCompare(String(b.tiqueteConsecutivo))));
        toast.success(`Venta registrada · ${tipoDocumentoRuta === 'Factura' ? 'factura electrónica' : 'tiquete electrónico'} ${data.documentoFiscalConsecutivo || ''} en Documentos`);
        resetPos();
        setPasoVenta(1);
        await loadGuia(guiaId);
      } else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
      }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const confirmarInicioRuta = async () => {
    if (!guiaId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logistica/guias/${guiaId}/marcar-en-ruta`, {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ confirmarRecepcion: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo confirmar la carga.');
      await loadGuia(guiaId);
      toast.success('Carga recibida. La ruta quedó iniciada.');
    } catch (error: any) { toast.error(error.message); }
    setLoading(false);
  };

  const devolver = async (etiquetaIdSel?: string, ventaRutaId?: string) => {
    if (!guiaId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/logistica/caja/devolucion', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ guiaId, etiquetaId: etiquetaIdSel || undefined, ventaRutaId: ventaRutaId || undefined, responsable: currentUser.name })
      });
      if (res.ok) {
        const d = await res.json();
        const cantidadDevuelta = Number(d.cantidadKg ?? d.cartones ?? 0);
        toast.success(cantidadDevuelta > 0
          ? `Devolución registrada: ${cantidadDevuelta} kg. Bodega debe confirmar la recepción para aplicar el ajuste a la factura${d.tiquetePendienteAceptacion ? ` ${d.tiquetePendienteAceptacion}` : ''}.`
          : 'Devolución registrada');
        // El tiquete y su crédito solo se revierten cuando Bodega acepta físicamente el retorno.
        await loadGuia(guiaId);
      } else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const reportarMerma = async () => {
    if (!guiaId || !etiquetaMerma || cantidadMerma <= 0) return toast.error('Seleccione la etiqueta e indique cuánto se dañó.');
    setLoading(true);
    try {
      const factor = factorProducto || 0;
      if (!factor) throw new Error('Este producto no tiene peso configurado en el catálogo. Avise al administrador.');
      const cantidadOrigenMerma = cantidadMerma / factor;
      const res = await fetch('/api/logistica/merma', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ guiaId, etiquetaId: etiquetaMerma, cantidad: cantidadMerma, unidad: 'kg', motivo: motivoMerma, responsable: currentUser.name || currentUser.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar la merma.');
      toast.success(`Merma registrada: ${cantidadMerma} kg`);
      setModoMerma(false); setCantidadMerma(1); setUnidadMerma('kg');
      await loadGuia(guiaId);
    } catch (error: any) { toast.error(error.message); }
    setLoading(false);
  };

  const finDia = async () => {
    if (!guiaId) return toast.error('Seleccione una guía activa');
    const contado = Number(efectivoContado);
    if (efectivoContado.trim() === '' || !Number.isFinite(contado) || contado < 0) {
      return toast.error('Escriba cuánto efectivo contó antes de cerrar la caja.');
    }
    const ok = window.confirm('¿Terminar el día? No podrá emitir más tiquetes de ruta hasta el cuadre en central. Esta acción es irreversible.');
    if (!ok) return;
    setLoading(true);
    try {
      const res = await fetch('/api/logistica/caja/fin-dia', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ guiaId, responsable: currentUser.name, efectivoContado: contado })
      });
      if (res.ok) { const d = await res.json(); setCuadre(d.cuadre); toast.success('Día cerrado: ventas bloqueadas hasta cuadre en central'); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const cajaCerrada = Boolean(guia?.finDiaFecha);
  const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
  const vendidoKg = emitidas.reduce((s: number, v: any) => s + Number(v.cantidadKg ?? 0), 0);
  const inventarioKgCamion = productosDisponibles
    .filter((i: any) => i.unidad === 'kg')
    .reduce((s: number, i: any) => s + Number(i.cantidad || 0), 0);
  const clientesRuta = (guia?.rutaOrden || []).length > 0 ? guia.rutaOrden : (guia?.clientesRuta || []);
  const clienteSeleccionado = clientesRuta.find((c: any) => c.clienteId === clienteId);
  const limiteCreditoCliente = Number(clienteSeleccionado?.limiteCredito ?? clienteSeleccionado?.limite_credito ?? 0);
  const saldoPendienteCliente = Number(clienteSeleccionado?.saldoPendiente ?? clienteSeleccionado?.saldo_pendiente ?? 0);
  const condicionCreditoCliente = String(clienteSeleccionado?.condicionPago ?? clienteSeleccionado?.condicion_pago ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('credito');
  const montoCreditoDisponible = Math.max(0, limiteCreditoCliente - saldoPendienteCliente);
  const creditoDisponible = condicionCreditoCliente && montoCreditoDisponible > 0;
  const mensajeCreditoNoDisponible = !condicionCreditoCliente ? 'Este cliente no tiene crédito autorizado. El administrador debe aprobar su condición de crédito.' : montoCreditoDisponible <= 0 ? 'El cliente ya alcanzó el límite de crédito autorizado.' : `El saldo supera el crédito disponible de ${fmtCRC(montoCreditoDisponible)}.`;
  const mediosPagoActuales = pagosVenta.map((pago) => ({ metodo: pago.metodo, monto: pago.monto === 'total' ? total : roundMoney(Math.max(0, Number(pago.monto) || 0)) })).filter((pago) => pago.monto > 0);
  const recibidoActual = roundMoney(mediosPagoActuales.reduce((suma, pago) => suma + pago.monto, 0));
  const saldoCreditoActual = Math.max(0, roundMoney(total - recibidoActual));
  const errorPago = recibidoActual > roundMoney(total) ? 'Los montos recibidos superan el total.' : saldoCreditoActual > 0 && (!creditoDisponible || saldoCreditoActual > montoCreditoDisponible) ? mensajeCreditoNoDisponible : '';
  const maximoPagoPorLinea = (index: number) => roundMoney(Math.max(0, total - pagosVenta.reduce((suma, pago, i) => i === index ? suma : suma + (pago.monto === 'total' ? total : Math.max(0, Number(pago.monto) || 0)), 0)));
  const cambiarMontoPago = (index: number, valor: string) => {
    const limpio = valor.replace(/[^\d.,]/g, '').replace(',', '.');
    const [entero = '', ...decimales] = limpio.split('.');
    const enteroSinCeros = entero.replace(/^0+(?=\d)/, '');
    const normalizado = decimales.length ? `${enteroSinCeros || '0'}.${decimales.join('').slice(0, 2)}` : enteroSinCeros;
    const maximo = maximoPagoPorLinea(index);
    const monto = normalizado === '' || normalizado.endsWith('.') ? null : Number(normalizado);
    const montoFinal = monto !== null && Number.isFinite(monto) && monto > maximo ? maximo.toFixed(2).replace(/\.00$/, '') : normalizado;
    setPagosVenta((prev) => prev.map((item, i) => i === index ? { ...item, monto: montoFinal } : item));
  };
  const camionSeleccionado = camiones.find((cam: any) => cam.id === guia?.camionId);
  const guiaListado = guias.find((g: any) => g.id === guia?.id);
  const nombreRutaAsignada = guiaListado?.rutaNombre || camionSeleccionado?.ruta_defecto || guia?.rutaNombre || 'Ruta asignada';
  const estadoRutaLabel = guia?.estado === 'EnRuta' ? 'En ruta' : guia?.estado === 'Cargada' ? 'Lista para iniciar' : guia?.estadoLogico || guia?.estado;
  const ventaDeshabilitada = loading || guia?.estado !== 'EnRuta' || cajaCerrada || cargandoPrecio || !clienteId || !producto || !politicaPrecio?.precio || Boolean(politicaPrecio?.error) || precioVenta < precioMinimo || precioVenta > precioMaximo || cantidad <= 0 || cantidad > stockProducto || descuento < 0 || descuento > descuentoPermitido || (tipoDocumentoRuta !== 'Proforma' && Boolean(errorPago));
  const previsualizarTiquete = (muestraGeneral = false) => {
    if (!muestraGeneral && (!clienteId || !producto || !Number.isFinite(cantidad) || cantidad <= 0)) return toast.error('Seleccione cliente, producto y kilos para ver la muestra.');
    const cantidadMuestra = muestraGeneral ? 10 : cantidad;
    const precioMuestra = muestraGeneral ? 1300 : precioVenta;
    const subtotalMuestra = cantidadMuestra * precioMuestra;
    const descuentoMuestra = muestraGeneral ? 0 : descuento;
    setTiquete({
      demo: true,
      tiqueteConsecutivo: 'MUESTRA',
      fechaHora: new Date().toISOString(),
      cliente: { nombre: muestraGeneral ? 'Cliente de muestra' : clienteSeleccionado?.nombre || clienteSeleccionado?.clienteNombre || 'Cliente seleccionado' },
      camionNombre: guia?.camionNombre || (muestraGeneral ? 'Camión de muestra' : ''),
      guiaConsecutivo: guia?.consecutivo || (muestraGeneral ? 'MUESTRA' : ''),
      vendedorNombre: currentUser.name,
      producto: muestraGeneral ? 'Huevo' : producto,
      cantidadKg: cantidadMuestra,
      precioUnitario: precioMuestra,
      subtotal: subtotalMuestra,
      descuento: descuentoMuestra,
      cobro: muestraGeneral ? 'Efectivo' : (saldoCreditoActual > 0 ? (recibidoActual > 0 ? 'Mixto' : 'Credito') : (mediosPagoActuales.length > 1 ? 'Mixto' : mediosPagoActuales[0]?.metodo || 'Efectivo')),
      mediosPago: muestraGeneral ? [{ metodo: 'Efectivo', monto: subtotalMuestra - descuentoMuestra }] : mediosPagoActuales,
      saldoCredito: muestraGeneral ? 0 : saldoCreditoActual,
      total: subtotalMuestra - descuentoMuestra,
    });
    setPreviewTiqueteAbierto(true);
  };

  return (
    <div className={`route-pos-root space-y-4 pb-4${guia && !cajaCerrada && clienteId && producto ? ' route-pos-has-action' : ''}`}>
      {/* Cabecera: guía activa */}
      <div className="min-w-0 rounded-2xl p-4 sm:p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        <div className="flex items-start justify-end gap-3">
          {onClose && <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }} aria-label="Cerrar registro de venta"><X className="h-5 w-5" /></button>}
        </div>
        {guia && <div className="flex flex-col gap-2 sm:flex-row">
        </div>}
        <div className="route-pos-header-layout">
          <div className="route-pos-assignment">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {puedeElegirGuia ? 'Ruta de trabajo' : 'Ruta asignada'}
              </p>
              <div className="route-pos-title-row">
                <p className="mt-1 min-w-0 truncate text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>
                  {guia ? nombreRutaAsignada : 'Cargando ruta asignada…'}
                </p>
                {guia && <span className="route-pos-status">{estadoRutaLabel}</span>}
              </div>
              <p className="mt-1 break-words text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {guia ? `${guia.consecutivo} · ${guia.camionNombre}` : 'El administrador debe asignar un camión y una guía activa.'}
              </p>
            </div>
            {guia && puedeElegirGuia && !initialGuideId && (
              <label className="mt-3 block min-w-0 text-xs font-bold" htmlFor="guia-activa" style={{ color: 'var(--text-secondary)' }}>
                Cambiar guía
                <select
                  id="guia-activa"
                  value={guiaId}
                  onChange={(e) => setGuiaId(e.target.value)}
                  className="mt-1 min-h-11 w-full min-w-0 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none"
                  style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                >
                  {guias.map((g: any) => <option key={g.id} value={g.id}>{g.consecutivo} · {g.camionNombre} ({g.estado})</option>)}
                </select>
              </label>
            )}
          </div>
          {guia && (
            <div className="route-pos-metrics">
              <div className="route-pos-metric rounded-xl p-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Cargado</p>
                <p className="mt-1 text-lg font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{Number(guia.totalKg ?? guia.totalCartones).toFixed(2)} {guia.totalKg != null ? 'kg' : 'ct'}</p>
                {Number(guia.colchonKg ?? guia.colchonCartones) > 0 && <p className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Extra: {Number(guia.colchonKg ?? guia.colchonCartones).toFixed(2)} kg</p>}
              </div>
              <div className="route-pos-metric rounded-xl p-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Vendido</p>
                <p className="mt-1 text-lg font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{vendidoKg.toFixed(2)} kg</p>
              </div>
              <div className="route-pos-metric rounded-xl p-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Disponible</p>
                <p className="mt-1 text-lg font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{inventarioKgCamion.toFixed(2)} kg</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {!!proformasRuta.length && <section className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        <div className="mb-3"><h3 className="font-extrabold" style={{ color: 'var(--text-primary)' }}>Proformas de esta ruta</h3><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Cotizaciones no fiscales; no han descontado kilos del camión.</p></div>
        <div className="space-y-2">{proformasRuta.map((proforma: any) => <div key={proforma.id} className="flex flex-col gap-2 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: 'var(--bg-muted)' }}><div><b style={{ color: 'var(--text-primary)' }}>{proforma.consecutivo}</b><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{proforma.detalles?.[0]?.producto} · {Number(proforma.detalles?.[0]?.cantidad || 0).toFixed(2)} kg · {fmtCRC(Number(proforma.total))}</p></div>{proforma.estado === 'Vigente' && <button type="button" onClick={() => { const linea = proforma.detalles?.[0]; if (!linea) return; setProformaOrigenIdRuta(proforma.id); setClienteId(proforma.clienteId || ''); setProducto(linea.producto); setCantidadTexto(String(linea.cantidad)); setDescuentoTexto(String(proforma.descuento || 0)); setTipoDocumentoRuta('Factura'); setPagosVenta([{ metodo: 'Efectivo', monto: 'total' }]); setPasoVenta(3); toast.info('Revise el precio autorizado y la cantidad antes de registrar la venta.'); }} className="min-h-10 rounded-lg px-3 text-xs font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>Preparar venta</button>}</div>)}</div>
      </section>}

      {cajaCerrada && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
          <X className="w-5 h-5 shrink-0" />
          <div className="text-sm font-semibold">
            <p>Caja cerrada ({fmtHora(guia.finDiaFecha)}). No se pueden emitir más tiquetes de ruta hasta el cuadre en central.</p>
            {guia.cierreCaja && <p className="mt-1">Conteo: {guia.cierreCaja.efectivoContado == null ? 'pendiente' : fmtCRC(Number(guia.cierreCaja.efectivoContado))} · diferencia: {guia.cierreCaja.diferencia == null ? 'pendiente de conteo' : fmtCRC(Number(guia.cierreCaja.diferencia))} · {guia.cierreCaja.estado}</p>}
          </div>
        </div>
      )}

      {/* Tiquete emitido */}
      {tiquete && (
        <>
        <div role="status" aria-live="polite" className="rounded-2xl p-4 flex items-start justify-between gap-4 no-print" style={{ background: 'var(--bg-card)', border: '1px solid var(--status-success)' }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{tiquete.demo ? 'Muestra · no registra una venta' : 'Venta registrada · documento en Documentos'}</p>
            <p className="text-2xl font-extrabold" style={{ color: 'var(--brand-primary)' }}>{tiquete.demo ? 'VISTA PREVIA' : tiquete.tiqueteConsecutivo}</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{tiquete.producto} × {Number(tiquete.cantidadKg ?? tiquete.cartones).toFixed(2)} kg — {fmtCRC(tiquete.total)}</p>
            {!tiquete.demo && <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{tiquete.tipoDocumento === 'Tiquete' ? 'Tiquete electrónico' : 'Factura electrónica'} {tiquete.documentoFiscalConsecutivo} · simulación sin envío a Hacienda</p>}
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtHora(tiquete.fechaHora)} · {tiquete.cobro}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPreviewTiqueteAbierto(true)} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} aria-label="Ver tiquete">
              <Eye className="w-4 h-4" />
            </button>
            <button onClick={imprimirTiquete} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} aria-label="Imprimir tiquete">
              <Printer className="w-4 h-4" />
            </button>
            <button onClick={() => { setTiquete(null); setPreviewTiqueteAbierto(false); }} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} aria-label="Cerrar tiquete">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <section className={`route-ticket-print-overlay${previewTiqueteAbierto ? ' route-ticket-preview-screen' : ''}`} aria-label="Tiquete de ruta para impresión">
          {previewTiqueteAbierto && <button type="button" className="route-ticket-preview-close no-print" onClick={() => setPreviewTiqueteAbierto(false)} aria-label="Cerrar vista previa"><X className="h-5 w-5" /></button>}
          <article className="route-ticket-paper">
            <header className="route-ticket-header"><img src="/granja-don-paco-logo.png" alt="Granja Don Paco" /><div><span>GRANJA DON PACO</span><strong>TIQUETE DE RUTA</strong><small>Control de venta y entrega</small></div><div className="route-ticket-number"><small>{tiquete.demo ? 'MUESTRA' : 'N.º'}</small><strong>{tiquete.demo ? 'VISTA PREVIA' : tiquete.tiqueteConsecutivo}</strong></div></header>
            <p className="route-ticket-demo">{tiquete.demo ? 'VISTA PREVIA · NO REGISTRA UNA VENTA NI ES UN COMPROBANTE FISCAL' : 'COMPROBANTE INTERNO DE RUTA · NO SUSTITUYE EL TIQUETE ELECTRÓNICO DE HACIENDA'}</p>
            <div className="route-ticket-meta"><span><b>FECHA Y HORA</b>{fmtFechaHora(tiquete.fechaHora)}</span><span><b>CONDICIÓN</b>{Number(tiquete.saldoCredito || 0) > 0 ? 'Crédito con abono' : 'Contado'}</span><span><b>RECIBIDO</b>{(tiquete.mediosPago || []).map((p: any) => `${p.metodo}: ${fmtCRC(Number(p.monto))}`).join(' · ') || 'Pendiente de pago'}</span></div>
            <section className="route-ticket-customer"><h3>CLIENTE</h3><strong>{tiquete.cliente?.nombre || 'Cliente'}</strong><div>{tiquete.cliente?.documentoId ? `Cédula: ${tiquete.cliente.documentoId}` : ''}{tiquete.cliente?.telefono ? ` · Tel.: ${tiquete.cliente.telefono}` : ''}</div><div>{[tiquete.cliente?.direccion, tiquete.cliente?.distrito, tiquete.cliente?.canton, tiquete.cliente?.provincia].filter(Boolean).join(', ')}</div></section>
            <div className="route-ticket-meta"><span><b>VENDEDOR</b>{tiquete.vendedorNombre || currentUser.name}</span><span><b>CAMIÓN</b>{tiquete.camionNombre || guia?.camionNombre || '—'}{tiquete.placa ? ` · ${tiquete.placa}` : ''}</span><span><b>GUÍA</b>{tiquete.guiaConsecutivo || guia?.consecutivo || '—'}</span></div>
            <table className="route-ticket-lines"><thead><tr><th>CANTIDAD</th><th>DESCRIPCIÓN</th><th>PRECIO / KG</th><th>TOTAL</th></tr></thead><tbody><tr><td>{cantidadTiquete.toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg</td><td>{tiquete.producto}</td><td>{fmtCRC(precioUnitarioTiquete)}</td><td>{fmtCRC(Number(tiquete.total || 0))}</td></tr></tbody></table>
            <div className="route-ticket-totals"><div><span>Subtotal</span><b>{fmtCRC(Number(tiquete.subtotal ?? tiquete.total ?? 0))}</b></div>{Number(tiquete.descuento || 0) > 0 && <div><span>Descuento</span><b>− {fmtCRC(Number(tiquete.descuento))}</b></div>}<div className="route-ticket-total"><span>TOTAL</span><strong>{fmtCRC(Number(tiquete.total || 0))}</strong></div></div>
            {Number(tiquete.saldoCredito || 0) > 0 && <div className="route-ticket-totals"><div className="route-ticket-total"><span>SALDO A CRÉDITO</span><strong>{fmtCRC(Number(tiquete.saldoCredito))}</strong></div></div>}
            <footer className="route-ticket-signature"><div><i /><span>RECIBIDO CONFORME · Nombre y firma</span></div><small>Conserve este comprobante para cualquier consulta sobre su entrega.</small></footer>
          </article>
        </section>
        </>
      )}

      {!guia ? (
        <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <Truck className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Sin guía activa. El despachador debe crear una guía para vender en ruta.</p>
          <button type="button" onClick={() => previsualizarTiquete(true)} className="mt-4 min-h-11 rounded-xl border px-4 py-2 text-sm font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>
            Ver muestra del tiquete · no registra venta
          </button>
        </div>
      ) : guia.estado === 'Cargada' ? (
        <section className="mx-auto w-full max-w-xl rounded-2xl p-5 sm:p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <div className="mb-5 flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}><Truck className="h-6 w-6" /></span><div><p className="text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>Antes de salir</p><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Confirme que recibió la carga asignada.</p></div></div>
          <div className="mb-5 space-y-3 rounded-xl p-4" style={{ background: 'var(--bg-muted)' }}>
            <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-secondary)' }}>Ruta</span><strong className="text-right" style={{ color: 'var(--text-primary)' }}>{nombreRutaAsignada}</strong></div>
            <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-secondary)' }}>Camión</span><strong className="text-right" style={{ color: 'var(--text-primary)' }}>{guia.camionNombre}</strong></div>
            {(guia.detalle || []).filter((e: any) => e.estadoEtiqueta === 'Cargada').map((e: any) => <div key={e.etiquetaId} className="flex justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--border-default)' }}><span style={{ color: 'var(--text-secondary)' }}>{e.producto}</span><strong style={{ color: 'var(--text-primary)' }}>{Number(e.saldoKg ?? e.pesoNeto ?? 0).toFixed(2)} kg</strong></div>)}
            <p className="border-t pt-3 text-sm font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>Total esperado <span className="float-right">{inventarioKgCamion.toFixed(2)} kg</span></p>
          </div>
          <button type="button" onClick={() => void confirmarInicioRuta()} disabled={loading} className="min-h-14 w-full rounded-xl px-4 py-3 text-base font-extrabold disabled:opacity-60" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>{loading ? 'Confirmando…' : 'Confirmar carga recibida e iniciar ruta'}</button>
          <p className="mt-3 text-center text-xs" style={{ color: 'var(--text-muted)' }}>Al confirmar, quedará registrada la hora y podrá iniciar ventas.</p>
        </section>
      ) : guia.estado !== 'EnRuta' ? (
        <section className="rounded-2xl p-5" style={{ background: 'var(--status-warning-soft)', color: 'var(--text-primary)' }}><strong>La ruta aún no está lista para iniciar.</strong><p className="mt-1 text-sm">Pida al administrador de despacho que complete y asigne la guía.</p></section>
      ) : (
      <div className="route-pos-layout">
          {/* Columna izquierda: cliente + producto */}
          <div className="route-pos-main min-w-0 space-y-4">
            <div className="grid grid-cols-4 gap-2" aria-label="Pasos de la venta">
              {[['1', 'Cliente'], ['2', 'Producto'], ['3', 'Cantidad y precio'], ['4', 'Cobro y factura']].map(([numero, etiqueta], index) => {
                const puedeAbrir = index === 0 || (index === 1 && Boolean(clienteId)) || (index === 2 && Boolean(clienteId && producto)) || (index === 3 && Boolean(clienteId && producto && cantidad > 0 && cantidad <= stockProducto && precioAutorizado && !precioFueraDeRango && descuento >= 0 && descuento <= descuentoPermitido));
                return <button key={numero} type="button" onClick={() => { if (puedeAbrir) setPasoVenta(index + 1); }} disabled={!puedeAbrir} aria-current={pasoVenta === index + 1 ? 'step' : undefined} className="rounded-xl px-1.5 py-3 text-center text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-50 sm:px-2 sm:text-xs" style={{ background: pasoVenta === index + 1 ? 'var(--brand-primary)' : 'var(--bg-muted)', color: pasoVenta === index + 1 ? 'var(--text-on-action)' : 'var(--text-secondary)' }}><span className="mr-1">{numero}</span>{etiqueta}</button>;
              })}
            </div>
            {/* Clientes */}
            {pasoVenta === 1 && <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-base font-extrabold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>1</span>
                <UserIcon className="w-4 h-4" /> Elija el cliente
              </p>
              <div className="route-pos-choice-grid">
                {clientesRuta.map((c: any) => (
                  <button
                    key={c.clienteId}
                    onClick={() => setClienteId(c.clienteId)}
                    aria-pressed={clienteId === c.clienteId}
                    className={cn('min-h-14 rounded-xl px-4 py-3 text-left text-base font-bold transition-all border focus-visible:ring-2', clienteId === c.clienteId && 'ring-2')}
                    style={clienteId === c.clienteId
                      ? { background: 'var(--brand-primary)', color: 'var(--text-on-action)', borderColor: 'var(--brand-primary)' }
                      : { background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}
                  >
                    {c.nombre}
                    {c.ventanaIni && <span className="block text-[10px] font-medium opacity-80">{c.ventanaIni}–{c.ventanaFin}</span>}
                  </button>
                ))}
              </div>
              {clientesRuta.length === 0 && (
                <p className="rounded-xl p-3 text-sm" style={{ background: 'var(--status-warning-soft)', color: 'var(--text-primary)' }}>Esta ruta no tiene clientes asignados. Pida al administrador que los agregue antes de iniciar la venta.</p>
              )}
            </div>}

            {/* Selección de producto */}
            {pasoVenta === 2 && <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-base font-extrabold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>2</span>
                <PackageOpen className="w-4 h-4" /> Elija el producto
              </p>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary-dark)' }}>
                <p className="text-sm">Cliente: <strong>{clienteSeleccionado?.nombre || clienteSeleccionado?.clienteNombre || 'Seleccione un cliente'}</strong></p>
                <button type="button" onClick={() => setPasoVenta(1)} className="min-h-10 rounded-lg border px-3 text-sm font-bold" style={{ background: 'var(--bg-card)', color: 'var(--brand-primary)', borderColor: 'var(--border-default)' }}>{clienteId ? 'Cambiar cliente' : 'Elegir cliente'}</button>
              </div>
              <div className="route-pos-choice-grid mb-4">
                {productosDisponibles.map((i: any) => (
                  <button
                    key={i.id}
                    onClick={() => { setProducto(i.producto); setCantidadTexto('1'); }}
                    aria-pressed={producto === i.producto}
                    className={cn('min-h-16 rounded-xl px-4 py-3 text-left text-base font-bold border transition-all', producto === i.producto && 'ring-2')}
                    style={producto === i.producto
                      ? { background: 'var(--brand-primary)', color: 'var(--text-on-action)', borderColor: 'var(--brand-primary)' }
                      : { background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}
                  >
                    {i.producto}
                    <span className="block mt-1 text-sm font-medium opacity-90">{i.unidad === 'kg' ? `Quedan ${Number(i.cantidad).toFixed(2)} kg` : `Unidad de inventario incompatible: ${i.unidad || 'sin definir'}`}</span>
                    <span className="block text-xs font-medium opacity-80">
                      {!clienteId ? 'Elija cliente para ver precio' : cargandoPrecio ? 'Consultando precio…' : Number(preciosProductos[i.producto]?.precio) > 0
                        ? `${fmtCRC(Number(preciosProductos[i.producto].precio))} por kg · ${fmtCRC(Number(preciosProductos[i.producto].precioMinimo ?? preciosProductos[i.producto].precio))}–${fmtCRC(Number(preciosProductos[i.producto].precioMaximo ?? preciosProductos[i.producto].precio))}`
                        : preciosProductos[i.producto]?.error ? 'No se pudo consultar el precio' : 'Precio no configurado'}</span>
                    {sugerenciasVenta[i.producto] && <span className="mt-1 block text-xs font-bold" style={{ color: producto === i.producto ? 'var(--text-on-action)' : 'var(--brand-primary)' }}>Sugerido: {sugerenciasVenta[i.producto].kilos > 0 ? `${sugerenciasVenta[i.producto].kilos.toFixed(2)} kg · ` : ''}{fmtCRC(sugerenciasVenta[i.producto].precio)}/kg</span>}
                  </button>
                ))}
              </div>

              {!clienteId && (
                <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm" style={{ background: 'var(--status-warning-soft)', color: 'var(--text-primary)', border: '1px solid var(--status-warning)' }}>
                  <span>Primero elija el cliente para cargar su precio y calcular el total.</span>
                  <button type="button" onClick={() => setPasoVenta(1)} className="min-h-10 rounded-lg px-4 font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>Elegir cliente</button>
                </div>
              )}

              {!producto && <p role="status" className="rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>Seleccione un producto para continuar a la cantidad y el precio.</p>}
              {producto && <p className="rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary-dark)' }}><strong>{producto}</strong> seleccionado · {stockProducto.toFixed(2)} kg disponibles en el camión.</p>}
            </div>}

            {/* Cantidad y precio */}
            {pasoVenta === 3 && <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-base font-extrabold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>3</span>
                <PackageOpen className="w-4 h-4" /> Cantidad y precio
              </p>
              <div className="mb-4 rounded-xl px-3 py-3" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary-dark)' }}>
                <p className="text-sm">Cliente: <strong>{clienteSeleccionado?.nombre || clienteSeleccionado?.clienteNombre || '—'}</strong></p>
                <p className="mt-1 text-sm">Producto: <strong>{producto || '—'}</strong> · Disponible: <strong>{stockProducto.toFixed(2)} kg</strong></p>
              </div>
              {clienteId && producto && (
                <div className="mb-4 rounded-xl border px-3 py-2.5 text-sm" style={{ background: politicaPrecio?.error ? 'var(--status-danger-soft)' : 'var(--status-success-soft)', borderColor: politicaPrecio?.error ? 'var(--status-danger)' : 'var(--status-success)', color: politicaPrecio?.error ? 'var(--status-danger)' : 'var(--status-success)' }}>
                  {cargandoPrecio ? 'Consultando precio autorizado…' : politicaPrecio?.error ? politicaPrecio.error : politicaPrecio?.precio ? (
                    <><strong>Rango autorizado: {fmtCRC(precioMinimo)} a {fmtCRC(precioMaximo)} por kg</strong><span className="block text-xs">{politicaPrecio.listaUsada} · precio sugerido {fmtCRC(politicaPrecio.precio)} por kg</span></>
                  ) : 'Administración aún no configuró el precio para este producto y cliente.'}
                </div>
              )}

              <div className="route-pos-sale-fields">
                {producto && clienteId && sugerenciaProducto && <div className="rounded-xl p-3" style={{ background: 'var(--brand-primary-soft)', border: '1px solid var(--border-default)' }}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>{sugerenciaProducto.pedidosAnalizados === 0 ? 'Precio recomendado por Administración' : sugerenciaProducto.metodo === 'ia_con_historial' ? 'Sugerencia de IA basada en pedidos anteriores' : 'Sugerencia basada en el historial'}</p>
                      <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{sugerenciaProducto.pedidosAnalizados > 0 ? `${sugerenciaProducto.pedidosAnalizados} pedidos · ` : 'Sin pedidos históricos · '}{sugerenciaProducto.kilos > 0 ? `${sugerenciaProducto.kilos.toFixed(2)} kg` : 'cantidad a definir'} · {fmtCRC(sugerenciaProducto.precio)}/kg</p>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>Precio permitido por Administración: {fmtCRC(sugerenciaProducto.precioMinimo)}–{fmtCRC(sugerenciaProducto.precioMaximo)}/kg</p>
                    </div>
                    {sugerenciaProducto.kilos > 0 && <button type="button" onClick={() => { setCantidadTexto(String(Math.min(stockProducto, sugerenciaProducto.kilos))); setPrecioNegociado(Math.min(sugerenciaProducto.precioMaximo, Math.max(sugerenciaProducto.precioMinimo, sugerenciaProducto.precio))); }} disabled={!precioAutorizado || stockProducto <= 0} className="min-h-10 rounded-lg px-3 text-xs font-extrabold disabled:opacity-50" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>Aplicar sugerencia</button>}
                  </div>
                </div>}
                {clienteId && cargandoSugerencia && <p role="status" className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>Analizando pedidos anteriores y precios aprobados…</p>}
                {clienteId && producto && !cargandoSugerencia && !sugerenciaProducto && <p className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>No hay una sugerencia para este producto. El precio se mantiene sujeto al rango aprobado por Administración.</p>}
                {clienteId && producto && (cargandoPrecio || !precioAutorizado) && (
                  <div role="status" className="route-pos-price-warning rounded-xl px-3 py-2.5 text-sm" style={{ background: 'var(--status-warning-soft)', color: 'var(--status-warning)', border: '1px solid var(--status-warning)' }}>
                    <strong className="block">{cargandoPrecio ? 'Consultando precio autorizado…' : 'Precio autorizado pendiente'}</strong>
                    {!cargandoPrecio && <span>Administración debe configurar el precio de este producto para el cliente antes de emitir la venta.</span>}
                  </div>
                )}
                <div>
                  <label htmlFor="cantidad-venta" className="mb-1 block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>¿Cuántos kilos?</label>
                  <div className="flex min-h-14 items-center gap-2">
                    <button type="button" onClick={() => setCantidadTexto(String(Math.max(0.1, Math.round(((Number(cantidadTexto) || 0) - 1) * 100) / 100)))} disabled={!producto} aria-label="Quitar un kilo" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border disabled:cursor-not-allowed disabled:opacity-45" style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}><Minus className="h-5 w-5" /></button>
                  <input
                    id="cantidad-venta" type="number" min={0.01} max={stockProducto || undefined} step="0.01" inputMode="decimal" value={producto ? cantidadTexto : ''} disabled={!producto}
                    onChange={(e) => setCantidadTexto(e.target.value)}
                    onBlur={() => { if (cantidadTexto && Number(cantidadTexto) > 0) setCantidadTexto(String(Number(cantidadTexto))); }}
                    className="h-12 min-w-0 flex-1 rounded-xl px-3 py-2 text-center text-2xl font-extrabold focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  />
                    <button type="button" onClick={() => setCantidadTexto(String(Math.round(((Number(cantidadTexto) || 0) + 1) * 100) / 100))} disabled={!producto} aria-label="Agregar un kilo" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border disabled:cursor-not-allowed disabled:opacity-45" style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}><Plus className="h-5 w-5" /></button>
                  </div>
                  {cantidad > stockProducto && producto && (
                    <p role="alert" className="mt-2 rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)' }}>
                      Solo quedan {stockProducto.toFixed(2)} kg. Baje la cantidad para continuar.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="precio-venta" className="mb-1 block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Precio por kilo (₡)</label>
                  <input
                    id="precio-venta"
                    type="number" min={precioMinimo} max={precioMaximo} step="0.01" value={precioAutorizado ? (precioVenta || '') : ''} disabled={!producto || !precioAutorizado || cargandoPrecio}
                    onChange={(e) => setPrecioNegociado(Number(e.target.value) || 0)}
                    onBlur={() => { if (precioAutorizado && (precioVenta < precioMinimo || precioVenta > precioMaximo)) setPrecioNegociado(Number(politicaPrecio.precio)); }}
                    inputMode="decimal"
                    className="h-12 w-full rounded-xl px-3 py-2 text-base font-bold focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: `1px solid ${precioFueraDeRango ? 'var(--status-danger)' : 'var(--border-default)'}` }}
                    aria-label="Precio por kilo"
                    aria-invalid={precioFueraDeRango}
                    aria-describedby="precio-venta-ayuda"
                  />
                  <p id="precio-venta-ayuda" className="mt-1 text-xs" role={precioFueraDeRango ? 'alert' : undefined} style={{ color: precioFueraDeRango ? 'var(--status-danger)' : 'var(--text-muted)' }}>{precioFueraDeRango ? `Fuera del rango autorizado. Ajuste el precio entre ${fmtCRC(precioMinimo)} y ${fmtCRC(precioMaximo)}; no se podrá registrar la venta así.` : precioAutorizado ? `Puede cobrar entre ${fmtCRC(precioMinimo)} y ${fmtCRC(precioMaximo)} por kg. El total se calcula automáticamente.` : clienteId ? 'No hay un precio autorizado para este cliente y producto. Solicite a Administración que configure la lista.' : 'Seleccione un cliente para cargar el precio autorizado.'}</p>
                </div>
                <div>
                  <label htmlFor="descuento-venta" className="mb-1 block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Descuento total (₡)</label>
                  <input
                    id="descuento-venta"
                    type="number" min={0} max={descuentoPermitido} value={descuentoTexto} disabled={!producto || !precioAutorizado}
                    onChange={(e) => setDescuentoTexto(e.target.value)}
                    inputMode="decimal"
                    className="h-12 w-full rounded-xl px-3 py-2 text-base font-bold focus:outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  />
                  <p className="mt-1 text-xs" role={descuento > descuentoPermitido ? 'alert' : undefined} style={{ color: descuento > descuentoPermitido ? 'var(--status-danger)' : 'var(--text-muted)' }}>{descuento > descuentoPermitido ? `Descuento fuera del límite. Redúzcalo a ${fmtCRC(descuentoPermitido)} o menos.` : `Máximo permitido: ${fmtCRC(descuentoPermitido)}`}</p>
                </div>
                <div className="route-pos-total rounded-xl p-3 sm:flex sm:items-center sm:justify-between" style={{ background: 'var(--bg-muted)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Total a cobrar</p>
                  <p className="text-3xl font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{precioFueraDeRango ? '—' : fmtCRC(total)}</p>
                </div>
              </div>
            </div>}

            {/* Cobro + accion */}
            {pasoVenta === 4 && <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-base font-extrabold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}><span className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>4</span>Documento de la venta</p>
              <div className="grid grid-cols-2 gap-2 rounded-xl p-1" style={{ background: 'var(--bg-muted)' }}>
                {(['Factura', 'Tiquete', 'Proforma'] as const).map(tipo => <button key={tipo} type="button" onClick={() => setTipoDocumentoRuta(tipo)} className={`min-h-11 rounded-lg px-2 text-sm font-bold ${tipo === 'Proforma' ? 'col-span-2' : ''}`} style={tipoDocumentoRuta === tipo ? { background: 'var(--brand-primary)', color: 'var(--text-on-action)' } : { background: 'transparent', color: 'var(--text-secondary)' }}>{tipo === 'Factura' ? 'Factura electrónica' : tipo === 'Tiquete' ? 'Tiquete electrónico' : 'Proforma · no fiscal'}</button>)}
              </div>
              {tipoDocumentoRuta !== 'Proforma' ? <>
              <p className="text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>¿Cuánto recibe ahora?</p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Agregue los medios usados en este cobro. Si queda un saldo, se registrará como crédito solo si el cliente tiene línea autorizada.</p>
              <div className="space-y-2">
                {pagosVenta.map((pago, index) => (
                  <div key={`${index}-${pago.metodo}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-xl p-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <label className="min-w-0 text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Medio de pago
                      <select value={pago.metodo} onChange={(e) => setPagosVenta((prev) => prev.map((item, i) => i === index ? { ...item, metodo: e.target.value } : item))} className="mt-1 min-h-11 w-full rounded-lg border px-2 text-sm" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>
                        {METODOS_PAGO_RUTA.filter((metodo) => metodo === pago.metodo || !pagosVenta.some((otro, i) => i !== index && otro.metodo === metodo)).map((metodo) => <option key={metodo} value={metodo}>{metodo}</option>)}
                      </select>
                    </label>
                    <label className="min-w-0 text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Monto recibido (₡)
                      <input type="text" inputMode="decimal" autoComplete="off" value={pago.monto === 'total' ? total.toFixed(2) : pago.monto} onFocus={() => { if (pago.monto === 'total') setPagosVenta((prev) => prev.map((item, i) => i === index ? { ...item, monto: '' } : item)); }} onChange={(e) => cambiarMontoPago(index, e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 text-base font-bold tabular-nums" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }} aria-label={`Monto recibido para ${pago.metodo}; máximo ${fmtCRC(maximoPagoPorLinea(index))}`} />
                    </label>
                    <button type="button" onClick={() => setPagosVenta((prev) => prev.filter((_, i) => i !== index))} disabled={pagosVenta.length <= 1} className="mb-0.5 flex h-11 w-11 items-center justify-center rounded-lg border disabled:opacity-40" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }} aria-label="Quitar medio de pago"><X className="h-4 w-4" /></button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {pagosVenta.length < 4 && <button type="button" onClick={() => { const metodo = METODOS_PAGO_RUTA.find((candidato) => !pagosVenta.some((pago) => pago.metodo === candidato)); if (metodo) setPagosVenta((prev) => [...prev, { metodo, monto: '0' }]); }} className="min-h-10 rounded-lg border px-3 text-sm font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--brand-primary)' }}>+ Agregar otro medio</button>}
                  {creditoDisponible && <button type="button" onClick={() => setPagosVenta([])} className="min-h-10 rounded-lg border px-3 text-sm font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>Todo a crédito</button>}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 rounded-xl p-3 text-sm sm:grid-cols-3" style={{ background: 'var(--brand-primary-soft)' }}>
                <div><span style={{ color: 'var(--text-secondary)' }}>Total factura</span><strong className="block" style={{ color: 'var(--text-primary)' }}>{fmtCRC(total)}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Recibido ahora</span><strong className="block" style={{ color: 'var(--text-primary)' }}>{fmtCRC(recibidoActual)}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Saldo a crédito</span><strong className="block" style={{ color: 'var(--text-primary)' }}>{fmtCRC(saldoCreditoActual)}</strong></div>
              </div>
              {saldoCreditoActual > 0 && <p className="rounded-lg p-3 text-sm" role={errorPago ? 'alert' : undefined} style={{ background: errorPago ? 'var(--status-danger-soft)' : 'var(--bg-muted)', color: errorPago ? 'var(--status-danger)' : 'var(--text-secondary)' }}>{errorPago || `Crédito disponible: ${fmtCRC(Math.max(0, limiteCreditoCliente - saldoPendienteCliente))}. La factura quedará con saldo pendiente.`}</p>}
              {pagosVenta.length === 0 && !creditoDisponible && <p className="text-sm font-semibold" style={{ color: 'var(--status-danger)' }}>{mensajeCreditoNoDisponible}</p>}
              </> : <div className="rounded-xl border p-3 text-sm" style={{ background: 'var(--status-warning-soft)', borderColor: 'var(--status-warning)', color: 'var(--text-primary)' }}><b>Proforma comercial · no fiscal</b><p className="mt-1">Se guardará la cotización para el cliente. No registra cobro, venta ni salida de inventario.</p></div>}
              <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-muted)' }}>Cliente</span><strong className="text-right" style={{ color: 'var(--text-primary)' }}>{clienteSeleccionado?.nombre || clienteSeleccionado?.clienteNombre || '—'}</strong></div>
                <div className="mt-2 flex justify-between gap-3"><span style={{ color: 'var(--text-muted)' }}>Producto y cantidad</span><strong className="text-right" style={{ color: 'var(--text-primary)' }}>{producto} · {cantidad.toFixed(2)} kg</strong></div>
                <div className="mt-2 flex justify-between gap-3"><span style={{ color: 'var(--text-muted)' }}>Precio por kg</span><strong style={{ color: 'var(--text-primary)' }}>{fmtCRC(precioVenta)}</strong></div>
                {descuento > 0 && <div className="mt-2 flex justify-between gap-3"><span style={{ color: 'var(--text-muted)' }}>Descuento</span><strong style={{ color: 'var(--text-primary)' }}>− {fmtCRC(descuento)}</strong></div>}
                <div className="mt-3 flex justify-between gap-3 border-t pt-3 font-extrabold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><span>Total</span><span>{fmtCRC(total)}</span></div>
              </div>
              {tipoDocumentoRuta !== 'Proforma' && <div className="rounded-xl p-3" style={{ background: 'var(--brand-primary-soft)' }}><p className="text-sm font-bold" style={{ color: 'var(--brand-primary-dark)' }}>Se registrará la venta con {tipoDocumentoRuta === 'Factura' ? 'una factura electrónica' : 'un tiquete electrónico'}</p><p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Simulación: el comprobante queda en borrador y no se envía a Hacienda.</p></div>}
              <button onClick={vender} disabled={ventaDeshabilitada}
                className="min-h-14 w-full flex items-center justify-center gap-2 rounded-xl px-4 py-4 text-lg font-extrabold disabled:opacity-50"
                style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
                <CheckCircle2 className="w-5 h-5" /> {tipoDocumentoRuta === 'Proforma' ? 'Guardar proforma' : precioAutorizado ? `Registrar venta y ${tipoDocumentoRuta === 'Factura' ? 'factura' : 'tiquete'} · ${fmtCRC(total)}` : 'Precio no configurado'}
              </button>
              {tipoDocumentoRuta !== 'Proforma' && <button type="button" onClick={() => previsualizarTiquete()} disabled={!clienteId || !producto || cantidad <= 0}
                className="min-h-11 w-full rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>
                Vista previa del tiquete de ruta · no registra venta
              </button>}
            </div>}
            <div className="flex gap-2">
              {pasoVenta > 1 && <button type="button" onClick={() => setPasoVenta(v => Math.max(1, v - 1))} className="min-h-12 flex-1 rounded-xl border px-4 text-sm font-bold" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}>Volver</button>}
              {pasoVenta < 4 && <button type="button" onClick={() => {
                if (pasoVenta === 1 && !clienteId) return toast.error('Seleccione el cliente de la ruta.');
                if (pasoVenta === 2 && !producto) return toast.error('Seleccione el producto que va a vender.');
                if (pasoVenta === 3 && (!producto || cantidad <= 0 || cantidad > stockProducto)) return toast.error('Indique kilos dentro del saldo disponible.');
                if (pasoVenta === 3 && (!precioAutorizado || cargandoPrecio || precioFueraDeRango)) return toast.error(`El precio debe respetar el rango autorizado de ${fmtCRC(precioMinimo)} a ${fmtCRC(precioMaximo)} por kg.`);
                if (pasoVenta === 3 && (descuento < 0 || descuento > descuentoPermitido)) return toast.error(`El descuento máximo permitido es ${fmtCRC(descuentoPermitido)}.`);
                setPasoVenta(v => v + 1);
              }} disabled={(pasoVenta === 2 && (!clienteId || !producto)) || (pasoVenta === 3 && (!producto || cantidad <= 0 || cantidad > stockProducto || !precioAutorizado || cargandoPrecio || precioFueraDeRango || descuento < 0 || descuento > descuentoPermitido))} className="min-h-12 flex-1 rounded-xl px-4 text-sm font-extrabold disabled:opacity-50" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>{pasoVenta === 3 && precioFueraDeRango ? 'Ajuste el precio autorizado' : 'Continuar'}</button>}
            </div>
          </div>

          {/* Panel independiente para cierre de ruta y entrega de sobrante */}
          {cierreRutaAbierto && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
            <div className="route-pos-sidebar max-h-[92dvh] w-full max-w-2xl min-w-0 space-y-4 overflow-y-auto rounded-2xl p-4" style={{ background: 'var(--bg-page)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Cierre de ruta y entrega a Bodega</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Revise ventas y gastos, registre devoluciones o daños y cuente el efectivo antes de finalizar el día.</p></div>
              <button type="button" onClick={() => initialOpenClosure ? onClose?.() : setCierreRutaAbierto(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }} aria-label="Cerrar panel de cierre"><X className="h-5 w-5" /></button>
            </div>
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Tiquetes de ruta del día</p>
              {emitidas.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aún no se emiten tiquetes de ruta.</p>
              ) : (
                <div className="space-y-2">
                  {emitidas.map((v: any) => (
                    <div key={v.ventaId} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                      <div>
                        <p className="text-sm font-extrabold" style={{ color: 'var(--brand-primary)' }}>{v.tiqueteConsecutivo}</p>
                        <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{v.producto} × {Number(v.cantidadKg ?? v.cartones ?? 0).toFixed(2)} kg — {fmtHora(v.fechaHora)}</p>
                      </div>
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmtCRC(v.total)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Gastos de esta ruta</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{gastosRuta.length} registros · asociados a {guia?.consecutivo || 'la guía'}</p></div><p className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtCRC(gastosRuta.reduce((sum: number, gasto: any) => sum + Number(gasto.monto || 0), 0))}</p></div>
              {gastosRuta.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aún no hay gastos registrados para esta ruta.</p> : <div className="space-y-2">{gastosRuta.slice().sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 4).map((gasto: any) => <div key={gasto.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--bg-muted)' }}><div><p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{gasto.categoria} · {fmtCRC(Number(gasto.monto))}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{gasto.descripcion} · {fmtHora(gasto.fecha)}</p>{gasto.motivoRevision && <p className="text-xs font-semibold" style={{ color: 'var(--status-danger)' }}>Observación: {gasto.motivoRevision}</p>}</div><span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: gasto.estadoRevision === 'Aprobado' ? 'var(--status-success-soft)' : gasto.estadoRevision === 'Observado' ? 'var(--status-danger-soft)' : 'var(--status-warning-soft)', color: gasto.estadoRevision === 'Aprobado' ? 'var(--status-success)' : gasto.estadoRevision === 'Observado' ? 'var(--status-danger)' : 'var(--status-warning)' }}>{gasto.estadoRevision === 'Aprobado' ? 'Revisado' : gasto.estadoRevision}</span></div>)}</div>}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => { setDevSel(null); setModoDevolucion(true); setCierreRutaAbierto(false); }} disabled={loading || cajaCerrada || emitidas.length === 0} className="min-h-12 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold disabled:opacity-50" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}><RotateCcw className="h-4 w-4" /> Registrar devolución</button>
              <button type="button" onClick={() => { setEtiquetaMerma(etiquetasDisponibles[0]?.etiquetaId || ''); setModoMerma(true); setCierreRutaAbierto(false); }} disabled={loading || cajaCerrada || etiquetasDisponibles.length === 0} className="min-h-12 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold disabled:opacity-50" style={{ background: 'var(--status-warning-soft)', color: 'var(--status-warning)', border: '1px solid var(--status-warning)' }}><AlertTriangle className="h-4 w-4" /> Reportar daño</button>
            </div>

            {!cajaCerrada && (
              <label className="block mt-3 space-y-1.5">
                <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Conteo de efectivo al cierre (₡)</span>
                <input
                  type="number" min="0" step="1" inputMode="decimal" value={efectivoContado}
                  onChange={e => setEfectivoContado(e.target.value)}
                  aria-label="Efectivo contado en caja"
                  placeholder="Cuente el efectivo y escriba el total"
                  className="w-full rounded-xl px-3 py-3 text-base font-bold focus:outline-none"
                  style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                />
                <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Efectivo esperado: <strong>{fmtCRC(Number(guia?.cajaResumen?.efectivoEsperado || 0))}</strong>
                  {Number(guia?.cajaResumen?.gastosEfectivo || 0) > 0 && <> · incluye {fmtCRC(Number(guia.cajaResumen.gastosEfectivo))} de gastos en efectivo de esta ruta</>}.
                </span>
              </label>
            )}
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--bg-muted)' }}>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Al finalizar, se bloquean las ventas y Bodega podrá recibir el sobrante y completar el cierre de la guía.</p>
              <button
                onClick={finDia}
                disabled={loading || cajaCerrada || !efectivoContado.trim()}
                className="min-h-12 w-full flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-base font-bold disabled:opacity-50"
                style={{ background: 'var(--status-warning-soft)', color: 'var(--text-primary)', border: '1px solid var(--status-warning)' }}>
                 Finalizar ventas y enviar a Bodega
              </button>
            </div>

            {/* Cuadre de fin de día */}
            {cuadre && (
              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--status-danger)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--status-danger)' }}>Cuadre del día</p>
                <dl className="space-y-1.5 text-sm">
                  {[
                    ['Tiquetes de ruta emitidos', cuadre.tiquetesEmitidos],
                    ['Tiquetes de ruta anulados', cuadre.tiquetesAnulados],
                    [`Cantidad vendida (${unidadRuta})`, `${cuadre.cartonesVendidos} / ${cuadre.cartonesCargados}`],
                    ['Efectivo', fmtCRC(cuadre.totalEfectivo)],
                    ['Transferencias', fmtCRC(cuadre.totalTransferencia)],
                    ...(cuadre.caja ? [
                      ['Efectivo contado', cuadre.caja.efectivoContado == null ? 'Pendiente' : fmtCRC(Number(cuadre.caja.efectivoContado))],
                      ['Diferencia de caja', cuadre.caja.diferencia == null ? 'Pendiente de conteo' : fmtCRC(Number(cuadre.caja.diferencia))],
                      ['Estado de caja', cuadre.caja.estado === 'Cuadrada' ? 'Cuadrada' : cuadre.caja.estado === 'DiferenciaPendiente' ? 'Diferencia pendiente de aprobación' : 'Pendiente de conteo'],
                    ] : []),
                    ['Crédito', fmtCRC(cuadre.totalCredito)],
                    ['Retornados', `${cuadre.cartonesRetornados} ${unidadRuta}`],
                    ['Restante camión', `${cuadre.restanteCamion} ${unidadRuta}`],
                    ['Merma registrada', `${cuadre.mermaRegistrada ?? cuadre.mermaPreliminar ?? 0} ${unidadRuta}`],
                    ['Retorno aceptado por Bodega', `${cuadre.retornoAceptado ?? 0} ${unidadRuta}`],
                    ['Retorno pendiente en Bodega', `${cuadre.retornoPendiente ?? 0} ${unidadRuta}`],
                    ['Falta explicar', `${cuadre.diferenciaPendiente ?? 0} ${unidadRuta}`],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between gap-2">
                      <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
                      <dd className="font-bold" style={{ color: 'var(--text-primary)' }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            </div>
          </div>}
        </div>
      )}

      {/* Modal devolución */}
      {/* Modal devolución */}
      {modoDevolucion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => { setDevSel(null); setModoDevolucion(false); }} />
          <div className="relative w-full max-w-md rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-extrabold" style={{ color: 'var(--text-primary)' }}>{devSel ? 'Confirmar devolución' : 'Registrar devolución'}</p>
              <button onClick={() => { setDevSel(null); setModoDevolucion(false); }} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg" style={{ color: 'var(--text-secondary)' }} aria-label="Cerrar devolución">
                <X className="w-5 h-5" />
              </button>
            </div>
            {devSel ? (
              <div className="space-y-4">
                <div className="rounded-xl px-4 py-3" style={{ background: 'var(--status-danger-soft)', border: '1px solid var(--status-danger)' }}>
                  <p className="text-sm font-bold" style={{ color: 'var(--status-danger)' }}>Tiquete de ruta {devSel.tiqueteConsecutivo} — {devSel.producto} × {Number(devSel.cantidadKg ?? devSel.cartones).toFixed(2)} kg</p>
                  <p className="text-sm font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{fmtCRC(devSel.total)}</p>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  La devolución devolverá los kilos al camión{devSel.cobro === 'Credito' ? ' y anulará el crédito' : ''}. ¿Desea continuar?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setDevSel(null)} className="rounded-xl px-3 py-3 text-sm font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                    Volver
                  </button>
                  <button onClick={() => { devolver(devSel.etiquetaId, devSel.ventaId); setDevSel(null); setModoDevolucion(false); }}
                    className="min-h-12 rounded-xl px-3 py-3 text-sm font-extrabold disabled:opacity-50" disabled={loading} style={{ background: 'var(--brand-danger)', color: '#10122A' }}>
                    CONFIRMAR DEVOLUCIÓN
                  </button>
                </div>
              </div>
            ) : emitidas.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay tiquetes de ruta emitidos para devolver.</p>
            ) : (
              <div className="space-y-2">
                {emitidas.map((v: any) => (
                  <button
                    key={v.ventaId}
                    onClick={() => setDevSel(v)}
                    className="w-full flex items-center justify-between rounded-xl px-3 py-3 text-sm"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  >
                    <span className="font-bold">{v.tiqueteConsecutivo} — {v.producto} × {Number(v.cantidadKg ?? v.cartones ?? 0).toFixed(2)} kg</span>
                    <span className="font-bold" style={{ color: 'var(--status-danger)' }}>{fmtCRC(v.total)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {modoMerma && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setModoMerma(false)} />
          <div className="relative w-full max-w-md rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-center justify-between mb-4">
              <div><p className="font-extrabold" style={{ color: 'var(--text-primary)' }}>Reportar producto dañado</p><p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Se descuenta de esta etiqueta y del camión.</p></div>
              <button onClick={() => setModoMerma(false)} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg" style={{ color: 'var(--text-secondary)' }} aria-label="Cerrar reporte de daño"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>¿De cuál etiqueta?*
                <select value={etiquetaMerma} onChange={e => setEtiquetaMerma(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3 text-base" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                  {etiquetasDisponibles.map((e: any) => <option key={e.etiquetaId} value={e.etiquetaId}>{e.producto} · quedan {Number(e.saldoKg ?? e.pesoNeto ?? 0).toFixed(2)} kg</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Cantidad*
                  <input type="number" min="0.01" step="0.01" value={cantidadMerma} onChange={e => setCantidadMerma(Number(e.target.value))} className="mt-1 w-full rounded-xl border px-3 py-3 text-base" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                </label>
                <label className="block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Unidad*
                  <div className="mt-1 rounded-xl border px-3 py-3 text-base" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>Kilogramos (kg)</div>
                </label>
              </div>
              <label className="block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Motivo*
                <select value={motivoMerma} onChange={e => setMotivoMerma(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3 text-base" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                  <option>Quebrado Camión</option><option>Daño en ruta</option><option>Rechazo Cliente</option>
                </select>
              </label>
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }}>La conversión usa el peso configurado en el catálogo.</p>
              <button onClick={() => void reportarMerma()} disabled={loading || !etiquetaMerma || cantidadMerma <= 0} className="w-full min-h-12 rounded-xl px-4 py-3 text-base font-extrabold disabled:opacity-50" style={{ background: 'var(--brand-danger)', color: '#10122A' }}>GUARDAR MERMA</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
