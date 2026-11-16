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
  SUBTABS_GRANJA, SUBTABS_BODEGA, SUBTABS_OPERACIONES_DESKTOP, SUBTABS_POR_MODULO,
  SUBTABS_DESPACHO, SUBTABS_VENTAS,
  SUBTABS_ADMIN, SUBTABS_FINANZAS,
  SUBTABS_ANALITICA, TIPOS_REPORTE, idSubTabReporte, tipoReporteDe, subTabsInternosDe,
  rolesEfectivos, modulosVisibles, moduloPorId, labelDeModulo, moduloPorDefecto,
  subTabsDe, subTabPorDefecto, subTabsOperacionesMovil, grupoQueContiene,
  subTabMovilEfectivo, breadcrumbDe, esRolMovil, validarConfig, INCIDENCIAS_CONOCIDAS,
  espacioOfficeDe, BREADCRUMB_EXTRA, destinoGrupoOperaciones,
} from '../src/nav/modulos';

const TODOS: Role[] = ['Admin', 'Socio', 'Comercial', 'Despachador', 'Bodeguero', 'Camionero'];
const DESKTOP: Role[] = ['Admin', 'Socio'];

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
        if (!porDefecto) continue;
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
  it('Admin ve los 5 módulos: Granja y Logística pasaron al hub de Operaciones', () => {
    // Granja no se repartió entre Logistics ni Office: pasó a ser un grupo del
    // hub de Operaciones, que es de Admin. Un módulo que solo Admin puede ver y
    // que comparte sitio con otros cuatro grupos es una fila más, no un destino.
    // Lo mismo en Fase 8 con Logística: su contenido vive como sub-fila de los
    // grupos Despacho y Ventas del mismo hub.
    expect(idsModulos(['Admin'])).toEqual([
      'office', 'operaciones', 'clientes', 'finanzas', 'admin',
    ]);
    expect(MODULOS.map(m => m.id)).not.toContain('granja');
    expect(MODULOS.map(m => m.id)).not.toContain('logistica');
  });

  it('Socio ve Dirección, CRM de solo lectura y Finanzas', () => {
    expect(idsModulos(['Socio'])).toEqual(['office', 'clientes', 'finanzas']);
  });

  it('ningún rol ve el módulo dashboard, que fue disuelto en Fase 5', () => {
    for (const rol of TODOS) {
      expect(idsModulos([rol]), rol).not.toContain('dashboard');
    }
  });

  it('Socio no ve Admin ni Operaciones', () => {
    const visibles = idsModulos(['Socio']);
    for (const ausente of ['admin', 'operaciones', 'logistica']) {
      expect(visibles, ausente).not.toContain(ausente);
    }
  });

  it('Comercial ve Dirección, Operaciones, Clientes y Finanzas', () => {
    expect(idsModulos(['Comercial'])).toEqual([
      'office', 'operaciones', 'clientes', 'finanzas',
    ]);
  });

  it('Bodeguero solo ve Operaciones', () => {
    expect(idsModulos(['Bodeguero'])).toEqual(['operaciones']);
  });

  it('Despachador solo ve Operaciones', () => {
    expect(idsModulos(['Despachador'])).toEqual(['operaciones']);
  });

  it('Camionero legado hereda exactamente los módulos de Comercial', () => {
    expect(idsModulos(['Camionero'])).toEqual(idsModulos(['Comercial']));
  });

  it('un usuario con varios roles ve la unión', () => {
    expect(idsModulos(['Bodeguero', 'Comercial'])).toEqual([
      'office', 'operaciones', 'clientes', 'finanzas',
    ]);
  });
});

describe('etiqueta del módulo Operaciones', () => {
  it('Admin ve la etiqueta completa y Comercial entra a Mi Ruta', () => {
    expect(labelDeModulo('operaciones', ['Admin'])).toBe('Operaciones y Bodegas');
    expect(labelDeModulo('operaciones', ['Comercial'])).toBe('Mi Ruta');
  });

  it('los roles móviles puros ven su etiqueta propia', () => {
    expect(labelDeModulo('operaciones', ['Despachador'])).toBe('Carga a Bodega');
    expect(labelDeModulo('operaciones', ['Bodeguero'])).toBe('Recepción');
    expect(labelDeModulo('operaciones', ['Camionero'])).toBe('Mi Ruta');
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
  it('Admin entra a Finanzas, que es donde vive el P&L', () => {
    expect(moduloPorDefecto(['Admin'])).toBe('finanzas');
  });

  it('los roles móviles entran a Operaciones', () => {
    for (const r of ROLES_MOVIL) expect(moduloPorDefecto([r]), r).toBe('operaciones');
  });

  it('Comercial y Camionero entran a Mi Ruta; un Socio, a Finanzas', () => {
    // Fase 8: Logística ya no es un módulo. Lo que el Comercial hacía ahí vive
    // en los grupos Despacho y Ventas del hub, que sí ve, así que entra ahí.
    expect(moduloPorDefecto(['Comercial'])).toBe('operaciones');
    // Bug 7 corregido en Fase 1: un Socio caía en `logistica`, que no ve.
    // Fase 5: el destino ya no es el Centro de Mando, que fue disuelto.
    expect(moduloPorDefecto(['Socio'])).toBe('finanzas');
  });

  it('el módulo por defecto siempre es alcanzable desde el propio sidebar', () => {
    for (const rol of TODOS) {
      const defecto = moduloPorDefecto([rol]);
      expect(idsModulos([rol]), `${rol} no ve su módulo por defecto`).toContain(defecto);
    }
  });
});

describe('hub de Operaciones de escritorio', () => {
  it('declaro los cinco grupos en orden y no hay un grupo residual', () => {
    expect(ids(SUBTABS_OPERACIONES_DESKTOP)).toEqual(['resumen', 'granja', 'bodega', 'despacho', 'ventas']);
    expect(SUBTABS_POR_MODULO.operaciones).toBe(SUBTABS_OPERACIONES_DESKTOP);
  });

  it('Admin ve los cinco grupos; Comercial y Camionero usan el flujo móvil', () => {
    expect(ids(subTabsDe('operaciones', ['Admin'])))
      .toEqual(['resumen', 'granja', 'bodega', 'despacho', 'ventas']);
    expect(ids(subTabsDe('operaciones', ['Comercial']))).toEqual([]);
    expect(ids(subTabsOperacionesMovil(['Camionero']))).toEqual(['venta-movil', 'facturar-movil', 'cargas-comercial']);
    for (const rol of ['Socio'] as Role[]) {
      expect(ids(subTabsDe('operaciones', [rol])), rol).toEqual([]);
    }
  });

  it('el reparto de roles por grupo es explícito, no "Admin hasta que se demuestre lo contrario"', () => {
    const rolesDe = (id: string) => SUBTABS_OPERACIONES_DESKTOP.find(t => t.id === id)?.roles;
    expect(rolesDe('resumen')).toEqual(['Admin']);
    expect(rolesDe('granja')).toEqual(['Admin']);
    expect(rolesDe('bodega')).toEqual(['Admin']);
    expect(rolesDe('despacho')).toEqual(['Admin', 'Comercial']);
    expect(rolesDe('ventas')).toEqual(['Admin', 'Comercial']);
  });

  it('los roles móviles puros no ven ningún grupo de escritorio', () => {
    // Su camino no cambia: BodegaAdmin, DespachoMovil y compañía siguen montados
    // por `esRolMovil`, no por la fila de grupos.
    for (const r of ROLES_MOVIL) {
      expect(subTabsDe('operaciones', [r]), r).toEqual([]);
      expect(subTabsOperacionesMovil([r]).length, r).toBeGreaterThan(0);
    }
  });
});

describe('sub-filas del hub de Operaciones', () => {
  it('Granja expone sus cuatro vistas como sub-fila, no como módulo', () => {
    expect(ids(SUBTABS_GRANJA)).toEqual(['granjas', 'salud', 'alimento', 'mantenimiento']);
    // El maestro de alta se queda en Admin: crear granjas es tocar el maestro de
    // datos, y eso sigue siendo de Admin aunque la lista viva en el hub.
    expect(subTabsInternosDe('operaciones', 'granja')).toEqual(SUBTABS_GRANJA);
    expect(idsModulos(['Admin'])).not.toContain('granja');
  });

  it('Bodega expone Entradas, Existencias y Control como sub-fila', () => {
    // El id de la vista se renombró de `bodega` a `existencias` para no colisionar
    // con el grupo contenedor. Con los dos nombres conviviendo, `subTab` no
    // podría decir cuál de los dos está activo. `bodega-entradas` es el paso que
    // recibe la remisión GR- y el alistamiento, que en la Fase 11 salen del
    // grupo Despacho.
    expect(ids(SUBTABS_BODEGA)).toEqual(['bodega-entradas', 'existencias', 'control']);
    expect(SUBTABS_BODEGA.some(t => t.id === 'bodega')).toBe(false);
    expect(subTabsInternosDe('operaciones', 'bodega')).toEqual(SUBTABS_BODEGA);
  });

  it('la sub-fila sigue visible cuando el sub-tab activo ya es una de sus vistas', () => {
    // Igual que Analítica con sus tipos de reporte: si la fila solo apareciera con
    // el id del grupo, al elegir "Salud Avícola" la fila desaparecería y no habría
    // forma de volver a las otras tres sin abrir el hub de nuevo.
    for (const id of ['granjas', 'salud', 'alimento', 'mantenimiento']) {
      expect(subTabsInternosDe('operaciones', id), id).toEqual(SUBTABS_GRANJA);
    }
    for (const id of ['bodega-entradas', 'existencias', 'control']) {
      expect(subTabsInternosDe('operaciones', id), id).toEqual(SUBTABS_BODEGA);
    }
    for (const id of ['despacho', 'despacho-guias', 'despacho-camiones', 'despacho-etiquetas', 'despacho-pesos']) {
      expect(subTabsInternosDe('operaciones', id), id).toEqual(SUBTABS_DESPACHO);
    }
    for (const id of ['ventas', 'ventas-tablero', 'ventas-precios']) {
      expect(subTabsInternosDe('operaciones', id), id).toEqual(SUBTABS_VENTAS);
    }
  });

  it('los grupos sin sub-fila no piden fila, y Bodega no se confunde con su grupo', () => {
    for (const subTab of ['resumen', '', 'carga', 'recibir']) {
      expect(subTabsInternosDe('operaciones', subTab), subTab).toEqual([]);
    }
  });

  it('Despacho y Ventas son las sub-filas que absorbieron el módulo Logística', () => {
    // Fase 8: el módulo Logística desaparece y su contenido vive en estas dos
    // sub-filas. La configuración (etiquetas, pesos, precios) era de Admin y
    // sigue siéndolo: el Comercial ve solo el día a día de la ruta. La guía
    // GD- completa es el cuerpo del grupo Despacho, y la remisión GR- con el
    // alistamiento se movieron a Bodega (Fase 11). La Fase 12 agrega la GD- como
    // paso de la sub-fila ("Guías de Despacho") y unifica camiones y rutas en
    // "Flota y Rutas": cuatro pasos en total. La consolidación G2 saca el último
    // paso que le quedaba a Ventas sobre lo de Logística: la auditoría de merma
    // se muda a la pantalla de Despacho, que es la que crea las guías que se
    // auditan, y deja de ser un paso de navegación. La consolidación G3 elimina
    // el cierre de ruta como paso aparte: "Cierre y Conciliación" desaparece y el
    // cuadre se hace desde Despacho con el endpoint completo.
    expect(ids(SUBTABS_DESPACHO)).toEqual([
      'despacho-guias', 'despacho-camiones', 'despacho-etiquetas', 'despacho-pesos',
    ]);
    expect(ids(SUBTABS_VENTAS)).toEqual([
      'ventas-tablero', 'ventas-precios',
    ]);
    const rolesDe = (tabs: { id: string; roles?: Role[] }[], id: string) =>
      tabs.find(t => t.id === id)?.roles;
    expect(rolesDe(SUBTABS_DESPACHO, 'despacho-guias')).toEqual(['Admin', 'Comercial']);
    expect(rolesDe(SUBTABS_DESPACHO, 'despacho-camiones')).toEqual(['Admin', 'Comercial']);
    expect(rolesDe(SUBTABS_DESPACHO, 'despacho-etiquetas')).toEqual(['Admin', 'Bodeguero', 'Despachador']);
    expect(rolesDe(SUBTABS_DESPACHO, 'despacho-pesos')).toEqual(['Admin', 'Bodeguero', 'Despachador']);
    expect(rolesDe(SUBTABS_VENTAS, 'ventas-precios')).toEqual(['Admin']);
    // El Comercial ya no entra al hub de escritorio: su flujo móvil reúne venta,
    // facturación y confirmación de cargas sin pestañas administrativas.
    expect(ids(subTabsInternosDe('operaciones', 'despacho', ['Comercial']))).toEqual([]);
    expect(ids(subTabsInternosDe('operaciones', 'ventas', ['Comercial']))).toEqual([]);
    // Sin roles no filtra: es la forma en que el shell pide la fila completa.
    expect(ids(subTabsInternosDe('operaciones', 'despacho'))).toHaveLength(4);
  });

  it('al elegir una vista de la sub-fila, la fila primaria sigue marcando su grupo', () => {
    // Igual que Finanzas manda `analitica` a la fila primaria cuando el sub-tab es
    // un reporte: elegir "Guías de Despacho" no puede apagar el botón Despacho.
    expect(grupoQueContiene('operaciones', 'despacho-camiones')).toBe('despacho');
    expect(grupoQueContiene('operaciones', 'bodega-entradas')).toBe('bodega');
    expect(grupoQueContiene('operaciones', 'ventas-precios')).toBe('ventas');
    expect(grupoQueContiene('operaciones', 'salud')).toBe('granja');
    expect(grupoQueContiene('operaciones', 'despacho')).toBe('despacho');
    expect(grupoQueContiene('operaciones', 'inventado')).toBe('inventado');
  });
});

describe('sub-tabs por módulo y rol', () => {
  it('el camino móvil de Operaciones no comparte ids con el hub de escritorio', () => {
    // `bodega` y `existencias` convivían en la Fase 6 con el grupo del hub, así
    // que un `subTab` heredado podía montar la vista equivocada sin que se notara.
    const escritorio = new Set(ids(SUBTABS_OPERACIONES_DESKTOP));
    for (const t of subTabsOperacionesMovil(['Despachador', 'Bodeguero', 'Camionero'])) {
      expect(escritorio.has(t.id), t.id).toBe(false);
    }
  });

  it('Comercial solo ve Documentos; analítica es para Admin y Socio', () => {
    expect(ids(subTabsDe('finanzas', ['Admin']))).toEqual(['resumen', 'documentos', 'cobranza', 'analitica']);
    expect(ids(subTabsDe('finanzas', ['Socio']))).toEqual(['resumen', 'analitica']);
    expect(ids(subTabsDe('finanzas', ['Comercial']))).toEqual(['documentos']);
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

  it('Admin declara configuración, aprobaciones y vinculaciones', () => {
    expect(ids(subTabsDe('admin', ['Admin']))).toEqual(['productos', 'infraestructura', 'usuarios', 'aprobaciones', 'vinculaciones']);
    expect(ids(SUBTABS_ADMIN)).toEqual(['productos', 'infraestructura', 'usuarios', 'aprobaciones', 'vinculaciones']);
    expect(ids(subTabsDe('admin', ['Comercial']))).toEqual(['productos', 'infraestructura', 'usuarios', 'vinculaciones']);
    expect(ids(subTabsDe('admin', ['Admin', 'Comercial']))).toContain('aprobaciones');
  });

  it('Office declara solo Correo y Documentos', () => {
    // Vinculaciones es configuración del sistema: vive en Admin. Office queda
    // como la bandeja de correo y sus documentos, que es lo que usan los tres roles.
    expect(ids(ESPACIOS_OFFICE)).toEqual(['correo', 'documentos']);
  });

  it('los dos espacios de Office son visibles para los tres roles, sin filtro', () => {
    // Ya no hay un espacio con filtro por rol: el que lo tenía era Vinculaciones,
    // que se movió a Admin. Así ningún rol abre un espacio y recibe un 403.
    for (const rol of ['Admin', 'Socio', 'Comercial'] as const) {
      expect(ids(subTabsDe('office', [rol])), rol).toEqual(['correo', 'documentos']);
    }
  });

  it('el default de Office es Correo para los tres roles, no un string vacío', () => {
    // Devolver `''` era lo que obligaba a `validarConfig` a saltarse Office con
    // `m.id === 'office'`. Ya no hace falta la excepción.
    for (const rol of ['Admin', 'Socio', 'Comercial'] as const) {
      expect(subTabPorDefecto('office', [rol]), rol).toBe('correo');
    }
  });

  it('el espacio que se monta es el subTab solo si ese rol lo ve', () => {
    expect(espacioOfficeDe('documentos', ['Admin'])).toBe('documentos');
    expect(espacioOfficeDe('documentos', ['Socio'])).toBe('documentos');
    // Un `subTab` heredado de cuando Vinculaciones vivía en Office no puede montar
    // un espacio que ya no existe: cae en Correo.
    expect(espacioOfficeDe('vinculaciones', ['Admin'])).toBe('correo');
    // Id desconocido: al primer espacio visible, no a un espacio arbitrario.
    expect(espacioOfficeDe('inventado', ['Admin'])).toBe('correo');
    expect(espacioOfficeDe('', ['Comercial'])).toBe('correo');
  });

  it('el módulo Logística ya no existe como segunda puerta a la ruta', () => {
    // Fase 8: lo que antes era un módulo con tres bandas vive en la sub-fila de
    // los grupos Despacho y Ventas. No hay un único punto de salida que pueda
    // reaparecer con otra ruta de navegación.
    expect(MODULOS.some(m => (m.id as string) === 'logistica')).toBe(false);
    expect(ids(SUBTABS_DESPACHO)).not.toContain('remisiones');
    expect(ids(SUBTABS_VENTAS)).not.toContain('caja');
  });

  it('Comercial ve el día a día de Despacho y Ventas, pero no la configuración', () => {
    // La configuración que el módulo Logística separaba en su banda `config`
    // (etiquetas, pesos, precios) vive ahora en las sub-filas de Despacho y
    // Ventas, y sigue siendo solo de Admin.
    const despacho = ids(subTabsInternosDe('operaciones', 'despacho', ['Comercial']));
    expect(despacho).not.toContain('despacho-etiquetas');
    expect(despacho).not.toContain('despacho-pesos');
    const ventas = ids(subTabsInternosDe('operaciones', 'ventas', ['Comercial']));
    expect(ventas).not.toContain('ventas-precios');
  });

  it('un módulo sin sub-tabs declarados devuelve lista vacía', () => {
    expect(subTabsDe('clientes', ['Admin'])).toEqual([]);
  });
});

describe('sub-tab por defecto', () => {
  it('Admin entra por Resumen y Comercial usa la entrada móvil de venta', () => {
    // Antes el Comercial entraba a Logística por Caja Ruta, que en Fase 7 es el
    // grupo Ventas del hub. Ahora Caja Ruta y Despacho son grupos del mismo hub
    // y el Comercial entra por el que ve en primer lugar.
    expect(subTabPorDefecto('operaciones', ['Comercial'])).toBe('venta-movil');
  });

  it('Admin entra a Despacho por la vista principal', () => {
    expect(subTabPorDefecto('operaciones', ['Admin'])).toBe('resumen');
  });

  it('el camino móvil elige según el rol comercial unificado', () => {
    expect(subTabPorDefecto('operaciones', ['Despachador'])).toBe('carga');
    expect(subTabPorDefecto('operaciones', ['Bodeguero'])).toBe('recibir');
    expect(subTabPorDefecto('operaciones', ['Camionero'])).toBe('venta-movil');
  });

  it('Camionero + Bodeguero prioriza Recepción', () => {
    expect(subTabPorDefecto('operaciones', ['Camionero', 'Bodeguero'])).toBe('recibir');
  });

  it('Admin entra a Operaciones por Resumen y Comercial por Venta móvil', () => {
    // El default de escritorio es el primer grupo visible, nunca uno fijo. Fase 7
    // cerró la incidencia `operaciones/produccion`: `produccion` era un sub-tab
    // que nadie podía montar, así que Admin caía en una pantalla vacía.
    expect(subTabPorDefecto('operaciones', ['Admin'])).toBe('resumen');
    expect(subTabPorDefecto('operaciones', ['Comercial'])).toBe('venta-movil');
    // Y ningún rol de escritorio aterriza en un grupo que no ve.
    for (const rol of ['Admin', 'Comercial', 'Socio'] as Role[]) {
      if (rol === 'Comercial') continue; // su entrada corresponde a la fila móvil
      const visibles = ids(subTabsDe('operaciones', [rol]));
      if (!visibles.length) continue;
      expect(visibles, rol).toContain(subTabPorDefecto('operaciones', [rol]));
    }
  });

  it('el default de cada módulo no depende de cómo se llegó', () => {
    // Ya no hay flag `manual`: el shell salta el reseteo cuando la sub-vista se
    // eligió a mano, así que el default es siempre el mismo.
    expect(subTabPorDefecto('admin', ['Admin'])).toBe('productos');
    expect(subTabPorDefecto('operaciones', ['Comercial'])).toBe('venta-movil');
    expect(subTabPorDefecto('finanzas', ['Admin'])).toBe('resumen');
    expect(subTabPorDefecto('finanzas', ['Comercial'])).toBe('documentos');
  });
});

describe('camino móvil de Operaciones', () => {
  it('Despachador ve Carga e Incidencias', () => {
    expect(ids(subTabsOperacionesMovil(['Despachador']))).toEqual(['carga', 'incidencias']);
  });

  it('Comercial (incluido Camionero legado) ve Venta, Facturar y Cargas', () => {
    expect(ids(subTabsOperacionesMovil(['Camionero']))).toEqual(['venta-movil', 'facturar-movil', 'cargas-comercial']);
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
    expect(subTabMovilEfectivo(['Camionero'], 'confirmar')).toBe('venta-movil');
  });

  it('sin tabs visibles cae a Carga', () => {
    expect(subTabMovilEfectivo(['Admin'], 'granja')).toBe('carga');
  });
});

describe('breadcrumb', () => {
  it('Clientes no lleva breadcrumb', () => {
    expect(breadcrumbDe('clientes', '', ['Admin'])).toBeNull();
  });

  it('muestra módulo y sub-tab', () => {
    expect(breadcrumbDe('finanzas', 'cobranza', ['Admin'])).toEqual(['Finanzas', 'Cobranza']);
    expect(breadcrumbDe('operaciones', 'despacho', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Despacho']);
    expect(breadcrumbDe('operaciones', 'salud', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Granja']);
    expect(breadcrumbDe('admin', 'infraestructura', ['Admin'])).toEqual(['Admin', 'Infraestructura']);
  });

  it('el hub de Operaciones nombra el grupo activo', () => {
    // Antes el breadcrumb del hub solo mostraba el módulo y el id `produccion`
    // quedaba sin nombre, que es como se descubre que se está en un id que no
    // existe. Ahora cada grupo se nombra solo.
    expect(breadcrumbDe('operaciones', 'resumen', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Resumen del día']);
    expect(breadcrumbDe('operaciones', 'granja', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Granja']);
    expect(breadcrumbDe('operaciones', 'ventas', ['Comercial'])).toEqual(['Mi Ruta', 'Venta']);
  });

  it('el camino móvil muestra el módulo y la vista efectiva', () => {
    expect(breadcrumbDe('operaciones', 'carga', ['Bodeguero'])).toEqual(['Recepción', 'Recibir']);
  });

  it('un sub-tab desconocido no rompe el breadcrumb', () => {
    expect(breadcrumbDe('operaciones', 'inventado', ['Admin'])).toEqual(['Operaciones y Bodegas', '']);
  });

  it('las vistas de Bodega y Granja se nombran con el grupo que las contiene', () => {
    // Una vista de sub-fila no es un tab del módulo, así que el breadcrumb nombra
    // el grupo que la contiene, igual que un reporte nombra "Analítica". La vista
    // exacta ya está marcada en la fila de arriba, y el breadcrumb no crece un
    // nivel por cada clic. `desperdicios` y `produccion` vivían en
    // BREADCRUMB_EXTRA justamente porque eran ids que no venían de SUBTABS_*; los
    // dos desaparecieron, y esa tabla vacía avisa si vuelve a hacer falta.
    expect(breadcrumbDe('operaciones', 'control', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Bodega']);
    expect(breadcrumbDe('operaciones', 'existencias', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Bodega']);
    expect(breadcrumbDe('operaciones', 'bodega-entradas', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Bodega']);
    expect(Object.keys(BREADCRUMB_EXTRA)).toEqual([]);
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

  it('las sub-filas de Despacho y Ventas juntan sus pasos', () => {
    // Con la unión de bandas de Logística bastaba un solo arreglo; ahora los dos
    // grupos declaran sus propios pasos y el shell los filtra por rol en el sitio.
    expect(subTabsInternosDe('operaciones', 'despacho')).toHaveLength(SUBTABS_DESPACHO.length);
    expect(subTabsInternosDe('operaciones', 'ventas')).toHaveLength(SUBTABS_VENTAS.length);
  });
});

describe('destino de la búsqueda hacia un grupo del hub', () => {
  it('lleva al grupo pedido cuando el rol lo ve', () => {
    expect(destinoGrupoOperaciones('despacho', ['Admin'])).toEqual({ modulo: 'operaciones', subTab: 'despacho' });
    expect(destinoGrupoOperaciones('ventas', ['Comercial'])).toEqual({ modulo: 'operaciones', subTab: 'venta-movil' });
    expect(destinoGrupoOperaciones('granja', ['Admin'])).toEqual({ modulo: 'operaciones', subTab: 'granja' });
  });

  it('devuelve null para un rol sin Operaciones, en vez de un módulo vacío', () => {
    // Un Socio busca "granja". La granja no existe para él, y el peor resultado
    // posible es abrir el módulo igual: sin fila y sin cuerpo, con el texto
    // buscado a la vista y el resultado en ninguna pantalla.
    expect(destinoGrupoOperaciones('granja', ['Socio'])).toBeNull();
    expect(destinoGrupoOperaciones('despacho', ['Socio'])).toBeNull();
    // Tampoco un Comercial puede buscar Granja o Bodega: son de Admin.
    expect(destinoGrupoOperaciones('granja', ['Comercial'])).toBeNull();
    expect(destinoGrupoOperaciones('bodega', ['Comercial'])).toBeNull();
  });

  it('un rol móvil aterriza en su propia pantalla de Operaciones', () => {
    // Sigue siendo Operaciones, que es el módulo que sí ve en el sidebar, pero con
    // el sub-tab móvil: el camino de escritorio no existe para él.
    expect(destinoGrupoOperaciones('despacho', ['Camionero'])).toEqual({ modulo: 'operaciones', subTab: 'cargas-comercial' });
    expect(destinoGrupoOperaciones('despacho', ['Bodeguero'])).toEqual({ modulo: 'operaciones', subTab: 'recibir' });
    expect(destinoGrupoOperaciones('despacho', ['Despachador'])).toEqual({ modulo: 'operaciones', subTab: 'carga' });
  });

  it('con Admin y un rol móvil manda el camino móvil, que es el que monta el shell', () => {
    // La fila de escritorio le enseñaría los cinco grupos, pero `esRolMovil` gana
    // al montar el cuerpo: devolverle un grupo de escritorio lo dejaría en un
    // sub-tab que ninguna fila tiene marcado.
    expect(destinoGrupoOperaciones('granja', ['Admin', 'Bodeguero'])).toEqual({ modulo: 'operaciones', subTab: 'recibir' });
  });
});
