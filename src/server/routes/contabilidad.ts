import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import * as schema from '../../db/schema';

const TIPOS = new Set(['Activo', 'Pasivo', 'Patrimonio', 'Ingreso', 'Costo', 'Gasto']);
const NATURALEZAS = new Set(['Deudora', 'Acreedora']);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fechaValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const POLITICAS_BASE = [
  { clave: 'marco', nombre: 'Marco de información financiera', normaReferencia: 'CCPA · NIIF completas / NIIF para las PYMES', pregunta: '¿Qué marco aplica a la entidad y desde qué período? Confirme elegibilidad y edición adoptada.' },
  { clave: 'aves', nombre: 'Aves ponedoras y activos biológicos', normaReferencia: 'IAS 41 / Sección 34 PYMES', pregunta: 'Defina base de medición, cambios de valor, mortalidad, descarte y evidencia de valuación.' },
  { clave: 'cosecha', nombre: 'Huevos al momento de recolección', normaReferencia: 'IAS 41 / Sección 34 PYMES', pregunta: 'Defina momento de reconocimiento y medición de producto agrícola en cosecha.' },
  { clave: 'inventarios', nombre: 'Costos y valoración de inventario', normaReferencia: 'IAS 2 / Sección 13 PYMES', pregunta: 'Defina fórmula de costo por clase, componentes del costo, mermas y deterioro.' },
  { clave: 'ingresos', nombre: 'Ingresos, descuentos y cuentas por cobrar', normaReferencia: 'IFRS 15 / Sección 23 PYMES · IFRS 9 / Sección 11 PYMES', pregunta: 'Defina reconocimiento de venta, descuentos, devoluciones, crédito y deterioro de saldos.' },
  { clave: 'gastos', nombre: 'Gastos y conciliación fiscal', normaReferencia: 'Marco contable aplicable · normativa tributaria CR', pregunta: 'Defina reconocimiento, soporte y conciliación entre gasto contable y deducibilidad fiscal.' },
  { clave: 'activos_fijos', nombre: 'Propiedad, planta y equipo', normaReferencia: 'IAS 16 / Sección 17 PYMES', pregunta: 'Defina umbral de capitalización, costo inicial, componentes, vida útil, depreciación, deterioro y disposición de equipo, vehículos e instalaciones.' },
  { clave: 'arrendamientos', nombre: 'Arrendamientos', normaReferencia: 'IFRS 16 / Sección 20 PYMES', pregunta: 'Evalúe contratos de alquiler de instalaciones, vehículos y equipo; documente clasificación, reconocimiento, exenciones y datos requeridos.' },
  { clave: 'beneficios_empleados', nombre: 'Beneficios a empleados', normaReferencia: 'IAS 19 / Sección 28 PYMES', pregunta: 'Defina reconocimiento y medición de salarios, cargas, vacaciones, aguinaldo, cesantía y otros beneficios aplicables.' },
  { clave: 'provisiones', nombre: 'Provisiones y contingencias', normaReferencia: 'IAS 37 / Sección 21 PYMES', pregunta: 'Defina criterios de provisión, medición, actualización, contingencias y revelaciones.' },
  { clave: 'impuesto_renta', nombre: 'Impuesto a las ganancias', normaReferencia: 'IAS 12 / Sección 29 PYMES', pregunta: 'Defina impuesto corriente, diferencias temporarias e impuesto diferido cuando corresponda; concilie con la base fiscal.' },
  { clave: 'instrumentos_financieros', nombre: 'Instrumentos financieros', normaReferencia: 'IFRS 9 / Secciones 11 y 12 PYMES', pregunta: 'Defina clasificación, medición, deterioro de cuentas por cobrar, bajas y revelaciones de activos y pasivos financieros.' },
  { clave: 'moneda_extranjera', nombre: 'Moneda extranjera', normaReferencia: 'IAS 21 / Sección 30 PYMES', pregunta: 'Defina moneda funcional, tipos de cambio y reconocimiento de diferencias en operaciones en moneda extranjera.' },
  { clave: 'partes_relacionadas', nombre: 'Partes relacionadas', normaReferencia: 'IAS 24 / Sección 33 PYMES', pregunta: 'Identifique partes relacionadas, transacciones, saldos, condiciones y revelaciones requeridas.' },
  { clave: 'hechos_posteriores', nombre: 'Hechos posteriores', normaReferencia: 'IAS 10 / Sección 32 PYMES', pregunta: 'Defina ventana de evaluación, hechos ajustables y no ajustables y fecha de autorización de estados financieros.' },
  { clave: 'cierre', nombre: 'Cierre, estimaciones y correcciones', normaReferencia: 'IAS 8 / secciones relacionadas PYMES', pregunta: 'Defina cierre, aprobaciones, tratamiento de estimaciones y correcciones de períodos.' },
];
const MAPEO_BASE = [
  { clave: 'venta_ruta', nombre: 'Venta de ruta / factura', dimensiones: ['Cliente', 'Producto', 'Ruta', 'Vendedor'], fiscal: 'CABYS, tarifa, descuentos y documento simulado' },
  { clave: 'venta_mostrador', nombre: 'Venta mostrador / factura', dimensiones: ['Cliente', 'Producto'], fiscal: 'CABYS, tarifa y descuentos' },
  { clave: 'cobro_efectivo', nombre: 'Cobro en efectivo', dimensiones: ['Factura', 'Cliente', 'Caja'], fiscal: 'Medio de pago declarado' },
  { clave: 'cobro_transferencia', nombre: 'Cobro por transferencia', dimensiones: ['Factura', 'Cliente', 'Banco'], fiscal: 'Medio de pago declarado' },
  { clave: 'cuenta_por_cobrar', nombre: 'Saldo de venta a crédito', dimensiones: ['Factura', 'Cliente', 'Vencimiento'], fiscal: 'Deterioro/IVA según política aprobada' },
  { clave: 'gasto_ruta', nombre: 'Gastos de ruta', dimensiones: ['Ruta', 'Vendedor', 'Comprobante'], fiscal: 'Hospedaje, combustible, dietas y otros; deducibilidad por CPA' },
  { clave: 'compra_insumos', nombre: 'Compra/recepción de alimento e insumos', dimensiones: ['Proveedor', 'Producto', 'Lote', 'Ubicación'], fiscal: 'Clasificación del comprobante por CPA' },
  { clave: 'movimiento_inventario', nombre: 'Traslado y devolución de inventario', dimensiones: ['Producto', 'Lote', 'Origen', 'Destino'], fiscal: 'Valorización según política de inventarios' },
  { clave: 'merma_devolucion', nombre: 'Merma, daño o devolución', dimensiones: ['Producto', 'Lote', 'Ruta', 'Causa'], fiscal: 'Nota de crédito/impuesto cuando corresponda' },
  { clave: 'produccion_agricola', nombre: 'Cosecha de huevos y medición de aves', dimensiones: ['Granja', 'Galerón', 'Lote', 'Fecha'], fiscal: 'Marco y medición por CPA' },
  { clave: 'activos_nomina_provisiones', nombre: 'Depreciación, nómina, provisiones e impuestos', dimensiones: ['Entidad', 'Centro de costo'], fiscal: 'Conciliación tributaria según política' },
];

/** Ledger foundation only: records remain drafts until explicitly posted. */
export function registrarRutasContabilidad(app: any, db: any, requirePermission: any, logAudit: any) {
  const { cuentasContables, cuentasContablesHistorial, periodosContables, secuenciasContables, asientosContables, lineasAsientoContable, politicasContables, politicasContablesHistorial, notasEstadosFinancieros, mapeosCuentasContables, granjas, galerones, lotes_aves, productosCatalogo, rutas, users, facturas, detallesFactura, pagos, gastos, movimientosInventario, inventario, clientes, facturas_electronicas, ventas_ruta, ventas_ruta_kg, produccion_diaria } = schema;
  const siguienteConsecutivo = async (tx: any) => {
    const [row] = await tx.insert(secuenciasContables).values({ id: 'asiento', ultimo: 1 }).onConflictDoUpdate({ target: secuenciasContables.id, set: { ultimo: sql`${secuenciasContables.ultimo} + 1` } }).returning({ ultimo: secuenciasContables.ultimo });
    return Number(row.ultimo);
  };

  app.post('/api/contabilidad/conteos-inventario', requirePermission('finanzas_resumen', 'create'), async (req: any, res: any) => {
    try {
      const body = req.body || {};
      const producto = String(body.producto || '').trim(); const unidad = String(body.unidad || '').trim();
      const ubicacion = String(body.ubicacion || '').trim(); const lote = String(body.lote || '').trim();
      const responsable = String(body.responsable || '').trim(); const evidencia = String(body.evidencia || '').trim();
      const cantidadFisica = Number(body.cantidadFisica);
      if (!producto || !unidad || !ubicacion || !responsable || !evidencia || !Number.isFinite(cantidadFisica) || cantidadFisica < 0) return res.status(400).json({ error: 'Indique producto, unidad, ubicación, cantidad contada, responsable y referencia del acta o evidencia.' });
      const stocks = await db.query.inventario.findMany({ where: and(eq(inventario.producto, producto), eq(inventario.unidad, unidad), eq(inventario.ubicacion, ubicacion)) });
      const stock = (stocks as any[]).filter(row => String(row.lote || '').trim() === lote).reduce((sum, row) => sum + Number(row.cantidad || 0), 0);
      const fecha = new Date().toISOString();
      const snapshotAntes = { producto, unidad, ubicacion, lote: lote || null, saldoRegistrado: stock };
      const snapshotDespues = { ...snapshotAntes, cantidadFisica, diferencia: Math.round((cantidadFisica - stock) * 1000) / 1000, responsable, evidencia, capturadoEn: fecha, estado: 'Pendiente de revisión; no modifica inventario ni crea asiento' };
      const id = crypto.randomUUID();
      await db.insert(schema.auditoria).values({ id, usuarioId: String(req.usuario?.id || ''), accion: 'Registrar', modulo: 'ConteoInventarioFisico', referenciaId: `${producto}|${unidad}|${ubicacion}|${lote}`, valoresAntes: JSON.stringify(snapshotAntes), valoresDespues: JSON.stringify(snapshotDespues), motivo: evidencia, fecha });
      res.status(201).json({ id, ...snapshotDespues });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo registrar el conteo físico.' }); }
  });

  app.get('/api/contabilidad/cuentas/:id/historial', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const id = String(req.params.id || '');
      const cuenta = await db.query.cuentasContables.findFirst({ where: eq(cuentasContables.id, id) });
      if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada.' });
      let historial = await db.query.cuentasContablesHistorial.findMany({ where: eq(cuentasContablesHistorial.cuentaId, id), orderBy: [desc(cuentasContablesHistorial.cambiadoEn)] });
      if (!historial.length) {
        const baseline = { id: crypto.randomUUID(), cuentaId: id, snapshotJson: JSON.stringify({ ...cuenta, notaHistorial: 'Línea base capturada al habilitar el historial; no reconstruye revisiones anteriores.' }), cambiadoPor: 'Línea base F1', cambiadoEn: new Date().toISOString() };
        await db.insert(cuentasContablesHistorial).values(baseline);
        historial = [baseline];
      }
      res.json({ historial: historial.map((row: any) => ({ ...row, snapshot: JSON.parse(row.snapshotJson) })) });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo consultar el historial de la cuenta.' }); }
  });

  app.patch('/api/contabilidad/cuentas/:id/clasificacion-flujo', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const id = String(req.params.id || '');
      const cuenta = await db.query.cuentasContables.findFirst({ where: eq(cuentasContables.id, id) });
      if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada.' });
      if (cuenta.revisionEstado !== 'Aprobada') return res.status(409).json({ error: 'La cuenta debe estar revisada por CPA antes de configurarla para el flujo de efectivo.' });
      const esEfectivoEquivalente = req.body?.esEfectivoEquivalente === true;
      const clasificacionFlujo = String(req.body?.clasificacionFlujo || '') || null;
      const revisorNombre = String(req.body?.revisorNombre || '').trim(); const revisorCredencial = String(req.body?.revisorCredencial || '').trim(); const evidencia = String(req.body?.evidencia || '').trim();
      if (esEfectivoEquivalente && cuenta.tipo !== 'Activo') return res.status(400).json({ error: 'Solo una cuenta clasificada como Activo puede ser efectivo o equivalente.' });
      if (clasificacionFlujo && !['Operacion', 'Inversion', 'Financiamiento'].includes(clasificacionFlujo)) return res.status(400).json({ error: 'Clasificación de flujo no válida.' });
      if (!revisorNombre || !revisorCredencial || evidencia.length < 10) return res.status(400).json({ error: 'Registre CPA revisor, credencial y referencia de aprobación para esta clasificación.' });
      const cambiadoPor = String(req.usuario?.id || ''); const cambiadoEn = new Date().toISOString();
      const snapshot = { ...cuenta, esEfectivoEquivalente, clasificacionFlujo, flujoRevisorNombre: revisorNombre, flujoRevisorCredencial: revisorCredencial, flujoEvidencia: evidencia, flujoActualizadoEn: cambiadoEn, flujoActualizadoPor: cambiadoPor };
      await db.update(cuentasContables).set({ esEfectivoEquivalente, clasificacionFlujo }).where(eq(cuentasContables.id, id));
      await db.insert(cuentasContablesHistorial).values({ id: crypto.randomUUID(), cuentaId: id, snapshotJson: JSON.stringify(snapshot), cambiadoPor: cambiadoPor || null, cambiadoEn });
      await logAudit(cambiadoPor, 'ClasificarCuentaFlujoEfectivo', 'CuentaContable', id, { esEfectivoEquivalente: cuenta.esEfectivoEquivalente, clasificacionFlujo: cuenta.clasificacionFlujo }, snapshot);
      res.json({ success: true, clasificacion: snapshot });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo guardar la clasificación del flujo.' }); }
  });

  app.get('/api/contabilidad/notas-estados', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const desde = String(req.query.desde || ''); const hasta = String(req.query.hasta || '');
      const all = await db.query.notasEstadosFinancieros.findMany({ orderBy: [desc(notasEstadosFinancieros.actualizadoEn)] });
      const notas = (all as any[]).filter(n => (!desde || n.periodoDesde === desde) && (!hasta || n.periodoHasta === hasta));
      res.json({ notas });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudieron cargar las notas.' }); }
  });

  app.post('/api/contabilidad/notas-estados', requirePermission('finanzas_resumen', 'create'), async (req: any, res: any) => {
    try {
      const periodoDesde = String(req.body?.periodoDesde || ''); const periodoHasta = String(req.body?.periodoHasta || '');
      const clave = String(req.body?.clave || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 80);
      const titulo = String(req.body?.titulo || '').trim(); const contenido = String(req.body?.contenido || '').trim();
      if (!fechaValida(periodoDesde) || !fechaValida(periodoHasta) || periodoDesde > periodoHasta || !clave || titulo.length < 3 || contenido.length < 10) return res.status(400).json({ error: 'Indique período válido, identificador, título y contenido de al menos 10 caracteres.' });
      const reemplazaNotaId = String(req.body?.reemplazaNotaId || '') || null;
      let version = 1;
      if (reemplazaNotaId) {
        const anterior = await db.query.notasEstadosFinancieros.findFirst({ where: eq(notasEstadosFinancieros.id, reemplazaNotaId) });
        if (!anterior || anterior.estado !== 'Aprobada' || anterior.clave !== clave || anterior.periodoDesde !== periodoDesde || anterior.periodoHasta !== periodoHasta) return res.status(409).json({ error: 'La nueva versión debe reemplazar una nota aprobada con el mismo período y clave.' });
        const yaReemplazada = await db.query.notasEstadosFinancieros.findFirst({ where: eq(notasEstadosFinancieros.reemplazaNotaId, reemplazaNotaId) });
        if (yaReemplazada) return res.status(409).json({ error: 'Esta versión ya tiene una sustitución. Use la versión aprobada más reciente.' });
        version = Number(anterior.version) + 1;
      }
      const usuarioId = String(req.usuario?.id || ''); const now = new Date().toISOString();
      const nota = { id: crypto.randomUUID(), periodoDesde, periodoHasta, clave, reemplazaNotaId, titulo, contenido, estado: 'Borrador', version, evidenciaReferencia: null, revisorNombre: null, revisorCredencial: null, creadoPor: usuarioId, creadoEn: now, actualizadoPor: usuarioId, actualizadoEn: now };
      await db.insert(notasEstadosFinancieros).values(nota);
      await logAudit(usuarioId, 'CrearNotaEstadoFinanciero', 'NotaEstadoFinanciero', nota.id, null, nota);
      res.status(201).json({ success: true, nota });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo crear la nota.' }); }
  });

  app.patch('/api/contabilidad/notas-estados/:id', requirePermission('finanzas_resumen', 'create'), async (req: any, res: any) => {
    try {
      const id = String(req.params.id || ''); const previo = await db.query.notasEstadosFinancieros.findFirst({ where: eq(notasEstadosFinancieros.id, id) });
      if (!previo) return res.status(404).json({ error: 'Nota no encontrada.' });
      if (previo.estado === 'Aprobada') return res.status(409).json({ error: 'Una nota aprobada no se modifica; cree una nueva versión para conservar la trazabilidad.' });
      if (Number(req.body?.version) !== Number(previo.version)) return res.status(409).json({ error: 'La nota cambió desde que la abrió. Actualice antes de editar.' });
      const titulo = String(req.body?.titulo || '').trim(); const contenido = String(req.body?.contenido || '').trim(); const estado = String(req.body?.estado || 'Borrador');
      if (titulo.length < 3 || contenido.length < 10 || !['Borrador', 'En revisión'].includes(estado)) return res.status(400).json({ error: 'Título, contenido y estado de revisión no válidos.' });
      const usuarioId = String(req.usuario?.id || ''); const now = new Date().toISOString();
      const actualizadas = await db.update(notasEstadosFinancieros).set({ titulo, contenido, estado, version: Number(previo.version) + 1, actualizadoPor: usuarioId, actualizadoEn: now }).where(and(eq(notasEstadosFinancieros.id, id), eq(notasEstadosFinancieros.version, Number(previo.version)))).returning();
      if (!actualizadas.length) return res.status(409).json({ error: 'La nota fue editada por otro usuario. Actualice y vuelva a intentar.' });
      await logAudit(usuarioId, 'ActualizarNotaEstadoFinanciero', 'NotaEstadoFinanciero', id, previo, actualizadas[0]);
      res.json({ success: true, nota: actualizadas[0] });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo guardar la nota.' }); }
  });

  app.post('/api/contabilidad/notas-estados/:id/aprobar', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const id = String(req.params.id || ''); const previo = await db.query.notasEstadosFinancieros.findFirst({ where: eq(notasEstadosFinancieros.id, id) });
      if (!previo) return res.status(404).json({ error: 'Nota no encontrada.' });
      if (previo.estado !== 'En revisión') return res.status(409).json({ error: 'Envíe la nota a revisión antes de aprobarla.' });
      const revisorNombre = String(req.body?.revisorNombre || '').trim(); const revisorCredencial = String(req.body?.revisorCredencial || '').trim(); const evidenciaReferencia = String(req.body?.evidenciaReferencia || '').trim();
      if (!revisorNombre || !revisorCredencial || evidenciaReferencia.length < 10) return res.status(400).json({ error: 'Registre CPA revisor, credencial y referencia documental de aprobación.' });
      const usuarioId = String(req.usuario?.id || ''); const now = new Date().toISOString();
      const actualizadas = await db.update(notasEstadosFinancieros).set({ estado: 'Aprobada', version: Number(previo.version) + 1, evidenciaReferencia, revisorNombre, revisorCredencial, actualizadoPor: usuarioId, actualizadoEn: now }).where(and(eq(notasEstadosFinancieros.id, id), eq(notasEstadosFinancieros.version, Number(previo.version)), eq(notasEstadosFinancieros.estado, 'En revisión'))).returning();
      if (!actualizadas.length) return res.status(409).json({ error: 'La nota cambió durante la aprobación. Actualice y vuelva a revisar.' });
      await logAudit(usuarioId, 'AprobarNotaEstadoFinanciero', 'NotaEstadoFinanciero', id, previo, actualizadas[0]);
      res.json({ success: true, nota: actualizadas[0], aviso: 'La identidad y documentación del revisor no se verifican automáticamente.' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo aprobar la nota.' }); }
  });

  app.get('/api/contabilidad/politicas', requirePermission('finanzas_resumen', 'view'), async (_req: any, res: any) => {
    try {
      await db.insert(politicasContables).values(POLITICAS_BASE.map(p => ({ id: `politica-${p.clave}`, ...p, criterio: null, justificacion: null, estado: 'Pendiente' }))).onConflictDoNothing({ target: politicasContables.clave });
      const rows = await db.query.politicasContables.findMany();
      res.json({ politicas: POLITICAS_BASE.map(base => ({ ...base, ...rows.find((row: any) => row.clave === base.clave) })), nota: 'Plantillas de trabajo. Ningún criterio se considera aprobado hasta registrar revisión profesional y evidencia.' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudieron cargar las políticas.' }); }
  });

  app.get('/api/contabilidad/politicas/:clave/historial', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const clave = String(req.params.clave || '');
      if (!POLITICAS_BASE.some(p => p.clave === clave)) return res.status(404).json({ error: 'Política no encontrada.' });
      let historial = await db.query.politicasContablesHistorial.findMany({ where: eq(politicasContablesHistorial.clave, clave), orderBy: [desc(politicasContablesHistorial.cambiadoEn)] });
      if (!historial.length) {
        const actual = await db.query.politicasContables.findFirst({ where: eq(politicasContables.clave, clave) });
        if (actual) {
          const baseline = { id: crypto.randomUUID(), clave, estado: actual.estado, snapshotJson: JSON.stringify({ ...actual, notaHistorial: 'Línea base capturada al habilitar el historial; no reconstruye versiones anteriores.' }), cambiadoPor: 'Línea base F1', cambiadoEn: new Date().toISOString() };
          await db.insert(politicasContablesHistorial).values(baseline);
          historial = [baseline];
        }
      }
      res.json({ historial: historial.map((row: any) => ({ ...row, snapshot: JSON.parse(row.snapshotJson) })) });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo consultar el historial.' }); }
  });

  app.put('/api/contabilidad/politicas/:clave', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const clave = String(req.params.clave || ''); const base = POLITICAS_BASE.find(p => p.clave === clave);
      if (!base) return res.status(404).json({ error: 'Política no encontrada.' });
      const criterio = String(req.body?.criterio || '').trim(); const justificacion = String(req.body?.justificacion || '').trim();
      const estado = String(req.body?.estado || 'Borrador'); const fechaVigencia = req.body?.fechaVigencia ? String(req.body.fechaVigencia) : null;
      const revisorNombre = String(req.body?.revisorNombre || '').trim(); const revisorCredencial = String(req.body?.revisorCredencial || '').trim(); const evidenciaAprobacion = String(req.body?.evidenciaAprobacion || '').trim();
      if (!['Borrador', 'En revisión', 'Aprobada', 'Requiere cambios', 'No aplica'].includes(estado) || criterio.length > 4000 || justificacion.length > 3000 || revisorNombre.length > 160 || revisorCredencial.length > 120 || evidenciaAprobacion.length > 500) return res.status(400).json({ error: 'Revise el estado y el tamaño de los campos.' });
      if (estado === 'En revisión' && (criterio.length < 10 || justificacion.length < 10)) return res.status(400).json({ error: 'Complete el criterio y su justificación antes de enviarla al contador.' });
      if (['Aprobada', 'No aplica'].includes(estado) && (criterio.length < 10 || justificacion.length < 10 || !fechaValida(String(fechaVigencia || '')) || !revisorNombre || !revisorCredencial || !evidenciaAprobacion)) return res.status(400).json({ error: 'Para aprobar o declarar no aplica, complete criterio/justificación, vigencia, CPA revisor, credencial y evidencia.' });
      const actualizadoEn = new Date().toISOString(); const actualizadoPor = String(req.usuario?.id || '');
      const anterior = await db.query.politicasContables.findFirst({ where: eq(politicasContables.clave, clave) });
      const revisionProfesional = ['Aprobada', 'No aplica'].includes(estado);
      const actualizado = await db.update(politicasContables).set({ criterio, justificacion, estado, fechaVigencia, revisorNombre: revisionProfesional ? revisorNombre : null, revisorCredencial: revisionProfesional ? revisorCredencial : null, evidenciaAprobacion: revisionProfesional ? evidenciaAprobacion : null, actualizadoPor, actualizadoEn }).where(eq(politicasContables.clave, clave)).returning();
      if (actualizado[0]) await db.insert(politicasContablesHistorial).values({ id: crypto.randomUUID(), clave, estado, snapshotJson: JSON.stringify(actualizado[0]), cambiadoPor: actualizadoPor || null, cambiadoEn: actualizadoEn });
      await logAudit(actualizadoPor, 'ActualizarPolitica', 'PoliticaContable', clave, anterior || null, actualizado[0] || { estado, fechaVigencia });
      res.json({ success: true, politica: actualizado[0] });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo guardar la política.' }); }
  });

  app.get('/api/contabilidad/mapeos', requirePermission('finanzas_resumen', 'view'), async (_req: any, res: any) => {
    try {
      await db.insert(mapeosCuentasContables).values(MAPEO_BASE.map(m => ({ id: `mapeo-${m.clave}`, clave: m.clave, nombre: m.nombre, dimensionesJson: JSON.stringify(m.dimensiones), tratamientoFiscal: m.fiscal, estado: 'Pendiente' }))).onConflictDoNothing({ target: mapeosCuentasContables.clave });
      const rows = await db.query.mapeosCuentasContables.findMany();
      res.json({ mapeos: MAPEO_BASE.map(base => { const row = rows.find((item: any) => item.clave === base.clave) || {}; let dimensiones: string[] = base.dimensiones; try { dimensiones = JSON.parse(row.dimensionesJson || '[]'); } catch { /* Use current template. */ } return { ...base, ...row, dimensiones }; }), nota: 'Los mapeos no generan asientos automáticamente. Requieren aprobación del CPA.' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudieron cargar los mapeos.' }); }
  });

  app.put('/api/contabilidad/mapeos/:clave', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const clave = String(req.params.clave || ''); const base = MAPEO_BASE.find(m => m.clave === clave);
      if (!base) return res.status(404).json({ error: 'Mapeo no encontrado.' });
      const estado = String(req.body?.estado || 'Borrador');
      const cuentaDebitoId = String(req.body?.cuentaDebitoId || '') || null; const cuentaCreditoId = String(req.body?.cuentaCreditoId || '') || null;
      const noAplicaJustificacion = String(req.body?.noAplicaJustificacion || '').trim(); const fechaVigencia = String(req.body?.fechaVigencia || '') || null;
      const revisorNombre = String(req.body?.revisorNombre || '').trim(); const revisorCredencial = String(req.body?.revisorCredencial || '').trim(); const evidenciaAprobacion = String(req.body?.evidenciaAprobacion || '').trim();
      if (!['Borrador', 'En revisión', 'Aprobado', 'No aplica'].includes(estado)) return res.status(400).json({ error: 'Estado de mapeo no válido.' });
      if (estado === 'No aplica') {
        if (noAplicaJustificacion.length < 10 || !revisorNombre || !revisorCredencial || !evidenciaAprobacion) return res.status(400).json({ error: 'Documente por qué no aplica e indique CPA revisor, credencial y evidencia.' });
      } else if (estado !== 'Borrador') {
        if (!cuentaDebitoId || !cuentaCreditoId || cuentaDebitoId === cuentaCreditoId || !fechaValida(String(fechaVigencia || ''))) return res.status(400).json({ error: 'Seleccione cuentas de débito y crédito distintas y una fecha de vigencia.' });
        const ids = new Set([cuentaDebitoId, cuentaCreditoId]); const cuentasElegidas = await db.query.cuentasContables.findMany();
        if (cuentasElegidas.filter((c: any) => ids.has(c.id)).length !== 2 || cuentasElegidas.some((c: any) => ids.has(c.id) && (c.estado !== 'Activa' || !c.permiteMovimiento || c.revisionEstado !== 'Aprobada'))) return res.status(400).json({ error: 'Use únicamente cuentas de movimiento activas y aprobadas por CPA.' });
      }
      if (['Aprobado', 'No aplica'].includes(estado) && (!revisorNombre || !revisorCredencial || !evidenciaAprobacion)) return res.status(400).json({ error: 'La aprobación o excepción requiere CPA revisor, credencial y referencia documental.' });
      const previo = await db.query.mapeosCuentasContables.findFirst({ where: eq(mapeosCuentasContables.clave, clave) });
      const actualizadoPor = String(req.usuario?.id || ''); const actualizadoEn = new Date().toISOString();
      const cambios = { cuentaDebitoId: estado === 'No aplica' ? null : cuentaDebitoId, cuentaCreditoId: estado === 'No aplica' ? null : cuentaCreditoId, estado, noAplicaJustificacion: estado === 'No aplica' ? noAplicaJustificacion : null, fechaVigencia, revisorNombre: ['Aprobado', 'No aplica'].includes(estado) ? revisorNombre : null, revisorCredencial: ['Aprobado', 'No aplica'].includes(estado) ? revisorCredencial : null, evidenciaAprobacion: ['Aprobado', 'No aplica'].includes(estado) ? evidenciaAprobacion : null, actualizadoPor, actualizadoEn };
      const actualizado = await db.update(mapeosCuentasContables).set(cambios).where(eq(mapeosCuentasContables.clave, clave)).returning();
      await logAudit(actualizadoPor, 'ActualizarMapeoContable', 'MapeoContable', clave, previo || null, actualizado[0] || cambios);
      res.json({ success: true, mapeo: actualizado[0] });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo guardar el mapeo.' }); }
  });

  app.get('/api/contabilidad/base', requirePermission('finanzas_resumen', 'view'), async (_req: any, res: any) => {
    try {
      const [cuentas, periodos, todosAsientos, lineas, granjasRows, galeronesRows, lotesRows, productosRows, rutasRows, usuariosRows] = await Promise.all([
        db.query.cuentasContables.findMany(),
        db.query.periodosContables.findMany({ orderBy: [desc(periodosContables.fechaInicio)] }),
        db.query.asientosContables.findMany({ orderBy: [desc(asientosContables.consecutivo)] }),
        db.query.lineasAsientoContable.findMany(),
        db.query.granjas.findMany(), db.query.galerones.findMany(), db.query.lotes_aves.findMany(),
        db.query.productosCatalogo.findMany(), db.query.rutas.findMany(), db.query.users.findMany(),
      ]);
      const cuentaMap = new Map(cuentas.map((c: any) => [c.id, c]));
      const lineasPorAsiento = new Map<string, any[]>();
      for (const linea of lineas as any[]) {
        if (!lineasPorAsiento.has(linea.asientoId)) lineasPorAsiento.set(linea.asientoId, []);
        lineasPorAsiento.get(linea.asientoId)!.push({ ...linea, cuenta: cuentaMap.get(linea.cuentaId) || null });
      }
      const reversosPorOrigen = new Map((todosAsientos as any[]).filter(a => a.reversaDeId).map(a => [a.reversaDeId, a]));
      const movimientos = (todosAsientos as any[]).map(a => ({ ...a, reversadoPor: reversosPorOrigen.get(a.id) || null, lineas: lineasPorAsiento.get(a.id) || [] }));
      const saldos = new Map<string, { debitos: number; creditos: number }>();
      for (const a of movimientos.filter(a => a.estado === 'Contabilizado')) for (const l of a.lineas) {
        const saldo = saldos.get(l.cuentaId) || { debitos: 0, creditos: 0 };
        saldo.debitos += Number(l.debito || 0); saldo.creditos += Number(l.credito || 0); saldos.set(l.cuentaId, saldo);
      }
      const activas = (rows: any[]) => rows.filter((row: any) => !['Inactivo', 'Archivado', 'Finalizado'].includes(String(row.estado)));
      res.json({ cuentas, periodos, dimensiones: {
        granjas: activas(granjasRows as any[]).map((r: any) => ({ id: r.id, nombre: r.nombre })),
        galerones: activas(galeronesRows as any[]).map((r: any) => ({ id: r.id, nombre: r.nombre, granjaId: r.granjaId })),
        lotes: activas(lotesRows as any[]).map((r: any) => ({ id: r.id, nombre: `${r.linea_genetica} · ${r.fecha_ingreso}`, galeronId: r.galeronId })),
        productos: activas(productosRows as any[]).map((r: any) => ({ id: r.id, nombre: r.nombre })),
        rutas: activas(rutasRows as any[]).map((r: any) => ({ id: r.id, nombre: r.nombre })),
        vendedores: (usuariosRows as any[]).filter((r: any) => r.activo !== false && (/Comercial|Vendedor/i.test(`${r.role || ''} ${r.roles || ''}`))).map((r: any) => ({ id: r.id, nombre: r.name })),
      }, balanceComprobacion: cuentas.map((c: any) => {
        const s = saldos.get(c.id) || { debitos: 0, creditos: 0 };
        return { cuentaId: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, debitos: round2(s.debitos), creditos: round2(s.creditos), saldo: round2(c.naturaleza === 'Deudora' ? s.debitos - s.creditos : s.creditos - s.debitos) };
      }), asientos: movimientos.slice(0, 100) });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo cargar la base contable.' }); }
  });

  // Read-only reconciliation: makes missing operational-to-ledger links visible.
  // No operational record is posted automatically because tax/cost accounting
  // policies still require configuration and accountant approval.
  app.get('/api/contabilidad/cobertura', requirePermission('finanzas_resumen', 'view'), async (_req: any, res: any) => {
    try {
      const [facturasRows, pagosRows, gastosRows, inventarioRows, asientos] = await Promise.all([
        db.query.facturas.findMany(), db.query.pagos.findMany(), db.query.gastos.findMany(),
        db.query.movimientosInventario.findMany(), db.query.asientosContables.findMany(),
      ]);
      const reversados = new Set((asientos as any[]).filter(a => a.reversaDeId).map(a => a.reversaDeId));
      const refs = new Map<string, { borrador: number; contabilizado: number; revertido: number }>();
      for (const a of asientos as any[]) {
        if (!a.referenciaTipo || !a.referenciaId || a.referenciaTipo === 'Reverso') continue;
        const key = `${a.referenciaTipo}:${a.referenciaId}`;
        const row = refs.get(key) || { borrador: 0, contabilizado: 0, revertido: 0 };
        if (a.estado === 'Borrador') row.borrador++;
        if (a.estado === 'Contabilizado') { row.contabilizado++; if (reversados.has(a.id)) row.revertido++; }
        refs.set(key, row);
      }
      const summarize = (tipo: string, records: any[], amount: (r: any) => number | null) => {
        const active = records.filter(r => !(tipo === 'Factura' && ['Anulada', 'Anulado', 'NotaCredito'].includes(String(r.estado))));
        let sinAsiento = 0; let soloBorrador = 0; let contabilizados = 0; let revertidos = 0; let montoSinVincular = 0;
        for (const record of active) {
          const ref = refs.get(`${tipo}:${record.id}`);
          if (!ref || (!ref.borrador && !ref.contabilizado)) { sinAsiento++; montoSinVincular += amount(record) || 0; }
          else if (!ref.contabilizado && ref.borrador) soloBorrador++;
          else { contabilizados++; if (ref.revertido) revertidos++; }
        }
        return { fuente: tipo, registros: active.length, sinAsiento, soloBorrador, contabilizados, revertidos, montoSinVincular: amount(active[0] || {}) === null ? null : round2(montoSinVincular) };
      };
      const filas = [
        summarize('Factura', facturasRows as any[], r => Number.isFinite(Number(r.total)) ? Number(r.total) : null),
        summarize('Pago', pagosRows as any[], r => Number.isFinite(Number(r.monto)) ? Number(r.monto) : null),
        summarize('Gasto', gastosRows as any[], r => Number.isFinite(Number(r.monto)) ? Number(r.monto) : null),
        summarize('MovimientoInventario', inventarioRows as any[], () => null),
      ];
      res.json({ generadoEn: new Date().toISOString(), filas, nota: 'Comparación por referencia exacta. No determina tratamiento fiscal, costo de inventario ni cumplimiento normativo.' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo calcular la cobertura contable.' }); }
  });

  // F7: period-scoped, read-only checks across sales, payments, demo fiscal
  // documents, route expenses, inventory references and posted ledger links.
  app.get('/api/contabilidad/conciliacion-f7', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const desde = String(req.query.desde || ''); const hasta = String(req.query.hasta || '');
      if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return res.status(400).json({ error: 'Indique un rango de fechas válido.' });
      const [invoices, payments, documents, expenses, approvals, inventoryMoves, entries] = await Promise.all([
        db.query.facturas.findMany(), db.query.pagos.findMany(), db.query.facturas_electronicas.findMany(),
        db.query.gastos.findMany(), db.query.aprobaciones.findMany(), db.query.movimientosInventario.findMany(),
        db.query.asientosContables.findMany(),
      ]);
      const inRange = (date: any) => String(date || '').slice(0, 10) >= desde && String(date || '').slice(0, 10) <= hasta;
      const invoiceRows = (invoices as any[]).filter(f => inRange(f.fecha));
      const invoiceIds = new Set(invoiceRows.map(f => String(f.id)));
      const paymentRows = (payments as any[]).filter(p => !hasta || String(p.fecha || '') <= hasta);
      const paymentRowsInPeriod = (payments as any[]).filter(p => inRange(p.fecha));
      const paidByInvoice = new Map<string, number>();
      for (const p of paymentRows) paidByInvoice.set(String(p.facturaId), round2((paidByInvoice.get(String(p.facturaId)) || 0) + Number(p.monto || 0)));
      const docsByInvoice = new Map<string, any[]>();
      for (const d of documents as any[]) if (invoiceIds.has(String(d.facturaId)) && !['NotaCredito', 'Nota de crédito'].includes(String(d.tipoDocumento))) {
        const id = String(d.facturaId); if (!docsByInvoice.has(id)) docsByInvoice.set(id, []); docsByInvoice.get(id)!.push(d);
      }
      const expenseRows = (expenses as any[]).filter(g => inRange(g.fecha));
      const expenseIds = new Set(expenseRows.map(g => String(g.id)));
      const gastoRevision = new Map<string, any>();
      for (const a of (approvals as any[]).filter(a => a.tipo === 'GastoRuta').sort((a, b) => String(b.fechaSolicitud || '').localeCompare(String(a.fechaSolicitud || '')))) if (expenseIds.has(String(a.referenciaId)) && !gastoRevision.has(String(a.referenciaId))) gastoRevision.set(String(a.referenciaId), a);
      const refStates = new Map<string, { draft: number; posted: number; reversed: number }>();
      const reversed = new Set((entries as any[]).filter(a => a.reversaDeId).map(a => String(a.reversaDeId)));
      for (const a of entries as any[]) {
        if (!a.referenciaTipo || !a.referenciaId || a.referenciaTipo === 'Reverso') continue;
        const key = `${a.referenciaTipo}:${a.referenciaId}`; const value = refStates.get(key) || { draft: 0, posted: 0, reversed: 0 };
        if (a.estado === 'Borrador') value.draft++;
        if (a.estado === 'Contabilizado') { value.posted++; if (reversed.has(String(a.id))) value.reversed++; }
        refStates.set(key, value);
      }
      const facturas = invoiceRows.map((f: any) => {
        const total = Number(f.total || 0); const pagado = paidByInvoice.get(String(f.id)) || 0; const saldo = round2(total - pagado);
        const docs = docsByInvoice.get(String(f.id)) || []; const docMonto = docs.length === 1 ? Number(docs[0].total || 0) : null;
        let fiscalSnapshot: any = null; try { fiscalSnapshot = docs.length === 1 && docs[0].datosFiscalSnapshot ? JSON.parse(docs[0].datosFiscalSnapshot) : null; } catch { fiscalSnapshot = null; }
        const ref = refStates.get(`Factura:${f.id}`); const estado = String(f.estado || '').toLowerCase();
        const alertas: string[] = [];
        if (!docs.length && !['anulada', 'anulado'].includes(estado)) alertas.push('Sin documento demo asociado');
        if (docs.length > 1) alertas.push('Más de un documento demo asociado');
        if (docMonto != null && Math.abs(total - docMonto) > 0.01) alertas.push('Monto factura/documento distinto');
        const importesSnapshot = fiscalSnapshot?.importesFuenteFactura || fiscalSnapshot?.importes || null;
        if (importesSnapshot && Math.abs(Number(importesSnapshot.total || 0) - total) > 0.01) alertas.push('Total del snapshot fiscal distinto a la factura');
        if (importesSnapshot && Math.abs(Number(importesSnapshot.subtotal || 0) - Number(f.subtotal || 0)) > 0.01) alertas.push('Subtotal del snapshot fiscal distinto a la factura');
        if (importesSnapshot && Math.abs(Number(importesSnapshot.descuento || 0) - Number(f.descuento || 0)) > 0.01) alertas.push('Descuento del snapshot fiscal distinto a la factura');
        const subtotalLineasSnapshot = Array.isArray(fiscalSnapshot?.lineas) ? fiscalSnapshot.lineas.reduce((sum: number, linea: any) => sum + Number(linea.subtotal || 0), 0) : null;
        if (subtotalLineasSnapshot != null && Math.abs(subtotalLineasSnapshot - Number(f.subtotal || 0)) > 0.01) alertas.push('Suma de líneas del snapshot distinta al subtotal');
        const totalCalculadoDemo = importesSnapshot ? Number(importesSnapshot.subtotal || 0) - Number(importesSnapshot.descuento || 0) + Number(importesSnapshot.impuestos || 0) : null;
        if (totalCalculadoDemo != null && Math.abs(totalCalculadoDemo - Number(importesSnapshot.total || 0)) > 0.01) alertas.push('La aritmética del snapshot fiscal demo no cuadra');
        if (pagado - total > 0.01) alertas.push('Pagos exceden el total');
        if (estado === 'pagada' && saldo > 0.01) alertas.push('Estado Pagada con saldo pendiente según pagos registrados');
        if (estado !== 'pagada' && Math.abs(saldo) <= 0.01 && pagado > 0) alertas.push('Pagos cubren el total pero el estado no dice Pagada');
        if (Number(ref?.posted || 0) <= Number(ref?.reversed || 0)) alertas.push(ref?.draft ? 'Solo tiene asiento en borrador' : ref?.posted ? 'Asiento contabilizado revertido; falta reposición' : 'Sin asiento contabilizado por referencia');
        const lineasSnapshot = Array.isArray(fiscalSnapshot?.lineas) ? fiscalSnapshot.lineas : [];
        const observacionesTributariasDemo = [Number(importesSnapshot?.impuestos ?? docs[0]?.impuestos ?? 0) === 0 ? 'Impuesto declarado como ₡0 en la simulación; confirmar tratamiento fiscal con CPA.' : null, ...lineasSnapshot.flatMap((linea: any) => [!linea.cabysCodigo ? `Línea sin CABYS (${linea.descripcionFactura || 'sin descripción'}).` : null, !linea.tratamientoFiscal ? `Línea sin tratamiento fiscal (${linea.descripcionFactura || 'sin descripción'}).` : null, linea.estadoRevisionFiscal && linea.estadoRevisionFiscal !== 'Aprobado' ? `Clasificación no aprobada (${linea.descripcionFactura || 'sin descripción'}).` : null])].filter(Boolean);
        return { id: f.id, fecha: f.fecha, consecutivo: f.consecutivo, estado: f.estado, total, pagadoAlCorte: round2(pagado), saldoPorPagos: saldo, documentosDemo: docs.length, documentoDemoEstado: docs.map(d => `${d.tipoDocumento}: ${d.estado} · ${d.ambiente || 'Pruebas'}`).join(' | '), montoDocumentoDemo: docMonto, diferenciaFacturaDocumento: docMonto == null ? null : round2(total - docMonto), impuestoDeclaradoDemo: Number(importesSnapshot?.impuestos ?? (docs.length === 1 ? docs[0].impuestos : 0)) || 0, observacionesTributariasDemo, asientoBorrador: ref?.draft || 0, asientosContabilizados: Math.max(0, Number(ref?.posted || 0) - Number(ref?.reversed || 0)), alertas };
      });
      const gastosReporte = expenseRows.map((g: any) => {
        let datos: any = {}; try { datos = JSON.parse(gastoRevision.get(String(g.id))?.datos || '{}'); } catch { datos = {}; }
        const ref = refStates.get(`Gasto:${g.id}`); const alertas: string[] = [];
        if (!datos.comprobante) alertas.push('Sin imagen de comprobante adjunta');
        if (gastoRevision.get(String(g.id))?.estado === 'Pendiente') alertas.push('Pendiente de revisión administrativa');
        if (Number(ref?.posted || 0) <= Number(ref?.reversed || 0)) alertas.push(ref?.draft ? 'Solo tiene asiento en borrador' : ref?.posted ? 'Asiento contabilizado revertido; falta reposición' : 'Sin asiento contabilizado por referencia');
        return { id: g.id, fecha: g.fecha, categoria: g.categoria, monto: Number(g.monto || 0), medioPago: g.medioPago, guiaId: g.guiaId, estadoRevision: gastoRevision.get(String(g.id))?.estado || 'Sin revisión', comprobanteAdjunto: Boolean(datos.comprobante), asientoBorrador: ref?.draft || 0, asientosContabilizados: Math.max(0, Number(ref?.posted || 0) - Number(ref?.reversed || 0)), alertas };
      });
      const pagosReporte = paymentRowsInPeriod.map((p: any) => {
        const ref = refStates.get(`Pago:${p.id}`); const invoiceExists = (invoices as any[]).some(f => String(f.id) === String(p.facturaId)); const alertas: string[] = [];
        if (!invoiceExists) alertas.push('Factura asociada no encontrada');
        if (!Number.isFinite(Number(p.monto)) || Number(p.monto) <= 0) alertas.push('Monto de pago inválido');
        if (Number(ref?.posted || 0) <= Number(ref?.reversed || 0)) alertas.push(ref?.posted ? 'Asiento contabilizado revertido; falta reposición' : ref?.draft ? 'Solo tiene asiento en borrador' : 'Sin asiento contabilizado por referencia');
        return { id: p.id, facturaId: p.facturaId, fecha: p.fecha, monto: Number(p.monto || 0), metodo: p.metodo || 'No indicado', usuarioId: p.usuarioId || null, asientoBorrador: ref?.draft || 0, asientosContabilizados: Math.max(0, Number(ref?.posted || 0) - Number(ref?.reversed || 0)), alertas };
      });
      const movimientos = (inventoryMoves as any[]).filter(m => inRange(m.fecha)).map((m: any) => {
        const ref = refStates.get(`MovimientoInventario:${m.id}`);
        const alerta = Number(ref?.posted || 0) <= Number(ref?.reversed || 0) ? ref?.draft ? 'Solo tiene asiento en borrador' : ref?.posted ? 'Asiento contabilizado revertido; falta reposición' : 'Sin asiento contabilizado por referencia' : null;
        return { id: m.id, fecha: m.fecha, tipo: m.tipo, producto: m.producto, cantidad: Number(m.cantidad || 0), unidad: m.unidad || null, lote: m.lote || null, origen: m.origen, destino: m.destino, asientoBorrador: ref?.draft || 0, asientosContabilizados: Math.max(0, Number(ref?.posted || 0) - Number(ref?.reversed || 0)), alerta };
      });
      const docRows = [...docsByInvoice.values()].flat();
      res.json({ generadoEn: new Date().toISOString(), periodo: { desde, hasta }, base: 'Conciliación informativa por referencias exactas y pagos registrados hasta la fecha final.', resumen: {
        facturas: facturas.length, facturasSinDocumentoDemo: facturas.filter(f => f.alertas.includes('Sin documento demo asociado')).length,
        documentosConMontoDistinto: facturas.filter(f => f.alertas.includes('Monto factura/documento distinto')).length, facturasConObservacionTributariaDemo: facturas.filter(f => f.observacionesTributariasDemo.length).length,
        facturasConSaldo: facturas.filter(f => f.saldoPorPagos > 0.01).length, pagosSobreAplicados: facturas.filter(f => f.alertas.includes('Pagos exceden el total')).length,
        estadosPagoInconsistentes: facturas.filter(f => f.alertas.some((a: string) => a.includes('estado') || a.includes('Estado'))).length,
        documentosDemo: docRows.length, pagosEnPeriodo: pagosReporte.length, pagosSinAsientoContabilizado: pagosReporte.filter(p => !p.asientosContabilizados).length, gastos: gastosReporte.length, gastosSinComprobante: gastosReporte.filter(g => !g.comprobanteAdjunto).length,
        gastosPendientesRevision: gastosReporte.filter(g => g.estadoRevision === 'Pendiente').length, movimientosInventario: movimientos.length,
        movimientosSinAsientoContabilizado: movimientos.filter(m => !m.asientosContabilizados).length,
      }, facturas, pagos: pagosReporte, gastos: gastosReporte, movimientosInventario: movimientos, limitaciones: [
        'Los documentos electrónicos listados son simulaciones; no acreditan emisión, recepción, aceptación ni validez ante Hacienda.',
        'La factura operativa no conserva un desglose tributario validado; el monto de impuesto del documento demo no determina el impuesto correcto.',
        'La referencia exacta indica vínculo técnico, no que el asiento sea correcto o completo. Los borradores y asientos revertidos sin reposición no cuentan como contabilizados.',
        'La conciliación de inventario de esta salida es por vínculo del movimiento al mayor; las cantidades físicas se consultan en el informe separado y no incluyen costo/valoración.',
        'La imagen adjunta a un gasto es evidencia de archivo, no validación del comprobante ni de deducibilidad fiscal.',
      ] });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo preparar la conciliación F7.' }); }
  });

  // Full payload export for the accountant: simulated XML, response text,
  // fiscal snapshots and route-expense receipt images with content hashes.
  app.get('/api/contabilidad/exportar-anexos', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const desde = String(req.query.desde || ''); const hasta = String(req.query.hasta || '');
      if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return res.status(400).json({ error: 'Indique un rango de fechas válido.' });
      const [docs, invoices, expenses, approvals] = await Promise.all([db.query.facturas_electronicas.findMany(), db.query.facturas.findMany(), db.query.gastos.findMany(), db.query.aprobaciones.findMany()]);
      const hashContenido = (value: any) => value ? createHash('sha256').update(String(value)).digest('hex') : null;
      const invoiceIds = new Set((invoices as any[]).filter(f => String(f.fecha || '').slice(0, 10) >= desde && String(f.fecha || '').slice(0, 10) <= hasta).map(f => String(f.id)));
      const documentos = (docs as any[]).filter(d => invoiceIds.has(String(d.facturaId)) || (String(d.fechaEmision || '').slice(0, 10) >= desde && String(d.fechaEmision || '').slice(0, 10) <= hasta)).map(d => {
        let respuesta: any = null; try { respuesta = d.respuestaHacienda ? JSON.parse(d.respuestaHacienda) : null; } catch { respuesta = { raw: d.respuestaHacienda || null }; }
        return { id: d.id, facturaId: d.facturaId, consecutivo: d.consecutivo, clave: d.clave, tipoDocumento: d.tipoDocumento, fechaEmision: d.fechaEmision, estado: d.estado, ambiente: d.ambiente || 'Pruebas', proveedor: d.proveedor || 'Simulado', simulado: Boolean(d.datosFiscalSnapshot?.includes('SIMULACION_NO_FISCAL') || String(d.ambiente || '').toLowerCase() === 'pruebas'), montos: { subtotal: Number(d.subtotal || 0), descuento: Number(d.descuento || 0), impuestos: Number(d.impuestos || 0), total: Number(d.total || 0) }, snapshotFiscal: d.datosFiscalSnapshot || null, xmlGenerado: d.xmlGenerado || null, xmlFirmado: d.xmlFirmado || null, respuestaRaw: d.respuestaHacienda || null, respuestaParseada: respuesta, hashesSha256: { snapshotFiscal: hashContenido(d.datosFiscalSnapshot), xmlGenerado: hashContenido(d.xmlGenerado), xmlFirmado: hashContenido(d.xmlFirmado), respuestaRaw: hashContenido(d.respuestaHacienda) }, nota: 'Los estados, XML, firmas y respuestas de simulación no son evidencia de recepción oficial.' };
      });
      const gastoIds = new Set((expenses as any[]).filter(g => String(g.fecha || '').slice(0, 10) >= desde && String(g.fecha || '').slice(0, 10) <= hasta).map(g => String(g.id)));
      const comprobantesPorGasto = new Map<string, any>();
      for (const a of (approvals as any[]).filter(a => a.tipo === 'GastoRuta').sort((a, b) => String(b.fechaSolicitud || '').localeCompare(String(a.fechaSolicitud || '')))) if (gastoIds.has(String(a.referenciaId)) && !comprobantesPorGasto.has(String(a.referenciaId))) comprobantesPorGasto.set(String(a.referenciaId), a);
      const comprobantes = [...comprobantesPorGasto.values()].map(a => {
        let datos: any = {}; try { datos = JSON.parse(a.datos || '{}'); } catch { datos = { raw: a.datos || null }; }
        const contenido = datos.comprobante || null;
        return { gastoId: a.referenciaId, estadoRevision: datos.revisionEstado || a.estado, referenciaAprobacionId: a.id, comprobanteDataUri: contenido, sha256: hashContenido(contenido), nota: 'El adjunto no valida autenticidad, requisitos tributarios ni deducibilidad.' };
      });
      const manifiesto = [...documentos.flatMap(d => [
        ...(d.snapshotFiscal ? [{ tipo: 'snapshotFiscal', referenciaId: d.id, sha256: d.hashesSha256.snapshotFiscal }] : []),
        ...(d.xmlGenerado ? [{ tipo: 'xmlGeneradoDemo', referenciaId: d.id, sha256: d.hashesSha256.xmlGenerado }] : []),
        ...(d.xmlFirmado ? [{ tipo: 'xmlFirmadoDemo', referenciaId: d.id, sha256: d.hashesSha256.xmlFirmado }] : []),
        ...(d.respuestaRaw ? [{ tipo: 'respuestaDemo', referenciaId: d.id, sha256: d.hashesSha256.respuestaRaw }] : []),
      ]), ...comprobantes.filter(c => c.comprobanteDataUri).map(c => ({ tipo: 'comprobanteGastoAdjunto', referenciaId: c.gastoId, sha256: c.sha256 }))];
      res.json({ tipoPaquete: 'ANEXOS_CONTADOR_DEMO', version: 1, algoritmoIntegridad: 'SHA-256 por contenido', generadoEn: new Date().toISOString(), periodo: { desde, hasta }, advertencia: 'Paquete de soporte para revisión. Los documentos fiscales son simulados y las imágenes de gastos requieren verificación humana.', resumen: { documentos: documentos.length, xmlGenerados: documentos.filter(d => d.xmlGenerado).length, respuestas: documentos.filter(d => d.respuestaRaw).length, comprobantesGasto: comprobantes.filter(c => c.comprobanteDataUri).length, comprobantesGastoFaltantes: comprobantes.filter(c => !c.comprobanteDataUri).length }, manifiesto, notaIntegridad: 'Las huellas permiten comparar el contenido recibido; no equivalen a firma digital, sello de tiempo ni validación de autenticidad.', documentos, comprobantesGasto: comprobantes });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudieron exportar los anexos.' }); }
  });

  // F3: read-only quantity reconciliation. It compares the physical balance
  // with the movement subledger and never assigns monetary values or posts entries.
  app.get('/api/contabilidad/conciliacion-inventario-fisico', requirePermission('finanzas_resumen', 'view'), async (_req: any, res: any) => {
    try {
      const [stocks, movements, production, flocks, barns, feedItems, feedMovements, auditRows, labels] = await Promise.all([
        db.query.inventario.findMany(), db.query.movimientosInventario.findMany(),
        db.query.produccion_diaria.findMany(), db.query.lotes_aves.findMany(), db.query.galerones.findMany(),
        db.query.inventario_alimento.findMany(), db.query.consumo_alimento.findMany(), db.query.auditoria.findMany(), db.query.etiquetas.findMany(),
      ]);
      const conteosFisicos = (auditRows as any[]).filter(row => row.modulo === 'ConteoInventarioFisico').map(row => {
        let valores: any = {}; try { valores = JSON.parse(row.valoresDespues || '{}'); } catch { /* Expose malformed historical record for review. */ }
        return { id: row.id, referenciaId: row.referenciaId, fecha: row.fecha, registradoPor: row.usuarioId, accion: row.accion, ...valores };
      }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
      const keyOf = (producto: any, unidad: any, ubicacion: any) => `${String(producto || '').trim()}\u0000${String(unidad || '').trim()}\u0000${String(ubicacion || '').trim()}`;
      const ledger = new Map<string, { producto: string; unidad: string; ubicacion: string; cantidad: number }>();
      const ubicacionesConMovimientoNoClasificado = new Map<string, Set<string>>();
      const tiposMovimientoConocidos = new Set(['Entrada Producción', 'Ingreso Manual', 'Ajuste Conteo Físico', 'Corrección Unidad Traslado', 'Corrección Unidad Remisión', 'Traslado', 'Recepción Bodega', 'Pérdida en Tránsito', 'Remisión', 'Venta', 'Retorno Camión', 'Aceptación Bodega', 'Retorno Sobrante Camión', 'Retorno a Cuarentena', 'Ajuste Conteo Positivo', 'Ajuste Conteo Negativo', 'Ajuste Peso Etiqueta', 'Liberación Cuarentena', 'Merma Ruta', 'Despacho demo a ruta']);
      const add = (producto: any, unidad: any, ubicacion: any, cantidad: number) => {
        // Endpoints such as Cliente, Merma, Venta, suppliers and count-source
        // labels are events/destinations, not physical stock locations.
        if (!ubicacion || /cliente|\bventa\b|merma|diferencia|conteo físico consolidado|proveedor|excepción ingreso manual/i.test(String(ubicacion)) || !Number.isFinite(cantidad)) return;
        const key = keyOf(producto, unidad, ubicacion); const row = ledger.get(key) || { producto: String(producto || ''), unidad: String(unidad || ''), ubicacion: String(ubicacion), cantidad: 0 };
        row.cantidad += cantidad; ledger.set(key, row);
      };
      for (const m of movements as any[]) {
        const tipo = String(m.tipo || ''); const cantidad = Number(m.cantidad || 0); const unidad = m.unidad || 'kg';
        if (!Number.isFinite(cantidad) || ['Corrección Unidad Traslado', 'Corrección Unidad Remisión'].includes(tipo)) continue;
        if (tipo === 'Ajuste Peso Etiqueta') {
          // This event stores a signed delta at the same physical location.
          // Treating it as an ordinary transfer either cancels it or drops negatives.
          add(m.producto, unidad, m.origen, cantidad);
          continue;
        }
        if (!tiposMovimientoConocidos.has(tipo)) for (const ubicacion of [m.origen, m.destino]) {
          if (!ubicacion) continue;
          const key = keyOf(m.producto, unidad, ubicacion); const tipos = ubicacionesConMovimientoNoClasificado.get(key) || new Set<string>();
          tipos.add(tipo || '(sin tipo)'); ubicacionesConMovimientoNoClasificado.set(key, tipos);
        }
        if (tipo === 'Entrada Producción' || tipo === 'Ingreso Manual' || tipo === 'Ajuste Conteo Físico') add(m.producto, unidad, m.destino, cantidad);
        else {
          add(m.producto, unidad, m.origen, -cantidad);
          if (!['Venta', 'Merma Ruta'].includes(tipo)) add(m.producto, unidad, m.destino, cantidad);
        }
      }
      const physical = new Map<string, { producto: string; unidad: string; ubicacion: string; cantidadFisica: number; actualizadoEn: string | null }>();
      for (const s of stocks as any[]) {
        const key = keyOf(s.producto, s.unidad, s.ubicacion); const row = physical.get(key) || { producto: String(s.producto || ''), unidad: String(s.unidad || ''), ubicacion: String(s.ubicacion || ''), cantidadFisica: 0, actualizadoEn: null };
        row.cantidadFisica += Number(s.cantidad || 0); if (!row.actualizadoEn || String(s.ultima_actualizacion || '') > row.actualizadoEn) row.actualizadoEn = s.ultima_actualizacion || null; physical.set(key, row);
      }
      const keys = new Set([...ledger.keys(), ...physical.keys()]);
      const comparacion = [...keys].map(key => {
        const libro = ledger.get(key); const fisico = physical.get(key); const base = libro || fisico!;
        const esperado = Number(libro?.cantidad || 0); const cantidadFisica = Number(fisico?.cantidadFisica || 0);
        const diferencia = Math.round((cantidadFisica - esperado) * 1000) / 1000;
        const movimientosSinClasificar = [...(ubicacionesConMovimientoNoClasificado.get(key) || [])];
        const estado = movimientosSinClasificar.length ? 'Requiere clasificar movimiento' : Math.abs(diferencia) < 0.001 ? 'Coincide por cantidad' : 'Revisar diferencia de cantidad';
        return { producto: base.producto, unidad: base.unidad, ubicacion: base.ubicacion, saldoPorMovimientos: Math.round(esperado * 1000) / 1000, cantidadFisica: Math.round(cantidadFisica * 1000) / 1000, diferencia, actualizadoEn: fisico?.actualizadoEn || null, estado, movimientosSinClasificar };
      }).sort((a, b) => a.estado.localeCompare(b.estado) || a.producto.localeCompare(b.producto) || a.ubicacion.localeCompare(b.ubicacion));
      const unidadesEnUbicacion = new Set(['EnBodega', 'Cargada', 'Retornada', 'EnCuarentena']);
      const etiquetaPorPosicion = new Map<string, Map<string, { cantidad: number; fechasVencimiento: string[]; etiquetasSinFecha: number }>>();
      for (const etiqueta of labels as any[]) {
        if (!unidadesEnUbicacion.has(String(etiqueta.estado || ''))) continue;
        const ubicacion = String(etiqueta.ubicacionActual || (etiqueta.estado === 'EnBodega' ? 'Bodega Central' : etiqueta.estado === 'EnCuarentena' ? 'Cuarentena Bodega' : '')).trim();
        if (!ubicacion) continue;
        const unidad = String(etiqueta.unidad || 'cartones');
        const cantidadEtiqueta = unidad === 'kg' ? Number(etiqueta.saldoKg ?? etiqueta.pesoNeto ?? etiqueta.cantidad) : Number(etiqueta.cantidad) > 0 ? 1 : 0;
        if (!Number.isFinite(cantidadEtiqueta) || cantidadEtiqueta <= 0) continue;
        const key = keyOf(etiqueta.producto, unidad, ubicacion);
        const lotesPosicion = etiquetaPorPosicion.get(key) || new Map<string, { cantidad: number; fechasVencimiento: string[]; etiquetasSinFecha: number }>();
        const lote = String(etiqueta.lote || '').trim() || 'Sin lote';
        const detalleLote = lotesPosicion.get(lote) || { cantidad: 0, fechasVencimiento: [], etiquetasSinFecha: 0 };
        detalleLote.cantidad += cantidadEtiqueta;
        const vencimiento = String(etiqueta.fechaVencimiento || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) detalleLote.fechasVencimiento.push(vencimiento);
        else detalleLote.etiquetasSinFecha += 1;
        lotesPosicion.set(lote, detalleLote);
        etiquetaPorPosicion.set(key, lotesPosicion);
      }
      const hoyUtc = new Date().toISOString().slice(0, 10);
      const describirLotes = (porLote: Map<string, { cantidad: number; fechasVencimiento: string[]; etiquetasSinFecha: number }>) => [...porLote.entries()].map(([lote, detalle]) => {
        const vencimientoProximo = detalle.fechasVencimiento.sort()[0] || null;
        const dias = vencimientoProximo ? Math.floor((Date.parse(`${vencimientoProximo}T00:00:00Z`) - Date.parse(`${hoyUtc}T00:00:00Z`)) / 86400000) : null;
        const estadoVencimiento = dias === null ? 'Sin fecha' : dias < 0 ? 'Vencido' : dias <= 30 ? 'Vence en 30 días' : 'Con fecha';
        return { lote, cantidad: Math.round(detalle.cantidad * 1000) / 1000, fechaVencimientoProxima: vencimientoProximo, etiquetasSinFecha: detalle.etiquetasSinFecha, estadoVencimiento };
      }).sort((a, b) => (a.fechaVencimientoProxima || '9999-12-31').localeCompare(b.fechaVencimientoProxima || '9999-12-31'));
      const trazabilidadLotes = [...physical.entries()].map(([key, saldo]) => {
        const porLote = etiquetaPorPosicion.get(key) || new Map<string, { cantidad: number; fechasVencimiento: string[]; etiquetasSinFecha: number }>();
        const cantidadEtiquetada = [...porLote.values()].reduce((sum, value: any) => sum + Number(value.cantidad || 0), 0);
        const saldoSinTrazabilidad = Number(saldo.cantidadFisica) - cantidadEtiquetada;
        const estado = saldoSinTrazabilidad < -0.001 ? 'Etiquetas exceden saldo' : saldoSinTrazabilidad > 0.001 ? 'Saldo sin lote identificado' : 'Lotes identificados por etiqueta';
        return { producto: saldo.producto, unidad: saldo.unidad, ubicacion: saldo.ubicacion, saldoRegistrado: Math.round(Number(saldo.cantidadFisica) * 1000) / 1000, cantidadEtiquetada: Math.round(cantidadEtiquetada * 1000) / 1000, saldoSinTrazabilidad: Math.round(saldoSinTrazabilidad * 1000) / 1000, lotes: describirLotes(porLote), estado };
      }).concat([...etiquetaPorPosicion.entries()].filter(([key]) => !physical.has(key)).map(([key, porLote]) => {
        const [producto, unidad, ubicacion] = key.split('\u0000');
        const cantidadEtiquetada = [...porLote.values()].reduce((sum, value: any) => sum + Number(value.cantidad || 0), 0);
        return { producto, unidad, ubicacion, saldoRegistrado: 0, cantidadEtiquetada: Math.round(cantidadEtiquetada * 1000) / 1000, saldoSinTrazabilidad: -Math.round(cantidadEtiquetada * 1000) / 1000, lotes: describirLotes(porLote), estado: 'Etiquetas exceden saldo' };
      })).sort((a, b) => a.estado.localeCompare(b.estado) || a.producto.localeCompare(b.producto) || a.ubicacion.localeCompare(b.ubicacion));
      // Compare each aggregate inventory lot independently. A location-level
      // total can match while labels are assigned to the wrong lot.
      const loteKey = (producto: any, unidad: any, ubicacion: any, lote: any) => JSON.stringify([String(producto || '').trim(), String(unidad || '').trim(), String(ubicacion || '').trim(), String(lote || '').trim() || 'Sin lote']);
      const saldoInventarioPorLote = new Map<string, { producto: string; unidad: string; ubicacion: string; lote: string; saldoRegistrado: number; fechasInventario: string[] }>();
      for (const stock of stocks as any[]) {
        const key = loteKey(stock.producto, stock.unidad, stock.ubicacion, stock.lote);
        const row = saldoInventarioPorLote.get(key) || { producto: String(stock.producto || ''), unidad: String(stock.unidad || ''), ubicacion: String(stock.ubicacion || ''), lote: String(stock.lote || '').trim() || 'Sin lote', saldoRegistrado: 0, fechasInventario: [] };
        row.saldoRegistrado += Number(stock.cantidad || 0);
        const fecha = String(stock.fecha_caducidad || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) row.fechasInventario.push(fecha);
        saldoInventarioPorLote.set(key, row);
      }
      const etiquetasActivasPorLote = new Map<string, { cantidadEtiquetada: number; fechasEtiqueta: string[]; etiquetasSinFecha: number }>();
      for (const etiqueta of labels as any[]) {
        if (!unidadesEnUbicacion.has(String(etiqueta.estado || ''))) continue;
        const ubicacion = String(etiqueta.ubicacionActual || (etiqueta.estado === 'EnBodega' ? 'Bodega Central' : etiqueta.estado === 'EnCuarentena' ? 'Cuarentena Bodega' : '')).trim();
        if (!ubicacion) continue;
        const unidad = String(etiqueta.unidad || 'cartones');
        const cantidad = unidad === 'kg' ? Number(etiqueta.saldoKg ?? etiqueta.pesoNeto ?? etiqueta.cantidad) : Number(etiqueta.cantidad) > 0 ? 1 : 0;
        if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
        const key = loteKey(etiqueta.producto, unidad, ubicacion, etiqueta.lote);
        const row = etiquetasActivasPorLote.get(key) || { cantidadEtiquetada: 0, fechasEtiqueta: [], etiquetasSinFecha: 0 };
        row.cantidadEtiquetada += cantidad;
        const fecha = String(etiqueta.fechaVencimiento || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) row.fechasEtiqueta.push(fecha); else row.etiquetasSinFecha += 1;
        etiquetasActivasPorLote.set(key, row);
      }
      const comparacionLotes = [...new Set([...saldoInventarioPorLote.keys(), ...etiquetasActivasPorLote.keys()])].map(key => {
        const saldo = saldoInventarioPorLote.get(key); const etiqueta = etiquetasActivasPorLote.get(key);
        const base = saldo || { producto: '', unidad: '', ubicacion: '', lote: 'Sin lote', saldoRegistrado: 0, fechasInventario: [] };
        const saldoRegistrado = Number(base.saldoRegistrado || 0); const cantidadEtiquetada = Number(etiqueta?.cantidadEtiquetada || 0);
        const diferencia = Math.round((cantidadEtiquetada - saldoRegistrado) * 1000) / 1000;
        const vencimientoInventario = [...new Set(base.fechasInventario || [])].sort()[0] || null;
        const vencimientoEtiqueta = [...new Set(etiqueta?.fechasEtiqueta || [])].sort()[0] || null;
        const diferenciaVencimiento = Boolean(vencimientoInventario && vencimientoEtiqueta && vencimientoInventario !== vencimientoEtiqueta);
        const estado = Math.abs(diferencia) >= 0.001 ? (diferencia > 0 ? 'Etiquetas exceden saldo del lote' : cantidadEtiquetada === 0 ? 'Lote sin etiquetas activas' : 'Saldo del lote sin etiqueta') : diferenciaVencimiento ? 'Vencimiento no coincide' : !vencimientoInventario && Boolean(vencimientoEtiqueta) ? 'Completar vencimiento en inventario' : 'Coincide por cantidad';
        return { producto: base.producto, unidad: base.unidad, ubicacion: base.ubicacion, lote: base.lote, saldoRegistrado: Math.round(saldoRegistrado * 1000) / 1000, cantidadEtiquetada: Math.round(cantidadEtiquetada * 1000) / 1000, diferencia, vencimientoInventario, vencimientoEtiqueta, etiquetasSinFecha: etiqueta?.etiquetasSinFecha || 0, estado };
      }).sort((a, b) => a.estado.localeCompare(b.estado) || a.producto.localeCompare(b.producto) || a.lote.localeCompare(b.lote));
      const movimientosSinLote = (movements as any[]).filter(m => !String(m.lote || '').trim() && !['Corrección Unidad Traslado', 'Corrección Unidad Remisión'].includes(String(m.tipo || ''))).map(m => ({ id: m.id, fecha: m.fecha, tipo: m.tipo, producto: m.producto, cantidad: Number(m.cantidad), unidad: m.unidad || 'kg', origen: m.origen, destino: m.destino, referenciaId: m.referencia_id || null, registradoPor: m.registradoPor || null, estado: 'Completar lote o validar que el movimiento no tenga lote' }));
      const feedConsumptionById = new Map<string, number>();
      for (const m of feedMovements as any[]) if (m.inventarioAlimentoId) feedConsumptionById.set(m.inventarioAlimentoId, (feedConsumptionById.get(m.inventarioAlimentoId) || 0) + Number(m.cantidadConsumida || 0));
      const latestFeedCount = new Map<string, any>();
      const latestFeedTransfer = new Map<string, string>();
      for (const a of auditRows as any[]) {
        if (a.modulo === 'ConteoAlimento' && a.referenciaId) { const prior = latestFeedCount.get(a.referenciaId); if (!prior || String(a.fecha) > String(prior.fecha)) { let conteo: any = null; try { conteo = JSON.parse(a.valoresDespues || 'null'); } catch { /* Keep invalid legacy audit visible as no parsed count. */ } latestFeedCount.set(a.referenciaId, { fecha: a.fecha, conteo }); } }
        if (a.modulo === 'TransferenciaAlimento' && a.referenciaId) latestFeedTransfer.set(a.referenciaId, [latestFeedTransfer.get(a.referenciaId) || '', String(a.fecha)].sort().at(-1) || '');
      }
      const alimentoComparacion = (feedItems as any[]).map(item => {
        const conteo = latestFeedCount.get(item.id); const ultimoTraslado = latestFeedTransfer.get(item.id) || '';
        const fechaConteo = conteo?.fecha || null; const conteoDesactualizado = Boolean(fechaConteo && ultimoTraslado > String(fechaConteo));
        const movimientos = (feedMovements as any[]).filter(m => m.inventarioAlimentoId === item.id);
        const ultimoMovimiento = movimientos.reduce((max, m) => String(m.fecha) > max ? String(m.fecha) : max, '');
        const desactualizado = conteoDesactualizado || Boolean(fechaConteo && ultimoMovimiento > String(fechaConteo));
        const diferenciaConteo = conteo?.conteo?.diferencia == null ? null : Number(conteo.conteo.diferencia);
        const saldoPorMovimientos = Number(item.cantidadRecibida) - (feedConsumptionById.get(item.id) || 0);
        const estado = !conteo?.conteo ? 'Sin conteo físico' : desactualizado ? 'Conteo desactualizado' : Math.abs(Number(diferenciaConteo || 0)) < 0.001 ? 'Conciliado' : 'Revisar';
        return { tipoInventario: 'Alimento', producto: `${item.tipoAlimento} · lote ${item.loteAlimento || 'sin lote'}`, unidad: item.unidad, ubicacion: item.siloUbicacion || 'Sin ubicación', saldoPorMovimientos: Math.round(saldoPorMovimientos * 1000) / 1000, saldoRegistradoActual: Number(item.cantidadActual), cantidadFisica: conteo?.conteo?.cantidadFisica == null ? null : Number(conteo.conteo.cantidadFisica), diferencia: desactualizado ? null : diferenciaConteo, fechaConteo, responsableConteo: conteo?.conteo?.responsable || null, actualizadoEn: null, estado, nota: !conteo?.conteo ? 'No hay conteo físico capturado.' : desactualizado ? 'Hubo consumos, mermas o traslados posteriores al conteo; requiere nuevo conteo.' : 'La diferencia corresponde al saldo del sistema al momento del conteo.' };
      });
      const filasConciliacion = [...comparacion.map(r => ({ tipoInventario: 'Producto', ...r })), ...alimentoComparacion].sort((a, b) => a.estado.localeCompare(b.estado) || a.producto.localeCompare(b.producto) || a.ubicacion.localeCompare(b.ubicacion));
      const movementByRef = new Map<string, any[]>();
      for (const m of movements as any[]) if (m.referencia_id && m.tipo === 'Entrada Producción') { const list = movementByRef.get(String(m.referencia_id)) || []; list.push(m); movementByRef.set(String(m.referencia_id), list); }
      const productionIssues = (production as any[]).flatMap(p => {
        const linked = movementByRef.get(String(p.id)) || [];
        const matching = linked.filter(m => m.producto === p.tipo_producto && String(m.unidad || 'kg') === String(p.unidad || 'kg') && Math.abs(Number(m.cantidad) - Number(p.cantidad)) < 0.001);
        return matching.length === 1 ? [] : [{ produccionId: p.id, fecha: p.fecha, producto: p.tipo_producto, cantidad: Number(p.cantidad), unidad: p.unidad, granjaId: p.granjaId, galeronId: p.galeronId, loteId: p.loteId, movimientosAsociados: linked.length, estado: matching.length ? 'Movimiento duplicado o inconsistente' : 'Falta movimiento de entrada' }];
      });
      const productionWithoutResponsible = (production as any[]).filter(p => !p.registradoPor || !p.responsable).map(p => ({ produccionId: p.id, fecha: p.fecha, producto: p.tipo_producto, cantidad: Number(p.cantidad), unidad: p.unidad, granjaId: p.granjaId, galeronId: p.galeronId, loteId: p.loteId, registradoPor: p.registradoPor || null, responsable: p.responsable || null, estado: 'Completar atribución del registro' }));
      const barnsMap = new Map((barns as any[]).map(b => [b.id, b]));
      const posicionesCoincidentes = filasConciliacion.filter(r => ['Coincide por cantidad', 'Conciliado'].includes(r.estado)).length;
      const lotesConVencimiento = trazabilidadLotes.flatMap(r => r.lotes || []);
      res.json({ generadoEn: new Date().toISOString(), modo: 'solo_cantidades', filas: filasConciliacion, conteosFisicos, trazabilidadLotes, comparacionLotes, movimientosSinLote: movimientosSinLote.slice(0, 500), resumen: { posiciones: filasConciliacion.length, conciliadas: posicionesCoincidentes, coincidenPorCantidad: posicionesCoincidentes, requiereClasificarMovimiento: comparacion.filter(r => r.estado === 'Requiere clasificar movimiento').length, diferencias: filasConciliacion.length - posicionesCoincidentes, conteosFisicosRegistrados: conteosFisicos.length, posicionesLote: trazabilidadLotes.length, saldosSinLote: trazabilidadLotes.filter(r => r.estado === 'Saldo sin lote identificado').length, etiquetasExcedenSaldo: trazabilidadLotes.filter(r => r.estado === 'Etiquetas exceden saldo').length, lotesVencidos: lotesConVencimiento.filter(l => l.estadoVencimiento === 'Vencido').length, lotesPorVencer: lotesConVencimiento.filter(l => l.estadoVencimiento === 'Vence en 30 días').length, lotesSinFecha: lotesConVencimiento.filter(l => l.estadoVencimiento === 'Sin fecha').length, lotesConDiferencia: comparacionLotes.filter(l => l.estado !== 'Coincide por cantidad').length, movimientosSinLote: movimientosSinLote.length, alimentoPosiciones: alimentoComparacion.length, alimentoSinConteo: alimentoComparacion.filter(r => r.estado === 'Sin conteo físico').length, alimentoConteoDesactualizado: alimentoComparacion.filter(r => r.estado === 'Conteo desactualizado').length, alimentoConteoConDiferencia: alimentoComparacion.filter(r => r.estado === 'Revisar').length, produccionRegistrada: (production as any[]).length, produccionSinResponsable: productionWithoutResponsible.length, problemasVinculoProduccion: productionIssues.length }, produccionSinVinculo: productionIssues.slice(0, 200), produccionSinResponsable: productionWithoutResponsible.slice(0, 200), lotes: (flocks as any[]).map(f => ({ id: f.id, galeronId: f.galeronId, galeron: barnsMap.get(f.galeronId)?.nombre || null, lineaGenetica: f.linea_genetica, fechaIngreso: f.fecha_ingreso, avesIniciales: Number(f.cantidad_inicial), estado: f.estado, nota: 'Saldo inicial operativo; no es conteo vivo ni valoración contable.' })), limitaciones: ['Los conteos físicos de producto se registran como evidencia operativa y no modifican el saldo ni crean ajustes.', 'Las existencias de alimento se comparan con conteos físicos capturados al último conteo; acciones posteriores los marcan desactualizados.', 'En producto, “Coincide por cantidad” solo compara saldo calculado por movimientos clasificados con saldo registrado; no es conciliación contable ni validación de conteo físico.', 'La distribución por lote utiliza etiquetas activas como partición del saldo agregado; el remanente sin etiqueta queda sin lote identificable.', 'Las etiquetas son identidad de paquete y no certifican conteo físico actual; un código etiqueta sin lote no acredita trazabilidad de origen.', 'Los tipos de movimiento desconocidos mantienen la posición pendiente de clasificación, aunque los saldos calculados coincidan.', 'Compara cantidades con los movimientos registrados; los saldos iniciales sin movimiento aparecerán como diferencia.', 'Los registros de producción históricos no incluyen usuario/responsable si se crearon antes de este control.', 'No incluye costos ni valores contables y no determina el método de costo.', 'No valora aves/activos biológicos ni producto agrícola.', 'Los tipos documentales históricos pueden requerir normalización antes de usar el resultado como conciliación formal.'] });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo conciliar inventario físico.' }); }
  });

  app.get('/api/contabilidad/cobertura/detalle', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const fuente = String(req.query.fuente || '');
      const tipoPorFuente: Record<string, string> = { Factura: 'Factura', Pago: 'Pago', Gasto: 'Gasto', MovimientoInventario: 'MovimientoInventario' };
      const tipo = tipoPorFuente[fuente];
      if (!tipo) return res.status(400).json({ error: 'Seleccione una fuente válida.' });
      const [records, asientos] = await Promise.all([
        tipo === 'Factura' ? db.query.facturas.findMany() : tipo === 'Pago' ? db.query.pagos.findMany() : tipo === 'Gasto' ? db.query.gastos.findMany() : db.query.movimientosInventario.findMany(),
        db.query.asientosContables.findMany(),
      ]);
      const reversados = new Set((asientos as any[]).filter(a => a.reversaDeId).map(a => a.reversaDeId));
      const byReference = new Map<string, any[]>();
      for (const asiento of asientos as any[]) {
        if (asiento.referenciaTipo !== tipo || !asiento.referenciaId || asiento.estado === 'Reversado') continue;
        const group = byReference.get(String(asiento.referenciaId)) || [];
        group.push(asiento); byReference.set(String(asiento.referenciaId), group);
      }
      const pendientes = (records as any[]).filter(r => {
        if (tipo === 'Factura' && ['Anulada', 'Anulado', 'NotaCredito'].includes(String(r.estado))) return false;
        const journals = byReference.get(String(r.id)) || [];
        return !journals.some(a => a.estado === 'Contabilizado' && !reversados.has(a.id));
      });
      const clienteIds = tipo === 'Factura' ? [...new Set(pendientes.map(r => r.clienteId).filter(Boolean))] : [];
      const clientesRows = clienteIds.length ? await db.query.clientes.findMany() : [];
      const clientesMap = new Map((clientesRows as any[]).map(c => [c.id, c.nombre]));
      const detalle = pendientes.slice(0, 100).map((r: any) => ({
        id: r.id, fecha: r.fecha || '',
        documento: r.consecutivo || r.categoria || r.producto || tipo,
        detalle: tipo === 'Factura' ? String(clientesMap.get(r.clienteId) || 'Cliente sin nombre')
          : tipo === 'Pago' ? `Factura ${r.facturaId}`
            : tipo === 'Gasto' ? r.descripcion
              : `${r.tipo} · ${r.origen} → ${r.destino} · ${r.cantidad} ${r.unidad}`,
        monto: tipo === 'MovimientoInventario' ? null : Number(tipo === 'Factura' ? r.total : tipo === 'Pago' ? r.monto : r.monto) || 0,
        estado: r.estado || '',
        estadoAsiento: (byReference.get(String(r.id)) || []).some(a => a.estado === 'Borrador') ? 'Borrador existente' : (byReference.get(String(r.id)) || []).some(a => a.estado === 'Contabilizado' && reversados.has(a.id)) ? 'Asiento revertido' : 'Sin asiento contabilizado',
      }));
      res.json({ fuente: tipo, registros: detalle, limite: 100, truncado: pendientes.length > 100, nota: tipo === 'MovimientoInventario' ? 'No se propone monto porque el movimiento no tiene una valoración de costo vinculada.' : 'Monto de referencia del documento. Confirme tratamiento, impuestos y cuentas antes de contabilizar.' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo cargar el detalle de cobertura.' }); }
  });

  // Accountant handoff export: one normalized CSV with ledger and source rows.
  // The export preserves raw operational fields while flagging unconfigured tax/cost treatments.
  app.get('/api/contabilidad/exportar', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const desde = req.query.desde ? String(req.query.desde) : '';
      const hasta = req.query.hasta ? String(req.query.hasta) : '';
      if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta)) || (desde && hasta && desde > hasta)) return res.status(400).json({ error: 'El rango de fechas de exportación no es válido.' });
      const [cuentas, accountHistoryRows, periodos, allEntries, allLines, invoices, invoiceLines, paymentRows, expenseRows, inventoryRows, stockRows, electronicRows, clients, salesLegacy, salesKg, productionRows, flockRows, barnRows, policyRows, policyHistoryRows, mappingRows, feedInventoryRows, feedConsumptionRows, auditRows, wasteRows, returnRows, approvalRows] = await Promise.all([
        db.query.cuentasContables.findMany(), db.query.cuentasContablesHistorial.findMany(), db.query.periodosContables.findMany(), db.query.asientosContables.findMany(), db.query.lineasAsientoContable.findMany(),
        db.query.facturas.findMany(), db.query.detallesFactura.findMany(), db.query.pagos.findMany(), db.query.gastos.findMany(),
        db.query.movimientosInventario.findMany(), db.query.inventario.findMany(), db.query.facturas_electronicas.findMany(), db.query.clientes.findMany(),
        db.query.ventas_ruta.findMany(), db.query.ventas_ruta_kg.findMany(), db.query.produccion_diaria.findMany(), db.query.lotes_aves.findMany(), db.query.galerones.findMany(),
        db.query.politicasContables.findMany(), db.query.politicasContablesHistorial.findMany(), db.query.mapeosCuentasContables.findMany(),
        db.query.inventario_alimento.findMany(), db.query.consumo_alimento.findMany(), db.query.auditoria.findMany(), db.query.desperdicios.findMany(), db.query.retornos_camion.findMany(), db.query.aprobaciones.findMany(),
      ]);
      const inRange = (date: any) => (!desde || String(date || '') >= desde) && (!hasta || String(date || '') <= hasta);
      const entries = (allEntries as any[]).filter(a => inRange(a.fecha));
      const entryIds = new Set(entries.map(a => a.id));
      const lines = (allLines as any[]).filter(l => entryIds.has(l.asientoId));
      const invoiceRows = (invoices as any[]).filter(f => inRange(f.fecha));
      const invoiceIds = new Set(invoiceRows.map(f => f.id));
      const clientMap = new Map((clients as any[]).map(c => [c.id, c]));
      const accountMap = new Map((cuentas as any[]).map(c => [c.id, c]));
      const entryMap = new Map(entries.map((a: any) => [a.id, a]));
      const postedEntryIds = new Set(entries.filter((a: any) => a.estado === 'Contabilizado').map((a: any) => a.id));
      // The source's accounting relationship is global: a later reversal must
      // remain visible even when the accountant exports only the original date range.
      const reversedIds = new Set((allEntries as any[]).filter((a: any) => a.reversaDeId).map((a: any) => a.reversaDeId));
      const linked = new Set((allEntries as any[]).filter((a: any) => a.referenciaTipo && a.referenciaId && (a.estado === 'Borrador' || (a.estado === 'Contabilizado' && !reversedIds.has(a.id)))).map((a: any) => `${a.referenciaTipo}:${a.referenciaId}`));
      const paymentsToCutoff = (paymentRows as any[]).filter(p => !hasta || String(p.fecha || '') <= hasta);
      const paidByInvoice = new Map<string, number>();
      for (const p of paymentsToCutoff) paidByInvoice.set(p.facturaId, round2((paidByInvoice.get(p.facturaId) || 0) + Number(p.monto || 0)));
      const rows: any[] = [];
      const add = (seccion: string, values: Record<string, any>) => rows.push({ seccion, ...values });
      const mermasEnRango = (wasteRows as any[]).filter(d => inRange(d.fecha));
      const movimientosEnRango = (inventoryRows as any[]).filter(m => inRange(m.fecha));
      const movimientosSinActor = movimientosEnRango.filter(m => !m.registradoPor);
      const mermasSinAtribucion = mermasEnRango.filter(d => !d.registradoPor || !d.responsable);
      const mermasSinSoporte = mermasEnRango.filter(d => !d.evidencia);
      const retornosEnRango = (returnRows as any[]).filter(r => inRange(r.fecha));
      const retornosPendientes = retornosEnRango.filter(r => !['AceptadoBodega', 'Recibido'].includes(String(r.estado)));
      const retornosSinAtribucion = retornosEnRango.filter(r => !r.registradoPor || !r.responsable || (['AceptadoBodega', 'Recibido'].includes(String(r.estado)) && !r.aceptadoPor));
      const countCases = (approvalRows as any[]).filter(a => a.tipo === 'DiferenciaConteoBodega' && inRange(a.fechaSolicitud));
      const countCasesOpen = countCases.filter(a => ['Pendiente', 'RecuentoRequerido'].includes(String(a.estado)));
      add('LEEME', { detalle: 'Exportación para revisión del contador. No es un informe financiero certificado ni acredita cumplimiento NIIF/Hacienda.', extra: JSON.stringify({ generadoEn: new Date().toISOString(), desde: desde || null, hasta: hasta || null, moneda: 'CRC', periodoComparativo: 'Los saldos del balance son movimientos del rango y no incluyen saldos iniciales.', controlMovimientosInventario: { registrosEnRango: movimientosEnRango.length, sinUsuarioRegistrador: movimientosSinActor.length }, controlMermas: { registrosEnRango: mermasEnRango.length, sinAtribucionCompleta: mermasSinAtribucion.length, sinReferenciaDeEvidencia: mermasSinSoporte.length }, controlRetornos: { registrosEnRango: retornosEnRango.length, pendientesAceptacionBodega: retornosPendientes.length, sinAtribucionCompleta: retornosSinAtribucion.length }, controlDiferenciasConteo: { casosEnRango: countCases.length, pendientesReconteoOAprobacion: countCasesOpen.length }, limitaciones: ['Las facturas no contienen un desglose fiscal/CABYS completo en el modelo actual.', 'Los movimientos de inventario no contienen costo unitario valorado.', 'Los movimientos históricos sin usuario no se atribuyen por inferencia.', 'El total de factura de alimento es una referencia fuente sin asignación de costo ni distribución a producción.', 'El mayor incluye únicamente asientos guardados.', 'Las mermas se exportan como evidencia operativa y no son asientos ni pérdidas valoradas; valide causa, evidencia, cantidad y tratamiento con el contador.', 'Los retornos se exportan como hechos físicos/custodia; el valor monetario y su efecto contable no se infieren.', 'Los casos de conteo se exportan para seguimiento operativo; su aprobación no determina medición, importe ni asiento NIIF.'] }) });
      for (const c of cuentas as any[]) add('CUENTAS', { id: c.id, codigoCuenta: c.codigo, cuenta: c.nombre, tipoCuenta: c.tipo, naturaleza: c.naturaleza, estado: c.estado, extra: JSON.stringify({ cuentaPadreId: c.cuentaPadreId, permiteMovimiento: c.permiteMovimiento, revisionEstado: c.revisionEstado, revisionVigencia: c.revisionVigencia, revisionRevisorNombre: c.revisionRevisorNombre, revisionRevisorCredencial: c.revisionRevisorCredencial, revisionEvidencia: c.revisionEvidencia, revisionActualizadoEn: c.revisionActualizadoEn }) });
      for (const h of accountHistoryRows as any[]) add('HISTORIAL_CUENTAS', { id: h.id, referenciaTipo: 'CuentaContable', referenciaId: h.cuentaId, fecha: h.cambiadoEn, usuario: h.cambiadoPor, extra: h.snapshotJson });
      for (const p of policyRows as any[]) add('POLITICAS_CONTABLES', { id: p.clave, estado: p.estado, descripcion: p.nombre, fecha: p.fechaVigencia, extra: JSON.stringify({ normaReferencia: p.normaReferencia, criterio: p.criterio, justificacion: p.justificacion, revisorNombre: p.revisorNombre, revisorCredencial: p.revisorCredencial, evidenciaAprobacion: p.evidenciaAprobacion, actualizadoPor: p.actualizadoPor, actualizadoEn: p.actualizadoEn }) });
      for (const h of policyHistoryRows as any[]) add('HISTORIAL_POLITICAS', { id: h.id, estado: h.estado, referenciaTipo: 'PoliticaContable', referenciaId: h.clave, fecha: h.cambiadoEn, extra: h.snapshotJson });
      for (const m of mappingRows as any[]) add('MAPEOS_CUENTAS', { id: m.clave, estado: m.estado, descripcion: m.nombre, fecha: m.fechaVigencia, extra: JSON.stringify({ cuentaDebitoId: m.cuentaDebitoId, cuentaCreditoId: m.cuentaCreditoId, dimensiones: m.dimensionesJson, tratamientoFiscal: m.tratamientoFiscal, noAplicaJustificacion: m.noAplicaJustificacion, revisorNombre: m.revisorNombre, revisorCredencial: m.revisorCredencial, evidenciaAprobacion: m.evidenciaAprobacion, actualizadoPor: m.actualizadoPor, actualizadoEn: m.actualizadoEn }) });
      for (const p of periodos as any[]) add('PERIODOS', { id: p.id, fecha: p.fechaInicio, fechaFin: p.fechaFin, estado: p.estado, extra: JSON.stringify({ creadoPor: p.creadoPor, cerradoPor: p.cerradoPor, cerradoEn: p.cerradoEn }) });
      for (const a of entries as any[]) add('ASIENTOS', { id: a.id, fecha: a.fecha, consecutivo: a.consecutivo, estado: a.estado, referenciaTipo: a.referenciaTipo, referenciaId: a.referenciaId, descripcion: a.descripcion, extra: JSON.stringify({ periodoId: a.periodoId, creadoPor: a.creadoPor, creadoEn: a.creadoEn, contabilizadoPor: a.contabilizadoPor, contabilizadoEn: a.contabilizadoEn, reversaDeId: a.reversaDeId, reversado: reversedIds.has(a.id) }) });
      for (const l of lines as any[]) { const account: any = accountMap.get(l.cuentaId); add('LINEAS_ASIENTO', { id: l.id, fecha: (entryMap.get(l.asientoId) as any)?.fecha, consecutivo: (entryMap.get(l.asientoId) as any)?.consecutivo, referenciaId: l.asientoId, codigoCuenta: account?.codigo, cuenta: account?.nombre, debito: l.debito, credito: l.credito, descripcion: l.descripcion, extra: JSON.stringify({ cuentaId: l.cuentaId, terceroId: l.terceroId, granjaId: l.granjaId, galeronId: l.galeronId, loteId: l.loteId, productoId: l.productoId, rutaId: l.rutaId, vendedorId: l.vendedorId }) }); }
      const balances = new Map<string, { debitos: number; creditos: number }>();
      for (const l of lines as any[]) if (postedEntryIds.has(l.asientoId)) { const b = balances.get(l.cuentaId) || { debitos: 0, creditos: 0 }; b.debitos += Number(l.debito || 0); b.creditos += Number(l.credito || 0); balances.set(l.cuentaId, b); }
      for (const c of cuentas as any[]) { const b = balances.get(c.id) || { debitos: 0, creditos: 0 }; const saldo = c.naturaleza === 'Acreedora' ? b.creditos - b.debitos : b.debitos - b.creditos; add('BALANCE_COMPROBACION', { codigoCuenta: c.codigo, cuenta: c.nombre, tipoCuenta: c.tipo, debito: round2(b.debitos), credito: round2(b.creditos), monto: round2(saldo), extra: JSON.stringify({ naturaleza: c.naturaleza, nota: 'Movimientos del rango, sin saldo inicial.' }) }); }
      for (const f of invoiceRows as any[]) {
        const c: any = clientMap.get(f.clienteId); const pagado = paidByInvoice.get(f.id) || 0; const saldoCalculado = round2(Number(f.total || 0) - pagado);
        const esNotaCredito = ['NotaCredito', 'Nota de crédito'].includes(String(f.estado));
        const estadoConciliacion = esNotaCredito ? 'Nota de crédito' : Math.abs(saldoCalculado) <= 0.01 ? 'Conciliada' : pagado > 0 ? 'Pago parcial' : 'Pendiente de cobro';
        add('FACTURAS', { id: f.id, fecha: f.fecha, consecutivo: f.consecutivo, estado: f.estado, cliente: c?.nombre, documentoCliente: c?.documento_id, monto: f.total, descripcion: `Subtotal ${f.subtotal}; descuento ${f.descuento}`, referenciaId: f.guiaId, extra: JSON.stringify({ clienteId: f.clienteId, vendedorId: f.vendedorId, condicionPago: f.condicion_pago, medioPago: f.metodo_pago, camionId: f.camionId, pagosRegistradosAlCorte: pagado, saldoPorPagosRegistrados: esNotaCredito ? null : saldoCalculado, estadoConciliacion, inconsistenciaEstadoVsPagos: !esNotaCredito && String(f.estado).toLowerCase() === 'pagada' && saldoCalculado > 0.01, aviso: 'Confirmar tratamiento IVA/CABYS con el contador.' }) });
        add('CONCILIACION_CXC', { id: f.id, fecha: f.fecha, consecutivo: f.consecutivo, estado: estadoConciliacion, cliente: c?.nombre, documentoCliente: c?.documento_id, monto: f.total, debito: pagado, credito: esNotaCredito ? null : saldoCalculado, referenciaTipo: 'Factura', referenciaId: f.id, descripcion: esNotaCredito ? 'Nota de crédito excluida del cálculo de cobro' : 'Crédito = saldo por pagos registrados; validar contra auxiliar y banco.' });
        const docsAsociados = (electronicRows as any[]).filter(d => String(d.facturaId) === String(f.id) && !['NotaCredito', 'Nota de crédito'].includes(String(d.tipoDocumento)));
        const montoDocumento = docsAsociados.length === 1 ? Number(docsAsociados[0].total || 0) : null;
        const asientosFactura = (allEntries as any[]).filter(a => a.referenciaTipo === 'Factura' && String(a.referenciaId) === String(f.id));
        const asientoActivoFactura = asientosFactura.some(a => a.estado === 'Contabilizado' && !reversedIds.has(a.id));
        const diferencias: string[] = [];
        if (!docsAsociados.length && !esNotaCredito && !['Anulada', 'Anulado'].includes(String(f.estado))) diferencias.push('Sin documento demo asociado');
        if (docsAsociados.length > 1) diferencias.push('Más de un documento demo asociado');
        if (montoDocumento != null && Math.abs(Number(f.total) - montoDocumento) > 0.01) diferencias.push('Monto fuente/documento distinto');
        if (pagado - Number(f.total) > 0.01) diferencias.push('Pagos exceden el total');
        if (!asientoActivoFactura) diferencias.push(asientosFactura.length ? 'Asiento contabilizado revertido o solo borrador' : 'Sin asiento contabilizado en mayor');
        add('CONCILIACION_F7_FACTURA', { id: f.id, fecha: f.fecha, consecutivo: f.consecutivo, estado: diferencias.length ? 'Revisar' : 'Sin diferencia detectada', referenciaTipo: 'Factura', referenciaId: f.id, monto: f.total, debito: pagado, credito: round2(Number(f.total || 0) - pagado), descripcion: diferencias.join(' · ') || 'Comparación por pago registrado y documento demo vinculado', extra: JSON.stringify({ documentosDemo: docsAsociados.length, documentoDemoEstado: docsAsociados.map(d => `${d.tipoDocumento}:${d.estado}`).join(' | '), montoDocumentoDemo: montoDocumento, diferenciaMonto: montoDocumento == null ? null : round2(Number(f.total) - montoDocumento), saldoPorPagosAlCorte: saldoCalculado, impuestoDeclaradoDemo: docsAsociados.length === 1 ? Number(docsAsociados[0].impuestos || 0) : null, referenciaMayorExacta: linked.has(`Factura:${f.id}`), asientoContabilizadoActivo: asientoActivoFactura, alertas: diferencias, nota: 'La coincidencia del documento demo no valida impuesto, clasificación fiscal, aceptación ni conciliación bancaria.' }) });
      }
      for (const d of invoiceLines as any[]) if (invoiceIds.has(d.facturaId)) add('DETALLES_FACTURA', { id: d.id, referenciaId: d.facturaId, descripcion: d.producto, cantidad: d.cantidad, monto: d.subtotal, extra: JSON.stringify({ precioUnitario: d.precio_unitario, resolucionPrecio: d.resolucionPrecioJson, nota: 'La línea no tiene snapshot fiscal/CABYS en el esquema actual.' }) });
      for (const p of paymentRows as any[]) if (inRange(p.fecha)) { const paymentLinked = linked.has(`Pago:${p.id}`); add('PAGOS', { id: p.id, fecha: p.fecha, referenciaTipo: 'Factura', referenciaId: p.facturaId, estado: 'Registrado', monto: p.monto, descripcion: p.metodo || '', extra: JSON.stringify({ usuarioId: p.usuarioId, nota: p.nota, idempotencyKey: p.idempotencyKey, referenciaAsientoPagoEncontrada: paymentLinked, alertaConciliacion: paymentLinked ? null : 'Pago sin asiento con referencia Pago exacta' }) }); add('CONCILIACION_F7_PAGO', { id: p.id, fecha: p.fecha, estado: paymentLinked ? 'Referencia de asiento encontrada' : 'Revisar · pago sin asiento', referenciaTipo: 'Pago', referenciaId: p.id, monto: p.monto, descripcion: paymentLinked ? 'Vínculo técnico exacto con mayor; revisar asiento y extracto bancario.' : 'No hay asiento con referencia Pago exacta; revisar contabilización y extracto.', extra: JSON.stringify({ facturaId: p.facturaId, metodo: p.metodo || null, usuarioId: p.usuarioId || null }) }); }
      const gastoApprovalMap = new Map((approvalRows as any[]).filter(a => a.tipo === 'GastoRuta').map(a => [String(a.referenciaId), a]));
      for (const g of expenseRows as any[]) if (inRange(g.fecha)) { const approval: any = gastoApprovalMap.get(String(g.id)); let data: any = {}; try { data = JSON.parse(approval?.datos || '{}'); } catch { data = {}; } add('GASTOS', { id: g.id, fecha: g.fecha, estado: approval?.estado || 'Sin revisión', referenciaTipo: 'Gasto', referenciaId: g.id, monto: g.monto, descripcion: g.descripcion, extra: JSON.stringify({ categoria: g.categoria, usuarioId: g.usuarioId, medioPago: g.medioPago, guiaId: g.guiaId, revisionId: approval?.id || null, comprobanteAdjunto: Boolean(data.comprobante), comprobanteIncluidoEnPaqueteAnexos: Boolean(data.comprobante), referenciaAsientoMayor: linked.has(`Gasto:${g.id}`), nota: 'La imagen se entrega en el archivo JSON de anexos. El adjunto no valida autenticidad ni deducibilidad.' }) }); }
      for (const d of mermasEnRango) add('MERMA_OPERATIVA', { id: d.id, fecha: d.fecha, estado: d.aprobacion || 'Revisión operativa/contable pendiente', referenciaTipo: d.guiaId ? 'Guia' : d.rutaId ? 'Ruta' : 'Merma', referenciaId: d.guiaId || d.rutaId || d.id, descripcion: `${d.origen} · ${d.producto} · ${d.motivo}`, cantidad: d.cantidad, unidad: d.unidad, monto: Number(d.impactoFinanciero) > 0 ? d.impactoFinanciero : null, usuario: d.responsable, extra: JSON.stringify({ registradoPor: d.registradoPor || null, responsable: d.responsable || null, lote: d.lote || null, etiquetaId: d.etiquetaId || null, rutaId: d.rutaId || null, guiaId: d.guiaId || null, camionId: d.camionId || null, vendedorId: d.vendedorId || null, evidencia: d.evidencia || null, aprobacion: d.aprobacion || null, observaciones: d.observaciones || null, cantidadCartones: d.cantidadCartones == null ? null : Number(d.cantidadCartones), factorKgPorCarton: d.factorKgPorCarton == null ? null : Number(d.factorKgPorCarton), nota: 'Registro operativo fuente. El impacto financiero, si existe, es referencia sin costo/valoración validada; no crear asiento automáticamente.' }) });
      for (const r of retornosEnRango) add('RETORNO_OPERATIVO', { id: r.id, fecha: r.fecha, estado: r.estado, referenciaTipo: 'Guia', referenciaId: r.guiaId, descripcion: `${r.tipo || 'Retorno'} · ${r.producto} · ${r.condicion || 'condición no indicada'}`, cantidad: r.cartones, unidad: r.unidad || 'cartones', usuario: r.responsable, extra: JSON.stringify({ guiaId: r.guiaId, etiquetaId: r.etiquetaId || null, ventaRutaId: r.ventaRutaId || null, etiquetas: r.etiquetasJson || null, pesoMedido: r.peso == null ? null : Number(r.peso), cantidadAceptada: r.cantidadAceptada == null ? null : Number(r.cantidadAceptada), condicion: r.condicion || null, responsableRegistro: r.responsable || null, registradoPor: r.registradoPor || null, aceptadoPor: r.aceptadoPor || null, aceptadoEn: r.aceptadoEn || null, nota: 'Trazabilidad física de retorno y recepción; no es ingreso contable ni contiene valoración de inventario.' }) });
      for (const a of countCases) {
        let conteos: any = {}; try { conteos = JSON.parse(a.datos || '{}'); } catch { conteos = { datosSinParsear: a.datos || null }; }
        add('DIFERENCIA_CONTEO_OPERATIVA', { id: a.id, fecha: a.fechaSolicitud, estado: a.estado, referenciaTipo: 'Guia', referenciaId: a.referenciaId, descripcion: a.descripcion, usuario: a.solicitudUsuario, extra: JSON.stringify({ primerConteo: conteos.primerConteo || null, segundoConteo: conteos.segundoConteo || null, reconteos: conteos.reconteos || [], aprobadoPor: a.aprobadoPor || null, fechaResolucion: a.fechaResolucion || null, motivoResolucion: a.motivoRechazo || null, movimientosVinculados: movimientosEnRango.filter(m => m.referencia_id === a.id).map(m => ({ tipo: m.tipo, cantidad: Number(m.cantidad), unidad: m.unidad || null, origen: m.origen, destino: m.destino, fecha: m.fecha, registradoPor: m.registradoPor || null })), nota: 'Evidencia de conteo/cuarentena; no representa una valoración monetaria ni asiento contable.' }) });
      }
      for (const a of auditRows as any[]) if (a.modulo === 'ConteoInventarioFisico' && inRange(a.fecha)) {
        let conteo: any = {}; try { conteo = JSON.parse(a.valoresDespues || '{}'); } catch { conteo = { datosSinParsear: a.valoresDespues || null }; }
        add('CONTEO_FISICO_INVENTARIO', { id: a.id, fecha: a.fecha, estado: conteo.estado || 'Pendiente de revisión', referenciaTipo: 'Inventario', referenciaId: a.referenciaId, descripcion: `${conteo.producto || 'Producto'} · ${conteo.ubicacion || 'Ubicación sin indicar'} · lote ${conteo.lote || 'sin lote'}`, usuario: a.usuarioId, cantidad: conteo.cantidadFisica ?? null, unidad: conteo.unidad || null, extra: JSON.stringify({ saldoRegistradoAlContar: conteo.saldoRegistrado ?? null, diferencia: conteo.diferencia ?? null, responsable: conteo.responsable || null, evidencia: conteo.evidencia || a.motivo || null, nota: 'Conteo físico operativo; no altera el inventario ni constituye aprobación o asiento contable.' }) });
      }
      for (const m of movimientosEnRango) add('MOVIMIENTOS_INVENTARIO', { id: m.id, fecha: m.fecha, estado: m.tipo, referenciaId: m.referencia_id, descripcion: `${m.producto} · ${m.origen} → ${m.destino}`, cantidad: m.cantidad, unidad: m.unidad, usuario: m.registradoPor || null, extra: JSON.stringify({ lote: m.lote || null, registradoPor: m.registradoPor || null, referenciaAsientoMayor: linked.has(`MovimientoInventario:${m.id}`), nota: 'No incluye valoración de costo; no permite calcular costo de ventas.' }) });
      for (const s of stockRows as any[]) add('EXISTENCIAS_FISICAS', { id: s.id, estado: s.ubicacion, referenciaId: s.lote, descripcion: s.producto, cantidad: s.cantidad, unidad: s.unidad, fecha: s.ultima_actualizacion, extra: JSON.stringify({ ubicacion: s.ubicacion, lote: s.lote, vencimiento: s.fecha_caducidad, valorContable: null, nota: 'Cantidad física; costo y valor contable no están configurados.' }) });
      const routeSales = [
        ...(salesLegacy as any[]).filter(s => inRange(s.fechaHora)).map(s => ({ ...s, unidadVenta: s.unidad || 'kg', cantidadVenta: s.cartones, precioVenta: s.precioUnitario })),
        ...(salesKg as any[]).filter(s => inRange(s.fechaHora)).map(s => ({ ...s, unidadVenta: 'kg', cantidadVenta: s.cantidadKg, precioVenta: s.precioKg })),
      ];
      for (const s of routeSales) add('VENTAS_RUTA', { id: s.id, fecha: s.fechaHora, consecutivo: s.tiqueteConsecutivo, estado: s.estado, cliente: clientMap.get(s.clienteId)?.nombre, cantidad: s.cantidadVenta, unidad: s.unidadVenta, monto: s.total, referenciaTipo: 'Factura', referenciaId: s.facturaId, descripcion: s.producto, extra: JSON.stringify({ guiaId: s.guiaId, vendedorId: s.vendedorId, cobro: s.cobro, subtotal: s.subtotal, descuento: s.descuento, precioUnitario: s.precioVenta, vinculadaFactura: Boolean(s.facturaId) }) });
      for (const p of productionRows as any[]) if (inRange(p.fecha)) add('PRODUCCION_AGRICOLA', { id: p.id, fecha: p.fecha, estado: p.estado, referenciaId: p.loteId, descripcion: p.tipo_producto, cantidad: p.cantidad, unidad: p.unidad, usuario: p.responsable, extra: JSON.stringify({ granjaId: p.granjaId, galeronId: p.galeronId, registradoPor: p.registradoPor || null, responsable: p.responsable || null, nota: 'Cantidad física cosechada; falta valoración al punto de cosecha conforme política aplicable.' }) });
      const feedById = new Map((feedInventoryRows as any[]).map(i => [i.id, i]));
      const feedTransferDestinations = new Set<string>();
      for (const a of auditRows as any[]) if (a.modulo === 'TransferenciaAlimento') { try { const move = JSON.parse(a.valoresDespues || '{}'); if (move.inventarioDestinoId && move.inventarioDestinoId !== move.inventarioAlimentoId) feedTransferDestinations.add(String(move.inventarioDestinoId)); } catch { /* preserve the audit row as the source evidence */ } }
      for (const i of feedInventoryRows as any[]) if (inRange(i.fechaIngreso) && !feedTransferDestinations.has(String(i.id))) add('ALIMENTO_INVENTARIO', { id: i.id, fecha: i.fechaIngreso, estado: i.estado, referenciaTipo: 'DocumentoCompraFuente', referenciaId: i.referenciaDocumentoOrigen, descripcion: `${i.tipoAlimento} · ${i.proveedor || 'Proveedor no registrado'} · lote ${i.loteAlimento || 'sin lote'}`, cantidad: i.cantidadRecibida, unidad: i.unidad, monto: i.montoDocumentoOrigen, extra: JSON.stringify({ cantidadActual: i.cantidadActual, galeronId: i.galeronAsociado, loteAvesId: i.loteAvesAsociado, siloUbicacion: i.siloUbicacion, responsable: i.responsable, fechaDocumentoOrigen: i.fechaDocumentoOrigen, monedaDocumentoOrigen: i.monedaDocumentoOrigen, nota: 'Importe bruto de referencia del comprobante fuente; no equivale a costo unitario inventariable.' }) });
      for (const c of feedConsumptionRows as any[]) if (inRange(c.fecha)) { const source: any = feedById.get(c.inventarioAlimentoId); const esMerma = c.tipoMovimiento === 'Merma'; const esTransferencia = c.tipoMovimiento === 'Transferencia'; add(esMerma ? 'MERMA_ALIMENTO' : esTransferencia ? 'TRANSFERENCIA_ALIMENTO_SALIDA' : 'CONSUMO_ALIMENTO', { id: c.id, fecha: c.fecha, estado: 'Registrado', referenciaTipo: 'LoteAlimento', referenciaId: c.inventarioAlimentoId, descripcion: `${source?.tipoAlimento || 'Alimento'} · lote ${source?.loteAlimento || 'sin lote'}`, cantidad: c.cantidadConsumida, unidad: c.unidad, extra: JSON.stringify({ tipoMovimiento: c.tipoMovimiento || 'Consumo', galeronId: c.galeronId, loteAvesId: c.loteAvesId, responsable: c.responsable, observaciones: c.observaciones, documentoCompraFuente: source?.referenciaDocumentoOrigen || null, nota: esMerma ? 'Cantidad de merma física; requiere revisión de causa y tratamiento de costo.' : esTransferencia ? 'Salida interna hacia un galerón; no es consumo ni gasto.' : 'Cantidad consumida; aún no asignada a costo de producción ni asiento contable.' }) }); }
      for (const a of auditRows as any[]) if (a.modulo === 'ConteoAlimento' && inRange(a.fecha)) add('CONTEO_FISICO_ALIMENTO', { id: a.id, fecha: a.fecha, estado: 'Observado; sin ajuste de saldo', referenciaTipo: a.modulo, referenciaId: a.referenciaId, descripcion: a.motivo, extra: JSON.stringify({ usuarioId: a.usuarioId, antes: a.valoresAntes, conteo: a.valoresDespues, nota: 'Conteo operativo no aprobado ni contabilizado. Revisar diferencia y acta de soporte.' }) });
      for (const a of auditRows as any[]) if (a.modulo === 'TransferenciaAlimento' && inRange(a.fecha)) add('TRANSFERENCIA_ALIMENTO', { id: a.id, fecha: a.fecha, estado: 'Registrado; sin cambio de cantidad total', referenciaTipo: a.modulo, referenciaId: a.referenciaId, descripcion: a.motivo, extra: JSON.stringify({ usuarioId: a.usuarioId, antes: a.valoresAntes, traslado: a.valoresDespues, nota: 'Movimiento de ubicación de stock; revisar trazabilidad física. No es compra ni asiento.' }) });
      const barnsMap = new Map((barnRows as any[]).map(b => [b.id, b]));
      for (const f of flockRows as any[]) { const barn: any = barnsMap.get(f.galeronId); add('LOTES_AVES', { id: f.id, fecha: f.fecha_ingreso, estado: f.estado, referenciaId: f.galeronId, descripcion: barn ? `${barn.nombre} · ${f.linea_genetica}` : f.linea_genetica, cantidad: f.cantidad_inicial, unidad: 'aves iniciales', extra: JSON.stringify({ fechaIngreso: f.fecha_ingreso, galeronId: f.galeronId, nota: 'Saldo inicial de lote, no representa necesariamente el conteo vivo actual ni su medición contable.' }) }); }
      for (const b of barnRows as any[]) add('CONTEO_AVES_GALERON', { id: b.id, estado: b.estado, referenciaId: b.granjaId, descripcion: b.nombre, cantidad: b.aves_en_produccion, unidad: 'aves', extra: JSON.stringify({ capacidad: b.capacidad_maxima, tipo: b.tipo_galeron, nota: 'Conteo operativo, no valoración NIIF de activo biológico.' }) });
      for (const d of electronicRows as any[]) if (inRange(d.fechaEmision)) {
        let respuestaFiscal: any = null; try { respuestaFiscal = d.respuestaHacienda ? JSON.parse(d.respuestaHacienda) : null; } catch { /* Preserve raw source and flag for accountant review. */ }
        const simulado = Boolean(respuestaFiscal?.simulado) || String(d.ambiente || '').toLowerCase() === 'pruebas';
        add('DOCUMENTOS_ELECTRONICOS', { id: d.id, fecha: d.fechaEmision, consecutivo: d.consecutivo, estado: simulado ? `${d.estado} (DEMO)` : d.estado, referenciaTipo: 'Factura', referenciaId: d.facturaId, monto: d.total, descripcion: d.tipoDocumento, extra: JSON.stringify({ clave: d.clave, ambiente: d.ambiente, proveedor: d.proveedor, fechaEnvio: d.fechaEnvio, fechaRespuesta: d.fechaRespuesta, motivoRechazo: d.motivoRechazo, datosFiscalSnapshot: d.datosFiscalSnapshot || null, simulado, respuestaFiscal: respuestaFiscal || d.respuestaHacienda, nota: simulado ? 'Estado de demostración; no acredita recepción ni aceptación por Hacienda.' : 'Confirme aceptación real en el portal o API de Hacienda.' }) });
      }
      const ops: Array<{ tipo: string; records: any[]; date: (r: any) => any }> = [
        { tipo: 'Factura', records: invoiceRows, date: r => r.fecha },
        { tipo: 'Pago', records: paymentRows as any[], date: r => r.fecha },
        { tipo: 'Gasto', records: expenseRows as any[], date: r => r.fecha },
        { tipo: 'MovimientoInventario', records: inventoryRows as any[], date: r => r.fecha },
      ];
      for (const source of ops) for (const record of source.records) if (inRange(source.date(record)) && !linked.has(`${source.tipo}:${record.id}`)) add('PENDIENTE_VINCULAR', { id: record.id, fecha: source.date(record), referenciaTipo: source.tipo, referenciaId: record.id, estado: 'Sin asiento', descripcion: `Registro operativo ${source.tipo}` });
      const filename = `contabilidad-contador-${desde || 'inicio'}-${hasta || 'hoy'}.csv`;
      res.json({ filename, filas: rows, filasTotales: rows.length, columnas: ['seccion', 'fecha', 'fechaFin', 'id', 'consecutivo', 'estado', 'referenciaTipo', 'referenciaId', 'codigoCuenta', 'cuenta', 'tipoCuenta', 'naturaleza', 'cliente', 'documentoCliente', 'cantidad', 'unidad', 'debito', 'credito', 'monto', 'descripcion', 'usuario', 'extra'] });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo preparar la exportación contable.' }); }
  });

  app.get('/api/contabilidad/libro-mayor', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const cuentaId = String(req.query.cuentaId || ''); const desde = String(req.query.desde || ''); const hasta = String(req.query.hasta || '');
      if (!cuentaId || !fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return res.status(400).json({ error: 'Seleccione una cuenta e indique un rango de fechas válido.' });
      const cuenta = await db.query.cuentasContables.findFirst({ where: eq(cuentasContables.id, cuentaId) });
      if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada.' });
      const [asientos, lineas] = await Promise.all([db.query.asientosContables.findMany({ where: and(lte(asientosContables.fecha, hasta), eq(asientosContables.estado, 'Contabilizado')), orderBy: [asientosContables.fecha] }), db.query.lineasAsientoContable.findMany({ where: eq(lineasAsientoContable.cuentaId, cuentaId) })]);
      const cuentaMap = new Map([[cuenta.id, cuenta]]); const asientoMap = new Map(asientos.map((a: any) => [a.id, a]));
      const movimientos = (lineas as any[]).filter(l => asientoMap.has(l.asientoId)).map(l => ({ ...l, cuenta: cuentaMap.get(l.cuentaId), asiento: asientoMap.get(l.asientoId) }));
      movimientos.sort((a: any, b: any) => String(a.asiento.fecha).localeCompare(String(b.asiento.fecha)) || a.asiento.consecutivo - b.asiento.consecutivo);
      const natural = (m: any) => cuenta.naturaleza === 'Acreedora' ? Number(m.credito) - Number(m.debito) : Number(m.debito) - Number(m.credito);
      const previos = movimientos.filter((m: any) => m.asiento.fecha < desde); let saldo = round2(previos.reduce((s: number, m: any) => s + natural(m), 0)); const saldoAnterior = saldo;
      const detalle = movimientos.filter((m: any) => m.asiento.fecha >= desde).map((m: any) => { saldo = round2(saldo + natural(m)); return { ...m, saldo }; });
      res.json({ cuenta, periodo: { desde, hasta }, saldoAnterior, movimientos: detalle, totales: { debitos: round2(detalle.reduce((s: number, m: any) => s + Number(m.debito), 0)), creditos: round2(detalle.reduce((s: number, m: any) => s + Number(m.credito), 0)), saldo } });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo cargar el libro mayor.' }); }
  });

  app.get('/api/contabilidad/resultado-periodo', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const desde = String(req.query.desde || ''); const hasta = String(req.query.hasta || '');
      if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return res.status(400).json({ error: 'Indique fechas desde y hasta válidas.' });
      const asientos = await db.query.asientosContables.findMany({ where: and(gte(asientosContables.fecha, desde), lte(asientosContables.fecha, hasta), eq(asientosContables.estado, 'Contabilizado')) });
      const ids = new Set(asientos.map((a: any) => a.id)); const [lineas, cuentas] = await Promise.all([db.query.lineasAsientoContable.findMany(), db.query.cuentasContables.findMany()]); const cuentasMap = new Map(cuentas.map((c: any) => [c.id, c]));
      const detalle: Record<string, { cuentaId: string; codigo: string; nombre: string; tipo: string; saldo: number }> = {};
      for (const l of lineas as any[]) if (ids.has(l.asientoId)) { const c: any = cuentasMap.get(l.cuentaId); if (!c || !['Ingreso', 'Costo', 'Gasto'].includes(c.tipo)) continue; const row = detalle[c.id] || (detalle[c.id] = { cuentaId: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, saldo: 0 }); row.saldo += c.naturaleza === 'Acreedora' ? Number(l.credito) - Number(l.debito) : Number(l.debito) - Number(l.credito); }
      const rows = Object.values(detalle).map(r => ({ ...r, saldo: round2(r.saldo) })); const total = (tipo: string) => round2(rows.filter(r => r.tipo === tipo).reduce((s, r) => s + r.saldo, 0));
      const ingresos = total('Ingreso'); const costos = total('Costo'); const gastos = total('Gasto');
      res.json({ periodo: { desde, hasta }, base: 'Solo asientos contabilizados; no incluye registros operativos aún no mapeados.', ingresos, costos, gastos, resultado: round2(ingresos - costos - gastos), cuentas: rows });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo calcular el resultado desde el mayor.' }); }
  });

  // F5: preliminary statement package from posted ledger only. Classification,
  // cash-flow presentation and disclosures remain subject to CPA-approved setup.
  app.get('/api/contabilidad/paquete-estados', requirePermission('finanzas_resumen', 'view'), async (req: any, res: any) => {
    try {
      const desde = String(req.query.desde || ''); const hasta = String(req.query.hasta || '');
      if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return res.status(400).json({ error: 'Indique fechas desde y hasta válidas.' });
      const [asientos, lineas, cuentas, politicas, periodos] = await Promise.all([
        db.query.asientosContables.findMany({ where: lte(asientosContables.fecha, hasta) }),
        db.query.lineasAsientoContable.findMany(), db.query.cuentasContables.findMany(), db.query.politicasContables.findMany(), db.query.periodosContables.findMany(),
      ]);
      const cuentaMap = new Map((cuentas as any[]).map(c => [c.id, c]));
      const asientoMap = new Map((asientos as any[]).map(a => [a.id, a]));
      const acum = new Map<string, { apertura: number; movimiento: number; cierre: number; debitos: number; creditos: number }>();
      for (const l of lineas as any[]) {
        const a = asientoMap.get(l.asientoId); const c: any = cuentaMap.get(l.cuentaId);
        if (!a || a.estado !== 'Contabilizado' || !c || a.fecha > hasta) continue;
        const row = acum.get(c.id) || { apertura: 0, movimiento: 0, cierre: 0, debitos: 0, creditos: 0 };
        const debito = Number(l.debito || 0); const credito = Number(l.credito || 0);
        const neto = c.naturaleza === 'Acreedora' ? credito - debito : debito - credito;
        row.cierre += neto;
        if (a.fecha < desde) row.apertura += neto;
        else { row.movimiento += neto; row.debitos += debito; row.creditos += credito; }
        acum.set(c.id, row);
      }
      const rows = (cuentas as any[]).filter(c => c.permiteMovimiento !== false).map(c => {
        const s = acum.get(c.id) || { apertura: 0, movimiento: 0, cierre: 0, debitos: 0, creditos: 0 };
        return { cuentaId: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, revisionEstado: c.revisionEstado, apertura: round2(s.apertura), debitos: round2(s.debitos), creditos: round2(s.creditos), movimiento: round2(s.movimiento), cierre: round2(s.cierre) };
      });
      const list = (tipos: string[], field: 'apertura' | 'movimiento' | 'cierre') => rows.filter(r => tipos.includes(r.tipo) && (r[field] || 0) !== 0);
      const suma = (tipos: string[], field: 'apertura' | 'movimiento' | 'cierre') => round2(rows.filter(r => tipos.includes(r.tipo)).reduce((total, r) => total + r[field], 0));
      const ingresos = suma(['Ingreso'], 'movimiento'); const costos = suma(['Costo'], 'movimiento'); const gastos = suma(['Gasto'], 'movimiento');
      const resultadoPeriodo = round2(ingresos - costos - gastos);
      const activos = suma(['Activo'], 'cierre'); const pasivos = suma(['Pasivo'], 'cierre'); const patrimonioRegistrado = suma(['Patrimonio'], 'cierre');
      const resultadoAcumulado = round2(suma(['Ingreso'], 'cierre') - suma(['Costo'], 'cierre') - suma(['Gasto'], 'cierre'));
      const patrimonio = round2(patrimonioRegistrado + resultadoAcumulado);
      const fechaComparativa = (fecha: string) => { const date = new Date(`${fecha}T12:00:00Z`); date.setUTCFullYear(date.getUTCFullYear() - 1); return date.toISOString().slice(0, 10); };
      const comparDesde = fechaComparativa(desde); const comparHasta = fechaComparativa(hasta);
      const comparar = new Map<string, number>();
      for (const l of lineas as any[]) {
        const a = asientoMap.get(l.asientoId); const c: any = cuentaMap.get(l.cuentaId);
        if (!a || a.estado !== 'Contabilizado' || !c || a.fecha < comparDesde || a.fecha > comparHasta) continue;
        const neto = c.naturaleza === 'Acreedora' ? Number(l.credito || 0) - Number(l.debito || 0) : Number(l.debito || 0) - Number(l.credito || 0);
        comparar.set(`${c.tipo}:periodo`, (comparar.get(`${c.tipo}:periodo`) || 0) + neto);
      }
      const saldoComparativo = new Map<string, number>();
      for (const l of lineas as any[]) {
        const a = asientoMap.get(l.asientoId); const c: any = cuentaMap.get(l.cuentaId);
        if (!a || a.estado !== 'Contabilizado' || !c || a.fecha > comparHasta) continue;
        const neto = c.naturaleza === 'Acreedora' ? Number(l.credito || 0) - Number(l.debito || 0) : Number(l.debito || 0) - Number(l.credito || 0);
        saldoComparativo.set(c.tipo, (saldoComparativo.get(c.tipo) || 0) + neto);
      }
      const comp = (map: Map<string, number>, key: string) => round2(map.get(key) || 0);
      const comparIngresos = comp(comparar, 'Ingreso:periodo'); const comparCostos = comp(comparar, 'Costo:periodo'); const comparGastos = comp(comparar, 'Gasto:periodo');
      const comparActivos = comp(saldoComparativo, 'Activo'); const comparPasivos = comp(saldoComparativo, 'Pasivo');
      const comparPatrimonio = round2(comp(saldoComparativo, 'Patrimonio') + comp(saldoComparativo, 'Ingreso') - comp(saldoComparativo, 'Costo') - comp(saldoComparativo, 'Gasto'));
      const asientosPorPeriodo = new Map<string, { debitos: number; creditos: number }>();
      for (const l of lineas as any[]) {
        const a = asientoMap.get(l.asientoId); if (!a || a.estado !== 'Contabilizado' || a.fecha < desde || a.fecha > hasta) continue;
        const total = asientosPorPeriodo.get(a.id) || { debitos: 0, creditos: 0 };
        total.debitos += Number(l.debito || 0); total.creditos += Number(l.credito || 0); asientosPorPeriodo.set(a.id, total);
      }
      const asientosDescuadrados = [...asientosPorPeriodo.entries()].filter(([, t]) => Math.abs(t.debitos - t.creditos) > 0.01).map(([id, t]) => ({ id, diferencia: round2(t.debitos - t.creditos) }));
      const borradoresPendientes = (asientos as any[]).filter(a => a.estado === 'Borrador' && a.fecha >= desde && a.fecha <= hasta).length;
      const periodoContable = (periodos as any[]).find(p => p.fechaInicio <= desde && p.fechaFin >= hasta) || null;
      const efectivoIds = new Set((cuentas as any[]).filter(c => c.esEfectivoEquivalente === true || Number(c.esEfectivoEquivalente) === 1).map(c => c.id));
      let efectivoInicial = 0; let efectivoFinal = 0; let variacionEfectivo = 0; let operacion = 0; let inversion = 0; let financiamiento = 0; let contrapartidasSinClasificar = 0; let movimientosAmbiguos = 0;
      const lineasPorAsiento = new Map<string, any[]>();
      for (const linea of lineas as any[]) { const group = lineasPorAsiento.get(linea.asientoId) || []; group.push(linea); lineasPorAsiento.set(linea.asientoId, group); }
      for (const a of asientos as any[]) {
        if (a.estado !== 'Contabilizado' || a.fecha > hasta) continue;
        const entryLines = lineasPorAsiento.get(a.id) || [];
        const cashLines = entryLines.filter(l => efectivoIds.has(l.cuentaId)); if (!cashLines.length) continue;
        const cashDebits = cashLines.reduce((sum, l) => sum + Number(l.debito || 0), 0); const cashCredits = cashLines.reduce((sum, l) => sum + Number(l.credito || 0), 0); const delta = cashDebits - cashCredits;
        if (a.fecha < desde) { efectivoInicial += delta; continue; }
        efectivoFinal += delta; variacionEfectivo += delta;
        if (Math.abs(delta) <= 0.01) continue;
        if (cashDebits > 0.01 && cashCredits > 0.01) { movimientosAmbiguos++; continue; }
        const counterparts = entryLines.filter(l => !efectivoIds.has(l.cuentaId));
        if (!counterparts.length) { movimientosAmbiguos++; continue; }
        for (const l of counterparts) {
          const c: any = cuentaMap.get(l.cuentaId); const category = c?.clasificacionFlujo;
          const signedFlow = delta > 0 ? Number(l.credito || 0) - Number(l.debito || 0) : Number(l.debito || 0) - Number(l.credito || 0);
          if (!category || !['Operacion', 'Inversion', 'Financiamiento'].includes(category)) { contrapartidasSinClasificar += signedFlow; continue; }
          if (category === 'Operacion') operacion += signedFlow;
          if (category === 'Inversion') inversion += signedFlow;
          if (category === 'Financiamiento') financiamiento += signedFlow;
        }
      }
      efectivoInicial = round2(efectivoInicial); efectivoFinal = round2(efectivoInicial + variacionEfectivo); variacionEfectivo = round2(variacionEfectivo);
      operacion = round2(operacion); inversion = round2(inversion); financiamiento = round2(financiamiento); contrapartidasSinClasificar = round2(contrapartidasSinClasificar);
      const flujoNetoClasificado = round2(operacion + inversion + financiamiento);
      const diferenciaFlujos = round2(variacionEfectivo - flujoNetoClasificado - contrapartidasSinClasificar);
      const flujoCompletoTecnico = efectivoIds.size > 0 && Math.abs(contrapartidasSinClasificar) <= 0.01 && movimientosAmbiguos === 0 && Math.abs(diferenciaFlujos) <= 0.01;
      const sinRevision = rows.filter(r => r.revisionEstado !== 'Aprobada').length;
      const notasPreparacion = (politicas as any[]).map(p => ({ clave: p.clave, tema: p.nombre, estadoPolitica: p.estado || 'Pendiente', tieneCriterio: Boolean(String(p.criterio || '').trim()), tieneVigencia: Boolean(p.fechaVigencia), tieneRevisor: Boolean(p.revisorNombre && p.revisorCredencial), tieneEvidencia: Boolean(String(p.evidenciaAprobacion || '').trim()), listaParaNota: p.estado === 'Aprobada' && Boolean(String(p.criterio || '').trim()) && Boolean(p.fechaVigencia) && Boolean(p.revisorNombre && p.revisorCredencial) && Boolean(String(p.evidenciaAprobacion || '').trim()) }));
      res.json({ periodo: { desde, hasta }, generadoEn: new Date().toISOString(), base: 'Solo asientos contabilizados del mayor; saldos iniciales solo aparecen si fueron registrados como asientos con fecha anterior al período.', controlCierre: { periodoContable: periodoContable ? { id: periodoContable.id, estado: periodoContable.estado, fechaInicio: periodoContable.fechaInicio, fechaFin: periodoContable.fechaFin } : null, borradoresPendientes, asientosDescuadrados, diferenciaSituacion: round2(activos - pasivos - patrimonio), listoTecnico: Boolean(periodoContable?.estado === 'Cerrado' && borradoresPendientes === 0 && asientosDescuadrados.length === 0 && Math.abs(activos - pasivos - patrimonio) <= 0.01), nota: 'Control técnico parcial: no revisa conciliación de submayores, impuestos, flujos, notas ni aprobación CPA.' }, estadoFlujosEfectivo: { metodo: 'Clasificación directa desde contrapartidas de asientos', efectivoInicial, operacion, inversion, financiamiento, flujoNetoClasificado, variacionEfectivo, efectivoFinal, diferenciaFlujos, cuentasEfectivoEquivalente: efectivoIds.size, contrapartidasSinClasificar, movimientosAmbiguos, completoTecnico: flujoCompletoTecnico }, estadoResultados: { ingresos, costos, gastos, resultado: resultadoPeriodo, cuentas: list(['Ingreso', 'Costo', 'Gasto'], 'movimiento') }, estadoSituacion: { activos, pasivos, patrimonio, patrimonioRegistrado, resultadoAcumuladoNoCerrado: resultadoAcumulado, diferencia: round2(activos - pasivos - patrimonio), cuentas: list(['Activo', 'Pasivo', 'Patrimonio'], 'cierre') }, cambiosPatrimonio: { saldoInicial: suma(['Patrimonio'], 'apertura'), movimientos: suma(['Patrimonio'], 'movimiento'), resultadoPeriodo, saldoFinalMayor: patrimonioRegistrado, cuentas: list(['Patrimonio'], 'movimiento') }, comparativoMismoPeriodoAnoAnterior: { periodo: { desde: comparDesde, hasta: comparHasta }, estadoResultados: { ingresos: comparIngresos, costos: comparCostos, gastos: comparGastos, resultado: round2(comparIngresos - comparCostos - comparGastos) }, estadoSituacion: { activos: comparActivos, pasivos: comparPasivos, patrimonio: comparPatrimonio, diferencia: round2(comparActivos - comparPasivos - comparPatrimonio) } }, balanceComprobacion: rows.filter(r => r.debitos || r.creditos), notasPreparacion, alertas: { cuentasSinAprobacionCpa: sinRevision, politicasPendientesDeNota: notasPreparacion.filter(p => !p.listaParaNota).length, diferenciaSituacion: round2(activos - pasivos - patrimonio), faltanFlujosEfectivo: !flujoCompletoTecnico, faltanNotasRevelacion: true }, limitaciones: ['Informe preliminar, no son estados financieros NIIF aprobados.', 'El flujo de efectivo solo es preliminar y requiere validar la identificación de efectivo, equivalentes, clasificación de contrapartidas y método con CPA.', 'El comparativo resta un año calendario al rango y solo compara asientos contabilizados; no valida períodos contables ni reexpresiones.', 'El patrimonio presentado incorpora el resultado acumulado de cuentas de ingreso/costo/gasto sin cierre; confirme los asientos de cierre antes de usar.', 'Cambios en patrimonio no presenta movimientos de propietarios ni reclasificaciones por separado sin mapeos y políticas aprobados.', 'La lista de preparación de notas solo verifica que las políticas tengan evidencia registrada; no genera revelaciones completas ni sustituye revisión CPA.', 'No incorpora fuentes operativas sin asientos contabilizados ni evidencia fiscal.'] });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo generar el paquete preliminar de estados.' }); }
  });

  app.post('/api/contabilidad/cuentas', requirePermission('finanzas_resumen', 'create'), async (req: any, res: any) => {
    try {
      const { codigo, nombre, tipo, naturaleza, cuentaPadreId = null, permiteMovimiento = true } = req.body || {};
      const usuarioId = String(req.usuario?.id || '');
      const codigoLimpio = String(codigo || '').trim(); const nombreLimpio = String(nombre || '').trim();
      if (!/^[0-9A-Za-z.-]{1,30}$/.test(codigoLimpio) || !nombreLimpio || nombreLimpio.length > 120 || !TIPOS.has(tipo) || !NATURALEZAS.has(naturaleza)) return res.status(400).json({ error: 'Complete código, nombre, tipo y naturaleza válidos.' });
      const existente = await db.query.cuentasContables.findFirst({ where: eq(cuentasContables.codigo, codigoLimpio) });
      if (existente) return res.status(409).json({ error: 'Ese código de cuenta ya existe.' });
      if (cuentaPadreId) {
        const padre = await db.query.cuentasContables.findFirst({ where: eq(cuentasContables.id, String(cuentaPadreId)) });
        if (!padre) return res.status(400).json({ error: 'La cuenta padre no existe.' });
        if (padre.estado !== 'Activa' || padre.permiteMovimiento) return res.status(400).json({ error: 'La cuenta padre debe estar activa y configurada como cuenta agrupadora.' });
        if (padre.tipo !== tipo || padre.naturaleza !== naturaleza) return res.status(400).json({ error: 'La cuenta debe tener el mismo tipo y naturaleza que su cuenta agrupadora.' });
      }
      if (typeof permiteMovimiento !== 'boolean') return res.status(400).json({ error: 'Indique si la cuenta acepta movimientos.' });
      const cuenta = { id: crypto.randomUUID(), codigo: codigoLimpio, nombre: nombreLimpio, tipo, naturaleza, cuentaPadreId: cuentaPadreId ? String(cuentaPadreId) : null, permiteMovimiento, estado: 'Activa', revisionEstado: 'Pendiente CPA', creadoEn: new Date().toISOString() };
      await db.insert(cuentasContables).values(cuenta);
      await logAudit(usuarioId, 'Crear', 'CuentaContable', cuenta.id, null, cuenta);
      res.status(201).json({ success: true, cuenta });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo crear la cuenta.' }); }
  });

  app.post('/api/contabilidad/cuentas/:id/aprobar', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const id = String(req.params.id || ''); const cuenta = await db.query.cuentasContables.findFirst({ where: eq(cuentasContables.id, id) });
      if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada.' });
      if (cuenta.cuentaPadreId) {
        const padre = await db.query.cuentasContables.findFirst({ where: eq(cuentasContables.id, cuenta.cuentaPadreId) });
        if (!padre || padre.revisionEstado !== 'Aprobada') return res.status(409).json({ error: 'Revise y apruebe primero la cuenta padre.' });
      }
      const revisorNombre = String(req.body?.revisorNombre || '').trim(); const revisorCredencial = String(req.body?.revisorCredencial || '').trim();
      const evidencia = String(req.body?.evidencia || '').trim(); const vigencia = String(req.body?.vigencia || '');
      if (!fechaValida(vigencia) || !revisorNombre || revisorNombre.length > 160 || !revisorCredencial || revisorCredencial.length > 120 || !evidencia || evidencia.length > 500) return res.status(400).json({ error: 'Indique vigencia, CPA revisor, credencial y referencia de evidencia.' });
      const actualizadoEn = new Date().toISOString(); const actualizadoPor = String(req.usuario?.id || '');
      const actualizado = { ...cuenta, revisionEstado: 'Aprobada', revisionVigencia: vigencia, revisionRevisorNombre: revisorNombre, revisionRevisorCredencial: revisorCredencial, revisionEvidencia: evidencia, revisionActualizadoEn: actualizadoEn, revisionActualizadoPor: actualizadoPor };
      await db.update(cuentasContables).set({ revisionEstado: 'Aprobada', revisionVigencia: vigencia, revisionRevisorNombre: revisorNombre, revisionRevisorCredencial: revisorCredencial, revisionEvidencia: evidencia, revisionActualizadoEn: actualizadoEn, revisionActualizadoPor: actualizadoPor }).where(eq(cuentasContables.id, id));
      await db.insert(cuentasContablesHistorial).values({ id: crypto.randomUUID(), cuentaId: id, snapshotJson: JSON.stringify(actualizado), cambiadoPor: actualizadoPor || null, cambiadoEn: actualizadoEn });
      await logAudit(actualizadoPor, 'AprobarCuentaContable', 'CuentaContable', id, { revisionEstado: cuenta.revisionEstado }, actualizado);
      res.json({ success: true, revisionEstado: 'Aprobada' });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo registrar la revisión de la cuenta.' }); }
  });

  app.post('/api/contabilidad/periodos', requirePermission('finanzas_resumen', 'create'), async (req: any, res: any) => {
    try {
      const { fechaInicio, fechaFin } = req.body || {};
      const start = String(fechaInicio || ''); const end = String(fechaFin || '');
      if (!fechaValida(start) || !fechaValida(end) || start > end) return res.status(400).json({ error: 'Indique un rango de fechas válido.' });
      const existentes = await db.query.periodosContables.findMany();
      if (existentes.some((p: any) => start <= p.fechaFin && end >= p.fechaInicio)) return res.status(409).json({ error: 'El periodo se cruza con otro periodo contable existente.' });
      const usuarioId = String(req.usuario?.id || ''); const periodo = { id: crypto.randomUUID(), fechaInicio: start, fechaFin: end, estado: 'Abierto', creadoPor: usuarioId, creadoEn: new Date().toISOString(), cerradoPor: null, cerradoEn: null };
      await db.insert(periodosContables).values(periodo);
      await logAudit(usuarioId, 'Crear', 'PeriodoContable', periodo.id, null, periodo);
      res.status(201).json({ success: true, periodo });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo crear el periodo.' }); }
  });

  app.post('/api/contabilidad/periodos/:id/cerrar', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const periodo = await db.query.periodosContables.findFirst({ where: eq(periodosContables.id, req.params.id) });
      if (!periodo) return res.status(404).json({ error: 'Periodo no encontrado.' });
      if (periodo.estado !== 'Abierto') return res.status(409).json({ error: 'El periodo ya está cerrado.' });
      const usuarioId = String(req.usuario?.id || ''); const cerradoEn = new Date().toISOString();
      const resultado = await db.transaction(async (tx: any) => {
        // Claim the period first; competing posting transactions serialize on this row.
        const cerrado = await tx.update(periodosContables).set({ estado: 'Cerrado', cerradoPor: usuarioId, cerradoEn }).where(and(eq(periodosContables.id, periodo.id), eq(periodosContables.estado, 'Abierto'))).returning({ id: periodosContables.id });
        if (!cerrado.length) return { cerrado: false, borradores: 0 };
        const borradores = await tx.query.asientosContables.findMany({ where: and(eq(asientosContables.periodoId, periodo.id), eq(asientosContables.estado, 'Borrador')) });
        if (borradores.length) throw new Error(`PERIODO_CON_BORRADORES:${borradores.length}`);
        return { cerrado: true, borradores: 0 };
      });
      if (!resultado.cerrado) return res.status(409).json({ error: 'Otro usuario ya cerró el periodo. Actualice la lista.' });
      await logAudit(usuarioId, 'Aprobar', 'PeriodoContable', periodo.id, { estado: 'Abierto' }, { estado: 'Cerrado', cerradoEn });
      res.json({ success: true, estado: 'Cerrado' });
    } catch (error: any) {
      const match = String(error?.message || '').match(/^PERIODO_CON_BORRADORES:(\d+)$/);
      if (match) return res.status(409).json({ error: `Hay ${match[1]} asiento(s) en borrador. Contabilícelos antes de cerrar.` });
      res.status(500).json({ error: error.message || 'No se pudo cerrar el periodo.' });
    }
  });

  app.post('/api/contabilidad/asientos', requirePermission('finanzas_resumen', 'create'), async (req: any, res: any) => {
    let idempotencyKey = '';
    let idempotencyPayload = '';
    try {
      const { fecha, descripcion, lineas, referenciaTipo = null, referenciaId = null } = req.body || {};
      idempotencyKey = String(req.body?.idempotencyKey || '').trim();
      if (!/^[A-Za-z0-9._:-]{12,120}$/.test(idempotencyKey)) return res.status(400).json({ error: 'Falta una clave de envío única válida. Actualice el formulario e inténtelo de nuevo.' });
      const fechaAsiento = String(fecha || ''); const texto = String(descripcion || '').trim();
      if (!fechaValida(fechaAsiento) || !texto || texto.length > 240 || !Array.isArray(lineas) || lineas.length < 2 || lineas.length > 50) return res.status(400).json({ error: 'Indique fecha, descripción y al menos dos líneas.' });
      const periodos = await db.query.periodosContables.findMany({ where: eq(periodosContables.estado, 'Abierto') });
      const periodo = periodos.find((p: any) => fechaAsiento >= p.fechaInicio && fechaAsiento <= p.fechaFin);
      if (!periodo) return res.status(409).json({ error: 'No existe un periodo contable abierto para esa fecha.' });
      const [cuentas, granjasRows, galeronesRows, lotesRows, productosRows, rutasRows, usuariosRows] = await Promise.all([
        db.query.cuentasContables.findMany(), db.query.granjas.findMany(), db.query.galerones.findMany(), db.query.lotes_aves.findMany(),
        db.query.productosCatalogo.findMany(), db.query.rutas.findMany(), db.query.users.findMany(),
      ]);
      const cuentasMap = new Map(cuentas.map((c: any) => [c.id, c]));
      const mapasDimensiones = { granjaId: new Map((granjasRows as any[]).map(r => [r.id, r])), galeronId: new Map((galeronesRows as any[]).map(r => [r.id, r])), loteId: new Map((lotesRows as any[]).map(r => [r.id, r])), productoId: new Map((productosRows as any[]).map(r => [r.id, r])), rutaId: new Map((rutasRows as any[]).map(r => [r.id, r])), vendedorId: new Map((usuariosRows as any[]).map(r => [r.id, r])) };
      const normalizadas = lineas.map((l: any) => ({
        cuentaId: String(l.cuentaId || ''), descripcion: String(l.descripcion || '').trim().slice(0, 240), debito: round2(Number(l.debito || 0)), credito: round2(Number(l.credito || 0)), terceroId: l.terceroId ? String(l.terceroId) : null,
        granjaId: l.granjaId ? String(l.granjaId) : null, galeronId: l.galeronId ? String(l.galeronId) : null, loteId: l.loteId ? String(l.loteId) : null,
        productoId: l.productoId ? String(l.productoId) : null, rutaId: l.rutaId ? String(l.rutaId) : null, vendedorId: l.vendedorId ? String(l.vendedorId) : null,
      }));
      if (normalizadas.some(l => !cuentasMap.has(l.cuentaId) || (cuentasMap.get(l.cuentaId) as any).estado !== 'Activa' || !(cuentasMap.get(l.cuentaId) as any).permiteMovimiento || !Number.isFinite(l.debito) || !Number.isFinite(l.credito) || l.debito < 0 || l.credito < 0 || (l.debito > 0) === (l.credito > 0))) return res.status(400).json({ error: 'Cada línea debe usar una cuenta activa y tener débito o crédito, nunca ambos.' });
      const clavesDimension = ['granjaId', 'galeronId', 'loteId', 'productoId', 'rutaId', 'vendedorId'] as const;
      if (normalizadas.some((linea: any) => clavesDimension.some(clave => linea[clave] && !mapasDimensiones[clave].has(linea[clave])))) return res.status(400).json({ error: 'Una dimensión seleccionada ya no existe. Actualice el formulario.' });
      if (normalizadas.some((linea: any) => {
        const galeron: any = linea.galeronId ? mapasDimensiones.galeronId.get(linea.galeronId) : null;
        const lote: any = linea.loteId ? mapasDimensiones.loteId.get(linea.loteId) : null;
        return (galeron && linea.granjaId && galeron.granjaId !== linea.granjaId) || (lote && galeron && lote.galeronId !== linea.galeronId);
      })) return res.status(400).json({ error: 'El galerón y el lote deben corresponder a la granja seleccionada.' });
      const debitos = round2(normalizadas.reduce((s, l) => s + l.debito, 0)); const creditos = round2(normalizadas.reduce((s, l) => s + l.credito, 0));
      if (debitos <= 0 || Math.abs(debitos - creditos) > 0.01) return res.status(400).json({ error: 'El asiento debe cuadrar: débitos y créditos deben ser iguales y mayores a cero.' });
      idempotencyPayload = JSON.stringify({ fecha: fechaAsiento, descripcion: texto, referenciaTipo: referenciaTipo ? String(referenciaTipo).slice(0, 80) : null, referenciaId: referenciaId ? String(referenciaId).slice(0, 120) : null, lineas: normalizadas });
      const previo = await db.query.asientosContables.findFirst({ where: eq(asientosContables.idempotencyKey, idempotencyKey) });
      if (previo) {
        if (previo.idempotencyPayload !== idempotencyPayload) return res.status(409).json({ error: 'La clave de envío ya se usó con otros datos. Actualice el formulario antes de reenviar.' });
        return res.json({ success: true, idempotentReplay: true, asiento: { id: previo.id, consecutivo: previo.consecutivo, fecha: previo.fecha, estado: previo.estado } });
      }
      const usuarioId = String(req.usuario?.id || ''); const asientoId = crypto.randomUUID(); const creadoEn = new Date().toISOString();
      let consecutivo = 0;
      await db.transaction(async (tx: any) => {
        consecutivo = await siguienteConsecutivo(tx);
        await tx.insert(asientosContables).values({ id: asientoId, consecutivo, fecha: fechaAsiento, periodoId: periodo.id, descripcion: texto, referenciaTipo: referenciaTipo ? String(referenciaTipo).slice(0, 80) : null, referenciaId: referenciaId ? String(referenciaId).slice(0, 120) : null, estado: 'Borrador', creadoPor: usuarioId, creadoEn, contabilizadoPor: null, contabilizadoEn: null, reversaDeId: null, idempotencyKey, idempotencyPayload });
        await tx.insert(lineasAsientoContable).values(normalizadas.map(l => ({ ...l, id: crypto.randomUUID(), asientoId })));
      });
      await logAudit(usuarioId, 'Crear', 'AsientoContable', asientoId, null, { consecutivo, fecha: fechaAsiento, debitos, creditos, estado: 'Borrador' });
      res.status(201).json({ success: true, asiento: { id: asientoId, consecutivo, fecha: fechaAsiento, debitos, creditos, estado: 'Borrador' } });
    } catch (error: any) {
      if (idempotencyKey && idempotencyPayload) {
        const existente = await db.query.asientosContables.findFirst({ where: eq(asientosContables.idempotencyKey, idempotencyKey) }).catch(() => null);
        if (existente) {
          if (existente.idempotencyPayload !== idempotencyPayload) return res.status(409).json({ error: 'La clave de envío ya se usó con otros datos. Actualice el formulario antes de reenviar.' });
          return res.json({ success: true, idempotentReplay: true, asiento: { id: existente.id, consecutivo: existente.consecutivo, fecha: existente.fecha, estado: existente.estado } });
        }
      }
      res.status(500).json({ error: error.message || 'No se pudo guardar el asiento.' });
    }
  });

  app.post('/api/contabilidad/asientos/:id/contabilizar', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const asiento = await db.query.asientosContables.findFirst({ where: eq(asientosContables.id, req.params.id) });
      if (!asiento) return res.status(404).json({ error: 'Asiento no encontrado.' });
      if (asiento.estado !== 'Borrador') return res.status(409).json({ error: 'Solo se puede contabilizar un borrador.' });
      const usuarioId = String(req.usuario?.id || ''); const contabilizadoEn = new Date().toISOString();
      if (asiento.creadoPor && asiento.creadoPor === usuarioId) return res.status(403).json({ error: 'Por segregación de funciones, otra persona con permiso de aprobación debe contabilizar este asiento.' });
      const resultado = await db.transaction(async (tx: any) => {
        // Lock the open period before posting so close/post cannot pass each other.
        const periodo = await tx.update(periodosContables).set({ estado: 'Abierto' }).where(and(eq(periodosContables.id, asiento.periodoId), eq(periodosContables.estado, 'Abierto'), lte(periodosContables.fechaInicio, asiento.fecha), gte(periodosContables.fechaFin, asiento.fecha))).returning({ id: periodosContables.id });
        if (!periodo.length) return { conflicto: 'periodo' };
        const lineas = await tx.query.lineasAsientoContable.findMany({ where: eq(lineasAsientoContable.asientoId, asiento.id) });
        const debitos = round2(lineas.reduce((s: number, l: any) => s + Number(l.debito || 0), 0)); const creditos = round2(lineas.reduce((s: number, l: any) => s + Number(l.credito || 0), 0));
        if (lineas.length < 2 || debitos <= 0 || Math.abs(debitos - creditos) > 0.01) return { conflicto: 'cuadre' };
        const cuentaIds = new Set(lineas.map((l: any) => String(l.cuentaId)));
        const cuentasUsadas = await tx.query.cuentasContables.findMany();
        if (cuentasUsadas.filter((c: any) => cuentaIds.has(c.id)).length !== cuentaIds.size || cuentasUsadas.some((c: any) => cuentaIds.has(c.id) && (c.estado !== 'Activa' || !c.permiteMovimiento || c.revisionEstado !== 'Aprobada'))) return { conflicto: 'cuenta_no_aprobada' };
        const actualizado = await tx.update(asientosContables).set({ estado: 'Contabilizado', contabilizadoPor: usuarioId, contabilizadoEn }).where(and(eq(asientosContables.id, asiento.id), eq(asientosContables.estado, 'Borrador'))).returning({ id: asientosContables.id });
        if (!actualizado.length) return { conflicto: 'asiento' };
        return { debitos, creditos };
      });
      if (resultado.conflicto === 'periodo') return res.status(409).json({ error: 'El periodo está cerrado o la fecha queda fuera del periodo.' });
      if (resultado.conflicto === 'cuadre') return res.status(409).json({ error: 'El asiento no cuadra y no se puede contabilizar.' });
      if (resultado.conflicto === 'cuenta_no_aprobada') return res.status(409).json({ error: 'El asiento usa cuentas pendientes de revisión profesional o inactivas. Revise el catálogo con el CPA antes de contabilizar.' });
      if (resultado.conflicto === 'asiento') return res.status(409).json({ error: 'Otro usuario ya contabilizó este asiento.' });
      const { debitos, creditos } = resultado;
      await logAudit(usuarioId, 'Aprobar', 'AsientoContable', asiento.id, { estado: 'Borrador' }, { estado: 'Contabilizado', debitos, creditos });
      res.json({ success: true, estado: 'Contabilizado', debitos, creditos });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo contabilizar el asiento.' }); }
  });

  app.delete('/api/contabilidad/asientos/:id', requirePermission('finanzas_resumen', 'create'), async (req: any, res: any) => {
    try {
      const asiento = await db.query.asientosContables.findFirst({ where: eq(asientosContables.id, req.params.id) });
      if (!asiento) return res.status(404).json({ error: 'Asiento no encontrado.' });
      if (asiento.estado !== 'Borrador') return res.status(409).json({ error: 'Un asiento contabilizado no se elimina; registre un reverso.' });
      await db.transaction(async (tx: any) => {
        const reclamado = await tx.update(asientosContables).set({ estado: 'Eliminando' }).where(and(eq(asientosContables.id, asiento.id), eq(asientosContables.estado, 'Borrador'))).returning({ id: asientosContables.id });
        if (!reclamado.length) throw new Error('Otro usuario modificó el asiento. Actualice la lista e inténtelo de nuevo.');
        await tx.delete(lineasAsientoContable).where(eq(lineasAsientoContable.asientoId, asiento.id));
        await tx.delete(asientosContables).where(eq(asientosContables.id, asiento.id));
      });
      const usuarioId = String(req.usuario?.id || '');
      await logAudit(usuarioId, 'EliminarBorrador', 'AsientoContable', asiento.id, { consecutivo: asiento.consecutivo, fecha: asiento.fecha, descripcion: asiento.descripcion }, null, 'Borrador descartado por administrador');
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message || 'No se pudo eliminar el borrador.' }); }
  });

  app.post('/api/contabilidad/asientos/:id/reversar', requirePermission('finanzas_resumen', 'approve'), async (req: any, res: any) => {
    try {
      const original = await db.query.asientosContables.findFirst({ where: eq(asientosContables.id, req.params.id) });
      if (!original || original.estado !== 'Contabilizado') return res.status(404).json({ error: 'Solo se pueden reversar asientos contabilizados.' });
      const usuarioId = String(req.usuario?.id || '');
      if (original.creadoPor === usuarioId || original.contabilizadoPor === usuarioId) return res.status(403).json({ error: 'Por segregación de funciones, una persona distinta al creador y al aprobador debe registrar el reverso.' });
      const yaReversado = await db.query.asientosContables.findFirst({ where: eq(asientosContables.reversaDeId, original.id) });
      if (yaReversado) return res.status(409).json({ error: `Este asiento ya tiene reverso (#${yaReversado.consecutivo}).` });
      const fecha = String(req.body?.fecha || new Date().toISOString().slice(0, 10)); const motivo = String(req.body?.motivo || '').trim();
      if (!fechaValida(fecha) || !motivo || motivo.length > 240) return res.status(400).json({ error: 'Indique fecha y motivo del reverso.' });
      const periodos = await db.query.periodosContables.findMany({ where: eq(periodosContables.estado, 'Abierto') }); const periodo = periodos.find((p: any) => fecha >= p.fechaInicio && fecha <= p.fechaFin);
      if (!periodo) return res.status(409).json({ error: 'No hay un periodo abierto para la fecha del reverso.' });
      const origen = await db.query.lineasAsientoContable.findMany({ where: eq(lineasAsientoContable.asientoId, original.id) });
      if (origen.length < 2) return res.status(409).json({ error: 'El asiento original no tiene líneas suficientes para reversarse.' });
      const creadoEn = new Date().toISOString(); const asientoId = crypto.randomUUID();
      let consecutivo = 0;
      await db.transaction(async (tx: any) => {
        consecutivo = await siguienteConsecutivo(tx);
        await tx.insert(asientosContables).values({ id: asientoId, consecutivo, fecha, periodoId: periodo.id, descripcion: `Reverso #${original.consecutivo}: ${motivo}`, referenciaTipo: 'Reverso', referenciaId: original.id, estado: 'Contabilizado', creadoPor: usuarioId, creadoEn, contabilizadoPor: usuarioId, contabilizadoEn: creadoEn, reversaDeId: original.id });
        await tx.insert(lineasAsientoContable).values((origen as any[]).map(l => ({ id: crypto.randomUUID(), asientoId, cuentaId: l.cuentaId, descripcion: `Reverso de asiento #${original.consecutivo}`, debito: Number(l.credito || 0), credito: Number(l.debito || 0), terceroId: l.terceroId || null, granjaId: l.granjaId || null, galeronId: l.galeronId || null, loteId: l.loteId || null, productoId: l.productoId || null, rutaId: l.rutaId || null, vendedorId: l.vendedorId || null })));
      });
      await logAudit(usuarioId, 'Crear', 'ReversoContable', asientoId, { asientoId: original.id, estado: 'Contabilizado' }, { asientoId, consecutivo, motivo, fecha });
      res.status(201).json({ success: true, asientoId, consecutivo, fecha, estado: 'Contabilizado', reversaDeId: original.id });
    } catch (error: any) {
      if (String(error?.message || '').includes('idx_asientos_contables_reversa')) return res.status(409).json({ error: 'Este asiento ya tiene un reverso registrado.' });
      res.status(500).json({ error: error.message || 'No se pudo crear el reverso.' });
    }
  });
}
