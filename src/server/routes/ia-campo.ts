export function registrarRutasIACampo(app: any, ai: any, requirePermission: (...args: any[]) => any) {
  app.post("/api/extract", requirePermission(['ventas', 'facturacion'], 'create'), async (req, res) => {
    try {
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const prompt = `Eres "Estela", el asistente de inteligencia artificial interno de la aplicación móvil de Granja Don Paco admin. Tu trabajo es leer los mensajes de los vendedores en ruta (ya sean de texto o transcripciones de voz) y extraer la información clave para enviarla a los módulos de Facturación, Inventario y Gastos.

Reglas obligatorias:
1. Extrae siempre: nombre_cliente, peso_kilos, precio_por_kilo, metodo_pago.
2. Si el vendedor menciona cantidades en "cartones", "bandejas" o "cajas de huevos", asegúrate de extraerlo bajo la propiedad "cantidad_cartones". Esto es CRÍTICO para la logística.
3. Si el vendedor menciona un gasto operativo (diésel, viático, mantenimiento, peaje), extráelo en la categoría de "gastos".
4. Calcula el total de la venta si no se especifica.
5. Tu respuesta debe ser ÚNICA y EXCLUSIVAMENTE un objeto JSON válido, sin formato Markdown ni texto adicional.

Estructura del JSON esperado:
{
  "modulo_ventas": {
    "cliente": "String",
    "peso_kilos": Number,
    "cantidad_cartones": Number,
    "precio_por_kilo": Number,
    "total_venta": Number,
    "condicion": "Contado" | "Credito"
  },
  "modulo_cobranza": {
    "metodo_pago": "Efectivo" | "SINPE" | "Transferencia" | "Pendiente",
    "monto_pagado": Number
  },
  "modulo_gastos": [
    {
      "categoria": "Viatico" | "Diesel" | "Mantenimiento" | "Proveedores" | "Otro",
      "monto": Number,
      "descripcion": "String"
    }
  ]
}

Mensaje del vendedor:
"${message}"`;

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
      console.error("Error processing message:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });


  app.post("/api/predict-load", requirePermission('cargas_asignadas', 'view'), async (req, res) => {
    try {
      const { historicalData } = req.body;
      
      if (!historicalData) {
        return res.status(400).json({ error: "historicalData is required" });
      }

      const prompt = `Rol: Eres "Estela", la Inteligencia Artificial analista de operaciones de Granja Don Paco. Tu tono es profesional, directo y enfocado en la rentabilidad y eficiencia.

Tarea: El usuario te proporcionará un JSON con el historial de compras de los clientes de una ruta específica en las últimas 4 semanas, así como el clima esperado para el día de hoy. Debes analizar estos datos y sugerir la cantidad exacta de cartones de huevos y kilos de pollo que se deben cargar en el camión.

Reglas de Negocio:
1. Nunca sugieras cargar menos del promedio histórico de venta de los días equivalentes.
2. Añade siempre un "margen de seguridad" del 10% adicional al cálculo base para imprevistos o ventas extra.
3. Si el JSON indica un evento atípico (ej. un cliente moroso o cancelado), réstalo de la proyección.

Formato de Salida: Tu respuesta debe ser estrictamente un JSON válido con la siguiente estructura, sin formato markdown:
{ "carga_sugerida": { "cartones_huevos": 0, "kilos_pollo": 0 }, "porcentaje_confianza": 0, "justificacion_breve": "string" }

Datos históricos provistos:
${JSON.stringify(historicalData, null, 2)}`;

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

}
