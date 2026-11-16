import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";

export function registrarRutasGastos(app: any, db: any, requirePermission: any) {
  const { gastos, guias_despacho } = schema;
  app.post("/api/gastos", requirePermission(['gastos_ruta', 'finanzas'], 'create'), async (req, res) => {
    try {
      const { id, fecha, categoria, monto, descripcion, guiaId = null, medioPago = 'Efectivo' } = req.body;
      const rawKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
      const idempotencyKey = rawKey == null ? null : String(rawKey).trim();
      if (idempotencyKey !== null && (!idempotencyKey || idempotencyKey.length > 160)) {
        return res.status(400).json({ error: 'Idempotency-Key debe tener entre 1 y 160 caracteres' });
      }
      const categoriasPermitidas = new Set(['Diésel', 'Diesel', 'Viáticos', 'Mantenimiento', 'Insumos', 'Planilla', 'Otros']);
      const montoNumerico = Number(monto);
      const fechaGasto = fecha == null || fecha === '' ? new Date().toISOString() : String(fecha);
      if (!categoriasPermitidas.has(String(categoria || '')) || !Number.isFinite(montoNumerico) || montoNumerico <= 0 || !String(descripcion || '').trim() || Number.isNaN(Date.parse(fechaGasto))) {
        return res.status(400).json({ error: "Datos de gasto inválidos" });
      }
      if (!['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'].includes(String(medioPago))) return res.status(400).json({ error: 'Medio de pago inválido.' });
      if (guiaId) {
        const guiaGasto = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, String(guiaId)) });
        if (!guiaGasto) return res.status(404).json({ error: 'Guía asociada al gasto no encontrada.' });
        if (guiaGasto.finDiaFecha || ['Cerrada', 'CerradaConDiferencia', 'Anulada'].includes(guiaGasto.estado)) return res.status(409).json({ error: 'La guía ya cerró; no se pueden agregar gastos a su caja.' });
      }

      const autor = String((req as any).usuario?.id || '');
      if (!autor) return res.status(401).json({ error: 'Se requiere una sesión válida para registrar gastos' });
      if (idempotencyKey) {
        const existente = await db.query.gastos.findFirst({ where: eq(gastos.idempotencyKey, idempotencyKey) });
        if (existente) {
          const coincide = existente.usuarioId === autor && existente.categoria === categoria
            && Number(existente.monto) === Math.round(montoNumerico * 100) / 100
            && existente.descripcion === String(descripcion).trim()
            && (existente.guiaId ?? null) === (guiaId ? String(guiaId) : null)
            && (existente.medioPago || 'Efectivo') === medioPago;
          return coincide
            ? res.status(200).json({ success: true, repetido: true, gasto: existente })
            : res.status(409).json({ error: 'Idempotency-Key ya fue usada para otro gasto' });
        }
      }
      await db.insert(gastos).values({
        id: id || crypto.randomUUID(),
        fecha: fechaGasto,
        categoria,
        monto: Math.round(montoNumerico * 100) / 100,
        descripcion: String(descripcion).trim(),
        usuarioId: autor,
        idempotencyKey,
        guiaId: guiaId ? String(guiaId) : null,
        medioPago: String(medioPago),
      });
      
      res.status(200).json({ success: true, repetido: false, message: 'Gasto registrado exitosamente' });
    } catch (error: any) {
      if (String(error?.message || '').includes('idx_gastos_idempotency_key')) {
        return res.status(409).json({ error: 'El gasto ya fue registrado; recargue la lista antes de continuar' });
      }
      console.error("Error registrando gasto:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.get("/api/gastos", requirePermission(['finanzas', 'gastos_ruta'], 'view'), async (req, res) => {
    try {
      const data = await db.query.gastos.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
