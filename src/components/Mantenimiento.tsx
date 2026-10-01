import React, { useState, useEffect } from 'react';
import { Wrench, Plus, AlertTriangle, CheckCircle, Clock, Calendar, DollarSign, RefreshCw, X, Settings } from 'lucide-react';
import { ActivoMantenimiento, OrdenMantenimiento, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

interface Props { currentUser: User; }

export default function Mantenimiento({ currentUser }: Props) {
  const [activos, setActivos] = useState<ActivoMantenimiento[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenMantenimiento[]>([]);
  const [alertas, setAlertas] = useState<any>(null);
  const [granjas, setGranjas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreatingActivo, setIsCreatingActivo] = useState(false);
  const [isCreatingOrden, setIsCreatingOrden] = useState(false);
  const [subTab, setSubTab] = useState<'activos' | 'ordenes' | 'alertas' | 'costos'>('activos');

  const [formActivo, setFormActivo] = useState({ nombre: '', tipo: 'Galerón', granjaId: '', ubicacion: '', responsable: '' });
  const [formOrden, setFormOrden] = useState({ activoId: '', tipo: 'Preventivo', fechaProgramada: '', responsable: '', costo: 0, observaciones: '' });

  const cargar = async () => {
    setLoading(true);
    try {
      const [aRes, oRes, alRes, gRes] = await Promise.all([
        fetch('/api/activos'), fetch('/api/ordenes-mantenimiento'),
        fetch('/api/ordenes-mantenimiento/alertas'), fetch('/api/granjas')
      ]);
      setActivos(await aRes.json());
      setOrdenes(await oRes.json());
      setAlertas(await alRes.json());
      setGranjas(await gRes.json());
    } catch { toast.error('No se pudieron cargar los datos de mantenimiento.'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const crearActivo = async () => {
    if (!formActivo.nombre || !formActivo.tipo) return;
    setLoading(true);
    try {
      const res = await fetch('/api/activos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formActivo)
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al crear el activo'); }
      toast.success('Activo creado');
      setIsCreatingActivo(false);
      setFormActivo({ nombre: '', tipo: 'Galerón', granjaId: '', ubicacion: '', responsable: '' });
      cargar();
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };

  const crearOrden = async () => {
    if (!formOrden.activoId || !formOrden.tipo || !formOrden.fechaProgramada || !formOrden.responsable) return;
    setLoading(true);
    try {
      const res = await fetch('/api/ordenes-mantenimiento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formOrden)
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al crear la orden'); }
      toast.success('Orden de mantenimiento creada');
      setIsCreatingOrden(false);
      setFormOrden({ activoId: '', tipo: 'Preventivo', fechaProgramada: '', responsable: '', costo: 0, observaciones: '' });
      cargar();
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };

  const completarOrden = async (id: string) => {
    try {
      const res = await fetch(`/api/ordenes-mantenimiento/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'Completado', fechaEjecutada: new Date().toISOString() })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al completar la orden'); }
      toast.success('Orden completada');
      cargar();
    } catch (e: any) { toast.error(e.message); }
  };

  const costoTotal = ordenes.reduce((a, o) => a + Number(o.costo), 0);
  const hoy = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-blue-100 dark:bg-blue-900 p-2 rounded-xl"><Wrench className="w-6 h-6 text-blue-600 dark:text-blue-400" /></div>
          <div>
            <h2 className="text-xl font-black text-neutral-900 dark:text-white">Mantenimiento</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Activos, órdenes y costos</p>
          </div>
        </div>
        <div className="flex space-x-2">
          <button onClick={cargar} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
          <button onClick={() => setIsCreatingActivo(true)} className="flex items-center space-x-2 text-white px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
            <Plus className="w-4 h-4" /><span>Activo</span>
          </button>
          <button onClick={() => setIsCreatingOrden(true)} className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 dark:hover:bg-indigo-500">
            <Plus className="w-4 h-4" /><span>Orden</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Activos</p>
          <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{activos.length}</p>
        </div>
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Órdenes Pendientes</p>
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{alertas?.totalPendientes || 0}</p>
        </div>
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Costo Total</p>
          <p className="text-2xl font-black text-neutral-900 dark:text-white mt-1">₡{costoTotal.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex border-b border-neutral-200 dark:border-neutral-700 space-x-6">
        {[['activos', 'Activos'], ['ordenes', 'Órdenes'], ['alertas', 'Alertas'], ['costos', 'Costos']].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k as any)}
            className={cn("pb-3 text-sm font-bold border-b-2 transition-colors",
              subTab === k ? "text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400" : "text-neutral-500 dark:text-neutral-400 border-transparent hover:text-neutral-800 dark:hover:text-white")}>{l}</button>
        ))}
      </div>

      {subTab === 'activos' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Nombre</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Tipo</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Ubicación</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Estado</th></tr>
            </thead>
            <tbody>
              {activos.map(a => (
                <tr key={a.id} className="border-b border-neutral-100 dark:border-neutral-700">
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{a.nombre}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{a.tipo}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{a.ubicacion || '—'}</td>
                  <td className="px-4 py-3"><span className={cn("px-2 py-1 rounded-full text-xs font-bold",
                    a.estado === 'Operativo' ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300")}>{a.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {activos.length === 0 && <p className="p-6 text-center text-neutral-400 dark:text-neutral-500">Sin activos registrados</p>}
        </div>
      )}

      {subTab === 'ordenes' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Tipo</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Programada</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Responsable</th><th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Costo</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Estado</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {ordenes.map(o => (
                <tr key={o.id} className="border-b border-neutral-100 dark:border-neutral-700">
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{o.tipo}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{o.fechaProgramada}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{o.responsable}</td>
                  <td className="px-4 py-3 text-right text-neutral-900 dark:text-white">₡{Number(o.costo).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={cn("px-2 py-1 rounded-full text-xs font-bold",
                    o.estado === 'Completado' ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                    o.estado === 'Pendiente' && o.fechaProgramada < hoy ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                    "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300")}>{o.estado}</span></td>
                  <td className="px-4 py-3">
                    {o.estado === 'Pendiente' && (
                      <button onClick={() => completarOrden(o.id)} className="text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 text-xs font-bold">Completar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ordenes.length === 0 && <p className="p-6 text-center text-neutral-400 dark:text-neutral-500">Sin órdenes registradas</p>}
        </div>
      )}

      {subTab === 'alertas' && (
        <div className="space-y-3">
          {alertas?.vencidas?.map((o: any) => (
            <div key={o.id} className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl p-4 flex items-center space-x-3">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
              <div className="flex-1"><p className="font-bold text-red-800 dark:text-red-300">{o.tipo} — Vencido</p><p className="text-sm text-red-600 dark:text-red-400">Programado: {o.fechaProgramada}</p></div>
              <button onClick={() => completarOrden(o.id)} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-green-700 dark:hover:bg-green-500">Completar</button>
            </div>
          ))}
          {alertas?.proximas?.map((o: any) => (
            <div key={o.id} className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex items-center space-x-3">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div><p className="font-bold text-amber-800 dark:text-amber-300">{o.tipo}</p><p className="text-sm text-amber-600 dark:text-amber-400">Programado: {o.fechaProgramada}</p></div>
            </div>
          ))}
          {(!alertas?.vencidas?.length && !alertas?.proximas?.length) && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-6 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 dark:text-green-400 mx-auto mb-2" />
              <p className="font-bold text-green-800 dark:text-green-300">Sin mantenimientos pendientes</p>
            </div>
          )}
        </div>
      )}

      {subTab === 'costos' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Tipo</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Fecha</th><th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Costo</th></tr>
            </thead>
            <tbody>
              {ordenes.filter(o => o.costo > 0).map(o => (
                <tr key={o.id} className="border-b border-neutral-100 dark:border-neutral-700">
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{o.tipo}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{o.fechaEjecutada || o.fechaProgramada}</td>
                  <td className="px-4 py-3 text-right font-bold text-neutral-900 dark:text-white">₡{Number(o.costo).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-4 border-t border-neutral-200 dark:border-neutral-700 text-right font-bold text-lg text-neutral-900 dark:text-white">Total: ₡{costoTotal.toLocaleString()}</div>
        </div>
      )}

      {/* Modal activo */}
      {isCreatingActivo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4"><h3 className="font-bold text-lg text-neutral-900 dark:text-white">Nuevo Activo</h3><button onClick={() => setIsCreatingActivo(false)}><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button></div>
            <div className="space-y-3">
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Nombre *</label>
                <input value={formActivo.nombre} onChange={e => setFormActivo({ ...formActivo, nombre: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Tipo *</label>
                <select value={formActivo.tipo} onChange={e => setFormActivo({ ...formActivo, tipo: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  {['Galerón', 'Silo', 'Sistema Agua', 'Eléctrico', 'Ventilación', 'Cerca', 'Equipo Recolect', 'Vehículo', 'Herramienta', 'Báscula', 'Estante', 'Andén'].map(t => <option key={t}>{t}</option>)}
                </select></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Responsable</label>
                <input value={formActivo.responsable} onChange={e => setFormActivo({ ...formActivo, responsable: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              <button onClick={crearActivo} className="w-full text-white py-2.5 rounded-lg font-bold" style={{ background: 'var(--brand-primary)' }}>Crear Activo</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal orden */}
      {isCreatingOrden && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4"><h3 className="font-bold text-lg text-neutral-900 dark:text-white">Nueva Orden</h3><button onClick={() => setIsCreatingOrden(false)}><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button></div>
            <div className="space-y-3">
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Activo *</label>
                <select value={formOrden.activoId} onChange={e => setFormOrden({ ...formOrden, activoId: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  <option value="">Seleccionar...</option>
                  {activos.map(a => <option key={a.id} value={a.id}>{a.nombre} ({a.tipo})</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Tipo *</label>
                  <select value={formOrden.tipo} onChange={e => setFormOrden({ ...formOrden, tipo: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                    {['Preventivo', 'Correctivo', 'Limpieza', 'Inspección', 'Calibración'].map(t => <option key={t}>{t}</option>)}
                  </select></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Fecha *</label>
                  <input type="date" value={formOrden.fechaProgramada} onChange={e => setFormOrden({ ...formOrden, fechaProgramada: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Responsable *</label>
                  <input value={formOrden.responsable} onChange={e => setFormOrden({ ...formOrden, responsable: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Costo (₡)</label>
                  <input type="number" value={formOrden.costo || ''} onChange={e => setFormOrden({ ...formOrden, costo: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              </div>
              <button onClick={crearOrden} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-bold hover:bg-indigo-700 dark:hover:bg-indigo-500">Crear Orden</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
