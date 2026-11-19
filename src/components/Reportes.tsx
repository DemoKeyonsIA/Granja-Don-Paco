import React, { useState, useEffect } from 'react';
import { ArrowRight, RefreshCw, AlertCircle, CalendarDays } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { fmtCRC } from '../lib/finanzas';
import type { TipoReporte } from '../nav/modulos';
import { BloqueCarga } from './Spinner';
import { TarjetaKpi } from './TarjetaKpi';
import { sessionHeaders } from '../lib/session';

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
  onNavigate,
}: {
  currentUser: User;
  tipo: TipoReporte;
  onNavigate: (tab: string) => void;
}) {
  const reporteActivo = tipo;
  const [datos, setDatos] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fechaInicio, setFechaInicio] = useState(() => inicioMesActual());
  const [fechaFin, setFechaFin] = useState(() => fechaLocalHoy());

  useEffect(() => {
    cargarReporte();
  }, [reporteActivo, fechaInicio, fechaFin]);

  const cargarReporte = async () => {
    setLoading(true);
    setDatos(null);
    setError('');
    try {
      const params = new URLSearchParams();
      if (fechaInicio) params.set('fechaInicio', fechaInicio);
      if (fechaFin) params.set('fechaFin', fechaFin);
      const qs = params.toString();
      const url = `/api/reportes/${reporteActivo}${qs ? '?' + qs : ''}`;
      const res = await fetch(url, { headers: sessionHeaders(currentUser.id) });
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
      const mensaje = e instanceof Error ? e.message : String(e);
      setError(mensaje);
      toast.error('No se pudo cargar el reporte. Podés reintentarlo desde esta pantalla.');
    }
    setLoading(false);
  };

  const inventarioEsCorte = reporteActivo === 'inventario';
  const periodoVisible = `${formatoFecha(fechaInicio)} – ${formatoFecha(fechaFin)}`;
  const datosVacios = reporteSinDatos(reporteActivo, datos);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-neutral-900 dark:text-white">{etiquetaReporte(reporteActivo)}</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            {inventarioEsCorte ? 'Existencias al momento de la consulta.' : `Periodo: ${periodoVisible}`}
            {reporteActivo === 'financiero' && ' · Cuentas por cobrar muestra el saldo actual.'}
          </p>
        </div>
        {!inventarioEsCorte && <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-bold text-neutral-600 dark:text-neutral-300">Desde
            <input type="date" value={fechaInicio} max={fechaFin} onChange={e => setFechaInicio(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 focus:ring-2 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white" />
          </label>
          <label className="grid gap-1 text-xs font-bold text-neutral-600 dark:text-neutral-300">Hasta
            <input type="date" value={fechaFin} min={fechaInicio} max={fechaLocalHoy()} onChange={e => setFechaFin(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 focus:ring-2 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-700 dark:text-white" />
          </label>
          <button type="button" onClick={cargarReporte} disabled={loading || !fechaInicio || !fechaFin || fechaInicio > fechaFin}
            className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </div>}
      </div>

      {loading ? (
        <BloqueCarga className="py-20" />
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-red-300 bg-red-50 p-6 text-neutral-900 dark:border-red-800 dark:bg-red-950 dark:text-white">
          <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-300" />
            <div className="flex-1"><h3 className="font-bold">No se pudo cargar este reporte</h3><p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">La navegación sigue disponible. Revisá la conexión o intentá de nuevo.</p>
              <button type="button" onClick={cargarReporte} className="btn-primary mt-4 inline-flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Reintentar</button>
            </div>
          </div>
        </div>
      ) : datos == null || datosVacios ? (
        <EmptyReport mensaje="Todavía no hay información para mostrar." tipo={reporteActivo} onNavigate={onNavigate} />
      ) : (
        <div className="animate-in fade-in">
          {reporteActivo === 'financiero' && <ReporteFinanciero data={datos} />}
          {reporteActivo === 'ventas-por-ruta' && <ReporteVentasRuta data={datos} />}
          {reporteActivo === 'produccion' && <ReporteProduccion data={datos} />}
          {reporteActivo === 'inventario' && <ReporteInventario data={datos} />}
          {reporteActivo === 'flujo-caja' && <ReporteFlujoCaja data={datos} />}
          {reporteActivo === 'desperdicios' && <ReporteDesperdicios data={datos} />}
        </div>
      )}
    </div>
  );
}

function fechaLocalHoy() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function inicioMesActual() { return `${fechaLocalHoy().slice(0, 8)}01`; }
function formatoFecha(fecha: string) {
  if (!fecha) return '—';
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a}`;
}
function etiquetaReporte(tipo: TipoReporte) {
  return ({ financiero: 'Financiero', 'flujo-caja': 'Flujo de caja', 'ventas-por-ruta': 'Ventas por ruta', produccion: 'Producción', inventario: 'Inventario', desperdicios: 'Desperdicios' })[tipo];
}
function reporteSinDatos(tipo: TipoReporte, data: any) {
  if (data == null) return true;
  if (['ventas-por-ruta', 'produccion', 'inventario', 'desperdicios'].includes(tipo)) return !Array.isArray(data) || data.length === 0;
  const importes = tipo === 'financiero'
    ? [data.totalVentas, data.totalGastos, data.ingresosCobrados, data.cuentasPorCobrar]
    : [data.ingresosFacturados, data.ingresosCobrados, data.gastos];
  return importes.every(importe => Number(importe || 0) === 0);
}
function EmptyReport({ mensaje, tipo, onNavigate }: { mensaje: string; tipo?: TipoReporte; onNavigate?: (tab: string) => void }) {
  const acciones: Partial<Record<TipoReporte, { etiqueta: string; tab: string }[]>> = {
    financiero: [{ etiqueta: 'Ver documentos', tab: 'documentos' }, { etiqueta: 'Ver gastos de ruta', tab: 'gastos-ruta' }],
    'flujo-caja': [{ etiqueta: 'Ver gastos de ruta', tab: 'gastos-ruta' }, { etiqueta: 'Ver cobranza', tab: 'cobranza' }],
    'ventas-por-ruta': [{ etiqueta: 'Ver documentos', tab: 'documentos' }],
  };
  return <div className="rounded-2xl border border-neutral-200 bg-white px-6 py-12 text-center dark:border-neutral-700 dark:bg-neutral-800">
    <CalendarDays className="mx-auto h-8 w-8 text-neutral-500 dark:text-neutral-300" />
    <p className="mt-3 font-semibold text-neutral-900 dark:text-white">{mensaje}</p>
    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">Probá otro periodo o registrá actividad para este reporte.</p>
    {!!tipo && !!onNavigate && !!acciones[tipo]?.length && <div className="mt-5 flex flex-wrap justify-center gap-2">{acciones[tipo]!.map(accion => <button key={accion.tab} type="button" onClick={() => onNavigate(accion.tab)} className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-bold text-neutral-800 transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-600 dark:text-white dark:hover:bg-neutral-700">{accion.etiqueta}<ArrowRight className="ml-2 inline h-4 w-4" /></button>)}</div>}
  </div>;
}

function ReporteFinanciero({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <TarjetaKpi etiqueta="Total Ventas" valor={`₡${Number(data.totalVentas || 0).toLocaleString()}`} tono="positivo" superficie="tono" />
        <TarjetaKpi etiqueta="Total Gastos" valor={`₡${Number(data.totalGastos || 0).toLocaleString()}`} tono="negativo" superficie="tono" />
        <TarjetaKpi etiqueta="Utilidad Neta" valor={`₡${Number(data.utilidadNeta || 0).toLocaleString()}`} tono={data.utilidadNeta >= 0 ? 'positivo' : 'negativo'} superficie="tono" />
        <TarjetaKpi etiqueta="Cuentas por Cobrar · hoy" valor={fmtCRC(data.cuentasPorCobrar)} tono="alerta" superficie="tono" />
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
    return <EmptyReport mensaje="No hay movimientos de dinero en este periodo." />;
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
  if (!Array.isArray(data) || data.length === 0) return <EmptyReport mensaje="No hay ventas por ruta en este periodo." />;
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
              <p className="text-sm font-bold text-neutral-800 dark:text-white">{Number(det.cantidad).toLocaleString('es-CR')} · unidad no registrada — {fmtCRC(det.total)}</p>
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
  if (!Array.isArray(data) || data.length === 0) return <EmptyReport mensaje="No hay producción registrada en este periodo." />;
  return (
    <div className="space-y-4">
      {data.map((g: any) => (
        <div key={`${g.granja}-${g.unidad || 'sin-unidad'}`} className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-neutral-800 dark:text-white">{g.granja}</h3>
            <span className="text-lg font-black text-blue-700 dark:text-blue-300">{Number(g.totalProduccion).toLocaleString('es-CR')} {g.unidad || 'unidad no especificada'}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(g.porProducto && typeof g.porProducto === 'object' ? g.porProducto : {}).map(([prod, cant]: [string, any]) => (
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
  if (!Array.isArray(data) || data.length === 0) return <EmptyReport mensaje="No hay existencias registradas." />;
  return (
    <div className="space-y-4">
      {data.map((u: any) => (
        <div key={u.ubicacion} className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5">
          <h3 className="font-bold text-neutral-800 dark:text-white mb-3">{u.ubicacion}</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {(Array.isArray(u.productos) ? u.productos : []).map((p: any, i: number) => (
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
  if (!Array.isArray(data) || data.length === 0) return <EmptyReport mensaje="No hay pérdidas registradas en este periodo." />;
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    {data.map((item: any) => <article key={item.origen} className="rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-800">
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-neutral-900 dark:text-white">{item.origen || 'Origen no especificado'}</h3><p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{item.registros} registros</p></div><strong className="text-neutral-900 dark:text-white">{fmtCRC(item.impactoTotal)}</strong></div>
      <p className="mt-4 text-xs font-bold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">Cantidad registrada por unidad</p>
      <ul className="mt-2 space-y-2">{Object.entries(item.porUnidad || {}).map(([unidad, cantidad]: [string, any]) => <li key={unidad} className="flex justify-between gap-3 text-sm"><span className="text-neutral-700 dark:text-neutral-200">{unidad}</span><strong className="text-neutral-900 dark:text-white">{Number(cantidad).toLocaleString('es-CR')}</strong></li>)}</ul>
    </article>)}
  </div>;
}
