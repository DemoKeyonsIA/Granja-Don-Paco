import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import * as schema from "../../db/schema";

export function registrarRutaRecoleccion(app: any, db: any, requirePermission: (...args: any[]) => any) {
  const { galerones, lotes_aves, inventario, produccion_diaria, movimientosInventario } = schema;
  app.post("/api/produccion/recoleccion", requirePermission('produccion', 'create'), async (req, res) => {
    try {
      const { galeron, galeronId, granjaId, detalles, cargaId } = req.body;

      if ((!galeron && !galeronId) || !detalles || !Array.isArray(detalles)) {
        return res.status(400).json({ error: "Datos de recolección inválidos" });
      }

      // El galerón se resolvía por nombre y a nivel global: `findFirst(nombre)`
      // devolvía el primero, así que con dos granjas que tienen un "Galerón Central"
      // cada uno, la recolección de la segunda granja se guardaba en el galerón de
      // la primera. No daba error, daba producción en la granja equivocada, que es
      // peor. Se acepta el id (que es lo que manda la vista) y, si solo llega el
      // nombre, se acota a la granja indicada; sin granja, un nombre ambiguo se
      // rechaza en vez de adivinarse.
      let galeronRecord: typeof galerones.$inferSelect | undefined;
      if (galeronId) {
        galeronRecord = await db.query.galerones.findFirst({ where: eq(galerones.id, galeronId) });
      } else {
        const porNombre = await db.query.galerones.findMany({ where: eq(galerones.nombre, galeron) });
        if (granjaId) {
          galeronRecord = porNombre.find(g => g.granjaId === granjaId);
        } else if (porNombre.length > 1) {
          return res.status(400).json({
            error: `"${galeron}" existe en ${porNombre.length} granjas: indica cuál con granjaId o galeronId`,
          });
        } else {
          galeronRecord = porNombre[0];
        }
      }

      if (!galeronRecord) {
        // Fuera de la transacción a propósito: antes este `throw` la abortaba y el
        // catch la devolvía como 500, cuando es un nombre equivocado del cliente.
        return res.status(400).json({ error: `Galerón no encontrado: ${galeronId ?? galeron}` });
      }
      if (granjaId && galeronRecord.granjaId !== granjaId) {
        return res.status(400).json({
          error: `El galerón ${galeronRecord.nombre} no pertenece a esa granja`,
        });
      }

      const idempotenciaPrefix = cargaId
        ? `recoleccion-${createHash('sha256').update(String(cargaId)).digest('hex')}-`
        : null;
      const cantidadDetalle = (det: any) => Number(det.cantidadKg ?? det.cantidad);
      const unidadDetalle = (det: any) => det.cantidadKg != null || det.unidad === 'kg' ? 'kg' : null;
      const detallesActivos = detalles.filter((det: any) => cantidadDetalle(det) > 0);
      const nombreProducto = (det: any) => det.producto || (det.tamano === 'Gallinaza' ? 'Gallinaza' : `Huevos - ${det.tamano}`);

      const resultadoRecoleccion = await db.transaction(async (tx) => {
        // El mismo id de carga hace idempotente el reintento tras perder el acuse.
        if (idempotenciaPrefix) {
          const previas = await tx.query.produccion_diaria.findMany({
            where: (produccion, { like }) => like(produccion.id, `${idempotenciaPrefix}%`)
          });
          if (previas.length > 0) {
            const contenidoIgual = previas.length === detallesActivos.length && detallesActivos.every((det: any) => {
              const producto = nombreProducto(det);
              return previas.some((p: any) => p.tipo_producto === producto && p.galeronId === galeronRecord!.id && Number(p.cantidad) === cantidadDetalle(det) && (!unidadDetalle(det) || p.unidad === 'kg'));
            });
            return { duplicada: true as const, conflicto: !contenidoIgual };
          }
        }

        // Find active lote for this galeron
        const loteRecord = await tx.query.lotes_aves.findFirst({
          where: and(
            eq(lotes_aves.galeronId, galeronRecord.id),
            eq(lotes_aves.estado, 'Activo')
          )
        });

        const loteId = loteRecord ? loteRecord.id : "NO_LOTE_ACTIVO";
        const fecha = new Date().toISOString();
        
        // Create placeholder lote if none exists (FK constraint requires valid lote_id)
        if (!loteRecord) {
          const placeholderId = "NO_LOTE_ACTIVO";
          const existingPlaceholder = await tx.query.lotes_aves.findFirst({ where: eq(lotes_aves.id, placeholderId) });
          if (!existingPlaceholder) {
            await tx.insert(lotes_aves).values({
              id: placeholderId,
              galeronId: galeronRecord.id,
              fecha_ingreso: fecha,
              cantidad_inicial: 0,
              linea_genetica: 'Sin lote activo',
              estado: 'Activo'
            });
          }
        }

        for (const det of detallesActivos) {
          
          let productName: string;
          let unidad: string;
          
          if (det.producto) {
            productName = det.producto;
            const catalogItem = await tx.query.productosCatalogo.findFirst({
              where: eq(schema.productosCatalogo.nombre, det.producto)
            });
            unidad = unidadDetalle(det) || (catalogItem ? catalogItem.unidad : (det.producto.toLowerCase().includes('gallinaza') ? 'sacos' : 'cartones'));
          } else {
            productName = det.tamano === 'Gallinaza' ? 'Gallinaza' : `Huevos - ${det.tamano}`;
            unidad = unidadDetalle(det) || (det.tamano === 'Gallinaza' ? 'sacos' : 'cartones');
          }
          const cantidadProducida = cantidadDetalle(det);
          
          const inventoryItem = await tx.query.inventario.findFirst({
            where: and(
              eq(inventario.producto, productName),
              eq(inventario.ubicacion, 'Granja'),
              eq(inventario.unidad, unidad)
            )
          });

          if (inventoryItem) {
            if (inventoryItem.unidad !== unidad) throw Object.assign(new Error(`La unidad de recolección (${unidad}) no coincide con el inventario de Granja (${inventoryItem.unidad}) para ${productName}.`), { status: 409 });
            await tx.update(inventario)
              .set({ 
                cantidad: inventoryItem.cantidad + cantidadProducida,
                ultima_actualizacion: fecha
              })
              .where(eq(inventario.id, inventoryItem.id));
          } else {
            // If it doesn't exist, we insert it
            await tx.insert(inventario).values({
              id: crypto.randomUUID(),
              producto: productName,
              cantidad: cantidadProducida,
              unidad: unidad,
              ubicacion: 'Granja',
              ultima_actualizacion: fecha
            });
          }

          const prodId = idempotenciaPrefix
            ? `${idempotenciaPrefix}${encodeURIComponent(galeronRecord.id)}-${encodeURIComponent(productName)}`
            : crypto.randomUUID();

          // Insert into produccion_diaria
          await tx.insert(produccion_diaria).values({
            id: prodId,
            loteId: loteId,
            granjaId: galeronRecord.granjaId,
            galeronId: galeronRecord.id,
            fecha: fecha,
            tipo_producto: productName,
            cantidad: cantidadProducida,
            unidad: unidad
          });

          // Insert into movimientosInventario
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: productName,
            cantidad: cantidadProducida,
            unidad,
            tipo: 'Entrada Producción',
            origen: galeronRecord.id,
            destino: 'Granja',
            fecha: fecha,
            referencia_id: prodId
          });
        }
        return { duplicada: false as const, conflicto: false as const };
      });

      if (resultadoRecoleccion.conflicto) {
        return res.status(409).json({ error: 'Esta carga ya se registró con otros productos o cantidades. No se cambió el inventario.' });
      }
      
      res.status(200).json({ success: true, duplicada: resultadoRecoleccion.duplicada, message: resultadoRecoleccion.duplicada ? 'Esta recolección ya estaba registrada.' : 'Recolección registrada exitosamente' });
    } catch (error: any) {
      console.error("Error registrando recolección:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

}
