// @vitest-environment jsdom
/**
 * Vinculaciones: está en Admin, no en Office.
 *
 * La mudanza tiene dos mitades y el test las ata:
 *
 *   1. La pantalla. `Admin` monta `OfficeVinculos` y su fila sale de
 *      `SUBTABS_ADMIN`. `Office` deja de tener el espacio: sus dos espacios son
 *      Correo y Documentos, y los tres roles que entran ven los mismos.
 *   2. La configuración. `ESPACIOS_OFFICE` pierde el tab, y la fila que dibuja
 *      `Admin.tsx` se deriva de `SUBTABS_ADMIN`. Cada pantalla mantiene una sola
 *      lista: antes cada una tenía la suya, que es justo por lo que Vinculaciones
 *      aparecía en un sitio que ya no la declaraba.
 *
 * El backend no se tocó: `/api/office/vinculaciones` sigue detrás de
 * `requireOfficeAdmin`. El prefijo `/api/office` describe el dominio (correo ↔
 * Drive), no dónde se administra la pantalla.
 *
 * `Office` y `OfficeVinculos` no se sustituyen por stubs: lo que se prueba es
 * que se monten de verdad y que el fetch que corresponde sea el que corresponde.
 * Los módulos ajenos sí van stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Role, User } from '../../src/types';
import { saveSession } from '../../src/lib/session';
import { ESPACIOS_OFFICE, SUBTABS_ADMIN } from '../../src/nav/modulos';

// `Office` y `OfficeVinculos` quedan fuera del stub a propósito.
const MODULOS_STUB = [
  'Login', 'Clientes', 'Cobranza', 'Granjas', 'Etiquetas', 'Pesos',
  'SaludAvicola', 'Alimento', 'Mantenimiento', 'Precios',
  'Logistica', 'CajaRuta', 'TableroRutas',
  'operaciones', 'operaciones/BodegaAdmin',
  'DespachoMovil', 'BodegaMovil', 'CamioneroMovil', 'IncidentesMovil',
].map(n => `../../src/components/${n}`);

for (const ruta of MODULOS_STUB) {
  vi.doMock(ruta, () => {
    const Stub = () => <div data-testid="stub-modulo" />;
    Stub.displayName = 'StubModulo';
    return { default: Stub };
  });
}

const Office = (await import('../../src/components/Office')).default;
const Admin = (await import('../../src/components/Admin')).default;

const REGLA = {
  id: 'r-1',
  nombreCuenta: 'proveedores@gdp.cr',
  carpeta: 'Drive/Finanzas/Proveedores',
  driveFolderId: null,
  criterioTipo: 'subject' as const,
  criterioValor: 'factura',
  automatico: 12,
  estado: 'Activa',
  fechaCreacion: '2027-04-01',
  archivos: 12,
  requiereAccion: false,
};

const CUENTA = {
  id: 'c-1', email: 'proveedores@gdp.cr', etiqueta: 'Proveedores', color: '#B8860B',
  provider: 'gmail', estado: 'ok', lastSync: '2027-04-01T10:00:00.000Z',
  mensajes: 5, sinLeer: 1,
};

/** Registra cada URL pedida para poder afirmar qué NO se llamó. */
const mockFetch = (vinculaciones: unknown = [REGLA]) => {
  const llamadas: string[] = [];
  const f = vi.fn(async (url: string) => {
    const u = String(url);
    llamadas.push(u);
    const ok = (json: unknown) => ({
      ok: true, status: 200, statusText: 'OK', json: async () => json, text: async () => '',
    });
    if (u.startsWith('/api/office/vinculaciones')) return ok(vinculaciones);
    if (u.startsWith('/api/office/cuentas')) return ok([CUENTA]);
    if (u.startsWith('/api/office/resumen')) {
      return ok({
        cuentas: 1, mensajes: 5, sinLeer: 1, documentos: 2, reglasActivas: 1, reglas: 1,
        cuentasSinCarpeta: 0, documentosHuerfanos: 0, ultimoSync: '2027-04-01T10:00:00.000Z',
      });
    }
    return ok([]);
  });
  vi.stubGlobal('fetch', f);
  return llamadas;
};

const usuario = (role: Role, roles?: Role[]): User => ({
  id: `u-${role}`, name: `Usuario ${role}`, email: `${role}@granja.com`, role, roles,
});

/**
 * Deja que las promesas que disparan los efectos de carga resuelvan dentro de
 * `act`.
 *
* React monta y ejecuta los efectos de forma síncrona, así que la fila se puede
  * afirmar de inmediato. Lo que no alcanza es el resto: los `fetch` siguen
  * pendientes cuando el test termina, y al resolverse actualizan estado fuera de
  * `act`, lo que llena el stderr de avisos. No es un fallo, pero esconde los que
  * sí lo serían.
 */
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

const renderOffice = async (role: Role, roles?: Role[], initialEspacio?: 'correo' | 'documentos' | 'vinculaciones') => {
  const r = render(<Office currentUser={usuario(role, roles)} initialEspacio={initialEspacio} />);
  await flush();
  return r;
};

const renderAdmin = async (tab?: 'productos' | 'infraestructura' | 'usuarios' | 'aprobaciones' | 'vinculaciones') => {
  const r = render(<Admin currentUser={usuario('Admin')} initialTab={tab} />);
  await flush();
  return r;
};

const renderAdminConUsuario = async (user: User, tab?: 'productos' | 'infraestructura' | 'usuarios' | 'aprobaciones' | 'vinculaciones') => {
  const r = render(<Admin currentUser={user} initialTab={tab} />);
  await flush();
  return r;
};

/** Ids de los espacios de la fila, en orden. */
const idsEspacios = () =>
  Array.from(document.querySelectorAll('[data-testid="office-espacios"] [data-espacio-id]'))
    .map(el => el.getAttribute('data-espacio-id')!);

/** Etiquetas de los espacios de la fila, en orden. */
const espaciosVisibles = () =>
  Array.from(document.querySelectorAll('[data-testid="office-espacios"] [data-espacio-id]'))
    .map(el => el.textContent?.trim() ?? '');

/** Id del espacio resaltado en la fila. */
const espacioActivo = () =>
  document.querySelector('[data-testid="office-espacios"] [aria-current="page"]')?.getAttribute('data-espacio-id') ?? null;

const urlLlamadas = (llamadas: string[]) => (fragmento: string) =>
  llamadas.filter(u => u.includes(fragmento));

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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('la fila de espacios de Office', () => {
  it('manda auth en cada llamada a la API de Office', async () => {
    // `requireOfficeViewer` -> `requirePermission('office','view')` ->
    // `resolveUsuario`, que solo acepta `Bearer` o `x-user-id` y no hay cookie. Con
    // `fetch` pelado todo `/api/office/*` devolvia 401 y la pantalla mostraba "No se
    // pudieron cargar las cuentas" aunque la bandeja estuviera sembrada. Nadie lo
    // notaba porque ningun test miraba los headers, y los otros modulos no fallan
    // igual: sus endpoints no exigen auth.
    mockFetch();
    saveSession({ token: 'token-admin-demo', user: usuario('Admin') });
    await renderOffice('Admin');
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const office = f.mock.calls.filter(([u]) => String(u).startsWith('/api/office/'));
    expect(office.length).toBeGreaterThan(0);
    for (const call of office) {
      const init = call[1];
      if (!init) continue; // Las llamadas GET usan los headers predeterminados de fetchOffice.
      const headers = (init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
      expect(headers['x-user-id']).toBe('u-Admin');
    }
  });

  it.each(['Admin', 'Socio', 'Comercial'] as const)('%s ve Correo y Documentos, y nada más', async (rol) => {
    mockFetch();
    await renderOffice(rol);
    expect(idsEspacios()).toEqual(['correo', 'documentos']);
    expect(espaciosVisibles()).toEqual(['Correo', 'Documentos']);
    expect(document.body.textContent).not.toContain('Vinculaciones');
  });

  it('un Comercial con Admin como segundo rol tampoco la ve en Office', async () => {
    // Los roles efectivos deciden qué módulos existen, no qué pantalla hay dentro
    // de Office. Office es la bandeja para todos; las reglas se administran en el
    // módulo Admin, que sí filtra por rol.
    mockFetch();
    await renderOffice('Comercial', ['Comercial', 'Admin']);
    expect(idsEspacios()).toEqual(['correo', 'documentos']);
  });

  it('la fila usa los labels de la configuración, no unos escritos en el componente', async () => {
    const labels = ESPACIOS_OFFICE.map(e => e.label);
    mockFetch();
    await renderOffice('Admin');
    expect(espaciosVisibles()).toEqual(labels);
  });
});

describe('Office ya no monta la pantalla de reglas', () => {
  it('un subTab heredado de cuando vivía ahí aterriza en Correo', async () => {
    // El shell resuelve el espacio antes de montar, pero `Office` se defiende por
    // su cuenta: si le pasan `vinculaciones`, cae al primer visible en vez de
    // pedir `/api/office/vinculaciones` y recibir un 403.
    const llamadas = mockFetch();
    await renderOffice('Admin', ['Admin'], 'vinculaciones');
    expect(idsEspacios()).toEqual(['correo', 'documentos']);
    expect(espacioActivo()).toBe('correo');
    expect(urlLlamadas(llamadas)('/api/office/vinculaciones')).toEqual([]);
  });

  it('la bandeja carga normal para Admin y la fila nombra Dirección y Correo', async () => {
    const llamadas = mockFetch();
    await renderOffice('Admin', ['Admin'], 'vinculaciones');
    await waitFor(() => expect(urlLlamadas(llamadas)('/api/office/mensajes').length).toBeGreaterThan(0));
    const crumbs = screen.getByRole('navigation');
    expect(crumbs.textContent).toContain('Dirección');
    expect(crumbs.textContent).toContain('Correo');
  });

  it('Cambiar entre Correo y Documentos no vuelve a pedir los cinco recursos', async () => {
    const llamadas = mockFetch();
    const user = userEvent.setup();
    await renderOffice('Admin', ['Admin'], 'correo');
    await waitFor(() => expect(urlLlamadas(llamadas)('/api/office/mensajes').length).toBeGreaterThan(0));

    const antes = llamadas.length;
    await user.click(screen.getByRole('button', { name: /Documentos/ }));
    await waitFor(() => expect(espacioActivo()).toBe('documentos'));
    expect(llamadas.length).toBe(antes);
  });
});

describe('Vinculaciones dentro de Admin', () => {
  it('la fila sigue los tabs declarados de Administración, en su orden', async () => {
    mockFetch();
    await renderAdmin();
    const fila = screen.getByTestId('admin-tabs');
    const labels = within(fila).getAllByRole('tab').map(b => b.textContent?.trim() ?? '');
    expect(labels).toEqual(SUBTABS_ADMIN.map(t => t.label));
  });

  it('no muestra ni carga aprobaciones para un usuario sin rol Admin', async () => {
    const llamadas = mockFetch();
    await renderAdminConUsuario(usuario('Comercial', ['Comercial']), 'aprobaciones');
    const fila = screen.getByTestId('admin-tabs');
    expect(within(fila).queryByRole('button', { name: /Aprobaciones/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Solicitudes por revisar' })).toBeNull();
    expect(llamadas.some(u => u.includes('/api/aprobaciones'))).toBe(false);
  });

  it('Admin entra y ve las reglas, no un producto del catálogo', async () => {
    mockFetch();
    await renderAdmin('vinculaciones');
    await waitFor(() => expect(screen.getByText('proveedores@gdp.cr')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Vinculaciones' })).toBeTruthy();
    // La pantalla de reglas, no la de productos.
    expect(screen.queryByText('Cuentas')).toBeNull();
    expect(screen.queryByText('Todas las remitentes')).toBeNull();
  });

  it('las reglas piden solo su endpoint, no la bandeja de Office', async () => {
    const llamadas = mockFetch();
    await renderAdmin('vinculaciones');
    await waitFor(() => expect(screen.getByText('proveedores@gdp.cr')).toBeTruthy());

    expect(urlLlamadas(llamadas)('/api/office/vinculaciones').length).toBeGreaterThan(0);
    for (const endpoint of ['/api/office/mensajes', '/api/office/documentos', '/api/office/arbol', '/api/office/resumen']) {
      expect(urlLlamadas(llamadas)(endpoint), endpoint).toEqual([]);
    }
  });

  it('la descripción del panel nombra la funcionalidad', async () => {
    mockFetch();
    await renderAdmin();
    const texto = document.body.textContent ?? '';
    expect(texto).toContain('productos');
    expect(texto).toContain('Vinculaciones');
  });
});
