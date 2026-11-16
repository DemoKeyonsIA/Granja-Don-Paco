import { and, eq, inArray, ne } from 'drizzle-orm';
import * as schema from '../../../db/schema';
import { calcularOrdenRuta } from '../../services/logistica/orden-ruta';

export type CreacionGuiaDependencies = {
  app: any;
  db: any;
  nextGuiaDespachoConsecutivo: () => string;
  registrarPesoPunto: (opts: any) => Promise<void>;
  recordEvent: (...args: any[]) => Promise<void>;
  httpError: (res: any, error: any) => any;
  ApiError: new (status: number, message: string) => Error;
  requirePermission: (...args: any[]) => any;
};

/** Registra la creación transaccional de guías y recibe sus efectos laterales por inyección. */
export function registrarCreacionGuia({ app, db, nextGuiaDespachoConsecutivo, registrarPesoPunto, recordEvent, httpError, ApiError, requirePermission }: CreacionGuiaDependencies) {
  app.post("/api/logistica/guias", requirePermission(['carga_camion', 'rutas'], 'create'), async (req, res) => {
    try {
      const { camionId, rutaId, etiquetasIds, responsablesCarga, responsableTransporte, pesoSalida, vendedorId, clienteIds, colchonEtiquetaIds } = req.body;
      if (!camionId || !Array.isArray(etiquetasIds) || etiquetasIds.length === 0) {
        return res.status(400).json({ error: "Se requiere camionId y al menos una etiqueta para la guía" });
      }
      const camion = await db.query.camiones.findFirst({ where: eq(schema.camiones.id, camionId) });
      if (!camion) return res.status(400).json({ error: "Camión no encontrado" });
      if (vendedorId) {
        const vendedor = await db.query.users.findFirst({ where: eq(schema.users.id, vendedorId) });
        if (!vendedor || !['Vendedor', 'Comercial'].includes(vendedor.role)) {
          return res.status(400).json({ error: `Vendedor de ruta inválido: ${vendedor?.name || vendedorId} no es un vendedor` });
        }
      }

      let totalCartonesResumen = 0;
      let etiquetasParaTraza: any[] = [];
      let guiaIdRef: string | null = null;
      await db.transaction(async (tx) => {
        // 1. Un camión no puede tener 2 guías abiertas a la vez
        const guiaAbierta = await tx.query.guias_despacho.findFirst({
          where: and(
            eq(schema.guias_despacho.camionId, camionId),
            ne(schema.guias_despacho.estado, 'Cerrada'),
            ne(schema.guias_despacho.estado, 'Anulada')
          )
        });
        if (guiaAbierta) throw new ApiError(409, `El camión "${camion.nombre}" ya tiene una guía activa: ${guiaAbierta.consecutivo}`);

        // 2. Cargar etiquetas candidatas (solo estado EnBodega)
        const etiquetasCargar = await tx.query.etiquetas.findMany({
          where: and(
            inArray(schema.etiquetas.id, etiquetasIds),
            eq(schema.etiquetas.estado, 'EnBodega')
          )
        });
        const etiquetasSolicitadas = await tx.query.etiquetas.findMany({ where: inArray(schema.etiquetas.id, etiquetasIds) });
        if (etiquetasCargar.length !== etiquetasIds.length) {
          const noCargables = etiquetasSolicitadas.filter(e => e.estado !== 'EnBodega').map(e => `${e.codigoUnico} (${e.estado})`);
          throw new ApiError(400, `Etiquetas no cargables (deben estar EnBodega): ${noCargables.join(', ')}`);
        }
        const extraIds = Array.isArray(colchonEtiquetaIds) ? [...new Set(colchonEtiquetaIds.map(String))] : [];
        if (extraIds.some((id: string) => !etiquetasIds.includes(id))) {
          throw new ApiError(400, 'El colchón extra debe estar dentro de las etiquetas seleccionadas para esta guía');
        }
        const colchón = etiquetasCargar
          .filter((e: any) => extraIds.includes(e.id))
          .map((e: any) => ({ etiquetaId: e.id, producto: e.producto, unidad: 'kg', cantidad: Number(e.pesoNeto) || 0 }));

        // 3. La carga solo admite etiquetas pesadas en kg. No se convierten
        // conteos históricos de cartones ni se infiere un peso por empaque.
        const sinPesaje = etiquetasCargar.filter((e: any) => !(Number(e.pesoNeto ?? e.pesoBodega) > 0) || (e.pesoNeto != null && !e.pesoRegistradoEn) || (e.pesoNeto != null && !['Manual', 'Bascula'].includes(String(e.pesoOrigen))));
        if (sinPesaje.length) throw new ApiError(409, `Registre el peso neto real en kg antes de cargar: ${sinPesaje.map((e: any) => e.codigoUnico).join(', ')}`);
        const totalKg = etiquetasCargar.reduce((a, e: any) => a + Number(e.pesoNeto ?? e.pesoBodega), 0);
        totalCartonesResumen = totalKg;
        const capacidadKg = Number(camion.capacidad_cartones || 0);
        if (capacidadKg > 0 && totalKg > capacidadKg + 0.0001) {
          throw new ApiError(400, `Excede capacidad: la carga es de ${totalKg.toFixed(2)} kg y supera la capacidad del camión (${capacidadKg.toFixed(2)} kg).`);
        }
        // 4. Stock Bodega Central suficiente (no cargar más de lo que hay)
        const kgPorProducto = new Map<string, number>();
        for (const etiqueta of etiquetasCargar as any[]) kgPorProducto.set(etiqueta.producto, (kgPorProducto.get(etiqueta.producto) || 0) + Number(etiqueta.pesoNeto ?? etiqueta.pesoBodega));
        for (const [producto, cantidadKg] of kgPorProducto) {
          const stockBodega = await tx.query.inventario.findFirst({
            where: and(
              eq(schema.inventario.producto, producto),
              eq(schema.inventario.ubicacion, 'Bodega Central'),
              eq(schema.inventario.unidad, 'kg')
            )
          });
          if (!stockBodega || stockBodega.unidad !== 'kg' || stockBodega.cantidad < cantidadKg) {
            throw new ApiError(400, `Stock insuficiente o no confirmado en kg en Bodega Central para ${producto} (se requieren ${cantidadKg.toFixed(2)} kg)`);
          }
        }

        // 5. Orden de recorrido sugerido (nearest neighbor desde el centróide de la ruta)
        const ruta = rutaId ? await tx.query.rutas.findFirst({ where: eq(schema.rutas.id, rutaId) }) : undefined;
        let rutaOrdenJson: string | null = null;
        let idsClientesRuta: string[] = [];
        if (ruta?.cliente_ids) {
          try { idsClientesRuta = JSON.parse(ruta.cliente_ids); } catch { /* noop */ }
        }
        const idsSeleccionados = Array.isArray(clienteIds) && clienteIds.length ? clienteIds.map(String) : idsClientesRuta;
        const clientesSolicitados = idsSeleccionados.length
          ? await tx.query.clientes.findMany({ where: inArray(schema.clientes.id, idsSeleccionados) })
          : [];
        if (clientesSolicitados.length !== idsSeleccionados.length) throw new ApiError(400, 'Uno o más clientes seleccionados no existen');
        const clientesRuta = idsSeleccionados.length ? clientesSolicitados : [];
        rutaOrdenJson = calcularOrdenRuta(clientesRuta as any[], ruta);

        // 6. Crear guía + detalle
        const guiaId = crypto.randomUUID();
        guiaIdRef = guiaId;
        await tx.insert(schema.guias_despacho).values({
          id: guiaId,
          consecutivo: nextGuiaDespachoConsecutivo(),
          camionId,
          rutaId: rutaId || null,
          vendedorId: vendedorId || camion.vendedor_id || null,
          clientesIds: idsSeleccionados.length ? JSON.stringify(idsSeleccionados) : null,
          colchonExtraJson: colchón.length ? JSON.stringify(colchón) : null,
          fecha: new Date().toISOString(),
          horaCarga: new Date().toTimeString().slice(0, 8),
          responsableCarga: responsablesCarga || null,
          responsableTransporte: responsableTransporte || null,
          totalCartones: totalKg,
          totalKg,
          pesoSalida: pesoSalida != null ? Number(pesoSalida) : null,
          estado: 'Cargada',
          rutaOrdenJson
        });

        for (const etiqueta of etiquetasCargar as any[]) {
          await tx.insert(schema.guias_despacho_detalle).values({
            id: crypto.randomUUID(),
            guiaId,
            etiquetaId: etiqueta.id,
            producto: etiqueta.producto,
            cartones: Number(etiqueta.pesoNeto),
            cantidadKg: Number(etiqueta.pesoNeto),
            pesoAnden: etiqueta.pesoBruto || null,
            estadoSalida: 'checked'
          });

          // Marcar etiqueta Cargada + guía de despacho
          await tx.update(schema.etiquetas)
            .set({ estado: 'Cargada', ubicacionActual: camion.nombre, guiaDespachoId: guiaId, saldoKg: Number(etiqueta.pesoNeto) })
            .where(eq(schema.etiquetas.id, etiqueta.id));

          // Bodega → Camión (bloquear stock)
          const stockBodega = await tx.query.inventario.findFirst({
            where: and(
              eq(schema.inventario.producto, etiqueta.producto),
              eq(schema.inventario.ubicacion, 'Bodega Central'),
              eq(schema.inventario.unidad, 'kg')
            )
          });
          if (stockBodega) {
            await tx.update(schema.inventario)
              .set({ cantidad: stockBodega.cantidad - Number(etiqueta.pesoNeto), ultima_actualizacion: new Date().toISOString() })
              .where(eq(schema.inventario.id, stockBodega.id));
          }
          const camionStock = await tx.query.inventario.findFirst({
            where: and(
              eq(schema.inventario.producto, etiqueta.producto),
              eq(schema.inventario.ubicacion, camion.nombre),
              eq(schema.inventario.unidad, 'kg')
            )
          });
          if (camionStock) {
            await tx.update(schema.inventario)
            .set({ cantidad: camionStock.cantidad + Number(etiqueta.pesoNeto), ultima_actualizacion: new Date().toISOString() })
              .where(eq(schema.inventario.id, camionStock.id));
          } else {
            await tx.insert(schema.inventario).values({
              id: crypto.randomUUID(),
              producto: etiqueta.producto,
              cantidad: Number(etiqueta.pesoNeto),
              unidad: 'kg',
              ubicacion: camion.nombre,
              ultima_actualizacion: new Date().toISOString()
            });
          }
          await tx.insert(schema.movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: etiqueta.producto,
            cantidad: Number(etiqueta.pesoNeto),
            unidad: 'kg',
            tipo: 'Carga Camión',
            origen: 'Bodega Central',
            destino: camion.nombre,
            fecha: new Date().toISOString(),
            referencia_id: guiaId
          });

          etiquetasParaTraza.push({ etiquetaId: etiqueta.id, codigo: etiqueta.codigoUnico });
        }

        // 7. Punto de custodia con báscula: peso andén (esperado) vs peso de salida del camión
        if (pesoSalida != null && totalKg > 0) {
          const totalPesoAnden = totalKg;
          await registrarPesoPunto({
            cliente: tx,
            referenciaId: guiaId,
            tipoReferencia: 'Carga Camión',
            producto: (etiquetasCargar[0] as any)?.producto || 'Carga (mixto)',
            cantidadUnidades: totalKg,
            unidad: 'kg',
            pesoEsperado: totalPesoAnden,
            pesoReal: Number(pesoSalida),
            responsable: responsablesCarga,
            ubicacion: camion.nombre,
            observaciones: `Carga verificada de ${totalKg} kg; etiquetas pesadas manualmente`
          });
        }
      });

      // Traza por etiqueta (fuera de la transacción para evitar SQLITE_BUSY)
      for (const e of etiquetasParaTraza) {
        await recordEvent(e.etiquetaId, 'Cargada', camion.nombre, guiaIdRef, req.headers['x-user-id'] as string || 'system');
      }

      const colchonResumen = await db.query.guias_despacho.findFirst({ where: eq(schema.guias_despacho.id, guiaIdRef!) });
      const colchonExtra = colchonResumen?.colchonExtraJson ? JSON.parse(colchonResumen.colchonExtraJson) : [];
      res.status(201).json({ success: true, message: `Guía de despacho creada: ${totalCartonesResumen.toFixed(2)} kg`, totalKg: totalCartonesResumen, colchonKg: colchonExtra.reduce((s: number, x: any) => s + Number(x.cantidad || 0), 0), colchonPorProducto: colchonExtra });
    } catch (error: any) {
      httpError(res, error);
    }
  });
}
