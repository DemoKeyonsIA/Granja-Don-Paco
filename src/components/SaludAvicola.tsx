import React, { useState, useEffect } from 'react';
import { Shield, Plus, AlertTriangle, CheckCircle, Clock, Calendar, Syringe, Search, RefreshCw, X } from 'lucide-react';
import { Vacunacion, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

interface Props { currentUser: User; }

export default function SaludAvicola({ currentUser }: Props) {
  const [vacunaciones, setVacunaciones] = useState<Vacunacion[]>([]);
  const [alertas, setAlertas] = useState<any>(null);
  const [granjas, setGranjas] = useState<any[]>([]);
  const [galerones, setGalerones] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [subTab, setSubTab] = useState<'calendario' | 'alertas' | 'historial'>('calendario');

  const [form, setForm] = useState({
    granjaId: '', galeronId: '', tipoVacuna: '', proveedor: '', dosis: '',
    metodoAplicacion: 'Inyectable', fechaProgramada: '', responsable: '', observaciones: ''
  });

  const cargar = async () => {
    setLoading(true);
    try {
      const [vRes, aRes, gRes, galRes] = await Promise.all([
        fetch('/api/vacunaciones'), fetch('/api/vacunaciones/alertas'),
        fetch('/api/granjas'), fetch('/api/galerones')
      ]);
      setVacunaciones(await vRes.json());
      setAlertas(await aRes.json());
      setGranjas(await gRes.json());
      setGalerones(await galRes.json());
    } catch { toast.error('No se pudieron cargar los datos de salud avícola.'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const crear = async () => {
    if (!form.granjaId || !form.tipoVacuna || !form.fechaProgramada || !form.responsable) return;
    setLoading(true);
    try {
      const res = await fetch('/api/vacunaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al registrar la vacunación'); }
      toast.success('Vacunación registrada');
      setIsCreating(false);
      setForm({ granjaId: '', galeronId: '', tipoVacuna: '', proveedor: '', dosis: '', metodoAplicacion: 'Inyectable', fechaProgramada: '', responsable: '', observaciones: '' });
      cargar();
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };

  const aplicar = async (id: string) => {
    try {
      const res = await fetch(`/api/vacunaciones/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'Aplicada', fechaAplicada: new Date().toISOString() })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al marcar como aplicada'); }
      toast.success('Vacunación marcada como aplicada');
      cargar();
    } catch (e: any) { toast.error(e.message); }
  };

  const estadoColor = (e: string) => {
    if (e === 'Aplicada') return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    if (e === 'Vencida') return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    if (e === 'Programada') return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300';
    return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300';
  };

  const hoy = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-emerald-100 dark:bg-emerald-900 p-2 rounded-xl"><Shield className="w-6 h-6 text-emerald-600 dark:text-emerald-400" /></div>
          <div>
            <h2 className="text-xl font-black text-neutral-900 dark:text-white">Salud Avícola</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Calendario de vacunación y control sanitario</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={cargar} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
          <button onClick={() => setIsCreating(true)} className="flex items-center space-x-2 text-white px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
            <Plus className="w-4 h-4" /><span>Nueva Vacunación</span>
          </button>
        </div>
      </div>

      {/* Alertas Banner */}
      {alertas && (alertas.vencidas.length > 0 || alertas.proximas.length > 0) && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl p-4">
          <div className="flex items-center space-x-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <span className="font-bold text-amber-800 dark:text-amber-300">Alertas Sanitarias</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {alertas.vencidas.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900/30 p-3 rounded-lg border border-red-200 dark:border-red-700">
                <p className="font-bold text-red-700 dark:text-red-400">{alertas.vencidas.length} Vacuna(s) Vencida(s)</p>
                {alertas.vencidas.map((v: any) => <p key={v.id} className="text-red-600 dark:text-red-400">{v.tipoVacuna} — {v.fechaProgramada}</p>)}
              </div>
            )}
            {alertas.proximas.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/30 p-3 rounded-lg border border-amber-200 dark:border-amber-700">
                <p className="font-bold text-amber-700 dark:text-amber-400">{alertas.proximas.length} Vacuna(s) Próximas</p>
                {alertas.proximas.map((v: any) => <p key={v.id} className="text-amber-600 dark:text-amber-400">{v.tipoVacuna} — {v.fechaProgramada}</p>)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-700 space-x-6">
        {[['calendario', 'Calendario'], ['alertas', 'Alertas'], ['historial', 'Historial']].map(([key, label]) => (
          <button key={key} onClick={() => setSubTab(key as any)}
            className={cn("pb-3 text-sm font-bold transition-colors border-b-2",
              subTab === key ? "text-emerald-600 dark:text-emerald-400 border-emerald-600 dark:border-emerald-400" : "text-neutral-500 dark:text-neutral-400 border-transparent hover:text-neutral-800 dark:hover:text-white")}>
            {label}
          </button>
        ))}
      </div>

      {/* Calendar view */}
      {subTab === 'calendario' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6">
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-2">
            {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }, (_, i) => {
              const d = new Date(); d.setDate(d.getDate() - d.getDay() + i);
              const fechaStr = d.toISOString().split('T')[0];
              const vacs = vacunaciones.filter(v => v.fechaProgramada?.startsWith(fechaStr));
              const isToday = fechaStr === hoy;
              return (
                <div key={i} className={cn("p-2 min-h-[60px] rounded-lg border text-left text-xs",
                  isToday ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30" : "border-neutral-100 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700")}>
                  <p className={cn("font-bold mb-1", isToday ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-700 dark:text-neutral-300")}>{d.getDate()}</p>
                  {vacs.map(v => (
                    <div key={v.id} className={cn("px-1 py-0.5 rounded text-[10px] font-bold mb-0.5 truncate", estadoColor(v.estado))}>
                      {v.tipoVacuna}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Alertas view */}
      {subTab === 'alertas' && alertas && (
        <div className="space-y-3">
          {alertas.vencidas.map((v: any) => (
            <div key={v.id} className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl p-4 flex items-center justify-between">
              <div><p className="font-bold text-red-800 dark:text-red-300">{v.tipoVacuna}</p><p className="text-sm text-red-600 dark:text-red-400">Vencida: {v.fechaProgramada}</p></div>
              <button onClick={() => aplicar(v.id)} className="text-white px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'var(--brand-primary)' }}>Marcar Aplicada</button>
            </div>
          ))}
          {alertas.vencidas.length === 0 && alertas.proximas.length === 0 && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-6 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 dark:text-green-400 mx-auto mb-2" />
              <p className="font-bold text-green-800 dark:text-green-300">Sin alertas pendientes</p>
            </div>
          )}
        </div>
      )}

      {/* Historial */}
      {subTab === 'historial' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Vacuna</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Fecha</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Responsable</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Estado</th></tr>
            </thead>
            <tbody>
              {vacunaciones.map(v => (
                <tr key={v.id} className="border-b border-neutral-100 dark:border-neutral-700">
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{v.tipoVacuna}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{v.fechaProgramada}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{v.responsable}</td>
                  <td className="px-4 py-3"><span className={cn("px-2 py-1 rounded-full text-xs font-bold", estadoColor(v.estado))}>{v.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {vacunaciones.length === 0 && <p className="p-6 text-center text-neutral-400 dark:text-neutral-500">Sin vacunaciones registradas</p>}
        </div>
      )}

      {/* Modal crear */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-white">Nueva Vacunación</h3>
              <button onClick={() => setIsCreating(false)}><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Granja *</label>
                <select value={form.granjaId} onChange={e => setForm({ ...form, granjaId: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  <option value="">Seleccionar...</option>
                  {granjas.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
                </select></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Galerón</label>
                <select value={form.galeronId} onChange={e => setForm({ ...form, galeronId: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  <option value="">Todos</option>
                  {galerones.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
                </select></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Tipo de Vacuna *</label>
                <input value={form.tipoVacuna} onChange={e => setForm({ ...form, tipoVacuna: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" placeholder="Ej: Newcastle, Bronquitis..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Proveedor</label>
                  <input value={form.proveedor} onChange={e => setForm({ ...form, proveedor: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Dosis</label>
                  <input value={form.dosis} onChange={e => setForm({ ...form, dosis: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              </div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Método</label>
                <select value={form.metodoAplicacion} onChange={e => setForm({ ...form, metodoAplicacion: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  {['Inyectable', 'Oral', 'Agua', 'Spray'].map(m => <option key={m}>{m}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Fecha Programada *</label>
                  <input type="date" value={form.fechaProgramada} onChange={e => setForm({ ...form, fechaProgramada: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Responsable *</label>
                  <input value={form.responsable} onChange={e => setForm({ ...form, responsable: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              </div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Observaciones</label>
                <textarea value={form.observaciones} onChange={e => setForm({ ...form, observaciones: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" rows={2} /></div>
              <button onClick={crear} className="w-full text-white py-2.5 rounded-lg font-bold" style={{ background: 'var(--brand-primary)' }}>Registrar Vacunación</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
