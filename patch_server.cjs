const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const newEndpoint = `
  app.post("/api/granjas/wizard", async (req, res) => {
    try {
      const { nombre, ubicacion, tipo_produccion, encargadoId, galerones: galeronesData } = req.body;
      if (!nombre || !ubicacion || !tipo_produccion || !encargadoId) {
        return res.status(400).json({ error: "Missing fields" });
      }

      await db.transaction(async (tx) => {
        const granjaId = crypto.randomUUID();
        await tx.insert(granjas).values({
          id: granjaId,
          nombre,
          ubicacion,
          tipo_produccion,
          encargadoId,
          estado: 'Activo'
        });

        if (galeronesData && Array.isArray(galeronesData) && galeronesData.length > 0) {
          const galeronesToInsert = galeronesData.map((g: any) => ({
            id: crypto.randomUUID(),
            granjaId,
            nombre: g.nombre,
            capacidad_maxima: Number(g.capacidad_maxima),
            estado_fisico: 'Óptimo',
            estado: 'Activo'
          }));
          await tx.insert(galerones).values(galeronesToInsert);
        }
      });

      res.status(201).json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/granjas"`;

code = code.replace('  app.post("/api/granjas"', newEndpoint);

fs.writeFileSync('server.ts', code);
