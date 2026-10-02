/**
 * Fases 0-7 dejaron una capa de estados de carga: `Skeleton` para lo que tiene
 * forma conocida (tarjetas, tablas) y `PageLoader` para lo que no la tiene.
 *
 * Faltaba el tercer caso, y era el más repetido: el spinner suelto. Antes cada
 * pantalla escribía su propio `<Loader2 className="w-8 h-8 animate-spin" />` o su
 * propio `<div className="animate-spin rounded-full border-b-2" />`, en tres
 * tamaños, tres colores y cinco ritmos verticales distintos según el archivo. Dos
 * pantallas esperando lo mismo no se veían igual, y no había forma de cambiar las
 * catorce de una vez.
 *
 * Este archivo es ese tercer caso. El indicador es uno solo (`Spinner`), el bloque
 * que lo centra en la pantalla es uno solo (`BloqueCarga`) y el texto que lo
 * acompaña se pasa como prop en vez de duplicarse en el JSX.
 *
 * Dos decisiones que no son estéticas:
 *
 * - El texto visible es opcional y lo decide la pantalla. "Cargando cuadre…" dice
 *   algo que "Cargando..." no dice, así que no se escribe a mano: se pasa.
 * - El texto para lectores de pantalla no es opcional. Los `<div className=
 *   "animate-spin">` anteriores no tenían `role` ni etiqueta, así que un lector de
 *   pantalla no anunciaba nada; `Spinner` siempre la tiene.
 * - **El spinner no fija color.** Hereda el del texto que lo rodea, y por eso sirve
 *   tanto en el bloque de carga (que le pone el de marca) como dentro de un botón
 *   verde o de un encabezado oscuro. Los `Loader2` sueltos que había antes lo
 *   tenían forzado a `var(--brand-primary)`, que sobre un botón verde se veía mal:
 *   era el motivo de que el mismo spinner tuviera dos reglas de color según el
 *   archivo.
 */
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export type TamanoSpinner = 'xs' | 'sm' | 'md' | 'lg';

const TAMANOS: Record<TamanoSpinner, string> = {
  // `xs` existe porque cuatro botones de `Granjas.tsx` usaban `w-3.5` a mano: es un
  // tamaño que se notaba, así que se declara en vez de redondearlo a `sm`.
  xs: 'w-3.5 h-3.5',
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

export function Spinner({
  tamano = 'md',
  className,
  etiqueta = 'Cargando',
}: {
  tamano?: TamanoSpinner;
  className?: string;
  /** Texto para lectores de pantalla. No se pinta en pantalla a propósito. */
  etiqueta?: string;
}) {
  return (
    <Loader2
      role="status"
      aria-label={etiqueta}
      className={cn('animate-spin', TAMANOS[tamano], className)}
    />
  );
}

/**
 * `Spinner` con su texto al lado, para el caso de un indicador en línea que sí dice
 * algo ("Enviando…", "Confirmando…"). Es la forma en la que aparecen casi todos los
 * que viven dentro de un botón.
 */
export function SpinnerConTexto({
  children,
  tamano = 'sm',
  className,
}: {
  children: React.ReactNode;
  tamano?: TamanoSpinner;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Spinner tamano={tamano} />
      <span>{children}</span>
    </span>
  );
}

/**
 * Bloque de carga que ocupa la pantalla mientras llega el `fetch` principal.
 *
 * El ritmo vertical por defecto es `py-12`. Las pantallas que necesitan ocupar
 * toda la altura del móvil pasan `className="min-h-[60vh]"`; las de escritorio usan
 * el de por defecto, que es lo que hace el layout estable en vez de saltar cuando
 * el spinner desaparece.
 *
 * `PageLoader` (en `Skeleton.tsx`) es su versión con barras de esqueleto y texto
 * visible; esta es la mínima para cuando todavía no hay nada que esbozar. Las dos
 * usan el mismo spinner para que no parezcan pantallas distintas.
 */
export function BloqueCarga({
  texto,
  className,
  tamano = 'lg',
}: {
  /** Texto visible bajo el spinner. Opcional: no todas las pantallas saben qué cargan. */
  texto?: string;
  className?: string;
  tamano?: TamanoSpinner;
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 py-12', className)}
      role="status"
      aria-live="polite"
      data-testid="bloque-carga"
    >
      {/* El color va en el bloque y no en el spinner: es el bloque el que está sobre
          fondo de página y el que decide qué color de marca se ve aquí. */}
      <span style={{ color: 'var(--brand-primary)' }}>
        <Spinner tamano={tamano} />
      </span>
      {texto && <span className="text-sm text-neutral-500 dark:text-neutral-400">{texto}</span>}
    </div>
  );
}
