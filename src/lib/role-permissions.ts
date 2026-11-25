export interface RolePermissions {
  view: string[];
  create: string[];
  approve: string[];
}

/** Matriz única de permisos usada por middleware y pantallas de administración. */
export const ROLE_PERMISSIONS: Record<string, RolePermissions> = {
  Admin: { view: ['*'], create: ['*'], approve: ['*'] },
  Socio: {
    view: ['dashboard', 'finanzas_resumen', 'clientes', 'crm_insights', 'office'],
    create: [],
    approve: [],
  },
  Comercial: {
    // El vendedor solo trabaja con su ruta asignada, sus clientes y documentos.
    // `ventas` también limita inventario y clientes al contexto del vendedor en
    // los endpoints que lo soportan; no se concede inventario general ni gastos.
    view: ['rutas_propias', 'clientes_propios', 'ventas_propias', 'inventario_camion', 'facturacion', 'clientes', 'ventas', 'cargas_asignadas', 'catalogo', 'gastos_ruta'],
    create: ['ventas', 'facturacion', 'notas_credito', 'gastos_ruta'],
    approve: ['carga'],
  },
  Despachador: { view: ['bodega', 'etiquetas', 'pesos', 'inventario_bodega', 'catalogo', 'rutas', 'produccion', 'granjas_admin', 'cargas_asignadas', 'traslados'], create: ['etiquetas', 'pesos', 'carga_camion', 'rutas', 'produccion', 'traslados'], approve: [] },
  // Bodega confirma recepciones y retornos físicos. El permiso de inventario se
  // limita a las operaciones de bodega; no concede despacho, rutas ni catálogo.
  Bodeguero: { view: ['recepciones', 'etiquetas', 'inventario_bodega'], create: ['recepciones', 'inventario_bodega'], approve: [] },
};

const ROLE_ALIASES: Record<string, string> = {
  vendedor: 'Comercial',
  facturador: 'Comercial',
  camionero: 'Comercial',
};

export function normalizarRol(role: string): string {
  return ROLE_ALIASES[String(role || '').trim().toLowerCase()] || String(role || '').trim();
}

/**
 * Roles efectivos desde el rol principal y los adicionales guardados.
 * Una cuenta cuyo rol principal es Comercial es siempre una cuenta de vendedor:
 * los roles heredados o mal asignados no deben convertirla en administrador.
 */
export function rolesParaUsuario(rolePrincipal: string, rolesExtra?: string | string[] | null): string[] {
  const principal = normalizarRol(rolePrincipal);
  const extras = Array.isArray(rolesExtra)
    ? rolesExtra
    : String(rolesExtra || '').split(',');
  if (principal === 'Comercial') return ['Comercial'];
  return Array.from(new Set([principal, ...extras.map(normalizarRol).filter(Boolean)]));
}

export function permisosParaRoles(roles: string[]): RolePermissions | null {
  const encontrados = roles.map(normalizarRol).map(role => ROLE_PERMISSIONS[role]).filter(Boolean);
  if (!encontrados.length) return null;
  return {
    view: Array.from(new Set(encontrados.flatMap(p => p.view))),
    create: Array.from(new Set(encontrados.flatMap(p => p.create))),
    approve: Array.from(new Set(encontrados.flatMap(p => p.approve))),
  };
}

export function permisosParaRol(role: string): RolePermissions | null {
  return ROLE_PERMISSIONS[normalizarRol(role)] || null;
}
