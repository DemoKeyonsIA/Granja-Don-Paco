import React, { useState, useEffect } from 'react';
import { Scale, Plus, Search, AlertTriangle, CheckCircle, XCircle, MapPin, Clock, Filter, RefreshCw, ArrowRight, X } from 'lucide-react';
import { PesoPorPunto, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

interface PesosProps {
  currentUser: User;
}

export default function Pesos({ currentUser }: PesosProps) {
  const [pesos, setPesos] = useState<PesoPorPunto[]>([]);
  const [conciliacion, setConciliacion] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filtroUbicacion, setFiltroUbicacion] = useState<string>('Todas');
  const [loading, setLoading] = useState(false);
  const [catalogo, setCatalogo] = useState<{id:string;nombre:string;unidad:string}[]>([]);

  // Form state
  const [tipoReferencia, setTipoReferencia] = useState<string>('Traslado');
  const [producto, setProducto] = useState('Huevos - Grande');
  const [cantidadUnidades, setCantidadUnidades] = useState(30);
  const [unidad, setUnidad] = useState('cartones');
  const [pesoEsperado, setPesoEsperado] = useState(18);
  const [pesoReal, setPesoReal] = useState(0);
  const [basculaUtilizada, setBasculaUtilizada] = useState('');
  const [ubicacion, setUbicacion] = useState('Granja');
  const [observaciones, setObservaciones] = useState('');

  const fetchPesos = async () => {
    try {
      const [pesosRes, concRes, cRes] = await Promise.all([
        fetch('/api/pesos'),
        fetch('/api/pesos/conciliacion'),
        fetch('/api/productos-catalogo')
      ]);
      if (pesosRes.ok) setPesos(await pesosRes.json());
      if (concRes.ok) setConciliacion(await concRes.json());
      if (cRes.ok) setCatalogo(await cRes.json());
    } catch (err) { toast.error('Error al cargar registros de peso.'); }
  };

  useEffect(() => { fetchPesos(); }, []);

  const handleRegistrar = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/pesos/registrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipoReferencia, producto, cantidadUnidades, unidad, pesoEsperado, pesoReal,
          basculaUtilizada: basculaUtilizada || undefined,
          responsable: currentUser.name,
          ubicacion, observaciones: observaciones || undefined
        })
      });
      if (res.ok) {
        const data = await res.json();
        await fetchPesos();
        setIsCreating(false);
        resetForm();
        toast.success(`Peso registrado. Estado: ${data.estado} (Diferencia: ${data.diferencia.toFixed(2)} kg)`);
      } else { const data = await res.json(); toast.error(`Error: ${data.error}`); }
    } catch (err: any) { toast.error(`Error: ${err.message}`); }
    setLoading(false);
  };

  const resetForm = () => {
    setPesoReal(0);
    setBasculaUtilizada('');
    setObservaciones('');
  };

  const getUbicaciones = () => {
    const ubicaciones = new Set(pesos.map(p => p.ubicacion));
    return ['Todas', ...Array.from(ubicaciones)];
  };

  const filteredPesos = pesos.filter(p => {
    const matchSearch = p.producto.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.observaciones && p.observaciones.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchUbicacion = filtroUbicacion === 'Todas' || p.ubicacion === filtroUbicacion;
    return matchSearch && matchUbicacion;
  });

  const getResumenByUbicacion = (ubicacion: string) => {
    return filteredPesos.filter(p => p.ubicacion === ubicacion).reduce((acc, p) => {
      acc.esperado += Number(p.pesoEsperado);
      acc.real += Number(p.pesoReal);
      acc.diferencia += Number(p.diferencia);
      acc.registros += 1;
      return acc;
    }, { esperado: 0, real: 0, diferencia: 0, registros: 0 });
  };

  const ubicaciones = getUbicaciones();

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-neutral-800 dark:text-white flex items-center">
            <Scale className="w-6 h-6 mr-2 text-amber-600" />
            Control de Pesos
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Registrar y conciliar pesos por punto de custodia.</p>
        </div>
        <button onClick={() => setIsCreating(!isCreating)}
          className="flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm"
          style={isCreating ? { background: '#E7E5E4', color: '#57534E' } : { background: 'var(--brand-secondary)', color: 'white' }}>
          {isCreating ? <><X className="w-5 h-5 mr-2" /> Cancelar</> : <><Plus className="w-5 h-5 mr-2" /> Registrar Peso</>}
        </button>
      </div>

      {/* Summary Cards */}
      {conciliacion && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(conciliacion.porUbicacion || {}).map(([ubic, data]: [string, any]) => (
            <div key={ubic} className="bg-white dark:bg-neutral-800 p-4 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-amber-500" />
                <span className="font-bold text-sm text-neutral-800 dark:text-white">{ubic}</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-neutral-500 dark:text-neutral-400">Esperado:</span><span className="font-bold text-neutral-800 dark:text-white">{data.pesoEsperado.toFixed(1)} kg</span></div>
                <div className="flex justify-between"><span className="text-neutral-500 dark:text-neutral-400">Real:</span><span className="font-bold text-neutral-800 dark:text-white">{data.pesoReal.toFixed(1)} kg</span></div>
                <div className={cn("flex justify-between font-bold", Math.abs(data.diferencia) > 0.5 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                  <span>Diferencia:</span><span>{data.diferencia > 0 ? '+' : ''}{data.diferencia.toFixed(2)} kg</span>
                </div>
                <div className="flex justify-between text-neutral-400 dark:text-neutral-500"><span>Registros:</span><span>{data.registros}</span></div>
              </div>
            </div>
          ))}
          {Object.keys(conciliacion.porUbicacion || {}).length === 0 && (
            <div className="col-span-4 bg-neutral-50 dark:bg-neutral-900 p-4 rounded-2xl text-center text-neutral-500 dark:text-neutral-400 text-sm">
              No hay registros de pesos hoy.
            </div>
          )}
        </div>
      )}

      {/* Create Form */}
      {isCreating && (
        <div className="bg-neutral-50 dark:bg-neutral-900 p-4 md:p-6 rounded-3xl animate-in slide-in-from-top-4 border border-neutral-200 dark:border-neutral-700">
          <h3 className="font-bold text-lg text-neutral-800 dark:text-white mb-4">Registrar Peso en Punto de Custodia</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Punto de Custodia</label>
              <select value={tipoReferencia} onChange={e => setTipoReferencia(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white">
                <option value="Traslado">Salida de Granja</option>
                <option value="Recepcion">Recepción en Bodega</option>
                <option value="Carga">Carga a Camión</option>
                <option value="Venta">Entrega a Cliente</option>
                <option value="Retorno">Retorno a Bodega</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Producto</label>
              <select value={producto} onChange={e => setProducto(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white">
                {catalogo.length > 0 ? catalogo.map(p => <option key={p.id}>{p.nombre}</option>) : (
                  <>
                    <option>Huevos - Grande</option>
                    <option>Huevos - Mediano</option>
                    <option>Huevos - Pequeño</option>
                    <option>Gallinaza</option>
                    <option>Aves (Pollo Entero)</option>
                  </>
                )}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Ubicación</label>
              <select value={ubicacion} onChange={e => setUbicacion(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white">
                <option>Granja</option>
                <option>Bodega Central</option>
                <option>Camión Ruta 1</option>
                <option>Camión Ruta 2</option>
                <option>Cliente</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Cantidad (unidades)</label>
              <input type="number" value={cantidadUnidades} onChange={e => setCantidadUnidades(Number(e.target.value))}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Unidad</label>
              <select value={unidad} onChange={e => setUnidad(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white">
                <option value="cartones">Cartones</option>
                <option value="kg">Kilogramos</option>
                <option value="sacos">Sacos</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Báscula Utilizada</label>
              <input type="text" value={basculaUtilizada} onChange={e => setBasculaUtilizada(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white placeholder:text-neutral-400" placeholder="Ej: Báscula #1" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Peso Esperado (kg)</label>
              <input type="number" step="0.1" value={pesoEsperado} onChange={e => setPesoEsperado(Number(e.target.value))}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Peso Real (kg)</label>
              <input type="number" step="0.1" value={pesoReal || ''} onChange={e => setPesoReal(Number(e.target.value))}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white font-bold text-lg" placeholder="0.0" />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Observaciones</label>
              <input type="text" value={observaciones} onChange={e => setObservaciones(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white placeholder:text-neutral-400" placeholder="Notas adicionales..." />
            </div>
          </div>
          {/* Preview */}
          {pesoReal > 0 && (
            <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-neutral-500 dark:text-neutral-400">Esperado:</span>
                  <span className="font-bold text-neutral-800 dark:text-white">{pesoEsperado} kg</span>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-400" />
                <div className="flex items-center gap-2">
                  <span className="text-neutral-500 dark:text-neutral-400">Real:</span>
                  <span className="font-bold text-neutral-800 dark:text-white">{pesoReal} kg</span>
                </div>
                <div className={cn("flex items-center gap-1 font-bold",
                  Math.abs(pesoReal - pesoEsperado) <= pesoEsperado * 0.02 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                  {Math.abs(pesoReal - pesoEsperado) <= pesoEsperado * 0.02 ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  Diferencia: {pesoReal - pesoEsperado > 0 ? '+' : ''}{(pesoReal - pesoEsperado).toFixed(2)} kg
                  ({((pesoReal - pesoEsperado) / pesoEsperado * 100).toFixed(1)}%)
                </div>
              </div>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button onClick={handleRegistrar} disabled={loading || pesoReal === 0}
              className="px-6 py-2.5 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-50 flex items-center" style={{ background: 'var(--brand-secondary)' }}>
              {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Scale className="w-4 h-4 mr-2" />}
              Registrar Peso
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white dark:bg-neutral-800 rounded-3xl shadow-sm border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
            <input type="text" placeholder="Buscar por producto u observaciones..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-xl text-sm focus:border-amber-500 outline-none shadow-sm text-neutral-800 dark:text-white placeholder:text-neutral-400" />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-neutral-400" />
            <select value={filtroUbicacion} onChange={e => setFiltroUbicacion(e.target.value)}
              className="bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-xl px-3 py-2.5 text-sm focus:border-amber-500 outline-none text-neutral-800 dark:text-white">
              {ubicaciones.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 uppercase tracking-wider font-bold text-xs border-b border-neutral-200 dark:border-neutral-700">
              <tr>
                <th className="px-6 py-4">Fecha</th>
                <th className="px-6 py-4">Punto Custodia</th>
                <th className="px-6 py-4">Producto</th>
                <th className="px-6 py-4">Ubicación</th>
                <th className="px-6 py-4 text-right">Esperado</th>
                <th className="px-6 py-4 text-right">Real</th>
                <th className="px-6 py-4 text-right">Diferencia</th>
                <th className="px-6 py-4 text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {filteredPesos.map(p => (
                <tr key={p.id} className="hover:bg-amber-50/30 dark:hover:bg-neutral-700/50 transition-colors">
                  <td className="px-6 py-4 text-neutral-500 dark:text-neutral-400 text-xs">{new Date(p.fecha).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <span className={cn("inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold",
                      p.tipoReferencia === 'Traslado' ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                      p.tipoReferencia === 'Recepcion' ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                      p.tipoReferencia === 'Carga' ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" :
                      p.tipoReferencia === 'Venta' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" :
                      "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300")}>
                      {p.tipoReferencia}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium text-neutral-800 dark:text-white">{p.producto}</td>
                  <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300 flex items-center gap-1"><MapPin className="w-3 h-3" /> {p.ubicacion}</td>
                  <td className="px-6 py-4 text-right text-neutral-700 dark:text-neutral-300">{Number(p.pesoEsperado).toFixed(1)} kg</td>
                  <td className="px-6 py-4 text-right font-bold text-neutral-900 dark:text-white">{Number(p.pesoReal).toFixed(1)} kg</td>
                  <td className={cn("px-6 py-4 text-right font-bold", Math.abs(Number(p.diferencia)) <= Number(p.pesoEsperado) * 0.02 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                    {Number(p.diferencia) > 0 ? '+' : ''}{Number(p.diferencia).toFixed(2)} kg
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold",
                      p.estado === 'Conforme' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" :
                      p.estado === 'ConDiferencia' ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                      "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300")}>
                      {p.estado === 'Conforme' ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                      {p.estado}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredPesos.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-neutral-500 dark:text-neutral-400">No se encontraron registros de peso.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
