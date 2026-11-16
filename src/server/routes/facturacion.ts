import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { siguienteConsecutivo, getClienteConsumidorFinal } from '../services/consecutivos';

/** Registra documentos fiscales, XML, Hacienda simulado, notas de crédito y consolidación de ruta. */
export function registrarRutasFacturacion(app: any, db: any, requirePermission: (...args: any[]) => any, testMode: boolean, logAudit: (...args: any[]) => Promise<void>) {
  const { facturas, detallesFactura, facturas_electronicas, guias_despacho, ventas_ruta, ventas_ruta_kg } = schema;
  // Generar documento fiscal (Borrador)
  app.post("/api/facturacion/crear-documento", requirePermission(['facturacion', 'ventas'], 'create'), async (req, res) => {
    let idempotencyKey = '';
    let idempotencyPayload = '';
    try {
      const { facturaId, tipoDocumento, emisorNombre, emisorCedula, emisorCorreo, receptorNombre, receptorCedula, receptorCorreo, condicionPago, medioPago, ambiente, proveedor } = req.body;
      if (!facturaId || !['Factura', 'Tiquete', 'NotaCredito'].includes(tipoDocumento) || !emisorNombre || !emisorCedula) {
        return res.status(400).json({ error: "Faltan datos requeridos del documento fiscal" });
      }

      idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || `documento:${facturaId}:${tipoDocumento}`).trim();
      if (!idempotencyKey || idempotencyKey.length > 160) return res.status(400).json({ error: 'Idempotency-Key debe tener entre 1 y 160 caracteres' });

      // Fetch the parent factura for amounts
      const facturaOriginal = await db.query.facturas.findFirst({
        where: eq(facturas.id, facturaId)
      });

      if (!facturaOriginal) {
        return res.status(404).json({ error: "Factura original no encontrada" });
      }

      const payload = {
        facturaId: String(facturaId), tipoDocumento, emisorNombre: String(emisorNombre).trim(), emisorCedula: String(emisorCedula).trim(),
        emisorCorreo: emisorCorreo ? String(emisorCorreo).trim() : null,
        receptorNombre: receptorNombre ? String(receptorNombre).trim() : null,
        receptorCedula: receptorCedula ? String(receptorCedula).trim() : null,
        receptorCorreo: receptorCorreo ? String(receptorCorreo).trim() : null,
        condicionPago: condicionPago || facturaOriginal.condicion_pago,
        medioPago: medioPago || null, ambiente: ambiente || 'Pruebas', proveedor: proveedor || null,
      };
      idempotencyPayload = JSON.stringify(payload);

      const porClave = await db.query.facturas_electronicas.findFirst({ where: eq(facturas_electronicas.idempotencyKey, idempotencyKey) });
      if (porClave && (porClave.facturaId !== facturaId || porClave.tipoDocumento !== tipoDocumento || porClave.idempotencyPayload !== idempotencyPayload)) {
        return res.status(409).json({ error: 'Idempotency-Key ya fue usada para otro contenido fiscal' });
      }
      const documentosMismoTipo = await db.query.facturas_electronicas.findMany({ where: and(eq(facturas_electronicas.facturaId, facturaId), eq(facturas_electronicas.tipoDocumento, tipoDocumento)) });
      const existente = porClave || documentosMismoTipo[0];
      if (existente) {
        const coincideLegacy = !existente.idempotencyPayload
          && existente.emisorNombre === payload.emisorNombre && existente.emisorCedula === payload.emisorCedula
          && (existente.emisorCorreo || null) === payload.emisorCorreo
          && (existente.receptorNombre || null) === payload.receptorNombre
          && (existente.receptorCedula || null) === payload.receptorCedula
          && (existente.receptorCorreo || null) === payload.receptorCorreo
          && existente.condicionPago === payload.condicionPago && (existente.medioPago || null) === payload.medioPago
          && (existente.ambiente || 'Pruebas') === payload.ambiente && (existente.proveedor || null) === payload.proveedor
          && Number(existente.subtotal) === Number(facturaOriginal.subtotal)
          && Number(existente.descuento || 0) === Number(facturaOriginal.descuento || 0)
          && Number(existente.total) === Number(facturaOriginal.total);
        if (existente.idempotencyPayload !== idempotencyPayload && !coincideLegacy) {
          return res.status(409).json({ error: 'Ya existe un documento de este tipo para la factura con otros datos. Revise el documento existente antes de reintentar.' });
        }
        if (coincideLegacy && !existente.idempotencyKey) {
          await db.update(facturas_electronicas).set({ idempotencyKey, idempotencyPayload })
            .where(eq(facturas_electronicas.id, existente.id));
        }
        return res.status(200).json({ success: true, repetido: true, id: existente.id, consecutivo: existente.consecutivo, clave: existente.clave });
      }

      const tipoPrefix = tipoDocumento === 'Factura' ? 'FE' : tipoDocumento === 'Tiquete' ? 'TE' : 'NC';
      const documentoId = crypto.randomUUID();
      const hoy = new Date().toISOString();
      let consecutivoFinal = '';
      let claveFinal = '';

      // R1: consecutivo por serie (DOCUMENTO_FISCAL + tipo) vía tabla consecutivos,
      // no por count+1 de filas (raza / números repetidos).
      await db.transaction(async (tx) => {
        const consec = await siguienteConsecutivo(tx, 'DOCUMENTO_FISCAL', tipoDocumento, tipoPrefix, 10);
        consecutivoFinal = consec.s;
        claveFinal = `${emisorCedula.replace(/-/g, '')}${hoy.slice(0, 10).replace(/-/g, '')}${consecutivoFinal.replace(/-/g, '')}`;

        await tx.insert(facturas_electronicas).values({
          id: documentoId,
          facturaId: payload.facturaId,
          tipoDocumento: payload.tipoDocumento,
          consecutivo: consecutivoFinal,
          clave: claveFinal,
          fechaEmision: hoy,
          emisorNombre: payload.emisorNombre,
          emisorCedula: payload.emisorCedula,
          emisorCorreo: payload.emisorCorreo,
          receptorNombre: payload.receptorNombre,
          receptorCedula: payload.receptorCedula,
          receptorCorreo: payload.receptorCorreo,
          subtotal: facturaOriginal.subtotal,
          descuento: facturaOriginal.descuento,
          total: facturaOriginal.total,
          condicionPago: payload.condicionPago,
          medioPago: payload.medioPago,
          estado: 'Borrador',
          ambiente: payload.ambiente,
          proveedor: payload.proveedor,
          idempotencyKey,
          idempotencyPayload,
        });
      });

      res.status(201).json({ success: true, id: documentoId, consecutivo: consecutivoFinal, clave: claveFinal });
    } catch (error: any) {
      const message = String(error?.message || '');
      if (message.includes('idx_facturas_electronicas_idempotency_key') || message.includes('idx_facturas_electronicas_factura_tipo_idem')) {
        const existente = await db.query.facturas_electronicas.findFirst({ where: eq(facturas_electronicas.idempotencyKey, idempotencyKey) });
        if (existente && existente.idempotencyPayload === idempotencyPayload) {
          return res.status(200).json({ success: true, repetido: true, id: existente.id, consecutivo: existente.consecutivo, clave: existente.clave });
        }
        const facturaId = req.body?.facturaId;
        const tipoDocumento = req.body?.tipoDocumento;
        if (facturaId && tipoDocumento) {
          const mismoDocumento = await db.query.facturas_electronicas.findMany({ where: and(eq(facturas_electronicas.facturaId, facturaId), eq(facturas_electronicas.tipoDocumento, tipoDocumento)) });
          const coincide = mismoDocumento.find((d: any) => d.idempotencyPayload === idempotencyPayload);
          if (coincide) return res.status(200).json({ success: true, repetido: true, id: coincide.id, consecutivo: coincide.consecutivo, clave: coincide.clave });
        }
        return res.status(409).json({ error: 'Idempotency-Key ya fue usada para otro contenido fiscal' });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Generar XML del documento fiscal
  app.post("/api/facturacion/generar-xml", requirePermission('facturacion', 'create'), async (req, res) => {
    try {
      const { documentoId } = req.body;

      if (!documentoId) {
        return res.status(400).json({ error: "Falta documentoId" });
      }

      const doc = await db.query.facturas_electronicas.findFirst({
        where: eq(facturas_electronicas.id, documentoId)
      });

      if (!doc) return res.status(404).json({ error: "Documento fiscal no encontrado" });

      if (doc.xmlGenerado) {
        return res.json({ success: true, repetido: true, xml: doc.xmlGenerado, estado: doc.estado });
      }
      if (doc.estado !== 'Borrador') {
        return res.status(409).json({ error: `No se puede generar XML desde el estado ${doc.estado}` });
      }

      // Build XML for Costa Rica electronic invoice (simplified)
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FacturaElectronica xmlns="https://www.hacienda.go.cr/dte/0.0.0">
  <Clave>${doc.clave}</Clave>
  <NumeroConsecutivo>${doc.consecutivo}</NumeroConsecutivo>
  <FechaEmision>${doc.fechaEmision}</FechaEmision>
  <Emisor>
    <Nombre>${doc.emisorNombre}</Nombre>
    <Identificacion>${doc.emisorCedula}</Identificacion>
    ${doc.emisorCorreo ? `<CorreoElectronico>${doc.emisorCorreo}</CorreoElectronico>` : ''}
  </Emisor>
  ${doc.receptorNombre ? `<Receptor>
    <Nombre>${doc.receptorNombre}</Nombre>
    ${doc.receptorCedula ? `<Identificacion>${doc.receptorCedula}</Identificacion>` : ''}
    ${doc.receptorCorreo ? `<CorreoElectronico>${doc.receptorCorreo}</CorreoElectronico>` : ''}
  </Receptor>` : ''}
  <ResumenFactura>
    <CodigoMoneda>CRC</CodigoMoneda>
    <TotalServGravados>${doc.subtotal}</TotalServGravados>
    <TotalDescuentos>${doc.descuento || 0}</TotalDescuentos>
    <TotalVentas>${doc.total}</TotalVentas>
    <TotalImpuestos>${doc.impuestos || 0}</TotalImpuestos>
    <TotalComprobante>${doc.total}</TotalComprobante>
  </ResumenFactura>
  <MedioPago>${doc.medioPago || 'Efectivo'}</MedioPago>
  <CondicionVenta>${doc.condicionPago}</CondicionVenta>
</FacturaElectronica>`;

      await db.update(facturas_electronicas)
        .set({ xmlGenerado: xml, estado: 'Pendiente' })
        .where(eq(facturas_electronicas.id, documentoId));

      res.json({ success: true, xml });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Enviar a proveedor/Hacienda (simulado)
  app.post("/api/facturacion/enviar", requirePermission('facturacion', 'create'), async (req, res) => {
    try {
      const { documentoId } = req.body;

      if (!documentoId) {
        return res.status(400).json({ error: "Falta documentoId" });
      }

      const doc = await db.query.facturas_electronicas.findFirst({
        where: eq(facturas_electronicas.id, documentoId)
      });

      if (!doc) return res.status(404).json({ error: "Documento fiscal no encontrado" });

      if (!doc.xmlGenerado) {
        return res.status(400).json({ error: "Debe generar el XML primero" });
      }

      if (doc.estado === 'Enviado') return res.json({ success: true, repetido: true, message: 'El documento ya fue enviado' });
      if (['Aceptado', 'Rechazado'].includes(doc.estado)) {
        return res.status(409).json({ error: `El documento ya tiene respuesta ${doc.estado}; no se enviará de nuevo` });
      }
      if (!['Pendiente', 'Error'].includes(doc.estado)) {
        return res.status(409).json({ error: `No se puede enviar un documento en estado ${doc.estado}` });
      }

      // Simulate sending to Hacienda/provider
      await db.update(facturas_electronicas)
        .set({ 
          estado: 'Enviado',
          fechaEnvio: new Date().toISOString(),
          xmlFirmado: doc.xmlGenerado // Simulated signed XML
        })
        .where(eq(facturas_electronicas.id, documentoId));

      res.json({ success: true, message: 'Documento enviado al proveedor exitosamente' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Consultar estado / Simular respuesta de Hacienda
  app.post("/api/facturacion/consultar-estado", requirePermission('facturacion', 'create'), async (req, res) => {
    try {
      const { documentoId } = req.body;

      if (!documentoId) {
        return res.status(400).json({ error: "Falta documentoId" });
      }

      const doc = await db.query.facturas_electronicas.findFirst({
        where: eq(facturas_electronicas.id, documentoId)
      });

      if (!doc) return res.status(404).json({ error: "Documento fiscal no encontrado" });

      if (['Aceptado', 'Rechazado'].includes(doc.estado) && doc.respuestaHacienda) {
        let respuestaGuardada: any = null;
        try { respuestaGuardada = JSON.parse(doc.respuestaHacienda); } catch { respuestaGuardada = { estado: doc.estado, mensaje: doc.respuestaHacienda }; }
        return res.json({ success: true, repetido: true, estado: doc.estado, respuesta: respuestaGuardada });
      }
      if (doc.estado !== 'Enviado') {
        return res.status(409).json({ error: `Solo se puede consultar Hacienda después del envío; estado actual: ${doc.estado}` });
      }

      // Simulate Hacienda response (80% acceptance rate in test mode)
      const aceptado = Math.random() > 0.2;
      const nuevoEstado = aceptado ? 'Aceptado' : 'Rechazado';
      const respuesta = aceptado 
        ? JSON.stringify({ estado: 'Aceptado', fechaRespuesta: new Date().toISOString(), mensaje: 'Comprobante aceptado por Hacienda' })
        : JSON.stringify({ estado: 'Rechazado', fechaRespuesta: new Date().toISOString(), motivo: 'Error en formato de datos' });

      await db.update(facturas_electronicas)
        .set({ 
          estado: nuevoEstado,
          fechaRespuesta: new Date().toISOString(),
          respuestaHacienda: respuesta,
          motivoRechazo: aceptado ? null : 'Error en formato de datos'
        })
        .where(eq(facturas_electronicas.id, documentoId));

      res.json({ success: true, estado: nuevoEstado, respuesta: JSON.parse(respuesta) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Emitir Nota de Crédito
  app.post("/api/facturacion/nota-credito", requirePermission(['facturacion', 'notas_credito'], 'create'), async (req, res) => {
    try {
      const { facturaIdOriginal, motivo, monto, emisorNombre, emisorCedula } = req.body;
      
      if (!facturaIdOriginal || !motivo || !monto) {
        return res.status(400).json({ error: "Faltan datos para nota de crédito" });
      }

      const facturaOriginal = await db.query.facturas.findFirst({
        where: eq(facturas.id, facturaIdOriginal)
      });

      if (!facturaOriginal) {
        return res.status(404).json({ error: "Factura original no encontrada" });
      }

      // R3: la NC NO vuelve a sumar ingreso. Antes se insertaba estado 'Pagada' con
      // monto positivo → doble ingreso contable. Ahora usa el estado 'NotaCredito'
      // (misma convención que las NC de consolidar), que finanzas/dashboard excluyen.
      const nuevaFacturaId = crypto.randomUUID();
      const ncId = crypto.randomUUID();
      const hoy = new Date().toISOString();
      let consecutivo = '';
      let consecutivoNCR = '';

      await db.transaction(async (tx) => {
        const ncr = await siguienteConsecutivo(tx, 'NOTA_CREDITO', 'GLOBAL', 'NCR', 6);
        consecutivoNCR = ncr.s;
        await tx.insert(facturas).values({
          id: nuevaFacturaId,
          consecutivo: consecutivoNCR,
          fecha: hoy,
          clienteId: facturaOriginal.clienteId,
          vendedorId: facturaOriginal.vendedorId,
          subtotal: Number(monto),
          descuento: 0,
          total: Number(monto),
          condicion_pago: 'Contado',
          estado: 'NotaCredito',
          guiaId: facturaOriginal.guiaId || null,
          camionId: facturaOriginal.camionId || null
        });

        const nc = await siguienteConsecutivo(tx, 'DOCUMENTO_FISCAL', 'NotaCredito', 'NC', 10);
        consecutivo = nc.s;
        await tx.insert(facturas_electronicas).values({
          id: ncId,
          facturaId: nuevaFacturaId,
          tipoDocumento: 'NotaCredito',
          consecutivo,
          fechaEmision: hoy,
          emisorNombre: emisorNombre || 'Granja Don Paco',
          emisorCedula: emisorCedula || '3-101-XXXXXX',
          subtotal: Number(monto),
          total: Number(monto),
          condicionPago: 'Contado',
          estado: 'Borrador',
          notasCreditoId: facturaIdOriginal,
          ambiente: 'Pruebas'
        });
      });

      res.status(201).json({ success: true, id: ncId, consecutivo });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Listar documentos electrónicos
  app.get("/api/facturacion/documentos", requirePermission(['facturacion', 'dashboard'], 'view'), async (req, res) => {
    try {
      const data = await db.query.facturas_electronicas.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // -------------------- CONSOLIDACIÓN DE RUTA → FACTURACIÓN ELECTRÓNICA (F4) --------------------

  // Factura electrónica consolidada por consumidor final a partir de los tiquetes Emitidos de la guía.
  // Devuelve: 404 si no existe la guía · 409 si no está cerrada o ya fue consolidada · 400 si no hay ventas.
  app.post("/api/facturacion/consolidar-ruta", requirePermission('facturacion', 'create'), async (req, res) => {
    try {
      const { guiaId, emisorNombre, emisorCedula, emisorCorreo } = req.body || {};
      const usuarioId = (req as any).usuario?.id || req.headers['x-user-id'] || 'system';
      if (!guiaId) return res.status(400).json({ error: "Falta guiaId" });

      // Validaciones (lectura) fuera de la transacción
      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      if (guia.estado !== 'Cerrada' && guia.estado !== 'CerradaConDiferencia') {
        return res.status(409).json({ error: `La guía debe estar cerrada (cuadre completado). Estado actual: ${guia.estado}` });
      }

      const ventasLegacy = await db.query.ventas_ruta.findMany({ where: eq(ventas_ruta.guiaId, guiaId) });
      const ventasKg = await db.query.ventas_ruta_kg.findMany({ where: eq(ventas_ruta_kg.guiaId, guiaId) }).catch(() => []);
      const ventas = [...ventasLegacy, ...ventasKg.map((v: any) => ({ ...v, cartones: Number(v.cantidadKg), precioUnitario: Number(v.precioKg), unidad: 'kg', cantidadKg: Number(v.cantidadKg) }))];
      const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
      const anuladas = ventas.filter((v: any) => v.estado === 'Anulada');
      if (emitidas.some((v: any) => v.facturaId)) {
        return res.status(409).json({ error: "Esta guía ya fue consolidada en facturación" });
      }
      if (emitidas.length === 0 && anuladas.length === 0) {
        return res.status(400).json({ error: "No hay ventas (emitidas ni anuladas) para consolidar" });
      }

      const clientes = await db.query.clientes.findMany();

      let resultado: any = null;
      await db.transaction(async (tx) => {
        const clienteDe = (id: string | null) => (id ? clientes.find((c: any) => c.id === id) : null);
        const hoy = new Date().toISOString();
        const facturasCreadas: any[] = [];
        const documentosCreados: any[] = [];
        // R2: tiquetes sin cliente se facturan a Consumidor Final (nunca se descarta el dinero).
        const consumidorFinal = await getClienteConsumidorFinal(tx);

        // 1) Factura electrónica por (cliente, cobro): separa efectivo vs crédito.
        //    Antes se agrupaba solo por cliente y un tiquete de crédito "contaminaba"
        //    todo el grupo → factura 100% crédito mezclando medios de pago (R4).
        const porCliente = new Map<string, { cliente: any; ventas: any[]; subtotal: number; descuento: number; total: number; productos: Map<string, { cantidad: number; subtotal: number; componentesPrecio: any[] }>; cobro: string }>();
        for (const v of emitidas) {
          const cobro = v.cobro === 'Credito' ? 'Credito' : 'Contado';
          const key = `${v.clienteId || '__consumidor_final__'}|${cobro}`;
          if (!porCliente.has(key)) porCliente.set(key, { cliente: clienteDe(v.clienteId) || (!v.clienteId ? consumidorFinal : null), ventas: [], subtotal: 0, descuento: 0, total: 0, productos: new Map(), cobro });
          const g = porCliente.get(key)!;
          g.ventas.push(v);
          g.subtotal += Number(v.subtotal);
          g.descuento += Number(v.descuento || 0);
          g.total += Number(v.total);
          const prod = g.productos.get(v.producto) || { cantidad: 0, subtotal: 0, componentesPrecio: [] };
          prod.cantidad += Number(v.cartones);
          prod.subtotal += Number(v.subtotal);
          let resolucionPrecio: any = null;
          try { resolucionPrecio = v.resolucionPrecioJson ? JSON.parse(v.resolucionPrecioJson) : null; } catch { resolucionPrecio = null; }
          prod.componentesPrecio.push({
            ventaRutaId: v.id, tiquete: v.tiqueteConsecutivo, cantidad: Number(v.cartones),
            subtotal: Number(v.subtotal), descuento: Number(v.descuento || 0),
            precioUnitario: Number(v.precioUnitario), resolucionPrecio,
          });
          g.productos.set(v.producto, prod);
        }

        for (const [, g] of porCliente) {
          const clienteReal = g.cliente || consumidorFinal;
          const esCredito = g.cobro === 'Credito';
          const mediosContado = [...new Set(g.ventas.map((v: any) => ['SINPE', 'Transferencia'].includes(String(v.cobro)) ? 'Transferencia' : 'Efectivo'))];
          const medioPagoGrupo = esCredito ? 'Credito' : (mediosContado.length === 1 ? mediosContado[0] : 'Mixto');
          const facturaId = crypto.randomUUID();
          // R1: consecutivo global único FAC (tabla consecutivos) — no reusa números por guía.
          const consec = await siguienteConsecutivo(tx, 'FACTURA', 'GLOBAL', 'FAC', 6);
          const consecutivo = consec.s;
          await tx.insert(facturas).values({
            id: facturaId,
            consecutivo,
            fecha: hoy,
            clienteId: clienteReal.id,
            vendedorId: g.ventas[0].vendedorId,
            subtotal: g.subtotal,
            descuento: g.descuento,
            total: g.total,
            condicion_pago: esCredito ? 'Credito' : 'Contado',
            metodo_pago: medioPagoGrupo,
            estado: esCredito ? 'Pendiente' : 'Pagada',
            guiaId,
            camionId: guia.camionId
          });
          for (const [producto, p] of g.productos) {
            await tx.insert(detallesFactura).values({
              id: crypto.randomUUID(),
              facturaId,
              producto,
              cantidad: p.cantidad,
              precio_unitario: p.cantidad > 0 ? Number((p.subtotal / p.cantidad).toFixed(2)) : 0,
              subtotal: p.subtotal,
              resolucionPrecioJson: JSON.stringify({
                version: 1, tipo: 'ConsolidacionTiquetes', cantidad: p.cantidad,
                precioPromedioPonderado: p.cantidad > 0 ? Number((p.subtotal / p.cantidad).toFixed(2)) : 0,
                componentes: p.componentesPrecio,
              }),
            });
          }
          for (const v of g.ventas) {
            if (v.unidad === 'kg') await tx.update(ventas_ruta_kg).set({ facturaId }).where(eq(ventas_ruta_kg.id, v.id));
            else await tx.update(ventas_ruta).set({ facturaId }).where(eq(ventas_ruta.id, v.id));
          }

          // Documento electrónico Borrador por factura consolidada
          const idFE = crypto.randomUUID();
          const consecFE = (await siguienteConsecutivo(tx, 'DOCUMENTO_FISCAL', 'Factura', 'FE', 10)).s;
          const clave = `${(emisorCedula || '3-101-000000').replace(/-/g, '')}${hoy.slice(0, 10).replace(/-/g, '')}${consecFE.replace(/-/g, '')}`;
          await tx.insert(facturas_electronicas).values({
            id: idFE,
            facturaId,
            tipoDocumento: 'Factura',
            consecutivo: consecFE,
            clave,
            fechaEmision: hoy,
            emisorNombre: emisorNombre || 'Granja Don Paco',
            emisorCedula: emisorCedula || '3-101-000000',
            emisorCorreo: emisorCorreo || null,
            receptorNombre: clienteReal.nombre || 'Consumidor Final',
            receptorCedula: clienteReal.documento_id || null,
            receptorCorreo: clienteReal.email || null,
            subtotal: g.subtotal,
            descuento: g.descuento,
            total: g.total,
            condicionPago: esCredito ? 'Credito' : 'Contado',
            medioPago: medioPagoGrupo,
            estado: 'Borrador',
            ambiente: 'Pruebas',
            proveedor: null
          });
          facturasCreadas.push({ consecutivo, cliente: clienteReal.nombre || 'Consumidor Final', total: g.total, condicion: esCredito ? 'Credito' : 'Contado' });
          documentosCreados.push({ id: idFE, consecutivo: consecFE, tipoDocumento: 'Factura', estado: 'Borrador' });
        }

        // 2) Nota de crédito por cada venta anulada (devolución) de la guía
        for (const v of anuladas) {
          const cli = clienteDe(v.clienteId);
          if (!cli) continue; // devolución sin cliente: no se emite documento fiscal
          // Factura receptora de la NC (no suma a ingresos: estado NotaCredito)
          const ncFacturaId = crypto.randomUUID();
          const ncrCons = await siguienteConsecutivo(tx, 'NOTA_CREDITO', 'GLOBAL', 'NCR', 6);
          await tx.insert(facturas).values({
            id: ncFacturaId,
            consecutivo: ncrCons.s,
            fecha: hoy,
            clienteId: v.clienteId!,
            vendedorId: v.vendedorId,
            subtotal: Number(v.total),
            descuento: 0,
            total: Number(v.total),
            condicion_pago: 'Contado',
            estado: 'NotaCredito',
            guiaId,
            camionId: guia.camionId
          });
          const idNC = crypto.randomUUID();
          const consecNC = (await siguienteConsecutivo(tx, 'DOCUMENTO_FISCAL', 'NotaCredito', 'NC', 10)).s;
          await tx.insert(facturas_electronicas).values({
            id: idNC,
            facturaId: ncFacturaId,
            tipoDocumento: 'NotaCredito',
            consecutivo: consecNC,
            clave: `${(emisorCedula || '3-101-000000').replace(/-/g, '')}${hoy.slice(0, 10).replace(/-/g, '')}${consecNC.replace(/-/g, '')}`,
            fechaEmision: hoy,
            emisorNombre: emisorNombre || 'Granja Don Paco',
            emisorCedula: emisorCedula || '3-101-000000',
            receptorNombre: cli.nombre,
            receptorCedula: cli.documento_id || null,
            subtotal: Number(v.total),
            descuento: 0,
            total: Number(v.total),
            condicionPago: 'Contado',
            estado: 'Borrador',
            notasCreditoId: v.id,
            ambiente: 'Pruebas'
          });
          documentosCreados.push({ id: idNC, consecutivo: consecNC, tipoDocumento: 'NotaCredito', estado: 'Borrador' });
        }

        resultado = { guiaId, facturas: facturasCreadas, documentos: documentosCreados, emitidas: emitidas.length, anuladas: anuladas.length };
      });

      await logAudit(usuarioId, 'Crear', 'ConsolidacionRuta', guiaId, null, { facturas: resultado.facturas.length, documentos: resultado.documentos.length, emitidas: resultado.emitidas, anuladas: resultado.anuladas });
      res.json({ success: true, ...resultado });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rutas del día para el Facturador: estado de consolidación fiscal por guía
  app.get("/api/facturacion/rutas-dia", requirePermission(['facturacion', 'ventas'], 'view'), async (req, res) => {
    try {
      const [guias, ventasLegacy, ventasKg, camionesData, facturasData] = await Promise.all([
        db.query.guias_despacho.findMany(),
        db.query.ventas_ruta.findMany(),
        db.query.ventas_ruta_kg.findMany().catch(() => []),
        db.query.camiones.findMany(),
        db.query.facturas.findMany()
      ]);
      const ventas = [...ventasLegacy, ...ventasKg.map((v: any) => ({ ...v, cartones: Number(v.cantidadKg), unidad: 'kg' }))];
      const hoy = new Date().toISOString().slice(0, 10);
      const rutas = guias
        .filter((g: any) => !!g.finDiaFecha && String(g.finDiaFecha).slice(0, 10) === hoy)
        .map((g: any) => {
          const gv = ventas.filter((v: any) => v.guiaId === g.id);
          const camion = camionesData.find((c: any) => c.id === g.camionId);
          const consolidadas = gv.filter((v: any) => v.estado === 'Emitida' && v.facturaId).length;
          const facturasFiscales = facturasData.filter((f: any) => f.guiaId === g.id && f.estado !== 'NotaCredito');
          return {
            guiaId: g.id,
            consecutivo: g.consecutivo,
            camionNombre: camion?.nombre || '—',
            fecha: g.finDiaFecha,
            estado: g.estado,
            totalCartones: g.totalCartones,
            vendidos: gv.filter((v: any) => v.estado === 'Emitida').reduce((a: number, v: any) => a + Number(v.cartones), 0),
            totalGenerado: gv.filter((v: any) => v.estado === 'Emitida').reduce((a: number, v: any) => a + Number(v.total), 0),
            tiquetesEmitidos: gv.filter((v: any) => v.estado === 'Emitida').length,
            retornos: gv.filter((v: any) => v.estado === 'Anulada').length,
            consolidada: facturasFiscales.length > 0 || consolidadas > 0,
            nFacturas: facturasFiscales.length
          };
        })
        .sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha)));
      res.json({ fecha: hoy, rutas });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


}
