import React, { useState, useEffect } from 'react';
import { AlertTriangle, Check, ChevronRight, ChevronLeft, Wrench, Egg, ClipboardList, Plus } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { BloqueCarga, Spinner } from './Spinner';
import { sessionHeaders } from '../lib/session';

type Granja = { id: string; nombre: string; ubicacion?: string; estado?: string };
type Galeron = { id: string; granjaId: string; nombre: string; estado?: string };
type Incidente = {
  id: string;
  granjaId: string | null;
  granjaNombre?: string | null;
  galeronId: string | null;
  galeronNombre?: string | null;
  categoria: string;
  severidad: string;
  descripcion: string;
  cantidadAfectada?: number | null;
  causaProbable?: string | null;
  equipoAfectado?: string | null;
  accionTomada?: string | null;
  estado: string;
  reportadoPorNombre?: string | null;
  fecha: string;
};

interface Props { currentUser: User; onBack?: () => void; }

const CATEGORIAS = ['Mortalidad', 'Enfermedad', 'Fiebre / Baja postura', 'Problema de alimentación', 'Problema de iluminación', 'Temperatura / Clima', 'Fuga de agua', 'Falla de equipo', 'Daño en instalaciones', 'Avispa / Plaga / Predador', 'Otro'];
const SEVERIDADES = ['Alta', 'Media', 'Baja'];
const EQUIPOS = ['Bebedero', 'Comedero', 'Sistema de ventilación', 'Calefacción', 'Iluminación', 'Banda transportadora', 'Otro equipo'];

const SEVERIDAD_COLOR: Record<string, string> = { Alta: '#dc2626', Media: '#d97706', Baja: '#16a34a' };
const ESTADO_LABEL: Record<string, string> = { Reportado: 'Reportado', EnRevision: 'En revisión', Resuelto: 'Resuelto', Descartado: 'Descartado' };

function IncStepper({ n }: { n: number }) {
  return (
    <div className="flex justify-center gap-2 mb-6">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} className="h-2 rounded-full transition-all duration-300"
          style={{
            width: i <= n ? 28 : 12,
            background: i <= n ? 'var(--brand-primary)' : 'var(--border-default)'
          }} />
      ))}
    </div>
  );
}

export default function IncidentesMovil({ currentUser, onBack }: Props) {
  const [screen, setScreen] = useState<'inicio' | 'form' | 'resumen' | 'exito'>('inicio');
  const [formStep, setFormStep] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [granjas, setGranjas] = useState<Granja[]>([]);
  const [galerones, setGalerones] = useState<Galeron[]>([]);
  const [incidentes, setIncidentes] = useState<Incidente[]>([]);
  const [granjaSel, setGranjaSel] = useState<Granja | null>(null);
  const [galeronSel, setGaleronSel] = useState<Galeron | null>(null);
  const [categoria, setCategoria] = useState('');
  const [severidad, setSeveridad] = useState('Media');
  const [descripcion, setDescripcion] = useState('');
  const [cantidad, setCantidad] = useState('0');
  const [causaProbable, setCausaProbable] = useState('');
  const [equipoAfectado, setEquipoAfectado] = useState('');
  const [requiereMantenimiento, setRequiereMantenimiento] = useState(false);
  const [accionTomada, setAccionTomada] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadIncidentes = async () => {
    try {
      const res = await fetch('/api/incidentes', { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setIncidentes(await res.json());
    } catch { /* silencioso */ }
  };

  useEffect(() => {
    (async () => {
      try {
        const headers = sessionHeaders(currentUser.id);
        const [rG, rGal] = await Promise.all([
          fetch('/api/granjas', { headers }),
          fetch('/api/galerones', { headers }),
        ]);
        if (rG.ok) {
          const data = await rG.json();
          setGranjas(data.filter((g: Granja) => g.estado !== 'Archivado'));
        }
        if (rGal.ok) {
          const data = await rGal.json();
          setGalerones(data.filter((g: Galeron) => g.estado !== 'Archivado'));
        }
        await loadIncidentes();
      } catch { toast.error('Error cargando datos'); }
      setLoading(false);
    })();
  }, [currentUser.id]);

  const galeronesGranja = galerones.filter(g => g.granjaId === granjaSel?.id);

  const cantidadRequerida = categoria === 'Mortalidad' || categoria === 'Enfermedad';
  const muestraCausa = categoria === 'Mortalidad' || categoria === 'Enfermedad';
  const muestraEquipo = categoria === 'Falla de equipo';

  const fecha = new Date();
  const fechaCorta = fecha.toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' });

  const iniciarReporte = () => {
    setGranjaSel(null);
    setGaleronSel(null);
    setCategoria('');
    setSeveridad('Media');
    setDescripcion('');
    setCantidad('0');
    setCausaProbable('');
    setEquipoAfectado('');
    setRequiereMantenimiento(false);
    setAccionTomada('');
    setFormStep(0);
    setScreen('form');
  };

  const puedeContinuar = descripcion.trim().length >= 10 && (!cantidadRequerida || Number(cantidad) >= 1);
  const descOk = descripcion.trim().length >= 10;
  const cantOk = !cantidadRequerida || Number(cantidad) >= 1;

  const handleEnviar = async () => {
    if (!granjaSel || !puedeContinuar) return;
    setSubmitting(true);
    try {
      const accionFinal = requiereMantenimiento
        ? `[Requiere mantenimiento urgente] ${accionTomada}`.trim()
        : accionTomada.trim() || null;
      const res = await fetch('/api/incidentes', {
        method: 'POST',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({
          granjaId: granjaSel.id,
          galeronId: galeronSel?.id || null,
          categoria,
          severidad,
          descripcion: descripcion.trim(),
          cantidadAfectada: cantidadRequerida ? Number(cantidad) : null,
          causaProbable: muestraCausa && causaProbable.trim() ? causaProbable.trim() : null,
          equipoAfectado: muestraEquipo ? equipoAfectado : null,
          accionTomada: accionFinal,
          reportadoPorId: currentUser.id,
          reportadoPorNombre: currentUser.name,
        }),
      });
      if (res.ok) {
        setScreen('exito');
        await loadIncidentes();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'No se pudo reportar el incidente');
      }
    } catch { toast.error('Error de conexión al reportar'); }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <BloqueCarga className="min-h-[60vh]" />
    );
  }

  // ============ PANTALLA PRINCIPAL ============
  if (screen === 'inicio') {
    return (
      <div className="min-h-[70vh] px-4 pt-6 pb-24 animate-in fade-in">
        {onBack && <button type="button" onClick={onBack} className="mb-4 inline-flex min-h-11 items-center gap-2 px-1 text-base font-bold" style={{ color: 'var(--brand-primary)' }}><ChevronLeft className="h-5 w-5" />Volver a opciones</button>}
        <div className="rounded-2xl p-5 mb-6 text-center"
          style={{ background: 'var(--brand-primary-soft)', border: '1px solid color-mix(in srgb, var(--brand-primary) 20%, transparent)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            Incidentes de galerón
          </h1>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            Reporta mortalidad, fallas de equipo u otras anomalías · {fechaCorta}
          </p>
          <button onClick={iniciarReporte}
            className="w-full py-4 rounded-2xl text-base font-black flex items-center justify-center gap-2 transition-all active:scale-[0.97]"
            style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)', boxShadow: '0 8px 24px color-mix(in srgb, var(--brand-primary) 35%, transparent)' }}>
            <Plus className="w-5 h-5" /> Reportar incidente
          </button>
        </div>

        <h2 className="text-sm font-black uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
          Historial
        </h2>
        {incidentes.length === 0 ? (
          <div className="rounded-2xl p-10 text-center"
            style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-default)' }}>
            <ClipboardList className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sin incidentes registrados</p>
          </div>
        ) : (
          <div className="space-y-3">
            {incidentes.map(inc => (
              <div key={inc.id} className="p-4 rounded-2xl"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold px-2 py-1 rounded-full"
                      style={{ background: `${SEVERIDAD_COLOR[inc.severidad] || '#6b7280'}18`, color: SEVERIDAD_COLOR[inc.severidad] || '#6b7280' }}>
                      {inc.severidad}
                    </span>
                    <span className="text-xs font-bold px-2 py-1 rounded-full"
                      style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)' }}>
                      {inc.categoria}
                    </span>
                    <span className="text-xs px-2 py-1 rounded-full"
                      style={{ background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)', color: 'var(--brand-primary)' }}>
                      {ESTADO_LABEL[inc.estado] || inc.estado}
                    </span>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {new Date(inc.fecha).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <p className="font-bold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
                  {inc.granjaNombre || 'Granja'} {inc.galeronNombre ? `· ${inc.galeronNombre}` : ''}
                </p>
                <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{inc.descripcion}</p>
                {inc.cantidadAfectada ? (
                  <p className="text-xs font-semibold mb-1" style={{ color: '#dc2626' }}>
                    Aves afectadas: {inc.cantidadAfectada}
                  </p>
                ) : null}
                {inc.accionTomada ? (
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    Acción: {inc.accionTomada}
                  </p>
                ) : null}
                {inc.reportadoPorNombre && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {inc.reportadoPorNombre} · {new Date(inc.fecha).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ============ FORMULARIO ============
  if (screen === 'form') {
    // Paso 0: Granja
    if (formStep === 0) {
      return (
        <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
          <button onClick={() => setScreen('inicio')} className="flex items-center gap-1 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Volver
          </button>
          <IncStepper n={0} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            ¿En qué granja ocurrió?
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            Toca la granja donde está el incidente
          </p>
          <div className="space-y-3">
            {granjas.map(g => (
              <button key={g.id} onClick={() => { setGranjaSel(g); setFormStep(1); }}
                className="w-full text-left p-5 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.97]"
                style={{ background: 'var(--bg-card)', border: '2px solid var(--border-default)' }}>
                <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
                  <Egg className="w-7 h-7" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{g.nombre}</p>
                  {g.ubicacion && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{g.ubicacion}</p>}
                </div>
                <ChevronRight className="w-6 h-6 shrink-0" style={{ color: 'var(--brand-primary)' }} />
              </button>
            ))}
            {granjas.length === 0 && (
              <p className="text-center py-12" style={{ color: 'var(--text-muted)' }}>No hay granjas disponibles</p>
            )}
          </div>
        </div>
      );
    }

    // Paso 1: Galerón
    if (formStep === 1) {
      return (
        <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
          <button onClick={() => setFormStep(0)} className="flex items-center gap-1 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Cambiar granja
          </button>
          <IncStepper n={1} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            ¿En qué galpón?
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            Granja: <strong style={{ color: 'var(--text-primary)' }}>{granjaSel?.nombre}</strong>
          </p>
          <div className="space-y-3">
            {galeronesGranja.map(g => (
              <button key={g.id} onClick={() => { setGaleronSel(g); setFormStep(2); }}
                className="w-full text-left p-5 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.97]"
                style={{ background: 'var(--bg-card)', border: '2px solid var(--border-default)' }}>
                <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
                  <Egg className="w-7 h-7" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{g.nombre}</p>
                </div>
                <ChevronRight className="w-6 h-6 shrink-0" style={{ color: 'var(--brand-primary)' }} />
              </button>
            ))}
            {galeronesGranja.length === 0 && (
              <p className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                No hay galpones activos en esta granja
              </p>
            )}
          </div>
        </div>
      );
    }

    // Paso 2: Categoría
    if (formStep === 2) {
      return (
        <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
          <button onClick={() => setFormStep(1)} className="flex items-center gap-1 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Cambiar galpón
          </button>
          <IncStepper n={2} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            ¿Qué tipo de incidente?
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            {granjaSel?.nombre}{galeronSel ? ` · ${galeronSel.nombre}` : ''}
          </p>
          <div className="grid grid-cols-1 gap-3">
            {CATEGORIAS.map(cat => (
              <button key={cat} onClick={() => { setCategoria(cat); setFormStep(3); }}
                className="w-full text-left px-5 py-4 rounded-2xl flex items-center gap-3 transition-all active:scale-[0.97]"
                style={{ background: 'var(--bg-card)', border: categoria === cat ? '2px solid var(--brand-primary)' : '2px solid var(--border-default)' }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{cat}</span>
                <ChevronRight className="w-5 h-5 ml-auto shrink-0" style={{ color: 'var(--brand-primary)' }} />
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Paso 3: Severidad
    if (formStep === 3) {
      return (
        <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
          <button onClick={() => setFormStep(2)} className="flex items-center gap-1 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Cambiar categoría
          </button>
          <IncStepper n={3} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            ¿Qué tan grave es?
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            {categoria}
          </p>
          <div className="space-y-3">
            {SEVERIDADES.map(s => (
              <button key={s} onClick={() => { setSeveridad(s); setFormStep(4); }}
                className="w-full text-left p-5 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.97]"
                style={{ background: 'var(--bg-card)', border: severidad === s ? `2px solid ${SEVERIDAD_COLOR[s]}` : '2px solid var(--border-default)' }}>
                <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `${SEVERIDAD_COLOR[s]}18`, color: SEVERIDAD_COLOR[s] }}>
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{s}</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {s === 'Alta' ? 'Atención inmediata requerida' : s === 'Media' ? 'Requiere seguimiento' : 'Menor, puede esperar'}
                  </p>
                </div>
                <ChevronRight className="w-6 h-6 shrink-0" style={{ color: 'var(--brand-primary)' }} />
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Paso 4: Detalles
    if (formStep === 4) {
      return (
        <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
          <button onClick={() => setFormStep(3)} className="flex items-center gap-1 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Cambiar severidad
          </button>
          <IncStepper n={4} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            Detalles del incidente
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            {categoria} · Severidad {severidad.toLowerCase()}
          </p>
          <div className="space-y-4">
            {cantidadRequerida && (
              <div>
                <label className="text-sm font-bold mb-2 block" style={{ color: 'var(--text-primary)' }}>
                  {categoria === 'Mortalidad' ? '¿Cuántas aves murieron?' : '¿Cuántas aves están afectadas?'} *
                </label>
                <div className="flex items-center gap-3">
                  <button onClick={() => setCantidad(String(Math.max(0, Number(cantidad) - 1)))}
                    className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90"
                    style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>−</button>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={cantidad}
                    onChange={e => { const raw = e.target.value.replace(/[^0-9]/g, ''); setCantidad(raw === '' ? '0' : raw); }}
                    className="w-16 text-center text-2xl font-black tabular-nums outline-none rounded-lg flex-1 max-w-[7rem]"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: cantOk ? '1px solid var(--border-default)' : '1px solid #dc2626', padding: '6px 0' }} />
                  <button onClick={() => setCantidad(String(Number(cantidad) + 1))}
                    className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90"
                    style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>+</button>
                </div>
                {!cantOk && <p className="text-xs mt-1" style={{ color: '#dc2626' }}>Indica al menos 1 ave</p>}
              </div>
            )}

            {muestraCausa && (
              <div>
                <label className="text-sm font-bold mb-2 block" style={{ color: 'var(--text-primary)' }}>
                  Causa probable (opcional)
                </label>
                <input type="text" value={causaProbable}
                  onChange={e => setCausaProbable(e.target.value)}
                  placeholder={`p. ej. ${categoria === 'Mortalidad' ? 'Posible intoxicación en el alimento' : 'Sospecha de infección respiratoria'}`}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }} />
              </div>
            )}

            {muestraEquipo && (
              <div>
                <label className="text-sm font-bold mb-2 block" style={{ color: 'var(--text-primary)' }}>
                  ¿Qué equipo falló? *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {EQUIPOS.map(eq => (
                    <button key={eq} onClick={() => setEquipoAfectado(eq)}
                      className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.97]"
                      style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: equipoAfectado === eq ? '2px solid var(--brand-primary)' : '2px solid var(--border-default)' }}>
                      <Wrench className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-primary)' }} />{eq}
                    </button>
                  ))}
                </div>
                <button onClick={() => setRequiereMantenimiento(v => !v)}
                  className="w-full mt-3 flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Requiere mantenimiento urgente
                  </span>
                  <span className="w-10 h-6 rounded-full transition-colors relative"
                    style={{ background: requiereMantenimiento ? '#dc2626' : 'var(--border-default)' }}>
                    <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                      style={{ left: requiereMantenimiento ? 18 : 2 }} />
                  </span>
                </button>
              </div>
            )}

            <div>
              <label className="text-sm font-bold mb-2 block" style={{ color: 'var(--text-primary)' }}>
                Describe lo sucedido *
              </label>
              <textarea value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                placeholder="Detalla qué pasó, desde cuándo, cuántas aves se ven afectadas..."
                rows={4}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: descOk ? '1px solid var(--border-default)' : '1px solid #dc2626' }} />
              <p className={`text-xs mt-1 ${descOk ? '' : ''}`} style={{ color: descOk ? 'var(--text-muted)' : '#dc2626' }}>
                {descOk ? `${descripcion.trim().length} caracteres` : 'Describe con al menos 10 caracteres'}
              </p>
            </div>

            <div>
              <label className="text-sm font-bold mb-2 block" style={{ color: 'var(--text-primary)' }}>
                Acción tomada (opcional)
              </label>
              <textarea value={accionTomada}
                onChange={e => setAccionTomada(e.target.value)}
                placeholder="p. ej. Separé las aves afectadas, ajusté la ventilación..."
                rows={2}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }} />
            </div>
          </div>
          <button onClick={() => setFormStep(5)}
            disabled={!puedeContinuar}
            className="w-full mt-8 py-5 rounded-2xl text-lg font-black transition-all active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
            style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>
            Continuar
          </button>
        </div>
      );
    }

    // Paso 5: Revisión
    if (formStep === 5) {
      return (
        <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
          <button onClick={() => setFormStep(4)} className="flex items-center gap-1 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Editar detalles
          </button>
          <IncStepper n={5} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            Confirma el reporte
          </h2>
          <div className="rounded-2xl p-5 space-y-3 mb-8"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Granja: <strong style={{ color: 'var(--text-primary)' }}>{granjaSel?.nombre}</strong></p>
            {galeronSel && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Galpón: <strong style={{ color: 'var(--text-primary)' }}>{galeronSel.nombre}</strong></p>}
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Tipo: <strong style={{ color: 'var(--text-primary)' }}>{categoria}</strong></p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Severidad: <strong style={{ color: SEVERIDAD_COLOR[severidad] }}>{severidad}</strong></p>
            {cantidadRequerida && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aves afectadas: <strong style={{ color: '#dc2626' }}>{cantidad}</strong></p>}
            {muestraEquipo && equipoAfectado && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Equipo: <strong style={{ color: 'var(--text-primary)' }}>{equipoAfectado}</strong></p>}
            {requiereMantenimiento && <p className="text-sm font-bold" style={{ color: '#dc2626' }}>Requiere mantenimiento urgente</p>}
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Descripción: <strong style={{ color: 'var(--text-primary)' }}>{descripcion.trim()}</strong></p>
            {causaProbable && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Causa probable: <strong style={{ color: 'var(--text-primary)' }}>{causaProbable}</strong></p>}
          </div>
          <button onClick={handleEnviar} disabled={submitting}
            className="w-full py-5 rounded-2xl text-lg font-black flex items-center justify-center gap-2 transition-all active:scale-[0.97] disabled:opacity-60"
            style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>
            {submitting ? <Spinner /> : <Check className="w-5 h-5" />}
            {submitting ? 'Enviando...' : 'Reportar incidente'}
          </button>
        </div>
      );
    }
  }

  // ============ ÉXITO ============
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 text-center animate-in fade-in">
      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
        style={{ background: 'color-mix(in srgb, #16a34a 15%, transparent)', color: '#16a34a' }}>
        <Check className="w-10 h-10" />
      </div>
      <h1 className="text-2xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
        Incidente reportado
      </h1>
      <p className="text-sm mb-10" style={{ color: 'var(--text-muted)' }}>
        El {categoria.toLowerCase()} quedó registrado como <strong style={{ color: 'var(--text-primary)' }}>Reportado</strong>
      </p>
      <button onClick={() => setScreen('inicio')}
        className="w-full max-w-sm py-5 rounded-2xl text-lg font-black transition-all active:scale-[0.97]"
        style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>
        Volver al inicio
      </button>
    </div>
  );
}
