import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { clienteDisponibleParaUsuario } from '../clientes-scope';

type PrecioResolver = (producto: string, clienteId?: string, ruta?: string) => Promise<any>;

/** Sugerencia asistida por IA a partir del historial real y precios aprobados. */
export function registrarRutaRecomendacionVenta(app: any, db: any, ai: any, getPrecioParaProducto: PrecioResolver, requirePermission: (...args: any[]) => any) {
  app.post('/api/precios/recomendacion-ruta', requirePermission('facturacion', 'view'), async (req: any, res: any) => {
    try {
      const clienteId = String(req.body?.clienteId || '');
      const productosSolicitados: string[] = Array.isArray(req.body?.productos)
        ? Array.from(new Set<string>(req.body.productos.map((p: any) => String(p).trim()).filter(Boolean))).slice(0, 20)
        : [];
      if (!clienteId || productosSolicitados.length === 0) return res.status(400).json({ error: 'Seleccione cliente y al menos un producto.' });
      if (!await clienteDisponibleParaUsuario(db, req.usuario, clienteId)) return res.status(404).json({ error: 'Cliente no encontrado en sus rutas asignadas.' });
      const cliente = await db.query.clientes.findFirst({ where: eq(schema.clientes.id, clienteId) });
      if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

      const [facturasRaw, ticketsKg, ticketsHistoricos, catalogo] = await Promise.all([
        db.query.facturas.findMany({ where: eq(schema.facturas.clienteId, clienteId) }).catch(() => []),
        db.query.ventas_ruta_kg.findMany({ where: eq(schema.ventas_ruta_kg.clienteId, clienteId) }).catch(() => []),
        db.query.ventas_ruta.findMany({ where: eq(schema.ventas_ruta.clienteId, clienteId) }).catch(() => []),
        db.query.productosCatalogo.findMany().catch(() => []),
      ]);
      const facturas = (facturasRaw as any[]).filter(f => f.estado !== 'Anulada');
      const detalles = facturas.length
        ? await db.query.detallesFactura.findMany({ where: inArray(schema.detallesFactura.facturaId, facturas.map(f => f.id)) }).catch(() => [])
        : [];
      const catalogoPorNombre = new Map((catalogo as any[]).map((p: any) => [String(p.nombre).trim().toLocaleLowerCase(), p]));
      const kgPorUnidad = (producto: string) => Number((catalogoPorNombre.get(producto.trim().toLocaleLowerCase()) as any)?.kgPorCarton || 0);
      const fechaLimite = Date.now() - 180 * 86400000;
      const historial: Array<{ producto: string; kilos: number; precioKg: number; fecha: string }> = [];
      for (const ticket of [...ticketsKg, ...ticketsHistoricos] as any[]) {
        if (ticket.estado === 'Anulada' || ticket.facturaId && facturas.some(f => f.id === ticket.facturaId)) continue;
        const producto = String(ticket.producto || '');
        const cantidadRaw = Number(ticket.cantidadKg ?? ticket.cartones ?? 0);
        const unidad = String(ticket.unidad || 'kg').toLowerCase();
        const factor = kgPorUnidad(producto);
        const kilos = unidad.includes('cart') ? (factor > 0 ? cantidadRaw * factor : 0) : cantidadRaw;
        const fecha = String(ticket.fechaHora || '');
        if (producto && kilos > 0 && new Date(fecha).getTime() >= fechaLimite) historial.push({ producto, kilos, precioKg: Number(ticket.precioKg ?? ticket.precioUnitario ?? 0), fecha });
      }
      const facturasPorId = new Map(facturas.map((f: any) => [f.id, f]));
      for (const linea of detalles as any[]) {
        const factura: any = facturasPorId.get(linea.facturaId);
        if (!factura) continue;
        const producto = String(linea.producto || '');
        let resolucion: any = null;
        try { resolucion = linea.resolucionPrecioJson ? JSON.parse(linea.resolucionPrecioJson) : null; } catch { /* historial anterior sin resolución serializada */ }
        const unidad = String(linea.unidad || resolucion?.unidad || (catalogoPorNombre.get(producto.trim().toLocaleLowerCase()) as any)?.unidad || 'kg').toLowerCase();
        const cantidadRaw = Number(linea.cantidad || 0);
        const factor = kgPorUnidad(producto);
        const kilos = unidad.includes('cart') ? (factor > 0 ? cantidadRaw * factor : 0) : cantidadRaw;
        const fecha = String(factura.fecha || '');
        if (producto && kilos > 0 && new Date(fecha).getTime() >= fechaLimite) historial.push({ producto, kilos, precioKg: Number(linea.precio_unitario || 0) / (unidad.includes('cart') && factor > 0 ? factor : 1), fecha });
      }
      historial.sort((a, b) => b.fecha.localeCompare(a.fecha));
      const politicas: Record<string, any> = {};
      for (const producto of productosSolicitados) {
        const politica = await getPrecioParaProducto(producto, clienteId, cliente.ruta || undefined);
        if (politica && Number(politica.precio) > 0 && !politica.error) politicas[producto] = {
          precio: Number(politica.precio), precioMinimo: Number(politica.precioMinimo ?? politica.precio),
          precioMaximo: Number(politica.precioMaximo ?? politica.precio),
        };
      }

      const resumir = (producto: string) => {
        const compras = historial.filter(h => h.producto === producto).slice(0, 30);
        if (!compras.length) return null;
        const pesoTotal = compras.reduce((s, x) => s + x.kilos, 0);
        const promedio = pesoTotal / compras.length;
        const precioConHistorial = compras.filter(x => x.precioKg > 0);
        const precioPromedio = precioConHistorial.length ? precioConHistorial.reduce((s, x) => s + x.precioKg, 0) / precioConHistorial.length : null;
        return { pedidos: compras.length, promedioKgPedido: Math.round(promedio * 100) / 100, kilosUltimoPedido: Math.round(compras[0].kilos * 100) / 100, precioPromedioHistorico: precioPromedio == null ? null : Math.round(precioPromedio * 100) / 100 };
      };
      const base: Record<string, any> = {};
      for (const producto of productosSolicitados) {
        const h = resumir(producto);
        const politica = politicas[producto];
        if (!politica) continue;
        const min = Math.min(politica.precioMinimo, politica.precioMaximo);
        const max = Math.max(politica.precioMinimo, politica.precioMaximo);
        const precioHist = h?.precioPromedioHistorico;
        const precioSugerido = precioHist == null ? politica.precio : Math.min(max, Math.max(min, precioHist));
        base[producto] = {
          producto, kilos: h?.promedioKgPedido || 0, precio: Math.round(precioSugerido * 100) / 100,
          pedidosAnalizados: h?.pedidos || 0, precioMinimo: min, precioMaximo: max,
          precioLista: politica.precio, metodo: 'promedio_historial',
        };
      }

      let recomendaciones = Object.values(base);
      let usoIA = false;
      if (recomendaciones.length && historial.length && ai?.models?.generateContent) {
        try {
          const contexto = productosSolicitados.filter(p => base[p]).map(producto => ({ producto, politica: politicas[producto], historial: historial.filter(h => h.producto === producto).slice(0, 20).map(h => ({ kilos: h.kilos, precioKg: h.precioKg || null, fecha: h.fecha })) }));
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Sugiere para cada producto los kilos para el próximo pedido y el precio por kg. Usa el historial dado: considera el promedio por pedido y la tendencia de las últimas compras. El precio debe quedar dentro de precioMinimo y precioMaximo, sin excepción. Si no hay evidencia suficiente, usa el promedio del historial y precioLista. No inventes productos ni unidades. Devuelve únicamente JSON: {"recomendaciones":[{"producto":"...","kilos":0,"precio":0}]}. Contexto: ${JSON.stringify(contexto)}`,
            config: { systemInstruction: 'Eres un asistente de apoyo para sugerir ventas. No autorizas ni cambias precios; aplica estrictamente los límites que vienen en la política. Devuelve JSON válido.', temperature: 0.1 },
          });
          const texto = String(response.text || '').replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
          const sugeridas = new Map((parsed.recomendaciones || []).map((r: any) => [String(r.producto), r]));
          recomendaciones = recomendaciones.map((baseRec: any) => {
            const ia: any = sugeridas.get(baseRec.producto);
            if (!ia) return baseRec;
            const kilosIa = Number(ia.kilos);
            const precioIa = Number(ia.precio);
            return {
              ...baseRec,
              kilos: Number.isFinite(kilosIa) && kilosIa > 0 ? Math.round(kilosIa * 100) / 100 : baseRec.kilos,
              precio: Number.isFinite(precioIa) ? Math.round(Math.min(baseRec.precioMaximo, Math.max(baseRec.precioMinimo, precioIa)) * 100) / 100 : baseRec.precio,
              metodo: 'ia_con_historial',
            };
          });
          usoIA = true;
        } catch { /* La recomendación por historial y límites de precio sigue disponible sin IA */ }
      }
      return res.json({ recomendaciones, usoIA, pedidosAnalizados: historial.length });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'No fue posible sugerir la venta.' });
    }
  });
}
