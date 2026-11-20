import * as schema from '../../db/schema';
import { tieneRol } from '../clientes-scope';

/** Lecturas de existencias y kardex enriquecido para Bodega y Operaciones. */
export function registrarRutasLecturaInventario(app: any, db: any, requirePermission: (...args: any[]) => any) {
  app.get("/api/inventario", requirePermission ? requirePermission(['inventario', 'inventario_bodega', 'ventas'], 'view') : undefined, async (req, res) => {
    try {
      let data = await db.query.inventario.findMany();
      const usuario = (req as any).usuario;
      if (usuario && tieneRol(usuario, 'Comercial') && !tieneRol(usuario, 'Admin')) {
        const camiones = await db.query.camiones.findMany();
        const ubicacionesAsignadas = new Set(camiones
          .filter((camion: any) => String(camion.camioneroId || '') === String(usuario.id) || String(camion.vendedor_id || '') === String(usuario.id))
          .map((camion: any) => String(camion.nombre || '').trim())
          .filter(Boolean));
        data = data.filter((item: any) => ubicacionesAsignadas.has(String(item.ubicacion || '').trim()));
      }
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/inventario/movimientos — enriquecido con camión/guía/estado/responsable para el árbol día → camión → eventos
  app.get("/api/inventario/movimientos", requirePermission ? requirePermission(['inventario_bodega', 'tablero_operativo'], 'view') : undefined, async (req, res) => {
    try {
      const [movimientos, guiasData, camionesData, trasladosData, recepcionesData, remisionesData, usersData, granjasData, etiquetasData] =
        await Promise.all([
          db.query.movimientosInventario.findMany(),
          db.query.guias_despacho.findMany(),
          db.query.camiones.findMany(),
          db.query.traslados.findMany(),
          db.query.recepciones.findMany(),
          db.query.guias_remision.findMany(),
          db.query.users.findMany(),
          db.query.granjas.findMany(),
          db.query.etiquetas.findMany()
        ]) as any[];

      const guiaPorId = new Map(guiasData.map((g: any) => [g.id, g]) as any) as Map<string, any>;
      const camionPorId = new Map(camionesData.map((c: any) => [c.id, c]) as any) as Map<string, any>;
      const trasladoPorId = new Map(trasladosData.map((t: any) => [t.id, t]) as any) as Map<string, any>;
      const granjaPorId = new Map(granjasData.map((g: any) => [g.id, g]) as any) as Map<string, any>;
      const granjaPorNombre = new Map(granjasData.map((g: any) => [String(g.nombre || '').trim().toLocaleLowerCase(), g]) as any) as Map<string, any>;
      const recepcionPorId = new Map(recepcionesData.map((r: any) => [r.id, r]) as any) as Map<string, any>;
      const remisionPorId = new Map(remisionesData.map((r: any) => [r.id, r]) as any) as Map<string, any>;
      const userPorId = new Map(usersData.map((u: any) => [u.id, u]) as any) as Map<string, any>;
      const recepcionPorTraslado = new Map(recepcionesData.filter((r: any) => r.trasladoId).map((r: any) => [r.trasladoId, r]) as any) as Map<string, any>;
      const etiquetasPorRemision = new Map<string, any[]>();
      const etiquetasPorDespacho = new Map<string, any[]>();
      for (const etiqueta of etiquetasData as any[]) {
        if (etiqueta.guiaRemisionId) etiquetasPorRemision.set(etiqueta.guiaRemisionId, [...(etiquetasPorRemision.get(etiqueta.guiaRemisionId) || []), etiqueta]);
        if (etiqueta.guiaDespachoId) etiquetasPorDespacho.set(etiqueta.guiaDespachoId, [...(etiquetasPorDespacho.get(etiqueta.guiaDespachoId) || []), etiqueta]);
      }

      const correccionesPeso = new Map<string, any>(movimientos.filter((m: any) => m.tipo === 'Corrección Unidad Traslado' && m.referencia_id).map((m: any) => [m.referencia_id, m]));
      const correccionesPesoRemision = new Map<string, any>(movimientos.filter((m: any) => m.tipo === 'Corrección Unidad Remisión' && m.referencia_id).map((m: any) => [m.referencia_id, m]));
      const enriquecidos = movimientos.filter((m: any) => !['Corrección Unidad Traslado', 'Corrección Unidad Remisión'].includes(m.tipo)).map((mv: any) => {
        let estado: string | null = null;
        let reportadoPor: string | null = null;
        let camion: any = null;
        let consecutivo: string | null = null;
        let guiaId: string | null = null;
        let motivoDiferencia: string | null = null;
        let tipoDiferencia: string | null = null;
        let diferencia: number | null = null;
        let cantidadRecibida: number | null = null;
        let cantidadEsperada: number | null = null;

        const guia = mv.referencia_id ? guiaPorId.get(mv.referencia_id) : null;
        const traslado = !guia && mv.referencia_id ? trasladoPorId.get(mv.referencia_id) : null;
        const recepcionTraslado = traslado ? recepcionPorTraslado.get(traslado.id) : null;
        const remisionDirecta = mv.referencia_id ? remisionPorId.get(mv.referencia_id) : null;
        const remisionAsociada = remisionDirecta || (recepcionTraslado?.guiaRemisionId ? remisionPorId.get(recepcionTraslado.guiaRemisionId) : null);
        const granjaRemision = remisionAsociada?.granjaId
          ? granjaPorId.get(remisionAsociada.granjaId) || granjaPorNombre.get(String(remisionAsociada.granjaId).trim().toLocaleLowerCase())
          : null;
        const etiquetasAsociadas = guia
          ? etiquetasPorDespacho.get(guia.id) || []
          : remisionAsociada ? etiquetasPorRemision.get(remisionAsociada.id) || [] : [];
        const lotes = Array.from(new Set([
          remisionAsociada?.lote,
          ...etiquetasAsociadas.map((e: any) => e.lote),
        ].map((lote: any) => String(lote || '').trim()).filter(Boolean)));
        const codigosEtiquetas = Array.from(new Set(etiquetasAsociadas.map((e: any) => String(e.codigoUnico || '').trim()).filter(Boolean)));
        if (guia) {
          guiaId = guia.id;
          consecutivo = guia.consecutivo || null;
          camion = guia.camionId ? camionPorId.get(guia.camionId) : null;
          estado = guia.estado || null;
          reportadoPor = guia.responsableTransporte || guia.responsableCarga || null;
        } else if (traslado) {
          estado = traslado.estado || null;
          camion = traslado.camionId ? camionPorId.get(traslado.camionId) : null;
          reportadoPor = traslado.responsableEntrega || traslado.responsableTransporte
            || (traslado.creadoPorId ? (userPorId.get(traslado.creadoPorId)?.name ?? null) : null) || null;
        } else {
          const recepcion = mv.referencia_id ? recepcionPorId.get(mv.referencia_id) : null;
          if (recepcion) {
            estado = recepcion.estado || null;
            reportadoPor = recepcion.responsableRecepcion || null;
            motivoDiferencia = recepcion.motivoDiferencia ?? null;
            tipoDiferencia = recepcion.tipoDiferencia ?? null;
            diferencia = recepcion.diferencia ?? null;
            cantidadRecibida = recepcion.cantidadRecibida ?? null;
            cantidadEsperada = recepcion.cantidadEsperada ?? null;
          } else {
            const remision = mv.referencia_id ? remisionPorId.get(mv.referencia_id) : null;
            if (remision) {
              estado = remision.estado || null;
              reportadoPor = remision.responsable || null;
            }
          }
        }

        const correccionPeso = mv.tipo === 'Traslado' && mv.referencia_id ? correccionesPeso.get(mv.referencia_id) : null;
        const correccionPesoRemision = mv.tipo === 'Remisión' && mv.referencia_id ? correccionesPesoRemision.get(mv.referencia_id) : null;
        return {
          ...mv,
          ...(correccionPeso ? { cantidadOriginal: mv.cantidad, unidadOriginal: mv.unidad, cantidad: correccionPeso.cantidad, unidad: 'kg', pesoKgCorregido: true, fechaCorreccionPeso: correccionPeso.fecha } : {}),
          ...(correccionPesoRemision ? { cantidadOriginal: mv.cantidad, unidadOriginal: mv.unidad, cantidad: correccionPesoRemision.cantidad, unidad: 'kg', pesoKgCorregido: true, fechaCorreccionPeso: correccionPesoRemision.fecha } : {}),
          estado,
          reportadoPor,
          guiaId,
          consecutivo: consecutivo || remisionAsociada?.consecutivo || null,
          camionId: camion?.id ?? null,
          camionNombre: camion?.nombre ?? remisionAsociada?.transporte ?? null,
          transporte: remisionAsociada?.transporte ?? null,
          lotes,
          codigosEtiquetas,
          granjaOrigenId: (traslado && traslado.granjaOrigenId) || null,
          granjaOrigenNombre: (traslado && traslado.granjaOrigenId)
            ? (granjaPorId.get(traslado.granjaOrigenId)?.nombre ?? null)
            : (granjaRemision?.nombre ?? null),
          motivoDiferencia,
          tipoDiferencia,
          diferencia,
          cantidadRecibida,
          cantidadEsperada
        };
      });
      res.json(enriquecidos);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}


type HelpersStockBodega = {
  normalizarProducto: (nombre: string) => string;
  resolverVidaUtil: (producto: string, catalogo: any[]) => { vidaUtilDias: number; diasAvisoVencimiento: number };
  diasHastaVencimiento: (fecha?: string | null, ahora?: number) => number | null;
  estadoVencimiento: (dias: number | null, aviso: number) => string;
};

export function registrarRutaStockBodega(app: any, db: any, helpers: HelpersStockBodega, requirePermission: (...args: any[]) => any) {
  const { normalizarProducto, resolverVidaUtil, diasHastaVencimiento, estadoVencimiento } = helpers;
  const { etiquetas, inventario } = schema;
  // ==================== BODEGA — STOCK FEFO ====================
  // Fuente principal: etiquetas serializadas (un cartón = una etiqueta) con estado EnBodega.
  // Se expone además el inventario agregado de bodega (filas sin etiqueta) para no perder stock.
  app.get("/api/bodega/stock", requirePermission('inventario_bodega', 'view'), async (req, res) => {
    try {
      const [todasEtiquetas, inventarioRows, catalogo] = await Promise.all([
        db.select().from(etiquetas),
        db.select().from(inventario),
        db.select().from(schema.productosCatalogo),
      ]);

      const ahora = Date.now();
      const norm = (s: string) => normalizarProducto(s);

      const lotes = (todasEtiquetas as any[])
        .filter(e => e.estado === 'EnBodega')
        .map((e: any) => {
          const { vidaUtilDias, diasAvisoVencimiento } = resolverVidaUtil(e.producto, catalogo as any[]);
          const dias = diasHastaVencimiento(e.fechaVencimiento, ahora);
          return {
            tipo: 'etiqueta',
            id: e.id,
            codigoUnico: e.codigoUnico,
            producto: e.producto,
            tipoCarton: e.tipoCarton || (Number(e.cantidad) > 0 ? `Cartón de ${e.cantidad} huevos` : null),
            // Los productos en kg exponen el saldo físico del empaque. El
            // conteo de etiquetas sigue disponible como dato de trazabilidad.
            cantidad: e.unidad === 'kg'
              ? Number(e.saldoKg ?? e.pesoNeto ?? e.cantidad) || 0
              : 1,
            unidad: e.unidad || 'cartones',
            unidades: Number(e.cantidad) || 0,
            ubicacion: e.ubicacionActual || 'Bodega Central',
            lote: e.lote || null,
            clasificacion: e.clasificacion || null,
            fechaProduccion: e.fechaProduccion || null,
            fechaRecepcion: e.fechaRecepcion || null,
            fechaVencimiento: e.fechaVencimiento || null,
            dias,
            estado: estadoVencimiento(dias, diasAvisoVencimiento),
            vidaUtilDias,
            diasAvisoVencimiento,
          };
        });

      const inventarioAgregado = (inventarioRows as any[])
        .filter(i => String(i.ubicacion || '').toLowerCase().includes('bodega'))
        .map((i: any) => {
          const { vidaUtilDias, diasAvisoVencimiento } = resolverVidaUtil(i.producto, catalogo as any[]);
          const dias = diasHastaVencimiento(i.fecha_caducidad, ahora);
          return {
            tipo: 'agregado',
            id: i.id,
            codigoUnico: null,
            producto: i.producto,
            tipoCarton: null,
            cantidad: Number(i.cantidad) || 0,
            unidad: i.unidad || 'cartones',
            ubicacion: i.ubicacion,
            lote: i.lote || null,
            clasificacion: null,
            fechaProduccion: null,
            fechaRecepcion: null,
            fechaVencimiento: i.fecha_caducidad || null,
            dias,
            estado: estadoVencimiento(dias, diasAvisoVencimiento),
            vidaUtilDias,
            diasAvisoVencimiento,
          };
        });

      // Inventario agregado es el ledger de existencias; las etiquetas son una
      // partición de ese saldo. Restar lo ya etiquetado evita mostrarlo dos veces.
      const etiquetadoPorProductoUnidad = new Map<string, number>();
      for (const etiqueta of lotes) {
        const key = `${norm(etiqueta.producto)}||${etiqueta.unidad}`;
        etiquetadoPorProductoUnidad.set(key, (etiquetadoPorProductoUnidad.get(key) || 0) + etiqueta.cantidad);
      }
      const sinEtiquetar = inventarioAgregado.map(item => {
        const key = `${norm(item.producto)}||${item.unidad}`;
        const etiquetado = etiquetadoPorProductoUnidad.get(key) || 0;
        return { ...item, cantidad: Math.max(0, item.cantidad - etiquetado) };
      }).filter(item => item.cantidad > 0.0001);
      const todos = [...lotes, ...sinEtiquetar];
      // FEFO: primero vence primero sale; sin fecha al final. Desempate por fecha de recepción.
      const conFecha = todos.filter(x => x.dias !== null);
      const sinFecha = todos.filter(x => x.dias === null);
      conFecha.sort((a, b) => (a.dias! - b.dias!) || String(a.fechaRecepcion || a.fechaProduccion || '').localeCompare(String(b.fechaRecepcion || b.fechaProduccion || '')));
      const ordenPorProductoUnidad = new Map<string, number>();
      const colaFEFO = [...conFecha, ...sinFecha].map(x => {
        const productoKey = `${norm(x.producto) || String(x.producto).toLowerCase()}||${x.unidad || 'unidad no especificada'}`;
        const ordenFEFO = (ordenPorProductoUnidad.get(productoKey) || 0) + 1;
        ordenPorProductoUnidad.set(productoKey, ordenFEFO);
        return { ...x, ordenFEFO, productoKey };
      });

      // Agrupar por producto y unidad. No sumar kg con cartones: las filas
      // heredadas conservan su unidad hasta pesarse físicamente.
      const porProducto = new Map<string, any>();
      for (const item of colaFEFO) {
        const productoKey = norm(item.producto) || String(item.producto).toLowerCase();
        // La clave de grupo sigue identificando el producto como en el contrato
        // previo; la unidad se conserva en el grupo y separa los saldos mixtos.
        const key = productoKey;
        if (!porProducto.has(key)) {
          porProducto.set(key, {
            key,
            productoKey: key,
            producto: item.producto,
            unidad: item.unidad,
            total: 0,
            etiquetados: 0,
            agregado: 0,
            items: 0,
            lotes: 0,
            fechaVencimientoProxima: null,
            diasProximo: null,
            estado: 'sin-fecha',
            vidaUtilDias: item.vidaUtilDias,
            diasAvisoVencimiento: item.diasAvisoVencimiento,
          });
        }
        const g = porProducto.get(key)!;
        if (g.unidad !== item.unidad) {
          // Un mismo nombre puede aparecer en kg y cartones en datos heredados.
          // Nunca sumarlos: mantener grupos separados con clave estable por unidad.
          const unidadKey = `${productoKey}||${item.unidad || 'unidad no especificada'}`;
          if (!porProducto.has(unidadKey)) {
            porProducto.set(unidadKey, { ...g, key: unidadKey, productoKey: unidadKey, unidad: item.unidad, total: 0, etiquetados: 0, agregado: 0, items: 0, lotes: 0, fechaVencimientoProxima: null, diasProximo: null, estado: 'sin-fecha' });
          }
          const separado = porProducto.get(unidadKey)!;
          separado.total += item.cantidad;
          separado.items += 1;
          if (item.tipo === 'etiqueta') { separado.etiquetados += item.cantidad; separado.lotes += 1; }
          else separado.agregado += item.cantidad;
          if (separado.fechaVencimientoProxima === null && item.dias !== null) { separado.fechaVencimientoProxima = item.fechaVencimiento; separado.diasProximo = item.dias; separado.estado = item.estado; }
          continue;
        }
        g.total += item.cantidad;
        g.items += 1;
        if (item.tipo === 'etiqueta') { g.etiquetados += item.cantidad; g.lotes += 1; }
        else { g.agregado += item.cantidad; }
        if (g.fechaVencimientoProxima === null && item.dias !== null) {
          g.fechaVencimientoProxima = item.fechaVencimiento;
          g.diasProximo = item.dias;
          g.estado = item.estado;
        }
      }
      const productos = Array.from(porProducto.values())
        .sort((a, b) => {
          const rank: Record<string, number> = { vencido: 0, pronto: 1, ok: 2, 'sin-fecha': 3 };
          return (rank[a.estado] - rank[b.estado]) || (a.diasProximo ?? 1e9) - (b.diasProximo ?? 1e9) || a.producto.localeCompare(b.producto);
        });

      const kpis = (() => {
        // Realidad de bodega: lo que entró de granja menos lo que salió a ruta (ledger de inventario).
        const sumarPorUnidad = (items: any[]) => items.reduce((acc: Record<string, number>, item: any) => {
          const unidad = String(item.unidad || 'Unidad no especificada');
          acc[unidad] = (acc[unidad] || 0) + Number(item.cantidad || 0);
          return acc;
        }, {});
        const stockPorUnidad = sumarPorUnidad(inventarioAgregado);
        const etiquetadoPorUnidad = sumarPorUnidad(lotes);
        const porVencerPorUnidad = sumarPorUnidad(todos.filter(x => x.estado === 'pronto'));
        const vencidosPorUnidad = sumarPorUnidad(todos.filter(x => x.estado === 'vencido'));
        const unidades = [...new Set([...Object.keys(stockPorUnidad), ...Object.keys(etiquetadoPorUnidad)])];
        const unidadStock = unidades.length === 1 ? unidades[0] : (unidades.length ? 'unidades mixtas' : 'kg');
        const totalPorUnidad = (valores: Record<string, number>) => unidades.length <= 1 ? Number(Object.values(valores)[0] || 0) : null;
        const porEtiquetarPorUnidad = Object.fromEntries(unidades.map(unidad => [unidad,
          Math.max(0, Number(stockPorUnidad[unidad] || 0) - Number(etiquetadoPorUnidad[unidad] || 0)),
        ]));
        return {
          unidad: unidadStock,
          stockTotal: totalPorUnidad(stockPorUnidad),
          stockPorUnidad,
          etiquetados: totalPorUnidad(etiquetadoPorUnidad),
          etiquetadoPorUnidad,
          etiquetas: lotes.length,
          cartonesEtiquetados: totalPorUnidad(etiquetadoPorUnidad),
          porEtiquetar: totalPorUnidad(porEtiquetarPorUnidad),
          porEtiquetarPorUnidad,
          lotes: new Set(lotes.map(l => l.lote).filter(Boolean)).size,
          porVencer: totalPorUnidad(porVencerPorUnidad),
          porVencerPorUnidad,
          vencidos: totalPorUnidad(vencidosPorUnidad),
          vencidosPorUnidad,
          sinFecha: sinFecha.reduce((a, x) => a + x.cantidad, 0),
          proximoSalir: conFecha[0] ? {
            codigoUnico: conFecha[0].codigoUnico,
            producto: conFecha[0].producto,
            productoKey: `${norm(conFecha[0].producto) || String(conFecha[0].producto).toLowerCase()}||${conFecha[0].unidad || 'unidad no especificada'}`,
            unidad: conFecha[0].unidad || 'cartones',
            lote: conFecha[0].lote,
            cantidad: conFecha[0].cantidad,
            fechaVencimiento: conFecha[0].fechaVencimiento,
            dias: conFecha[0].dias,
          } : null,
        };
      })();

      res.json({ ubicacion: 'Bodega Central', generadoEn: new Date().toISOString(), kpis, productos, colaFEFO, inventarioAgregado, inventarioSinEtiquetar: sinEtiquetar });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });


}
