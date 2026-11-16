import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";

export function registrarRutasGastos(app: any, db: any, requirePermission: any) {
  const { gastos, guias_despacho, camiones, users, aprobaciones, rutas } = schema;
  app.post("/api/gastos", requirePermission(['gastos_ruta', 'finanzas'], 'create'), async (req, res) => {
    try {
      const { id, fecha, categoria, monto, descripcion, guiaId = null, medioPago = 'Efectivo', comprobante = null } = req.body;
      const rawKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
      const idempotencyKey = rawKey == null ? null : String(rawKey).trim();
      if (idempotencyKey !== null && (!idempotencyKey || idempotencyKey.length > 160)) {
        return res.status(400).json({ error: 'Idempotency-Key debe tener entre 1 y 160 caracteres' });
      }
      const categoriasPermitidas = new Set(['Diésel', 'Diesel', 'Hospedaje', 'Dieta', 'Viáticos', 'Mantenimiento', 'Insumos', 'Planilla', 'Otros']);
      const montoNumerico = Number(monto);
      const fechaGasto = fecha == null || fecha === '' ? new Date().toISOString() : String(fecha);
      if (!categoriasPermitidas.has(String(categoria || '')) || !Number.isFinite(montoNumerico) || montoNumerico <= 0 || !String(descripcion || '').trim() || Number.isNaN(Date.parse(fechaGasto))) {
        return res.status(400).json({ error: "Datos de gasto inválidos" });
      }
      if (!['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'].includes(String(medioPago))) return res.status(400).json({ error: 'Medio de pago inválido.' });
      const autor = String((req as any).usuario?.id || '');
      if (!autor) return res.status(401).json({ error: 'Se requiere una sesión válida para registrar gastos' });
      const roles = [(req as any).usuario?.role, ...((req as any).usuario?.roles || [])].filter(Boolean);
      if (roles.includes('Comercial') && !guiaId) return res.status(400).json({ error: 'El gasto del vendedor debe asociarse a su guía de ruta activa.' });
      if (guiaId) {
        const guiaGasto = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, String(guiaId)) });
        if (!guiaGasto) return res.status(404).json({ error: 'Guía asociada al gasto no encontrada.' });
        if (guiaGasto.finDiaFecha || ['Cerrada', 'CerradaConDiferencia', 'Anulada'].includes(guiaGasto.estado)) return res.status(409).json({ error: 'La guía ya cerró; no se pueden agregar gastos a su caja.' });
        if (!roles.includes('Admin')) {
          const camion = guiaGasto.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guiaGasto.camionId) }) : null;
          if (!camion || (camion.camioneroId || camion.vendedor_id) !== autor || (guiaGasto.vendedorId && guiaGasto.vendedorId !== autor)) return res.status(403).json({ error: 'Solo puede registrar gastos en la guía activa de su camión.' });
        }
      }
      if (comprobante && (typeof comprobante !== 'string' || comprobante.length > 800_000 || !/^data:image\/(jpeg|png|webp);base64,/.test(comprobante))) return res.status(400).json({ error: 'El comprobante debe ser una imagen JPG, PNG o WebP de hasta 600 KB.' });
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
      const gastoId = id || crypto.randomUUID();
      await db.transaction(async (tx: any) => {
        await tx.insert(gastos).values({
          id: gastoId, fecha: fechaGasto, categoria, monto: Math.round(montoNumerico * 100) / 100,
          descripcion: String(descripcion).trim(), usuarioId: autor, idempotencyKey,
          guiaId: guiaId ? String(guiaId) : null, medioPago: String(medioPago),
        });
        if (guiaId && !roles.includes('Admin')) await tx.insert(aprobaciones).values({
          id: crypto.randomUUID(), tipo: 'GastoRuta', modulo: 'Finanzas', referenciaId: gastoId,
          solicitudUsuario: autor, descripcion: `Gasto ${categoria} por ₡${Math.round(montoNumerico).toLocaleString('es-CR')}`,
          datos: JSON.stringify({ guiaId: guiaId || null, comprobante, revisionEstado: 'Pendiente' }),
          estado: 'Pendiente', fechaSolicitud: new Date().toISOString(),
        });
      });
      
      res.status(200).json({ success: true, repetido: false, gastoId, message: 'Gasto registrado y enviado a revisión' });
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
      const [data, usuarios, guias, revisiones, rutasData] = await Promise.all([
        db.query.gastos.findMany(), db.query.users.findMany(), db.query.guias_despacho.findMany(), db.query.aprobaciones.findMany(), db.query.rutas.findMany(),
      ]);
      const usersById = new Map(usuarios.map((u: any) => [u.id, u]));
      const guiasById = new Map(guias.map((g: any) => [g.id, g]));
      const revisionsById = new Map(revisiones.filter((a: any) => a.tipo === 'GastoRuta').map((a: any) => [a.referenciaId, a]));
      const rutasById = new Map(rutasData.map((r: any) => [r.id, r]));
      res.json(data.map((g: any) => {
        const revision: any = revisionsById.get(g.id);
        const datos = revision?.datos ? JSON.parse(revision.datos) : {};
        const guia: any = guiasById.get(g.guiaId);
        const ruta: any = guia?.rutaId ? rutasById.get(guia.rutaId) : null;
        const usuario: any = usersById.get(g.usuarioId);
        return { ...g, vendedorNombre: usuario?.name || usuario?.nombre || 'Usuario', guiaConsecutivo: guia?.consecutivo || null, rutaId: guia?.rutaId || null, rutaNombre: ruta?.nombre || 'Ruta asignada', estadoRevision: revision ? (revision.estado === 'Aprobado' ? 'Aprobado' : datos.revisionEstado || 'Pendiente') : 'Sin revisión', motivoRevision: datos.motivoRevision || revision?.motivoRechazo || null, comprobante: datos.comprobante || null, revisionId: revision?.id || null };
      }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/gastos/guia/:guiaId', requirePermission(['gastos_ruta', 'finanzas'], 'create'), async (req, res) => {
    try {
      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, req.params.guiaId) });
      if (!guia) return res.status(404).json({ error: 'Guía no encontrada.' });
      const usuarioId = String((req as any).usuario?.id || '');
      const roles = [(req as any).usuario?.role, ...((req as any).usuario?.roles || [])].filter(Boolean);
      if (!roles.includes('Admin')) {
        const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
        if (!camion || (camion.camioneroId || camion.vendedor_id) !== usuarioId) return res.status(403).json({ error: 'Solo puede consultar los gastos de su guía.' });
      }
      const [data, revisiones] = await Promise.all([
        db.query.gastos.findMany({ where: eq(gastos.guiaId, guia.id) }),
        db.query.aprobaciones.findMany(),
      ]);
      const revisionsById = new Map(revisiones.filter((a: any) => a.tipo === 'GastoRuta').map((a: any) => [a.referenciaId, a]));
      res.json(data.map((g: any) => {
        const revision: any = revisionsById.get(g.id); const datos = revision?.datos ? JSON.parse(revision.datos) : {};
        return { ...g, estadoRevision: revision ? (revision.estado === 'Aprobado' ? 'Aprobado' : datos.revisionEstado || 'Pendiente') : 'Sin revisión', motivoRevision: datos.motivoRevision || null };
      }));
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudieron cargar los gastos de ruta.' }); }
  });

  app.put('/api/gastos/:id/revision', requirePermission('finanzas', 'approve'), async (req, res) => {
    try {
      const gasto = await db.query.gastos.findFirst({ where: eq(gastos.id, req.params.id) });
      if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado.' });
      const revision = await db.query.aprobaciones.findFirst({ where: eq(aprobaciones.referenciaId, gasto.id) });
      if (!revision || revision.tipo !== 'GastoRuta') return res.status(404).json({ error: 'No se encontró la revisión de este gasto.' });
      const usuarioId = String((req as any).usuario?.id || '');
      if (revision.solicitudUsuario === usuarioId) return res.status(403).json({ error: 'Quien registró el gasto no puede revisarlo.' });
      const { estado, motivo } = req.body || {};
      if (!['Aprobado', 'Observado'].includes(estado)) return res.status(400).json({ error: 'Estado de revisión inválido.' });
      const prev = JSON.parse(revision.datos || '{}');
      if (estado === 'Observado') {
        if (!String(motivo || '').trim()) return res.status(400).json({ error: 'Escriba el motivo de la observación.' });
        await db.update(aprobaciones).set({ datos: JSON.stringify({ ...prev, revisionEstado: 'Observado', motivoRevision: String(motivo).trim(), revisadoPor: usuarioId, fechaRevision: new Date().toISOString() }) }).where(eq(aprobaciones.id, revision.id));
      } else {
        if (revision.estado !== 'Pendiente') return res.status(409).json({ error: 'Este gasto ya fue aprobado.' });
        await db.update(aprobaciones).set({ estado: 'Aprobado', aprobadoPor: usuarioId, fechaResolucion: new Date().toISOString(), datos: JSON.stringify({ ...prev, revisionEstado: 'Aprobado', revisadoPor: usuarioId, fechaRevision: new Date().toISOString() }) }).where(eq(aprobaciones.id, revision.id));
      }
      res.json({ success: true, estadoRevision: estado });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo revisar el gasto.' }); }
  });

}
