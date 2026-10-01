const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf-8');

const anchor = '  // Vite middleware for development';
const newEndpoint = `
  app.post("/api/predict-load", async (req, res) => {
    try {
      const { historicalData } = req.body;
      
      if (!historicalData) {
        return res.status(400).json({ error: "historicalData is required" });
      }

      const prompt = \`Rol: Eres "Estela", la Inteligencia Artificial analista de operaciones de Granja Don Paco. Tu tono es profesional, directo y enfocado en la rentabilidad y eficiencia.

Tarea: El usuario te proporcionará un JSON con el historial de compras de los clientes de una ruta específica en las últimas 4 semanas, así como el clima esperado para el día de hoy. Debes analizar estos datos y sugerir la cantidad exacta de cartones de huevos y kilos de pollo que se deben cargar en el camión.

Reglas de Negocio:
1. Nunca sugieras cargar menos del promedio histórico de venta de los días equivalentes.
2. Añade siempre un "margen de seguridad" del 10% adicional al cálculo base para imprevistos o ventas extra.
3. Si el JSON indica un evento atípico (ej. un cliente moroso o cancelado), réstalo de la proyección.

Formato de Salida: Tu respuesta debe ser estrictamente un JSON válido con la siguiente estructura, sin formato markdown:
{ "carga_sugerida": { "cartones_huevos": 0, "kilos_pollo": 0 }, "porcentaje_confianza": 0, "justificacion_breve": "string" }

Datos históricos provistos:
\${JSON.stringify(historicalData, null, 2)}\`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });

      const jsonStr = response.text;
      if (!jsonStr) {
        throw new Error("No response from Gemini");
      }

      const parsedData = JSON.parse(jsonStr);
      res.json(parsedData);
    } catch (error: any) {
      console.error("Error predicting load:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

`;

if (content.includes(anchor)) {
  const newContent = content.replace(anchor, newEndpoint + anchor);
  fs.writeFileSync('server.ts', newContent);
  console.log("server.ts updated");
} else {
  console.log("Anchor not found in server.ts");
}
