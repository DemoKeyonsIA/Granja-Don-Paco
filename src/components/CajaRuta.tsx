import React, { useState, useEffect, useCallback } from 'react';
import { Truck, PackageOpen, User as UserIcon, Banknote, CreditCard, RotateCcw, Printer, CheckCircle2, X } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface CajaRutaProps {
  currentUser: User;
}

const fmtCRC = (n: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n || 0);
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });

export default function CajaRuta({ currentUser }: CajaRutaProps) {
  const [guias, setGuias] = useState<any[]>([]);
  const [camiones, setCamiones] = useState<any[]>([]);
  const [guiaId, setGuiaId] = useState<string>('');
  const [guia, setGuia] = useState<any>(null);
  const [stockCamion, setStockCamion] = useState<any[]>([]);
  const [catalogo, setCatalogo] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // POS state
  const [clienteId, setClienteId] = useState<string>('');
  const [producto, setProducto] = useState<string>('');
  const [etiquetaId, setEtiquetaId] = useState<string>('');
  const [cantidad, setCantidad] = useState<number>(1);
  const [descuento, setDescuento] = useState<number>(0);
  const [cobro, setCobro] = useState<'Efectivo' | 'Credito'>('Efectivo');
  const [tiquete, setTiquete] = useState<any>(null);
  const [ventas, setVentas] = useState<any[]>([]);
  const [modoDevolucion, setModoDevolucion] = useState(false);
  const [devSel, setDevSel] = useState<any>(null);
  const [cuadre, setCuadre] = useState<any>(null);

  const fetchBase = useCallback(async () => {
    try {
      const [guiRes, camRes, catRes] = await Promise.all([
        fetch('/api/logistica/guias-activas'),
        fetch('/api/logistica/camiones'),
        fetch('/api/productos-catalogo')
      ]);
      const g = guiRes.ok ? await guiRes.json() : [];
      const c = camRes.ok ? await camRes.json() : [];
      const cat = catRes.ok ? await catRes.json() : [];
      setGuias(g);
      setCamiones(c);
      setCatalogo(cat);

      // Auto-selecciona la guía del camión del vendedor (o la primera activa)
      if (g.length > 0) {
        const camionVendedor = c.find((cam: any) => cam.vendedor_id === currentUser.id);
        const elegida = camionVendedor ? g.find((gg: any) => gg.camionId === camionVendedor.id) : g[0];
        if (elegida) setGuiaId(elegida.id);
      }
    } catch { toast.error('Error al cargar datos de la caja.'); }
  }, [currentUser.id]);

  const loadGuia = useCallback(async (id: string) => {
    if (!id) { setGuia(null); return; }
    try {
      const [detRes, invRes] = await Promise.all([
        fetch(`/api/logistica/guias/${id}`),
        fetch('/api/inventario')
      ]);
      if (detRes.ok) {
        const det = await detRes.json();
        setGuia(det);
        setVentas((det.ventas || []).slice().sort((a: any, b: any) => String(a.tiqueteConsecutivo).localeCompare(String(b.tiqueteConsecutivo))));
        setStockCamion((await invRes.json()).filter((i: any) => i.ubicacion === det.camionNombre));
      }
    } catch { toast.error('Error al cargar la guía.'); }
  }, []);

  useEffect(() => { fetchBase(); }, [fetchBase]);
  useEffect(() => { loadGuia(guiaId); }, [guiaId, loadGuia]);
  useEffect(() => {
    if (!tiquete) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTiquete(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tiquete]);

  const productosDisponibles = stockCamion.filter((i: any) => Number(i.cantidad) > 0);
  const precioCatalogo = (prod: string) => catalogo.find((c: any) => c.nombre === prod)?.precioBase || 0;
  const subtotal = Number(cantidad) * (precioCatalogo(producto) || 0);
  const total = Math.max(0, subtotal - Number(descuento || 0));

  const etiquetasDisponibles = (guia?.detalle || []).filter((e: any) => e.estadoEtiqueta === 'Cargada');

  const resetPos = () => {
    setClienteId(''); setEtiquetaId(''); setCantidad(1); setDescuento(0); setCobro('Efectivo');
  };

  const vender = async () => {
    if (!guiaId) return toast.error('Seleccione una guía activa');
    if (!producto) return toast.error('Seleccione un producto');
    if (!clienteId) return toast.error('Seleccione un cliente');
    if (!cantidad || cantidad <= 0) return toast.error('Indique una cantidad');
    setLoading(true);
    try {
      const res = await fetch('/api/logistica/caja/venta', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({
          guiaId, clienteId,
          etiquetaId: etiquetaId || undefined,
          producto, cartones: cantidad, descuento: descuento || undefined, cobro
        })
      });
      if (res.ok) {
        const data = await res.json();
        setTiquete(data);
        setVentas(prev => [...prev, { ...data, estado: 'Emitida' }].sort((a: any, b: any) => String(a.tiqueteConsecutivo).localeCompare(String(b.tiqueteConsecutivo))));
        toast.success(`Tiquete ${data.tiqueteConsecutivo} emitido`);
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
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({ guiaId, etiquetaId: etiquetaIdSel, ventaRutaId: ventaRutaId || undefined, responsable: currentUser.name })
      });
      if (res.ok) {
        const d = await res.json();
        const cartones = Number(d.cartones || 0);
        toast.success(cartones > 0
          ? (d.tiqueteAnulado ? `Devolución registrada: ${cartones} ct devueltos al camión (tiquete ${d.tiqueteAnulado} anulado)` : `Devolución registrada: ${cartones} ct devueltos al camión`)
          : 'Devolución registrada');
        setVentas(prev => ventaRutaId
          ? prev.map(v => v.ventaId === ventaRutaId ? { ...v, estado: 'Anulada' } : v)
          : prev);
        await loadGuia(guiaId);
      } else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const finDia = async () => {
    if (!guiaId) return toast.error('Seleccione una guía activa');
    const ok = window.confirm('¿Terminar el día? No podrá emitir más tiquetes hasta el cuadre en central. Esta acción es irreversible.');
    if (!ok) return;
    setLoading(true);
    try {
      const res = await fetch('/api/logistica/caja/fin-dia', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({ guiaId, responsable: currentUser.name })
      });
      if (res.ok) { const d = await res.json(); setCuadre(d.cuadre); toast.success('Día cerrado: ventas bloqueadas hasta cuadre en central'); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const cajaCerrada = Boolean(guia?.finDiaFecha);
  const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
  const clientesRuta = (guia?.rutaOrden || []).length > 0 ? guia.rutaOrden : (guia?.clientesRuta || []);

  return (
    <div className="space-y-4">
      {/* Cabecera: guía activa */}
      <div className="rounded-2xl p-4 flex flex-wrap items-center gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        <div className="flex-1 min-w-[200px]">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Guía activa</p>
          <select
            value={guiaId}
            onChange={(e) => setGuiaId(e.target.value)}
            className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none"
            style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
          >
            <option value="">Seleccione guía…</option>
            {guias.map((g: any) => (
              <option key={g.id} value={g.id}>
                {g.consecutivo} — {g.camionNombre} ({g.estado})
              </option>
            ))}
          </select>
        </div>
        {guia && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Camión</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{guia.camionNombre}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Cargado</p>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{guia.totalCartones} ct</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Stock camión</p>
              <p className="text-sm font-bold" style={{ color: 'var(--brand-primary)' }}>{productosDisponibles.reduce((a, i: any) => a + Number(i.cantidad), 0)} ct</p>
            </div>
          </div>
        )}
      </div>

      {cajaCerrada && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
          <X className="w-5 h-5 shrink-0" />
          <p className="text-sm font-semibold">Caja cerrada ({fmtHora(guia.finDiaFecha)}). No se pueden emitir más tiquetes hasta el cuadre en central.</p>
        </div>
      )}

      {/* Tiquete emitido */}
      {tiquete && (
        <div className="rounded-2xl p-4 flex items-start justify-between gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--status-success)' }}>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Tiquete impreso</p>
            <p className="text-2xl font-extrabold" style={{ color: 'var(--brand-primary)' }}>{tiquete.tiqueteConsecutivo}</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{tiquete.producto} × {tiquete.cartones} ct — {fmtCRC(tiquete.total)}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtHora(tiquete.fechaHora)} · {tiquete.cobro}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="p-2 rounded-xl" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }} title="Imprimir">
              <Printer className="w-4 h-4" />
            </button>
            <button onClick={() => setTiquete(null)} className="p-2 rounded-xl" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {!guia ? (
        <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <Truck className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Sin guía activa. El despachador debe crear una guía para vender en ruta.</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-5 gap-4">
          {/* Columna izquierda: cliente + producto */}
          <div className="lg:col-span-3 space-y-4">
            {/* Clientes */}
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                <UserIcon className="w-3.5 h-3.5" /> Clientes de la ruta
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {clientesRuta.map((c: any) => (
                  <button
                    key={c.clienteId}
                    onClick={() => setClienteId(c.clienteId)}
                    className={cn('rounded-xl px-3 py-3 text-left text-sm font-bold transition-all border', clienteId === c.clienteId && 'ring-2')}
                    style={clienteId === c.clienteId
                      ? { background: 'var(--brand-primary)', color: 'var(--text-inverse)', borderColor: 'var(--brand-primary)' }
                      : { background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}
                  >
                    {c.nombre}
                    {c.ventanaIni && <span className="block text-[10px] font-medium opacity-80">{c.ventanaIni}–{c.ventanaFin}</span>}
                  </button>
                ))}
              </div>
              {clientesRuta.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin clientes asignados a la ruta. Asígnele clientes al camión o déjelo sin selecccionar para vender libremente.</p>
              )}
            </div>

            {/* Producto + cantidad */}
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                <PackageOpen className="w-3.5 h-3.5" /> Producto del camión
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                {productosDisponibles.map((i: any) => (
                  <button
                    key={i.id}
                    onClick={() => { setProducto(i.producto); setEtiquetaId(''); }}
                    className={cn('rounded-xl px-3 py-3 text-sm font-bold border transition-all', producto === i.producto && 'ring-2')}
                    style={producto === i.producto
                      ? { background: 'var(--brand-primary)', color: 'var(--text-inverse)', borderColor: 'var(--brand-primary)' }
                      : { background: 'var(--bg-muted)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}
                  >
                    {i.producto}
                    <span className="block text-[10px] font-medium opacity-80">{i.cantidad} ct — {fmtCRC(precioCatalogo(i.producto))}</span>
                  </button>
                ))}
              </div>

              {/* Etiqueta (opcional): galerón completo */}
              {etiquetasDisponibles.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Galón por etiqueta (opcional)</p>
                  <div className="flex flex-wrap gap-2">
                    {etiquetasDisponibles.map((e: any) => (
                      <button
                        key={e.etiquetaId}
                        onClick={() => { setEtiquetaId(e.etiquetaId); setProducto(e.producto); setCantidad(Number(e.cartones)); }}
                        className={cn('px-3 py-2 rounded-xl text-xs font-bold border transition-all', etiquetaId === e.etiquetaId && 'ring-2')}
                        style={etiquetaId === e.etiquetaId
                          ? { background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' }
                          : { background: 'var(--bg-muted)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}
                      >
                        #{e.codigoUnico} — {e.producto} ({e.cartones} ct)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Cantidad (cartones)</p>
                  <input
                    type="number" min={1} value={cantidad}
                    onChange={(e) => setCantidad(Number(e.target.value) || 0)}
                    className="w-28 rounded-xl px-3 py-2 text-xl font-extrabold focus:outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Descuento (₡)</p>
                  <input
                    type="number" min={0} value={descuento}
                    onChange={(e) => setDescuento(Number(e.target.value) || 0)}
                    className="w-28 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  />
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Total</p>
                  <p className="text-2xl font-extrabold" style={{ color: 'var(--text-primary)' }}>{fmtCRC(total)}</p>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>subtotal {fmtCRC(subtotal)}</p>
                </div>
              </div>
            </div>

            {/* Cobro + accion */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setCobro('Efectivo')}
                  className={cn('flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold border transition-all')}
                  style={cobro === 'Efectivo'
                    ? { background: 'var(--status-success)', color: '#fff', borderColor: 'transparent' }
                    : { background: 'var(--bg-muted)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}
                >
                  <Banknote className="w-4 h-4" /> EFECTIVO
                </button>
                <button onClick={() => setCobro('Credito')}
                  className={cn('flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold border transition-all')}
                  style={cobro === 'Credito'
                    ? { background: 'var(--brand-primary)', color: 'var(--text-inverse)', borderColor: 'transparent' }
                    : { background: 'var(--bg-muted)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}
                >
                  <CreditCard className="w-4 h-4" /> CRÉDITO
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setModoDevolucion(true)}
                  disabled={loading || cajaCerrada}
                  className="flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold disabled:opacity-50"
                  style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                  <RotateCcw className="w-4 h-4" /> DEVOLVER
                </button>
                <button onClick={vender} disabled={loading || cajaCerrada}
                  className="flex items-center justify-center gap-2 rounded-xl px-3 py-4 text-base font-extrabold disabled:opacity-50"
                  style={{ background: 'var(--status-success)', color: '#fff', boxShadow: '0 4px 14px rgba(34,197,94,0.35)' }}>
                  <CheckCircle2 className="w-5 h-5" /> VENDER
                </button>
              </div>
            </div>
          </div>

          {/* Columna derecha: tiquetes del día + terminar día */}
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Tiquetes del día</p>
              {emitidas.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aún no se emiten tiquetes.</p>
              ) : (
                <div className="space-y-2">
                  {emitidas.map((v: any) => (
                    <div key={v.ventaId} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                      <div>
                        <p className="text-sm font-extrabold" style={{ color: 'var(--brand-primary)' }}>{v.tiqueteConsecutivo}</p>
                        <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{v.producto} × {v.cartones} — {fmtHora(v.fechaHora)}</p>
                      </div>
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmtCRC(v.total)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={finDia}
              disabled={loading || cajaCerrada}
              className="w-full flex items-center justify-center gap-2 rounded-xl px-3 py-4 text-sm font-extrabold disabled:opacity-50"
              style={{ background: 'var(--status-danger)', color: '#fff' }}>
              TERMINAR DÍA (cuadre y bloqueo)
            </button>

            {/* Cuadre de fin de día */}
            {cuadre && (
              <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--status-danger)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--status-danger)' }}>Cuadre del día</p>
                <dl className="space-y-1.5 text-sm">
                  {[
                    ['Tiquetes emitidos', cuadre.tiquetesEmitidos],
                    ['Tiquetes anulados', cuadre.tiquetesAnulados],
                    ['Cartones vendidos', `${cuadre.cartonesVendidos} / ${cuadre.cartonesCargados}`],
                    ['Efectivo', fmtCRC(cuadre.totalEfectivo)],
                    ['Crédito', fmtCRC(cuadre.totalCredito)],
                    ['Retornados', `${cuadre.cartonesRetornados} ct`],
                    ['Restante camión', `${cuadre.restanteCamion} ct`],
                    ['Merma preliminar', `${cuadre.mermaPreliminar} ct`],
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

      {/* Modal devolución */}
      {/* Modal devolución */}
      {modoDevolucion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => { setDevSel(null); setModoDevolucion(false); }} />
          <div className="relative w-full max-w-md rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-extrabold" style={{ color: 'var(--text-primary)' }}>{devSel ? 'Confirmar devolución' : 'Registrar devolución'}</p>
              <button onClick={() => { setDevSel(null); setModoDevolucion(false); }} className="p-1 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {devSel ? (
              <div className="space-y-4">
                <div className="rounded-xl px-4 py-3" style={{ background: 'var(--status-danger-soft)', border: '1px solid var(--status-danger)' }}>
                  <p className="text-sm font-bold" style={{ color: 'var(--status-danger)' }}>Tiquete {devSel.tiqueteConsecutivo} — {devSel.producto} × {devSel.cartones} ct</p>
                  <p className="text-sm font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{fmtCRC(devSel.total)}</p>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  La devolución devolverá los cartones al camión{devSel.cobro === 'Credito' ? ' y anulará el crédito' : ''}. ¿Desea continuar?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setDevSel(null)} className="rounded-xl px-3 py-3 text-sm font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                    Volver
                  </button>
                  <button onClick={() => { devolver(devSel.etiquetaId, devSel.ventaId); setDevSel(null); setModoDevolucion(false); }}
                    className="rounded-xl px-3 py-3 text-sm font-extrabold disabled:opacity-50" disabled={loading} style={{ background: 'var(--status-danger)', color: '#fff' }}>
                    CONFIRMAR DEVOLUCIÓN
                  </button>
                </div>
              </div>
            ) : emitidas.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No hay tiquetes emitidos para devolver.</p>
            ) : (
              <div className="space-y-2">
                {emitidas.map((v: any) => (
                  <button
                    key={v.ventaId}
                    onClick={() => setDevSel(v)}
                    className="w-full flex items-center justify-between rounded-xl px-3 py-3 text-sm"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  >
                    <span className="font-bold">{v.tiqueteConsecutivo} — {v.producto} × {v.cartones}</span>
                    <span className="font-bold" style={{ color: 'var(--status-danger)' }}>{fmtCRC(v.total)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}