// @vitest-environment jsdom
/**
 * Fase 0 — cobertura de la arquitectura de información tal como se renderiza.
 *
 * `tests/nav-config.test.ts` verifica la configuración pura. Este verifica que
 * `App.tsx` la consume de verdad: qué módulos muestra el sidebar de cada rol,
 * qué filas de tabs aparecen, y cuál queda resaltado.
 *
 * Los módulos hijos se sustituyen por stubs. El objetivo es probar el shell de
 * navegación, no el contenido de cada pantalla: atarlo a la forma de las
 * respuestas de `/api/*` haría que el test se rompiera con cada endpoint nuevo.
 *
 * Antes de esta fase la suite era 100% HTTP, de modo que reordenar tabs o
 * cambiar un permiso dejaba los 345 tests en verde con la interfaz rota.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Role, User } from '../../src/types';

/**
 * Rutas relativas a ESTE archivo de test: `vi.doMock` no resuelve los módulos
 * desde quien los importa, sino desde quien los sustituye.
 */
const MODULOS_APLICACION = [
  'Login', 'Clientes', 'Facturacion', 'Logistica', 'CajaRuta', 'TableroRutas',
  'Cobranza', 'Granjas', 'Finanzas', 'Etiquetas', 'Pesos', 'DashboardEnterprise',
  'SaludAvicola', 'Alimento', 'Mantenimiento', 'Precios', 'Admin', 'Office',
  'Reportes',
  'operaciones', 'operaciones/BodegaAdmin',
  'DespachoMovil', 'BodegaMovil', 'CamioneroMovil', 'IncidentesMovil',
  // ErrorBoundary NO se sustituye a propósito: forma parte del shell y su
  // comportamiento (contener el fallo de un módulo) es lo que se quiere observar.
].map(n => `../../src/components/${n}`);

for (const ruta of MODULOS_APLICACION) {
  // `vi.doMock` y no `vi.mock`: dentro de un bucle, el hoisting de `vi.mock`
  // sacaría la llamada fuera del bucle y `ruta` sería undefined.
  vi.doMock(ruta, () => {
    const Stub = () => <div data-testid="stub-modulo" />;
    Stub.displayName = 'StubModulo';
    return { default: Stub };
  });
}

const App = (await import('../../src/App')).default;

function usuario(role: Role, roles?: Role[]): User {
  return { id: `u-${role}`, name: `Usuario ${role}`, email: `${role}@granja.com`, role, roles };
}

const renderComo = (role: Role, roles?: Role[]) => {
  sessionStorage.setItem('gdp_session_tab', JSON.stringify({ token: 't', user: usuario(role, roles) }));
  return render(<App />);
};

/** Etiquetas de los botones de módulo del sidebar de escritorio, en orden. */
const modulosDelSidebar = (): string[] => {
  const aside = document.querySelector('aside');
  expect(aside, 'el sidebar de escritorio debe existir').toBeTruthy();
  return Array.from(aside!.querySelectorAll('[data-modulo-id]')).map(el => el.textContent?.trim() ?? '');
};

/** Tabs renderizados en la vista actual, con su estado activo. */
const tabsRenderizados = (): { id: string; activo: boolean }[] =>
  Array.from(document.querySelectorAll('[data-testid="nav-tabs"] [data-tab-id]')).map(el => ({
    id: el.getAttribute('data-tab-id')!,
    activo: el.getAttribute('aria-current') === 'page',
  }));

const idsDeTabs = (): string[] => tabsRenderizados().map(t => t.id);

const etiquetasDeTabs = (): string[] =>
  Array.from(document.querySelectorAll('[data-testid="nav-tabs"] [data-tab-id]')).map(
    el => (el.textContent ?? '').trim(),
  );

const tabsActivos = (): string[] =>
  idsDeTabs().filter((_, i) => tabsRenderizados()[i].activo);

const bandasDeTabs = (): string[] =>
  Array.from(document.querySelectorAll('[data-testid="nav-tabs"]')).map(el => el.getAttribute('data-banda') ?? '');

const textoDelModuloActual = (): string =>
  (document.querySelector('main')?.textContent ?? '').trim();

/** Los dos tramos del breadcrumb, o `null` si la vista no lo muestra. */
const breadcrumb = (): string[] | null => {
  const main = document.querySelector('main')!;
  const el = Array.from(main.children).find(c => c.className.includes('text-xs') && c.className.includes('font-medium'));
  if (!el) return null;
  return Array.from(el.children)
    .map(c => (c.textContent ?? '').trim())
    .filter(t => t.length > 0);
};

const abrirModulo = async (nombre: string) => {
  const user = userEvent.setup();
  const botones = within(document.querySelector('aside')!).getAllByRole('button', { name: nombre });
  await user.click(botones[0]);
};

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

describe('sidebar por rol', () => {
  it('Admin ve los 8 módulos', () => {
    renderComo('Admin');
    expect(modulosDelSidebar()).toEqual([
      'Centro de Mando', 'Finanzas', 'Granja', 'Admin', 'Office', 'Operaciones y Bodegas', 'Logística', 'Clientes',
    ]);
  });

  it('Socio ve solo 3 módulos', () => {
    renderComo('Socio');
    expect(modulosDelSidebar()).toEqual(['Centro de Mando', 'Finanzas', 'Office']);
  });

  it('Comercial ve Office, Operaciones, Logística y Clientes', () => {
    renderComo('Comercial');
    expect(modulosDelSidebar()).toEqual(['Office', 'Operaciones y Bodegas', 'Logística', 'Clientes']);
  });

  it('un Bodeguero solo ve su módulo móvil, con etiqueta propia', () => {
    renderComo('Bodeguero');
    expect(modulosDelSidebar()).toEqual(['Recepción']);
  });

  it('un Despachador entra como "Carga a Bodega"', () => {
    renderComo('Despachador');
    expect(modulosDelSidebar()).toEqual(['Carga a Bodega']);
  });

  it('un Camionero entra como "Confirmar Cargas"', () => {
    renderComo('Camionero');
    expect(modulosDelSidebar()).toEqual(['Confirmar Cargas']);
  });

  it('un Bodeguero que además es Admin vuelve al hub de escritorio', () => {
    renderComo('Bodeguero', ['Bodeguero', 'Admin']);
    const mods = modulosDelSidebar();
    expect(mods).toContain('Operaciones y Bodegas');
    expect(mods).toContain('Granja');
    expect(mods).not.toContain('Recepción');
  });
});

describe('módulo de entrada por defecto', () => {
  it('Admin entra al Centro de Mando', () => {
    renderComo('Admin');
    expect(screen.getAllByTestId('stub-modulo')).toHaveLength(1);
  });

  it('Socio aterriza en Logística pese a no tenerlo en el sidebar: defecto preexistente', () => {
    renderComo('Socio');
    // Defecto preexistente (Fase 1): `moduloPorDefecto(['Socio'])` devuelve
    // `logistica`, pero Logística no está en el sidebar de un Socio. La vista
    // renderiza con su breadcrumb, pero no hay entrada que permita cambiarla.
    expect(breadcrumb()).toEqual(['Logística', 'Logística']);
    expect(modulosDelSidebar()).not.toContain('Logística');
    expect(screen.getAllByTestId('stub-modulo')).toHaveLength(1);
  });

  it('Comercial entra a Logística por Caja Ruta', async () => {
    renderComo('Comercial');
    await abrirModulo('Logística');
    expect(tabsActivos()).toEqual(['caja']);
  });

  it('un Bodeguero entra directo al camino móvil', () => {
    renderComo('Bodeguero');
    expect(screen.getAllByTestId('stub-modulo').length).toBeGreaterThan(0);
  });
});

describe('tabs de Finanzas', () => {
  it('Admin ve Flujo, Cobranza y Reportes con Flujo activo', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(idsDeTabs()).toEqual(['flujo', 'cobranza', 'reportes']);
    expect(tabsActivos()).toEqual(['flujo']);
  });

  it('Socio solo ve Reportes', async () => {
    renderComo('Socio');
    await abrirModulo('Finanzas');
    expect(idsDeTabs()).toEqual(['reportes']);
  });

  it('cambiar de tab marca solo ese tab como activo', async () => {
    const user = userEvent.setup();
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await user.click(document.querySelector('[data-tab-id="cobranza"]')!);
    expect(tabsActivos()).toEqual(['cobranza']);
  });
});

describe('tabs de Logística', () => {
  it('Admin ve las tres bandas', async () => {
    renderComo('Admin');
    await abrirModulo('Logística');
    expect(bandasDeTabs()).toEqual(['primario', 'secundario', 'terciario']);
    expect(idsDeTabs()).toEqual([
      'logistica', 'guias', 'remisiones', 'caja', 'tablero',
      'facturacion', 'etiquetas', 'pesos', 'precios',
    ]);
  });

  it('Admin entra por la vista principal de Logística', async () => {
    renderComo('Admin');
    await abrirModulo('Logística');
    expect(tabsActivos()).toEqual(['logistica']);
  });

  it('Comercial ve dos bandas: sin configuración', async () => {
    renderComo('Comercial');
    await abrirModulo('Logística');
    expect(bandasDeTabs()).toEqual(['primario', 'secundario']);
    expect(idsDeTabs()).toEqual(['logistica', 'guias', 'remisiones', 'caja', 'tablero', 'facturacion']);
  });

  it('las etiquetas coinciden con el modelo del boceto', async () => {
    renderComo('Admin');
    await abrirModulo('Logística');
    expect(etiquetasDeTabs()).toContain('Facturación');
    expect(etiquetasDeTabs()).toContain('Control Pesos');
  });
});

describe('tabs de Granja', () => {
  it('Granja ofrece sus cuatro vistas', async () => {
    renderComo('Admin');
    await abrirModulo('Granja');
    expect(idsDeTabs()).toEqual(['granjas', 'salud', 'alimento', 'mantenimiento']);
    expect(tabsActivos()).toEqual(['granjas']);
  });
});

describe('módulos con navegación propia', () => {
  it('Office no usa la fila de tabs global', async () => {
    renderComo('Admin');
    await abrirModulo('Office');
    expect(tabsRenderizados()).toEqual([]);
    expect(screen.getAllByTestId('stub-modulo')).toHaveLength(1);
  });

  it('Admin tampoco: dibuja sus propios tabs y recibe initialTab', async () => {
    renderComo('Admin');
    await abrirModulo('Admin');
    expect(tabsRenderizados()).toEqual([]);
    expect(screen.getAllByTestId('stub-modulo')).toHaveLength(1);
  });

  // La fila de Admin todavía no la dibuja la configuración: vive dentro de
  // Admin.tsx. La Fase 6 la conecta, cuando Vinculaciones salga de ahí.
  it('pendiente: Admin aún no consume SUBTABS_ADMIN', () => {
    expect(idsDeTabs()).toEqual([]);
  });
});

describe('camino móvil de Operaciones', () => {
  it('un Despachador ve Carga e Incidencias, con Carga activa', () => {
    renderComo('Despachador');
    expect(idsDeTabs()).toEqual(['carga', 'incidencias']);
    expect(tabsActivos()).toEqual(['carga']);
  });

  it('un Camionero no ve fila de tabs: tiene una sola vista', () => {
    renderComo('Camionero');
    expect(tabsRenderizados()).toEqual([]);
  });

  it('un Bodeguero tampoco ve fila de tabs', () => {
    renderComo('Bodeguero');
    expect(tabsRenderizados()).toEqual([]);
  });

  it('un Bodeguero con también Despachador ve ambas filas, en el orden de sus roles', () => {
    renderComo('Bodeguero', ['Bodeguero', 'Despachador']);
    expect(idsDeTabs()).toEqual(['recibir', 'carga', 'incidencias']);
  });

  it('la etiqueta del sidebar no aparece en la barra inferior de escritorio', () => {
    renderComo('Despachador');
    const nav = document.querySelector('nav.lg\\:hidden');
    expect(nav?.textContent).toContain('Ops');
  });
});

describe('breadcrumbs', () => {
  it('el Centro de Mando no muestra breadcrumb', () => {
    renderComo('Admin');
    expect(textoDelModuloActual()).toBe('');
  });

  it('Finanzas muestra módulo y tab activo en el breadcrumb', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(breadcrumb()).toEqual(['Finanzas', 'Flujo de Caja']);
  });

  it('el breadcrumb sigue al tab que se elige', async () => {
    const user = userEvent.setup();
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await user.click(document.querySelector('[data-tab-id="cobranza"]')!);
    expect(breadcrumb()).toEqual(['Finanzas', 'Cuentas por Cobrar']);
  });

  it('el hub de Operaciones no muestra el sub-tab en el breadcrumb', async () => {
    renderComo('Admin');
    await abrirModulo('Operaciones y Bodegas');
    expect(breadcrumb()).toEqual(['Operaciones y Bodegas']);
  });
});
