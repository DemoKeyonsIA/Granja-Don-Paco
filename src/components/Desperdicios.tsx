import React, { useState, useEffect } from 'react';
import { Trash2, Plus, AlertTriangle, TrendingDown, MapPin, RefreshCw, X, Route, User as UserIcon, Calendar, Truck, Link2 } from 'lucide-react';
import { Desperdicio, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { sessionHeaders } from '../lib/session';

interface Props { currentUser: User; soloLectura?: boolean; }

export default function Desperdicios({ currentUser, soloLectura = false }: Props) {
  const [desperdicios, setDesperdicios] = useState<Desperdicio[]>([]);
  const [resumen, setResumen] = useState<any>(null);
  const [patrones, setPatrones] = useState<any>(null);
  const [rutas, setRutas] = useState<any[]>([]);
  const [camiones, setCamiones] = useState<any[]>([]);
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [subTab, setSubTab] = useState<'lista' | 'resumen' | 'patrones'>('lista');

  const [form, setForm] = useState({
    origen: 'Granja', producto: 'Huevos - Grande', cantidad: 0, unidad: 'cartones', peso: 0,
    motivo: 'Quebrado Granja', responsable: '', impactoFinanciero: 0, observaciones: '',
    rutaId: '', camionId: '', vendedorId: ''
  });

  const cargar = async () => {
    setLoading(true);
    try {
      const [dRes, rRes, rutasRes, camionesRes, usersRes] = await Promise.all([
        fetch('/api/desperdicios', { headers: sessionHeaders(currentUser.id) }), fetch('/api/desperdicios/resumen', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/rutas', { headers: sessionHeaders(currentUser.id) }), fetch('/api/camiones', { headers: sessionHeaders(currentUser.id) }), fetch('/api/users', { headers: sessionHeaders(currentUser.id) })
      ]);
      setDesperdicios(await dRes.json());
      setResumen(await rRes.json());
      setRutas((await rutasRes.json()) || []);
      setCamiones((await camionesRes.json()) || []);
      const users = (await usersRes.json()) || [];
      setVendedores(users.filter((u: any) => ['Comercial', 'Vendedor', 'Facturador', 'Camionero'].includes(u.role) || String(u.roles || '').split(',').some((r: string) => ['Comercial', 'Vendedor', 'Facturador', 'Camionero'].includes(r.trim()))));
    } catch { toast.error('No se pudieron cargar los datos de desperdicio.'); }
    setLoading(false);
  };

  const cargarPatrones = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (fechaInicio) qs.set('fechaInicio', fechaInicio);
      if (fechaFin) qs.set('fechaFin', `${fechaFin}T23:59:59`);
      const res = await fetch(`/api/desperdicios/patrones?${qs.toString()}`, { headers: sessionHeaders(currentUser.id) });
      setPatrones(await res.json());
    } catch { toast.error('No se pudieron cargar los patrones.'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  useEffect(() => {
    if (subTab === 'patrones') cargarPatrones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const crear = async () => {
    if (!form.origen || !form.producto || !form.cantidad || !form.motivo || !form.responsable) return;
    setLoading(true);
    try {
      const res = await fetch('/api/desperdicios', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify(form)
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al registrar la pérdida'); }
      toast.success('Pérdida registrada');
      setIsCreating(false);
      setForm({ origen: 'Granja', producto: 'Huevos - Grande', cantidad: 0, unidad: 'cartones', peso: 0, motivo: 'Quebrado Granja', responsable: '', impactoFinanciero: 0, observaciones: '', rutaId: '', camionId: '', vendedorId: '' });
      cargar();
    } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-red-100 dark:bg-red-900 p-2 rounded-xl"><Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" /></div>
          <div>
            <h2 className="text-xl font-black text-neutral-900 dark:text-white">Desperdicio y Merma</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Control de pérdidas por etapa</p>
          </div>
        </div>
            <div className="flex space-x-2">
              <button onClick={cargar} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
              {!soloLectura && (
                <button onClick={() => setIsCreating(true)} className="btn-primary">
                  <Plus className="w-4 h-4" /><span>Registrar Pérdida</span>
                </button>
              )}
            </div>
      </div>

      {/* Resumen */}
      {resumen && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Object.entries(resumen.porOrigen || {}).map(([origen, cantidad]) => (
            <div key={origen} className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
              <div className="flex items-center space-x-2 mb-1"><MapPin className="w-4 h-4 text-neutral-400 dark:text-neutral-500" /><p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">{origen}</p></div>
              <p className="text-2xl font-black text-red-600 dark:text-red-400 mt-1">{String(cantidad)}</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">unidades</p>
            </div>
          ))}
          <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
            <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Impacto Financiero (7 días)</p>
            <p className="text-2xl font-black text-neutral-900 dark:text-white mt-1">₡{Number(resumen.impactoTotal || 0).toLocaleString()}</p>
          </div>
        </div>
      )}

      <div className="flex border-b border-neutral-200 dark:border-neutral-700 space-x-6">
        {[['lista', 'Registro'], ['resumen', 'Resumen'], ['patrones', 'Patrones']].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k as any)}
            className={cn("pb-3 text-sm font-bold border-b-2 transition-colors",
              subTab === k ? "text-red-600 dark:text-red-400 border-red-600 dark:border-red-400" : "text-neutral-500 dark:text-neutral-400 border-transparent hover:text-neutral-800 dark:hover:text-white")}>{l}</button>
        ))}
      </div>

      {subTab === 'lista' && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Fecha</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Origen</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Producto</th><th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Cantidad</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Motivo</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Ruta</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Camión</th><th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Vendedor</th><th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Impacto</th></tr>
            </thead>
            <tbody>
              {desperdicios.map(d => (
                <tr key={d.id} className="border-b border-neutral-100 dark:border-neutral-700">
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{d.fecha}</td>
                  <td className="px-4 py-3"><span className="px-2 py-1 rounded-full text-xs font-bold bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300">{d.origen}</span></td>
                  <td className="px-4 py-3 font-medium text-neutral-900 dark:text-white">{d.producto}</td>
                  <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">{d.cantidad} {d.unidad || 'cartones'}</td>
                  <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{d.motivo}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">{rutas.find((r: any) => r.id === d.rutaId)?.nombre || '—'}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">{camiones.find((c: any) => c.id === d.camionId)?.nombre || '—'}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">{vendedores.find((v: any) => v.id === d.vendedorId)?.name || '—'}</td>
                  <td className="px-4 py-3 text-right text-neutral-900 dark:text-white">₡{Number(d.impactoFinanciero).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {desperdicios.length === 0 && <p className="p-6 text-center text-neutral-400 dark:text-neutral-500">Sin registros de desperdicio</p>}
        </div>
      )}

      {subTab === 'resumen' && resumen && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6">
          <h3 className="font-bold text-lg mb-4 text-neutral-900 dark:text-white">Resumen del Día</h3>
          <div className="space-y-3">
            {Object.entries(resumen.porOrigen || {}).map(([origen, cantidad]) => (
              <div key={origen} className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-900 rounded-lg">
                <span className="font-medium text-neutral-900 dark:text-white">{origen}</span>
                <span className="font-bold text-red-600 dark:text-red-400">{String(cantidad)} unidades</span>
              </div>
            ))}
            <div className="border-t border-neutral-200 dark:border-neutral-700 pt-3 flex items-center justify-between">
              <span className="font-bold text-neutral-900 dark:text-white">Impacto Total</span>
              <span className="font-black text-lg text-neutral-900 dark:text-white">₡{Number(resumen.impactoTotal || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {subTab === 'patrones' && (
        <div className="space-y-6">
          {/* Filtro de fechas */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Desde</label>
              <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
                className="border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Hasta</label>
              <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
                className="border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" />
            </div>
            <button onClick={cargarPatrones} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white" style={{ background: 'var(--brand-primary)' }}>
              <Calendar className="w-4 h-4" /> Aplicar
            </button>
            <button onClick={cargar} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400"><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></button>
          </div>

          {!patrones && <p className="text-sm text-neutral-400 dark:text-neutral-500">Cargando patrones…</p>}
          {patrones && (
            <>
              {/* Totales */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
                  <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Cartones perdidos</p>
                  <p className="text-2xl font-black text-red-600 dark:text-red-400 mt-1">{String(patrones.totales?.cartones ?? 0).toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
                  <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Impacto Total</p>
                  <p className="text-2xl font-black text-neutral-900 dark:text-white mt-1">₡{Number(patrones.totales?.impacto ?? 0).toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-neutral-800 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700">
                  <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Registros</p>
                  <p className="text-2xl font-black text-neutral-900 dark:text-white mt-1">{String(patrones.totales?.registros ?? 0)}</p>
                </div>
              </div>

              {/* Ranking por ruta */}
              <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700">
                  <Route className="w-4 h-4 text-red-500 dark:text-red-400" />
                  <h3 className="font-bold text-neutral-900 dark:text-white">Cartones perdidos por ruta</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Ruta</th>
                        <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Cartones</th>
                        <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Impacto</th>
                        <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Motivo top</th>
                        <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Vendedores</th>
                        <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Camiones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(patrones.porRuta || []).map((r: any, i: number) => (
                        <tr key={i} className="border-b border-neutral-100 dark:border-neutral-700">
                          <td className="px-4 py-3 font-semibold text-neutral-900 dark:text-white">{r.ruta}</td>
                          <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">{Number(r.cartones).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-neutral-900 dark:text-white">₡{Number(r.impacto).toLocaleString()}</td>
                          <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{r.motivoTop || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(r.vendedores || []).map((v: string, j: number) => (
                                <span key={j} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300">{v}</span>
                              ))}
                              {(r.vendedores || []).length === 0 && <span className="text-xs text-neutral-400 dark:text-neutral-500">Sin ventas</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3"><span className="text-xs text-neutral-500 dark:text-neutral-400">{(r.camiones || []).join(', ') || '—'}</span></td>
                        </tr>
                      ))}
                      {(patrones.porRuta || []).length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-400 dark:text-neutral-500">Sin desperdicios vinculados a rutas</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Ranking por vendedor */}
              <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700">
                  <UserIcon className="w-4 h-4 text-red-500 dark:text-red-400" />
                  <h3 className="font-bold text-neutral-900 dark:text-white">Cartones perdidos por vendedor</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Vendedor</th>
                        <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Cartones</th>
                        <th className="px-4 py-3 text-right font-bold text-neutral-600 dark:text-neutral-400">Impacto</th>
                        <th className="px-4 py-3 text-left font-bold text-neutral-600 dark:text-neutral-400">Rutas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(patrones.porVendedor || []).map((v: any, i: number) => (
                        <tr key={i} className="border-b border-neutral-100 dark:border-neutral-700">
                          <td className="px-4 py-3 font-semibold text-neutral-900 dark:text-white">{v.vendedor}</td>
                          <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">{Number(v.cartones).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-neutral-900 dark:text-white">₡{Number(v.impacto).toLocaleString()}</td>
                          <td className="px-4 py-3"><span className="text-xs text-neutral-500 dark:text-neutral-400">{(v.rutas || []).join(', ') || '—'}</span></td>
                        </tr>
                      ))}
                      {(patrones.porVendedor || []).length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-neutral-400 dark:text-neutral-500">Sin registros</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Desglose por motivo / producto / tendencia */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4">
                  <h3 className="font-bold text-sm mb-3 text-neutral-900 dark:text-white">Por motivo</h3>
                  <div className="space-y-2">
                    {(patrones.porMotivo || []).map((m: any, i: number) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{m.motivo}</span>
                        <span className="text-xs font-bold text-red-600 dark:text-red-400">{String(m.cartones).toLocaleString()} ct</span>
                      </div>
                    ))}
                    {(patrones.porMotivo || []).length === 0 && <p className="text-xs text-neutral-400 dark:text-neutral-500">Sin datos</p>}
                  </div>
                </div>
                <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4">
                  <h3 className="font-bold text-sm mb-3 text-neutral-900 dark:text-white">Por producto</h3>
                  <div className="space-y-2">
                    {(patrones.porProducto || []).map((p: any, i: number) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{p.producto}</span>
                        <span className="text-xs font-bold text-neutral-900 dark:text-white">{String(p.cartones).toLocaleString()} ct</span>
                      </div>
                    ))}
                    {(patrones.porProducto || []).length === 0 && <p className="text-xs text-neutral-400 dark:text-neutral-500">Sin datos</p>}
                  </div>
                </div>
                <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4">
                  <h3 className="font-bold text-sm mb-3 text-neutral-900 dark:text-white flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-500 dark:text-red-400" /> Tendencia diaria</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {(patrones.tendencia || []).map((t: any, i: number) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{String(t.fecha).slice(5, 10)}</span>
                        <span className="text-xs font-bold text-neutral-900 dark:text-white">{String(t.cartones).toLocaleString()} ct</span>
                        <span className="text-[10px] text-neutral-400 dark:text-neutral-500">₡{Number(t.impacto).toLocaleString()}</span>
                      </div>
                    ))}
                    {(patrones.tendencia || []).length === 0 && <p className="text-xs text-neutral-400 dark:text-neutral-500">Sin datos</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal crear */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4"><h3 className="font-bold text-lg text-neutral-900 dark:text-white">Registrar Pérdida</h3><button onClick={() => setIsCreating(false)}><X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" /></button></div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Origen *</label>
                  <select value={form.origen} onChange={e => setForm({ ...form, origen: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                    {['Granja', 'Bodega', 'Camión', 'Cliente'].map(o => <option key={o}>{o}</option>)}
                  </select></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Producto *</label>
                  <select value={form.producto} onChange={e => setForm({ ...form, producto: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                    {['Huevos - Grande', 'Huevos - Mediano', 'Huevos - Pequeño', 'Huevos - Extra'].map(p => <option key={p}>{p}</option>)}
                  </select></div>
              </div>
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Motivo *</label>
                <select value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                  {['Quebrado Granja', 'Quebrado Bodega', 'Quebrado Camión', 'Rechazo Cliente', 'Vencido', 'Sucio', 'Diferencia Peso', 'Ajuste Administrativo'].map(m => <option key={m}>{m}</option>)}
                </select></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Cantidad *</label>
                  <input type="number" min="0.01" step="0.01" value={form.cantidad || ''} onChange={e => setForm({ ...form, cantidad: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Unidad *</label>
                  <select value={form.unidad} onChange={e => setForm({ ...form, unidad: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                    <option value="cartones">Cartones</option><option value="kg">Kilos (kg)</option>
                  </select></div>
                <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Impacto (₡)</label>
                  <input type="number" value={form.impactoFinanciero || ''} onChange={e => setForm({ ...form, impactoFinanciero: Number(e.target.value) })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>
              </div>
              {form.unidad === 'kg' && <p className="text-xs text-amber-700 dark:text-amber-300">El sistema guardará el factor kg/cartón vigente. Sin factor, el cuadre quedará pendiente de conversión.</p>}
              <div><label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1">Responsable *</label>
                <input value={form.responsable} onChange={e => setForm({ ...form, responsable: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" /></div>

              {/* Vinculación opcional con la ruta / camión / vendedor para análisis de patrones */}
              <div className="bg-neutral-50 dark:bg-neutral-900 rounded-lg p-3 space-y-2 border border-neutral-200 dark:border-neutral-600">
                <p className="text-[11px] font-bold uppercase text-neutral-400 dark:text-neutral-500 flex items-center gap-1"><Link2 className="w-3 h-3" /> Vincular a la ruta (opcional)</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="flex items-center gap-1 text-[11px] font-bold text-neutral-500 dark:text-neutral-400 mb-0.5"><Route className="w-3 h-3" /> Ruta</label>
                    <select value={form.rutaId} onChange={e => setForm({ ...form, rutaId: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                      <option value="">Sin ruta</option>
                      {rutas.map((r: any) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-[11px] font-bold text-neutral-500 dark:text-neutral-400 mb-0.5"><Truck className="w-3 h-3" /> Camión</label>
                    <select value={form.camionId} onChange={e => setForm({ ...form, camionId: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                      <option value="">Sin camión</option>
                      {camiones.map((c: any) => <option key={c.id} value={c.id}>{c.nombre} ({c.placa || '—'})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-[11px] font-bold text-neutral-500 dark:text-neutral-400 mb-0.5"><UserIcon className="w-3 h-3" /> Vendedor</label>
                    <select value={form.vendedorId} onChange={e => setForm({ ...form, vendedorId: e.target.value })} className="w-full border border-neutral-200 dark:border-neutral-600 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white">
                      <option value="">Sin vendedor</option>
                      {vendedores.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <button onClick={crear} className="btn-primary btn-block">Registrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
