import React, { useState, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { fmtCRC } from '../lib/finanzas';
import type { TipoReporte } from '../nav/modulos';
import { BloqueCarga } from './Spinner';
import { TarjetaKpi } from './TarjetaKpi';

/**
 * Sub-fila de Analítica: los seis reportes.
 *
 * El tipo activo y su navegación bajan de `App.tsx` como prop. Antes eran un
 * `useState` local y una fila de tabs propia: eso dejaba el reporte visible sin
 * tab que lo seleccionara, que es el bug 2 del plan en otra forma. Ahora quien
 * navega es el shell, que también sabe qué roles ven esta pantalla.
 */
export default function Reportes({
  currentUser,
  tipo,
}: {
  currentUser: User;
  tipo: TipoReporte;
}) {
  const reporteActivo = tipo;
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

      {loading ? (
        <BloqueCarga className="py-20" />
      ) : !datos ? (
        <div className="text-center py-20 text-neutral-400 dark:text-neutral-500">No hay datos disponibles</div>
      ) : (
        <div className="animate-in fade-in">
          {reporteActivo === 'financiero' && <ReporteFinanciero data={datos} />}
          {reporteActivo === 'ventas-por-ruta' && <ReporteVentasRuta data={datos} />}
          {reporteActivo === 'produccion' && <ReporteProduccion data={datos} />}
          {reporteActivo === 'inventario' && <ReporteInventario data={datos} />}
          {reporteActivo === 'desperdicios' && <ReporteDesperdicios data={datos} />}
          {reporteActivo === 'flujo-caja' && <ReporteFlujoCaja data={datos} />}
        </div>
      )}
    </div>
  );
}

function ReporteFinanciero({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <TarjetaKpi etiqueta="Total Ventas" valor={`₡${Number(data.totalVentas || 0).toLocaleString()}`} tono="positivo" superficie="tono" />
        <TarjetaKpi etiqueta="Total Gastos" valor={`₡${Number(data.totalGastos || 0).toLocaleString()}`} tono="negativo" superficie="tono" />
        <TarjetaKpi etiqueta="Utilidad Neta" valor={`₡${Number(data.utilidadNeta || 0).toLocaleString()}`} tono={data.utilidadNeta >= 0 ? 'positivo' : 'negativo'} superficie="tono" />
        <TarjetaKpi etiqueta="Cuentas por Cobrar" valor={`₡${Number(data.cuentasPorCobrar || 0).toLocaleString()}`} tono="alerta" superficie="tono" />
        <TarjetaKpi etiqueta="Margen" valor={`${data.margen || 0}%`} tono="acento" superficie="tono" />
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

/**
 * Flujo de caja: el recorrido del dinero etapa por etapa.
 *
 * Se alimenta de `/api/finanzas/resumen`, no de `/api/reportes/financiero`:
 * el ciclo del dinero es devengado arriba y cobrado abajo, y el reporte
 * financiero legacy solo conoce el total de todo el historial.
 */
function ReporteFlujoCaja({ data }: { data: any }) {
  const ciclo: { etapa: string; etiqueta: string; monto: number }[] = data?.cicloDelDinero ?? [];
  const gastos = (data?.gastosPorCategoria ?? []) as { categoria: string; monto: number }[];
  const totalGastos = Number(data?.gastos || 0);
  const cobrado = Number(data?.ingresosCobrados || 0);
  // Caja es efectivo: lo que entró menos lo que salió. No se deriva de la
  // utilidad devengada, porque esa todavía incluye lo que no se cobró.
  const caja = cobrado - totalGastos;

  if (ciclo.length === 0 && gastos.length === 0) {
    return <div className="text-center py-10 text-neutral-400 dark:text-neutral-500">No hay movimientos en el periodo</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <TarjetaKpi etiqueta="Facturado" valor={fmtCRC(data?.ingresosFacturados)} tono="positivo" superficie="tono" />
        <TarjetaKpi etiqueta="Cobrado" valor={fmtCRC(cobrado)} tono="info" superficie="tono" />
        <TarjetaKpi etiqueta="Por cobrar" valor={fmtCRC(data?.cuentasPorCobrar)} tono="alerta" superficie="tono" />
        <TarjetaKpi etiqueta="Caja del periodo" valor={fmtCRC(caja)} tono={caja >= 0 ? 'positivo' : 'negativo'} superficie="tono" />
      </div>

      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6">
        <h3 className="font-bold text-neutral-800 dark:text-white mb-4">Del mostrador al resultado</h3>
        <ol className="space-y-2">
          {ciclo.map((n, i) => (
            <li key={n.etapa} className="flex items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2 min-w-0">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white" style={{ background: 'var(--brand-primary)' }}>{i + 1}</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
                <span className="text-sm text-neutral-700 dark:text-neutral-300 truncate">{n.etapa.replace(/_/g, ' ')}</span>
              </span>
              <span className="text-sm font-bold text-neutral-900 dark:text-white shrink-0">{fmtCRC(n.monto)}</span>
            </li>
          ))}
        </ol>
      </div>

      {gastos.length > 0 && (
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-6">
          <h3 className="font-bold text-neutral-800 dark:text-white mb-4">Dónde se fue la plata</h3>
          <div className="space-y-3">
            {gastos.map(g => (
              <div key={g.categoria}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-neutral-600 dark:text-neutral-400">{g.categoria}</span>
                  <span className="font-bold text-neutral-800 dark:text-white">{fmtCRC(g.monto)}</span>
                </div>
                <div className="h-2 rounded-full bg-neutral-100 dark:bg-neutral-700 overflow-hidden">
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${totalGastos > 0 ? Math.min((g.monto / totalGastos) * 100, 100) : 0}%` }}
                  />
                </div>
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
