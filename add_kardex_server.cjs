const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const newEndpoint = `
  // GET /api/inventario/movimientos
  app.get("/api/inventario/movimientos", async (req, res) => {
    try {
      const movimientos = await db.query.movimientosInventario.findMany();
      res.json(movimientos);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gastos"`;

code = code.replace(/app\.post\("\/api\/gastos"/, newEndpoint);
fs.writeFileSync('server.ts', code);
