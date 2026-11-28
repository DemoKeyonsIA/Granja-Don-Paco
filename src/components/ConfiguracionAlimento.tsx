import { useCallback, useEffect, useState } from 'react';
import { Check, LoaderCircle, Plus, RefreshCw, Wheat } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../types';
import { sessionHeaders } from '../lib/session';

type TipoAlimento = { id: string; nombre: string; estado: 'Activo' | 'Archivado'; creadoEn?: string };

export default function ConfiguracionAlimento({ currentUser }: { currentUser: User }) {
  const [tipos, setTipos] = useState<TipoAlimento[]>([]);
  const [nombre, setNombre] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [actualizando, setActualizando] = useState<string | null>(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const response = await fetch('/api/alimento/tipos', { headers: sessionHeaders(currentUser.id) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cargar el catálogo.');
      setTipos(Array.isArray(data) ? data : []);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo cargar el catálogo.';
      setError(message);
    } finally {
      setCargando(false);
    }
  }, [currentUser.id]);

  useEffect(() => { void cargar(); }, [cargar]);

  const agregar = async (event: React.FormEvent) => {
    event.preventDefault();
    const limpio = nombre.trim().replace(/\s+/g, ' ');
    if (limpio.length < 2 || limpio.length > 60) {
      toast.error('Escribe un nombre de 2 a 60 caracteres.');
      return;
    }
    setGuardando(true);
    try {
      const response = await fetch('/api/alimento/tipos', {
        method: 'POST',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ nombre: limpio }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo agregar el tipo de alimento.');
      setTipos(prev => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      setNombre('');
      toast.success('Tipo de alimento agregado.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'No se pudo agregar el tipo de alimento.');
    } finally {
      setGuardando(false);
    }
  };

  const cambiarEstado = async (tipo: TipoAlimento) => {
    const estado = tipo.estado === 'Activo' ? 'Archivado' : 'Activo';
    setActualizando(tipo.id);
    try {
      const response = await fetch(`/api/alimento/tipos/${encodeURIComponent(tipo.id)}`, {
        method: 'PATCH',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ estado }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el tipo de alimento.');
      setTipos(prev => prev.map(item => item.id === tipo.id ? data : item));
      toast.success(estado === 'Activo' ? 'Tipo de alimento activado.' : 'Tipo de alimento desactivado.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'No se pudo actualizar el tipo de alimento.');
    } finally {
      setActualizando(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl space-y-5" aria-labelledby="config-alimento-titulo">
      <header className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]"><Wheat className="h-6 w-6" /></span>
          <div>
            <h3 id="config-alimento-titulo" className="text-xl font-black text-[var(--text-primary)]">Tipos de alimento</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Administra las opciones que aparecen al recibir alimento y registrar inventario.</p>
          </div>
        </div>
      </header>

      <form onSubmit={agregar} className="flex flex-col gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-sm font-bold text-[var(--text-primary)]" htmlFor="nuevo-tipo-alimento">
          Agregar tipo de alimento
          <input id="nuevo-tipo-alimento" value={nombre} onChange={event => setNombre(event.target.value)} maxLength={60} placeholder="Ej. Preinicio" className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-page)] px-3 font-normal text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--brand-primary)]" />
        </label>
        <button type="submit" disabled={guardando || nombre.trim().length < 2} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 font-bold text-[var(--text-on-action)] disabled:cursor-not-allowed disabled:opacity-50">
          {guardando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Agregar
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-5 py-4">
          <div><h4 className="font-black text-[var(--text-primary)]">Catálogo</h4><p className="text-sm text-[var(--text-muted)]">{tipos.filter(tipo => tipo.estado === 'Activo').length} activos · {tipos.length} en total</p></div>
          <button type="button" onClick={() => void cargar()} disabled={cargando} aria-label="Actualizar catálogo" className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-default)] text-[var(--text-muted)] hover:bg-[var(--bg-page)] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} /></button>
        </div>

        {error && <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><span>{error}</span><button type="button" onClick={() => void cargar()} className="font-bold underline">Reintentar</button></div>}
        {cargando ? <div role="status" className="p-8 text-center text-sm text-[var(--text-muted)]">Cargando catálogo…</div> : tipos.length === 0 ? <p className="p-8 text-center text-sm text-[var(--text-muted)]">Todavía no hay tipos registrados. Agrega el primero arriba.</p> : (
          <ul className="divide-y divide-[var(--border-default)]">
            {tipos.map(tipo => (
              <li key={tipo.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tipo.estado === 'Activo' ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-500'}`}>{tipo.estado === 'Activo' ? <Check className="h-4 w-4" /> : <Wheat className="h-4 w-4" />}</span>
                  <div className="min-w-0"><p className="truncate font-bold text-[var(--text-primary)]">{tipo.nombre}</p><p className="text-xs text-[var(--text-muted)]">{tipo.estado === 'Activo' ? 'Disponible para registrar' : 'Desactivado'}</p></div>
                </div>
                <button type="button" onClick={() => void cambiarEstado(tipo)} disabled={actualizando === tipo.id} className="min-h-10 rounded-xl border border-[var(--border-default)] px-4 text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--bg-page)] disabled:opacity-50">
                  {actualizando === tipo.id ? 'Guardando…' : tipo.estado === 'Activo' ? 'Desactivar' : 'Activar'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)]">Los tipos que desactives se conservan en el historial y dejan de aparecer en nuevos registros.</p>
    </section>
  );
}
