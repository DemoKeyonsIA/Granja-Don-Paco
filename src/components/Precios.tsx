import React, { useState, useEffect, useMemo } from 'react';
import { DollarSign, Plus, Tag, History, RefreshCw, X, CheckCircle, Edit3, BarChart3, ArrowUpDown, Filter } from 'lucide-react';
import { ListaPrecios, PrecioDetalle, HistorialPrecio, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import Breadcrumb from './Breadcrumb';
import { loadSession, sessionHeaders } from '../lib/session';

interface Props { currentUser: User; }

export default function Precios({ currentUser }: Props) {
  const [listas, setListas] = useState<ListaPrecios[]>([]);
  const [detalle, setDetalle] = useState<PrecioDetalle[]>([]);
  const [historial, setHistorial] = useState<HistorialPrecio[]>([]);
  const [listaSeleccionada, setListaSeleccionada] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isAddingPrecio, setIsAddingPrecio] = useState(false);
  const [isCambiando, setIsCambiando] = useState(false);
  const [isEditandoRango, setIsEditandoRango] = useState(false);
  const [subTab, setSubTab] = useState<'listas' | 'historial' | 'comparacion'>('listas');

  const hoy = new Date().toISOString().slice(0, 10);
  const [formLista, setFormLista] = useState({ nombre: '', tipo: 'Global', rutaAsociada: '', clienteId: '', fechaInicio: hoy, fechaFin: '' });
  const [formPrecio, setFormPrecio] = useState({ producto: '', precioUnitario: 0, precioMinimo: 0, precioMaximo: 0, descuentoMaximo: 0 });
  const [formCambio, setFormCambio] = useState({ producto: '', precioNuevo: 0, motivo: '' });
  const [formRango, setFormRango] = useState({ id: '', producto: '', precioUnitario: 0, precioMinimo: 0, precioMaximo: 0 });
  const [catalogo, setCatalogo] = useState<{id:string;nombre:string;precioBase:number}[]>([]);
  const [rutas, setRutas] = useState<{id:string;nombre:string}[]>([]);
  const [clientes, setClientes] = useState<{id:string;nombre:string}[]>([]);

  const authHeaders = () => {
    const session = loadSession();
    return {
      'Content-Type': 'application/json',
      'x-user-id': String(currentUser.id),
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    };
  };

  const cargar = async () => {
    setLoading(true);
    try {
      const [lRes, hRes, cRes, rRes, clRes] = await Promise.all([fetch('/api/precios/listas', { headers: sessionHeaders(currentUser.id) }), fetch('/api/precios/historial', { headers: sessionHeaders(currentUser.id) }), fetch('/api/productos-catalogo', { headers: sessionHeaders(currentUser.id) }), fetch('/api/rutas', { headers: sessionHeaders(currentUser.id) }), fetch('/api/clientes', { headers: sessionHeaders(currentUser.id) })]);
      setListas(await lRes.json());
      setHistorial(await hRes.json());
      if (cRes.ok) setCatalogo(await cRes.json());
      if (rRes.ok) setRutas(await rRes.json());
      if (clRes.ok) setClientes(await clRes.json());
    } catch { toast.error('No se pudieron cargar los precios.'); }
    setLoading(false);
  };

  const cargarDetalle = async (listaId: string) => {
    setListaSeleccionada(listaId);
    const res = await fetch(`/api/precios/detalle/${listaId}`, { headers: sessionHeaders(currentUser.id) });
    setDetalle(await res.json());
  };

  useEffect(() => { cargar(); }, []);

  const crearLista = async () => {
    if (!formLista.nombre || !formLista.tipo) { toast.error('Nombre y tipo son requeridos'); return; }
    const res = await fetch('/api/precios/listas', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(formLista),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(body.error || 'No se pudo crear la lista'); return; }
    setIsCreating(false);
    setFormLista({ nombre: '', tipo: 'Global', rutaAsociada: '', clienteId: '', fechaInicio: new Date().toISOString().slice(0, 10), fechaFin: '' });
    cargar();
    toast.success('Lista de precios creada');
  };

  const agregarPrecio = async () => {
    if (!listaSeleccionada || !formPrecio.producto || !formPrecio.precioUnitario) return;
    const res = await fetch('/api/precios/detalle', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ listaId: listaSeleccionada, ...formPrecio })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(body.error || 'No se pudo agregar el precio'); return; }
    setIsAddingPrecio(false);
    setFormPrecio({ producto: catalogo[0]?.nombre || '', precioUnitario: 0, precioMinimo: 0, precioMaximo: 0, descuentoMaximo: 0 });
    cargarDetalle(listaSeleccionada);
    toast.success('Precio agregado');
  };

  const cambiarPrecio = async () => {
    if (!listaSeleccionada || !formCambio.producto || !formCambio.precioNuevo) return;
    const res = await fetch('/api/precios/cambiar', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ listaId: listaSeleccionada, ...formCambio })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(body.error || 'No se pudo cambiar el precio'); return; }
    setIsCambiando(false);
    setFormCambio({ producto: '', precioNuevo: 0, motivo: '' });
    cargarDetalle(listaSeleccionada);
    cargar();
    toast.success('Precio actualizado');
  };

  const editarRango = async () => {
    if (!formRango.id) return;
    const res = await fetch(`/api/precios/detalle/${formRango.id}/rango`, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ precioMinimo: formRango.precioMinimo, precioMaximo: formRango.precioMaximo }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(body.error || 'No se pudo actualizar el rango'); return; }
    setIsEditandoRango(false);
    await cargarDetalle(listaSeleccionada);
    toast.success('Rango de negociación actualizado');
  };

  const cambiarVigenciaLista = async (lista: ListaPrecios) => {
    if (lista.estado !== 'Activa') return;
    const fechaFin = window.prompt(`Fecha final de vigencia para “${lista.nombre}” (AAAA-MM-DD). La fecha aplica hasta el final del día:`, lista.fechaFin || new Date().toISOString().slice(0, 10));
    if (!fechaFin?.trim()) return;
    const res = await fetch(`/api/precios/listas/${lista.id}/vigencia`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ fechaFin: fechaFin.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(body.error || 'No se pudo actualizar la vigencia'); return; }
    await cargar();
    toast.success(`La lista estará vigente hasta ${fechaFin.trim()}`);
  };

  // Build comparison matrix: all products × all price lists
  const productos = useMemo(() => {
    if (catalogo.length > 0) return catalogo.map(p => p.nombre);
    return ['Huevos - Grande', 'Huevos - Mediano', 'Huevos - Pequeño', 'Huevos - Extra', 'Gallinaza'];
  }, [catalogo]);

  const allDetails = useMemo(() => {
    // Build a map: producto → { listaNombre → precio }
    const map: Record<string, Record<string, { precio: number; descMax: number }>> = {};
    // For comparison, we need all details from all lists — fetch them lazily
    // For now, use the currently loaded detalle for the selected list
    // We'll show a matrix of selected list vs first list for comparison
    return map;
  }, [detalle, listas]);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in pb-20">
      <Breadcrumb items={[
        { label: 'Admin', onClick: () => {} },
        { label: 'Precios y negociación' }
      ]} />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="rounded-xl p-2" style={{ background: 'var(--brand-primary-soft)' }}>
            <DollarSign className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-neutral-900 dark:text-white">Precios y negociación</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Define los precios y el rango autorizado para negociar por producto.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={cargar} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          {currentUser.role === 'Admin' && <button onClick={() => setIsCreating(true)} className="btn-primary">
            <Plus className="w-4 h-4" /><span>Nueva Lista</span>
          </button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-200 dark:border-neutral-700 pb-2 overflow-x-auto">
        {([
          ['listas', 'Listas y rangos', Tag],
          ['comparacion', 'Comparación', BarChart3],
          ['historial', 'Historial', History],
        ] as [string, string, React.ComponentType<{className?: string}>][]).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setSubTab(key as 'listas' | 'comparacion' | 'historial')}
            className="flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-bold transition-colors whitespace-nowrap border-b-2"
            style={subTab === key
              ? { color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)', background: 'var(--brand-primary-soft)' }
              : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Listas tab */}
      {subTab === 'listas' && (
        <div className="space-y-4">
          {listas.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-5 py-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: 'var(--brand-primary-soft)', color: 'var(--text-link)' }}>
                <Tag className="h-6 w-6" />
              </div>
              <h3 className="text-base font-extrabold text-neutral-900 dark:text-white">No hay listas de precios</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm text-neutral-500 dark:text-neutral-400">
                Las ventas usarán el precio base configurado en cada producto hasta que se cree una lista con rangos de negociación.
              </p>
              {currentUser.role === 'Admin' && (
                <button onClick={() => setIsCreating(true)} className="btn-primary mt-5 min-h-11">
                  <Plus className="h-4 w-4" /> Crear primera lista
                </button>
              )}
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {listas.map(l => (
              <div key={l.id} onClick={() => cargarDetalle(l.id)}
                className={cn("bg-white dark:bg-neutral-800 p-4 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-md",
                  listaSeleccionada === l.id ? "border-[var(--brand-primary)] shadow-md" : "border-neutral-200 dark:border-neutral-700")}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-neutral-900 dark:text-white">{l.nombre}</h3>
                  <span className={cn("px-2 py-0.5 rounded-full text-xs font-bold",
                    l.estado === 'Activa' ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400")}>{l.estado}</span>
                </div>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Tipo: {l.tipo}</p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Desde: {String(l.fechaInicio).slice(0, 10)}{l.fechaFin ? ` · hasta ${String(l.fechaFin).slice(0, 10)}` : ' · sin fecha de fin'}</p>
                {currentUser.role === 'Admin' && l.estado === 'Activa' && <button type="button" onClick={e => { e.stopPropagation(); void cambiarVigenciaLista(l); }} className="mt-3 min-h-9 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200">Programar fin de vigencia</button>}
              </div>
            ))}
          </div>
          )}

          {listaSeleccionada && (
            <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
                <h3 className="font-bold text-neutral-900 dark:text-white">Detalle de Precios</h3>
                <div className="flex space-x-2">
                  {currentUser.role === 'Admin' && <button onClick={() => setIsAddingPrecio(true)} className="btn-primary btn-sm">
                    <Plus className="w-3 h-3" />Precio
                  </button>}
                  {currentUser.role === 'Admin' && <button onClick={() => { setFormCambio({ ...formCambio, producto: detalle[0]?.producto || '' }); setIsCambiando(true); }}
                    className="btn-secondary btn-sm">
                    <Edit3 className="w-3 h-3" />Cambiar
                  </button>}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-neutral-50 dark:bg-neutral-900">
                      <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Producto</th>
                      <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Precio / kg</th>
                      <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Rango / kg</th>
                      <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Desc. Max</th>
                      <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.map(d => (
                      <tr key={d.id} className="border-t border-neutral-100 dark:border-neutral-700 hover:bg-[var(--brand-primary-soft)] transition-colors">
                        <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{d.producto}</td>
                        <td className="px-4 py-3 text-right font-bold text-neutral-900 dark:text-white">₡{Number(d.precioUnitario).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-neutral-600 dark:text-neutral-300">₡{Number(d.precioMinimo ?? Number(d.precioUnitario) * (1 - Number(d.descuentoMaximo || 0) / 100)).toLocaleString()} – ₡{Number(d.precioMaximo ?? d.precioUnitario).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-neutral-500 dark:text-neutral-400">{Number(d.descuentoMaximo)}%</td>
                        <td className="px-4 py-3 text-right">{currentUser.role === 'Admin' && <button type="button" onClick={() => { setFormRango({ id: d.id, producto: d.producto, precioUnitario: Number(d.precioUnitario), precioMinimo: Number(d.precioMinimo ?? Number(d.precioUnitario) * (1 - Number(d.descuentoMaximo || 0) / 100)), precioMaximo: Number(d.precioMaximo ?? d.precioUnitario) }); setIsEditandoRango(true); }} className="min-h-9 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200">Editar rango</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detalle.length === 0 && <p className="p-4 text-center text-neutral-400 dark:text-neutral-500 text-sm">Sin precios definidos</p>}
            </div>
          )}
        </div>
      )}

      {/* Comparison tab */}
      {subTab === 'comparacion' && (
        <ComparisonView listas={listas} cargarDetalle={cargarDetalle} currentUser={currentUser} />
      )}

      {/* Historial tab */}
      {subTab === 'historial' && (
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
                <tr>
                  <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Fecha</th>
                  <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Producto</th>
                  <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Anterior</th>
                  <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Nuevo</th>
                  <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Cambio por</th>
                </tr>
              </thead>
              <tbody>
                {historial.map(h => (
                    <tr key={h.id} className="border-b border-neutral-100 dark:border-neutral-700 hover:bg-[var(--brand-primary-soft)] transition-colors">
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{h.fecha}</td>
                    <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{h.producto}</td>
                    <td className="px-4 py-3 text-right text-neutral-500 dark:text-neutral-400">{h.precioAnterior ? `₡${Number(h.precioAnterior).toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-green-600 dark:text-green-400">₡{Number(h.precioNuevo).toLocaleString()}</td>
                    <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{h.cambioPor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {historial.length === 0 && <p className="p-6 text-center text-neutral-400 dark:text-neutral-500">Sin historial de cambios</p>}
        </div>
      )}

      {/* Modals */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-white">Nueva Lista de Precios</h3>
              <button onClick={() => setIsCreating(false)} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg"><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Nombre *</label>
                <input value={formLista.nombre} onChange={e => setFormLista({ ...formLista, nombre: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-[var(--brand-primary)] outline-none" placeholder="Ej: Lista General" />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Tipo *</label>
                <select value={formLista.tipo} onChange={e => setFormLista({ ...formLista, tipo: e.target.value, rutaAsociada: '', clienteId: '' })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-[var(--brand-primary)] outline-none">
                  {['Global', 'Ruta', 'Cliente'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              {formLista.tipo === 'Ruta' && <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Ruta *</label>
                <select value={formLista.rutaAsociada} onChange={e => setFormLista({ ...formLista, rutaAsociada: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  <option value="">Seleccionar ruta...</option>{rutas.map(r => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}
                </select>
              </div>}
              {formLista.tipo === 'Cliente' && <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Cliente *</label>
                <select value={formLista.clienteId} onChange={e => setFormLista({ ...formLista, clienteId: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  <option value="">Seleccionar cliente...</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>}
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Vigente desde *</label>
                <input type="date" min={new Date().toISOString().slice(0, 10)} value={formLista.fechaInicio} onChange={e => setFormLista({ ...formLista, fechaInicio: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Vigente hasta (opcional)</label>
                <input type="date" min={formLista.fechaInicio} value={formLista.fechaFin} onChange={e => setFormLista({ ...formLista, fechaFin: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" />
              </div>
              <button onClick={crearLista} className="btn-primary btn-block">Crear Lista</button>
            </div>
          </div>
        </div>
      )}

      {isAddingPrecio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-white">Agregar Precio</h3>
              <button onClick={() => setIsAddingPrecio(false)} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg"><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Producto *</label>
                <select value={formPrecio.producto} onChange={e => setFormPrecio({ ...formPrecio, producto: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-[var(--brand-primary)] outline-none">
                  <option value="">Seleccionar producto...</option>
                  {catalogo.map(p => <option key={p.id} value={p.nombre}>{p.nombre} — ₡{p.precioBase.toLocaleString()} base</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Precio por kg (₡) *</label>
                  <input type="number" value={formPrecio.precioUnitario || ''} onChange={e => setFormPrecio({ ...formPrecio, precioUnitario: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-[var(--brand-primary)] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Desc. Max (%)</label>
                  <input type="number" value={formPrecio.descuentoMaximo || ''} onChange={e => setFormPrecio({ ...formPrecio, descuentoMaximo: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-[var(--brand-primary)] outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Piso vendedor (₡)</label>
                  <input type="number" min="0" value={formPrecio.precioMinimo || ''} onChange={e => setFormPrecio({ ...formPrecio, precioMinimo: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-[var(--brand-primary)] outline-none" placeholder="Según descuento máximo" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Techo vendedor (₡)</label>
                  <input type="number" min="0" value={formPrecio.precioMaximo || ''} onChange={e => setFormPrecio({ ...formPrecio, precioMaximo: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-[var(--brand-primary)] outline-none" placeholder="Precio de lista" />
                </div>
              </div>
              <p className="text-xs text-neutral-500">El precio de lista debe quedar dentro del rango configurado.</p>
              <button onClick={agregarPrecio} className="btn-primary btn-block">Agregar</button>
            </div>
          </div>
        </div>
      )}

      {isCambiando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-white">Cambiar Precio</h3>
              <button onClick={() => setIsCambiando(false)} className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg"><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Producto *</label>
                <input value={formCambio.producto} onChange={e => setFormCambio({ ...formCambio, producto: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-amber-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Nuevo Precio (₡) *</label>
                <input type="number" value={formCambio.precioNuevo || ''} onChange={e => setFormCambio({ ...formCambio, precioNuevo: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-amber-500 outline-none" />
              </div>
              <p className="text-xs text-neutral-500">El piso y el techo conservarán el porcentaje negociable. La identidad se registra desde la sesión de Admin.</p>
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Motivo</label>
                <input value={formCambio.motivo} onChange={e => setFormCambio({ ...formCambio, motivo: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-amber-500 outline-none" />
              </div>
              <button onClick={cambiarPrecio} className="w-full text-white py-2.5 rounded-xl font-bold transition-colors" style={{ background: 'var(--brand-secondary)' }}>Cambiar Precio</button>
            </div>
          </div>
        </div>
      )}

      {isEditandoRango && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="rango-negociacion-titulo" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-800">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><h3 id="rango-negociacion-titulo" className="text-lg font-bold text-neutral-900 dark:text-white">Rango para vendedores</h3><p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{formRango.producto} · ₡{formRango.precioUnitario.toLocaleString('es-CR')} por kg</p></div>
              <button type="button" aria-label="Cerrar" onClick={() => setIsEditandoRango(false)} className="rounded-lg p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700"><X className="h-5 w-5 text-neutral-500" /></button>
            </div>
            <p className="mb-4 rounded-xl bg-[var(--brand-primary-soft)] p-3 text-sm text-[var(--text-primary)]">El vendedor podrá negociar entre el piso y el techo. El precio de lista debe quedar dentro del rango.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold text-neutral-600 dark:text-neutral-300">Piso autorizado (₡/kg)
                <input type="number" min="1" step="1" value={formRango.precioMinimo || ''} onChange={e => setFormRango(prev => ({ ...prev, precioMinimo: Number(e.target.value) }))} className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white" />
              </label>
              <label className="text-xs font-bold text-neutral-600 dark:text-neutral-300">Techo autorizado (₡/kg)
                <input type="number" min="1" step="1" value={formRango.precioMaximo || ''} onChange={e => setFormRango(prev => ({ ...prev, precioMaximo: Number(e.target.value) }))} className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setIsEditandoRango(false)} className="min-h-10 rounded-lg border border-neutral-300 px-4 text-sm font-bold text-neutral-700 dark:border-neutral-600 dark:text-neutral-200">Cancelar</button>
              <button type="button" onClick={() => void editarRango()} disabled={formRango.precioMinimo <= 0 || formRango.precioMaximo < formRango.precioMinimo || formRango.precioUnitario < formRango.precioMinimo || formRango.precioUnitario > formRango.precioMaximo} className="min-h-10 rounded-lg px-4 text-sm font-extrabold text-white disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>Guardar rango</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonView({ listas, cargarDetalle, currentUser }: { listas: ListaPrecios[]; cargarDetalle: (id: string) => void; currentUser: User }) {
  const [detailsMap, setDetailsMap] = useState<Record<string, PrecioDetalle[]>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Load all list details for comparison
    const loadAll = async () => {
      const newMap: Record<string, PrecioDetalle[]> = {};
      const newLoading = new Set<string>();
      for (const l of listas) {
        newLoading.add(l.id);
      }
      setLoadingIds(newLoading);

      await Promise.all(listas.map(async l => {
        try {
          const res = await fetch(`/api/precios/detalle/${l.id}`, { headers: sessionHeaders(currentUser.id) });
          if (res.ok) newMap[l.id] = await res.json();
        } catch {}
      }));

      setDetailsMap(newMap);
      setLoadingIds(new Set());
    };
    if (listas.length > 0) loadAll();
  }, [listas, currentUser.id]);

  const productos = useMemo(() => {
    const names = new Set<string>();
    Object.values(detailsMap).forEach(details => {
      details.forEach(d => names.add(d.producto));
    });
    return Array.from(names).sort();
  }, [detailsMap]);

  if (listas.length < 2) {
    return (
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-8 text-center">
        <BarChart3 className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-3" />
        <p className="text-neutral-500 dark:text-neutral-400 font-medium">Se necesitan al menos 2 listas de precios para comparar.</p>
        <p className="text-neutral-400 dark:text-neutral-500 text-sm mt-1">Cree más listas en la pestaña "Listas de Precios".</p>
      </div>
    );
  }

  const precioFor = (producto: string, listaId: string) => {
    const details = detailsMap[listaId] || [];
    return details.find(d => d.producto === producto);
  };

  return (
    <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
        <h3 className="font-bold text-neutral-900 dark:text-white flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
          Tabla Comparativa de Precios
        </h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Comparación lado a lado de precios por producto en cada lista.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider sticky left-0 bg-neutral-50 dark:bg-neutral-900 z-10">Producto</th>
              {listas.map(l => (
                <th key={l.id} className="px-4 py-3 text-center font-bold text-xs uppercase tracking-wider min-w-[120px]">
                  <span className={cn(l.estado === 'Activa' ? "text-[var(--text-link)]" : "text-neutral-400 dark:text-neutral-500")}>
                    {l.nombre}
                  </span>
                  <span className="block text-[10px] font-normal text-neutral-400 dark:text-neutral-500 normal-case tracking-normal">{l.tipo}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productos.map((prod, idx) => {
              const precios = listas.map(l => precioFor(prod, l.id));
              const vals = precios.filter(Boolean).map(p => Number(p!.precioUnitario));
              const min = vals.length > 0 ? Math.min(...vals) : 0;
              const max = vals.length > 0 ? Math.max(...vals) : 0;

              return (
                <tr key={prod} className={cn("border-b border-neutral-100 dark:border-neutral-700 transition-colors",
                  idx % 2 === 0 ? "bg-white dark:bg-neutral-800" : "bg-neutral-50 dark:bg-neutral-800/50")}>
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white sticky left-0 bg-inherit z-10">{prod}</td>
                  {listas.map(l => {
                    const p = precioFor(prod, l.id);
                    const val = p ? Number(p.precioUnitario) : null;
                    const isLowest = val !== null && val === min && min !== max;
                    const isHighest = val !== null && val === max && min !== max;

                    return (
                      <td key={l.id} className="px-4 py-3 text-center">
                        {loadingIds.has(l.id) ? (
                          <span className="text-neutral-300 dark:text-neutral-600">...</span>
                        ) : val !== null ? (
                          <span className={cn("font-bold",
                            isLowest ? "text-emerald-600 dark:text-emerald-400" :
                            isHighest ? "text-red-500 dark:text-red-400" :
                            "text-neutral-900 dark:text-white")}>
                            ₡{val.toLocaleString()}
                            {isLowest && <span className="ml-1 text-[10px] font-normal text-emerald-500">●</span>}
                            {isHighest && <span className="ml-1 text-[10px] font-normal text-red-400">●</span>}
                          </span>
                        ) : (
                          <span className="text-neutral-300 dark:text-neutral-600">—</span>
                        )}
                        {p && Number(p.descuentoMaximo) > 0 && (
                          <span className="block text-[10px] text-neutral-400 dark:text-neutral-500">-{p.descuentoMaximo}% máx</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {productos.length === 0 && (
              <tr>
                <td colSpan={listas.length + 1} className="px-4 py-8 text-center text-neutral-400 dark:text-neutral-500">
                  No hay productos definidos en las listas seleccionadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Más bajo</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Más alto</span>
        <span className="flex items-center gap-1">— Sin precio</span>
      </div>
    </div>
  );
}
