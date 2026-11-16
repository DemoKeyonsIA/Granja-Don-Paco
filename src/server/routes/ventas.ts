import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../../db/schema";
import { saldoDe, round2, fechaVencimientoDe } from "../../lib/cobranza";
import { siguienteConsecutivo, getClienteConsumidorFinal } from "../services/consecutivos";

export function registrarRutasComerciales(app: any, db: any, deps: { requirePermission: any; ApiError: any; getPrecioParaProducto: any; logAudit: any; recordEvent: any }) {
  const { facturas, detallesFactura, inventario, clientes, guias_despacho, camiones, etiquetas, pagos } = schema;
  const { requirePermission, ApiError, getPrecioParaProducto, logAudit, recordEvent } = deps;
  /** Suma de `pagos.monto` de una factura. Base del saldo pendiente. */
  async function totalPagado(facturaId: string): Promise<number> {
    const lista = await db.query.pagos.findMany({ where: eq(pagos.facturaId, facturaId) });
    return round2(lista.reduce((a: number, p: any) => a + Number(p.monto || 0), 0));
  }

  app.post("/api/ventas", requirePermission(['ventas', 'facturacion'], 'create'), async (req, res) => {
    try {
      const { factura, detalles } = req.body;
      const usuario = (req as any).usuario; // resuelto por requirePermission (Bearer o x-user-id → BD)
      const usuarioId = (usuario && usuario.id) || 'system';
      
      if (!factura || !Array.isArray(detalles)) {
        return res.status(400).json({ error: "Datos de factura y detalles inválidos" });
      }

      // Un body incompleto es un 400, no un 500. Antes `fecha`, `subtotal`,
      // `descuento`, `condicion_pago` y `estado` llegaban como `undefined` y
      // SQLite contestaba NOT NULL; y la búsqueda de cliente con
      // `eq(clientes.id, undefined)` —que ni siquiera es un valor legal para
      // Drizzle— reventaba con el volcado del SQL en el mensaje. Eso convertía un
      // `curl` mal formado en un error de servidor ilegible.
      //
      // Los defaults que se rellenan aquí son los que el servidor puede saber
      // mejor que el cliente: la fecha es ahora porque la factura nace ahora, y el
      // descuento es cero porque no hay descuento. Lo que sí es verdad del negocio
      // —a quién se factura y en qué plazo— se exige, en vez de inventarlo.
      const faltan: string[] = [];
      if (!factura.clienteId) faltan.push('factura.clienteId');
      if (!factura.condicion_pago) faltan.push('factura.condicion_pago');
      if (detalles.length === 0) faltan.push('detalles (al menos una línea)');
      detalles.forEach((det: any, i: number) => {
        if (!det?.producto) faltan.push(`detalles[${i}].producto`);
        if (det?.cantidad === undefined || det?.cantidad === null) faltan.push(`detalles[${i}].cantidad (kg)`);
      });
      if (faltan.length) {
        return res.status(400).json({ error: `Faltan datos de la venta: ${faltan.join(', ')}` });
      }

      if (!factura.fecha) factura.fecha = new Date().toISOString();
      if (factura.descuento === undefined || factura.descuento === null) factura.descuento = 0;
      if (!factura.estado) factura.estado = 'Pendiente';

      const facturaId = factura.id || crypto.randomUUID();
      factura.id = facturaId;

      // Validar vendedor y cliente existen (FKs NOT NULL de facturas). Un id del body
      // inexistente antes derivaba en 500 por violación de foreign key en BDs con FKs activas.
      // R5: sin fallback hardcodeado a '3'; un Vendedor factura SIEMPRE a su propio id,
      // los demás roles pueden delegar a otro usuario válido (o default a ellos mismos).
      const vendedorId = ['Vendedor', 'Facturador', 'Camionero', 'Comercial'].includes(usuario?.role)
        ? usuario.id
        : (factura.vendedorId || usuario?.id);
      const [vendedorValido] = await db.select().from(schema.users).where(eq(schema.users.id, vendedorId)).limit(1);
      if (!vendedorValido) {
        return res.status(400).json({ error: `Vendedor no existe: ${vendedorId}` });
      }
      // R2: el cliente sentinel 'consumidor-final' se auto-crea (FK satisfecha) — no se rechaza.
      const esConsumidorFinal = factura.clienteId === 'consumidor-final';
      const clienteValido = factura.clienteId && !esConsumidorFinal
        ? await db.query.clientes.findFirst({ where: eq(clientes.id, factura.clienteId) })
        : null;
      if (factura.clienteId && !esConsumidorFinal && !clienteValido) {
        return res.status(400).json({ error: `Cliente no existe: ${factura.clienteId}` });
      }

      // F2: resolve truck from guía despacho (or camion_id) — bug antiguo usaba 'Camión Ruta 1' hardcodeado
      let camionNombre = 'Camión Ruta 1';
      let camionResueltoId: string | null = null;
      let guiaEnKg = false;
      const etiquetasEntregadas: { etiquetaId: string }[] = [];
      if (factura.guiaId) {
        const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, factura.guiaId) });
        if (guia?.camionId) {
          guiaEnKg = guia.totalKg != null;
          const camion = await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) });
          camionNombre = camion?.nombre || 'Camión Ruta 1';
          camionResueltoId = guia.camionId || null;
        }
      } else if (factura.camionId) {
        const camion = await db.query.camiones.findFirst({ where: eq(camiones.id, factura.camionId) });
        camionNombre = camion?.nombre || 'Camión Ruta 1';
        camionResueltoId = factura.camionId;
      }

      // PHASE 5: Credit limit validation
      if (factura.condicion_pago === 'Credito') {
        const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, factura.clienteId) });
        if (cliente) {
          const nuevoSaldo = Number(cliente.saldo_pendiente || 0) + Number(factura.total);
          const limite = Number(cliente.limite_credito || 0);
          if (limite > 0 && nuevoSaldo > limite) {
            return res.status(400).json({ 
              error: `Cliente excede límite de crédito. Saldo actual: ${cliente.saldo_pendiente}, Límite: ${limite}, Total factura: ${factura.total}`,
              requiereAprobacion: true,
              tipoAprobacion: 'DescuentoNoAutorizado'
            });
          }
        }
      }

      // El servidor resuelve la banda autorizada de cada línea. El precio
      // solicitado por el cliente solo se acepta dentro del piso y el techo.
      const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, factura.clienteId) });
      const clienteRuta = cliente?.ruta || factura.ruta;
      let preciosAplicados: any[] = [];
      let descuentoMaximoAutorizado = 0;
      let subtotalResuelto = 0;
      for (const det of detalles) {
        const precioLista = await getPrecioParaProducto(det.producto, factura.clienteId, clienteRuta);
        if (!precioLista) {
          return res.status(400).json({ error: `Sin precio autorizado para ${det.producto}. Consulte al administrador.` });
        }
        const precioSolicitado = det.precio_unitario != null && Number(det.precio_unitario) > 0
          ? Number(det.precio_unitario) : Number(precioLista.precio);
        if (!Number.isFinite(precioSolicitado) || precioSolicitado < precioLista.precioMinimo - 0.01 || precioSolicitado > precioLista.precioMaximo + 0.01) {
          return res.status(409).json({ error: `Precio fuera del rango autorizado para ${det.producto}. Rango: ₡${Number(precioLista.precioMinimo).toLocaleString('es-CR')} a ₡${Number(precioLista.precioMaximo).toLocaleString('es-CR')} (${precioLista.listaUsada}).` });
        }
        det.precio_unitario = precioSolicitado;
        det.subtotal = Number(det.cantidad) * precioSolicitado;
        det.resolucionPrecio = {
          version: 1, resueltoEn: new Date().toISOString(), producto: det.producto, unidad: 'kg',
          precioObjetivo: precioLista.precio, precioAplicado: precioSolicitado,
          precioMinimo: precioLista.precioMinimo, precioMaximo: precioLista.precioMaximo,
          descuentoMaximoPct: precioLista.descuentoMaximo, regla: precioLista.listaUsada,
        };
        preciosAplicados.push(det.resolucionPrecio);
        const descuentoPorPiso = Math.max(0, Number(det.subtotal) - Number(det.cantidad) * Number(precioLista.precioMinimo));
        const descuentoPorPorcentaje = Math.max(0, Number(det.subtotal) * Math.max(0, Number(precioLista.descuentoMaximo || 0)) / 100);
        descuentoMaximoAutorizado += Math.min(descuentoPorPiso, descuentoPorPorcentaje);
        subtotalResuelto += Number(det.subtotal);
      }

      if (Number(factura.descuento || 0) < 0 || Number(factura.descuento || 0) - descuentoMaximoAutorizado > 0.01) {
        return res.status(409).json({ error: `Descuento fuera del rango autorizado. Máximo permitido: ₡${Math.floor(descuentoMaximoAutorizado).toLocaleString('es-CR')}.` });
      }
      factura.subtotal = subtotalResuelto;
      factura.total = subtotalResuelto - Number(factura.descuento || 0);
      if (factura.condicion_pago === 'Credito' && cliente) {
        const nuevoSaldo = Number(cliente.saldo_pendiente || 0) + Number(factura.total);
        const limite = Number(cliente.limite_credito || 0);
        if (limite > 0 && nuevoSaldo > limite) {
          return res.status(409).json({ error: `Cliente excede límite de crédito. Saldo actual: ${cliente.saldo_pendiente}, límite: ${limite}, total autorizado: ${factura.total}`, requiereAprobacion: true, tipoAprobacion: 'LimiteCredito' });
        }
      }

      // `precio_unitario` no se exige al cliente porque una lista de precios puede
      // aportarlo, pero después de intentar eso sí tiene que existir: `subtotal` y
      // `precio_unitario` son NOT NULL en detalles_factura, y sin precio la línea
      // era un 500. El subtotal de cada línea se deriva aquí para que ninguna
      // dependable del cliente lo deje en null.
      const sinPrecio: string[] = [];
      for (const det of detalles) {
        if (det.precio_unitario === undefined || det.precio_unitario === null) sinPrecio.push(String(det.producto));
      }
      if (sinPrecio.length) {
        return res.status(400).json({
          error: `Sin precio unitario y sin lista de precios que lo resuelva: ${sinPrecio.join(', ')}`,
        });
      }
      for (const det of detalles) {
        const precio = Number(det.precio_unitario);
        det.precio_unitario = precio;
        if (det.subtotal === undefined || det.subtotal === null) det.subtotal = Number(det.cantidad) * precio;
      }

      // El total se acepta si viene, pero se completa si no: un total ausente era
      // NOT NULL y la factura se perdía entera aunque las líneas fueran correctas.
      if (factura.subtotal === undefined || factura.subtotal === null) {
        factura.subtotal = detalles.reduce((a: number, d: any) => a + Number(d.subtotal), 0);
      }
      if (factura.total === undefined || factura.total === null) {
        factura.total = Number(factura.subtotal) - Number(factura.descuento || 0);
      }

      let consecutivoAsignado = '';
      await db.transaction(async (tx) => {
        // R1: el consecutivo se expide en el backend (nunca lo reparte el cliente) —
        // elimina los FAC duplicados del frontend (`array.length + 1`).
        const consec = await siguienteConsecutivo(tx, 'FACTURA', 'GLOBAL', 'FAC', 4);
        consecutivoAsignado = consec.s;
        // R2: garantiza la fila consumidor final para satisfacer la FK de facturas.
        if (esConsumidorFinal) await getClienteConsumidorFinal(tx);

        // 1. Insert Factura
        await tx.insert(facturas).values({
          id: factura.id,
          consecutivo: consecutivoAsignado,
          fecha: factura.fecha,
          // Vencimiento resuelto al crear, para que el aging no dependa de
          // recalcularlo cada lectura. `Credito` no tiene plazo fijo definido en
          // la app, así que vence el mismo día y no se inventa ninguno.
          fechaVencimiento: fechaVencimientoDe(factura as any) || null,
          clienteId: factura.clienteId,
          vendedorId,
          subtotal: factura.subtotal,
          descuento: factura.descuento,
          total: factura.total,
          condicion_pago: factura.condicion_pago,
          metodo_pago: factura.metodo_pago,
          estado: factura.estado,
          guiaId: factura.guiaId || null,
          camionId: camionResueltoId
        });

        // 2. Update client saldo if credit sale
        if (factura.condicion_pago === 'Credito' && cliente) {
          await tx.update(clientes).set({
            saldo_pendiente: Number(cliente.saldo_pendiente || 0) + Number(factura.total)
          }).where(eq(clientes.id, factura.clienteId));
        }

        // 3. Insert Detalles & Update Inventario
        for (const det of detalles) {
          await tx.insert(detallesFactura).values({
            id: crypto.randomUUID(),
            facturaId: factura.id,
            producto: det.producto,
            cantidad: det.cantidad,
            precio_unitario: det.precio_unitario,
            subtotal: det.subtotal,
            resolucionPrecioJson: JSON.stringify(det.resolucionPrecio),
          });

          const inventoryItem = await tx.query.inventario.findFirst({
            where: and(
              eq(inventario.producto, det.producto),
              eq(inventario.ubicacion, camionNombre),
              eq(inventario.unidad, guiaEnKg ? 'kg' : 'cartones')
            )
          });

          if (inventoryItem) {
            if (inventoryItem.cantidad < det.cantidad) {
              throw new Error(`Inventario insuficiente para ${det.producto}`);
            }
            await tx.update(inventario)
              .set({ cantidad: inventoryItem.cantidad - det.cantidad })
              .where(eq(inventario.id, inventoryItem.id));
          }

          if (det.etiquetaId) {
            const etiqueta = await tx.query.etiquetas.findFirst({ where: eq(etiquetas.id, det.etiquetaId) });
            if (!etiqueta || (factura.guiaId && etiqueta.guiaDespachoId !== factura.guiaId)) {
              throw new ApiError(409, `La etiqueta ${det.etiquetaId} no corresponde a la guía de la factura`);
            }
            const saldoEtiqueta = guiaEnKg
              ? Number(etiqueta.saldoKg ?? etiqueta.pesoNeto ?? 0)
              : Number(etiqueta.cantidad);
            if (etiqueta.estado !== 'Cargada' || Number(det.cantidad) > saldoEtiqueta + 0.0001) {
              throw new ApiError(409, `Cantidad o estado no válido para la etiqueta ${etiqueta.codigoUnico}`);
            }
            const restanteEtiqueta = Math.max(0, saldoEtiqueta - Number(det.cantidad));
            if (restanteEtiqueta <= 0) {
              await tx.update(etiquetas).set({ estado: 'Entregada', ubicacionActual: camionNombre, ...(guiaEnKg ? { saldoKg: 0 } : {}) }).where(eq(etiquetas.id, etiqueta.id));
              etiquetasEntregadas.push({ etiquetaId: etiqueta.id });
            } else if (guiaEnKg) {
              await tx.update(etiquetas).set({ saldoKg: restanteEtiqueta, ubicacionActual: camionNombre }).where(eq(etiquetas.id, etiqueta.id));
            } else {
              await tx.update(etiquetas).set({ cantidad: restanteEtiqueta, ubicacionActual: camionNombre }).where(eq(etiquetas.id, etiqueta.id));
            }
          }
        }
      });

      // PHASE 5: Log audit
      await logAudit(usuarioId, 'Crear', 'Factura', factura.id, null, { total: factura.total, cliente: factura.clienteId, condicion: factura.condicion_pago });

      // Traza de entregas (fuera de la transacción para evitar SQLITE_BUSY)
      for (const e of etiquetasEntregadas) {
        await recordEvent(e.etiquetaId, 'Entregada Venta', camionNombre, factura.guiaId || 'FACT-' + factura.id, usuarioId);
      }

      res.status(200).json({ 
        success: true, 
        consecutivo: consecutivoAsignado,
        message: 'Factura creada exitosamente',
        preciosAplicados: preciosAplicados.length > 0 ? preciosAplicados : undefined
      });
    } catch (error: any) {
      console.error("Error creating venta:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });




  app.get("/api/facturas", requirePermission(['facturacion', 'dashboard'], 'view'), async (req, res) => {
    try {
      const data = await db.query.facturas.findMany({
        
      });
      const facturaIds = data.map((factura: any) => factura.id);
      const [pagos, detalles] = await Promise.all([
        db.query.pagos.findMany(),
        facturaIds.length
          ? db.query.detallesFactura.findMany({ where: inArray(detallesFactura.facturaId, facturaIds) })
          : Promise.resolve([]),
      ]);
      const pagadoPorFactura = new Map<string, number>();
      for (const pago of pagos) {
        pagadoPorFactura.set(pago.facturaId, (pagadoPorFactura.get(pago.facturaId) || 0) + Number(pago.monto || 0));
      }
      const detallesPorFactura = new Map<string, any[]>();
      for (const detalle of detalles) {
        const lista = detallesPorFactura.get(detalle.facturaId) || [];
        lista.push({
          producto: detalle.producto,
          cantidad: Number(detalle.cantidad || 0),
          precio_unitario: Number(detalle.precio_unitario || 0),
          subtotal: Number(detalle.subtotal || 0),
        });
        detallesPorFactura.set(detalle.facturaId, lista);
      }
      res.json(data.map((factura: any) => {
        const pagado = Number(pagadoPorFactura.get(factura.id) || 0);
        return {
          ...factura,
          detalles: detallesPorFactura.get(factura.id) || [],
          pagado: factura.estado === 'Pagada' ? Number(factura.total || 0) : pagado,
          saldoPendiente: saldoDe(factura, pagado),
        };
      }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Registrar pago de una cuenta por cobrar.
  // Un pago es append-only: cada uno es una fila en `pagos` y el saldo de la
  // factura es `total - SUM(pagos.monto)`. Antes ponía `estado = 'Pagada'` sin
  // más, así que un pago parcial marcaba la factura entera como pagada y no
  // quedaba historial.
  app.post("/api/pagos", requirePermission(['facturacion', 'ventas'], 'create'), async (req, res) => {
    try {
      const { facturaId, metodoPago, monto, nota } = req.body;
      const rawIdempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
      const idempotencyKey = rawIdempotencyKey == null ? null : String(rawIdempotencyKey).trim();
      if (idempotencyKey !== null && (!idempotencyKey || idempotencyKey.length > 160)) {
        return res.status(400).json({ error: "Idempotency-Key debe tener entre 1 y 160 caracteres" });
      }
      // El autor del pago es el autenticado, nunca uno del body: aceptar el
      // `usuarioId` del body firmaría la auditoría de un cobro ajeno.
      const usuarioId = ((req as any).usuario && (req as any).usuario.id) || 'system';
      if (!facturaId) return res.status(400).json({ error: "facturaId requerido" });

      // Un reintento confirmado devuelve el pago original y nunca vuelve a
      // tocar los saldos de la factura o del cliente.
      if (idempotencyKey) {
        const pagoExistente = await db.query.pagos.findFirst({ where: eq(pagos.idempotencyKey, idempotencyKey) });
        if (pagoExistente) {
          const mismoIntento = pagoExistente.facturaId === facturaId
            && Number(pagoExistente.monto) === round2(Number(monto ?? pagoExistente.monto))
            && (pagoExistente.metodo ?? null) === (metodoPago ?? null)
            && (pagoExistente.usuarioId ?? null) === (usuarioId ?? null);
          if (!mismoIntento) return res.status(409).json({ error: "Idempotency-Key ya fue usada para otro pago" });
          const facturaExistente = await db.query.facturas.findFirst({ where: eq(facturas.id, facturaId) });
          if (!facturaExistente) return res.status(404).json({ error: "Factura no encontrada" });
          const pagadoActual = await totalPagado(facturaId);
          return res.json({
            ok: true, repetido: true,
            pago: { id: pagoExistente.id, facturaId, monto: Number(pagoExistente.monto), metodo: pagoExistente.metodo ?? null },
            pagado: pagadoActual, saldo: saldoDe(facturaExistente as any, pagadoActual), factura: facturaExistente,
          });
        }
      }

      const factura = await db.query.facturas.findFirst({ where: eq(facturas.id, facturaId) });
      if (!factura) return res.status(404).json({ error: "Factura no encontrada" });
      if (factura.estado === 'Anulada') {
        // Una factura anulada no debe dinero; aceptarle un pago la reviviría
        // como "Pagada" y devolvería una cartera que nunca existió.
        return res.status(409).json({ error: "No se puede pagar una factura anulada" });
      }

      const pagadoPrevio = await totalPagado(facturaId);
      const saldoPrevio = saldoDe(factura as any, pagadoPrevio);
      if (saldoPrevio <= 0) {
        return res.status(409).json({ error: "La factura ya está saldada" });
      }

      const montoPago = monto === undefined || monto === null || Number(monto) <= 0
        ? saldoPrevio
        : round2(Number(monto));
      if (!Number.isFinite(montoPago) || montoPago <= 0) {
        return res.status(400).json({ error: "monto inválido" });
      }
      if (montoPago > saldoPrevio) {
        return res.status(400).json({
          error: `El monto (${montoPago}) supera el saldo pendiente (${saldoPrevio})`,
        });
      }

      const pagoId = crypto.randomUUID();
      const saldoRestante = round2(saldoPrevio - montoPago);
      // Solo queda `Pagada` cuando no debe nada. Antes cualquier monto la marcaba.
      const estadoResultante = saldoRestante <= 0 ? 'Pagada' : factura.estado;

      await db.transaction(async (tx) => {
        await tx.insert(pagos).values({
          id: pagoId,
          facturaId,
          fecha: new Date().toISOString().slice(0, 10),
          monto: montoPago,
          metodo: metodoPago ?? null,
          usuarioId: usuarioId ?? null,
          nota: nota ?? null,
          idempotencyKey,
        });

        await tx.update(facturas).set({
          estado: estadoResultante,
          ...(metodoPago ? { metodo_pago: metodoPago } : {}),
        }).where(eq(facturas.id, facturaId));

        // El saldo del cliente baja por lo efectivamente pagado, no por el total.
        if (factura.condicion_pago === 'Credito') {
          await tx.update(clientes).set({
          saldo_pendiente: sql`GREATEST(0, COALESCE(saldo_pendiente, 0) - ${montoPago})`,
          }).where(eq(clientes.id, factura.clienteId));
        }
      });

      await logAudit(
        usuarioId,
        'Pago registrado',
        'Cobranza',
        facturaId,
        { estado: factura.estado, saldo: saldoPrevio },
        { estado: estadoResultante, saldo: saldoRestante },
        saldoRestante > 0
          ? `Pago parcial: ${montoPago} de ${saldoPrevio}`
          : `Pago total: ${montoPago}`
      );

      const actualizada = await db.query.facturas.findFirst({ where: eq(facturas.id, facturaId) });
      res.json({
        ok: true,
        pago: { id: pagoId, facturaId, monto: montoPago, metodo: metodoPago ?? null },
        pagado: round2(pagadoPrevio + montoPago),
        saldo: saldoRestante,
        factura: actualizada,
      });
    } catch (error: any) {
      // Si dos reintentos concurrentes compiten, el índice único evita la
      // segunda escritura. Se relee para responder con el resultado original.
      const message = String(error?.message || '');
      if (message.includes('idx_pagos_idempotency_key') || message.includes('pagos.idempotency_key')) {
        const key = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim();
        if (key) {
          const pago = await db.query.pagos.findFirst({ where: eq(pagos.idempotencyKey, key) });
          if (pago && pago.facturaId === req.body.facturaId
            && Number(pago.monto) === round2(Number(req.body.monto ?? pago.monto))) {
            const factura = await db.query.facturas.findFirst({ where: eq(facturas.id, pago.facturaId) });
            const pagado = await totalPagado(pago.facturaId);
            if (factura) return res.json({ ok: true, repetido: true, pago: { id: pago.id, facturaId: pago.facturaId, monto: Number(pago.monto), metodo: pago.metodo ?? null }, pagado, saldo: saldoDe(factura as any, pagado), factura });
          }
        }
      }
      res.status(500).json({ error: error.message });
    }
  });

  /** Historial de pagos de una factura, del más reciente al más antiguo. */
  app.get("/api/facturas/:id/pagos", requirePermission(['facturacion', 'finanzas_resumen'], 'view'), async (req, res) => {
    try {
      const { id } = req.params;
      const factura = await db.query.facturas.findFirst({ where: eq(facturas.id, id) });
      if (!factura) return res.status(404).json({ error: "Factura no encontrada" });

      const lista = await db.query.pagos.findMany({ where: eq(pagos.facturaId, id) });
      const pagado = lista.reduce((a: number, p: any) => a + Number(p.monto || 0), 0);

      res.json({
        pagos: lista.sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha))),
        pagado: round2(pagado),
        saldo: saldoDe(factura as any, pagado),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
