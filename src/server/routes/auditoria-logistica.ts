export function registrarAuditoriaLogistica(app: any, db: any, requirePermission: (...args: any[]) => any) {
  app.get("/api/logistica/auditoria", requirePermission('auditoria', 'view'), async (req, res) => {
    try {
      const rutaSeleccionada = (req.query.ruta as string) || 'Camión Ruta 1';

      const todasFacturas = await db.query.facturas.findMany();
      const todosDetalles = await db.query.detallesFactura.findMany();
      const todosClientes = await db.query.clientes.findMany();
      
      const facturasCompletas = todasFacturas.map(f => ({
        ...f,
        cliente: todosClientes.find(c => c.id === f.clienteId),
        detalles: todosDetalles.filter(d => d.facturaId === f.id)
      }));
      
      const facturasDeRuta = facturasCompletas.filter(f => f.cliente && f.cliente.ruta === rutaSeleccionada);

      const todosMovimientos = await db.query.movimientosInventario.findMany();
      const hoy = new Date().toISOString().split('T')[0];
      const movimientosCarga = todosMovimientos.filter(m => 
        m.destino === rutaSeleccionada && 
        m.origen === 'Bodega Central' && 
        String(m.fecha).startsWith(hoy)
      );
      
      const totalCargado = movimientosCarga.reduce((acc, curr) => acc + Number(curr.cantidad), 0);

      res.json({
        facturas: facturasDeRuta,
        totalCargado: totalCargado
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
