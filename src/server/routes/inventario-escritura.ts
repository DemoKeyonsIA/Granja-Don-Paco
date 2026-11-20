import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../db/schema';

/** Registra ingresos a bodega y capturas/consultas de peso de custodia. */
export function registrarRutasEscrituraBodega(app: any, db: any, requirePermission: (...args: any[]) => any) {
  const { etiquetas, traza_etiqueta, inventario, movimientosInventario, auditoria, pesos_por_punto } = schema;
  // ==================== BODEGA — INGRESO POR ESCANEO (Fase 2) ====================
  // Escanea códigos de etiqueta y las ingresa a bodega: estado EnBodega + fecha_recepcion + traza.
  app.post("/api/bodega/ingresar-etiquetas", requirePermission('inventario_bodega', 'create'), async (req, res) => {
    try {
      const { codigos, ubicacion, usuarioId, observaciones } = req.body;
      if (!Array.isArray(codigos) || codigos.length === 0) {
        return res.status(400).json({ error: "Se requiere un array de códigos de etiqueta" });
      }
      const destino = ubicacion || 'Bodega Central';
      const ahora = new Date().toISOString();
      const ingresadas: any[] = [];
      const errores: any[] = [];

      for (const codigo of codigos) {
        const cod = String(codigo || '').trim();
        if (!cod) continue;
        const etiqueta = await db.query.etiquetas.findFirst({ where: eq(etiquetas.codigoUnico, cod) });
        if (!etiqueta) { errores.push({ codigo: cod, error: 'Etiqueta no encontrada' }); continue; }
        await db.update(etiquetas).set({
          estado: 'EnBodega',
          ubicacionActual: destino,
          fechaRecepcion: (etiqueta as any).fechaRecepcion || ahora,
        }).where(eq(etiquetas.id, etiqueta.id));
        await db.insert(traza_etiqueta).values({
          id: crypto.randomUUID(),
          etiquetaId: etiqueta.id,
          tipoEvento: 'Recibida',
          ubicacion: destino,
          documentoRef: null,
          usuarioId: usuarioId || null,
          fecha: ahora,
          observaciones: observaciones || `Ingreso a bodega (${destino})`,
        });
        ingresadas.push({ id: etiqueta.id, codigoUnico: etiqueta.codigoUnico, producto: etiqueta.producto, cantidad: etiqueta.cantidad });
      }

      res.json({ success: true, ingresadas, errores });
    } catch (error: any) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  // Ingreso manual de producto a bodega (excepción: no hay traslado registrado)
  app.post("/api/bodega/ingreso-manual", requirePermission('inventario_bodega', 'create'), async (req, res) => {
    try {
      const { producto, cantidad, unidad, procedencia, observaciones, usuarioId } = req.body;
      const lote = String(req.body?.lote || '').trim() || null;
      const fechaVencimiento = String(req.body?.fechaVencimiento || '').trim() || null;
      const actorId = String((req as any).usuario?.id || req.headers['x-user-id'] || '');
      if (!producto || !String(producto).trim()) return res.status(400).json({ error: "El producto es requerido" });
      const cant = Number(cantidad);
      if (!Number.isFinite(cant) || cant <= 0) return res.status(400).json({ error: "La cantidad debe ser mayor a 0" });
      const unidadFinal = String(unidad || (String(producto).toLowerCase().includes('huevo') ? 'kg' : 'cartones'));
      if (!['kg', 'cartones'].includes(unidadFinal)) return res.status(400).json({ error: 'La unidad del ingreso debe ser kg.' });
      if (String(producto).toLowerCase().includes('huevo') && unidadFinal !== 'kg') return res.status(400).json({ error: 'El huevo se registra exclusivamente en kg.' });
      const fechaVencimientoValida = Boolean(fechaVencimiento && /^\d{4}-\d{2}-\d{2}$/.test(fechaVencimiento) && Number.isFinite(Date.parse(`${fechaVencimiento}T00:00:00Z`)) && new Date(`${fechaVencimiento}T00:00:00Z`).toISOString().slice(0, 10) === fechaVencimiento);
      if (fechaVencimiento && !fechaVencimientoValida) return res.status(400).json({ error: 'La fecha de vencimiento debe ser una fecha válida.' });
      if (!observaciones || !String(observaciones).trim()) {
        return res.status(400).json({ error: "La observación es obligatoria en un ingreso manual (auditoría)" });
      }
      const origenExcepcion = procedencia || 'Granja (sin traslado)';
      const destino = 'Bodega Central';
      const ahora = new Date().toISOString();
      const referente = actorId || (usuarioId ? String(usuarioId) : null);
      const responsable = referente || 'Bodeguero Actual';
      const id = crypto.randomUUID();

      await db.transaction(async (tx) => {
        // 1. Sumar al inventario de Bodega Central
        const item = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, destino), eq(inventario.unidad, unidadFinal), lote ? eq(inventario.lote, lote) : isNull(inventario.lote)),
        });
        if (item) {
          if (fechaVencimiento && item.fecha_caducidad && item.fecha_caducidad !== fechaVencimiento) throw Object.assign(new Error('Este lote ya tiene otra fecha de vencimiento registrada. Verifique el documento y corrija el lote antes de mezclar el ingreso.'), { status: 409 });
          await tx.update(inventario).set({
            cantidad: item.cantidad + cant,
            ...(fechaVencimiento ? { fecha_caducidad: fechaVencimiento } : {}),
            ultima_actualizacion: ahora,
          }).where(eq(inventario.id, item.id));
        } else {
          await tx.insert(inventario).values({
            id: crypto.randomUUID(), producto, cantidad: cant, unidad: unidadFinal, ubicacion: destino, lote, fecha_caducidad: fechaVencimiento, ultima_actualizacion: ahora,
          });
        }

        // 2. Registrar movimiento tipo excepción
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(), producto, cantidad: cant, unidad: unidadFinal, tipo: 'Ingreso Manual', origen: origenExcepcion, destino, fecha: ahora, referencia_id: id, registradoPor: referente, lote,
        });

        // 3. Auditoría de la excepción
        await tx.insert(auditoria).values({
          id: crypto.randomUUID(),
          usuarioId: referente || 'sistema',
          accion: 'Ingreso manual de producto a bodega',
          modulo: 'Bodega',
          referenciaId: id,
          valoresDespues: JSON.stringify({ producto, cantidad: cant, unidad: unidadFinal, lote, fechaVencimiento, procedencia: origenExcepcion }),
          motivo: String(observaciones).trim(),
          fecha: ahora,
        });
      });

      res.status(201).json({
        success: true,
        message: 'Ingreso manual registrado',
        id,
        descuadre: true, // excepción de stock visible en control/alertas
        responsable,
      });
    } catch (error: any) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  // ==================== PESOS POR PUNTO DE CUSTODIA ====================

  // Registrar peso en un punto de custodia
  app.post("/api/pesos/registrar", requirePermission(['pesos', 'inventario_bodega'], 'create'), async (req, res) => {
    try {
      const { referenciaId, tipoReferencia, producto, cantidadUnidades, unidad, pesoEsperado, pesoReal, basculaUtilizada, responsable, ubicacion, observaciones } = req.body;
      
      if (!tipoReferencia || !producto || !pesoEsperado || !pesoReal || !responsable || !ubicacion) {
        return res.status(400).json({ error: "Faltan datos requeridos del peso" });
      }

      const diferencia = Number(pesoReal) - Number(pesoEsperado);
      const estado = Math.abs(diferencia) <= Number(pesoEsperado) * 0.02 ? 'Conforme' : 'ConDiferencia'; // 2% tolerance

      const id = crypto.randomUUID();
      await db.insert(pesos_por_punto).values({
        id,
        referenciaId: referenciaId || null,
        tipoReferencia,
        producto,
        cantidadUnidades: Number(cantidadUnidades) || 0,
        unidad: unidad || 'cartones',
        pesoEsperado: Number(pesoEsperado),
        pesoReal: Number(pesoReal),
        diferencia,
        basculaUtilizada: basculaUtilizada || null,
        responsable,
        fecha: new Date().toISOString(),
        ubicacion,
        observaciones: observaciones || null,
        estado
      });

      res.status(201).json({ success: true, id, diferencia, estado });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Consultar trazabilidad de pesos por producto
  app.get("/api/pesos/trazabilidad", requirePermission(['pesos', 'tablero_operativo'], 'view'), async (req, res) => {
    try {
      const producto = req.query.producto as string;
      const todosPesos = await db.query.pesos_por_punto.findMany();
      
      const filtered = producto 
        ? todosPesos.filter(p => p.producto === producto)
        : todosPesos;

      // Summary
      const resumen = filtered.reduce((acc, p) => {
        acc.totalEsperado += Number(p.pesoEsperado);
        acc.totalReal += Number(p.pesoReal);
        acc.totalDiferencia += Number(p.diferencia);
        return acc;
      }, { totalEsperado: 0, totalReal: 0, totalDiferencia: 0 });

      res.json({ pesos: filtered, resumen });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Listar todos los pesos
  app.get("/api/pesos", requirePermission(['pesos', 'tablero_operativo'], 'view'), async (req, res) => {
    try {
      const data = await db.query.pesos_por_punto.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Conciliación de pesos (resumen por Custodia)
  app.get("/api/pesos/conciliacion", requirePermission(['pesos', 'tablero_operativo'], 'view'), async (req, res) => {
    try {
      const todosPesos = await db.query.pesos_por_punto.findMany();
      const hoy = new Date().toISOString().split('T')[0];

      const pesosHoy = todosPesos.filter(p => String(p.fecha).startsWith(hoy));

      // Group by ubicacion
      const porUbicacion = pesosHoy.reduce((acc, p) => {
        if (!acc[p.ubicacion]) {
          acc[p.ubicacion] = { pesoEsperado: 0, pesoReal: 0, diferencia: 0, registros: 0 };
        }
        acc[p.ubicacion].pesoEsperado += Number(p.pesoEsperado);
        acc[p.ubicacion].pesoReal += Number(p.pesoReal);
        acc[p.ubicacion].diferencia += Number(p.diferencia);
        acc[p.ubicacion].registros += 1;
        return acc;
      }, {} as Record<string, { pesoEsperado: number; pesoReal: number; diferencia: number; registros: number }>);

      res.json({ porUbicacion, totalRegistros: pesosHoy.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


}
