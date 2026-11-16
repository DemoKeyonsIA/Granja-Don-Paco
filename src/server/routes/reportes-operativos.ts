/** Reportes operativos de ventas, producción, inventario y desperdicios. */
export function registrarRutasReportesOperativos(app: any, db: any, requirePermission: (...args: any[]) => any) {
  const fechaEnRango = (fecha: unknown, inicio?: string, fin?: string) => {
    const dia = String(fecha ?? '').slice(0, 10);
    return (!inicio || dia >= inicio) && (!fin || dia <= fin);
  };

  app.get("/api/reportes/ventas-por-ruta", requirePermission('reportes', 'view'), async (req, res) => {
    try {
      const fechaInicio = req.query.fechaInicio as string;
      const fechaFin = req.query.fechaFin as string;
      const [todasFacturas, todosClientes, todosDetalles] = await Promise.all([
        db.query.facturas.findMany(), db.query.clientes.findMany(), db.query.detallesFactura.findMany()
      ]);

      const facturasConCliente = todasFacturas.map(f => ({
        ...f, cliente: todosClientes.find(c => c.id === f.clienteId)
      }));

      const filtradas = facturasConCliente.filter(f => fechaEnRango(f.fecha, fechaInicio, fechaFin));

      const porRuta = filtradas.reduce((acc: Record<string, any>, f) => {
        const ruta = (f as any).cliente?.ruta || 'Sin ruta';
        if (!acc[ruta]) acc[ruta] = { ruta, facturas: 0, totalVentas: 0, totalDescuento: 0, productos: {} };
        acc[ruta].facturas += 1;
        acc[ruta].totalVentas += Number(f.total);
        acc[ruta].totalDescuento += Number(f.descuento);
        const detalles = todosDetalles.filter(d => d.facturaId === f.id);
        for (const d of detalles) {
          if (!acc[ruta].productos[d.producto]) acc[ruta].productos[d.producto] = { cantidad: 0, total: 0 };
          acc[ruta].productos[d.producto].cantidad += Number(d.cantidad);
          acc[ruta].productos[d.producto].total += Number(d.subtotal);
        }
        return acc;
      }, {});

      res.json(Object.values(porRuta));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/reportes/produccion", requirePermission('reportes', 'view'), async (req, res) => {
    try {
      const fechaInicio = req.query.fechaInicio as string;
      const fechaFin = req.query.fechaFin as string;
      const [todaProduccion, todasGranjas] = await Promise.all([
        db.query.produccion_diaria.findMany(), db.query.granjas.findMany()
      ]);

      const filtrada = todaProduccion.filter(p => fechaEnRango(p.fecha, fechaInicio, fechaFin));

      const porGranja = filtrada.reduce((acc: Record<string, any>, p) => {
        const granja = todasGranjas.find(g => g.id === p.granjaId);
        const unidad = String(p.unidad || 'Unidad no especificada');
        const nombreGranja = granja?.nombre || p.granjaId || 'Sin granja';
        const key = `${nombreGranja}::${unidad}`;
        if (!acc[key]) acc[key] = { granja: nombreGranja, unidad, totalProduccion: 0, porProducto: {} };
        const cantidad = Number(p.cantidad) || 0;
        acc[key].totalProduccion += cantidad;
        const producto = String(p.tipo_producto || 'Sin categoría');
        acc[key].porProducto[producto] = (acc[key].porProducto[producto] || 0) + cantidad;
        return acc;
      }, {});

      res.json(Object.values(porGranja));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/reportes/inventario", requirePermission('reportes', 'view'), async (req, res) => {
    try {
      const inventarioTotal = await db.query.inventario.findMany();
      const porUbicacion = inventarioTotal.reduce((acc: Record<string, any>, i) => {
        if (!acc[i.ubicacion]) acc[i.ubicacion] = { ubicacion: i.ubicacion, productos: [], valorTotal: 0 };
        acc[i.ubicacion].productos.push({ producto: i.producto, cantidad: i.cantidad, unidad: i.unidad });
        return acc;
      }, {});
      res.json(Object.values(porUbicacion));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/reportes/desperdicios", requirePermission('reportes', 'view'), async (req, res) => {
    try {
      const fechaInicio = req.query.fechaInicio as string;
      const fechaFin = req.query.fechaFin as string;
      const todosDesperdicios = await db.query.desperdicios.findMany();

      const filtrados = todosDesperdicios.filter(d => fechaEnRango(d.fecha, fechaInicio, fechaFin));

      const porOrigen = filtrados.reduce((acc: Record<string, any>, d) => {
        if (!acc[d.origen]) acc[d.origen] = { origen: d.origen, registros: 0, impactoTotal: 0, porUnidad: {}, porMotivo: {} };
        acc[d.origen].registros += 1;
        acc[d.origen].impactoTotal += Number(d.impactoFinanciero);
        const unidad = String(d.unidad || 'Unidad no especificada');
        acc[d.origen].porUnidad[unidad] = (acc[d.origen].porUnidad[unidad] || 0) + Number(d.cantidad || 0);
        if (!acc[d.origen].porMotivo[d.motivo]) acc[d.origen].porMotivo[d.motivo] = { registros: 0, impacto: 0 };
        acc[d.origen].porMotivo[d.motivo].registros += 1;
        acc[d.origen].porMotivo[d.motivo].impacto += Number(d.impactoFinanciero);
        return acc;
      }, {});

      res.json(Object.values(porOrigen));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

}
