import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Eye, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../types';
import { sessionHeaders } from '../lib/session';

type GastoRuta = {
  id: string; fecha: string; categoria: string; monto: number; descripcion: string; medioPago: string;
  vendedorNombre: string; guiaConsecutivo: string | null; rutaId: string | null; rutaNombre: string; estadoRevision: string;
  motivoRevision?: string | null; comprobante?: string | null;
};

const dinero = (n: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(Number(n || 0));
const fechaHora = (v: string) => new Date(v).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' });

export default function GastosRutaAdmin({ currentUser }: { currentUser: User }) {
  const [items, setItems] = useState<GastoRuta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroVendedor, setFiltroVendedor] = useState('Todos');
  const [filtroRuta, setFiltroRuta] = useState('Todas');
  const [filtroEstado, setFiltroEstado] = useState('Por atender');
  const [busqueda, setBusqueda] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [filtrosAvanzadosAbiertos, setFiltrosAvanzadosAbiertos] = useState(false);
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [observacion, setObservacion] = useState<GastoRuta | null>(null);
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gastos', { headers: sessionHeaders(currentUser.id) });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los gastos.');
      setItems(Array.isArray(data) ? data.filter((g: any) => g.guiaId) : []);
    } catch (e: any) { toast.error(e.message || 'Error al cargar gastos'); }
    finally { setLoading(false); }
  }, [currentUser.id]);

  useEffect(() => { void cargar(); }, [cargar]);

  const vendedores = useMemo(() => ['Todos', ...Array.from(new Set(items.map(g => g.vendedorNombre))).sort()], [items]);
  const rutas = useMemo(() => ['Todas', ...Array.from(new Set(items.map(g => g.rutaNombre).filter(Boolean))).sort()], [items]);
  const visibles = useMemo(() => items.filter(g => {
    const coincideEstado = filtroEstado === 'Todos'
      || (filtroEstado === 'Por atender' ? ['Pendiente', 'Observado'].includes(g.estadoRevision) : g.estadoRevision === filtroEstado);
    const texto = `${g.vendedorNombre} ${g.categoria} ${g.descripcion} ${g.guiaConsecutivo || ''}`.toLocaleLowerCase();
    const dia = String(g.fecha || '').slice(0, 10);
    return coincideEstado && (!fechaDesde || dia >= fechaDesde) && (!fechaHasta || dia <= fechaHasta)
      && (filtroVendedor === 'Todos' || g.vendedorNombre === filtroVendedor)
      && (filtroRuta === 'Todas' || g.rutaNombre === filtroRuta) && texto.includes(busqueda.toLocaleLowerCase());
  }), [items, filtroEstado, filtroVendedor, filtroRuta, busqueda, fechaDesde, fechaHasta]);
  const pendientes = items.filter(g => g.estadoRevision === 'Pendiente' || g.estadoRevision === 'Observado');
  const totalPendiente = pendientes.reduce((s, g) => s + Number(g.monto || 0), 0);
  const filtrosActivos = Boolean(busqueda || fechaDesde || fechaHasta || filtroVendedor !== 'Todos' || filtroRuta !== 'Todas' || filtroEstado !== 'Por atender');
  const limpiarFiltros = () => { setFiltroVendedor('Todos'); setFiltroRuta('Todas'); setFiltroEstado('Por atender'); setBusqueda(''); setFechaDesde(''); setFechaHasta(''); };

  const revisar = async (g: GastoRuta, estado: 'Aprobado' | 'Observado', comentario?: string) => {
    try {
      const res = await fetch(`/api/gastos/${g.id}/revision`, { method: 'PUT', headers: sessionHeaders(currentUser.id, true), body: JSON.stringify({ estado, motivo: comentario }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo actualizar el gasto.');
      toast.success(estado === 'Aprobado' ? 'Gasto revisado y aprobado' : 'Observación enviada al vendedor');
      setObservacion(null); setMotivo(''); await cargar();
    } catch (e: any) { toast.error(e.message || 'No se pudo revisar el gasto'); }
  };

  const exportar = () => {
    const filas = [['Fecha', 'Guia', 'Vendedor', 'Ruta', 'Categoria', 'Descripcion', 'Monto', 'Medio de pago', 'Estado']];
    visibles.forEach(g => filas.push([g.fecha, g.guiaConsecutivo || '', g.vendedorNombre, g.rutaNombre || '', g.categoria, g.descripcion, String(g.monto), g.medioPago || '', g.estadoRevision]));
    const csv = filas.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'gastos-de-ruta.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return <div className="space-y-5" data-testid="gastos-ruta-admin">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-2xl font-extrabold" style={{ color: 'var(--text-primary)' }}>Gastos de ruta</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Revisa los gastos que el vendedor registró desde la guía activa.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={exportar} disabled={!visibles.length} className="min-h-11 rounded-xl border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>Exportar visibles</button><button type="button" onClick={() => void cargar()} className="flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Actualizar</button></div>
    </div>
    <div className="rounded-2xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
        <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Buscar<input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Vendedor, guía o detalle" className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }} /></label>
        <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Estado<select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>{['Por atender', 'Pendiente', 'Observado', 'Aprobado', 'Sin revisión', 'Todos'].map(x => <option key={x}>{x}</option>)}</select></label>
        <button type="button" aria-expanded={filtrosAvanzadosAbiertos} onClick={() => setFiltrosAvanzadosAbiertos(v => !v)} className="min-h-11 self-end rounded-xl border px-4 text-sm font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>{filtrosAvanzadosAbiertos ? 'Ocultar filtros' : 'Más filtros'}{(fechaDesde || fechaHasta || filtroVendedor !== 'Todos' || filtroRuta !== 'Todas') ? ' · activos' : ''}</button>
      </div>
      {filtrosAvanzadosAbiertos && <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2 xl:grid-cols-4" style={{ borderColor: 'var(--border-default)' }}>
        <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Desde<input type="date" value={fechaDesde} max={fechaHasta || undefined} onChange={e => setFechaDesde(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }} /></label>
        <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Hasta<input type="date" value={fechaHasta} min={fechaDesde || undefined} onChange={e => setFechaHasta(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }} /></label>
        <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Vendedor<select value={filtroVendedor} onChange={e => setFiltroVendedor(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>{vendedores.map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Ruta<select value={filtroRuta} onChange={e => setFiltroRuta(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>{rutas.map(x => <option key={x}>{x}</option>)}</select></label>
      </div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}><span>{visibles.length} {visibles.length === 1 ? 'gasto visible' : 'gastos visibles'}</span>{filtrosActivos && <button type="button" onClick={limpiarFiltros} className="min-h-9 rounded-lg px-2 font-bold" style={{ color: 'var(--text-link)' }}>Limpiar filtros</button>}</div>
    </div>
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4" style={{ background: 'var(--status-warning-soft)', borderColor: 'var(--status-warning)' }}><div><p className="text-xs font-extrabold uppercase" style={{ color: 'var(--status-warning)' }}>Pendiente de revisión · {pendientes.length} gastos</p><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Incluye los gastos observados que esperan corrección o respuesta.</p></div><strong className="text-2xl" style={{ color: 'var(--text-primary)' }}>{dinero(totalPendiente)}</strong></section>
    <section className="overflow-hidden rounded-2xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
      {loading ? <div className="p-10 text-center" style={{ color: 'var(--text-secondary)' }}>Cargando gastos…</div> : visibles.length === 0 ? <div className="p-8 text-center" style={{ color: 'var(--text-secondary)' }}><p className="font-bold" style={{ color: 'var(--text-primary)' }}>{items.length === 0 ? 'Aún no hay gastos de ruta' : 'No encontramos gastos con estos filtros'}</p><p className="mt-1 text-sm">{items.length === 0 ? 'Cuando el vendedor registre un gasto en una guía, aparecerá aquí para revisión.' : 'Cambia o limpia los filtros para ver otros gastos.'}</p>{items.length > 0 && filtrosActivos && <button type="button" onClick={limpiarFiltros} className="mt-3 min-h-10 rounded-xl border px-4 text-sm font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-link)' }}>Limpiar filtros</button>}</div> : <>
        <div className="divide-y sm:hidden" style={{ borderColor: 'var(--border-default)' }}>{visibles.map(g => <article key={g.id} className="space-y-3 p-4" style={{ borderColor: 'var(--border-default)' }}><div className="flex items-start justify-between gap-3"><div><h3 className="font-extrabold" style={{ color: 'var(--text-primary)' }}>{g.categoria} · {dinero(g.monto)}</h3><p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{fechaHora(g.fecha)}</p></div><span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: g.estadoRevision === 'Aprobado' ? 'var(--status-success-soft)' : g.estadoRevision === 'Observado' ? 'var(--status-danger-soft)' : 'var(--status-warning-soft)', color: g.estadoRevision === 'Aprobado' ? 'var(--status-success)' : g.estadoRevision === 'Observado' ? 'var(--status-danger)' : 'var(--status-warning)' }}>{g.estadoRevision === 'Aprobado' ? 'Revisado' : g.estadoRevision}</span></div><div className="grid grid-cols-2 gap-2 text-sm"><div><span className="block text-xs" style={{ color: 'var(--text-muted)' }}>Vendedor / ruta</span><b>{g.vendedorNombre}</b><span className="block" style={{ color: 'var(--text-secondary)' }}>{g.rutaNombre || 'Ruta asignada'}</span></div><div><span className="block text-xs" style={{ color: 'var(--text-muted)' }}>Guía / pago</span><b>{g.guiaConsecutivo || 'Guía'}</b><span className="block" style={{ color: 'var(--text-secondary)' }}>{g.medioPago || 'Efectivo'}</span></div></div>{g.descripcion && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{g.descripcion}</p>}{g.motivoRevision && <p className="rounded-lg p-2 text-xs" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)' }}>Observación: {g.motivoRevision}</p>}<div className="flex flex-wrap gap-2">{g.comprobante && <button type="button" className="min-h-10 rounded-lg px-3 text-sm font-bold" style={{ color: 'var(--text-link)' }} onClick={() => setComprobante(g.comprobante!)}><Eye className="mr-1 inline h-4 w-4" />Ver comprobante</button>}{(g.estadoRevision === 'Pendiente' || g.estadoRevision === 'Observado') && <><button type="button" onClick={() => void revisar(g, 'Aprobado')} className="min-h-10 rounded-lg px-3 text-sm font-bold" style={{ background: 'var(--status-success-soft)', color: 'var(--status-success)' }}><Check className="mr-1 inline h-4 w-4" />Marcar revisado</button><button type="button" onClick={() => { setObservacion(g); setMotivo(''); }} className="min-h-10 rounded-lg border px-3 text-sm font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>Observar</button></>}</div></article>)}</div>
        <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[1050px] text-left text-sm"><thead style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}><tr>{['Fecha y guía', 'Vendedor · ruta', 'Tipo y detalle', 'Monto', 'Pago', 'Comprobante', 'Estado / acción'].map(h => <th key={h} className="px-3 py-3 text-xs font-extrabold uppercase">{h}</th>)}</tr></thead><tbody>{visibles.map(g => <tr key={g.id} className="border-t" style={{ borderColor: 'var(--border-default)' }}><td className="px-3 py-3"><b>{fechaHora(g.fecha)}</b><small className="block" style={{ color: 'var(--text-muted)' }}>{g.guiaConsecutivo || 'Guía'}</small></td><td className="px-3 py-3"><b>{g.vendedorNombre}</b><small className="block" style={{ color: 'var(--text-muted)' }}>{g.rutaNombre || 'Ruta asignada'}</small></td><td className="max-w-[240px] px-3 py-3"><b>{g.categoria}</b><small className="block whitespace-normal" style={{ color: 'var(--text-secondary)' }}>{g.descripcion}</small></td><td className="px-3 py-3 font-extrabold tabular-nums">{dinero(g.monto)}</td><td className="px-3 py-3">{g.medioPago || 'Efectivo'}</td><td className="px-3 py-3">{g.comprobante ? <button className="inline-flex items-center gap-1 font-bold" style={{ color: 'var(--text-link)' }} onClick={() => setComprobante(g.comprobante!)}><Eye className="h-4 w-4" /> Ver foto</button> : <span style={{ color: 'var(--text-muted)' }}>Sin foto</span>}</td><td className="px-3 py-3">{g.estadoRevision === 'Aprobado' ? <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--status-success-soft)', color: 'var(--status-success)' }}>Revisado</span> : g.estadoRevision === 'Pendiente' || g.estadoRevision === 'Observado' ? <div className="flex min-w-[220px] flex-wrap items-center gap-1.5"><span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: g.estadoRevision === 'Observado' ? 'var(--status-danger-soft)' : 'var(--status-warning-soft)', color: g.estadoRevision === 'Observado' ? 'var(--status-danger)' : 'var(--status-warning)' }}>{g.estadoRevision}</span><button onClick={() => void revisar(g, 'Aprobado')} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-bold" style={{ background: 'var(--status-success-soft)', color: 'var(--status-success)' }}><Check className="h-3.5 w-3.5" />Revisado</button><button onClick={() => { setObservacion(g); setMotivo(''); }} className="min-h-9 rounded-lg border px-2.5 text-xs font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>Observar</button></div> : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{g.estadoRevision}</span>}{g.motivoRevision && <small className="mt-1 block max-w-[220px] whitespace-normal" style={{ color: 'var(--status-danger)' }}>Motivo: {g.motivoRevision}</small>}</td></tr>)}</tbody></table></div>
      </>}
    </section>
    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>“Revisado” confirma que el administrador validó el registro. El gasto permanece ligado a la guía para la conciliación y los reportes financieros.</p>
    {comprobante && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Comprobante del gasto" onClick={() => setComprobante(null)}><div className="relative max-h-[90vh] max-w-3xl rounded-2xl bg-white p-3" onClick={e => e.stopPropagation()}><button className="absolute -right-3 -top-3 rounded-full bg-white p-2 shadow" onClick={() => setComprobante(null)} aria-label="Cerrar"><X className="h-5 w-5" /></button><img src={comprobante} alt="Comprobante del gasto" className="max-h-[84vh] rounded-xl object-contain" /></div></div>}
    {observacion && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="observacion-title"><div className="w-full max-w-md rounded-2xl p-5" style={{ background: 'var(--bg-card)' }}><h3 id="observacion-title" className="text-lg font-extrabold">Observar gasto</h3><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{observacion.vendedorNombre} · {observacion.categoria} · {dinero(observacion.monto)}</p><label className="mt-4 block text-sm font-bold">¿Qué debe aclarar el vendedor?<textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={4} className="mt-1 w-full rounded-xl border p-3 font-normal" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }} /></label><div className="mt-4 flex justify-end gap-2"><button className="min-h-10 rounded-xl border px-4 font-bold" style={{ borderColor: 'var(--border-default)' }} onClick={() => setObservacion(null)}>Cancelar</button><button className="min-h-10 rounded-xl px-4 font-bold text-white disabled:opacity-50" style={{ background: 'var(--brand-primary)' }} disabled={!motivo.trim()} onClick={() => void revisar(observacion, 'Observado', motivo)}>Enviar observación</button></div></div></div>}
  </div>;
}
