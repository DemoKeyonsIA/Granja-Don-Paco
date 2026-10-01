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
import React, { useState } from 'react';
import { DollarSign, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../types';
import { cn } from '../lib/utils';

const CATEGORIAS = ['Diésel', 'Viáticos', 'Mantenimiento', 'Insumos', 'Planilla', 'Otros'] as const;

export default function RegistroGasto({
  currentUser,
  onClose,
}: {
  currentUser: User;
  onClose: () => void;
}) {
  const [categoria, setCategoria] = useState<string>('');
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const completo = Boolean(categoria && Number(monto) > 0 && descripcion.trim());

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completo || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/gastos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          fecha: new Date().toISOString(),
          categoria,
          monto: Number(monto),
          descripcion: descripcion.trim(),
          usuarioId: currentUser.id,
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