const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

// Also need to import 'gastos' from schema
content = content.replace(
  'import { facturas, detallesFactura, inventario } from "./src/db/schema";',
  'import { facturas, detallesFactura, inventario, gastos } from "./src/db/schema";'
);

const routesTarget = '  // Vite middleware for development';
const routesReplacement = `  app.post("/api/gastos", async (req, res) => {
    try {
      const { id, fecha, categoria, monto, descripcion, usuarioId } = req.body;
      
      if (!categoria || !monto || !descripcion || !usuarioId) {
        return res.status(400).json({ error: "Datos de gasto inválidos" });
      }

      await db.insert(gastos).values({
        id: id || crypto.randomUUID(),
        fecha: fecha || new Date().toISOString(),
        categoria,
        monto,
        descripcion,
        usuarioId
      });
      
      res.status(200).json({ success: true, message: 'Gasto registrado exitosamente' });
    } catch (error: any) {
      console.error("Error registrando gasto:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.get("/api/gastos", async (req, res) => {
    try {
      const data = await db.query.gastos.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development`;

if (content.includes(routesTarget)) {
  content = content.replace(routesTarget, routesReplacement);
  fs.writeFileSync('server.ts', content);
  console.log('Added /api/gastos endpoints');
} else {
  console.log('Target not found for /api/gastos');
}
