/**
 * Fase 8 cerró seis tarjetas KPI locales —`Reportes.KPI`, `Granjas.KPISimple`,
 * `Granjas.MiniStat`, `Granjas.MiniStatCard`, `BodegaAdmin.Kpi` y
 * `FinanzasResumen.Tarjeta`— que pintaban la misma idea con cajas, cuerpos de
 * letra y paletas distintas. Este es el único lugar donde se decide cómo se ve una
 * tarjeta KPI; las pantallas eligen y ya no redefinen nada.
 *
 * Los ejes que existen son los que de verdad variaban, y cada uno tiene una razón:
 *
 * - `variante` elige la FORMA. `pila` es etiqueta arriba del número, `fila` es un
 *   cuadro de icono a la izquierda con el texto a la derecha, y `plano` no tiene
 *   caja: es para una cifra que vive dentro de otra tarjeta.
 * - `superficie` elige si la caja se tiñe con el tono o se queda neutra y el color
 *   solo se aplica a la cifra. Son dos tratamientos que ya coexistían y no se
 *   deducen uno del otro.
 * - `tono` y `tamanoValor` eligen color y cuerpo porque las pantallas no estaban de
 *   acuerdo en ninguno de los dos: había `text-lg`, `text-xl`, `text-2xl` y
 *   `text-3xl` para la misma idea.
 * - `iconoPosicion` y `etiquetaPosicion` existen porque `pila` tenía tres
 *   colocaciones reales: cuadro junto a la etiqueta (`FinanzasResumen`), cuadro
 *   encima de la cifra con la etiqueta debajo (`Granjas`), y sin cuadro
 *   (`Reportes`). No es adorno: si se fija una sola, media pantalla cambia de
 *   lugar.
 * - `nivelEtiqueta` convierte la etiqueta en encabezado cuando la pantalla la
 *   necesita para su contorno. Por omisión es un `<p>`, que es lo correcto para
 *   una cifra suelta; `FinanzasResumen` la usa como `h3` y sus tests la buscan por
 *   rol de encabezado, así que bajarla a `<p>` rompía el contorno del documento.
 *
 * Dos cosas que NO se unificaron, a propósito:
 *
 * - **Las paletas.** `Granjas` usa las variables CSS de marca con `color-mix` y el
 *   resto usa pares explícitos de Tailwind para tema claro y oscuro. Forzar uno
 *   sobre el otro rompe el cambio de tema, así que la rampa trae las dos familias
 *   (`marca`, `marca-info`, `marca-acento` van por variable; el resto por clase).
 * - **El comparativo contra el periodo anterior.** Es lógica de dinero —qué
 *   variación es mala, y qué se muestra cuando el periodo anterior fue cero— y
 *   pertenece a la pantalla de finanzas, que lo compone en `children`.
 */
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { cn } from '../lib/utils';

export type TonoKpi = 'neutro' | 'info' | 'positivo' | 'negativo' | 'alerta' | 'acento' | 'marca' | 'marca-info' | 'marca-acento';
export type VarianteKpi = 'pila' | 'fila' | 'plano';
export type TamanoValorKpi = 'sm' | 'md' | 'lg' | 'xl';

type PaletaTono = {
  /** Caja teñida. Vacía en los tonos de marca: ahí el color va inline. */
  superficie: string;
  /**
   * Color del número, del cuadro del icono y de la etiqueta en superficie teñida.
   * Vacío en los tonos de marca, que resuelven el color por variable CSS.
   */
  valor: string;
  fondo?: string;
  color?: string;
};

const TONOS: Record<TonoKpi, PaletaTono> = {
  neutro: {
    superficie: 'border-neutral-200 dark:border-neutral-700',
    valor: 'text-neutral-900 dark:text-white',
  },
  info: {
    superficie: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700',
    valor: 'text-blue-700 dark:text-blue-300',
  },
  positivo: {
    superficie: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700',
    valor: 'text-emerald-700 dark:text-emerald-300',
  },
  negativo: {
    superficie: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700',
    valor: 'text-red-700 dark:text-red-300',
  },
  alerta: {
    superficie: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700',
    valor: 'text-amber-700 dark:text-amber-300',
  },
  acento: {
    superficie: 'bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-700',
    valor: 'text-purple-700 dark:text-purple-300',
  },
  // Los tres de marca conservan el sistema de variables CSS que ya usaba `Granjas`:
  // el tinte es `color-mix` sobre la variable, así la tarjeta sigue al tema.
  marca: {
    superficie: 'border-stone-200/60 dark:border-neutral-700/40',
    valor: '',
    fondo: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)',
    color: 'var(--text-primary)',
  },
  'marca-info': {
    superficie: 'border-stone-200/60 dark:border-neutral-700/40',
    valor: '',
    fondo: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)',
    color: 'var(--text-primary)',
  },
  'marca-acento': {
    superficie: 'border-stone-200/60 dark:border-neutral-700/40',
    valor: '',
    fondo: 'color-mix(in srgb, var(--brand-accent) 8%, transparent)',
    color: 'var(--text-primary)',
  },
};

/** Cuerpo por defecto de cada forma. */
const VALOR_POR_VARIANTE: Record<VarianteKpi, TamanoValorKpi> = {
  pila: 'lg',
  fila: 'lg',
  plano: 'sm',
};

const CUERPO_VALOR: Record<TamanoValorKpi, string> = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-2xl',
  xl: 'text-3xl',
};

export function TarjetaKpi({
  etiqueta,
  valor,
  icono: Icono,
  variante = 'pila',
  superficie = 'neutra',
  tono = 'neutro',
  tamanoValor,
  iconoPosicion = 'encabezado',
  etiquetaPosicion = 'arriba',
  nivelEtiqueta,
  unidad,
  ayuda,
  tonoIcono,
  className,
  children,
}: {
  etiqueta: string;
  valor: ReactNode;
  icono?: ComponentType<{ className?: string }>;
  variante?: VarianteKpi;
  superficie?: 'tono' | 'neutra';
  tono?: TonoKpi;
  tamanoValor?: TamanoValorKpi;
  /** Solo en `pila`: el cuadro del icono junto a la etiqueta o encima de la cifra. */
  iconoPosicion?: 'encabezado' | 'arriba';
  /** Solo en `pila`: si la etiqueta va sobre la cifra o debajo. */
  etiquetaPosicion?: 'arriba' | 'abajo';
  /** 2-6 para que la etiqueta sea un encabezado; por omisión es un `<p>`. */
  nivelEtiqueta?: 2 | 3 | 4 | 5 | 6;
  /** Sufijo del número ("cartones", "aves"). */
  unidad?: ReactNode;
  /** Línea de apoyo bajo la cifra. */
  ayuda?: ReactNode;
  /**
   * Color del cuadro del icono. Existe porque `BodegaAdmin` tiñe sus cinco
   * tarjetas por categoría y no por significado: son matices decorativos, no un
   * token semántico, y traducirlos sería rediseñar esa pantalla.
   */
  tonoIcono?: string;
  className?: string;
  /** Ranura de pie, para lo que la pantalla sepa del KPI y el componente no. */
  children?: ReactNode;
}) {
  const t = TONOS[tono];
  const cuerpo = CUERPO_VALOR[tamanoValor ?? VALOR_POR_VARIANTE[variante]];
  // El tinte de marca va inline porque sale de una variable CSS; el resto de tonos
  // lo resuelven clases con su par claro/oscuro.
  const estilo: CSSProperties | undefined = t.fondo ? { background: t.fondo } : undefined;

  // En superficie teñida la etiqueta es el mismo tono del número, más apagado: el
  // color lo pone la caja, no el texto. En superficie neutra va en gris, y la
  // variante `fila` lo baja un paso porque ahí comparte línea con la cifra.
  const etiquetaCls = cn(
    'font-bold uppercase',
    variante === 'pila' ? 'text-[10px]' : 'text-[10px] tracking-wide truncate',
    superficie === 'tono' && t.valor
      ? cn(t.valor || 'text-primary', 'tracking-wider')
      : variante === 'fila' ? 'text-neutral-400' : 'text-neutral-500 dark:text-neutral-400',
  );

  const numero = (
    <p className={cn('font-black', cuerpo, variante !== 'fila' && t.valor)} style={t.color ? { color: t.color } : undefined}>
      {valor}
      {unidad && <span className="text-xs font-medium text-neutral-500 ml-1">{unidad}</span>}
    </p>
  );

  // La etiqueta es un encabezado cuando la pantalla la usa para su contorno, y un
  // parrafo cuando es solo el nombre de una cifra.
  const Etiqueta = (nivelEtiqueta ? `h${nivelEtiqueta}` : 'p') as 'p' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

  const cuadroIcono = !Icono ? null : (
    <div
      className={cn(
        'shrink-0 flex items-center justify-center',
        variante === 'fila' ? 'w-10 h-10 rounded-xl' : 'p-2 rounded-lg',
        tonoIcono || cn('bg-neutral-100 dark:bg-neutral-700', t.valor),
      )}
    >
      <Icono className={cn('w-5 h-5', variante === 'fila' && !tonoIcono && 'text-neutral-600 dark:text-neutral-300')} />
    </div>
  );

  if (variante === 'plano') {
    return (
      <div className={className}>
        {numero}
        <p className="text-[9px] font-bold uppercase text-stone-400">{etiqueta}</p>
        {children}
      </div>
    );
  }

  const caja = cn(
    'rounded-2xl border',
    variante === 'pila' ? 'p-4' : 'p-3 flex items-center gap-3',
    superficie === 'tono' ? t.superficie : cn('bg-white dark:bg-neutral-800', t.superficie),
    className,
  );

  const pie = (
    <>
      {children}
      {ayuda && <p className="text-[10px] text-neutral-400 mt-1">{ayuda}</p>}
    </>
  );

  if (variante === 'fila') {
    return (
      <div className={caja} style={estilo}>
        {cuadroIcono}
        <div className="min-w-0">
          <Etiqueta className={etiquetaCls}>{etiqueta}</Etiqueta>
          {numero}
          {ayuda && <p className="text-[10px] text-neutral-400 truncate">{ayuda}</p>}
          {children}
        </div>
      </div>
    );
  }

  // `pila`. Con la etiqueta debajo, el cuadro del icono va encima de la cifra y no
  // hay fila de encabezado: es el orden que ya usan las tarjetas de `Granjas`.
  if (etiquetaPosicion === 'abajo') {
    return (
      <div className={caja} style={estilo}>
        {cuadroIcono}
        {numero}
        <Etiqueta className={cn(etiquetaCls, 'mt-0.5')}>{etiqueta}</Etiqueta>
        {pie}
      </div>
    );
  }

  return (
    <div className={caja} style={estilo}>
      {Icono ? (
        <div className="flex items-start justify-between gap-3">
          <Etiqueta className={etiquetaCls}>{etiqueta}</Etiqueta>
          {cuadroIcono}
        </div>
      ) : (
        <p className={etiquetaCls}>{etiqueta}</p>
      )}
      {numero}
      {pie}
    </div>
  );
}
