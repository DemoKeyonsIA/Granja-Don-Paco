const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf-8');

const anchor = '  // Vite middleware for development';
const endpoints = `
  app.get("/api/inventario", async (req, res) => {
    try {
      const data = await db.query.inventario.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/facturas", async (req, res) => {
    try {
      const data = await db.query.facturas.findMany({
        with: {
          detalles: true
        }
      });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

`;

if (content.includes(anchor)) {
  const newContent = content.replace(anchor, endpoints + anchor);
  fs.writeFileSync('server.ts', newContent);
  console.log("server.ts updated with GET endpoints");
} else {
  console.log("Anchor not found in server.ts");
}
