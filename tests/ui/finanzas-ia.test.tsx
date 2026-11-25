// @vitest-environment jsdom
/**
 * Fase 4 — la pantalla A→D: Resumen · Documentos · Cobranza · Analítica.
 *
 * `nav-config.test.ts` verifica la configuración pura y `nav-render.test.tsx` el
 * shell con módulos de prueba. Este test baja un nivel: qué pantalla real se
 * monta, qué dice, y sobre todo que el tab resaltado y el contenido que se ve
 * sean el mismo. Ese desajuste fue el bug 2 del plan — un rol aterrizaba en un
 * tab que no tenía seleccionado y leía la pantalla de otro sin saberlo.
 *
 * Los fetch se sustituyen por respuestas de `/api/finanzas/resumen` verdaderas
 * (misma forma que el endpoint) porque Resumen no calcula nada: si el contrato
 * cambia, el test debe romperse.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Role, User } from '../../src/types';

const MODULOS_APLICACION = [
  'Login', 'Clientes', 'Cobranza', 'Granjas', 'Etiquetas', 'Pesos',
  'SaludAvicola', 'Alimento', 'Mantenimiento', 'Precios',
  'Admin', 'Office', 'Logistica', 'CajaRuta', 'TableroRutas', 'Despacho',
  'operaciones', 'operaciones/BodegaAdmin',
  'DespachoMovil', 'BodegaMovil', 'CamioneroMovil', 'IncidentesMovil',
  // Facturacion y Reportes NO se sustituyen: son las pantallas que esta fase
  // reordena, y un stub no probaría nada sobre ellas.
].map(n => `../../src/components/${n}`);

for (const ruta of MODULOS_APLICACION) {
  vi.doMock(ruta, () => {
    const Stub = () => <div data-testid="stub-modulo" />;
    Stub.displayName = 'StubModulo';
    return { default: Stub };
  });
}

const App = (await import('../../src/App')).default;

/** Respuesta con la forma exacta de `GET /api/finanzas/resumen`. */
const RESUMEN = {
  periodo: { desde: '2027-03-01', hasta: '2027-03-31' },
  periodoAnterior: { desde: '2027-02-01', hasta: '2027-02-28' },
  ingresosFacturados: 5_000_000,
  ingresosCobrados: 3_200_000,
  gastos: 2_000_000,
  utilidad: 3_000_000,
  margen: 60,
  cuentasPorCobrar: 1_800_000,
  variacion: {
    ingresosFacturados: 25,
    ingresosCobrados: -10,
    gastos: 5,
    utilidad: 40,
  },
  anterior: {
    ingresosFacturados: 4_000_000,
    ingresosCobrados: 3_555_555.56,
    gastos: 1_904_761.9,
    utilidad: 2_095_238.1,
  },
  gastosPorCategoria: [
    { categoria: 'Diésel', monto: 1_200_000 },
    { categoria: 'Planilla', monto: 800_000 },
  ],
  cicloDelDinero: [
    { etapa: 'ventas_ruta', etiqueta: 'Vendido en ruta', monto: 5_000_000 },
    { etapa: 'documentos', etiqueta: 'Documentos emitidos', monto: 5_000_000 },
    { etapa: 'cuentasPorCobrar', etiqueta: 'Por cobrar', monto: 1_800_000 },
    { etapa: 'cobrado', etiqueta: 'Cobrado', monto: 3_200_000 },
    { etapa: 'caja', etiqueta: 'Caja (cobrado - gastos)', monto: 1_200_000 },
    { etapa: 'resultado', etiqueta: 'Resultado del periodo', monto: 3_000_000 },
  ],
  aging: { alDia: 500_000, d1_30: 300_000, d31_60: 400_000, d60: 600_000 },
  documentosEmitidos: 12,
};

/**
 * El mismo formateador que usa `src/lib/finanzas`. El test no reimplementa la
 * regla del colón: solo quiere saber que el número del endpoint llegó a la
 * tarjeta correcta.
 */
const crc = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 })
    .format(Number(n) || 0);

/**
 * Respuesta con la forma de `GET /api/dashboard/enterprise`.
 *
 * Fase 5: Resumen la consume para la columna "Salud del negocio" y para las
 * alertas de operación de la bandeja. Se incluye completa, con sus campos de
 * dinero, aunque Resumen los ignora a propósito: que el endpoint los devuelva
 * igual es la razón por la que el pick operativo no puede filtrarse por la
 * cabeza del JSON.
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
  alertas: [
    { tipo: 'Vacuna vencida', detalle: 'Newcastle — Granja El Alto', nivel: 'Crítica' },
    { tipo: 'Mantenimiento vencido', detalle: 'Cambio de cama — Galerón 3', nivel: 'Alta' },
  ],
};

const mockFetch = () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/finanzas/resumen') || u.includes('/api/reportes/flujo-caja')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => RESUMEN, text: async () => '' };
    }
    if (u.includes('/api/dashboard/enterprise')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => EMPRESA, text: async () => '' };
    }
    // El resto (facturas, gastos, catálogos) responde vacío: esta fase no
    // verifica el contenido de Documentos, solo que la ruta exista y monte.
    return { ok: true, status: 200, statusText: 'OK', json: async () => [], text: async () => '' };
  }));
};

/**
 * Igual que `mockFetch`, pero con un resumen propio.
 *
 * Desde la Fase 5 Resumen pide dos endpoints, así que un `json: async () => ({...})`
 * a pelo es un bug esperando: la segunda respuesta tiene que ser la de
 * `dashboard/enterprise` o el bloque operativo se oculta solo.
 */
const mockResumen = (overrides: Record<string, unknown>) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/dashboard/enterprise')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => EMPRESA, text: async () => '' };
    }
    return {
      ok: true, status: 200, statusText: 'OK', text: async () => '',
      json: async () => ({ ...RESUMEN, ...overrides }),
    };
  }));
};

const usuario = (role: Role, roles?: Role[]): User => ({
  id: `u-${role}`, name: `Usuario ${role}`, email: `${role}@granja.com`, role, roles,
});

const renderComo = (role: Role, roles?: Role[]) => {
  sessionStorage.setItem('gdp_session_tab', JSON.stringify({ token: 't', user: usuario(role, roles) }));
  return render(<App />);
};

const abrirModulo = async (nombre: string) => {
  const user = userEvent.setup();
  const aside = within(document.querySelector('aside')!);
  const botones = aside.getAllByRole('button');
  const boton = botones.find(b => (b.textContent ?? '').trim() === nombre)
    ?? (nombre === 'Finanzas' ? botones.find(b => (b.textContent ?? '').trim() === 'Gastos') : undefined);
  if (!boton && nombre === 'Finanzas') {
    const facturas = Array.from(document.querySelectorAll('button')).find(b => (b.textContent ?? '').trim() === 'Facturas');
    if (facturas) { await user.click(facturas); return; }
  }
  if (!boton) throw new Error(`No se encontró el módulo ${nombre}`);
  await user.click(boton);
  await waitFor(() => expect(screen.queryByTestId('module-loading')).toBeNull());
};

const tabs = (banda?: string): { id: string; etiqueta: string; activo: boolean }[] =>
  Array.from(document.querySelectorAll(`[data-testid="nav-tabs"]${banda ? `[data-banda="${banda}"]` : ''} [data-tab-id]`))
    .map(el => ({
      id: el.getAttribute('data-tab-id')!,
      etiqueta: (el.textContent ?? '').trim(),
      activo: el.getAttribute('aria-current') === 'page',
    }));

const idsDeTabs = () => tabs().map(t => t.id);

/**
 * Activos de una fila concreta.
 *
 * La unicidad es por fila, no global: con un reporte abierto hay dos marcas
 * correctas a la vez — Analítica arriba y el tipo de reporte abajo — y el
 * design las quiere así.
 */
const activasDe = (banda: string) => tabs(banda).filter(t => t.activo).map(t => t.id);

/** El tab resaltado de la fila primaria, o `null` si ninguno lo está. */
const tabActiva = () => {
  const a = activasDe('primario');
  expect(a, 'la fila primaria debe marcar un solo tab, no ' + JSON.stringify(a)).toHaveLength(1);
  return a[0];
};

const irATab = async (id: string) => {
  const user = userEvent.setup();
  await user.click(document.querySelector(`[data-tab-id="${id}"]`)!);
  await waitFor(() => expect(screen.queryByTestId('module-loading')).toBeNull());
};

beforeEach(() => {
  mockFetch();
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('matriz de tabs por rol', () => {
  it('Admin ve las cinco vistas, con Resumen activo', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(tabs('primario').map(t => t.id)).toEqual(['resumen', 'documentos', 'gastos-ruta', 'cobranza', 'analitica']);
    expect(tabActiva()).toBe('resumen');
  });

  it('Socio ve Resumen + Analítica', async () => {
    renderComo('Socio');
    await abrirModulo('Finanzas');
    expect(tabs('primario').map(t => t.id)).toEqual(['resumen', 'analitica']);
    expect(tabActiva()).toBe('resumen');
  });

  it('Comercial abre Facturas desde su navegación móvil, sin acceso a Finanzas', async () => {
    renderComo('Comercial');
    const user = userEvent.setup();
    await user.click(within(document.querySelector('aside')!).getByRole('button', { name: 'Facturas' }));
    expect(tabs('primario')).toEqual([]);
    expect(await screen.findByTestId('documentos-vendedor')).toBeTruthy();
  });

  it('las etiquetas son del boceto, no las del código viejo', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(tabs('primario').map(t => t.etiqueta)).toEqual(['Resumen', 'Documentos', 'Gastos de ruta', 'Cobranza', 'Analítica']);
    // "Flujo de Caja" y "Cuentas por Cobrar" eran tabs; ahora uno es un reporte
    // y el otro una etiqueta corta.
    expect(tabs('primario').map(t => t.etiqueta)).not.toContain('Flujo de Caja');
  });
});

describe('el tab resaltado siempre corresponde al contenido renderizado', () => {
  // Este es el bug 2 del plan, verificado para cada tab y cada rol que lo ve.
  const casos: { rol: Role; tab: string; contenido: () => boolean; descripcion: string }[] = [
    { rol: 'Admin', tab: 'resumen', contenido: () => !!screen.queryByTestId('finanzas-resumen'), descripcion: 'Resumen' },
    { rol: 'Admin', tab: 'documentos', contenido: () => !!screen.queryByTestId('documentos-ventas'), descripcion: 'Documentos' },
    { rol: 'Admin', tab: 'cobranza', contenido: () => !!screen.queryByTestId('stub-modulo'), descripcion: 'Cobranza' },
    { rol: 'Socio', tab: 'resumen', contenido: () => !!screen.queryByTestId('finanzas-resumen'), descripcion: 'Resumen de Socio' },
    { rol: 'Socio', tab: 'analitica', contenido: () => screen.queryByRole('heading', { name: 'Financiero' }) !== null, descripcion: 'Analítica de Socio' },
  ];

  for (const c of casos) {
    it(`${c.descripcion}: el tab ${c.tab} monta su propia pantalla`, async () => {
      renderComo(c.rol);
      await abrirModulo('Finanzas');
      await irATab(c.tab);
      expect(tabActiva(), `tab activo tras elegir ${c.tab}`).toBe(c.tab);
      expect(c.contenido(), `contenido esperado para ${c.tab}`).toBe(true);
    });
  }

  it('cambiar de tab apaga el anterior y enciende el nuevo', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await irATab('analitica');
    expect(activasDe('primario')).toEqual(['analitica']);
    await irATab('resumen');
    // Al salir de Analítica la sub-fila se va con ella: no queda flotando.
    expect(activasDe('primario')).toEqual(['resumen']);
    expect(tabs('secundario')).toEqual([]);
  });

  it('nunca hay dos tabs activos a la vez, ni en la primaria ni entre bandas', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await irATab('analitica');
    // Con un tipo de reporte activo hay dos filas, pero cada una marca uno.
    expect(tabs('primario').filter(t => t.activo).map(t => t.id)).toEqual(['analitica']);
    expect(tabs('secundario').filter(t => t.activo).length).toBe(1);
  });
});

describe('Resumen', () => {
  it('muestra las cinco tarjetas con la etiqueta del boceto', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const tarjetas = within(screen.getByTestId('finanzas-tarjetas')).getAllByRole('heading', { level: 3 });
    expect(tarjetas.map(t => t.textContent)).toEqual(['Ingresos', 'Cobrado', 'Gastos', 'Utilidad', 'Por cobrar']);
  });

  it('separa devengado de cobrado en tarjetas distintas', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const txt = screen.getByTestId('finanzas-tarjetas').textContent ?? '';
    // ₡5.000.000 y ₡3.200.000 son dos cifras distintas: la pantalla no muestra
    // "Ingresos" y espera que sea lo mismo que "Cobrado".
    expect(txt).toContain(crc(5_000_000));
    expect(txt).toContain(crc(3_200_000));
    expect(screen.getByText('Facturado, cobrado o no')).toBeTruthy();
    expect(screen.getByText('Dinero que entró a caja')).toBeTruthy();
  });

  it('no inventa una variación cuando el periodo anterior fue cero', async () => {
    mockResumen({
      ingresosFacturados: 1_000_000,
      ingresosCobrados: 0, gastos: 0, utilidad: 1_000_000, margen: 100,
      variacion: { ingresosFacturados: null, ingresosCobrados: null, gastos: null, utilidad: null },
    });
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(screen.getAllByText('Sin periodo anterior con que comparar').length).toBeGreaterThan(0);
    // Y en ningún sitio aparece un 0.0% disfrazado de comparación.
    expect(screen.queryByText('0.0%')).toBeNull();
  });

  it('pinta la banda del ciclo con las seis etapas en orden', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const nodos = within(screen.getByTestId('finanzas-ciclo')).getAllByRole('listitem');
    expect(nodos).toHaveLength(6);
    expect(nodos[0].textContent).toContain('Vendido en ruta');
    expect(nodos[5].textContent).toMatch(/resultado/i);
  });

  it('la bandeja Requiere atención avisa de la cartera vencida', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const bandeja = screen.getByTestId('finanzas-requiere-atencion');
    expect(bandeja.textContent).toContain('Detalle de asuntos');
    expect(bandeja.textContent).toContain('Cartera con más de 60 días');
    // ₡600.000 es el bucket d60 de la respuesta.
    expect(bandeja.textContent).toContain(crc(600_000));
  });

  it('la bandeja se vacía cuando no hay nada vencido, no hay alertas de operación y el mes cierra en positivo', async () => {
    mockResumen({
      ingresosFacturados: 5_000_000,
      ingresosCobrados: 5_000_000,
      gastos: 1_000_000,
      utilidad: 4_000_000,
      cuentasPorCobrar: 0,
      aging: { alDia: 0, d1_30: 0, d31_60: 0, d60: 0 },
      gastosPorCategoria: [],
    });
    // EMPRESA trae dos alertas de operación (vacuna vencida, mantenimiento
    // vencido), así que "vacía" exige también un endpoint sin alertas: desde la
    // Fase 5 la bandeja es una sola y no puede quedar medio vacía.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/dashboard/enterprise')) {
        return { ok: true, status: 200, statusText: 'OK', text: async () => '', json: async () => ({ ...EMPRESA, alertas: [] }) };
      }
      return {
        ok: true, status: 200, statusText: 'OK', text: async () => '',
        json: async () => ({
          ...RESUMEN,
          ingresosFacturados: 5_000_000,
          ingresosCobrados: 5_000_000,
          gastos: 1_000_000,
          utilidad: 4_000_000,
          cuentasPorCobrar: 0,
          aging: { alDia: 0, d1_30: 0, d31_60: 0, d60: 0 },
          gastosPorCategoria: [],
        }),
      };
    }));
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const bandeja = screen.getByTestId('finanzas-requiere-atencion');
    expect(bandeja.textContent).toContain('Nada pendiente');
  });

  it('avisa cuando el periodo cierra en pérdida', async () => {
    mockResumen({ gastos: 9_000_000, utilidad: -4_000_000, margen: -80 });
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(screen.getByTestId('finanzas-requiere-atencion').textContent).toContain('cierra en pérdida');
  });

  it('un error del endpoint se dice, no se disfraza de mes en ceros', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'boom', json: async () => ({}),
    })));
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const err = screen.getByTestId('finanzas-resumen-error');
    expect(err.textContent).toContain('No se pudo cargar el resumen financiero');
    expect(err.textContent).toContain('boom');
  });

  it('Socio ve el mismo Resumen que Admin', async () => {
    renderComo('Socio');
    await abrirModulo('Finanzas');
    expect(screen.getByTestId('finanzas-resumen')).toBeTruthy();
  });
});

describe('Documentos', () => {
  it('Admin consulta facturas, rutas y documentos físicos en la misma vista', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await irATab('documentos');
    expect(screen.getByTestId('documentos-ventas')).toBeTruthy();
    expect(screen.getByTestId('documentos-rutas')).toBeTruthy();
    expect(screen.getByTestId('documentos-fisicos')).toBeTruthy();
  });

  it('Documentos no agrega una segunda fila de navegación financiera', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await irATab('documentos');
    expect(document.querySelectorAll('[data-testid="nav-tabs"]').length).toBe(1);
  });

  it('el encabezado financiero de documentos dice Documentos', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await irATab('documentos');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Documentos');
  });
});

describe('Analítica', () => {
  it('solo dentro de Analítica aparece la sub-fila de reportes', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(tabs('secundario')).toEqual([]);
    await irATab('analitica');
    expect(tabs('secundario').map(t => t.id)).toEqual([
      'reporte:financiero', 'reporte:flujo-caja', 'reporte:ventas-por-ruta',
      'reporte:produccion', 'reporte:inventario', 'reporte:desperdicios',
    ]);
  });

  it('la sub-fila tiene los seis tipos, con flujo-caja incluido', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await irATab('analitica');
    expect(tabs('secundario').map(t => t.etiqueta)).toEqual([
      'Financiero', 'Flujo de Caja', 'Ventas por Ruta', 'Producción', 'Inventario', 'Desperdicios',
    ]);
  });

  it('elegir un tipo de reporte deja Analítica marcada arriba', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await irATab('analitica');
    await irATab('reporte:flujo-caja');
    expect(tabs('primario').filter(t => t.activo).map(t => t.id)).toEqual(['analitica']);
    expect(tabs('secundario').filter(t => t.activo).map(t => t.id)).toEqual(['reporte:flujo-caja']);
  });

  it('el reporte de Flujo de Caja pide el endpoint que Resumen también usa', async () => {
    const fetchMock = vi.mocked(fetch);
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await irATab('analitica');
    await irATab('reporte:flujo-caja');
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('/api/reportes/flujo-caja'))).toBe(true);
  });

  it('Comercial no puede abrir Analítica ni ver reportes financieros', async () => {
    renderComo('Comercial');
    await abrirModulo('Finanzas');
    expect(tabs('primario')).toEqual([]);
    expect(tabs('secundario')).toHaveLength(0);
    const user = userEvent.setup();
    await user.click(within(document.querySelector('aside')!).getByRole('button', { name: 'Facturas' }));
    expect(screen.queryByText('Reportes')).toBeNull();
    expect(screen.getByTestId('documentos-vendedor')).toBeTruthy();
  });
});

describe('Registro de gastos como acción del + Nuevo', () => {
  it('Gastos de ruta es una vista financiera separada de la captura de gasto', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const etiquetas = tabs('primario').map(t => t.etiqueta);
    expect(etiquetas).toContain('Gastos de ruta');
    expect(etiquetas).not.toContain('Registro de Gastos');
  });

  it('Registrar gasto abre el formulario para Administración', async () => {
    const user = userEvent.setup();
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await user.click(screen.getByRole('button', { name: 'Registrar gasto' }));
    const dialogo = screen.getByRole('dialog');
    expect(dialogo.textContent).toContain('Registrar gasto');
    expect(screen.getByLabelText('Categoría')).toBeTruthy();
    expect(screen.getByLabelText('Monto (₡)')).toBeTruthy();
    expect(screen.getByLabelText('Descripción')).toBeTruthy();
  });

  it('no deshabilita el envío hasta que los tres campos tengan sentido', async () => {
    const user = userEvent.setup();
    renderComo('Admin');
    await abrirModulo('Finanzas');
    await user.click(screen.getByRole('button', { name: 'Registrar gasto' }));
    const dialogo = screen.getByRole('dialog');
    const enviar = within(dialogo).getByRole('button', { name: /^Registrar$/ }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    await user.type(screen.getByLabelText('Monto (₡)'), '15000');
    await user.type(screen.getByLabelText('Descripción'), 'Peaje ruta 27');
    // Falta la categoría: sigue deshabilitado.
    expect((within(dialogo).getByRole('button', { name: /^Registrar$/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('Categoría'), 'Viáticos');
    expect((within(dialogo).getByRole('button', { name: /^Registrar$/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('un Socio no ve la acción: el gasto baja utilidad y no la mueve', async () => {
    renderComo('Socio');
    await abrirModulo('Finanzas');
    expect(screen.queryByRole('button', { name: 'Registrar gasto' })).toBeNull();
  });
});

describe('el módulo Logística ya no es una segunda puerta a la facturación', () => {
  it('ningún rol ve el tab facturación duplicado dentro del hub de Operaciones', async () => {
    // Fase 8: Logística desapareció como módulo. La única ruta a facturar es
    // Finanzas → Documentos, así que ni los grupos que absorbieron su día a día
    // (Despacho y Ventas en el hub) pueden ofrecer un tab de facturación.
    for (const [rol, modulo] of [['Admin', 'Operaciones y Bodegas'], ['Comercial', 'Mi Ruta']] as [Role, string][]) {
      renderComo(rol);
      await abrirModulo(modulo);
      expect(idsDeTabs()).not.toContain('facturacion');
      cleanup();
    }
  });
});
