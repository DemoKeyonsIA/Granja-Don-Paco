const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

const target = '  // Vite middleware for development';
const replacement = `  app.post("/api/produccion/recoleccion", async (req, res) => {
    try {
      const { galeron, detalles } = req.body;
      
      if (!galeron || !detalles || !Array.isArray(detalles)) {
        return res.status(400).json({ error: "Datos de recolección inválidos" });
      }

      await db.transaction(async (tx) => {
        for (const det of detalles) {
          if (det.cantidad <= 0) continue;
          
          const productName = \`Huevos - \${det.tamano}\`;
          
          const inventoryItem = await tx.query.inventario.findFirst({
            where: and(
              eq(inventario.producto, productName),
              eq(inventario.ubicacion, 'Bodega Central')
            )
          });

          if (inventoryItem) {
            await tx.update(inventario)
              .set({ 
                cantidad: inventoryItem.cantidad + det.cantidad,
                ultima_actualizacion: new Date().toISOString()
              })
              .where(eq(inventario.id, inventoryItem.id));
          } else {
            // If it doesn't exist, we insert it
            await tx.insert(inventario).values({
              id: Math.random().toString(36).substr(2, 9),
              producto: productName,
              cantidad: det.cantidad,
              unidad: 'cartones',
              ubicacion: 'Bodega Central',
              ultima_actualizacion: new Date().toISOString()
            });
          }
        }
      });
      
      res.status(200).json({ success: true, message: 'Recolección registrada exitosamente' });
    } catch (error: any) {
      console.error("Error registrando recolección:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Vite middleware for development`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('server.ts', content);
  console.log('Added /api/produccion/recoleccion');
}
