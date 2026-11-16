import { eq, and } from "drizzle-orm";
import * as schema from "../../db/schema";

export function registrarRutasAprobaciones(app: any, db: any, deps: { requirePermission: any; ApiError: any; httpError: any; logAudit: any; recordEventTx: any }) {
  const { aprobaciones, guias_despacho, camiones, inventario, movimientosInventario, retornos_camion, etiquetas, cierres_caja_ruta, depositos_caja } = schema;
  const { requirePermission, ApiError, httpError, logAudit, recordEventTx } = deps;
  // ==================== PHASE 5 — APROBACIONES ====================

  app.get("/api/aprobaciones", requirePermission('aprobaciones', 'view'), async (req, res) => {
    try {
      const estado = req.query.estado as string;
      const data = await db.query.aprobaciones.findMany();
      const filtered = estado ? data.filter(a => a.estado === estado) : data;
      res.json(filtered);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/aprobaciones", requirePermission(['ventas', 'aprobaciones'], 'create'), async (req, res) => {
    try {
      const { tipo, modulo, referenciaId, descripcion, datos } = req.body;
      const solicitudUsuario = String((req as any).usuario?.id || '');
      if (!tipo || !modulo || !descripcion) {
        return res.status(400).json({ error: "Faltan datos de la solicitud de aprobación" });
      }
      const id = crypto.randomUUID();
      await db.insert(aprobaciones).values({
        id, tipo, modulo, referenciaId: referenciaId || null,
        solicitudUsuario, descripcion, datos: datos ? JSON.stringify(datos) : null,
        estado: 'Pendiente', fechaSolicitud: new Date().toISOString()
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.put("/api/aprobaciones/:id", requirePermission('aprobaciones', 'approve'), async (req, res) => {
    try {
      const { id } = req.params;
      const { estado, motivoRechazo } = req.body;
      const aprobadoPor = String((req as any).usuario?.id || '');
      if (!estado) return res.status(400).json({ error: "Estado requerido" });
      if (!['Aprobado', 'Rechazado'].includes(estado)) return res.status(400).json({ error: "Estado inválido" });
      const updateData: any = { estado, aprobadoPor, fechaResolucion: new Date().toISOString() };
      if (estado === 'Rechazado') updateData.motivoRechazo = String(motivoRechazo || '').trim() || null;
      let guiaCerrada: any = null;
      let aprobacionPrev: any = null;
      let ajusteConteoAplicado: any[] = [];
      await db.transaction(async (tx: any) => {
        aprobacionPrev = await tx.query.aprobaciones.findFirst({ where: eq(aprobaciones.id, id) });
        if (!aprobacionPrev) throw new ApiError(404, 'Aprobación no encontrada');
        if (aprobacionPrev.estado !== 'Pendiente') throw new ApiError(409, `La aprobación ya fue resuelta (${aprobacionPrev.estado})`);
        if (aprobacionPrev.tipo === 'DiferenciaConteoBodega' && estado === 'Rechazado') {
          updateData.estado = 'RecuentoRequerido';
          updateData.motivoRechazo = String(motivoRechazo || '').trim() || 'Administración solicitó un nuevo conteo independiente.';
        }
        if (aprobacionPrev.tipo === 'DiferenciaConteoBodega') {
          const datos = JSON.parse(aprobacionPrev.datos || '{}');
          if (estado === 'Aprobado') {
            const segundo = datos.segundoConteo;
            if (!segundo?.usuarioId || segundo.usuarioId === datos.primerConteo?.usuarioId) throw new ApiError(409, 'No se puede aprobar: falta un segundo conteo realizado por otra persona.');
            const usuariosQueContaron = new Set([datos.primerConteo?.usuarioId, ...(datos.reconteos || []).map((c: any) => c.usuarioId), segundo.usuarioId].filter(Boolean));
            if (usuariosQueContaron.has(aprobadoPor)) throw new ApiError(403, 'La persona que contó no puede aprobar su propio ajuste de inventario.');
            const guia = await tx.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, aprobacionPrev.referenciaId) });
            const camion = guia?.camionId ? await tx.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
            if (!guia || !camion || !guia.finDiaFecha || ['Cerrada', 'CerradaConDiferencia', 'Anulada'].includes(guia.estado)) throw new ApiError(409, 'La guía ya no admite ajuste por conteo.');
            const stockCamion = await tx.query.inventario.findMany({ where: eq(inventario.ubicacion, camion.nombre) });
            const cuarentenas = await tx.query.inventario_cuarentena.findMany({ where: eq(schema.inventario_cuarentena.aprobacionId, aprobacionPrev.id) });
            if (!segundo.lineas?.length || cuarentenas.length !== segundo.lineas.length) throw new ApiError(409, 'Falta el registro de cuarentena del segundo conteo.');
            const ahora = new Date().toISOString();
            for (const linea of segundo.lineas) {
              const sistema = Number(linea.cantidadSistema);
              const contado = Number(linea.cantidadRecontada);
              const saldoCamion = stockCamion.find((i: any) => i.producto === linea.producto);
              if (!saldoCamion || Math.abs(Number(saldoCamion.cantidad) - sistema) > 0.0001) throw new ApiError(409, `El inventario de ${linea.producto} cambió desde el conteo; vuelva a verificarlo.`);
              const ubicacionCuarentena = 'Cuarentena Bodega';
              const stockCuarentena = await tx.query.inventario.findFirst({ where: and(eq(inventario.producto, linea.producto), eq(inventario.ubicacion, ubicacionCuarentena), eq(inventario.unidad, linea.unidad || 'cartones')) });
              if (contado > 0 && stockCuarentena) await tx.update(inventario).set({ cantidad: Number(stockCuarentena.cantidad) + contado, ultima_actualizacion: ahora }).where(eq(inventario.id, stockCuarentena.id));
              else if (contado > 0) await tx.insert(inventario).values({ id: crypto.randomUUID(), producto: linea.producto, cantidad: contado, unidad: linea.unidad || 'cartones', ubicacion: ubicacionCuarentena, ultima_actualizacion: ahora });
              await tx.update(inventario).set({ cantidad: 0, ultima_actualizacion: ahora }).where(eq(inventario.id, saldoCamion.id));
              const transferido = Math.min(sistema, contado);
              if (transferido > 0) await tx.insert(movimientosInventario).values({ id: crypto.randomUUID(), producto: linea.producto, cantidad: transferido, tipo: 'Retorno a Cuarentena', origen: camion.nombre, destino: ubicacionCuarentena, fecha: ahora, referencia_id: aprobacionPrev.id });
              const delta = contado - sistema;
              if (Math.abs(delta) > 0.0001) await tx.insert(movimientosInventario).values({ id: crypto.randomUUID(), producto: linea.producto, cantidad: Math.abs(delta), tipo: delta > 0 ? 'Ajuste Conteo Positivo' : 'Ajuste Conteo Negativo', origen: delta > 0 ? 'Diferencia física verificada' : camion.nombre, destino: delta > 0 ? ubicacionCuarentena : 'Diferencia de inventario', fecha: ahora, referencia_id: aprobacionPrev.id });
              if (contado > 0) await tx.insert(retornos_camion).values({
                id: crypto.randomUUID(), guiaId: guia.id, etiquetaId: null, ventaRutaId: null, fecha: ahora,
                responsable: segundo.responsable || segundo.usuarioId, producto: linea.producto, cartones: contado,
                cantidadAceptada: contado, etiquetasJson: JSON.stringify([{ producto: linea.producto, cantidad: contado, unidad: linea.unidad || 'cartones', ubicacion: ubicacionCuarentena }]),
                estado: 'AceptadoBodega', aceptadoPor: aprobadoPor, aceptadoEn: ahora, condicion: 'cuarentena', tipo: 'sobrante',
              });
              await tx.update(schema.inventario_cuarentena).set({ estado: 'Aprobada' }).where(eq(schema.inventario_cuarentena.aprobacionId, aprobacionPrev.id));
              const etiquetasProducto = await tx.query.etiquetas.findMany({ where: and(eq(etiquetas.guiaDespachoId, guia.id), eq(etiquetas.producto, linea.producto)) });
              for (const etiqueta of etiquetasProducto) {
                // La cantidad/identidad impresa nunca se reescribe por un conteo agregado.
                // Se bloquea la etiqueta anterior y se conserva evidencia ligada al caso.
                await tx.update(etiquetas).set({ estado: contado > 0 ? 'EnCuarentena' : 'DiferenciaInventario', ubicacionActual: contado > 0 ? ubicacionCuarentena : 'Diferencia de inventario', guiaDespachoId: null }).where(eq(etiquetas.id, etiqueta.id));
                await recordEventTx(tx, etiqueta.id, 'AjusteConteoAprobado', contado > 0 ? ubicacionCuarentena : 'Diferencia de inventario', aprobacionPrev.id, aprobadoPor,
                  JSON.stringify({ producto: linea.producto, cantidadEtiquetaPreservada: Number(etiqueta.cantidad), cantidadSistema: sistema, primerConteo: Number(linea.cantidadContada), segundoConteo: contado, diferenciaAprobada: delta, motivoPrimerConteo: linea.motivo || null, motivoReconteo: linea.motivoReconteo || null }));
              }
              ajusteConteoAplicado.push({ producto: linea.producto, unidad: linea.unidad || 'cartones', cantidadSistema: sistema, cantidadContada: contado, diferenciaFirmada: delta });
            }
          } else {
            await tx.update(schema.inventario_cuarentena).set({ estado: 'PendienteRevision' }).where(eq(schema.inventario_cuarentena.aprobacionId, aprobacionPrev.id));
          }
        }
        if (aprobacionPrev.tipo === 'DiferenciaCaja') {
          const cierreCaja = await tx.query.cierres_caja_ruta.findFirst({ where: eq(cierres_caja_ruta.guiaId, aprobacionPrev.referenciaId) });
          if (!cierreCaja || cierreCaja.estado !== 'DiferenciaPendiente' || cierreCaja.aprobacionId !== aprobacionPrev.id) {
            throw new ApiError(409, 'El cierre de caja vinculado ya no está pendiente de aprobación.');
          }
          if (cierreCaja.vendedorId === aprobadoPor) throw new ApiError(403, 'La persona responsable de la ruta no puede aprobar su propia diferencia de caja.');
          await tx.update(cierres_caja_ruta).set({ estado: estado === 'Aprobado' ? 'Aprobada' : 'Rechazada' }).where(eq(cierres_caja_ruta.id, cierreCaja.id));
        }
        if (aprobacionPrev.tipo === 'DiferenciaDeposito') {
          const deposito = await tx.query.depositos_caja.findFirst({ where: eq(depositos_caja.aprobacionId, aprobacionPrev.id) });
          if (!deposito || deposito.estado !== 'DiferenciaPendiente') throw new ApiError(409, 'El depósito vinculado ya no está pendiente de conciliación.');
          if (deposito.registradoPor === aprobadoPor) throw new ApiError(403, 'La persona que registró el depósito no puede aprobar su propia diferencia.');
          await tx.update(depositos_caja).set({ estado: estado === 'Aprobado' ? 'Conciliado' : 'Rechazado' }).where(eq(depositos_caja.id, deposito.id));
        }
        await tx.update(aprobaciones).set(updateData).where(and(eq(aprobaciones.id, id), eq(aprobaciones.estado, 'Pendiente')));

        // Solo una aprobación administrativa posterior al cierre con diferencia
        // puede completar la guía; una DiferenciaConteoBodega no ajusta existencias.
        if (estado === 'Aprobado' && ['MermaDescuadre', 'AjusteInventario', 'DiferenciaCuadre'].includes(aprobacionPrev.tipo)
          && aprobacionPrev.modulo === 'Logistica' && aprobacionPrev.referenciaId) {
          const guia = await tx.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, aprobacionPrev.referenciaId) });
          if (guia && guia.estado === 'CerradaConDiferencia') {
            await tx.update(guias_despacho).set({ estado: 'Cerrada', recibidoEn: new Date().toISOString() }).where(eq(guias_despacho.id, guia.id));
            guiaCerrada = guia;
          }
        }
      });
      if (guiaCerrada) await logAudit(aprobadoPor, 'Cerrar', 'GuiaDespacho', guiaCerrada.id, { estado: 'CerradaConDiferencia' }, { estado: 'Cerrada' }, 'Cuadre completado tras aprobación');
      await logAudit(aprobadoPor, estado, 'Aprobación', id, { estado: 'Pendiente' }, updateData, motivoRechazo);
      if (ajusteConteoAplicado.length) await logAudit(aprobadoPor, 'AjusteConteoFisico', 'Inventario', id, null, ajusteConteoAplicado, 'Aprobación de segundo conteo; producto retenido en cuarentena');
      res.json({ success: true, aprobadoPor, guiaCerradaId: guiaCerrada?.id || null, ajusteConteoAplicado });
    } catch (error: any) { httpError(res, error); }
  });

  app.get("/api/aprobaciones/pendientes", requirePermission('aprobaciones', 'view'), async (req, res) => {
    try {
      const data = await db.query.aprobaciones.findMany();
      const pendientes = data.filter(a => a.estado === 'Pendiente');
      res.json({ count: pendientes.length, items: pendientes });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

}
