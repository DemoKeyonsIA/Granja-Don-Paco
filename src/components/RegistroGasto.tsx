/**
 * Registro de Gasto: la acción del menú "+ Nuevo" en Finanzas.
 *
 * Antes era el segundo tab interno de `Finanzas.tsx`, junto a "Flujo de Caja".
 * Un tab para escribir un solo formulario daba la impresión de que había dos
 * formas de registrar un gasto; como acción del "+ Nuevo" queda donde pertenece
 * y Resumen gana el espacio.
 *
 * Al guardar no se toca el resumen: la pantalla que lo muestra lo vuelve a
 * pedir, así que no hay estado que invalidar desde acá.
 */
import React, { useEffect, useState } from 'react';
import { DollarSign, Plus, Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../types';
import { cn } from '../lib/utils';
import { loadSession } from '../lib/session';

const CATEGORIAS = ['Diésel', 'Hospedaje', 'Dieta', 'Otros', 'Viáticos', 'Mantenimiento', 'Insumos', 'Planilla'] as const;

export default function RegistroGasto({
  currentUser,
  onClose,
  initialGuideId,
}: {
  currentUser: User;
  onClose: () => void;
  initialGuideId?: string;
}) {
  const [categoria, setCategoria] = useState<string>('');
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [guiaId, setGuiaId] = useState('');
  const [medioPago, setMedioPago] = useState('Efectivo');
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [guiasActivas, setGuiasActivas] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/logistica/guias-activas', { headers: { 'x-user-id': currentUser.id, ...(loadSession()?.token ? { Authorization: `Bearer ${loadSession()?.token}` } : {}) } }).then(async res => res.ok ? res.json() : []).then(data => setGuiasActivas(Array.isArray(data) ? data : [])).catch(() => setGuiasActivas([]));
  }, [currentUser.id]);

  useEffect(() => { if (initialGuideId) setGuiaId(initialGuideId); }, [initialGuideId]);

  const completo = Boolean(categoria && Number(monto) > 0 && descripcion.trim());

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completo || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const token = loadSession()?.token;
      const key = idempotencyKey || crypto.randomUUID();
      if (!idempotencyKey) setIdempotencyKey(key);
      const res = await fetch('/api/gastos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'x-user-id': currentUser.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          fecha: new Date().toISOString(),
          categoria,
          monto: Number(monto),
          descripcion: descripcion.trim(),
          usuarioId: currentUser.id,
          guiaId: guiaId || null,
          medioPago,
          comprobante,
        }),
      });
      if (!res.ok) throw new Error(`No se pudo registrar el gasto (${res.status})`);
      toast.success('Gasto registrado');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo registrar el gasto');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Registrar gasto">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form onSubmit={guardar} className="relative w-full max-w-lg bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-2xl p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-neutral-100 dark:border-neutral-700">
          <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-900/30 text-orange-600 flex items-center justify-center">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-neutral-900 dark:text-white">Registrar gasto</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Gastos operativos de la jornada</p>
          </div>
        </div>

        <div className="space-y-4">
          {initialGuideId && (() => { const g = guiasActivas.find((x: any) => x.id === initialGuideId); return <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"><b>Gasto asociado a la guía activa</b><br />{g ? `${g.consecutivo} · ${g.camionNombre || 'Camión'} · ${g.rutaNombre || 'Ruta asignada'}` : 'Cargando guía…'}</div>; })()}
          <div className="space-y-2">
            <label htmlFor="gasto-categoria" className="text-sm font-bold text-neutral-700 dark:text-neutral-300">Categoría</label>
            <select
              id="gasto-categoria"
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
              className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Seleccione una categoría</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="gasto-monto" className="text-sm font-bold text-neutral-700 dark:text-neutral-300">Monto (₡)</label>
            <input
              id="gasto-monto"
              type="number"
              min="1"
              value={monto}
              onChange={e => setMonto(e.target.value)}
              className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Ej. 15000"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="gasto-medio-pago" className="text-sm font-bold text-neutral-700 dark:text-neutral-300">¿Cómo se pagó?</label>
            <select id="gasto-medio-pago" value={medioPago} onChange={e => setMedioPago(e.target.value)} className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm">
              <option value="Efectivo">Efectivo</option><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Otro">Otro</option>
            </select>
          </div>

          {!initialGuideId && <div className="space-y-2">
            <label htmlFor="gasto-guia" className="text-sm font-bold text-neutral-700 dark:text-neutral-300">Ruta o jornada (opcional)</label>
            <select id="gasto-guia" value={guiaId} onChange={e => setGuiaId(e.target.value)} className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm">
              <option value="">Gasto general</option>{guiasActivas.map((g: any) => <option key={g.id} value={g.id}>{g.consecutivo} · {g.camionNombre || 'Camión'} · {g.rutaNombre || 'Ruta'}</option>)}
            </select>
          </div>}

          <div className="space-y-2">
            <label htmlFor="gasto-descripcion" className="text-sm font-bold text-neutral-700 dark:text-neutral-300">Descripción</label>
            <textarea
              id="gasto-descripcion"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              rows={3}
              className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              placeholder="Ej. Peaje ruta 27 y almuerzo"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="gasto-comprobante" className="text-sm font-bold text-neutral-700 dark:text-neutral-300">Comprobante (opcional)</label>
            <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-600 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
              <Camera className="h-4 w-4" /> {comprobante ? 'Comprobante adjunto · cambiar' : 'Tomar foto o seleccionar imagen'}
              <input id="gasto-comprobante" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return;
                if (file.size > 8 * 1024 * 1024) { toast.error('La imagen debe pesar menos de 8 MB.'); e.target.value = ''; return; }
                try {
                  const raw = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
                  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = raw; });
                  const scale = Math.min(1, 1200 / Math.max(image.width, image.height)); const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
                  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height); const compacta = canvas.toDataURL('image/jpeg', 0.68);
                  if (compacta.length > 760_000) throw new Error('La foto sigue siendo muy pesada. Intenta tomarla con menor resolución.');
                  setComprobante(compacta);
                } catch (err) { toast.error(err instanceof Error ? err.message : 'No se pudo leer el comprobante.'); }
              }} />
            </label>
            {comprobante && <button type="button" className="text-xs font-bold text-red-700" onClick={() => setComprobante(null)}><X className="mr-1 inline h-3 w-3" />Quitar comprobante</button>}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className={cn("flex-1 py-3 rounded-xl text-sm font-bold border", "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:opacity-80")}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!completo || isSubmitting}
            className="flex-1 py-3 rounded-xl text-white text-sm font-bold disabled:opacity-50 transition-colors shadow-sm flex items-center justify-center gap-1.5"
            style={{ background: 'var(--brand-primary)' }}
          >
            <Plus className="w-4 h-4" />
            {isSubmitting ? 'Guardando...' : 'Registrar'}
          </button>
        </div>
      </form>
    </div>
  );
}
