import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";

export function registrarRutasGranjas(app: any, db: any, requirePermission: (...args: any[]) => any, logAudit?: (...args: any[]) => Promise<void>) {
  const { granjas, galerones, lotes_aves, mantenimientos } = schema;
  // Granja Hierarchy Endpoints
  app.get("/api/granjas", requirePermission('granjas_admin', 'view'), async (req, res) => {
    try {
      const data = await db.query.granjas.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  

  app.post("/api/granjas/wizard", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { nombre, ubicacion, tipo_produccion, encargadoId, galerones: galeronesData } = req.body;
      if (!nombre) {
        return res.status(400).json({ error: "Falta nombre de la granja" });
      }

      // `galerones` se acepta como array de objetos `{ nombre, capacidad_maxima }`, y
      // si mandas `['Galerón Uno']` se responds 400 diciendo cuál entrada está mal.
      // Antes `g.nombre` sobre un string daba `undefined` y SQLite contestaba
      // NOT NULL en `galerones.nombre`, así que un cliente que se equivocaba de
      // formato se comía un 500 con el SQL entero en el mensaje.
      let galeronesNormalizados: { nombre: string; capacidad_maxima: number }[] | null = null;
      if (galeronesData !== undefined && galeronesData !== null) {
        if (!Array.isArray(galeronesData)) {
          return res.status(400).json({ error: "galerones debe ser una lista" });
        }
        const malos: string[] = [];
        galeronesNormalizados = [];
        galeronesData.forEach((g: any, i: number) => {
          if (!g || typeof g !== 'object' || Array.isArray(g)) {
            malos.push(`galerones[${i}] no es un objeto con nombre y capacidad_maxima`);
            return;
          }
          if (!g.nombre || typeof g.nombre !== 'string') {
            malos.push(`galerones[${i}].nombre`);
            return;
          }
          // `Number(undefined)` es NaN, que SQLite no es NOT NULL pero tampoco es un
          // número: se cuela como 0 y la capacidad real se pierde sin avisar.
          const capacidad = Number(g.capacidad_maxima);
          galeronesNormalizados!.push({
            nombre: g.nombre,
            capacidad_maxima: Number.isFinite(capacidad) ? capacidad : 0,
          });
        });
        if (malos.length) {
          return res.status(400).json({ error: `Galerones inválidos: ${malos.join('; ')}` });
        }
      }

      const granjaId = crypto.randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(granjas).values({
          id: granjaId,
          nombre,
          ubicacion: ubicacion || '',
          tipo_produccion: tipo_produccion || '',
          encargadoId: encargadoId || 'admin-001',
          estado: 'Activo'
        });

        if (galeronesNormalizados && galeronesNormalizados.length > 0) {
          const galeronesToInsert = galeronesNormalizados.map(g => ({
            id: crypto.randomUUID(),
            granjaId,
            nombre: g.nombre,
            capacidad_maxima: g.capacidad_maxima,
            fecha_ultimo_mantenimiento: null,
            estado: 'Activo'
          }));
          await tx.insert(galerones).values(galeronesToInsert);
        }
      });

      if (logAudit) await logAudit(req.usuario?.id || 'demo', 'crear', 'granjas', granjaId, null, { nombre, ubicacion, tipo_produccion, galerones: galeronesNormalizados });

      res.status(201).json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/granjas", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { nombre, ubicacion, encargadoId } = req.body;
      if (!nombre || !ubicacion || !encargadoId) return res.status(400).json({ error: "Faltan datos" });
      const id = crypto.randomUUID();
      await db.insert(granjas).values({
        id,
        nombre,
        ubicacion,
        encargadoId
      });
      if (logAudit) await logAudit(req.usuario?.id || 'demo', 'crear', 'granjas', id, null, { nombre, ubicacion, encargadoId });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/galerones", requirePermission('granjas_admin', 'view'), async (req, res) => {
    try {
      const data = await db.query.galerones.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/galerones", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { granjaId, nombre, capacidad_maxima, fecha_ultimo_mantenimiento, aves_en_produccion, tipo_galeron, produccion_diaria_esperada, notas, estado } = req.body;
      if (!granjaId || !nombre || !capacidad_maxima) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(galerones).values({
        id: crypto.randomUUID(),
        granjaId,
        nombre,
        capacidad_maxima: Number(capacidad_maxima),
        aves_en_produccion: Number(aves_en_produccion) || 0,
        tipo_galeron: tipo_galeron || 'Productora',
        produccion_diaria_esperada: Number(produccion_diaria_esperada) || 0,
        notas: notas || '',
        fecha_ultimo_mantenimiento,
        estado: estado || 'Activo'
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/lotes", requirePermission('granjas_admin', 'view'), async (req, res) => {
    try {
      const data = await db.query.lotes_aves.findMany();
      // Legacy sentinel only satisfies the lote_id FK for production entered
      // before a real flock was assigned. It is not a business lot.
      res.json(data.filter((lote: any) => lote.id !== 'NO_LOTE_ACTIVO'));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/lotes", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { galeronId, fecha_ingreso, cantidad_inicial, linea_genetica, estado } = req.body;
      if (!galeronId || !fecha_ingreso || !cantidad_inicial || !linea_genetica || !estado) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(lotes_aves).values({
        id: crypto.randomUUID(),
        galeronId,
        fecha_ingreso,
        cantidad_inicial: Number(cantidad_inicial),
        linea_genetica,
        estado
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/mantenimientos", requirePermission('granjas_admin', 'view'), async (req, res) => {
    try {
      const data = await db.query.mantenimientos.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/mantenimientos", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { galeronId, fecha, tipo, descripcion, estado } = req.body;
      if (!galeronId || !fecha || !tipo || !descripcion || !estado) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(mantenimientos).values({
        id: crypto.randomUUID(),
        galeronId,
        fecha,
        tipo,
        descripcion,
        estado
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update mantenimiento
  app.put("/api/mantenimientos/:id", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { id } = req.params;
      const existente = await db.query.mantenimientos.findFirst({ where: eq(mantenimientos.id, id) });
      if (!existente) return res.status(404).json({ error: "Mantenimiento no encontrado" });
      const { estado } = req.body;
      const updateData: any = {};
      if (estado) updateData.estado = estado;
      await db.update(mantenimientos).set(updateData).where(eq(mantenimientos.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });


  // CRUD Updates Granjas
  app.put("/api/granjas/:id", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { id } = req.params;
      const existente = await db.query.granjas.findFirst({ where: eq(granjas.id, id) });
      if (!existente) return res.status(404).json({ error: "Granja no encontrada" });
      const { nombre, ubicacion, tipo_produccion, encargadoId, estado } = req.body;
      const updateData: any = {};
      if (nombre) updateData.nombre = nombre;
      if (ubicacion) updateData.ubicacion = ubicacion;
      if (tipo_produccion) updateData.tipo_produccion = tipo_produccion;
      if (encargadoId) updateData.encargadoId = encargadoId;
      if (estado) updateData.estado = estado;
      
      await db.update(granjas).set(updateData).where(eq(granjas.id, id));
      if (logAudit) await logAudit(req.usuario?.id || 'demo', estado === 'Archivado' ? 'archivar' : 'actualizar', 'granjas', id, existente, updateData);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // CRUD Updates Galerones
  app.put("/api/galerones/:id", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query.galerones.findFirst({ where: eq(galerones.id, id) });
      if (!existing) return res.status(404).json({ error: 'Galerón no encontrado' });
      const { nombre, capacidad_maxima, fecha_ultimo_mantenimiento, estado, aves_en_produccion, tipo_galeron, produccion_diaria_esperada, notas } = req.body;
      const updateData: any = {};
      if (nombre) updateData.nombre = nombre;
      if (capacidad_maxima) updateData.capacidad_maxima = Number(capacidad_maxima);
      if (fecha_ultimo_mantenimiento) updateData.fecha_ultimo_mantenimiento = fecha_ultimo_mantenimiento;
      if (estado) updateData.estado = estado;
      if (aves_en_produccion !== undefined) updateData.aves_en_produccion = Number(aves_en_produccion);
      if (tipo_galeron) updateData.tipo_galeron = tipo_galeron;
      if (produccion_diaria_esperada !== undefined) updateData.produccion_diaria_esperada = Number(produccion_diaria_esperada);
      if (notas !== undefined) updateData.notas = notas;
      
      await db.update(galerones).set(updateData).where(eq(galerones.id, id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete Galerón
  app.delete("/api/galerones/:id", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query.galerones.findFirst({ where: eq(galerones.id, id) });
      if (!existing) return res.status(404).json({ error: 'Galerón no encontrado' });
      await db.update(galerones).set({ estado: 'Archivado' }).where(eq(galerones.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Lotes CRUD
  app.put("/api/lotes/:id", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query.lotes_aves.findFirst({ where: eq(lotes_aves.id, id) });
      if (!existing) return res.status(404).json({ error: 'Lote no encontrado' });
      const { cantidad_inicial, linea_genetica, estado } = req.body;
      const updateData: any = {};
      if (cantidad_inicial !== undefined) updateData.cantidad_inicial = Number(cantidad_inicial);
      if (linea_genetica) updateData.linea_genetica = linea_genetica;
      if (estado) updateData.estado = estado;
      await db.update(lotes_aves).set(updateData).where(eq(lotes_aves.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete("/api/lotes/:id", requirePermission('granjas_admin', 'create'), async (req, res) => {
    try {
      const existing = await db.query.lotes_aves.findFirst({ where: eq(lotes_aves.id, req.params.id) });
      if (!existing) return res.status(404).json({ error: 'Lote no encontrado' });
      await db.update(lotes_aves).set({ estado: 'Finalizado' }).where(eq(lotes_aves.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Detalle de granja
  app.get("/api/granjas/:id/detalle", requirePermission('granjas_admin', 'view'), async (req, res) => {
    try {
      const { id } = req.params;
      const granja = await db.query.granjas.findFirst({ where: eq(granjas.id, id) });
      if (!granja) return res.status(404).json({ error: 'Granja no encontrada' });

      const todosGalerones = await db.query.galerones.findMany();
      const todosLotes = await db.query.lotes_aves.findMany();
      const todaProduccion = await db.query.produccion_diaria.findMany();
      const todasVacunaciones = await db.query.vacunaciones.findMany();
      const todasOrdenes = await db.query.ordenes_mantenimiento.findMany();
      const todoAlimento = await db.query.consumo_alimento.findMany();
      const hoy = new Date().toISOString().split('T')[0];

      const galeronesGranja = todosGalerones.filter(g => g.granjaId === id);
      const galeronIds = galeronesGranja.map(g => g.id);

      const galerones = galeronesGranja.map(gl => {
        const lotesGranja = todosLotes.filter(l => l.galeronId === gl.id && l.id !== 'NO_LOTE_ACTIVO');
        const lotesActivos = lotesGranja.filter(l => l.estado === 'Activo');
        const produccionHoy = todaProduccion.filter(p => p.galeronId === gl.id && String(p.fecha).startsWith(hoy));
        const produccion7d = todaProduccion.filter(p => p.galeronId === gl.id);
        const cartonesHoy = produccionHoy.filter(p => String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0);
        const aves = gl.aves_en_produccion || 0;
        const ocupacion = gl.capacidad_maxima > 0 ? Math.round((aves / gl.capacidad_maxima) * 100) : 0;
        const vacunas = todasVacunaciones.filter(v => v.galeronId === gl.id);
        const vacunasPendientes = vacunas.filter(v => v.estado === 'Programada' && v.fechaProgramada < hoy);
        const ordenes = todasOrdenes.filter(o => o.galeronId === gl.id);
        const ordenesPendientes = ordenes.filter(o => o.estado === 'Pendiente');
        const consumo = todoAlimento.filter(c => c.galeronId === gl.id);

        return {
          id: gl.id, nombre: gl.nombre, capacidad_maxima: gl.capacidad_maxima, estado: gl.estado,
          aves_en_produccion: gl.aves_en_produccion, tipo_galeron: gl.tipo_galeron,
          produccion_diaria_esperada: gl.produccion_diaria_esperada, notas: gl.notas,
          lotes: lotesGranja, lotesActivos: lotesActivos.length,
          cartonesHoy, aves, ocupacion,
          vacunasTotales: vacunas.length, vacunasPendientes: vacunasPendientes.length,
          ordenesTotales: ordenes.length, ordenesPendientes: ordenesPendientes.length,
          consumoTotal: consumo.reduce((a, c) => a + Number(c.cantidadConsumida), 0),
          produccionHistorial: produccion7d.map(p => ({ fecha: p.fecha, tipo: p.tipo_producto, cantidad: Number(p.cantidad) })),
          mantenimientos: ordenes.map(o => ({ id: o.id, tipo: o.tipo, fecha_programada: o.fecha_programada, fecha_ejecutada: o.fecha_ejecutada, estado: o.estado, responsable: o.responsable, costo: o.costo, observaciones: o.observaciones }))
        };
      });

      const produccionGranja = todaProduccion.filter(p => p.granjaId === id);
      const cartonesHoy = produccionGranja.filter(p => String(p.fecha).startsWith(hoy) && String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0);
      const avesTotal = galerones.reduce((a, g) => a + (g.aves_en_produccion || 0), 0);
      const capacidadTotal = galeronesGranja.reduce((a, g) => a + Number(g.capacidad_maxima), 0);
      const vacunasVencidas = todasVacunaciones.filter(v => v.granjaId === id && v.estado === 'Programada' && v.fechaProgramada < hoy);
      const ordenesVencidas = todasOrdenes.filter(o => galeronIds.includes(o.galeronId) && o.estado === 'Pendiente' && o.fechaProgramada < hoy);

      res.json({
        granja, galerones,
        resumen: {
          totalGalerones: galeronesGranja.filter(g => g.estado === 'Activo').length,
          totalLotes: galerones.reduce((a, g) => a + g.lotesActivos, 0),
          avesTotal, capacidadTotal, ocupacion: capacidadTotal > 0 ? Math.round((avesTotal / capacidadTotal) * 100) : 0,
          cartonesHoy,
          vacunasVencidas: vacunasVencidas.length, ordenesVencidas: ordenesVencidas.length
        }
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Produccion historial filtrado. Único handler de esta ruta: ver el comentario
  // en el lugar donde estaba el duplicado que lo precedía.
  app.get("/api/produccion/historial", requirePermission(['produccion', 'dashboard'], 'view'), async (req, res) => {
    try {
      const { granjaId, desde, hasta } = req.query;
      let data = await db.query.produccion_diaria.findMany();
      if (granjaId) data = data.filter(p => p.granjaId === granjaId);
      // `fecha` es un timestamp ISO completo y las vistas mandan los límites como
      // fecha corta (`<input type="date">`): comparar los textos tal cual hacía que
      // '2026-10-04T12:34:56.000Z' <= '2026-10-04' fuera falso y el rango de un solo
      // día saliera siempre vacío. Comparar solo la parte de la fecha lo arregla y
      // deja el límite superior incluido, que es lo que el usuario espera.
      const dia = (v: unknown) => String(v ?? '').slice(0, 10);
      if (desde) data = data.filter(p => dia(p.fecha) >= dia(desde));
      if (hasta) data = data.filter(p => dia(p.fecha) <= dia(hasta));
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

}
