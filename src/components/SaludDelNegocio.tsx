import React from 'react';
import { Activity, AlertTriangle, Egg, Heart, Package, Truck, Users } from 'lucide-react';
import { fmtCRC } from '../lib/finanzas';

/**
 * "Salud del negocio": los siete números operativos de `/api/dashboard/enterprise`.
 *
 * Este bloque estaba duplicado —y con dos lecturas distintas del mismo dato— entre
 * `operaciones/ResumenDelDia` y el bloque "Salud del negocio" de `FinanzasResumen`.
 * Acá vive una sola vez la regla de negocio: qué claves hacen falta y qué pasa si
 * el payload viene incompleto. Lo que cambia entre las dos pantallas es el
 * envoltorio (título, testid, reintento) y la densidad, no el dato.
 *
 * Los cinco campos de dinero que el endpoint también devuelve (`ingresosHoy`,
 * `ingresosCobradosHoy`, `gastosHoy`, `utilidadNeta`, `cuentasPorCobrar`) quedan
 * fuera a propósito: los calcula mejor `/api/finanzas/resumen`, y pintarlos acá
 * reabriría la brecha que la Fase 3 cerró.
 */
export type SaludNegocio = {
  cartonesProducidos: number;
  stockBodegaCentral: number;
  totalAvesVivas: number;
  rutasActivas: number;
  clientesActivos: number;
  desperdicios7d: number;
  impactoDesperdicio7d: number;
};

const OPERATIVO_NUMERICO = [
  'cartonesProducidos', 'stockBodegaCentral', 'totalAvesVivas', 'rutasActivas',
  'clientesActivos', 'desperdiciosHoy', 'impactoDesperdicioHoy',
] as const;

/**
 * Traduce la respuesta del endpoint al bloque.
 *
 * Devuelve `null` si falta cualquiera de los siete números, y no los rellena con
 * ceros: pintar "0 cartones" porque el endpoint vino incompleto es la misma
 * mentira que pintar "todo en cero" cuando el resumen da 404. Con `null` el
 * bloque se oculta y cada pantalla decide qué muestra en su lugar.
 */
export const operativoDe = (d: Partial<Record<string, unknown>>): SaludNegocio | null => {
  if (OPERATIVO_NUMERICO.some(k => typeof d[k] !== 'number' || !Number.isFinite(d[k] as number))) {
    return null;
  }
  return {
    cartonesProducidos: d.cartonesProducidos as number,
    stockBodegaCentral: d.stockBodegaCentral as number,
    totalAvesVivas: d.totalAvesVivas as number,
    rutasActivas: d.rutasActivas as number,
    clientesActivos: d.clientesActivos as number,
    desperdicios7d: d.desperdiciosHoy as number,
    impactoDesperdicio7d: d.impactoDesperdicioHoy as number,
  };
};

/**
 * `operaciones` — rejilla de tarjetas, sin dinero (el hub de Operaciones no pinta ₡).
 * `finanzas`    — lista compacta, con clientes activos y el impacto del desperdicio.
 *
 * La etiqueta de `stockBodegaCentral` es una sola en las dos: antes decía
 * "En bodega central (cartones)" acá y "Huevos" allá para el mismo número.
 */
export default function SaludDelNegocio({
  salud,
  variante,
}: {
  salud: SaludNegocio;
  variante: 'operaciones' | 'finanzas';
}) {
  if (variante === 'operaciones') {
    const tarjetas = [
      { label: 'Producción hoy', value: salud.cartonesProducidos, unidad: 'kg', icon: Egg, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
      { label: 'En bodega central', value: salud.stockBodegaCentral, unidad: 'kg', icon: Package, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
      { label: 'Aves vivas', value: salud.totalAvesVivas, unidad: 'aves', icon: Activity, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200' },
      { label: 'Rutas activas', value: salud.rutasActivas, unidad: 'rutas', icon: Truck, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
      { label: 'Desperdicios (7 días)', value: salud.desperdicios7d, unidad: 'registros', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    ];
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {tarjetas.map(t => (
          <div key={t.label} className={`${t.bg} ${t.border} dark:bg-neutral-800 dark:border-neutral-700 border rounded-xl p-4 flex items-center gap-3`}>
            <div className={`${t.color} dark:text-neutral-100 p-2 rounded-lg bg-white/60 dark:bg-neutral-700`}><t.icon className="w-5 h-5" /></div>
            <div className="min-w-0">
              <p className={`text-2xl font-black ${t.color} dark:text-white`}>{Number(t.value).toLocaleString('es-CR')}</p>
              <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">{t.label}</p>
              <p className="text-[11px] text-neutral-600 dark:text-neutral-300">{t.unidad}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const items = [
    { label: 'Huevo producido', valor: salud.cartonesProducidos, sufijo: 'kg hoy', icono: Package },
    { label: 'Aves vivas', valor: salud.totalAvesVivas, sufijo: 'en producción', icono: Heart },
    { label: 'En bodega central', valor: salud.stockBodegaCentral, sufijo: 'kg', icono: Egg },
    { label: 'Rutas', valor: salud.rutasActivas, sufijo: 'activas', icono: Truck },
    { label: 'Clientes', valor: salud.clientesActivos, sufijo: 'activos', icono: Users },
    {
      label: 'Desperdicios',
      valor: salud.desperdicios7d,
      sufijo: 'en 7 días',
      icono: AlertTriangle,
      monto: salud.impactoDesperdicio7d,
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-3">
      {items.map(k => (
        <li key={k.label} className="rounded-xl bg-neutral-50 dark:bg-neutral-900/60 p-3">
          <div className="flex items-center gap-1.5">
            <k.icono className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              {k.label}
            </span>
          </div>
          <p className="text-xl font-black text-neutral-900 dark:text-white mt-1">
            {k.valor.toLocaleString('es-CR')}
          </p>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{k.sufijo}</p>
          {k.monto != null && k.monto > 0 && (
            <p className="text-[11px] font-bold text-red-600 dark:text-red-400 mt-1">
              {fmtCRC(k.monto)} de impacto
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
