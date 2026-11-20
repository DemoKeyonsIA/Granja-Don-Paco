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
      const { tipoAlimento, proveedor, loteAlimento, siloUbicacion, cantidadRecibida, unidad, galeronAsociado, loteAvesAsociado, responsable, referenciaDocumentoOrigen, fechaDocumentoOrigen, montoDocumentoOrigen, monedaDocumentoOrigen } = req.body;
      const cantidad = Number(cantidadRecibida);
      if (!tipoAlimento || !Number.isFinite(cantidad) || cantidad <= 0 || !responsable) {
        return res.status(400).json({ error: "Faltan datos requeridos de alimento" });
      }
      if (!['kg', 'sacos'].includes(String(unidad || 'kg'))) return res.status(400).json({ error: 'La unidad del alimento debe ser kg o sacos.' });
      const hayDatosDocumento = Boolean(referenciaDocumentoOrigen || fechaDocumentoOrigen || (montoDocumentoOrigen !== '' && montoDocumentoOrigen != null) || monedaDocumentoOrigen);
      const montoDocumento = montoDocumentoOrigen === '' || montoDocumentoOrigen == null ? null : Number(montoDocumentoOrigen);
      if (hayDatosDocumento && (!String(referenciaDocumentoOrigen || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(fechaDocumentoOrigen || '')) || !Number.isFinite(montoDocumento) || Number(montoDocumento) < 0 || !/^[A-Z]{3}$/.test(String(monedaDocumentoOrigen || '')))) return res.status(400).json({ error: 'Para guardar el soporte de compra indique referencia, fecha, monto y moneda en el mismo registro.' });
      if (loteAvesAsociado) {
        const lote = await db.query.lotes_aves.findFirst({ where: eq(schema.lotes_aves.id, String(loteAvesAsociado)) });
        if (!lote || (galeronAsociado && lote.galeronId !== galeronAsociado)) return res.status(400).json({ error: 'El lote de aves no corresponde al galerón indicado.' });
      }
      const id = crypto.randomUUID();
      await db.insert(inventario_alimento).values({
        id, tipoAlimento, proveedor: proveedor || null, loteAlimento: loteAlimento || null,
        siloUbicacion: siloUbicacion || null, cantidadRecibida: cantidad,
        cantidadActual: cantidad, unidad: unidad || 'kg',
        galeronAsociado: galeronAsociado || null, loteAvesAsociado: loteAvesAsociado || null,
        fechaIngreso: new Date().toISOString(), responsable,
        referenciaDocumentoOrigen: String(referenciaDocumentoOrigen || '').trim() || null,
        fechaDocumentoOrigen: fechaDocumentoOrigen || null, montoDocumentoOrigen: montoDocumento,
        monedaDocumentoOrigen: String(monedaDocumentoOrigen || '').trim() || null,
        merma: 0, estado: 'Activo'
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/alimento/consumo", requirePermission ? requirePermission('produccion', 'create') : undefined, async (req, res) => {
    try {
      const { inventarioAlimentoId, galeronId, loteAvesId, cantidadConsumida, unidad, responsable, observaciones, tipoMovimiento } = req.body;
      const cantidad = Number(cantidadConsumida);
      if (!inventarioAlimentoId || !Number.isFinite(cantidad) || cantidad <= 0 || !responsable) return res.status(400).json({ error: "Seleccione un lote de alimento, indique una cantidad positiva y el responsable." });
      if (!['Consumo', 'Merma'].includes(String(tipoMovimiento || 'Consumo'))) return res.status(400).json({ error: 'Tipo de movimiento de alimento inválido.' });
      if (tipoMovimiento === 'Merma' && !String(observaciones || '').trim()) return res.status(400).json({ error: 'Describa la causa de la merma para conservar evidencia.' });
      const resultado = await db.transaction(async (tx) => {
        const inv = await tx.query.inventario_alimento.findFirst({ where: eq(inventario_alimento.id, String(inventarioAlimentoId)) });
        if (!inv || inv.estado !== 'Activo') throw Object.assign(new Error('El lote de alimento ya no está activo. Actualice la lista.'), { status: 409 });
        const unidadConsumo = String(unidad || inv.unidad);
        if (unidadConsumo !== inv.unidad) throw Object.assign(new Error(`La unidad de consumo (${unidadConsumo}) no coincide con el inventario (${inv.unidad}).`), { status: 400 });
        if (Number(inv.cantidadActual) + 0.0001 < cantidad) throw Object.assign(new Error(`Stock insuficiente. Disponible: ${Number(inv.cantidadActual).toFixed(3)} ${inv.unidad}.`), { status: 409 });
        if (loteAvesId) {
          const lote = await tx.query.lotes_aves.findFirst({ where: eq(schema.lotes_aves.id, String(loteAvesId)) });
          if (!lote || (galeronId && lote.galeronId !== galeronId)) throw Object.assign(new Error('El lote de aves no corresponde al galerón seleccionado.'), { status: 400 });
        }
        const id = crypto.randomUUID();
        await tx.insert(consumo_alimento).values({
          id, inventarioAlimentoId,
          galeronId: galeronId || null, loteAvesId: loteAvesId || null,
          cantidadConsumida: cantidad, unidad: unidadConsumo,
          fecha: new Date().toISOString(), tipoMovimiento: tipoMovimiento || 'Consumo', responsable, observaciones: observaciones || null
        });
        const saldoNuevo = Math.max(0, Number(inv.cantidadActual) - cantidad);
        await tx.update(inventario_alimento).set({ cantidadActual: saldoNuevo, estado: saldoNuevo <= 0.0001 ? 'Agotado' : 'Activo' }).where(eq(inventario_alimento.id, inventarioAlimentoId));
        return { id, saldoNuevo, unidad: inv.unidad };
      });
      res.status(201).json({ success: true, ...resultado });
    } catch (error: any) { res.status(error?.status || 500).json({ error: error.message }); }
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

  app.get('/api/alimento/f3-integridad', requirePermission ? requirePermission(['produccion', 'granjas_admin'], 'view') : undefined, async (_req, res) => {
    try {
      const [inventarios, consumos, lotes, galerones] = await Promise.all([db.query.inventario_alimento.findMany(), db.query.consumo_alimento.findMany(), db.query.lotes_aves.findMany(), db.query.galerones.findMany()]);
      const consumoPorInventario = new Map<string, number>();
      for (const c of consumos as any[]) if (c.inventarioAlimentoId) consumoPorInventario.set(c.inventarioAlimentoId, (consumoPorInventario.get(c.inventarioAlimentoId) || 0) + Number(c.cantidadConsumida || 0));
      const lotesMap = new Map((lotes as any[]).map(l => [l.id, l])); const galeronesMap = new Map((galerones as any[]).map(g => [g.id, g]));
      const mermaPorInventario = new Map<string, number>();
      for (const c of consumos as any[]) if (c.inventarioAlimentoId && c.tipoMovimiento === 'Merma') mermaPorInventario.set(c.inventarioAlimentoId, (mermaPorInventario.get(c.inventarioAlimentoId) || 0) + Number(c.cantidadConsumida || 0));
      const diferenciasStock = (inventarios as any[]).map(i => { const consumido = consumoPorInventario.get(i.id) || 0; const merma = mermaPorInventario.get(i.id) || 0; const esperado = Number(i.cantidadRecibida) - consumido; const actual = Number(i.cantidadActual); return { id: i.id, tipoAlimento: i.tipoAlimento, loteAlimento: i.loteAlimento || null, ubicacion: i.siloUbicacion || null, unidad: i.unidad, recibido: Number(i.cantidadRecibida), consumoRegistrado: consumido - merma, mermaRegistrada: merma, saldoEsperado: Math.round(esperado * 1000) / 1000, saldoActual: actual, diferencia: Math.round((actual - esperado) * 1000) / 1000, referenciaDocumentoOrigen: i.referenciaDocumentoOrigen || null, fechaDocumentoOrigen: i.fechaDocumentoOrigen || null, montoDocumentoOrigen: i.montoDocumentoOrigen == null ? null : Number(i.montoDocumentoOrigen), monedaDocumentoOrigen: i.monedaDocumentoOrigen || null, estado: Math.abs(actual - esperado) < 0.001 ? 'Conciliado' : 'Revisar' }; });
      const pendientes = (inventarios as any[]).flatMap(i => [{ falta: !i.proveedor ? 'Proveedor no registrado' : null }, { falta: !i.loteAlimento ? 'Lote del proveedor no registrado' : null }, { falta: !i.siloUbicacion ? 'Ubicación/silo no registrado' : null }, { falta: !i.loteAvesAsociado && !i.galeronAsociado ? 'Ingreso no asignado a galerón/lote (puede ser stock común)' : null }, { falta: !i.referenciaDocumentoOrigen || i.montoDocumentoOrigen == null || !i.monedaDocumentoOrigen ? 'Falta capturar el soporte/monto del documento de compra' : null }].filter(x => x.falta).map(x => ({ tipo: i.tipoAlimento, inventarioId: i.id, loteAlimento: i.loteAlimento || null, detalle: x.falta })));
      const consumosSinDimension = (consumos as any[]).filter(c => !c.galeronId || !c.loteAvesId || (c.loteAvesId && !lotesMap.has(c.loteAvesId)) || (c.galeronId && !galeronesMap.has(c.galeronId))).map(c => ({ id: c.id, fecha: c.fecha, cantidad: Number(c.cantidadConsumida), unidad: c.unidad, responsable: c.responsable, galeronId: c.galeronId || null, loteAvesId: c.loteAvesId || null, estado: 'Completar o revisar asignación de granja/lote' }));
      res.json({ generadoEn: new Date().toISOString(), resumen: { lotesAlimento: diferenciasStock.length, saldosConciliados: diferenciasStock.filter(i => i.estado === 'Conciliado').length, saldosConDiferencia: diferenciasStock.filter(i => i.estado !== 'Conciliado').length, ingresosConDatosTrazabilidadPendientes: pendientes.length, consumosSinAsignacionCompleta: consumosSinDimension.length, sinDocumentoCompra: (inventarios as any[]).filter(i => i.montoDocumentoOrigen == null || !i.referenciaDocumentoOrigen || !i.monedaDocumentoOrigen).length }, saldos: diferenciasStock, pendientes, consumosSinDimension, lotesAves: (lotes as any[]).map(l => ({ id: l.id, galeron: galeronesMap.get(l.galeronId)?.nombre || null, lineaGenetica: l.linea_genetica, cantidadInicial: Number(l.cantidad_inicial), fechaIngreso: l.fecha_ingreso, estado: l.estado, nota: 'Saldo operativo; no equivale a conteo vivo ni valoración contable.' })), limitaciones: ['La conciliación reconcilia recibido − consumos − mermas registrados; no contempla transferencias entre silos ni conteos físicos de alimento.', 'El importe de factura se conserva como dato fuente; no se asigna automáticamente como costo de inventario ni de producción.', 'Los lotes y galerones son dimensiones operativas; no representan valoración de activo biológico.'] });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo revisar la integridad de alimento y producción.' }); }
  });

  // Read-only physical counts are retained in the audit log; they never
  // silently overwrite a book/operational quantity.
  app.get('/api/alimento/conteos', requirePermission ? requirePermission(['produccion', 'granjas_admin'], 'view') : undefined, async (_req, res) => {
    try {
      const rows = await db.query.auditoria.findMany({ where: eq(schema.auditoria.modulo, 'ConteoAlimento') });
      res.json((rows as any[]).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map(r => ({ id: r.id, usuarioId: r.usuarioId, fecha: r.fecha, motivo: r.motivo, antes: r.valoresAntes ? JSON.parse(r.valoresAntes) : null, conteo: r.valoresDespues ? JSON.parse(r.valoresDespues) : null })));
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudieron cargar los conteos físicos.' }); }
  });

  app.post('/api/alimento/conteos', requirePermission ? requirePermission('produccion', 'create') : undefined, async (req: any, res: any) => {
    try {
      const { inventarioAlimentoId, cantidadFisica, responsable, observaciones } = req.body || {};
      const cantidad = Number(cantidadFisica);
      if (!inventarioAlimentoId || !Number.isFinite(cantidad) || cantidad < 0 || !String(responsable || '').trim() || !String(observaciones || '').trim()) return res.status(400).json({ error: 'Seleccione un lote, indique una cantidad física válida, responsable y motivo/observación.' });
      const inventory = await db.query.inventario_alimento.findFirst({ where: eq(inventario_alimento.id, String(inventarioAlimentoId)) });
      if (!inventory) return res.status(404).json({ error: 'El lote de alimento ya no existe.' });
      const difference = Math.round((cantidad - Number(inventory.cantidadActual)) * 1000) / 1000;
      const actorId = req.usuario?.id || 'demo';
      const valuesBefore = { inventarioAlimentoId, cantidadSistema: Number(inventory.cantidadActual), unidad: inventory.unidad, loteAlimento: inventory.loteAlimento, ubicacion: inventory.siloUbicacion };
      const valuesAfter = { inventarioAlimentoId, cantidadFisica: cantidad, diferencia: difference, unidad: inventory.unidad, responsable: String(responsable).trim(), usuarioId: actorId, observaciones: String(observaciones).trim(), requiereInvestigacion: Math.abs(difference) > 0.001, nota: 'Conteo observado; no ajusta inventario ni produce asiento contable.' };
      if (logAudit) await logAudit(actorId, 'RegistrarConteoFisico', 'ConteoAlimento', inventory.id, valuesBefore, valuesAfter, valuesAfter.observaciones);
      else await db.insert(schema.auditoria).values({ id: crypto.randomUUID(), usuarioId: actorId, accion: 'RegistrarConteoFisico', modulo: 'ConteoAlimento', referenciaId: inventory.id, valoresAntes: JSON.stringify(valuesBefore), valoresDespues: JSON.stringify(valuesAfter), motivo: valuesAfter.observaciones, fecha: new Date().toISOString() });
      res.status(201).json({ success: true, ...valuesAfter });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo registrar el conteo físico.' }); }
  });

  app.get('/api/alimento/transferencias', requirePermission ? requirePermission(['produccion', 'granjas_admin'], 'view') : undefined, async (_req: any, res: any) => {
    try {
      const rows = await db.query.auditoria.findMany({ where: eq(schema.auditoria.modulo, 'TransferenciaAlimento') });
      res.json((rows as any[]).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map(r => ({ id: r.id, usuarioId: r.usuarioId, fecha: r.fecha, motivo: r.motivo, traslado: r.valoresDespues ? JSON.parse(r.valoresDespues) : null })));
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo cargar el historial de traslados.' }); }
  });

  // A stock lot currently represents one location; this first release moves
  // its full remaining balance and records the before/after snapshot.
  app.post('/api/alimento/transferencias', requirePermission ? requirePermission('produccion', 'create') : undefined, async (req: any, res: any) => {
    try {
      const { inventarioAlimentoId, ubicacionDestino, responsable, observaciones } = req.body || {};
      if (!inventarioAlimentoId || !String(ubicacionDestino || '').trim() || !String(responsable || '').trim()) return res.status(400).json({ error: 'Seleccione el lote y destino, e indique responsable.' });
      const result = await db.transaction(async (tx: any) => {
        const item = await tx.query.inventario_alimento.findFirst({ where: eq(inventario_alimento.id, String(inventarioAlimentoId)) });
        if (!item || item.estado !== 'Activo' || Number(item.cantidadActual) <= 0) throw Object.assign(new Error('El lote no tiene saldo activo para trasladar.'), { status: 409 });
        if (!item.siloUbicacion || String(item.siloUbicacion) === String(ubicacionDestino)) throw Object.assign(new Error('El destino debe ser distinto de la ubicación actual.'), { status: 400 });
        const actorId = req.usuario?.id || 'demo'; const fecha = new Date().toISOString();
        const before = { inventarioAlimentoId: item.id, alimento: item.tipoAlimento, loteAlimento: item.loteAlimento, origen: item.siloUbicacion, saldoTrasladado: Number(item.cantidadActual), unidad: item.unidad };
        const traslado = { ...before, destino: String(ubicacionDestino).trim(), responsable: String(responsable).trim(), usuarioId: actorId, observaciones: String(observaciones || '').trim() || null, fecha, nota: 'Traslado del saldo completo del registro de lote; no cambia la cantidad total ni el valor contable.' };
        const changed = await tx.update(inventario_alimento).set({ siloUbicacion: traslado.destino }).where(and(eq(inventario_alimento.id, item.id), eq(inventario_alimento.siloUbicacion, item.siloUbicacion))).returning({ id: inventario_alimento.id });
        if (!changed.length) throw Object.assign(new Error('La ubicación cambió desde que abrió el formulario. Actualice e intente de nuevo.'), { status: 409 });
        await tx.insert(schema.auditoria).values({ id: crypto.randomUUID(), usuarioId: actorId, accion: 'TrasladarLote', modulo: 'TransferenciaAlimento', referenciaId: item.id, valoresAntes: JSON.stringify(before), valoresDespues: JSON.stringify(traslado), motivo: traslado.observaciones || `Traslado ${before.origen} → ${traslado.destino}`, fecha });
        return traslado;
      });
      res.status(201).json({ success: true, traslado: result });
    } catch (error: any) { res.status(error?.status || 500).json({ error: error.message || 'No se pudo registrar el traslado.' }); }
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
        motivo, responsable, registradoPor: req.usuario?.id ? String(req.usuario.id) : (req.headers['x-user-id'] ? String(req.headers['x-user-id']) : null), evidencia: evidencia || null, aprobacion: aprobacion || null,
        impactoFinanciero: Number(impactoFinanciero) || 0,
        fecha: new Date().toISOString(), observaciones: observaciones || null,
        rutaId: rutaId || null, guiaId: guiaId || null, camionId: camionId || null, vendedorId: vendedorId || null
      });
      await logAudit?.(req.usuario?.id || req.headers['x-user-id'] || 'demo', 'Registrar', 'Desperdicio', id, null, { origen, producto, lote: lote || null, cantidad: cantidadOriginal, unidad, motivo, responsable, evidencia: evidencia || null, aprobacion: aprobacion || null, rutaId: rutaId || null, guiaId: guiaId || null }, observaciones || motivo);
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
