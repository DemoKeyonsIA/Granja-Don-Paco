import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';

/** Registra los endpoints CRUD básicos de clientes. */
export function registrarRutasClientes(app: any, db: any, requirePermission: (...args: any[]) => any, logAudit?: (...args: any[]) => Promise<void>) {
  app.get("/api/clientes", requirePermission('clientes', 'view'), async (req, res) => {
    try {
      const data = await db.query.clientes.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clientes", requirePermission('clientes', 'create'), async (req, res) => {
    try {
      const { nombre, tipo_documento, documento_id, telefono, email, direccion, provincia, canton, distrito, latitud, longitud, ruta, condicion_pago, precio_especial, limite_credito, notas } = req.body;
      if (!nombre) return res.status(400).json({ error: "Nombre es requerido" });
      
      const id = crypto.randomUUID();
      await db.insert(schema.clientes).values({
        id,
        nombre,
        tipo_documento: tipo_documento || 'Fisica',
        documento_id: documento_id || null,
        telefono: telefono || null,
        email: email || null,
        direccion: direccion || null,
        provincia: provincia || null,
        canton: canton || null,
        distrito: distrito || null,
        latitud: latitud ? Number(latitud) : null,
        longitud: longitud ? Number(longitud) : null,
        ruta: ruta || null,
        condicion_pago: condicion_pago || 'Contado',
        precio_especial: precio_especial ? Number(precio_especial) : null,
        limite_credito: limite_credito ? Number(limite_credito) : 0,
        saldo_pendiente: 0,
        promedio_compra: 0,
        estado: 'Activo',
        notas: notas || null,
        fecha_creacion: new Date().toISOString()
      });
      await logAudit?.((req as any).usuario?.id, 'Crear', 'Cliente', id, null, { nombre, tipo_documento: tipo_documento || 'Fisica', documento_id: documento_id || null, telefono: telefono || null, email: email || null, direccion: direccion || null, ruta: ruta || null, condicion_pago: condicion_pago || 'Contado', estado: 'Activo' });
      res.status(201).json({ success: true, id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/clientes/:id", requirePermission('clientes', 'create'), async (req, res) => {
    try {
      const { id } = req.params;
      const existente = await db.query.clientes.findFirst({ where: eq(schema.clientes.id, id) });
      if (!existente) return res.status(404).json({ error: "Cliente no encontrado" });
      const { nombre, tipo_documento, documento_id, telefono, email, direccion, provincia, canton, distrito, latitud, longitud, ruta, condicion_pago, precio_especial, limite_credito, notas, estado } = req.body;
      const updateData: any = {};
      if (nombre !== undefined) updateData.nombre = nombre;
      if (tipo_documento !== undefined) updateData.tipo_documento = tipo_documento;
      if (documento_id !== undefined) updateData.documento_id = documento_id;
      if (telefono !== undefined) updateData.telefono = telefono;
      if (email !== undefined) updateData.email = email;
      if (direccion !== undefined) updateData.direccion = direccion;
      if (provincia !== undefined) updateData.provincia = provincia;
      if (canton !== undefined) updateData.canton = canton;
      if (distrito !== undefined) updateData.distrito = distrito;
      if (latitud !== undefined) updateData.latitud = latitud ? Number(latitud) : null;
      if (longitud !== undefined) updateData.longitud = longitud ? Number(longitud) : null;
      if (ruta !== undefined) updateData.ruta = ruta;
      if (condicion_pago !== undefined) updateData.condicion_pago = condicion_pago;
      if (precio_especial !== undefined) updateData.precio_especial = precio_especial ? Number(precio_especial) : null;
      if (limite_credito !== undefined) updateData.limite_credito = Number(limite_credito);
      if (notas !== undefined) updateData.notas = notas;
      if (estado !== undefined) updateData.estado = estado;
      
      await db.update(schema.clientes).set(updateData).where(eq(schema.clientes.id, id));
      await logAudit?.((req as any).usuario?.id, estado === 'Archivado' ? 'Archivar' : 'Editar', 'Cliente', id, existente, { ...existente, ...updateData });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/clientes/:id", requirePermission('clientes', 'create'), async (req, res) => {
    try {
      const { id } = req.params;
      const existente = await db.query.clientes.findFirst({ where: eq(schema.clientes.id, id) });
      if (!existente) return res.status(404).json({ error: 'Cliente no encontrado' });
      await db.update(schema.clientes).set({ estado: 'Archivado' }).where(eq(schema.clientes.id, id));
      await logAudit?.((req as any).usuario?.id, 'Archivar', 'Cliente', id, existente, { ...existente, estado: 'Archivado' });
      res.json({ success: true, estado: 'Archivado' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
