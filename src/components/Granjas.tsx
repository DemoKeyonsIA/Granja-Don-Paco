import React, { useState, useEffect } from 'react';
import { Building2, Plus, ChevronRight, ChevronDown, Warehouse, Heart, Egg, Package, AlertTriangle, Wrench, Calendar, Trash2, Edit, X, MapPin, Users, TrendingUp, Clock, Activity, Target, ArrowLeft, Check, CheckCircle2, ShieldCheck, PackageCheck } from 'lucide-react';
import { User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import Breadcrumb from './Breadcrumb';
import WizardProgress from './WizardProgress';
import { BloqueCarga, Spinner } from './Spinner';
import { TarjetaKpi } from './TarjetaKpi';

interface Props { currentUser: User; }

interface Granja {
  id: string; nombre: string; ubicacion: string; tipo_produccion?: string; encargadoId: string; estado?: string;
}

interface Galeron {
  id: string; nombre: string; capacidad_maxima: number; aves_en_produccion?: number; estado?: string; granjaId: string;
}

interface Lote {
  id: string; galeronId: string; fecha_ingreso: string; cantidad_inicial: number; linea_genetica: string; estado: string;
}

interface GaleronDetalle {
  id: string; nombre: string; capacidad_maxima: number; estado: string;
  aves_en_produccion: number; tipo_galeron: string;
  produccion_diaria_esperada: number; notas: string;
  lotes: Lote[]; lotesActivos: number;
  cartonesHoy: number; aves: number; ocupacion: number;
  vacunasTotales: number; vacunasPendientes: number;
  ordenesTotales: number; ordenesPendientes: number;
  consumoTotal: number;
  produccionHistorial: Array<{ fecha: string; tipo: string; cantidad: number }>;
  mantenimientos: Array<{ id: string; tipo: string; fecha_programada: string; fecha_ejecutada: string; estado: string; responsable: string; costo: number; observaciones: string }>;
}

interface GranjaDetalle {
  granja: Granja;
  galerones: GaleronDetalle[];
  resumen: {
    totalGalerones: number; totalLotes: number; avesTotal: number; capacidadTotal: number;
    ocupacion: number; cartonesHoy: number; vacunasVencidas: number; ordenesVencidas: number;
  };
}

type View = 'lista' | 'crear' | 'detalle';
type DetailTab = 'resumen' | 'galerones' | 'produccion' | 'lotes' | 'mantenimientos';

export default function Granjas({ currentUser }: Props) {
  const [view, setView] = useState<View>('lista');
  const [granjas, setGranjas] = useState<Granja[]>([]);
  const [galerones, setGalerones] = useState<Galeron[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [selectedGranja, setSelectedGranja] = useState<GranjaDetalle | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('resumen');
  const [loading, setLoading] = useState(false);

  const [showRecoleccion, setShowRecoleccion] = useState(false);
  const [recolGranjaId, setRecolGranjaId] = useState('');
  const [recolGaleron, setRecolGaleron] = useState('');
  const [recolCantidades, setRecolCantidades] = useState<Record<string, number>>({});
  const [savingRecoleccion, setSavingRecoleccion] = useState(false);
  const [productosCatalogo, setProductosCatalogo] = useState<{ id: string; nombre: string; unidad: string; categoria: string; estado: string }[]>([]);

  const cargar = async () => {
    setLoading(true);
    try {
      const [rG, rGl, rL, rCat] = await Promise.all([
        fetch('/api/granjas'), fetch('/api/galerones'), fetch('/api/lotes'), fetch('/api/productos-catalogo')
      ]);
      if (rG.ok) setGranjas(await rG.json());
      if (rGl.ok) setGalerones(await rGl.json());
      if (rL.ok) setLotes(await rL.json());
      if (rCat.ok) setProductosCatalogo(await rCat.json());
    } catch { toast.error('No se pudieron cargar las granjas.'); }
    setLoading(false);
  };

  const cargarDetalle = async (granjaId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/granjas/${granjaId}/detalle`);
      if (res.ok) {
        setSelectedGranja(await res.json());
        setView('detalle');
        setDetailTab('resumen');
      } else {
        toast.error('No se pudo cargar la granja');
      }
    } catch { toast.error('Error de conexión'); }
    setLoading(false);
  };

  const registrarRecoleccion = async () => {
    if (!recolGaleron) { toast.error('Selecciona un galerón'); return; }
    if (!productosConCantidad.length) { toast.error('Ingresa al menos una cantidad'); return; }
    setSavingRecoleccion(true);
    try {
      const detalles = productosConCantidad.map(p => ({ producto: p.nombre, cantidad: recolCantidades[p.id] || 0 }));
      const res = await fetch('/api/produccion/recoleccion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // `granjaId` acota la búsqueda del galerón: el nombre no es único entre
        // granjas y sin esto una granja con el mismo nombre de galerón que otra
        // registraba la recolección en el galerón de la otra.
        body: JSON.stringify({ galeron: recolGaleron, granjaId: recolGranjaId || undefined, detalles })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error registrando recolección'); }
      toast.success('Recolección registrada. Inventario actualizado en Granja.');
      setRecolGranjaId(''); setRecolGaleron(''); setRecolCantidades({}); setShowRecoleccion(false);
      cargar();
    } catch (e: any) { toast.error(e.message); }
    finally { setSavingRecoleccion(false); };
  };

  useEffect(() => { cargar(); }, []);

  if (view === 'crear') return <CrearGranjaWizard onBack={() => { setView('lista'); cargar(); }} />;
  if (view === 'detalle' && selectedGranja) return (
    <GranjaDetalleView
      data={selectedGranja} tab={detailTab} setTab={setDetailTab}
      onBack={() => { setView('lista'); setSelectedGranja(null); }}
      onRefresh={() => cargarDetalle(selectedGranja.granja.id)} currentUser={currentUser} />
  );

  // LISTA VIEW
  const granjasActivas = granjas.filter(g => g.estado !== 'Archivado');
  const totalGalerones = galerones.filter(g => g.estado !== 'Archivado').length;
  const totalLotesActivos = lotes.filter(l => l.estado === 'Activo').length;
  const totalAves = galerones.reduce((a, g) => a + (g.aves_en_produccion || 0), 0);
  const productosConCantidad = productosCatalogo.filter(p => (recolCantidades[p.id] || 0) > 0);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in pb-20">
      <Breadcrumb items={[{ label: 'Granjas' }]} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl shadow-lg" style={{ background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))', boxShadow: '0 4px 14px color-mix(in srgb, var(--brand-primary) 30%, transparent)' }}>
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-neutral-900 dark:text-white">Granjas</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Administración de unidades productivas</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
        <button onClick={() => setShowRecoleccion(!showRecoleccion)}
          className={cn('flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98]',
            showRecoleccion ? 'bg-white text-emerald-700 border border-emerald-200' : 'bg-emerald-600 text-white')}>
          <PackageCheck className="w-5 h-5" /> {showRecoleccion ? 'Cerrar Recolección' : 'Ingresar Recolección'}
        </button>
        <button onClick={() => setView('crear')}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-white text-sm font-bold shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))' }}>
          <Plus className="w-5 h-5" /> Nueva Granja
        </button>
        </div>
      </div>

      {/* Recolección rápida */}
      {showRecoleccion && (
        <div className="mb-2 bg-emerald-50/60 dark:bg-emerald-950/30 border-2 border-emerald-200 dark:border-emerald-900 rounded-2xl p-6 space-y-5 animate-in fade-in">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><Egg className="w-5 h-5" /></div>
            <div>
              <h4 className="font-bold text-neutral-800 dark:text-white">Ingreso de Recolección</h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Los productos se sumarán al Inventario en Granja (Disponible para Traslado)</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-1">
              <label className="text-xs font-bold text-neutral-600 dark:text-neutral-400 uppercase">Granja de Origen</label>
              <select value={recolGranjaId} onChange={e => { setRecolGranjaId(e.target.value); setRecolGaleron(''); }} className="w-full bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-xl px-4 py-3 text-sm focus:border-emerald-500 outline-none">
                <option value="">Todas las granjas</option>
                {granjasActivas.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-neutral-600 dark:text-neutral-400 uppercase">Galerón de Origen *</label>
              <select value={recolGaleron} onChange={e => setRecolGaleron(e.target.value)} className="w-full bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-xl px-4 py-3 text-sm focus:border-emerald-500 outline-none">
                <option value="">Seleccione un galerón</option>
                {galerones.filter(g => g.estado !== 'Archivado' && (!recolGranjaId || g.granjaId === recolGranjaId)).map(g => <option key={g.id} value={g.nombre}>{g.nombre}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {productosCatalogo.filter(p => p.estado === 'Activo').map(p => (
              <div key={p.id} className="space-y-1">
                <label className="text-xs font-bold text-neutral-600 dark:text-neutral-400 uppercase">{p.nombre} ({p.unidad})</label>
                <input type="number" min="0" value={recolCantidades[p.id] || ''} onChange={e => setRecolCantidades(prev => ({ ...prev, [p.id]: Number(e.target.value) || 0 }))}
                  className="w-full bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-xl px-4 py-3 text-sm focus:border-emerald-500 outline-none" placeholder="0" />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={registrarRecoleccion} disabled={savingRecoleccion || !productosConCantidad.length || !recolGaleron}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-sm disabled:opacity-50 flex items-center transition-colors">
              {savingRecoleccion ? <Spinner className="mr-2" /> : <PackageCheck className="w-4 h-4 mr-2" />}Registrar Recolección
            </button>
          </div>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <TarjetaKpi iconoPosicion="arriba" etiquetaPosicion="abajo" superficie="tono" etiqueta="Granjas Activas" valor={String(granjasActivas.length)} icono={Building2} tono="marca" />
        <TarjetaKpi iconoPosicion="arriba" etiquetaPosicion="abajo" superficie="tono" etiqueta="Galerones" valor={String(totalGalerones)} icono={Warehouse} tono="marca-info" />
        <TarjetaKpi iconoPosicion="arriba" etiquetaPosicion="abajo" superficie="tono" etiqueta="Lotes Activos" valor={String(totalLotesActivos)} icono={Heart} tono="marca-acento" />
        <TarjetaKpi iconoPosicion="arriba" etiquetaPosicion="abajo" superficie="tono" etiqueta="Aves Totales" valor={totalAves.toLocaleString()} icono={Egg} tono="marca-info" />
      </div>

      {/* Granja Cards */}
      {loading && granjas.length === 0 ? (
        <BloqueCarga />
      ) : granjasActivas.length === 0 ? (
        <div className="bg-white dark:bg-neutral-800/80 rounded-2xl border border-stone-200/60 dark:border-neutral-700/40 p-12 text-center">
          <Building2 className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--brand-primary)', opacity: 0.3 }} />
          <p className="font-bold text-stone-500 dark:text-stone-400">No hay granjas registradas</p>
          <p className="text-sm text-stone-400 dark:text-stone-500 mt-1">Crea tu primera granja para comenzar</p>
          <button onClick={() => setView('crear')}
            className="mt-4 px-5 py-2.5 rounded-xl text-white text-sm font-bold"
            style={{ background: 'var(--brand-primary)' }}>
            <Plus className="w-4 h-4 inline mr-1" /> Crear Granja
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {granjasActivas.map(granja => {
            const gGalerones = galerones.filter(g => g.granjaId === granja.id);
            const gLotes = lotes.filter(l => gGalerones.some(g => g.id === l.galeronId));
            const aves = gGalerones.reduce((a, g) => a + (g.aves_en_produccion || 0), 0);
            const capacidad = gGalerones.reduce((a, g) => a + Number(g.capacidad_maxima), 0);
            const ocupacion = capacidad > 0 ? Math.round((aves / capacidad) * 100) : 0;

            return (
              <button key={granja.id} onClick={() => cargarDetalle(granja.id)}
                className="bg-white dark:bg-neutral-800/80 rounded-2xl border border-stone-200/60 dark:border-neutral-700/40 p-5 text-left transition-all hover:shadow-lg group"
                style={{ '--hover-border': 'color-mix(in srgb, var(--brand-primary) 30%, transparent)' } as any}>
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl shrink-0" style={{ background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)' }}>
                    <Building2 className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-stone-800 dark:text-white truncate">{granja.nombre}</h3>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0"
                        style={{ background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', color: 'var(--brand-primary-dark)' }}>
                        {granja.estado || 'Activa'}
                      </span>
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 flex items-center gap-1 mb-3">
                      <MapPin className="w-3 h-3" /> {granja.ubicacion || 'Sin ubicación'}
                    </p>
                    <div className="grid grid-cols-4 gap-3">
                      <TarjetaKpi variante="plano" etiqueta="Galerones" valor={String(gGalerones.filter(g => g.estado !== 'Archivado').length)} />
                      <TarjetaKpi variante="plano" etiqueta="Aves" valor={aves.toLocaleString()} />
                      <TarjetaKpi variante="plano" etiqueta="Ocupación" valor={`${ocupacion}%`} tono={ocupacion > 90 ? 'negativo' : 'neutro'} />
                      <TarjetaKpi variante="plano" etiqueta="Lotes" valor={String(gLotes.length)} />
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-neutral-300 dark:text-neutral-600 shrink-0 mt-2 group-hover:text-emerald-500 transition-colors" />
                </div>
                {/* Occupancy bar */}
                <div className="mt-3 w-full bg-stone-100 dark:bg-neutral-700 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full transition-all" style={{
                    width: `${Math.min(ocupacion, 100)}%`,
                    background: ocupacion > 90 ? '#c2554a' : 'linear-gradient(90deg, var(--brand-primary), var(--brand-primary-light))'
                  }} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==================== CREAR GRANJA WIZARD ====================
function CrearGranjaWizard({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ nombre: '', ubicacion: '', tipo_produccion: [] as string[] });
  const [galeronesForm, setGaleronesForm] = useState<Array<{ nombre: string; capacidad_maxima: string; estado: string }>>([
    { nombre: 'Galerón 1', capacidad_maxima: '5000', estado: 'Producción' }
  ]);
  const [saving, setSaving] = useState(false);

  const steps = [{ number: 0, label: 'Datos de Granja' }, { number: 1, label: 'Galerones' }, { number: 2, label: 'Confirmar' }];

  const toggleTipo = (tipo: string) => {
    setForm(f => ({ ...f, tipo_produccion: f.tipo_produccion.includes(tipo) ? f.tipo_produccion.filter(t => t !== tipo) : [...f.tipo_produccion, tipo] }));
  };

  const addGaleron = () => setGaleronesForm(g => [...g, { nombre: `Galerón ${g.length + 1}`, capacidad_maxima: '5000', estado: 'Producción' }]);
  const removeGaleron = (i: number) => setGaleronesForm(g => g.filter((_, idx) => idx !== i));
  const updateGaleron = (i: number, field: string, value: string) => setGaleronesForm(g => g.map((gl, idx) => idx === i ? { ...gl, [field]: value } : gl));

  const handleSave = async () => {
    if (!form.nombre.trim()) { toast.error('Ingresa el nombre de la granja'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/granjas/wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre, ubicacion: form.ubicacion,
          tipo_produccion: form.tipo_produccion.join(', '),
          galerones: galeronesForm.filter(g => g.nombre.trim()).map(g => ({
            nombre: g.nombre, capacidad_maxima: Number(g.capacidad_maxima) || 5000
          }))
        })
      });
      if (res.ok) { toast.success('Granja creada exitosamente'); onBack(); }
      else { toast.error('Error al crear granja'); }
    } catch { toast.error('Error de conexión'); }
    setSaving(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in pb-20">
      <Breadcrumb items={[{ label: 'Granjas', onClick: onBack }, { label: 'Nueva Granja' }]} />
      <WizardProgress steps={steps} currentStep={step} />

      {/* Step 0: Datos */}
      {step === 0 && (
        <div className="bg-white dark:bg-neutral-800/80 rounded-2xl border border-stone-200/60 dark:border-neutral-700/40 p-6 space-y-5">
          <h3 className="font-bold text-stone-800 dark:text-white">Datos de la Granja</h3>
          <div>
            <label className="block text-sm font-bold text-stone-500 dark:text-stone-400 mb-1">Nombre *</label>
            <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              placeholder="Ej: Granja La Esperanza"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 dark:border-neutral-600 bg-stone-50 dark:bg-neutral-700/50 text-stone-800 dark:text-white text-sm font-medium focus:ring-2 focus:border-transparent" style={{ '--tw-ring-color': 'color-mix(in srgb, var(--brand-primary) 25%, transparent)' } as any} />
          </div>
          <div>
            <label className="block text-sm font-bold text-stone-500 dark:text-stone-400 mb-1">Ubicación</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input value={form.ubicacion} onChange={e => setForm(f => ({ ...f, ubicacion: e.target.value }))}
                placeholder="Dirección o referencia"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-stone-200 dark:border-neutral-600 bg-stone-50 dark:bg-neutral-700/50 text-stone-800 dark:text-white text-sm font-medium" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-stone-500 dark:text-stone-400 mb-2">Tipo de Producción</label>
            <div className="flex flex-wrap gap-2">
              {['Huevos', 'Gallinaza', 'Pollo'].map(tipo => (
                <button key={tipo} onClick={() => toggleTipo(tipo)}
                  className={cn("px-4 py-2 rounded-xl text-sm font-bold border transition-all",
                    form.tipo_produccion.includes(tipo)
                      ? "text-white border-transparent shadow-sm"
                      : "text-stone-600 dark:text-stone-400 border-stone-200 dark:border-neutral-600 hover:border-stone-300")}
                  style={form.tipo_produccion.includes(tipo) ? { background: 'var(--brand-primary)' } : {}}>
                  {form.tipo_produccion.includes(tipo) && <Check className="w-3.5 h-3.5 inline mr-1" />}
                  {tipo}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={() => { if (!form.nombre.trim()) { toast.error('Ingresa el nombre'); return; } setStep(1); }}
              className="px-6 py-3 rounded-xl text-white text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
              Siguiente <ChevronRight className="w-4 h-4 inline ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Galerones */}
      {step === 1 && (
        <div className="bg-white dark:bg-neutral-800/80 rounded-2xl border border-stone-200/60 dark:border-neutral-700/40 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-stone-800 dark:text-white">Galerones Iniciales</h3>
            <button onClick={addGaleron} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold"
              style={{ color: 'var(--brand-primary)', background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)' }}>
              <Plus className="w-3.5 h-3.5" /> Agregar
            </button>
          </div>
          <div className="space-y-3">
            {galeronesForm.map((gl, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-stone-50 dark:bg-neutral-900 border border-stone-200/60 dark:border-neutral-700/40">
                <Warehouse className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-secondary)' }} />
                <input value={gl.nombre} onChange={e => updateGaleron(i, 'nombre', e.target.value)}
                  placeholder="Nombre" className="flex-1 px-3 py-2 rounded-lg border border-stone-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-stone-800 dark:text-white" />
                <input value={gl.capacidad_maxima} onChange={e => updateGaleron(i, 'capacidad_maxima', e.target.value)}
                  type="number" placeholder="Cap." className="w-24 px-3 py-2 rounded-lg border border-stone-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-stone-800 dark:text-white text-center" />
                <select value={gl.estado} onChange={e => updateGaleron(i, 'estado', e.target.value)}
                  className="px-3 py-2 rounded-lg border border-stone-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-stone-800 dark:text-white">
                  <option>Producción</option><option>Crianza</option><option>Mantenimiento</option>
                </select>
                {galeronesForm.length > 1 && (
                  <button onClick={() => removeGaleron(i)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(0)} className="px-5 py-3 rounded-xl text-sm font-bold text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-neutral-700">
              <ArrowLeft className="w-4 h-4 inline mr-1" /> Atrás
            </button>
            <button onClick={() => setStep(2)} className="px-6 py-3 rounded-xl text-white text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
              Siguiente <ChevronRight className="w-4 h-4 inline ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Confirmar */}
      {step === 2 && (
        <div className="bg-white dark:bg-neutral-800/80 rounded-2xl border border-stone-200/60 dark:border-neutral-700/40 p-6 space-y-5">
          <h3 className="font-bold text-stone-800 dark:text-white">Confirmar Creación</h3>
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-stone-50 dark:bg-neutral-900 border border-stone-200/60 dark:border-neutral-700/40">
              <p className="text-xs font-bold text-stone-500 uppercase mb-1">Granja</p>
              <p className="font-bold text-stone-800 dark:text-white">{form.nombre}</p>
              {form.ubicacion && <p className="text-xs text-stone-500 flex items-center gap-1 mt-1"><MapPin className="w-3 h-3" /> {form.ubicacion}</p>}
              {form.tipo_produccion.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {form.tipo_produccion.map(t => (
                    <span key={t} className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)', color: 'var(--brand-primary)' }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 rounded-xl bg-stone-50 dark:bg-neutral-900 border border-stone-200/60 dark:border-neutral-700/40">
              <p className="text-xs font-bold text-stone-500 uppercase mb-2">Galerones ({galeronesForm.filter(g => g.nombre.trim()).length})</p>
              <div className="space-y-1">
                {galeronesForm.filter(g => g.nombre.trim()).map((gl, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-stone-600 dark:text-stone-300">{gl.nombre}</span>
                    <span className="text-stone-500 text-xs">{Number(gl.capacidad_maxima).toLocaleString()} aves · {gl.estado}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(1)} className="px-5 py-3 rounded-xl text-sm font-bold text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-neutral-700">
              <ArrowLeft className="w-4 h-4 inline mr-1" /> Atrás
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-white text-sm font-bold shadow-lg disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))' }}>
              {saving ? <Spinner /> : <Check className="w-4 h-4" />}
              {saving ? 'Creando...' : 'Crear Granja'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== GRANJA DETALLE VIEW ====================
interface DetalleProps {
  data: GranjaDetalle; tab: DetailTab; setTab: (t: DetailTab) => void;
  onBack: () => void; onRefresh: () => void; currentUser: User;
}

function GranjaDetalleView({ data, tab, setTab, onBack, onRefresh, currentUser }: DetalleProps) {
  const { granja, galerones, resumen } = data;
  const tabs: Array<{ id: DetailTab; label: string; icon: React.ComponentType<{className?: string}> }> = [
    { id: 'resumen', label: 'Resumen', icon: Target },
    { id: 'galerones', label: 'Galerones', icon: Warehouse },
    { id: 'produccion', label: 'Producción', icon: Egg },
    { id: 'lotes', label: 'Lotes', icon: Heart },
    { id: 'mantenimientos', label: 'Mantenimientos', icon: Wrench },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in pb-20">
      <Breadcrumb items={[{ label: 'Granjas', onClick: onBack }, { label: granja.nombre }]} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <button onClick={onBack} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="p-2.5 rounded-2xl" style={{ background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))' }}>
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-black text-neutral-900 dark:text-white">{granja.nombre}</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {granja.ubicacion || 'Sin ubicación'}
            </p>
          </div>
        </div>
      </div>

      {/* Resumen KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <TarjetaKpi iconoPosicion="arriba" etiquetaPosicion="abajo" superficie="tono" etiqueta="Galerones" valor={String(resumen.totalGalerones)} icono={Warehouse} tono="marca-info" />
        <TarjetaKpi iconoPosicion="arriba" etiquetaPosicion="abajo" superficie="tono" etiqueta="Aves" valor={resumen.avesTotal.toLocaleString()} icono={Heart} tono="marca-acento" />
        <TarjetaKpi iconoPosicion="arriba" etiquetaPosicion="abajo" superficie="tono" etiqueta="Ocupación" valor={`${resumen.ocupacion}%`} icono={TrendingUp} tono={resumen.ocupacion > 90 ? 'marca-acento' : 'marca'} />
        <TarjetaKpi iconoPosicion="arriba" etiquetaPosicion="abajo" superficie="tono" etiqueta="Cartones Hoy" valor={String(resumen.cartonesHoy)} icono={Package} tono="marca-info" />
          <TarjetaKpi iconoPosicion="arriba" etiquetaPosicion="abajo" superficie="tono" etiqueta="Alertas" valor={String(resumen.vacunasVencidas + resumen.ordenesVencidas)} icono={AlertTriangle} tono={resumen.vacunasVencidas + resumen.ordenesVencidas > 0 ? 'marca-acento' : 'marca'} />
      </div>

      {/* Occupancy bar */}
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-4">
        <div className="flex justify-between text-xs mb-2">
          <span className="font-bold text-neutral-600 dark:text-neutral-400">Ocupación de Galerones</span>
          <span className="font-bold" style={{ color: 'var(--brand-primary)' }}>{resumen.avesTotal.toLocaleString()} / {resumen.capacidadTotal.toLocaleString()} aves</span>
        </div>
        <div className="w-full bg-neutral-100 dark:bg-neutral-700 rounded-full h-3">
          <div className="h-3 rounded-full transition-all" style={{
            width: `${Math.min(resumen.ocupacion, 100)}%`,
            background: resumen.ocupacion > 90 ? '#ef4444' : `linear-gradient(90deg, var(--brand-primary), var(--brand-primary-light))`
          }} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-2xl overflow-x-auto">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn("flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap flex-1 justify-center",
                tab === t.id ? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm" : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700")}>
              <Icon className={cn("w-4 h-4", tab === t.id && "text-emerald-600 dark:text-emerald-400")} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="animate-in fade-in">
        {tab === 'resumen' && <ResumenTab galerones={galerones} resumen={resumen} />}
        {tab === 'galerones' && <GaleronesTab galerones={galerones} granjaId={granja.id} onRefresh={onRefresh} />}
        {tab === 'produccion' && <ProduccionTab granjaId={granja.id} galerones={galerones} />}
        {tab === 'lotes' && <LotesTab galerones={galerones} onRefresh={onRefresh} />}
        {tab === 'mantenimientos' && <MantenimientosTab galerones={galerones} granjaId={granja.id} onRefresh={onRefresh} />}
      </div>
    </div>
  );
}

// ==================== RESUMEN TAB ====================
function ResumenTab({ galerones, resumen }: { galerones: GaleronDetalle[]; resumen: GranjaDetalle['resumen'] }) {
  const produccionPorProducto: Record<string, number> = {};
  galerones.forEach(gl => {
    gl.produccionHistorial.forEach(p => {
      const key = p.tipo;
      produccionPorProducto[key] = (produccionPorProducto[key] || 0) + p.cantidad;
    });
  });
  const produccionEntries = Object.entries(produccionPorProducto).sort((a, b) => b[1] - a[1]);

  const totalEsperado = galerones.reduce((a, g) => a + g.produccion_diaria_esperada, 0);
  const totalReal = resumen.cartonesHoy;
  const eficiencia = totalEsperado > 0 ? Math.round((totalReal / totalEsperado) * 100) : 0;

  const ordenesVencidasList: Array<{ galeron: string; tipo: string; fecha: string }> = [];
  galerones.forEach(gl => {
    gl.mantenimientos.filter(m => m.estado === 'Pendiente' && m.fecha_programada < new Date().toISOString().split('T')[0])
      .forEach(m => ordenesVencidasList.push({ galeron: gl.nombre, tipo: m.tipo, fecha: m.fecha_programada }));
  });

  const tipoColors: Record<string, string> = {
    'Productora': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    'Crianza': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    'Vacía': 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400',
  };

  return (
    <div className="space-y-6">
      {/* Efficiency KPI */}
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-neutral-900 dark:text-white text-sm">Eficiencia del Día</h3>
          <span className={cn("text-xs font-bold px-2.5 py-1 rounded-full", eficiencia >= 90 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : eficiencia >= 70 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400')}>
            {eficiencia}%
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-lg font-black text-neutral-900 dark:text-white">{totalEsperado.toLocaleString()}</p>
            <p className="text-[10px] font-bold text-neutral-500 uppercase">Esperado</p>
          </div>
          <div>
            <p className="text-lg font-black" style={{ color: 'var(--brand-primary)' }}>{totalReal.toLocaleString()}</p>
            <p className="text-[10px] font-bold text-neutral-500 uppercase">Real</p>
          </div>
          <div>
            <p className={cn("text-lg font-black", totalReal > totalEsperado ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              {totalReal > totalEsperado ? '+' : ''}{(totalReal - totalEsperado).toLocaleString()}
            </p>
            <p className="text-[10px] font-bold text-neutral-500 uppercase">Diferencia</p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {(resumen.vacunasVencidas > 0 || ordenesVencidasList.length > 0) && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <h3 className="font-bold text-red-800 dark:text-red-300">Alertas Activas</h3>
          </div>
          <div className="space-y-2">
            {resumen.vacunasVencidas > 0 && (
              <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                <ShieldCheck className="w-4 h-4" /> {resumen.vacunasVencidas} vacuna(s) vencida(s) o pendiente(s)
              </div>
            )}
            {ordenesVencidasList.map((o, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                <Wrench className="w-4 h-4" /> {o.galeron}: {o.tipo} vencido el {o.fecha}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Galerones by type */}
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5">
        <h3 className="font-bold text-neutral-900 dark:text-white mb-4 text-sm">Galerones por Tipo</h3>
        <div className="grid grid-cols-3 gap-3">
          {['Productora', 'Crianza', 'Vacía'].map(tipo => {
            const count = galerones.filter(g => g.tipo_galeron === tipo).length;
            const aves = galerones.filter(g => g.tipo_galeron === tipo).reduce((a, g) => a + g.aves, 0);
            return (
              <div key={tipo} className="text-center p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-100 dark:border-neutral-700">
                <p className="text-lg font-black text-neutral-900 dark:text-white">{count}</p>
                <p className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full inline-block mb-1", tipoColors[tipo])}>{tipo}</p>
                <p className="text-[10px] text-neutral-500">{aves.toLocaleString()} aves</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Producción por Producto */}
      {produccionEntries.length > 0 && (
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5">
          <h3 className="font-bold text-neutral-900 dark:text-white mb-4 text-sm">Producción por Producto (período visible)</h3>
          <div className="space-y-3">
            {produccionEntries.map(([producto, cantidad]) => {
              const maxProd = produccionEntries[0][1];
              const pct = maxProd > 0 ? (cantidad / maxProd) * 100 : 0;
              return (
                <div key={producto}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-bold text-neutral-700 dark:text-neutral-300">{producto}</span>
                    <span className="font-bold" style={{ color: 'var(--brand-primary)' }}>{cantidad.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-neutral-100 dark:bg-neutral-700 rounded-full h-2">
                    <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--brand-primary), var(--brand-primary-light))' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Galerones Summary with cartones per galerón */}
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
          <h3 className="font-bold text-neutral-900 dark:text-white text-sm">Detalle por Galerón</h3>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
          {galerones.map(gl => (
            <div key={gl.id} className="px-5 py-3 flex items-center gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--brand-secondary) 15%, transparent)' }}>
                <Warehouse className="w-4 h-4" style={{ color: 'var(--brand-secondary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-sm text-neutral-900 dark:text-white truncate">{gl.nombre}</p>
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase", tipoColors[gl.tipo_galeron] || tipoColors['Vacía'])}>{gl.tipo_galeron}</span>
                </div>
                <p className="text-[11px] text-neutral-500">{gl.aves.toLocaleString()} aves · {gl.cartonesHoy} cartones hoy · {gl.lotesActivos} lotes</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-black text-neutral-900 dark:text-white">{gl.ocupacion}%</p>
                <p className="text-[10px] text-neutral-500">ocupación</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== GALERONES TAB ====================
function GaleronesTab({ galerones, granjaId, onRefresh }: { galerones: GaleronDetalle[]; granjaId: string; onRefresh: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingGaleron, setEditingGaleron] = useState<GaleronDetalle | null>(null);
  const [editForm, setEditForm] = useState({ nombre: '', capacidad_maxima: '', estado: 'Activo', aves_en_produccion: '0', tipo_galeron: 'Productora', produccion_diaria_esperada: '0', notas: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ nombre: '', capacidad_maxima: '5000', estado: 'Activo', aves_en_produccion: '0', tipo_galeron: 'Productora', produccion_diaria_esperada: '0', notas: '' });
  const [saving, setSaving] = useState(false);

  const startEdit = (gl: GaleronDetalle) => {
    setEditingGaleron(gl);
    setEditForm({
      nombre: gl.nombre, capacidad_maxima: String(gl.capacidad_maxima), estado: gl.estado,
      aves_en_produccion: String(gl.aves_en_produccion), tipo_galeron: gl.tipo_galeron,
      produccion_diaria_esperada: String(gl.produccion_diaria_esperada), notas: gl.notas || ''
    });
  };

  const saveEdit = async () => {
    if (!editingGaleron) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/galerones/${editingGaleron.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: editForm.nombre, capacidad_maxima: Number(editForm.capacidad_maxima), estado: editForm.estado,
          aves_en_produccion: Number(editForm.aves_en_produccion), tipo_galeron: editForm.tipo_galeron,
          produccion_diaria_esperada: Number(editForm.produccion_diaria_esperada), notas: editForm.notas
        })
      });
      if (res.ok) { toast.success('Galerón actualizado'); setEditingGaleron(null); onRefresh(); }
      else toast.error('Error al actualizar');
    } catch { toast.error('Error de conexión'); }
    setSaving(false);
  };

  const handleCreate = async () => {
    if (!createForm.nombre.trim()) { toast.error('Ingresa el nombre del galerón'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/galerones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          granjaId, nombre: createForm.nombre, capacidad_maxima: Number(createForm.capacidad_maxima),
          aves_en_produccion: Number(createForm.aves_en_produccion), tipo_galeron: createForm.tipo_galeron,
          produccion_diaria_esperada: Number(createForm.produccion_diaria_esperada), notas: createForm.notas,
          estado: createForm.estado
        })
      });
      if (res.ok) {
        toast.success('Galerón creado'); setShowCreate(false);
        setCreateForm({ nombre: '', capacidad_maxima: '5000', estado: 'Activo', aves_en_produccion: '0', tipo_galeron: 'Productora', produccion_diaria_esperada: '0', notas: '' });
        onRefresh();
      } else toast.error('Error al crear');
    } catch { toast.error('Error de conexión'); }
    setSaving(false);
  };

  const deleteGaleron = async (gl: GaleronDetalle) => {
    if (!confirm(`¿Archivar "${gl.nombre}"?`)) return;
    try {
      const res = await fetch(`/api/galerones/${gl.id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Galerón archivado'); onRefresh(); }
      else toast.error('Error al archivar');
    } catch { toast.error('Error de conexión'); }
  };

  const estadoColors: Record<string, string> = {
    Activo: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Mantenimiento: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Inactivo: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400',
  };
  const tipoColors: Record<string, string> = {
    Productora: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Crianza: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    'Vacía': 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-neutral-900 dark:text-white text-sm">Galerones ({galerones.length})</h3>
        <button onClick={() => { setShowCreate(!showCreate); setEditingGaleron(null); }}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold"
          style={{ color: 'var(--brand-primary)', background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)' }}>
          <Plus className="w-3.5 h-3.5" /> Nuevo Galerón
        </button>
      </div>

      {showCreate && (
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border-2 border-dashed p-5 space-y-3 animate-in fade-in" style={{ borderColor: 'var(--brand-primary)' }}>
          <h4 className="font-bold text-sm text-neutral-900 dark:text-white">Crear Nuevo Galerón</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Nombre *</label>
              <input value={createForm.nombre} onChange={e => setCreateForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Galerón 1" className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Capacidad (aves)</label>
              <input type="number" value={createForm.capacidad_maxima} onChange={e => setCreateForm(f => ({ ...f, capacidad_maxima: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Aves en Producción</label>
              <input type="number" value={createForm.aves_en_produccion} onChange={e => setCreateForm(f => ({ ...f, aves_en_produccion: e.target.value }))}
                placeholder="Gallinas productoras" className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Tipo de Galerón</label>
              <select value={createForm.tipo_galeron} onChange={e => setCreateForm(f => ({ ...f, tipo_galeron: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white">
                <option>Productora</option><option>Crianza</option><option>Vacía</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Prod. Diaria Esperada (cartones)</label>
              <input type="number" value={createForm.produccion_diaria_esperada} onChange={e => setCreateForm(f => ({ ...f, produccion_diaria_esperada: e.target.value }))}
                placeholder="Meta diaria" className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Estado</label>
              <select value={createForm.estado} onChange={e => setCreateForm(f => ({ ...f, estado: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white">
                <option>Activo</option><option>Mantenimiento</option><option>Inactivo</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-neutral-500 mb-1">Notas</label>
              <textarea value={createForm.notas} onChange={e => setCreateForm(f => ({ ...f, notas: e.target.value }))} rows={2}
                placeholder="Observaciones internas..." className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700">Cancelar</button>
            <button onClick={handleCreate} disabled={saving} className="flex items-center gap-1 px-5 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>
              {saving && <Spinner tamano="xs" />} Crear
            </button>
          </div>
        </div>
      )}

      {galerones.map(gl => {
        const isExpanded = expandedId === gl.id;
        const eficiencia = gl.produccion_diaria_esperada > 0 ? Math.round(((0) / gl.produccion_diaria_esperada) * 100) : null;
        const avesProduccion = gl.aves_en_produccion || 0;
        const ocupacion = gl.capacidad_maxima > 0 ? Math.round((avesProduccion / gl.capacidad_maxima) * 100) : 0;
        const lotesActivos = gl.lotesActivos || gl.lotes.filter(l => l.estado === 'Activo').length;
        return (
          <div key={gl.id} className={cn("bg-white dark:bg-neutral-800 rounded-2xl border overflow-hidden transition-all",
            isExpanded ? "border-emerald-300 dark:border-emerald-700 shadow-lg" : "border-neutral-200 dark:border-neutral-700")}>
            <button onClick={() => setExpandedId(isExpanded ? null : gl.id)}
              className="w-full p-4 text-left flex items-center gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--brand-secondary) 15%, transparent)' }}>
                <Warehouse className="w-5 h-5" style={{ color: 'var(--brand-secondary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h4 className="font-bold text-sm text-neutral-900 dark:text-white">{gl.nombre}</h4>
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase", tipoColors[gl.tipo_galeron] || tipoColors['Vacía'])}>{gl.tipo_galeron}</span>
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase", estadoColors[gl.estado] || estadoColors.Activo)}>{gl.estado}</span>
                </div>
                <p className="text-[11px] text-neutral-500">{avesProduccion.toLocaleString()}/{gl.capacidad_maxima.toLocaleString()} aves · {lotesActivos} lotes</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${ocupacion}%`, background: ocupacion > 90 ? 'var(--status-danger)' : ocupacion > 70 ? 'var(--status-warning)' : 'var(--brand-primary)' }} />
                  </div>
                  <span className="text-[9px] font-bold tabular-nums" style={{ color: ocupacion > 90 ? 'var(--status-danger)' : ocupacion > 70 ? 'var(--status-warning)' : 'var(--brand-primary)' }}>{ocupacion}%</span>
                </div>
              </div>
              <div className="w-16 shrink-0 text-right">
                {eficiencia !== null && <p className={cn("text-[9px] font-bold", eficiencia >= 90 ? 'text-emerald-500' : eficiencia >= 70 ? 'text-amber-500' : 'text-red-500')}>{eficiencia}% efic.</p>}
              </div>
              <ChevronDown className={cn("w-5 h-5 text-neutral-400 transition-transform", isExpanded && "rotate-180")} />
            </button>

            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--border-default)', background: 'var(--bg-muted)' }} className="p-5 space-y-4 animate-in fade-in">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <TarjetaKpi tamanoValor="md" etiqueta="Capacidad Maxima" valor={`${gl.capacidad_maxima.toLocaleString()} aves`} tono="info" />
              <TarjetaKpi tamanoValor="md" etiqueta="Aves en Produccion" valor={String(avesProduccion)} tono="positivo" />
              <TarjetaKpi tamanoValor="md" etiqueta="Lotes Activos" valor={String(lotesActivos)} tono="alerta" />
                </div>
                {gl.notas && <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>Notas: {gl.notas}</p>}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => startEdit(gl)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                    <Edit className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button onClick={() => deleteGaleron(gl)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold" style={{ color: 'var(--status-danger)' }}>
                    <Trash2 className="w-3.5 h-3.5" /> Archivar
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {galerones.length === 0 && (
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-8 text-center">
          <Warehouse className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--brand-secondary)', opacity: 0.4 }} />
          <p className="font-bold text-neutral-500">No hay galerones</p>
        </div>
      )}

      {editingGaleron && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm" onClick={() => setEditingGaleron(null)} />
          <div className="relative bg-white dark:bg-neutral-800 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-neutral-900 dark:text-white">Editar Galerón</h3>
              <button onClick={() => setEditingGaleron(null)} className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-neutral-500 mb-1">Nombre</label>
                <input value={editForm.nombre} onChange={e => setEditForm(f => ({ ...f, nombre: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 mb-1">Capacidad (aves)</label>
                <input type="number" value={editForm.capacidad_maxima} onChange={e => setEditForm(f => ({ ...f, capacidad_maxima: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 mb-1">Aves en Producción</label>
                <input type="number" value={editForm.aves_en_produccion} onChange={e => setEditForm(f => ({ ...f, aves_en_produccion: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 mb-1">Tipo de Galerón</label>
                <select value={editForm.tipo_galeron} onChange={e => setEditForm(f => ({ ...f, tipo_galeron: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white">
                  <option>Productora</option><option>Crianza</option><option>Vacía</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 mb-1">Prod. Diaria Esperada</label>
                <input type="number" value={editForm.produccion_diaria_esperada} onChange={e => setEditForm(f => ({ ...f, produccion_diaria_esperada: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-500 mb-1">Estado</label>
                <select value={editForm.estado} onChange={e => setEditForm(f => ({ ...f, estado: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white">
                  <option>Activo</option><option>Mantenimiento</option><option>Inactivo</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-neutral-500 mb-1">Notas</label>
                <textarea value={editForm.notas} onChange={e => setEditForm(f => ({ ...f, notas: e.target.value }))} rows={2}
                  className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditingGaleron(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700">Cancelar</button>
              <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1 px-5 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>
                {saving && <Spinner tamano="xs" />} Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== PRODUCCION TAB ====================
function ProduccionTab({ granjaId, galerones }: { granjaId: string; galerones: GaleronDetalle[] }) {
  const [historial, setHistorial] = useState<any[]>([]);
  const [galeronSel, setGaleronSel] = useState('');
  const [grandes, setGrandes] = useState(0);
  const [medianos, setMedianos] = useState(0);
  const [pequenos, setPequenos] = useState(0);
  const [gallinaza, setGallinaza] = useState(0);
  const [responsable, setResponsable] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [saving, setSaving] = useState(false);
  const [fechaDesde, setFechaDesde] = useState(new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]);
  const [fechaHasta, setFechaHasta] = useState(new Date().toISOString().split('T')[0]);

  const cargarHistorial = async () => {
    const res = await fetch(`/api/produccion/historial?granjaId=${granjaId}&desde=${fechaDesde}&hasta=${fechaHasta}`);
    if (res.ok) setHistorial(await res.json());
  };

  useEffect(() => { cargarHistorial(); }, [granjaId, fechaDesde, fechaHasta]);

  const registrarRecoleccion = async () => {
    if (!galeronSel) { toast.error('Selecciona un galerón'); return; }
    if (grandes === 0 && medianos === 0 && pequenos === 0 && gallinaza === 0) { toast.error('Ingresa al menos una cantidad'); return; }
    if (!responsable.trim()) { toast.error('Ingresa el responsable'); return; }
    setSaving(true);
    try {
      const galeron = galerones.find(g => g.id === galeronSel);
      if (!galeron) return;
      const detalles = [
        { tamano: 'Grandes', cantidad: grandes },
        { tamano: 'Medianos', cantidad: medianos },
        { tamano: 'Pequeños', cantidad: pequenos },
        { tamano: 'Gallinaza', cantidad: gallinaza },
      ].filter(d => d.cantidad > 0);
      const res = await fetch('/api/produccion/recoleccion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Ya se tiene el galerón por id, así que se manda el id en vez de dejar que
        // el servidor lo busque por nombre: el nombre se repite entre granjas.
        // `granjaId` es el de la granja abierta en pantalla, no una propiedad del
        // galerón: `/api/produccion/galerones` no lo devuelve.
        body: JSON.stringify({ galeron: galeron.nombre, galeronId: galeron.id, granjaId, detalles, responsable: responsable.trim(), observaciones: observaciones.trim() })
      });
      if (res.ok) {
        toast.success('Recolección registrada');
        setGrandes(0); setMedianos(0); setPequenos(0); setGallinaza(0); setObservaciones('');
        cargarHistorial();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Error al registrar');
      }
    } catch { toast.error('Error de conexión'); }
    setSaving(false);
  };

  const totalHuevos = historial.filter(h => String(h.tipo_producto).includes('Huevos')).reduce((a, h) => a + Number(h.cantidad), 0);
  const totalGallinaza = historial.filter(h => String(h.tipo_producto).includes('Gallinaza')).reduce((a, h) => a + Number(h.cantidad), 0);

  // Group by date for chart
  const byDate: Record<string, number> = {};
  historial.filter(h => String(h.tipo_producto).includes('Huevos')).forEach(h => {
    const d = String(h.fecha).split('T')[0];
    byDate[d] = (byDate[d] || 0) + Number(h.cantidad);
  });
  const chartData = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
  const maxChart = Math.max(...chartData.map(d => d[1]), 1);

  return (
    <div className="space-y-6">
      {/* Recolection Form */}
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl" style={{ background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)' }}>
            <Egg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
          </div>
          <div>
            <h3 className="font-bold text-neutral-900 dark:text-white">Registrar Recolección del Día</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Captura la producción de cada galerón al finalizar la jornada</p>
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold text-neutral-500 mb-1">Galerón *</label>
          <select value={galeronSel} onChange={e => setGaleronSel(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white">
            <option value="">Seleccionar galerón...</option>
            {galerones.filter(g => g.estado === 'Producción').map(g => (
              <option key={g.id} value={g.id}>{g.nombre} ({(g.aves_en_produccion || 0)} aves)</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Grandes', value: grandes, set: setGrandes, icon: '🥚' },
            { label: 'Medianos', value: medianos, set: setMedianos, icon: '🫧' },
            { label: 'Pequeños', value: pequenos, set: setPequenos, icon: '•' },
            { label: 'Gallinaza (sacos)', value: gallinaza, set: setGallinaza, icon: '📦' },
          ].map(item => (
            <div key={item.label}>
              <label className="block text-xs font-bold text-neutral-500 mb-1">{item.label}</label>
              <input type="number" value={item.value || ''} onChange={e => item.set(Number(e.target.value) || 0)}
                placeholder="0" min="0"
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white text-center font-bold text-lg" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-neutral-500 mb-1">Responsable *</label>
            <input value={responsable} onChange={e => setResponsable(e.target.value)}
              placeholder="Nombre del responsable de recolección"
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-bold text-neutral-500 mb-1">Observaciones</label>
            <input value={observaciones} onChange={e => setObservaciones(e.target.value)}
              placeholder="Notas adicionales (opcional)"
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
          </div>
        </div>
        <button onClick={registrarRecoleccion} disabled={saving}
          className="w-full py-3 rounded-xl text-white text-sm font-bold shadow-lg disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))' }}>
          {saving ? <Spinner className="inline mr-2" /> : null}
          {saving ? 'Registrando...' : 'Registrar Recolección'}
        </button>
      </div>

      {/* Daily Production Chart */}
      {chartData.length > 0 && (
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
          <h3 className="font-bold text-neutral-900 dark:text-white mb-4">Producción Diaria (cartones)</h3>
          <div className="flex items-end gap-1.5 h-32">
            {chartData.map(([fecha, cantidad], i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <span className="text-[9px] font-bold text-neutral-500 dark:text-neutral-400">{cantidad}</span>
                <div className="w-full rounded-t-md transition-all" style={{
                  height: `${Math.max((cantidad / maxChart) * 100, 4)}%`,
                  background: 'linear-gradient(to top, var(--brand-primary), var(--brand-primary-light))'
                }} />
                <span className="text-[8px] font-bold text-neutral-400 truncate w-full text-center">{fecha.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historial */}
      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="font-bold text-neutral-900 dark:text-white">Historial de Producción</h3>
          <div className="flex items-center gap-2">
            <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-xs text-neutral-900 dark:text-white" />
            <span className="text-neutral-400">-</span>
            <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-xs text-neutral-900 dark:text-white" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <p className="text-lg font-black text-emerald-600 dark:text-emerald-400">{totalHuevos.toLocaleString()}</p>
            <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase">Huevos (cartones)</p>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-lg font-black text-amber-600 dark:text-amber-400">{totalGallinaza.toLocaleString()}</p>
            <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase">Gallinaza (sacos)</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-700">
                <th className="text-left py-2 px-3 text-xs font-bold text-neutral-500 uppercase">Fecha</th>
                <th className="text-left py-2 px-3 text-xs font-bold text-neutral-500 uppercase">Producto</th>
                <th className="text-right py-2 px-3 text-xs font-bold text-neutral-500 uppercase">Cantidad</th>
                <th className="text-left py-2 px-3 text-xs font-bold text-neutral-500 uppercase">Unidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {historial.slice(-20).reverse().map((h, i) => (
                <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                  <td className="py-2 px-3 text-neutral-600 dark:text-neutral-400">{String(h.fecha).split('T')[0]}</td>
                  <td className="py-2 px-3 font-medium text-neutral-900 dark:text-white">{h.tipo_producto}</td>
                  <td className="py-2 px-3 text-right font-bold text-neutral-900 dark:text-white">{Number(h.cantidad).toLocaleString()}</td>
                  <td className="py-2 px-3 text-neutral-500">{h.unidad}</td>
                </tr>
              ))}
              {historial.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-neutral-400">Sin registros en este período</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==================== MANTENIMIENTOS TAB ====================
function MantenimientosTab({ galerones, granjaId, onRefresh }: { galerones: GaleronDetalle[]; granjaId: string; onRefresh: () => void }) {
  const [galeronSel, setGaleronSel] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tipo: 'Preventivo', fecha: new Date().toISOString().split('T')[0], descripcion: '' });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!galeronSel) { toast.error('Selecciona un galerón'); return; }
    if (!form.descripcion.trim()) { toast.error('Ingresa la descripción'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/mantenimientos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ galeronId: galeronSel, fecha: form.fecha, tipo: form.tipo, descripcion: form.descripcion, estado: 'Pendiente' })
      });
      if (res.ok) {
        toast.success('Mantenimiento registrado'); setShowForm(false);
        setForm({ tipo: 'Preventivo', fecha: new Date().toISOString().split('T')[0], descripcion: '' });
        onRefresh();
      } else toast.error('Error al registrar');
    } catch { toast.error('Error de conexión'); }
    setSaving(false);
  };

  const completarMant = async (id: string) => {
    try {
      const res = await fetch(`/api/mantenimientos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: 'Completado' }) });
      if (res.ok) { toast.success('Mantenimiento completado'); onRefresh(); }
    } catch { toast.error('Error'); }
  };

  const allMant = galerones.flatMap(g => g.mantenimientos.map(m => ({ ...m, galeronNombre: g.nombre }))).sort((a, b) => String(b.fecha_programada).localeCompare(String(a.fecha_programada)));
  const pendientes = allMant.filter(m => m.estado === 'Pendiente');
  const completados = allMant.filter(m => m.estado === 'Completado');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-neutral-900 dark:text-white text-sm">Historial de Mantenimientos</h3>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold" style={{ color: 'var(--brand-primary)', background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)' }}>
          <Plus className="w-3.5 h-3.5" /> Nuevo Mantenimiento
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5 space-y-3 animate-in fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Galerón *</label>
              <select value={galeronSel} onChange={e => setGaleronSel(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white">
                <option value="">Seleccionar...</option>
                {galerones.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white">
                <option>Preventivo</option><option>Correctivo</option><option>Inspección</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Fecha</label>
              <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-neutral-500 mb-1">Descripción *</label>
              <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} rows={2} placeholder="Trabajo a realizar..." className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700">Cancelar</button>
            <button onClick={handleCreate} disabled={saving} className="flex items-center gap-1 px-5 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>
              {saving && <Spinner tamano="xs" />} Registrar
            </button>
          </div>
        </div>
      )}

      {pendientes.length > 0 && (
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-amber-50 dark:bg-amber-900/10">
            <h4 className="font-bold text-amber-700 dark:text-amber-400 text-sm">Pendientes ({pendientes.length})</h4>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {pendientes.map(m => (
              <div key={m.id} className="px-5 py-3 flex items-center gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                <Wrench className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
<p className="text-sm font-bold text-neutral-900 dark:text-white">{m.tipo}</p>
                  <p className="text-[11px] text-neutral-500">{m.galeronNombre} · {m.tipo} · {m.fecha_programada}</p>
                </div>
                <button onClick={() => completarMant(m.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-200">
                  <Check className="w-3.5 h-3.5" /> Completar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
          <h4 className="font-bold text-neutral-900 dark:text-white text-sm">Historial ({completados.length} completados)</h4>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
          {completados.map(m => (
            <div key={m.id} className="px-5 py-3 flex items-center gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-neutral-900 dark:text-white">{m.tipo}</p>
                <p className="text-[11px] text-neutral-500">{m.galeronNombre} · {m.fecha_programada}</p>
              </div>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Completado</span>
            </div>
          ))}
          {completados.length === 0 && pendientes.length === 0 && (
            <div className="py-8 text-center text-neutral-400 text-sm">No hay mantenimientos registrados</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== LOTES TAB ====================
function LotesTab({ galerones, onRefresh }: { galerones: GaleronDetalle[]; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ galeronId: '', fecha_ingreso: new Date().toISOString().split('T')[0], cantidad_inicial: '', linea_genetica: '', estado: 'Activo' });
  const [saving, setSaving] = useState(false);

  const allLotes = galerones.flatMap(g => g.lotes.map(l => ({ ...l, galeronNombre: g.nombre })));

  const handleCreate = async () => {
    if (!form.galeronId || !form.cantidad_inicial || !form.linea_genetica) { toast.error('Completa los campos requeridos'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/lotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, cantidad_inicial: Number(form.cantidad_inicial) })
      });
      if (res.ok) { toast.success('Lote creado'); setShowForm(false); setForm({ galeronId: '', fecha_ingreso: new Date().toISOString().split('T')[0], cantidad_inicial: '', linea_genetica: '', estado: 'Activo' }); onRefresh(); }
      else toast.error('Error al crear lote');
    } catch { toast.error('Error de conexión'); }
    setSaving(false);
  };

  const finalizarLote = async (id: string) => {
    try {
      const res = await fetch(`/api/lotes/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Lote finalizado'); onRefresh(); }
    } catch { toast.error('Error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-neutral-900 dark:text-white">Lotes de Aves</h3>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold"
          style={{ color: 'var(--brand-primary)', background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)' }}>
          <Plus className="w-3.5 h-3.5" /> Nuevo Lote
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-5 space-y-3 animate-in fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Galerón *</label>
              <select value={form.galeronId} onChange={e => setForm(f => ({ ...f, galeronId: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white">
                <option value="">Seleccionar...</option>
                {galerones.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Fecha de Ingreso *</label>
              <input type="date" value={form.fecha_ingreso} onChange={e => setForm(f => ({ ...f, fecha_ingreso: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Cantidad de Aves *</label>
              <input type="number" value={form.cantidad_inicial} onChange={e => setForm(f => ({ ...f, cantidad_inicial: e.target.value }))}
                placeholder="Ej: 5000" className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1">Línea Genética *</label>
              <input value={form.linea_genetica} onChange={e => setForm(f => ({ ...f, linea_genetica: e.target.value }))}
                placeholder="Ej: Hy-Line W36, Lohmann Brown" className="w-full px-3 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-sm text-neutral-900 dark:text-white" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700">Cancelar</button>
            <button onClick={handleCreate} disabled={saving}
              className="flex items-center gap-1 px-5 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50"
              style={{ background: 'var(--brand-primary)' }}>
              {saving && <Spinner tamano="xs" />} Crear Lote
            </button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="divide-y divide-neutral-100 dark:divide-neutral-700">
          {allLotes.map(l => (
            <div key={l.id} className="px-5 py-4 flex items-center gap-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
              <div className={cn("w-3 h-3 rounded-full shrink-0", l.estado === 'Activo' ? "bg-emerald-500" : "bg-neutral-400")} />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-neutral-900 dark:text-white">{l.linea_genetica}</p>
                <p className="text-xs text-neutral-500">{l.galeronNombre} · {l.cantidad_inicial.toLocaleString()} aves · Ingreso: {l.fecha_ingreso}</p>
              </div>
              <span className={cn("text-[10px] font-bold px-2.5 py-1 rounded-full uppercase",
                l.estado === 'Activo' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-neutral-100 text-neutral-500")}>
                {l.estado}
              </span>
              {l.estado === 'Activo' && (
                <button onClick={() => finalizarLote(l.id)}
                  className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 text-xs font-bold">
                  Finalizar
                </button>
              )}
            </div>
          ))}
          {allLotes.length === 0 && (
            <div className="py-8 text-center text-neutral-400 text-sm">No hay lotes registrados</div>
          )}
        </div>
      </div>
    </div>
  );
}
