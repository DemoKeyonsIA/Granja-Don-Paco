import React from 'react';
import { Map, ClipboardList, ShoppingCart, CheckCircle2 } from 'lucide-react';

const PASOS = [
  { id: 'ruta', icon: Map, label: 'Ruta definida', sub: 'clientes · días · camión' },
  { id: 'guia', icon: ClipboardList, label: 'Guía de Despacho', sub: 'carga · salida' },
  { id: 'venta', icon: ShoppingCart, label: 'En ruta · caja', sub: 'ventas y tiquetes' },
  { id: 'cierre', icon: CheckCircle2, label: 'Cierre y cuadre', sub: 'peso · reconciliación' },
] as const;

export type ProcesoPaso = (typeof PASOS)[number]['id'];

/**
 * Franja de proceso Ruta → Guía → En ruta → Cierre, compartida por Despacho
 * (paso «Guía de Despacho») y FlotaRutas (paso «Ruta definida»). Hace visible
 * de dónde sale la guía (el recorrido) y hacia dónde va (caja y cuadre).
 */
export default function FranjaProceso({ actual }: { actual: ProcesoPaso }) {
  const actualIndex = PASOS.findIndex(p => p.id === actual);
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
      {PASOS.map((p, i) => {
        const esActual = i === actualIndex;
        const hecho = i < actualIndex;
        const Icon = p.icon;
        return (
          <React.Fragment key={p.id}>
            {i > 0 && <span className="text-xs shrink-0 opacity-50">→</span>}
            <div
              title={p.sub}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition-all shrink-0 ${
                esActual
                  ? 'bg-amber-100 text-amber-800 border border-amber-600 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-500'
                  : 'border border-black/10 dark:border-white/15 opacity-80'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{p.label}</span>
              {hecho && <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}