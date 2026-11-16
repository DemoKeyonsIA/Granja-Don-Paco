/**
 * Los vendedores se dan de alta en Admin → Usuarios y Roles, con el rol
 * "Comercial", rol que reúne ventas, facturación y reparto.
 * Cualquier pantalla que necesite elegir vendedor debe filtrar con esta misma
 * regla para que el listado siempre coincida con lo que hay en Admin.
 */
export function esVendedor(u: { role?: string; roles?: string; activo?: boolean } | null | undefined): boolean {
  if (!u || u.activo === false) return false;
  const texto = `${u.role || ''} ${u.roles || ''}`.toLowerCase();
  return ['comercial', 'vendedor', 'facturador', 'camionero'].some(r => texto.includes(r));
}

/**
 * Las personas Comercial pueden recibir asignación de camión para reparto.
 */
export function esCamionero(u: { role?: string; roles?: string; activo?: boolean } | null | undefined): boolean {
  if (!u || u.activo === false) return false;
  const texto = `${u.role || ''} ${u.roles || ''}`.toLowerCase();
  return texto.includes('comercial') || texto.includes('camionero');
}
