import { ArrowLeft, ChevronRight, Wheat, PackagePlus } from 'lucide-react';

type Props = { onBack: () => void; onReceive: () => void; onAssign: () => void };

export default function AlimentosMovil({ onBack, onReceive, onAssign }: Props) {
  const optionClass = 'flex min-h-24 w-full items-center gap-4 rounded-2xl border-2 border-[var(--border-default)] bg-[var(--bg-card)] p-5 text-left transition-transform active:scale-[0.98]';
  return (
    <main className="mx-auto max-w-md px-4 pb-24 pt-4" data-testid="alimentos-menu-movil">
      <button type="button" onClick={onBack} className="mb-5 flex min-h-11 items-center gap-2 font-bold text-[var(--brand-primary)]"><ArrowLeft className="h-5 w-5" />Volver a opciones</button>
      <h1 className="mb-1 text-2xl font-black text-[var(--text-primary)]">Alimentos</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">Elige lo que necesitas hacer.</p>
      <div className="space-y-3">
        <button type="button" onClick={onReceive} className={optionClass}>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]"><Wheat className="h-7 w-7" /></span>
          <span className="min-w-0 flex-1"><span className="block text-lg font-extrabold text-[var(--text-primary)]">Recibir alimento</span><span className="mt-1 block text-sm text-[var(--text-muted)]">Anota los sacos que llegaron a la granja.</span></span>
          <ChevronRight className="h-6 w-6 shrink-0 text-[var(--brand-primary)]" />
        </button>
        <button type="button" onClick={onAssign} className={optionClass}>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]"><PackagePlus className="h-7 w-7" /></span>
          <span className="min-w-0 flex-1"><span className="block text-lg font-extrabold text-[var(--text-primary)]">Asignar alimento</span><span className="mt-1 block text-sm text-[var(--text-muted)]">Pasa alimento disponible a un galerón.</span></span>
          <ChevronRight className="h-6 w-6 shrink-0 text-[var(--brand-primary)]" />
        </button>
      </div>
    </main>
  );
}
