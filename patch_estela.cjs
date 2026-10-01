const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const regex = /\/\/ Chat RAG Estela[\s\S]*?res\.status\(500\)\.json\(\{ error: error\.message \}\);\s*\}\s*\}\);/m;

const newEndpoint = `// Chat RAG Estela
  app.post("/api/chat/estela", async (req, res) => {
    try {
      const { message, history } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const hoy = new Date().toISOString().split('T')[0];

      // 1. Ingresos, Cuentas por Cobrar y Gastos
      const todasFacturas = await db.query.facturas.findMany();
      const facturasHoy = todasFacturas.filter(f => String(f.fecha).startsWith(hoy));
      
      const ingresosHoyPagados = facturasHoy
        .filter(f => f.estado === 'Pagada')
        .reduce((acc, f) => acc + Number(f.total), 0);

      const cuentasPorCobrar = todasFacturas
        .filter(f => f.estado === 'Pendiente')
        .reduce((acc, f) => acc + Number(f.total), 0);

      const todosGastos = await db.query.gastos.findMany();
      const gastosHoy = todosGastos
        .filter(g => String(g.fecha).startsWith(hoy))
        .reduce((acc, g) => acc + Number(g.monto), 0);
        
      const utilidadNetaHoy = ingresosHoyPagados - gastosHoy;

      // 2. Producción de Hoy
      const todaProduccion = await db.query.produccion_diaria.findMany();
      const produccionHoy = todaProduccion.filter(p => String(p.fecha).startsWith(hoy));
      
      const cartonesHoy = produccionHoy
        .filter(p => String(p.tipo_producto).includes('Huevos'))
        .reduce((acc, p) => acc + Number(p.cantidad), 0);
        
      const gallinazaHoy = produccionHoy
        .filter(p => String(p.tipo_producto).includes('Gallinaza'))
        .reduce((acc, p) => acc + Number(p.cantidad), 0);

      // 3. Stock actual de Huevos en Bodega Central
      const inventarioTotal = await db.query.inventario.findMany();
      const stockHuevosBodega = inventarioTotal
        .filter(i => String(i.producto).includes('Huevos') && i.ubicacion === 'Bodega Central')
        .reduce((acc, i) => acc + Number(i.cantidad), 0);

      // 4. Total de Aves Vivas
      const lotesAves = await db.query.lotes_aves.findMany();
      const avesVivas = lotesAves
        .filter(l => l.estado === 'Activo')
        .reduce((acc, l) => acc + Number(l.cantidad_inicial), 0);

      const contextoGranja = {
        ingresos_pagados_hoy: ingresosHoyPagados,
        cuentas_por_cobrar: cuentasPorCobrar,
        gastos_hoy: gastosHoy,
        utilidad_neta_hoy: utilidadNetaHoy,
        produccion_hoy_cartones: cartonesHoy,
        produccion_hoy_gallinaza: gallinazaHoy,
        stock_huevos_bodega_central: stockHuevosBodega,
        total_aves_vivas: avesVivas
      };

      const systemInstruction = \`Eres Estela, la Directora de Operaciones (COO) de Granja Don Paco. Tu rol es dar respuestas ejecutivas, analíticas y directas al administrador basadas estrictamente en el siguiente JSON en tiempo real. Si te preguntan por rentabilidad, cruza los ingresos con los gastos. Si te preguntan por producción, lee los cartones y gallinaza de hoy. Nunca inventes datos, si la respuesta no está en el JSON, dilo. Contexto: \${JSON.stringify(contextoGranja)}\`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: message,
        config: {
           systemInstruction: systemInstruction,
           temperature: 0.2
        }
      });

      res.json({ text: response.text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });`;

code = code.replace(regex, newEndpoint);
fs.writeFileSync('server.ts', code);
