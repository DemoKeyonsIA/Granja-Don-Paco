import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { siguienteConsecutivo, getClienteConsumidorFinal } from '../services/consecutivos';

/** Registra documentos en modo de prueba; no sustituye el conector fiscal oficial. */
export function registrarRutasFacturacion(app: any, db: any, requirePermission: (...args: any[]) => any, _testMode: boolean, logAudit: (...args: any[]) => Promise<void>) {
  const { facturas, detallesFactura, facturas_electronicas, productosCatalogo, clientes, guias_despacho, ventas_ruta, ventas_ruta_kg } = schema;
  app.get('/api/proformas', requirePermission(['facturacion', 'ventas'], 'view'), async (req: any, res: any) => {
    try {
      const usuarioId = String(req.usuario?.id || '');
      const roles = Array.isArray(req.usuario?.roles) ? req.usuario.roles : String(req.usuario?.roles || req.usuario?.role || '').split(',');
      const todas = await db.query.proformas.findMany();
      const rows = roles.includes('Admin') ? todas : todas.filter((proforma: any) => proforma.vendedorId === usuarioId);
      res.json(rows.map((p: any) => ({ ...p, detalles: JSON.parse(p.detallesJson || '[]') })).sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha))));
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudieron cargar las proformas.' }); }
  });
  app.post('/api/proformas', requirePermission(['facturacion', 'ventas'], 'create'), async (req: any, res: any) => {
    try {
      const { clienteId, detalles, descuento = 0, notas = '', venceEn = null, guiaId = null } = req.body || {};
      const usuarioId = String(req.usuario?.id || '');
      const lineas = Array.isArray(detalles) ? detalles.filter((d: any) => Number(d.cantidad) > 0) : [];
      if (!usuarioId || !lineas.length) return res.status(400).json({ error: 'Agregue al menos un producto.' });
      if (clienteId && !await db.query.clientes.findFirst({ where: eq(clientes.id, String(clienteId)) })) return res.status(400).json({ error: 'El cliente seleccionado no existe.' });
      if (guiaId) {
        const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, String(guiaId)) });
        if (!guia || guia.vendedorId !== usuarioId || guia.estado !== 'EnRuta') return res.status(403).json({ error: 'La proforma debe asociarse a la ruta activa asignada al vendedor.' });
      }
      if (lineas.some((d: any) => !String(d.producto || '').trim() || !Number.isFinite(Number(d.precio_unitario)) || Number(d.precio_unitario) < 0)) return res.status(400).json({ error: 'Revise productos, cantidades y precios.' });
      const catalogoActivo = await db.query.productosCatalogo.findMany();
      const nombresCatalogo = new Set((catalogoActivo as any[]).map((producto: any) => String(producto.nombre).trim().toLocaleLowerCase('es')));
      if (lineas.some((d: any) => !nombresCatalogo.has(String(d.producto).trim().toLocaleLowerCase('es')))) return res.status(400).json({ error: 'La proforma contiene un producto que no está en el catálogo.' });
      const lineasFinales = lineas.map((d: any) => ({ producto: String(d.producto).trim(), cantidad: Number(d.cantidad), precio_unitario: Number(d.precio_unitario), subtotal: Number(d.cantidad) * Number(d.precio_unitario) }));
      const subtotal = lineasFinales.reduce((s: number, d: any) => s + d.subtotal, 0);
      const descuentoFinal = Math.max(0, Number(descuento) || 0);
      if (descuentoFinal > subtotal) return res.status(400).json({ error: 'El descuento supera el subtotal.' });
      const fecha = new Date().toISOString();
      const fila: any = { id: crypto.randomUUID(), consecutivo: `PRO-${fecha.slice(0,10).replaceAll('-','')}-${crypto.randomUUID().slice(0,6).toUpperCase()}`, fecha, venceEn: venceEn ? String(venceEn).slice(0,10) : null, clienteId: clienteId || null, vendedorId: usuarioId, guiaId: guiaId || null, detallesJson: JSON.stringify(lineasFinales), subtotal, descuento: descuentoFinal, total: subtotal - descuentoFinal, notas: String(notas).slice(0,1000), estado: 'Vigente', facturaId: null };
      await db.insert(schema.proformas).values(fila);
      await logAudit(usuarioId, 'CrearProformaNoFiscal', 'Proforma', fila.id, null, { consecutivo: fila.consecutivo, total: fila.total });
      res.status(201).json({ ...fila, detalles: lineasFinales, aviso: 'Cotización comercial no fiscal. No afecta inventario, pagos ni cuentas por cobrar.' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo guardar la proforma.' }); }
  });
  app.post('/api/proformas/:id/convertir', requirePermission(['facturacion', 'ventas'], 'create'), async (req: any, res: any) => {
    try {
      const facturaId = String(req.body?.facturaId || '');
      const proforma = await db.query.proformas.findFirst({ where: eq(schema.proformas.id, String(req.params.id)) });
      if (!proforma) return res.status(404).json({ error: 'Proforma no encontrada.' });
      const roles = Array.isArray(req.usuario?.roles) ? req.usuario.roles : String(req.usuario?.roles || req.usuario?.role || '').split(',');
      if (!roles.includes('Admin') && proforma.vendedorId !== String(req.usuario?.id || '')) return res.status(403).json({ error: 'No tiene permiso para convertir esta proforma.' });
      const factura = await db.query.facturas.findFirst({ where: eq(facturas.id, facturaId) });
      if (!factura) return res.status(400).json({ error: 'La factura vinculada no existe.' });
      if (proforma.clienteId && factura.clienteId !== proforma.clienteId) return res.status(400).json({ error: 'La factura debe corresponder al cliente de la proforma.' });
      if (proforma.guiaId && factura.guiaId !== proforma.guiaId) return res.status(400).json({ error: 'La venta debe realizarse desde la ruta asignada a esta proforma.' });
      await db.update(schema.proformas).set({ estado: 'Convertida', facturaId }).where(eq(schema.proformas.id, proforma.id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo vincular la factura.' }); }
  });
  app.get('/api/configuracion-fiscal/emisor', requirePermission('finanzas_resumen', 'view'), async (_req: any, res: any) => {
    try {
      let configuracion = await db.query.configuracionFiscalEmisor.findFirst({ where: eq(schema.configuracionFiscalEmisor.id, 'emisor') });
      if (!configuracion) {
        await db.insert(schema.configuracionFiscalEmisor).values({ id: 'emisor', razonSocial: '', identificacionTipo: '', identificacion: '', actividadEconomica: '', monedaPresentacion: 'CRC', estadoRevision: 'Pendiente' }).onConflictDoNothing();
        configuracion = await db.query.configuracionFiscalEmisor.findFirst({ where: eq(schema.configuracionFiscalEmisor.id, 'emisor') });
      }
      res.json({ configuracion, modo: 'simulacion', aviso: 'Este perfil es una ficha para preparación interna; su registro o revisión aquí no habilita emisión real ni valida datos ante Hacienda.' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo cargar el perfil fiscal.' }); }
  });
  app.get('/api/configuracion-fiscal/estado-maestros', requirePermission('finanzas_resumen', 'view'), async (_req: any, res: any) => {
    try {
      const [emisor, clientesData, productosData] = await Promise.all([
        db.query.configuracionFiscalEmisor.findFirst({ where: eq(schema.configuracionFiscalEmisor.id, 'emisor') }),
        db.query.clientes.findMany(),
        db.query.productosCatalogo.findMany(),
      ]);
      const camposEmisor = ['razonSocial', 'identificacionTipo', 'identificacion', 'actividadEconomica', 'correo', 'telefono', 'provincia', 'canton', 'distrito', 'otrasSenas', 'monedaPresentacion'];
      const faltantesEmisor = camposEmisor.filter(c => !String((emisor as any)?.[c] || '').trim());
      const clientesFiscales = (clientesData as any[]).filter(c => c.estado !== 'Inactivo');
      const productos = (productosData as any[]).filter(p => p.estado === 'Activo');
      const faltantesProducto = productos.filter(p => !p.cabysCodigo || !/^\d{13}$/.test(String(p.cabysCodigo)) || !p.cabysDescripcion || !p.unidad || !p.tratamientoFiscal || p.tarifaImpuesto == null || !p.fiscalVigenteDesde || p.fiscalEstado !== 'Aprobado');
      const fecha = new Date().toISOString().slice(0, 10);
      const productoNoVigente = productos.filter(p => !p.fiscalVigenteDesde || p.fiscalVigenteDesde > fecha || (p.fiscalVigenteHasta && p.fiscalVigenteHasta < fecha));
      res.json({
        modo: 'simulacion', generadoEn: new Date().toISOString(),
        emisor: { configurado: Boolean(emisor), faltantes: faltantesEmisor, revisionDeclarada: emisor?.estadoRevision || 'Pendiente', evidenciaDeclarada: Boolean(emisor?.referenciaEvidencia) },
        clientes: { totalActivos: clientesFiscales.length, sinIdentificacion: clientesFiscales.filter(c => !String(c.documento_id || '').trim()).length, sinActividadEconomica: clientesFiscales.filter(c => !String(c.actividad_economica || '').trim()).length },
        productos: { totalActivos: productos.length, conDatosFiscalPendientes: faltantesProducto.length, fueraDeVigenciaOHastaSinInicio: productoNoVigente.length, pendientes: faltantesProducto.slice(0, 100).map(p => ({ id: p.id, nombre: p.nombre, faltantes: [!p.cabysCodigo || !/^\d{13}$/.test(String(p.cabysCodigo)) ? 'CABYS (13 dígitos)' : null, !p.cabysDescripcion ? 'descripción CABYS' : null, !p.unidad ? 'unidad' : null, !p.tratamientoFiscal ? 'tratamiento fiscal' : null, p.tarifaImpuesto == null ? 'tarifa' : null, !p.fiscalVigenteDesde ? 'inicio de vigencia' : null, p.fiscalEstado !== 'Aprobado' ? 'revisión interna pendiente' : null].filter(Boolean) })) },
        limitaciones: ['Este control mide campos registrados, no verifica su veracidad ni vigencia en fuentes externas.', 'La marca de aprobación se registra localmente y no acredita revisión real de CPA.', 'Los documentos fiscales continúan simulados; no se envía información a Hacienda.'],
      });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo revisar la integridad de los datos fiscales.' }); }
  });
  app.put('/api/configuracion-fiscal/emisor', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const campos = ['razonSocial', 'identificacionTipo', 'identificacion', 'actividadEconomica', 'nombreComercial', 'correo', 'telefono', 'provincia', 'canton', 'distrito', 'barrio', 'otrasSenas', 'monedaPresentacion'] as const;
      const datos: any = {};
      for (const campo of campos) datos[campo] = String(req.body?.[campo] ?? '').trim() || null;
      const limite: Record<string, number> = { razonSocial: 200, identificacionTipo: 2, identificacion: 20, actividadEconomica: 20, nombreComercial: 200, correo: 160, telefono: 20, provincia: 80, canton: 80, distrito: 80, barrio: 80, otrasSenas: 500, monedaPresentacion: 3 };
      if (Object.entries(limite).some(([k, max]) => String(datos[k] || '').length > max)) return res.status(400).json({ error: 'Uno o más campos exceden el tamaño permitido.' });
      if (datos.identificacionTipo && !['01', '02', '03', '04'].includes(datos.identificacionTipo)) return res.status(400).json({ error: 'Seleccione un tipo de identificación válido para el emisor.' });
      if (datos.actividadEconomica && !/^\d{1,20}$/.test(datos.actividadEconomica)) return res.status(400).json({ error: 'El código de actividad económica debe contener solo dígitos.' });
      if (datos.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) return res.status(400).json({ error: 'Revise el correo del emisor.' });
      if (datos.telefono && !/^\+?[0-9 ()-]{8,20}$/.test(datos.telefono)) return res.status(400).json({ error: 'Revise el teléfono del emisor.' });
      if (datos.monedaPresentacion && !/^[A-Z]{3}$/.test(datos.monedaPresentacion)) return res.status(400).json({ error: 'La moneda debe ser un código de tres letras en mayúscula.' });
      const actual = await db.query.configuracionFiscalEmisor.findFirst({ where: eq(schema.configuracionFiscalEmisor.id, 'emisor') });
      const usuarioId = String(req.usuario?.id || ''); const actualizadoEn = new Date().toISOString();
      const cambios = { ...datos, estadoRevision: 'Pendiente', referenciaEvidencia: null, revisorNombre: null, revisorCredencial: null, actualizadoPor: usuarioId, actualizadoEn };
      if (actual) await db.update(schema.configuracionFiscalEmisor).set(cambios).where(eq(schema.configuracionFiscalEmisor.id, 'emisor'));
      else await db.insert(schema.configuracionFiscalEmisor).values({ id: 'emisor', ...cambios });
      await logAudit(usuarioId, 'ActualizarPerfilFiscalEmisor', 'ConfiguracionFiscal', 'emisor', actual || null, cambios);
      res.json({ success: true, estadoRevision: 'Pendiente' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo guardar el perfil fiscal.' }); }
  });
  app.post('/api/configuracion-fiscal/emisor/revisar', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const actual = await db.query.configuracionFiscalEmisor.findFirst({ where: eq(schema.configuracionFiscalEmisor.id, 'emisor') });
      if (!actual) return res.status(404).json({ error: 'Complete primero el perfil del emisor.' });
      const requeridos = ['razonSocial', 'identificacionTipo', 'identificacion', 'actividadEconomica', 'correo', 'telefono', 'provincia', 'canton', 'distrito', 'otrasSenas', 'monedaPresentacion'];
      if (requeridos.some(k => !String((actual as any)[k] || '').trim())) return res.status(400).json({ error: 'Complete la razón social, identificación, actividad, contacto, ubicación y moneda antes de registrar revisión.' });
      const revisorNombre = String(req.body?.revisorNombre || '').trim(); const revisorCredencial = String(req.body?.revisorCredencial || '').trim(); const referenciaEvidencia = String(req.body?.referenciaEvidencia || '').trim();
      if (!revisorNombre || revisorNombre.length > 160 || !revisorCredencial || revisorCredencial.length > 120 || !referenciaEvidencia || referenciaEvidencia.length > 500) return res.status(400).json({ error: 'Indique CPA, credencial profesional y referencia de evidencia.' });
      const usuarioId = String(req.usuario?.id || ''); const actualizadoEn = new Date().toISOString();
      const cambios = { estadoRevision: 'Revisado declarado', revisorNombre, revisorCredencial, referenciaEvidencia, actualizadoPor: usuarioId, actualizadoEn };
      await db.update(schema.configuracionFiscalEmisor).set(cambios).where(eq(schema.configuracionFiscalEmisor.id, 'emisor'));
      await logAudit(usuarioId, 'RegistrarRevisionPerfilFiscal', 'ConfiguracionFiscal', 'emisor', actual, { ...actual, ...cambios });
      res.json({ success: true, estadoRevision: cambios.estadoRevision, aviso: 'Registro declarativo; el sistema no valida identidad, credencial ni evidencia.' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo registrar la revisión.' }); }
  });
  app.get('/api/facturacion/estado-integracion', requirePermission(['facturacion', 'ventas', 'dashboard'], 'view'), (_req: any, res: any) => {
    res.json({ modo: 'simulacion', disponible: true, emisionReal: false,
      mensaje: 'Modo demostración permanente: los XML, envíos y respuestas son simulados. No se transmite información a Hacienda ni se emiten comprobantes fiscales válidos.',
      limitaciones: [
        'El XML es una representación de demostración; no se valida contra los esquemas oficiales.',
        'No se utiliza firma digital ni se transmite información a Hacienda o a un proveedor.',
        'Los estados Aceptado/Rechazado son simulados y no acreditan recepción fiscal.',
        'Los datos del emisor de demostración no deben usarse como identificación fiscal real.',
      ] });
  });
  // Generar documento fiscal (Borrador)
  app.post("/api/facturacion/crear-documento", requirePermission(['facturacion', 'ventas'], 'create'), async (req, res) => {
    let idempotencyKey = '';
    let idempotencyPayload = '';
    try {
      const { facturaId, tipoDocumento, emisorNombre, emisorCedula, emisorCorreo, receptorNombre, receptorCedula, receptorCorreo, condicionPago, medioPago } = req.body;
      if (!facturaId || !['Factura', 'Tiquete', 'NotaCredito'].includes(tipoDocumento)) {
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
      const perfilEmisor = await db.query.configuracionFiscalEmisor.findFirst({ where: eq(schema.configuracionFiscalEmisor.id, 'emisor') });
      const emisorNombreFinal = String(perfilEmisor?.razonSocial || emisorNombre || 'DEMO · Granja Don Paco').trim();
      const emisorCedulaFinal = String(perfilEmisor?.identificacion || emisorCedula || 'DEMO-SIN-IDENTIFICACION').trim();
      const emisorCorreoFinal = perfilEmisor?.correo || (emisorCorreo ? String(emisorCorreo).trim() : null);

      const [lineasFactura, catalogo, clienteRegistrado] = await Promise.all([
        db.query.detallesFactura.findMany({ where: eq(detallesFactura.facturaId, String(facturaId)) }),
        db.query.productosCatalogo.findMany(),
        facturaOriginal.clienteId ? db.query.clientes.findFirst({ where: eq(clientes.id, String(facturaOriginal.clienteId)) }) : Promise.resolve(null),
      ]);
      const normalizar = (s: any) => String(s || '').trim().toLocaleLowerCase('es');
      const lineasSnapshot = (lineasFactura as any[]).map(linea => {
        const matches = (catalogo as any[]).filter(p => normalizar(p.nombre) === normalizar(linea.producto));
        const producto = matches.length === 1 ? matches[0] : null;
        const fechaDoc = String(facturaOriginal.fecha || new Date().toISOString()).slice(0, 10);
        const vigente = Boolean(producto && producto.fiscalVigenteDesde && producto.fiscalVigenteDesde <= fechaDoc && (!producto.fiscalVigenteHasta || producto.fiscalVigenteHasta >= fechaDoc));
        return {
          descripcionFactura: linea.producto, cantidad: Number(linea.cantidad), precioUnitario: Number(linea.precio_unitario), subtotal: Number(linea.subtotal),
          productoCatalogoId: producto?.id || null, productoCatalogoNombre: producto?.nombre || null, unidad: producto?.unidad || null,
          cabysCodigo: producto?.cabysCodigo || null, cabysDescripcion: producto?.cabysDescripcion || null,
          tratamientoFiscal: producto?.tratamientoFiscal || null, tarifaImpuesto: producto?.tarifaImpuesto ?? null,
          exoneracionReferencia: producto?.exoneracionReferencia || null, fiscalVigenteDesde: producto?.fiscalVigenteDesde || null,
          fiscalVigenteHasta: producto?.fiscalVigenteHasta || null, estadoRevisionFiscal: producto?.fiscalEstado || 'Sin producto fiscal asociado',
          referenciaAprobacion: producto?.fiscalAprobacionReferencia || null, revisorDeclarado: producto?.fiscalRevisorNombre || null,
          credencialDeclarada: producto?.fiscalRevisorCredencial || null, vigenteEnFechaDocumento: vigente,
          coincidenciasCatalogo: matches.length,
        };
      });
      const snapshotFiscal = {
        versionSnapshot: 1, creadoEn: new Date().toISOString(), modo: 'SIMULACION_NO_FISCAL', moneda: perfilEmisor?.monedaPresentacion || 'CRC',
        aviso: 'Instantánea para demostración y revisión. No valida datos contra Hacienda, no aplica cálculo fiscal oficial y no representa un comprobante válido.',
        emisor: { nombre: emisorNombreFinal, tipoIdentificacion: perfilEmisor?.identificacionTipo || null, identificacion: emisorCedulaFinal, actividadEconomica: perfilEmisor?.actividadEconomica || null, nombreComercial: perfilEmisor?.nombreComercial || null, correo: emisorCorreoFinal, telefono: perfilEmisor?.telefono || null, provincia: perfilEmisor?.provincia || null, canton: perfilEmisor?.canton || null, distrito: perfilEmisor?.distrito || null, barrio: perfilEmisor?.barrio || null, otrasSenas: perfilEmisor?.otrasSenas || null, estadoRevisionDeclarada: perfilEmisor?.estadoRevision || 'Sin perfil', referenciaRevision: perfilEmisor?.referenciaEvidencia || null },
        receptor: { nombre: receptorNombre ? String(receptorNombre).trim() : clienteRegistrado?.nombre || null, tipoIdentificacion: clienteRegistrado?.tipo_documento || null, identificacion: receptorCedula ? String(receptorCedula).trim() : clienteRegistrado?.documento_id || null, actividadEconomica: clienteRegistrado?.actividad_economica || null, correo: receptorCorreo ? String(receptorCorreo).trim() : clienteRegistrado?.email || null, telefono: clienteRegistrado?.telefono || null, provincia: clienteRegistrado?.provincia || null, canton: clienteRegistrado?.canton || null, distrito: clienteRegistrado?.distrito || null, direccion: clienteRegistrado?.direccion || null, clienteId: clienteRegistrado?.id || null },
        condicionPago: condicionPago || facturaOriginal.condicion_pago, medioPago: medioPago || null,
        importesFuenteFactura: { subtotal: Number(facturaOriginal.subtotal), descuento: Number(facturaOriginal.descuento || 0), impuestos: 0, total: Number(facturaOriginal.total) },
        lineas: lineasSnapshot,
        alertas: [
          !perfilEmisor?.razonSocial || !perfilEmisor?.identificacion ? 'Perfil del emisor incompleto; se usaron valores de demostración o enviados por el cliente.' : null,
          perfilEmisor && perfilEmisor.estadoRevision !== 'Revisado declarado' ? 'Perfil del emisor pendiente de revisión documental declarada.' : null,
          !clienteRegistrado?.documento_id ? 'Cliente sin identificación tributaria registrada.' : null,
          !clienteRegistrado?.actividad_economica ? 'Cliente sin actividad económica registrada.' : null,
          ...lineasSnapshot.flatMap((linea: any) => [
          !linea.productoCatalogoId ? `Producto "${linea.descripcionFactura}" sin asociación única al catálogo fiscal.` : null,
          linea.productoCatalogoId && linea.estadoRevisionFiscal !== 'Aprobado' ? `Producto "${linea.descripcionFactura}" tiene clasificación fiscal no aprobada.` : null,
          linea.productoCatalogoId && !linea.vigenteEnFechaDocumento ? `Clasificación fiscal del producto "${linea.descripcionFactura}" fuera de vigencia o sin fecha inicial.` : null,
          ]),
        ].filter(Boolean),
      };

      const payload = {
        facturaId: String(facturaId), tipoDocumento, emisorNombre: emisorNombreFinal, emisorCedula: emisorCedulaFinal,
        emisorCorreo: emisorCorreoFinal,
        receptorNombre: receptorNombre ? String(receptorNombre).trim() : null,
        receptorCedula: receptorCedula ? String(receptorCedula).trim() : null,
        receptorCorreo: receptorCorreo ? String(receptorCorreo).trim() : null,
        condicionPago: condicionPago || facturaOriginal.condicion_pago,
        medioPago: medioPago || null, ambiente: 'Pruebas', proveedor: 'Simulado', snapshotFiscal: { ...snapshotFiscal, creadoEn: undefined },
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
          datosFiscalSnapshot: JSON.stringify(snapshotFiscal),
        });
      });

      res.status(201).json({ success: true, simulado: true, id: documentoId, consecutivo: consecutivoFinal, clave: claveFinal });
    } catch (error: any) {
      const message = String(error?.message || '');
      if (message.includes('idx_facturas_electronicas_idempotency_key') || message.includes('idx_facturas_electronicas_factura_tipo_idem')) {
        const existente = await db.query.facturas_electronicas.findFirst({ where: eq(facturas_electronicas.idempotencyKey, idempotencyKey) });
        if (existente && existente.idempotencyPayload === idempotencyPayload) {
          return res.status(200).json({ success: true, simulado: true, repetido: true, id: existente.id, consecutivo: existente.consecutivo, clave: existente.clave });
        }
        const facturaId = req.body?.facturaId;
        const tipoDocumento = req.body?.tipoDocumento;
        if (facturaId && tipoDocumento) {
          const mismoDocumento = await db.query.facturas_electronicas.findMany({ where: and(eq(facturas_electronicas.facturaId, facturaId), eq(facturas_electronicas.tipoDocumento, tipoDocumento)) });
          const coincide = mismoDocumento.find((d: any) => d.idempotencyPayload === idempotencyPayload);
          if (coincide) return res.status(200).json({ success: true, simulado: true, repetido: true, id: coincide.id, consecutivo: coincide.consecutivo, clave: coincide.clave });
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
        return res.json({ success: true, simulado: true, repetido: true, xml: doc.xmlGenerado, estado: doc.estado });
      }
      if (doc.estado !== 'Borrador') {
        return res.status(409).json({ error: `No se puede generar XML desde el estado ${doc.estado}` });
      }

      const xmlEscape = (value: any) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;');
      // Build XML for Costa Rica electronic invoice (simplified)
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- DEMOSTRACION LOCAL: NO ES XML FISCAL, NO ESTA FIRMADO, VALIDADO NI ENVIADO A HACIENDA -->
<FacturaElectronica xmlns="https://www.hacienda.go.cr/dte/0.0.0">
  <Clave>${xmlEscape(doc.clave)}</Clave>
  <NumeroConsecutivo>${xmlEscape(doc.consecutivo)}</NumeroConsecutivo>
  <FechaEmision>${xmlEscape(doc.fechaEmision)}</FechaEmision>
  <Emisor>
    <Nombre>${xmlEscape(doc.emisorNombre)}</Nombre>
    <Identificacion>${xmlEscape(doc.emisorCedula)}</Identificacion>
    ${doc.emisorCorreo ? `<CorreoElectronico>${xmlEscape(doc.emisorCorreo)}</CorreoElectronico>` : ''}
  </Emisor>
  ${doc.receptorNombre ? `<Receptor>
    <Nombre>${xmlEscape(doc.receptorNombre)}</Nombre>
    ${doc.receptorCedula ? `<Identificacion>${xmlEscape(doc.receptorCedula)}</Identificacion>` : ''}
    ${doc.receptorCorreo ? `<CorreoElectronico>${xmlEscape(doc.receptorCorreo)}</CorreoElectronico>` : ''}
  </Receptor>` : ''}
  <ResumenFactura>
    <CodigoMoneda>CRC</CodigoMoneda>
    <TotalServGravados>${xmlEscape(doc.subtotal)}</TotalServGravados>
    <TotalDescuentos>${xmlEscape(doc.descuento || 0)}</TotalDescuentos>
    <TotalVentas>${xmlEscape(doc.total)}</TotalVentas>
    <TotalImpuestos>${xmlEscape(doc.impuestos || 0)}</TotalImpuestos>
    <TotalComprobante>${xmlEscape(doc.total)}</TotalComprobante>
  </ResumenFactura>
  <MedioPago>${xmlEscape(doc.medioPago || 'Efectivo')}</MedioPago>
  <CondicionVenta>${xmlEscape(doc.condicionPago)}</CondicionVenta>
</FacturaElectronica>`;

      const actualizado = await db.update(facturas_electronicas)
        .set({ xmlGenerado: xml, estado: 'Pendiente' })
        .where(and(eq(facturas_electronicas.id, documentoId), eq(facturas_electronicas.estado, 'Borrador'))).returning();
      if (!actualizado.length) return res.status(409).json({ error: 'El documento cambió mientras se preparaba el XML. Recargue el estado e intente de nuevo.' });
      await logAudit(String(req.usuario?.id || ''), 'GenerarXmlDemostracion', 'FacturaElectronica', String(documentoId), doc, { estado: 'Pendiente', simulado: true, xmlGenerado: true, xmlFirmado: false, transmitido: false });

      res.json({ success: true, simulado: true, xml });
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

      if (doc.estado === 'Enviado') return res.json({ success: true, repetido: true, simulado: true, message: 'Este documento ya fue marcado como enviado en la demostración; no se transmitió a Hacienda.' });
      if (['Aceptado', 'Rechazado'].includes(doc.estado)) {
        return res.status(409).json({ error: `El documento ya tiene respuesta ${doc.estado}; no se enviará de nuevo` });
      }
      if (!['Pendiente', 'Error'].includes(doc.estado)) {
        return res.status(409).json({ error: `No se puede enviar un documento en estado ${doc.estado}` });
      }

      // Demo simulation only. Do not persist simulated content as a signed XML.
      const actualizado = await db.update(facturas_electronicas)
        .set({ 
          estado: 'Enviado',
          fechaEnvio: new Date().toISOString(),
          xmlFirmado: null
        })
        .where(and(eq(facturas_electronicas.id, documentoId), eq(facturas_electronicas.estado, doc.estado))).returning();
      if (!actualizado.length) return res.status(409).json({ error: 'El estado cambió mientras se registraba la simulación. Recargue el documento.' });
      await logAudit(String(req.usuario?.id || ''), 'SimularEnvioComprobante', 'FacturaElectronica', String(documentoId), doc, { estado: 'Enviado', simulado: true, transmitido: false });

      res.json({ success: true, simulado: true, message: 'Simulación completada; el documento no fue enviado a Hacienda ni a un proveedor.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Simular respuesta de estado. Esta ruta no consulta Hacienda.
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
        return res.json({ success: true, repetido: true, simulado: Boolean(respuestaGuardada?.simulado), estado: doc.estado, respuesta: respuestaGuardada });
      }
      if (doc.estado !== 'Enviado') {
        return res.status(409).json({ error: `La respuesta de prueba solo se simula después del envío local; estado actual: ${doc.estado}` });
      }

      // Controlled demonstration scenario. This endpoint never contacts Hacienda.
      const resultadoSolicitado = String(req.body?.resultadoSimulado || 'Aceptado');
      if (!['Aceptado', 'Rechazado'].includes(resultadoSolicitado)) return res.status(400).json({ error: 'El resultado de demostración debe ser Aceptado o Rechazado.' });
      const aceptado = resultadoSolicitado === 'Aceptado';
      const nuevoEstado = aceptado ? 'Aceptado' : 'Rechazado';
      const respuesta = aceptado 
        ? JSON.stringify({ estado: 'Aceptado', simulado: true, fechaRespuesta: new Date().toISOString(), mensaje: 'Respuesta simulada para demostración; Hacienda no recibió el comprobante.' })
        : JSON.stringify({ estado: 'Rechazado', simulado: true, fechaRespuesta: new Date().toISOString(), motivo: 'Resultado simulado para demostración; Hacienda no recibió el comprobante.' });

      const actualizado = await db.update(facturas_electronicas)
        .set({ 
          estado: nuevoEstado,
          fechaRespuesta: new Date().toISOString(),
          respuestaHacienda: respuesta,
          motivoRechazo: aceptado ? null : 'Error en formato de datos'
        })
        .where(and(eq(facturas_electronicas.id, documentoId), eq(facturas_electronicas.estado, 'Enviado'))).returning();
      if (!actualizado.length) return res.status(409).json({ error: 'El estado cambió mientras se registraba la respuesta simulada. Recargue el documento.' });
      await logAudit(String(req.usuario?.id || ''), 'RegistrarRespuestaFiscalSimulada', 'FacturaElectronica', String(documentoId), doc, { estado: nuevoEstado, simulado: true, transmitido: false, respuesta: JSON.parse(respuesta) });

      res.json({ success: true, simulado: true, estado: nuevoEstado, respuesta: JSON.parse(respuesta) });
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

      const [perfilEmisor, clienteOriginal, lineasOriginales, catalogo] = await Promise.all([
        db.query.configuracionFiscalEmisor.findFirst({ where: eq(schema.configuracionFiscalEmisor.id, 'emisor') }),
        facturaOriginal.clienteId ? db.query.clientes.findFirst({ where: eq(clientes.id, String(facturaOriginal.clienteId)) }) : Promise.resolve(null),
        db.query.detallesFactura.findMany({ where: eq(detallesFactura.facturaId, String(facturaIdOriginal)) }),
        db.query.productosCatalogo.findMany(),
      ]);
      const normalizarProducto = (s: any) => String(s || '').trim().toLocaleLowerCase('es');
      const fechaNC = new Date().toISOString();
      const lineasSnapshot = (lineasOriginales as any[]).map(linea => {
        const coincidencias = (catalogo as any[]).filter(p => normalizarProducto(p.nombre) === normalizarProducto(linea.producto));
        const producto = coincidencias.length === 1 ? coincidencias[0] : null;
        return {
          descripcionFactura: linea.producto, cantidadFuente: Number(linea.cantidad), montoFuente: Number(linea.subtotal),
          montoAcreditado: Number(monto), productoCatalogoId: producto?.id || null, cabysCodigo: producto?.cabysCodigo || null,
          cabysDescripcion: producto?.cabysDescripcion || null, tratamientoFiscal: producto?.tratamientoFiscal || null,
          tarifaImpuesto: producto?.tarifaImpuesto ?? null, exoneracionReferencia: producto?.exoneracionReferencia || null,
          estadoRevisionFiscal: producto?.fiscalEstado || 'Sin producto fiscal asociado', coincidenciasCatalogo: coincidencias.length,
        };
      });
      const perfilSnapshot = {
        versionSnapshot: 1, creadoEn: fechaNC, modo: 'SIMULACION_NO_FISCAL', tipoDocumento: 'NotaCredito',
        aviso: 'Nota de crédito simulada. No es un comprobante fiscal válido y requiere validar la referencia, el motivo, montos e impuestos con el contador.',
        emisor: perfilEmisor || null,
        receptor: clienteOriginal ? { clienteId: clienteOriginal.id, nombre: clienteOriginal.nombre, tipoIdentificacion: clienteOriginal.tipo_documento || null, identificacion: clienteOriginal.documento_id || null, actividadEconomica: clienteOriginal.actividad_economica || null } : null,
        referencia: { facturaOriginalId: facturaOriginal.id, consecutivoOriginal: facturaOriginal.consecutivo || null, motivo: String(motivo).trim(), montoAcreditado: Number(monto), moneda: perfilEmisor?.monedaPresentacion || 'CRC' },
        importesFuenteFactura: { subtotalOriginal: Number(facturaOriginal.subtotal), descuentoOriginal: Number(facturaOriginal.descuento || 0), totalOriginal: Number(facturaOriginal.total), montoAcreditado: Number(monto) },
        lineas: lineasSnapshot,
        alertas: [!perfilEmisor?.razonSocial || !perfilEmisor?.identificacion ? 'Perfil fiscal del emisor incompleto.' : null, !clienteOriginal?.documento_id ? 'Receptor sin identificación registrada.' : null, !clienteOriginal?.actividad_economica ? 'Receptor sin actividad económica registrada.' : null, ...lineasSnapshot.filter((l: any) => !l.productoCatalogoId || l.estadoRevisionFiscal !== 'Aprobado').map((l: any) => `Clasificación fiscal por revisar para "${l.descripcionFactura}".`)],
      };

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
          emisorNombre: perfilEmisor?.razonSocial || emisorNombre || 'DEMO · Granja Don Paco',
          emisorCedula: perfilEmisor?.identificacion || emisorCedula || 'DEMO-SIN-IDENTIFICACION',
          emisorCorreo: perfilEmisor?.correo || null,
          receptorNombre: clienteOriginal?.nombre || null,
          receptorCedula: clienteOriginal?.documento_id || null,
          receptorCorreo: clienteOriginal?.email || null,
          subtotal: Number(monto),
          total: Number(monto),
          condicionPago: 'Contado',
          estado: 'Borrador',
          notasCreditoId: facturaIdOriginal,
          ambiente: 'Pruebas',
          proveedor: 'Simulado',
          datosFiscalSnapshot: JSON.stringify(perfilSnapshot),
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

      const [clientes, catalogoFiscal, perfilFiscalEmisor] = await Promise.all([
        db.query.clientes.findMany(), db.query.productosCatalogo.findMany(),
        db.query.configuracionFiscalEmisor.findFirst({ where: eq(schema.configuracionFiscalEmisor.id, 'emisor') }),
      ]);
      const resolverProductoFiscal = (nombre: string) => {
        const matches = (catalogoFiscal as any[]).filter(p => String(p.nombre || '').trim().toLocaleLowerCase('es') === String(nombre || '').trim().toLocaleLowerCase('es'));
        const producto = matches.length === 1 ? matches[0] : null;
        return { matches, producto };
      };
      const emisorNombreFinal = perfilFiscalEmisor?.razonSocial || emisorNombre || 'DEMO · Granja Don Paco';
      const emisorCedulaFinal = perfilFiscalEmisor?.identificacion || emisorCedula || 'DEMO-SIN-IDENTIFICACION';
      const emisorCorreoFinal = perfilFiscalEmisor?.correo || emisorCorreo || null;

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
          const clave = `${emisorCedulaFinal.replace(/-/g, '')}${hoy.slice(0, 10).replace(/-/g, '')}${consecFE.replace(/-/g, '')}`;
          const lineasSnapshot = [...g.productos.entries()].map(([nombre, p]: [string, any]) => {
            const { matches, producto } = resolverProductoFiscal(nombre);
            const vigente = Boolean(producto && producto.fiscalVigenteDesde && producto.fiscalVigenteDesde <= hoy.slice(0, 10) && (!producto.fiscalVigenteHasta || producto.fiscalVigenteHasta >= hoy.slice(0, 10)));
            return { descripcionFactura: nombre, cantidad: Number(p.cantidad), subtotal: Number(p.subtotal), precioUnitario: Number(p.cantidad > 0 ? p.subtotal / p.cantidad : 0), productoCatalogoId: producto?.id || null, cabysCodigo: producto?.cabysCodigo || null, cabysDescripcion: producto?.cabysDescripcion || null, unidad: producto?.unidad || null, tratamientoFiscal: producto?.tratamientoFiscal || null, tarifaImpuesto: producto?.tarifaImpuesto ?? null, exoneracionReferencia: producto?.exoneracionReferencia || null, fiscalVigenteDesde: producto?.fiscalVigenteDesde || null, fiscalVigenteHasta: producto?.fiscalVigenteHasta || null, vigenteEnFechaDocumento: vigente, estadoRevisionFiscal: producto?.fiscalEstado || 'Sin producto fiscal asociado', coincidenciasCatalogo: matches.length, componentesPrecio: p.componentesPrecio };
          });
          const snapshotFiscal = { versionSnapshot: 1, creadoEn: hoy, modo: 'SIMULACION_NO_FISCAL', tipoDocumento: 'FacturaConsolidadaRuta', aviso: 'Documento de demostración; no se transmite ni constituye comprobante válido ante Hacienda.', moneda: perfilFiscalEmisor?.monedaPresentacion || 'CRC', emisor: perfilFiscalEmisor ? { razonSocial: perfilFiscalEmisor.razonSocial, identificacionTipo: perfilFiscalEmisor.identificacionTipo, identificacion: perfilFiscalEmisor.identificacion, actividadEconomica: perfilFiscalEmisor.actividadEconomica, correo: perfilFiscalEmisor.correo, telefono: perfilFiscalEmisor.telefono, provincia: perfilFiscalEmisor.provincia, canton: perfilFiscalEmisor.canton, distrito: perfilFiscalEmisor.distrito, estadoRevisionDeclarada: perfilFiscalEmisor.estadoRevision, referenciaRevision: perfilFiscalEmisor.referenciaEvidencia } : null, receptor: { clienteId: clienteReal.id, nombre: clienteReal.nombre, tipoIdentificacion: clienteReal.tipo_documento || null, identificacion: clienteReal.documento_id || null, actividadEconomica: clienteReal.actividad_economica || null, correo: clienteReal.email || null }, guiaId, ventasRutaIds: g.ventas.map((v: any) => v.id), condicionPago: esCredito ? 'Credito' : 'Contado', medioPago: medioPagoGrupo, importesFuenteFactura: { subtotal: g.subtotal, descuento: g.descuento, impuestos: 0, total: g.total }, lineas: lineasSnapshot, alertas: [!perfilFiscalEmisor?.razonSocial || !perfilFiscalEmisor?.identificacion ? 'Perfil del emisor incompleto.' : null, perfilFiscalEmisor && perfilFiscalEmisor.estadoRevision !== 'Revisado declarado' ? 'Perfil del emisor pendiente de revisión documental declarada.' : null, !clienteReal.documento_id ? 'Cliente sin identificación registrada.' : null, !clienteReal.actividad_economica ? 'Cliente sin actividad económica registrada.' : null, ...lineasSnapshot.flatMap((l: any) => [!l.productoCatalogoId ? `Producto "${l.descripcionFactura}" sin asociación única al catálogo fiscal.` : null, l.productoCatalogoId && l.estadoRevisionFiscal !== 'Aprobado' ? `Producto "${l.descripcionFactura}" con clasificación fiscal sin aprobación.` : null, l.productoCatalogoId && !l.vigenteEnFechaDocumento ? `Clasificación de "${l.descripcionFactura}" fuera de vigencia o sin fecha inicial.` : null])].filter(Boolean) };
          await tx.insert(facturas_electronicas).values({
            id: idFE,
            facturaId,
            tipoDocumento: 'Factura',
            consecutivo: consecFE,
            clave,
            fechaEmision: hoy,
            emisorNombre: emisorNombreFinal,
            emisorCedula: emisorCedulaFinal,
            emisorCorreo: emisorCorreoFinal,
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
            proveedor: 'Simulado',
            datosFiscalSnapshot: JSON.stringify(snapshotFiscal)
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
          const { matches: matchesProducto, producto: productoFiscal } = resolverProductoFiscal(v.producto);
          const snapshotNC = { versionSnapshot: 1, creadoEn: hoy, modo: 'SIMULACION_NO_FISCAL', tipoDocumento: 'NotaCreditoRuta', aviso: 'Nota de crédito simulada; validar motivo, referencia e importes con el contador.', emisor: perfilFiscalEmisor ? { razonSocial: perfilFiscalEmisor.razonSocial, identificacion: perfilFiscalEmisor.identificacion, actividadEconomica: perfilFiscalEmisor.actividadEconomica, monedaPresentacion: perfilFiscalEmisor.monedaPresentacion } : null, receptor: { clienteId: cli.id, nombre: cli.nombre, identificacion: cli.documento_id || null, actividadEconomica: cli.actividad_economica || null }, referencia: { ventaRutaId: v.id, tiquete: v.tiqueteConsecutivo || null, guiaId, motivo: 'Anulación/devolución de venta en ruta' }, importes: { montoAcreditado: Number(v.total), impuestos: 0 }, lineas: [{ descripcionFactura: v.producto, cantidad: Number(v.cartones), subtotal: Number(v.subtotal), cabysCodigo: productoFiscal?.cabysCodigo || null, cabysDescripcion: productoFiscal?.cabysDescripcion || null, tratamientoFiscal: productoFiscal?.tratamientoFiscal || null, tarifaImpuesto: productoFiscal?.tarifaImpuesto ?? null, exoneracionReferencia: productoFiscal?.exoneracionReferencia || null, estadoRevisionFiscal: productoFiscal?.fiscalEstado || 'Sin producto fiscal asociado', coincidenciasCatalogo: matchesProducto.length }], alertas: [!perfilFiscalEmisor?.razonSocial || !perfilFiscalEmisor?.identificacion ? 'Perfil del emisor incompleto.' : null, !cli.documento_id ? 'Receptor sin identificación registrada.' : null, !cli.actividad_economica ? 'Receptor sin actividad económica registrada.' : null, !productoFiscal || productoFiscal.fiscalEstado !== 'Aprobado' ? `Clasificación fiscal de "${v.producto}" pendiente de validar.` : null].filter(Boolean) };
          await tx.insert(facturas_electronicas).values({
            id: idNC,
            facturaId: ncFacturaId,
            tipoDocumento: 'NotaCredito',
            consecutivo: consecNC,
            clave: `${emisorCedulaFinal.replace(/-/g, '')}${hoy.slice(0, 10).replace(/-/g, '')}${consecNC.replace(/-/g, '')}`,
            fechaEmision: hoy,
            emisorNombre: emisorNombreFinal,
            emisorCedula: emisorCedulaFinal,
            emisorCorreo: emisorCorreoFinal,
            receptorNombre: cli.nombre,
            receptorCedula: cli.documento_id || null,
            subtotal: Number(v.total),
            descuento: 0,
            total: Number(v.total),
            condicionPago: 'Contado',
            estado: 'Borrador',
            notasCreditoId: v.id,
            ambiente: 'Pruebas',
            proveedor: 'Simulado',
            datosFiscalSnapshot: JSON.stringify(snapshotNC)
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
