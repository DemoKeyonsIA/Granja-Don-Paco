import { and, eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { permisosParaRol } from "../../lib/role-permissions";

const cabysCache = new Map<string, { guardadoEn: number; resultados: any[] }>();

export function registrarRutasCatalogo(app: any, db: any, deps: { requirePermission: any; logAudit: any; vidaUtilDefaultDias: number; diasAvisoDefault: number }) {
  const { clientes } = schema;
  const { requirePermission, logAudit, vidaUtilDefaultDias, diasAvisoDefault } = deps;
  const normalizarDatosFiscales = (body: any) => {
    const cabysCodigo = String(body?.cabysCodigo || '').trim();
    const cabysDescripcion = String(body?.cabysDescripcion || '').trim();
    const tratamientoFiscal = String(body?.tratamientoFiscal || '').trim();
    const tarifaRaw = body?.tarifaImpuesto;
    const tarifaImpuesto = tarifaRaw === '' || tarifaRaw == null ? null : Number(tarifaRaw);
    const exoneracionReferencia = String(body?.exoneracionReferencia || '').trim();
    const fiscalVigenteDesde = String(body?.fiscalVigenteDesde || '').trim() || null;
    const fiscalVigenteHasta = String(body?.fiscalVigenteHasta || '').trim() || null;
    if (cabysCodigo && !/^\d{13}$/.test(cabysCodigo)) return { error: 'El CABYS debe tener 13 dígitos; consulte el código oficial antes de guardarlo.' };
    if (cabysDescripcion.length > 240 || tratamientoFiscal.length > 120 || exoneracionReferencia.length > 500) return { error: 'Revise la longitud de los datos fiscales.' };
    if (tarifaImpuesto != null && (!Number.isFinite(tarifaImpuesto) || tarifaImpuesto < 0 || tarifaImpuesto > 100)) return { error: 'La tarifa debe ser un porcentaje entre 0 y 100.' };
    const fechaOk = (value: string | null) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value);
    if (!fechaOk(fiscalVigenteDesde) || !fechaOk(fiscalVigenteHasta) || (fiscalVigenteDesde && fiscalVigenteHasta && fiscalVigenteHasta < fiscalVigenteDesde)) return { error: 'Revise el rango de vigencia fiscal.' };
    return { value: { cabysCodigo: cabysCodigo || null, cabysDescripcion: cabysDescripcion || null, tratamientoFiscal: tratamientoFiscal || null, tarifaImpuesto, exoneracionReferencia: exoneracionReferencia || null, fiscalVigenteDesde, fiscalVigenteHasta } };
  };
  app.get("/api/roles/permisos", async (req, res) => {
    const role = req.query.role as string;
    const permisos = role ? permisosParaRol(role) : null;
    if (!permisos) return res.status(400).json({ error: "Rol no válido" });
    res.json(permisos);
  });

  // ─── Productos Catálogo ────────────────────────────────────
  app.get('/api/catalogo/cabys', requirePermission('catalogo', 'view'), async (req, res) => {
    const codigo = String(req.query.codigo || '').trim();
    const consulta = String(req.query.q || '').trim().slice(0, 100);
    if (codigo ? !/^\d{13}$/.test(codigo) : consulta.length < 3) return res.status(400).json({ error: 'Indique un CABYS de 13 dígitos o una descripción de al menos 3 caracteres.' });
    const claveCache = codigo ? `c:${codigo}` : `q:${consulta.toLocaleLowerCase('es')}`;
    const previo = cabysCache.get(claveCache);
    if (previo && Date.now() - previo.guardadoEn < 6 * 60 * 60 * 1000) return res.json({ resultados: previo.resultados, fuente: 'API pública CABYS de Hacienda', consultadoEn: new Date(previo.guardadoEn).toISOString(), cache: true, soloReferencia: true });
    try {
      const url = new URL('https://api.hacienda.go.cr/fe/cabys');
      if (codigo) url.searchParams.set('codigo', codigo);
      else { url.searchParams.set('q', consulta); url.searchParams.set('top', '10'); }
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
      let upstream: Response;
      try { upstream = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } }); }
      finally { clearTimeout(timeout); }
      if (!upstream.ok) return res.status(upstream.status === 429 ? 429 : 502).json({ error: upstream.status === 429 ? 'Hacienda limitó temporalmente las consultas CABYS. Espere antes de intentar de nuevo.' : `La consulta CABYS no está disponible (HTTP ${upstream.status}).` });
      const body = await upstream.json();
      const filas = Array.isArray(body) ? body : (Array.isArray((body as any)?.cabys) ? (body as any).cabys : []);
      const resultados = filas.slice(0, 10).filter((x: any) => /^\d{13}$/.test(String(x?.codigo || '')) && String(x?.descripcion || '').trim()).map((x: any) => ({ codigo: String(x.codigo), descripcion: String(x.descripcion), impuestoReferencia: Number.isFinite(Number(x.impuesto)) ? Number(x.impuesto) : null, categorias: Array.isArray(x.categorias) ? x.categorias.map(String) : [] }));
      const guardadoEn = Date.now(); cabysCache.set(claveCache, { guardadoEn, resultados });
      if (cabysCache.size > 500) for (const [key, value] of cabysCache) if (Date.now() - value.guardadoEn > 6 * 60 * 60 * 1000) cabysCache.delete(key);
      res.json({ resultados, fuente: 'API pública CABYS de Hacienda', consultadoEn: new Date(guardadoEn).toISOString(), cache: false, soloReferencia: true, aviso: 'El resultado confirma la existencia/descripcion del código en el catálogo consultado; no determina por sí solo el tratamiento ni la tarifa aplicable a la operación.' });
    } catch (error: any) {
      res.status(error?.name === 'AbortError' ? 504 : 502).json({ error: error?.name === 'AbortError' ? 'La consulta a Hacienda tardó demasiado.' : 'No se pudo consultar CABYS en Hacienda.' });
    }
  });

  app.get('/api/productos-catalogo', requirePermission('catalogo', 'view'), async (req, res) => {
    const productos = await db.select().from(schema.productosCatalogo);
    const usuario = (req as any).usuario;
    const esAdmin = usuario.role === 'Admin' || usuario.roles?.includes('Admin');
    res.json(esAdmin ? productos : productos.filter((p: any) => p.estado === 'Activo'));
  });

  app.post('/api/productos-catalogo', requirePermission('catalogo', 'create'), async (req, res) => {
    const { nombre, descripcion, unidad, kgPorCarton, precioBase, categoria, vidaUtilDias, diasAvisoVencimiento } = req.body;
    if (!nombre) { res.status(400).json({ error: 'Nombre es requerido' }); return; }
    const unidadFinal = unidad || 'kg';
    if (unidadFinal !== 'kg') { res.status(400).json({ error: 'Los productos se administran y venden en kilogramos.' }); return; }
    const fiscal = normalizarDatosFiscales(req.body);
    if (fiscal.error) return res.status(400).json({ error: fiscal.error });
    const id = crypto.randomUUID();
    await db.insert(schema.productosCatalogo).values({
      id, nombre, descripcion: descripcion || '', unidad: unidadFinal, kgPorCarton: kgPorCarton || 0,
      precioBase: precioBase || 0, categoria: categoria || 'Huevos',
      estado: 'Activo', fechaCreacion: new Date().toISOString(),
      vidaUtilDias: Number(vidaUtilDias) > 0 ? Number(vidaUtilDias) : vidaUtilDefaultDias,
      diasAvisoVencimiento: Number(diasAvisoVencimiento) >= 0 ? Number(diasAvisoVencimiento) : diasAvisoDefault,
      ...('value' in fiscal ? fiscal.value : {}), fiscalEstado: 'Pendiente', fiscalAprobacionReferencia: null, fiscalRevisorNombre: null, fiscalRevisorCredencial: null, fiscalAprobadoEn: null,
    });
    await logAudit((req as any).usuario.id, 'Crear', 'Producto', id, null, { nombre, descripcion: descripcion || '', unidad: unidadFinal, precioBase: precioBase || 0, categoria: categoria || 'Huevos', estado: 'Activo' });
    res.status(201).json({ success: true, id });
  });

  app.put('/api/productos-catalogo/:id', requirePermission('catalogo', 'create'), async (req, res) => {
    const { nombre, descripcion, unidad, kgPorCarton, precioBase, categoria, estado, vidaUtilDias, diasAvisoVencimiento } = req.body;
    const existing = await db.select().from(schema.productosCatalogo).where(eq(schema.productosCatalogo.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Producto no encontrado' }); return; }
    if (unidad !== undefined && unidad !== 'kg') { res.status(400).json({ error: 'Los productos se administran y venden en kilogramos.' }); return; }
    if (existing[0].estado === 'Archivado' && estado !== 'Activo') { res.status(409).json({ error: 'El producto está archivado. Seleccione Activo para restaurarlo antes de editarlo.' }); return; }
    const fiscalKeys = ['cabysCodigo', 'cabysDescripcion', 'tratamientoFiscal', 'tarifaImpuesto', 'exoneracionReferencia', 'fiscalVigenteDesde', 'fiscalVigenteHasta'] as const;
    const hasFiscalFields = fiscalKeys.some(key => Object.prototype.hasOwnProperty.call(req.body || {}, key));
    const fiscal = hasFiscalFields ? normalizarDatosFiscales(req.body) : null;
    if (fiscal && 'error' in fiscal) return res.status(400).json({ error: fiscal.error });
    const cambioFiscal = !!fiscal && 'value' in fiscal && fiscalKeys.some(key => (existing[0] as any)[key] !== (fiscal.value as any)[key]);
    await db.update(schema.productosCatalogo).set({
      ...(nombre !== undefined && { nombre }),
      ...(descripcion !== undefined && { descripcion }),
      ...(unidad !== undefined && { unidad }),
      ...(kgPorCarton !== undefined && { kgPorCarton: Number(kgPorCarton) || 0 }),
      ...(precioBase !== undefined && { precioBase }),
      ...(categoria !== undefined && { categoria }),
      ...(estado !== undefined && { estado }),
      ...(vidaUtilDias !== undefined && { vidaUtilDias: Number(vidaUtilDias) > 0 ? Number(vidaUtilDias) : vidaUtilDefaultDias }),
      ...(diasAvisoVencimiento !== undefined && { diasAvisoVencimiento: Number(diasAvisoVencimiento) >= 0 ? Number(diasAvisoVencimiento) : diasAvisoDefault }),
      ...(cambioFiscal && fiscal && 'value' in fiscal && { ...fiscal.value, fiscalEstado: 'Pendiente', fiscalAprobacionReferencia: null, fiscalRevisorNombre: null, fiscalRevisorCredencial: null, fiscalAprobadoEn: null }),
    }).where(eq(schema.productosCatalogo.id, req.params.id));
    const accion = existing[0].estado === 'Archivado' && estado === 'Activo' ? 'Restaurar' : (estado === 'Archivado' ? 'Archivar' : 'Editar');
    await logAudit((req as any).usuario.id, accion, 'Producto', req.params.id, existing[0], { ...existing[0], ...req.body });
    res.json({ success: true });
  });

  app.post('/api/productos-catalogo/:id/aprobar-fiscal', requirePermission('finanzas_resumen', 'approve'), async (req, res) => {
    const existing = await db.query.productosCatalogo.findFirst({ where: eq(schema.productosCatalogo.id, req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado.' });
    const revisorNombre = String(req.body?.revisorNombre || '').trim();
    const revisorCredencial = String(req.body?.revisorCredencial || '').trim();
    const evidencia = String(req.body?.evidencia || '').trim();
    if (!existing.cabysCodigo || !/^\d{13}$/.test(existing.cabysCodigo) || !existing.cabysDescripcion || !existing.tratamientoFiscal || existing.tarifaImpuesto == null || !existing.fiscalVigenteDesde || !revisorNombre || !revisorCredencial || !evidencia) return res.status(400).json({ error: 'Complete CABYS válido por formato, descripción, tratamiento, tarifa (incluido 0%), vigencia y datos/referencia de aprobación declarada del CPA.' });
    const fechaFiscalOk = (value: any) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
    if (!fechaFiscalOk(existing.fiscalVigenteDesde) || (existing.fiscalVigenteHasta && !fechaFiscalOk(existing.fiscalVigenteHasta)) || (existing.fiscalVigenteHasta && existing.fiscalVigenteHasta < existing.fiscalVigenteDesde)) return res.status(400).json({ error: 'El rango de vigencia fiscal debe contener fechas válidas y no terminar antes de iniciar.' });
    if (evidencia.length > 500) return res.status(400).json({ error: 'La referencia de evidencia no puede superar 500 caracteres.' });
    const usuarioId = String((req as any).usuario?.id || ''); const fiscalAprobadoEn = new Date().toISOString();
    await db.update(schema.productosCatalogo).set({ fiscalEstado: 'Aprobado', fiscalAprobacionReferencia: evidencia, fiscalRevisorNombre: revisorNombre, fiscalRevisorCredencial: revisorCredencial, fiscalAprobadoEn }).where(eq(schema.productosCatalogo.id, req.params.id));
    await logAudit(usuarioId, 'AprobarDatosFiscales', 'Producto', req.params.id, { fiscalEstado: existing.fiscalEstado }, { fiscalEstado: 'Aprobado', cabysCodigo: existing.cabysCodigo, fiscalVigenteDesde: existing.fiscalVigenteDesde, evidencia, revisorNombre, fiscalAprobadoEn });
    res.json({ success: true, fiscalEstado: 'Aprobado' });
  });

  app.delete('/api/productos-catalogo/:id', requirePermission('catalogo', 'create'), async (req, res) => {
    const existing = await db.select().from(schema.productosCatalogo).where(eq(schema.productosCatalogo.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Producto no encontrado' }); return; }
    if (existing[0].estado !== 'Archivado') {
      await db.update(schema.productosCatalogo).set({ estado: 'Archivado' }).where(eq(schema.productosCatalogo.id, req.params.id));
      await logAudit((req as any).usuario.id, 'Archivar', 'Producto', req.params.id, existing[0], { ...existing[0], estado: 'Archivado' });
    }
    res.json({ success: true, estado: 'Archivado' });
  });

  // ─── Tipos de Cartón ────────────────────────────────────────
  app.get('/api/tipos-carton', requirePermission('catalogo', 'view'), async (_req, res) => {
    const tipos = await db.select().from(schema.tiposCarton);
    res.json(tipos);
  });

  app.post('/api/tipos-carton', requirePermission('catalogo', 'create'), async (req, res) => {
    const { nombre, unidades } = req.body;
    if (!nombre) { res.status(400).json({ error: 'Nombre es requerido' }); return; }
    if (!(Number(unidades) > 0)) { res.status(400).json({ error: 'Unidades debe ser mayor a 0' }); return; }
    const id = crypto.randomUUID();
    await db.insert(schema.tiposCarton).values({
      id, nombre, unidades: Number(unidades), estado: 'Activo', fechaCreacion: new Date().toISOString(),
    });
    res.status(201).json({ success: true, id });
  });

  app.put('/api/tipos-carton/:id', requirePermission('catalogo', 'create'), async (req, res) => {
    const { nombre, unidades, estado } = req.body;
    const existing = await db.select().from(schema.tiposCarton).where(eq(schema.tiposCarton.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Tipo de cartón no encontrado' }); return; }
    await db.update(schema.tiposCarton).set({
      ...(nombre !== undefined && { nombre }),
      ...(unidades !== undefined && Number(unidades) > 0 && { unidades: Number(unidades) }),
      ...(estado !== undefined && { estado }),
    }).where(eq(schema.tiposCarton.id, req.params.id));
    res.json({ success: true });
  });

  app.delete('/api/tipos-carton/:id', requirePermission('catalogo', 'create'), async (req, res) => {
    const existing = await db.select().from(schema.tiposCarton).where(eq(schema.tiposCarton.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Tipo de cartón no encontrado' }); return; }
    await db.delete(schema.tiposCarton).where(eq(schema.tiposCarton.id, req.params.id));
    res.json({ success: true });
  });

  // ─── Excepciones de Precio por Cliente ──────────────────────
  app.get('/api/precio-excepciones/:clienteId', requirePermission('precios', 'view'), async (req, res) => {
    const excepciones = await db.select().from(schema.precioExcepcionesCliente)
      .where(eq(schema.precioExcepcionesCliente.clienteId, req.params.clienteId));
    res.json(excepciones);
  });

  app.post('/api/precio-excepciones', requirePermission('precios', 'approve'), async (req, res) => {
    const { clienteId, productoId, precioExcepcion, justificacion, fechaInicio, fechaFin } = req.body || {};
    const precio = Number(precioExcepcion);
    const inicio = String(fechaInicio || '').slice(0, 10);
    const fin = String(fechaFin || '').slice(0, 10);
    if (!clienteId || !productoId || !Number.isFinite(precio) || precio <= 0 || !justificacion || !inicio || !fin) {
      res.status(400).json({ error: 'Cliente, producto, precio positivo, justificación y fechas de vigencia son requeridos' }); return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fin) || inicio > fin) {
      res.status(400).json({ error: 'La vigencia debe tener fechas válidas y la fecha final no puede ser anterior a la inicial' }); return;
    }
    const [cliente, producto] = await Promise.all([
      db.query.clientes.findFirst({ where: eq(clientes.id, clienteId) }),
      db.query.productosCatalogo.findFirst({ where: eq(schema.productosCatalogo.id, productoId) }),
    ]);
    if (!cliente || !producto) return res.status(404).json({ error: 'Cliente o producto no encontrado' });
    const existentes = await db.select().from(schema.precioExcepcionesCliente)
      .where(and(eq(schema.precioExcepcionesCliente.clienteId, clienteId), eq(schema.precioExcepcionesCliente.productoId, productoId), eq(schema.precioExcepcionesCliente.estado, 'Activa')));
    const seCruza = existentes.some((e: any) => {
      const eInicio = e.fechaInicio ? String(e.fechaInicio).slice(0, 10) : '0000-01-01';
      const eFin = e.fechaFin ? String(e.fechaFin).slice(0, 10) : '9999-12-31';
      return inicio <= eFin && fin >= eInicio;
    });
    if (seCruza) return res.status(409).json({ error: 'Ya existe una excepción activa para ese cliente y producto en parte de esas fechas' });
    const actor = (req as any).usuario;
    const id = crypto.randomUUID();
    const creadaEn = new Date().toISOString();
    await db.insert(schema.precioExcepcionesCliente).values({
      id, clienteId, productoId, precioExcepcion: precio,
      justificacion: String(justificacion).trim(), aprobadoPor: actor.name || actor.id,
      fechaCreacion: creadaEn, fechaInicio: inicio, fechaFin: fin, estado: 'Activa',
    });
    await logAudit(actor.id, 'AutorizarExcepcion', 'PrecioCliente', id, null, {
      clienteId, productoId, precioExcepcion: precio, justificacion: String(justificacion).trim(),
      fechaInicio: inicio, fechaFin: fin,
    });
    res.status(201).json({ success: true, id, aprobadoPor: actor.name || actor.id, fechaInicio: inicio, fechaFin: fin });
  });

  app.delete('/api/precio-excepciones/:id', requirePermission('precios', 'approve'), async (req, res) => {
    const existing = await db.select().from(schema.precioExcepcionesCliente)
      .where(eq(schema.precioExcepcionesCliente.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Excepción no encontrada' }); return; }
    const actor = (req as any).usuario;
    await db.update(schema.precioExcepcionesCliente).set({ estado: 'Inactiva' })
      .where(eq(schema.precioExcepcionesCliente.id, req.params.id));
    await logAudit(actor.id, 'DesactivarExcepcion', 'PrecioCliente', req.params.id, existing[0], { ...existing[0], estado: 'Inactiva' });
    res.json({ success: true, estado: 'Inactiva' });
  });

}
