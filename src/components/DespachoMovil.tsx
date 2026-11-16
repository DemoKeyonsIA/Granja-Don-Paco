import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Egg, Check, ChevronRight, ChevronLeft, Plus, Minus, Truck } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { BloqueCarga, SpinnerConTexto } from './Spinner';
import AccionFijaMovil from './AccionFijaMovil';
import { sessionHeaders } from '../lib/session';

type Granja = { id: string; nombre: string; ubicacion?: string; estado?: string };
type Galeron = { id: string; granjaId: string; nombre: string; estado?: string };
type Camion = { id: string; nombre: string; placa?: string | null; camioneroId?: string | null; camioneroNombre?: string | null; estado?: string | null };

interface Props { currentUser: User; }

function Stepper({ n }: { n: number }) {
  return (
    <div className="flex justify-center gap-2 mb-6" role="progressbar" aria-label={`Paso ${n + 1} de 4`} aria-valuemin={1} aria-valuemax={4} aria-valuenow={n + 1}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="h-2 rounded-full transition-all duration-300"
          style={{
            width: i <= n ? 36 : 14,
            background: i <= n ? 'var(--brand-primary)' : 'var(--border-default)'
          }} />
      ))}
    </div>
  );
}

function StepperRow({ emoji, label, value, onChange, increment = 1 }: { emoji: string; label: string; value: string; onChange: (s: string) => void; increment?: number }) {
  const num = Number(value) || 0;
  return (
    <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
      <span className="font-bold text-base flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <span className="text-xl">{emoji}</span>{label}
      </span>
      <div className="flex items-center gap-3">
        <button onClick={() => onChange(String(Math.max(0, Number((num - increment).toFixed(2)))))}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}
          aria-label={`Restar ${label}`}>
          <Minus className="w-5 h-5" />
        </button>
        <input type="text" inputMode="decimal" value={value}
          onChange={e => {
            const raw = e.target.value.replace(',', '.');
            if (/^\d*(\.\d{0,2})?$/.test(raw)) onChange(raw === '' ? '0' : raw);
          }}
          className="w-16 text-center text-2xl font-black tabular-nums outline-none rounded-lg"
          style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', padding: '4px 0' }}
          aria-label={`Cantidad ${label}`} />
        <button onClick={() => onChange(String(Number((num + increment).toFixed(2))))}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}
          aria-label={`Sumar ${label}`}>
          <Plus className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

export default function DespachoMovil({ currentUser }: Props) {
  // Pantalla: 'inicio' (botón registrar), 'form' (granja→galerón→cantidades), 'resumen', 'exito'
  const [screen, setScreen] = useState<'inicio' | 'form' | 'resumen' | 'exito'>('inicio');
  const [formStep, setFormStep] = useState<0 | 1 | 2 | 3>(0); // 0=granja, 1=galeron, 2=cantidades, 3=camion
  const [granjas, setGranjas] = useState<Granja[]>([]);
  const [galerones, setGalerones] = useState<Galeron[]>([]);
  const [camiones, setCamiones] = useState<Camion[]>([]);
  const [granjaSel, setGranjaSel] = useState<Granja | null>(null);
  const [galeronSel, setGaleronSel] = useState<Galeron | null>(null);
  const [camionSel, setCamionSel] = useState<Camion | null>(null);
  const [vehiculo, setVehiculo] = useState('');
  const [grandes, setGrandes] = useState('0');
  const [medianos, setMedianos] = useState('0');
  const [gallinaza, setGallinaza] = useState('0');
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const cargaIdRef = useRef<string | null>(null);

  const cargarCatalogos = useCallback(async () => {
    setLoading(true);
    setErrorCarga('');
    try {
      const headers = sessionHeaders(currentUser.id);
      const [rG, rGal, rC] = await Promise.all([
        fetch('/api/granjas', { headers }),
        fetch('/api/galerones', { headers }),
        fetch('/api/camiones', { headers }),
      ]);
      if (!rG.ok || !rGal.ok || !rC.ok) {
        const fallidos = [
          ['granjas', rG],
          ['galerones', rGal],
          ['camiones', rC],
        ].filter(([, response]) => !(response as Response).ok)
          .map(([recurso, response]) => `${recurso} (${(response as Response).status})`);
        throw new Error(`No se pudieron cargar ${fallidos.join(', ')}. Revisa la conexión e inténtalo de nuevo.`);
      }
      const [granjasData, galeronesData, camionesData] = await Promise.all([rG.json(), rGal.json(), rC.json()]);
      if (!Array.isArray(granjasData) || !Array.isArray(galeronesData) || !Array.isArray(camionesData)) {
        throw new Error('La respuesta del servidor está incompleta. Vuelve a cargar los datos.');
      }
      setGranjas(granjasData.filter((g: Granja) => g.estado !== 'Archivado'));
      setGalerones(galeronesData.filter((g: Galeron) => g.estado !== 'Archivado'));
      setCamiones(camionesData.filter((c: Camion) => c.estado !== 'Inactivo'));
    } catch (error) {
      setErrorCarga(error instanceof Error ? error.message : 'No se pudieron cargar los datos. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => { void cargarCatalogos(); }, [cargarCatalogos]);

  const galeronesGranja = galerones.filter(g => g.granjaId === granjaSel?.id);

  const totalHuevosKg = [grandes, medianos].reduce((suma, cantidad) => suma + (Number.isFinite(Number(cantidad)) ? Number(cantidad) : 0), 0);
  const total = totalHuevosKg + (Number.isFinite(Number(gallinaza)) ? Number(gallinaza) : 0);
  const fecha = new Date();
  const hora = fecha.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
  const fechaCorta = fecha.toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' });

  const iniciarRegistro = () => {
    cargaIdRef.current = crypto.randomUUID();
    setGranjaSel(null);
    setGaleronSel(null);
    setCamionSel(null);
    setGrandes('0');
    setMedianos('0');
    setGallinaza('0');
    setVehiculo('');
    setFormStep(0);
    setScreen('form');
  };

  const handleConfirmar = async () => {
    if (!galeronSel || !granjaSel || total === 0) return;
    const cargaId = cargaIdRef.current || crypto.randomUUID();
    cargaIdRef.current = cargaId;
    setSubmitting(true);
    try {
      // 1. Registrar recolección (galerón → inventario Granja)
      const resRec = await fetch('/api/produccion/recoleccion', {
        method: 'POST',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({
          // El id va además del nombre porque el nombre no es único: dos granjas
          // pueden tener un "Galerón Central" cada una, y el servidor resolvía por
          // nombre, así que la segunda granja producía en el galerón de la primera.
          galeron: galeronSel.nombre,
          galeronId: galeronSel.id,
          granjaId: granjaSel.id,
          cargaId,
          detalles: [
            { tamano: 'Grande', cantidadKg: Number(grandes), unidad: 'kg' },
            { tamano: 'Mediano', cantidadKg: Number(medianos), unidad: 'kg' },
            { tamano: 'Gallinaza', cantidad: Number(gallinaza) }
          // Los huevos se envían en cantidadKg; filtrar solo por `cantidad`
          // descartaba esas líneas y el traslado encontraba el inventario vacío.
          ].filter(d => Number('cantidadKg' in d ? d.cantidadKg : d.cantidad) > 0)
        })
      });
      if (!resRec.ok) {
        const err = await resRec.json();
        throw new Error(err.error || 'Error registrando la carga');
      }

      // 2. Traslado a Bodega Central → queda En Tránsito automáticamente
      const items = [
        { producto: 'Huevos - Grande', cantidad: Number(grandes), unidad: 'kg' },
        { producto: 'Huevos - Mediano', cantidad: Number(medianos), unidad: 'kg' },
        { producto: 'Gallinaza', cantidad: Number(gallinaza), unidad: 'sacos' }
      ].filter(i => i.cantidad > 0);

      const vehiculoFinal = camionSel?.nombre || vehiculo || null;

      for (const it of items) {
        const resTr = await fetch('/api/operaciones/traslado', {
          method: 'POST',
          headers: sessionHeaders(currentUser.id, true),
          body: JSON.stringify({
            granjaId: granjaSel.id,
            producto: it.producto,
            ...(it.unidad === 'kg' ? { cantidadKg: it.cantidad } : { cantidad: it.cantidad }),
            unidad: it.unidad,
            responsable: currentUser.name,
            cargaId,
            vehiculo: vehiculoFinal,
            camionId: camionSel?.id || null,
            creadoPorId: currentUser.id,
          })
        });
        if (!resTr.ok) {
          const err = await resTr.json();
          throw new Error(err.error || 'Error registrando en tránsito');
        }
      }

      cargaIdRef.current = null;
      setScreen('exito');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <BloqueCarga className="min-h-[60vh]" />
    );
  }

  if (errorCarga) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center" role="alert">
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--status-danger)' }}>
          <h2 className="text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>No se cargaron los datos de la carga</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{errorCarga}</p>
          <button onClick={() => void cargarCatalogos()} className="mt-5 min-h-12 w-full rounded-xl px-4 text-base font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
            Intentar de nuevo
          </button>
        </div>
      </div>
    );
  }

  // ============ PANTALLA PRINCIPAL ============
  if (screen === 'inicio') {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 text-center animate-in fade-in">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
          <Truck className="w-10 h-10" />
        </div>
        <h1 className="text-2xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
          Carga de la granja a bodega
        </h1>
        <p className="text-sm mb-10" style={{ color: 'var(--text-muted)' }}>
          Registrar envío de huevos · {fechaCorta}
        </p>
        <button onClick={iniciarRegistro}
          className="w-full max-w-sm py-6 rounded-2xl text-xl font-black transition-all active:scale-[0.97]"
          style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)', boxShadow: '0 8px 24px color-mix(in srgb, var(--brand-primary) 35%, transparent)' }}>
          Registrar carga nueva
        </button>
        <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
          ¡Hola {currentUser.name}! Toca el botón para empezar
        </p>
      </div>
    );
  }

  // ============ FORMULARIO ============
  if (screen === 'form') {
    // Paso 0: Granja
    if (formStep === 0) {
      return (
        <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
          <button onClick={() => setScreen('inicio')} className="flex min-h-11 items-center gap-1 px-1 py-2 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Volver
          </button>
          <Stepper n={0} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            ¿De qué granja sale la carga?
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            Toca la granja que corresponde
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
          <button onClick={() => setFormStep(0)} className="flex min-h-11 items-center gap-1 px-1 py-2 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Cambiar granja
          </button>
          <Stepper n={1} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            ¿De qué galerón?
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

    // Paso 2: Cantidades
    if (formStep === 2) {
      return (
        <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
          <button onClick={() => setFormStep(1)} className="flex min-h-11 items-center gap-1 px-1 py-2 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Cambiar galerón
          </button>
          <Stepper n={2} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            Cantidades de la carga
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            {granjaSel?.nombre} → {galeronSel?.nombre}. Registra kilos pesados de huevo.
          </p>
          <div className="space-y-3">
            <StepperRow emoji="🥚" label="Huevo grande (kg)" value={grandes} onChange={setGrandes} increment={0.5} />
            <StepperRow emoji="🥚" label="Huevo mediano (kg)" value={medianos} onChange={setMedianos} increment={0.5} />
            <StepperRow emoji="🐔" label="Gallinaza (sacos)" value={gallinaza} onChange={setGallinaza} />
          </div>
          <button onClick={() => setFormStep(3)}
            disabled={total === 0}
            className="w-full mt-8 py-5 rounded-2xl text-lg font-black transition-all active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
            style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
            Continuar
          </button>
        </div>
      );
    }

    // Paso 3: Camión
    if (formStep === 3) {
      return (
        <div className="max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4">
          <button onClick={() => setFormStep(2)} className="flex min-h-11 items-center gap-1 px-1 py-2 text-sm font-semibold mb-4"
            style={{ color: 'var(--brand-primary)' }}>
            <ChevronLeft className="w-4 h-4" /> Cambiar cantidades
          </button>
          <Stepper n={3} />
          <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            ¿En qué camión va?
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            Selecciona el camión asignado al viaje
          </p>
          <div className="space-y-3">
            {camiones.map(c => (
              <button key={c.id} onClick={() => { setCamionSel(c); setVehiculo(c.nombre); setScreen('resumen'); }}
                className="w-full text-left p-5 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.97]"
                style={{ background: 'var(--bg-card)', border: camionSel?.id === c.id ? '2px solid var(--brand-primary)' : '2px solid var(--border-default)' }}>
                <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
                  <Truck className="w-7 h-7" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{c.nombre}</p>
                  {c.placa && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{c.placa}</p>}
                  {c.camioneroNombre && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Camionero: {c.camioneroNombre}</p>}
                </div>
                <ChevronRight className="w-6 h-6 shrink-0" style={{ color: 'var(--brand-primary)' }} />
              </button>
            ))}
            {camiones.length === 0 && (
              <p className="text-center py-6" style={{ color: 'var(--text-muted)' }}>No hay camiones disponibles</p>
            )}
          </div>
          <button onClick={() => { setCamionSel(null); setVehiculo(''); setScreen('resumen'); }}
            className="w-full mt-4 py-4 rounded-2xl text-base font-bold transition-all"
            style={{ color: 'var(--text-muted)' }}>
            Sin vehículo
          </button>
        </div>
      );
    }
  }

  // ============ RESUMEN / CONFIRMACIÓN ============
  if (screen === 'resumen') {
    return (
      <div className="max-w-md mx-auto px-4 pt-6 pb-32 animate-in fade-in slide-in-from-bottom-4">
        <button onClick={() => { setScreen('form'); setFormStep(3); }} className="flex min-h-11 items-center gap-1 px-1 py-2 text-sm font-semibold mb-4"
          style={{ color: 'var(--brand-primary)' }}>
          <ChevronLeft className="w-4 h-4" /> Corregir datos
        </button>
        <h2 className="text-xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
          ¿Es correcto?
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          Confirma la información antes de enviar
        </p>
        <div className="rounded-2xl p-5 space-y-3 mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <ResumenRow label="Registrado por" value={currentUser.name} />
          <ResumenRow label="Granja" value={granjaSel?.nombre || ''} />
          <ResumenRow label="Galerón" value={galeronSel?.nombre || ''} />
          <ResumenRow label="Fecha" value={`${fechaCorta} · ${hora}`} />
          {vehiculo && <ResumenRow label="Vehículo" value={vehiculo} />}
{Number(grandes) > 0 && <ResumenRow label="Huevo grande" value={`${Number(grandes).toFixed(2)} kg`} />}
{Number(medianos) > 0 && <ResumenRow label="Huevo mediano" value={`${Number(medianos).toFixed(2)} kg`} />}
          {Number(gallinaza) > 0 && <ResumenRow label="Gallinaza" value={`${gallinaza} sacos`} />}
          <div className="border-t pt-3 flex justify-between items-center" style={{ borderColor: 'var(--border-default)' }}>
            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Total de huevo</span>
            <span className="text-2xl font-black" style={{ color: 'var(--brand-primary)' }}>{totalHuevosKg.toFixed(2)} kg</span>
          </div>
        </div>
        <AccionFijaMovil etiquetaAccesible="Confirmar carga">
          <div className="mx-auto max-w-md">
            <button onClick={handleConfirmar}
              disabled={submitting}
              className="w-full min-h-14 rounded-xl text-lg font-black transition-all active:scale-[0.97] disabled:opacity-60 disabled:active:scale-100"
              style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)', boxShadow: '0 8px 24px color-mix(in srgb, var(--brand-primary) 35%, transparent)' }}>
              {submitting ? (
                <SpinnerConTexto tamano="md" className="justify-center">Enviando...</SpinnerConTexto>
              ) : (
                'Confirmar y enviar carga'
              )}
            </button>
            <p className="text-center text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Quedará pendiente de confirmación del camionero
            </p>
          </div>
        </AccionFijaMovil>
      </div>
    );
  }

  // ============ ÉXITO ============
  return (
    <div role="status" aria-live="polite" className="max-w-md mx-auto px-4 pt-16 pb-24 animate-in fade-in slide-in-from-bottom-4 text-center">
      <div className="w-24 h-24 rounded-full mx-auto mb-6 flex items-center justify-center" style={{ background: 'var(--brand-primary)' }}>
        <Check className="w-12 h-12" style={{ color: 'var(--text-on-action)' }} />
      </div>
      <h2 className="text-2xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>¡Carga registrada!</h2>
          <p className="text-base mb-8" style={{ color: 'var(--text-muted)' }}>
        {totalHuevosKg.toFixed(2)} kg de huevo · Esperando confirmación del camionero
      </p>
      <div className="rounded-2xl p-5 space-y-3 mb-8 text-left" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        <ResumenRow label="Registrado por" value={currentUser.name} />
        <ResumenRow label="Granja" value={granjaSel?.nombre || ''} />
        <ResumenRow label="Galerón" value={galeronSel?.nombre || ''} />
        <ResumenRow label="Fecha" value={`${fechaCorta} · ${hora}`} />
        {vehiculo && <ResumenRow label="Vehículo" value={vehiculo} />}
        {Number(grandes) > 0 && <ResumenRow label="Huevo grande" value={`${Number(grandes).toFixed(2)} kg`} />}
        {Number(medianos) > 0 && <ResumenRow label="Huevo mediano" value={`${Number(medianos).toFixed(2)} kg`} />}
        {Number(gallinaza) > 0 && <ResumenRow label="Gallinaza" value={`${gallinaza} sacos`} />}
      </div>
      <button onClick={iniciarRegistro}
        className="w-full py-6 rounded-2xl text-xl font-bold transition-all active:scale-[0.97]"
        style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
        Registrar otra carga
      </button>
      <button onClick={() => setScreen('inicio')}
        className="w-full py-4 rounded-2xl text-base font-bold mt-3 transition-all"
        style={{ color: 'var(--text-muted)' }}>
        Volver al inicio
      </button>
    </div>
  );
}

function ResumenRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
