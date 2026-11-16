import { and, eq, ne } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { rutasAsignadasDelVendedor, tieneRol } from '../clientes-scope';

/** CRUD de rutas y camiones usados por despacho. */
export function registrarRutasYCaminones(app: any, db: any, requirePermission?: (...args: any[]) => any, logAudit?: (...args: any[]) => Promise<void>) {
  const { rutas, camiones, guias_despacho } = schema;
  // ==================== RUTAS CRUD ====================
  app.get("/api/rutas", requirePermission ? requirePermission(['ventas', 'inventario_bodega'], 'view') : undefined, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const data = tieneRol(usuario, 'Comercial') && !tieneRol(usuario, 'Admin')
        ? await rutasAsignadasDelVendedor(db, String(usuario.id))
        : await db.query.rutas.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/rutas", requirePermission ? requirePermission('rutas', 'create') : undefined, async (req, res) => {
    try {
      const { nombre, vendedor_asignado, cliente_ids, dias_frecuencia, kilometraje_aprox } = req.body;
      if (!nombre) return res.status(400).json({ error: "Nombre de ruta es requerido" });
      
      const id = crypto.randomUUID();
      await db.insert(rutas).values({
        id,
        nombre,
        vendedor_asignado: vendedor_asignado || null,
        cliente_ids: cliente_ids ? JSON.stringify(cliente_ids) : null,
        dias_frecuencia: dias_frecuencia || null,
        kilometraje_aprox: kilometraje_aprox ? Number(kilometraje_aprox) : null,
        estado: 'Activa'
      });
      await logAudit?.((req as any).usuario?.id, 'Crear', 'Ruta', id, null, { nombre, vendedor_asignado: vendedor_asignado || null, cliente_ids: cliente_ids || [], dias_frecuencia: dias_frecuencia || null, kilometraje_aprox: kilometraje_aprox || null, estado: 'Activa' });
      res.status(201).json({ success: true, id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/rutas/:id", requirePermission ? requirePermission('rutas', 'create') : undefined, async (req, res) => {
    try {
      const { id } = req.params;
      const existente = await db.query.rutas.findFirst({ where: eq(rutas.id, id) });
      if (!existente) return res.status(404).json({ error: "Ruta no encontrada" });
      const { nombre, vendedor_asignado, cliente_ids, dias_frecuencia, kilometraje_aprox, estado } = req.body;
      const updateData: any = {};
      if (nombre !== undefined) updateData.nombre = nombre;
      if (vendedor_asignado !== undefined) updateData.vendedor_asignado = vendedor_asignado;
      if (cliente_ids !== undefined) updateData.cliente_ids = JSON.stringify(cliente_ids);
      if (dias_frecuencia !== undefined) updateData.dias_frecuencia = dias_frecuencia;
      if (kilometraje_aprox !== undefined) updateData.kilometraje_aprox = Number(kilometraje_aprox);
      if (estado !== undefined) updateData.estado = estado;
      
      await db.update(rutas).set(updateData).where(eq(rutas.id, id));
      await logAudit?.((req as any).usuario?.id, estado === 'Archivada' ? 'Archivar' : 'Editar', 'Ruta', id, existente, { ...existente, ...updateData });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== PLAN DE CARGA ====================

  // ---- CAMIONES ----
  app.get("/api/logistica/camiones", requirePermission ? requirePermission('ventas', 'view') : undefined, async (req, res) => {
    try {
      const data = await db.query.camiones.findMany();
      const guiasActivas = await db.query.guias_despacho.findMany({
        where: and(
          ne(guias_despacho.estado, 'Cerrada'),
          ne(guias_despacho.estado, 'Anulada')
        )
      });
      const dataConGuia = data.map((c: any) => ({
        ...c,
        guiaActivaId: guiasActivas.find(g => g.camionId === c.id)?.id || null,
        guiaActiva: guiasActivas.find(g => g.camionId === c.id) || null
      }));
      res.json(dataConGuia);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistica/camiones", requirePermission ? requirePermission('rutas', 'create') : undefined, async (req, res) => {
    try {
      const { nombre, placa, ruta_defecto, vendedor_id, camioneroId, camionero_id, capacidad_cartones } = req.body;
      if (!nombre || !capacidad_cartones) {
        return res.status(400).json({ error: "Faltan datos: nombre y capacidad_cartones son obligatorios" });
      }
      const existente = await db.query.camiones.findFirst({ where: eq(camiones.nombre, nombre) });
      if (existente) return res.status(400).json({ error: `Ya existe un camión llamado "${nombre}"` });

      const id = crypto.randomUUID();
      await db.insert(camiones).values({
        id,
        nombre,
        placa: placa || null,
        camioneroId: camioneroId || camionero_id || null,
        ruta_defecto: ruta_defecto || null,
        vendedor_id: vendedor_id || null,
        capacidad_cartones: Number(capacidad_cartones),
        estado: 'Activo'
      });
      await logAudit?.((req as any).usuario?.id, 'Crear', 'Camion', id, null, { nombre, placa: placa || null, camioneroId: camioneroId || camionero_id || null, capacidad_cartones: Number(capacidad_cartones), estado: 'Activo' });
      res.status(201).json({ success: true, id, message: 'Camión creado exitosamente' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


}
