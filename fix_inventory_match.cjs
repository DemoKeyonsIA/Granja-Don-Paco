const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

const targetStr = `          // Update inventory atomically: subtract quantity for 'Camión Ruta 1' matching the product type (e.g. '%Huevos%' or '%Aves%')
          // Since product names in det.producto are like 'Huevos - Grande' or 'Aves (Pollo Entero)'
          const productLike = det.producto.includes('Huevos') ? '%Huevos%' : '%Aves%';
          
          const inventoryItem = await tx.query.inventario.findFirst({
            where: and(
              like(inventario.producto, productLike),
              eq(inventario.ubicacion, 'Camión Ruta 1')
            )
          });`;

const replacement = `          // Update inventory atomically: match exact product ID/name
          const inventoryItem = await tx.query.inventario.findFirst({
            where: and(
              eq(inventario.producto, det.producto),
              eq(inventario.ubicacion, 'Camión Ruta 1')
            )
          });`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, replacement);
  fs.writeFileSync('server.ts', content);
  console.log("Updated inventory match to exact eq()");
} else {
  console.log("Could not find targetStr");
}
