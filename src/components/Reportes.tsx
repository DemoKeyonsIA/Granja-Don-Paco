import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Package, AlertTriangle, DollarSign, Loader2, Calendar } from 'lucide-react';
import { User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

type ReporteTipo = 'ventas-por-ruta' | 'produccion' | 'inventario' | 'desperdicios' | 'financiero';

export default function Reportes({ currentUser }: { currentUser: User }) {
  const [reporteActivo, setReporteActivo] = useState<ReporteTipo>('financiero');
  const [datos, setDatos] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');

  useEffect(() => {
    cargarReporte();
  }, [reporteActivo, fechaInicio, fechaFin]);

  const cargarReporte = async () => {
    setLoading(true);
    setDatos(null);
    try {
      const params = new URLSearchParams();
      if (fechaInicio) params.set('fechaInicio', fechaInicio);
      if (fechaFin) params.set('fechaFin', fechaFin);
      const qs = params.toString();
      const url = `/api/reportes/${reporteActivo}${qs ? '?' + qs : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        // Sin esto, un 404 se renderizaba como "No hay datos disponibles",
        // que hacía creer que el reporte venía vacío y no roto.
        const detalle = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText}${detalle ? `: ${detalle.slice(0, 200)}` : ''}`);
      }
      const data = await res.json();
      setDatos(data);
    } catch (e) {
      console.error('Error al cargar el reporte', reporteActivo, e);
      toast.error(`No se pudo cargar el reporte: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const tabs: { id: ReporteTipo; label: string; icon: any }[] = [
    { id: 'financiero', label: 'Financiero', icon: DollarSign },
    { id: 'ventas-por-ruta', label: 'Ventas por Ruta', icon: TrendingUp },
    { id: 'produccion', label: 'Producción', icon: BarChart3 },
    { id: 'inventario', label: 'Inventario', icon: Package },
    { id: 'desperdicios', label: 'Desperdicios', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-neutral-900 dark:text-white">Reportes</h2>
        <div className="flex items-center space-x-3">
          <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
            className="px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" />
          <span className="text-neutral-400 dark:text-neutral-500">a</span>
          <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
            className="px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white" />
        </div>
      </div>

      <div className="flex border-b border-neutral-200 dark:border-neutral-700 space-x-6 overflow-x-auto">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setReporteActivo(t.id)}
              className={`pb-3 text-sm font-bold flex items-center space-x-2 whitespace-nowrap border-b-2 transition-colors ${
                reporteActivo === t.id ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400' : 'text-neutral-500 dark:text-neutral-400 border-transparent hover:text-neutral-800 dark:hover:text-white'
              }`}>
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" />
        </div>
      ) : !datos ? (
        <div className="text-center py-20 text-neutral-400 dark:text-neutral-500">No hay datos disponibles</div>
      ) : (
        <div className="animate-in fade-in">
          {reporteActivo === 'financiero' && <ReporteFinanciero data={datos} />}
          {reporteActivo === 'ventas-por-ruta' && <ReporteVentasRuta data={datos} />}
          {reporteActivo === 'produccion' && <ReporteProduccion data={datos} />}
          {reporteActivo === 'inventario' && <ReporteInventario data={datos} />}
          {reporteActivo === 'desperdicios' && <ReporteDesperdicios data={datos} />}
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, color = 'blue' }: { label: string; value: string | number; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
    red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
    purple: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700',
  };
  return (
    <div className={`rounded-xl p-4 border ${colors[color] || colors.blue}`}>
      <p className="text-xs font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-black mt-1">{typeof value === 'number' ? value.toLocaleString('es-CR') : value}</p>
    </div>
  );
}

function ReporteFinanciero({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPI label="Total Ventas" value={`₡${Number(data.totalVentas || 0).toLocaleString()}`} color="green" />
        <KPI label="Total Gastos" value={`₡${Number(data.totalGastos || 0).toLocaleString()}`} color="red" />
        <KPI label="Utilidad Neta" value={`₡${Number(data.utilidadNeta || 0).toLocaleString()}`} color={data.utilidadNeta >= 0 ? 'green' : 'red'} />
        <KPI label="Cuentas por Cobrar" value={`₡${Number(data.cuentasPorCobrar || 0).toLocaleString()}`} color="yellow" />
        <KPI label="Margen" value={`${data.margen || 0}%`} color="purple" />
      </div>
      {data.gastosPorCategoria && Object.keys(data.gastosPorCategoria).length > 0 && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6">
          <h3 className="font-bold text-neutral-800 dark:text-white mb-4">Gastos por Categoría</h3>
          <div className="space-y-3">
            {Object.entries(data.gastosPorCategoria).map(([cat, monto]: [string, any]) => (
              <div key={cat} className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">{cat}</span>
                <span className="text-sm font-bold text-neutral-800 dark:text-white">₡{Number(monto).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReporteVentasRuta({ data }: { data: any[] }) {
  if (!Array.isArray(data) || data.length === 0) return <div className="text-center py-10 text-neutral-400 dark:text-neutral-500">No hay ventas registradas</div>;
  return (
    <div className="space-y-4">
      {data.map((r: any) => (
        <div key={r.ruta} className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-neutral-800 dark:text-white">{r.ruta}</h3>
            <div className="flex space-x-4 text-sm">
              <span className="text-neutral-500 dark:text-neutral-400">{r.facturas} facturas</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">₡{Number(r.totalVentas).toLocaleString()}</span>
            </div>
          </div>
          {r.productos && Object.keys(r.productos).length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
              {Object.entries(r.productos).map(([prod, det]: [string, any]) => (
                <div key={prod} className="bg-neutral-50 dark:bg-neutral-900 rounded-lg p-3">
                  <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400">{prod}</p>
                  <p className="text-sm font-bold text-neutral-800 dark:text-white">{det.cantidad} uds — ₡{Number(det.total).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReporteProduccion({ data }: { data: any[] }) {
  if (!Array.isArray(data) || data.length === 0) return <div className="text-center py-10 text-neutral-400 dark:text-neutral-500">No hay producción registrada</div>;
  return (
    <div className="space-y-4">
      {data.map((g: any) => (
        <div key={g.granja} className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-neutral-800 dark:text-white">{g.granja}</h3>
            <span className="text-lg font-black text-blue-600 dark:text-blue-400">{Number(g.totalProduccion).toLocaleString()} uds</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(g.porProducto).map(([prod, cant]: [string, any]) => (
              <div key={prod} className="bg-neutral-50 dark:bg-neutral-900 rounded-lg p-3">
                <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400">{prod}</p>
                <p className="text-sm font-bold text-neutral-800 dark:text-white">{Number(cant).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReporteInventario({ data }: { data: any[] }) {
  if (!Array.isArray(data) || data.length === 0) return <div className="text-center py-10 text-neutral-400 dark:text-neutral-500">No hay inventario</div>;
  return (
    <div className="space-y-4">
      {data.map((u: any) => (
        <div key={u.ubicacion} className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5">
          <h3 className="font-bold text-neutral-800 dark:text-white mb-3">{u.ubicacion}</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {u.productos.map((p: any, i: number) => (
              <div key={i} className="bg-neutral-50 dark:bg-neutral-900 rounded-lg p-3">
                <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400">{p.producto}</p>
                <p className="text-sm font-bold text-neutral-800 dark:text-white">{Number(p.cantidad).toLocaleString()} {p.unidad}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReporteDesperdicios({ data }: { data: any[] }) {
  if (!Array.isArray(data) || data.length === 0) return <div className="text-center py-10 text-neutral-400 dark:text-neutral-500">No hay desperdicios registrados</div>;
  return (
    <div className="space-y-4">
      {data.map((o: any) => (
        <div key={o.origen} className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-neutral-800 dark:text-white">{o.origen}</h3>
            <div className="flex space-x-4 text-sm">
              <span className="text-neutral-500 dark:text-neutral-400">{o.cantidadTotal} unidades</span>
              <span className="font-bold text-red-600 dark:text-red-400">₡{Number(o.impactoTotal).toLocaleString()}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(o.porMotivo).map(([motivo, det]: [string, any]) => (
              <div key={motivo} className="bg-red-50 dark:bg-red-900/30 rounded-lg p-3 border border-red-100 dark:border-red-700">
                <p className="text-xs font-bold text-red-600 dark:text-red-400">{motivo}</p>
                <p className="text-sm font-bold text-red-800 dark:text-red-300">{det.cantidad} uds — ₡{Number(det.impacto).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
