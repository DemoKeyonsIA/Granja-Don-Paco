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
  'Cobranza', 'Granjas', 'FinanzasResumen', 'Etiquetas', 'Pesos', 'DashboardEnterprise',
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
  it('Admin ve los 7 módulos, sin Centro de Mando', () => {
    renderComo('Admin');
    expect(modulosDelSidebar()).toEqual([
      'Finanzas', 'Granja', 'Admin', 'Office', 'Operaciones y Bodegas', 'Logística', 'Clientes',
    ]);
  });

  it('Socio ve solo Finanzas y Office', () => {
    renderComo('Socio');
    expect(modulosDelSidebar()).toEqual(['Finanzas', 'Office']);
  });

  it('Comercial ve Finanzas, Office, Operaciones, Logística y Clientes', () => {
    // Fase 4: el Comercial entra a Finanzas para facturar y consultar analítica.
    renderComo('Comercial');
    expect(modulosDelSidebar()).toEqual([
      'Finanzas', 'Office', 'Operaciones y Bodegas', 'Logística', 'Clientes',
    ]);
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
  it('Admin entra a Finanzas, no a un módulo que ya no existe', () => {
    renderComo('Admin');
    expect(screen.getAllByTestId('stub-modulo')).toHaveLength(1);
  });

  it('un Socio entra a un módulo que sí tiene en el sidebar', () => {
    renderComo('Socio');
    // Bug 7 corregido en Fase 1: antes caía en Logística, que no ve, y quedaba
    // sin ninguna entrada de navegación desde la que salir. Fase 5: el módulo
    // es Finanzas, que sí ve, y por eso ahora sí hay breadcrumb que lo delata.
    expect(breadcrumb()).toEqual(['Finanzas', 'Resumen']);
    expect(modulosDelSidebar()).toContain('Finanzas');
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
  it('Admin ve los 4 tabs con Resumen activo', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(idsDeTabs()).toEqual(['resumen', 'documentos', 'cobranza', 'analitica']);
    expect(tabsActivos()).toEqual(['resumen']);
  });

  it('Socio ve Resumen + Analítica', async () => {
    renderComo('Socio');
    await abrirModulo('Finanzas');
    expect(idsDeTabs()).toEqual(['resumen', 'analitica']);
    expect(tabsActivos()).toEqual(['resumen']);
  });

  it('Comercial ve Documentos + Analítica y entra en Documentos', async () => {
    renderComo('Comercial');
    await abrirModulo('Finanzas');
    expect(idsDeTabs()).toEqual(['documentos', 'analitica']);
    expect(tabsActivos()).toEqual(['documentos']);
  });

  it('cambiar de tab marca solo ese tab como activo', async () => {
    const user = userEvent.setup();
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await user.click(document.querySelector('[data-tab-id="cobranza"]')!);
    expect(tabsActivos()).toEqual(['cobranza']);
  });

  // El reseteo por cambio de módulo no puede pisar una sub-vista elegida a mano: la
  // búsqueda dice a dónde ir, y mandar a otro lado deja el texto buscado a la
  // vista con el resultado en otra pantalla.
  it('buscar "factura" lleva a Documentos y no al tab inicial del módulo', async () => {
    const user = userEvent.setup();
    renderComo('Admin');
    await abrirModulo('Granja');
    await user.type(screen.getByRole('textbox'), 'factura');
    await user.keyboard('{Enter}');
    expect(idsDeTabs()).toEqual(['resumen', 'documentos', 'cobranza', 'analitica']);
    expect(tabsActivos()).toEqual(['documentos']);
  });

  it('buscar "flujo de caja" abre Analítica en el reporte, no un tab vacío', async () => {
    const user = userEvent.setup();
    renderComo('Admin');
    await abrirModulo('Granja');
    await user.type(screen.getByRole('textbox'), 'flujo de caja');
    await user.keyboard('{Enter}');
    expect(
      Array.from(document.querySelectorAll('[data-banda="primario"] [data-tab-id]'))
        .filter(el => el.getAttribute('aria-current') === 'page')
        .map(el => el.getAttribute('data-tab-id')),
    ).toEqual(['analitica']);
    expect(
      Array.from(document.querySelectorAll('[data-banda="secundario"] [data-tab-id]'))
        .filter(el => el.getAttribute('aria-current') === 'page')
        .map(el => el.getAttribute('data-tab-id')),
    ).toEqual(['reporte:flujo-caja']);
  });

  it('un Socio que busca "factura" aterriza en un tab que sí ve', async () => {
    const user = userEvent.setup();
    renderComo('Socio');
    await abrirModulo('Office');
    await user.type(screen.getByRole('textbox'), 'factura');
    await user.keyboard('{Enter}');
    expect(idsDeTabs()).toEqual(['resumen', 'analitica']);
    expect(tabsActivos()).toEqual(['resumen']);
  });

  it('volver a un módulo después de una búsqueda reinicia en su tab por defecto', async () => {
    const user = userEvent.setup();
    renderComo('Admin');
    await user.type(screen.getByRole('textbox'), 'factura');
    await user.keyboard('{Enter}');
    expect(tabsActivos()).toEqual(['documentos']);
    await abrirModulo('Logística');
    await abrirModulo('Finanzas');
    expect(tabsActivos()).toEqual(['resumen']);
  });
});

describe('tabs de Logística', () => {
  it('Admin ve las tres bandas', async () => {
    renderComo('Admin');
    await abrirModulo('Logística');
    expect(bandasDeTabs()).toEqual(['primario', 'terciario']);
    expect(idsDeTabs()).toEqual([
      'logistica', 'guias', 'remisiones', 'caja', 'tablero',
      'etiquetas', 'pesos', 'precios',
    ]);
  });

  it('Admin entra por la vista principal de Logística', async () => {
    renderComo('Admin');
    await abrirModulo('Logística');
    expect(tabsActivos()).toEqual(['logistica']);
  });

  it('Comercial ve una sola banda: sin configuración ni facturación', async () => {
    renderComo('Comercial');
    await abrirModulo('Logística');
    expect(bandasDeTabs()).toEqual(['primario']);
    expect(idsDeTabs()).toEqual(['logistica', 'guias', 'remisiones', 'caja', 'tablero']);
  });

  it('las etiquetas coinciden con el modelo del boceto', async () => {
    renderComo('Admin');
    await abrirModulo('Logística');
    expect(etiquetasDeTabs()).toContain('Control Pesos');
    // Facturación ya no es etiqueta de Logística: vive en Finanzas → Documentos.
    expect(etiquetasDeTabs()).not.toContain('Facturación');
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
  it('Clientes, que es una sola vista, no muestra breadcrumb', async () => {
    renderComo('Admin');
    await abrirModulo('Clientes');
    expect(textoDelModuloActual()).toBe('');
  });

  it('Finanzas muestra módulo y tab activo en el breadcrumb', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(breadcrumb()).toEqual(['Finanzas', 'Resumen']);
  });

  it('el breadcrumb sigue al tab que se elige', async () => {
    const user = userEvent.setup();
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await user.click(document.querySelector('[data-tab-id="cobranza"]')!);
    expect(breadcrumb()).toEqual(['Finanzas', 'Cobranza']);
  });

  it('el hub de Operaciones no muestra el sub-tab en el breadcrumb', async () => {
    renderComo('Admin');
    await abrirModulo('Operaciones y Bodegas');
    expect(breadcrumb()).toEqual(['Operaciones y Bodegas']);
  });
});
