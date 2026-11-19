/**
 * Tab Resumen de Finanzas: la pantalla A→D del boceto.
 *
 * Reemplaza a `Finanzas.tsx` (eliminado en esta fase). No recalcula ninguna
 * cifra: el dinero sale de `GET /api/finanzas/resumen`, la fuente única del P&L
 * desde la Fase 3, y la operación sale de `GET /api/dashboard/enterprise`. Esta
 * pantalla decide qué se muestra y cómo se cuenta, no cuánto vale.
 *
 * Cuatro bloques, en el orden en que se leen:
 *   1. Cinco tarjetas: Ingresos, Cobrado, Gastos, Utilidad, Por cobrar.
 *   2. La banda del ciclo del dinero: de la venta en ruta al resultado.
 *   3. "Requiere atención": una sola bandeja, con lo de dinero y lo de operación.
 *   4. Columna derecha: "Salud del negocio" (lo que el Centro de Mando aportaba)
 *      sobre "Salud de la cartera" (aging).
 *
 * Desde la Fase 5 esta pantalla es también el principio de la app: el módulo
 * `dashboard` se disolvió acá, así que estas cifras se ven sin cambiar de lugar.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Clock, DollarSign, FileText,
  TrendingDown, TrendingUp, Wallet, ClipboardList,
} from 'lucide-react';
import type { User } from '../types';
import { fmtCRC, type NodoCiclo, type RangoPeriodo } from '../lib/finanzas';
import { BloqueCarga } from './Spinner';
import { TarjetaKpi } from './TarjetaKpi';
import SaludDelNegocio, { operativoDe, type SaludNegocio } from './SaludDelNegocio';
import { sessionHeaders } from '../lib/session';
import ConciliacionDepositos from './ConciliacionDepositos';

type Aging = { alDia: number; d1_30: number; d31_60: number; d60: number };

type CategoriaGasto = { categoria: string; monto: number };

/** Subconjunto de `/api/finanzas/resumen` que esta pantalla usa. */
type ResumenFinanzas = {
  periodo: RangoPeriodo;
  ingresosFacturados: number;
  ingresosCobrados: number;
  gastos: number;
  utilidad: number;
  margen: number;
  cuentasPorCobrar: number;
  variacion: {
    ingresosFacturados: number | null;
    ingresosCobrados: number | null;
    gastos: number | null;
    utilidad: number | null;
  };
  gastosPorCategoria: CategoriaGasto[];
  cicloDelDinero: NodoCiclo[];
  aging: Aging;
  documentosEmitidos: number;
  conciliacionCaja?: {
    cierres: number;
    pendientesConteo: number;
    diferenciasPendientes: number;
    cierresCuadrados: number;
    depositosPendientes: number;
    depositosConciliados: number;
    montoDepositado: number;
    gastosEfectivo: number;
    efectivoEsperado: number;
    efectivoContado: number;
    diferenciaNeta: number;
  };
};

/** Respuesta de `/api/dashboard/enterprise`, tal cual la devuelve el server. */
type DashboardEnterprise = {
  ingresosHoy: number;
  ingresosCobradosHoy: number;
  gastosHoy: number;
  utilidadNeta: number;
  cuentasPorCobrar: number;
  facturasEmitidas: number;
  cartonesProducidos: number;
  stockBodegaCentral: number;
  totalAvesVivas: number;
  clientesActivos: number;
  rutasActivas: number;
  vacunasVencidas: number;
  mantenimientosVencidos: number;
  desperdiciosHoy: number;
  impactoDesperdicioHoy: number;
  alertas: { tipo: string; detalle: string; nivel: string }[];
};

/** Un aviso de la bandeja. `nivel` decide el color, no el orden. */
type Aviso = {
  id: string;
  nivel: 'alto' | 'medio' | 'bajo';
  titulo: string;
  detalle: string;
  monto: number | null;
};

const ETIQUETAS_AGING: { id: keyof Aging; label: string; nivel: Aviso['nivel'] }[] = [
  { id: 'd60', label: 'Más de 60 días', nivel: 'alto' },
  { id: 'd31_60', label: 'Entre 31 y 60 días', nivel: 'medio' },
  { id: 'd1_30', label: 'Entre 1 y 30 días', nivel: 'medio' },
  { id: 'alDia', label: 'Al día', nivel: 'bajo' },
];

/**
 * La bandeja "Requiere atención", derivada de las cifras que yacollapsed.
 *
 * Cada aviso nace de un número que el endpoint ya trae; ninguno inventa un
 * umbral propio. El orden es por monto porque el trabajo más caro es el que
 * más plata tiene quieta.
 */
const avisosDe = (r: ResumenFinanzas): Aviso[] => {
  const avisos: Aviso[] = [];
  const vencido = r.aging.d1_30 + r.aging.d31_60 + r.aging.d60;

  if (r.aging.d60 > 0) {
    avisos.push({
      id: 'aging-60',
      nivel: 'alto',
      titulo: 'Cartera con más de 60 días',
      detalle: 'Revisa el vencimiento, el seguimiento realizado y el soporte de cobro.',
      monto: r.aging.d60,
    });
  }
  if (r.aging.d31_60 > 0) {
    avisos.push({
      id: 'aging-31',
      nivel: 'medio',
      titulo: 'Cartera entre 31 y 60 días',
      detalle: 'Revisa cuáles facturas siguen abiertas y programa su seguimiento.',
      monto: r.aging.d31_60,
    });
  }
  if (r.utilidad < 0) {
    avisos.push({
      id: 'utilidad-negativa',
      nivel: 'alto',
      titulo: 'El periodo cierra en pérdida',
      detalle: 'Los gastos superaron a lo facturado en el mes en curso.',
      monto: r.utilidad,
    });
  }
  if (r.ingresosFacturados > 0 && r.ingresosCobrados < r.ingresosFacturados) {
    const noCobrado = Math.round(r.ingresosFacturados - r.ingresosCobrados);
    avisos.push({
      id: 'devengado-cobrado',
      nivel: 'bajo',
      titulo: 'Facturado y todavía no cobrado',
      detalle: 'Es la diferencia entre lo que se vendió y lo que entró a caja.',
      monto: noCobrado,
    });
  }
  const gastoTop = (r.gastosPorCategoria ?? [])[0];
  if (gastoTop && gastoTop.monto > 0 && r.gastos > 0 && gastoTop.monto / r.gastos >= 0.5) {
    avisos.push({
      id: 'gasto-concentrado',
      nivel: 'bajo',
      titulo: `Gasto concentrado en ${gastoTop.categoria}`,
      detalle: 'Una sola categoría explica la mitad de los gastos del mes.',
      monto: gastoTop.monto,
    });
  }
  return avisos.sort((a, b) => (b.monto ?? -1) - (a.monto ?? -1));
};

/**
 * Las alertas que traía la bandeja del Centro de Mando (vacunas y
 * mantenimientos vencidos, diferencias de recepción) traducidas al mismo formato
 * que los avisos de dinero.
 *
 * Se fusionan en la misma bandeja en vez de vivir aparte por dos razones: eran
 * dos listas de "cosas que hay que hacer hoy" en dos pantallas que ya no existen
 * como pantallas separadas, y separarlas obligaba al usuario a recordarlas.
 * `Crítica` y `Alta` se distinguen por el color, igual que antes.
 */
const avisosOperativosDe = (alertas: DashboardEnterprise['alertas']): Aviso[] =>
  (alertas ?? []).map((a, i) => ({
    id: `operativo-${i}`,
    nivel: a.nivel === 'Crítica' ? 'alto' as const : 'medio' as const,
    titulo: a.tipo,
    detalle: a.detalle,
    monto: null,
  }));

const accionParaAviso = (aviso?: Aviso): { tab: string; texto: string } | null => {
  if (!aviso) return null;
  if (aviso.id.startsWith('aging') || aviso.id === 'devengado-cobrado') return { tab: 'cobranza', texto: 'Ver cobranza' };
  if (aviso.id === 'gasto-concentrado') return { tab: 'gastos-ruta', texto: 'Ver gastos' };
  if (aviso.id === 'utilidad-negativa') return { tab: 'reporte:financiero', texto: 'Ver resultado' };
  return null;
};

const ESTILO_NIVEL: Record<Aviso['nivel'], { fondo: string; texto: string; punto: string }> = {
  alto: { fondo: 'bg-red-50 dark:bg-red-950/30', texto: 'text-red-800 dark:text-red-300', punto: 'bg-red-500' },
  medio: { fondo: 'bg-amber-50 dark:bg-amber-950/30', texto: 'text-amber-900 dark:text-amber-200', punto: 'bg-amber-500' },
  bajo: { fondo: 'bg-neutral-50 dark:bg-neutral-800/50', texto: 'text-neutral-700 dark:text-neutral-300', punto: 'bg-neutral-400' },
};

/**
 * Tarjeta de dinero. Envuelve `TarjetaKpi` y le pone lo que el componente
 * compartido no puede saber: si una variación es mala depende del signo que
 * importa —un gasto que sube es malo, un ingreso que sube es bueno— y qué se
 * muestra cuando el periodo anterior fue cero.
 */
function Tarjeta({
  label, valor, variacion, ayuda, icono: Icono, negativo = false, maloSiSube = false, onClick,
}: {
  label: string;
  valor: number;
  /** `null` = el periodo anterior fue cero y no hay con qué comparar. */
  variacion?: number | null;
  ayuda?: string;
  icono: React.ComponentType<{ className?: string }>;
  negativo?: boolean;
  maloSiSube?: boolean;
  onClick?: () => void;
}) {
  // Una variación no comparable (`null`, periodo anterior en cero) no se pinta
  // como 0%: sería una mentira más pequeña que la de al lado.
  const malo = variacion == null ? null : (maloSiSube ? variacion > 0 : variacion < 0);
  const contenido = <TarjetaKpi
      etiqueta={label}
      valor={fmtCRC(valor)}
      icono={Icono}
      tono={negativo ? 'negativo' : 'neutro'}
      tamanoValor="xl"
      nivelEtiqueta={3}
      ayuda={ayuda}
    >
      <div className="flex items-center gap-2 mt-2 min-h-[1.25rem]">
        {variacion != null && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${
            malo ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
          }`}>
            {variacion >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {Math.abs(variacion).toFixed(1)}%
          </span>
        )}
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {variacion == null ? 'Sin periodo anterior con que comparar' : 'vs. periodo anterior'}
        </span>
      </div>
    </TarjetaKpi>;
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={`Ver ${label.toLowerCase()}`} className="group block w-full min-w-0 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      <div className="transition group-hover:-translate-y-0.5 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-blue-500 rounded-2xl">{contenido}</div>
      <span className="sr-only">Abrir detalle</span>
    </button>
  ) : contenido;
}

export default function FinanzasResumen({ currentUser, onNavigate }: { currentUser: User; onNavigate?: (tab: string) => void }) {
  const [resumen, setResumen] = useState<ResumenFinanzas | null>(null);
  const [salud, setSalud] = useState<SaludNegocio | null>(null);
  const [alertasOperacion, setAlertasOperacion] = useState<DashboardEnterprise['alertas']>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/finanzas/resumen', { headers: sessionHeaders(currentUser.id) });
      if (!res.ok) {
        // Un 404 sin leer se renderiza como "todo en cero", que es peor que un
        // error: hace creer que el mes cerró sin ventas ni gastos.
        const detalle = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText}${detalle ? `: ${detalle.slice(0, 200)}` : ''}`);
      }
      setResumen(await res.json());
    } catch (e) {
      setResumen(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * La operación va en su propia llamada y a su propio estado.
   *
   * No se espera a que responda para pintar el P&L: si `/api/dashboard/enterprise`
   * se cae, Resumen todavía muestra las cinco tarjetas, el ciclo y la cartera,
   * y solo se pierde "Salud del negocio". Un bloque accesorio no puede tumbar la
   * pantalla que sí tiene los números que sostienen la decisión.
   */
  const cargarOperacion = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/enterprise', { headers: sessionHeaders(currentUser.id) });
      if (!res.ok) return;
      const datos: Partial<DashboardEnterprise> = await res.json();
      setSalud(operativoDe(datos as Record<string, unknown>));
      setAlertasOperacion(datos.alertas ?? []);
    } catch {
      // Red caída o JSON inválido: se deja el bloque fuera, sin rastro de error.
    }
  }, []);

  useEffect(() => { cargar(); cargarOperacion(); }, [cargar, cargarOperacion]);

  if (isLoading) {
    return (
      <div data-testid="finanzas-resumen-cargando">
        <BloqueCarga className="min-h-[30vh]" />
      </div>
    );
  }

  if (error || !resumen) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800" data-testid="finanzas-resumen-error">
        <p className="font-bold">No se pudo cargar el resumen financiero</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  const avisos = [...avisosDe(resumen), ...avisosOperativosDe(alertasOperacion)]
    .sort((a, b) => (b.monto ?? -1) - (a.monto ?? -1));
  const accionPrioritaria = accionParaAviso(avisos[0]);
  const vencido = resumen.aging.d1_30 + resumen.aging.d31_60 + resumen.aging.d60;
  const enRiesgo = resumen.aging.d31_60 + resumen.aging.d60;
  const hayActividadFinanciera = resumen.ingresosFacturados !== 0 || resumen.ingresosCobrados !== 0 || resumen.gastos !== 0 || resumen.cuentasPorCobrar !== 0 || resumen.documentosEmitidos > 0 || (resumen.conciliacionCaja?.cierres ?? 0) > 0;
  const rolesUsuario = currentUser.roles?.length ? currentUser.roles : [currentUser.role];
  const puedeRegistrar = rolesUsuario.includes('Admin');
  const navegar = (tab: string) => onNavigate?.(tab);

  return (
    <div className="space-y-6" data-testid="finanzas-resumen">
      <div>
        <h2 className="text-2xl font-bold text-neutral-900 dark:text-white">Resumen financiero</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {resumen.periodo.desde} a {resumen.periodo.hasta} · Aquí puedes revisar ventas, cobros y gastos.
        </p>
      </div>

      {avisos.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30" data-testid="finanzas-resumen-prioridad">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" /><div><h3 className="font-bold text-amber-950 dark:text-amber-100">Hay {avisos.length} asunto(s) para revisar</h3><p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200">Empieza por: {avisos[0]?.titulo}. Abre el detalle para ver qué registros lo explican.</p></div></div>
            {accionPrioritaria && <button type="button" onClick={() => navegar(accionPrioritaria.tab)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:bg-neutral-900 dark:text-amber-100">{accionPrioritaria.texto} <ArrowRight className="h-4 w-4" /></button>}
          </div>
        </section>
      ) : null}

      {!hayActividadFinanciera && (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30" data-testid="finanzas-sin-actividad">
          <div className="flex items-start gap-3">
              <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-blue-300" />
              <div>
                <h3 className="font-bold text-blue-950 dark:text-blue-100">Aún no hay movimientos financieros en este periodo</h3>
                <p className="mt-1 text-sm text-blue-900/80 dark:text-blue-200">Registra o consulta una actividad para empezar. Un periodo sin movimientos no significa que esté conciliado.</p>
              </div>
          </div>
          {puedeRegistrar && <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Acciones financieras">
            <button type="button" onClick={() => navegar('documentos')} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3 text-left text-sm font-bold text-blue-950 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-800 dark:bg-neutral-900 dark:text-blue-100 dark:hover:bg-blue-950/40">
              <span className="flex items-center gap-2"><FileText className="h-4 w-4" />Facturas y documentos</span><ArrowRight className="h-4 w-4 shrink-0" />
            </button>
            <button type="button" onClick={() => navegar('gastos-ruta')} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3 text-left text-sm font-bold text-blue-950 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-800 dark:bg-neutral-900 dark:text-blue-100 dark:hover:bg-blue-950/40">
              <span className="flex items-center gap-2"><TrendingDown className="h-4 w-4" />Gastos de ruta</span><ArrowRight className="h-4 w-4 shrink-0" />
            </button>
            <button type="button" onClick={() => navegar('cobranza')} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3 text-left text-sm font-bold text-blue-950 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-800 dark:bg-neutral-900 dark:text-blue-100 dark:hover:bg-blue-950/40">
              <span className="flex items-center gap-2"><Wallet className="h-4 w-4" />Cobros y saldos</span><ArrowRight className="h-4 w-4 shrink-0" />
            </button>
          </div>}
        </section>
      )}

      {avisos.length === 0 && hayActividadFinanciera && (
        <section className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30" data-testid="finanzas-todo-al-dia">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
          <div><h3 className="font-bold text-emerald-950 dark:text-emerald-100">No hay asuntos pendientes detectados</h3><p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200">Revisa los indicadores y la conciliación antes de dar el periodo por cerrado.</p></div>
        </section>
      )}

      {/* 1. Las cinco tarjetas */}
      {hayActividadFinanciera && <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4" data-testid="finanzas-tarjetas">
        <Tarjeta
          label="Ingresos"
          valor={resumen.ingresosFacturados}
          variacion={resumen.variacion.ingresosFacturados}
          icono={DollarSign}
          ayuda="Facturado, cobrado o no"
          onClick={() => navegar('documentos')}
        />
        <Tarjeta
          label="Cobrado"
          valor={resumen.ingresosCobrados}
          variacion={resumen.variacion.ingresosCobrados}
          icono={Wallet}
          ayuda="Dinero que entró a caja"
          onClick={() => navegar('cobranza')}
        />
        <Tarjeta
          label="Gastos"
          valor={resumen.gastos}
          variacion={resumen.variacion.gastos}
          icono={TrendingDown}
          maloSiSube
          onClick={() => navegar('gastos-ruta')}
        />
        <Tarjeta
          label="Utilidad"
          valor={resumen.utilidad}
          variacion={resumen.variacion.utilidad}
          icono={FileText}
          negativo={resumen.utilidad < 0}
          ayuda={`Margen ${resumen.margen.toFixed(1)}%`}
          onClick={() => navegar('reporte:financiero')}
        />
        <Tarjeta
          label="Por cobrar"
          valor={resumen.cuentasPorCobrar}
          icono={Clock}
          ayuda={`${fmtCRC(enRiesgo)} en riesgo`}
          onClick={() => navegar('cobranza')}
        />
      </div>}

      {/* 2. La banda del ciclo del dinero */}
      <details className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-bold text-neutral-900 dark:text-white [&::-webkit-details-marker]:hidden">
          <span>Entender el recorrido del dinero</span>
          <span className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">{resumen.documentosEmitidos} documentos <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
        </summary>
        <div className="border-t border-neutral-200 p-5 dark:border-neutral-700">
        <ol className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="finanzas-ciclo">
          {(resumen.cicloDelDinero ?? []).map((nodo) => (
            <li key={nodo.etapa} className="relative rounded-xl bg-neutral-50 dark:bg-neutral-900/60 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{nodo.etiqueta}</p>
              <p className="text-base font-black text-neutral-900 dark:text-white mt-1">{fmtCRC(nodo.monto)}</p>
            </li>
          ))}
        </ol>
        </div>
      </details>

      <details className="group rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800" data-testid="finanzas-conciliacion-caja">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-bold text-neutral-900 dark:text-white [&::-webkit-details-marker]:hidden"><span>Revisar caja de rutas</span><span className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">{resumen.conciliacionCaja?.cierres ?? 0} cierres <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" /></span></summary>
        <div className="border-t border-neutral-200 p-5 dark:border-neutral-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-neutral-900 dark:text-white">Conciliación de caja de ruta</h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Conteo declarado por vendedor comparado con efectivo esperado por tiquetes.</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${(resumen.conciliacionCaja?.cierres ?? 0) === 0 ? 'bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200' : (resumen.conciliacionCaja?.pendientesConteo || resumen.conciliacionCaja?.diferenciasPendientes || resumen.conciliacionCaja?.depositosPendientes) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
            {(resumen.conciliacionCaja?.cierres ?? 0) === 0 ? 'Sin cierres registrados' : (resumen.conciliacionCaja?.pendientesConteo || resumen.conciliacionCaja?.diferenciasPendientes || resumen.conciliacionCaja?.depositosPendientes) ? `${(resumen.conciliacionCaja?.pendientesConteo || 0) + (resumen.conciliacionCaja?.diferenciasPendientes || 0) + (resumen.conciliacionCaja?.depositosPendientes || 0)} por revisar` : 'Cierres sin diferencias'}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
          <div><p className="text-xs text-neutral-500">Cierres</p><p className="font-extrabold text-neutral-900 dark:text-white">{resumen.conciliacionCaja?.cierres ?? 0}</p></div>
          <div><p className="text-xs text-neutral-500">Gastos en efectivo de ruta</p><p className="font-extrabold text-neutral-900 dark:text-white">{fmtCRC(resumen.conciliacionCaja?.gastosEfectivo ?? 0)}</p></div>
          <div><p className="text-xs text-neutral-500">Efectivo esperado</p><p className="font-extrabold text-neutral-900 dark:text-white">{fmtCRC(resumen.conciliacionCaja?.efectivoEsperado ?? 0)}</p></div>
          <div><p className="text-xs text-neutral-500">Efectivo contado</p><p className="font-extrabold text-neutral-900 dark:text-white">{fmtCRC(resumen.conciliacionCaja?.efectivoContado ?? 0)}</p></div>
          <div><p className="text-xs text-neutral-500">Diferencia neta</p><p className="font-extrabold text-neutral-900 dark:text-white">{fmtCRC(resumen.conciliacionCaja?.diferenciaNeta ?? 0)}</p></div>
          <div><p className="text-xs text-neutral-500">Depósitos conciliados</p><p className="font-extrabold text-neutral-900 dark:text-white">{resumen.conciliacionCaja?.depositosConciliados ?? 0} · {fmtCRC(resumen.conciliacionCaja?.montoDepositado ?? 0)}</p></div>
        </div>
        </div>
      </details>
      <details className="group rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-800" data-testid="finanzas-depositos-plegable">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-bold text-neutral-900 dark:text-white [&::-webkit-details-marker]:hidden">
          <span>Depósitos bancarios</span><span className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">Registrar y conciliar depósitos de ruta <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
        </summary>
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-700"><ConciliacionDepositos currentUser={currentUser} /></div>
      </details>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* 3. Requiere atención */}
        <details className="group xl:col-span-2 bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm" data-testid="finanzas-requiere-atencion" open={avisos.length > 0}>
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
            <h3 className="font-bold text-neutral-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Detalle de asuntos
            </h3>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {avisos.length > 0 ? `${avisos.length} asuntos` : 'Nada pendiente'}
            </span>
            <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-neutral-200 dark:border-neutral-700">
          {avisos.length > 0 ? (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {avisos.map(a => {
                const estilo = ESTILO_NIVEL[a.nivel];
                const accion = accionParaAviso(a);
                return (
                  <li key={a.id} className="flex items-start gap-3 p-4">
                    <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${estilo.punto}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-sm ${estilo.texto}`}>{a.titulo}</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{a.detalle}</p>
                    </div>
                    {a.monto !== null && (
                      <p className="font-black text-sm text-neutral-900 dark:text-white shrink-0">{fmtCRC(a.monto)}</p>
                    )}
                    {accion && <button type="button" onClick={() => navegar(accion.tab)} className="ml-2 shrink-0 text-xs font-bold text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300">{accion.texto}</button>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-10 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-sm text-neutral-600 dark:text-neutral-300 mt-2">No hay alertas financieras ni operativas detectadas con la información disponible.</p>
            </div>
          )}
          </div>
        </details>

        {/* Columna derecha: lo que aportaba el Centro de Mando, y la cartera */}
        <div className="space-y-6">
          <details className="group bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm" data-testid="finanzas-salud-negocio">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-bold text-neutral-900 dark:text-white [&::-webkit-details-marker]:hidden"><span>Salud del negocio</span><span className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">Producción, bodega y rutas <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" /></span></summary>
            <div className="border-t border-neutral-200 p-5 dark:border-neutral-700">
            <h3 className="font-bold text-neutral-900 dark:text-white mb-1">Salud del negocio</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
              Producción, bodega y rutas de hoy.
            </p>
            {salud ? (
              <SaludDelNegocio salud={salud} variante="finanzas" />
            ) : (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 py-4" data-testid="finanzas-salud-negocio-no-disponible">
                No se pudo cargar la operación de hoy. Las cifras de arriba siguen
                siendo las de `/api/finanzas/resumen`.
              </p>
            )}
            </div>
          </details>

          <section className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-sm p-5">
            <h3 className="font-bold text-neutral-900 dark:text-white mb-1">Salud de la cartera</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
              {fmtCRC(resumen.cuentasPorCobrar)} por cobrar, {fmtCRC(vencido)} vencido.
            </p>
            {resumen.cuentasPorCobrar > 0 ? <ul className="space-y-2" data-testid="finanzas-aging">
              {ETIQUETAS_AGING.map(e => {
                const monto = resumen.aging[e.id] ?? 0;
                const pct = resumen.cuentasPorCobrar > 0 ? (monto / resumen.cuentasPorCobrar) * 100 : 0;
                return (
                  <li key={e.id}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-bold text-neutral-700 dark:text-neutral-300">{e.label}</span>
                      <span className="text-neutral-500 dark:text-neutral-400">{fmtCRC(monto)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-neutral-100 dark:bg-neutral-700 overflow-hidden">
                      <div className={`h-full ${ESTILO_NIVEL[e.nivel].punto}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul> : <p className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-300" data-testid="finanzas-aging-vacio">No hay saldos pendientes de cobro en este periodo.</p>}
          </section>
        </div>
      </div>

      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
        Actualizado por {currentUser.name} · dinero de `/api/finanzas/resumen` (fuente única del
        P&L) y operación de `/api/dashboard/enterprise`.
      </p>
    </div>
  );
}
