const fs = require('fs');
const content = fs.readFileSync('src/components/Facturacion.tsx', 'utf-8');

const startStr = "const handleCreate = (e: React.FormEvent) => {";
const endStr = "    setFacturas([newFactura, ...facturas]);\n    setIsCreating(false);\n    resetForm();\n  };";

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr) + endStr.length;

if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCliente || detalles.some(d => d.cantidad <= 0 || d.precio_unitario <= 0)) return;

    const newFactura: Factura = {
      id: Math.random().toString(36).substr(2, 9),
      consecutivo: \`FAC-\${(facturas.length + 1).toString().padStart(4, '0')}\`,
      fecha: new Date().toISOString(),
      clienteId: selectedCliente,
      vendedorId: currentUser.id,
      detalles: [...detalles],
      subtotal,
      descuento,
      total,
      condicion_pago: condicionPago,
      metodo_pago: condicionPago === 'Contado' ? metodoPago : undefined,
      estado: condicionPago === 'Contado' ? 'Pagada' : 'Pendiente'
    };

    // RESTAR DEL INVENTARIO MOCK GLOBAL (Simulando DB Transaction)
    detalles.forEach(det => {
      const stockIndex = mockInventario.findIndex(i => i.producto.includes(det.producto) && i.ubicacion === 'Camión Ruta 1');
      if (stockIndex >= 0) {
        mockInventario[stockIndex].cantidad -= det.cantidad;
      }
    });

    // INSERTAR EN LA BD MOCK GLOBAL PARA QUE LOGISTICA LO VEA
    mockFacturas.unshift(newFactura);

    setFacturas([newFactura, ...facturas]);
    setIsCreating(false);
    resetForm();
  };`;
  
  const newContent = content.substring(0, startIdx) + replacement + content.substring(endIdx);
  fs.writeFileSync('src/components/Facturacion.tsx', newContent);
  console.log("Facturacion Updated!");
} else {
  console.log("Facturacion Not found");
}

const logContent = fs.readFileSync('src/components/Logistica.tsx', 'utf-8');
const logStartStr = "const handleFinalizarRuta = (id: string, pesoEntrada: number, cartonesEntrada: number) => {";
const logEndStr = "      return c;\n    }));\n  };";

const logStartIdx = logContent.indexOf(logStartStr);
const logEndIdx = logContent.indexOf(logEndStr) + logEndStr.length;

if (logStartIdx !== -1 && logEndIdx !== -1) {
  const logReplacement = `const handleFinalizarRuta = (id: string, pesoEntrada: number, cartonesEntrada: number) => {
    setControles(controles.map(c => {
      if (c.id === id) {
        // CÁLCULO MATEMÁTICO REAL: Leer las facturas emitidas por este vendedor en la ruta
        const facturasRuta = mockFacturas.filter(f => f.vendedorId === currentUser.id && f.estado !== 'Cancelada');
        
        let cartonesVendidos = 0;
        let kilosVendidos = 0;
        
        facturasRuta.forEach(f => {
           f.detalles.forEach(det => {
              if (det.producto.includes('Huevos')) cartonesVendidos += det.cantidad;
              if (det.producto.includes('Aves')) kilosVendidos += det.cantidad;
           });
        });

        const mermaCartones = (c.cartonesSalida || 0) - cartonesVendidos - cartonesEntrada;
        const mermaKilos = (c.pesoSalida || 0) - kilosVendidos - pesoEntrada;

        return { 
          ...c, 
          horaEntrada: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), 
          pesoEntrada, 
          cartonesEntrada,
          cartonesVendidos,
          kilosVendidos,
          mermaCartones,
          mermaKilos,
          estado: 'Finalizado' 
        };
      }
      return c;
    }));
  };`;
  
  const newLogContent = logContent.substring(0, logStartIdx) + logReplacement + logContent.substring(logEndIdx);
  fs.writeFileSync('src/components/Logistica.tsx', newLogContent);
  console.log("Logistica Updated!");
} else {
  console.log("Logistica Not found");
}

