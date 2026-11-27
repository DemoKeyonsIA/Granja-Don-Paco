import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, RefreshCw, Wheat } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../types';
import { sessionHeaders } from '../lib/session';

type Granja = { id: string; nombre: string; estado?: string };
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
  const opcion = 'flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border-2 border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-3 text-left text-lg font-extrabold text-[var(--text-primary)] transition-colors hover:border-[var(--brand-primary)]';

  return (
    <main className="mx-auto max-w-md space-y-4 pb-8" data-testid="recepcion-alimento-movil">
      {onBack && <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 px-1 text-base font-bold text-[var(--brand-primary)]"><ArrowLeft className="h-5 w-5" />Volver a opciones</button>}
      <header className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]"><Wheat className="h-6 w-6" /></span>
          <div>
            <h1 className="text-xl font-black text-[var(--text-primary)]">Recibir alimento</h1>
            <p className="text-sm text-[var(--text-secondary)]">Primero elige la granja y el galerón.</p>
          </div>
        </div>
      </header>

      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"><span>{error}</span><button type="button" onClick={() => void cargarDatos()} aria-label="Intentar de nuevo" className="min-h-11 min-w-11"><RefreshCw className="mx-auto h-5 w-5" /></button></div>}

      {reporteEnviado ? (
        <section role="status" className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />
            <div><h2 className="text-lg font-extrabold">¡Listo!</h2><p className="mt-1 text-sm">Avisamos que llegaron {reporteEnviado.cantidadSacos} sacos de alimento {reporteEnviado.tipoAlimento.toLowerCase()} a {reporteEnviado.galeron}, en {reporteEnviado.granja}.</p></div>
          </div>
          <button type="button" onClick={() => { setReporteEnviado(null); setPaso(1); setGranjaId(''); setGaleronId(''); setTipoAlimento(''); setCantidadSacos(''); }} className="min-h-12 w-full rounded-xl bg-[var(--brand-primary)] px-4 text-base font-extrabold text-[var(--text-on-action)]">Registrar otra entrega</button>
        </section>
      ) : cargando ? (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 text-base font-semibold text-[var(--text-secondary)]">Cargando granjas…</div>
      ) : paso === 1 ? (
        <section className="space-y-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <h2 className="text-lg font-extrabold text-[var(--text-primary)]">1. Elige la granja</h2>
          {granjas.map(granja => <button key={granja.id} type="button" className={opcion} onClick={() => { setGranjaId(granja.id); setGaleronId(''); setPaso(2); }}>{granja.nombre}<span aria-hidden="true">›</span></button>)}
          {!error && granjas.length === 0 && <p className="rounded-xl bg-[var(--bg-muted)] p-4 text-sm text-[var(--text-secondary)]">No hay granjas disponibles.</p>}
        </section>
      ) : paso === 2 ? (
        <section className="space-y-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <button type="button" onClick={() => setPaso(1)} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--brand-primary)]"><ArrowLeft className="h-4 w-4" />Cambiar granja</button>
          <p className="rounded-xl bg-[var(--brand-primary-soft)] p-3 text-sm text-[var(--text-primary)]">Granja: <strong>{granjaSeleccionada?.nombre}</strong></p>
          <h2 className="text-lg font-extrabold text-[var(--text-primary)]">2. Elige el galerón</h2>
          {galeronesDeGranja.map(galeron => <button key={galeron.id} type="button" className={opcion} onClick={() => { setGaleronId(galeron.id); setPaso(3); }}>{galeron.nombre}<span aria-hidden="true">›</span></button>)}
          {!error && galeronesDeGranja.length === 0 && <p className="rounded-xl bg-[var(--bg-muted)] p-4 text-sm text-[var(--text-secondary)]">Esta granja no tiene galerones disponibles.</p>}
        </section>
      ) : (
        <form onSubmit={enviar} className="space-y-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4 shadow-sm">
          <button type="button" onClick={() => setPaso(2)} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--brand-primary)]"><ArrowLeft className="h-4 w-4" />Cambiar galerón</button>
          <p className="rounded-xl bg-[var(--brand-primary-soft)] p-3 text-sm text-[var(--text-primary)]"><strong>{granjaSeleccionada?.nombre}</strong> · {galeronSeleccionado?.nombre}</p>
          <h2 className="text-lg font-extrabold text-[var(--text-primary)]">3. ¿Qué alimento llegó?</h2>
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
        </form>
      )}
    </main>
  );
}
