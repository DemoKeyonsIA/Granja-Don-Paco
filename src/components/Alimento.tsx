import React, { useState, useEffect } from 'react';
import { Wheat, Plus, AlertTriangle, CheckCircle, Droplets, TrendingDown, RefreshCw, X, Package } from 'lucide-react';
import { InventarioAlimento, ConsumoAlimento, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

interface Props { currentUser: User; }

export default function Alimento({ currentUser }: Props) {
  const [inventario, setInventario] = useState<InventarioAlimento[]>([]);
  const [consumos, setConsumos] = useState<ConsumoAlimento[]>([]);
  const [alertas, setAlertas] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isConsumo, setIsConsumo] = useState(false);
  const [subTab, setSubTab] = useState<'inventario' | 'consumo' | 'alertas'>('inventario');

  const [formInv, setFormInv] = useState({
    tipoAlimento: 'Producción', proveedor: '', loteAlimento: '', siloUbicacion: 'Silo 1',
    cantidadRecibida: 0, unidad: 'kg', responsable: ''
  });
  const [formCons, setFormCons] = useState({
    inventarioAlimentoId: '', galeronId: '', cantidadConsumida: 0, unidad: 'kg', responsable: '', observaciones: ''
  });

  const cargar = async () => {
    setLoading(true);
    try {
      const [iRes, cRes, aRes] = await Promise.all([
        fetch('/api/alimento'), fetch('/api/alimento/consumo'), fetch('/api/alimento/alertas')
      ]);
      setInventario(await iRes.json());
      setConsumos(await cRes.json());
      setAlertas(await aRes.json());
    } catch { toast.error('No se pudieron cargar los datos de alimento.'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const crearInventario = async () => {
    if (!formInv.tipoAlimento || !formInv.cantidadRecibida || !formInv.responsable) return;
    setLoading(true);
    try {
      const res = await fetch('/api/alimento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formInv)
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al registrar ingreso'); }
      toast.success('Ingreso de alimento registrado');
      setIsCreating(false);
      setFormInv({ tipoAlimento: 'Producción', proveedor: '', loteAlimento: '', siloUbicacion: 'Silo 1', cantidadRecibida: 0, unidad: 'kg', responsable: '' });
      cargar();
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };

  const registrarConsumo = async () => {
    if (!formCons.cantidadConsumida || !formCons.responsable) return;
    setLoading(true);
    try {
      const res = await fetch('/api/alimento/consumo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formCons)
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al registrar consumo'); }
      toast.success('Consumo registrado');
      setIsConsumo(false);
      setFormCons({ inventarioAlimentoId: '', galeronId: '', cantidadConsumida: 0, unidad: 'kg', responsable: '', observaciones: '' });
      cargar();
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };

  const totalInventario = inventario.filter(i => i.estado === 'Activo').reduce((a, i) => a + Number(i.cantidadActual), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl" style={{ background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)' }}><Wheat className="w-6 h-6" style={{ color: 'var(--brand-secondary)' }} /></div>
          <div>
            <h2 className="text-xl font-black text-neutral-900 dark:text-white">Control de Alimento</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Inventario, consumo y silos</p>
          </div>
        </div>
        <div className="flex space-x-2">
          <button onClick={cargar} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
          <button onClick={() => setIsCreating(true)} className="flex items-center space-x-2 text-white px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-secondary)' }}>
            <Plus className="w-4 h-4" /><span>Nuevo Ingreso</span>
          </button>
          <button onClick={() => setIsConsumo(true)} className="flex items-center space-x-2 text-white px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
            <TrendingDown className="w-4 h-4" /><span>Registrar Consumo</span>
          </button>
        </div>
      </div>

      {/* Resumen cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Stock Total</p>
          <p className="text-2xl font-black mt-1" style={{ color: 'var(--brand-secondary)' }}>{totalInventario.toLocaleString()} kg</p>
        </div>
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Silos Activos</p>
          <p className="text-2xl font-black text-neutral-900 dark:text-white mt-1">{inventario.filter(i => i.estado === 'Activo').length}</p>
        </div>
        <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
          <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Bajo Inventario</p>
          <p className="text-2xl font-black text-red-600 dark:text-red-400 mt-1">{alertas?.bajoInventario?.length || 0}</p>
        </div>
      </div>

      <div className="flex border-b border-neutral-200 dark:border-neutral-700 space-x-6">
        {[['inventario', 'Inventario'], ['consumo', 'Consumo'], ['alertas', 'Alertas']].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k as any)}
            className={cn("pb-3 text-sm font-bold border-b-2 transition-colors",
              subTab === k ? "text-stone-800 border-b-2" : "text-stone-400 border-transparent hover:text-stone-600")}
              style={subTab === k ? { borderColor: 'var(--brand-secondary)', color: 'var(--brand-secondary-dark)' } : {}}>{l}</button>
        ))}
      </div>

      {subTab === 'inventario' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Tipo</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Silo</th><th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Recibido</th><th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Actual</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Estado</th></tr>
            </thead>
            <tbody>
              {inventario.map(i => (
                <tr key={i.id} className="border-b border-neutral-100 dark:border-neutral-700">
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{i.tipoAlimento}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{i.siloUbicacion}</td>
                  <td className="px-4 py-3 text-right text-neutral-900 dark:text-white">{Number(i.cantidadRecibida).toLocaleString()} {i.unidad}</td>
                  <td className={cn("px-4 py-3 text-right font-bold", i.cantidadActual < i.cantidadRecibida * 0.2 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400")}>
                    {Number(i.cantidadActual).toLocaleString()} {i.unidad}
                  </td>
                  <td className="px-4 py-3"><span className={cn("px-2 py-1 rounded-full text-xs font-bold", i.estado === 'Activo' ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300")}>{i.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {inventario.length === 0 && <p className="p-6 text-center text-neutral-400 dark:text-neutral-500">Sin inventario de alimento</p>}
        </div>
      )}

      {subTab === 'consumo' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Fecha</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Cantidad</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Responsable</th></tr>
            </thead>
            <tbody>
              {consumos.map(c => (
                <tr key={c.id} className="border-b border-neutral-100 dark:border-neutral-700">
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{c.fecha}</td>
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{Number(c.cantidadConsumida)} {c.unidad}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{c.responsable}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {consumos.length === 0 && <p className="p-6 text-center text-neutral-400 dark:text-neutral-500">Sin consumos registrados</p>}
        </div>
      )}

      {subTab === 'alertas' && (
        <div className="space-y-3">
          {alertas?.bajoInventario?.map((i: any) => (
            <div key={i.id} className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex items-center space-x-3">
              <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-secondary)' }} />
              <div><p className="font-bold text-stone-800">{i.tipoAlimento} — {i.siloUbicacion}</p>
                <p className="text-sm" style={{ color: 'var(--brand-secondary)' }}>Stock: {Number(i.cantidadActual)} {i.unidad} ({Math.round((i.cantidadActual / i.cantidadRecibida) * 100)}%)</p></div>
            </div>
          ))}
          {(!alertas?.bajoInventario || alertas.bajoInventario.length === 0) && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-6 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 dark:text-green-400 mx-auto mb-2" />
              <p className="font-bold text-green-800 dark:text-green-300">Todos los silos con stock suficiente</p>
            </div>
          )}
        </div>
      )}

      {/* Modal crear inventario */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-white">Ingreso de Alimento</h3>
              <button onClick={() => setIsCreating(false)}><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Tipo de Alimento *</label>
                <select value={formInv.tipoAlimento} onChange={e => setFormInv({ ...formInv, tipoAlimento: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  {['Inicial', 'Crecimiento', 'Producción', 'Premix'].map(t => <option key={t}>{t}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Proveedor</label>
                  <input value={formInv.proveedor} onChange={e => setFormInv({ ...formInv, proveedor: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Lote</label>
                  <input value={formInv.loteAlimento} onChange={e => setFormInv({ ...formInv, loteAlimento: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Silo/Ubicación</label>
                  <select value={formInv.siloUbicacion} onChange={e => setFormInv({ ...formInv, siloUbicacion: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                    {['Silo 1', 'Silo 2', 'Silo 3', 'Bodega Alimento'].map(s => <option key={s}>{s}</option>)}
                  </select></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Cantidad (kg) *</label>
                  <input type="number" value={formInv.cantidadRecibida || ''} onChange={e => setFormInv({ ...formInv, cantidadRecibida: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              </div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Responsable *</label>
                <input value={formInv.responsable} onChange={e => setFormInv({ ...formInv, responsable: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              <button onClick={crearInventario} className="w-full text-white py-2.5 rounded-lg font-bold" style={{ background: 'var(--brand-secondary)' }}>Registrar Ingreso</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal consumo */}
      {isConsumo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-neutral-900 dark:text-white">Registrar Consumo</h3>
              <button onClick={() => setIsConsumo(false)}><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Inventario *</label>
                <select value={formCons.inventarioAlimentoId} onChange={e => setFormCons({ ...formCons, inventarioAlimentoId: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  <option value="">Seleccionar...</option>
                  {inventario.filter(i => i.estado === 'Activo').map(i => <option key={i.id} value={i.id}>{i.tipoAlimento} — {i.siloUbicacion} ({i.cantidadActual} kg)</option>)}
                </select></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Cantidad Consumida (kg) *</label>
                <input type="number" value={formCons.cantidadConsumida || ''} onChange={e => setFormCons({ ...formCons, cantidadConsumida: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Responsable *</label>
                <input value={formCons.responsable} onChange={e => setFormCons({ ...formCons, responsable: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              <button onClick={registrarConsumo} className="w-full text-white py-2.5 rounded-lg font-bold" style={{ background: 'var(--brand-primary)' }}>Registrar Consumo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
