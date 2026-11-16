import { and, eq, inArray, notInArray } from 'drizzle-orm';
import * as schema from '../../../db/schema';
import { resumenDineroVentasRuta } from '../../../lib/finanzasRuta';

type GuiaDetalleHelpers = {
  estadoLogicoGuia: (guia: any) => string;
  leerColchonExtra: (raw: any) => any[];
  round2: (value: number) => number;
  requirePermission: (...args: any[]) => any;
};

function agruparPor<T>(filas: T[], obtenerClave: (fila: T) => string | null | undefined): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const fila of filas) {
    const clave = obtenerClave(fila);
    if (!clave) continue;
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(fila);
    else grupos.set(clave, [fila]);
  }
  return grupos;
}

/** Registra la lectura de detalle de una guía de despacho y su contexto de ruta. */
export function registrarRutaDetalleGuia(app: any, db: any, helpers: GuiaDetalleHelpers) {
  const {
    estadoLogicoGuia,
    leerColchonExtra,
    round2,
    requirePermission,
  } = helpers;

  app.get('/api/logistica/guias/:id', requirePermission(['ventas', 'inventario_bodega'], 'view'), async (req: any, res: any) => {
    try {
      const guia = await db.query.guias_despacho.findFirst({ where: eq(schema.guias_despacho.id, req.params.id) });
      if (!guia) return res.status(404).json({ error: 'Guía no encontrada' });
      const roles = [req.usuario?.role, ...(req.usuario?.roles || [])].filter(Boolean);
      if (!roles.includes('Admin')) {
        const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(schema.camiones.id, guia.camionId) }) : null;
        if (!camion || (camion.camioneroId || camion.vendedor_id) !== req.usuario?.id) return res.status(403).json({ error: 'Solo puede consultar las guías de su camión asignado.' });
      }
      const [detalles, etiquetasData, camionesData, facturasData, rutasData, clientesData, cierreCaja] = await Promise.all([
        db.query.guias_despacho_detalle.findMany({ where: eq(schema.guias_despacho_detalle.guiaId, guia.id) }),
        db.query.etiquetas.findMany(),
        db.query.camiones.findMany(),
        db.query.facturas.findMany({ where: eq(schema.facturas.guiaId, guia.id) }),
        db.query.rutas.findMany(),
        db.query.clientes.findMany(),
        db.query.cierres_caja_ruta.findFirst({ where: eq(schema.cierres_caja_ruta.guiaId, guia.id) }).catch(() => null),
      ]);

      // Las tablas de ventas y retornos pueden faltar en bases demo/legacy.
      let ventasRutaData: any[] = [];
      let retornosRutaData: any[] = [];
      try { ventasRutaData = await db.query.ventas_ruta.findMany({ where: eq(schema.ventas_ruta.guiaId, guia.id) }); } catch { ventasRutaData = []; }
      try { ventasRutaData = [...ventasRutaData, ...(await db.query.ventas_ruta_kg.findMany({ where: eq(schema.ventas_ruta_kg.guiaId, guia.id) })).map((v: any) => ({ ...v, cantidadKg: Number(v.cantidadKg), cartones: Number(v.cantidadKg), precioUnitario: Number(v.precioKg), unidad: 'kg' }))]; } catch { /* tablas demo antiguas */ }
      try { retornosRutaData = await db.query.retornos_camion.findMany({ where: eq(schema.retornos_camion.guiaId, guia.id) }); } catch { retornosRutaData = []; }
      const gastosRuta = await db.query.gastos.findMany().catch(() => [] as any[]);
      const gastosEfectivoGuia = round2(gastosRuta
        .filter((g: any) => g.guiaId === guia.id && (g.medioPago || 'Efectivo') === 'Efectivo')
        .reduce((s: number, g: any) => s + Number(g.monto || 0), 0));
      const dineroRuta = resumenDineroVentasRuta(ventasRutaData, retornosRutaData);
      const camion = camionesData.find((c: any) => c.id === guia.camionId) || null;
      const detalleConEtiquetas = detalles.map((d: any) => {
        const etiqueta = etiquetasData.find((e: any) => e.id === d.etiquetaId);
        return {
          ...d,
          codigoUnico: etiqueta?.codigoUnico || null,
          estadoEtiqueta: etiqueta?.estado || null,
          lote: etiqueta?.lote || null,
          pesoBodega: etiqueta?.pesoBodega || null,
          pesoNeto: etiqueta?.pesoNeto || null,
          saldoKg: etiqueta?.saldoKg ?? etiqueta?.pesoNeto ?? null,
        };
      });

      // Si la guía no define paradas, se usa la ruta del camión y luego clientes activos.
      const rutaRec = guia.rutaId ? rutasData.find((r: any) => r.id === guia.rutaId) : null;
      let clienteIdsRuta: string[] = [];
      try {
        if (guia.clientesIds) clienteIdsRuta = JSON.parse(guia.clientesIds);
        else if (rutaRec?.cliente_ids) clienteIdsRuta = JSON.parse(rutaRec.cliente_ids);
      } catch { clienteIdsRuta = []; }
      let clientesRuta = clienteIdsRuta.length > 0
        ? clientesData.filter((c: any) => clienteIdsRuta.includes(c.id))
        : (camion?.ruta_defecto
          ? clientesData.filter((c: any) => c.ruta === camion.ruta_defecto)
          : clientesData);
      clientesRuta = clientesRuta.filter((c: any) => c.estado !== 'Inactivo');
      if (clientesRuta.length === 0) clientesRuta = clientesData.filter((c: any) => c.estado !== 'Inactivo');
      const ordenVisita = guia.rutaOrdenJson ? JSON.parse(guia.rutaOrdenJson) : [];
      const clientesRutaMap = clientesRuta
        .filter((c: any) => !(ordenVisita || []).some((o: any) => o.clienteId === c.id))
        .map((c: any) => ({
          clienteId: c.id,
          nombre: c.nombre,
          prioridad: c.prioridad || 'Normal',
          ventanaIni: c.ventana_entrega_ini,
          ventanaFin: c.ventana_entrega_fin,
        }));
      const ventas = ventasRutaData.map((v: any) => ({
        ventaId: v.id,
        tiqueteConsecutivo: v.tiqueteConsecutivo,
        producto: v.producto,
        cartones: Number(v.cartones),
        cantidadKg: Number(v.cantidadKg ?? v.cartones),
        unidad: v.unidad || 'cartones',
        total: Number(v.total),
        cobro: v.cobro,
        fechaHora: v.fechaHora,
        etiquetaId: v.etiquetaId || null,
        estado: v.estado,
      }));

      return res.json({
        ...guia,
        colchonExtra: leerColchonExtra(guia.colchonExtraJson),
        colchonCartones: leerColchonExtra(guia.colchonExtraJson).reduce((s: number, x: any) => s + Number(x.cantidad || 0), 0),
        estadoLogico: estadoLogicoGuia(guia),
        cierreCaja: cierreCaja || null,
        cajaResumen: { ...dineroRuta, gastosEfectivo: gastosEfectivoGuia, efectivoEsperado: round2(dineroRuta.efectivo - gastosEfectivoGuia) },
        camionNombre: camion?.nombre || guia.camionId || null,
        placa: camion?.placa || null,
        detalle: detalleConEtiquetas,
        facturas: facturasData,
        ventas,
        rutaOrden: ordenVisita,
        clientesRuta: [...ordenVisita, ...clientesRutaMap],
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });
}

/** Registra las rutas de consulta y transición operativa de guías. */
export function registrarRutasGuias(app: any, db: any, helpers: GuiaDetalleHelpers) {
  const { estadoLogicoGuia, leerColchonExtra, round2, requirePermission } = helpers;

  app.get('/api/logistica/guias', requirePermission(['ventas', 'inventario_bodega'], 'view'), async (_req: any, res: any) => {
    try {
      const roles = [_req.usuario?.role, ...(_req.usuario?.roles || [])].filter(Boolean);
      let guiasVisibles: any[];
      let camionesData: any[];
      if (roles.includes('Admin')) {
        [guiasVisibles, camionesData] = await Promise.all([
          db.query.guias_despacho.findMany({ orderBy: schema.guias_despacho.fecha }),
          db.query.camiones.findMany(),
        ]);
      } else {
        camionesData = await db.query.camiones.findMany();
        const asignados = camionesData.filter((c: any) => (c.camioneroId || c.vendedor_id) === _req.usuario?.id).map((c: any) => String(c.id));
        if (asignados.length === 0) return res.json([]);
        guiasVisibles = await db.query.guias_despacho.findMany({
          where: inArray(schema.guias_despacho.camionId, asignados),
          orderBy: schema.guias_despacho.fecha,
        });
      }
      if (guiasVisibles.length === 0) return res.json([]);
      const rutasData = await db.query.rutas.findMany();
      const guiaIds = guiasVisibles.map((g: any) => g.id);
      const [detalles, etiquetasData, facturasData, ventasLegacy, ventasKg] = await Promise.all([
        db.query.guias_despacho_detalle.findMany({ where: inArray(schema.guias_despacho_detalle.guiaId, guiaIds) }),
        db.query.etiquetas.findMany({ where: inArray(schema.etiquetas.guiaDespachoId, guiaIds) }),
        db.query.facturas.findMany({ where: inArray(schema.facturas.guiaId, guiaIds) }),
        db.query.ventas_ruta.findMany({ where: inArray(schema.ventas_ruta.guiaId, guiaIds) }).catch(() => [] as any[]),
        db.query.ventas_ruta_kg.findMany({ where: inArray(schema.ventas_ruta_kg.guiaId, guiaIds) }).catch(() => [] as any[]),
      ]);
      const facturaIds = facturasData.map((f: any) => f.id);
      const detallesFacturaData = facturaIds.length > 0
        ? await db.query.detallesFactura.findMany({ where: inArray(schema.detallesFactura.facturaId, facturaIds) })
        : [];
      const ventasRutaData = [
        ...ventasLegacy,
        ...ventasKg.map((v: any) => ({ ...v, cartones: Number(v.cantidadKg), unidad: 'kg' })),
      ];
      const detallesPorGuia = agruparPor(detalles as any[], (d: any) => d.guiaId);
      const etiquetasPorGuia = agruparPor((etiquetasData as any[]).filter((e: any) => e.estado === 'Entregada'), (e: any) => e.guiaDespachoId);
      const facturasPorGuia = agruparPor(facturasData as any[], (f: any) => f.guiaId);
      const ventasPorGuia = agruparPor(ventasRutaData as any[], (v: any) => v.guiaId);
      const detallesPorFactura = agruparPor(detallesFacturaData as any[], (d: any) => d.facturaId);
      const resumen = guiasVisibles.map((g: any) => {
        const camion = camionesData.find((c: any) => c.id === g.camionId) || null;
        const detallesGuia = detallesPorGuia.get(g.id) || [];
        const tiquetesGuia = (ventasPorGuia.get(g.id) || []).filter((v: any) => v.estado === 'Emitida');
        const vendido = tiquetesGuia.length > 0
          ? tiquetesGuia.reduce((acc: number, v: any) => acc + Number(v.cartones), 0)
          : (facturasPorGuia.get(g.id) || [])
            .reduce((acc: number, f: any) => acc + (detallesPorFactura.get(f.id) || []).reduce((a: number, d: any) => a + Number(d.cantidad), 0), 0);
        const entregadas = (etiquetasPorGuia.get(g.id) || []).length;
        const colchonExtra = leerColchonExtra(g.colchonExtraJson);
        return {
          ...g,
          colchonExtra,
          colchonCartones: colchonExtra.reduce((s: number, x: any) => s + Number(x.cantidad || 0), 0),
          estadoLogico: estadoLogicoGuia(g),
          camionNombre: camion?.nombre || g.camionId || null,
          rutaNombre: rutasData.find((r: any) => r.id === g.rutaId)?.nombre || g.rutaNombre || camion?.ruta_defecto || (camion?.nombre ? `Ruta de ${camion.nombre}` : 'Ruta sin asignar'),
          placa: camion?.placa || null,
          totalEtiquetas: detallesGuia.length,
          totalVendido: vendido,
          totalVendidoKg: vendido,
          avance: g.totalCartones > 0 ? Math.round((vendido / g.totalCartones) * 100) : 0,
          entregadas,
        };
      });
      return res.json(resumen);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/logistica/guias-activas', requirePermission(['ventas', 'inventario_bodega'], 'view'), async (req: any, res: any) => {
    try {
      const roles = [req.usuario?.role, ...(req.usuario?.roles || [])].filter(Boolean);
      const camionesData = await db.query.camiones.findMany();
      const administrador = roles.includes('Admin');
      const camionesAsignados: string[] | null = administrador ? null : camionesData.filter((c: any) => (c.camioneroId || c.vendedor_id) === req.usuario?.id).map((c: any) => String(c.id));
      if (camionesAsignados !== null && camionesAsignados.length === 0) return res.json([]);
      const condicion = camionesAsignados === null
        ? notInArray(schema.guias_despacho.estado, ['Cerrada', 'Anulada'])
        : and(notInArray(schema.guias_despacho.estado, ['Cerrada', 'Anulada']), inArray(schema.guias_despacho.camionId, camionesAsignados));
      const activas = await db.query.guias_despacho.findMany({ where: condicion });
      if (activas.length === 0) return res.json([]);
      const guiaIds = activas.map((g: any) => g.id);
      const detallesData = await db.query.guias_despacho_detalle.findMany({ where: inArray(schema.guias_despacho_detalle.guiaId, guiaIds) });
      const detallesPorGuia = agruparPor(detallesData as any[], (d: any) => d.guiaId);
      return res.json(activas.map((g: any) => {
        const camion = camionesData.find((c: any) => c.id === g.camionId) || null;
        const colchonExtra = leerColchonExtra(g.colchonExtraJson);
        return {
          ...g,
          colchonExtra,
          colchonCartones: colchonExtra.reduce((s: number, x: any) => s + Number(x.cantidad || 0), 0),
          estadoLogico: estadoLogicoGuia(g),
          camionNombre: camion?.nombre || g.camionId || null,
          totalEtiquetas: (detallesPorGuia.get(g.id) || []).length,
        };
      }));
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  registrarRutaDetalleGuia(app, db, { estadoLogicoGuia, leerColchonExtra, round2, requirePermission });

  app.post('/api/logistica/guias/:id/marcar-en-ruta', requirePermission('carga', 'approve'), async (req: any, res: any) => {
    try {
      const guia = await db.query.guias_despacho.findFirst({ where: eq(schema.guias_despacho.id, req.params.id) });
      if (!guia) return res.status(404).json({ error: 'Guía no encontrada' });
      const roles = [req.usuario?.role, ...(req.usuario?.roles || [])].filter(Boolean);
      if (!roles.includes('Admin')) {
        const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(schema.camiones.id, guia.camionId) }) : null;
        if (!camion || (camion.camioneroId || camion.vendedor_id) !== req.usuario?.id) return res.status(403).json({ error: 'Solo puede iniciar la ruta de una guía asignada a su camión.' });
      }
      if (guia.estado !== 'Cargada') return res.status(400).json({ error: `Solo una guía Cargada puede pasar a EnRuta (estado actual: ${guia.estado})` });
      await db.update(schema.guias_despacho).set({ estado: 'EnRuta', recibidoEn: new Date().toISOString() }).where(eq(schema.guias_despacho.id, guia.id));
      return res.json({ success: true, message: 'Guía marcada EnRuta' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });
}
