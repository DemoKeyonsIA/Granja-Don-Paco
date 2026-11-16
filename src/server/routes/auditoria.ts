import * as schema from "../../db/schema";

export function registrarRutasAuditoria(app: any, db: any, requirePermission: (...args: any[]) => any) {
  const { auditoria } = schema;
  // ==================== AUDITORÍA ====================

  app.get("/api/auditoria", requirePermission('auditoria', 'view'), async (req, res) => {
    try {
      const data = await db.query.auditoria.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/auditoria", requirePermission('auditoria', 'create'), async (req, res) => {
    try {
      const { accion, modulo, referenciaId, valoresAntes, valoresDespues, motivo } = req.body;
      if (!accion || !modulo) return res.status(400).json({ error: "Faltan datos de auditoría" });
      const id = crypto.randomUUID();
      await db.insert(auditoria).values({
        id, usuarioId: req.usuario.id, accion, modulo, referenciaId: referenciaId || null,
        valoresAntes: valoresAntes || null, valoresDespues: valoresDespues || null,
        motivo: motivo || null, fecha: new Date().toISOString()
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

}
