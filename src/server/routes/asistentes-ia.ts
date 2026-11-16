import { and, eq, gte, lte, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';

export function registrarRutasAsistentesIA(app: any, db: any, ai: any, requirePermission: (...args: any[]) => any) {
  // ==================== IA ASISTENTES ====================

  app.post("/api/ai/ceres", requirePermission('granjas_admin', 'view'), async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const hoy = new Date().toISOString().split('T')[0];
      const finHoy = `${hoy}T23:59:59.999Z`;
      const [produccion, vacunacionesData, alimentoData, mantenimientosData] = await Promise.all([
        db.query.produccion_diaria.findMany({ where: and(gte(schema.produccion_diaria.fecha, hoy), lte(schema.produccion_diaria.fecha, finHoy)) }),
        db.query.vacunaciones.findMany({ where: eq(schema.vacunaciones.estado, 'Programada') }),
        db.query.inventario_alimento.findMany({ where: eq(schema.inventario_alimento.estado, 'Activo') }),
        db.query.ordenes_mantenimiento.findMany({ where: eq(schema.ordenes_mantenimiento.estado, 'Pendiente') })
      ]);
      const contexto = {
        produccion_hoy: produccion,
        vacunaciones_pendientes: vacunacionesData,
        inventario_alimento: alimentoData,
        mantenimientos_pendientes: mantenimientosData
      };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Ceres, la asistente avícola de Granja Don Paco. Respondes sobre producción, vacunación, alimento, mantenimiento y alertas de rendimiento. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/vega", requirePermission('clientes', 'view'), async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const [clientesData, facturasRecientes] = await Promise.all([
        db.query.clientes.findMany(),
        db.query.facturas.findMany({ orderBy: (f: any, { desc }: any) => [desc(f.fecha)], limit: 50 }),
      ]);
      const contexto = { clientes: clientesData, facturas_recientes: facturasRecientes };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Vega, la asistente de servicio al cliente de Granja Don Paco. Respondes sobre clientes, pedidos, estados de factura y reclamos. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/nash", requirePermission('finanzas_resumen', 'view'), async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const [ventasTotalRows, gastosTotalRows, facturasRecientes, gastosRecientes] = await Promise.all([
        db.select({ total: sql<number>`coalesce(sum(${schema.facturas.total}), 0)` }).from(schema.facturas),
        db.select({ total: sql<number>`coalesce(sum(${schema.gastos.monto}), 0)` }).from(schema.gastos),
        db.query.facturas.findMany({ orderBy: (f: any, { desc }: any) => [desc(f.fecha)], limit: 20 }),
        db.query.gastos.findMany({ orderBy: (g: any, { desc }: any) => [desc(g.fecha)], limit: 20 }),
      ]);
      const totalVentas = Number(ventasTotalRows[0]?.total || 0);
      const totalGastos = Number(gastosTotalRows[0]?.total || 0);
      const contexto = { totalVentas, totalGastos, utilidadTotal: totalVentas - totalGastos, facturas_recientes: facturasRecientes, gastos_recientes: gastosRecientes };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Nash, el analista financiero de Granja Don Paco. Respondes sobre ventas, cartera, rentabilidad y margen por ruta. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/houston", requirePermission('granjas_admin', 'view'), async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const [rutasData, ordenesData] = await Promise.all([db.query.rutas.findMany(), db.query.ordenes_mantenimiento.findMany()]);
      const contexto = { rutas: rutasData, ordenes_pendientes: ordenesData.filter(o => o.estado === 'Pendiente') };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Houston, el coordinador operativo de Granja Don Paco. Respondes sobre rutas, tareas, mantenimiento y atrasos. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/magnetar", requirePermission('clientes', 'view'), async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const [clientesData, facturasData] = await Promise.all([
        db.query.clientes.findMany(),
        db.query.facturas.findMany({ orderBy: (f: any, { desc }: any) => [desc(f.fecha)], limit: 100 }),
      ]);
      const contexto = { clientes: clientesData, facturas_recientes: facturasData };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Magnetar, el especialista en retención de clientes de Granja Don Paco. Respondes sobre recompra, clientes en riesgo y patrones de compra. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/nova", requirePermission('ai_admin', 'view'), async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Nova, la asistente de marketing y redes sociales de Granja Don Paco. Ayudas con contenido, campañas y comunicación digital.`, temperature: 0.7 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/tales", requirePermission('facturacion', 'view'), async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const docsFE = await db.query.facturas_electronicas.findMany({ orderBy: (f: any, { desc }: any) => [desc(f.fechaEmision)], limit: 50 });
      const contexto = { documentos_electronicos: docsFE };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Tales, el experto en control fiscal y documentos electrónicos de Granja Don Paco. Respondes sobre facturación electrónica, Hacienda, XML y notas de crédito. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

}
