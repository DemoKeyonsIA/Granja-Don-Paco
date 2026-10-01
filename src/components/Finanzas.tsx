import React, { useState, useEffect } from 'react';
import { DollarSign, Truck, AlertTriangle, CheckCircle, TrendingUp, TrendingDown, Plus, Wrench, Fuel, Users, Package } from 'lucide-react';
import { User } from '../types';
import { fmtCRC } from '../lib/finanzas';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from 'sonner';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type FinanzasProps = {
  currentUser: User;
};

type Gasto = {
  id: string;
  fecha: string;
  categoria: string;
  monto: number;
  descripcion: string;
  usuarioId: string;
};

/** Subconjunto de `GET /api/finanzas/resumen` que esta pantalla usa. */
type ResumenFinanzas = {
  ingresosFacturados: number;
  ingresosCobrados: number;
  gastos: number;
  utilidad: number;
  margen: number;
  cuentasPorCobrar: number;
};

export default function Finanzas({ currentUser }: FinanzasProps) {
  const [activeTab, setActiveTab] = useState<'flujo' | 'registro'>('flujo');
  
  // State for Finanzas Flujo de Caja
  const [gastosList, setGastosList] = useState<Gasto[]>([]);
  // Las cifras de dinero salen de la fuente única; esta pantalla ya no las
  // recalcula. Antes sumaba facturas `Pagada` de todo el historial menos gastos
  // de todo el historial, así que mostraba un número distinto del de Analítica
  // y del reporte con los mismos datos.
  const [resumen, setResumen] = useState<ResumenFinanzas | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // State for Form
  const [categoria, setCategoria] = useState('');
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchFinanzas = async () => {
    setIsLoading(true);
    try {
      const [resResumen, resGastos] = await Promise.all([
        fetch('/api/finanzas/resumen'),
        fetch('/api/gastos')
      ]);

      if (resResumen.ok) {
        setResumen(await resResumen.json());
      }
      if (resGastos.ok) {
        setGastosList(await resGastos.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFinanzas();
  }, []);

  const handleRegisterGasto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoria || !monto || !descripcion) return;
    setIsSubmitting(true);
    
    try {
      const res = await fetch('/api/gastos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          fecha: new Date().toISOString(),
          categoria,
          monto: Number(monto),
          descripcion,
          usuarioId: currentUser.id
        })
      });

      if (!res.ok) throw new Error('Error al registrar gasto');
      
      toast.success('Gasto registrado exitosamente');
      setCategoria('');
      setMonto('');
      setDescripcion('');
      fetchFinanzas();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Las cifras vienen del endpoint: devengado (lo vendido, cobrado o no), que
  // es la base del P&L. `gastosList` sigue alimentando solo el historial.
  const ingresosTotales = resumen?.ingresosFacturados ?? 0;
  const gastosTotales = resumen?.gastos ?? 0;
  const utilidadNeta = resumen?.utilidad ?? 0;
  const margenUtilidad = resumen?.margen ?? 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in pb-20">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-neutral-800 tracking-tight">Módulo de Finanzas</h2>
        <p className="text-neutral-500 text-sm">Control de flujo de caja y registro de gastos operativos</p>
      </div>

      {/* Internal Navigation Tabs */}
      <div className="flex border-b border-neutral-200 space-x-8">
        {[
          { id: 'flujo', label: 'Flujo de Caja' },
          { id: 'registro', label: 'Registro de Gastos' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "pb-3 text-sm font-bold transition-colors relative",
              activeTab === tab.id ? "text-blue-600" : "text-neutral-500 hover:text-neutral-800"
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full" style={{ background: 'var(--brand-primary)' }} />
            )}
          </button>
        ))}
      </div>

      <div className="pt-2">
        {activeTab === 'flujo' && (
          <div className="space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center min-h-[30vh]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Ingresos del mes</h3>
                      <div className="bg-emerald-100 p-2 rounded-lg">
                        <TrendingUp className="w-5 h-5 text-emerald-600" />
                      </div>
                    </div>
                    <div>
                      <p className="text-3xl font-black text-neutral-800">{fmtCRC(ingresosTotales)}</p>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Gastos Totales</h3>
                      <div className="bg-orange-100 p-2 rounded-lg">
                        <TrendingDown className="w-5 h-5 text-orange-600" />
                      </div>
                    </div>
                    <div>
                      <p className="text-3xl font-black text-neutral-800">{fmtCRC(gastosTotales)}</p>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Utilidad Neta</h3>
                      <div className={cn("p-2 rounded-lg", utilidadNeta >= 0 ? "bg-blue-100" : "bg-red-100")}>
                        <DollarSign className={cn("w-5 h-5", utilidadNeta >= 0 ? "text-blue-600" : "text-red-600")} />
                      </div>
                    </div>
                    <div>
                      <p className={cn("text-3xl font-black", utilidadNeta >= 0 ? "text-neutral-800" : "text-red-600")}>
                        {fmtCRC(utilidadNeta)}
                      </p>
                      <p className="text-sm font-medium mt-1 text-neutral-500">
                        Margen: {margenUtilidad.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Historial de Gastos List */}
                <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
                  <div className="p-4 border-b border-neutral-200 bg-neutral-50/50 flex justify-between items-center">
                    <h3 className="font-bold text-neutral-800">Últimos Gastos Registrados</h3>
                  </div>
                  {gastosList.length > 0 ? (
                    <div className="divide-y divide-neutral-100">
                      {gastosList.slice().reverse().map(gasto => (
                        <div key={gasto.id} className="p-4 flex items-center justify-between hover:bg-neutral-50 transition-colors">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                              {gasto.categoria.includes('Diésel') || gasto.categoria.includes('Gasolina') ? <Fuel className="w-5 h-5" /> :
                               gasto.categoria.includes('Mantenimiento') ? <Wrench className="w-5 h-5" /> :
                               gasto.categoria.includes('Planilla') ? <Users className="w-5 h-5" /> :
                               gasto.categoria.includes('Insumos') ? <Package className="w-5 h-5" /> :
                               <Truck className="w-5 h-5" />
                              }
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">{gasto.categoria}</p>
                              <p className="text-xs text-neutral-500 max-w-md truncate">{gasto.descripcion}</p>
                              <p className="text-[10px] text-neutral-400 mt-0.5">{new Date(gasto.fecha).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-black text-lg text-orange-600">
                              - {fmtCRC(gasto.monto)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-10 text-center text-neutral-500">
                      <p>No hay gastos registrados todavía.</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'registro' && (
          <div className="max-w-xl">
            <form onSubmit={handleRegisterGasto} className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm space-y-6">
              <div className="flex items-center space-x-3 pb-4 border-b border-neutral-100">
                <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-neutral-800">Registrar Nuevo Gasto</h3>
                  <p className="text-xs text-neutral-500">Añade los gastos operativos de la jornada</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">Categoría</label>
                  <select
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                  >
                    <option value="">Seleccione una categoría</option>
                    <option value="Diésel">Diésel</option>
                    <option value="Viáticos">Viáticos</option>
                    <option value="Mantenimiento">Mantenimiento</option>
                    <option value="Insumos">Insumos</option>
                    <option value="Planilla">Planilla</option>
                    <option value="Otros">Otros</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">Monto (₡)</label>
                  <input
                    type="number"
                    min="1"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    placeholder="Ej. 15000"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">Descripción</label>
                  <textarea
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none"
                    placeholder="Ej. Peaje ruta 27 y almuerzo"
                    rows={3}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !categoria || !monto || !descripcion}
                className="w-full text-white font-bold py-3.5 rounded-xl disabled:opacity-50 transition-colors shadow-sm flex justify-center items-center" style={{ background: 'var(--brand-primary)' }}
              >
                {isSubmitting ? (
                  <span className="flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Guardando...
                  </span>
                ) : (
                  <span className="flex items-center">
                    <Plus className="w-5 h-5 mr-1.5" />
                    Registrar Gasto
                  </span>
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
