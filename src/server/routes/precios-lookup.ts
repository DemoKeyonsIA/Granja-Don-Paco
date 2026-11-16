import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';

/** Registra consultas de precio para venta individual y captura en lote. */
export function registrarRutasLookupPrecios(app: any, db: any, getPrecioParaProducto: (producto: string, clienteId?: string, ruta?: string) => Promise<any>, requirePermission: (...args: any[]) => any) {

  app.get("/api/precios/lookup", requirePermission('facturacion', 'view'), async (req, res) => {
    try {
      const producto = req.query.producto as string;
      const clienteId = req.query.clienteId as string;
      const rutaSolicitada = req.query.ruta as string;
      if (!producto) return res.status(400).json({ error: "Producto es requerido" });
      const cliente = clienteId ? await db.query.clientes.findFirst({ where: eq(schema.clientes.id, clienteId) }) : null;
      const ruta = clienteId ? cliente?.ruta || undefined : rutaSolicitada;
      const resultado = await getPrecioParaProducto(producto, clienteId, ruta);
      if (!resultado) return res.status(404).json({ error: "No se encontró precio para este producto" });
      res.json(resultado);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/precios/lookup-multiple", requirePermission('facturacion', 'view'), async (req, res) => {
    try {
      const { productos, clienteId, ruta } = req.body;
      if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: "Array de productos requerido" });
      const cliente = clienteId ? await db.query.clientes.findFirst({ where: eq(schema.clientes.id, clienteId) }) : null;
      const rutaEfectiva = clienteId ? cliente?.ruta || undefined : ruta;
      const resultados: Record<string, any> = {};
      for (const p of productos) {
        resultados[p] = await getPrecioParaProducto(p, clienteId, rutaEfectiva);
      }
      res.json(resultados);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

}
