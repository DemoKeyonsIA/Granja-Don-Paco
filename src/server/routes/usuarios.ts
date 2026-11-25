import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { normalizarRol, rolesParaUsuario } from '../../lib/role-permissions';

/** CRUD de usuarios con protección de historial referencial. */
export function registrarRutasUsuarios(app: any, db: any, hashPassword: (password: string) => string, requirePermission: (...args: any[]) => any, logAudit?: (...args: any[]) => Promise<void>) {
  const { granjas, camiones, ventas_ruta, facturas, gastos, sesiones } = schema;
  const rolesAdicionalesGuardables = (role: string, roles: string | string[] | null | undefined) =>
    rolesParaUsuario(role, roles).filter(r => r !== normalizarRol(role)).join(',');
  // ==================== PHASE 5 — USERS ====================

  app.get("/api/users", requirePermission('usuarios', 'view'), async (req, res) => {
    try {
      const data = await db.select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        roles: schema.users.roles,
        activo: schema.users.activo,
      }).from(schema.users);
      res.json(data.map((usuario: any) => ({ ...usuario, activo: Boolean(usuario.activo) })));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/users", requirePermission('usuarios', 'create'), async (req, res) => {
    try {
      const { name, email, role, roles, password, activo } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: "Faltan datos del usuario" });
      const existente = await db.query.users.findFirst({ where: eq(schema.users.email, String(email).trim()) });
      if (existente) return res.status(400).json({ error: "Ya existe un usuario con ese email" });
      const id = crypto.randomUUID();
      const rolPrincipal = normalizarRol(String(role));
      await db.insert(schema.users).values({
        id, name, email, role: rolPrincipal,
        roles: rolesAdicionalesGuardables(rolPrincipal, roles ? String(roles) : ''),
        activo: activo !== undefined ? !!activo : true,
      });
      try {
        await db.update(schema.users)
          .set({ password_hash: hashPassword(password || '1234') })
          .where(eq(schema.users.id, id));
      } catch { /* columna ausente en DBs de prueba */ }
      await logAudit?.((req as any).usuario?.id, 'Crear', 'Usuario', id, null, { name, email, role, roles: roles || '', activo: activo !== undefined ? !!activo : true });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.put("/api/users/:id", requirePermission('usuarios', 'create'), async (req, res) => {
    try {
      const id = req.params.id;
      const { name, email, role, roles, activo, password } = req.body || {};
      const existente = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
      if (!existente) return res.status(404).json({ error: "Usuario no encontrado" });
      if (email && String(email).trim() !== existente.email) {
        const dup = await db.query.users.findFirst({ where: eq(schema.users.email, String(email).trim()) });
        if (dup) return res.status(400).json({ error: "Ya existe un usuario con ese email" });
      }
      const rolPrincipal = normalizarRol(String(role !== undefined && role !== null ? role : existente.role));
      const rolesSolicitados = roles !== undefined ? String(roles) : existente.roles;
      await db.update(schema.users).set({
        name: name !== undefined && name !== null ? String(name) : existente.name,
        email: email !== undefined && email !== null ? String(email) : existente.email,
        role: rolPrincipal,
        roles: rolesAdicionalesGuardables(rolPrincipal, rolesSolicitados),
        activo: activo !== undefined ? !!activo : existente.activo,
      }).where(eq(schema.users.id, id));
      if (password) {
        try {
          await db.update(schema.users)
            .set({ password_hash: hashPassword(String(password)) })
            .where(eq(schema.users.id, id));
        } catch { /* columna ausente en DBs de prueba */ }
      }
      await logAudit?.((req as any).usuario?.id, activo === false ? 'Desactivar' : 'Editar', 'Usuario', id, existente, { ...existente, name: name ?? existente.name, email: email ?? existente.email, role: role ?? existente.role, roles: roles ?? existente.roles, activo: activo ?? existente.activo });
      res.json({ success: true, message: 'Usuario actualizado' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete("/api/users/:id", requirePermission('usuarios', 'create'), async (req, res) => {
    try {
      const id = req.params.id;
      const existente = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
      if (!existente) return res.status(404).json({ error: "Usuario no encontrado" });
      // Integridad referencial: no permitir borrar un usuario que ya tiene actividad
      // (así las granjas/camiones/ventas no quedan huérfanos). Mejor desactivarlo.
      const [granjasR, camionesR, ventasR, facturasR, gastosR, incidentesR] = await Promise.all([
        db.select({ id: granjas.id }).from(granjas).where(eq(granjas.encargadoId, id)).limit(1),
        db.select({ id: camiones.id }).from(camiones).where(eq(camiones.camioneroId, id)).limit(1),
        db.select({ id: ventas_ruta.id }).from(ventas_ruta).where(eq(ventas_ruta.vendedorId, id)).limit(1),
        db.select({ id: facturas.id }).from(facturas).where(eq(facturas.vendedorId, id)).limit(1),
        db.select({ id: gastos.id }).from(gastos).where(eq(gastos.usuarioId, id)).limit(1),
        db.select({ id: schema.incidentes.id }).from(schema.incidentes).where(eq(schema.incidentes.reportadoPorId, id)).limit(1),
      ]);
      const refs = [
        granjasR.length > 0 && 'granja(s) a cargo',
        camionesR.length > 0 && 'camión(es) asignado(s)',
        ventasR.length > 0 && 'ventas registradas',
        facturasR.length > 0 && 'facturas emitidas',
        gastosR.length > 0 && 'gastos registrados',
        incidentesR.length > 0 && 'incidentes reportados',
      ].filter(Boolean);
      if (refs.length > 0) {
        return res.status(409).json({ error: `No se puede eliminar: tiene ${refs.join(', ')}. Desactivalo (cuenta inactiva) para conservar la historia.` });
      }
      await db.delete(sesiones).where(eq(sesiones.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
      await logAudit?.((req as any).usuario?.id, 'Eliminar', 'Usuario', id, existente, null);
      res.json({ success: true, message: 'Usuario eliminado' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });


}
