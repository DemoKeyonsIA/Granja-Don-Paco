import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Download, Eye, RefreshCw, Search, X } from 'lucide-react';
import { User } from '../types';
import { sessionHeaders } from '../lib/session';
import { toast } from 'sonner';

interface HistorialVentasRutaProps { currentUser: User }

const fmtCRC = (n: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n || 0);
const fechaCorta = (iso: string) => {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? 'Fecha no disponible' : fecha.toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' });
};
const fechaFiltro = (iso: string) => {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '' : `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
};
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export default function HistorialVentasRuta({ currentUser }: HistorialVentasRutaProps) {
  const [ventas, setVentas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [ruta, setRuta] = useState('');
  const [cobro, setCobro] = useState('');
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState<string | null>(null);
  const porPagina = 12;

  const cargar = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/logistica/ventas-ruta/historico', { headers: sessionHeaders(currentUser.id) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo cargar el historial.');
      setVentas(Array.isArray(body) ? body : []);
    } catch (e: any) {
      setError(e?.message || 'Error de conexión al cargar las ventas.');
    } finally { setLoading(false); }
  }, [currentUser.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const rutas = useMemo(() => Array.from(new Set(ventas.map(v => v.rutaNombre).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')), [ventas]);
  const pagos = useMemo(() => Array.from(new Set(ventas.map(v => v.cobro).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')), [ventas]);
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es');
    return ventas.filter(v => {
      const fecha = fechaFiltro(v.fechaHora);
      const texto = [v.tiqueteConsecutivo, v.clienteNombre, v.vendedorNombre, v.camionNombre, v.rutaNombre, v.guiaConsecutivo].join(' ').toLocaleLowerCase('es');
      return (!desde || (fecha && fecha >= desde)) && (!hasta || (fecha && fecha <= hasta))
        && (!q || texto.includes(q)) && (!ruta || v.rutaNombre === ruta)
        && (!cobro || v.cobro === cobro) && (!estado || v.estado === estado);
    });
  }, [ventas, desde, hasta, busqueda, ruta, cobro, estado]);
  const totalEmitido = filtradas.filter(v => v.estado === 'Emitida').reduce((s, v) => s + Number(v.total || 0), 0);
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const visibles = filtradas.slice((pagina - 1) * porPagina, pagina * porPagina);

  const limpiar = () => { setDesde(''); setHasta(''); setBusqueda(''); setRuta(''); setCobro(''); setEstado(''); setPagina(1); };
  const exportar = () => {
    if (!filtradas.length) return toast.error('No hay ventas en el resultado actual para exportar.');
    const cabeceras = ['Fecha y hora', 'Tiquete', 'Guía', 'Ruta', 'Camión', 'Vendedor', 'Cliente', 'Producto', 'Cantidad', 'Unidad', 'Precio unitario', 'Descuento', 'Total', 'Pago', 'Estado'];
    const filas = filtradas.map(v => [fechaCorta(v.fechaHora), v.tiqueteConsecutivo, v.guiaConsecutivo, v.rutaNombre, v.camionNombre, v.vendedorNombre, v.clienteNombre, v.producto, v.cantidad, v.unidad, v.precioUnitario, v.descuento, v.total, v.cobro, v.estado]);
    const csv = '\ufeff' + [cabeceras, ...filas].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `historial-ventas-ruta-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="min-w-0 space-y-5 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>Historial de ventas en ruta</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Consulta los tiquetes emitidos por fecha, guía, vendedor o cliente.</p>
        </div>
        <button type="button" onClick={exportar} disabled={filtradas.length === 0 || loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}><Download className="h-4 w-4" />Exportar CSV</button>
      </header>

      <section className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }} aria-label="Filtros del historial">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(210px,1.1fr)_minmax(230px,1.4fr)_minmax(160px,.9fr)_minmax(150px,.8fr)_minmax(145px,.8fr)_auto] xl:items-end">
          <div>
            <label htmlFor="historial-desde" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Desde</label>
            <div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} /><input id="historial-desde" type="date" value={desde} onChange={e => { setDesde(e.target.value); setPagina(1); }} className="min-h-11 w-full rounded-xl border pl-9 pr-3 text-sm" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)', borderColor: 'var(--border-default)' }} /></div>
          </div>
          <div>
            <label htmlFor="historial-hasta" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Hasta</label>
            <div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} /><input id="historial-hasta" type="date" value={hasta} onChange={e => { setHasta(e.target.value); setPagina(1); }} className="min-h-11 w-full rounded-xl border pl-9 pr-3 text-sm" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)', borderColor: 'var(--border-default)' }} /></div>
          </div>
          <div className="relative">
            <label htmlFor="historial-buscar" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Buscar</label>
            <Search className="pointer-events-none absolute left-3 top-[38px] h-4 w-4" style={{ color: 'var(--text-muted)' }} />
            <input id="historial-buscar" type="search" value={busqueda} onChange={e => { setBusqueda(e.target.value); setPagina(1); }} placeholder="Tiquete, cliente, vendedor…" className="min-h-11 w-full rounded-xl border pl-9 pr-3 text-sm" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)', borderColor: 'var(--border-default)' }} />
          </div>
          <div>
            <label htmlFor="historial-ruta" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Ruta</label>
            <select id="historial-ruta" value={ruta} onChange={e => { setRuta(e.target.value); setPagina(1); }} className="min-h-11 w-full rounded-xl border px-3 text-sm" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}><option value="">Todas las rutas</option>{rutas.map(r => <option key={r} value={r}>{r}</option>)}</select>
          </div>
          <div>
            <label htmlFor="historial-pago" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Forma de pago</label>
            <select id="historial-pago" value={cobro} onChange={e => { setCobro(e.target.value); setPagina(1); }} className="min-h-11 w-full rounded-xl border px-3 text-sm" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}><option value="">Todos los pagos</option>{pagos.map(p => <option key={p} value={p}>{p}</option>)}</select>
          </div>
          <button type="button" onClick={limpiar} className="min-h-11 rounded-xl px-3 text-sm font-bold" style={{ color: 'var(--brand-primary)' }}>Limpiar filtros</button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5" style={{ borderColor: 'var(--border-default)' }}>
          <div><p className="text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>{filtradas.length} {filtradas.length === 1 ? 'venta' : 'ventas'}</p><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Total emitido en el resultado: <strong>{fmtCRC(totalEmitido)}</strong></p></div>
          <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}><span>Estado</span><select value={estado} onChange={e => { setEstado(e.target.value); setPagina(1); }} className="min-h-9 rounded-lg border px-2" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}><option value="">Todos</option><option value="Emitida">Emitidas</option><option value="Anulada">Anuladas</option></select></label>
        </div>

        {loading ? <div className="p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Cargando tiquetes de ruta…</div>
          : error ? <div role="alert" className="m-4 rounded-xl p-4 text-sm" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)' }}><p className="font-bold">{error}</p><button type="button" onClick={cargar} className="mt-2 inline-flex items-center gap-2 font-bold"><RefreshCw className="h-4 w-4" />Reintentar</button></div>
          : filtradas.length === 0 ? <div className="p-10 text-center"><p className="font-bold" style={{ color: 'var(--text-primary)' }}>{ventas.length ? 'No hay ventas que coincidan con esos filtros.' : 'Aún no hay ventas de ruta registradas.'}</p><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{ventas.length ? 'Prueba con otra fecha o limpia los filtros.' : 'Los tiquetes emitidos aparecerán aquí.'}</p>{ventas.length > 0 && <button type="button" onClick={limpiar} className="mt-3 text-sm font-bold" style={{ color: 'var(--brand-primary)' }}>Limpiar filtros</button>}</div>
          : <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                <thead><tr style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                  {['FECHA Y HORA', 'TIQUETE', 'RUTA / CAMIÓN', 'VENDEDOR', 'CLIENTE', 'CANTIDAD', 'TOTAL', 'PAGO', 'ESTADO', ''].map((h, i) => <th key={`${h}-${i}`} className={`whitespace-nowrap px-3 py-3 text-[11px] font-extrabold tracking-wide ${['CANTIDAD', 'TOTAL'].includes(h) ? 'text-right' : ''}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {visibles.map((v: any) => <React.Fragment key={v.id}>
                    <tr className="border-t" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                      <td className="whitespace-nowrap px-3 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{fechaCorta(v.fechaHora)}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-extrabold">{v.tiqueteConsecutivo || '—'}</td>
                      <td className="px-3 py-3"><strong className="block">{v.rutaNombre}</strong><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{v.camionNombre}</span></td>
                      <td className="px-3 py-3">{v.vendedorNombre}</td>
                      <td className="px-3 py-3">{v.clienteNombre}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{Number(v.cantidad || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {v.unidad || 'kg'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-extrabold tabular-nums">{fmtCRC(Number(v.total || 0))}</td>
                      <td className="px-3 py-3">{v.cobro}</td>
                      <td className="px-3 py-3"><span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: v.estado === 'Anulada' ? 'var(--status-danger-soft)' : 'var(--status-success-soft)', color: v.estado === 'Anulada' ? 'var(--status-danger)' : 'var(--status-success)' }}>{v.estado}</span></td>
                      <td className="px-3 py-3"><button type="button" onClick={() => setAbierta(abierta === v.id ? null : v.id)} aria-expanded={abierta === v.id} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-bold" style={{ color: 'var(--brand-primary)' }}><Eye className="h-4 w-4" />Ver<ChevronDown className={`h-3.5 w-3.5 transition-transform ${abierta === v.id ? 'rotate-180' : ''}`} /></button></td>
                    </tr>
                    {abierta === v.id && <tr><td colSpan={10} className="px-4 py-3" style={{ background: 'var(--bg-muted)' }}><div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-xs" style={{ color: 'var(--text-secondary)' }}><span>Guía: <strong style={{ color: 'var(--text-primary)' }}>{v.guiaConsecutivo}</strong></span><span>Producto: <strong style={{ color: 'var(--text-primary)' }}>{v.producto}</strong></span><span>Precio unitario: <strong style={{ color: 'var(--text-primary)' }}>{fmtCRC(Number(v.precioUnitario || 0))} / {v.unidad || 'kg'}</strong></span><span>Descuento: <strong style={{ color: 'var(--text-primary)' }}>{fmtCRC(Number(v.descuento || 0))}</strong></span><span>Subtotal: <strong style={{ color: 'var(--text-primary)' }}>{fmtCRC(Number(v.subtotal || 0))}</strong></span><button type="button" onClick={() => setAbierta(null)} className="inline-flex items-center gap-1 font-bold" style={{ color: 'var(--brand-primary)' }}><X className="h-3.5 w-3.5" />Cerrar detalle</button></div></td></tr>}
                  </React.Fragment>)}
                </tbody>
              </table>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
              <span>Mostrando {Math.min((pagina - 1) * porPagina + 1, filtradas.length)}–{Math.min(pagina * porPagina, filtradas.length)} de {filtradas.length} ventas</span>
              <div className="flex items-center gap-2"><button type="button" disabled={pagina <= 1} onClick={() => setPagina(p => Math.max(1, p - 1))} className="min-h-9 rounded-lg border px-3 font-bold disabled:opacity-40" style={{ borderColor: 'var(--border-default)' }}>Anterior</button><span className="px-2 font-bold">{pagina} / {totalPaginas}</span><button type="button" disabled={pagina >= totalPaginas} onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} className="min-h-9 rounded-lg border px-3 font-bold disabled:opacity-40" style={{ borderColor: 'var(--border-default)' }}>Siguiente</button></div>
            </footer>
          </>}
      </section>
    </div>
  );
}
