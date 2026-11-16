import { and, eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { permisosParaRol } from "../../lib/role-permissions";

export function registrarRutasCatalogo(app: any, db: any, deps: { requirePermission: any; logAudit: any; vidaUtilDefaultDias: number; diasAvisoDefault: number }) {
  const { clientes } = schema;
  const { requirePermission, logAudit, vidaUtilDefaultDias, diasAvisoDefault } = deps;
  app.get("/api/roles/permisos", async (req, res) => {
    const role = req.query.role as string;
    const permisos = role ? permisosParaRol(role) : null;
    if (!permisos) return res.status(400).json({ error: "Rol no válido" });
    res.json(permisos);
  });

  // ─── Productos Catálogo ────────────────────────────────────
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
    const id = crypto.randomUUID();
    await db.insert(schema.productosCatalogo).values({
      id, nombre, descripcion: descripcion || '', unidad: unidadFinal, kgPorCarton: kgPorCarton || 0,
      precioBase: precioBase || 0, categoria: categoria || 'Huevos',
      estado: 'Activo', fechaCreacion: new Date().toISOString(),
      vidaUtilDias: Number(vidaUtilDias) > 0 ? Number(vidaUtilDias) : vidaUtilDefaultDias,
      diasAvisoVencimiento: Number(diasAvisoVencimiento) >= 0 ? Number(diasAvisoVencimiento) : diasAvisoDefault,
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
    }).where(eq(schema.productosCatalogo.id, req.params.id));
    const accion = existing[0].estado === 'Archivado' && estado === 'Activo' ? 'Restaurar' : (estado === 'Archivado' ? 'Archivar' : 'Editar');
    await logAudit((req as any).usuario.id, accion, 'Producto', req.params.id, existing[0], { ...existing[0], ...req.body });
    res.json({ success: true });
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
