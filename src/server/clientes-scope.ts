import { rolesParaUsuario } from '../lib/role-permissions';

/** Alcance por ruta para la cartera del rol Comercial. */
const parseLista = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) return value.map(String);
  } catch { /* formatos CSV heredados */ }
  return raw.split(',').map(v => v.trim()).filter(Boolean);
};

export const tieneRol = (user: any, role: string) =>
  rolesParaUsuario(user?.role, user?.roles).includes(role);

export async function rutasAsignadasDelVendedor(db: any, userId: string) {
  const rutas = await db.query.rutas.findMany();
  return rutas.filter((ruta: any) =>
    ruta.vendedor_asignado === userId || parseLista(ruta.vendedores).includes(userId)
  );
}

export async function clientesVisiblesDelVendedor(db: any, userId: string) {
  const rutas = await rutasAsignadasDelVendedor(db, userId);
  const ids = new Set<string>();
  const nombres = new Set<string>();
  for (const ruta of rutas) {
    nombres.add(String(ruta.nombre || '').trim().toLocaleLowerCase());
    parseLista(ruta.cliente_ids).forEach(id => ids.add(id));
  }
  const todos = await db.query.clientes.findMany();
  return todos.filter((cliente: any) =>
    ids.has(String(cliente.id)) || nombres.has(String(cliente.ruta || '').trim().toLocaleLowerCase())
  );
}

export async function clienteDisponibleParaUsuario(db: any, user: any, clienteId: string) {
  if (tieneRol(user, 'Admin') || !tieneRol(user, 'Comercial')) return true;
  const clientes = await clientesVisiblesDelVendedor(db, String(user?.id || ''));
  return clientes.some((cliente: any) => String(cliente.id) === clienteId);
}
