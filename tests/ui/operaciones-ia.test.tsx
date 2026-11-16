// @vitest-environment jsdom
/**
 * Fase 7 — el hub de Operaciones de escritorio, un nivel más abajo que el shell.
 *
 * `nav-config.test.ts` verifica la configuración pura y `nav-render.test.tsx`
 * comprueba que el shell dibuje las filas y monte un cuerpo por grupo. Este test
 * baja a los dos cuerpos que la fase cambió de verdad:
 *
 *  - `ResumenDelDia`, que hasta ahora era código muerto: el tab `resumen` que la
 *    configuración declaraba no lo montaba nadie.
 *  - `BodegaAdmin`, que perdió su fila interna. La fila vive ahora en el shell,
 *    así que la vista llega por props; esto es lo que falla si vuelve a decidir
 *    por su cuenta.
 *
 * No se sustituye ningún módulo con stubs: aquí el comportamiento prueba algo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResumenDelDia from '../../src/components/operaciones/ResumenDelDia';
import BodegaAdmin from '../../src/components/operaciones/BodegaAdmin';
import { ETIQUETA_TIPO_DIFERENCIA } from '../../src/lib/opcionesRecepcion';
import type { User } from '../../src/types';

const USUARIO: User = {
  id: 'u-admin', name: 'Admin', email: 'admin@granja.com', role: 'Admin', roles: ['Admin'],
};

/**
 * Respuesta con la forma de `GET /api/dashboard/enterprise`.
 *
 * Va completa, con los campos de dinero que esta pantalla ignora a propósito:
 * que el endpoint los devuelva igual es la razón por la que el pick operativo
 * tiene que leer por nombre de campo y no por posición.
 */
const EMPRESA = {
  ingresosHoy: 9_000_000,
  ingresosCobradosHoy: 3_200_000,
  gastosHoy: 2_000_000,
  utilidadNeta: 7_000_000,
  cuentasPorCobrar: 4_444_444,
  facturasEmitidas: 12,
  cartonesProducidos: 320,
  stockBodegaCentral: 1_500,
  totalAvesVivas: 48_300,
  clientesActivos: 37,
  rutasActivas: 6,
  vacunasVencidas: 2,
  mantenimientosVencidos: 1,
  desperdiciosHoy: 4,
  impactoDesperdicioHoy: 45_000,
  alertas: [],
};

const ok = (json: unknown) => ({
  ok: true, status: 200, statusText: 'OK', text: async () => '',
  json: async () => json,
});

/** Sustituye `fetch` por un router de URL a respuesta. */
const mockFetch = (rutas: Record<string, unknown>) => {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    for (const [prefijo, cuerpo] of Object.entries(rutas)) {
      if (u.includes(prefijo)) return ok(cuerpo);
    }
    // Lo que no este en el mapa responde vacío y bien: este test no verifica el
    // contenido de esos cuerpos, solo que no rompan el montaje.
    return ok([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/**
 * Forma de `GET /api/bodega/stock`: `kpis` con los contadores y los productos
 * agrupados por clave normalizada.
 *
 * Se declara copiando lo que devuelve el endpoint —incluida la `key`, que es la
 * que React usa para identificar cada producto en la lista— porque un
 * `json: async () => ({})` haría que BodegaAdmin leyera `productos.filter` sobre
 * `undefined` y el test reventaría por una razón que no tiene que ver con lo que
 * quiere comprobar.
 */
const STOCK_BODEGA = {
  kpis: { stockTotal: 1_500, etiquetas: 900, porEtiquetar: 600, porVencer: 0, vencidos: 0, lotes: 3, proximoSalir: null },
  productos: [
    {
      key: 'huevos-grande', producto: 'Huevos - Grande', unidad: 'cartones', total: 1_200,
      etiquetados: 800, agregado: 400, items: 5, lotes: 3,
      fechaVencimientoProxima: null, diasProximo: null, estado: 'sin-fecha',
    },
    {
      key: 'huevos-mediano', producto: 'Huevos - Mediano', unidad: 'cartones', total: 300,
      etiquetados: 100, agregado: 200, items: 2, lotes: 1,
      fechaVencimientoProxima: null, diasProximo: null, estado: 'sin-fecha',
    },
  ],
  colaFEFO: [],
};

const INVENTARIO = [
  { id: 'i1', producto: 'Huevos - Grande', cantidad: 1_200, unidad: 'cartones', ubicacion: 'Bodega Central' },
  { id: 'i2', producto: 'Huevos - Mediano', cantidad: 300, unidad: 'cartones', ubicacion: 'Bodega Central' },
];

const MOVIMIENTOS = [
  { id: 'm1', tipo: 'Ingreso', origen: 'Granja', destino: 'Bodega Central', producto: 'Huevos - Grande', cantidad: 500, fecha: '2027-03-02T08:00:00Z' },
  { id: 'm2', tipo: 'Salida', origen: 'Bodega Central', destino: 'Cliente', producto: 'Huevos - Grande', cantidad: 200, fecha: '2027-03-02T10:00:00Z' },
];

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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Resumen del día', () => {
  it('muestra los cinco números operativos del endpoint', async () => {
    mockFetch({ '/api/dashboard/enterprise': EMPRESA });
    render(<ResumenDelDia currentUser={USUARIO} />);

    await waitFor(() => expect(screen.getByTestId('operaciones-resumen')).toBeTruthy());
    const t = screen.getByTestId('operaciones-resumen').textContent ?? '';

    // Los separadores de millar dependen de los datos de ICU del Node donde corre
    // el test: acá `1 500`, en otro entorno `1.500`. Lo que importa es el número,
    // así que se acepta cualquier separador en vez de fijar el del mío.
    expect(t).toMatch(/320/);
    expect(t).toMatch(/1\D?500/);
    expect(t).toMatch(/48\D?300/);
    expect(t).toMatch(/Producción hoy/);
    expect(t).toMatch(/En bodega central/);
    expect(t).toMatch(/Aves vivas/);
    expect(t).toMatch(/Rutas activas/);
    expect(t).toMatch(/Desperdicios/);
  });

  it('ignora los números de dinero: esos los calcula Finanzas mejor', async () => {
    mockFetch({ '/api/dashboard/enterprise': EMPRESA });
    render(<ResumenDelDia currentUser={USUARIO} />);
    await waitFor(() => expect(screen.getByTestId('operaciones-resumen')).toBeTruthy());

    const t = screen.getByTestId('operaciones-resumen').textContent ?? '';
    // 9.000.000 de ingresos y 7.000.000 de utilidad no aparecen: son de
    // Finanzas › Resumen, y duplicarlos reabre la brecha que la Fase 3 cerró.
    expect(t).not.toContain('9.000.000');
    expect(t).not.toContain('7.000.000');
    expect(t).not.toContain('₡');
  });

  it('se oculta si falta un número, en vez de pintar cero', async () => {
    // Sin `cartonesProducidos` no se puede afirmar que hoy no se produjo nada. Un
    // cero ahí es una mentira operativa: en el resumen del día se lee como "hoy
    // no se produjo nada" cuando la verdad es "no se pudo saber".
    const { cartonesProducidos, ...incompleto } = EMPRESA;
    void cartonesProducidos;
    mockFetch({ '/api/dashboard/enterprise': incompleto });
    render(<ResumenDelDia currentUser={USUARIO} />);

    await waitFor(() => expect(screen.queryByTestId('operaciones-resumen')).toBeNull());
    expect(screen.getByText(/El resumen vino incompleto/i)).toBeTruthy();
  });

  it('un error del endpoint se muestra y se puede reintentar', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 503, statusText: 'Service Unavailable', text: async () => '',
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ResumenDelDia currentUser={USUARIO} />);

    await waitFor(() => expect(screen.getByText(/503/)).toBeTruthy());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(2));
  });

  it('pide el endpoint una sola vez al montar', async () => {
    const fetchMock = mockFetch({ '/api/dashboard/enterprise': EMPRESA });
    render(<ResumenDelDia currentUser={USUARIO} />);
    await waitFor(() => expect(screen.getByTestId('operaciones-resumen')).toBeTruthy());
    const llamadas = fetchMock.mock.calls.filter(c => String(c[0]).includes('/api/dashboard/enterprise'));
    expect(llamadas).toHaveLength(1);
  });
});

describe('BodegaAdmin dirigido por el shell', () => {
  const renderBodega = (vista: 'existencias' | 'control') => {
    const onVista = vi.fn();
    mockFetch({
      '/api/bodega/stock': STOCK_BODEGA,
      '/api/logistica/tablero': { guias: [] },
      '/api/operaciones/recepciones': [],
      '/api/etiquetas': [],
    });
    const v = render(
      <BodegaAdmin
        currentUser={USUARIO}
        inventario={INVENTARIO}
        movimientos={MOVIMIENTOS}
        onRefresh={() => {}}
        vista={vista}
        onVista={onVista}
      />,
    );
    return { onVista, ...v };
  };

  it('la vista la elige el shell, no el componente', async () => {
    const { container } = renderBodega('existencias');
    await waitFor(() => expect(screen.getByText('Stock total')).toBeTruthy());
    expect(container.textContent).toContain('Huevos - Grande');
  });

  it('no dibuja su propia fila de vistas', async () => {
    // La fila está en el shell, junto a la de los cinco grupos. Si BodegaAdmin la
    // volviera a dibujar, aparecerían dos filas que dicen lo mismo pero solo una
    // mueve el breadcrumb.
    const { container } = renderBodega('existencias');
    await waitFor(() => expect(screen.getByText('Stock total')).toBeTruthy());
    const botones = Array.from(container.querySelectorAll('button')).map(b => b.textContent?.trim() ?? '');
    expect(botones).not.toContain('Existencias');
    expect(botones).not.toContain('Control');
  });

  it('el botón "Registrar en Desperdicios" pide la vista de Control', async () => {
    const stockVencido = {
      ...STOCK_BODEGA,
      kpis: { ...STOCK_BODEGA.kpis, vencidos: 40 },
    };
    const onVista = vi.fn();
    mockFetch({
      '/api/bodega/stock': stockVencido,
      '/api/logistica/tablero': { guias: [] },
      '/api/operaciones/recepciones': [],
      '/api/etiquetas': [],
    });
    render(
      <BodegaAdmin
        currentUser={USUARIO}
        inventario={INVENTARIO}
        movimientos={MOVIMIENTOS}
        onRefresh={() => {}}
        vista="existencias"
        onVista={onVista}
      />,
    );

    const boton = await screen.findByRole('button', { name: /Registrar en Desperdicios/ });
    await userEvent.setup().click(boton);
    // No cambia sola: avisa al shell, que es quien sabe qué fila marcar.
    expect(onVista).toHaveBeenCalledWith('control');
  });

  it('la tarjeta de diferencia usa el rótulo canónico y nunca acusa', async () => {
    // El rótulo de esta tarjeta estaba hardcodeado y escrito en tres copias
    // distintas (tablero, BodegaAdmin y un mockup), así que cambiarlo en una no
    // cambiaba las otras. El test abre los dos caminos que dibuja BodegaAdmin y
    // falla si cualquiera vuelve al texto viejo.
    mockFetch({
      '/api/bodega/stock': STOCK_BODEGA,
      '/api/logistica/tablero': { guias: [] },
      '/api/operaciones/recepciones': [{
        id: 'rec-1',
        fechaRecepcion: '2026-10-01T12:00:00.000Z',
        cantidadEsperada: 100,
        cantidadRecibida: 60,
        diferencia: 40,
        motivoDiferencia: null,
        responsableRecepcion: 'Encargado Test',
        tipoDiferencia: 'alerta',
        esPosibleRobo: true,
      }],
      '/api/etiquetas': [],
    });
    const { container } = render(
      <BodegaAdmin
        currentUser={USUARIO}
        inventario={INVENTARIO}
        movimientos={MOVIMIENTOS}
        onRefresh={() => {}}
        vista="control"
        onVista={vi.fn()}
      />,
    );

    const titulo = await screen.findByText(ETIQUETA_TIPO_DIFERENCIA.alerta);
    expect(titulo).toBeTruthy();
    // El hecho sigue visible: el detalle trae el conteo.
    expect(container.textContent).toContain('40');
    // Ningún texto de la tarjeta puede acusar.
    expect(container.textContent).not.toMatch(/robo|robado|steal/i);
  });
});
