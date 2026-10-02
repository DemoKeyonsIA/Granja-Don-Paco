// @vitest-environment jsdom
/**
 * Fase 6 â€” Vinculaciones pasa de Admin al tercer espacio de Office.
 *
 * La mudanza tiene dos mitades y el test las ata:
 *
 *   1. La pantalla. `Office` monta `OfficeVinculos` dentro de su propia fila, y
 *      esa fila sale de `ESPACIOS_OFFICE` filtrada por rol. Un Socio o un
 *      Comercial no pueden ver el tab, y tampoco pueden llegar a la pantalla con
 *      `initialEspacio: 'vinculaciones'`: caerÃ­an en Correo. El filtro refleja
 *      `requireOfficeAdmin` del backend.
 *   2. La configuraciÃ³n. `SUBTABS_ADMIN` pierde el tab, y la fila que dibuja
 *      `Admin.tsx` se deriva de ese array. Antes cada uno mantenÃ­a su propia
 *      lista, que es justo por lo que Vinculaciones siguiÃ³ en Admin despuÃ©s de
 *      salir de la configuraciÃ³n.
 *
 * `Office` y `OfficeVinculos` no se sustituyen por stubs: lo que se prueba es
 * que se monten de verdad y que el fetch que corresponde sea el que corresponde.
 * Los mÃ³dulos ajenos a la fase sÃ­ van stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Role, User } from '../../src/types';
import { ESPACIOS_OFFICE, SUBTABS_ADMIN } from '../../src/nav/modulos';

// `Office` y `OfficeVinculos` quedan fuera del stub a propÃ³sito.
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

/** Registra cada URL pedida para poder afirmar quÃ© NO se llamÃ³. */
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
 * React monta y ejecuta los efectos de forma sÃ­ncrona, asÃ­ que la fila se puede
 * afirmar de inmediato. Lo que no alcanza es el resto: los `fetch` siguen
 * pendientes cuando el test termina, y al resolverse actualizan estado fuera de
 * `act`, lo que llena el stderr de avisos. No es un fallo, pero esconde los que
 * sÃ­ lo serÃ­an.
 */
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

const renderOffice = async (role: Role, roles?: Role[], initialEspacio?: 'correo' | 'documentos' | 'vinculaciones') => {
  const r = render(<Office currentUser={usuario(role, roles)} initialEspacio={initialEspacio} />);
  await flush();
  return r;
};

const renderAdmin = async () => {
  const r = render(<Admin currentUser={usuario('Admin')} />);
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
  it('Admin ve los tres, y Vinculaciones el Ãºltimo', async () => {
    mockFetch();
    await renderOffice('Admin');
    expect(idsEspacios()).toEqual(['correo', 'documentos', 'vinculaciones']);
    expect(espaciosVisibles()).toEqual(['Correo', 'Documentos', 'Vinculaciones']);
  });

  it.each(['Socio', 'Comercial'] as const)('%s ve solo Correo y Documentos', async (rol) => {
    mockFetch();
    await renderOffice(rol);
    expect(idsEspacios()).toEqual(['correo', 'documentos']);
    expect(document.body.textContent).not.toContain('Vinculaciones');
  });

  it('un Comercial con Admin como segundo rol sÃ­ ve Vinculaciones', async () => {
    // Los roles efectivos, no el principal: es el criterio que ya usa el sidebar
    // para decidir si el mÃ³dulo Admin es visible.
    mockFetch();
    await renderOffice('Comercial', ['Comercial', 'Admin']);
    expect(idsEspacios()).toEqual(['correo', 'documentos', 'vinculaciones']);
  });

  it('la fila usa los labels de la configuraciÃ³n, no unos escritos en el componente', async () => {
    const labels = ESPACIOS_OFFICE.map(e => e.label);
    mockFetch();
    await renderOffice('Admin');
    expect(espaciosVisibles()).toEqual(labels);
  });
});

describe('Vinculaciones dentro de Office', () => {
  it('Admin entra y ve las reglas, no la bandeja', async () => {
    mockFetch();
    await renderOffice('Admin', ['Admin'], 'vinculaciones');
    await waitFor(() => expect(screen.getByText('proveedores@gdp.cr')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Vinculaciones' })).toBeTruthy();
    // La pantalla de reglas, no la de correo.
    expect(screen.queryByText('Cuentas')).toBeNull();
    expect(screen.queryByText('Todas las remitentes')).toBeNull();
  });

  it('el breadcrumb nombra Office y Vinculaciones', async () => {
    mockFetch();
    await renderOffice('Admin', ['Admin'], 'vinculaciones');
    await waitFor(() => expect(screen.getByText('proveedores@gdp.cr')).toBeTruthy());
    const crumbs = screen.getByRole('navigation');
    expect(crumbs.textContent).toContain('Office');
    expect(crumbs.textContent).toContain('Vinculaciones');
  });

  it('no pide los recursos de la bandeja: ni cuentas, ni mensajes, ni documentos', async () => {
    // `Office` compartÃ­a una sola pantalla para Correo y Documentos, asÃ­ que al
    // entrar pedÃ­a las cinco cosas siempre. Montar las reglas no necesita ninguna.
    const llamadas = mockFetch();
    await renderOffice('Admin', ['Admin'], 'vinculaciones');
    await waitFor(() => expect(screen.getByText('proveedores@gdp.cr')).toBeTruthy());

    expect(urlLlamadas(llamadas)('/api/office/vinculaciones').length).toBeGreaterThan(0);
    for (const endpoint of ['/api/office/mensajes', '/api/office/documentos', '/api/office/arbol', '/api/office/resumen']) {
      expect(urlLlamadas(llamadas)(endpoint), endpoint).toEqual([]);
    }
    // `sembrarSiEstaVacio` dispara POST de cuentas si la bandeja estÃ¡ vacÃ­a.
    expect(urlLlamadas(llamadas)('/api/office/cuentas')).toEqual([]);
  });

  it('un Socio que pide el espacio directamente aterriza en Correo, no en un 403', async () => {
    // El shell resuelve el espacio antes de montar, pero `Office` se defiende por
    // su cuenta: si le pasan `vinculaciones` sin permiso, cae al primer visible.
    const llamadas = mockFetch();
    await renderOffice('Socio', undefined, 'vinculaciones');
    expect(idsEspacios()).toEqual(['correo', 'documentos']);
    expect(urlLlamadas(llamadas)('/api/office/vinculaciones')).toEqual([]);
  });

  it('al volver de Vinculaciones a Correo, la bandeja carga', async () => {
    // El efecto de carga distingue "cambiÃ© de espacio" de "cambiÃ³ el filtro". Si
    // solo mirara el espacio, volver a Correo dejarÃ­a la pantalla vacÃ­a.
    const llamadas = mockFetch();
    const user = userEvent.setup();
    await renderOffice('Admin', ['Admin'], 'vinculaciones');
    await waitFor(() => expect(screen.getByText('proveedores@gdp.cr')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Correo/ }));
    await waitFor(() => expect(urlLlamadas(llamadas)('/api/office/mensajes').length).toBeGreaterThan(0));
    // El botÃ³n de la cuenta concatena etiqueta y contador ("Proveedores1"), asÃ­
    // que se busca por fragmento y no por texto exacto.
    expect(screen.getByText(/Proveedores/)).toBeTruthy();
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

describe('Admin ya no tiene Vinculaciones', () => {
  it('su fila son los tres tabs de la configuraciÃ³n, en su orden', async () => {
    await renderAdmin();
    const fila = screen.getByTestId('admin-tabs');
    const labels = within(fila).getAllByRole('button').map(b => b.textContent?.trim() ?? '');
    expect(labels).toEqual(SUBTABS_ADMIN.map(t => t.label));
  });

  it('no monta la pantalla de reglas en ninguno de sus tabs', async () => {
    await renderAdmin();
    expect(document.body.textContent).not.toContain('Vinculaciones');
    expect(document.body.textContent).not.toContain('reglas de vinculaciÃ³n');
  });

  it('la descripciÃ³n ya no promete la funcionalidad que se mudÃ³', async () => {
    await renderAdmin();
    const texto = document.body.textContent ?? '';
    expect(texto).toContain('productos y cartones');
    expect(texto).not.toContain('vinculaciÃ³n');
  });
});
