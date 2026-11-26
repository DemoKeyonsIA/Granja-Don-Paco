import { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Wheat } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../types';
import { sessionHeaders } from '../lib/session';

type Galeron = { id: string; nombre: string; granjaId: string; estado?: string };
type Reporte = { cantidadSacos: number; galeron: string };

export default function RecepcionAlimentoMovil({ currentUser }: { currentUser: User }) {
  const [galerones, setGalerones] = useState<Galeron[]>([]);
  const [galeronId, setGaleronId] = useState('');
  const [cantidadSacos, setCantidadSacos] = useState('');
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [reporteEnviado, setReporteEnviado] = useState<Reporte | null>(null);

  const cargarGalerones = async () => {
    setCargando(true);
    setError('');
    try {
      const response = await fetch('/api/galerones', { headers: sessionHeaders(currentUser.id) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los galerones.');
      const activos = (Array.isArray(data) ? data : []).filter((g: Galeron) => g.estado !== 'Archivado');
      setGalerones(activos);
      setGaleronId(prev => activos.some((g: Galeron) => g.id === prev) ? prev : activos[0]?.id || '');
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'No se pudieron cargar los galerones.';
      setError(mensaje);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { void cargarGalerones(); }, [currentUser.id]);

  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    const cantidad = Number(cantidadSacos);
    if (!galeronId || !Number.isSafeInteger(cantidad) || cantidad <= 0) {
      toast.error('Elige el galerón y escribe cuántos sacos llegaron.');
      return;
    }
    setEnviando(true);
    try {
      const response = await fetch('/api/alimento/recepciones', {
        method: 'POST',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ tipoAlimento: 'Producción', cantidadSacos: cantidad, galeronId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo enviar el reporte.');
      const galeron = galerones.find(g => g.id === galeronId);
      setReporteEnviado({ cantidadSacos: cantidad, galeron: galeron?.nombre || 'Galerón' });
      setCantidadSacos('');
      toast.success('Avisamos al administrador.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar el reporte.');
    } finally {
      setEnviando(false);
    }
  };

  const campo = 'mt-2 min-h-14 w-full rounded-xl border-2 border-[var(--border-default)] bg-[var(--bg-card)] px-4 text-lg text-[var(--text-primary)]';

  return (
    <main className="mx-auto max-w-md space-y-4 pb-8" data-testid="recepcion-alimento-movil">
      <header className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]"><Wheat className="h-6 w-6" /></span>
          <div>
            <h1 className="text-xl font-black text-[var(--text-primary)]">Recibir alimento</h1>
            <p className="text-sm text-[var(--text-secondary)]">Cuenta los sacos y avisa al administrador.</p>
          </div>
        </div>
      </header>

      {reporteEnviado ? (
        <section role="status" className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700 dark:text-emerald-300" />
            <div><h2 className="text-lg font-extrabold">¡Listo!</h2><p className="mt-1 text-sm">Avisamos que llegaron {reporteEnviado.cantidadSacos} sacos a {reporteEnviado.galeron}.</p></div>
          </div>
          <button type="button" onClick={() => setReporteEnviado(null)} className="min-h-12 w-full rounded-xl bg-[var(--brand-primary)] px-4 text-base font-extrabold text-[var(--text-on-action)]">Registrar otra entrega</button>
        </section>
      ) : (
        <form onSubmit={enviar} className="space-y-5 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4 shadow-sm">
          {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"><span>{error}</span><button type="button" onClick={() => void cargarGalerones()} aria-label="Intentar de nuevo"><RefreshCw className="h-5 w-5" /></button></div>}
          <label className="block text-base font-extrabold text-[var(--text-primary)]">¿A cuál galerón llegó?
            <select required value={galeronId} onChange={e => setGaleronId(e.target.value)} disabled={cargando || galerones.length === 0} className={campo}>
              <option value="">{cargando ? 'Cargando…' : galerones.length ? 'Elige el galerón' : 'No hay galerones disponibles'}</option>
              {galerones.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </label>

          <label className="block text-base font-extrabold text-[var(--text-primary)]">¿Cuántos sacos llegaron?
            <input required type="number" inputMode="numeric" min="1" step="1" value={cantidadSacos} onChange={e => setCantidadSacos(e.target.value)} placeholder="Escribe un número" className={`${campo} text-2xl font-extrabold tabular-nums`} />
          </label>

          <button type="submit" disabled={enviando || cargando || !galeronId || !cantidadSacos} className="min-h-14 w-full rounded-xl bg-[var(--brand-primary)] px-4 text-lg font-extrabold text-[var(--text-on-action)] disabled:cursor-not-allowed disabled:opacity-50">{enviando ? 'Enviando…' : 'Enviar al administrador'}</button>
        </form>
      )}
    </main>
  );
}
