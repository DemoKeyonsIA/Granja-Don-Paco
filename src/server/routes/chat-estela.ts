import { and, eq, gte, lte, ne } from 'drizzle-orm';
import * as schema from '../../db/schema';

export function registrarChatEstela(app: any, db: any, ai: any, requirePermission: (...args: any[]) => any) {
  // Chat RAG Estela
  app.post("/api/chat/estela", requirePermission('ai_admin', 'view'), async (req, res) => {
    try {
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const hoy = new Date().toISOString().split('T')[0];
      const desdeHoy = hoy;
      const hastaHoy = `${hoy}T23:59:59.999Z`;

      // 1. Ingresos, Cuentas por Cobrar y Gastos
      const [facturasHoy, facturasPendientes] = await Promise.all([
        db.query.facturas.findMany({ where: and(gte(schema.facturas.fecha, desdeHoy), lte(schema.facturas.fecha, hastaHoy), eq(schema.facturas.estado, 'Pagada')) }),
        db.query.facturas.findMany({ where: eq(schema.facturas.estado, 'Pendiente'), columns: { total: true } }),
      ]);
      
      const ingresosHoyPagados = facturasHoy.reduce((acc, f) => acc + Number(f.total), 0);

      const cuentasPorCobrar = facturasPendientes.reduce((acc, f) => acc + Number(f.total), 0);

      const gastosHoyRows = await db.query.gastos.findMany({ where: and(gte(schema.gastos.fecha, desdeHoy), lte(schema.gastos.fecha, hastaHoy)), columns: { monto: true } });
      const gastosHoy = gastosHoyRows.reduce((acc, g) => acc + Number(g.monto), 0);
        
      const utilidadNetaHoy = ingresosHoyPagados - gastosHoy;

      // 2. Producción de Hoy
      const produccionHoy = await db.query.produccion_diaria.findMany({ where: and(gte(schema.produccion_diaria.fecha, desdeHoy), lte(schema.produccion_diaria.fecha, hastaHoy)), columns: { tipo_producto: true, cantidad: true } });
      
      const cartonesHoy = produccionHoy
        .filter(p => String(p.tipo_producto).includes('Huevos'))
        .reduce((acc, p) => acc + Number(p.cantidad), 0);
        
      const gallinazaHoy = produccionHoy
        .filter(p => String(p.tipo_producto).includes('Gallinaza'))
        .reduce((acc, p) => acc + Number(p.cantidad), 0);

      // 3. Stock actual de Huevos en Bodega Central
      const inventarioTotal = await db.query.inventario.findMany({ where: eq(schema.inventario.ubicacion, 'Bodega Central'), columns: { producto: true, cantidad: true } });
      const stockHuevosBodega = inventarioTotal
        .filter(i => String(i.producto).includes('Huevos') && i.ubicacion === 'Bodega Central')
        .reduce((acc, i) => acc + Number(i.cantidad), 0);

      // 4. Total de Aves Vivas
      const todosGalerones = await db.query.galerones.findMany({ where: ne(schema.galerones.estado, 'Archivado'), columns: { aves_en_produccion: true } });
      const avesVivas = todosGalerones.reduce((acc, g) => acc + (g.aves_en_produccion || 0), 0);

      const contextoGranja = {
        ingresos_pagados_hoy: ingresosHoyPagados,
        cuentas_por_cobrar: cuentasPorCobrar,
        gastos_hoy: gastosHoy,
        utilidad_neta_hoy: utilidadNetaHoy,
        produccion_hoy_cartones: cartonesHoy,
        produccion_hoy_gallinaza: gallinazaHoy,
        stock_huevos_bodega_central: stockHuevosBodega,
        total_aves_vivas: avesVivas
      };

      const systemInstruction = `Eres Estela, la Directora de Operaciones (COO) de Granja Don Paco. Tu rol es dar respuestas ejecutivas, analíticas y directas al administrador basadas estrictamente en el siguiente JSON en tiempo real. Si te preguntan por rentabilidad, cruza los ingresos con los gastos. Si te preguntan por producción, lee los cartones y gallinaza de hoy. Nunca inventes datos, si la respuesta no está en el JSON, dilo. Contexto: ${JSON.stringify(contextoGranja)}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: message,
        config: {
           systemInstruction: systemInstruction,
           temperature: 0.2
        }
      });

      res.json({ text: response.text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
