import React, { useState, useEffect, useMemo } from 'react';
import { DollarSign, Plus, Tag, History, RefreshCw, X, CheckCircle, Edit3, BarChart3, ArrowUpDown, Filter } from 'lucide-react';
import { ListaPrecios, PrecioDetalle, HistorialPrecio, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import Breadcrumb from './Breadcrumb';

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
  const [subTab, setSubTab] = useState<'listas' | 'historial' | 'comparacion'>('listas');

  const [formLista, setFormLista] = useState({ nombre: '', tipo: 'Global', aprobadoPor: '' });
  const [formPrecio, setFormPrecio] = useState({ producto: '', precioUnitario: 0, descuentoMaximo: 0 });
  const [formCambio, setFormCambio] = useState({ producto: '', precioNuevo: 0, cambioPor: '', motivo: '' });
  const [catalogo, setCatalogo] = useState<{id:string;nombre:string;precioBase:number}[]>([]);

  const cargar = async () => {
    setLoading(true);
    try {
      const [lRes, hRes, cRes] = await Promise.all([fetch('/api/precios/listas'), fetch('/api/precios/historial'), fetch('/api/productos-catalogo')]);
      setListas(await lRes.json());
      setHistorial(await hRes.json());
      if (cRes.ok) setCatalogo(await cRes.json());
    } catch { toast.error('No se pudieron cargar los precios.'); }
    setLoading(false);
  };

  const cargarDetalle = async (listaId: string) => {
    setListaSeleccionada(listaId);
    const res = await fetch(`/api/precios/detalle/${listaId}`);
    setDetalle(await res.json());
  };

  useEffect(() => { cargar(); }, []);

  const crearLista = async () => {
    if (!formLista.nombre || !formLista.tipo) { toast.error('Nombre y tipo son requeridos'); return; }
    await fetch('/api/precios/listas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...formLista, aprobadoPor: currentUser.name })
    });
    setIsCreating(false);
    setFormLista({ nombre: '', tipo: 'Global', aprobadoPor: '' });
    cargar();
    toast.success('Lista de precios creada');
  };

  const agregarPrecio = async () => {
    if (!listaSeleccionada || !formPrecio.producto || !formPrecio.precioUnitario) return;
    await fetch('/api/precios/detalle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listaId: listaSeleccionada, ...formPrecio })
    });
    setIsAddingPrecio(false);
    setFormPrecio({ producto: catalogo[0]?.nombre || '', precioUnitario: 0, descuentoMaximo: 0 });
    cargarDetalle(listaSeleccionada);
    toast.success('Precio agregado');
  };

  const cambiarPrecio = async () => {
    if (!listaSeleccionada || !formCambio.producto || !formCambio.precioNuevo || !formCambio.cambioPor) return;
    await fetch('/api/precios/cambiar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listaId: listaSeleccionada, ...formCambio })
    });
    setIsCambiando(false);
    setFormCambio({ producto: '', precioNuevo: 0, cambioPor: '', motivo: '' });
    cargarDetalle(listaSeleccionada);
    cargar();
    toast.success('Precio actualizado');
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
        { label: 'Logística', onClick: () => {} },
        { label: 'Precios' }
      ]} />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="bg-violet-100 dark:bg-violet-900 p-2 rounded-xl">
            <DollarSign className="w-6 h-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-neutral-900 dark:text-white">Precios y Políticas</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Listas de precios, historial y comparación</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={cargar} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          <button onClick={() => setIsCreating(true)} className="flex items-center space-x-2 bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-violet-700 dark:hover:bg-violet-500 transition-colors">
            <Plus className="w-4 h-4" /><span>Nueva Lista</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-200 dark:border-neutral-700 pb-2 overflow-x-auto">
        {([
          ['listas', 'Listas de Precios', Tag],
          ['comparacion', 'Comparación', BarChart3],
          ['historial', 'Historial', History],
        ] as [string, string, React.ComponentType<{className?: string}>][]).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setSubTab(key as 'listas' | 'comparacion' | 'historial')}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-bold transition-colors whitespace-nowrap border-b-2",
              subTab === key ? "text-violet-600 dark:text-violet-400 border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/20" : "text-neutral-500 dark:text-neutral-400 border-transparent hover:text-neutral-800 dark:hover:text-white")}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Listas tab */}
      {subTab === 'listas' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {listas.map(l => (
              <div key={l.id} onClick={() => cargarDetalle(l.id)}
                className={cn("bg-white dark:bg-neutral-800 p-4 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-md",
                  listaSeleccionada === l.id ? "border-violet-400 shadow-md" : "border-neutral-200 dark:border-neutral-700")}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-neutral-900 dark:text-white">{l.nombre}</h3>
                  <span className={cn("px-2 py-0.5 rounded-full text-xs font-bold",
                    l.estado === 'Activa' ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400")}>{l.estado}</span>
                </div>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Tipo: {l.tipo}</p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Desde: {l.fechaInicio}</p>
              </div>
            ))}
          </div>

          {listaSeleccionada && (
            <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
                <h3 className="font-bold text-neutral-900 dark:text-white">Detalle de Precios</h3>
                <div className="flex space-x-2">
                  <button onClick={() => setIsAddingPrecio(true)} className="bg-violet-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-violet-700 dark:hover:bg-violet-500 transition-colors">
                    <Plus className="w-3 h-3 inline mr-1" />Precio
                  </button>
                  <button onClick={() => { setFormCambio({ ...formCambio, producto: detalle[0]?.producto || '' }); setIsCambiando(true); }}
                    className="text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors" style={{ background: 'var(--brand-secondary)' }}>
                    <Edit3 className="w-3 h-3 inline mr-1" />Cambiar
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-neutral-50 dark:bg-neutral-900">
                      <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Producto</th>
                      <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Precio</th>
                      <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400 text-xs uppercase tracking-wider">Desc. Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.map(d => (
                      <tr key={d.id} className="border-t border-neutral-100 dark:border-neutral-700 hover:bg-violet-50/30 dark:hover:bg-violet-900/10 transition-colors">
                        <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{d.producto}</td>
                        <td className="px-4 py-3 text-right font-bold text-neutral-900 dark:text-white">₡{Number(d.precioUnitario).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-neutral-500 dark:text-neutral-400">{Number(d.descuentoMaximo)}%</td>
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
        <ComparisonView listas={listas} cargarDetalle={cargarDetalle} />
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
                  <tr key={h.id} className="border-b border-neutral-100 dark:border-neutral-700 hover:bg-violet-50/30 dark:hover:bg-violet-900/10 transition-colors">
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
                <input value={formLista.nombre} onChange={e => setFormLista({ ...formLista, nombre: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-violet-500 outline-none" placeholder="Ej: Lista General" />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Tipo *</label>
                <select value={formLista.tipo} onChange={e => setFormLista({ ...formLista, tipo: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-violet-500 outline-none">
                  {['Global', 'Ruta', 'Cliente'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <button onClick={crearLista} className="w-full bg-violet-600 text-white py-2.5 rounded-xl font-bold hover:bg-violet-700 dark:hover:bg-violet-500 transition-colors">Crear Lista</button>
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
                <select value={formPrecio.producto} onChange={e => setFormPrecio({ ...formPrecio, producto: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-violet-500 outline-none">
                  <option value="">Seleccionar producto...</option>
                  {catalogo.map(p => <option key={p.id} value={p.nombre}>{p.nombre} — ₡{p.precioBase.toLocaleString()} base</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Precio (₡) *</label>
                  <input type="number" value={formPrecio.precioUnitario || ''} onChange={e => setFormPrecio({ ...formPrecio, precioUnitario: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-violet-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Desc. Max (%)</label>
                  <input type="number" value={formPrecio.descuentoMaximo || ''} onChange={e => setFormPrecio({ ...formPrecio, descuentoMaximo: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-violet-500 outline-none" />
                </div>
              </div>
              <button onClick={agregarPrecio} className="w-full bg-violet-600 text-white py-2.5 rounded-xl font-bold hover:bg-violet-700 dark:hover:bg-violet-500 transition-colors">Agregar</button>
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
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Cambio por *</label>
                <input value={formCambio.cambioPor} onChange={e => setFormCambio({ ...formCambio, cambioPor: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-amber-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Motivo</label>
                <input value={formCambio.motivo} onChange={e => setFormCambio({ ...formCambio, motivo: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white focus:border-amber-500 outline-none" />
              </div>
              <button onClick={cambiarPrecio} className="w-full text-white py-2.5 rounded-xl font-bold transition-colors" style={{ background: 'var(--brand-secondary)' }}>Cambiar Precio</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonView({ listas, cargarDetalle }: { listas: ListaPrecios[]; cargarDetalle: (id: string) => void }) {
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
          const res = await fetch(`/api/precios/detalle/${l.id}`);
          if (res.ok) newMap[l.id] = await res.json();
        } catch {}
      }));

      setDetailsMap(newMap);
      setLoadingIds(new Set());
    };
    if (listas.length > 0) loadAll();
  }, [listas]);

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
          <BarChart3 className="w-4 h-4 text-violet-600" />
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
                  <span className={cn(l.estado === 'Activa' ? "text-violet-700 dark:text-violet-400" : "text-neutral-400 dark:text-neutral-500")}>
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
