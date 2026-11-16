import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { productoCatalogoPara } from '../../lib/kilos';

/** Registra salud avícola, alimento, mantenimiento de activos y desperdicio. */
export function registrarRutasActivosGranja(app: any, db: any, requirePermission?: (...args: any[]) => any, logAudit?: (...args: any[]) => Promise<void>) {
  const { vacunaciones, inventario_alimento, consumo_alimento, activos_mantenimiento, ordenes_mantenimiento, desperdicios } = schema;
  // ==================== VACUNACIONES / SALUD AVÍCOLA ====================

  app.get("/api/vacunaciones", requirePermission ? requirePermission(['produccion', 'dashboard'], 'view') : undefined, async (req, res) => {
    try {
      const data = await db.query.vacunaciones.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/vacunaciones", requirePermission ? requirePermission('produccion', 'create') : undefined, async (req, res) => {
    try {
      const { granjaId, galeronId, loteId, tipoVacuna, proveedor, dosis, metodoAplicacion, fechaProgramada, responsable, observaciones } = req.body;
      if (!granjaId || !tipoVacuna || !fechaProgramada || !responsable) {
        return res.status(400).json({ error: "Faltan datos requeridos de vacunación" });
      }
      const id = crypto.randomUUID();
      await db.insert(vacunaciones).values({
        id, granjaId, galeronId: galeronId || null, loteId: loteId || null,
        tipoVacuna, proveedor: proveedor || null, dosis: dosis || null,
        metodoAplicacion: metodoAplicacion || null, fechaProgramada,
        responsable, estado: 'Programada', observaciones: observaciones || null,
        fechaCreacion: new Date().toISOString()
      });
      await logAudit?.((req as any).usuario?.id, 'Programar', 'Vacunacion', id, null, { granjaId, galeronId: galeronId || null, loteId: loteId || null, tipoVacuna, fechaProgramada, responsable });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.put("/api/vacunaciones/:id", requirePermission ? requirePermission('produccion', 'create') : undefined, async (req, res) => {
    try {
      const { id } = req.params;
      const existente = await db.query.vacunaciones.findFirst({ where: eq(vacunaciones.id, id) });
      if (!existente) return res.status(404).json({ error: "Vacunación no encontrada" });
      const { estado, fechaAplicada, reaccionIncidencia, proximaFecha, evidencia } = req.body;
      const updateData: any = {};
      if (estado) updateData.estado = estado;
      if (fechaAplicada) updateData.fechaAplicada = fechaAplicada;
      if (reaccionIncidencia) updateData.reaccionIncidencia = reaccionIncidencia;
      if (proximaFecha) updateData.proximaFecha = proximaFecha;
      if (evidencia) updateData.evidencia = evidencia;
      await db.update(vacunaciones).set(updateData).where(eq(vacunaciones.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/vacunaciones/alertas", requirePermission ? requirePermission(['produccion', 'dashboard'], 'view') : undefined, async (req, res) => {
    try {
      const todas = await db.query.vacunaciones.findMany();
      const hoy = new Date().toISOString().split('T')[0];
      const proximas = todas.filter(v => v.estado === 'Programada' && v.fechaProgramada <= hoy);
      const vencidas = todas.filter(v => v.estado === 'Programada' && v.fechaProgramada < hoy);
      res.json({ proximas, vencidas, totalProgramadas: todas.filter(v => v.estado === 'Programada').length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== ALIMENTO / SILOS ====================

  app.get("/api/alimento", requirePermission ? requirePermission(['produccion', 'inventario_bodega'], 'view') : undefined, async (req, res) => {
    try {
      const data = await db.query.inventario_alimento.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/alimento", requirePermission ? requirePermission('produccion', 'create') : undefined, async (req, res) => {
    try {
      const { tipoAlimento, proveedor, loteAlimento, siloUbicacion, cantidadRecibida, unidad, galeronAsociado, loteAvesAsociado, responsable } = req.body;
      if (!tipoAlimento || !cantidadRecibida || !responsable) {
        return res.status(400).json({ error: "Faltan datos requeridos de alimento" });
      }
      const id = crypto.randomUUID();
      await db.insert(inventario_alimento).values({
        id, tipoAlimento, proveedor: proveedor || null, loteAlimento: loteAlimento || null,
        siloUbicacion: siloUbicacion || null, cantidadRecibida: Number(cantidadRecibida),
        cantidadActual: Number(cantidadRecibida), unidad: unidad || 'kg',
        galeronAsociado: galeronAsociado || null, loteAvesAsociado: loteAvesAsociado || null,
        fechaIngreso: new Date().toISOString(), responsable, merma: 0, estado: 'Activo'
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/alimento/consumo", requirePermission ? requirePermission('produccion', 'create') : undefined, async (req, res) => {
    try {
      const { inventarioAlimentoId, galeronId, loteAvesId, cantidadConsumida, unidad, responsable, observaciones } = req.body;
      if (!cantidadConsumida || !responsable) {
        return res.status(400).json({ error: "Faltan datos de consumo" });
      }
      await db.transaction(async (tx) => {
        const id = crypto.randomUUID();
        await tx.insert(consumo_alimento).values({
          id, inventarioAlimentoId: inventarioAlimentoId || null,
          galeronId: galeronId || null, loteAvesId: loteAvesId || null,
          cantidadConsumida: Number(cantidadConsumida), unidad: unidad || 'kg',
          fecha: new Date().toISOString(), responsable, observaciones: observaciones || null
        });
        if (inventarioAlimentoId) {
          const inv = await tx.query.inventario_alimento.findFirst({ where: eq(inventario_alimento.id, inventarioAlimentoId) });
          if (inv) {
            await tx.update(inventario_alimento).set({ cantidadActual: inv.cantidadActual - Number(cantidadConsumida) }).where(eq(inventario_alimento.id, inventarioAlimentoId));
          }
        }
      });
      res.status(201).json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/alimento/consumo", requirePermission ? requirePermission(['produccion', 'dashboard'], 'view') : undefined, async (req, res) => {
    try {
      const data = await db.query.consumo_alimento.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/alimento/alertas", requirePermission ? requirePermission(['produccion', 'dashboard'], 'view') : undefined, async (req, res) => {
    try {
      const data = await db.query.inventario_alimento.findMany();
      const bajoInventario = data.filter(i => i.cantidadActual < i.cantidadRecibida * 0.2 && i.estado === 'Activo');
      res.json({ bajoInventario, totalSilos: data.length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== MANTENIMIENTO MEJORADO ====================

  app.get("/api/activos", requirePermission ? requirePermission('granjas_admin', 'view') : undefined, async (req, res) => {
    try {
      const data = await db.query.activos_mantenimiento.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/activos", requirePermission ? requirePermission('granjas_admin', 'create') : undefined, async (req, res) => {
    try {
      const { nombre, tipo, granjaId, galeronId, ubicacion, responsable } = req.body;
      if (!nombre || !tipo) return res.status(400).json({ error: "Faltan datos del activo" });
      const id = crypto.randomUUID();
      await db.insert(activos_mantenimiento).values({
        id, nombre, tipo, granjaId: granjaId || null, galeronId: galeronId || null,
        ubicacion: ubicacion || null, estado: 'Operativo', responsable: responsable || null
      });
      if (logAudit) await logAudit(req.usuario?.id || 'demo', 'crear', 'activos_mantenimiento', id, null, { nombre, tipo, granjaId, galeronId, ubicacion, responsable });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.put("/api/activos/:id", requirePermission ? requirePermission('granjas_admin', 'create') : undefined, async (req, res) => {
    try {
      const { id } = req.params;
      const existente = await db.query.activos_mantenimiento.findFirst({ where: eq(activos_mantenimiento.id, id) });
      if (!existente) return res.status(404).json({ error: 'Activo no encontrado' });
      const { nombre, tipo, granjaId, galeronId, ubicacion, responsable, estado } = req.body;
      const estadosPermitidos = ['Operativo', 'En Mantenimiento', 'Inactivo'];
      if (estado !== undefined && !estadosPermitidos.includes(estado)) return res.status(400).json({ error: 'Estado de activo inválido' });
      const cambios: any = {};
      if (nombre !== undefined) cambios.nombre = String(nombre).trim();
      if (tipo !== undefined) cambios.tipo = String(tipo).trim();
      if (granjaId !== undefined) cambios.granjaId = granjaId || null;
      if (galeronId !== undefined) cambios.galeronId = galeronId || null;
      if (ubicacion !== undefined) cambios.ubicacion = ubicacion || null;
      if (responsable !== undefined) cambios.responsable = responsable || null;
      if (estado !== undefined) cambios.estado = estado;
      if (cambios.nombre === '') return res.status(400).json({ error: 'El nombre es obligatorio' });
      await db.update(activos_mantenimiento).set(cambios).where(eq(activos_mantenimiento.id, id));
      if (logAudit) await logAudit(req.usuario?.id || 'demo', estado === 'Inactivo' ? 'archivar' : 'actualizar', 'activos_mantenimiento', id, existente, cambios);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/ordenes-mantenimiento", requirePermission ? requirePermission('granjas_admin', 'view') : undefined, async (req, res) => {
    try {
      const data = await db.query.ordenes_mantenimiento.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  /**
   * `insumosUsados` y `checklist` son columnas TEXT que guardan JSON (el esquema lo
   * dice en el comentario), pero se insertaban tal cual venían. Si el cliente manda
   * el array que la columna describe —`[{ item, ok }]`— el bind lo convertía a
   * `"[object Object]"` y la consulta fallaba con un 500 que no tenía nada que ver
   * con el mantenimiento. Aquí se normaliza: array → texto JSON, texto → texto.
   *
   * Devuelve `null` para lo que no viene, para no pisar con un `"null"` en
   * texto lo que el `|| null` de antes dejaba en NULL.
   */
  const comoJson = (valor: unknown): string | null => {
    if (valor === undefined || valor === null) return null;
    if (typeof valor === 'string') return valor;
    return JSON.stringify(valor);
  };

  /**
   * Lo que `comoJson` sabe guardar sin dejar basura: texto, o el array que la
   * columna describe. Un objeto suelto o un número también se serializarían sin
   * quejarse, pero no hay código que los vuelva a leer, así que se rechazan con
   * 400 en vez de quedar guardados como texto que nadie puede interpretar.
   */
  const jsonValido = (valor: unknown): boolean =>
    valor === undefined || valor === null || typeof valor === 'string' || Array.isArray(valor);

  app.post("/api/ordenes-mantenimiento", requirePermission ? requirePermission('produccion', 'create') : undefined, async (req, res) => {
    try {
      const { activoId, tipo, fechaProgramada, responsable, insumosUsados, costo, observaciones, checklist } = req.body;
      if (!activoId || !tipo || !fechaProgramada || !responsable) {
        return res.status(400).json({ error: "Faltan datos de orden de mantenimiento" });
      }
      if (!jsonValido(insumosUsados) || !jsonValido(checklist)) {
        return res.status(400).json({ error: "insumosUsados y checklist deben ser un array o un texto" });
      }
      const id = crypto.randomUUID();
      await db.insert(ordenes_mantenimiento).values({
        id, activoId, tipo, fechaProgramada, responsable, estado: 'Pendiente',
        insumosUsados: comoJson(insumosUsados), costo: Number(costo) || 0,
        observaciones: observaciones || null, checklist: comoJson(checklist)
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.put("/api/ordenes-mantenimiento/:id", requirePermission ? requirePermission('produccion', 'create') : undefined, async (req, res) => {
    try {
      const { id } = req.params;
      const existente = await db.query.ordenes_mantenimiento.findFirst({ where: eq(ordenes_mantenimiento.id, id) });
      if (!existente) return res.status(404).json({ error: "Orden de mantenimiento no encontrada" });
      const { estado, fechaEjecutada, costo, observaciones, proximaFecha, insumosUsados } = req.body;
      if (!jsonValido(insumosUsados)) {
        return res.status(400).json({ error: "insumosUsados debe ser un array o un texto" });
      }
      const updateData: any = {};
      if (estado) updateData.estado = estado;
      if (fechaEjecutada) updateData.fechaEjecutada = fechaEjecutada;
      if (costo !== undefined) updateData.costo = Number(costo);
      if (observaciones) updateData.observaciones = observaciones;
      if (proximaFecha) updateData.proximaFecha = proximaFecha;
      if (insumosUsados !== undefined) updateData.insumosUsados = comoJson(insumosUsados);
      await db.update(ordenes_mantenimiento).set(updateData).where(eq(ordenes_mantenimiento.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/ordenes-mantenimiento/alertas", requirePermission ? requirePermission(['granjas_admin', 'dashboard'], 'view') : undefined, async (req, res) => {
    try {
      const todas = await db.query.ordenes_mantenimiento.findMany();
      const hoy = new Date().toISOString().split('T')[0];
      const vencidas = todas.filter(o => o.estado === 'Pendiente' && o.fechaProgramada < hoy);
      const proximas = todas.filter(o => o.estado === 'Pendiente' && o.fechaProgramada >= hoy && o.fechaProgramada <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);
      res.json({ vencidas, proximas, totalPendientes: todas.filter(o => o.estado === 'Pendiente').length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== DESPERDICIO / MERMA ====================

  app.get("/api/desperdicios", requirePermission ? requirePermission(['desperdicios', 'reportes'], 'view') : undefined, async (req, res) => {
    try {
      const data = await db.query.desperdicios.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/desperdicios", requirePermission ? requirePermission('desperdicios', 'create') : undefined, async (req, res) => {
    try {
      const { origen, producto, etiquetaId, lote, cantidad, unidad = 'cartones', peso, motivo, responsable, evidencia, aprobacion, impactoFinanciero, observaciones, rutaId, guiaId, camionId, vendedorId } = req.body;
      const cantidadOriginal = Number(cantidad);
      if (!origen || !producto || !Number.isFinite(cantidadOriginal) || cantidadOriginal <= 0 || !motivo || !responsable) {
        return res.status(400).json({ error: "Faltan datos del desperdicio" });
      }
      if (guiaId && ['Ruta', 'Camion', 'Camión'].includes(String(origen))) {
        return res.status(409).json({ error: 'La merma de ruta debe registrarse con guía y etiqueta en /api/logistica/merma para descontar la custodia correctamente.' });
      }
      if (!['cartones', 'kg'].includes(String(unidad))) return res.status(400).json({ error: 'La unidad de merma debe ser cartones o kg' });
      let factorKgPorCarton: number | null = null;
      let cantidadCartones: number | null = unidad === 'cartones' ? cantidadOriginal : null;
      if (unidad === 'kg') {
        const catalogo = await db.query.productosCatalogo.findMany();
        const item = productoCatalogoPara(producto, catalogo);
        const factor = item?.unidad === 'cartones' ? Number(item.kgPorCarton) : 0;
        if (Number.isFinite(factor) && factor > 0) {
          factorKgPorCarton = factor;
          cantidadCartones = cantidadOriginal / factor;
        }
      }
      const id = crypto.randomUUID();
      await db.insert(desperdicios).values({
        id, origen, producto, etiquetaId: etiquetaId || null, lote: lote || null,
        cantidad: cantidadOriginal, unidad, factorKgPorCarton, cantidadCartones, peso: peso ? Number(peso) : null,
        motivo, responsable, evidencia: evidencia || null, aprobacion: aprobacion || null,
        impactoFinanciero: Number(impactoFinanciero) || 0,
        fecha: new Date().toISOString(), observaciones: observaciones || null,
        rutaId: rutaId || null, guiaId: guiaId || null, camionId: camionId || null, vendedorId: vendedorId || null
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/desperdicios/resumen", requirePermission ? requirePermission(['desperdicios', 'reportes'], 'view') : undefined, async (req, res) => {
    try {
      // Ventana de la última jornada (7 días): hoy más los últimos 6 días
      const inicioHoy = new Date(new Date().toISOString().split('T')[0]).getTime();
      const hace7Dias = new Date(inicioHoy - 6 * 24 * 60 * 60 * 1000).toISOString();
      const ventanaData = await db.query.desperdicios.findMany({ where: gte(desperdicios.fecha, hace7Dias) });
      const porOrigen = ventanaData.reduce((acc, d) => {
        acc[d.origen] = (acc[d.origen] || 0) + d.cantidad;
        return acc;
      }, {} as Record<string, number>);
      const impactoTotal = ventanaData.reduce((acc, d) => acc + Number(d.impactoFinanciero), 0);
      res.json({ porOrigen, impactoTotal, totalRegistros: ventanaData.length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/desperdicios/patrones", requirePermission ? requirePermission(['desperdicios', 'reportes'], 'view') : undefined, async (req, res) => {
    try {
      const fechaInicio = req.query.fechaInicio as string;
      const fechaFin = req.query.fechaFin as string;
      const filtrosFecha = [] as any[];
      if (fechaInicio) filtrosFecha.push(gte(desperdicios.fecha, fechaInicio));
      if (fechaFin) filtrosFecha.push(lte(desperdicios.fecha, /^\d{4}-\d{2}-\d{2}$/.test(fechaFin) ? `${fechaFin}T23:59:59.999Z` : fechaFin));
      const guiasData = await db.query.guias_despacho.findMany(filtrosFecha.length ? { where: and(...[
        ...(fechaInicio ? [gte(schema.guias_despacho.fecha, fechaInicio)] : []),
        ...(fechaFin ? [lte(schema.guias_despacho.fecha, /^\d{4}-\d{2}-\d{2}$/.test(fechaFin) ? `${fechaFin}T23:59:59.999Z` : fechaFin)] : []),
      ]) } : {});
      const idsGuias = guiasData.map((g: any) => g.id);
      const [todos, usersData, rutasData, camionesData, ventasData] = await Promise.all([
        db.query.desperdicios.findMany(filtrosFecha.length ? { where: and(...filtrosFecha) } : {}),
        db.query.users.findMany(),
        db.query.rutas.findMany(),
        db.query.camiones.findMany(),
        idsGuias.length ? db.query.ventas_ruta.findMany({ where: inArray(schema.ventas_ruta.guiaId, idsGuias) }).catch(() => []) : Promise.resolve([]),
      ]);

      const filtrados = todos;
      const usuariosPorId = new Map<string, any>(usersData.map((u: any) => [u.id, u]));
      const rutasPorId = new Map<string, any>(rutasData.map((r: any) => [r.id, r]));
      const camionesPorId = new Map<string, any>(camionesData.map((c: any) => [c.id, c]));
      const guiasPorId = new Map<string, any>(guiasData.map((g: any) => [g.id, g]));
      const ventasPorGuia = new Map<string, any[]>();
      for (const venta of ventasData as any[]) {
        if (!venta.guiaId) continue;
        const grupo = ventasPorGuia.get(venta.guiaId);
        if (grupo) grupo.push(venta); else ventasPorGuia.set(venta.guiaId, [venta]);
      }

      const userName = (id: string | null | undefined) => {
        if (!id) return 'Sin asignar';
        const u = usuariosPorId.get(id);
        return u ? u.name : id;
      };
      const rutaNombre = (id: string | null | undefined) => {
        if (!id) return 'Sin ruta';
        const r = rutasPorId.get(id);
        return r ? r.nombre : id;
      };
      const camionNombre = (id: string | null | undefined) => {
        if (!id) return null;
        const c = camionesPorId.get(id);
        return c ? c.nombre : null;
      };

      // Mapa guía → ruta/vendedor (para registrar histórico que no trae los campos)
      const withRuta = filtrados.map((d: any) => ({
        ...d,
        rutaId: d.rutaId || d.guiaId ? guiasPorId.get(d.guiaId)?.rutaId || null : null
      }));

      // Ranking por ruta
      const porRutaAcc: Record<string, any> = {};
      for (const d of withRuta) {
        const key = d.rutaId || 'SIN_RUTA';
        if (!porRutaAcc[key]) porRutaAcc[key] = { rutaId: d.rutaId || null, ruta: rutaNombre(d.rutaId), cartones: 0, impacto: 0, registros: 0, motivos: {} as Record<string, number>, vendedores: new Set<string>(), camiones: new Set<string>() };
        const item = porRutaAcc[key];
        item.cartones += Number(d.cantidad);
        item.impacto += Number(d.impactoFinanciero);
        item.registros += 1;
        item.motivos[d.motivo] = (item.motivos[d.motivo] || 0) + Number(d.cantidad);
        if (d.vendedorId) item.vendedores.add(userName(d.vendedorId));
        const cn = camionNombre(d.camionId);
        if (cn) item.camiones.add(cn);
      }
      // Complementar vendedores reales de la ruta desde las ventas (guía → ruta)
      for (const guia of guiasData as any[]) {
        const rutaKey = guia.rutaId || 'SIN_RUTA';
        if (!porRutaAcc[rutaKey]) {
          porRutaAcc[rutaKey] = { rutaId: guia.rutaId || null, ruta: rutaNombre(guia.rutaId), cartones: 0, impacto: 0, registros: 0, motivos: {}, vendedores: new Set<string>(), camiones: new Set<string>() };
        }
        for (const v of ventasPorGuia.get(guia.id) || []) {
          if (v.estado === 'Anulada') continue;
          if (v.vendedorId) porRutaAcc[rutaKey].vendedores.add(userName(v.vendedorId));
        }
      }
      const porRuta = Object.values(porRutaAcc)
        .map((x: any) => ({
          rutaId: x.rutaId, ruta: x.ruta,
          cartones: x.cartones, impacto: x.impacto, registros: x.registros,
          motivoTop: Object.entries(x.motivos).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] || null,
          vendedores: [...x.vendedores].sort(),
          camiones: [...x.camiones].sort()
        }))
        .filter(x => x.cartones > 0)
        .sort((a, b) => b.cartones - a.cartones);

      // Ranking por vendedor
      const porVendedorAcc: Record<string, any> = {};
      for (const d of withRuta) {
        const key = d.vendedorId || 'SIN_VENDEDOR';
        if (!porVendedorAcc[key]) porVendedorAcc[key] = { vendedorId: d.vendedorId || null, vendedor: userName(d.vendedorId), cartones: 0, impacto: 0, registros: 0, rutas: new Set<string>() };
        const item = porVendedorAcc[key];
        item.cartones += Number(d.cantidad);
        item.impacto += Number(d.impactoFinanciero);
        item.registros += 1;
        item.rutas.add(rutaNombre(d.rutaId));
      }
      const porVendedor = Object.values(porVendedorAcc)
        .map((x: any) => ({ vendedorId: x.vendedorId, vendedor: x.vendedor, cartones: x.cartones, impacto: x.impacto, registros: x.registros, rutas: [...x.rutas].sort() }))
        .filter(x => x.cartones > 0)
        .sort((a, b) => b.cartones - a.cartones);

      // Por producto
      const porProductoAcc: Record<string, any> = {};
      for (const d of filtrados) {
        if (!porProductoAcc[d.producto]) porProductoAcc[d.producto] = { producto: d.producto, cartones: 0, impacto: 0, registros: 0 };
        porProductoAcc[d.producto].cartones += Number(d.cantidad);
        porProductoAcc[d.producto].impacto += Number(d.impactoFinanciero);
        porProductoAcc[d.producto].registros += 1;
      }
      const porProducto = Object.values(porProductoAcc).sort((a, b) => b.cartones - a.cartones);

      // Por motivo
      const porMotivoAcc: Record<string, any> = {};
      for (const d of filtrados) {
        if (!porMotivoAcc[d.motivo]) porMotivoAcc[d.motivo] = { motivo: d.motivo, cartones: 0, impacto: 0, registros: 0 };
        porMotivoAcc[d.motivo].cartones += Number(d.cantidad);
        porMotivoAcc[d.motivo].impacto += Number(d.impactoFinanciero);
        porMotivoAcc[d.motivo].registros += 1;
      }
      const porMotivo = Object.values(porMotivoAcc).sort((a, b) => b.cartones - a.cartones);

      // Tendencia diaria
      const tendenciaAcc: Record<string, any> = {};
      for (const d of filtrados) {
        const dia = String(d.fecha).slice(0, 10);
        if (!tendenciaAcc[dia]) tendenciaAcc[dia] = { fecha: dia, cartones: 0, impacto: 0, registros: 0 };
        tendenciaAcc[dia].cartones += Number(d.cantidad);
        tendenciaAcc[dia].impacto += Number(d.impactoFinanciero);
        tendenciaAcc[dia].registros += 1;
      }
      const tendencia = Object.values(tendenciaAcc).sort((a: any, b: any) => (a.fecha < b.fecha ? -1 : 1));

      res.json({
        rango: { fechaInicio: fechaInicio || null, fechaFin: fechaFin || null },
        totales: {
          cartones: filtrados.reduce((a, d) => a + Number(d.cantidad), 0),
          impacto: filtrados.reduce((a, d) => a + Number(d.impactoFinanciero), 0),
          registros: filtrados.length
        },
        porRuta, porVendedor, porProducto, porMotivo, tendencia
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

}
