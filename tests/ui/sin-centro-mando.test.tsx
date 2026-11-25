// @vitest-environment jsdom
/**
 * Fase 5 — el módulo `dashboard` (Centro de Mando) desaparece del sidebar.
 *
 * Esto no es cosmético. El módulo era una segunda puerta al mismo P&L: mostraba
 * ingresos, gastos, utilidad y cartera con sus propios cálculos, mientras
 * Finanzas hacía lo mismo con los de `/api/finanzas/resumen`. Mientras las dos
 * puertas existieran, cualquier cifra podía diferir de la otra y no había forma
 * de saber cuál era la buena.
 *
 * El test ata las dos mitades de la fase:
 *   1. Ningún rol tiene una entrada al Centro de Mando, ni por sidebar ni por
 *      módulo de entrada por defecto.
 *   2. Lo que el Centro de Mando aportaba sigue visible, ahora en Resumen: la
 *      columna "Salud del negocio" y las alertas de operación en la misma
 *      bandeja que las de dinero.
 *
 * `FinanzasResumen` no se sustituye por un stub: acá se prueba que el bloque
 * nuevo se monta de verdad. El resto de los módulos van stub porque no tienen
 * nada que ver con la fase.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Role, User } from '../../src/types';

const MODULOS_APLICACION = [
  'Login', 'Clientes', 'Cobranza', 'Granjas', 'Etiquetas', 'Pesos',
  'SaludAvicola', 'Alimento', 'Mantenimiento', 'Precios',
  'Admin', 'Office', 'Logistica', 'CajaRuta', 'TableroRutas',
  'operaciones', 'operaciones/BodegaAdmin',
  'DespachoMovil', 'BodegaMovil', 'CamioneroMovil', 'IncidentesMovil',
].map(n => `../../src/components/${n}`);

for (const ruta of MODULOS_APLICACION) {
  vi.doMock(ruta, () => {
    const Stub = () => <div data-testid="stub-modulo" />;
    Stub.displayName = 'StubModulo';
    return { default: Stub };
  });
}

const App = (await import('../../src/App')).default;

/** Forma exacta de `GET /api/finanzas/resumen`. */
const RESUMEN = {
  periodo: { desde: '2027-04-01', hasta: '2027-04-30' },
  ingresosFacturados: 5_000_000,
  ingresosCobrados: 3_200_000,
  gastos: 2_000_000,
  utilidad: 3_000_000,
  margen: 60,
  cuentasPorCobrar: 1_800_000,
  variacion: {
    ingresosFacturados: 25, ingresosCobrados: -10, gastos: 5, utilidad: 40,
  },
  gastosPorCategoria: [{ categoria: 'Diésel', monto: 1_200_000 }],
  cicloDelDinero: [
    { etapa: 'ventas_ruta', monto: 5_000_000 },
    { etapa: 'documentos', monto: 5_000_000 },
    { etapa: 'cuentasPorCobrar', monto: 1_800_000 },
    { etapa: 'cobrado', monto: 3_200_000 },
    { etapa: 'caja', monto: 1_200_000 },
    { etapa: 'resultado', monto: 3_000_000 },
  ],
  aging: { alDia: 500_000, d1_30: 300_000, d31_60: 400_000, d60: 600_000 },
  documentosEmitidos: 12,
};

/**
 * `ingresosHoy` es 9.000.000 a propósito: distinto de `RESUMEN.ingresosFacturados`
 * (5.000.000). Si Resumen lo llegara a pintar, la columna derecha contradiría a
 * las tarjetas de la izquierda y el test lo vería.
 */
const EMPRESA = {
  ingresosHoy: 9_000_000,
  ingresosCobradosHoy: 3_200_000,
  gastosHoy: 7_000_000,
  utilidadNeta: 2_000_000,
  cuentasPorCobrar: 9_999_999,
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
    { tipo: 'Diferencia en recepción', detalle: 'Esperado 300, recibido 280', nivel: 'Alta' },
  ],
};

const mockFetch = (empresa: unknown = EMPRESA) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const ok = (json: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => json, text: async () => '' });
    if (u.includes('/api/finanzas/resumen')) return ok(RESUMEN);
    if (u.includes('/api/dashboard/enterprise')) {
      if (empresa === 'fallo') {
        return { ok: false, status: 500, statusText: 'Server Error', json: async () => ({}), text: async () => 'boom' };
      }
      return ok(empresa);
    }
    return ok([]);
  }));
};

/**
 * Los strings esperados se arman con `Intl` y no a mano.
 *
 * El separador de miles depende del ICU del Node que corre el test: aquí puede
 * ser punto, puede ser espacio, y hardcodearlo produce un test que pasa en una
 * máquina y falla en otra sin que cambie el código.
 */
const miles = (n: number) => new Intl.NumberFormat('es-CR').format(n);
const crc = (n: number) =>
  new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n);

const usuario = (role: Role, roles?: Role[]): User => ({
  id: `u-${role}`, name: `Usuario ${role}`, email: `${role}@granja.com`, role, roles,
});

const renderComo = (role: Role, roles?: Role[]) => {
  sessionStorage.setItem('gdp_session_tab', JSON.stringify({ token: 't', user: usuario(role, roles) }));
  return render(<App />);
};

const sidebar = () => within(document.querySelector('aside')!);
const modulosDelSidebar = () => sidebar().getAllByRole('button').map(b => b.textContent?.trim() ?? '');

const abrirModulo = async (nombre: string) => {
  const user = userEvent.setup();
  const botones = sidebar().getAllByRole('button');
  const boton = botones.find(b => (b.textContent ?? '').trim() === nombre)
    ?? (nombre === 'Finanzas' ? botones.find(b => (b.textContent ?? '').trim() === 'Gastos') : undefined);
  if (!boton && nombre === 'Finanzas') {
    const facturas = Array.from(document.querySelectorAll('button')).find(b => (b.textContent ?? '').trim() === 'Facturas');
    if (facturas) { await user.click(facturas); return; }
  }
  if (!boton) throw new Error(`No se encontró el módulo ${nombre}`);
  await user.click(boton);
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('el Centro de Mando no es una entrada de navegación', () => {
  const ROLES: Role[] = ['Admin', 'Socio', 'Comercial', 'Bodeguero', 'Despachador', 'Camionero'];

  it.each(ROLES)('%s no lo ve en el sidebar', (rol) => {
    renderComo(rol);
    expect(modulosDelSidebar().join(' | ')).not.toContain('Centro de Mando');
    expect(screen.queryByText('Centro de Mando')).toBeNull();
  });

  it.each(ROLES)('%s tampoco aterriza ahí al entrar', async (rol) => {
    renderComo(rol);
    await Promise.resolve();
    expect(document.body.textContent).not.toContain('Cargando centro de mando');
  });

  it('Admin entra directo a Finanzas, que es el módulo del P&L', async () => {
    renderComo('Admin');
    expect(await screen.findByTestId('finanzas-resumen')).toBeTruthy();
  });

  it('ningún botón de navegación apunta a una pantalla borrada', () => {
    renderComo('Admin');
    // Los ids de módulo que quedaron son los que existen; si alguien reintroduce
    // `dashboard` como entrada, el sidebar lo muestra aunque el componente ya no
    // exista, y el usuario aterriza en un error global.
    for (const nombre of modulosDelSidebar()) {
      expect(nombre).not.toBe('Inicio');
    }
  });
});

describe('lo que aportaba el Centro de Mando vive en Resumen', () => {
  it('Resumen muestra la columna Salud del negocio con la operación de hoy', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const bloque = screen.getByTestId('finanzas-salud-negocio');
    expect(bloque.textContent).toContain('Salud del negocio');
    for (const valor of [320, 48_300, 1_500, 37, 6]) {
      expect(bloque.textContent, String(valor)).toContain(miles(valor));
    }
  });

  it('el impacto del desperdicio aparece con su monto', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const bloque = screen.getByTestId('finanzas-salud-negocio');
    expect(bloque.textContent).toContain(crc(45_000));
  });

  it('las alertas de operación se fusionan en la misma bandeja, no en otra', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const bandeja = screen.getByTestId('finanzas-requiere-atencion');
    expect(bandeja.textContent).toContain('Vacuna vencida');
    expect(bandeja.textContent).toContain('Diferencia en recepción');
    // Y junto a ellas siguen las de dinero: una sola bandeja, dos orígenes.
    expect(bandeja.textContent).toContain('Cartera con más de 60 días');
    // Y no hay una segunda lista suelta de alertas operativas en la pantalla.
    const texto = screen.getByTestId('finanzas-resumen').textContent ?? '';
    expect(texto.match(/Vacuna vencida/g)).toHaveLength(1);
  });

  it('las tarjetas de dinero vienen del resumen, no del endpoint del dashboard', async () => {
    renderComo('Admin');
    await abrirModulo('Finanzas');
    const tarjetas = screen.getByTestId('finanzas-tarjetas');
    expect(tarjetas.textContent).toContain(crc(5_000_000));
    // Los 9.000.000 de ingresos y los 2.000.000 de utilidad del endpoint del
    // dashboard no aparecen en ninguna tarjeta: ese endpoint ya no es dueño
    // del P&L, y el bloque de la derecha lo declara en voz alta.
    expect(tarjetas.textContent).not.toContain(crc(9_000_000));
    expect(tarjetas.textContent).not.toContain(crc(7_000_000));
  });

  it('si el endpoint de operación falla, Resumen sigue mostrando el dinero', async () => {
    mockFetch('fallo');
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(await screen.findByTestId('finanzas-resumen')).toBeTruthy();
    expect(screen.getByTestId('finanzas-tarjetas').textContent).toContain(crc(5_000_000));
    expect(screen.getByTestId('finanzas-salud-negocio-no-disponible')).toBeTruthy();
    // El ciclo y la cartera tampoco dependen de ese endpoint.
    expect(screen.getByTestId('finanzas-ciclo')).toBeTruthy();
    expect(screen.getByTestId('finanzas-aging')).toBeTruthy();
  });

  it('un payload incompleto oculta el bloque en vez de pintar ceros', async () => {
    mockFetch({ alertas: [] });
    renderComo('Admin');
    await abrirModulo('Finanzas');
    expect(screen.getByTestId('finanzas-salud-negocio-no-disponible')).toBeTruthy();
    expect(screen.getByTestId('finanzas-salud-negocio-no-disponible').textContent).not.toContain('0');
  });

  it('el Comercial no ve Resumen, así que el bloque operativo tampoco se le filtra', async () => {
    renderComo('Comercial');
    await abrirModulo('Finanzas');
    expect(screen.queryByTestId('finanzas-resumen')).toBeNull();
    expect(screen.queryByTestId('finanzas-salud-negocio')).toBeNull();
    // Documentos sí es suyo: la otra mitad de la fase 4 sigue en pie.
    expect(await screen.findByTestId('documentos-vendedor')).toBeTruthy();
  });

  it('el Socio ve Resumen con la columna derecha', async () => {
    renderComo('Socio');
    await abrirModulo('Finanzas');
    expect(screen.getByTestId('finanzas-salud-negocio')).toBeTruthy();
    expect(screen.getByTestId('finanzas-aging')).toBeTruthy();
  });
});
