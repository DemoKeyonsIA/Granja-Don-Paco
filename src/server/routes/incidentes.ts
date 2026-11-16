import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";

export function registrarRutasIncidentes(app: any, db: any, requirePermission: (...args: any[]) => any) {
  // ==================== INCIDENTES DE GALERÓN ====================
  app.get("/api/incidentes", requirePermission(['produccion', 'inventario_bodega', 'tablero_operativo'], 'view'), async (req, res) => {
    try {
      const { granjaId, soloActivos } = req.query;
      const rows = await db.query.incidentes.findMany({
        orderBy: (i: any, { desc }: any) => [desc(i.fecha)],
      });
      let data = rows;
      if (granjaId) data = data.filter((i: any) => i.granjaId === granjaId);
      if (soloActivos === 'true') data = data.filter((i: any) => i.estado === 'Reportado' || i.estado === 'EnRevision');
      const [todasGranjas, todosGalerones] = await Promise.all([db.query.granjas.findMany(), db.query.galerones.findMany()]);
      const granjaMap = new Map<string, any>(todasGranjas.map((g: any) => [g.id, g]));
      const galeronMap = new Map<string, any>(todosGalerones.map((g: any) => [g.id, g]));
      res.json(data.map((i: any) => ({
        ...i,
        granjaNombre: i.granjaId ? granjaMap.get(i.granjaId)?.nombre || null : null,
        galeronNombre: i.galeronId ? galeronMap.get(i.galeronId)?.nombre || null : null,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/incidentes", requirePermission(['produccion', 'inventario_bodega'], 'create'), async (req, res) => {
    try {
      const { granjaId, galeronId, categoria, severidad, descripcion, cantidadAfectada, causaProbable, equipoAfectado, accionTomada, reportadoPorId, reportadoPorNombre } = req.body || {};
      if (!granjaId) return res.status(400).json({ error: "Se requiere la granja del incidente" });
      if (!categoria) return res.status(400).json({ error: "Se requiere la categoría del incidente" });
      if (!descripcion || String(descripcion).trim().length < 10) return res.status(400).json({ error: "Describe el incidente con al menos 10 caracteres" });
      if ((categoria === 'Mortalidad' || categoria === 'Enfermedad') && (!cantidadAfectada || Number(cantidadAfectada) < 1)) {
        return res.status(400).json({ error: "Indica cuántas aves se ven afectadas" });
      }
      const id = crypto.randomUUID();
      await db.insert(schema.incidentes).values({
        id,
        granjaId,
        galeronId: galeronId || null,
        categoria,
        severidad: severidad || 'Media',
        descripcion: String(descripcion).trim(),
        cantidadAfectada: cantidadAfectada ? Number(cantidadAfectada) : null,
        causaProbable: causaProbable ? String(causaProbable).trim() : null,
        equipoAfectado: equipoAfectado || null,
        accionTomada: accionTomada && String(accionTomada).trim() ? String(accionTomada).trim() : null,
        estado: 'Reportado',
        reportadoPorId: reportadoPorId || 'system',
        reportadoPorNombre: reportadoPorNombre || null,
        fecha: new Date().toISOString(),
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/incidentes/:id", requirePermission('produccion', 'create'), async (req, res) => {
    try {
      const { estado, resumen, resueltoPor } = req.body || {};
      const existente = await db.query.incidentes.findFirst({ where: eq(schema.incidentes.id, req.params.id) });
      if (!existente) return res.status(404).json({ error: "Incidente no encontrado" });
      await db.update(schema.incidentes)
        .set({
          ...(estado !== undefined && { estado }),
          ...(resumen !== undefined && { resumen: resumen || null }),
          ...(resueltoPor !== undefined && { resueltoPor: resueltoPor || null }),
        })
        .where(eq(schema.incidentes.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
