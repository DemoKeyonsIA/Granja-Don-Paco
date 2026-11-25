import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";

export function registrarRutasGastos(app: any, db: any, requirePermission: any) {
  const { gastos, guias_despacho, camiones, users, aprobaciones, rutas } = schema;
  app.post("/api/gastos", requirePermission(['gastos_ruta', 'finanzas'], 'create'), async (req, res) => {
    try {
      const { id, fecha, categoria, monto, descripcion, guiaId = null, medioPago = 'Efectivo', comprobante = null, insumo = null } = req.body;
      const rawKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
      const idempotencyKey = rawKey == null ? null : String(rawKey).trim();
      if (idempotencyKey !== null && (!idempotencyKey || idempotencyKey.length > 160)) {
        return res.status(400).json({ error: 'Idempotency-Key debe tener entre 1 y 160 caracteres' });
      }
      const categoriasAdmin = ['Diésel', 'Diesel', 'Hospedaje', 'Dieta', 'Dietas', 'Viáticos', 'Mantenimiento', 'Insumos', 'Planilla', 'Otros'];
      const categoriasVendedor = ['Diésel', 'Diesel', 'Hospedaje', 'Dieta', 'Dietas', 'Otros'];
      const roles = [(req as any).usuario?.role, ...((req as any).usuario?.roles || [])].filter(Boolean);
      const esAdmin = roles.includes('Admin');
      const esVendedor = roles.includes('Comercial') && !esAdmin;
      if (categoria === 'Insumos' && !esAdmin) return res.status(403).json({ error: 'Solo Administración puede registrar compras de insumos.' });
      if (categoria === 'Insumos' && (!insumo || !String(insumo.producto || '').trim() || !Number.isFinite(Number(insumo.cantidad)) || Number(insumo.cantidad) <= 0 || !String(insumo.unidad || '').trim())) return res.status(400).json({ error: 'Para una compra de insumos indique producto, cantidad y unidad.' });
      if (categoria === 'Insumos' && !['Cartones', 'Alimento', 'Empaques', 'Otros'].includes(String(insumo.tipo || 'Otros'))) return res.status(400).json({ error: 'Tipo de insumo inválido.' });
      if (categoria === 'Insumos' && String(insumo.tipo) === 'Cartones') {
        const factor = Number(insumo.kgPorUnidad); const productoHuevo = String(insumo.productoHuevo || '').trim();
        if (String(insumo.unidad) !== 'cartones' || !productoHuevo || !Number.isFinite(factor) || factor <= 0) return res.status(400).json({ error: 'Para cartones use la unidad cartones, asócielos a un producto de huevo y configure kg por cartón.' });
        const productoCatalogo = await db.query.productosCatalogo.findFirst({ where: eq(schema.productosCatalogo.nombre, productoHuevo) });
        if (!productoCatalogo || productoCatalogo.estado !== 'Activo' || productoCatalogo.categoria !== 'Huevos') return res.status(400).json({ error: 'Seleccione un producto de huevo activo del catálogo.' });
      }
      const categoriasPermitidas = new Set(esVendedor ? categoriasVendedor : categoriasAdmin);
      const montoNumerico = Number(monto);
      const fechaGasto = fecha == null || fecha === '' ? new Date().toISOString() : String(fecha);
      if (!categoriasPermitidas.has(String(categoria || '')) || !Number.isFinite(montoNumerico) || montoNumerico <= 0 || !String(descripcion || '').trim() || Number.isNaN(Date.parse(fechaGasto))) {
        return res.status(400).json({ error: "Datos de gasto inválidos" });
      }
      if (!['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'].includes(String(medioPago))) return res.status(400).json({ error: 'Medio de pago inválido.' });
      const autor = String((req as any).usuario?.id || '');
      if (!autor) return res.status(401).json({ error: 'Se requiere una sesión válida para registrar gastos' });
      if (esVendedor && !guiaId) return res.status(400).json({ error: 'El gasto del vendedor debe asociarse a su guía de ruta activa.' });
      if (guiaId) {
        const guiaGasto = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, String(guiaId)) });
        if (!guiaGasto) return res.status(404).json({ error: 'Guía asociada al gasto no encontrada.' });
        if (guiaGasto.finDiaFecha || ['Cerrada', 'CerradaConDiferencia', 'Anulada'].includes(guiaGasto.estado)) return res.status(409).json({ error: 'La guía ya cerró; no se pueden agregar gastos a su caja.' });
        if (esVendedor && guiaGasto.estado !== 'EnRuta') return res.status(409).json({ error: 'Solo puede registrar gastos cuando ya inició su ruta.' });
        if (!esAdmin) {
          const camion = guiaGasto.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guiaGasto.camionId) }) : null;
          const camionAsignado = camion && [camion.camioneroId, camion.vendedor_id].some((id: unknown) => String(id || '') === autor);
          if (!camionAsignado || (guiaGasto.vendedorId && String(guiaGasto.vendedorId) !== autor)) return res.status(403).json({ error: 'Solo puede registrar gastos en una guía activa asignada a usted.' });
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
        if (categoria === 'Insumos') {
          const cantidad = Number(insumo.cantidad);
          const kgPorUnidad = insumo.kgPorUnidad == null || insumo.kgPorUnidad === '' ? null : Number(insumo.kgPorUnidad);
          if (kgPorUnidad != null && (!Number.isFinite(kgPorUnidad) || kgPorUnidad <= 0)) throw Object.assign(new Error('El factor kg por unidad debe ser positivo.'), { status: 400 });
          const insumoId = crypto.randomUUID();
          await tx.insert(schema.inventario_insumos).values({
            id: insumoId, producto: String(insumo.producto).trim(), categoria: String(insumo.tipo || 'Otros'),
            cantidadRecibida: cantidad, cantidadActual: cantidad, unidad: String(insumo.unidad),
            ubicacion: String(insumo.ubicacion || 'Bodega'), lote: String(insumo.lote || '').trim() || null,
            proveedor: String(insumo.proveedor || '').trim() || null, gastoId: gastoId,
            montoCompra: Math.round(montoNumerico * 100) / 100,
            productoHuevo: String(insumo.productoHuevo || '').trim() || null, kgPorUnidad,
            creadoPor: autor, creadoEn: new Date().toISOString(),
          });
          await tx.insert(schema.movimientos_insumos).values({ id: crypto.randomUUID(), insumoId, tipo: 'Compra', cantidad, unidad: String(insumo.unidad), referenciaId: gastoId, kgHuevo: null, registradoPor: autor, fecha: new Date().toISOString(), observacion: String(insumo.producto).trim() });
        }
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

  app.get('/api/inventario-insumos', requirePermission('finanzas', 'view'), async (_req, res) => {
    try {
      const rows = await db.query.inventario_insumos.findMany();
      res.json(rows.sort((a: any, b: any) => String(b.creadoEn).localeCompare(String(a.creadoEn))));
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo cargar el inventario de insumos.' }); }
  });

  app.get('/api/inventario-insumos/movimientos', requirePermission('finanzas', 'view'), async (_req, res) => {
    try { const rows = await db.query.movimientos_insumos.findMany(); res.json(rows.sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 300)); }
    catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo cargar el historial de insumos.' }); }
  });

  app.post('/api/inventario-insumos/:id/calibrar', requirePermission('finanzas', 'create'), async (req, res) => {
    try {
      const { kgHuevo, cartonesUsados, observacion } = req.body || {};
      const kg = Number(kgHuevo); const cartones = Number(cartonesUsados);
      if (!Number.isFinite(kg) || kg <= 0 || !Number.isFinite(cartones) || cartones <= 0 || !String(observacion || '').trim()) return res.status(400).json({ error: 'Indique kg vendidos, cartones realmente usados y una nota del conteo.' });
      const item = await db.query.inventario_insumos.findFirst({ where: eq(schema.inventario_insumos.id, String(req.params.id)) });
      if (!item || String(item.categoria).toLowerCase() !== 'cartones') return res.status(404).json({ error: 'No se encontró el insumo de cartones.' });
      const factor = Math.round((kg / cartones) * 10000) / 10000; const autor = String((req as any).usuario?.id || ''); const fecha = new Date().toISOString(); const anterior = Number(item.kgPorUnidad || 0);
      await db.transaction(async (tx: any) => {
        await tx.update(schema.inventario_insumos).set({ kgPorUnidad: factor }).where(eq(schema.inventario_insumos.id, item.id));
        await tx.insert(schema.movimientos_insumos).values({ id: crypto.randomUUID(), insumoId: item.id, tipo: 'Calibración real', cantidad: cartones, unidad: item.unidad, referenciaId: null, kgHuevo: kg, registradoPor: autor, fecha, observacion: `${String(observacion).trim()} · factor anterior ${anterior || 'sin configurar'} kg/cartón; nuevo ${factor} kg/cartón` });
      });
      res.json({ success: true, kgPorUnidad: factor });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo calibrar la conversión.' }); }
  });

  app.post('/api/inventario-insumos', requirePermission('finanzas', 'create'), async (req, res) => {
    try {
      const { producto, categoria = 'Otros', cantidad, unidad, ubicacion = 'Bodega', lote, proveedor, productoHuevo, kgPorUnidad } = req.body || {};
      const cantidadNum = Number(cantidad); const factor = kgPorUnidad == null || kgPorUnidad === '' ? null : Number(kgPorUnidad);
      if (!String(producto || '').trim() || !Number.isFinite(cantidadNum) || cantidadNum <= 0 || !String(unidad || '').trim()) return res.status(400).json({ error: 'Indique producto, cantidad positiva y unidad.' });
      if (!['Cartones', 'Alimento', 'Empaques', 'Otros'].includes(String(categoria))) return res.status(400).json({ error: 'Tipo de insumo inválido.' });
      if (factor != null && (!Number.isFinite(factor) || factor <= 0)) return res.status(400).json({ error: 'El factor kg por unidad debe ser positivo.' });
      if (String(categoria) === 'Cartones') {
        if (String(unidad) !== 'cartones' || !String(productoHuevo || '').trim() || factor == null) return res.status(400).json({ error: 'Para cartones use la unidad cartones, asócielos a un producto de huevo y configure kg por cartón.' });
        const productoCatalogo = await db.query.productosCatalogo.findFirst({ where: eq(schema.productosCatalogo.nombre, String(productoHuevo).trim()) });
        if (!productoCatalogo || productoCatalogo.estado !== 'Activo' || productoCatalogo.categoria !== 'Huevos') return res.status(400).json({ error: 'Seleccione un producto de huevo activo del catálogo.' });
      }
      const id = crypto.randomUUID(); const fecha = new Date().toISOString(); const autor = String((req as any).usuario?.id || '');
      await db.transaction(async (tx: any) => {
        await tx.insert(schema.inventario_insumos).values({ id, producto: String(producto).trim(), categoria: String(categoria), cantidadRecibida: cantidadNum, cantidadActual: cantidadNum, unidad: String(unidad), ubicacion: String(ubicacion).trim(), lote: String(lote || '').trim() || null, proveedor: String(proveedor || '').trim() || null, gastoId: null, montoCompra: null, productoHuevo: String(productoHuevo || '').trim() || null, kgPorUnidad: factor, creadoPor: autor, creadoEn: fecha });
        await tx.insert(schema.movimientos_insumos).values({ id: crypto.randomUUID(), insumoId: id, tipo: 'IngresoManual', cantidad: cantidadNum, unidad: String(unidad), referenciaId: null, kgHuevo: null, registradoPor: autor, fecha, observacion: String(lote || '').trim() || 'Ingreso manual' });
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo registrar la entrada de inventario.' }); }
  });

  app.get("/api/gastos", requirePermission('finanzas', 'view'), async (req, res) => {
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

  app.get('/api/gastos/guia/:guiaId', requirePermission('gastos_ruta', 'view'), async (req, res) => {
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
