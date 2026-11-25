import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { clientesVisiblesDelVendedor, rutasAsignadasDelVendedor, tieneRol } from '../clientes-scope';

/** Registra los endpoints CRUD básicos de clientes. */
export function registrarRutasClientes(app: any, db: any, requirePermission: (...args: any[]) => any, logAudit?: (...args: any[]) => Promise<void>) {
  app.get("/api/clientes", requirePermission('clientes', 'view'), async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const data = tieneRol(usuario, 'Comercial') && !tieneRol(usuario, 'Admin')
        ? await clientesVisiblesDelVendedor(db, String(usuario.id))
        : await db.query.clientes.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/clientes/solicitudes', requirePermission('ventas', 'view'), async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      if (!tieneRol(usuario, 'Comercial') || tieneRol(usuario, 'Admin')) return res.status(403).json({ error: 'Esta consulta es para vendedores.' });
      const solicitudes = await db.query.aprobaciones.findMany();
      res.json(solicitudes.filter((a: any) => a.tipo === 'AltaClienteRuta' && a.solicitudUsuario === usuario.id)
        .sort((a: any, b: any) => String(b.fechaSolicitud).localeCompare(String(a.fechaSolicitud))));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/clientes/solicitudes', requirePermission('ventas', 'create'), async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      if (!tieneRol(usuario, 'Comercial') || tieneRol(usuario, 'Admin')) return res.status(403).json({ error: 'Solo un vendedor puede solicitar un alta desde ruta.' });
      const nombre = String(req.body?.nombre || '').trim();
      if (!nombre) return res.status(400).json({ error: 'Indique el nombre del cliente.' });
      const rutas = await rutasAsignadasDelVendedor(db, String(usuario.id));
      if (rutas.length !== 1) return res.status(409).json({
        error: rutas.length === 0
          ? 'No tiene una ruta asignada. Administración debe asignarle una antes de solicitar un cliente.'
          : 'Tiene más de una ruta asignada. Administración debe dejar una sola ruta activa antes de solicitar un cliente.',
      });
      // La ruta siempre se obtiene de la asignación administrativa; nunca se
      // acepta la ruta enviada por el navegador como fuente de autorización.
      const ruta = rutas[0];
      const documento = String(req.body?.documento_id || '').trim();
      const actividadEconomica = String(req.body?.actividad_economica || '').trim();
      if (actividadEconomica && !/^\d{1,20}$/.test(actividadEconomica)) return res.status(400).json({ error: 'La actividad económica debe ser un código numérico; confirme el valor con el cliente.' });
      if (documento) {
        const existente = await db.query.clientes.findFirst({ where: eq(schema.clientes.documento_id, documento) });
        if (existente) return res.status(409).json({ error: 'Ya existe un cliente con ese documento. Solicite acceso a Administración.' });
      }
      const clienteSolicitado = {
        nombre,
        tipo_documento: String(req.body?.tipo_documento || 'Fisica'),
        documento_id: documento || null,
        actividad_economica: actividadEconomica || null,
        telefono: String(req.body?.telefono || '').trim() || null,
        email: String(req.body?.email || '').trim() || null,
        direccion: String(req.body?.direccion || '').trim() || null,
        provincia: String(req.body?.provincia || '').trim() || null,
        canton: String(req.body?.canton || '').trim() || null,
        distrito: String(req.body?.distrito || '').trim() || null,
        ruta: ruta.nombre,
        rutaId: ruta.id,
      };
      const id = crypto.randomUUID();
      await db.insert(schema.aprobaciones).values({
        id, tipo: 'AltaClienteRuta', modulo: 'Clientes', referenciaId: ruta.id,
        solicitudUsuario: String(usuario.id), descripcion: `Alta de ${nombre} para ${ruta.nombre}`,
        datos: JSON.stringify(clienteSolicitado), estado: 'Pendiente', fechaSolicitud: new Date().toISOString(),
      });
      res.status(201).json({ success: true, id, message: 'Solicitud enviada a Administración.' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/clientes", requirePermission('clientes', 'create'), async (req, res) => {
    try {
      const { nombre, tipo_documento, documento_id, actividad_economica, telefono, email, direccion, provincia, canton, distrito, latitud, longitud, ruta, condicion_pago, precio_especial, limite_credito, notas } = req.body;
      if (!nombre) return res.status(400).json({ error: "Nombre es requerido" });
      if (actividad_economica && !/^\d{1,20}$/.test(String(actividad_economica).trim())) return res.status(400).json({ error: 'La actividad económica debe ser un código numérico; confirme el valor con el cliente.' });
      
      const id = crypto.randomUUID();
      await db.insert(schema.clientes).values({
        id,
        nombre,
        tipo_documento: tipo_documento || 'Fisica',
        documento_id: documento_id || null,
        actividad_economica: actividad_economica || null,
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
      const { nombre, tipo_documento, documento_id, actividad_economica, telefono, email, direccion, provincia, canton, distrito, latitud, longitud, ruta, condicion_pago, precio_especial, limite_credito, notas, estado } = req.body;
      if (actividad_economica && !/^\d{1,20}$/.test(String(actividad_economica).trim())) return res.status(400).json({ error: 'La actividad económica debe ser un código numérico; confirme el valor con el cliente.' });
      const updateData: any = {};
      if (nombre !== undefined) updateData.nombre = nombre;
      if (tipo_documento !== undefined) updateData.tipo_documento = tipo_documento;
      if (documento_id !== undefined) updateData.documento_id = documento_id;
      if (actividad_economica !== undefined) updateData.actividad_economica = actividad_economica;
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
