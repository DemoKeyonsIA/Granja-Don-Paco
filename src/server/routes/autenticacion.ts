import { eq, lt } from "drizzle-orm";
import * as schema from "../../db/schema";

export function registrarRutasAutenticacion(app: any, db: any, authUser: any, getTokenFromReq: any, verifyPassword: any, normalizarRol: (role: string) => string) {
  const { sesiones } = schema;
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: "Correo y contraseña son requeridos" });
      const [usuario] = await db.select().from(schema.users)
        .where(eq(schema.users.email, String(email).toLowerCase().trim()))
        .limit(1);
      if (!usuario || !verifyPassword(password, usuario.password_hash || '')) {
        return res.status(401).json({ error: "Credenciales incorrectas" });
      }
      if ((usuario.activo ?? true) === false) {
        return res.status(401).json({ error: "Cuenta inactiva. Contacte al administrador" });
      }
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      await db.insert(sesiones).values({
        id: crypto.randomUUID(),
        userId: usuario.id,
        token,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await db.delete(sesiones).where(lt(sesiones.expiresAt, new Date().toISOString()));
      const roles = (usuario.roles && usuario.roles.trim()) ? usuario.roles.split(',').map(normalizarRol).filter(Boolean) : [normalizarRol(usuario.role)];
      res.json({ token, user: { id: usuario.id, name: usuario.name, email: usuario.email, role: normalizarRol(usuario.role), roles } });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const token = getTokenFromReq(req);
    if (token) await db.delete(sesiones).where(eq(sesiones.token, token));
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: "No autenticado" });
    res.json({ user });
  });

}
