import { and, desc, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { clasificarDiferencia, OPCIONES_DIFERENCIA_RECEPCION } from '../../lib/opcionesRecepcion';

/** Recepciones, traslados, remisiones, cargas y alistamiento de producto. */
export function registrarRutasOperaciones(
  app: any,
  db: any,
  helpers: {
    ApiError: new (status: number, message: string) => Error;
    httpError: (res: any, error: any) => any;
    registrarPesoPunto: (opts: any) => Promise<void>;
    calcularImpactoDesperdicio: (producto: string, cantidad: number) => Promise<number>;
    nextRemisionConsecutivo: () => string;
    requirePermission: (...args: any[]) => any;
    logAudit?: (...args: any[]) => Promise<void>;
  },
) {
  const { ApiError, httpError, registrarPesoPunto, calcularImpactoDesperdicio, nextRemisionConsecutivo, requirePermission, logAudit } = helpers;
  const { inventario, movimientosInventario, traslados, recepciones, bodega_recepcion_borradores, etiquetas, desperdicios, guias_remision, traza_etiqueta, camiones } = schema;

  // El borrador guarda solo el avance de captura. No mueve stock ni cambia el
  // estado de la guía; eso ocurre únicamente al confirmar la recepción normal.
  app.get('/api/operaciones/recepciones/borradores', requirePermission('recepciones', 'view'), async (_req, res) => {
    try {
      const rows = await db.query.bodega_recepcion_borradores.findMany();
      res.json(rows.map((row: any) => ({
        id: row.id, tipo: row.tipo,
        referencias: JSON.parse(row.referenciasJson || '[]'),
        datos: JSON.parse(row.datosJson || '{}'),
        iniciadoPor: row.iniciadoPor, iniciadoEn: row.iniciadoEn, actualizadoEn: row.actualizadoEn,
      })));
    } catch (error: any) { httpError(res, error); }
  });

  app.post('/api/operaciones/recepciones/borradores', requirePermission('recepciones', 'create'), async (req, res) => {
    try {
      const { id, tipo, referencias, datos } = req.body || {};
      if (typeof id !== 'string' || !id || !['traslado', 'remision'].includes(tipo) || !Array.isArray(referencias) || !referencias.length) {
        return res.status(400).json({ error: 'Datos de borrador de recepción inválidos.' });
      }
      const now = new Date().toISOString();
      const previo = await db.query.bodega_recepcion_borradores.findFirst({ where: eq(bodega_recepcion_borradores.id, id) });
      const row = {
        id, tipo, referenciasJson: JSON.stringify(referencias), datosJson: JSON.stringify(datos || {}),
        iniciadoPor: previo?.iniciadoPor || req.headers['x-user-id'] || null,
        iniciadoEn: previo?.iniciadoEn || now, actualizadoEn: now,
      };
      if (previo) await db.update(bodega_recepcion_borradores).set(row).where(eq(bodega_recepcion_borradores.id, id));
      else await db.insert(bodega_recepcion_borradores).values(row);
      res.json({ success: true, ...row, referencias, datos: datos || {} });
    } catch (error: any) { httpError(res, error); }
  });

  app.delete('/api/operaciones/recepciones/borradores/:id', requirePermission('recepciones', 'create'), async (req, res) => {
    try {
      await db.delete(bodega_recepcion_borradores).where(eq(bodega_recepcion_borradores.id, String(req.params.id)));
      res.json({ success: true });
    } catch (error: any) { httpError(res, error); }
  });
  app.post("/api/operaciones/traslado", requirePermission(['traslados', 'carga_camion'], 'create'), async (req, res) => {
    try {
      const { granjaId, producto, cantidad, cantidadKg, responsable, cargaId, vehiculo, camionId, creadoPorId } = req.body;
      const cantidadMovimiento = Number(cantidadKg ?? cantidad);
      const unidadMovimiento = cantidadKg != null ? 'kg' : String(req.body.unidad || 'cartones');

      if (!producto || !Number.isFinite(cantidadMovimiento) || cantidadMovimiento <= 0) {
        return res.status(400).json({ error: "Datos de traslado inválidos" });
      }

      const resultadoTraslado = await db.transaction(async (tx) => {
        // Una carga puede llevar varios productos; el par cargaId + producto
        // identifica cada traslado para que un reintento no vuelva a descontar stock.
        if (cargaId) {
          const trasladosDeCarga = await tx.query.traslados.findMany({ where: eq(traslados.cargaId, String(cargaId)) });
          for (const previo of trasladosDeCarga) {
            const movimientoPrevio = await tx.query.movimientosInventario.findFirst({
              where: eq(movimientosInventario.referencia_id, previo.id)
            });
            if (movimientoPrevio?.producto !== producto) continue;
            if (Number(movimientoPrevio.cantidad) !== cantidadMovimiento || (movimientoPrevio.unidad || 'cartones') !== unidadMovimiento) return { duplicado: false, conflicto: true as const };
            return { duplicado: true as const, conflicto: false as const, trasladoId: previo.id };
          }
        }

        // 1. Verify stock in Granja
        const stockGranja = await tx.query.inventario.findFirst({
          where: and(
            eq(inventario.producto, producto),
            eq(inventario.ubicacion, 'Granja'),
            eq(inventario.unidad, unidadMovimiento)
          )
        });

        if (!stockGranja || stockGranja.unidad !== unidadMovimiento || stockGranja.cantidad < cantidadMovimiento) {
          throw new Error("Stock insuficiente en granja para este traslado");
        }

        // Resolver vehículo: si se envía camionId, tomar el nombre del camión
        let vehiculoFinal = vehiculo || null;
        if (camionId && !vehiculoFinal) {
          const camion = await tx.query.camiones.findFirst({ where: eq(camiones.id, camionId) });
          vehiculoFinal = camion ? camion.nombre : null;
        }

        // 2. Create Traslado
        const trasladoId = crypto.randomUUID();
        await tx.insert(traslados).values({
          id: trasladoId,
          cargaId: cargaId || trasladoId,
          vehiculo: vehiculoFinal,
          camionId: camionId || null,
          creadoPorId: creadoPorId || null,
          granjaOrigenId: granjaId,
          bodegaDestinoId: 'Bodega Central',
          fechaSalida: new Date().toISOString(),
          responsableEntrega: responsable,
          responsableTransporte: 'Pendiente',
          estado: 'Pendiente'
        });

        // 3. Update Inventory
        await tx.update(inventario)
          .set({ cantidad: stockGranja.cantidad - cantidadMovimiento })
          .where(eq(inventario.id, stockGranja.id));

        // 4. Add inventory in Transit (Optional logic, or just keep status)
        // For now, we assume the item is in "Transito" status
        
        // 5. Record Movement
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto: producto,
          cantidad: cantidadMovimiento,
          unidad: unidadMovimiento,
          tipo: 'Traslado',
          origen: 'Granja',
          destino: 'Bodega Central',
          fecha: new Date().toISOString(),
          referencia_id: trasladoId
        });
        return { duplicado: false as const, conflicto: false as const, trasladoId };
      });

      if (resultadoTraslado.conflicto) {
        return res.status(409).json({ error: 'Este producto ya se trasladó con otra cantidad para esta carga. No se cambió el inventario.' });
      }
      if (resultadoTraslado.duplicado) {
        return res.status(200).json({ success: true, duplicada: true, trasladoId: resultadoTraslado.trasladoId, message: 'Este traslado ya estaba registrado.' });
      }
      
      res.status(200).json({ success: true, duplicada: false, trasladoId: resultadoTraslado.trasladoId, message: 'Traslado registrado. Pendiente de confirmación del camionero' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/operaciones/traslados", requirePermission(['traslados', 'inventario_bodega'], 'view'), async (req, res) => {
    try {
      const data = await db.query.traslados.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Corrección explícita de traslados históricos de huevo capturados en cartones.
  // Conserva el movimiento original: el nuevo registro documenta el peso real
  // confirmado por báscula y no aplica una conversión estimada ni ajusta stock.
  app.post("/api/operaciones/traslados/:id/corregir-peso-kg", requirePermission('inventario_bodega', 'create'), async (req, res) => {
    try {
      const actor = (req as any).usuario;
      if (!(actor?.roles || [actor?.role]).includes('Admin')) return res.status(403).json({ error: 'Solo Administración puede corregir el peso de un traslado histórico.' });
      const trasladoId = String(req.params.id);
      const pesoKg = Number(req.body?.pesoKg);
      const motivo = String(req.body?.motivo || '').trim();
      if (!Number.isFinite(pesoKg) || pesoKg <= 0) return res.status(400).json({ error: 'Ingrese el peso real confirmado en báscula, mayor que cero kg.' });
      if (motivo.length < 8) return res.status(400).json({ error: 'Explique la corrección con al menos 8 caracteres.' });

      const resultado = await db.transaction(async (tx: any) => {
        const traslado = await tx.query.traslados.findFirst({ where: eq(traslados.id, trasladoId) });
        if (!traslado) throw new ApiError(404, 'No se encontró el traslado.');
        if (!['Pendiente', 'EnTransito'].includes(String(traslado.estado))) throw new ApiError(409, 'Solo se puede corregir un traslado pendiente o en tránsito, antes de recibirlo.');
        const original = await tx.query.movimientosInventario.findFirst({
          where: and(eq(movimientosInventario.referencia_id, trasladoId), eq(movimientosInventario.tipo, 'Traslado'))
        });
        if (!original || !/huevo/i.test(String(original.producto)) || String(original.unidad || '').toLowerCase() === 'kg') {
          throw new ApiError(409, 'El traslado no es un traslado histórico de huevo en cartones.');
        }
        const correccionExistente = await tx.query.movimientosInventario.findFirst({
          where: and(eq(movimientosInventario.referencia_id, trasladoId), eq(movimientosInventario.tipo, 'Corrección Unidad Traslado'))
        });
        if (correccionExistente) throw new ApiError(409, 'Este traslado ya tiene una corrección de peso. Solicite una revisión administrativa para cambiarla.');

        const ahora = new Date().toISOString();
        const correccionId = crypto.randomUUID();
        await tx.insert(movimientosInventario).values({
          id: correccionId, producto: original.producto, cantidad: pesoKg, unidad: 'kg',
          tipo: 'Corrección Unidad Traslado', origen: original.origen, destino: original.destino,
          fecha: ahora, referencia_id: trasladoId
        });
        return {
          trasladoId, correccionId, producto: original.producto,
          original: { cantidad: original.cantidad, unidad: original.unidad || 'cartones' },
          corregido: { cantidad: pesoKg, unidad: 'kg' }, motivo, fecha: ahora,
          inventarioAjustado: false
        };
      });
      if (logAudit) await logAudit(actor.id, 'CorregirPesoTraslado', 'Traslado', trasladoId, resultado.original, resultado, motivo);
      return res.status(201).json({ success: true, ...resultado, message: `Peso real registrado: ${pesoKg} kg. El movimiento original permanece intacto.` });
    } catch (error: any) {
      return httpError(res, error);
    }
  });

  // Convierte una remisión histórica de huevo en empaques a kg reales medidos.
  // Actualiza el saldo en tránsito en la misma transacción para conservar la custodia.
  app.post("/api/operaciones/remisiones/:id/corregir-peso-kg", requirePermission('inventario_bodega', 'create'), async (req, res) => {
    try {
      const actor = (req as any).usuario;
      if (!(actor?.roles || [actor?.role]).includes('Admin')) return res.status(403).json({ error: 'Solo Administración puede corregir el peso de una remisión histórica.' });
      const guiaId = String(req.params.id);
      const pesoKg = Number(req.body?.pesoKg);
      const motivo = String(req.body?.motivo || '').trim();
      if (!Number.isFinite(pesoKg) || pesoKg <= 0) return res.status(400).json({ error: 'Ingrese el peso real confirmado en báscula, mayor que cero kg.' });
      if (motivo.length < 8) return res.status(400).json({ error: 'Explique la corrección con al menos 8 caracteres.' });

      const resultado = await db.transaction(async (tx: any) => {
        const guia = await tx.query.guias_remision.findFirst({ where: eq(guias_remision.id, guiaId) });
        if (!guia) throw new ApiError(404, 'No se encontró la remisión.');
        if (guia.estado !== 'EnTransito') throw new ApiError(409, 'Solo se puede corregir una remisión que siga en tránsito.');
        if (!/huevo/i.test(String(guia.producto)) || String(guia.unidad || 'cartones') === 'kg') throw new ApiError(409, 'La remisión no es un registro histórico de huevo en empaques.');

        const cantidadEmpaques = Number(guia.cartonesEsperados || 0);
        const saldoEmpaques = await tx.query.inventario.findFirst({ where: and(
          eq(inventario.producto, guia.producto), eq(inventario.ubicacion, 'EnTransito'), eq(inventario.unidad, 'cartones')
        ) });
        if (!saldoEmpaques || Number(saldoEmpaques.cantidad) < cantidadEmpaques) throw new ApiError(409, 'El saldo histórico en tránsito no alcanza para convertir esta remisión. Solicite una conciliación de inventario.');

        const ahora = new Date().toISOString();
        const saldoRestante = Number(saldoEmpaques.cantidad) - cantidadEmpaques;
        if (saldoRestante <= 0) await tx.delete(inventario).where(eq(inventario.id, saldoEmpaques.id));
        else await tx.update(inventario).set({ cantidad: saldoRestante, ultima_actualizacion: ahora }).where(eq(inventario.id, saldoEmpaques.id));

        const saldoKg = await tx.query.inventario.findFirst({ where: and(
          eq(inventario.producto, guia.producto), eq(inventario.ubicacion, 'EnTransito'), eq(inventario.unidad, 'kg')
        ) });
        if (saldoKg) await tx.update(inventario).set({ cantidad: Number(saldoKg.cantidad) + pesoKg, ultima_actualizacion: ahora }).where(eq(inventario.id, saldoKg.id));
        else await tx.insert(inventario).values({ id: crypto.randomUUID(), producto: guia.producto, cantidad: pesoKg, unidad: 'kg', ubicacion: 'EnTransito', ultima_actualizacion: ahora });

        await tx.update(guias_remision).set({ unidad: 'kg', cantidadKgEsperada: pesoKg, cartonesEsperados: 0 }).where(eq(guias_remision.id, guiaId));
        const correccionId = crypto.randomUUID();
        await tx.insert(movimientosInventario).values({
          id: correccionId, producto: guia.producto, cantidad: pesoKg, unidad: 'kg',
          tipo: 'Corrección Unidad Remisión', origen: 'EnTransito', destino: 'EnTransito', fecha: ahora, referencia_id: guiaId,
        });
        return { guiaId, correccionId, producto: guia.producto, original: { cantidad: cantidadEmpaques, unidad: 'empaques' }, corregido: { cantidad: pesoKg, unidad: 'kg' }, motivo, fecha: ahora };
      });
      if (logAudit) await logAudit(actor.id, 'CorregirPesoRemision', 'GuiaRemision', guiaId, resultado.original, resultado, motivo);
      return res.status(201).json({ success: true, ...resultado, message: `Peso real registrado: ${pesoKg} kg. La remisión permanece en tránsito.` });
    } catch (error: any) {
      return httpError(res, error);
    }
  });

  // Cambia la unidad del saldo global legado de Granja solo a partir de un
  // conteo físico consolidado en kg. El antes/después queda en auditoría.
  app.post("/api/operaciones/inventario/granja/conciliar-kg", requirePermission('inventario_bodega', 'create'), async (req, res) => {
    try {
      const actor = (req as any).usuario;
      if (!(actor?.roles || [actor?.role]).includes('Admin')) return res.status(403).json({ error: 'Solo Administración puede conciliar el inventario histórico de Granja.' });
      const inventarioId = String(req.body?.inventarioId || '');
      const cantidadKg = Number(req.body?.cantidadKg);
      const motivo = String(req.body?.motivo || '').trim();
      if (!inventarioId) return res.status(400).json({ error: 'Seleccione el saldo histórico que va a conciliar.' });
      if (!Number.isFinite(cantidadKg) || cantidadKg < 0) return res.status(400).json({ error: 'Ingrese el total en kg medido físicamente; puede ser cero.' });
      if (motivo.length < 8) return res.status(400).json({ error: 'Agregue el detalle del conteo y su evidencia con al menos 8 caracteres.' });

      const resultado = await db.transaction(async (tx: any) => {
        const saldo = await tx.query.inventario.findFirst({ where: eq(inventario.id, inventarioId) });
        if (!saldo) throw new ApiError(404, 'El saldo seleccionado ya no existe. Actualice la pantalla.');
        if (saldo.ubicacion !== 'Granja' || String(saldo.unidad).toLowerCase() === 'kg' || !/huevo/i.test(String(saldo.producto))) {
          throw new ApiError(409, 'Solo se puede conciliar un saldo histórico de huevo en cartones ubicado en Granja.');
        }
        const antes = { id: saldo.id, producto: saldo.producto, cantidad: Number(saldo.cantidad), unidad: saldo.unidad, ubicacion: saldo.ubicacion };
        const fecha = new Date().toISOString();
        await tx.update(inventario).set({ cantidad: cantidadKg, unidad: 'kg', ultima_actualizacion: fecha }).where(eq(inventario.id, inventarioId));
        const movimientoId = crypto.randomUUID();
        await tx.insert(movimientosInventario).values({
          id: movimientoId, producto: saldo.producto, cantidad: cantidadKg, unidad: 'kg',
          tipo: 'Ajuste Conteo Físico', origen: 'Conteo físico consolidado', destino: 'Granja',
          fecha, referencia_id: inventarioId
        });
        return { inventarioId, movimientoId, producto: saldo.producto, antes, despues: { ...antes, cantidad: cantidadKg, unidad: 'kg' }, motivo, fecha };
      });
      if (logAudit) await logAudit(actor.id, 'ConciliarSaldoHistoricoKg', 'InventarioGranja', inventarioId, resultado.antes, resultado.despues, motivo);
      return res.status(200).json({ success: true, ...resultado, message: `Saldo conciliado con el conteo físico: ${cantidadKg} kg.` });
    } catch (error: any) {
      return httpError(res, error);
    }
  });

  // ==================== CAMIONES — LECTURA DE COMPATIBILIDAD ====================

  app.get("/api/camiones", requirePermission(['rutas', 'cargas_asignadas'], 'view'), async (req, res) => {
    try {
      const rows = await db.query.camiones.findMany({ orderBy: (c: any, { asc }: any) => [asc(c.nombre)] });
      const users = await db.query.users.findMany();
      const userMap = new Map(users.map((u: any) => [u.id, u]));
      const data = rows.map((c: any) => ({
        ...c,
        camioneroNombre: c.camioneroId ? ((userMap.get(c.camioneroId) as any)?.name || null) : null,
      }));
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CARGA — Confirmar / Rechazar (Camionero) ====================

  // Listar cargas pendientes para un camionero (todas las asignadas a sus camiones)
  app.get("/api/operaciones/cargas", requirePermission('cargas_asignadas', 'view'), async (req, res) => {
    try {
      const usuario = req.usuario;
      const esAdmin = usuario.role === 'Admin' || usuario.roles?.includes('Admin');
      const camioneroId = esAdmin ? undefined : String(usuario.id);
      const allTraslados = await db.query.traslados.findMany({ orderBy: (t: any, { desc }: any) => [desc(t.fechaSalida)] });
      const camionesRows = await db.query.camiones.findMany();
      const camionById = new Map<string, any>(camionesRows.map((c: any) => [c.id, c]));
      const users = await db.query.users.findMany();
      const userMap = new Map<string, any>(users.map((u: any) => [u.id, u]));
      const allMovimientos = await db.query.movimientosInventario.findMany();
      const movByRef = new Map<string, any[]>();
      for (const m of allMovimientos) {
        if (m.tipo === 'Traslado' && m.referencia_id) {
          if (!movByRef.has(m.referencia_id)) movByRef.set(m.referencia_id, []);
          movByRef.get(m.referencia_id)!.push(m);
        }
      }

      // Cargar 1 camión → N traslados. Mostrar solo los Pendiente (o los no recibidos), agrupados por carga_id.
      const groups = new Map<string, any>();
      for (const t of allTraslados) {
        if (!t.cargaId) continue;
        const camion = t.camionId ? camionById.get(t.camionId) : null;
        // El Comercial solo ve camiones que le asignó Administración. Admin puede
        // consultar todo para supervisar la operación.
        const camioneroDelCamion = camion?.camioneroId || null;
        if (!esAdmin && camioneroDelCamion !== camioneroId) continue;
        if (!groups.has(t.cargaId)) {
          groups.set(t.cargaId, {
            cargaId: t.cargaId,
            camionId: t.camionId,
            camionNombre: camion?.nombre || null,
            camionPlaca: camion?.placa || null,
            camioneroId: camion?.camioneroId || null,
            camioneroNombre: camion?.camioneroId ? ((userMap.get(camion.camioneroId) as any)?.name || null) : null,
            creadoPorNombre: t.creadoPorId ? ((userMap.get(t.creadoPorId) as any)?.name || null) : null,
            creadoPorId: t.creadoPorId || null,
            fechaSalida: t.fechaSalida,
            estado: t.estado,
            motivoRechazo: t.motivoRechazo || null,
            items: [],
          });
        }
        const g = groups.get(t.cargaId)!;
        g.estado = t.estado;
        g.motivoRechazo = t.motivoRechazo || g.motivoRechazo;
        const movimientos = movByRef.get(t.id) || [];
        for (const m of movimientos) {
          g.items.push({
            trasladoId: t.id,
            granjaOrigenId: t.granjaOrigenId,
            producto: m.producto,
            cantidad: m.cantidad,
            unidad: m.unidad,
          });
        }
      }
      const cargas = Array.from(groups.values());
      res.json(cargas);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Confirmar carga: todos los traslados de la carga pasan a EnTransito
  app.post("/api/operaciones/carga/:cargaId/confirmar", requirePermission('carga', 'approve'), async (req, res) => {
    try {
      const { cargaId } = req.params;
      const usuario = req.usuario;
      const camioneroId = String(usuario.id);
      const esAdmin = usuario.role === 'Admin' || usuario.roles?.includes('Admin');

      const trasladosCarga = await db.query.traslados.findMany({ where: eq(traslados.cargaId, cargaId) });
      if (trasladosCarga.length === 0) return res.status(404).json({ error: "Carga no encontrada" });

      const camionesAsignados = await db.query.camiones.findMany();
      const asignadoAlUsuario = trasladosCarga.every((t: any) => camionesAsignados.some((c: any) => c.id === t.camionId && c.camioneroId === camioneroId));
      if (!esAdmin && !asignadoAlUsuario) return res.status(403).json({ error: "Esta carga no está asignada a tu camión" });

      // Regla: quien crea NO puede confirmar
      const creadores = new Set(trasladosCarga.map((t: any) => t.creadoPorId));
      if (creadores.has(camioneroId)) {
        return res.status(403).json({ error: "La persona que crea la solicitud no puede confirmarla" });
      }

      // Descartar cargas que ya fueron recibidas
      if (trasladosCarga.every((t: any) => t.estado === 'Recibido' || t.estado === 'RecibidoConDiferencia')) {
        return res.status(400).json({ error: "La carga ya fue recibida en bodega" });
      }

      await db.transaction(async (tx) => {
        for (const t of trasladosCarga) {
          if (t.estado === 'Pendiente') {
            await tx.update(traslados)
              .set({ estado: 'EnTransito', confirmadoPorId: camioneroId, motivoRechazo: null })
              .where(eq(traslados.id, t.id));
          }
        }
      });

      res.json({ success: true, message: 'Carga confirmada. En tránsito a bodega' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rechazar carga: vuelve a Pendiente/Rechazada con motivo
  app.post("/api/operaciones/carga/:cargaId/rechazar", requirePermission('carga', 'approve'), async (req, res) => {
    try {
      const { cargaId } = req.params;
      const usuario = req.usuario;
      const camioneroId = String(usuario.id);
      const esAdmin = usuario.role === 'Admin' || usuario.roles?.includes('Admin');
      const { motivo } = req.body || {};
      if (!motivo || !String(motivo).trim()) return res.status(400).json({ error: "Se requiere el motivo del rechazo" });

      const trasladosCarga = await db.query.traslados.findMany({ where: eq(traslados.cargaId, cargaId) });
      if (trasladosCarga.length === 0) return res.status(404).json({ error: "Carga no encontrada" });

      const camionesAsignados = await db.query.camiones.findMany();
      const asignadoAlUsuario = trasladosCarga.every((t: any) => camionesAsignados.some((c: any) => c.id === t.camionId && c.camioneroId === camioneroId));
      if (!esAdmin && !asignadoAlUsuario) return res.status(403).json({ error: "Esta carga no está asignada a tu camión" });

      // Regla: quien crea NO puede rechazar tampoco
      const creadores = new Set(trasladosCarga.map((t: any) => t.creadoPorId));
      if (creadores.has(camioneroId)) {
        return res.status(403).json({ error: "La persona que crea la solicitud no puede rechazarla" });
      }

      await db.transaction(async (tx) => {
        for (const t of trasladosCarga) {
          if (t.estado === 'Pendiente' || t.estado === 'Rechazada') {
            await tx.update(traslados)
              .set({ estado: 'Rechazada', confirmadoPorId: camioneroId, motivoRechazo: String(motivo).trim() })
              .where(eq(traslados.id, t.id));
            // Restaurar stock a Granja (se descontó al crear el traslado)
            const movs = await tx.query.movimientosInventario.findMany({ where: eq(movimientosInventario.referencia_id, t.id) });
            for (const m of movs) {
              if (m.tipo !== 'Traslado') continue;
              const inv = await tx.query.inventario.findFirst({
                where: and(
                  eq(inventario.producto, m.producto),
                  eq(inventario.ubicacion, 'Granja'),
                  eq(inventario.unidad, m.unidad || 'cartones')
                )
              });
              if (inv) {
                await tx.update(inventario)
                  .set({ cantidad: inv.cantidad + m.cantidad, ultima_actualizacion: new Date().toISOString() })
                  .where(eq(inventario.id, inv.id));
              }
            }
          }
        }
      });

      res.json({ success: true, message: 'Carga rechazada: se devuelve al encargado' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/operaciones/recepcion", requirePermission('recepciones', 'create'), async (req, res) => {
    try {
      const { trasladoId, cantidadEsperada, cantidadRecibida, cantidadKgEsperada, cantidadKgRecibida, motivoDiferencia, producto, responsableRecepcion, etiquetasCodigos } = req.body;
      const esKg = cantidadKgEsperada != null || cantidadKgRecibida != null;
      const esperadaFisica = Number(esKg ? cantidadKgEsperada : cantidadEsperada);
      const recibidaFisica = Number(esKg ? cantidadKgRecibida : cantidadRecibida);
      const diferenciaFisica = esperadaFisica - recibidaFisica;
      const diferencia = esKg ? 0 : diferenciaFisica;
      const recepcionResponsable = responsableRecepcion || 'Bodeguero Actual';
      const usuarioId = req.headers['x-user-id'] as string || null;

      if (!trasladoId || !Number.isFinite(esperadaFisica) || !Number.isFinite(recibidaFisica) || esperadaFisica <= 0 || recibidaFisica < 0 || (!esKg && (cantidadEsperada === undefined || cantidadRecibida === undefined))) {
        return res.status(400).json({ error: "Cantidades de recepción inválidas" });
      }
      const movimientoTraslado = await db.query.movimientosInventario.findFirst({ where: and(eq(movimientosInventario.referencia_id, String(trasladoId)), eq(movimientosInventario.tipo, 'Traslado')) });
      const correccionKg = await db.query.movimientosInventario.findFirst({ where: and(eq(movimientosInventario.referencia_id, String(trasladoId)), eq(movimientosInventario.tipo, 'Corrección Unidad Traslado')) });
      const unidadTrasladada = String(correccionKg?.unidad || movimientoTraslado?.unidad || 'cartones');
      const cantidadTrasladada = Number(correccionKg?.cantidad ?? movimientoTraslado?.cantidad ?? 0);
      if (unidadTrasladada === 'kg' && !esKg) return res.status(400).json({ error: 'El traslado está en kg. Registre cantidadKgEsperada y cantidadKgRecibida.' });
      if (unidadTrasladada !== 'kg' && esKg) return res.status(409).json({ error: 'La unidad recibida no coincide con la unidad enviada en el traslado.' });
      if (unidadTrasladada !== 'kg' && /huevo/i.test(String(producto || movimientoTraslado?.producto || ''))) {
        return res.status(409).json({ error: 'Este traslado histórico de huevo está en cartones. Administración debe confirmar el peso y registrar una corrección trazable en kg antes de recibirlo.' });
      }
      if (esKg && Number(cantidadKgEsperada) !== cantidadTrasladada) return res.status(409).json({ error: `El peso esperado del traslado corregido es ${cantidadTrasladada} kg. Actualice la recepción antes de continuar.` });
      const unidadFisica = esKg ? 'kg' : unidadTrasladada;

      // Motivo categorizado: según la opción seleccionada es Desperdicio o Posible Robo
      const opcionMotivo = clasificarDiferencia(motivoDiferencia);
      const tipoDiferencia = diferenciaFisica > 0
        ? (opcionMotivo?.tipo ?? 'desperdicio')
        : diferenciaFisica < 0 ? 'sobrante' : null;
      const esIdMotivo = OPCIONES_DIFERENCIA_RECEPCION.some(o => o.id === motivoDiferencia);
      const motivoFinal = diferenciaFisica !== 0
        ? (esIdMotivo ? (opcionMotivo?.label || motivoDiferencia) : (motivoDiferencia || null))
        : null;

      if (diferenciaFisica !== 0 && !motivoFinal) {
        return res.status(400).json({ error: 'Indique el motivo de la diferencia entre el peso enviado y el recibido.' });
      }

      const datosCoinciden = (existente: any) =>
        (esKg
          ? Number(existente.cantidadKgEsperada) === esperadaFisica && Number(existente.cantidadKgRecibida) === recibidaFisica
          : Number(existente.cantidadEsperada) === Number(cantidadEsperada) && Number(existente.cantidadRecibida) === Number(cantidadRecibida)) &&
        (existente.motivoDiferencia || null) === (motivoFinal || null);
      const conflictoReintento = () => res.status(409).json({
        error: 'Esta carga ya se recibió con otro conteo. No se cambió el inventario; solicita una corrección al administrador.'
      });

      // Reintentar una recepción cuyo acuse se perdió no debe sumar inventario dos veces.
      const recepcionPrevia = await db.query.recepciones.findFirst({
        where: eq(recepciones.trasladoId, String(trasladoId))
      });
      if (recepcionPrevia) {
        if (!datosCoinciden(recepcionPrevia)) return conflictoReintento();
        return res.status(200).json({
          success: true,
          duplicada: true,
          recepcionId: recepcionPrevia.id,
          cantidadRecibida: recepcionPrevia.cantidadRecibida,
          message: 'Esta recepción ya estaba registrada; no se volvió a sumar inventario.'
        });
      }

      // Etiquetas escaneadas por el bodeguero (opcional): se validan y se marcan EnBodega
      // al confirmar. Cada etiqueta es 1 cartón (1 etiqueta = 1 cartón del galerón).
      const codigos = Array.isArray(etiquetasCodigos) ? etiquetasCodigos.map(c => String(c).trim()).filter(Boolean) : [];
      const etiquetasAIngresar: any[] = [];
      if (recibidaFisica === 0 && codigos.length > 0) {
        return res.status(400).json({ error: 'No se pueden recibir etiquetas cuando el peso recibido es 0 kg.' });
      }
      if (codigos.length > 0) {
        for (const codigo of codigos) {
          const etiqueta = await db.query.etiquetas.findFirst({ where: eq(etiquetas.codigoUnico, codigo) });
          if (!etiqueta) {
            return res.status(400).json({ error: `Etiqueta ${codigo} no encontrada` });
          }
          if (etiqueta.producto !== producto) {
            return res.status(400).json({ error: `Etiqueta ${codigo} corresponde a ${etiqueta.producto}, no a ${producto}` });
          }
          if (etiqueta.estado !== 'Generada') {
            return res.status(400).json({ error: `Etiqueta ${codigo} está ${etiqueta.estado} — ya fue recibida o está en otro proceso` });
          }
          etiquetasAIngresar.push(etiqueta);
        }
      }

      const resultadoRecepcion = await db.transaction(async (tx) => {
        // Revalidar dentro de la transacción cubre dos envíos simultáneos.
        const existente = await tx.query.recepciones.findFirst({
          where: eq(recepciones.trasladoId, String(trasladoId))
        });
        if (existente) return { duplicada: true as const, conflicto: !datosCoinciden(existente), recepcion: existente };

        // 1. Create Recepcion
        const recepcionId = crypto.randomUUID();
        await tx.insert(recepciones).values({
          id: recepcionId,
          trasladoId: trasladoId,
          fechaRecepcion: new Date().toISOString(),
          cantidadEsperada: esKg ? 0 : Number(cantidadEsperada),
          cantidadRecibida: esKg ? 0 : Number(cantidadRecibida),
          diferencia,
          cantidadKgEsperada: esKg ? esperadaFisica : null,
          cantidadKgRecibida: esKg ? recibidaFisica : null,
          diferenciaKg: esKg ? diferenciaFisica : null,
          motivoDiferencia: motivoFinal,
          tipoDiferencia,
          responsableRecepcion: recepcionResponsable,
          estado: diferenciaFisica === 0 ? 'Conforme' : 'ConDiferencia'
        });

        // 2. Update Traslado Status
        await tx.update(traslados)
          .set({ 
            estado: diferenciaFisica === 0 ? 'Recibido' : 'RecibidoConDiferencia',
            fechaLlegada: new Date().toISOString()
          })
          .where(eq(traslados.id, trasladoId));

        // 3. Update Inventory in Bodega (Sum received amount)
        const inventoryItem = await tx.query.inventario.findFirst({
          where: and(
            eq(inventario.producto, producto),
            eq(inventario.ubicacion, 'Bodega Central'),
            eq(inventario.unidad, unidadFisica)
          )
        });

        if (recibidaFisica > 0) {
          if (inventoryItem) {
            if (inventoryItem.unidad !== unidadFisica) throw new ApiError(409, `La unidad recibida (${unidadFisica}) no coincide con el inventario de Bodega (${inventoryItem.unidad}).`);
            await tx.update(inventario)
              .set({
                cantidad: inventoryItem.cantidad + recibidaFisica,
                ultima_actualizacion: new Date().toISOString()
              })
              .where(eq(inventario.id, inventoryItem.id));
          } else {
            await tx.insert(inventario).values({
              id: crypto.randomUUID(),
              producto: producto,
              cantidad: recibidaFisica,
              unidad: unidadFisica,
              ubicacion: 'Bodega Central',
              ultima_actualizacion: new Date().toISOString()
            });
          }
        }

        // 4. Register Final Movement
        if (recibidaFisica > 0) {
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: producto,
            cantidad: recibidaFisica,
            unidad: unidadFisica,
            tipo: 'Recepción Bodega',
            origen: 'Granja',
            destino: 'Bodega Central',
            fecha: new Date().toISOString(),
            referencia_id: recepcionId
          });
        }

        // 5. Diferencia → clasificación según la opción de motivo seleccionada:
        //    - 'desperdicio': merma en tránsito (huevos rotos, sucios, vencidos)
        //    - 'alerta': POSIBLE ROBO — los cartones no aparecen, NO se registra desperdicio
        if (diferenciaFisica > 0 && tipoDiferencia === 'desperdicio') {
          const impacto = await calcularImpactoDesperdicio(producto, diferenciaFisica);
          await tx.insert(desperdicios).values({
            id: crypto.randomUUID(),
            origen: 'Recepción Bodega',
            producto: producto,
            lote: null,
            cantidad: diferenciaFisica,
            unidad: unidadFisica,
            motivo: motivoFinal || 'Diferencia en recepción',
            responsable: recepcionResponsable,
            fecha: new Date().toISOString(),
            impactoFinanciero: impacto
          });
        }

        // 6. La diferencia sale como pérdida en tránsito (kárdex equilibrado en ambos casos)
        if (diferenciaFisica > 0) {
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: producto,
            cantidad: diferenciaFisica,
            unidad: unidadFisica,
            tipo: 'Pérdida en Tránsito',
            origen: 'Granja',
            destino: 'Desperdicio',
            fecha: new Date().toISOString(),
            referencia_id: recepcionId
          });
        }

        // 7. Etiquetas escaneadas → EnBodega con fecha de recepción + traza
        const ahora = new Date().toISOString();
        for (const etiqueta of etiquetasAIngresar) {
          await tx.update(etiquetas).set({
            estado: 'EnBodega',
            ubicacionActual: 'Bodega Central',
            fechaRecepcion: ahora,
          }).where(eq(etiquetas.id, etiqueta.id));
          await tx.insert(traza_etiqueta).values({
            id: crypto.randomUUID(),
            etiquetaId: etiqueta.id,
            tipoEvento: 'Recibida',
            ubicacion: 'Bodega Central',
            documentoRef: trasladoId,
            usuarioId: usuarioId,
            fecha: ahora,
            observaciones: `Recibida de granja (traslado ${trasladoId}) por ${recepcionResponsable}`,
          });
        }
        return { duplicada: false as const, conflicto: false as const, recepcionId };
      });

      if (resultadoRecepcion.duplicada) {
        if (resultadoRecepcion.conflicto) return conflictoReintento();
        return res.status(200).json({
          success: true,
          duplicada: true,
          recepcionId: resultadoRecepcion.recepcion.id,
          cantidadRecibida: resultadoRecepcion.recepcion.cantidadRecibida,
          message: 'Esta recepción ya estaba registrada; no se volvió a sumar inventario.'
        });
      }
      
      res.status(200).json({
        success: true,
        duplicada: false,
        recepcionId: resultadoRecepcion.recepcionId,
        message: 'Recepción registrada y bodega actualizada',
        tipoDiferencia,
        esPosibleRobo: tipoDiferencia === 'alerta',
        etiquetasIngresadas: etiquetasAIngresar.map(e => e.codigoUnico),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Recepciones registradas (para alertas de posible robo y control de bodega)
  app.get("/api/operaciones/recepciones", requirePermission(['recepciones', 'inventario_bodega'], 'view'), async (req, res) => {
    try {
      const rows = await db.query.recepciones.findMany({
        orderBy: desc(recepciones.fechaRecepcion)
      });
      res.json(rows.map((r: any) => ({
        ...r,
        esPosibleRobo: r.tipoDiferencia === 'alerta'
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== F1 — GUÍAS DE REMISIÓN (cadena granja → bodega) ====================

  // Emitir guía de remisión (la granja no pesa ni etiqueta: solo remite cartones)
  app.post("/api/operaciones/remision", requirePermission(['produccion', 'carga_camion'], 'create'), async (req, res) => {
    try {
      const { granjaId, producto, cartones, cantidadKg, lote, responsable, transporte } = req.body;
      if (!granjaId || !producto || (cartones == null && cantidadKg == null) || !responsable) {
        return res.status(400).json({ error: "Granja, producto, cantidad y responsable son requeridos" });
      }
      const unidad = cantidadKg != null ? 'kg' : 'cartones';
      const cantidad = Number(cantidadKg ?? cartones);
      if (!Number.isFinite(cantidad) || cantidad <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a cero.' });

      await db.transaction(async (tx) => {
        // 1. Verify stock in Granja
        const stockGranja = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, 'Granja'), eq(inventario.unidad, unidad))
        });
        if (!stockGranja || stockGranja.unidad !== unidad || stockGranja.cantidad < cantidad) {
          throw new ApiError(400, "Stock insuficiente en granja para esta remisión");
        }

        // 2. Create guía
        const guiaId = crypto.randomUUID();
        await tx.insert(guias_remision).values({
          id: guiaId,
          consecutivo: nextRemisionConsecutivo(),
          granjaId,
          fecha: new Date().toISOString(),
          producto,
          cartonesEsperados: unidad === 'kg' ? 0 : cantidad,
          cantidadKgEsperada: unidad === 'kg' ? cantidad : null,
          unidad,
          lote: lote || null,
          responsable,
          transporte: transporte || 'Camión Ruta 1',
          estado: 'EnTransito'
        });

        // 3. Decrement Granja stock, add EnTransito
        await tx.update(inventario)
          .set({ cantidad: stockGranja.cantidad - cantidad, ultima_actualizacion: new Date().toISOString() })
          .where(eq(inventario.id, stockGranja.id));

        const enTransito = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, 'EnTransito'), eq(inventario.unidad, unidad))
        });
        if (enTransito) {
          if (enTransito.unidad !== unidad) throw new ApiError(409, `La unidad del tránsito (${enTransito.unidad}) no coincide con la remisión (${unidad}).`);
          await tx.update(inventario)
            .set({ cantidad: enTransito.cantidad + cantidad, ultima_actualizacion: new Date().toISOString() })
            .where(eq(inventario.id, enTransito.id));
        } else {
          await tx.insert(inventario).values({
            id: crypto.randomUUID(),
            producto,
            cantidad,
            unidad,
            ubicacion: 'EnTransito',
            ultima_actualizacion: new Date().toISOString()
          });
        }

        // 4. Movement record
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto,
          cantidad,
          unidad,
          tipo: 'Remisión',
          origen: 'Granja',
          destino: 'Bodega Central',
          fecha: new Date().toISOString(),
          referencia_id: guiaId
        });
      });

      res.status(201).json({ success: true, message: 'Guía de remisión emitida', consecutivo: undefined });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  // Listar guías de remisión
  app.get("/api/operaciones/remisiones", requirePermission(['produccion', 'inventario_bodega'], 'view'), async (req, res) => {
    try {
      const data = await db.query.guias_remision.findMany({ orderBy: (g: any, { desc }: any) => [desc(g.fecha)] });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Recepción de remisión en bodega (conteo + báscula → diferencia controlada)
  app.post("/api/operaciones/recepcion-remision", requirePermission('recepciones', 'create'), async (req, res) => {
    try {
      const { guiaId, cantidadRecibida, pesoBruto, cantidadKg, motivoDiferencia, responsable } = req.body;
      if (!guiaId || (cantidadRecibida == null && cantidadKg == null)) {
        return res.status(400).json({ error: "Guía y cantidad recibida son requeridos" });
      }

      await db.transaction(async (tx) => {
        const guia = await tx.query.guias_remision.findFirst({ where: eq(guias_remision.id, guiaId) });
        if (!guia) throw new ApiError(404, "Guía de remisión no encontrada");
        if (guia.estado !== 'EnTransito') throw new ApiError(409, `No se puede recibir una guía en estado ${guia.estado}`);

        const unidadFisica = guia.unidad || 'cartones';
        if (unidadFisica === 'kg' && cantidadKg == null) throw new ApiError(400, 'Indique cantidadKg recibida en la báscula.');
        if (unidadFisica !== 'kg' && cantidadRecibida == null) throw new ApiError(400, 'Indique la cantidad de cartones recibida.');
        const recibida = unidadFisica === 'kg' ? 0 : Number(cantidadRecibida);
        const recibidaFisica = unidadFisica === 'kg' ? Number(cantidadKg) : recibida;
        if (!Number.isFinite(recibidaFisica) || recibidaFisica < 0) throw new ApiError(400, 'El peso recibido no puede ser negativo.');
        const esperadaFisica = unidadFisica === 'kg' ? Number(guia.cantidadKgEsperada) : Number(guia.cartonesEsperados);
        const esperada = unidadFisica === 'kg' ? 0 : esperadaFisica;
        const diferenciaFisica = esperadaFisica - recibidaFisica;
        const diferencia = unidadFisica === 'kg' ? 0 : diferenciaFisica;

        // Motivo categorizado: desperdicio vs posible robo
        const opcionMotivo = clasificarDiferencia(motivoDiferencia);
        const tipoDiferencia = diferenciaFisica > 0 ? (opcionMotivo?.tipo ?? 'desperdicio')
          : diferenciaFisica < 0 ? 'sobrante' : null;
        const esIdMotivo = OPCIONES_DIFERENCIA_RECEPCION.some(o => o.id === motivoDiferencia);
        const motivoFinal = diferenciaFisica !== 0
          ? (esIdMotivo ? (opcionMotivo?.label || motivoDiferencia) : (motivoDiferencia || null))
          : null;
        if (diferenciaFisica !== 0 && !motivoFinal) throw new ApiError(400, 'Indique qué ocurrió con la diferencia recibida.');

        // 1. Recepción
        const recepcionId = crypto.randomUUID();
        await tx.insert(recepciones).values({
          id: recepcionId,
          guiaRemisionId: guiaId,
          fechaRecepcion: new Date().toISOString(),
          cantidadEsperada: esperada,
          cantidadRecibida: recibida,
          diferencia,
          cantidadKgEsperada: unidadFisica === 'kg' ? esperadaFisica : null,
          cantidadKgRecibida: unidadFisica === 'kg' ? recibidaFisica : null,
          diferenciaKg: unidadFisica === 'kg' ? diferenciaFisica : null,
          pesoBruto: pesoBruto != null ? Number(pesoBruto) : null,
          motivoDiferencia: motivoFinal,
          tipoDiferencia,
          responsableRecepcion: responsable || 'Bodeguero Actual',
          estado: diferenciaFisica === 0 ? 'Conforme' : 'ConDiferencia'
        });

        // 2. Guía → Recibida
        await tx.update(guias_remision)
          .set({
            estado: diferenciaFisica === 0 ? 'Recibida' : 'RecibidaConDiferencia',
            recibidoEn: new Date().toISOString()
          })
          .where(eq(guias_remision.id, guiaId));

        // 3. EnTransito → Bodega Central (descontar lo despachado, no solo lo recibido:
        //    la diferencia es pérdida en tránsito y se contabiliza como desperdicio)
        const enTransito = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, guia.producto), eq(inventario.ubicacion, 'EnTransito'), eq(inventario.unidad, unidadFisica))
        });
        if (!enTransito || Number(enTransito.cantidad) < esperadaFisica) throw new ApiError(409, 'El inventario en tránsito no alcanza para esta remisión. No se modificó el stock; solicita una conciliación.');
        const restante = Number(enTransito.cantidad) - esperadaFisica;
        if (restante <= 0) await tx.delete(inventario).where(eq(inventario.id, enTransito.id));
        else await tx.update(inventario)
          .set({ cantidad: restante, ultima_actualizacion: new Date().toISOString() })
          .where(eq(inventario.id, enTransito.id));

        if (recibidaFisica > 0) {
          const bodegaItem = await tx.query.inventario.findFirst({
            where: and(eq(inventario.producto, guia.producto), eq(inventario.ubicacion, 'Bodega Central'), eq(inventario.unidad, unidadFisica))
          });
          if (bodegaItem) {
            if (bodegaItem.unidad !== unidadFisica) throw new ApiError(409, `La unidad de recepción (${unidadFisica}) no coincide con el inventario de Bodega (${bodegaItem.unidad}). Realice un conteo y conversión controlados antes de mezclar unidades.`);
            await tx.update(inventario)
              .set({ cantidad: bodegaItem.cantidad + recibidaFisica, ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, bodegaItem.id));
          } else {
            await tx.insert(inventario).values({
              id: crypto.randomUUID(),
              producto: guia.producto,
              cantidad: recibidaFisica,
              unidad: unidadFisica,
              ubicacion: 'Bodega Central',
              ultima_actualizacion: new Date().toISOString()
            });
          }
        }

        // 4. Diferencia → desperdicio controlado SOLO si no es posible robo
        if (diferenciaFisica > 0 && tipoDiferencia !== 'alerta') {
          const impacto = await calcularImpactoDesperdicio(guia.producto, diferenciaFisica);
          await tx.insert(desperdicios).values({
            id: crypto.randomUUID(),
            origen: 'Remisión ' + guia.consecutivo,
            producto: guia.producto,
            lote: guia.lote || null,
            cantidad: diferenciaFisica,
            unidad: unidadFisica,
            motivo: motivoFinal || 'Diferencia en recepción',
            responsable: responsable || 'Bodeguero Actual',
            fecha: new Date().toISOString(),
            impactoFinanciero: impacto
          });
        }

        // 5. Movement record
        if (recibidaFisica > 0) await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto: guia.producto,
          cantidad: recibidaFisica,
          unidad: unidadFisica,
          tipo: 'Recepción Bodega',
          origen: 'EnTransito',
          destino: 'Bodega Central',
          fecha: new Date().toISOString(),
          referencia_id: recepcionId
        });

        // 6. La diferencia sale del tránsito como pérdida controlada (kárdex equilibrado)
        if (diferenciaFisica > 0) {
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: guia.producto,
            cantidad: diferenciaFisica,
            unidad: unidadFisica,
            tipo: 'Pérdida en Tránsito',
            origen: 'EnTransito',
            destino: 'Desperdicio',
            fecha: new Date().toISOString(),
            referencia_id: recepcionId
          });
        }

        // 7. Punto de custodia con báscula: peso de llegada a bodega
        if (pesoBruto != null) {
          await registrarPesoPunto({
            cliente: tx,
            referenciaId: recepcionId,
            tipoReferencia: 'Recepción de Remisión',
            producto: guia.producto,
            cantidadUnidades: recibidaFisica,
            pesoReal: Number(pesoBruto),
            unidad: unidadFisica,
            responsable,
            ubicacion: 'Bodega Central',
            observaciones: `Remisión ${guia.consecutivo}`
          });
        }
      });

      res.json({ success: true, message: 'Remisión recibida en bodega' });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  // Alistamiento en bodega: arma galerones de N cartones y emite etiquetas QR (nacen en bodega)
  app.post("/api/operaciones/alistamiento", requirePermission('inventario_bodega', 'create'), async (req, res) => {
    const KG_POR_ETIQUETA = 30;
    try {
      const { guiaId, producto, cartones, cantidadKg, granjaOrigen, lote, clasificacion, pesoBruto, responsable, unidad } = req.body;
      const esKgSolicitado = cantidadKg != null || unidad === 'kg';
      if (!producto || (esKgSolicitado ? cantidadKg == null : cartones == null)) {
        return res.status(400).json({ error: "Producto y cantidad son requeridos" });
      }
      const cantidadPorEtiqueta = Number(esKgSolicitado ? req.body.kgPorEtiqueta : req.body.cartonesPorGaleron) || KG_POR_ETIQUETA;
      const total = Number(esKgSolicitado ? cantidadKg : cartones);
      if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ error: "La cantidad debe ser mayor a cero" });

      const etiquetasCreadas: { id: string; codigoUnico: string; cantidad: number }[] = [];

      await db.transaction(async (tx) => {
        // 1. Validar stock en Bodega Central (las etiquetas identifican existencia ya contada)
        const unidadSolicitada = esKgSolicitado ? 'kg' : 'cartones';
        const stockBodega = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, 'Bodega Central'), eq(inventario.unidad, unidadSolicitada))
        });
        const esKg = unidadSolicitada === 'kg';
        // La cantidadKg es la masa neta de producto bajo custodia; pesoBruto
        // es una captura adicional de báscula y no debe cambiar el saldo stock.
        const cantidadValidar = total;
        if (!stockBodega || stockBodega.unidad !== (esKg ? 'kg' : 'cartones') || stockBodega.cantidad < cantidadValidar) {
          throw new ApiError(400, "Stock insuficiente en Bodega Central para alistar");
        }

        // 2. Armar galerones
        const galerones = [];
        let restante = total;
        while (restante > 0) {
          galerones.push(Math.min(cantidadPorEtiqueta, restante));
          restante -= Math.min(cantidadPorEtiqueta, restante);
        }

        const fechaDia = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const bodega = 'BOD';
        const sec = Date.now();
        // El pesoBruto recibido es del lote completo: se reparte equitativamente entre los galerones armados
        const pesoPorGaleron = pesoBruto != null ? Number(pesoBruto) / galerones.length : null;

        for (let i = 0; i < galerones.length; i++) {
          const id = crypto.randomUUID();
          const codigoUnico = `ETQ-${fechaDia}-${bodega}-${sec}-${i + 1}`;
          await tx.insert(etiquetas).values({
            id,
            codigoUnico,
            producto,
            cantidad: galerones[i],
            unidad: esKg ? 'kg' : 'cartones',
            pesoBruto: pesoPorGaleron,
            pesoNeto: esKg ? galerones[i] : null,
            saldoKg: esKg ? galerones[i] : null,
            pesoOrigen: esKg ? 'Manual' : null,
            pesoRegistradoPor: esKg ? (responsable || null) : null,
            pesoRegistradoEn: esKg ? new Date().toISOString() : null,
            pesoBodega: pesoPorGaleron,
            fechaProduccion: new Date().toISOString(),
            fechaEmpaque: new Date().toISOString(),
            granjaOrigen: granjaOrigen || null,
            galeronOrigen: `Galerón ${i + 1}`,
            clasificacion: clasificacion || null,
            estado: 'EnBodega',
            ubicacionActual: 'Bodega Central',
            lote: lote || null,
            guiaRemisionId: guiaId || null
          });
          await tx.insert(traza_etiqueta).values({
            id: crypto.randomUUID(),
            etiquetaId: id,
            tipoEvento: 'Alistamiento',
            ubicacion: 'Bodega Central',
            documentoRef: guiaId || null,
            usuarioId: responsable || null,
            fecha: new Date().toISOString(),
            observaciones: esKg ? `Etiqueta con ${galerones[i]} kg` : `Galerón armado con ${galerones[i]} cartones`
          });
          etiquetasCreadas.push({ id, codigoUnico, cantidad: galerones[i] });
        }

        // 3. Si viene guía, marcarla como Alistada
        if (guiaId) {
          const guia = await tx.query.guias_remision.findFirst({ where: eq(guias_remision.id, guiaId) });
          if (!guia) throw new ApiError(404, "Guía de remisión no encontrada");
          if (guia.estado === 'Recibida' || guia.estado === 'RecibidaConDiferencia') {
            await tx.update(guias_remision).set({ estado: 'Alistada' }).where(eq(guias_remision.id, guiaId));
          }
        }

        // 4. Punto de custodia con báscula: peso del lote alistado en bodega
        if (pesoBruto != null) {
          await registrarPesoPunto({
            cliente: tx,
            referenciaId: guiaId || null,
            tipoReferencia: 'Alistamiento',
            producto,
            cantidadUnidades: total,
            pesoReal: Number(pesoBruto),
            responsable,
            ubicacion: 'Bodega Central',
            observaciones: `${galerones.length} galerón(es) armados`
          });
        }
      });

      res.status(201).json({ success: true, message: esKgSolicitado ? `${total} kg alistados en etiquetas` : `${total} cartones alistados en galerones`, unidad: esKgSolicitado ? 'kg' : 'cartones', etiquetas: etiquetasCreadas });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  // Logistica Auditoria

}
