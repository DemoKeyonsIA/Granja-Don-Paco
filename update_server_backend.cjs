const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

// Adding PUT and DELETE endpoints for granjas and galerones, and logistica auditoria
const target = '  // Vite middleware for development';
const replacement = `
  // CRUD Updates Granjas
  app.put("/api/granjas/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, ubicacion, encargadoId, estado } = req.body;
      const updateData: any = {};
      if (nombre) updateData.nombre = nombre;
      if (ubicacion) updateData.ubicacion = ubicacion;
      if (encargadoId) updateData.encargadoId = encargadoId;
      if (estado) updateData.estado = estado;
      
      await db.update(granjas).set(updateData).where(eq(granjas.id, id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // CRUD Updates Galerones
  app.put("/api/galerones/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, capacidad_maxima, estado_fisico, estado } = req.body;
      const updateData: any = {};
      if (nombre) updateData.nombre = nombre;
      if (capacidad_maxima) updateData.capacidad_maxima = Number(capacidad_maxima);
      if (estado_fisico) updateData.estado_fisico = estado_fisico;
      if (estado) updateData.estado = estado;
      
      await db.update(galerones).set(updateData).where(eq(galerones.id, id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Logistica Auditoria
  app.get("/api/logistica/auditoria", async (req, res) => {
    try {
      const todasFacturas = await db.query.facturas.findMany();
      const todosDetalles = await db.query.detallesFactura.findMany();
      const todosClientes = await db.query.clientes.findMany();
      
      const facturasCompletas = todasFacturas.map(f => ({
        ...f,
        cliente: todosClientes.find(c => c.id === f.clienteId),
        detalles: todosDetalles.filter(d => d.facturaId === f.id)
      }));

      res.json(facturasCompletas);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('server.ts', content);
  console.log('Server updated with PUT endpoints and Auditoria');
}
