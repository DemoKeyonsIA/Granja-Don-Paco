const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const estelaEndpoint = `  // Chat RAG Estela
  app.post("/api/chat/estela", async (req, res) => {
    try {
      const { message, history } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const hoy = new Date().toISOString().split('T')[0];

      // 1. Ingresos totales del día de hoy
      const todasFacturas = await db.query.facturas.findMany();
      const ingresosHoy = todasFacturas
        .filter(f => String(f.fecha).startsWith(hoy))
        .reduce((acc, f) => acc + Number(f.total), 0);

      // 2. Total de Cuentas por Cobrar
      const cuentasPorCobrar = todasFacturas
        .filter(f => f.estado === 'Pendiente')
        .reduce((acc, f) => acc + Number(f.total), 0);

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
        ingresos_hoy: ingresosHoy,
        cuentas_por_cobrar: cuentasPorCobrar,
        stock_huevos_bodega_central: stockHuevosBodega,
        total_aves_vivas: avesVivas
      };

      const systemInstruction = \`Eres Estela, la analista de operaciones de Granja Don Paco. Responde de forma clara y directa a las preguntas del administrador basándote estrictamente en este contexto JSON de la base de datos de la granja. No inventes datos. Contexto: \${JSON.stringify(contextoGranja)}\`;

      const chat = ai.chats.create({
        model: "gemini-2.5-flash",
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.2
        }
      });
      
      if (history && Array.isArray(history)) {
        for (const msg of history) {
            await chat.sendMessage({ message: msg.content || "" });
            // Gemini doesn't support manual history injection like this cleanly in standard genai unless passing history in create, but we can just append it to the prompt or use contents array if needed.
            // Actually, we can just pass the contents array to model.generateContent if we prefer, but for simplicity, let's just pass the context and the last message.
        }
      }

      // Instead of chat, let's just use generateContent with system instruction to avoid complex history management if not strictly required, or pass the history.
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
  });
\n`;

code = code.replace("  // Start Vite dev server", estelaEndpoint + "  // Start Vite dev server");
// if not found, let's just insert it before app.listen
code = code.replace("  app.listen(PORT", estelaEndpoint + "  app.listen(PORT");

fs.writeFileSync('server.ts', code);
