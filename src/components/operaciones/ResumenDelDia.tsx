import React, { useCallback, useEffect, useState } from 'react';
import { Egg, Truck, Package, AlertTriangle, Activity } from 'lucide-react';
import type { User } from '../../types';

/**
 * El primer grupo del hub de Operaciones: cómo está la operación hoy.
 *
 * Este componente estaba muerto: nadie lo importaba y el tab `resumen` que la
 * configuración declaraba no lo montaba nadie, así que el hub de cinco grupos
 * habría tenido una puerta vacía. La Fase 7 lo convierte en el cuerpo de ese tab.
 *
 * Los números salen de `/api/dashboard/enterprise`, el mismo endpoint que
 * alimenta el bloque "Salud del negocio" de Finanzas. Se leen solo los campos
 * operativos: producción, bodega, rutas y desperdicios. Los cinco campos de
 * dinero que el endpoint también devuelve quedan fuera a propósito, porque
 * `/api/finanzas/resumen` los calcula mejor y copiar los dos sería volver a abrir
 * la brecha que la Fase 3 cerró.
 *
 * Antes este archivo tomaba cuatro números por props y las invocaba con los
 * nombres rotos por una codificación anterior ("ProducciA3n Hoy"), y su
 * `enTransito` no existía en ningún payload.
 */

/** Lo que se lee del endpoint. Todo número o nada. */
type Operativo = {
  cartonesProducidos: number;
  stockBodegaCentral: number;
  rutasActivas: number;
  desperdiciosHoy: number;
  avesVivas: number;
};

const OPERATIVO_NUMERICO = [
  'cartonesProducidos', 'stockBodegaCentral', 'rutasActivas', 'desperdiciosHoy', 'totalAvesVivas',
] as const;

const operativoDe = (d: Record<string, unknown>): Operativo | null => {
  if (OPERATIVO_NUMERICO.some(k => typeof d[k] !== 'number' || !Number.isFinite(d[k] as number))) {
    return null;
  }
  return {
    cartonesProducidos: d.cartonesProducidos as number,
    stockBodegaCentral: d.stockBodegaCentral as number,
    rutasActivas: d.rutasActivas as number,
    desperdiciosHoy: d.desperdiciosHoy as number,
    avesVivas: d.totalAvesVivas as number,
  };
};

export default function ResumenDelDia({ currentUser: _currentUser }: { currentUser: User }) {
  const [operativo, setOperativo] = useState<Operativo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/enterprise');
      if (!res.ok) throw new Error(`El resumen no respondió (${res.status})`);
      setOperativo(operativoDe(await res.json()));
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el resumen del día.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-[30vh] text-sm" style={{ color: 'var(--text-muted)' }}>
        Cargando el resumen del día…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex items-center justify-between gap-4">
        <span>{error}</span>
        <button onClick={() => void cargar()} className="font-bold underline whitespace-nowrap">Reintentar</button>
      </div>
    );
  }

  // Sin los cinco números no se pinta nada. Mostrar ceros cuando el endpoint vino
  // incompleto es la misma mentira que pintar "todo en cero" cuando el resumen
  // financier da 404, y acá significaría "hoy no se produjo nada" frente a
  // "no se pudo saber cuánto se produjo".
  if (!operativo) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>El resumen vino incompleto, así que no se muestran números. Los otros grupos del hub siguen disponibles.</span>
        <button onClick={() => void cargar()} className="ml-auto font-bold underline whitespace-nowrap">Reintentar</button>
      </div>
    );
  }

  const o = operativo;
  const tarjetas = [
    { label: 'Producción hoy', value: o.cartonesProducidos, unidad: 'cartones', icon: Egg, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { label: 'En bodega central', value: o.stockBodegaCentral, unidad: 'cartones', icon: Package, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
    { label: 'Aves vivas', value: o.avesVivas, unidad: 'aves', icon: Activity, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200' },
    { label: 'Rutas activas', value: o.rutasActivas, unidad: 'rutas', icon: Truck, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
    { label: 'Desperdicios (7 días)', value: o.desperdiciosHoy, unidad: 'registros', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  ];

  return (
    <div className="space-y-4 animate-in fade-in" data-testid="operaciones-resumen">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        La operación de hoy, en una pantalla. Los números que mueven plata están en
        {' '}<strong>Finanzas</strong>; los que mueven cartón, en los grupos de al lado.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {tarjetas.map(t => (
          <div key={t.label} className={`${t.bg} ${t.border} border rounded-xl p-4 flex items-center gap-3`}>
            <div className={`${t.color} p-2 rounded-lg bg-white/60`}><t.icon className="w-5 h-5" /></div>
            <div className="min-w-0">
              <p className={`text-2xl font-black ${t.color}`}>{Number(t.value).toLocaleString('es-CR')}</p>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">{t.label}</p>
              <p className="text-[11px] text-neutral-400">{t.unidad}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Los cinco números salen de <code>/api/dashboard/enterprise</code>, el mismo que alimenta
        {' '}<strong>Finanzas › Resumen</strong> con la Salud del Negocio. Si falta alguno, el bloque se
        oculta en vez de pintar cero.
      </p>
    </div>
  );
}
