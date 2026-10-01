/**
 * Fase 0 — caracterización de la arquitectura de información.
 *
 * Estos tests congelan la IA tal como existe hoy, después de moverla de
 * literales inline en `App.tsx` a `src/nav/modulos.ts`. Sirven de red para las
 * fases 1-7: cuando cambien tabs o permisos, este archivo es el que obliga a
 * declarar la decisión de forma explícita.
 *
 * Corre en `environment: node` a propósito: la capa de navegación no debe
 * arrastrar React.
 */
import { describe, it, expect } from 'vitest';
import type { Role } from '../src/types';
import {
  MODULOS, ROLES_MOVIL, ESPACIOS_OFFICE,
  SUBTABS_GRANJA, SUBTABS_ADMIN, SUBTABS_FINANZAS, SUBTABS_LOGISTICA,
  SUBTABS_ANALITICA, TIPOS_REPORTE, idSubTabReporte, tipoReporteDe, subTabsInternosDe,
  rolesEfectivos, modulosVisibles, moduloPorId, labelDeModulo, moduloPorDefecto,
  subTabsDe, subTabsLogisticaDe, subTabPorDefecto, subTabsOperacionesMovil,
  subTabMovilEfectivo, breadcrumbDe, esRolMovil, validarConfig, INCIDENCIAS_CONOCIDAS,
} from '../src/nav/modulos';

const TODOS: Role[] = ['Admin', 'Socio', 'Comercial', 'Despachador', 'Bodeguero', 'Camionero'];
const DESKTOP: Role[] = ['Admin', 'Socio', 'Comercial'];

const ids = (tabs: { id: string }[]) => tabs.map(t => t.id);
const idsModulos = (roles: Role[]) => modulosVisibles(roles).map(m => m.id);

describe('validez de la configuración', () => {
  it('no tiene errores de configuración', () => {
    expect(validarConfig().errores).toEqual([]);
  });

  it('las incidencias abiertas son exactamente las conocidas, con fase asignada', () => {
    const { incidencias } = validarConfig();
    expect(incidencias.map(i => i.problema).sort()).toEqual(Object.keys(INCIDENCIAS_CONOCIDAS).sort());
    for (const i of incidencias) expect(i.fase, i.problema).toMatch(/^Fase \d/);
  });

  it('todo módulo tiene icono registrado y roles conocidos', () => {
    for (const m of MODULOS) {
      expect(m.icon, m.id).toBeTruthy();
      expect(m.roles.length, m.id).toBeGreaterThan(0);
      for (const r of m.roles) expect(TODOS, `${m.id}/${r}`).toContain(r);
    }
  });

  it('los ids de módulo son únicos', () => {
    expect(new Set(MODULOS.map(m => m.id)).size).toBe(MODULOS.length);
  });

  it('todo sub-tab por defecto es visible para su rol, salvo incidencia conocida', () => {
    const conocidas = new Set(Object.keys(INCIDENCIAS_CONOCIDAS));
    for (const m of MODULOS) {
      for (const r of m.roles) {
        const porDefecto = subTabPorDefecto(m.id, [r]);
        if (!porDefecto || m.id === 'office') continue;
        if (m.id === 'operaciones' && esRolMovil([r])) continue;
        const visibles = subTabsDe(m.id, [r]);
        if (!visibles.length || visibles.some(t => t.id === porDefecto)) continue;
        expect(conocidas.has(`Rol ${r} entra a ${m.id}/${porDefecto} pero no ve ese tab`), r).toBe(true);
      }
    }
  });
});

describe('roles efectivos', () => {
  it('usa el rol principal cuando no hay roles extra', () => {
    expect(rolesEfectivos('Comercial')).toEqual(['Comercial']);
  });

  it('prefiere roles extra y deduplica', () => {
    expect(rolesEfectivos('Admin', ['Socio', 'Admin'])).toEqual(['Socio', 'Admin']);
  });

  it('descarta valores vacíos', () => {
    expect(rolesEfectivos('Admin', [undefined as any, 'Socio'])).toEqual(['Socio']);
  });
});

describe('sidebar por rol', () => {
  it('Admin ve los 8 módulos', () => {
    expect(idsModulos(['Admin'])).toEqual([
      'dashboard', 'finanzas', 'granja', 'admin', 'office', 'operaciones', 'logistica', 'clientes',
    ]);
  });

  it('Socio ve 3 módulos: Centro de Mando, Finanzas y Office', () => {
    expect(idsModulos(['Socio'])).toEqual(['dashboard', 'finanzas', 'office']);
  });

  it('Socio no ve Granja, Admin, Operaciones, Logística ni Clientes', () => {
    const visibles = idsModulos(['Socio']);
    for (const ausente of ['granja', 'admin', 'operaciones', 'logistica', 'clientes']) {
      expect(visibles, ausente).not.toContain(ausente);
    }
  });

  it('Comercial ve Finanzas, Office, Operaciones, Logística y Clientes', () => {
    expect(idsModulos(['Comercial'])).toEqual([
      'finanzas', 'office', 'operaciones', 'logistica', 'clientes',
    ]);
  });

  it('Bodeguero solo ve Operaciones', () => {
    expect(idsModulos(['Bodeguero'])).toEqual(['operaciones']);
  });

  it('Despachador solo ve Operaciones', () => {
    expect(idsModulos(['Despachador'])).toEqual(['operaciones']);
  });

  it('Camionero solo ve Operaciones', () => {
    expect(idsModulos(['Camionero'])).toEqual(['operaciones']);
  });

  it('un usuario con varios roles ve la unión', () => {
    expect(idsModulos(['Bodeguero', 'Comercial'])).toEqual([
      'finanzas', 'office', 'operaciones', 'logistica', 'clientes',
    ]);
  });
});

describe('etiqueta del módulo Operaciones', () => {
  it('los roles de escritorio ven la etiqueta completa', () => {
    expect(labelDeModulo('operaciones', ['Admin'])).toBe('Operaciones y Bodegas');
    expect(labelDeModulo('operaciones', ['Comercial'])).toBe('Operaciones y Bodegas');
  });

  it('los roles móviles puros ven su etiqueta propia', () => {
    expect(labelDeModulo('operaciones', ['Despachador'])).toBe('Carga a Bodega');
    expect(labelDeModulo('operaciones', ['Bodeguero'])).toBe('Recepción');
    expect(labelDeModulo('operaciones', ['Camionero'])).toBe('Confirmar Cargas');
  });

  it('un móvil que además es Admin vuelve al hub de escritorio', () => {
    expect(labelDeModulo('operaciones', ['Bodeguero', 'Admin'])).toBe('Operaciones y Bodegas');
  });

  it('los demás módulos no tienen variante por rol', () => {
    for (const m of MODULOS) {
      if (m.id === 'operaciones') continue;
      expect(labelDeModulo(m.id, m.roles)).toBe(m.label);
    }
  });
});

describe('módulo de entrada por defecto', () => {
  it('Admin entra al Centro de Mando', () => {
    expect(moduloPorDefecto(['Admin'])).toBe('dashboard');
  });

  it('los roles móviles entran a Operaciones', () => {
    for (const r of ROLES_MOVIL) expect(moduloPorDefecto([r]), r).toBe('operaciones');
  });

  it('Comercial entra a Logística; un Socio, al Centro de Mando', () => {
    expect(moduloPorDefecto(['Comercial'])).toBe('logistica');
    // Bug 7 corregido en Fase 1: un Socio caía en `logistica`, que no ve.
    expect(moduloPorDefecto(['Socio'])).toBe('dashboard');
  });

  it('el módulo por defecto siempre es alcanzable desde el propio sidebar', () => {
    for (const rol of TODOS) {
      const defecto = moduloPorDefecto([rol]);
      expect(idsModulos([rol]), `${rol} no ve su módulo por defecto`).toContain(defecto);
    }
  });
});

describe('sub-tabs por módulo y rol', () => {
  it('Granja tiene sus 4 vistas y es solo de Admin', () => {
    expect(ids(subTabsDe('granja', ['Admin']))).toEqual(ids(SUBTABS_GRANJA));
    expect(idsModulos(['Socio'])).not.toContain('granja');
  });

  it('Finanzas es Resumen · Documentos · Cobranza · Analítica con matriz por rol', () => {
    expect(ids(subTabsDe('finanzas', ['Admin']))).toEqual(['resumen', 'documentos', 'cobranza', 'analitica']);
    expect(ids(subTabsDe('finanzas', ['Socio']))).toEqual(['resumen', 'analitica']);
    expect(ids(subTabsDe('finanzas', ['Comercial']))).toEqual(['documentos', 'analitica']);
  });

  it('el tab por defecto de Finanzas es siempre visible para el rol', () => {
    // Bug 2 corregido en Fase 1 y generalized en Fase 4: cada rol aterriza en
    // el primer tab que puede ver, nunca en uno ajeno.
    for (const rol of ['Admin', 'Socio', 'Comercial'] as Role[]) {
      const visibles = ids(subTabsDe('finanzas', [rol]));
      expect(visibles, rol).toContain(subTabPorDefecto('finanzas', [rol]));
    }
    expect(subTabPorDefecto('finanzas', ['Admin'])).toBe('resumen');
    expect(subTabPorDefecto('finanzas', ['Socio'])).toBe('resumen');
    expect(subTabPorDefecto('finanzas', ['Comercial'])).toBe('documentos');
  });

  it('Comercial entra a Finanzas por Documentos', () => {
    expect(idsModulos(['Comercial'])).toContain('finanzas');
  });

  // La sub-fila de Analítica se resuelve por dos caminos distintos según dónde
  // esté el sub-tab activo. Antes solo reconocía `analitica`, así que al elegir
  // un reporte la fila desaparecía y no había forma de cambiar de reporte.
  it('la sub-fila de Analítica aparece con el tab y también con un tipo de reporte', () => {
    expect(ids(subTabsInternosDe('finanzas', 'analitica'))).toEqual([
      'reporte:financiero', 'reporte:flujo-caja', 'reporte:ventas-por-ruta',
      'reporte:produccion', 'reporte:inventario', 'reporte:desperdicios',
    ]);
    for (const tipo of TIPOS_REPORTE) {
      expect(ids(subTabsInternosDe('finanzas', idSubTabReporte(tipo.id))), tipo.id).toHaveLength(6);
    }
  });

  it('ningún otro tab pide una sub-fila', () => {
    for (const subTab of ['resumen', 'documentos', 'cobranza', '', 'inventario']) {
      expect(subTabsInternosDe('finanzas', subTab), subTab).toEqual([]);
    }
    expect(subTabsInternosDe('logistica', 'guias')).toEqual([]);
    expect(subTabsInternosDe('office', 'documentos')).toEqual([]);
  });

  it('el prefijo reporte: mantiene los ids de Analítica separados de los tabs', () => {
    // Sin prefijo, un tipo de reporte colisionaría con un tab y `subTab` dejaría
    // de saber cuál de los dos está activo.
    expect(idSubTabReporte('financiero')).toBe('reporte:financiero');
    expect(SUBTABS_FINANZAS.some(t => t.id.startsWith('reporte:'))).toBe(false);
    expect(tipoReporteDe('reporte:flujo-caja')).toBe('flujo-caja');
  });

  it('tipoReporteDe rechaza cualquier cosa que no sea un tipo de reporte', () => {
    for (const faux of ['resumen', 'analitica', 'reporte:', 'reporte:inventario-2', 'guias', '']) {
      expect(tipoReporteDe(faux), faux).toBeNull();
    }
  });

  it('los seis tipos de reporte tienen etiqueta y son únicos', () => {
    expect(TIPOS_REPORTE.map(t => t.label)).toEqual([
      'Financiero', 'Flujo de Caja', 'Ventas por Ruta', 'Producción', 'Inventario', 'Desperdicios',
    ]);
    expect(new Set(TIPOS_REPORTE.map(t => t.id)).size).toBe(TIPOS_REPORTE.length);
  });

  it('la sub-fila de Analítica lleva el breadcrumb del tab que la contiene', () => {
    for (const t of SUBTABS_ANALITICA) {
      expect(t.breadcrumb, t.id).toBe('Analítica');
    }
    expect(breadcrumbDe('finanzas', 'reporte:inventario', ['Admin'])).toEqual(['Finanzas', 'Analítica']);
  });

  it('Admin ve los 4 tabs de Admin', () => {
    expect(ids(subTabsDe('admin', ['Admin']))).toEqual(ids(SUBTABS_ADMIN));
  });

  it('Office declara Correo y Documentos; Vinculaciones llega en la Fase 6', () => {
    expect(ids(ESPACIOS_OFFICE)).toEqual(['correo', 'documentos']);
  });

  it('Logística separa bandas y ya no tiene banda admin', () => {
    // Fase 4: el tab `facturacion` salió de Logística. Documentos, en Finanzas,
    // es la única ruta a la facturación.
    const visibles = subTabsLogisticaDe(['Admin']);
    expect(visibles.filter(t => t.banda === 'nucleo').map(t => t.id))
      .toEqual(['logistica', 'guias', 'remisiones', 'caja', 'tablero']);
    expect(visibles.filter(t => t.banda === 'admin')).toEqual([]);
    expect(visibles.filter(t => t.banda === 'config').map(t => t.id))
      .toEqual(['etiquetas', 'pesos', 'precios']);
  });

  it('Comercial ve el núcleo de Logística pero no la configuración', () => {
    const visibles = subTabsLogisticaDe(['Comercial']);
    const porBanda = (b: string) => visibles.filter(t => t.banda === b).map(t => t.id);
    expect(porBanda('admin')).toEqual([]);
    expect(porBanda('config')).toEqual([]);
  });

  it('un módulo sin sub-tabs declarados devuelve lista vacía', () => {
    expect(subTabsDe('clientes', ['Admin'])).toEqual([]);
  });
});

describe('sub-tab por defecto', () => {
  it('Comercial entra a Logística por Caja Ruta', () => {
    expect(subTabPorDefecto('logistica', ['Comercial'])).toBe('caja');
  });

  it('Admin entra a Logística por la vista principal', () => {
    expect(subTabPorDefecto('logistica', ['Admin'])).toBe('logistica');
  });

  it('el camino móvil elige según el rol', () => {
    expect(subTabPorDefecto('operaciones', ['Despachador'])).toBe('carga');
    expect(subTabPorDefecto('operaciones', ['Bodeguero'])).toBe('recibir');
    expect(subTabPorDefecto('operaciones', ['Camionero'])).toBe('confirmar');
  });

  it('Camionero + Bodeguero prioriza Recepción', () => {
    expect(subTabPorDefecto('operaciones', ['Camionero', 'Bodeguero'])).toBe('recibir');
  });

  it('escritura entra a Operaciones por Produccion', () => {
    expect(subTabPorDefecto('operaciones', ['Admin'])).toBe('produccion');
  });

  it('el default de cada módulo no depende de cómo se llegó', () => {
    // Ya no hay flag `manual`: el shell salta el reseteo cuando la sub-vista se
    // eligió a mano, así que el default es siempre el mismo.
    expect(subTabPorDefecto('admin', ['Admin'])).toBe('productos');
    expect(subTabPorDefecto('logistica', ['Admin'])).toBe('logistica');
    expect(subTabPorDefecto('finanzas', ['Admin'])).toBe('resumen');
    expect(subTabPorDefecto('finanzas', ['Comercial'])).toBe('documentos');
  });
});

describe('camino móvil de Operaciones', () => {
  it('Despachador ve Carga e Incidencias', () => {
    expect(ids(subTabsOperacionesMovil(['Despachador']))).toEqual(['carga', 'incidencias']);
  });

  it('Camionero ve solo Confirmar', () => {
    expect(ids(subTabsOperacionesMovil(['Camionero']))).toEqual(['confirmar']);
  });

  it('Bodeguero ve solo Recibir', () => {
    expect(ids(subTabsOperacionesMovil(['Bodeguero']))).toEqual(['recibir']);
  });

  it('los roles de escritorio no ven la fila móvil', () => {
    for (const r of DESKTOP) expect(subTabsOperacionesMovil([r]), r).toEqual([]);
  });

  it('los roles combinados aplanan sin duplicar', () => {
    expect(ids(subTabsOperacionesMovil(['Despachador', 'Bodeguero']))).toEqual(['carga', 'incidencias', 'recibir']);
  });

  it('el sub-tab efectivo cae al primero visible si el actual no aplica', () => {
    expect(subTabMovilEfectivo(['Bodeguero'], 'carga')).toBe('recibir');
    expect(subTabMovilEfectivo(['Bodeguero'], 'recibir')).toBe('recibir');
    expect(subTabMovilEfectivo(['Camionero'], 'confirmar')).toBe('confirmar');
  });

  it('sin tabs visibles cae a Carga', () => {
    expect(subTabMovilEfectivo(['Admin'], 'produccion')).toBe('carga');
  });
});

describe('breadcrumb', () => {
  it('Centro de Mando y Clientes no llevan breadcrumb', () => {
    expect(breadcrumbDe('dashboard', '', ['Admin'])).toBeNull();
    expect(breadcrumbDe('clientes', '', ['Admin'])).toBeNull();
  });

  it('muestra módulo y sub-tab', () => {
    expect(breadcrumbDe('finanzas', 'cobranza', ['Admin'])).toEqual(['Finanzas', 'Cobranza']);
    expect(breadcrumbDe('logistica', 'guias', ['Admin'])).toEqual(['Logística', 'Guías y Camiones']);
    expect(breadcrumbDe('granja', 'salud', ['Admin'])).toEqual(['Granja', 'Salud Avícola']);
    expect(breadcrumbDe('admin', 'infraestructura', ['Admin'])).toEqual(['Admin', 'Infraestructura']);
  });

  it('el hub de Operaciones muestra solo el módulo', () => {
    expect(breadcrumbDe('operaciones', 'produccion', ['Admin'])).toEqual(['Operaciones y Bodegas', '']);
  });

  it('el camino móvil muestra el módulo y la vista efectiva', () => {
    expect(breadcrumbDe('operaciones', 'carga', ['Bodeguero'])).toEqual(['Recepción', 'Recibir']);
  });

  it('un sub-tab desconocido no rompe el breadcrumb', () => {
    expect(breadcrumbDe('granja', 'inventado', ['Admin'])).toEqual(['Granja', '']);
  });

  it('cubriría los sub-tabs declarados fuera de SUBTABS_*', () => {
    expect(breadcrumbDe('operaciones', 'desperdicios', ['Admin'])).toEqual(['Operaciones y Bodegas', '']);
  });
});

describe('consulta por id', () => {
  it('devuelve el módulo o undefined', () => {
    expect(moduloPorId('finanzas')?.label).toBe('Finanzas');
    expect(moduloPorId('inexistente' as any)).toBeUndefined();
  });

  it('labelDeModulo cae al id si el módulo no existe', () => {
    expect(labelDeModulo('inexistente' as any, ['Admin'])).toBe('inexistente');
  });

  it('subTabsLogisticaDe devuelve la unión de las tres bandas', () => {
    const total = Object.values(SUBTABS_LOGISTICA).reduce((n, b) => n + b.length, 0);
    expect(subTabsLogisticaDe(['Admin']).length).toBe(total);
  });
});
