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
    view: ['rutas_propias', 'clientes_propios', 'ventas_propias', 'inventario_camion', 'facturacion', 'clientes', 'inventario', 'ventas', 'cargas_asignadas', 'catalogo'],
    create: ['ventas', 'gastos_ruta', 'facturacion', 'notas_credito', 'caja'],
    approve: ['carga'],
  },
  Despachador: { view: ['bodega', 'etiquetas', 'pesos', 'inventario_bodega', 'catalogo', 'rutas', 'produccion', 'granjas_admin', 'cargas_asignadas', 'traslados'], create: ['etiquetas', 'pesos', 'carga_camion', 'rutas', 'produccion', 'traslados'], approve: [] },
  Bodeguero: { view: ['inventario_bodega', 'recepciones', 'etiquetas', 'pesos', 'desperdicios', 'tablero_operativo', 'catalogo', 'rutas', 'granjas_admin'], create: ['recepciones', 'desperdicios', 'inventario_bodega', 'pesos'], approve: [] },
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
