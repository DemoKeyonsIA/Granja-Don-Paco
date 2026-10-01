import React, { useState, useEffect, useCallback } from 'react';
import { Truck, Users, Map, Clock, Navigation, AlertTriangle, Box, Receipt, ArrowRightLeft, ListChecks, Plus, CheckCircle2, X, MapPin, PackageCheck, Truck as TruckIcon } from 'lucide-react';
import { User, Ruta, Cliente } from '../types';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from 'sonner';
import Despacho from './Despacho';
import DespachoAdmin from './operaciones/DespachoAdmin';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type LogisticaProps = {
  currentUser: User;
  initialTab?: TabId;
};

type TabId = 'trazabilidad' | 'guias' | 'rutas' | 'remisiones' | 'conciliacion';

const fmtCRC = (n: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n || 0);
const fmtFecha = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('es-CR') : '—';
const fmtHora = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) : '';

const estadoStyle = (estado: string): React.CSSProperties => {
  switch (estado) {
    case 'Cargada': return { background: 'var(--status-info-soft)', color: 'var(--status-info)' };
    case 'EnRuta': return { background: 'var(--status-warning-soft)', color: 'var(--status-warning)' };
    case 'Cerrada': return { background: 'var(--status-success-soft)', color: 'var(--status-success)' };
    case 'Anulada': return { background: 'var(--status-danger-soft)', color: 'var(--status-danger)' };
    default: return { background: 'var(--bg-muted)', color: 'var(--text-muted)' };
  }
};

export default function Logistica({ currentUser }: LogisticaProps) {
  const [activeTab, setActiveTab] = useState<TabId>('trazabilidad');
  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [camiones, setCamiones] = useState<any[]>([]);
  const [guias, setGuias] = useState<any[]>([]);
  const [inventario, setInventario] = useState<any[]>([]);
  const [etiquetas, setEtiquetas] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Camión seleccionado (real desde BD)
  const [camionId, setCamionId] = useState<string>('');

  // Rutas state
  const [isAddingRuta, setIsAddingRuta] = useState(false);
  const [newRuta, setNewRuta] = useState({ nombre: '', vendedor_asignado: '', dias_frecuencia: '', kilometraje_aprox: 0 });

  // Detalle / timeline
  const [timelineGuiaId, setTimelineGuiaId] = useState<string>('');
  const [detalleGuia, setDetalleGuia] = useState<any>(null);
  const [detalleModal, setDetalleModal] = useState<any>(null);

  // Resultado de cierre
  const [resultadoCierre, setResultadoCierre] = useState<any>(null);

  // Cierre (modal con confirmación + peso de llegada)
  const [cerrarSel, setCerrarSel] = useState<any>(null);
  const [pesoLlegada, setPesoLlegada] = useState<string>('');
  const [cerrando, setCerrando] = useState(false);

  const camion = camiones.find((c: any) => c.id === camionId) || null;
  const guiasDelCamion = guias.filter((g: any) => g.camionId === camionId);
  const camionObjetivo = camion?.nombre || 'Este camión';

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [resCam, resGuias, resInv, resRutas, resClientes, resEtiquetas] = await Promise.all([
        fetch('/api/logistica/camiones'),
        fetch('/api/logistica/guias'),
        fetch('/api/inventario'),
        fetch('/api/rutas'),
        fetch('/api/clientes'),
        fetch('/api/etiquetas')
      ]);
      if (resCam.ok) setCamiones(await resCam.json());
      if (resGuias.ok) setGuias(await resGuias.json());
      if (resInv.ok) setInventario(await resInv.json());
      if (resRutas.ok) setRutas(await resRutas.json());
      if (resClientes.ok) setClientes(await resClientes.json());
      if (resEtiquetas.ok) setEtiquetas(await resEtiquetas.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Camión por defecto = primero real; guía de timeline = activa o la última del camión
  useEffect(() => {
    if (!camionId && camiones.length > 0) setCamionId(camiones[0].id);
  }, [camiones, camionId]);

  useEffect(() => {
    const gs = guiasDelCamion;
    const g0 = gs.find((g: any) => g.estado !== 'Cerrada' && g.estado !== 'Anulada') || gs[0];
    setTimelineGuiaId(g0?.id || '');
  }, [camionId, guiasDelCamion.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!timelineGuiaId) { setDetalleGuia(null); return; }
    let cancelado = false;
    fetch(`/api/logistica/guias/${timelineGuiaId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelado) setDetalleGuia(d); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [timelineGuiaId]);

  // ==================== MÉTRICAS DEL CAMIÓN (flujo real) ====================
  const totalCargado = guiasDelCamion.reduce((acc: number, g: any) => acc + Number(g.totalCartones || 0), 0);
  const totalVendido = guiasDelCamion.reduce((acc: number, g: any) => acc + Number(g.totalVendido || 0), 0);
  const stockCamion = inventario
    .filter((i: any) => i.ubicacion === camion.nombre)
    .reduce((acc: number, i: any) => acc + Number(i.cantidad), 0);
  const merma = totalCargado - totalVendido - stockCamion;
  const etiquetasEnBodega = etiquetas.filter((e: any) => e.estado === 'EnBodega');
  const totalEtiquetasEnBodega = etiquetasEnBodega.reduce((a: number, e: any) => a + Number(e.cantidad), 0);

  // ==================== HANDLERS ====================
  const handleAddRuta = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/rutas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRuta)
      });
      if (!res.ok) throw new Error('Error creando ruta');
      await fetchData();
      setIsAddingRuta(false);
      setNewRuta({ nombre: '', vendedor_asignado: '', dias_frecuencia: '', kilometraje_aprox: 0 });
    } catch (err: any) { toast.error(`Error creando ruta: ${err.message}`); }
  };

  const abrirDetalle = async (id: string) => {
    try {
      const res = await fetch(`/api/logistica/guias/${id}`);
      if (res.ok) setDetalleModal(await res.json());
      else { const d = await res.json(); toast.error(d.error || 'Error al cargar detalle'); }
    } catch { toast.error('Error al cargar detalle'); }
  };

  const abrirCierre = (g: any) => {
    setPesoLlegada('');
    setCerrarSel(g);
  };

  const confirmarCierre = async () => {
    if (!cerrarSel) return;
    setCerrando(true);
    try {
      const res = await fetch(`/api/logistica/guias/${cerrarSel.id}/cerrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pesoLlegada: Number(pesoLlegada) || null, responsable: currentUser.name })
      });
      const body = await res.json();
      if (res.ok) {
        setResultadoCierre(body.cuadre);
        setCerrarSel(null);
        await fetchData();
      } else { toast.error(body.error || 'Error al cerrar la guía'); }
    } catch (err: any) { toast.error(err.message); }
    setCerrando(false);
  };

  const canEdit = currentUser.role === 'Admin' || currentUser.role === 'Despachador';

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in pb-20">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Módulo de Logística</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Control de guías, carga, trazabilidad y conciliación</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
          <TruckIcon className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
          <select value={camionId} onChange={e => setCamionId(e.target.value)} className="bg-transparent outline-none font-bold" style={{ color: 'var(--text-primary)' }}>
            {camiones.length === 0 && <option value="">Sin camiones</option>}
            {camiones.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b space-x-8 overflow-x-auto" style={{ borderColor: 'var(--border-default)' }}>
        {([
          { id: 'trazabilidad' as TabId, label: 'Auditoría de Ruta' },
          { id: 'guias' as TabId, label: 'Guías de Despacho' },
          { id: 'rutas' as TabId, label: 'Gestión de Rutas' },
          { id: 'remisiones' as TabId, label: 'Remisiones' },
          { id: 'conciliacion' as TabId, label: 'Cierre de Ruta' },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "pb-3 text-sm font-bold transition-colors relative whitespace-nowrap",
              activeTab === tab.id ? "" : "hover:opacity-70"
            )}
            style={activeTab === tab.id ? { color: 'var(--brand-primary)' } : { color: 'var(--text-muted)' }}
          >
            {tab.label}
            {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full" style={{ background: 'var(--brand-primary)' }} />}
          </button>
        ))}
      </div>

      {/* ==================== AUDITORÍA DE RUTA ==================== */}
      {activeTab === 'trazabilidad' && (
        <div className="space-y-6">
          {camiones.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <Truck className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No hay camiones registrados. Créelos en la pestaña Guías de Despacho.</p>
            </div>
          ) : (
            <>
              {isLoading ? (
                <div className="flex items-center justify-center min-h-[30vh]">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)' }} />
                </div>
              ) : (
                <div className="space-y-6 animate-in fade-in">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                      <div className="flex items-center space-x-2 mb-2">
                        <Box className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
                        <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Carga en guías</h4>
                      </div>
                      <p className="text-3xl font-black" style={{ color: 'var(--text-primary)' }}>{totalCargado} <span className="text-lg font-bold opacity-50">cts</span></p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{guiasDelCamion.length} guías · Bodega → {camionObjetivo}</p>
                    </div>

                    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                      <div className="flex items-center space-x-2 mb-2">
                        <Receipt className="w-5 h-5 text-emerald-600" />
                        <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Vendido (tiquetes)</h4>
                      </div>
                      <p className="text-3xl font-black text-emerald-600">{totalVendido} <span className="text-lg font-bold opacity-50">cts</span></p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Ventas en vivo de la caja de ruta</p>
                    </div>

                    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                      <div className="flex items-center space-x-2 mb-2">
                        <ArrowRightLeft className="w-5 h-5 text-orange-600" />
                        <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Stock actual</h4>
                      </div>
                      <p className="text-3xl font-black" style={{ color: 'var(--text-primary)' }}>{stockCamion} <span className="text-lg font-bold opacity-50">cts</span></p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Inventario físico en {camionObjetivo}</p>
                    </div>

                    <div className={cn("rounded-2xl p-5 border", merma === 0 ? "" : "")} style={{ background: merma === 0 ? 'var(--status-success-soft)' : 'var(--status-danger-soft)', borderColor: merma === 0 ? 'var(--status-success)' : 'var(--status-danger)' }}>
                      <div className="flex items-center space-x-2 mb-2">
                        <AlertTriangle className={cn("w-5 h-5", merma === 0 ? "text-emerald-600" : "text-red-600")} />
                        <h4 className={cn("font-bold text-xs uppercase tracking-wider", merma === 0 ? "text-emerald-700" : "text-red-700")}>Merma</h4>
                      </div>
                      <p className={cn("text-3xl font-black", merma === 0 ? "text-emerald-800" : "text-red-800")}>
                        {merma} <span className="text-lg font-bold opacity-70">cts</span>
                      </p>
                      <p className={cn("text-xs mt-1 font-medium", merma === 0 ? "text-emerald-600" : "text-red-600")}>
                        {merma === 0 ? "Cuadre matemático exacto" : "Discrepancia detectada"}
                      </p>
                    </div>
                  </div>

                  {/* Guías del camión */}
                  <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                    <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--border-default)' }}>
                      <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Navigation className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
                        Guías de {camionObjetivo}
                      </h3>
                    </div>
                    {guiasDelCamion.length === 0 ? (
                      <p className="p-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>Este camión aún no tiene guías de despacho.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)' }}>
                            <th className="py-2 px-4">Consecutivo</th><th className="py-2">Fecha</th>
                            <th className="py-2">Cargado</th><th className="py-2">Vendido</th><th className="py-2">Avance</th>
                            <th className="py-2">Estado</th><th className="py-2 pr-4">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {guiasDelCamion.map((g: any) => (
                            <tr key={g.id} style={{ borderBottom: '1px dashed var(--border-muted, var(--border-default))' }}>
                              <td className="py-2 px-4 font-mono text-xs">{g.consecutivo}</td>
                              <td className="py-2">{fmtFecha(g.fecha)}</td>
                              <td className="py-2">{g.totalCartones}</td>
                              <td className="py-2">{g.totalVendido}</td>
                              <td className="py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-1.5 rounded overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                                    <div className="h-full" style={{ width: `${g.avance}%`, background: 'var(--brand-primary)' }} />
                                  </div>
                                  <span className="text-xs">{g.avance}%</span>
                                </div>
                              </td>
                              <td className="py-2"><span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={estadoStyle(g.estado)}>{g.estado}</span></td>
                              <td className="py-2 pr-4">
                                <button onClick={() => abrirDetalle(g.id)} className="text-xs font-semibold" style={{ color: 'var(--brand-primary)' }}>Ver detalle</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Línea de tiempo */}
                  {guiasDelCamion.length > 0 && (
                    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                      <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--border-default)' }}>
                        <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                          <ListChecks className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
                          Línea de Tiempo
                        </h3>
                        <select
                          value={timelineGuiaId}
                          onChange={e => setTimelineGuiaId(e.target.value)}
                          className="rounded-lg px-3 py-1.5 text-xs font-bold outline-none"
                          style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                        >
                          {guiasDelCamion.map((g: any) => <option key={g.id} value={g.id}>{g.consecutivo} ({g.estado})</option>)}
                        </select>
                      </div>
                      <div className="p-6">
                        {detalleGuia && (
                          <div className="space-y-0">
                            <TimelineStep
                              icon={<Box className="w-4 h-4 text-blue-600" />}
                              bg="bg-blue-100"
                              titulo="Guía de despacho creada"
                              detalle={`${fmtFecha(detalleGuia.fecha)} ${fmtHora(detalleGuia.fecha)} · ${detalleGuia.totalCartones} cartones cargados a ${camionObjetivo}`}
                              activo={detalleGuia.estado === 'Cargada'}
                            />
                            <TimelineStep
                              icon={<Navigation className="w-4 h-4 text-amber-600" />}
                              bg="bg-amber-100"
                              titulo="Salida a ruta"
                              detalle={detalleGuia.recibidoEn ? `${fmtFecha(detalleGuia.recibidoEn)} ${fmtHora(detalleGuia.recibidoEn)}` : 'Pendiente de marcar EnRuta'}
                              activo={detalleGuia.estado === 'EnRuta' || detalleGuia.estado === 'Cerrada'}
                            />
                            <TimelineStep
                              icon={<Receipt className="w-4 h-4 text-emerald-600" />}
                              bg="bg-emerald-100"
                              ultimo={!(detalleGuia.finDiaFecha || detalleGuia.estado === 'Cerrada')}
                              titulo={`Ventas en ruta (${(detalleGuia.ventas || []).filter((v: any) => v.estado === 'Emitida').length} tiquetes)`}
                              detalle={
                                (detalleGuia.ventas || []).filter((v: any) => v.estado === 'Emitida').length === 0
                                  ? 'Sin ventas registradas aún'
                                  : (detalleGuia.ventas || []).filter((v: any) => v.estado === 'Emitida')
                                    .map((v: any) => `${v.tiqueteConsecutivo} · ${v.producto} × ${v.cartones} ct · ${fmtCRC(v.total)} (${fmtHora(v.fechaHora)})`).join(' · ')
                              }
                              activo={((detalleGuia.ventas || []).filter((v: any) => v.estado === 'Emitida').length) > 0 && detalleGuia.estado !== 'Cerrada'}
                            />
                            <TimelineStep
                              icon={<MapPin className="w-4 h-4 text-sky-600" />}
                              bg="bg-sky-100"
                              ultimo={!(detalleGuia.estado === 'Cerrada')}
                              titulo="Fin de día en la caja"
                              detalle={detalleGuia.finDiaFecha ? `${fmtFecha(detalleGuia.finDiaFecha)} ${fmtHora(detalleGuia.finDiaFecha)} · ventas bloqueadas hasta cuadre` : 'Pendiente (lo cierra el vendedor en Caja Ruta)'}
                              activo={Boolean(detalleGuia.finDiaFecha) && detalleGuia.estado !== 'Cerrada'}
                            />
                            <TimelineStep
                              icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                              bg="bg-emerald-100"
                              titulo="Cuadre en central (cierre)"
                              detalle={detalleGuia.estado === 'Cerrada' ? 'Guía cerrada y reconciliada · sobrante reingresado a Bodega Central' : 'Pendiente (cuadre en Tablero Vivo · cierre Tablero Vivo o pestaña Cierre)'}
                              activo={detalleGuia.estado === 'Cerrada'}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ==================== GUÍAS DE DESPACHO (Despacho.tsx + info de carga) ==================== */}
      {activeTab === 'guias' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="flex items-center justify-between gap-4 rounded-2xl px-5 py-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
                <PackageCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{etiquetasEnBodega.length} etiquetas EnBodega disponibles</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{totalEtiquetasEnBodega} cartones listos para cargar en una Guía de Despacho</p>
              </div>
            </div>
            {camion && (
              <div className="text-right text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                {camionObjetivo} · Capacidad {camion.capacidad_cartones} ct
              </div>
            )}
          </div>
          <Despacho currentUser={currentUser} />
        </div>
      )}

      {/* ==================== GESTIÓN DE RUTAS ==================== */}
      {activeTab === 'rutas' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Rutas Registradas</h3>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Administra las rutas de distribución y sus clientes asignados</p>
            </div>
            {canEdit && (
              <button
                onClick={() => setIsAddingRuta(!isAddingRuta)}
                className={cn(
                  "flex items-center px-4 py-2.5 rounded-xl font-bold transition-all shadow-sm text-sm",
                  isAddingRuta ? "" : "text-white"
                )}
                style={isAddingRuta ? { background: 'var(--bg-muted)', color: 'var(--text-secondary)' } : { background: 'var(--brand-primary)' }}
              >
                {isAddingRuta ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                {isAddingRuta ? "Cancelar" : "Nueva Ruta"}
              </button>
            )}
          </div>

          {isAddingRuta && (
            <form onSubmit={handleAddRuta} className="rounded-2xl p-6 shadow-sm animate-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Nombre Ruta *</label>
                  <input
                    required type="text" value={newRuta.nombre}
                    onChange={e => setNewRuta({ ...newRuta, nombre: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    placeholder="Ej. Ruta San José Norte"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Vendedor</label>
                  <input
                    type="text" value={newRuta.vendedor_asignado}
                    onChange={e => setNewRuta({ ...newRuta, vendedor_asignado: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    placeholder="Nombre del vendedor"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Días</label>
                  <input
                    type="text" value={newRuta.dias_frecuencia}
                    onChange={e => setNewRuta({ ...newRuta, dias_frecuencia: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    placeholder="Lunes,Miércoles,Viernes"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Km Aprox</label>
                  <input
                    type="number" value={newRuta.kilometraje_aprox || ''}
                    onChange={e => setNewRuta({ ...newRuta, kilometraje_aprox: Number(e.target.value) })}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    placeholder="45"
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button type="submit" className="text-white px-5 py-2 rounded-xl text-sm font-bold shadow-sm" style={{ background: 'var(--brand-primary)' }}>
                  <CheckCircle2 className="w-4 h-4 mr-1 inline" /> Crear Ruta
                </button>
              </div>
            </form>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)' }} />
            </div>
          ) : rutas.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <Map className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Sin rutas registradas</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Crea la primera ruta para comenzar a organizar la distribución.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rutas.map(ruta => {
                const clientesEnRuta = clientes.filter(c => c.ruta === ruta.nombre);
                return (
                  <div key={ruta.id} className="rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{ruta.nombre}</h4>
                        {ruta.vendedor_asignado && (
                          <p className="text-sm mt-1 flex items-center" style={{ color: 'var(--text-muted)' }}>
                            <Users className="w-3.5 h-3.5 mr-1" /> {ruta.vendedor_asignado}
                          </p>
                        )}
                      </div>
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-bold", ruta.estado === 'Activa' ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500")}>
                        {ruta.estado}
                      </span>
                    </div>
                    <div className="pt-3 space-y-2" style={{ borderTop: '1px solid var(--border-muted, var(--border-default))' }}>
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--text-muted)' }}>Clientes asignados</span>
                        <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{clientesEnRuta.length}</span>
                      </div>
                      {ruta.dias_frecuencia && (
                        <div className="flex justify-between text-sm">
                          <span style={{ color: 'var(--text-muted)' }}>Frecuencia</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{ruta.dias_frecuencia}</span>
                        </div>
                      )}
                      {ruta.kilometraje_aprox && (
                        <div className="flex justify-between text-sm">
                          <span style={{ color: 'var(--text-muted)' }}>Km aprox.</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{ruta.kilometraje_aprox} km</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================== REMISIONES (DespachoAdmin.tsx) ==================== */}
      {activeTab === 'remisiones' && <DespachoAdmin currentUser={currentUser} />}

      {/* ==================== CIERRE DE RUTA ==================== */}
      {activeTab === 'conciliacion' && (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
          <div className="rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-center space-x-3 pb-4 mb-6" style={{ borderBottom: '1px solid var(--border-default)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Cierre y Conciliación de Ruta — {camionObjetivo}</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  El sobrante vuelve automáticamente a Bodega Central y la guía se cierra reconciliada.
                </p>
              </div>
            </div>

            <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Flujo recomendado:</strong> el vendedor cierra el día en <strong style={{ color: 'var(--text-primary)' }}>Caja Ruta</strong>, y la central hace el <strong style={{ color: 'var(--text-primary)' }}>cuadre en el Tablero Vivo</strong> (controla merma, retornos y aprobación). Este botón es equivalente al cierre desde Despacho.
              </p>
            </div>

            {guiasDelCamion.filter((g: any) => g.estado === 'Cargada' || g.estado === 'EnRuta').length === 0 ? (
              <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No hay guías abiertas para {camionObjetivo}.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {guiasDelCamion.filter((g: any) => g.estado === 'Cargada' || g.estado === 'EnRuta').map((g: any) => (
                  <div key={g.id} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <div>
                      <p className="font-mono text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{g.consecutivo} <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={estadoStyle(g.estado)}>{g.estado}</span></p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        Cargado {g.totalCartones} ct · Vendido {g.totalVendido} ct · {fmtFecha(g.fecha)}
                      </p>
                    </div>
                    <button
                      onClick={() => abrirCierre(g)}
                      className="rounded-xl px-4 py-2 text-sm font-bold text-white shadow-sm"
                      style={{ background: 'var(--status-danger)' }}
                    >
                      Cerrar y Conciliar
                    </button>
                  </div>
                ))}
              </div>
            )}

            {resultadoCierre && (
              <div className="rounded-2xl p-6 border-2 animate-in" style={{ background: 'var(--bg-card)', borderColor: resultadoCierre.merma === 0 ? 'var(--status-success)' : 'var(--status-danger)' }}>
                <h3 className="font-bold text-lg mb-4" style={{ color: 'var(--text-primary)' }}>Resultado de Conciliación</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 rounded-xl" style={{ background: 'var(--bg-muted)' }}>
                    <p className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Cargado</p>
                    <p className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{resultadoCierre.totalCargado}</p>
                  </div>
                  <div className="text-center p-3 rounded-xl" style={{ background: 'var(--status-success-soft)' }}>
                    <p className="text-xs font-bold uppercase text-emerald-600">Vendido</p>
                    <p className="text-2xl font-black text-emerald-800">{resultadoCierre.totalVendido}</p>
                  </div>
                  <div className="text-center p-3 rounded-xl" style={{ background: 'var(--bg-muted)' }}>
                    <p className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Retornado</p>
                    <p className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{resultadoCierre.restanteCartones}</p>
                  </div>
                  <div className={cn("text-center p-3 rounded-xl", resultadoCierre.merma === 0 ? "" : "")} style={{ background: resultadoCierre.merma === 0 ? 'var(--status-success-soft)' : 'var(--status-danger-soft)' }}>
                    <p className={cn("text-xs font-bold uppercase", resultadoCierre.merma === 0 ? "text-emerald-600" : "text-red-600")}>Merma</p>
                    <p className={cn("text-2xl font-black", resultadoCierre.merma === 0 ? "text-emerald-800" : "text-red-800")}>{resultadoCierre.merma}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal detalle guía */}
      {detalleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDetalleModal(null)}>
          <div className="fixed inset-0 bg-black/60" />
          <div className="relative w-full max-w-xl rounded-2xl p-6 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-bold" style={{ color: 'var(--text-primary)' }}>{detalleModal.consecutivo}</h4>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {detalleModal.camionNombre} {detalleModal.placa && `(${detalleModal.placa})`} · <span className="px-2 py-0.5 rounded-full font-semibold" style={estadoStyle(detalleModal.estado)}>{detalleModal.estado}</span>
                </p>
              </div>
              <button onClick={() => setDetalleModal(null)} className="p-1 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Responsable carga: {detalleModal.responsableCarga || '—'} · Transporte: {detalleModal.responsableTransporte || '—'}
            </p>

            {detalleModal.detalle?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Etiquetas cargadas</p>
                <div className="space-y-1.5">
                  {detalleModal.detalle.map((d: any) => (
                    <div key={d.id} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                      <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{d.codigoUnico || d.etiquetaId}</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.producto} · {d.cartones} ct · <span className="px-2 py-0.5 rounded-full font-semibold" style={estadoStyle(d.estadoEtiqueta || '')}>{d.estadoEtiqueta}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Tiquetes de la ruta</p>
            {(detalleModal.ventas || []).length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin tiquetes emitidos.</p>
            ) : (
              <div className="space-y-1.5">
                {(detalleModal.ventas || []).map((v: any) => (
                  <div key={v.ventaId} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <div>
                      <span className="font-extrabold" style={{ color: v.estado === 'Anulada' ? 'var(--status-danger)' : 'var(--brand-primary)' }}>{v.tiqueteConsecutivo}</span>
                      <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>{v.producto} × {v.cartones} ct · {v.cobro}</span>
                    </div>
                    <span className="font-bold" style={{ color: v.estado === 'Anulada' ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                      {v.estado === 'Anulada' ? 'ANULADO' : fmtCRC(v.total)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {detalleModal.rutaOrden?.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-semibold mb-2 flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                  <MapPin className="w-3.5 h-3.5" /> Orden de recorrido sugerido
                </p>
                <ol className="text-xs space-y-1">
                  {detalleModal.rutaOrden.map((c: any, i: number) => (
                    <li key={c.clienteId} className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'var(--brand-primary)', color: '#fff' }}>{i + 1}</span>
                      {c.nombre} <span style={{ color: 'var(--text-muted)' }}>{c.prioridad}{c.ventanaIni && ` · ${c.ventanaIni}-${c.ventanaFin || '∞'}`}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      )}
    {/* Modal cierre de guía */}
      {cerrarSel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setCerrarSel(null)} />
          <div className="relative w-full max-w-md rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-extrabold" style={{ color: 'var(--text-primary)' }}>Cerrar y Conciliar {cerrarSel.consecutivo}</p>
              <button onClick={() => setCerrarSel(null)} className="p-1 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="rounded-xl px-4 py-3 mb-4" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
              <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
                Cargado <strong style={{ color: 'var(--text-primary)' }}>{cerrarSel.totalCartones} ct</strong> · Vendido <strong style={{ color: 'var(--text-primary)' }}>{cerrarSel.totalVendido} ct</strong>
              </p>
              <p className="text-xs text-center mt-1" style={{ color: 'var(--text-muted)' }}>
                El sobrante volverá automáticamente a Bodega Central. Acción irreversible.
              </p>
            </div>
            <div className="space-y-1 mb-4">
              <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Peso de llegada (kg, opcional)</label>
              <input
                type="number" min={0} value={pesoLlegada} autoFocus
                onChange={(e) => setPesoLlegada(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmarCierre(); }}
                className="w-full rounded-xl px-3 py-2 text-sm font-bold focus:outline-none"
                style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                placeholder="Ej. 1250"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setCerrarSel(null)} className="rounded-xl px-3 py-3 text-sm font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                Cancelar
              </button>
              <button onClick={confirmarCierre} disabled={cerrando} className="rounded-xl px-3 py-3 text-sm font-extrabold text-white disabled:opacity-50" style={{ background: 'var(--status-danger)' }}>
                {cerrando ? 'Cerrando…' : 'CONFIRMAR CIERRE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineStep({ icon, bg, titulo, detalle, ultimo = false, activo = false }: { icon: React.ReactNode; bg: string; titulo: string; detalle: string; ultimo?: boolean; activo?: boolean }) {
  return (
    <div className="flex space-x-4">
      <div className="flex flex-col items-center">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-4 border-white shadow-sm ${bg} ${activo ? 'ring-2 ring-offset-2' : 'opacity-70'}`} style={{ boxShadow: activo ? '0 0 0 2px var(--brand-primary), 0 0 0 4px var(--bg-card)' : undefined }}>
          {icon}
        </div>
        {!ultimo && <div className="w-0.5 h-full bg-neutral-200 mt-2" />}
      </div>
      <div className="pb-8 pt-2">
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{titulo}</p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{detalle}</p>
      </div>
    </div>
  );
}