import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, PackagePlus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../types';
import { sessionHeaders } from '../lib/session';
import { BloqueCarga } from './Spinner';
import ProgresoPuntosMovil from './ProgresoPuntosMovil';

type Granja = { id: string; nombre: string; ubicacion?: string; estado?: string };
type Galeron = { id: string; nombre: string; granjaId: string; estado?: string };
type LoteAlimento = { id: string; granjaId?: string | null; tipoAlimento: string; loteAlimento?: string | null; cantidadActual: number; unidad: string; estado?: string; galeronAsociado?: string | null };
type Asignacion = { alimento: string; galeron: string; cantidad: number; unidad: string };

export default function AsignacionAlimentoMovil({ currentUser, onBack }: { currentUser: User; onBack: () => void }) {
  const [granjas, setGranjas] = useState<Granja[]>([]);
  const [galerones, setGalerones] = useState<Galeron[]>([]);
  const [lotes, setLotes] = useState<LoteAlimento[]>([]);
  const [granjaId, setGranjaId] = useState('');
  const [galeronId, setGaleronId] = useState('');
  const [loteId, setLoteId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [asignacion, setAsignacion] = useState<Asignacion | null>(null);

  const cargar = async () => {
    setCargando(true); setError('');
    try {
      const headers = sessionHeaders(currentUser.id);
      const [granjasRes, galeronesRes, alimentoRes] = await Promise.all([
        fetch('/api/granjas', { headers }), fetch('/api/galerones', { headers }), fetch('/api/alimento', { headers }),
      ]);
      const [granjasData, galeronesData, alimentoData] = await Promise.all([granjasRes.json(), galeronesRes.json(), alimentoRes.json()]);
      if (!granjasRes.ok) throw new Error(granjasData.error || 'No se pudieron cargar las granjas.');
      if (!galeronesRes.ok) throw new Error(galeronesData.error || 'No se pudieron cargar los galerones.');
      if (!alimentoRes.ok) throw new Error(alimentoData.error || 'No se pudo consultar el alimento disponible.');
      setGranjas((Array.isArray(granjasData) ? granjasData : []).filter((g: Granja) => g.estado !== 'Archivado'));
      setGalerones((Array.isArray(galeronesData) ? galeronesData : []).filter((g: Galeron) => g.estado !== 'Archivado'));
      setLotes((Array.isArray(alimentoData) ? alimentoData : []).filter((l: LoteAlimento) => l.estado === 'Activo' && !l.galeronAsociado && Number(l.cantidadActual) > 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los datos.');
    } finally { setCargando(false); }
  };

  useEffect(() => { void cargar(); }, [currentUser.id]);

  const granja = granjas.find(g => g.id === granjaId);
  const galeron = galerones.find(g => g.id === galeronId);
  const lotesParaGranja = useMemo(() => lotes.filter(l => !l.granjaId || l.granjaId === granjaId), [lotes, granjaId]);
  const lote = lotesParaGranja.find(l => l.id === loteId);
  const galeronesGranja = useMemo(() => galerones.filter(g => g.granjaId === granjaId), [galerones, granjaId]);
  const disponibleMismoTipo = lote ? lotesParaGranja.filter(l => l.tipoAlimento === lote.tipoAlimento && l.unidad === lote.unidad).reduce((sum, row) => sum + Number(row.cantidadActual || 0), 0) : 0;

  const reiniciar = () => { setAsignacion(null); setPaso(1); setGranjaId(''); setGaleronId(''); setLoteId(''); setCantidad(''); void cargar(); };
  const guardar = async (event: FormEvent) => {
    event.preventDefault();
    const qty = Number(cantidad);
    if (!granja || !galeron || !lote || !Number.isFinite(qty) || qty <= 0 || qty > Number(lote.cantidadActual) || (lote.unidad === 'sacos' && !Number.isSafeInteger(qty))) {
      toast.error('Revisa la cantidad y el alimento disponible.'); return;
    }
    setEnviando(true);
    try {
      const response = await fetch('/api/alimento/asignaciones', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ inventarioAlimentoId: lote.id, granjaId, galeronId, cantidad: qty, unidad: lote.unidad }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo asignar el alimento.');
      setAsignacion({ alimento: data.alimento, galeron: data.galeron, cantidad: Number(data.cantidad), unidad: data.unidad });
      toast.success('Alimento asignado al galerón.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo asignar el alimento.'); }
    finally { setEnviando(false); }
  };

  const contenedor = 'mx-auto max-w-md px-4 pb-24 pt-4 animate-in fade-in';
  const opcion = 'flex min-h-20 w-full items-center gap-4 rounded-2xl border-2 border-[var(--border-default)] bg-[var(--bg-card)] p-4 text-left transition-transform active:scale-[0.98]';
  const volver = (label: string, onClick: () => void) => <button type="button" onClick={onClick} className="mb-4 flex min-h-11 items-center gap-2 font-bold text-[var(--brand-primary)]"><ArrowLeft className="h-5 w-5" />{label}</button>;

  if (cargando) return <BloqueCarga className="min-h-[60vh]" />;
  if (asignacion) return (
    <section className={`${contenedor} pt-16 text-center`} role="status" aria-live="polite" data-testid="asignacion-alimento-movil">
      <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-emerald-600" />
      <h1 className="mb-2 text-2xl font-black text-[var(--text-primary)]">Alimento asignado</h1>
      <p className="mb-8 text-[var(--text-secondary)]">{asignacion.cantidad} {asignacion.unidad} de {asignacion.alimento.toLowerCase()} para {asignacion.galeron}.</p>
      <button type="button" onClick={onBack} className="min-h-14 w-full rounded-2xl bg-[var(--brand-primary)] px-5 text-lg font-extrabold text-[var(--text-on-action)]">Volver a Alimentos</button>
      <button type="button" onClick={reiniciar} className="mt-3 min-h-12 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 font-bold text-[var(--text-primary)]">Asignar otra cantidad</button>
    </section>
  );

  if (error) return <section className={contenedor} role="alert"><p className="rounded-xl bg-red-50 p-4 text-red-900">{error}</p><button type="button" onClick={() => void cargar()} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] font-bold text-[var(--text-on-action)]"><RefreshCw className="h-4 w-4" />Intentar de nuevo</button></section>;

  if (paso === 1) return (
    <section className={contenedor} data-testid="asignacion-alimento-movil">
      {volver('Volver a Alimentos', onBack)}<ProgresoPuntosMovil total={3} paso={0} />
      <h1 className="mb-1 text-xl font-black text-[var(--text-primary)]">¿En qué granja?</h1><p className="mb-5 text-sm text-[var(--text-muted)]">Elige la granja que recibirá alimento.</p>
      <div className="space-y-3">{granjas.map(item => <button key={item.id} type="button" className={opcion} onClick={() => { setGranjaId(item.id); setGaleronId(''); setLoteId(''); setCantidad(''); setPaso(2); }}><span className="min-w-0 flex-1"><span className="block text-lg font-extrabold text-[var(--text-primary)]">{item.nombre}</span>{item.ubicacion && <span className="text-sm text-[var(--text-muted)]">{item.ubicacion}</span>}</span><ChevronRight className="h-6 w-6 text-[var(--brand-primary)]" /></button>)}{granjas.length === 0 && <p className="py-8 text-center text-[var(--text-muted)]">No hay granjas disponibles.</p>}</div>
    </section>
  );

  if (paso === 2) return (
    <section className={contenedor} data-testid="asignacion-alimento-movil">
      {volver('Cambiar granja', () => setPaso(1))}<ProgresoPuntosMovil total={3} paso={1} />
      <h1 className="mb-1 text-xl font-black text-[var(--text-primary)]">¿A qué galerón?</h1><p className="mb-5 text-sm text-[var(--text-muted)]">Granja: <strong className="text-[var(--text-primary)]">{granja?.nombre}</strong></p>
      <div className="space-y-3">{galeronesGranja.map(item => <button key={item.id} type="button" className={opcion} onClick={() => { setGaleronId(item.id); setPaso(3); }}><span className="min-w-0 flex-1 text-lg font-extrabold text-[var(--text-primary)]">{item.nombre}</span><ChevronRight className="h-6 w-6 text-[var(--brand-primary)]" /></button>)}{galeronesGranja.length === 0 && <p className="py-8 text-center text-[var(--text-muted)]">Esta granja no tiene galerones registrados.</p>}</div>
    </section>
  );

  return (
    <form onSubmit={guardar} className={contenedor} data-testid="asignacion-alimento-movil">
      {volver('Cambiar galerón', () => setPaso(2))}<ProgresoPuntosMovil total={3} paso={2} />
      <h1 className="mb-1 text-xl font-black text-[var(--text-primary)]">¿Cuánto alimento asignamos?</h1><p className="mb-5 text-sm text-[var(--text-muted)]">{granja?.nombre} · {galeron?.nombre}</p>
      {lotesParaGranja.length === 0 ? <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 text-center"><PackagePlus className="mx-auto mb-3 h-9 w-9 text-[var(--text-muted)]"/><p className="font-bold text-[var(--text-primary)]">No hay alimento disponible</p><p className="mt-1 text-sm text-[var(--text-muted)]">Esta granja aún no tiene saldo común. Registra la recepción o consulta a Administración.</p></div> : <>
        <label className="block text-base font-extrabold text-[var(--text-primary)]">Alimento disponible
          <select required value={loteId} onChange={e => { setLoteId(e.target.value); setCantidad(''); }} className="mt-2 min-h-14 w-full rounded-xl border-2 border-[var(--border-default)] bg-[var(--bg-card)] px-4 text-base text-[var(--text-primary)]">
            <option value="">Elige un lote</option>{lotesParaGranja.map(item => <option key={item.id} value={item.id}>{item.tipoAlimento} · {item.loteAlimento || 'sin lote'} · {Number(item.cantidadActual)} {item.unidad}</option>)}
          </select>
        </label>
        {lote && <>
      <div className="mt-4 rounded-xl bg-[var(--brand-primary-soft)] p-4 text-sm text-[var(--text-primary)]"><strong>{lote.tipoAlimento}</strong> · {Number(lote.cantidadActual)} {lote.unidad} disponibles en stock común{disponibleMismoTipo > Number(lote.cantidadActual) ? ` · ${disponibleMismoTipo} ${lote.unidad} en total` : ''}</div>
          <label className="mt-5 block text-base font-extrabold text-[var(--text-primary)]">Cantidad para este galerón
            <input required type="number" inputMode="decimal" min="0.001" max={lote.cantidadActual} step={lote.unidad === 'sacos' ? '1' : '0.001'} value={cantidad} onChange={e => setCantidad(e.target.value)} placeholder={`Hasta ${lote.cantidadActual} ${lote.unidad}`} className="mt-2 min-h-14 w-full rounded-xl border-2 border-[var(--border-default)] bg-[var(--bg-card)] px-4 text-2xl font-extrabold tabular-nums text-[var(--text-primary)]" />
          </label>
          <p className="mt-2 text-sm text-[var(--text-muted)]">El saldo del stock común baja cuando confirmas la asignación.</p>
        </>}
        <button type="submit" disabled={!lote || !cantidad || enviando || Number(cantidad) > Number(lote?.cantidadActual || 0)} className="mt-6 min-h-14 w-full rounded-xl bg-[var(--brand-primary)] px-4 text-lg font-extrabold text-[var(--text-on-action)] disabled:cursor-not-allowed disabled:opacity-50">{enviando ? 'Guardando…' : 'Asignar alimento'}</button>
      </>}
    </form>
  );
}
