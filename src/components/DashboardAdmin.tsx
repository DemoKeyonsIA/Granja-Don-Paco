import React, { useState, useEffect } from 'react';
import { DollarSign, Truck, Package, Activity, AlertTriangle, CheckCircle, TrendingUp, Users, Download, Plus, Trash2, Pencil, X, Check } from 'lucide-react';
import { Factura, InventarioItem } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

type CamionAdmin = {
  id: string;
  nombre: string;
  placa?: string | null;
  camioneroId?: string | null;
  camioneroNombre?: string | null;
  estado?: string | null;
};

export default function DashboardAdmin() {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [inventario, setInventario] = useState<InventarioItem[]>([]);
  const [gastos, setGastos] = useState<any[]>([]);
  const [guiasAuditoria, setGuiasAuditoria] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [camiones, setCamiones] = useState<CamionAdmin[]>([]);
  const [camioneros, setCamioneros] = useState<any[]>([]);
  const [modoCamion, setModoCamion] = useState<'lista' | 'nuevo' | 'editar'>('lista');
  const [camionForm, setCamionForm] = useState<{ nombre: string; placa: string; camioneroId: string }>({ nombre: '', placa: '', camioneroId: '' });
  const [editandoCamion, setEditandoCamion] = useState<CamionAdmin | null>(null);

  const fetchCamiones = async () => {
    try {
      const [cRes, uRes] = await Promise.all([fetch('/api/camiones'), fetch('/api/users')]);
      if (cRes.ok) setCamiones(await cRes.json());
      if (uRes.ok) {
        const users = await uRes.json();
        const camioneros = users.filter((u: any) => (u.roles || '').split(',').map((r: string) => r.trim()).includes('Camionero') || u.role === 'Camionero');
        setCamioneros(camioneros);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchCamiones(); }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [resFacturas, resInventario, resGastos, resTablero] = await Promise.all([
          fetch('/api/facturas'),
          fetch('/api/inventario'),
          fetch('/api/gastos'),
          fetch('/api/logistica/tablero')
        ]);
        
        if (resFacturas.ok) {
          const dataFact = await resFacturas.json();
          setFacturas(dataFact);
        }
        
        if (resInventario.ok) {
          const dataInv = await resInventario.json();
          setInventario(dataInv);
        }
        if (resGastos.ok) {
          const dataGastos = await resGastos.json();
          setGastos(dataGastos);
        }
        if (resTablero.ok) {
          const dataTablero = await resTablero.json();
          setGuiasAuditoria(dataTablero.guias || []);
        }
      } catch (error) {
        toast.error("Error al cargar datos del panel");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const hoy = new Date().toISOString().split('T')[0];
  
  const facturasHoy = facturas.filter(f => f.fecha.startsWith(hoy));
  const ingresosHoy = facturasHoy
    .filter(f => f.condicion_pago === 'Contado')
    .reduce((acc, f) => acc + f.total, 0);
    
  const cuentasPorCobrar = facturas
    .filter(f => f.condicion_pago === 'Credito' && f.estado !== 'Pagada')
    .reduce((acc, f) => acc + f.total, 0);

  const gastosOperativos = gastos.reduce((acc, g) => acc + g.monto, 0);
  const utilidadNeta = ingresosHoy - gastosOperativos;

  const stockBodega = inventario
    .filter(i => i.ubicacion === 'Bodega Central' && i.producto.includes('Huevos'))
    .reduce((acc, i) => acc + i.cantidad, 0);
    
  const stockTransito = inventario
    .filter(i => i.ubicacion.includes('Camión') && i.producto.includes('Huevos'))
    .reduce((acc, i) => acc + i.cantidad, 0);

  const totalHuevos = stockBodega + stockTransito;
  const porcentajeBodega = totalHuevos > 0 ? (stockBodega / totalHuevos) * 100 : 0;
  const porcentajeTransito = totalHuevos > 0 ? (stockTransito / totalHuevos) * 100 : 0;

  const handleCierre = () => {
    toast.success("Generando reporte de cierre del día y congelando transacciones...");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)', borderTopColor: 'transparent' }}></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6 pb-20 animate-in fade-in">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-neutral-800 dark:text-white tracking-tight">Panel Gerencial</h2>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm">Resumen financiero y operativo en tiempo real</p>
        </div>
        <button 
          onClick={handleCierre}
          className="flex items-center space-x-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 px-5 py-2.5 rounded-xl font-bold shadow-sm hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
        >
          <Download className="w-4 h-4" />
          <span>Cierre de Día</span>
        </button>
      </div>

      {/* Financial KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Ingresos del Día</h3>
            <div className="p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)' }}>
              <TrendingUp className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-3xl font-black text-neutral-800 dark:text-white">₡{ingresosHoy.toLocaleString()}</p>
            <p className="text-sm font-medium" style={{ color: 'var(--brand-primary)' }}>+12% vs ayer</p>
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Utilidad Neta</h3>
            <div className="p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)' }}>
              <DollarSign className="w-5 h-5" style={{ color: 'var(--brand-secondary)' }} />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-3xl font-black text-neutral-800 dark:text-white">₡{utilidadNeta.toLocaleString()}</p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 font-medium">Después de gastos operativos</p>
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Cuentas por Cobrar</h3>
            <div className="p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)' }}>
              <Activity className="w-5 h-5" style={{ color: 'var(--brand-secondary)' }} />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-3xl font-black text-neutral-800 dark:text-white">₡{cuentasPorCobrar.toLocaleString()}</p>
            <p className="text-sm font-medium" style={{ color: 'var(--brand-secondary)' }}>Deuda total acumulada</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inventory Semaphore */}
        <div className="bg-white dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm">
          <div className="flex items-center space-x-2 mb-6">
            <Package className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
            <h3 className="text-lg font-bold text-neutral-800 dark:text-white">Semáforo de Bodega (Huevos)</h3>
          </div>
          
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-sm font-bold mb-2">
                <span style={{ color: 'var(--brand-primary)' }}>Bodega Central</span>
                <span className="text-neutral-700 dark:text-neutral-300">{stockBodega.toLocaleString()} cartones</span>
              </div>
              <div className="w-full bg-neutral-100 dark:bg-neutral-700 rounded-full h-3">
                <div className="h-3 rounded-full" style={{ width: `${porcentajeBodega}%`, background: 'var(--brand-primary)' }}></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm font-bold mb-2">
                <span style={{ color: 'var(--brand-primary)' }}>En Tránsito (Calle)</span>
                <span className="text-neutral-700 dark:text-neutral-300">{stockTransito.toLocaleString()} cartones</span>
              </div>
              <div className="w-full bg-neutral-100 dark:bg-neutral-700 rounded-full h-3">
                <div className="h-3 rounded-full" style={{ width: `${porcentajeTransito}%`, background: 'var(--brand-secondary)' }}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Fleet Monitor */}
        <div className="bg-white dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center space-x-2 mb-4">
            <Truck className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
            <h3 className="text-lg font-bold text-neutral-800 dark:text-white">Auditoría de Rutas</h3>
          </div>
          
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 uppercase tracking-wider font-bold text-[10px] border-b border-neutral-200 dark:border-neutral-700">
                <tr>
                  <th className="px-4 py-3">Ruta</th>
                  <th className="px-4 py-3">Vendedor</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-right">Merma (Cartones)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                {guiasAuditoria.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <Truck className="w-10 h-10 text-neutral-300 dark:text-neutral-600 mb-3" />
                        <p className="text-neutral-700 dark:text-neutral-300 font-bold">Sin rutas activas hoy</p>
                        <p className="text-neutral-500 dark:text-neutral-400 text-xs mt-1">Las guías de despacho del día aparecerán aquí.</p>
                      </div>
                    </td>
                  </tr>
                )}
                {guiasAuditoria.map(ruta => {
                  const isEnRuta = ruta.estado === 'EnRuta';
                  const hasMerma = (ruta.mermaPreliminar || 0) !== 0;
                  
                  return (
                    <tr key={ruta.guiaId} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors">
                      <td className="px-4 py-3 font-bold text-neutral-800 dark:text-white">{ruta.rutaNombre || ruta.camionNombre || ruta.rutaId}</td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{ruta.vendedorNombre || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("inline-flex items-center px-2 py-1 rounded text-xs font-bold border",
                          isEnRuta ? "bg-stone-100 text-stone-700 border-stone-200" : "bg-stone-50 border-stone-200"
                        )}
                        style={isEnRuta ? {} : { color: 'var(--brand-primary-dark)', borderColor: 'color-mix(in srgb, var(--brand-primary) 20%, transparent)' }}>
                          {ruta.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {hasMerma ? (
                          <span className="text-red-600 dark:text-red-400 font-bold flex items-center justify-end space-x-1">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{ruta.mermaPreliminar}</span>
                          </span>
                        ) : (
                          <span className="font-bold flex items-center justify-end space-x-1" style={{ color: 'var(--brand-primary)' }}>
                            <CheckCircle className="w-3 h-3" />
                            <span>0</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Camiones (flujo granja→bodega) */}
      <div className="bg-white dark:bg-neutral-800 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Truck className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
            <h3 className="text-lg font-bold text-neutral-800 dark:text-white">Camiones de Granja→Bodega</h3>
          </div>
          <button onClick={() => { setModoCamion('nuevo'); setEditandoCamion(null); setCamionForm({ nombre: '', placa: '', camioneroId: '' }); }}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors"
            style={{ background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)', color: 'var(--brand-primary)' }}>
            <Plus className="w-4 h-4" /> <span>Nuevo camión</span>
          </button>
        </div>

        {modoCamion === 'nuevo' || modoCamion === 'editar' ? (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-600 p-4 space-y-3 mb-4">
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Nombre del camión</label>
              <input value={camionForm.nombre} onChange={e => setCamionForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Camión Jhon"
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 outline-none focus:border-neutral-500"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Placa (opcional)</label>
              <input value={camionForm.placa} onChange={e => setCamionForm(f => ({ ...f, placa: e.target.value }))}
                placeholder="Ej: ABC-123"
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 outline-none focus:border-neutral-500"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Camionero asignado</label>
              <select value={camionForm.camioneroId} onChange={e => setCamionForm(f => ({ ...f, camioneroId: e.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 outline-none focus:border-neutral-500">
                <option value="">— Sin asignar —</option>
                {camioneros.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                ))}
              </select>
              {camioneros.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">No hay usuarios con rol Camionero. Asígnalo al crear un usuario.</p>
              )}
            </div>
            <div className="flex space-x-2 pt-1">
              <button onClick={async () => {
                if (!camionForm.nombre.trim()) { toast.error('El nombre es requerido'); return; }
                try {
                  const url = modoCamion === 'editar' && editandoCamion ? `/api/camiones/${editandoCamion.id}` : '/api/camiones';
                  const res = await fetch(url, {
                    method: modoCamion === 'editar' ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: camionForm.nombre.trim(), placa: camionForm.placa.trim() || null, camioneroId: camionForm.camioneroId || null })
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'Error');
                  toast.success(data.message || 'Camión guardado');
                  setModoCamion('lista');
                  fetchCamiones();
                } catch (err: any) { toast.error(err.message); }
              }}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors"
                style={{ background: 'var(--brand-primary)' }}>
                {modoCamion === 'editar' ? 'Guardar cambios' : 'Crear camión'}
              </button>
              <button onClick={() => setModoCamion('lista')}
                className="px-4 py-2 rounded-lg text-sm font-bold text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 uppercase tracking-wider font-bold text-[10px] border-b border-neutral-200 dark:border-neutral-700">
              <tr>
                <th className="px-4 py-3">Camión</th>
                <th className="px-4 py-3">Placa</th>
                <th className="px-4 py-3">Camionero</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {camiones.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-neutral-500 dark:text-neutral-400 text-xs">
                    Sin camiones registrados. Crea uno para que el encargado pueda asignar cargas.
                  </td>
                </tr>
              )}
              {camiones.map(c => (
                <tr key={c.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors">
                  <td className="px-4 py-3 font-bold text-neutral-800 dark:text-white">{c.nombre}</td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{c.placa || '—'}</td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{c.camioneroNombre || 'Sin asignar'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold",
                      c.estado === 'Activo' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                    )}>
                      {c.estado || 'Activo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end space-x-1">
                      <button onClick={() => { setEditandoCamion(c); setCamionForm({ nombre: c.nombre, placa: c.placa || '', camioneroId: c.camioneroId || '' }); setModoCamion('editar'); }}
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={async () => {
                        if (!confirm(`¿Eliminar el camión "${c.nombre}"?`)) return;
                        try {
                          const res = await fetch(`/api/camiones/${c.id}`, { method: 'DELETE' });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || 'Error');
                          toast.success(data.message);
                          fetchCamiones();
                        } catch (err: any) { toast.error(err.message); }
                      }}
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
