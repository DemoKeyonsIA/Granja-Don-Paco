import { cn } from '../lib/utils';
import { BloqueCarga } from './Spinner';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-700', className)}
      {...props}
    />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6 space-y-3">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 space-y-3">
      <div className="flex gap-4 pb-3 border-b border-neutral-100 dark:border-neutral-700">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Esqueleto con texto visible, para cuando ya se sabe qué forma tiene la pantalla.
 * Comparte el indicador con `BloqueCarga`: los dos son "la pantalla está
 * esperando", y si cada uno dibuja el suyo se ven como dos pantallas distintas.
 */
export function PageLoader() {
  return <BloqueCarga texto="Cargando..." className="py-20" />;
}
