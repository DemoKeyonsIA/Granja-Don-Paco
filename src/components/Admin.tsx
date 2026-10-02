import React, { useState, useEffect } from 'react';
import { Settings, Package, Warehouse, Users as UsersIcon } from 'lucide-react';
import { User } from '../types';
import { cn } from '../lib/utils';
import { SUBTABS_ADMIN } from '../nav/modulos';
import ProductosCatalogo from './ProductosCatalogo';
import Granjas from './Granjas';
import AdminCamiones from './AdminCamiones';
import AdminUsuarios from './AdminUsuarios';

interface Props { currentUser: User; initialTab?: AdminTab; }

type AdminTab = 'productos' | 'infraestructura' | 'usuarios';

/**
 * Colores e iconos de la fila. Los ids y las etiquetas salen de
 * `SUBTABS_ADMIN`, no de una lista propia.
 *
 * Antes esta fila repetía los tabs en su propio array, y ese es el motivo por el
 * que Vinculaciones siguió apareciendo en Admin después de salir de
 * `SUBTABS_ADMIN`: la configuración decía una cosa y la pantalla otra. El test de
 * `Admin` compara ambas listas para que no vuelvan a divergir en silencio.
 */
const ESTILO_TAB: Record<AdminTab, { icon: React.ComponentType<{ className?: string }>; iconColor: string }> = {
  productos: { icon: Package, iconColor: 'bg-blue-100 text-blue-600' },
  infraestructura: { icon: Warehouse, iconColor: 'bg-emerald-100 text-emerald-600' },
  usuarios: { icon: UsersIcon, iconColor: 'bg-violet-100 text-violet-600' },
};

const TABS: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }>; iconColor: string }[] =
  SUBTABS_ADMIN.map(t => {
    const estilo = ESTILO_TAB[t.id as AdminTab];
    return { id: t.id as AdminTab, label: t.label, ...estilo };
  });

export default function Admin({ currentUser, initialTab = 'productos' }: Props) {
  const [tab, setTab] = useState<AdminTab>(initialTab);

  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
        <h2 className="text-2xl font-black text-neutral-800 dark:text-white">Panel de Administración</h2>
      </div>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 -mt-4">
        Configuración global: productos y cartones, infraestructura (granjas, galerones y camiones) y usuarios con sus roles.
      </p>

      <div data-testid="admin-tabs" className="flex space-x-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl p-1 max-w-2xl overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} data-tab-id={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors',
              tab === t.id ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300')}>
            <span className={cn('w-6 h-6 rounded-md flex items-center justify-center', t.iconColor)}><t.icon className="w-3.5 h-3.5" /></span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="animate-in fade-in">
        {tab === 'productos' && <ProductosCatalogo currentUser={currentUser} />}
        {tab === 'infraestructura' && <Infraestructura currentUser={currentUser} />}
        {tab === 'usuarios' && <AdminUsuarios currentUser={currentUser} />}
      </div>
    </div>
  );
}

function Infraestructura({ currentUser }: Props) {
  const [section, setSection] = useState<'granjas' | 'camiones'>('granjas');

  return (
    <div className="space-y-4">
      <div className="flex space-x-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-default)' }}>
        {[['granjas', 'Granjas (galerones)'], ['camiones', 'Camiones']].map(([key, label]) => (
          <button key={key} onClick={() => setSection(key as any)}
            className="pb-3 text-sm font-semibold capitalize transition-colors whitespace-nowrap border-b-2"
            style={section === key
              ? { color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' }
              : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
            {label}
          </button>
        ))}
      </div>
      {section === 'granjas' && <Granjas currentUser={currentUser} />}
      {section === 'camiones' && <AdminCamiones currentUser={currentUser} />}
    </div>
  );
}