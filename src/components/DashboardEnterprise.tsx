import React, { useState, useEffect } from 'react';
import { LayoutDashboard, RefreshCw, TrendingUp, TrendingDown, DollarSign, Package, Users, Truck, AlertTriangle, Egg, Heart, Wrench, Trash2, ShoppingCart, BarChart3, Shield, Activity, Calendar, Target, ArrowUpRight, ArrowDownRight, Clock, Zap, CircleDot, ChevronRight, ChevronDown, Building2, Warehouse, TrendingUp as TrendingUpIcon } from 'lucide-react';
import { User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import Breadcrumb from './Breadcrumb';

interface Props { currentUser: User; }

interface DashboardData {
  ingresosHoy: number;
  gastosHoy: number;
  utilidadNeta: number;
  cartonesProducidos: number;
  stockBodegaCentral: number;
  totalAvesVivas: number;
  facturasEmitidas: number;
  clientesActivos: number;
  rutasActivas: number;
  vacunasVencidas: number;
  mantenimientosVencidos: number;
  desperdiciosHoy: number;
  impactoDesperdicioHoy: number;
  cuentasPorCobrar: number;
  alertas: Array<{ tipo: string; detalle: string; nivel: string }>;
}

interface GaleronInfo {
  id: string; nombre: string; capacidad_maxima: number; estado: string;
  lotes: Array<{ id: string; cantidad_inicial: number; linea_genetica: string; estado: string }>;
  cartones: number; aves: number; consumoAlimentoTotal: number; ocupacion: number;
}

interface GranjaInfo {
  id: string; nombre: string; ubicacion: string; estado: string;
  galerones: GaleronInfo[];
  cartones: number; aves: number; lotesActivos: number;
  vacunasPendientes: number; mantenimientosPendientes: number; desperdicios: number;
}

interface ProduccionDetalle {
  porGranja: GranjaInfo[];
  resumen: { totalGranjas: number; totalGalerones: number; totalLotes: number; totalCartones: number; totalAves: number };
}

type TabId = 'general' | 'produccion' | 'finanzas' | 'logistica';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: string[];
}

const TABS: TabDef[] = [
  { id: 'general', label: 'General', icon: LayoutDashboard, roles: ['Admin', 'Socio'] },
  { id: 'produccion', label: 'Producción', icon: Egg, roles: ['Admin', 'Socio'] },
  { id: 'finanzas', label: 'Finanzas', icon: DollarSign, roles: ['Admin', 'Socio'] },
  { id: 'logistica', label: 'Logística', icon: Truck, roles: ['Admin', 'Socio', 'Comercial', 'Despachador'] },
];

export default function DashboardEnterprise({ currentUser }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [prodDetalle, setProdDetalle] = useState<ProduccionDetalle | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [expandedGranja, setExpandedGranja] = useState<string | null>(null);
  const [expandedGaleron, setExpandedGaleron] = useState<string | null>(null);

  const cargar = async () => {
    setLoading(true);
    try {
      const [resDash, resProd] = await Promise.all([
        fetch('/api/dashboard/enterprise'),
        fetch('/api/dashboard/produccion-detalle'),
      ]);
      if (resDash.ok) setData(await resDash.json());
      if (resProd.ok) setProdDetalle(await resProd.json());
    } catch { toast.error('No se pudo cargar el centro de mando.'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  if (!data) return (
    <div className="flex flex-col items-center justify-center h-64 space-y-3">
      <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--brand-primary)' }} />
      <p className="text-sm text-neutral-400 dark:text-neutral-500">Cargando centro de mando...</p>
    </div>
  );

  const utilidadPorcentaje = data.ingresosHoy > 0
    ? ((data.utilidadNeta / data.ingresosHoy) * 100).toFixed(1)
    : '0';

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in pb-20">
      <Breadcrumb items={[{ label: 'Centro de Mando' }]} />

      {/* Brand Header */}
      <div className="relative overflow-hidden rounded-2xl p-6 md:p-8" style={{ background: 'linear-gradient(135deg, var(--brand-primary-dark), var(--brand-primary), var(--brand-primary-light))' }}>
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10 -translate-y-1/2 translate-x-1/3" style={{ background: 'var(--brand-secondary)' }} />
        <div className="absolute bottom-0 left-0 w-40 h-40 rounded-full opacity-10 translate-y-1/2 -translate-x-1/4" style={{ background: 'var(--brand-secondary-light)' }} />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="p-3 rounded-2xl bg-white/20 backdrop-blur-sm">
              <Egg className="w-7 h-7 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white">Centro de Mando</h2>
              <p className="text-sm text-white/70 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {new Date().toLocaleDateString('es-CR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={cargar}
              className="p-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors"
              disabled={loading}>
              <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
            </button>
            {data.alertas.length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-white/20 backdrop-blur-sm rounded-xl border border-white/20">
                <AlertTriangle className="w-4 h-4 text-white" />
                <span className="text-sm font-bold text-white">{data.alertas.length} alertas</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-2xl overflow-x-auto">
        {TABS.filter(t => t.roles.includes(currentUser.role)).map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const alertCount = tab.id === 'general' ? data.alertas.length : 0;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all whitespace-nowrap flex-1 justify-center",
                isActive
                  ? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
              )}
            >
              <Icon className={cn("w-4 h-4", isActive && "text-brand")} />
              <span>{tab.label}</span>
              {alertCount > 0 && (
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {alertCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="animate-in fade-in">
        {activeTab === 'general' && <GeneralTab data={data} />}
        {activeTab === 'produccion' && (
          <ProduccionTab data={data} prodDetalle={prodDetalle}
            expandedGranja={expandedGranja} setExpandedGranja={setExpandedGranja}
            expandedGaleron={expandedGaleron} setExpandedGaleron={setExpandedGaleron} />
        )}
        {activeTab === 'finanzas' && <FinanzasTab data={data} utilidadPorcentaje={utilidadPorcentaje} />}
        {activeTab === 'logistica' && <LogisticaTab data={data} />}
      </div>
    </div>
  );
}

// ==================== GENERAL TAB ====================
function GeneralTab({ data }: { data: DashboardData }) {
  const cards = [
    { label: 'Ingresos Hoy', value: `₡${data.ingresosHoy.toLocaleString()}`, icon: DollarSign, color: 'emerald', trend: data.ingresosHoy > 0 ? 'up' as const : null },
    { label: 'Gastos Hoy', value: `₡${data.gastosHoy.toLocaleString()}`, icon: TrendingDown, color: 'red', trend: data.gastosHoy > 0 ? 'down' as const : null },
    { label: 'Utilidad Neta', value: `₡${data.utilidadNeta.toLocaleString()}`, icon: TrendingUp, color: data.utilidadNeta >= 0 ? 'emerald' : 'red' },
    { label: 'Facturas Hoy', value: String(data.facturasEmitidas), icon: ShoppingCart, color: 'blue' },
    { label: 'Clientes Activos', value: String(data.clientesActivos), icon: Users, color: 'teal' },
    { label: 'Rutas Activas', value: String(data.rutasActivas), icon: Truck, color: 'amber' },
  ];

  const colorStyles: Record<string, { color: string; bg: string; border: string }> = {
    emerald: { color: 'text-stone-700 dark:text-stone-300', bg: 'bg-stone-50 dark:bg-neutral-800/50', border: 'border-stone-200/60 dark:border-neutral-700/40' },
    red: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50/50 dark:bg-red-900/10', border: 'border-red-200/40 dark:border-red-800/30' },
    blue: { color: 'text-stone-700 dark:text-stone-300', bg: 'bg-stone-50 dark:bg-neutral-800/50', border: 'border-stone-200/60 dark:border-neutral-700/40' },
    teal: { color: 'text-stone-700 dark:text-stone-300', bg: 'bg-stone-50 dark:bg-neutral-800/50', border: 'border-stone-200/60 dark:border-neutral-700/40' },
    amber: { color: 'text-stone-700 dark:text-stone-300', bg: 'bg-stone-50 dark:bg-neutral-800/50', border: 'border-stone-200/60 dark:border-neutral-700/40' },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
        {cards.map((kpi, i) => {
          const Icon = kpi.icon;
          const cs = colorStyles[kpi.color] || colorStyles.blue;
          return (
            <div key={i} className={cn("p-5 rounded-2xl border transition-all hover:shadow-md", cs.bg, cs.border)}>
              <div className="flex items-center justify-between mb-3">
                <div className={cn("p-2 rounded-xl", cs.bg)}>
                  <Icon className={cn("w-5 h-5", cs.color)} />
                </div>
                {kpi.trend === 'up' && <ArrowUpRight className="w-4 h-4 text-emerald-500" />}
                {kpi.trend === 'down' && <ArrowDownRight className="w-4 h-4 text-red-500" />}
              </div>
              <p className={cn("text-3xl font-black", cs.color)}>{kpi.value}</p>
              <p className="text-xs font-bold text-stone-500 dark:text-stone-400 uppercase mt-1">{kpi.label}</p>
            </div>
          );
        })}
      </div>

      {data.alertas.length > 0 && (
        <div className="bg-white dark:bg-neutral-800/80 rounded-2xl border border-stone-200/60 dark:border-neutral-700/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-200/60 dark:border-neutral-700/40 bg-stone-50 dark:bg-neutral-900/50 flex items-center gap-3">
            <div className="p-2 rounded-xl" style={{ background: 'color-mix(in srgb, var(--brand-accent) 10%, transparent)' }}>
              <AlertTriangle className="w-5 h-5" style={{ color: 'var(--brand-accent)' }} />
            </div>
            <div>
              <h3 className="font-bold text-stone-800 dark:text-white">Alertas Activas</h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">{data.alertas.length} requieren atención</p>
            </div>
          </div>
          <div className="divide-y divide-stone-100 dark:divide-neutral-700/40">
            {data.alertas.map((a, i) => (
              <div key={i} className={cn("flex items-center gap-4 px-6 py-4 transition-colors hover:bg-stone-50 dark:hover:bg-neutral-800/30",
                a.nivel === 'Crítica' ? "border-l-4 border-l-red-400" : "border-l-4 border-l-amber-400")}>
                <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0",
                  a.nivel === 'Crítica' ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400" : "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400")}>
                  {a.nivel}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-stone-800 dark:text-white">{a.tipo}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400 truncate">{a.detalle}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard title="Producción" value={String(data.cartonesProducidos)} subtitle="cartones hoy" icon={Package} color="emerald" />
        <SummaryCard title="Inventario" value={String(data.stockBodegaCentral)} subtitle="unidades en bodega" icon={Egg} color="amber" />
        <SummaryCard title="Aves Vivas" value={data.totalAvesVivas.toLocaleString()} subtitle="aves activas" icon={Heart} color="rose" />
      </div>
    </div>
  );
}

function SummaryCard({ title, value, subtitle, icon: Icon, color }: { title: string; value: string; subtitle: string; icon: React.ComponentType<{className?: string}>; color: string }) {
  const colorMap: Record<string, { bg: string; text: string; icon: string }> = {
    emerald: { bg: 'bg-stone-50 dark:bg-neutral-800/50', text: 'text-stone-800 dark:text-stone-200', icon: '' },
    amber: { bg: 'bg-stone-50 dark:bg-neutral-800/50', text: 'text-stone-800 dark:text-stone-200', icon: '' },
    rose: { bg: 'bg-stone-50 dark:bg-neutral-800/50', text: 'text-stone-800 dark:text-stone-200', icon: '' },
    blue: { bg: 'bg-stone-50 dark:bg-neutral-800/50', text: 'text-stone-800 dark:text-stone-200', icon: '' },
  };
  const c = colorMap[color] || colorMap.emerald;
  return (
    <div className={cn("p-5 rounded-2xl border border-stone-200/60 dark:border-neutral-700/40 flex items-center gap-4", c.bg)}>
      <div className="p-3 rounded-xl bg-white dark:bg-neutral-800 shadow-sm">
        <span style={{ color: 'var(--brand-primary)' }}><Icon className="w-6 h-6" /></span>
      </div>
      <div>
        <p className={cn("text-2xl font-black", c.text)}>{value}</p>
        <p className="text-xs font-bold text-stone-500 dark:text-stone-400">{subtitle}</p>
      </div>
    </div>
  );
}

// ==================== PRODUCCION TAB ====================
interface ProduccionTabProps {
  data: DashboardData;
  prodDetalle: ProduccionDetalle | null;
  expandedGranja: string | null;
  setExpandedGranja: (id: string | null) => void;
  expandedGaleron: string | null;
  setExpandedGaleron: (id: string | null) => void;
}

function ProduccionTab({ data, prodDetalle, expandedGranja, setExpandedGranja, expandedGaleron, setExpandedGaleron }: ProduccionTabProps) {
  const [nivel, setNivel] = useState<'resumen' | 'granja' | 'galeron'>('resumen');

  useEffect(() => {
    if (expandedGaleron) setNivel('galeron');
    else if (expandedGranja) setNivel('granja');
    else setNivel('resumen');
  }, [expandedGranja, expandedGaleron]);

  const breadcrumbItems = [
    { label: 'Producción', onClick: () => { setExpandedGranja(null); setExpandedGaleron(null); } },
    ...(expandedGranja ? [{ label: prodDetalle?.porGranja.find(g => g.id === expandedGranja)?.nombre || '', onClick: () => setExpandedGaleron(null) }] : []),
    ...(expandedGaleron ? [{ label: (() => {
      const granja = prodDetalle?.porGranja.find(g => g.id === expandedGranja);
      return granja?.galerones.find(gl => gl.id === expandedGaleron)?.nombre || '';
    })() }] : []),
  ];

  return (
    <div className="space-y-6">
      <Breadcrumb items={breadcrumbItems} />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Cartones Hoy" value={String(data.cartonesProducidos)} icon={Package} color="emerald" desc="Empaquetados" />
        <KPICard label="Stock Bodega" value={String(data.stockBodegaCentral)} icon={Warehouse} color="amber" desc="Unidades" />
        <KPICard label="Aves Vivas" value={data.totalAvesVivas.toLocaleString()} icon={Heart} color="rose" desc="Lotes activos" />
        <KPICard label="Desperdicios" value={String(data.desperdiciosHoy)} icon={Trash2} color="red" desc="Incidentes últimos 7 días" />
      </div>

      {/* Granja Cards - Hierarchical Drill-down */}
      {prodDetalle ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
            <h3 className="font-bold text-neutral-900 dark:text-white">Producción por Granja</h3>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--brand-primary) 15%, transparent)', color: 'var(--brand-primary)' }}>
              {prodDetalle.resumen.totalGranjas} granjas activas
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {prodDetalle.porGranja.filter(g => g.estado === 'Activo').map(granja => {
              const isExpanded = expandedGranja === granja.id;
              const totalCapacidad = granja.galerones.reduce((a, g) => a + g.capacidad_maxima, 0);
              const ocupacionGeneral = totalCapacidad > 0 ? Math.round((granja.aves / totalCapacidad) * 100) : 0;

              return (
                <div key={granja.id} className={cn(
                  "bg-white dark:bg-neutral-800 rounded-2xl border transition-all overflow-hidden",
                  isExpanded ? "border-emerald-300 dark:border-emerald-700 shadow-lg" : "border-neutral-200 dark:border-neutral-700 hover:shadow-md"
                )}>
                  {/* Granja Header */}
                  <button
                    onClick={() => { setExpandedGranja(isExpanded ? null : granja.id); setExpandedGaleron(null); }}
                    className="w-full p-5 text-left flex items-center gap-4 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors"
                  >
                    <div className="p-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)' }}>
                      <Building2 className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-neutral-900 dark:text-white">{granja.nombre}</h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 uppercase">
                          {granja.galerones.length} galerones
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">{granja.ubicacion}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-black" style={{ color: 'var(--brand-primary)' }}>{granja.cartones.toLocaleString()}</p>
                      <p className="text-[10px] font-bold text-neutral-400 uppercase">cartones</p>
                    </div>
                    <ChevronRight className={cn("w-5 h-5 text-neutral-400 transition-transform", isExpanded && "rotate-90")} />
                  </button>

                  {/* Granja Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 p-5 space-y-4 animate-in fade-in">
                      {/* Granja KPIs */}
                      <div className="grid grid-cols-4 gap-3">
                        <MiniKPI label="Aves" value={granja.aves.toLocaleString()} color="rose" />
                        <MiniKPI label="Ocupación" value={`${ocupacionGeneral}%`} color={ocupacionGeneral > 90 ? 'red' : 'emerald'} />
                        <MiniKPI label="Vacunas" value={String(granja.vacunasPendientes)} color={granja.vacunasPendientes > 0 ? 'red' : 'emerald'} />
                        <MiniKPI label="Mantenimiento" value={String(granja.mantenimientosPendientes)} color={granja.mantenimientosPendientes > 0 ? 'amber' : 'emerald'} />
                      </div>

                      {/* Occupancy Bar */}
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-neutral-500 dark:text-neutral-400 font-bold">Ocupación Total</span>
                          <span className="font-bold" style={{ color: 'var(--brand-primary)' }}>{granja.aves.toLocaleString()} / {totalCapacidad.toLocaleString()} aves</span>
                        </div>
                        <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-3">
                          <div className="h-3 rounded-full transition-all" style={{
                            width: `${Math.min(ocupacionGeneral, 100)}%`,
                            background: `linear-gradient(90deg, var(--brand-primary), var(--brand-primary-light))`
                          }} />
                        </div>
                      </div>

                      {/* Galerones */}
                      <div className="space-y-3">
                        {granja.galerones.filter(gl => gl.estado === 'Activo').map(galeron => {
                          const isGaleronExpanded = expandedGaleron === galeron.id;
                          return (
                            <div key={galeron.id} className={cn(
                              "bg-white dark:bg-neutral-800 rounded-xl border overflow-hidden",
                              isGaleronExpanded ? "border-emerald-300 dark:border-emerald-700" : "border-neutral-200 dark:border-neutral-700"
                            )}>
                              <button
                                onClick={() => setExpandedGaleron(isGaleronExpanded ? null : galeron.id)}
                                className="w-full p-4 text-left flex items-center gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors"
                              >
                                <div className="p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--brand-secondary) 15%, transparent)' }}>
                                  <Warehouse className="w-4 h-4" style={{ color: 'var(--brand-secondary-dark)' }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm text-neutral-900 dark:text-white">{galeron.nombre}</span>
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-neutral-500">
                                      {galeron.lotes.length} lotes
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 mt-1">
                                    <span className="text-[11px] text-neutral-500">{galeron.aves.toLocaleString()} aves</span>
                                    <span className="text-[11px] font-bold" style={{ color: galeron.ocupacion > 90 ? '#ef4444' : 'var(--brand-primary)' }}>
                                      {galeron.ocupacion}% ocupación
                                    </span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-sm font-black text-neutral-900 dark:text-white">{galeron.cartones}</p>
                                  <p className="text-[9px] font-bold text-neutral-400 uppercase">cartones</p>
                                </div>
                                <ChevronRight className={cn("w-4 h-4 text-neutral-400 transition-transform", isGaleronExpanded && "rotate-90")} />
                              </button>

                              {/* Galeron Expanded */}
                              {isGaleronExpanded && (
                                <div className="border-t border-neutral-200 dark:border-neutral-700 p-4 space-y-3 bg-neutral-50 dark:bg-neutral-900/30 animate-in fade-in">
                                  {/* Galeron KPIs */}
                                  <div className="grid grid-cols-3 gap-2">
                                    <MiniKPI label="Cartones" value={String(galeron.cartones)} color="emerald" />
                                    <MiniKPI label="Consumo" value={`${galeron.consumoAlimentoTotal.toFixed(0)} kg`} color="amber" />
                                    <MiniKPI label="Capacidad" value={`${galeron.ocupacion}%`} color={galeron.ocupacion > 90 ? 'red' : 'emerald'} />
                                  </div>

                                  {/* Occupancy */}
                                  <div>
                                    <div className="flex justify-between text-xs mb-1">
                                      <span className="text-neutral-500 dark:text-neutral-400">Ocupación</span>
                                      <span className="font-bold text-neutral-700 dark:text-neutral-300">{galeron.aves} / {galeron.capacidad_maxima}</span>
                                    </div>
                                    <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2">
                                      <div className={cn("h-2 rounded-full transition-all", galeron.ocupacion > 90 ? "bg-red-500" : "bg-emerald-500")}
                                        style={{ width: `${Math.min(galeron.ocupacion, 100)}%` }} />
                                    </div>
                                  </div>

                                  {/* Lotes */}
                                  {galeron.lotes.length > 0 && (
                                    <div>
                                      <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase mb-2">Lotes Activos</p>
                                      <div className="space-y-2">
                                        {galeron.lotes.map(lote => (
                                          <div key={lote.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                              <p className="text-xs font-bold text-neutral-900 dark:text-white">{lote.linea_genetica}</p>
                                              <p className="text-[10px] text-neutral-500">{lote.cantidad_inicial.toLocaleString()} aves</p>
                                            </div>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                                              {lote.estado}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-48 space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
          <p className="text-sm text-neutral-400">Cargando datos de producción...</p>
        </div>
      )}

      {/* Impacto Desperdicio */}
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-50 dark:bg-red-900/20">
              <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h3 className="font-bold text-neutral-900 dark:text-white">Impacto de Desperdicios</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Costo acumulado últimos 7 días</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-red-600 dark:text-red-400">₡{data.impactoDesperdicioHoy.toLocaleString()}</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{data.desperdiciosHoy} incidentes en 7 días</p>
          </div>
        </div>
        {data.desperdiciosHoy > 0 && (
          <div className="w-full bg-red-100 dark:bg-red-900/30 rounded-full h-2.5">
            <div className="bg-red-500 h-2.5 rounded-full transition-all" style={{ width: `${Math.min((data.desperdiciosHoy / 10) * 100, 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({ label, value, icon: Icon, color, desc }: { label: string; value: string; icon: React.ComponentType<{className?: string}>; color: string; desc: string }) {
  const styles: Record<string, { color: string; bg: string; border: string }> = {
    emerald: { color: 'text-stone-700 dark:text-stone-300', bg: 'bg-stone-50 dark:bg-neutral-800/50', border: 'border-stone-200/60 dark:border-neutral-700/40' },
    amber: { color: 'text-stone-700 dark:text-stone-300', bg: 'bg-stone-50 dark:bg-neutral-800/50', border: 'border-stone-200/60 dark:border-neutral-700/40' },
    rose: { color: 'text-stone-700 dark:text-stone-300', bg: 'bg-stone-50 dark:bg-neutral-800/50', border: 'border-stone-200/60 dark:border-neutral-700/40' },
    red: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50/50 dark:bg-red-900/10', border: 'border-red-200/40 dark:border-red-800/30' },
  };
  const s = styles[color] || styles.emerald;
  return (
    <div className={cn("p-5 rounded-2xl border transition-all hover:shadow-md", s.bg, s.border)}>
      <div className="p-2 rounded-xl w-fit mb-3">
        <span style={{ color: 'var(--brand-primary)' }}><Icon className="w-5 h-5" /></span>
      </div>
      <p className={cn("text-3xl font-black", s.color)}>{value}</p>
      <p className="text-xs font-bold text-stone-500 dark:text-stone-400 uppercase mt-1">{label}</p>
      <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">{desc}</p>
    </div>
  );
}

function MiniKPI({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'text-stone-700 dark:text-stone-300',
    red: 'text-red-600 dark:text-red-400',
    amber: 'text-stone-700 dark:text-stone-300',
    rose: 'text-stone-700 dark:text-stone-300',
  };
  return (
    <div className="p-2.5 rounded-lg bg-white dark:bg-neutral-800 border border-stone-200/60 dark:border-neutral-700/40">
      <p className={cn("text-lg font-black", colors[color] || colors.emerald)}>{value}</p>
      <p className="text-[10px] font-bold text-stone-500 uppercase">{label}</p>
    </div>
  );
}

// ==================== FINANZAS TAB ====================
function FinanzasTab({ data, utilidadPorcentaje }: { data: DashboardData; utilidadPorcentaje: string }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-6 text-white shadow-lg" style={{ background: 'linear-gradient(135deg, var(--brand-primary-dark), var(--brand-primary))', boxShadow: '0 8px 32px color-mix(in srgb, var(--brand-primary) 30%, transparent)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-white/10">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg">Resumen Financiero del Día</h3>
            <p className="text-sm text-white/70">{new Date().toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-white/10 rounded-xl p-4">
            <p className="text-sm text-white/70 mb-1">Ingresos</p>
            <p className="text-2xl font-black">₡{data.ingresosHoy.toLocaleString()}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-4">
            <p className="text-sm text-white/70 mb-1">Gastos</p>
            <p className="text-2xl font-black">₡{data.gastosHoy.toLocaleString()}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-4">
            <p className="text-sm text-white/70 mb-1">Utilidad</p>
            <p className={cn("text-2xl font-black", data.utilidadNeta >= 0 ? "text-emerald-300" : "text-red-300")}>₡{data.utilidadNeta.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
              <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-bold text-neutral-600 dark:text-neutral-400">Margen de Utilidad</p>
          </div>
          <p className="text-3xl font-black text-neutral-900 dark:text-white">{utilidadPorcentaje}%</p>
          <div className="mt-3 w-full bg-neutral-100 dark:bg-neutral-700 rounded-full h-2">
            <div className={cn("h-2 rounded-full transition-all", data.utilidadNeta >= 0 ? "bg-emerald-500" : "bg-red-500")}
              style={{ width: `${Math.min(Math.abs(Number(utilidadPorcentaje)), 100)}%` }} />
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-orange-50 dark:bg-orange-900/20">
              <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <p className="text-sm font-bold text-neutral-600 dark:text-neutral-400">Ctas por Cobrar</p>
          </div>
          <p className="text-3xl font-black text-orange-600 dark:text-orange-400">₡{data.cuentasPorCobrar.toLocaleString()}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Facturas pendientes de cobro</p>
        </div>

        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/20">
              <ShoppingCart className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-sm font-bold text-neutral-600 dark:text-neutral-400">Facturas Hoy</p>
          </div>
          <p className="text-3xl font-black text-blue-600 dark:text-blue-400">{data.facturasEmitidas}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Documentos emitidos</p>
        </div>
      </div>

      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
        <h3 className="font-bold text-neutral-900 dark:text-white mb-4">Flujo del Día</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-neutral-500 dark:text-neutral-400">Ingresos</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">₡{data.ingresosHoy.toLocaleString()}</span>
            </div>
            <div className="w-full bg-emerald-100 dark:bg-emerald-900/30 rounded-full h-3">
              <div className="bg-emerald-500 h-3 rounded-full" style={{ width: `${data.ingresosHoy > 0 ? 100 : 0}%` }} />
            </div>
          </div>
          <Zap className="w-5 h-5 text-neutral-300 dark:text-neutral-600 shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-neutral-500 dark:text-neutral-400">Gastos</span>
              <span className="font-bold text-red-600 dark:text-red-400">₡{data.gastosHoy.toLocaleString()}</span>
            </div>
            <div className="w-full bg-red-100 dark:bg-red-900/30 rounded-full h-3">
              <div className="bg-red-500 h-3 rounded-full" style={{ width: `${data.ingresosHoy > 0 ? Math.min((data.gastosHoy / data.ingresosHoy) * 100, 100) : 0}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== LOGISTICA TAB ====================
function LogisticaTab({ data }: { data: DashboardData }) {
  const logKpis = [
    { label: 'Rutas Activas', value: String(data.rutasActivas), icon: Truck, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', desc: 'Rutas en operación' },
    { label: 'Clientes Activos', value: String(data.clientesActivos), icon: Users, color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-900/20', border: 'border-teal-200 dark:border-teal-800', desc: 'Clientes con pedidos' },
    { label: 'Facturas Hoy', value: String(data.facturasEmitidas), icon: ShoppingCart, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', desc: 'Documentos emitidos' },
    { label: 'Ctas por Cobrar', value: `₡${data.cuentasPorCobrar.toLocaleString()}`, icon: DollarSign, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', desc: 'Pendiente de cobro' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {logKpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <div key={i} className={cn("p-5 rounded-2xl border transition-all hover:shadow-md", kpi.bg, kpi.border)}>
              <div className={cn("p-2 rounded-xl w-fit mb-3", kpi.bg)}>
                <Icon className={cn("w-5 h-5", kpi.color)} />
              </div>
              <p className={cn("text-3xl font-black", kpi.color)}>{kpi.value}</p>
              <p className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase mt-1">{kpi.label}</p>
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">{kpi.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/20">
              <Truck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="font-bold text-neutral-900 dark:text-white">Operación de Rutas</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-neutral-100 dark:border-neutral-700">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Rutas en operación</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">{data.rutasActivas}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-neutral-100 dark:border-neutral-700">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Clientes servidos</span>
              <span className="font-bold text-teal-600 dark:text-teal-400">{data.clientesActivos}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Cartones distribuidos</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">{data.cartonesProducidos}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-orange-50 dark:bg-orange-900/20">
              <DollarSign className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <h3 className="font-bold text-neutral-900 dark:text-white">Cartera</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-neutral-100 dark:border-neutral-700">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Facturas emitidas hoy</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">{data.facturasEmitidas}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-neutral-100 dark:border-neutral-700">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Por cobrar</span>
              <span className="font-bold text-orange-600 dark:text-orange-400">₡{data.cuentasPorCobrar.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Ingresos confirmados</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">₡{data.ingresosHoy.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
