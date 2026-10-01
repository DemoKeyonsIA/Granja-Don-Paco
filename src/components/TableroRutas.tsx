import React, { useState, useEffect } from 'react';
import { Truck, RefreshCw, AlertTriangle, PackageOpen, Banknote, CreditCard, RotateCcw, TrendingDown, Hash, ClipboardCheck } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface TableroRutasProps {
  currentUser: User;
}

const fmtCRC = (n: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n || 0);
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });

const estadoBarStyle = (estado: string) => {
  switch (estado) {
    case 'Cargada': return { color: 'var(--status-info)', bg: 'var(--status-info-soft)' };
    case 'EnRuta': return { color: 'var(--status-warning)', bg: 'var(--status-warning-soft)' };
    case 'Cerrada': return { color: 'var(--status-success)', bg: 'var(--status-success-soft)' };
    case 'CerradaConDiferencia': return { color: 'var(--status-danger)', bg: 'var(--status-danger-soft)' };
    default: return { color: 'var(--text-muted)', bg: 'var(--bg-muted)' };
  }
};

export default function TableroRutas({ currentUser }: TableroRutasProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [ultima, setUltima] = useState<string | null>(null);

  const [guias, setGuias] = useState<any[]>([]);
  const [cuadreActivo, setCuadreActivo] = useState<any>(null);
  const [previewCuadre, setPreviewCuadre] = useState<any>(null);
  const [cargandoCuadre, setCargandoCuadre] = useState(false);
  const [pesoLlegada, setPesoLlegada] = useState('');
  const [mermaMotivo, setMermaMotivo] = useState('');
  const [enviandoCuadre, setEnviandoCuadre] = useState(false);

  const fetchTablero = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/logistica/tablero');
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setGuias(d.guias || []);
        setUltima(d.fecha);
      } else { const e = await res.json(); toast.error(`Error: ${e.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  useEffect(() => {
    setGuias(data?.guias || []);
  }, [data]);

  useEffect(() => {
    fetchTablero();
    const id = setInterval(() => fetchTablero(true), 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrirCuadre = async (g: any) => {
    setCuadreActivo(g);
    setPreviewCuadre(null);
    setPesoLlegada('');
    setMermaMotivo('');
    setCargandoCuadre(true);
    try {
      const res = await fetch(`/api/logistica/cuadre-central?guiaId=${g.guiaId}`);
      const body = await res.json();
      if (!res.ok) {
        toast.error(`Cuadre no disponible: ${body.error}`);
        setCuadreActivo(null);
        return;
      }
      setPreviewCuadre(body);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
      setCuadreActivo(null);
    } finally {
      setCargandoCuadre(false);
    }
  };

  const confirmarCuadre = async () => {
    if (!cuadreActivo) return;
    if (previewCuadre?.requiereAprobacion) {
      const ok = window.confirm('Este cuadre tiene diferencia y quedará pendiente de aprobación. ¿Confirmar de todas formas?');
      if (!ok) return;
    }
    setEnviandoCuadre(true);
    try {
      const res = await fetch('/api/logistica/cuadre-central', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({
          guiaId: cuadreActivo.guiaId,
          responsable: currentUser.name,
          ...(pesoLlegada ? { pesoLlegada: Number(pesoLlegada) } : {}),
          ...(mermaMotivo ? { mermaMotivo } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(`Error: ${body.error}`); return; }
      if (body.estado === 'CerradaConDiferencia') {
        toast.warning(`Cuadre cerrado con diferencia · aprobación pendiente (${body.aprobacion?.tipo})`);
      } else {
        toast.success(`Cuadre completado · guía cerrada`);
      }
      setCuadreActivo(null);
      setPreviewCuadre(null);
      fetchTablero(true);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setEnviandoCuadre(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Tablero de rutas en vivo</h2>
          <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--status-success)' }}></span>
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--status-success)' }}></span>
            </span>
            <span className="font-bold" style={{ color: 'var(--status-success)' }}>En vivo</span>
            <span>· Actualización cada 15 s · última: {ultima ? fmtHora(ultima) : '—'}</span>
          </p>
        </div>
        <button
          onClick={() => fetchTablero()}
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold"
          style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refrescar
        </button>
      </div>

      {guias.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <Truck className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No hay guías activas en este momento.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {guias.map((g: any) => (
            <div key={g.guiaId} className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              {/* Cabecera camión */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl" style={{ background: estadoBarStyle(g.estado).bg }}>
                    <Truck className="w-6 h-6" style={{ color: estadoBarStyle(g.estado).color }} />
                  </div>
                  <div>
                    <p className="text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>{g.camionNombre}</p>
                    <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                      {g.consecutivo} · {g.estado}{g.finDiaFecha ? ` · caja cerrada ${fmtHora(g.finDiaFecha)}` : ''}
                    </p>
                  </div>
                </div>
                <span className="rounded-full px-3 py-1 text-xs font-extrabold uppercase" style={{ background: estadoBarStyle(g.estado).bg, color: estadoBarStyle(g.estado).color }}>
                  {g.avance}% vendido
                </span>
              </div>

              {g.finDiaFecha && g.estado !== 'Cerrada' && (
                <div className="rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs" style={{ background: g.estado === 'CerradaConDiferencia' ? 'var(--status-danger-soft)' : 'var(--status-warning-soft, #fef3c7)', border: '1px solid ' + (g.estado === 'CerradaConDiferencia' ? 'var(--status-danger)' : 'var(--status-warning, #f59e0b)') }}>
                  <span className="font-bold flex items-center gap-1.5" style={{ color: g.estado === 'CerradaConDiferencia' ? 'var(--status-danger)' : 'var(--status-warning, #d97706)' }}>
                    <ClipboardCheck className="w-4 h-4 shrink-0" />
                    {g.estado === 'CerradaConDiferencia' ? 'Cuadre con diferencia pendiente de aprobación' : 'Caja cerrada · lista para cuadrar en central'}
                  </span>
                  <button
                    onClick={() => abrirCuadre(g)}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-extrabold uppercase"
                    style={{ background: 'var(--brand-primary)', color: '#fff' }}
                  >
                    Cuadrar en central
                  </button>
                </div>
              )}

              {/* Barra de progreso */}
              <div>
                <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(g.avance, 100)}%`, background: estadoBarStyle(g.estado).color }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                  <span>{g.cartonesVendidos} / {g.totalCargado} ct vendidos</span>
                  <span>{fmtCRC(g.totalGenerado)}</span>
                </div>
              </div>

              {/* Métricas */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <Banknote className="w-3 h-3" /> Efectivo
                  </p>
                  <p className="text-sm font-extrabold" style={{ color: 'var(--status-success)' }}>{fmtCRC(g.totalEfectivo)}</p>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <CreditCard className="w-3 h-3" /> Crédito
                  </p>
                  <p className="text-sm font-extrabold" style={{ color: 'var(--brand-primary)' }}>{fmtCRC(g.totalCredito)}</p>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <RotateCcw className="w-3 h-3" /> Retornos
                  </p>
                  <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>{g.cartonesRetornados} ct</p>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: g.mermaPreliminar !== 0 ? 'var(--status-danger-soft)' : 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: g.mermaPreliminar !== 0 ? 'var(--status-danger)' : 'var(--text-muted)' }}>
                    <TrendingDown className="w-3 h-3" /> Merma
                  </p>
                  <p className="text-sm font-extrabold" style={{ color: g.mermaPreliminar !== 0 ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                    {g.mermaPreliminar} ct{` (rest. ${g.restanteCamion})`}
                  </p>
                </div>
              </div>

              {/* Clientes de la ruta */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <PackageOpen className="w-3.5 h-3.5" /> Progreso por cliente ({g.clientesAtendidos.length}/{g.totalClientes}) · tiquetes {g.tiquetesEmitidos} emitidos · {g.tiquetesAnulados} anulados
                </p>
                <div className="flex flex-wrap gap-2">
                  {g.clientesAtendidos.map((c: any) => (
                    <span key={c.clienteId} className="inline-flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'var(--status-success-soft)', color: 'var(--status-success)', border: '1px solid var(--status-success)' }}>
                      <span>
                        {c.nombre}
                        <span className="block font-medium">{fmtHora(c.hora)} · {c.codigoUnico} · {fmtCRC(c.total)}</span>
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Alertas */}
              {(g.atrasados.length > 0 || g.saltosSecuencia.length > 0) && (
                <div className="space-y-2">
                  {g.atrasados.length > 0 && (
                    <div className="rounded-xl px-3 py-2 flex items-start gap-2 text-xs font-bold" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>Atrasados: {g.atrasados.map((a: any) => `${a.nombre} (ventana hasta ${a.ventanaFin})`).join(', ')}</span>
                    </div>
                  )}
                  {g.saltosSecuencia.length > 0 && (
                    <div className="rounded-xl px-3 py-2 flex items-start gap-2 text-xs font-bold" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
                      <Hash className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>Saltos de secuencia en tiquetes: {g.saltosSecuencia.map((s: any) => s.tiquete).join(', ')}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal Cuadre en Central */}
      {cuadreActivo && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,.55)' }} onClick={() => !enviandoCuadre && setCuadreActivo(null)}>
          <div
            className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>Cuadrar en central</h3>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {cuadreActivo.camionNombre} · {cuadreActivo.consecutivo}
                </p>
              </div>
              <span className="rounded-full px-3 py-1 text-xs font-extrabold uppercase" style={{ background: estadoBarStyle(cuadreActivo.estado).bg, color: estadoBarStyle(cuadreActivo.estado).color }}>
                {cuadreActivo.estado}
              </span>
            </div>

            {cargandoCuadre ? (
              <div className="text-center py-8 text-sm font-bold" style={{ color: 'var(--text-muted)' }}>
                <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin" /> Cargando cuadre…
              </div>
            ) : previewCuadre ? (
              <>
                {/* Cuadre doble */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Cargado</p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>{previewCuadre.cuadre.cargado} ct</p>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>A reingresar</p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--brand-primary)' }}>{previewCuadre.cuadre.cartonesReingresar} ct</p>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: previewCuadre.cuadre.merma > 0 ? 'var(--status-danger-soft)' : 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: previewCuadre.cuadre.merma > 0 ? 'var(--status-danger)' : 'var(--text-muted)' }}>Merma</p>
                    <p className="text-sm font-extrabold" style={{ color: previewCuadre.cuadre.merma > 0 ? 'var(--status-danger)' : 'var(--text-primary)' }}>{previewCuadre.cuadre.merma} ct</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <Banknote className="w-3 h-3" /> Efectivo
                    </p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--status-success)' }}>{fmtCRC(previewCuadre.cuadre.efectivo)}</p>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <CreditCard className="w-3 h-3" /> Crédito
                    </p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--brand-primary)' }}>{fmtCRC(previewCuadre.cuadre.credito)}</p>
                  </div>
                </div>

                {previewCuadre.cuadre.detalleRetornos.length > 0 && (
                  <div className="rounded-xl px-3 py-2.5 space-y-1" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Retornos a recibir</p>
                    {previewCuadre.cuadre.detalleRetornos.map((r: any, i: number) => (
                      <p key={i} className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                        {r.producto} · {r.cartones} ct · {r.etiqueta || ''}
                      </p>
                    ))}
                  </div>
                )}

                {previewCuadre.requiereAprobacion && (
                  <div className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-xs font-bold" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      {previewCuadre.cuadre.descuadreFisico > 0
                        ? `Descuadre físico de ${previewCuadre.cuadre.descuadreFisico} ct: el inventario del camión (${previewCuadre.cuadre.restanteCamion} ct) no coincide con los reingresos (${previewCuadre.cuadre.cartonesReingresar} ct).`
                        : `Merma de ${previewCuadre.cuadre.merma} ct (${(previewCuadre.cuadre.mermaPct * 100).toFixed(1)}%) supera la tolerancia (${(previewCuadre.toleranciaMermaDefault * 100).toFixed(1)}%).`}
                      {' '}Se cerrará con diferencia y quedará pendiente de aprobación.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Peso de llegada (kg)</label>
                    <input
                      type="number"
                      value={pesoLlegada}
                      onChange={(e) => setPesoLlegada(e.target.value)}
                      placeholder="Opcional"
                      className="w-full rounded-xl px-3 py-2 text-sm font-bold"
                      style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Motivo de merma</label>
                    <input
                      type="text"
                      value={mermaMotivo}
                      onChange={(e) => setMermaMotivo(e.target.value)}
                      placeholder="Opcional"
                      className="w-full rounded-xl px-3 py-2 text-sm font-bold"
                      style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCuadreActivo(null)}
                    disabled={enviandoCuadre}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-bold uppercase"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmarCuadre}
                    disabled={enviandoCuadre}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-extrabold uppercase"
                    style={{ background: 'var(--brand-primary)', color: '#fff' }}
                  >
                    {enviandoCuadre ? 'Cuadrando…' : `Confirmar cuadre`}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}