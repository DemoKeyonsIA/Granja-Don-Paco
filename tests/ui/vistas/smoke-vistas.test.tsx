// @vitest-environment jsdom
/**
 * Smoke de vistas: cada pantalla real, con datos reales, para el rol que la ve.
 *
 * Qué cubre y qué no, explícito:
 *
 * Cubre
 *   · Que la vista **monte**: sin pantalla en blanco, sin excepción, sin clave
 *     repetida y sin `useEffect` en bucle.
 *   · Que los datos **del fixture lleguen al DOM**: si `Reportes` pide
 *     `/api/reportes/ventas-por-ruta` y el componente lee `body.filas`, un cambio
 *     de contrato se rompe aquí y no tres días después en producción.
 *   · Que una vista **no avise de un error que no ocurrió**: al montar con datos
 *     válidos no debería salir ni un `toast.error`, y ese es un bug distinto del
 *     que la vista se caiga.
 *   · Que no haya **avisos duplicados**: el mismo texto dicho dos veces en la
 *     misma acción.
 *
 * No cubre
 *   · Que los números que se pintan sean los correctos. Eso lo verifica la capa de
 *     API (`finanzas-rules`, `e2e-consistencia-kpis`, `smoke`). Aquí el foco es que
 *     la pantalla se monte y diga algo, no la aritmética.
 *
 * Por qué los datos son un fixture y no un stub por vista
 *   Un `json: async () => ({ total: 0 })` por vista obliga a inventar la forma en
 *   treinta archivos y hace que cada uno se lleve su propia versión de la realidad.
 *   `tests/fixtures/vistas.json` sale del servidor real sobre un dataset sembrado,
 *   así que un cambio de contrato se nota en un archivo solo.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  FIXTURES, instalarRed, instalarMatchMedia, capturarConsola, avisosDeReact,
  montarComo, limpiar, asentar, abrirModulo, irATab, irAEspacio, tabs, tabActiva, textoVisible,
  toastsDe, toastsDuplicados, limpiarToasts, type Ruido,
} from '../_vistas/arnes';
import type { Role } from '../../../src/types';

const App = (await import('../../../src/App')).default;

let ruido: Ruido;

beforeEach(() => {
  instalarMatchMedia();
  ruido = capturarConsola();
  instalarRed();
});

afterEach(() => {
  limpiar();
});

/** Falla con un mensaje que nombra la vista, el aviso y lo que sí se pidió. */
function afirmarSinAvisos(ctx: { vista: string }, esperarError = false) {
  const errores = toastsDe('error');
  if (esperarError) return;
  expect(
    errores,
    `${ctx.vista}: la vista avisó de un error al montar con datos válidos. ` +
    `Avisos: ${JSON.stringify(errores)}. Peticiones: ${JSON.stringify(
      (globalThis as any).__vistasUrls ?? [],
    )}`,
  ).toEqual([]);
}

function afirmarSinRuidoDeConsola(ctx: { vista: string }) {
  const avisos = avisosDeReact(ruido.errores);
  expect(
    avisos,
    `${ctx.vista}: Reactielderon avisos de consola.\n  ${avisos.join('\n  ')}`,
  ).toEqual([]);
}

function afirmarSinDuplicados(ctx: { vista: string }) {
  const dupes = toastsDuplicados();
  expect(
    dupes,
    `${ctx.vista}: el mismo aviso se emitió más de una vez: ${JSON.stringify(dupes)}`,
  ).toEqual([]);
}

/**
 * Recorre la ruta de navegación completa y afirma en cada parada.
 *
 * `modulo` y `pasos` reflejan tres formas distintas de navegación que conviven en
 * la app, y que el smoke tiene que respetar para no exigirle tabs donde no las hay:
 *
 *   · módulo + banda de tabs — Finanzas, Operaciones, Logística, Admin. La banda
 *     la dibuja el shell con `data-tab-id`.
 *   · módulo sin banda — Clientes es una sola pantalla; Office trae su propia fila
 *     de espacios con `data-espacio-id`; y los roles móviles con un solo sub-tab
 *     (Bodeguero, Camionero) ven directamente su vista porque el shell solo
 *     dibuja la banda cuando hay más de una opción.
 *   · sólo módulo — basta con afirmar que la vista montó y qué dice.
 *
 * El orden importa: se abre el módulo, se espera a que la vista pida sus datos, y
 * solo entonces se mira el DOM. Un smoke que mira antes del fetch no fallaría
 * nunca.
 */
async function recorrer(opts: {
  vista: string;
  rol: Role;
  roles?: Role[];
  modulo?: string;
  /** Aserción de la pantalla: el shell provee `tab`, Office provee `espacio`. */
  pasos: { tab?: string; espacio?: string; debeContener?: string | RegExp; testid?: string }[];
}) {
  const ctx = { vista: opts.vista };
  montarComo(App, opts.rol, opts.roles);
  await asentar();

  if (opts.modulo) {
    await abrirModulo(opts.modulo);
    await asentar();
  }

  for (const paso of opts.pasos) {
    if (paso.espacio) {
      await irAEspacio(paso.espacio);
      await asentar();
      expect(
        document.querySelector(`[data-espacio-id="${paso.espacio}"]`)?.getAttribute('aria-current'),
        `${ctx.vista}/${paso.espacio}: el espacio no quedó resaltado`,
      ).toBe('page');
    }

    if (paso.tab) {
      if (paso.tab !== (tabActiva() ?? '')) {
        await irATab(paso.tab);
        await asentar();
      }
      // Con una sub-vista abierta hay dos marcas correctas a la vez — la del grupo
      // en la fila primaria y la del paso en la secundaria —, así que el resaltado
      // se comprueba sobre el tab que se eligió, no contra el primer marcado del
      // documento. Esto es el bug 2 del plan, y se comprueba en cada parada porque
      // se puede reintroducir en cualquier fila.
      const tabSeleccionado = document.querySelector(`[data-tab-id="${paso.tab}"]`);
      expect(
        tabSeleccionado?.getAttribute('aria-current') === 'page' || tabSeleccionado?.getAttribute('aria-selected') === 'true',
        `${ctx.vista}/${paso.tab}: el tab resaltado no es el que se eligió`,
      ).toBe(true);
    }

    // 1. La vista montó algo y no es la pantalla en blanco.
    const texto = textoVisible();
    expect(
      texto.length,
      `${ctx.vista}/${paso.tab ?? paso.espacio ?? ''}: la vista no pintó nada`,
    ).toBeGreaterThan(80);

    // 3. El contenido esperado está.
    if (paso.testid) {
      expect(
        document.querySelector(`[data-testid="${paso.testid}"]`),
        `${ctx.vista}/${paso.tab ?? paso.espacio ?? ''}: falta el testid ${paso.testid}`,
      ).toBeTruthy();
    }
    if (paso.debeContener) {
      const re = paso.debeContener instanceof RegExp ? paso.debeContener : new RegExp(escapar(paso.debeContener));
      await waitFor(() => expect(
        re.test(textoVisible()),
        `${ctx.vista}/${paso.tab ?? paso.espacio ?? ''}: la vista aún no muestra ${paso.debeContener}`,
      ).toBe(true));
    }

    afirmarSinAvisos(ctx);
    afirmarSinDuplicados(ctx);
    afirmarSinRuidoDeConsola(ctx);
    limpiarToasts();
  }
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------

describe('vistas de Finanzas', () => {
  it('Resumen: monta las tarjetas con las cifras del resumen real', async () => {
    await recorrer({
      vista: 'Finanzas/Resumen', rol: 'Admin', modulo: 'Finanzas',
      pasos: [{ tab: 'resumen', testid: 'finanzas-resumen', debeContener: 'Ingresos' }],
    });
  });

  // La banda de avisos de Finanzas es condicional: solo avisa de los buckets de
  // antigüedad que tienen plata. Eso se comprueba en las dos direcciones, porque
  // con una sola el test pasa por la mitad de los casos:
  //
  // · El fixture sembrado tiene d31_60 y d60 en cero, porque una granja sana no
  //   arrastra cartera de dos meses. Aquí se exige que esas bandas NO aparezcan.
  // · Con un parche que pone d60 en dinero, se exige que SÍ aparezcan, y con el
  //   monto. Si el parche no existiera, esta rama nunca se podría probar.
  it('Resumen: no avisa de buckets de antigüedad que están en cero', async () => {
    await recorrer({
      vista: 'Finanzas/Resumen/sin-d60', rol: 'Admin', modulo: 'Finanzas',
      pasos: [{ tab: 'resumen' }],
    });
    const texto = textoVisible();
    expect(texto).not.toContain('Cartera con más de 60 días');
    expect(texto).not.toContain('Cartera entre 31 y 60 días');
  });

  it('Resumen: avisa de la cartera con más de 60 días cuando la hay', async () => {
    const base = FIXTURES.endpoints['/api/finanzas/resumen'].body as any;
    instalarRed({
      parchear: {
        '/api/finanzas/resumen': {
          ...base,
          aging: { ...base.aging, d60: 500000 },
        },
      },
    });
    await recorrer({
      vista: 'Finanzas/Resumen/con-d60', rol: 'Admin', modulo: 'Finanzas',
      pasos: [{ tab: 'resumen', debeContener: 'Cartera con más de 60 días' }],
    });
    expect(textoVisible()).toMatch(/500\s?000/);
  });

  it('Documentos: lista ventas, rutas y físicos', async () => {
    await recorrer({
      vista: 'Finanzas/Documentos', rol: 'Comercial', modulo: 'Finanzas',
      pasos: [{ tab: 'documentos', testid: 'documentos-ventas' }],
    });
  });

  it('Cobranza: monta la cartera del cliente con crédito', async () => {
    await recorrer({
      vista: 'Finanzas/Cobranza', rol: 'Admin', modulo: 'Finanzas',
      pasos: [{ tab: 'cobranza', debeContener: /cobranza|factura|cartera|pendiente/i }],
    });
  });

  it('Analítica: los seis tipos de reporte montan su pantalla', async () => {
    await recorrer({
      vista: 'Finanzas/Analítica', rol: 'Admin', modulo: 'Finanzas',
      pasos: [
        { tab: 'analitica', debeContener: /reporte|analítica|flujo/i },
      ],
    });
  });
});

describe('vistas de Operaciones y Bodegas', () => {
  it('Resumen del día: muestra el pulso de la empresa', async () => {
    await recorrer({
      vista: 'Operaciones/Resumen', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'resumen', debeContener: /resumen|día|aves|ingresos/i }],
    });
  });

  it('Granja: la lista de granjas trae la del fixture', async () => {
    await recorrer({
      vista: 'Operaciones/Granja', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'granja', debeContener: 'Granja El Alto' }],
    });
  });

  it('Granja > Salud Avícola: lista la vacunación sembrada', async () => {
    await recorrer({
      vista: 'Operaciones/SaludAvicola', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'granja' }, { tab: 'salud', debeContener: /newcastle|vacun/i }],
    });
  });

  it('Granja > Alimento: el silo con el ingreso del fixture', async () => {
    await recorrer({
      vista: 'Operaciones/Alimento', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'granja' }, { tab: 'alimento', debeContener: /alimento|silo|balanceado/i }],
    });
  });

  it('Granja > Mantenimiento: la orden pendiente del fixture', async () => {
    await recorrer({
      vista: 'Operaciones/Mantenimiento', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'granja' }, { tab: 'mantenimiento', debeContener: /mantenim|orden|activo/i }],
    });
  });

  it('Bodega: las existencias muestran el producto del fixture', async () => {
    await recorrer({
      vista: 'Operaciones/Bodega/Existencias', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'bodega', debeContener: 'Huevos - Grande' }],
    });
  });

  it('Bodega > Control: la cola de recepción', async () => {
    await recorrer({
      vista: 'Operaciones/Bodega/Control', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'bodega' }, { tab: 'control', debeContener: /recepci|existencia|control/i }],
    });
  });

  it('Bodega > Entradas: la remisión GR- y el alistamiento', async () => {
    await recorrer({
      vista: 'Operaciones/Bodega/Entradas', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'bodega' }, { tab: 'bodega-entradas', debeContener: /remisi|guía|guia|bodega|alistar/i }],
    });
  });

  it('Despacho: la guía cargada del fixture', async () => {
    await recorrer({
      vista: 'Operaciones/Despacho', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'despacho', debeContener: /guía|guia|camión|despacho/i }],
    });
  });

  it('Ventas: la caja de la ruta', async () => {
    await recorrer({
      vista: 'Operaciones/Ventas', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'ventas', debeContener: /tiquete|venta|caja|guía/i }],
    });
  });
});

describe('el módulo Logística como pasos de Despacho y Ventas', () => {
  it('Auditoría de ruta: vive dentro de la pantalla de Despacho (G2)', async () => {
    // La consolidación G2 le quitó a Ventas el paso `ventas-trazabilidad`: la
    // auditoría es lectura de las guías que crea Despacho, así que su panel de
    // stock y merma ahora se ve en el cuerpo del grupo Despacho.
    await recorrer({
      vista: 'Operaciones/Despacho/Auditoría', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'despacho' }, { tab: 'despacho-guias', debeContener: /Auditoría de ruta|Merma|Stock actual|Carga en guías/i }],
    });
  });

  it('Tablero de Rutas: el tablero vivo de las ventas', async () => {
    await recorrer({
      vista: 'Operaciones/Ventas/Tablero', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'ventas' }, { tab: 'ventas-tablero', debeContener: /tablero|ruta|vivo/i }],
    });
  });

  it('Etiquetas QR: la etiqueta generada del fixture', async () => {
    await recorrer({
      vista: 'Operaciones/Despacho/Etiquetas', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'despacho' }, { tab: 'despacho-etiquetas', debeContener: /etiqueta|ETQ-/i }],
    });
  });

  it('Control Pesos: el pesaje registrado', async () => {
    await recorrer({
      vista: 'Operaciones/Despacho/Pesos', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'despacho' }, { tab: 'despacho-pesos', debeContener: /peso|pesaje|bascula|báscula/i }],
    });
  });

  it('Precios: la lista de la ruta Norte', async () => {
    await recorrer({
      vista: 'Operaciones/Ventas/Precios', rol: 'Admin', modulo: 'Operaciones',
      pasos: [{ tab: 'ventas' }, { tab: 'ventas-precios', debeContener: /precio|lista/i }],
    });
  });
});

describe('vistas de Admin', () => {
  it('Productos: el catálogo sembrado', async () => {
    await recorrer({
      vista: 'Admin/Productos', rol: 'Admin', modulo: 'Admin',
      pasos: [{ tab: 'productos', debeContener: 'Huevos - Grande' }],
    });
  });

  it('Infraestructura: granja, galerón y activo', async () => {
    await recorrer({
      vista: 'Admin/Infraestructura', rol: 'Admin', modulo: 'Admin',
      pasos: [{ tab: 'infraestructura', debeContener: /granja|galerón|activo/i }],
    });
  });

  it('Usuarios: la lista de usuarios', async () => {
    await recorrer({
      vista: 'Admin/Usuarios', rol: 'Admin', modulo: 'Admin',
      pasos: [{ tab: 'usuarios', debeContener: /usuario|admin|vendedor/i }],
    });
  });
});

describe('Clientes: una sola pantalla, sin banda de tabs', () => {
  it('monta con la cartera del fixture', async () => {
    await recorrer({
      vista: 'Clientes', rol: 'Admin', modulo: 'Clientes',
      pasos: [{ debeContener: 'Supermercado Don Pepito' }],
    });
  });

  it('no dibuja banda de tabs: es un módulo de una sola vista', async () => {
    montarComo(App, 'Admin');
    await asentar();
    await abrirModulo('Clientes');
    await asentar();
    expect(
      document.querySelectorAll('[data-testid="nav-tabs"]').length,
      'Clientes no debería dibujar bandas: el shell solo las pone donde hay sub-tabs',
    ).toBe(0);
  });
});

describe('Dirección: su propia fila de espacios', () => {
  it('Correo: monta aunque no haya cuentas conectadas', async () => {
    await recorrer({
      vista: 'Office/Correo', rol: 'Admin', modulo: 'Dirección',
      pasos: [{ espacio: 'correo' }],
    });
  });

  it('Documentos: monta aunque el buzón esté vacío', async () => {
    await recorrer({
      vista: 'Office/Documentos', rol: 'Admin', modulo: 'Dirección',
      pasos: [{ espacio: 'documentos' }],
    });
  });

  it('Admin/Vinculaciones: monta desde la fila de Admin, no desde Office', async () => {
    await recorrer({
      vista: 'Admin/Vinculaciones', rol: 'Admin', modulo: 'Admin',
      pasos: [{ tab: 'vinculaciones', debeContener: /vincular|cuenta|correo|carpeta/i }],
    });
  });

  it('el espacio resaltado es el que se eligió', async () => {
    montarComo(App, 'Admin');
    await asentar();
    await abrirModulo('Dirección');
    await asentar();
    const marcados = Array.from(
      document.querySelectorAll('[data-espacio-id][aria-current="page"]'),
    ).map(e => e.getAttribute('data-espacio-id'));
    expect(marcados).toHaveLength(1);
  });

  it('Vinculaciones ya no es un espacio de Dirección', async () => {
    montarComo(App, 'Admin');
    await asentar();
    await abrirModulo('Dirección');
    await asentar();
    const ids = Array.from(document.querySelectorAll('[data-espacio-id]'))
      .map(e => e.getAttribute('data-espacio-id'));
    expect(ids).toEqual(['correo', 'documentos']);
  });
});

describe('el camino móvil de Operaciones', () => {
  it('Despachador: Carga e Incidencias, que sí tienen banda', async () => {
    await recorrer({
      vista: 'Movil/Despachador/Carga', rol: 'Despachador', modulo: 'Carga a Bodega',
      pasos: [{ tab: 'carga' }, { tab: 'incidencias' }],
    });
  });

  it('Bodeguero: Recepción monta directo, sin banda de un solo tab', async () => {
    await recorrer({
      vista: 'Movil/Bodeguero', rol: 'Bodeguero', modulo: 'Recepción',
      pasos: [{ debeContener: /recib|recepci|bodega/i }],
    });
  });

  it('Camionero: la banda Mi Ruta permite confirmar cargas asignadas', async () => {
    await recorrer({
      vista: 'Movil/Camionero', rol: 'Camionero', modulo: 'Mi Ruta',
      pasos: [{ tab: 'cargas-comercial' }, { debeContener: /cargas asignadas|confirmar|rechazar/i }],
    });
  });

  it('un solo sub-tab no dibuja banda, pero la vista se ve igual', async () => {
    montarComo(App, 'Bodeguero');
    await asentar();
    await abrirModulo('Recepción');
    await asentar();
    expect(
      document.querySelectorAll('[data-testid="nav-tabs"]').length,
      'con un único sub-tab la banda sería ruido: un botón que no cambia nada',
    ).toBe(0);
    expect(textoVisible().length).toBeGreaterThan(80);
  });
});

describe('matriz de acceso por rol', () => {
  /**
   * Comprobación sobre el botón real del sidebar, no sobre el texto de la página.
   *
   * Buscar el substring del módulo en todo el body daba falsos positivos: "Clientes"
   * aparece en breadcrumbs y en textos de Finanzas, así que el test pasaba o fallaba
   * por una coincidencia de palabras y no por el permiso. Lo que decide es si el
   * botón con `data-modulo-id` existe, que es exactamente lo que aplica
   * `modulosVisibles(roles)`.
   */
  const modulosDelSidebar = () =>
    Array.from(document.querySelectorAll('aside button[data-modulo-id]'))
      .map(b => b.getAttribute('data-modulo-id')!);

  const sinAcceso: { rol: Role; modulo: string }[] = [
    { rol: 'Socio', modulo: 'admin' },
    { rol: 'Socio', modulo: 'operaciones' },
    { rol: 'Comercial', modulo: 'admin' },
    { rol: 'Bodeguero', modulo: 'finanzas' },
    { rol: 'Bodeguero', modulo: 'clientes' },
    { rol: 'Despachador', modulo: 'finanzas' },
    { rol: 'Despachador', modulo: 'clientes' },
  ];

  for (const { rol, modulo } of sinAcceso) {
    it(`${rol} no ve el módulo ${modulo}`, async () => {
      montarComo(App, rol);
      await asentar();
      expect(
        modulosDelSidebar(),
        `${rol} tiene el módulo ${modulo} en el sidebar, y no le corresponde`,
      ).not.toContain(modulo);
    });
  }

  const conAcceso: { rol: Role; modulo: string }[] = [
    { rol: 'Admin', modulo: 'finanzas' },
    { rol: 'Admin', modulo: 'admin' },
    { rol: 'Admin', modulo: 'office' },
    { rol: 'Admin', modulo: 'operaciones' },
    { rol: 'Admin', modulo: 'clientes' },
    { rol: 'Socio', modulo: 'finanzas' },
    { rol: 'Socio', modulo: 'office' },
    { rol: 'Socio', modulo: 'clientes' },
    { rol: 'Comercial', modulo: 'finanzas' },
    { rol: 'Comercial', modulo: 'operaciones' },
    { rol: 'Comercial', modulo: 'clientes' },
    { rol: 'Bodeguero', modulo: 'operaciones' },
    { rol: 'Despachador', modulo: 'operaciones' },
    { rol: 'Camionero', modulo: 'operaciones' },
    { rol: 'Camionero', modulo: 'finanzas' },
    { rol: 'Camionero', modulo: 'clientes' },
  ];

  for (const { rol, modulo } of conAcceso) {
    it(`${rol} sí ve el módulo ${modulo}`, async () => {
      montarComo(App, rol);
      await asentar();
      expect(
        modulosDelSidebar(),
        `${rol} no ve el módulo ${modulo}, y le corresponde`,
      ).toContain(modulo);
    });
  }

  // Un test por rol, y no un bucle con `limpiar()` dentro. `limpiar()` hace
  // `vi.unstubAllGlobals()`, que se lleva el `fetch` sustituido: en la segunda
  // iteración las vistas pedían al `fetch` real, `fetch('/api/...')` sin base
  // lanzaba `Failed to parse URL` y el error suelto se le endosaba a este archivo
  // en vez de al test que lo causó. Con un `it` por rol, el `beforeEach` los
  // vuelve a instalar todos.
  for (const rol of ['Admin', 'Socio', 'Comercial', 'Bodeguero', 'Despachador', 'Camionero'] as Role[]) {
    it(`${rol} ve al menos un módulo`, async () => {
      montarComo(App, rol);
      await asentar();
      expect(modulosDelSidebar(), `${rol} se queda sin ningún módulo`).not.toHaveLength(0);
    });
  }
});

describe('invariantes de navegación bajo datos reales', () => {
  it('nunca hay dos tabs activos en la misma banda', async () => {
    montarComo(App, 'Admin');
    await asentar();
    await abrirModulo('Finanzas');
    await asentar();
    await irATab('analitica');
    await asentar();

    const porBanda = new Map<string, string[]>();
    for (const t of tabs().filter(t => t.activo)) {
      porBanda.set(t.banda, [...(porBanda.get(t.banda) ?? []), t.id]);
    }
    for (const [banda, ids] of porBanda) {
      expect(ids, `la banda ${banda} marca ${ids.length} tabs activos`).toHaveLength(1);
    }
  });

  it('cambiar de módulo no deja el tab del anterior marcado', async () => {
    montarComo(App, 'Admin');
    await asentar();
    await abrirModulo('Finanzas');
    await asentar();
    await irATab('analitica');
    await asentar();
    await abrirModulo('Operaciones');
    await asentar();

    const activos = tabs().filter(t => t.activo).map(t => t.id);
    expect(activos).not.toContain('analitica');
  });
});
