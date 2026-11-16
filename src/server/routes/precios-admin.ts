import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';

/** Registra administración de listas, bandas, vigencias e historial de precios. */
export function registrarRutasAdministracionPrecios(app: any, db: any, requirePermission: (...args: any[]) => any, logAudit: (...args: any[]) => Promise<void>) {
  const { listas_precios, precios_detalle, historial_precios } = schema;

  app.get("/api/precios/listas", requirePermission('precios', 'view'), async (req, res) => {
    try {
      const data = await db.query.listas_precios.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/precios/listas", requirePermission('precios', 'approve'), async (req, res) => {
    try {
      const { nombre, tipo, rutaAsociada, clienteId } = req.body;
      if (!nombre || !['Global', 'Ruta', 'Cliente'].includes(tipo)) return res.status(400).json({ error: "Indique nombre y un tipo válido de lista" });
      if (tipo === 'Ruta' && !rutaAsociada) return res.status(400).json({ error: 'Seleccione la ruta para esta lista' });
      if (tipo === 'Cliente' && !clienteId) return res.status(400).json({ error: 'Seleccione el cliente para esta lista' });
      const actor = (req as any).usuario;
      const hoy = new Date().toISOString().slice(0, 10);
      const fechaInicio = String(req.body.fechaInicio || hoy).slice(0, 10);
      const fechaFinNormalizada = req.body.fechaFin ? String(req.body.fechaFin).slice(0, 10) : null;
      const esFechaValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
      if (!esFechaValida(fechaInicio) || fechaInicio < hoy) return res.status(400).json({ error: 'La fecha inicial debe ser válida y no puede estar en el pasado' });
      if (fechaFinNormalizada && (!esFechaValida(fechaFinNormalizada) || fechaFinNormalizada < fechaInicio)) return res.status(400).json({ error: 'La fecha final debe ser válida y no anterior al inicio' });
      const listasActivas = await db.query.listas_precios.findMany({ where: eq(listas_precios.estado, 'Activa') });
      const mismoAmbito = (l: any) => l.tipo === tipo && (tipo === 'Global'
        || (tipo === 'Ruta' && l.rutaAsociada === rutaAsociada)
        || (tipo === 'Cliente' && l.clienteId === clienteId));
      const seSolapa = listasActivas.some((l: any) => {
        if (!mismoAmbito(l)) return false;
        const inicioExistente = String(l.fechaInicio || '0000-01-01').slice(0, 10);
        const finExistente = l.fechaFin ? String(l.fechaFin).slice(0, 10) : '9999-12-31';
        const finNuevo = fechaFinNormalizada || '9999-12-31';
        return fechaInicio <= finExistente && inicioExistente <= finNuevo;
      });
      if (seSolapa) return res.status(409).json({ error: 'Ya existe una lista activa del mismo ámbito durante esas fechas. Ajuste su vigencia antes de crear otra.' });
      const id = crypto.randomUUID();
      await db.insert(listas_precios).values({
        id, nombre, tipo, rutaAsociada: rutaAsociada || null, clienteId: clienteId || null,
        estado: 'Activa', fechaInicio,
        fechaFin: fechaFinNormalizada, aprobadoPor: actor.name || actor.id
      });
      await logAudit(actor.id, 'CrearLista', 'Precios', id, null, { nombre, tipo, rutaAsociada: rutaAsociada || null, clienteId: clienteId || null, fechaInicio, fechaFin: fechaFinNormalizada });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.patch("/api/precios/listas/:id/vigencia", requirePermission('precios', 'approve'), async (req, res) => {
    try {
      const lista = await db.query.listas_precios.findFirst({ where: eq(listas_precios.id, req.params.id) });
      if (!lista) return res.status(404).json({ error: 'Lista de precios no encontrada' });
      const actor = (req as any).usuario;
      const nuevoEstado = req.body?.estado == null ? lista.estado : String(req.body.estado);
      if (!['Activa', 'Inactiva'].includes(nuevoEstado)) return res.status(400).json({ error: 'Estado de lista inválido' });
      const fechaInicio = String(req.body?.fechaInicio ?? lista.fechaInicio).slice(0, 10);
      const fechaFin = req.body?.fechaFin === null || req.body?.fechaFin === '' ? null : String(req.body?.fechaFin ?? lista.fechaFin ?? '').slice(0, 10) || null;
      const esFechaValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
      if (!esFechaValida(fechaInicio) || (fechaFin && (!esFechaValida(fechaFin) || fechaFin < fechaInicio))) return res.status(400).json({ error: 'Vigencia inválida: use fechas reales y un fin no anterior al inicio' });
      if (nuevoEstado === 'Activa') {
        const otras = await db.query.listas_precios.findMany({ where: eq(listas_precios.estado, 'Activa') });
        const conflicto = otras.some((l: any) => {
          if (l.id === lista.id || l.tipo !== lista.tipo) return false;
          const mismo = lista.tipo === 'Global' || (lista.tipo === 'Ruta' && l.rutaAsociada === lista.rutaAsociada)
            || (lista.tipo === 'Cliente' && l.clienteId === lista.clienteId);
          if (!mismo) return false;
          const inicioOtro = String(l.fechaInicio || '0000-01-01').slice(0, 10);
          const finOtro = l.fechaFin ? String(l.fechaFin).slice(0, 10) : '9999-12-31';
          return fechaInicio <= finOtro && inicioOtro <= (fechaFin || '9999-12-31');
        });
        if (conflicto) return res.status(409).json({ error: 'La vigencia se cruza con otra lista activa del mismo ámbito.' });
      }
      const antes = lista;
      await db.update(listas_precios).set({ estado: nuevoEstado, fechaInicio, fechaFin }).where(eq(listas_precios.id, lista.id));
      const despues = { ...lista, estado: nuevoEstado, fechaInicio, fechaFin };
      await logAudit(actor.id, 'CambiarVigenciaLista', 'Precios', lista.id, antes, despues);
      res.json({ success: true, lista: despues });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/precios/detalle/:listaId", requirePermission('precios', 'view'), async (req, res) => {
    try {
      const { listaId } = req.params;
      const data = await db.query.precios_detalle.findMany();
      res.json(data.filter(p => p.listaId === listaId));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/precios/detalle", requirePermission('precios', 'approve'), async (req, res) => {
    try {
      const { listaId, producto, precioUnitario, precioMinimo, precioMaximo, descuentoMaximo, unidad } = req.body;
      if (!listaId || !producto || precioUnitario === undefined) {
        return res.status(400).json({ error: "Faltan datos del precio" });
      }
      if (unidad !== undefined && unidad !== 'kg') return res.status(400).json({ error: 'Los precios comerciales se definen por kilogramo.' });
      const precio = Number(precioUnitario);
      const descuentoPct = Number(descuentoMaximo || 0);
      const minimo = precioMinimo == null || Number(precioMinimo) <= 0 ? precio * (1 - Number(descuentoMaximo || 0) / 100) : Number(precioMinimo);
      const maximo = precioMaximo == null || Number(precioMaximo) <= 0 ? precio : Number(precioMaximo);
      if (!Number.isFinite(precio) || precio <= 0 || !Number.isFinite(minimo) || !Number.isFinite(maximo)
        || !Number.isFinite(descuentoPct) || descuentoPct < 0 || descuentoPct > 100
        || minimo <= 0 || maximo < minimo || precio < minimo || precio > maximo) {
        return res.status(400).json({ error: "El precio de lista debe quedar dentro del rango mínimo y máximo" });
      }
      const lista = await db.query.listas_precios.findFirst({ where: eq(listas_precios.id, listaId) });
      if (!lista) return res.status(404).json({ error: 'Lista de precios no encontrada' });
      const duplicado = await db.query.precios_detalle.findFirst({ where: and(eq(precios_detalle.listaId, listaId), eq(precios_detalle.producto, producto)) });
      if (duplicado) return res.status(409).json({ error: 'El producto ya tiene precio en esta lista' });
      const actor = (req as any).usuario;
      const id = crypto.randomUUID();
      await db.insert(precios_detalle).values({
        id, listaId, producto, precioUnitario: precio, precioMinimo: minimo, precioMaximo: maximo,
        descuentoMaximo: descuentoPct, unidad: 'kg'
      });
      await logAudit(actor.id, 'AgregarPrecio', 'Precios', id, null, { listaId, producto, precioUnitario: precio, precioMinimo: minimo, precioMaximo: maximo, unidad: 'kg' });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.patch("/api/precios/detalle/:id/rango", requirePermission('precios', 'approve'), async (req, res) => {
    try {
      const detalle = await db.query.precios_detalle.findFirst({ where: eq(precios_detalle.id, req.params.id) });
      if (!detalle) return res.status(404).json({ error: 'Precio no encontrado' });
      const minimo = Number(req.body?.precioMinimo);
      const maximo = Number(req.body?.precioMaximo);
      const base = Number(detalle.precioUnitario);
      if (!Number.isFinite(minimo) || !Number.isFinite(maximo) || minimo <= 0 || maximo < minimo || base < minimo || base > maximo) {
        return res.status(400).json({ error: 'El rango debe ser válido e incluir el precio de lista actual.' });
      }
      const actualizado = {
        ...detalle,
        precioMinimo: minimo,
        precioMaximo: maximo,
        descuentoMaximo: base > 0 ? Math.max(0, ((base - minimo) / base) * 100) : 0,
      };
      await db.update(precios_detalle).set({
        precioMinimo: actualizado.precioMinimo,
        precioMaximo: actualizado.precioMaximo,
        descuentoMaximo: actualizado.descuentoMaximo,
      }).where(eq(precios_detalle.id, detalle.id));
      const actor = (req as any).usuario;
      await logAudit(actor.id, 'CambiarRangoNegociacion', 'Precios', detalle.id, detalle, actualizado);
      res.json({ success: true, precio: actualizado });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/precios/historial", requirePermission('precios', 'view'), async (req, res) => {
    try {
      const data = await db.query.historial_precios.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/precios/cambiar", requirePermission('precios', 'approve'), async (req, res) => {
    try {
      const { listaId, producto, precioNuevo, motivo } = req.body;
      const nuevo = Number(precioNuevo);
      if (!listaId || !producto || !Number.isFinite(nuevo) || nuevo <= 0) {
        return res.status(400).json({ error: "Indique lista, producto y un precio positivo" });
      }
      const precioActual = await db.query.precios_detalle.findFirst({
        where: and(eq(precios_detalle.listaId, listaId), eq(precios_detalle.producto, producto))
      });
      if (!precioActual) return res.status(404).json({ error: 'El producto no tiene precio en esta lista' });
      const anterior = Number(precioActual.precioUnitario);
      const minimoAnterior = Number(precioActual.precioMinimo ?? anterior * (1 - Number(precioActual.descuentoMaximo || 0) / 100));
      const maximoAnterior = Number(precioActual.precioMaximo ?? anterior);
      if (!Number.isFinite(anterior) || anterior <= 0 || !Number.isFinite(minimoAnterior) || !Number.isFinite(maximoAnterior)
        || minimoAnterior <= 0 || maximoAnterior < minimoAnterior || anterior < minimoAnterior || anterior > maximoAnterior) {
        return res.status(409).json({ error: 'La banda actual está incompleta o incoherente; corrija primero el piso y techo de negociación' });
      }
      const minimoNuevo = anterior > 0 ? nuevo * minimoAnterior / anterior : nuevo;
      const maximoNuevo = anterior > 0 ? nuevo * maximoAnterior / anterior : nuevo;
      const actor = (req as any).usuario;
      await db.insert(historial_precios).values({
        id: crypto.randomUUID(), producto, precioAnterior: anterior,
        precioNuevo: nuevo, tipoLista: 'Detalle', listaId,
        cambioPor: actor.name || actor.id, motivo: motivo || null, fecha: new Date().toISOString()
      });
      await db.update(precios_detalle).set({ precioUnitario: nuevo, precioMinimo: minimoNuevo, precioMaximo: maximoNuevo }).where(eq(precios_detalle.id, precioActual.id));
      await logAudit(actor.id, 'CambiarPrecio', 'Precios', precioActual.id, precioActual, { ...precioActual, precioUnitario: nuevo, precioMinimo: minimoNuevo, precioMaximo: maximoNuevo, motivo: motivo || null });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

}
