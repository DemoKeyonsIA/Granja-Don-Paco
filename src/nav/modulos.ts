/**
 * Definición declarativa de la arquitectura de información (sidebar, tabs y
 * breadcrumbs) del ERP.
 *
 * Este módulo es PURO: no importa React ni íconos. Eso permite verificar la
 * navegación desde tests de node sin navegador, y evita que un cambio de rol
 * quede invisible para la suite (que antes era 100% HTTP).
 *
 * Los íconos se referencian por nombre (`IconName`) y se resuelven en
 * `icons.tsx`, para mantener esta capa testeable en un environment `node`.
 *
 * Aplicación de referencia: PLAN-IA-UNIFICADA.md
 */
import type { Role } from '../types';

export type IconName =
  | 'LayoutDashboard' | 'DollarSign' | 'Egg' | 'Settings' | 'Mail'
  | 'PackageOpen' | 'Truck' | 'Users' | 'ClipboardList' | 'CreditCard'
  | 'Tag' | 'FileText' | 'BarChart3' | 'TrendingUp' | 'Receipt'
  | 'CreditCardAlt' | 'Scale' | 'PiggyBank';

export type ModuleId =
  | 'dashboard' | 'finanzas' | 'granja' | 'admin'
  | 'office' | 'operaciones' | 'logistica' | 'clientes';

export interface ModuloDef {
  id: ModuleId;
  label: string;
  icon: IconName;
  /** Roles con acceso. Un usuario con varios roles ve el módulo si alguno coincide. */
  roles: Role[];
  /** Etiquetas alternativas por rol (Operaciones cambia según quién entre). */
  labelsPorRol?: Partial<Record<Role, string>>;
  /** Etiqueta corta para la barra inferior en móvil. */
  shortLabel?: string;
  /** Oculta el breadcrumb del módulo (pantallas de una sola vista). */
  sinBreadcrumb?: boolean;
}

export interface SubTabDef {
  id: string;
  label: string;
  /** Si se define, el tab solo aparece para estos roles. */
  roles?: Role[];
  /** Etiqueta del breadcrumb. Si se omite, se usa `label`. */
  breadcrumb?: string;
}

/** Módulos de primer nivel del sidebar, en orden de aparición. */
export const MODULOS: ModuloDef[] = [
  {
    id: 'dashboard',
    label: 'Centro de Mando',
    icon: 'LayoutDashboard',
    roles: ['Admin', 'Socio'],
    shortLabel: 'Centro',
    sinBreadcrumb: true,
  },
  {
    id: 'finanzas',
    label: 'Finanzas',
    icon: 'DollarSign',
    roles: ['Admin', 'Socio'],
  },
  {
    id: 'granja',
    label: 'Granja',
    icon: 'Egg',
    roles: ['Admin'],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: 'Settings',
    roles: ['Admin'],
  },
  {
    id: 'office',
    label: 'Office',
    icon: 'Mail',
    roles: ['Admin', 'Socio', 'Comercial'],
  },
  {
    id: 'operaciones',
    label: 'Operaciones y Bodegas',
    icon: 'PackageOpen',
    roles: ['Admin', 'Bodeguero', 'Despachador', 'Camionero', 'Comercial'],
    labelsPorRol: {
      Despachador: 'Carga a Bodega',
      Bodeguero: 'Recepción',
      Camionero: 'Confirmar Cargas',
    },
    shortLabel: 'Ops',
  },
  {
    id: 'logistica',
    label: 'Logística',
    icon: 'Truck',
    roles: ['Admin', 'Comercial'],
  },
  {
    id: 'clientes',
    label: 'Clientes',
    icon: 'Users',
    roles: ['Admin', 'Comercial'],
    sinBreadcrumb: true,
  },
];

/** Roles que usan el camino móvil de Operaciones en lugar del hub de escritorio. */
export const ROLES_MOVIL: Role[] = ['Despachador', 'Bodeguero', 'Camionero'];

export const esRolMovil = (roles: Role[]): boolean => roles.some(r => ROLES_MOVIL.includes(r));

/** Sub-tabs del módulo `granja`. Solo Admin: el módulo entero es de Admin. */
export const SUBTABS_GRANJA: SubTabDef[] = [
  { id: 'granjas', label: 'Granjas' },
  { id: 'salud', label: 'Salud Avícola' },
  { id: 'alimento', label: 'Alimento/Silos' },
  { id: 'mantenimiento', label: 'Mantenimiento' },
];

/** Sub-tabs del camino móvil de Operaciones: dependen del rol, no del módulo. */
export const SUBTABS_OPERACIONES_MOVIL: Record<Role, SubTabDef[]> = {
  Despachador: [
    { id: 'carga', label: 'Carga' },
    { id: 'incidencias', label: 'Incidencias' },
  ],
  Camionero: [{ id: 'confirmar', label: 'Confirmar' }],
  Bodeguero: [{ id: 'recibir', label: 'Recibir' }],
  // El resto de roles nunca ven esta fila.
  Admin: [],
  Socio: [],
  Comercial: [],
};

/**
 * Sub-tabs de Logística. Se modelan como filas para conservar el agrupado
 * visual de tres bandas (núcleo / administración / configuración) que ya usa
 * el módulo. `banda` no participa en la lógica: solo documenta el agrupado.
 */
export type BandaLogistica = 'nucleo' | 'admin' | 'config';

export interface SubTabLogisticaDef extends SubTabDef {
  banda: BandaLogistica;
}

export const SUBTABS_LOGISTICA: Record<BandaLogistica, SubTabLogisticaDef[]> = {
  nucleo: [
    { id: 'logistica', label: 'Logística', banda: 'nucleo' },
    { id: 'guias', label: 'Guías y Camiones', breadcrumb: 'Guías y Camiones', banda: 'nucleo' },
    { id: 'remisiones', label: 'Remisiones', banda: 'nucleo' },
    { id: 'caja', label: 'Caja Ruta', banda: 'nucleo' },
    { id: 'tablero', label: 'Tablero Vivo', banda: 'nucleo' },
  ],
  admin: [
    { id: 'facturacion', label: 'Facturación', roles: ['Admin', 'Comercial'], banda: 'admin' },
  ],
  config: [
    { id: 'etiquetas', label: 'Etiquetas QR', roles: ['Admin'], banda: 'config' },
    { id: 'pesos', label: 'Control Pesos', roles: ['Admin'], banda: 'config' },
    { id: 'precios', label: 'Precios', roles: ['Admin'], banda: 'config' },
  ],
};

/**
 * Sub-tabs del hub de escritorio de Operaciones (`BodegaAdmin`).
 *
 * Fase 7 los amplía a los 5 grupos del boceto (Resumen · Granja · Bodega ·
 * Despacho · Ventas), cuando Despacho y Ventas se muden desde Logística. Por
 * ahora se declara únicamente lo que el hub muestra hoy, para que esta fase
 * sea una extracción sin cambio de comportamiento.
 */
export const SUBTABS_OPERACIONES_DESKTOP: SubTabDef[] = [
  { id: 'resumen', label: 'Resumen del día' },
  { id: 'bodega', label: 'Bodega' },
];

/** Sub-tabs de Admin. */
export const SUBTABS_ADMIN: SubTabDef[] = [
  { id: 'productos', label: 'Productos' },
  { id: 'infraestructura', label: 'Infraestructura' },
  { id: 'usuarios', label: 'Usuarios' },
  { id: 'vinculaciones', label: 'Vinculaciones' },
];

/** Sub-tabs de Finanzas. `roles` decide quién ve cada tab. */
export const SUBTABS_FINANZAS: SubTabDef[] = [
  { id: 'flujo', label: 'Flujo de Caja', roles: ['Admin'] },
  { id: 'cobranza', label: 'Cuentas por Cobrar', roles: ['Admin'] },
  { id: 'reportes', label: 'Reportes' },
];

/**
 * Espacios de Office.
 *
 * El boceto de Office tiene un tercer espacio, Vinculaciones, que hoy vive en
 * `admin`. Se suma en la Fase 6, cuando se mueva: declararlo antes haría que
 * el invariante viera un tab duplicado.
 */
export const ESPACIOS_OFFICE: SubTabDef[] = [
  { id: 'correo', label: 'Correo' },
  { id: 'documentos', label: 'Documentos' },
];

export const SUBTABS_POR_MODULO: Partial<Record<ModuleId, SubTabDef[]>> = {
  granja: SUBTABS_GRANJA,
  admin: SUBTABS_ADMIN,
  finanzas: SUBTABS_FINANZAS,
  office: ESPACIOS_OFFICE,
  operaciones: SUBTABS_OPERACIONES_DESKTOP,
};

// ---------------------------------------------------------------------------
// Resoluciones derivadas. Estas son las funciones que los tests deben cubrir.
// ---------------------------------------------------------------------------

/** Normaliza `user.role` + `user.roles` al conjunto efectivo de roles. */
export const rolesEfectivos = (rolPrincipal: Role, rolesExtra?: Role[]): Role[] => {
  const r = rolesExtra?.length ? rolesExtra : [rolPrincipal];
  return Array.from(new Set(r.filter(Boolean)));
};

/** Módulos visibles para un conjunto de roles, en orden del sidebar. */
export const modulosVisibles = (roles: Role[]): ModuloDef[] =>
  MODULOS.filter(m => m.roles.some(r => roles.includes(r)));

export const moduloPorId = (id: ModuleId): ModuloDef | undefined =>
  MODULOS.find(m => m.id === id);

/**
 * Etiqueta del módulo.
 *
 * Las etiquetas por rol de Operaciones ("Carga a Bodega", "Recepción",
 * "Confirmar Cargas") describen el camino móvil, así que solo aplican cuando el
 * usuario es exclusivamente un rol móvil. Un Bodeguero que además es Admin entra
 * al hub de escritorio y debe ver la etiqueta completa.
 */
export const labelDeModulo = (id: ModuleId, roles: Role[]): string => {
  const mod = moduloPorId(id);
  if (!mod) return id;
  const porRol = mod.labelsPorRol ?? {};
  const soloMovil = roles.length > 0 && roles.every(r => ROLES_MOVIL.includes(r));
  if (soloMovil) {
    const alternativa = roles.map(r => porRol[r]).find(Boolean);
    if (alternativa) return alternativa;
  }
  return mod.label;
};

/**
 * Módulo al que entra un usuario por defecto. Antes vivía hardcodeado en el
 * `useState` de `AppLayout`.
 *
 * La última línea no es decorativa: el módulo preferido tiene que ser alcanzable
 * desde el propio sidebar. Un Socio caía en `logistica` (bug 7 del plan) y
 * `logistica.roles` es `[Admin, Comercial]`, así que aterrizaba en una pantalla
 * sin ninguna entrada de navegación. Con la guarda, cualquier combinación de
 * roles futura hereda el primer módulo que sí ve en lugar de repetarlo.
 */
export const moduloPorDefecto = (roles: Role[]): ModuleId => {
  const preferido = preferidoDe(roles);
  const visibles = modulosVisibles(roles);
  return visibles.some(v => v.id === preferido)
    ? preferido
    : (visibles[0]?.id ?? 'dashboard');
};

const preferidoDe = (roles: Role[]): ModuleId => {
  if (roles.includes('Admin')) return 'dashboard';
  if (esRolMovil(roles)) return 'operaciones';
  // Comercial entra a Logística, que sí ve, y conserva su comportamiento actual.
  if (roles.includes('Comercial')) return 'logistica';
  // Un Socio solo ve Centro de Mando, Finanzas y Office: entra al Centro de Mando.
  return 'dashboard';
};

/** Sub-tabs de Logística visibles para un conjunto de roles, conservando la banda. */
export const subTabsLogisticaDe = (roles: Role[]): SubTabLogisticaDef[] =>
  (['nucleo', 'admin', 'config'] as BandaLogistica[])
    .flatMap(banda => SUBTABS_LOGISTICA[banda])
    .filter(t => !t.roles || t.roles.some(r => roles.includes(r)));

/** Sub-tabs visibles de un módulo para un conjunto de roles. */
export const subTabsDe = (id: ModuleId, roles: Role[]): SubTabDef[] => {
  if (id === 'logistica') return subTabsLogisticaDe(roles);
  const defs = SUBTABS_POR_MODULO[id] ?? [];
  return defs.filter(t => !t.roles || t.roles.some(r => roles.includes(r)));
};

/**
 * Sub-tab activo por defecto al entrar a un módulo.
 *
 * Reproduce exactamente la lógica que estaba hardcodeada en el `useEffect` de
 * `AppLayout`, incluidos sus defectos: el flag `manual` solo se respeta en
 * `admin`, que es el único módulo que lo consultaba. Corregir el resto (el menú
 * "Nuevo" no lograba abrir Guías ni Facturación al cambiar de módulo) es la
 * Fase 1, no esta extracción.
 */
export const subTabPorDefecto = (id: ModuleId, roles: Role[], manual = false): string => {
  if (id === 'logistica') {
    // Comercial arranca en Caja Ruta; el resto en Logística.
    return roles.includes('Comercial') && !roles.includes('Admin') ? 'caja' : 'logistica';
  }
  if (id === 'finanzas') {
    // Solo Admin ve `flujo`/`cobranza`; un Socio solo tiene `reportes`, así que
    // "flujo" lo dejaba viendo el P&L del Flujo de Caja bajo un tab que no
    // tenía seleccionado. Bug 2 del plan, corregido en Fase 1.
    return roles.includes('Admin') ? 'flujo' : 'reportes';
  }
  if (id === 'granja') return 'granjas';
  if (id === 'admin') return manual ? '' : 'productos';
  if (id === 'operaciones') {
    if (esRolMovil(roles)) {
      if (roles.includes('Camionero')) {
        return roles.includes('Bodeguero') ? 'recibir' : 'confirmar';
      }
      if (roles.includes('Bodeguero')) return 'recibir';
      return 'carga';
    }
    return 'produccion';
  }
  if (id === 'office') return '';
  return '';
};

/** Sub-tabs del camino móvil de Operaciones, aplanados y sin duplicados. */
export const subTabsOperacionesMovil = (roles: Role[]): SubTabDef[] => {
  const planes = roles.filter(r => ROLES_MOVIL.includes(r));
  const vistos = new Set<string>();
  const out: SubTabDef[] = [];
  for (const rol of planes) {
    for (const tab of SUBTABS_OPERACIONES_MOVIL[rol]) {
      if (vistos.has(tab.id)) continue;
      vistos.add(tab.id);
      out.push(tab);
    }
  }
  return out;
};

/**
 * Sub-tab de Operaciones que debe quedar realmente resaltado en el camino
 * móvil. Antes era `effectiveSub`, calculado en línea dentro del JSX.
 */
export const subTabMovilEfectivo = (roles: Role[], subTab: string): string => {
  const tabs = subTabsOperacionesMovil(roles);
  if (tabs.some(t => t.id === subTab)) return subTab;
  return tabs[0]?.id ?? 'carga';
};

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

/** Etiquetas de breadcrumb para sub-tabs que no viven en `SUBTABS_*`. */
export const BREADCRUMB_EXTRA: Record<string, string> = {
  produccion: 'Producción',
  desperdicios: 'Desperdicios',
};

/**
 * Devuelve el breadcrumb `[módulo, subTab]` de la vista actual, o `null` si la
 * vista no lleva breadcrumb.
 */
export const breadcrumbDe = (
  id: ModuleId,
  subTab: string,
  roles: Role[],
): [string, string] | null => {
  const mod = moduloPorId(id);
  if (!mod || mod.sinBreadcrumb) return null;

  if (id === 'operaciones' && esRolMovil(roles)) {
    const tab = subTabsOperacionesMovil(roles).find(t => t.id === subTabMovilEfectivo(roles, subTab));
    return [labelDeModulo(id, roles), tab?.label ?? ''];
  }

  // El hub de Operaciones no muestra el sub-tab en el breadcrumb.
  if (id === 'operaciones') return [labelDeModulo(id, roles), ''];

  const visibles = subTabsDe(id, roles);
  const tab = visibles.find(t => t.id === subTab);
  const etiqueta = tab?.breadcrumb ?? tab?.label ?? BREADCRUMB_EXTRA[subTab] ?? '';
  return [labelDeModulo(id, roles), etiqueta];
};

/**
 * Defectos de producto heredados que la configuración hace visibles.
 *
* No son errores de este módulo: son inconsistencias reales de la aplicación que
 * la extracción a datos puros dejó a la vista. Cada una tiene una fase asignada
 * en PLAN-IA-UNIFICADA.md, así que se listan aquí en vez de silenciarse, y los
 * tests fallan si aparece alguna nueva o si alguna se cierra antes de tiempo.
 */
export const INCIDENCIAS_CONOCIDAS: Record<string, string> = {
  'Rol Admin entra a operaciones/produccion pero no ve ese tab':
    'Fase 7 — el hub de escritorio de Operaciones ignora `subTab`: sus tabs son internos de BodegaAdmin. El valor `produccion` queda muerto hasta que el hub sea dirigido por la configuración.',
  'Rol Comercial entra a operaciones/produccion pero no ve ese tab':
    'Fase 7 — mismo origen que el caso de Admin. Comercial entra al hub de escritorio, no al camino móvil.',
};

export interface ResultadoValidacion {
  /** Errores de la propia configuración. Deben estar siempre vacíos. */
  errores: string[];
  /** Defectos preexistentes, con la fase que los corrige. */
  incidencias: { problema: string; fase: string }[];
}

/** Invariante de la configuración, separando errores de defectos conocidos. */
export const validarConfig = (): ResultadoValidacion => {
  const problemas: string[] = [];
  const ids = new Set<string>();
  for (const m of MODULOS) {
    if (ids.has(m.id)) problemas.push(`Módulo duplicado: ${m.id}`);
    ids.add(m.id);
    if (!m.label.trim()) problemas.push(`Módulo ${m.id} sin etiqueta`);
    if (m.roles.length === 0) problemas.push(`Módulo ${m.id} sin roles`);
  }

  const idsSub = new Set<string>();
  for (const [modId, tabs] of Object.entries(SUBTABS_POR_MODULO)) {
    for (const t of tabs) {
      if (idsSub.has(t.id)) problemas.push(`Sub-tab duplicado en ${modId}: ${t.id}`);
      idsSub.add(t.id);
      if (!t.label.trim()) problemas.push(`Sub-tab ${modId}/${t.id} sin etiqueta`);
    }
  }

  for (const banda of ['nucleo', 'admin', 'config'] as BandaLogistica[]) {
    for (const t of SUBTABS_LOGISTICA[banda]) {
      if (!t.label.trim()) problemas.push(`Sub-tab logística/${t.id} sin etiqueta`);
    }
  }

  // Ningún sub-tab por defecto debe apuntar a algo invisible para su propio rol.
  for (const m of MODULOS) {
    for (const r of m.roles) {
      const defecto = subTabPorDefecto(m.id, [r]);
      if (!defecto || m.id === 'office') continue;
      if (m.id === 'operaciones' && esRolMovil([r])) continue;
      const visibles = subTabsDe(m.id, [r]);
      if (visibles.length && !visibles.some(t => t.id === defecto)) {
        problemas.push(`Rol ${r} entra a ${m.id}/${defecto} pero no ve ese tab`);
      }
    }
  }

  // El módulo de entrada debe ser alcanzable desde el propio sidebar.
  const rolesDelSistema = new Set<Role>(MODULOS.flatMap(m => m.roles));
  for (const rol of rolesDelSistema) {
    const defecto = moduloPorDefecto([rol]);
    if (!modulosVisibles([rol]).some(v => v.id === defecto)) {
      problemas.push(`El módulo por defecto de ${rol} es ${defecto}, pero no lo ve en el sidebar`);
    }
  }

  const errores: string[] = [];
  const incidencias: ResultadoValidacion['incidencias'] = [];
  for (const p of problemas) {
    const fase = INCIDENCIAS_CONOCIDAS[p];
    if (fase) incidencias.push({ problema: p, fase });
    else errores.push(p);
  }

  return { errores, incidencias };
};
