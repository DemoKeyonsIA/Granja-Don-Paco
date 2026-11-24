import React, { useState, useEffect, useCallback } from 'react';
import { Truck, PackageOpen, User as UserIcon, UserPlus, Banknote, CreditCard, ArrowLeftRight, RotateCcw, Printer, CheckCircle2, X, AlertTriangle, Minus, Plus, Eye, Mail } from 'lucide-react';
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
  const esVendedorRuta = rolesUsuario.includes('Comercial') && !rolesUsuario.includes('Admin');
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
  const [documentoCreado, setDocumentoCreado] = useState<any>(null);
  const [cierreRutaAbierto, setCierreRutaAbierto] = useState(initialOpenClosure);
  const [ventas, setVentas] = useState<any[]>([]);
  const [gastosRuta, setGastosRuta] = useState<any[]>([]);
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
  const [ventaWizardAbierto, setVentaWizardAbierto] = useState(false);
  const [tipoDocumentoRuta, setTipoDocumentoRuta] = useState<'Factura' | 'Tiquete' | 'Proforma'>('Factura');
  const [selectorDocumentoAbierto, setSelectorDocumentoAbierto] = useState(false);
  const [proformaOrigenIdRuta, setProformaOrigenIdRuta] = useState<string | null>(null);
  const [clientePreseleccionadoDesdeEntrega, setClientePreseleccionadoDesdeEntrega] = useState(false);
  const [menuNuevaAccionAbierto, setMenuNuevaAccionAbierto] = useState(false);
  const [solicitudClienteAbierta, setSolicitudClienteAbierta] = useState(false);
  const [enviandoSolicitudCliente, setEnviandoSolicitudCliente] = useState(false);
  const [borradorCliente, setBorradorCliente] = useState({ nombre: '', tipo_documento: 'Fisica', documento_id: '', telefono: '', email: '', direccion: '' });

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

  const abrirDocumentoVenta = (venta: any, cliente: any) => {
    setTiquete({
      ...venta,
      demo: false,
      tiqueteConsecutivo: venta.tiqueteConsecutivo || venta.facturaConsecutivo || 'Documento de ruta',
      fechaHora: venta.fechaHora || new Date().toISOString(),
      cliente: { nombre: cliente?.nombre || 'Cliente', ...(venta.cliente || {}) },
      camionNombre: guia?.camionNombre || '',
      guiaConsecutivo: guia?.consecutivo || '',
      vendedorNombre: currentUser.name,
      subtotal: Number(venta.subtotal ?? venta.total ?? 0),
      total: Number(venta.total || 0),
      cantidadKg: Number(venta.cantidadKg ?? venta.cartones ?? 0),
      precioUnitario: Number(venta.precioUnitario || 0),
      mediosPago: venta.pagos || [],
      tipoDocumento: venta.tipoDocumento || 'Tiquete',
    });
    setPreviewTiqueteAbierto(true);
  };

  const imprimirProformaRuta = (proforma: any, cliente: any) => {
    const escapar = (valor: unknown) => String(valor ?? '').replace(/[&<>"']/g, (caracter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[caracter] as string));
    const lineas = (proforma.detalles || []).map((linea: any) => `<tr><td>${escapar(linea.producto)}</td><td>${Number(linea.cantidad || 0).toLocaleString('es-CR')} kg</td><td>${fmtCRC(Number(linea.precio_unitario || 0))}</td><td>${fmtCRC(Number(linea.subtotal || 0))}</td></tr>`).join('');
    const ventana = window.open('', '_blank', 'width=820,height=900');
    if (!ventana) return toast.error('Permita las ventanas emergentes para ver la proforma.');
    ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(proforma.consecutivo)} · Proforma</title><style>body{font:15px Arial,sans-serif;color:#172033;max-width:760px;margin:32px auto;padding:24px}h1{margin-bottom:4px}.muted{color:#687386}.notice{margin:20px 0;padding:12px;background:#fff6dd;border:1px solid #e6c46b;border-radius:8px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.total{text-align:right;font-size:22px;font-weight:bold;margin-top:18px}</style></head><body><h1>Proforma / cotización</h1><p class="muted">${escapar(proforma.consecutivo)} · ${new Date(proforma.fecha).toLocaleString('es-CR')}</p><p>Cliente: <b>${escapar(cliente?.nombre || 'Cliente')}</b></p><div class="notice">Documento comercial no fiscal. No es factura ni comprobante electrónico.</div><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio / kg</th><th>Total</th></tr></thead><tbody>${lineas}</tbody></table><p>Subtotal: ${fmtCRC(Number(proforma.subtotal || 0))}</p><p>Descuento: ${fmtCRC(Number(proforma.descuento || 0))}</p><div class="total">Total cotizado: ${fmtCRC(Number(proforma.total || 0))}</div><p class="muted">Esta cotización no registra una venta, cobro ni salida de inventario.</p></body></html>`);
    ventana.document.close(); ventana.focus(); ventana.print();
  };

  const prepararCorreoDocumento = (documento: any) => {
    const { tipo, data, cliente } = documento || {};
    const correo = cliente?.email || cliente?.correo || '';
    if (!correo) return toast.error('Este cliente no tiene correo registrado. Agréguelo en su perfil para preparar el envío.');
    const consecutivo = tipo === 'Proforma' ? data.consecutivo : (data.documentoFiscalConsecutivo || data.tiqueteConsecutivo || 'Documento de ruta');
    const nombreTipo = tipo === 'Proforma' ? 'Proforma' : tipo === 'Tiquete' ? 'Tiquete electrónico' : 'Factura electrónica';
    const productoDoc = data.producto || data.detalles?.map((linea: any) => `${linea.producto} · ${Number(linea.cantidad || 0).toFixed(2)} kg`).join(', ') || '';
    const asunto = `${nombreTipo} ${consecutivo} · Granja Don Paco`;
    const cuerpo = [`Hola ${cliente?.nombre || 'cliente'},`, '', `Te compartimos el detalle de ${nombreTipo.toLowerCase()} ${consecutivo}.`, productoDoc, `Total: ${fmtCRC(Number(data.total || 0))}`, '', tipo === 'Proforma' ? 'Esta proforma es una cotización comercial; no registra cobro ni salida de inventario.' : 'Este documento se encuentra en simulación y no ha sido enviado a Hacienda.', '', 'Granja Don Paco'].join('\n');
    window.location.href = `mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  };

  const anularProformaRuta = async (proforma: any) => {
    if (!window.confirm(`¿Anular la proforma ${proforma.consecutivo}? La cotización dejará de estar vigente; no se modifica una venta ni el inventario.`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/proformas/${proforma.id}/anular`, { method: 'POST', headers: sessionHeaders(currentUser.id, true), body: JSON.stringify({ motivo: 'Anulada desde el resumen de clientes de Mi Ruta' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo anular la proforma.');
      toast.success(`${proforma.consecutivo} anulada. Puede preparar una nueva cotización para este cliente.`);
      await loadGuia(guiaId);
    } catch (error: any) { toast.error(error.message); }
    setLoading(false);
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
        setDocumentoCreado({ tipo: 'Proforma', data, cliente: clienteSeleccionado });
        resetPos(); setPasoVenta(1); setVentaWizardAbierto(false); await loadGuia(guiaId);
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
        setDocumentoCreado({ tipo: tipoDocumentoRuta, data, cliente: clienteSeleccionado });
        setVentas(prev => [...prev, { ...data, clienteId, estado: 'Emitida' }].sort((a: any, b: any) => String(a.tiqueteConsecutivo).localeCompare(String(b.tiqueteConsecutivo))));
        toast.success(`Venta registrada · ${tipoDocumentoRuta === 'Factura' ? 'factura electrónica' : 'tiquete electrónico'} ${data.documentoFiscalConsecutivo || ''} en Documentos`);
        resetPos();
        setPasoVenta(1);
        setVentaWizardAbierto(false);
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

  const solicitarAltaCliente = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!borradorCliente.nombre.trim() || !guia) return;
    setEnviandoSolicitudCliente(true);
    try {
      const response = await fetch('/api/clientes/solicitudes', {
        method: 'POST',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ ...borradorCliente, nombre: borradorCliente.nombre.trim(), ruta: nombreRutaAsignada }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo enviar la solicitud.');
      toast.success('Solicitud enviada. El cliente aparecerá en la ruta solo cuando Administración la apruebe.');
      setSolicitudClienteAbierta(false);
      setBorradorCliente({ nombre: '', tipo_documento: 'Fisica', documento_id: '', telefono: '', email: '', direccion: '' });
    } catch (error: any) {
      toast.error(error.message || 'No se pudo enviar la solicitud.');
    } finally { setEnviandoSolicitudCliente(false); }
  };

  const cajaCerrada = Boolean(guia?.finDiaFecha);
  const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
  const vendidoKg = emitidas.reduce((s: number, v: any) => s + Number(v.cantidadKg ?? 0), 0);
  const vendidoProductoKg = emitidas.filter((v: any) => String(v.producto || '') === producto).reduce((s: number, v: any) => s + Number(v.cantidadKg ?? 0), 0);
  const cargadoProductoKg = (guia?.detalle || []).filter((d: any) => String(d.producto || '') === producto)
    .reduce((s: number, d: any) => s + Number(d.cantidadKg ?? d.cantidad ?? d.saldoKg ?? d.pesoNeto ?? d.cartones ?? 0), 0);
  const inventarioKgCamion = productosDisponibles
    .filter((i: any) => i.unidad === 'kg')
    .reduce((s: number, i: any) => s + Number(i.cantidad || 0), 0);
  const ventaEnPreparacion = Boolean(clienteId && producto && pasoVenta >= 4);
  const cantidadPuedeConfirmarse = cantidad > 0 && cantidad <= stockProducto;
  const kilosApartadosTemporalmente = ventaEnPreparacion && cantidadPuedeConfirmarse ? cantidad : 0;
  const disponibleCamionVisual = Math.max(0, inventarioKgCamion - kilosApartadosTemporalmente);
  const metricasProducto = Boolean(ventaWizardAbierto && producto);
  const cargadoVisual = metricasProducto ? (cargadoProductoKg || stockProducto + vendidoProductoKg) : Number(guia?.totalKg ?? guia?.totalCartones ?? 0);
  const vendidoVisual = metricasProducto ? vendidoProductoKg : vendidoKg;
  const disponibleVisual = metricasProducto
    ? Math.max(0, stockProducto - (ventaEnPreparacion && cantidadPuedeConfirmarse ? cantidad : 0))
    : disponibleCamionVisual;
  const clientesRuta = (guia?.rutaOrden || []).length > 0 ? guia.rutaOrden : (guia?.clientesRuta || []);
  const clientesCompletadosIds = new Set(ventas.filter((venta: any) => venta.estado === 'Emitida' && venta.clienteId).map((venta: any) => String(venta.clienteId)));
  const clientesPorEntregar = clientesRuta.filter((cliente: any) => !clientesCompletadosIds.has(String(cliente.clienteId)));
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
      <div className="min-w-0 rounded-2xl p-3 sm:p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        {onClose && <div className="mb-2 flex items-start justify-end gap-3">
          {onClose && <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }} aria-label="Cerrar registro de venta"><X className="h-5 w-5" /></button>}
        </div>}
        <div className="route-pos-header-layout">
          <div className="route-pos-assignment">
            <div className="min-w-0">
              <p className="text-xs font-bold tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {puedeElegirGuia ? 'Ruta de trabajo' : 'Ruta asignada'}
              </p>
              <div className="route-pos-title-row">
                <p className="mt-1 min-w-0 truncate text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>
                  {guia ? nombreRutaAsignada : 'Cargando ruta asignada…'}
                </p>
                {guia && <span className="route-pos-status">{estadoRutaLabel}</span>}
                {guia?.estado === 'EnRuta' && !cajaCerrada && (ventaWizardAbierto ? (
                  <button type="button" onClick={() => { setVentaWizardAbierto(false); resetPos(); setPasoVenta(1); }} aria-label="Cancelar factura" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}><X className="h-5 w-5" /></button>
                ) : (
                  <div className="relative shrink-0">
                    <button type="button" aria-label="Crear" aria-haspopup="menu" aria-expanded={menuNuevaAccionAbierto} onClick={() => setMenuNuevaAccionAbierto(open => !open)} className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}><Plus className="h-5 w-5" /></button>
                    {menuNuevaAccionAbierto && <>
                      <button type="button" aria-label="Cerrar menú" className="fixed inset-0 z-20 cursor-default" onClick={() => setMenuNuevaAccionAbierto(false)} />
                      <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border p-1.5 shadow-xl" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                        <button type="button" role="menuitem" onClick={() => { setMenuNuevaAccionAbierto(false); setClientePreseleccionadoDesdeEntrega(false); resetPos(); setPasoVenta(1); setVentaWizardAbierto(true); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-bold" style={{ color: 'var(--text-primary)' }}><Plus className="h-4 w-4" style={{ color: 'var(--brand-primary)' }} />Nueva factura</button>
                        {esVendedorRuta && <button type="button" role="menuitem" onClick={() => { setMenuNuevaAccionAbierto(false); setBorradorCliente({ nombre: '', tipo_documento: 'Fisica', documento_id: '', telefono: '', email: '', direccion: '' }); setSolicitudClienteAbierta(true); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-bold" style={{ color: 'var(--text-primary)' }}><UserPlus className="h-4 w-4" style={{ color: 'var(--brand-primary)' }} />Solicitar cliente nuevo</button>}
                      </div>
                    </>}
                  </div>
                ))}
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
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{metricasProducto ? 'Cargado' : 'Cargado total'}</p>
                {metricasProducto && <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>{producto}</p>}
                <p className="mt-1 text-lg font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{cargadoVisual.toFixed(2)} kg</p>
                {!metricasProducto && Number(guia.colchonKg ?? guia.colchonCartones) > 0 && <p className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Extra: {Number(guia.colchonKg ?? guia.colchonCartones).toFixed(2)} kg</p>}
              </div>
              <div className="route-pos-metric rounded-xl p-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{metricasProducto ? 'Vendido' : 'Vendido total'}</p>
                {metricasProducto && <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>{producto}</p>}
                <p className="mt-1 text-lg font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{vendidoVisual.toFixed(2)} kg</p>
              </div>
              <div className="route-pos-metric rounded-xl p-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{metricasProducto ? (ventaEnPreparacion && cantidadPuedeConfirmarse ? 'Quedaría disponible' : 'Disponible') : ventaEnPreparacion && cantidadPuedeConfirmarse ? 'Disponible tras venta' : 'Disponible total'}</p>
                <p className="mt-1 text-lg font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{disponibleVisual.toFixed(2)} kg</p>
                <p className="mt-0.5 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>{metricasProducto ? producto : 'Suma todos los productos'}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {guia?.estado === 'EnRuta' && !cajaCerrada && !ventaWizardAbierto && (
        <section className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }} aria-labelledby="clientes-pendientes-ruta">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="clientes-pendientes-ruta" className="text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>Entregas pendientes</h2>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{clientesPorEntregar.length} {clientesPorEntregar.length === 1 ? 'cliente por atender' : 'clientes por atender'} en esta ruta</p>
            </div>
          </div>
          {clientesPorEntregar.length > 0 ? (
            <ul className="space-y-2">
              {clientesPorEntregar.map((cliente: any) => (
                <li key={cliente.clienteId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" style={{ background: 'var(--bg-page)', borderColor: 'var(--border-default)' }}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{cliente.nombre || cliente.clienteNombre || 'Cliente'}</p>
                    {(cliente.ventanaIni || cliente.ventanaFin) && <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>Horario {cliente.ventanaIni || '—'}–{cliente.ventanaFin || '—'}</p>}
                  </div>
                  <button type="button" onClick={() => {
                    setClienteId(String(cliente.clienteId)); setProducto(''); setCantidadTexto('1'); setDescuentoTexto('0');
                    setPagosVenta([{ metodo: 'Efectivo', monto: 'total' }]); setProformaOrigenIdRuta(null); setClientePreseleccionadoDesdeEntrega(true); setPasoVenta(1); setVentaWizardAbierto(true);
                  }} className="min-h-10 shrink-0 rounded-lg px-4 py-2 text-sm font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
                    Iniciar entrega
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl p-3 text-sm" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>{clientesRuta.length === 0 ? 'Esta ruta no tiene clientes asignados.' : 'Ya completaste la entrega a todos los clientes de esta ruta.'}</p>
          )}
        </section>
      )}

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
        <section className={`route-ticket-print-overlay${previewTiqueteAbierto ? ' route-ticket-preview-screen' : ''}`} aria-label="Tiquete de ruta para impresión">
          {previewTiqueteAbierto && <button type="button" className="route-ticket-preview-close no-print" onClick={() => setPreviewTiqueteAbierto(false)} aria-label="Cerrar vista previa"><X className="h-5 w-5" /></button>}
          <article className="route-ticket-paper">
            <header className="route-ticket-header"><img src="/granja-don-paco-logo.png" alt="Granja Don Paco" /><div><span>GRANJA DON PACO</span><strong>{tiquete.demo ? 'VISTA PREVIA DE RUTA' : tiquete.tipoDocumento === 'Factura' ? 'FACTURA ELECTRÓNICA · DEMO' : tiquete.tipoDocumento === 'Tiquete' ? 'TIQUETE ELECTRÓNICO · DEMO' : 'COMPROBANTE DE RUTA'}</strong><small>{tiquete.facturaConsecutivo ? `Factura ${tiquete.facturaConsecutivo}` : 'Control de venta y entrega'}</small></div><div className="route-ticket-number"><small>{tiquete.demo ? 'MUESTRA' : 'N.º DOCUMENTO'}</small><strong>{tiquete.demo ? 'VISTA PREVIA' : tiquete.documentoFiscalConsecutivo || tiquete.tiqueteConsecutivo}</strong></div></header>
            <p className="route-ticket-demo">{tiquete.demo ? 'VISTA PREVIA · NO REGISTRA UNA VENTA NI ES UN COMPROBANTE FISCAL' : tiquete.tipoDocumento === 'Factura' || tiquete.tipoDocumento === 'Tiquete' ? 'SIMULACIÓN · NO ES UN COMPROBANTE ELECTRÓNICO VÁLIDO NI SE HA ENVIADO A HACIENDA' : 'COMPROBANTE INTERNO DE RUTA · NO SUSTITUYE EL COMPROBANTE ELECTRÓNICO'}</p>
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

      {documentoCreado && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setDocumentoCreado(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="documento-creado-titulo" className="w-full max-w-md rounded-2xl p-5 shadow-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--status-success)' }}>{documentoCreado.tipo === 'Proforma' ? 'Proforma guardada' : 'Entrega registrada'}</p><h2 id="documento-creado-titulo" className="mt-1 text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>{documentoCreado.tipo === 'Proforma' ? documentoCreado.data.consecutivo : documentoCreado.data.documentoFiscalConsecutivo || documentoCreado.data.tiqueteConsecutivo}</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{documentoCreado.cliente?.nombre || 'Cliente'} · {fmtCRC(Number(documentoCreado.data.total || 0))}</p></div>
              <button type="button" onClick={() => setDocumentoCreado(null)} aria-label="Cerrar" className="rounded-lg p-2" style={{ color: 'var(--text-secondary)' }}><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => { if (documentoCreado.tipo === 'Proforma') imprimirProformaRuta(documentoCreado.data, documentoCreado.cliente); else { setDocumentoCreado(null); setPreviewTiqueteAbierto(true); } }} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><Eye className="h-4 w-4" />Ver documento</button>
              <button type="button" onClick={() => { if (documentoCreado.tipo === 'Proforma') imprimirProformaRuta(documentoCreado.data, documentoCreado.cliente); else imprimirTiquete(); }} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><Printer className="h-4 w-4" />Imprimir</button>
              <button type="button" onClick={() => prepararCorreoDocumento(documentoCreado)} disabled={!documentoCreado.cliente?.email && !documentoCreado.cliente?.correo} className="flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold disabled:opacity-50 sm:col-span-2" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}><Mail className="h-4 w-4" />Preparar correo para el cliente</button>
            </div>
            <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>{documentoCreado.cliente?.email || documentoCreado.cliente?.correo ? `Se abrirá el correo dirigido a ${documentoCreado.cliente.email || documentoCreado.cliente.correo}.` : 'El cliente no tiene correo registrado. Agréguelo en su perfil para habilitar el envío.'} El correo se abrirá como borrador en su aplicación de email.</p>
          </section>
        </div>
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
            {ventaWizardAbierto && <>
              <div className={`grid ${clientePreseleccionadoDesdeEntrega ? 'grid-cols-4' : 'grid-cols-5'} gap-1`} aria-label="Pasos de la factura">
                {(clientePreseleccionadoDesdeEntrega ? [{ paso: 1, label: 'Documento' }, { paso: 3, label: 'Producto' }, { paso: 4, label: 'Precio' }, { paso: 5, label: 'Pago' }] : [{ paso: 1, label: 'Documento' }, { paso: 2, label: 'Cliente' }, { paso: 3, label: 'Producto' }, { paso: 4, label: 'Precio' }, { paso: 5, label: 'Pago' }]).map((item, index) => <div key={item.paso} className="rounded-lg px-1 py-2 text-center text-[10px] font-bold sm:text-xs" style={{ background: pasoVenta === item.paso ? 'var(--brand-primary)' : 'var(--bg-muted)', color: pasoVenta === item.paso ? 'var(--text-on-action)' : 'var(--text-muted)' }}>{index + 1} {item.label}</div>)}
              </div>
              {pasoVenta === 1 && <section className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <p className="mb-3 text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>1 · Tipo de documento</p>
                <button type="button" onClick={() => setSelectorDocumentoAbierto(true)} aria-haspopup="dialog" className="flex min-h-12 w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-bold" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><span>{tipoDocumentoRuta === 'Factura' ? 'Factura electrónica' : tipoDocumentoRuta === 'Tiquete' ? 'Tiquete electrónico' : 'Proforma'}</span><span aria-hidden="true">⌄</span></button>
                {clientePreseleccionadoDesdeEntrega && clienteId && <p className="mt-3 rounded-xl px-3 py-2.5 text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary-dark)' }}>Entrega para: <strong>{clienteSeleccionado?.nombre || clienteSeleccionado?.clienteNombre || 'Cliente seleccionado'}</strong></p>}
              </section>}
              {pasoVenta === 2 && <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <p className="mb-3 flex items-center gap-2 text-base font-extrabold" style={{ color: 'var(--text-primary)' }}><UserIcon className="h-4 w-4" /> 2 · Elija el cliente</p>
                <div className="route-pos-choice-grid">
                  {clientesPorEntregar.map((c: any) => <button key={c.clienteId} onClick={() => { setClienteId(c.clienteId); setClientePreseleccionadoDesdeEntrega(false); setProducto(''); setCantidadTexto('1'); setDescuentoTexto('0'); setPagosVenta([{ metodo: 'Efectivo', monto: 'total' }]); setProformaOrigenIdRuta(null); setPasoVenta(3); }} aria-pressed={clienteId === c.clienteId} className={cn('min-h-14 rounded-xl px-4 py-3 text-left text-base font-bold transition-all border focus-visible:ring-2', clienteId === c.clienteId && 'ring-2')} style={clienteId === c.clienteId ? { background: 'var(--brand-primary)', color: 'var(--text-on-action)', borderColor: 'var(--brand-primary)' } : { background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>{c.nombre}{c.ventanaIni && <span className="block text-[10px] font-medium opacity-80">{c.ventanaIni}–{c.ventanaFin}</span>}</button>)}
                </div>
                {clientesPorEntregar.length === 0 && <p className="rounded-xl p-3 text-sm" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>{clientesRuta.length === 0 ? 'Esta ruta no tiene clientes asignados.' : 'Todos los clientes ya recibieron su entrega. Consulte el historial en Facturas.'}</p>}
              </div>}
            </>}
            {/* Selección de producto */}
            {ventaWizardAbierto && pasoVenta === 3 && <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-base font-extrabold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>3</span>
                <PackageOpen className="w-4 h-4" /> Elija el producto
              </p>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary-dark)' }}>
                <p className="text-sm">Cliente: <strong>{clienteSeleccionado?.nombre || clienteSeleccionado?.clienteNombre || 'Seleccione un cliente'}</strong></p>
                <button type="button" onClick={() => { setClientePreseleccionadoDesdeEntrega(false); setPasoVenta(2); }} className="min-h-10 rounded-lg border px-3 text-sm font-bold" style={{ background: 'var(--bg-card)', color: 'var(--brand-primary)', borderColor: 'var(--border-default)' }}>{clienteId ? 'Cambiar cliente' : 'Elegir cliente'}</button>
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
                  <button type="button" onClick={() => setPasoVenta(2)} className="min-h-10 rounded-lg px-4 font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>Elegir cliente</button>
                </div>
              )}

              {!producto && <p role="status" className="rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>Seleccione un producto para continuar a la cantidad y el precio.</p>}
            </div>}

            {/* Cantidad y precio */}
            {ventaWizardAbierto && pasoVenta === 4 && <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-base font-extrabold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>4</span>
                <PackageOpen className="w-4 h-4" /> Cantidad y precio
              </p>
              <p className="mb-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                {clienteSeleccionado?.nombre || clienteSeleccionado?.clienteNombre || 'Cliente'} · {producto || 'Producto'} · Stock actual {stockProducto.toFixed(2)} kg
              </p>

              <div className="route-pos-sale-fields">
                {producto && clienteId && sugerenciaProducto && <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span><strong style={{ color: 'var(--text-primary)' }}>Sugerido:</strong> {sugerenciaProducto.kilos > 0 ? `${Math.min(stockProducto, sugerenciaProducto.kilos).toFixed(2)} kg · ` : ''}{fmtCRC(Math.min(sugerenciaProducto.precioMaximo, Math.max(sugerenciaProducto.precioMinimo, sugerenciaProducto.precio)))}/kg{sugerenciaProducto.pedidosAnalizados > 0 ? ` · ${sugerenciaProducto.pedidosAnalizados} pedidos` : ' · Administración'}</span>
                  {sugerenciaProducto.kilos > 0 && <button type="button" onClick={() => { setCantidadTexto(String(Math.min(stockProducto, sugerenciaProducto.kilos))); setPrecioNegociado(Math.min(sugerenciaProducto.precioMaximo, Math.max(sugerenciaProducto.precioMinimo, sugerenciaProducto.precio))); }} disabled={!precioAutorizado || stockProducto <= 0} className="min-h-9 rounded-lg px-3 text-xs font-bold disabled:opacity-50" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary-dark)' }}>Usar sugerencia</button>}
                </div>}
                {clienteId && cargandoSugerencia && <p role="status" className="text-xs" style={{ color: 'var(--text-muted)' }}>Preparando sugerencia…</p>}
                {clienteId && producto && !cargandoSugerencia && !sugerenciaProducto && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sin historial de compra para sugerir.</p>}
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
            {ventaWizardAbierto && pasoVenta === 5 && <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-base font-extrabold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}><span className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>5</span>Pago y factura</p>
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
              </> : null}
              <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-muted)' }}>Cliente</span><strong className="text-right" style={{ color: 'var(--text-primary)' }}>{clienteSeleccionado?.nombre || clienteSeleccionado?.clienteNombre || '—'}</strong></div>
                <div className="mt-2 flex justify-between gap-3"><span style={{ color: 'var(--text-muted)' }}>Producto y cantidad</span><strong className="text-right" style={{ color: 'var(--text-primary)' }}>{producto} · {cantidad.toFixed(2)} kg</strong></div>
                <div className="mt-2 flex justify-between gap-3"><span style={{ color: 'var(--text-muted)' }}>Precio por kg</span><strong style={{ color: 'var(--text-primary)' }}>{fmtCRC(precioVenta)}</strong></div>
                {descuento > 0 && <div className="mt-2 flex justify-between gap-3"><span style={{ color: 'var(--text-muted)' }}>Descuento</span><strong style={{ color: 'var(--text-primary)' }}>− {fmtCRC(descuento)}</strong></div>}
                <div className="mt-3 flex justify-between gap-3 border-t pt-3 font-extrabold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><span>Total</span><span>{fmtCRC(total)}</span></div>
              </div>
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
              {ventaWizardAbierto && pasoVenta > 1 && <button type="button" onClick={() => { if (pasoVenta === 3) setClientePreseleccionadoDesdeEntrega(false); setPasoVenta(v => Math.max(1, v - 1)); }} className="min-h-12 flex-1 rounded-xl border px-4 text-sm font-bold" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}>Volver</button>}
              {ventaWizardAbierto && pasoVenta < 5 && <button type="button" onClick={() => {
                if (pasoVenta === 2 && !clienteId) return toast.error('Seleccione el cliente de la ruta.');
                if (pasoVenta === 3 && !producto) return toast.error('Seleccione el producto que va a vender.');
                if (pasoVenta === 4 && (!producto || cantidad <= 0 || cantidad > stockProducto)) return toast.error('Indique kilos dentro del saldo disponible.');
                if (pasoVenta === 4 && (!precioAutorizado || cargandoPrecio || precioFueraDeRango)) return toast.error(`El precio debe respetar el rango autorizado de ${fmtCRC(precioMinimo)} a ${fmtCRC(precioMaximo)} por kg.`);
                if (pasoVenta === 4 && (descuento < 0 || descuento > descuentoPermitido)) return toast.error(`El descuento máximo permitido es ${fmtCRC(descuentoPermitido)}.`);
                setPasoVenta(pasoVenta === 1 && clientePreseleccionadoDesdeEntrega && clienteId ? 3 : pasoVenta + 1);
              }} disabled={(pasoVenta === 2 && !clienteId) || (pasoVenta === 3 && !producto) || (pasoVenta === 4 && (!producto || cantidad <= 0 || cantidad > stockProducto || !precioAutorizado || cargandoPrecio || precioFueraDeRango || descuento < 0 || descuento > descuentoPermitido))} className="min-h-12 flex-1 rounded-xl px-4 text-sm font-extrabold disabled:opacity-50" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>{pasoVenta === 4 && precioFueraDeRango ? 'Ajuste el precio autorizado' : 'Continuar'}</button>}
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
                  Este paso registra la devolución física de los kilos al camión{devSel.cobro === 'Credito' ? ' y deja pendiente el ajuste del crédito' : ''}. La anulación del documento se completa cuando Bodega confirma la recepción. Confirme solo si el producto regresa físicamente.
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
      {selectorDocumentoAbierto && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setSelectorDocumentoAbierto(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="tipo-documento-titulo" className="w-full max-w-sm rounded-2xl p-5 shadow-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><h2 id="tipo-documento-titulo" className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Tipo de documento</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Seleccione cómo registrar esta operación.</p></div>
              <button type="button" onClick={() => setSelectorDocumentoAbierto(false)} aria-label="Cerrar" className="rounded-lg p-2" style={{ color: 'var(--text-secondary)' }}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-2">
              {(['Factura', 'Tiquete', 'Proforma'] as const).map(tipo => <button key={tipo} type="button" onClick={() => { setTipoDocumentoRuta(tipo); setSelectorDocumentoAbierto(false); }} className="flex min-h-12 w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-bold" style={tipoDocumentoRuta === tipo ? { background: 'var(--brand-primary-soft)', borderColor: 'var(--brand-primary)', color: 'var(--brand-primary-dark)' } : { background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><span>{tipo === 'Factura' ? 'Factura electrónica' : tipo === 'Tiquete' ? 'Tiquete electrónico' : 'Proforma'}</span>{tipoDocumentoRuta === tipo && <CheckCircle2 className="h-5 w-5" />}</button>)}
            </div>
          </section>
        </div>
      )}
      {solicitudClienteAbierta && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/55 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !enviandoSolicitudCliente) setSolicitudClienteAbierta(false); }}>
          <form role="dialog" aria-modal="true" aria-labelledby="solicitud-cliente-titulo" onSubmit={solicitarAltaCliente} className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border p-5 shadow-2xl" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
            <div className="flex items-start justify-between gap-3">
              <div><h2 id="solicitud-cliente-titulo" className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Solicitar cliente nuevo</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Ruta: {nombreRutaAsignada}. Administración debe aprobarlo antes de incorporarlo y venderle.</p></div>
              <button type="button" onClick={() => setSolicitudClienteAbierta(false)} disabled={enviandoSolicitudCliente} aria-label="Cerrar" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ color: 'var(--text-secondary)' }}><X className="h-5 w-5" /></button>
            </div>
            <label className="block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Nombre del cliente *
              <input required autoFocus maxLength={160} value={borradorCliente.nombre} onChange={event => setBorradorCliente(prev => ({ ...prev, nombre: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-base font-normal" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Tipo de identificación
                <select value={borradorCliente.tipo_documento} onChange={event => setBorradorCliente(prev => ({ ...prev, tipo_documento: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm font-normal" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><option value="Fisica">Física</option><option value="Juridica">Jurídica</option><option value="DIMEX">DIMEX</option><option value="NITE">NITE</option></select>
              </label>
              <label className="block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Identificación
                <input maxLength={40} value={borradorCliente.documento_id} onChange={event => setBorradorCliente(prev => ({ ...prev, documento_id: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-base font-normal" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
              </label>
              <label className="block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Teléfono
                <input type="tel" maxLength={40} value={borradorCliente.telefono} onChange={event => setBorradorCliente(prev => ({ ...prev, telefono: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-base font-normal" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
              </label>
              <label className="block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Correo
                <input type="email" maxLength={160} value={borradorCliente.email} onChange={event => setBorradorCliente(prev => ({ ...prev, email: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-base font-normal" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
              </label>
            </div>
            <label className="block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Dirección
              <input maxLength={240} value={borradorCliente.direccion} onChange={event => setBorradorCliente(prev => ({ ...prev, direccion: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-base font-normal" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
            </label>
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setSolicitudClienteAbierta(false)} disabled={enviandoSolicitudCliente} className="min-h-11 rounded-xl border px-4 text-sm font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>Cancelar</button>
              <button type="submit" disabled={enviandoSolicitudCliente || !borradorCliente.nombre.trim()} className="min-h-11 rounded-xl px-4 text-sm font-extrabold disabled:opacity-50" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>{enviandoSolicitudCliente ? 'Enviando solicitud…' : 'Enviar a Administración'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
