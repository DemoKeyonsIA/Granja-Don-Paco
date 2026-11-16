import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Settings, Package, Warehouse, Users as UsersIcon, Link2, ClipboardCheck, DollarSign } from 'lucide-react';
import { User } from '../types';
import { cn } from '../lib/utils';
import { SUBTABS_ADMIN, subTabsDe } from '../nav/modulos';
import ProductosCatalogo from './ProductosCatalogo';
import Granjas from './Granjas';
import AdminUsuarios from './AdminUsuarios';
import OfficeVinculos from './OfficeVinculos';
import AprobacionesAdmin from './AprobacionesAdmin';
import './gcrm.css';

const Precios = lazy(() => import('./Precios'));

interface Props { currentUser: User; initialTab?: AdminTab; }

type AdminTab = 'productos' | 'infraestructura' | 'precios-negociacion' | 'usuarios' | 'aprobaciones' | 'vinculaciones';

/**
 * Colores e iconos de la fila. Los ids y las etiquetas salen de
 * `SUBTABS_ADMIN`, no de una lista propia.
 *
 * Antes esta fila repetía los tabs en su propio array, y ese es el motivo por el
 * que Vinculaciones apareció en Admin sin estar en `SUBTABS_ADMIN`. El test de
 * `Admin` compara ambas listas para que no vuelvan a divergir en silencio.
 */
const ESTILO_TAB: Record<AdminTab, { icon: React.ComponentType<{ className?: string }>; tono: 'cielo' | 'salmon' }> = {
  productos: { icon: Package, tono: 'cielo' },
  infraestructura: { icon: Warehouse, tono: 'salmon' },
  'precios-negociacion': { icon: DollarSign, tono: 'cielo' },
  usuarios: { icon: UsersIcon, tono: 'cielo' },
  aprobaciones: { icon: ClipboardCheck, tono: 'salmon' },
  vinculaciones: { icon: Link2, tono: 'cielo' },
};

const ESTILO_FALLBACK = { icon: Settings, tono: 'cielo' as const };

export default function Admin({ currentUser, initialTab = 'productos' }: Props) {
  const roles = currentUser.roles?.length ? currentUser.roles : [currentUser.role];
  const tabs: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }>; tono: 'cielo' | 'salmon' }[] =
    subTabsDe('admin', roles).map(t => {
    const estilo = ESTILO_TAB[t.id as AdminTab];
    return { id: t.id as AdminTab, label: t.label, ...(estilo ?? ESTILO_FALLBACK) };
  });

  const [tab, setTab] = useState<AdminTab>(tabs.some(t => t.id === initialTab) ? initialTab : tabs[0]?.id ?? 'productos');

  useEffect(() => {
    setTab(tabs.some(t => t.id === initialTab) ? initialTab : tabs[0]?.id ?? 'productos');
  }, [initialTab, currentUser.role, currentUser.roles]);

  const moverTabConTeclado = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || tabs.length === 0) return;
    event.preventDefault();
    const actual = Math.max(0, tabs.findIndex(t => t.id === tab));
    const siguiente = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (actual + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    const id = tabs[siguiente].id;
    setTab(id);
    document.getElementById(`admin-tab-${id}`)?.focus();
  };

  return (
    <div className="admin-workspace space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
        <h2 className="text-2xl font-black text-neutral-800 dark:text-white">Panel de Administración</h2>
      </div>
      <p className="text-[15px] text-neutral-500 dark:text-neutral-400 -mt-4 max-w-3xl">
        Configura productos, infraestructura, precios autorizados para vendedores, usuarios y permisos del sistema.
      </p>

      <div data-testid="admin-tabs" role="tablist" aria-label="Secciones de administración" onKeyDown={moverTabConTeclado} className="admin-tab-list flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl p-1 w-full max-w-full xl:max-w-4xl overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} id={`admin-tab-${t.id}`} data-tab-id={t.id} role="tab" aria-controls="admin-tabpanel" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}
            className={cn('flex shrink-0 items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors min-h-11',
              tab === t.id ? 'bg-white dark:bg-neutral-700 text-neutral-800 dark:text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300')}>
            <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: t.tono === 'cielo' ? 'var(--brand-primary-soft)' : 'var(--brand-secondary-soft)', color: 'var(--text-primary)' }}><t.icon className="w-4 h-4" /></span>
            {t.label}
          </button>
        ))}
      </div>

      <div id="admin-tabpanel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`} tabIndex={0} className="animate-in fade-in min-w-0">
        {tab === 'productos' && <ProductosCatalogo currentUser={currentUser} />}
        {tab === 'infraestructura' && <Infraestructura currentUser={currentUser} />}
        {tab === 'precios-negociacion' && <Suspense fallback={<div role="status" className="py-12 text-center text-sm text-neutral-500">Cargando precios…</div>}><Precios currentUser={currentUser} /></Suspense>}
        {tab === 'usuarios' && <AdminUsuarios currentUser={currentUser} />}
        {tab === 'aprobaciones' && roles.includes('Admin') && <AprobacionesAdmin currentUser={currentUser} />}
        {tab === 'vinculaciones' && <OfficeVinculos currentUser={currentUser} />}
      </div>
    </div>
  );
}

/**
 * Infraestructura quedó con un solo hijo tras la consolidación de flota (G1):
 * el CRUD de camiones vivía duplicado acá y en FlotaRutas, y el de FlotaRutas
 * era el único alcanzable por Comercial y el único con rutas. Ahora el maestro
 * de camiones vive allí, en «Despacho › Flota y Rutas».
 */
function Infraestructura({ currentUser }: Props) {
  return <Granjas currentUser={currentUser} />;
}
