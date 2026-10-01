const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

// Also need to import 'granjas', 'galerones', 'lotes_aves', 'mantenimientos' from schema
content = content.replace(
  'import { facturas, detallesFactura, inventario, gastos } from "./src/db/schema";',
  'import { facturas, detallesFactura, inventario, gastos, granjas, galerones, lotes_aves, mantenimientos } from "./src/db/schema";'
);

const routesTarget = '  // Vite middleware for development';
const routesReplacement = `  // Granja Hierarchy Endpoints
  app.get("/api/granjas", async (req, res) => {
    try {
      const data = await db.query.granjas.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post("/api/granjas", async (req, res) => {
    try {
      const { nombre, ubicacion, encargadoId } = req.body;
      if (!nombre || !ubicacion || !encargadoId) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(granjas).values({
        id: crypto.randomUUID(),
        nombre,
        ubicacion,
        encargadoId
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/galerones", async (req, res) => {
    try {
      const data = await db.query.galerones.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/galerones", async (req, res) => {
    try {
      const { granjaId, nombre, capacidad_maxima, estado_fisico } = req.body;
      if (!granjaId || !nombre || !capacidad_maxima || !estado_fisico) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(galerones).values({
        id: crypto.randomUUID(),
        granjaId,
        nombre,
        capacidad_maxima: Number(capacidad_maxima),
        estado_fisico
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/lotes", async (req, res) => {
    try {
      const data = await db.query.lotes_aves.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/lotes", async (req, res) => {
    try {
      const { galeronId, fecha_ingreso, cantidad_inicial, linea_genetica, estado } = req.body;
      if (!galeronId || !fecha_ingreso || !cantidad_inicial || !linea_genetica || !estado) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(lotes_aves).values({
        id: crypto.randomUUID(),
        galeronId,
        fecha_ingreso,
        cantidad_inicial: Number(cantidad_inicial),
        linea_genetica,
        estado
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/mantenimientos", async (req, res) => {
    try {
      const data = await db.query.mantenimientos.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/mantenimientos", async (req, res) => {
    try {
      const { galeronId, fecha, tipo, descripcion, estado } = req.body;
      if (!galeronId || !fecha || !tipo || !descripcion || !estado) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(mantenimientos).values({
        id: crypto.randomUUID(),
        galeronId,
        fecha,
        tipo,
        descripcion,
        estado
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development`;

if (content.includes(routesTarget)) {
  content = content.replace(routesTarget, routesReplacement);
  fs.writeFileSync('server.ts', content);
  console.log('Added Granja hierarchy endpoints');
} else {
  console.log('Target not found for Granja hierarchy endpoints');
}
