import QRCode from "qrcode";
import { and, eq, inArray, like, or } from "drizzle-orm";
import * as schema from "../../db/schema";

export function registrarRutasEtiquetas(app: any, db: any, deps: { recordEvent: any; resolverVidaUtil: any; calcularVencimiento: any; requirePermission?: any; logAudit?: any }) {
  const { etiquetas, traza_etiqueta, guias_remision, guias_despacho, camiones, rutas, inventario, movimientosInventario } = schema;
  const { recordEvent, resolverVidaUtil, calcularVencimiento, requirePermission, logAudit } = deps;
  const permisoVerTrazabilidad = requirePermission(['etiquetas', 'ventas', 'inventario_bodega'], 'view');
  // ==================== ETIQUETAS / QR ====================

  // Generar etiqueta para cartón
  app.post("/api/etiquetas/generar", requirePermission('etiquetas', 'create'), async (req, res) => {
    try {
      const { producto, cantidad, pesoBruto, pesoNeto, granjaOrigen, galeronOrigen, clasificacion, lote, ubicacion, fechaVencimiento, tipoCarton } = req.body;
      
      if (!producto || !cantidad) {
        return res.status(400).json({ error: "Faltan datos mínimos de la etiqueta" });
      }

      const id = crypto.randomUUID();
      const codigoUnico = `ETQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${id.slice(0, 8).toUpperCase()}`;
      const catalogo = await db.select().from(schema.productosCatalogo);
      const { vidaUtilDias } = resolverVidaUtil(producto, catalogo);
      const ahora = new Date().toISOString();
      
      await db.insert(etiquetas).values({
        id,
        codigoUnico,
        producto,
        cantidad: Number(cantidad),
        pesoBruto: pesoBruto ? Number(pesoBruto) : null,
        pesoNeto: pesoNeto ? Number(pesoNeto) : null,
        fechaProduccion: ahora,
        fechaEmpaque: ahora,
        fechaVencimiento: fechaVencimiento || calcularVencimiento(ahora, vidaUtilDias),
        granjaOrigen: granjaOrigen || null,
        galeronOrigen: galeronOrigen || null,
        clasificacion: clasificacion || null,
        tara: pesoBruto && pesoNeto ? Number(pesoBruto) - Number(pesoNeto) : null,
        estado: 'Generada',
        ubicacionActual: ubicacion || 'Granja',
        lote: lote || null,
        tipoCarton: tipoCarton || null
      });

      const actor = (req as any).usuario?.id || String(req.headers['x-user-id'] || 'system');
      await recordEvent(id, 'Generada', ubicacion || 'Granja', codigoUnico, actor, lote ? `Lote ${lote}` : undefined);

      res.status(201).json({ success: true, id, codigoUnico });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Capturar peso neto por etiqueta. El mismo contrato acepta Manual ahora y
  // Bascula cuando se conecte un dispositivo, conservando actor y timestamp.
  app.post("/api/etiquetas/:id/peso-neto", requirePermission ? requirePermission(['inventario_bodega', 'pesos'], 'create') : undefined, async (req, res) => {
    try {
      const etiqueta = await db.query.etiquetas.findFirst({ where: eq(etiquetas.id, req.params.id) });
      if (!etiqueta) return res.status(404).json({ error: 'Etiqueta no encontrada' });
      if (!['Generada', 'EnBodega'].includes(String(etiqueta.estado))) return res.status(409).json({ error: 'El peso solo se puede registrar antes de cargar la etiqueta a una ruta' });
      const pesoKg = Number(req.body?.pesoKg);
      if (!Number.isFinite(pesoKg) || pesoKg <= 0) return res.status(400).json({ error: 'Indique un peso neto en kg mayor que cero' });
      const origen = req.body?.origen === 'Bascula' ? 'Bascula' : 'Manual';
      const actor = (req as any).usuario?.id || String(req.headers['x-user-id'] || 'demo');
      const ahora = new Date().toISOString();
      const antes = { pesoNeto: etiqueta.pesoNeto, pesoOrigen: etiqueta.pesoOrigen || null, pesoRegistradoPor: etiqueta.pesoRegistradoPor || null, pesoRegistradoEn: etiqueta.pesoRegistradoEn || null };
      const despues = { pesoNeto: pesoKg, pesoOrigen: origen, pesoRegistradoPor: actor, pesoRegistradoEn: ahora };
      await db.transaction(async (tx: any) => {
        if (etiqueta.estado === 'EnBodega') {
          const pesoAnterior = Number(etiqueta.pesoNeto);
          const stockBodega = await tx.query.inventario.findFirst({ where: and(eq(inventario.producto, etiqueta.producto), eq(inventario.ubicacion, 'Bodega Central'), eq(inventario.unidad, 'kg')) });
          // La primera pesada de una etiqueta aceptada fija su peso real; no
          // debe exigir un peso previo. Los ajustes posteriores solo pueden
          // conciliarse contra inventario que ya esté expresado en kg.
          if (pesoAnterior > 0) {
            if (!stockBodega || stockBodega.unidad !== 'kg') throw Object.assign(new Error('El inventario de Bodega Central debe estar confirmado en kg antes de actualizar este pesaje.'), { status: 409 });
            const diferenciaKg = pesoKg - pesoAnterior;
            if (Number(stockBodega.cantidad) + diferenciaKg < -0.0001) throw Object.assign(new Error('El ajuste de peso dejaría el inventario de Bodega Central negativo.'), { status: 409 });
            if (Math.abs(diferenciaKg) > 0.0001) {
            await tx.update(inventario).set({ cantidad: Number(stockBodega.cantidad) + diferenciaKg, ultima_actualizacion: ahora }).where(eq(inventario.id, stockBodega.id));
            await tx.insert(movimientosInventario).values({ id: crypto.randomUUID(), producto: etiqueta.producto, cantidad: diferenciaKg, unidad: 'kg', tipo: 'Ajuste Peso Etiqueta', origen: 'Bodega Central', destino: 'Bodega Central', fecha: ahora, referencia_id: etiqueta.id, lote: etiqueta.lote || null });
            }
          }
        }
        await tx.update(etiquetas).set(despues).where(eq(etiquetas.id, etiqueta.id));
      });
      await recordEvent(etiqueta.id, 'Pesada', etiqueta.ubicacionActual || 'Bodega Central', null, actor, `Peso neto ${pesoKg} kg; origen ${origen}`);
      await logAudit?.(actor, 'RegistrarPesoNeto', 'Etiqueta', etiqueta.id, antes, despues);
      return res.json({ success: true, etiquetaId: etiqueta.id, pesoKg, origen, registradoEn: ahora });
    } catch (error: any) {
      return res.status(error.status || 500).json({ error: error.message });
    }
  });

  // Generar múltiples etiquetas (lote)
  app.post("/api/etiquetas/generar-lote", requirePermission('etiquetas', 'create'), async (req, res) => {
    try {
      const { etiquetas: etiquetasData } = req.body;
      
      if (!etiquetasData || !Array.isArray(etiquetasData) || etiquetasData.length === 0) {
        return res.status(400).json({ error: "Se requiere un array de etiquetas" });
      }

      const results = [];
      const catalogo = await db.select().from(schema.productosCatalogo);
      const ahora = new Date().toISOString();
      for (const eq_data of etiquetasData) {
        const id = crypto.randomUUID();
        const codigoUnico = `ETQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${id.slice(0, 8).toUpperCase()}`;
        const { vidaUtilDias } = resolverVidaUtil(eq_data.producto, catalogo);
        
        await db.insert(etiquetas).values({
          id,
          codigoUnico,
          producto: eq_data.producto,
          cantidad: Number(eq_data.cantidad),
          pesoBruto: eq_data.pesoBruto ? Number(eq_data.pesoBruto) : null,
          pesoNeto: eq_data.pesoNeto ? Number(eq_data.pesoNeto) : null,
          fechaProduccion: ahora,
          fechaEmpaque: ahora,
          fechaVencimiento: eq_data.fechaVencimiento || calcularVencimiento(ahora, vidaUtilDias),
          granjaOrigen: eq_data.granjaOrigen || null,
          galeronOrigen: eq_data.galeronOrigen || null,
          clasificacion: eq_data.clasificacion || null,
          tara: eq_data.pesoBruto && eq_data.pesoNeto ? Number(eq_data.pesoBruto) - Number(eq_data.pesoNeto) : null,
          estado: 'Generada',
          ubicacionActual: eq_data.ubicacion || 'Granja',
          lote: eq_data.lote || null,
          tipoCarton: eq_data.tipoCarton || null
        });

        const actor = (req as any).usuario?.id || String(req.headers['x-user-id'] || 'system');
        await recordEvent(id, 'Generada', eq_data.ubicacion || 'Granja', codigoUnico, actor, eq_data.lote ? `Lote ${eq_data.lote}` : undefined);

        results.push({ id, codigoUnico });
      }

      res.status(201).json({ success: true, etiquetas: results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Escanear/Actualizar estado de etiqueta
  app.post("/api/etiquetas/escanear", requirePermission(['etiquetas', 'inventario_bodega'], 'create'), async (req, res) => {
    try {
      const { codigoUnico, nuevoEstado, ubicacion } = req.body;
      
      if (!codigoUnico || !nuevoEstado) {
        return res.status(400).json({ error: "Código y nuevo estado son requeridos" });
      }

      const etiqueta = await db.query.etiquetas.findFirst({
        where: eq(etiquetas.codigoUnico, codigoUnico)
      });

      if (!etiqueta) {
        return res.status(404).json({ error: "Etiqueta no encontrada" });
      }

      await db.update(etiquetas)
        .set({ 
          estado: nuevoEstado,
          ubicacionActual: ubicacion || etiqueta.ubicacionActual
        })
        .where(eq(etiquetas.id, etiqueta.id));

      res.json({ success: true, message: `Etiqueta ${codigoUnico} actualizada a ${nuevoEstado}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // QR real de la etiqueta (PNG)
  app.get("/api/etiquetas/:codigo/qr.png", async (req, res) => {
    try {
      const { codigo } = req.params;
      const etiqueta = await db.query.etiquetas.findFirst({
        where: eq(etiquetas.codigoUnico, codigo)
      });
      if (!etiqueta) return res.status(404).json({ error: "Etiqueta no encontrada" });

      const url = `${req.protocol}://${req.get('host')}/#/trazabilidad/${encodeURIComponent(codigo)}`;
      const png = await QRCode.toBuffer(url, { width: 160, margin: 1 });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(png);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Buscar etiquetas por código, lote, producto o referencia de documento.
  app.get("/api/etiquetas/trazabilidad/buscar", permisoVerTrazabilidad, async (req, res) => {
    try {
      const termino = String(req.query.q || '').trim();
      if (termino.length < 2) return res.json({ resultados: [] });
      const patron = `%${termino}%`;
      const [coincidencias, eventos] = await Promise.all([
        db.query.etiquetas.findMany({
          where: or(like(etiquetas.codigoUnico, patron), like(etiquetas.lote, patron), like(etiquetas.producto, patron)),
          limit: 50,
          orderBy: (tabla: any, { desc }: any) => [desc(tabla.fechaEmpaque)]
        }),
        db.query.traza_etiqueta.findMany({ where: like(traza_etiqueta.documentoRef, patron), limit: 200 })
      ]);
      const idsPorDocumento = new Set<string>(eventos.map((evento: any) => String(evento.etiquetaId)));
      const etiquetasDocumento = idsPorDocumento.size
        ? await db.query.etiquetas.findMany({ where: inArray(etiquetas.id, Array.from(idsPorDocumento)), limit: 50 })
        : [];
      const porId = new Map<string, any>();
      [...coincidencias, ...etiquetasDocumento].forEach((etiqueta: any) => porId.set(etiqueta.id, etiqueta));
      return res.json({ resultados: Array.from(porId.values()).slice(0, 50).map((etiqueta: any) => ({
        codigo: etiqueta.codigoUnico,
        producto: etiqueta.producto,
        lote: etiqueta.lote || null,
        estado: etiqueta.estado,
        ubicacion: etiqueta.ubicacionActual || null,
        saldoKg: Number(etiqueta.saldoKg ?? etiqueta.pesoNeto ?? 0)
      })) });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Consultar trazabilidad por código de etiqueta
  app.get("/api/etiquetas/trazabilidad/:codigo", permisoVerTrazabilidad, async (req, res) => {
    try {
      const { codigo } = req.params;
      
      const etiqueta = await db.query.etiquetas.findFirst({
        where: eq(etiquetas.codigoUnico, codigo)
      });

      if (!etiqueta) {
        return res.status(404).json({ error: "Etiqueta no encontrada" });
      }

      // Get related weight records
      const todosPesos = await db.query.pesos_por_punto.findMany();
      const pesosRelacionados = todosPesos.filter(p => 
        p.referenciaId === etiqueta.id || 
        (p.producto === etiqueta.producto && String(p.fecha).slice(0, 10) === String(etiqueta.fechaProduccion).slice(0, 10))
      );

      // F1: línea de custodia (eventos de la etiqueta)
      const [eventosTraza, usuarios] = await Promise.all([
        db.query.traza_etiqueta.findMany({ where: eq(traza_etiqueta.etiquetaId, etiqueta.id) }),
        db.query.users.findMany({ columns: { id: true, name: true, role: true } })
      ]);
      const usuariosPorId = new Map(usuarios.map((usuario: any) => [usuario.id, usuario]));
      const traza = eventosTraza
        .sort((a: any, b: any) => String(a.fecha).localeCompare(String(b.fecha)))
        .map((evento: any, indice: number, lista: any[]) => ({
          ...evento,
          origenDerivado: indice > 0 ? lista[indice - 1].ubicacion || null : null,
          usuario: evento.usuarioId ? usuariosPorId.get(evento.usuarioId) || null : null
        }));

      // Guía de remisión asociada (si nació de un alistamiento)
      let guia = null;
      if (etiqueta.guiaRemisionId) {
        guia = await db.query.guias_remision.findFirst({
          where: eq(guias_remision.id, etiqueta.guiaRemisionId)
        });
      }

      // Despacho (GD-) que transportó la etiqueta: se toma de la traza 'Cargada' más reciente
      let despacho = null;
      const cargada = [...traza]
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
        .find(t => t.tipoEvento === 'Cargada' && t.documentoRef);
      if (cargada?.documentoRef) {
        const guiaDesp = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, cargada.documentoRef) });
        if (guiaDesp) {
          const camionDesp = guiaDesp.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guiaDesp.camionId) }) : null;
          const rutaDesp = guiaDesp.rutaId ? await db.query.rutas.findFirst({ where: eq(rutas.id, guiaDesp.rutaId) }) : null;
          despacho = {
            id: guiaDesp.id,
            consecutivo: guiaDesp.consecutivo,
            estado: guiaDesp.estado,
            pesoSalida: guiaDesp.pesoSalida,
            pesoLlegada: guiaDesp.pesoLlegada,
            camion: camionDesp ? { id: camionDesp.id, nombre: camionDesp.nombre, placa: camionDesp.placa } : null,
            ruta: rutaDesp ? { id: rutaDesp.id, nombre: rutaDesp.nombre } : null
          };
        }
      }

      res.json({ etiqueta, pesos: pesosRelacionados, traza, guia, despacho });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Listar etiquetas
  app.get("/api/etiquetas", requirePermission(['etiquetas', 'ventas', 'inventario_bodega'], 'view'), async (req, res) => {
    try {
      const data = await db.query.etiquetas.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
