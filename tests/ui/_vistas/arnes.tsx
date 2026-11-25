// @vitest-environment jsdom
/**
 * Arnés compartido para las pruebas de vistas.
 *
 * `finanzas-ia.test.tsx` y los demás tests de UI resuelven por su cuenta cómo
 * sembrar `sessionStorage`, sustituir `fetch` y limpiar. Eso está bien cuando cada
 * uno prueba una cosa; para un smoke que monta treinta vistas deja de estar bien,
 * porque cada vista repetida se lleva su propia copia de las reglas y el suite
 * empieza a fallar por motivos que no son del componente.
 *
 * Aquí vive lo que todas tienen en común:
 *
 *   1. Servir `tests/fixtures/vistas.json`, que son las respuestas REALES del
 *      servidor. Un `json: async () => ({})` invented deja pasar los errores que
 *      solo aparecen cuando el dato trae la forma que trae.
 *   2. Instalar una sesión para un rol.
 *   3. Capturar `console.error` / `console.warn`, que es donde se esconden las
 *      `key` duplicadas, los `useEffect` en bucle y los renders a medias: ninguno
 *      rompe la pantalla y todos son bugs.
 *   4. Contar los toasts por tipo, para poder afirmar "un aviso" y no "algún
 *      aviso" — que es lo que distingue un toast bien puesto de uno duplicado.
 */
import { expect, vi } from 'vitest';
import type { ComponentType } from 'react';
import { render, screen, cleanup, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fixturesJson from '../../fixtures/vistas.json';
import type { Role, User } from '../../../src/types';

const FIXTURES = fixturesJson as unknown as {
  endpoints: Record<string, { status: number; body: unknown }>;
};

export { FIXTURES, screen, within, userEvent };

/** Rol → id de usuario que el fixture sembró, para `x-user-id` y la sesión. */
export const USUARIOS: Record<string, string> = {
  Admin: 'u-admin',
  Vendedor: 'u-ven',
  Bodeguero: 'u-bod',
  Camionero: 'u-cam',
};

export type TipoToast = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  tipo: TipoToast;
  mensaje: string;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

/**
 * No se cuenta lo que `sonner` pinta: se cuenta lo que se **pidió** decir. El
 * `Toaster` real arrastra un `setTimeout` de autocierre por toast, así que leer su
 * DOM haría el test dependiente del reloj. Lo que importa para un smoke de avisos
 * es el par (tipo, mensaje).
 *
 * El mock va a nivel de módulo y no dentro de una función porque `vi.mock` se
 * hoistea al principio del archivo: puesto dentro de `instalarRed` se registraría
 * después de que el primer import del componente ya hubiera resuelto el `toast`
 * real, y el primer render contaría cero avisos sin avisar de nada.
 */
vi.mock('sonner', async () => {
  const real = await vi.importActual<typeof import('sonner')>('sonner');
  const pila: { tipo: string; mensaje: string }[] = [];
  (globalThis as any).__pilaToast = pila;
  const marca =
    (tipo: TipoToast) =>
    (msg: unknown, ...rest: unknown[]) => {
      pila.push({ tipo, mensaje: String(msg) });
      const fn = (real.toast as any)[tipo];
      return typeof fn === 'function' ? fn(msg, ...rest) : undefined;
    };
  return {
    ...real,
    Toaster: real.Toaster,
    toast: {
      ...real.toast,
      success: marca('success'),
      error: marca('error'),
      info: marca('info'),
      warning: marca('warning'),
      message: marca('info'),
    },
  };
});

const pilaToast = (): Toast[] => ((globalThis as any).__pilaToast as Toast[]) ?? [];

/** Los toasts emitidos desde la última limpieza. */
export const toasts = (): Toast[] => [...pilaToast()];

/** Solo los textos, sin tipo. */
export const mensajesToast = (): string[] => pilaToast().map(t => t.mensaje);

export const toastsDe = (tipo: TipoToast): string[] =>
  pilaToast().filter(t => t.tipo === tipo).map(t => t.mensaje);

/**
 * Textos que se dijeron más de una vez dentro de una misma acción.
 *
 * Es la forma más común de toast duplicado: el componente avisa del éxito, y el
 * refresco que dispara justo después vuelve a fallar y avisa del error — o dos
 * capas (la vista y el `+ Nuevo`) informan del mismo hecho.
 */
export const toastsDuplicados = (): string[] => {
  const cuenta = new Map<string, number>();
  for (const t of pilaToast()) cuenta.set(t.mensaje, (cuenta.get(t.mensaje) ?? 0) + 1);
  return [...cuenta.entries()].filter(([, n]) => n > 1).map(([m]) => m);
};

export function limpiarToasts() {
  pilaToast().splice(0, pilaToast().length);
}

// ---------------------------------------------------------------------------
// Red
// ---------------------------------------------------------------------------

function respuesta(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([]),
  } as unknown as Response;
}

/**
 * `fetch` servido desde el fixture.
 *
 * `escribir` permite alterar la respuesta de una escritura concreta, que es lo
 * que necesitan los tests de toast: para afirmar que una acción falla hay que
 * poder hacer que falle.
 */
export function instalarRed(opciones: {
  /** Cambia la respuesta de una escritura concreta. */
  escribir?: (url: string) => Response | null;
  /** Cambia la respuesta de una lectura concreta, por camino. */
  parchear?: Record<string, unknown>;
} = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const camino = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      const metodo = init?.method ?? 'GET';

      if (metodo !== 'GET') {
        const propia = opciones.escribir?.(camino);
        if (propia) return propia;
        return respuesta(200, { success: true });
      }

      // Un parche gana al fixture. Sirve para probar las ramas que el dataset
      // sembrado no produce: elaging se siembra con d60 en cero porque el negocio
      // no tiene cartera tan vieja, así que sin parchear esa banda solo se podría
      // comprobar que no aparece, nunca que aparece cuando debe.
      if (opciones.parchear && camino in opciones.parchear) {
        return respuesta(200, opciones.parchear[camino]);
      }

      const fixture = FIXTURES.endpoints[camino];
      if (fixture) return respuesta(fixture.status, fixture.body);

      // Lo que no está en el fixture devuelve vacío en vez de reventar: una vista
      // que pide un endpoint que este harness no conoce debe poder montarse y decir
      // "no hay datos", que también es un estado que hay que probar.
      return respuesta(200, []);
    }),
  );
}

/** Las URLs que la vista pidió, en orden. */
export const urlsPedidas = (): string[] =>
  (vi.mocked(fetch).mock.calls ?? []).map(c => String(c[0]));

// ---------------------------------------------------------------------------
// Ruido de consola
// ---------------------------------------------------------------------------

export interface Ruido {
  errores: string[];
  warns: string[];
}

let restaurar: (() => void) | null = null;

/**
 * Captura `console.error` / `console.warn` durante el test.
 *
 * React avisa por `console.error` de cosas que no rompen la pantalla: una `key`
 * repetida, un `useEffect` que se refresca solo, un estado actualizado durante el
 * render. Cada uno es un bug latente y, sin esta captura, el smoke los deja pasar
 * en silencio.
 */
export function capturarConsola(): Ruido {
  const ruido: Ruido = { errores: [], warns: [] };
  const e = console.error;
  const w = console.warn;
  console.error = (...a: unknown[]) => {
    ruido.errores.push(a.map(x => (typeof x === 'string' ? x : String(x))).join(' '));
  };
  console.warn = (...a: unknown[]) => {
    ruido.warns.push(a.map(x => (typeof x === 'string' ? x : String(x))).join(' '));
  };
  restaurar = () => {
    console.error = e;
    console.warn = w;
    restaurar = null;
  };
  return ruido;
}

export function restaurarConsola() {
  restaurar?.();
}

/**
 * Ruido que no es de la vista y que hay que filtrar antes de afirmar sobre él.
 *
 * React 19 adjunta el stack del componente a cada aviso, así que casi todo mensaje
 * de React trae `%s` y líneas `at ...`. Filtrar por eso conserva lo que el smoke
 * tiene que afirmar (el texto del aviso) y descarta el dónde estaba.
 */
export const avisosDeReact = (lineas: string[]): string[] =>
  lineas
    .map(l => l.replace(/%s/g, '').trim())
    .filter(l => l.length > 0)
    .filter(l => !/^\s*at\s/.test(l))
    .filter(l => !/React Router Future Flag/i.test(l));

// ---------------------------------------------------------------------------
// Sesión y montaje
// ---------------------------------------------------------------------------

export const usuario = (role: Role, roles?: Role[]): User => ({
  id: USUARIOS[role] ?? `u-${role}`,
  name: `Usuario ${role}`,
  email: `${role}@test.com`,
  role,
  roles,
});

/** Monta la app con una sesión para el rol dado. */
export function montarComo(App: ComponentType, role: Role, roles?: Role[]) {
  sessionStorage.setItem(
    'gdp_session_tab',
    JSON.stringify({ token: 't', user: usuario(role, roles) }),
  );
  return render(<App />);
}

/**
 * `matchMedia` no existe en jsdom y el shell lo consulta al montar para decidir el
 * modo oscuro inicial. Sin esto, la primera vista que lo toca revienta con
 * `matchMedia is not a function`, que es un falso positivo.
 */
export function instalarMatchMedia(opciones: { movil?: boolean } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: opciones.movil === true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/**
 * Deja asentar los `useEffect` y las peticiones que dispararon.
 *
 * Tiene que ir dentro de `act` por dos razones. La primera es comprobable: un
 * `setTimeout` a pelo deja las actualizaciones de estado de los `fetch` fuera del
 * ciclo de React, que responde con "An update to X inside a test was not wrapped
 * in act(...)" por cada una — y eso llena el buffer de `console.error` que este
 * arnés usa para detectar bugs de verdad, hasta taparlos. La segunda es que sin
 * `act` el assertion puede correr contra el estado de carga, y entonces el smoke
 * pasa siempre: habría que mirar el texto después del flush.
 */
export async function asentar() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 30));
  });
  await act(async () => {
    await new Promise(r => setTimeout(r, 0));
  });
  await waitFor(() => expect(screen.queryByTestId('module-loading')).toBeNull());
}

export function limpiar() {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  limpiarToasts();
  restaurarConsola();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

/** Etiquetas de los botones del sidebar, para diagnostics legibles. */
export const modulosVisibles = (): string[] =>
  Array.from(document.querySelectorAll('aside button')).map(b => (b.textContent ?? '').trim());

/** Abre un módulo del sidebar por su etiqueta visible. */
export async function abrirModulo(nombre: string) {
  const user = userEvent.setup();
  const aside = document.querySelector('aside');
  if (!aside) throw new Error('No hay sidebar: la app no montó el shell');
  const candidatos = within(aside).getAllByRole('button');
  // Admin ve el módulo renombrado como "Gastos"; Socio aún lo ve como
  // "Finanzas". El vendedor usa su acceso dedicado "Facturas" en la barra móvil.
  const boton = candidatos.find(b => (b.textContent ?? '').includes(nombre))
    ?? (nombre === 'Finanzas' ? candidatos.find(b => (b.textContent ?? '').includes('Gastos')) : undefined);
  if (boton) {
    await user.click(boton);
    return;
  }
  if (nombre === 'Finanzas') {
    const facturas = Array.from(document.querySelectorAll('button')).find(b => (b.textContent ?? '').trim() === 'Facturas');
    if (facturas) {
      await user.click(facturas);
      return;
    }
  }
  throw new Error(
    `El sidebar no tiene el módulo "${nombre}". Botones: ${candidatos
      .map(b => (b.textContent ?? '').trim())
      .filter(Boolean)
      .join(' | ')}`,
  );
}

/**
 * Hace clic en el elemento que lleva ese atributo con ese valor.
 *
 * El shell no es el único que navega, así que el atributo cambia: `data-tab-id`
 * para las bandas del shell, `data-espacio-id` para los espacios de Office. Antes
 * esto estaba fijo en `data-tab-id` y los tests de Office fallaban por una razón
 * que no tenía nada que ver con Office.
 */
export async function pulsarEn(atributo: string, valor: string) {
  const el = document.querySelector(`[${atributo}="${valor}"]`);
  if (!el) {
    const presentes = Array.from(document.querySelectorAll(`[${atributo}]`))
      .map(e => e.getAttribute(atributo)!)
      .join(', ');
    throw new Error(`No hay [${atributo}="${valor}"]. Presentes: ${presentes || '(ninguno)'}`);
  }
  await userEvent.setup().click(el);
}

/** Hace clic en el tab con ese id, esté en la banda que esté. */
export const irATab = (id: string) => pulsarEn('data-tab-id', id);

/** Hace clic en un espacio de Office. */
export const irAEspacio = (id: string) => pulsarEn('data-espacio-id', id);

/** El botón de "atrás" del shell, para comprobar que un tab no se pierde al volver. */
export async function volverAtras() {
  const user = userEvent.setup();
  const btn = document.querySelector('[data-testid="volver"]')
    ?? Array.from(document.querySelectorAll('button')).find(b => (b.textContent ?? '').trim() === 'Volver');
  if (!btn) throw new Error('No hay botón de volver');
  await user.click(btn);
}

export interface Tab {
  id: string;
  etiqueta: string;
  banda: string;
  activo: boolean;
}

/** Todos los tabs renderizados, con su banda y su estado. */
export const tabs = (): Tab[] =>
  Array.from(document.querySelectorAll('[data-tab-id]')).map(el => ({
    id: el.getAttribute('data-tab-id')!,
    etiqueta: (el.textContent ?? '').trim(),
    banda: el.closest('[data-banda]')?.getAttribute('data-banda') ?? 'primario',
    activo: el.getAttribute('aria-current') === 'page',
  }));

export const idsDeTabs = (): string[] => tabs().map(t => t.id);

export const tabActiva = (): string | null => tabs().filter(t => t.activo).map(t => t.id)[0] ?? null;

/** El texto de todo lo que la vista pintó, para afirmaciones de contenido. */
/**
 * El texto de todo lo que la vista pintó, para afirmaciones de contenido.
 *
 * Normaliza los espacios duros. `Intl.NumberFormat` con locale `es-CR` separa
 * los miles con U+00A0, así que `€1.234.567` llega al texto como `€1 234 567` y
 * cualquier regex escrito con un espacio normal no encuentra. Este helper es la
 * puerta de entrada del texto, y que salga limpio de aquí evita el clásico
 * "el test falla solo en la máquina del otro".
 */
export const textoVisible = (): string =>
  (document.body.textContent ?? '').replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/\s+/g, ' ');
