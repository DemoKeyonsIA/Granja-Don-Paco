import React, { useState, useEffect } from 'react';
import { Truck, Check, ChevronLeft, ChevronRight, X, Package, AlertCircle, DollarSign } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { BloqueCarga, SpinnerConTexto } from './Spinner';
import { sessionHeaders } from '../lib/session';
import RegistroGasto from './RegistroGasto';

type CargaItem = { trasladoId: string; granjaOrigenId?: string; producto: string; cantidad: number; unidad: string };
type Carga = {
  cargaId: string;
  camionId?: string;
  camionNombre?: string;
  camionPlaca?: string;
  camioneroId?: string;
  camioneroNombre?: string;
  creadoPorNombre?: string;
  creadoPorId?: string;
  fechaSalida: string;
  estado: string;
  motivoRechazo?: string;
  items: CargaItem[];
};

interface Props { currentUser: User; }

type GuiaActiva = {
  id: string;
  consecutivo?: string;
  estado?: string;
  estadoLogico?: string;
  camionNombre?: string;
  rutaNombre?: string;
  totalKg?: number | null;
  totalCartones?: number;
  detalle?: Array<{ producto?: string; pesoNeto?: number | string | null; saldoKg?: number | string | null; cantidad?: number | string; cartones?: number | string; unidad?: string }>;
  ventas?: Array<{ producto?: string; cantidadKg?: number | string; cartones?: number | string; unidad?: string; estado?: string }>;
};

export default function CamioneroMovil({ currentUser }: Props) {
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Carga | null>(null);
  const [motivo, setMotivo] = useState('');
  const [sendingAction, setSendingAction] = useState<'confirm' | 'reject' | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [guiaActiva, setGuiaActiva] = useState<GuiaActiva | null>(null);
  const [inventarioCamion, setInventarioCamion] = useState<any[]>([]);
  const [gastoAbierto, setGastoAbierto] = useState(false);

  const fetchCargas = async () => {
    try {
      const [cargasRes, guiasRes] = await Promise.all([
        fetch('/api/operaciones/cargas', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/logistica/guias-activas', { headers: sessionHeaders(currentUser.id) }),
      ]);
      if (cargasRes.ok) setCargas(await cargasRes.json());
      if (guiasRes.ok) {
        const guias: GuiaActiva[] = await guiasRes.json();
        // Una guía activa representa la única ruta que el vendedor puede atender.
        // En caso de datos históricos inconsistentes, priorizamos la que ya salió.
        const orden: Record<string, number> = { EnRuta: 0, Cargada: 1, Preparada: 2 };
        const activa = guias.filter(g => !['Cerrada', 'Anulada'].includes(g.estado || ''))
          .sort((a, b) => (orden[a.estado || ''] ?? 9) - (orden[b.estado || ''] ?? 9))[0];
        if (activa) {
          const detalleRes = await fetch(`/api/logistica/guias/${activa.id}`, { headers: sessionHeaders(currentUser.id) });
          if (detalleRes.ok) {
            const detalle = await detalleRes.json();
            setGuiaActiva(detalle);
            const invRes = await fetch('/api/inventario', { headers: sessionHeaders(currentUser.id) });
            if (invRes.ok) setInventarioCamion((await invRes.json()).filter((i: any) => i.ubicacion === detalle.camionNombre));
            else setInventarioCamion([]);
          }
          else setGuiaActiva(activa);
        } else { setGuiaActiva(null); setInventarioCamion([]); }
      }
    } catch { toast.error('Error cargando cargas'); }
    setLoading(false);
  };

  useEffect(() => { fetchCargas(); }, [currentUser.id]);

  const pendientes = cargas.filter(c => c.estado === 'Pendiente');
  const enTransito = cargas.filter(c => c.estado === 'EnTransito');
  const historial = cargas.filter(c => c.estado === 'Rechazada' || c.estado === 'Recibido' || c.estado === 'RecibidoConDiferencia');

  const handleConfirmar = async () => {
    if (!selected) return;
    setSendingAction('confirm');
    try {
      const res = await fetch(`/api/operaciones/carga/${selected.cargaId}/confirmar`, {
        method: 'POST',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ camioneroId: currentUser.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al confirmar');
      toast.success(data.message);
      setSelected(null);
      setLoading(true);
      await fetchCargas();
    } catch (err: any) { toast.error(err.message); }
    finally { setSendingAction(null); }
  };

  const handleRechazar = async () => {
    if (!selected || !motivo.trim()) return;
    setSendingAction('reject');
    try {
      const res = await fetch(`/api/operaciones/carga/${selected.cargaId}/rechazar`, {
        method: 'POST',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ camioneroId: currentUser.id, motivo: motivo.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al rechazar');
      toast.success(data.message);
      setSelected(null);
      setShowReject(false);
      setMotivo('');
      setLoading(true);
      await fetchCargas();
    } catch (err: any) { toast.error(err.message); }
    finally { setSendingAction(null); }
  };

  const totalItems = (c: Carga) => c.items.reduce((s, i) => s + i.cantidad, 0);
  const saldoRuta = (() => {
    if (!guiaActiva) return [] as Array<{ producto: string; inicial: number; actual: number; unidad: string }>;
    const iniciales = new Map<string, { inicial: number; unidad: string }>();
    for (const item of guiaActiva.detalle || []) {
      const producto = String(item.producto || 'Producto');
      const unidad = String(item.unidad || 'kg');
      const cantidad = Number(item.pesoNeto ?? item.cantidad ?? item.cartones ?? 0) || 0;
      const previo = iniciales.get(producto);
      iniciales.set(producto, { inicial: (previo?.inicial || 0) + cantidad, unidad });
    }
    if (!iniciales.size && Number(guiaActiva.totalKg ?? guiaActiva.totalCartones) > 0) {
      iniciales.set('Carga total', { inicial: Number(guiaActiva.totalKg ?? guiaActiva.totalCartones), unidad: guiaActiva.totalKg != null ? 'kg' : 'cartones' });
    }
    const vendidos = new Map<string, number>();
    for (const venta of guiaActiva.ventas || []) {
      if (venta.estado === 'Anulada') continue;
      const producto = String(venta.producto || 'Producto');
      vendidos.set(producto, (vendidos.get(producto) || 0) + (Number(venta.cantidadKg ?? venta.cartones) || 0));
    }
    const disponible = new Map<string, number>();
    for (const item of inventarioCamion) {
      const producto = String(item.producto || 'Producto');
      disponible.set(producto, (disponible.get(producto) || 0) + (Number(item.cantidad) || 0));
    }
    return [...iniciales].map(([producto, carga]) => ({ producto, inicial: carga.inicial, actual: disponible.has(producto) ? Math.max(0, disponible.get(producto)!) : Math.max(0, carga.inicial - (vendidos.get(producto) || 0)), unidad: String(inventarioCamion.find((i: any) => i.producto === producto)?.unidad || carga.unidad) }));
  })();

  if (loading) {
    return (
      <BloqueCarga className="min-h-[60vh]" />
    );
  }

  // ============ DETALLE DE CARGA ============
  if (selected) {
    return (
      <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
        <button onClick={() => { setSelected(null); setShowReject(false); setMotivo(''); }}
          className="flex items-center gap-1 text-sm font-semibold mb-4"
          style={{ color: 'var(--brand-primary)' }}>
          <ChevronLeft className="w-4 h-4" /> Volver a cargas
        </button>
        <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
          Detalle de carga
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          {selected.estado === 'Pendiente' ? 'Confirma o rechaza esta carga' : `Estado: ${selected.estado}`}
        </p>

        <div className="rounded-2xl p-5 space-y-3 mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <Row label="Camión" value={selected.camionNombre || 'Sin asignar'} />
          {selected.camionPlaca && <Row label="Placa" value={selected.camionPlaca} />}
          {selected.creadoPorNombre && <Row label="Solicitado por" value={selected.creadoPorNombre} />}
          <Row label="Fecha" value={new Date(selected.fechaSalida).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} />
          {selected.motivoRechazo && <Row label="Motivo rechazo" value={selected.motivoRechazo} />}
          <div className="border-t pt-3" style={{ borderColor: 'var(--border-default)' }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Productos</p>
            <div className="space-y-2">
              {selected.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center py-2 px-3 rounded-lg" style={{ background: 'var(--bg-muted)' }}>
                  <div>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{item.producto}</p>
                    {item.granjaOrigenId && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Granja: {item.granjaOrigenId.slice(0, 8)}</p>}
                  </div>
                  <span className="text-sm font-black" style={{ color: 'var(--brand-primary)' }}>{item.cantidad} <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{item.unidad}</span></span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t pt-3 flex justify-between items-center" style={{ borderColor: 'var(--border-default)' }}>
            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Total</span>
            <span className="text-2xl font-black" style={{ color: 'var(--brand-primary)' }}>{totalItems(selected)}</span>
          </div>
        </div>

        {selected.estado === 'Pendiente' && (
          <>
            {/* Regla: no puede confirmar si creó la carga */}
            {selected.creadoPorId === currentUser.id ? (
              <div className="p-4 rounded-2xl mb-4 flex items-start gap-3" style={{ background: 'var(--status-warning-soft)', border: '1px solid var(--status-warning)' }}>
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--status-warning)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--status-warning)' }}>
                  Tú creaste esta solicitud. No puedes confirmar o rechazar tu propia carga.
                </p>
              </div>
            ) : (
              <>
                <button onClick={handleConfirmar}
                  disabled={sendingAction === 'confirm'}
                  className="w-full min-h-14 py-4 rounded-2xl text-lg font-black transition-all active:scale-[0.97] disabled:opacity-60"
                  style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)', boxShadow: 'var(--shadow-md)' }}>
                  {sendingAction === 'confirm' ? (
                    <SpinnerConTexto tamano="md" className="justify-center">Confirmando...</SpinnerConTexto>
                  ) : (
                    <span className="flex items-center justify-center gap-2"><Check className="w-5 h-5" /> Confirmar carga</span>
                  )}
                </button>
                <button onClick={() => setShowReject(true)}
                  className="w-full min-h-12 mt-3 py-3 rounded-2xl text-base font-bold transition-all"
                  style={{ color: 'var(--status-danger)', background: 'var(--status-danger-soft)' }}>
                  Rechazar esta carga
                </button>
              </>
            )}

            {showReject && (
              <div className="mt-4 p-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <p className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Motivo del rechazo</p>
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)}
                  placeholder="Ej: Cantidad no coincide, producto equivocado..."
                  rows={3}
                  className="w-full p-3 rounded-xl text-sm outline-none resize-none"
                  style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setShowReject(false); setMotivo(''); }}
                    className="flex-1 min-h-12 py-3 rounded-xl text-sm font-bold" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
                  <button onClick={handleRechazar}
                    disabled={!motivo.trim() || sendingAction === 'reject'}
                    className="flex-1 min-h-12 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                    style={{ background: 'var(--brand-danger)', color: '#10122A' }}>
                    {sendingAction === 'reject' ? 'Rechazando...' : 'Confirmar rechazo'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {(selected.estado === 'EnTransito' || selected.estado === 'Recibido' || selected.estado === 'RecibidoConDiferencia' || selected.estado === 'Rechazada') && (
          <div className="p-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
              {selected.estado === 'EnTransito' && 'Carga confirmada y en tránsito a bodega'}
              {selected.estado === 'Recibido' && 'Carga recibida correctamente en bodega'}
              {selected.estado === 'RecibidoConDiferencia' && 'Carga recibida con diferencia en bodega'}
              {selected.estado === 'Rechazada' && `Carga rechazada: ${selected.motivoRechazo || 'Sin motivo'}`}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ============ RUTA ACTIVA Y CONFIRMACIÓN DE CARGA ============
  return (
    <div className="max-w-3xl mx-auto px-4 pt-4 pb-24 animate-in fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>Mi ruta</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Consulta tu ruta asignada y los kilos disponibles.</p>
        </div>
        <button type="button" onClick={() => setGastoAbierto(true)}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 font-bold"
          style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
          <DollarSign className="w-5 h-5" /> Registrar gasto
        </button>
      </div>

      {guiaActiva ? (
        <section className="rounded-2xl p-5 mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Ruta asignada</p>
              <h3 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>{guiaActiva.rutaNombre || guiaActiva.consecutivo || guiaActiva.camionNombre || 'Ruta activa'}</h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{guiaActiva.camionNombre || ''}</p>
            </div>
            <span className="rounded-full px-3 py-1 text-sm font-bold" style={{ background: 'var(--status-success-soft)', color: 'var(--status-success)' }}>{guiaActiva.estadoLogico || guiaActiva.estado || 'Activa'}</span>
          </div>
          {saldoRuta.length ? <div className="space-y-3">
            {saldoRuta.map(item => <div key={item.producto} className="rounded-xl p-4" style={{ background: 'var(--bg-muted)' }}>
              <p className="font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{item.producto}</p>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.unidad === 'kg' ? 'Kilos al salir' : `Cantidad inicial (${item.unidad})`}</p><p className="text-xl font-black" style={{ color: 'var(--text-primary)' }}>{item.inicial.toFixed(2)} {item.unidad}</p></div>
                <div><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.unidad === 'kg' ? 'Kilos disponibles ahora' : `Disponible ahora (${item.unidad})`}</p><p className="text-xl font-black" style={{ color: 'var(--brand-primary)' }}>{item.actual.toFixed(2)} {item.unidad}</p></div>
              </div>
            </div>)}
          </div> : <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>La guía activa todavía no tiene detalle de productos.</p>}
        </section>
      ) : (
        <section className="rounded-2xl p-6 mb-6 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}><Truck className="w-7 h-7" /></div>
          <p className="font-bold" style={{ color: 'var(--text-primary)' }}>No tienes una ruta activa</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Cuando Administración te asigne una ruta, aquí verás la carga y el saldo disponible.</p>
        </section>
      )}

      {pendientes.length > 0 && <p className="px-1 text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Confirma la carga para iniciar la ruta</p>}

      {/* Pendientes */}
      {pendientes.length > 0 && (
        <div className="mb-6">
          <p className="px-1 text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Pendientes de confirmación</p>
          <div className="space-y-3">
            {pendientes.map(c => (
              <button key={c.cargaId} onClick={() => setSelected(c)}
                className="w-full text-left p-5 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.97]"
                style={{ background: 'var(--bg-card)', border: '2px solid var(--status-warning)' }}>
                <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }}>
                  <Truck className="w-7 h-7" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{c.camionNombre || 'Sin camión'}</p>
                  {c.creadoPorNombre && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Solicitado por: {c.creadoPorNombre}</p>}
                  <p className="text-sm mt-1" style={{ color: 'var(--brand-primary)' }}>{totalItems(c)} unidades · {c.items.length} producto{c.items.length !== 1 ? 's' : ''}</p>
                </div>
                <ChevronRight className="w-6 h-6 shrink-0" style={{ color: 'var(--status-warning)' }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {gastoAbierto && <RegistroGasto currentUser={currentUser} initialGuideId={guiaActiva?.id} onClose={() => setGastoAbierto(false)} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
