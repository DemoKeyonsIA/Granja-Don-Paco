import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** En pantallas grandes, el contenedor puede volver al flujo normal. */
  enLineaEnEscritorio?: boolean;
  etiquetaAccesible?: string;
  className?: string;
}

/** Barra de acción principal consistente para tareas de campo en móvil. */
export default function AccionFijaMovil({
  children,
  enLineaEnEscritorio = false,
  etiquetaAccesible = 'Acción principal',
  className = '',
}: Props) {
  const escritorio = enLineaEnEscritorio
    ? 'lg:static lg:inset-auto lg:bottom-auto lg:z-auto lg:mx-auto lg:max-w-md lg:border-0 lg:px-0 lg:pt-0 lg:backdrop-blur-none'
    : 'lg:hidden';

  return (
    <div
      role="region"
      aria-label={etiquetaAccesible}
      className={`safe-area-pb fixed inset-x-0 bottom-[68px] z-30 border-t px-3 pt-2 backdrop-blur-lg ${escritorio} ${className}`}
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}
    >
      {children}
    </div>
  );
}
