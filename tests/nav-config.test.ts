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
  SUBTABS_ADMIN, SUBTABS_FINANZAS, SUBTABS_LOGISTICA,
  SUBTABS_ANALITICA, TIPOS_REPORTE, idSubTabReporte, tipoReporteDe, subTabsInternosDe,
  rolesEfectivos, modulosVisibles, moduloPorId, labelDeModulo, moduloPorDefecto,
  subTabsDe, subTabsLogisticaDe, subTabPorDefecto, subTabsOperacionesMovil,
  subTabMovilEfectivo, breadcrumbDe, esRolMovil, validarConfig, INCIDENCIAS_CONOCIDAS,
  espacioOfficeDe, BREADCRUMB_EXTRA, destinoGrupoOperaciones,
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
  it('Admin ve los 6 módulos: en Fase 7 dejó de existir el módulo Granja', () => {
    // Granja no se repartió entre Logistics ni Office: pasó a ser un grupo del
    // hub de Operaciones, que es de Admin. Un módulo que solo Admin puede ver y
    // que comparte sitio con otros cuatro grupos es una fila más, no un destino.
    expect(idsModulos(['Admin'])).toEqual([
      'finanzas', 'admin', 'office', 'operaciones', 'logistica', 'clientes',
    ]);
    expect(MODULOS.map(m => m.id)).not.toContain('granja');
  });

  it('Socio ve 2 módulos: Finanzas y Office', () => {
    expect(idsModulos(['Socio'])).toEqual(['finanzas', 'office']);
  });

  it('ningún rol ve el módulo dashboard, que fue disuelto en Fase 5', () => {
    for (const rol of TODOS) {
      expect(idsModulos([rol]), rol).not.toContain('dashboard');
    }
  });

  it('Socio no ve Admin, Operaciones, Logística ni Clientes', () => {
    const visibles = idsModulos(['Socio']);
    for (const ausente of ['admin', 'operaciones', 'logistica', 'clientes']) {
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
  it('Admin entra a Finanzas, que es donde vive el P&L', () => {
    expect(moduloPorDefecto(['Admin'])).toBe('finanzas');
  });

  it('los roles móviles entran a Operaciones', () => {
    for (const r of ROLES_MOVIL) expect(moduloPorDefecto([r]), r).toBe('operaciones');
  });

  it('Comercial entra a Logística; un Socio, a Finanzas', () => {
    expect(moduloPorDefecto(['Comercial'])).toBe('logistica');
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

  it('Admin ve los cinco grupos y Comercial solo los dos que le tocan', () => {
    expect(ids(subTabsDe('operaciones', ['Admin'])))
      .toEqual(['resumen', 'granja', 'bodega', 'despacho', 'ventas']);
    expect(ids(subTabsDe('operaciones', ['Comercial']))).toEqual(['despacho', 'ventas']);
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

  it('Bodega expone Existencias y Control como sub-fila', () => {
    // El id de la vista se renombró de `bodega` a `existencias` para no colisionar
    // con el grupo contenedor. Con los dos nombres conviviendo, `subTab` no
    // podría decir cuál de los dos está activo.
    expect(ids(SUBTABS_BODEGA)).toEqual(['existencias', 'control']);
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
    for (const id of ['existencias', 'control']) {
      expect(subTabsInternosDe('operaciones', id), id).toEqual(SUBTABS_BODEGA);
    }
  });

  it('los grupos sin sub-fila no piden fila, y Bodega no se confunde con su grupo', () => {
    for (const subTab of ['resumen', 'despacho', 'ventas', '', 'carga', 'recibir']) {
      expect(subTabsInternosDe('operaciones', subTab), subTab).toEqual([]);
    }
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

  it('Admin ve los 3 tabs que le quedan tras el salida de Vinculaciones', () => {
    expect(ids(subTabsDe('admin', ['Admin']))).toEqual(['productos', 'infraestructura', 'usuarios']);
    expect(ids(SUBTABS_ADMIN)).toEqual(['productos', 'infraestructura', 'usuarios']);
  });

  it('Office declara Correo, Documentos y Vinculaciones', () => {
    expect(ids(ESPACIOS_OFFICE)).toEqual(['correo', 'documentos', 'vinculaciones']);
  });

  it('Vinculaciones de Office es el único espacio con filtro: solo Admin', () => {
    // Refleja `requireOfficeAdmin` en el backend. Si el filtro desapareciera,
    // Socio y Comercial abrirían el espacio y verían el 403 en pantalla.
    expect(ids(subTabsDe('office', ['Admin']))).toEqual(['correo', 'documentos', 'vinculaciones']);
    for (const rol of ['Socio', 'Comercial'] as const) {
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
    expect(espacioOfficeDe('vinculaciones', ['Admin'])).toBe('vinculaciones');
    expect(espacioOfficeDe('documentos', ['Socio'])).toBe('documentos');
    // Un `subTab` heredado de la época en que Vinculaciones vivía en Admin no
    // puede montar Vinculaciones para un Socio.
    for (const rol of ['Socio', 'Comercial'] as const) {
      expect(espacioOfficeDe('vinculaciones', [rol]), rol).toBe('correo');
    }
    // Id desconocido: al primer espacio visible, no a un espacio arbitrario.
    expect(espacioOfficeDe('inventado', ['Admin'])).toBe('correo');
    expect(espacioOfficeDe('', ['Comercial'])).toBe('correo');
  });

  it('Logística separa bandas y ya no tiene banda admin', () => {
    // Fase 4: el tab `facturacion` salió de Logística. Documentos, en Finanzas,
    // es la única ruta a la facturación.
    // Fase 7: `remisiones` y `caja` también salieron. Remisiones es el grupo
    // Despacho y Caja Ruta es el grupo Ventas, los dos en el hub. Lo que se va de
    // un sitio no puede seguir apareciendo en otro: dos puertas al mismo trabajo
    // significa dos rutas de soporte y dos caminos para aprender.
    const visibles = subTabsLogisticaDe(['Admin']);
    expect(visibles.filter(t => t.banda === 'nucleo').map(t => t.id))
      .toEqual(['logistica', 'guias', 'tablero']);
    expect(visibles.filter(t => t.banda === 'admin')).toEqual([]);
    expect(visibles.filter(t => t.banda === 'config').map(t => t.id))
      .toEqual(['etiquetas', 'pesos', 'precios']);
    for (const id of ['remisiones', 'caja']) {
      expect(ids(subTabsLogisticaDe(['Admin', 'Comercial']))).not.toContain(id);
      expect(MODULOS.some(m => m.id === 'logistica' && m.id === id), id).toBe(false);
    }
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
  it('Logística entra por su vista principal para los dos roles de escritorio', () => {
    // Antes el Comercial entraba por Caja Ruta, que en Fase 7 es el grupo Ventas
    // del hub. Un módulo cuyo default cambia con el rol esconde el trabajo de
    // escritorio de uno de los dos; ahora los dos entran al mismo lugar.
    expect(subTabPorDefecto('logistica', ['Comercial'])).toBe('logistica');
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

  it('Admin entra a Operaciones por Resumen y Comercial por Despacho', () => {
    // El default de escritorio es el primer grupo visible, nunca uno fijo. Fase 7
    // cerró la incidencia `operaciones/produccion`: `produccion` era un sub-tab
    // que nadie podía montar, así que Admin caía en una pantalla vacía.
    expect(subTabPorDefecto('operaciones', ['Admin'])).toBe('resumen');
    expect(subTabPorDefecto('operaciones', ['Comercial'])).toBe('despacho');
    // Y ningún rol de escritorio aterriza en un grupo que no ve.
    for (const rol of ['Admin', 'Comercial', 'Socio'] as Role[]) {
      const visibles = ids(subTabsDe('operaciones', [rol]));
      if (!visibles.length) continue;
      expect(visibles, rol).toContain(subTabPorDefecto('operaciones', [rol]));
    }
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
    expect(subTabMovilEfectivo(['Admin'], 'granja')).toBe('carga');
  });
});

describe('breadcrumb', () => {
  it('Clientes no lleva breadcrumb', () => {
    expect(breadcrumbDe('clientes', '', ['Admin'])).toBeNull();
  });

  it('muestra módulo y sub-tab', () => {
    expect(breadcrumbDe('finanzas', 'cobranza', ['Admin'])).toEqual(['Finanzas', 'Cobranza']);
    expect(breadcrumbDe('logistica', 'guias', ['Admin'])).toEqual(['Logística', 'Guías y Camiones']);
    expect(breadcrumbDe('operaciones', 'salud', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Granja']);
    expect(breadcrumbDe('admin', 'infraestructura', ['Admin'])).toEqual(['Admin', 'Infraestructura']);
  });

  it('el hub de Operaciones nombra el grupo activo', () => {
    // Antes el breadcrumb del hub solo mostraba el módulo y el id `produccion`
    // quedaba sin nombre, que es como se descubre que se está en un id que no
    // existe. Ahora cada grupo se nombra solo.
    expect(breadcrumbDe('operaciones', 'resumen', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Resumen del día']);
    expect(breadcrumbDe('operaciones', 'granja', ['Admin'])).toEqual(['Operaciones y Bodegas', 'Granja']);
    expect(breadcrumbDe('operaciones', 'ventas', ['Comercial'])).toEqual(['Operaciones y Bodegas', 'Ventas']);
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

  it('subTabsLogisticaDe devuelve la unión de las tres bandas', () => {
    const total = Object.values(SUBTABS_LOGISTICA).reduce((n, b) => n + b.length, 0);
    expect(subTabsLogisticaDe(['Admin']).length).toBe(total);
  });
});

describe('destino de la búsqueda hacia un grupo del hub', () => {
  it('lleva al grupo pedido cuando el rol lo ve', () => {
    expect(destinoGrupoOperaciones('despacho', ['Admin'])).toEqual({ modulo: 'operaciones', subTab: 'despacho' });
    expect(destinoGrupoOperaciones('ventas', ['Comercial'])).toEqual({ modulo: 'operaciones', subTab: 'ventas' });
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
    expect(destinoGrupoOperaciones('despacho', ['Camionero'])).toEqual({ modulo: 'operaciones', subTab: 'confirmar' });
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
