import React from 'react';
import { Egg, Truck, Package, AlertTriangle } from 'lucide-react';

interface Props {
  produccionHoy: number;
  enTransito: number;
  enBodega: number;
  desperdiciosHoy: number;
}

export default function ResumenDelDia({ produccionHoy, enTransito, enBodega, desperdiciosHoy }: Props) {
  const cards = [
    { label: 'Producción Hoy', value: produccionHoy.toLocaleString(), icon: Egg, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { label: 'En Tránsito', value: String(enTransito), icon: Truck, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
    { label: 'En Bodega', value: enBodega.toLocaleString(), icon: Package, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
    { label: 'Desperdicios 7 días', value: String(desperdiciosHoy), icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className={`${c.bg} ${c.border} border rounded-xl p-4 flex items-center space-x-3`}>
          <div className={`${c.color} p-2 rounded-lg bg-white/60`}>
            <c.icon className="w-5 h-5" />
          </div>
          <div>
            <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">{c.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
