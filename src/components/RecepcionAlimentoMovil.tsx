import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, RefreshCw, Wheat } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../types';
import { sessionHeaders } from '../lib/session';
import { BloqueCarga } from './Spinner';
import ProgresoPuntosMovil from './ProgresoPuntosMovil';

type Granja = { id: string; nombre: string; ubicacion?: string; estado?: string };
type Galeron = { id: string; nombre: string; granjaId: string; estado?: string };
type Reporte = { cantidadSacos: number; tipoAlimento: string; granja: string; galeron: string };

const TIPOS_ALIMENTO = ['Inicial', 'Crecimiento', 'Producción', 'Premix'];

export default function RecepcionAlimentoMovil({ currentUser, onBack }: { currentUser: User; onBack?: () => void }) {
  const [granjas, setGranjas] = useState<Granja[]>([]);
  const [galerones, setGalerones] = useState<Galeron[]>([]);
  const [granjaId, setGranjaId] = useState('');
  const [galeronId, setGaleronId] = useState('');
  const [tipoAlimento, setTipoAlimento] = useState('');
  const [cantidadSacos, setCantidadSacos] = useState('');
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [reporteEnviado, setReporteEnviado] = useState<Reporte | null>(null);

  const cargarDatos = async () => {
    setCargando(true);
    setError('');
    try {
      const headers = sessionHeaders(currentUser.id);
      const [granjasResponse, galeronesResponse] = await Promise.all([
        fetch('/api/granjas', { headers }),
        fetch('/api/galerones', { headers }),
      ]);
      const [granjasData, galeronesData] = await Promise.all([granjasResponse.json(), galeronesResponse.json()]);
      if (!granjasResponse.ok) throw new Error(granjasData.error || 'No se pudieron cargar las granjas.');
      if (!galeronesResponse.ok) throw new Error(galeronesData.error || 'No se pudieron cargar los galerones.');
      setGranjas((Array.isArray(granjasData) ? granjasData : []).filter((g: Granja) => g.estado !== 'Archivado'));
      setGalerones((Array.isArray(galeronesData) ? galeronesData : []).filter((g: Galeron) => g.estado !== 'Archivado'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los datos.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { void cargarDatos(); }, [currentUser.id]);

  const granjaSeleccionada = granjas.find(g => g.id === granjaId);
  const galeronesDeGranja = galerones.filter(g => g.granjaId === granjaId);
  const galeronSeleccionado = galeronesDeGranja.find(g => g.id === galeronId);

  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    const cantidad = Number(cantidadSacos);
    if (!granjaSeleccionada || !galeronSeleccionado || !TIPOS_ALIMENTO.includes(tipoAlimento) || !Number.isSafeInteger(cantidad) || cantidad <= 0) {
      toast.error('Revisa la granja, el galerón, el alimento y la cantidad de sacos.');
      return;
    }
    setEnviando(true);
    try {
      const response = await fetch('/api/alimento/recepciones', {
        method: 'POST',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ tipoAlimento, cantidadSacos: cantidad, galeronId, granjaId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo enviar el reporte.');
      setReporteEnviado({ cantidadSacos: cantidad, tipoAlimento, granja: granjaSeleccionada.nombre, galeron: galeronSeleccionado.nombre });
      toast.success('Avisamos al administrador.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar el reporte.');
    } finally {
      setEnviando(false);
    }
  };

  const campo = 'mt-2 min-h-14 w-full rounded-xl border-2 border-[var(--border-default)] bg-[var(--bg-card)] px-4 text-lg text-[var(--text-primary)]';
  const contenedorPaso = 'max-w-md mx-auto px-4 pt-4 pb-24 animate-in fade-in slide-in-from-bottom-4';
  const tarjetaOpcion = 'w-full text-left p-5 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.97]';
  const mensajeError = error && (
    <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <span>{error}</span>
      <button type="button" onClick={() => void cargarDatos()} aria-label="Intentar de nuevo" className="min-h-11 min-w-11"><RefreshCw className="mx-auto h-5 w-5" /></button>
    </div>
  );
  const volver = (label: string, action: () => void) => (
    <button type="button" onClick={action} className="mb-4 flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--brand-primary)]"><ArrowLeft className="h-4 w-4" />{label}</button>
  );
  const limpiar = () => { setReporteEnviado(null); setPaso(1); setGranjaId(''); setGaleronId(''); setTipoAlimento(''); setCantidadSacos(''); };

  if (cargando) return <BloqueCarga className="min-h-[60vh]" />;

  if (reporteEnviado) {
    return (
      <div role="status" aria-live="polite" className="max-w-md mx-auto px-4 pt-16 pb-24 animate-in fade-in text-center" data-testid="recepcion-alimento-movil">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-10 w-10" /></div>
        <h1 className="mb-2 text-2xl font-black text-[var(--text-primary)]">Alimento recibido</h1>
        <p className="mb-10 text-sm text-[var(--text-muted)]">Se avisó al administrador: {reporteEnviado.cantidadSacos} sacos de alimento {reporteEnviado.tipoAlimento.toLowerCase()} en {reporteEnviado.galeron} · {reporteEnviado.granja}.</p>
        <button type="button" onClick={onBack || limpiar} className="w-full max-w-sm rounded-2xl bg-[var(--brand-primary)] py-5 text-lg font-black text-[var(--text-on-action)]">{onBack ? 'Volver a opciones' : 'Registrar otra entrega'}</button>
      </div>
    );
  }

  if (paso === 1) {
    return (
      <div className={contenedorPaso} data-testid="recepcion-alimento-movil">
        {onBack && <button type="button" onClick={onBack} className="mb-4 flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--brand-primary)]"><ArrowLeft className="h-4 w-4" />Volver a opciones</button>}
        <ProgresoPuntosMovil total={3} paso={0} />
        <h2 className="mb-1 text-xl font-black text-[var(--text-primary)]">¿En qué granja llegó el alimento?</h2>
        <p className="mb-6 text-sm text-[var(--text-muted)]">Toca la granja que recibió el alimento</p>
        {mensajeError}
        <div className="space-y-3">
          {granjas.map(granja => (
            <button key={granja.id} type="button" onClick={() => { setGranjaId(granja.id); setGaleronId(''); setPaso(2); }} className={tarjetaOpcion} style={{ background: 'var(--bg-card)', border: '2px solid var(--border-default)' }}>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]"><Wheat className="h-7 w-7" /></div>
              <div className="min-w-0 flex-1"><p className="text-lg font-bold text-[var(--text-primary)]">{granja.nombre}</p>{granja.ubicacion && <p className="text-sm text-[var(--text-muted)]">{granja.ubicacion}</p>}</div>
              <ChevronRight className="h-6 w-6 shrink-0 text-[var(--brand-primary)]" />
            </button>
          ))}
          {!error && granjas.length === 0 && <p className="py-12 text-center text-[var(--text-muted)]">No hay granjas disponibles</p>}
        </div>
      </div>
    );
  }

  if (paso === 2) {
    return (
      <div className={contenedorPaso} data-testid="recepcion-alimento-movil">
        {volver('Cambiar granja', () => setPaso(1))}
        <ProgresoPuntosMovil total={3} paso={1} />
        <h2 className="mb-1 text-xl font-black text-[var(--text-primary)]">¿En qué galerón?</h2>
        <p className="mb-6 text-sm text-[var(--text-muted)]">Granja: <strong className="text-[var(--text-primary)]">{granjaSeleccionada?.nombre}</strong></p>
        {mensajeError}
        <div className="space-y-3">
          {galeronesDeGranja.map(galeron => (
            <button key={galeron.id} type="button" onClick={() => { setGaleronId(galeron.id); setPaso(3); }} className={tarjetaOpcion} style={{ background: 'var(--bg-card)', border: '2px solid var(--border-default)' }}>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]"><Wheat className="h-7 w-7" /></div>
              <div className="min-w-0 flex-1"><p className="text-lg font-bold text-[var(--text-primary)]">{galeron.nombre}</p></div>
              <ChevronRight className="h-6 w-6 shrink-0 text-[var(--brand-primary)]" />
            </button>
          ))}
          {!error && galeronesDeGranja.length === 0 && <p className="py-12 text-center text-[var(--text-muted)]">No hay galerones en esta granja</p>}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className={contenedorPaso} data-testid="recepcion-alimento-movil">
      {volver('Cambiar galerón', () => setPaso(2))}
      <ProgresoPuntosMovil total={3} paso={2} />
      <h2 className="mb-1 text-xl font-black text-[var(--text-primary)]">¿Qué alimento llegó?</h2>
      <p className="mb-6 text-sm text-[var(--text-muted)]">{granjaSeleccionada?.nombre} · {galeronSeleccionado?.nombre}</p>
      {mensajeError}
      <div className="space-y-5">
        <label className="block text-base font-extrabold text-[var(--text-primary)]">Tipo de alimento
          <select required value={tipoAlimento} onChange={e => setTipoAlimento(e.target.value)} className={campo}>
            <option value="">Elige el alimento</option>
            {TIPOS_ALIMENTO.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
          </select>
        </label>
        <label className="block text-base font-extrabold text-[var(--text-primary)]">¿Cuántos sacos llegaron?
          <input required type="number" inputMode="numeric" min="1" step="1" value={cantidadSacos} onChange={e => setCantidadSacos(e.target.value)} placeholder="Escribe la cantidad" className={`${campo} text-2xl font-extrabold tabular-nums`} />
        </label>
        <button type="submit" disabled={enviando || !tipoAlimento || !cantidadSacos} className="min-h-14 w-full rounded-xl bg-[var(--brand-primary)] px-4 text-lg font-extrabold text-[var(--text-on-action)] disabled:cursor-not-allowed disabled:opacity-50">{enviando ? 'Enviando…' : 'Avisar al administrador'}</button>
      </div>
    </form>
  );
}
