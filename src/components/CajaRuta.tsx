import React, { useState, useEffect, useCallback } from 'react';
import { Truck, PackageOpen, User as UserIcon, Banknote, CreditCard, ArrowLeftRight, RotateCcw, Printer, CheckCircle2, X, AlertTriangle, Minus, Plus, Eye } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { sessionHeaders } from '../lib/session';
import AccionFijaMovil from './AccionFijaMovil';
import RegistroGasto from './RegistroGasto';

interface CajaRutaProps {
  currentUser: User;
  initialGuideId?: string;
  onClose?: () => void;
}

const fmtCRC = (n: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n || 0);
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });

export default function CajaRuta({ currentUser, initialGuideId, onClose }: CajaRutaProps) {
  const rolesUsuario = currentUser.roles?.length ? currentUser.roles : [currentUser.role];
  const puedeElegirGuia = rolesUsuario.some((role) => role === 'Admin' || role === 'Despachador');
  const [guias, setGuias] = useState<any[]>([]);
  const [camiones, setCamiones] = useState<any[]>([]);
  const [guiaId, setGuiaId] = useState<string>(initialGuideId || '');
  const [guia, setGuia] = useState<any>(null);
  const [stockCamion, setStockCamion] = useState<any[]>([]);
  const [politicaPrecio, setPoliticaPrecio] = useState<any>(null);
  const [precioNegociado, setPrecioNegociado] = useState(0);
  const [cargandoPrecio, setCargandoPrecio] = useState(false);
  const [loading, setLoading] = useState(false);

  // POS state
  const [clienteId, setClienteId] = useState<string>('');
  const [producto, setProducto] = useState<string>('');
  const [etiquetaId, setEtiquetaId] = useState<string>('');
  const [cantidad, setCantidad] = useState<number>(1);
  const [descuento, setDescuento] = useState<number>(0);
  const [cobro, setCobro] = useState<'Efectivo' | 'Credito' | 'Transferencia'>('Efectivo');
  const [tiquete, setTiquete] = useState<any>(null);
  const [previewTiqueteAbierto, setPreviewTiqueteAbierto] = useState(false);
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
  const [registrarGastoAbierto, setRegistrarGastoAbierto] = useState(false);

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
    if (!producto || !clienteId) { setPoliticaPrecio(null); setPrecioNegociado(0); return; }
    const controller = new AbortController();
    setCargandoPrecio(true);
    setPoliticaPrecio(null);
    setPrecioNegociado(0);
    fetch(`/api/precios/lookup?producto=${encodeURIComponent(producto)}&clienteId=${encodeURIComponent(clienteId)}`, { signal: controller.signal, headers: sessionHeaders(currentUser.id) })
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Precio no configurado'); setPoliticaPrecio(data); setPrecioNegociado(Number(data.precio) || 0); })
      .catch(error => { if (error.name !== 'AbortError') setPoliticaPrecio({ error: error.message }); })
      .finally(() => { if (!controller.signal.aborted) setCargandoPrecio(false); });
    return () => controller.abort();
  }, [producto, clienteId, currentUser.id]);
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
  const precioVenta = Number(precioNegociado || politicaPrecio?.precio) || 0;
  const precioAutorizado = Number(politicaPrecio?.precio) > 0 && !politicaPrecio?.error;
  const cantidadTiquete = Number(tiquete?.cantidadKg ?? tiquete?.cartones ?? 0);
  const precioUnitarioTiquete = Number(tiquete?.precioUnitario || (Number(tiquete?.subtotal ?? tiquete?.total ?? 0) / (cantidadTiquete || 1)));
  const subtotal = Number(cantidad) * precioVenta;
  const total = Math.max(0, subtotal - Number(descuento || 0));
  const precioMinimo = Number(politicaPrecio?.precioMinimo ?? politicaPrecio?.precio ?? 0);
  const precioMaximo = Number(politicaPrecio?.precioMaximo ?? politicaPrecio?.precio ?? 0);
  const descuentoPorPiso = Math.max(0, subtotal - Number(cantidad) * precioMinimo);
  const descuentoPorcentaje = Math.max(0, subtotal * Math.max(0, Number(politicaPrecio?.descuentoMaximo || 0)) / 100);
  const descuentoPermitido = Math.min(descuentoPorPiso, descuentoPorcentaje);

  const etiquetasDisponibles = (guia?.detalle || []).filter((e: any) => e.estadoEtiqueta === 'Cargada');
  const etiquetaSeleccionada = etiquetasDisponibles.find((e: any) => e.etiquetaId === etiquetaId);
  const disponibleEtiquetaKg = Number(etiquetaSeleccionada?.saldoKg ?? etiquetaSeleccionada?.pesoNeto ?? 0);
  const unidadRuta = 'kg';

  const resetPos = () => {
    setClienteId(''); setEtiquetaId(''); setCantidad(1); setDescuento(0); setCobro('Efectivo');
  };

  const vender = async () => {
    if (!guiaId) return toast.error('Seleccione una guía activa');
    if (!producto) return toast.error('Seleccione un producto');
    if (!clienteId) return toast.error('Seleccione un cliente');
    if (!etiquetaId) return toast.error('Seleccione la etiqueta de la carga física entregada');
    if (!cantidad || cantidad <= 0) return toast.error('Indique una cantidad');
    if (cantidad > disponibleEtiquetaKg) return toast.error(`La etiqueta tiene ${disponibleEtiquetaKg.toFixed(2)} kg disponibles`);
    setLoading(true);
    try {
      const res = await fetch('/api/logistica/caja/venta', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({
          guiaId, clienteId,
          etiquetaId: etiquetaId || undefined,
          producto, cantidadKg: cantidad, unidad: 'kg', precioUnitario: precioVenta, descuento: descuento || undefined, cobro
        })
      });
      if (res.ok) {
        const data = await res.json();
        setTiquete(data);
        setVentas(prev => [...prev, { ...data, estado: 'Emitida' }].sort((a: any, b: any) => String(a.tiqueteConsecutivo).localeCompare(String(b.tiqueteConsecutivo))));
        toast.success(`Tiquete de ruta ${data.tiqueteConsecutivo} emitido`);
        resetPos();
        await loadGuia(guiaId);
      } else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const devolver = async (etiquetaIdSel: string, ventaRutaId?: string) => {
    if (!guiaId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/logistica/caja/devolucion', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ guiaId, etiquetaId: etiquetaIdSel, ventaRutaId: ventaRutaId || undefined, responsable: currentUser.name })
      });
      if (res.ok) {
        const d = await res.json();
        const cantidadDevuelta = Number(d.cantidadKg ?? d.cartones ?? 0);
        toast.success(cantidadDevuelta > 0
          ? (d.tiqueteAnulado ? `Devolución registrada: ${cantidadDevuelta} kg (tiquete de ruta ${d.tiqueteAnulado} anulado)` : `Devolución registrada: ${cantidadDevuelta} kg`)
          : 'Devolución registrada');
        // La API decide si una devolución parcial conserva el tiquete emitido;
        // recargar desde el servidor evita marcarlo como anulado por defecto.
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
  const camionSeleccionado = camiones.find((cam: any) => cam.id === guia?.camionId);
  const guiaListado = guias.find((g: any) => g.id === guia?.id);
  const nombreRutaAsignada = guiaListado?.rutaNombre || camionSeleccionado?.ruta_defecto || guia?.rutaNombre || 'Ruta asignada';
  const estadoRutaLabel = guia?.estado === 'EnRuta' ? 'En ruta' : guia?.estado === 'Cargada' ? 'Lista para iniciar' : guia?.estadoLogico || guia?.estado;
  const ventaDeshabilitada = loading || cajaCerrada || cargandoPrecio || !clienteId || !producto || !politicaPrecio?.precio || Boolean(politicaPrecio?.error) || precioVenta < precioMinimo || precioVenta > precioMaximo || cantidad <= 0 || cantidad > stockProducto || descuento < 0 || descuento > descuentoPermitido;
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
      cobro: muestraGeneral ? 'Efectivo' : cobro,
      total: subtotalMuestra - descuentoMuestra,
    });
    setPreviewTiqueteAbierto(muestraGeneral);
  };

  return (
    <div className="route-pos-root space-y-4 pb-28 lg:pb-4">
      {/* Cabecera: guía activa */}
      <div className="min-w-0 rounded-2xl p-4 sm:p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>Venta en ruta</p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Registre los kilos entregados y emita el tiquete de esta entrega.</p>
          </div>
          {onClose && <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }} aria-label="Cerrar registro de venta"><X className="h-5 w-5" /></button>}
        </div>
        {guia && <button type="button" onClick={() => setRegistrarGastoAbierto(true)} disabled={!guiaId || cajaCerrada} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold disabled:opacity-50 sm:w-auto" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary-dark)', border: '1px solid var(--brand-primary-soft)' }}><Banknote className="h-5 w-5" /> Registrar gasto de esta ruta</button>}
        <div className="route-pos-header-layout">
          <div className="route-pos-assignment">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {puedeElegirGuia ? 'Ruta de trabajo' : 'Ruta asignada por Administración'}
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
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{tiquete.demo ? 'Muestra · no registra una venta' : 'Tiquete de ruta listo para imprimir'}</p>
            <p className="text-2xl font-extrabold" style={{ color: 'var(--brand-primary)' }}>{tiquete.demo ? 'VISTA PREVIA' : tiquete.tiqueteConsecutivo}</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{tiquete.producto} × {Number(tiquete.cantidadKg ?? tiquete.cartones).toFixed(2)} kg — {fmtCRC(tiquete.total)}</p>
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
            <div className="route-ticket-meta"><span><b>FECHA Y HORA</b>{fmtFechaHora(tiquete.fechaHora)}</span><span><b>CONDICIÓN</b>{tiquete.cobro === 'Credito' ? 'Crédito' : 'Contado'}</span><span><b>MEDIO DE PAGO</b>{tiquete.cobro === 'Credito' ? 'Crédito' : tiquete.cobro}</span></div>
            <section className="route-ticket-customer"><h3>CLIENTE</h3><strong>{tiquete.cliente?.nombre || 'Cliente'}</strong><div>{tiquete.cliente?.documentoId ? `Cédula: ${tiquete.cliente.documentoId}` : ''}{tiquete.cliente?.telefono ? ` · Tel.: ${tiquete.cliente.telefono}` : ''}</div><div>{[tiquete.cliente?.direccion, tiquete.cliente?.distrito, tiquete.cliente?.canton, tiquete.cliente?.provincia].filter(Boolean).join(', ')}</div></section>
            <div className="route-ticket-meta"><span><b>VENDEDOR</b>{tiquete.vendedorNombre || currentUser.name}</span><span><b>CAMIÓN</b>{tiquete.camionNombre || guia?.camionNombre || '—'}{tiquete.placa ? ` · ${tiquete.placa}` : ''}</span><span><b>GUÍA</b>{tiquete.guiaConsecutivo || guia?.consecutivo || '—'}</span></div>
            <table className="route-ticket-lines"><thead><tr><th>CANTIDAD</th><th>DESCRIPCIÓN</th><th>PRECIO / KG</th><th>TOTAL</th></tr></thead><tbody><tr><td>{cantidadTiquete.toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg</td><td>{tiquete.producto}</td><td>{fmtCRC(precioUnitarioTiquete)}</td><td>{fmtCRC(Number(tiquete.total || 0))}</td></tr></tbody></table>
            <div className="route-ticket-totals"><div><span>Subtotal</span><b>{fmtCRC(Number(tiquete.subtotal ?? tiquete.total ?? 0))}</b></div>{Number(tiquete.descuento || 0) > 0 && <div><span>Descuento</span><b>− {fmtCRC(Number(tiquete.descuento))}</b></div>}<div className="route-ticket-total"><span>TOTAL</span><strong>{fmtCRC(Number(tiquete.total || 0))}</strong></div></div>
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
      ) : (
      <div className="route-pos-layout">
          {/* Columna izquierda: cliente + producto */}
          <div className="route-pos-main min-w-0 space-y-4">
            {/* Clientes */}
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
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
            </div>

            {/* Producto + cantidad */}
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-base font-extrabold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>2</span>
                <PackageOpen className="w-4 h-4" /> Elija qué va a vender
              </p>
              <div className="route-pos-choice-grid mb-4">
                {productosDisponibles.map((i: any) => (
                  <button
                    key={i.id}
                    onClick={() => { setProducto(i.producto); setEtiquetaId(''); }}
                    aria-pressed={producto === i.producto}
                    className={cn('min-h-16 rounded-xl px-4 py-3 text-left text-base font-bold border transition-all', producto === i.producto && 'ring-2')}
                    style={producto === i.producto
                      ? { background: 'var(--brand-primary)', color: 'var(--text-on-action)', borderColor: 'var(--brand-primary)' }
                      : { background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}
                  >
                    {i.producto}
                    <span className="block mt-1 text-sm font-medium opacity-90">{i.unidad === 'kg' ? `Quedan ${Number(i.cantidad).toFixed(2)} kg` : `Unidad de inventario incompatible: ${i.unidad || 'sin definir'}`}</span>
                    <span className="block text-xs font-medium opacity-80">{producto === i.producto && politicaPrecio?.precio ? `${fmtCRC(precioVenta)} por kg` : 'Elija cliente para ver precio'}</span>
                  </button>
                ))}
              </div>

              {producto && clienteId && (
                <div className="mb-4 rounded-xl border px-3 py-2.5 text-sm" style={{ background: politicaPrecio?.error ? 'var(--status-danger-soft)' : 'var(--status-success-soft)', borderColor: politicaPrecio?.error ? 'var(--status-danger)' : 'var(--status-success)', color: politicaPrecio?.error ? 'var(--status-danger)' : 'var(--status-success)' }}>
                  {cargandoPrecio ? 'Consultando precio autorizado…' : politicaPrecio?.error ? politicaPrecio.error : politicaPrecio?.precio ? (
                    <><strong>Rango autorizado: {fmtCRC(precioMinimo)} a {fmtCRC(precioMaximo)} por kg</strong><span className="block text-xs">{politicaPrecio.listaUsada} · precio sugerido {fmtCRC(politicaPrecio.precio)} por kg</span></>
                  ) : 'Seleccione el cliente y el producto para ver el precio autorizado.'}
                </div>
              )}

              {/* Identifica la carga física de la que salen estos kilos */}
              {etiquetasDisponibles.length > 0 && (
                <div className="mb-4">
                  <p className="text-sm font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>1 · Seleccione la carga física (obligatorio)</p>
                  <div className="flex flex-wrap gap-2">
                    {etiquetasDisponibles.map((e: any) => (
                      <button
                        key={e.etiquetaId}
                        onClick={() => { setEtiquetaId(e.etiquetaId); setProducto(e.producto); }}
                        className={cn('min-h-11 px-3 py-2 rounded-xl text-xs font-bold border transition-all', etiquetaId === e.etiquetaId && 'ring-2')}
                        style={etiquetaId === e.etiquetaId
                          ? { background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' }
                          : { background: 'var(--bg-muted)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}
                      >
                        #{e.codigoUnico} — {e.producto} · {Number(e.saldoKg ?? e.pesoNeto ?? 0).toFixed(2)} kg disponibles
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="route-pos-sale-fields">
                {clienteId && producto && (cargandoPrecio || !precioAutorizado) && (
                  <div role="status" className="route-pos-price-warning rounded-xl px-3 py-2.5 text-sm" style={{ background: 'var(--status-warning-soft)', color: 'var(--status-warning)', border: '1px solid var(--status-warning)' }}>
                    <strong className="block">{cargandoPrecio ? 'Consultando precio autorizado…' : 'Precio autorizado pendiente'}</strong>
                    {!cargandoPrecio && <span>Administración debe configurar el precio de este producto para el cliente antes de emitir la venta.</span>}
                  </div>
                )}
                <div>
                  <label htmlFor="cantidad-venta" className="mb-1 block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>3 · ¿Cuántos kilos?</label>
                  <div className="flex min-h-14 items-center gap-2">
                    <button type="button" onClick={() => setCantidad(v => Math.max(0.1, Math.round((v - 1) * 100) / 100))} aria-label="Quitar un kilo" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border" style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}><Minus className="h-5 w-5" /></button>
                  <input
                    id="cantidad-venta" type="number" min={0.01} max={etiquetaSeleccionada ? disponibleEtiquetaKg : undefined} step="0.01" inputMode="decimal" value={cantidad}
                    onChange={(e) => setCantidad(Number(e.target.value) || 0)}
                    className="h-12 min-w-0 flex-1 rounded-xl px-3 py-2 text-center text-2xl font-extrabold focus:outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  />
                    <button type="button" onClick={() => setCantidad(v => Math.round((v + 1) * 100) / 100)} aria-label="Agregar un kilo" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border" style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}><Plus className="h-5 w-5" /></button>
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
                    type="number" min={precioMinimo} max={precioMaximo} step="0.01" value={precioAutorizado ? (precioVenta || '') : ''} disabled={!precioAutorizado || cargandoPrecio}
                    onChange={(e) => setPrecioNegociado(Number(e.target.value) || 0)}
                    inputMode="decimal"
                    className="h-12 w-full rounded-xl px-3 py-2 text-base font-bold focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    aria-label="Precio por kilo"
                  />
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{precioAutorizado ? `Puede cobrar entre ${fmtCRC(precioMinimo)} y ${fmtCRC(precioMaximo)}` : 'Rango autorizado: —'}</p>
                </div>
                <div>
                  <label htmlFor="descuento-venta" className="mb-1 block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Descuento total (₡)</label>
                  <input
                    id="descuento-venta"
                    type="number" min={0} value={descuento}
                    onChange={(e) => setDescuento(Number(e.target.value) || 0)}
                    inputMode="decimal"
                    className="h-12 w-full rounded-xl px-3 py-2 text-base font-bold focus:outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  />
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Máximo permitido: {fmtCRC(descuentoPermitido)}</p>
                </div>
                <div className="route-pos-total rounded-xl p-3 sm:flex sm:items-center sm:justify-between" style={{ background: 'var(--bg-muted)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Total a cobrar</p>
                  <p className="text-3xl font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtCRC(total)}</p>
                </div>
              </div>
            </div>

            {/* Cobro + accion */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-base font-extrabold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}><span className="flex h-7 w-7 items-center justify-center rounded-full text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>4</span>¿Cómo paga?</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button onClick={() => setCobro('Efectivo')}
                  aria-pressed={cobro === 'Efectivo'} className={cn('min-h-14 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-base font-bold border transition-all')}
                  style={cobro === 'Efectivo'
                    ? { background: 'var(--brand-primary)', color: 'var(--text-on-action)', borderColor: 'transparent' }
                    : { background: 'var(--bg-muted)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}
                >
                  <Banknote className="w-5 h-5" /> Efectivo
                </button>
                <button onClick={() => setCobro('Transferencia')}
                  aria-pressed={cobro === 'Transferencia'} className={cn('min-h-14 flex items-center justify-center gap-2 rounded-xl px-2 py-3 text-base font-bold border transition-all')}
                  style={cobro === 'Transferencia'
                    ? { background: 'var(--brand-primary)', color: 'var(--text-on-action)', borderColor: 'transparent' }
                    : { background: 'var(--bg-muted)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}
                >
                  <ArrowLeftRight className="w-5 h-5" /> Transferencia
                </button>
                <button onClick={() => setCobro('Credito')}
                  aria-pressed={cobro === 'Credito'} className={cn('min-h-14 flex items-center justify-center gap-2 rounded-xl px-2 py-3 text-base font-bold border transition-all')}
                  style={cobro === 'Credito'
                    ? { background: 'var(--brand-primary)', color: 'var(--text-on-action)', borderColor: 'transparent' }
                    : { background: 'var(--bg-muted)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}
                >
                  <CreditCard className="w-5 h-5" /> Crédito
                </button>
              </div>
              <button onClick={vender} disabled={ventaDeshabilitada}
                className="min-h-14 w-full flex items-center justify-center gap-2 rounded-xl px-4 py-4 text-lg font-extrabold disabled:opacity-50"
                style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
                <CheckCircle2 className="w-5 h-5" /> {precioAutorizado ? `Emitir tiquete · ${fmtCRC(total)}` : 'Precio no configurado'}
              </button>
              <button type="button" onClick={() => previsualizarTiquete()} disabled={!clienteId || !producto || cantidad <= 0}
                className="min-h-11 w-full rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>
                Vista previa del tiquete · no registra venta
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setModoDevolucion(true)}
                  disabled={loading || cajaCerrada}
                  className="min-h-12 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold disabled:opacity-50"
                  style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                  <RotateCcw className="w-4 h-4" /> Registrar devolución
                </button>
                <button onClick={() => { setEtiquetaMerma(etiquetasDisponibles[0]?.etiquetaId || ''); setModoMerma(true); }}
                  disabled={loading || cajaCerrada || etiquetasDisponibles.length === 0}
                  className="min-h-12 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold disabled:opacity-50"
                  style={{ background: 'var(--status-warning-soft)', color: 'var(--status-warning)', border: '1px solid var(--status-warning)' }}>
                  <AlertTriangle className="w-4 h-4" /> Reportar daño
                </button>
              </div>
            </div>
          </div>

          {/* Columna derecha: tiquetes del día + terminar día */}
          <div className="route-pos-sidebar min-w-0 space-y-4">
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

            {!cajaCerrada && (
              <label className="block mt-3 space-y-1.5">
                <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Efectivo contado en caja (₡)</span>
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
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Al cerrar, ya no podrá emitir más tiquetes. Cuente el efectivo primero.</p>
              <button
                onClick={finDia}
                disabled={loading || cajaCerrada || !efectivoContado.trim()}
                className="min-h-12 w-full flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-base font-bold disabled:opacity-50"
                style={{ background: 'var(--status-warning-soft)', color: 'var(--text-primary)', border: '1px solid var(--status-warning)' }}>
                Cerrar caja y terminar día
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
        </div>
      )}

      {guia && !cajaCerrada && (
        <AccionFijaMovil etiquetaAccesible="Registrar venta" className="route-pos-mobile-action">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                {clienteSeleccionado?.nombre || 'Elija cliente'} · {producto || 'Elija producto'}
              </p>
              <p className="text-xl font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtCRC(total)}</p>
            </div>
              <button onClick={vender} disabled={ventaDeshabilitada} className="min-h-12 shrink-0 rounded-xl px-4 text-base font-extrabold disabled:opacity-50" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
              Emitir tiquete
            </button>
          </div>
        </AccionFijaMovil>
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
      {registrarGastoAbierto && guiaId && <RegistroGasto currentUser={currentUser} initialGuideId={guiaId} onClose={() => { setRegistrarGastoAbierto(false); void loadGuia(guiaId); }} />}
    </div>
  );
}
