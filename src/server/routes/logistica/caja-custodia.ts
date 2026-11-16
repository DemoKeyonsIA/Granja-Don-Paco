import { and, eq, inArray, ne, notInArray } from 'drizzle-orm';
import * as schema from '../../../db/schema';
import { calcularCuadreIntegral } from '../../../lib/cuadre-integral';
import { productoCatalogoPara } from '../../../lib/kilos';
import { factorKilos } from '../../../lib/kilos';
import { resumenDineroVentasRuta } from '../../../lib/finanzasRuta';
import { clienteDisponibleParaUsuario } from '../../clientes-scope';

/** Caja de ruta, custodia, aceptación de retornos, cuadre y tablero logístico. */
export function registrarRutasCajaCustodia(
  app: any,
  db: any,
  helpers: {
    ApiError: new (status: number, message: string) => Error;
    httpError: (res: any, error: any) => any;
    recordEvent: (...args: any[]) => Promise<void>;
    recordEventTx: (...args: any[]) => Promise<void>;
    registrarPesoPunto: (opts: any) => Promise<void>;
    getPrecioParaProducto: (...args: any[]) => Promise<any>;
    requirePermission: (...args: any[]) => any;
    logAudit: (...args: any[]) => Promise<void>;
    round2: (value: number) => number;
    estadoLogicoGuia: (guia: any) => string;
    testMode: boolean;
  },
) {
  const { ApiError, httpError, recordEvent, recordEventTx, registrarPesoPunto, getPrecioParaProducto, requirePermission, logAudit, round2, estadoLogicoGuia } = helpers;
  const { facturas, inventario, cierres_caja_ruta, movimientosInventario, clientes, etiquetas, desperdicios, aprobaciones, traza_etiqueta, camiones, rutas, guias_despacho, guias_despacho_detalle, consecutivos, ventas_ruta, ventas_ruta_kg, retornos_camion } = schema;

  app.get('/api/logistica/ventas-ruta/historico', requirePermission('tablero_operativo', 'view'), async (_req: any, res: any) => {
    try {
      const [legacy, enKg, guiasData, camionesData, rutasData, clientesData, usuariosData] = await Promise.all([
        db.query.ventas_ruta.findMany().catch(() => [] as any[]),
        db.query.ventas_ruta_kg.findMany().catch(() => [] as any[]),
        db.query.guias_despacho.findMany(),
        db.query.camiones.findMany(),
        db.query.rutas.findMany(),
        db.query.clientes.findMany(),
        db.query.users.findMany(),
      ]);
      const porId = (items: any[]) => new Map(items.map((item: any) => [item.id, item]));
      const guiasPorId = porId(guiasData), camionesPorId = porId(camionesData), rutasPorId = porId(rutasData);
      const clientesPorId = porId(clientesData), usuariosPorId = porId(usuariosData);
      const ventas = [
        ...legacy.map((v: any) => ({ ...v, cantidad: Number(v.cantidadKg ?? v.cartones ?? 0), unidad: v.unidad || 'kg', precioUnitario: Number(v.precioUnitario || 0) })),
        ...enKg.map((v: any) => ({ ...v, cantidad: Number(v.cantidadKg || 0), unidad: 'kg', precioUnitario: Number(v.precioKg || 0) })),
      ].map((v: any) => {
        const guia = guiasPorId.get(v.guiaId);
        const camion = camionesPorId.get(v.camionId || guia?.camionId);
        const cliente = clientesPorId.get(v.clienteId);
        const vendedor = usuariosPorId.get(v.vendedorId || guia?.vendedorId || camion?.camioneroId || camion?.vendedor_id);
        const ruta = rutasPorId.get(guia?.rutaId);
        return {
          id: v.id,
          tiqueteConsecutivo: v.tiqueteConsecutivo,
          fechaHora: v.fechaHora,
          guiaId: v.guiaId,
          guiaConsecutivo: guia?.consecutivo || 'Guía sin consecutivo',
          rutaNombre: ruta?.nombre || camion?.ruta_defecto || (camion?.nombre ? `Ruta de ${camion.nombre}` : 'Ruta sin asignar'),
          camionNombre: camion?.nombre || 'Camión sin asignar',
          vendedorNombre: vendedor?.name || 'Vendedor no asignado',
          clienteId: v.clienteId,
          clienteNombre: cliente?.nombre || 'Cliente no registrado',
          producto: v.producto,
          cantidad: v.cantidad,
          unidad: v.unidad,
          precioUnitario: v.precioUnitario,
          subtotal: Number(v.subtotal || 0),
          descuento: Number(v.descuento || 0),
          total: Number(v.total || 0),
          cobro: v.cobro || '—',
          estado: v.estado || 'Emitida',
        };
      }).sort((a: any, b: any) => String(b.fechaHora || '').localeCompare(String(a.fechaHora || '')));
      return res.json(ventas);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'No se pudo cargar el historial de ventas en ruta.' });
    }
  });

  app.post("/api/logistica/caja/venta", requirePermission(['ventas', 'facturacion'], 'create'), async (req, res) => {
    try {
      const { guiaId, clienteId, etiquetaId, producto, precioUnitario, descuento, cobro } = req.body;
      const cantidadKg = Number(req.body?.cantidadKg ?? req.body?.cantidad);
      const usuarioId = String(req.usuario?.id || '');

      if (!guiaId) return res.status(400).json({ error: "Se requiere guiaId (caja en ruta)" });
      if (!producto || !Number.isFinite(cantidadKg) || cantidadKg <= 0) {
        return res.status(400).json({ error: "Se requiere producto y cantidad en kg mayor a cero" });
      }

      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      if (guia.estado === 'Cerrada' || guia.estado === 'Anulada') {
        return res.status(409).json({ error: `La guía está ${guia.estado.toLowerCase()} — no se pueden registrar ventas` });
      }
      if (guia.finDiaFecha) return res.status(409).json({ error: 'El día ya fue cerrado por esta guía. Las ventas están bloqueadas hasta resolver el cuadre en central.' });
      const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
      if (!camion) return res.status(400).json({ error: "La guía no tiene camión asignado" });
      if (!etiquetaId) return res.status(400).json({ error: 'Seleccione la etiqueta/lote físico del que se entregarán los kilos.' });
      const etiquetaSeleccionada = await db.query.etiquetas.findFirst({ where: eq(etiquetas.id, etiquetaId) });
      if (!etiquetaSeleccionada || etiquetaSeleccionada.guiaDespachoId !== guia.id || etiquetaSeleccionada.estado !== 'Cargada') {
        return res.status(409).json({ error: 'La etiqueta seleccionada no pertenece a esta guía o ya no está disponible.' });
      }
      const saldoEtiquetaKg = Number(etiquetaSeleccionada.saldoKg ?? etiquetaSeleccionada.pesoNeto ?? 0);
      if (saldoEtiquetaKg < cantidadKg) return res.status(409).json({ error: `La etiqueta solo tiene ${saldoEtiquetaKg.toFixed(2)} kg disponibles.` });
      if (etiquetaSeleccionada.producto !== producto) return res.status(409).json({ error: 'El producto de la etiqueta no coincide con el producto de la venta.' });
      const roles = [req.usuario?.role, ...(req.usuario?.roles || [])].filter(Boolean);
      if (!roles.includes('Admin') && (camion.camioneroId || camion.vendedor_id) !== usuarioId) return res.status(403).json({ error: 'Solo puede vender desde la guía de su camión asignado.' });

      // La venta queda atribuida a quien inició sesión; no se acepta un vendedor
      // diferente desde el body.
      const vendedorEfectivo = usuarioId;

      // El servidor resuelve la banda vigente; el vendedor puede proponer dentro
      // de ella, pero nunca modificar el precio por fuera del piso/techo.
      const clientePrecio = clienteId ? await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId) }) : null;
      if (clienteId && !await clienteDisponibleParaUsuario(db, req.usuario, String(clienteId))) return res.status(403).json({ error: 'Este cliente no pertenece a las rutas que tiene asignadas.' });
      const catalogoVenta = await db.query.productosCatalogo.findMany();
      const productoVenta: any = productoCatalogoPara(producto, catalogoVenta);
      if (!productoVenta || productoVenta.estado !== 'Activo') return res.status(409).json({ error: 'El producto no está activo en el catálogo.' });
      if (productoVenta.unidad !== 'kg') return res.status(409).json({ error: `El inventario de ${producto} todavía está registrado en ${productoVenta.unidad}. Registre el peso neto real en kg antes de vender.` });
      const cantidadOrigen = cantidadKg;
      const politicaPrecio = await getPrecioParaProducto(producto, clienteId, clientePrecio?.ruta || null);
      if (!politicaPrecio) return res.status(409).json({ error: `No hay precio autorizado para ${producto}. Consulte al administrador.` });
      const precioLista = Number(politicaPrecio.precio);
      const precio = precioUnitario == null ? precioLista : Number(precioUnitario);
      const precioMinimo = Number(politicaPrecio.precioMinimo);
      const precioMaximo = Number(politicaPrecio.precioMaximo);
      if (!Number.isFinite(precio) || precio < precioMinimo - 0.01 || precio > precioMaximo + 0.01) {
        return res.status(409).json({ error: `Precio fuera del rango autorizado. Puede vender entre ₡${precioMinimo.toLocaleString('es-CR')} y ₡${precioMaximo.toLocaleString('es-CR')} (${politicaPrecio.listaUsada}).` });
      }
      const subtotal = cantidadKg * precio;
      const descuentoNum = Number(descuento || 0);
      // El descuento monetario no puede llevar el precio efectivo por unidad
      // debajo del piso, incluyendo una negociación manual dentro de la banda.
      const descuentoPorPiso = Math.max(0, subtotal - cantidadKg * precioMinimo);
      const descuentoPorPorcentaje = Math.max(0, subtotal * Math.max(0, Number(politicaPrecio.descuentoMaximo || 0)) / 100);
      const descuentoMaximo = Math.min(descuentoPorPiso, descuentoPorPorcentaje);
      if (!Number.isFinite(descuentoNum) || descuentoNum < 0 || descuentoNum - descuentoMaximo > 0.01) {
        return res.status(409).json({ error: `Descuento fuera del rango autorizado. Máximo permitido: ₡${Math.floor(descuentoMaximo).toLocaleString('es-CR')}.` });
      }
      const total = subtotal - descuentoNum;
      if (total < 0) return res.status(400).json({ error: "El descuento no puede superar el subtotal" });
      const cobroFinal = ['Credito', 'Transferencia'].includes(String(cobro)) ? String(cobro) : 'Efectivo';
      const resolucionPrecio = {
        version: 1, resueltoEn: new Date().toISOString(), producto, unidad: 'kg',
        precioObjetivo: politicaPrecio.precio, precioAplicado: precio,
        precioMinimo, precioMaximo, descuentoMaximoPct: politicaPrecio.descuentoMaximo,
        regla: politicaPrecio.listaUsada,
      };

      let tiquete = '';
      let ventaId = '';
      const etiquetasEntregadas: { etiquetaId: string }[] = [];
      await db.transaction(async (tx) => {
        // 1. Stock del camión de la guía
        const camionStock = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, camion.nombre), eq(inventario.unidad, 'kg'))
        });
        if (!camionStock || camionStock.unidad !== 'kg') {
          throw new ApiError(409, `El saldo de ${producto} en el camión no está confirmado en kg. Pese y registre el inventario antes de vender.`);
        }
        if (Number(camionStock.cantidad) < cantidadOrigen) {
          throw new ApiError(400, `Stock insuficiente en ${camion.nombre} para ${producto} (disponible: ${camionStock?.cantidad ?? 0})`);
        }
        if (camionStock.unidad !== productoVenta.unidad) throw new ApiError(409, `La unidad del inventario (${camionStock.unidad}) no coincide con la unidad del catálogo (${productoVenta.unidad}). Corrija los datos antes de vender.`);

        // 2. Tiquete consecutivo por camión (transacción antidups)
        let nextNum = 1;
        let seqId: string | null = null;
        const seq = await tx.query.consecutivos.findFirst({
          where: and(eq(consecutivos.tipo, 'TIQUETE'), eq(consecutivos.entidad, camion.id))
        });
        if (seq) {
          seqId = seq.id;
          nextNum = Number(seq.ultimo) + 1;
          if (nextNum > Number(seq.rangoHasta)) throw new ApiError(409, `Rango de tiquetes agotado para ${camion.nombre}`);
        } else {
          // Rango disjunto por camión para que el consecutivo sea globalmente único
          const todosSeq = await tx.query.consecutivos.findMany({ where: eq(consecutivos.tipo, 'TIQUETE') });
          const maxHasta = todosSeq.reduce((m: number, r: any) => Math.max(m, Number(r.rangoHasta) || 0), 0);
          const desde = maxHasta + 1;
          const nid = crypto.randomUUID();
          seqId = nid;
          await tx.insert(consecutivos).values({
            id: nid,
            tipo: 'TIQUETE',
            entidad: camion.id,
            prefijo: 'TQ',
            rangoDesde: desde,
            rangoHasta: desde + 5000,
            ultimo: desde - 1
          });
          nextNum = desde;
        }
        await tx.update(consecutivos).set({ ultimo: nextNum }).where(eq(consecutivos.id, seqId));
        tiquete = `TQ-${String(nextNum).padStart(4, '0')}`;

        // 3. Registrar venta en ruta
        ventaId = crypto.randomUUID();
        await tx.insert(ventas_ruta_kg).values({
          id: ventaId,
          tiqueteConsecutivo: tiquete,
          camionId: camion.id,
          guiaId: guia.id,
          vendedorId: vendedorEfectivo,
          fechaHora: new Date().toISOString(),
          clienteId: clienteId || null,
          etiquetaId,
          producto,
          cantidadKg,
          cantidadInventario: cantidadOrigen,
          unidadInventario: productoVenta.unidad,
          precioKg: precio,
          subtotal,
          descuento: descuentoNum,
          total,
          cobro: cobroFinal,
          estado: 'Emitida',
          facturaId: null,
          resolucionPrecioJson: JSON.stringify(resolucionPrecio),
        });

        // 4. Descontar inventario del camión
        await tx.update(inventario)
          .set({ cantidad: Number(camionStock.cantidad) - cantidadOrigen, ultima_actualizacion: new Date().toISOString() })
          .where(eq(inventario.id, camionStock.id));

        // 5. Movimiento de inventario
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto,
          cantidad: cantidadOrigen,
          unidad: productoVenta.unidad,
          tipo: 'Venta',
          origen: camion.nombre,
          destino: clienteId ? 'Cliente' : 'Venta',
          fecha: new Date().toISOString(),
          referencia_id: ventaId
        });

        // El saldo medido en kg es independiente de la cantidad histórica de
        // empaques; la etiqueta se entrega al cliente cuando llega a cero.
        const etiquetaActual = await tx.query.etiquetas.findFirst({ where: eq(etiquetas.id, etiquetaId) });
        const restanteEtiquetaKg = Number(etiquetaActual?.saldoKg ?? etiquetaActual?.pesoNeto ?? 0) - cantidadKg;
        if (!etiquetaActual || restanteEtiquetaKg < -0.001) throw new ApiError(409, 'El saldo en kg de la etiqueta cambió; actualice la venta e intente de nuevo.');
        if (restanteEtiquetaKg <= 0.001) {
          await tx.update(etiquetas).set({ saldoKg: 0, estado: 'Entregada', ubicacionActual: camion.nombre }).where(eq(etiquetas.id, etiquetaActual.id));
          etiquetasEntregadas.push({ etiquetaId: etiquetaActual.id });
        } else {
          await tx.update(etiquetas).set({ saldoKg: restanteEtiquetaKg, ubicacionActual: camion.nombre }).where(eq(etiquetas.id, etiquetaActual.id));
        }

        // 7. Crédito: sumar saldo y validar límite
        if (cobroFinal === 'Credito' && clienteId) {
          const cliente = await tx.query.clientes.findFirst({ where: eq(clientes.id, clienteId) });
          if (cliente) {
            const nuevoSaldo = Number(cliente.saldo_pendiente || 0) + total;
            const limite = Number(cliente.limite_credito || 0);
            if (limite > 0 && nuevoSaldo > limite) {
              throw new ApiError(400, `Cliente excede límite de crédito. Saldo actual: ${cliente.saldo_pendiente}, Límite: ${limite}, Total tiquete: ${total}`);
            }
            await tx.update(clientes).set({ saldo_pendiente: nuevoSaldo }).where(eq(clientes.id, clienteId));
          }
        }
      });

      // Trazas + auditoría (fuera de la transacción para evitar SQLITE_BUSY)
      for (const e of etiquetasEntregadas) {
        await recordEvent(e.etiquetaId, 'Entregada', camion.nombre, guia.id, usuarioId);
      }
      await logAudit(usuarioId, 'Crear', 'VentaRuta', ventaId, null, { tiquete, producto, cantidadKg, cantidadInventario: cantidadOrigen, total, cobro: cobroFinal });

      res.status(201).json({
        success: true,
        ventaId,
        tiqueteConsecutivo: tiquete,
        fechaHora: new Date().toISOString(),
        cliente: clientePrecio ? {
          nombre: clientePrecio.nombre,
          documentoId: clientePrecio.documento_id || '',
          telefono: clientePrecio.telefono || '',
          direccion: clientePrecio.direccion || '',
          distrito: clientePrecio.distrito || '',
          canton: clientePrecio.canton || '',
          provincia: clientePrecio.provincia || '',
        } : { nombre: 'Consumidor Final' },
        camionNombre: camion.nombre,
        placa: camion.placa || '',
        guiaConsecutivo: guia.consecutivo || '',
        vendedorNombre: String(req.usuario?.name || ''),
        producto,
        cantidadKg,
        unidad: 'kg',
        precioUnitario: precio,
        subtotal,
        descuento: descuentoNum,
        cobro: cobroFinal,
        descuentoMaximoPct: Number(politicaPrecio.descuentoMaximo || 0),
        listaPrecio: politicaPrecio.listaUsada,
        resolucionPrecio,
        precioMinimo,
        precioMaximo,
        etiquetaId: etiquetaId || null,
        total
      });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  app.post("/api/logistica/caja/devolucion", requirePermission('ventas', 'create'), async (req, res) => {
    try {
      const { guiaId, etiquetaId, ventaRutaId, responsable, peso } = req.body;
      const cantidadSolicitada = req.body?.cantidadKg ?? req.body?.cartones ?? req.body?.cantidad;
      const usuarioId = String(req.usuario?.id || '');

      if (!guiaId || !etiquetaId) {
        return res.status(400).json({ error: "Se requiere guiaId y etiquetaId para la devolución" });
      }
      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      if (guia.estado === 'Cerrada' || guia.estado === 'Anulada') {
        return res.status(400).json({ error: `La guía está ${guia.estado.toLowerCase()} — no se pueden registrar retornos` });
      }
      const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
      const roles = [req.usuario?.role, ...(req.usuario?.roles || [])].filter(Boolean);
      if (!roles.includes('Admin') && (!camion || (camion.camioneroId || camion.vendedor_id) !== usuarioId)) return res.status(403).json({ error: 'Solo puede registrar retornos de la guía de su camión asignado.' });
      const etiqueta = await db.query.etiquetas.findFirst({ where: eq(etiquetas.id, etiquetaId) });
      if (!etiqueta) return res.status(404).json({ error: "Etiqueta no encontrada" });
      const guiaEnKg = guia.totalKg != null;
      const catalogoRetorno = await db.query.productosCatalogo.findMany();
      const productoRetorno = productoCatalogoPara(etiqueta.producto, catalogoRetorno);
      const factorRetorno = productoRetorno?.unidad === 'kg' ? 1 : factorKilos(productoRetorno?.kgPorCarton);
      const cantidadSolicitadaOrigen = cantidadSolicitada == null ? null : Number(cantidadSolicitada);
      if (req.body?.cantidadKg != null && productoRetorno?.unidad !== 'kg') return res.status(409).json({ error: 'El inventario de este producto todavía no está confirmado en kg. Bodega debe pesar el retorno antes de aceptarlo.' });

      // Defensa contra doble POST: la etiqueta solo se devuelve si aún no regresó
      if (etiqueta.estado === 'Retornada' || etiqueta.estado === 'EnBodega') {
        return res.status(400).json({ error: `La etiqueta ${etiqueta.codigoUnico} ya está ${etiqueta.estado.toLowerCase()} — no se puede devolver dos veces` });
      }
      if (etiqueta.guiaDespachoId && etiqueta.guiaDespachoId !== guia.id) {
        return res.status(400).json({ error: `La etiqueta pertenece a otra guía de despacho` });
      }

      // Si viene ventaRutaId, la devolución revierte UNA venta y sus cartones exactos:
      // - Venta completa → la etiqueta quedó Entregada con su cantidad íntegra.
      // - Venta parcial   → la etiqueta quedó Cargada con el restante (cantidad ya reducida),
      //   así que se devuelven los cartones VENDIDOS y se restaura la cantidad original.
      let venta: any = null;
      if (ventaRutaId) {
        venta = await db.query.ventas_ruta.findFirst({ where: eq(ventas_ruta.id, ventaRutaId) });
        if (!venta) {
          const nueva = await db.query.ventas_ruta_kg.findFirst({ where: eq(ventas_ruta_kg.id, ventaRutaId) });
          if (nueva) venta = { ...nueva, cantidadKg: Number(nueva.cantidadKg), precioUnitario: Number(nueva.precioKg), cartones: Number(nueva.cantidadKg), unidad: 'kg', tablaKg: true };
        }
        if (!venta) return res.status(404).json({ error: "Tiquete no encontrado" });
        if (venta.guiaId !== guia.id) return res.status(400).json({ error: "El tiquete no pertenece a esta guía" });
        if (venta.estado !== 'Emitida') return res.status(400).json({ error: `El tiquete ya está ${venta.estado.toLowerCase()}` });
        if (venta.etiquetaId && venta.etiquetaId !== etiqueta.id) return res.status(400).json({ error: "El tiquete no corresponde a esta etiqueta" });
      }

      const retornosPrevios = venta ? await db.query.retornos_camion.findMany({ where: eq(retornos_camion.ventaRutaId, venta.id) }) : [];
      const cantidadYaDevuelta = retornosPrevios.reduce((s: number, r: any) => s + Number(r.cartones || 0), 0);
      const saldoVenta = venta ? Math.max(0, Number(venta.cartones) - cantidadYaDevuelta) : 0;
      const unidadRetorno = guiaEnKg ? 'kg' : 'cartones';
      const saldoFisicoEtiqueta = guiaEnKg ? Number(etiqueta.saldoKg ?? etiqueta.pesoNeto ?? 0) : Number(etiqueta.cantidad);
      const cartonesRetorno = venta
        ? (cantidadSolicitadaOrigen == null ? saldoVenta : Number(cantidadSolicitadaOrigen))
        : (cantidadSolicitadaOrigen == null ? saldoFisicoEtiqueta : Number(cantidadSolicitadaOrigen));
      if (cartonesRetorno <= 0) return res.status(400).json({ error: `Cantidad de retorno en ${unidadRetorno} no válida` });
      if (!Number.isFinite(cartonesRetorno) || (venta && cartonesRetorno > saldoVenta) || (!venta && cartonesRetorno > saldoFisicoEtiqueta)) {
        return res.status(400).json({ error: `La cantidad debe estar dentro del saldo disponible (${venta ? saldoVenta : saldoFisicoEtiqueta} ${unidadRetorno})` });
      }

      // Restaurar la cantidad de la etiqueta a la íntegra del cartón físico que regresa
      const cantidadRestaurada = !venta
        ? Number(etiqueta.cantidad)
        : etiqueta.estado === 'Cargada' && !guiaEnKg
          ? Number(etiqueta.cantidad) + cartonesRetorno
          : cartonesRetorno;

      // Si no hay tiquete y la etiqueta nunca salió del camión (Cargada sin vender),
      // el stock del camión ya la incluye: no hay nada que sumar.
      const esSinTiqueteSinVenta = !venta && etiqueta.estado === 'Cargada';

      let ventaResumen: { tiquete?: string; cobro?: string; total?: number } = {};
      const retornoId = crypto.randomUUID();
      await db.transaction(async (tx) => {
        // Anular solo cuando el total de la venta ya se devolvió. Una devolución
        // parcial conserva la venta por la cantidad que el cliente retuvo.
        if (venta) {
          const totalDevuelto = cantidadYaDevuelta + cartonesRetorno;
          if (totalDevuelto >= Number(venta.cartones)) {
            if (venta.tablaKg) await tx.update(ventas_ruta_kg).set({ estado: 'Anulada', anuladoEn: new Date().toISOString(), anuladoPor: usuarioId }).where(eq(ventas_ruta_kg.id, venta.id));
            else await tx.update(ventas_ruta).set({ estado: 'Anulada', anuladoEn: new Date().toISOString(), anuladoPor: usuarioId }).where(eq(ventas_ruta.id, venta.id));
          }
          const montoDevuelto = Number(venta.total || 0) * cartonesRetorno / Math.max(1, Number(venta.cartones));
          ventaResumen = { tiquete: venta.tiqueteConsecutivo, cobro: venta.cobro, total: montoDevuelto };
          // Revertir saldo si la venta original fue a crédito
          if (venta.cobro === 'Credito' && venta.clienteId) {
            const cliente = await tx.query.clientes.findFirst({ where: eq(clientes.id, venta.clienteId) });
            if (cliente) {
              const nuevoSaldo = Math.max(0, Number(cliente.saldo_pendiente || 0) - montoDevuelto);
              await tx.update(clientes).set({ saldo_pendiente: nuevoSaldo }).where(eq(clientes.id, venta.clienteId));
            }
          }
        }

        // La devolución permanece bajo custodia del camión hasta que Bodega la acepte.
        const saldoRestauradoKg = guiaEnKg
          ? Number(etiqueta.saldoKg ?? 0) + (venta ? cartonesRetorno : 0)
          : null;
        await tx.update(etiquetas)
          .set({ estado: etiqueta.estado === 'Entregada' ? 'Retornada' : 'Cargada', ...(guiaEnKg ? { saldoKg: saldoRestauradoKg } : { cantidad: cantidadRestaurada }), ubicacionActual: camion?.nombre || 'Bodega Central' })
          .where(eq(etiquetas.id, etiqueta.id));

        // 3. Liberar inventario en el camión (solo si el cartón salió del camión con la venta)
        if (!esSinTiqueteSinVenta) {
          const camionStock = camion ? await tx.query.inventario.findFirst({
            where: and(eq(inventario.producto, etiqueta.producto), eq(inventario.ubicacion, camion.nombre), eq(inventario.unidad, unidadRetorno))
          }) : null;
          if (camionStock) {
            await tx.update(inventario)
              .set({ cantidad: Number(camionStock.cantidad) + cartonesRetorno, ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, camionStock.id));
            if (guiaEnKg && camionStock.unidad !== 'kg') throw new ApiError(409, 'El inventario del camión no está expresado en kg; retorno no registrado.');
          } else if (camion) {
            await tx.insert(inventario).values({
              id: crypto.randomUUID(),
              producto: etiqueta.producto,
              cantidad: cartonesRetorno,
              unidad: unidadRetorno,
              ubicacion: camion.nombre,
              ultima_actualizacion: new Date().toISOString()
            });
          }
        }

        // 4. Registrar retorno en retornos_camion
        await tx.insert(retornos_camion).values({
          id: retornoId,
          guiaId: guia.id,
          etiquetaId: etiqueta.id,
          ventaRutaId: venta?.id || null,
          fecha: new Date().toISOString(),
          responsable: responsable || usuarioId,
          producto: etiqueta.producto,
          cartones: cartonesRetorno,
          unidad: unidadRetorno,
          etiquetasJson: JSON.stringify([{ etiquetaId: etiqueta.id, codigoUnico: etiqueta.codigoUnico, producto: etiqueta.producto, cartones: cartonesRetorno }]),
          peso: peso != null ? Number(peso) : null,
          estado: 'PendienteBodega', cantidadAceptada: 0,
          tipo: venta ? (cantidadYaDevuelta + cartonesRetorno >= Number(venta.cartones) ? 'completo' : 'parcial') : 'sobrante'
        });

        // 5. Movimiento de inventario (solo si hay flujo físico real)
        if (!esSinTiqueteSinVenta) {
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: etiqueta.producto,
            cantidad: cartonesRetorno,
            unidad: unidadRetorno,
            tipo: 'Retorno Camión',
            origen: 'Cliente',
            destino: camion?.nombre || 'Bodega Central',
            fecha: new Date().toISOString(),
            referencia_id: guia.id
          });
        }
      });

      await recordEvent(etiqueta.id, 'Retornada', camion?.nombre || 'Bodega Central', guia.id, usuarioId, `Regresan ${cartonesRetorno} ${unidadRetorno}; pendiente de aceptación de Bodega`);
      await logAudit(usuarioId, 'Crear', 'RetornoCamion', guia.id, null, { etiquetaId, cartones: cartonesRetorno, cantidadRestaurada, tiqueteAnulado: ventaResumen.tiquete || null });

      res.status(201).json({ success: true, message: 'Devolución registrada; pendiente de aceptación física en Bodega', retornoId, tiqueteAnulado: ventaResumen.tiquete || null, etiquetaId, cartones: cartonesRetorno, cantidadKg: guiaEnKg ? cartonesRetorno : cartonesRetorno * Number(factorRetorno || 1), unidad: unidadRetorno, estado: 'PendienteBodega' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Pendientes visibles para que Bodega confirme la recepción física antes del cierre.
  app.get("/api/logistica/retornos/pendientes", requirePermission('inventario_bodega', 'view'), async (req, res) => {
    try {
      const guiaId = typeof req.query.guiaId === 'string' ? req.query.guiaId : undefined;
      const filas = await db.query.retornos_camion.findMany(guiaId
        ? { where: and(eq(retornos_camion.guiaId, guiaId), ne(retornos_camion.estado, 'AceptadoBodega')) }
        : { where: ne(retornos_camion.estado, 'AceptadoBodega') });
      const pendientes = filas.filter((r: any) => ['Registrado', 'PendienteBodega', 'RechazadoBodega'].includes(r.estado));
      const enriquecidos = await Promise.all(pendientes.map(async (r: any) => {
        const guia = r.guiaId ? await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, r.guiaId) }) : null;
        const [camion, ruta] = await Promise.all([
          guia?.camionId ? db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null,
          guia?.rutaId ? db.query.rutas.findFirst({ where: eq(rutas.id, guia.rutaId) }) : null,
        ]);
        return {
          ...r,
          guiaConsecutivo: guia?.consecutivo || null,
          camionNombre: camion?.nombre || null,
          rutaNombre: ruta?.nombre || camion?.ruta_defecto || null,
          guiaFecha: guia?.fecha || null,
          cartones: Number(r.cartones) || 0,
          cantidadAceptada: Number(r.cantidadAceptada) || 0,
          cantidadPendiente: Math.max(0, Number(r.cartones || 0) - Number(r.cantidadAceptada || 0)),
        };
      }));
      res.json(enriquecidos);
    } catch (error: any) { httpError(res, error); }
  });

  // La aceptación es acumulativa: cantidadAceptada significa total aceptado hasta
  // ahora. Repetir la misma solicitud produce delta 0 y no duplica inventario.
  app.post("/api/logistica/bodega/retorno/aceptar", requirePermission('inventario_bodega', 'create'), async (req, res) => {
    try {
      const { retornoId, cantidadAceptada, condicion, rechazado, observaciones, peso } = req.body || {};
      const usuarioId = String((req as any).usuario?.id || '');
      if (!retornoId) return res.status(400).json({ error: 'Se requiere retornoId' });
      const resultado: any = {};
      await db.transaction(async (tx: any) => {
        const retorno = await tx.query.retornos_camion.findFirst({ where: eq(retornos_camion.id, retornoId) });
        if (!retorno) throw new ApiError(404, 'Retorno no encontrado');
        const total = Number(retorno.cartones) || 0;
        const previo = Number(retorno.cantidadAceptada) || 0;
        if (total <= 0 || previo < 0 || previo > total) throw new ApiError(409, 'Cantidad del retorno inconsistente');
        if (retorno.estado === 'AceptadoBodega') {
          if (cantidadAceptada == null || Number(cantidadAceptada) === previo) {
            resultado.idempotente = true; resultado.estado = retorno.estado; resultado.cantidadAceptada = previo; resultado.retornoId = retorno.id;
            return;
          }
          throw new ApiError(409, 'El retorno ya fue aceptado completamente');
        }
        if (Number(retorno.cantidadAceptada || 0) >= Number(retorno.cartones || 0)) {
          resultado.idempotente = true; resultado.estado = retorno.estado; resultado.cantidadAceptada = Number(retorno.cantidadAceptada) || 0; resultado.retornoId = retorno.id;
          return;
        }
        const guia = await tx.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, retorno.guiaId) });
        const camion = guia?.camionId ? await tx.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
        const unidadFisica = retorno.unidad || (guia?.totalKg != null ? 'kg' : 'cartones');
        const objetivo = rechazado === true ? previo : (cantidadAceptada == null ? total : Number(cantidadAceptada));
        if (!Number.isFinite(objetivo) || objetivo < previo || objetivo > total) throw new ApiError(400, `La cantidad aceptada debe estar entre ${previo} y ${total}`);
        const delta = objetivo - previo;
        if (delta > 0) {
          if (!camion) throw new ApiError(409, 'No se encontró el camión asociado para transferir el retorno');
          const stockCamion = await tx.query.inventario.findFirst({ where: and(eq(inventario.producto, retorno.producto), eq(inventario.ubicacion, camion.nombre), eq(inventario.unidad, unidadFisica)) });
          if (!stockCamion || Number(stockCamion.cantidad) < delta) throw new ApiError(409, 'El camión no tiene suficiente existencia para aceptar esta cantidad');
          if (stockCamion.unidad !== unidadFisica) throw new ApiError(409, `La unidad del retorno (${unidadFisica}) no coincide con el inventario del camión (${stockCamion.unidad}).`);
          const ahora = new Date().toISOString();
          await tx.update(inventario).set({ cantidad: Number(stockCamion.cantidad) - delta, ultima_actualizacion: ahora }).where(eq(inventario.id, stockCamion.id));
          const stockBodega = await tx.query.inventario.findFirst({ where: and(eq(inventario.producto, retorno.producto), eq(inventario.ubicacion, 'Bodega Central'), eq(inventario.unidad, unidadFisica)) });
          if (stockBodega) {
            if (stockBodega.unidad !== unidadFisica) throw new ApiError(409, `La unidad del retorno (${unidadFisica}) no coincide con el inventario de Bodega (${stockBodega.unidad}).`);
            await tx.update(inventario).set({ cantidad: Number(stockBodega.cantidad) + delta, ultima_actualizacion: ahora }).where(eq(inventario.id, stockBodega.id));
          } else await tx.insert(inventario).values({ id: crypto.randomUUID(), producto: retorno.producto, cantidad: delta, unidad: unidadFisica, ubicacion: 'Bodega Central', ultima_actualizacion: ahora });
          await tx.insert(movimientosInventario).values({ id: crypto.randomUUID(), producto: retorno.producto, cantidad: delta,
            unidad: unidadFisica, tipo: 'Aceptación Bodega', origen: camion.nombre, destino: 'Bodega Central', fecha: ahora, referencia_id: retorno.guiaId });
          if (retorno.etiquetaId) {
            const etiqueta = await tx.query.etiquetas.findFirst({ where: eq(etiquetas.id, retorno.etiquetaId) });
            if (etiqueta) {
              const restante = unidadFisica === 'kg'
                ? Math.max(0, Number(etiqueta.saldoKg || 0) - delta)
                : Math.max(0, Number(etiqueta.cantidad || 0) - delta);
              // Si el empaque completo vuelve a Bodega, su saldo pasa a ser el
              // total aceptado. Dejarlo en cero creaba stock físico sin etiqueta.
              const disponibleDespues = unidadFisica === 'kg'
                ? { saldoKg: restante <= 0.001 ? objetivo : restante }
                : { cantidad: restante <= 0.001 ? objetivo : restante };
              await tx.update(etiquetas).set(restante <= 0.001
                ? { ...disponibleDespues, estado: 'EnBodega', ubicacionActual: 'Bodega Central', guiaDespachoId: null }
                : { ...disponibleDespues, estado: 'Cargada', ubicacionActual: camion.nombre })
                .where(eq(etiquetas.id, etiqueta.id));
            await recordEventTx(tx, etiqueta.id, 'RetornoAceptadoBodega', 'Bodega Central', retorno.guiaId, usuarioId,
              `Bodega aceptó ${delta} de ${total} ${unidadFisica}; acumulado ${objetivo}`);
            }
          }
        }
        const estado = rechazado === true ? 'RechazadoBodega' : (objetivo >= total ? 'AceptadoBodega' : 'PendienteBodega');
        const ahora = new Date().toISOString();
        await tx.update(retornos_camion).set({ estado, cantidadAceptada: objetivo, aceptadoPor: usuarioId,
          aceptadoEn: delta > 0 || rechazado === true ? ahora : retorno.aceptadoEn, condicion: condicion || retorno.condicion || null,
          ...(peso == null ? {} : { peso: Number(peso) }) })
          .where(eq(retornos_camion.id, retorno.id));
        resultado.idempotente = delta === 0 && rechazado !== true;
        resultado.estado = estado; resultado.cantidadAceptada = objetivo; resultado.cantidadPendiente = total - objetivo;
        resultado.retornoId = retorno.id; resultado.rechazado = rechazado === true; resultado.observaciones = observaciones || null;
        resultado.etiquetaIdReingresada = delta > 0 && objetivo >= total ? retorno.etiquetaId || null : null;
        resultado.guiaId = retorno.guiaId;
      });
      res.json({ success: true, ...resultado });
    } catch (error: any) { httpError(res, error); }
  });

  // Bodega confirma el sobrante que permanece en el camión después de resolver
  // todas las devoluciones etiquetadas. El movimiento y el cambio de custodio
  // ocurren juntos; el cierre de guía no vuelve a tocar estas existencias.
  app.post("/api/logistica/bodega/retorno/aceptar-sobrante", requirePermission('inventario_bodega', 'create'), async (req, res) => {
    try {
      const { guiaId, responsable, conteoPorProducto } = req.body || {};
      const usuarioId = String((req as any).usuario?.id || '');
      if (!guiaId || !responsable || !Array.isArray(conteoPorProducto)) return res.status(400).json({ error: 'Se requiere guía, responsable y conteo físico por producto.' });
      const aceptados: any[] = [];
      const resultadoConteo: any = {};
      await db.transaction(async (tx: any) => {
        const guia = await tx.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
        if (!guia) throw new ApiError(404, 'Guía no encontrada.');
        if (!guia.finDiaFecha || ['Cerrada', 'CerradaConDiferencia', 'Anulada'].includes(guia.estado)) throw new ApiError(409, 'El sobrante se recibe después del fin de día y antes de cerrar la guía.');
        const camion = guia.camionId ? await tx.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
        if (!camion) throw new ApiError(409, 'La guía no tiene un camión asociado.');
        const retornos = await tx.query.retornos_camion.findMany({ where: eq(retornos_camion.guiaId, guiaId) });
        if (retornos.some((r: any) => ['Registrado', 'PendienteBodega', 'RechazadoBodega'].includes(r.estado) && Number(r.cartones) > Number(r.cantidadAceptada || 0))) {
          throw new ApiError(409, 'Primero resuelva todos los retornos etiquetados pendientes o rechazados.');
        }
        const stockCamion = await tx.query.inventario.findMany({ where: eq(inventario.ubicacion, camion.nombre) });
        const stockConSaldo = stockCamion.filter((item: any) => Number(item.cantidad) > 0.0001);
        const conteos = new Map<string, { cantidad: number; motivoDiferencia: string }>();
        for (const fila of conteoPorProducto) {
          const producto = String(fila?.producto || '').trim();
          const cantidad = Number(fila?.cantidad);
          if (!producto || !Number.isFinite(cantidad) || cantidad < 0 || conteos.has(producto)) throw new ApiError(400, 'Cada producto debe tener un único conteo físico válido.');
          conteos.set(producto, { cantidad, motivoDiferencia: String(fila?.motivoDiferencia || '').trim() });
        }
        const productosEnStock = new Set(stockConSaldo.map((item: any) => item.producto));
        if (conteos.size !== productosEnStock.size || [...conteos.keys()].some(producto => !productosEnStock.has(producto))) {
          throw new ApiError(409, 'El conteo debe incluir exactamente todos los productos con saldo en el camión.');
        }
        const diferenciasConteo: any[] = [];
        for (const item of stockConSaldo) {
          const conteo = conteos.get(item.producto)!;
          if (Math.abs(conteo.cantidad - Number(item.cantidad)) > 0.0001) {
            if (!conteo.motivoDiferencia) throw new ApiError(400, `Indique el motivo de la diferencia para ${item.producto}.`);
            diferenciasConteo.push({ producto: item.producto, cantidadSistema: Number(item.cantidad), cantidadContada: conteo.cantidad, motivo: conteo.motivoDiferencia });
          }
        }
        if (diferenciasConteo.length) {
          const pendientes = await tx.query.aprobaciones.findMany({ where: and(eq(aprobaciones.modulo, 'Logistica'), eq(aprobaciones.referenciaId, guiaId)) });
          const existente = pendientes.find((a: any) => a.estado === 'Pendiente' && a.tipo === 'DiferenciaConteoBodega');
          if (existente) throw new ApiError(409, 'Esta diferencia ya tiene un segundo conteo pendiente de revisión o una aprobación abierta. Use la bandeja de reconteos.');
          const aprobacionId = crypto.randomUUID();
          const lineasPrimerConteo = stockConSaldo.map((item: any) => {
            const conteo = conteos.get(item.producto)!;
            return { producto: item.producto, unidad: item.unidad || 'cartones', cantidadSistema: Number(item.cantidad), cantidadContada: conteo.cantidad, motivo: conteo.motivoDiferencia || null };
          });
          await tx.insert(aprobaciones).values({
            id: aprobacionId, tipo: 'DiferenciaConteoBodega', modulo: 'Logistica', referenciaId: guiaId,
            solicitudUsuario: usuarioId, descripcion: `Primer conteo discrepante en la guía ${guia.consecutivo}. Se requiere reconteo independiente antes de resolver.`,
            datos: JSON.stringify({ guiaId, camionId: camion.id, primerConteo: { usuarioId, responsable: String(responsable), fecha: new Date().toISOString(), lineas: lineasPrimerConteo }, diferencias: diferenciasConteo }),
            estado: 'Pendiente', fechaSolicitud: new Date().toISOString(),
          });
          resultadoConteo.diferencias = diferenciasConteo;
          resultadoConteo.aprobacionId = aprobacionId;
          return;
        }
        const ahora = new Date().toISOString();
        for (const item of stockCamion) {
          const cantidadSistema = Number(item.cantidad) || 0;
          const cantidad = cantidadSistema;
          if (cantidadSistema <= 0 && cantidad <= 0) continue;
          const bodegaItem = await tx.query.inventario.findFirst({ where: and(eq(inventario.producto, item.producto), eq(inventario.ubicacion, 'Bodega Central'), eq(inventario.unidad, item.unidad || 'cartones')) });
          if (cantidad > 0 && bodegaItem) {
            if (bodegaItem.unidad !== item.unidad) throw new ApiError(409, `La unidad del retorno (${item.unidad}) no coincide con Bodega (${bodegaItem.unidad}) para ${item.producto}.`);
            await tx.update(inventario).set({ cantidad: Number(bodegaItem.cantidad) + cantidad, ultima_actualizacion: ahora }).where(eq(inventario.id, bodegaItem.id));
          }
          else if (cantidad > 0) await tx.insert(inventario).values({ id: crypto.randomUUID(), producto: item.producto, cantidad, unidad: item.unidad || 'cartones', ubicacion: 'Bodega Central', ultima_actualizacion: ahora });
          await tx.update(inventario).set({ cantidad: 0, ultima_actualizacion: ahora }).where(eq(inventario.id, item.id));
          await tx.insert(movimientosInventario).values({ id: crypto.randomUUID(), producto: item.producto, cantidad, unidad: item.unidad || 'cartones', tipo: 'Retorno Sobrante Camión', origen: camion.nombre, destino: 'Bodega Central', fecha: ahora, referencia_id: guiaId });
          await tx.insert(retornos_camion).values({
            id: crypto.randomUUID(), guiaId, etiquetaId: null, ventaRutaId: null, fecha: ahora,
            responsable: String(responsable), producto: item.producto, cartones: cantidad, unidad: item.unidad || 'cartones',
            cantidadAceptada: cantidad, etiquetasJson: JSON.stringify([{ producto: item.producto, cantidad, cantidadSistema, unidad: item.unidad || 'cartones' }]),
            estado: 'AceptadoBodega', aceptadoPor: usuarioId, aceptadoEn: ahora, condicion: 'bueno', tipo: 'sobrante',
          });
          aceptados.push({ producto: item.producto, cantidad, cantidadSistema, unidad: item.unidad || 'cartones' });
        }
        const etiquetasGuiaSobrante = await tx.query.etiquetas.findMany({ where: eq(etiquetas.guiaDespachoId, guiaId) });
        for (const etiqueta of etiquetasGuiaSobrante) {
          if (['Entregada', 'Mermada'].includes(etiqueta.estado)) continue;
          await tx.update(etiquetas).set({ estado: 'EnBodega', ubicacionActual: 'Bodega Central', guiaDespachoId: null }).where(eq(etiquetas.id, etiqueta.id));
          await recordEventTx(tx, etiqueta.id, 'Reingresada', 'Bodega Central', guiaId, usuarioId, `Sobrante contado por ${responsable}`);
        }
      });
      if (resultadoConteo.diferencias) {
        await logAudit(usuarioId, 'ReportarDiferencia', 'RetornoSobranteBodega', guiaId, null, resultadoConteo, responsable);
        return res.status(409).json({ success: false, error: 'El conteo físico no coincide con el inventario del camión. No se movió producto; la diferencia quedó pendiente de revisión.', diferenciaPendiente: true, diferencias: resultadoConteo.diferencias, aprobacionId: resultadoConteo.aprobacionId });
      }
      await logAudit(usuarioId, 'Aceptar', 'RetornoSobranteBodega', guiaId, null, { responsable, aceptados });
      const unidadesAceptadas = [...new Set(aceptados.map(x => x.unidad))];
      res.json({ success: true, guiaId, aceptados, diferenciasConteo: [], totalAceptado: aceptados.reduce((s, x) => s + x.cantidad, 0), unidad: unidadesAceptadas.length === 1 ? unidadesAceptadas[0] : (unidadesAceptadas.length ? 'unidades mixtas' : 'kg') });
    } catch (error: any) { httpError(res, error); }
  });

  app.get("/api/logistica/bodega/reconteos-pendientes", requirePermission('inventario_bodega', 'view'), async (_req, res) => {
    try {
      const aprobacionesPendientes = await db.query.aprobaciones.findMany({ where: eq(aprobaciones.tipo, 'DiferenciaConteoBodega') });
      const items = aprobacionesPendientes.map((a: any) => ({ ...a, datos: (() => { try { return JSON.parse(a.datos || '{}'); } catch { return {}; } })() }))
        .filter((a: any) => ['Pendiente', 'RecuentoRequerido'].includes(a.estado));
      res.json({ count: items.length, items });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/logistica/bodega/reconteos/:aprobacionId", requirePermission('inventario_bodega', 'create'), async (req, res) => {
    try {
      const usuarioId = String((req as any).usuario?.id || '');
      const responsable = String(req.body?.responsable || (req as any).usuario?.name || usuarioId);
      const filas = req.body?.conteoPorProducto;
      if (!Array.isArray(filas) || !filas.length) return res.status(400).json({ error: 'Ingrese el reconteo de cada producto.' });
      let resultado: any = null;
      await db.transaction(async (tx: any) => {
        const aprobacion = await tx.query.aprobaciones.findFirst({ where: eq(aprobaciones.id, req.params.aprobacionId) });
        if (!aprobacion || aprobacion.tipo !== 'DiferenciaConteoBodega') throw new ApiError(404, 'Diferencia de conteo no encontrada.');
        if (!['Pendiente', 'RecuentoRequerido'].includes(aprobacion.estado)) throw new ApiError(409, 'Esta diferencia ya fue resuelta.');
        const datos = JSON.parse(aprobacion.datos || '{}');
        const primero = datos.primerConteo;
        if (!primero?.usuarioId) throw new ApiError(409, 'El conteo original no tiene responsable identificable; solicite un nuevo conteo inicial.');
        const conteosPrevios = datos.reconteos || [primero, ...(datos.segundoConteo ? [datos.segundoConteo] : [])];
        if (conteosPrevios.some((conteo: any) => conteo.usuarioId === usuarioId)) throw new ApiError(409, 'El reconteo debe hacerlo una persona distinta de quienes ya contaron este producto.');
        const ultimoConteo = conteosPrevios[conteosPrevios.length - 1] || primero;
        const guia = await tx.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, aprobacion.referenciaId) });
        if (!guia || !guia.finDiaFecha || ['Cerrada', 'CerradaConDiferencia', 'Anulada'].includes(guia.estado)) throw new ApiError(409, 'La guía ya no admite reconteos.');
        const camion = guia.camionId ? await tx.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
        if (!camion) throw new ApiError(409, 'La guía no tiene camión asociado.');
        const stock = await tx.query.inventario.findMany({ where: eq(inventario.ubicacion, camion.nombre) });
        const porProducto = new Map<string, any>();
        for (const fila of filas) {
          const producto = String(fila?.producto || '').trim();
          const cantidad = Number(fila?.cantidad);
          if (!producto || !Number.isFinite(cantidad) || cantidad < 0 || porProducto.has(producto)) throw new ApiError(400, 'Cada producto debe tener un único conteo físico válido.');
          porProducto.set(producto, cantidad);
        }
        const lineasPrimerConteo = ultimoConteo.lineas || [];
        if (porProducto.size !== lineasPrimerConteo.length || lineasPrimerConteo.some((l: any) => !porProducto.has(l.producto))) throw new ApiError(409, 'El reconteo debe incluir exactamente los productos del conteo anterior.');
        const lineas = lineasPrimerConteo.map((l: any) => {
          const saldo = stock.find((i: any) => i.producto === l.producto);
          if (!saldo || Math.abs(Number(saldo.cantidad) - Number(l.cantidadSistema)) > 0.0001) throw new ApiError(409, `El inventario de ${l.producto} cambió después del primer conteo. Solicite una nueva revisión.`);
          return { ...l, cantidadAnterior: Number(l.cantidadRecontada ?? l.cantidadContada ?? l.cantidadSistema), cantidadRecontada: porProducto.get(l.producto), motivoReconteo: String(filas.find((f: any) => f.producto === l.producto)?.motivoDiferencia || '').trim() || null };
        });
        const conforme = lineas.every((l: any) => Math.abs(Number(l.cantidadRecontada) - Number(l.cantidadSistema)) <= 0.0001);
        const ahora = new Date().toISOString();
        const nuevoConteo = { usuarioId, responsable, fecha: ahora, lineas };
        datos.reconteos = [...conteosPrevios, nuevoConteo];
        datos.segundoConteo = nuevoConteo;
        if (conforme) {
          await tx.update(schema.inventario_cuarentena).set({ estado: 'ResueltaSinAjuste', motivoResolucion: 'Reconteo independiente coincide con saldo del sistema.' }).where(eq(schema.inventario_cuarentena.aprobacionId, aprobacion.id));
          await tx.update(aprobaciones).set({ estado: 'ResueltaSinAjuste', aprobadoPor: usuarioId, fechaResolucion: ahora,
            motivoRechazo: 'Segundo conteo independiente coincide con el inventario registrado; no se requiere ajuste.' , datos: JSON.stringify(datos) }).where(eq(aprobaciones.id, aprobacion.id));
          resultado = { conforme: true, mensaje: 'El segundo conteo coincide con el registro. Confirme ahora la recepción normal del sobrante.' };
          return;
        }
        await tx.update(schema.inventario_cuarentena).set({ estado: 'RecuentoReemplazado' }).where(eq(schema.inventario_cuarentena.aprobacionId, aprobacion.id));
        for (const l of lineas) {
          await tx.insert(schema.inventario_cuarentena).values({
            id: crypto.randomUUID(), aprobacionId: aprobacion.id, guiaId: guia.id, producto: l.producto,
            cantidadSistema: Number(l.cantidadSistema), cantidad: Number(l.cantidadRecontada), unidad: l.unidad || 'cartones',
            estado: 'PendienteAprobacion', creadoPor: usuarioId, creadoEn: ahora,
          });
        }
        const descripcion = `Dos conteos independientes confirman una diferencia física en la guía ${guia.consecutivo}. La cantidad contada se mantiene en cuarentena hasta aprobación.`;
        await tx.update(aprobaciones).set({ descripcion, datos: JSON.stringify(datos), estado: 'Pendiente' }).where(eq(aprobaciones.id, aprobacion.id));
        resultado = { conforme: false, requiereAprobacion: true, mensaje: 'El segundo conteo confirma la diferencia. El producto queda registrado en cuarentena y pendiente de aprobación de Administración.', lineas };
      });
      if (resultado?.requiereAprobacion) await logAudit(usuarioId, 'ConfirmarReconteo', 'InventarioCuarentena', req.params.aprobacionId, null, resultado.lineas, responsable);
      if (resultado?.conforme) await logAudit(usuarioId, 'ReconteoConforme', 'InventarioCuarentena', req.params.aprobacionId, null, resultado, responsable);
      res.json({ success: true, ...resultado });
    } catch (error: any) { httpError(res, error); }
  });

  app.get("/api/logistica/bodega/cuarentena", requirePermission('inventario_bodega', 'view'), async (_req, res) => {
    try {
      const items = await db.query.inventario_cuarentena.findMany();
      res.json(items.filter((item: any) => !['Liberada', 'Resuelta'].includes(item.estado)));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/logistica/bodega/cuarentena/:id/etiquetas-reemplazo", requirePermission('aprobaciones', 'approve'), async (req, res) => {
    try {
      const usuarioId = String((req as any).usuario?.id || '');
      const motivo = String(req.body?.motivo || '').trim();
      const ids = Array.isArray(req.body?.etiquetaIds) ? req.body.etiquetaIds.map((id: any) => String(id).trim()).filter(Boolean) : [];
      if (!motivo) return res.status(400).json({ error: 'Explique brevemente qué se reempacó y verificó.' });
      if (!ids.length || new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Seleccione una o más etiquetas nuevas, sin repetirlas.' });
      let resultado: any;
      await db.transaction(async (tx: any) => {
        const caso = await tx.query.inventario_cuarentena.findFirst({ where: eq(schema.inventario_cuarentena.id, req.params.id) });
        if (!caso || caso.estado !== 'Aprobada' || Number(caso.liberado || 0) > 0) throw new ApiError(409, 'El caso no está disponible para registrar etiquetas de reempaque.');
        if (caso.etiquetasReemplazoJson) throw new ApiError(409, 'Este caso ya tiene etiquetas nuevas vinculadas.');
        const cantidadFisica = Number(caso.cantidad);
        if (!Number.isFinite(cantidadFisica) || cantidadFisica <= 0) throw new ApiError(409, 'La cantidad física debe ser mayor que cero para emitir etiquetas.');
        const enKg = caso.unidad === 'kg';
        const nuevas: any[] = [];
        for (const id of ids) {
          const etiqueta = await tx.query.etiquetas.findFirst({ where: eq(etiquetas.id, id) });
          if (!etiqueta) throw new ApiError(404, `No se encontró la etiqueta ${id}.`);
          if (etiqueta.producto !== caso.producto || etiqueta.estado !== 'Generada' || etiqueta.guiaDespachoId) {
            throw new ApiError(409, `La etiqueta ${etiqueta.codigoUnico} debe ser nueva, estar en estado Generada y corresponder a ${caso.producto}.`);
          }
          const cantidadEtiqueta = enKg ? Number(etiqueta.pesoNeto) : Number(etiqueta.cantidad);
          if (!Number.isFinite(cantidadEtiqueta) || cantidadEtiqueta <= 0 || (enKg && (!etiqueta.pesoRegistradoEn || !['Manual', 'Bascula'].includes(String(etiqueta.pesoOrigen))))) {
            throw new ApiError(409, `La etiqueta ${etiqueta.codigoUnico} debe tener ${enKg ? 'peso neto real en kg registrado' : 'una cantidad válida en cartones'}.`);
          }
          nuevas.push(etiqueta);
        }
        const cantidadEtiqueta = (e: any) => enKg ? Number(e.pesoNeto) : Number(e.cantidad);
        const sumaEtiquetas = nuevas.reduce((s: number, e: any) => s + cantidadEtiqueta(e), 0);
        if (Math.abs(sumaEtiquetas - cantidadFisica) > 0.0001) throw new ApiError(409, `Las etiquetas seleccionadas suman ${sumaEtiquetas} ${caso.unidad}; el conteo físico es ${cantidadFisica}.`);
        const eventosOriginales = await tx.query.traza_etiqueta.findMany({ where: and(eq(traza_etiqueta.documentoRef, caso.aprobacionId), eq(traza_etiqueta.tipoEvento, 'AjusteConteoAprobado')) });
        const originales: any[] = [];
        for (const evento of eventosOriginales) {
          const etiqueta = await tx.query.etiquetas.findFirst({ where: eq(etiquetas.id, evento.etiquetaId) });
          if (etiqueta?.producto === caso.producto) originales.push(etiqueta);
        }
        const nuevaRef = nuevas.map((e: any) => ({ id: e.id, codigoUnico: e.codigoUnico, cantidad: cantidadEtiqueta(e), unidad: caso.unidad }));
        for (const etiqueta of nuevas) {
          await tx.update(etiquetas).set({ estado: 'EnCuarentena', ubicacionActual: 'Cuarentena Bodega' }).where(eq(etiquetas.id, etiqueta.id));
          await recordEventTx(tx, etiqueta.id, 'EtiquetaReempaqueCuarentena', 'Cuarentena Bodega', caso.id, usuarioId,
            JSON.stringify({ casoId: caso.id, etiquetasOriginales: originales.map((e: any) => e.id), cantidad: cantidadEtiqueta(etiqueta), unidad: caso.unidad, motivo }));
        }
        for (const etiqueta of originales) {
          await tx.update(etiquetas).set({ estado: 'ReemplazadaReempaque', ubicacionActual: 'Archivo de reempaque', guiaDespachoId: null }).where(eq(etiquetas.id, etiqueta.id));
          await recordEventTx(tx, etiqueta.id, 'EtiquetaReemplazadaReempaque', 'Archivo de reempaque', caso.id, usuarioId,
            JSON.stringify({ casoId: caso.id, etiquetasNuevas: nuevaRef.map((e: any) => e.id), motivo }));
        }
        await tx.update(schema.inventario_cuarentena).set({ etiquetasReemplazoJson: JSON.stringify(nuevaRef), motivoResolucion: `Reempaque: ${motivo}` }).where(eq(schema.inventario_cuarentena.id, caso.id));
        resultado = { casoId: caso.id, producto: caso.producto, cantidad: sumaEtiquetas, etiquetasNuevas: nuevaRef, etiquetasOriginalesArchivadas: originales.length };
      });
      await logAudit(usuarioId, 'VincularEtiquetasReempaque', 'InventarioCuarentena', req.params.id, null, resultado, motivo);
      res.json({ success: true, ...resultado });
    } catch (error: any) { httpError(res, error); }
  });

  app.post("/api/logistica/bodega/cuarentena/:id/liberar", requirePermission('aprobaciones', 'approve'), async (req, res) => {
    try {
      const usuarioId = String((req as any).usuario?.id || '');
      const motivo = String(req.body?.motivo || '').trim();
      if (!motivo) return res.status(400).json({ error: 'Indique qué se verificó para liberar este producto de cuarentena.' });
      let resultado: any;
      await db.transaction(async (tx: any) => {
        const caso = await tx.query.inventario_cuarentena.findFirst({ where: eq(schema.inventario_cuarentena.id, req.params.id) });
        if (!caso || caso.estado !== 'Aprobada') throw new ApiError(409, 'El caso no está aprobado o ya fue liberado.');
        const restante = Number(caso.cantidad) - Number(caso.liberado || 0);
        if (restante <= 0.0001) throw new ApiError(409, 'No queda cantidad física por liberar.');
        const etiquetasEvento = await tx.query.traza_etiqueta.findMany({ where: and(eq(traza_etiqueta.documentoRef, caso.aprobacionId), eq(traza_etiqueta.tipoEvento, 'AjusteConteoAprobado')) });
        const etiquetasCaso: any[] = [];
        for (const ev of etiquetasEvento) {
          const tag = await tx.query.etiquetas.findFirst({ where: eq(etiquetas.id, ev.etiquetaId) });
          if (tag?.producto === caso.producto) etiquetasCaso.push(tag);
        }
        let etiquetasParaLiberar = etiquetasCaso;
        if (caso.etiquetasReemplazoJson) {
          const reemplazos = JSON.parse(caso.etiquetasReemplazoJson);
          etiquetasParaLiberar = [];
          for (const reemplazo of reemplazos) {
            const etiqueta = await tx.query.etiquetas.findFirst({ where: eq(etiquetas.id, reemplazo.id) });
            if (!etiqueta || etiqueta.producto !== caso.producto || etiqueta.estado !== 'EnCuarentena') throw new ApiError(409, 'Una etiqueta nueva ya no está disponible en cuarentena; revise el caso antes de liberar.');
            etiquetasParaLiberar.push(etiqueta);
          }
        }
        const esKg = caso.unidad === 'kg';
        const cantidadEtiquetada = etiquetasParaLiberar.reduce((s: number, e: any) => s + Number(esKg ? (e.saldoKg ?? e.pesoNeto ?? 0) : e.cantidad || 0), 0);
        if (!etiquetasParaLiberar.length || Math.abs(cantidadEtiquetada - restante) > 0.0001) {
          throw new ApiError(409, `La cantidad física (${restante} ${caso.unidad}) debe coincidir con etiquetas vigentes (${cantidadEtiquetada}). Registre las etiquetas nuevas del reempaque antes de liberar.`);
        }
        const ubicacionCuarentena = await tx.query.inventario.findFirst({ where: and(eq(inventario.producto, caso.producto), eq(inventario.ubicacion, 'Cuarentena Bodega'), eq(inventario.unidad, caso.unidad)) });
        if (!ubicacionCuarentena || Number(ubicacionCuarentena.cantidad) < restante) throw new ApiError(409, 'El saldo físico de cuarentena cambió; solicite una nueva revisión.');
        const ahora = new Date().toISOString();
        const central = await tx.query.inventario.findFirst({ where: and(eq(inventario.producto, caso.producto), eq(inventario.ubicacion, 'Bodega Central'), eq(inventario.unidad, caso.unidad)) });
        if (central) await tx.update(inventario).set({ cantidad: Number(central.cantidad) + restante, ultima_actualizacion: ahora }).where(eq(inventario.id, central.id));
        else await tx.insert(inventario).values({ id: crypto.randomUUID(), producto: caso.producto, cantidad: restante, unidad: caso.unidad, ubicacion: 'Bodega Central', ultima_actualizacion: ahora });
        await tx.update(inventario).set({ cantidad: Number(ubicacionCuarentena.cantidad) - restante, ultima_actualizacion: ahora }).where(eq(inventario.id, ubicacionCuarentena.id));
        await tx.insert(movimientosInventario).values({ id: crypto.randomUUID(), producto: caso.producto, cantidad: restante, tipo: 'Liberación Cuarentena', origen: 'Cuarentena Bodega', destino: 'Bodega Central', fecha: ahora, referencia_id: caso.aprobacionId });
        for (const etiqueta of etiquetasParaLiberar) {
          await tx.update(etiquetas).set({ estado: 'EnBodega', ubicacionActual: 'Bodega Central', ...(esKg ? { saldoKg: Number(etiqueta.pesoNeto) } : {}) }).where(eq(etiquetas.id, etiqueta.id));
          await recordEventTx(tx, etiqueta.id, 'LiberacionCuarentena', 'Bodega Central', caso.aprobacionId, usuarioId, motivo);
        }
        await tx.update(schema.inventario_cuarentena).set({ estado: 'Liberada', liberado: Number(caso.cantidad), liberadoPor: usuarioId, liberadoEn: ahora, motivoResolucion: `${caso.motivoResolucion ? `${caso.motivoResolucion}; ` : ''}Liberación: ${motivo}` }).where(eq(schema.inventario_cuarentena.id, caso.id));
        resultado = { casoId: caso.id, producto: caso.producto, cantidad: restante, ubicacion: 'Bodega Central', etiquetasLiberadas: etiquetasParaLiberar.length, etiquetasReemplazo: Boolean(caso.etiquetasReemplazoJson) };
      });
      await logAudit(usuarioId, 'LiberarCuarentena', 'Inventario', req.params.id, null, resultado, motivo);
      res.json({ success: true, ...resultado });
    } catch (error: any) { httpError(res, error); }
  });

  // La merma de ruta siempre se liga a una etiqueta cargada. La cantidad en kg
  // conserva el factor vigente y su equivalente en cartones para el cuadre.
  app.post("/api/logistica/merma", requirePermission(['ventas', 'desperdicios'], 'create'), async (req, res) => {
    try {
      const { guiaId, etiquetaId, cantidad, unidad = 'kg', motivo, responsable, observaciones } = req.body || {};
      const cantidadOriginal = Number(cantidad);
      if (!guiaId || !etiquetaId || !Number.isFinite(cantidadOriginal) || cantidadOriginal <= 0 || !motivo || !responsable) {
        return res.status(400).json({ error: 'Indique guía, etiqueta, cantidad, motivo y responsable para reportar la merma.' });
      }
      if (!['cartones', 'kg'].includes(String(unidad))) return res.status(400).json({ error: 'La unidad debe ser cartones o kg.' });
      const usuarioId = String((req as any).usuario?.id || '');
      const resultado: any = {};
      await db.transaction(async (tx: any) => {
        const guia = await tx.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
        if (!guia) throw new ApiError(404, 'Guía no encontrada.');
        if (['Cerrada', 'CerradaConDiferencia', 'Anulada'].includes(guia.estado)) throw new ApiError(409, 'La guía ya está cerrada; no se puede agregar merma.');
        const etiqueta = await tx.query.etiquetas.findFirst({ where: eq(etiquetas.id, etiquetaId) });
        if (!etiqueta || etiqueta.guiaDespachoId !== guiaId || etiqueta.estado !== 'Cargada') throw new ApiError(409, 'La etiqueta no pertenece a esta guía o ya no tiene producto bajo custodia del camión.');
        const camion = guia.camionId ? await tx.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
        if (!camion) throw new ApiError(409, 'La guía no tiene un camión válido asociado.');
        const roles = [req.usuario?.role, ...(req.usuario?.roles || [])].filter(Boolean);
        if (!roles.includes('Admin') && (camion.camioneroId || camion.vendedor_id) !== usuarioId) throw new ApiError(403, 'Solo puede reportar merma de la guía de su camión asignado.');
        const catalogo = await tx.query.productosCatalogo.findMany();
        const productoCatalogo = productoCatalogoPara(etiqueta.producto, catalogo);
        const guiaEnKg = guia.totalKg != null;

        let factorKgPorCarton: number | null = null;
        let cantidadCartones = cantidadOriginal;
        if (guiaEnKg && unidad !== 'kg') throw new ApiError(409, 'Esta guía se controla en kg; registre la merma en kg medidos.');
        if (unidad === 'cartones' && !Number.isInteger(cantidadOriginal)) throw new ApiError(400, 'La cantidad en cartones debe ser un número entero.');
        if (unidad === 'kg' && !guiaEnKg) {
          const factor = productoCatalogo?.unidad === 'cartones' ? Number(productoCatalogo.kgPorCarton) : 0;
          if (!Number.isFinite(factor) || factor <= 0) throw new ApiError(409, `Falta configurar el factor kg/cartón de ${etiqueta.producto} en el catálogo.`);
          factorKgPorCarton = factor;
          cantidadCartones = cantidadOriginal / factor;
        }
        cantidadCartones = Math.round(cantidadCartones * 1000) / 1000;
        const cantidadEtiqueta = guiaEnKg ? Number(etiqueta.saldoKg ?? 0) : Number(etiqueta.cantidad) || 0;
        if (cantidadCartones > cantidadEtiqueta + 0.0001) throw new ApiError(409, `La merma supera los ${cantidadEtiqueta.toFixed(2)} ${guiaEnKg ? 'kg' : 'cartones'} que quedan en esta etiqueta.`);
        const stock = await tx.query.inventario.findFirst({ where: and(eq(inventario.producto, etiqueta.producto), eq(inventario.ubicacion, camion.nombre), eq(inventario.unidad, guiaEnKg ? 'kg' : 'cartones')) });
        if (guiaEnKg && stock?.unidad !== 'kg') throw new ApiError(409, 'El inventario del camión no está confirmado en kg.');
        if (!stock || Number(stock.cantidad) + 0.0001 < cantidadCartones) throw new ApiError(409, 'El inventario del camión no alcanza para registrar esta merma.');

        const ahora = new Date().toISOString();
        const restanteEtiqueta = Math.max(0, Math.round((cantidadEtiqueta - cantidadCartones) * 1000) / 1000);
        const mermaId = crypto.randomUUID();
        await tx.update(inventario).set({ cantidad: Number(stock.cantidad) - cantidadCartones, ultima_actualizacion: ahora }).where(eq(inventario.id, stock.id));
        await tx.update(etiquetas).set(restanteEtiqueta <= 0.0001
          ? (guiaEnKg ? { saldoKg: 0, estado: 'Mermada', ubicacionActual: 'Merma' } : { cantidad: 0, estado: 'Mermada', ubicacionActual: 'Merma' })
          : (guiaEnKg ? { saldoKg: restanteEtiqueta } : { cantidad: restanteEtiqueta }))
          .where(eq(etiquetas.id, etiqueta.id));
        await tx.insert(desperdicios).values({
          id: mermaId, origen: 'Ruta', producto: etiqueta.producto, etiquetaId: etiqueta.id, lote: etiqueta.lote || null,
          cantidad: cantidadOriginal, unidad, factorKgPorCarton, cantidadCartones: guiaEnKg ? null : cantidadCartones, peso: unidad === 'kg' ? cantidadOriginal : null,
          motivo: String(motivo), responsable: String(responsable), impactoFinanciero: 0,
          fecha: ahora, observaciones: observaciones || null, rutaId: guia.rutaId || null, guiaId,
          camionId: camion.id, vendedorId: guia.vendedorId || null,
        });
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(), producto: etiqueta.producto, cantidad: cantidadCartones, unidad: guiaEnKg ? 'kg' : 'cartones', tipo: 'Merma Ruta',
          origen: camion.nombre, destino: 'Merma', fecha: ahora, referencia_id: guiaId,
        });
        resultado.id = mermaId; resultado.guiaId = guiaId; resultado.etiquetaId = etiqueta.id;
        resultado.cantidad = cantidadOriginal; resultado.unidad = unidad; resultado.cantidadCartones = cantidadCartones;
        resultado.factorKgPorCarton = factorKgPorCarton; resultado.etiquetaAgotada = restanteEtiqueta <= 0.0001; resultado.kgAutoritativo = guiaEnKg;
      });
      await recordEvent(etiquetaId, resultado.etiquetaAgotada ? 'Mermada' : 'MermaParcial', resultado.etiquetaAgotada ? 'Merma' : 'Camión', guiaId, usuarioId, `${resultado.cantidad} ${unidad} (${resultado.cantidadCartones} cartones) reportados como merma`);
      await logAudit(usuarioId, 'Crear', 'MermaRuta', guiaId, null, resultado, responsable);
      res.status(201).json({ success: true, ...resultado });
    } catch (error: any) { httpError(res, error); }
  });

  app.post("/api/logistica/caja/fin-dia", requirePermission('ventas', 'create'), async (req, res) => {
    try {
      const { guiaId, responsable, efectivoContado } = req.body || {};
      const usuarioId = String(req.usuario?.id || '');
      if (!guiaId) return res.status(400).json({ error: "Se requiere guiaId" });
      const conteoInformado = efectivoContado !== undefined && efectivoContado !== null && efectivoContado !== '';
      const montoContado = conteoInformado ? Number(efectivoContado) : null;
      if (conteoInformado && (!Number.isFinite(montoContado) || Number(montoContado) < 0)) {
        return res.status(400).json({ error: 'El efectivo contado debe ser un monto válido mayor o igual a cero.' });
      }

      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
      const roles = [req.usuario?.role, ...(req.usuario?.roles || [])].filter(Boolean);
      if (!roles.includes('Admin') && (!camion || (camion.camioneroId || camion.vendedor_id) !== usuarioId)) return res.status(403).json({ error: 'Solo puede cerrar el día de la guía de su camión asignado.' });

      const contexto = await cargarContextoCuadre(db, guia.id);
      if (!contexto) return res.status(404).json({ error: "Guía no encontrada" });
      const { ventas, retornos, stockCamion } = contexto;

      const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
      const anuladas = ventas.filter((v: any) => v.estado === 'Anulada');
      const cartonesVendidos = emitidas.reduce((a: number, v: any) => a + Number(v.cartones), 0);
    const detalle = cuadreGuiaData(guia, camion, ventas, retornos, contexto.etiquetasGuia, stockCamion, contexto.detalleCarga, contexto.desperdiciosGuia, contexto.catalogo, contexto.cuarentenas);
      const cartonesRetornados = detalle.retornados;
      const restanteCamion = detalle.restanteCamion;
      const totalCargado = detalle.cargado;
      const mermaPreliminar = detalle.merma;
      const gastosDeRuta = await db.query.gastos.findMany({ where: eq(schema.gastos.guiaId, guia.id) }).catch(() => [] as any[]);
      const gastosEfectivoRuta = round2(gastosDeRuta.filter((g: any) => (g.medioPago || 'Efectivo') === 'Efectivo')
        .reduce((s: number, g: any) => s + Number(g.monto || 0), 0));
      const efectivoNetoEsperado = round2(Number(detalle.efectivo || 0) - gastosEfectivoRuta);

      const cierreCajaExistente = await db.query.cierres_caja_ruta.findFirst({ where: eq(cierres_caja_ruta.guiaId, guia.id) });
      let cierreCaja = cierreCajaExistente || null;
      if (cierreCajaExistente && conteoInformado && cierreCajaExistente.efectivoContado != null
        && round2(Number(cierreCajaExistente.efectivoContado)) !== round2(Number(montoContado))) {
        return res.status(409).json({ error: 'El cierre de caja ya fue registrado con otro conteo. Solicite una corrección administrativa.', cierre: cierreCajaExistente });
      }
      if (cierreCajaExistente && conteoInformado && cierreCajaExistente.efectivoContado == null) {
        const diferencia = round2(Number(montoContado) - Number(cierreCajaExistente.efectivoEsperado || 0));
        const estadoCaja = Math.abs(diferencia) <= 0.01 ? 'Cuadrada' : 'DiferenciaPendiente';
        let aprobacionCajaId: string | null = null;
        await db.transaction(async (tx: any) => {
          if (estadoCaja === 'DiferenciaPendiente') {
            aprobacionCajaId = crypto.randomUUID();
            await tx.insert(aprobaciones).values({
              id: aprobacionCajaId, tipo: 'DiferenciaCaja', modulo: 'Finanzas', referenciaId: guia.id,
              solicitudUsuario: usuarioId, descripcion: `Diferencia de efectivo de ₡${diferencia.toLocaleString('es-CR')} en la guía ${guia.consecutivo}. Esperado ₡${Number(cierreCajaExistente.efectivoEsperado || 0).toLocaleString('es-CR')}; contado ₡${Number(montoContado).toLocaleString('es-CR')}.`,
              datos: JSON.stringify({ guiaId: guia.id, efectivoEsperado: Number(cierreCajaExistente.efectivoEsperado || 0), efectivoContado: Number(montoContado), diferencia }),
              estado: 'Pendiente', fechaSolicitud: new Date().toISOString(),
            });
          }
          await tx.update(cierres_caja_ruta).set({ efectivoContado: Number(montoContado), diferencia, estado: estadoCaja, aprobacionId: aprobacionCajaId }).where(eq(cierres_caja_ruta.id, cierreCajaExistente.id));
        });
        cierreCaja = { ...cierreCajaExistente, efectivoContado: Number(montoContado), diferencia, estado: estadoCaja, aprobacionId: aprobacionCajaId };
      }
      if (!cierreCaja) {
        const efectivoEsperado = efectivoNetoEsperado;
        const diferencia = conteoInformado ? round2(Number(montoContado) - efectivoEsperado) : null;
        const cierreId = crypto.randomUUID();
        const ahora = new Date().toISOString();
        const estadoCaja = !conteoInformado ? 'PendienteConteo' : (Math.abs(Number(diferencia)) <= 0.01 ? 'Cuadrada' : 'DiferenciaPendiente');
        let aprobacionCajaId: string | null = null;
        await db.transaction(async (tx: any) => {
          if (estadoCaja === 'DiferenciaPendiente') {
            aprobacionCajaId = crypto.randomUUID();
            await tx.insert(aprobaciones).values({
              id: aprobacionCajaId, tipo: 'DiferenciaCaja', modulo: 'Finanzas', referenciaId: guia.id,
              solicitudUsuario: usuarioId, descripcion: `Diferencia de efectivo de ₡${Number(diferencia).toLocaleString('es-CR')} en la guía ${guia.consecutivo}. Esperado ₡${efectivoEsperado.toLocaleString('es-CR')}; contado ₡${Number(montoContado).toLocaleString('es-CR')}.`,
              datos: JSON.stringify({ guiaId: guia.id, efectivoEsperado, efectivoContado: Number(montoContado), diferencia }),
              estado: 'Pendiente', fechaSolicitud: ahora,
            });
          }
          await tx.insert(cierres_caja_ruta).values({
            id: cierreId, guiaId: guia.id, vendedorId: guia.vendedorId || usuarioId, fecha: ahora.slice(0, 10),
            efectivoEsperado, gastosEfectivo: gastosEfectivoRuta, efectivoContado: montoContado, creditoDocumentado: Number(detalle.credito) || 0,
            diferencia, estado: estadoCaja, aprobacionId: aprobacionCajaId, creadoEn: ahora,
          });
          if (!guia.finDiaFecha) await tx.update(guias_despacho).set({ finDiaFecha: ahora }).where(eq(guias_despacho.id, guia.id));
        });
        cierreCaja = { id: cierreId, efectivoEsperado, gastosEfectivo: gastosEfectivoRuta, efectivoContado: montoContado, creditoDocumentado: Number(detalle.credito) || 0, diferencia, estado: estadoCaja, aprobacionId: aprobacionCajaId };
      }

      // Bloquear nuevas ventas hasta el cuadre en central
      if (!guia.finDiaFecha) {
        await db.update(guias_despacho).set({ finDiaFecha: new Date().toISOString() }).where(eq(guias_despacho.id, guia.id));
      }

      const clientesAtendidos = emitidas
        .filter((v: any) => v.clienteId)
        .map((v: any) => ({ clienteId: v.clienteId, tiquete: v.tiqueteConsecutivo, hora: v.fechaHora, total: v.total, cobro: v.cobro }));

      await logAudit(usuarioId, 'Cerrar', 'VentaRuta', guia.id, null, { cartonesVendidos, totalEfectivo: detalle.efectivo, totalCredito: detalle.credito, cartonesRetornados, restanteCamion, mermaPreliminar }, responsable || null);

      res.json({
        success: true,
        estado: 'CajaCerrada',
        guiaId: guia.id,
        cuadre: {
          tiquetesEmitidos: emitidas.length,
          tiquetesAnulados: anuladas.length,
          cartonesVendidos: detalle.vendidos,
          cartonesVendidosBrutos: cartonesVendidos,
          cartonesCargados: totalCargado,
          cartonesRetornados,
          restanteCamion,
          mermaPreliminar,
          retornoAceptado: detalle.retornoAceptado,
          retornoPendiente: detalle.retornoPendiente,
          saldoNoExplicado: detalle.saldoNoExplicado,
          diferenciaPendiente: detalle.diferenciaPendiente,
          tieneDiferencias: detalle.tieneDiferencias,
          porProducto: detalle.porProducto,
          totalEfectivo: detalle.efectivo,
          totalCredito: detalle.credito,
          totalTransferencia: detalle.transferencia,
          totalGenerado: detalle.totalGenerado,
          caja: cierreCaja,
        },
        clientesAtendidos
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CUADRE EN CENTRAL (F4) ====================

  const TOLERANCIA_MERMA_DEFAULT = 0.02;

  function cuadreGuiaData(
    guia: any, camion: any | null, ventas: any[], retornos: any[], etiquetasGuia: any[], stockCamion: any[],
    detalleCarga: any[] = [], desperdiciosGuia: any[] = [], catalogo: any[] = [], cuarentenas: any[] = []
  ) {
    const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
    const anuladas = ventas.filter((v: any) => v.estado === 'Anulada');
    const noEntregadas = etiquetasGuia.filter((e: any) => !['Entregada', 'Mermada'].includes(e.estado));
    const guiaEnKg = guia.totalKg != null;
    const cargadoPorProducto = detalleCarga.length
      ? detalleCarga.map((d: any) => ({ producto: d.producto, unidad: guiaEnKg ? 'kg' : 'cartones', cantidad: Number(guiaEnKg ? (d.cantidadKg ?? d.cartones) : d.cartones) || 0, ...(guiaEnKg ? { kgAutoritativo: true } : {}) }))
      : (() => {
          const productos = Array.from(new Set(etiquetasGuia.map((e: any) => e.producto).filter(Boolean)));
          if (productos.length === 1) return [{ producto: productos[0], unidad: guiaEnKg ? 'kg' : 'cartones', cantidad: Number(guiaEnKg ? guia.totalKg : guia.totalCartones) || 0, ...(guiaEnKg ? { kgAutoritativo: true } : {}) }];
          const mapa = new Map<string, number>();
          for (const e of etiquetasGuia) mapa.set(e.producto, (mapa.get(e.producto) || 0) + Number(guiaEnKg ? e.pesoNeto : e.cantidad || 0));
          // Datos históricos sin detalle por producto: reportar el desglose disponible
          // sin inventar una distribución del total agregado.
          return Array.from(mapa, ([producto, cantidad]) => ({ producto, unidad: guiaEnKg ? 'kg' : 'cartones', cantidad, ...(guiaEnKg ? { kgAutoritativo: true } : {}) }));
        })();
    const integral = calcularCuadreIntegral({
      guiaId: guia.id,
      cargadoPorProducto,
      ventasEmitidas: emitidas.map((v: any) => ({ producto: v.producto, unidad: v.unidad === 'kg' ? 'kg' : 'cartones', cantidad: Number(v.cantidadKg ?? v.cartones) || 0, ventaRutaId: v.id, ...(v.unidad === 'kg' ? { kgAutoritativo: true } : {}) })),
      devoluciones: retornos.map((r: any) => ({
        producto: r.producto, unidad: r.unidad || 'cartones', cantidad: Number(r.cartones) || 0, ...(r.unidad === 'kg' ? { kgAutoritativo: true } : {}),
        cantidadAceptada: r.cantidadAceptada == null ? null : Number(r.cantidadAceptada),
        ventaRutaId: r.ventaRutaId || null,
        estado: ['Recibido', 'Cerrado'].includes(r.estado) ? 'AceptadoBodega' : (r.estado || 'Registrado'),
        tipo: r.tipo === 'sobrante' ? 'sobrante' : (r.tipo || 'completo'),
      })),
      mermaRegistrada: desperdiciosGuia.map((d: any) => ({
        producto: d.producto,
        unidad: guiaEnKg && d.unidad === 'kg' ? 'kg' : (d.unidad === 'kg' && d.cantidadCartones != null && Number.isFinite(Number(d.cantidadCartones)) ? 'cartones' : (d.unidad || 'cartones')),
        cantidad: guiaEnKg && d.unidad === 'kg' ? (Number(d.cantidad) || 0) : (d.unidad === 'kg' && d.cantidadCartones != null && Number.isFinite(Number(d.cantidadCartones)) ? Number(d.cantidadCartones) : (Number(d.cantidad) || 0)),
        ...(guiaEnKg && d.unidad === 'kg' ? { kgAutoritativo: true } : (d.unidad === 'kg' && (d.cantidadCartones == null || !Number.isFinite(Number(d.cantidadCartones))) ? { kgPorCartonSnapshot: d.factorKgPorCarton == null ? null : Number(d.factorKgPorCarton) } : {})),
        motivo: d.motivo || 'Sin motivo', responsable: d.responsable || 'Sin responsable',
      })),
      ajustesAprobados: cuarentenas.filter((c: any) => c.estado === 'Aprobada' || c.estado === 'Liberada').map((c: any) => ({
        producto: c.producto, unidad: c.unidad || 'cartones', cantidad: Math.abs(Number(c.cantidad) - Number(c.cantidadSistema)),
        diferenciaFirmada: Number(c.cantidad) - Number(c.cantidadSistema),
      })),
      sobranteFisicoCamion: stockCamion.map((i: any) => ({ producto: i.producto, unidad: i.unidad || 'cartones', cantidad: Number(i.cantidad) || 0, ...(i.unidad === 'kg' ? { kgAutoritativo: true } : {}) })),
      factoresKgPorCarton: Array.from(new Set([
        ...cargadoPorProducto.map((m: any) => m.producto),
        ...emitidas.map((m: any) => m.producto),
        ...retornos.map((m: any) => m.producto),
        ...desperdiciosGuia.map((m: any) => m.producto),
        ...stockCamion.map((m: any) => m.producto),
      ])).map((producto: any) => {
        const item = productoCatalogoPara(producto, catalogo);
        return { producto, kgPorCarton: item?.unidad === 'cartones' ? item.kgPorCarton : null };
      }),
    });

    const cargado = integral.totalCargado || Number(guia.totalCartones) || 0;
    const retornados = retornos.reduce((a: number, r: any) => a + Number(r.cartones || 0), 0);
    const restanteCamion = stockCamion.reduce((a: number, i: any) => a + Number(i.cantidad || 0), 0);
    const cartonesReingresar = restanteCamion;
    const merma = integral.totalMermaRegistrada;
    const mermaPct = cargado > 0 ? merma / cargado : 0;
    const descuadreFisico = integral.totalDiferenciaPendiente;
    const mermaPorProducto = integral.porProducto.filter((l: any) => l.mermaRegistrada > 0).map((l: any) => ({
      producto: l.producto, cargado: l.cargado, reingresar: l.retornoAceptado + l.sobranteFisicoCamion,
      merma: l.mermaRegistrada,
    }));
    const dinero = resumenDineroVentasRuta(ventas, retornos);

    return {
      guiaId: guia.id, consecutivo: guia.consecutivo, estado: guia.estado, finDiaFecha: guia.finDiaFecha || null,
      camionNombre: camion?.nombre || guia.camionId || null,
      cargado, vendidos: integral.totalVendidoNeto,
      cartonesAnulados: anuladas.reduce((a: number, v: any) => a + Number(v.cartones || 0), 0),
      retornados, cartonesReingresar, restanteCamion, merma, mermaPct, descuadreFisico, mermaPorProducto,
      efectivo: dinero.efectivo, credito: dinero.credito, transferencia: dinero.transferencia, totalGenerado: dinero.totalGenerado,
      porProducto: integral.porProducto, saldoNoExplicado: integral.totalSaldoNoExplicado,
      diferenciaPendiente: integral.totalDiferenciaPendiente, tieneDiferencias: integral.tieneDiferencias,
      diferencias: integral.diferencias, retornoAceptado: integral.totalRetornoAceptado,
      retornoPendiente: integral.totalRetornoPendiente, tieneRetornosPendientes: integral.tieneRetornosPendientes,
      retornoRechazado: integral.totalRetornoRechazado,
      saldoBajoCustodiaCamion: integral.totalSaldoBajoCustodiaCamion,
      conversionesPendientes: integral.conversionesPendientes,
      puedeCerrarSinDiferencia: integral.puedeCerrarSinDiferencia,
      detalleRetornos: retornos.map((r: any) => ({ id: r.id, etiquetaId: r.etiquetaId, producto: r.producto,
        cartones: Number(r.cartones), cantidadAceptada: Number(r.cantidadAceptada || 0), ventaRutaId: r.ventaRutaId || null,
        tipo: r.tipo || 'sobrante', peso: r.peso, estado: r.estado })),
      ajustesInventarioAprobados: integral.porProducto.filter((l: any) => l.ajusteInventarioAprobado !== 0).map((l: any) => ({ producto: l.producto, unidad: l.unidad, diferenciaFirmada: l.ajusteInventarioAprobado })),
      etiquetasReingresar: noEntregadas.map((e: any) => ({ etiquetaId: e.id, codigoUnico: e.codigoUnico,
        producto: e.producto, cartones: Number(e.cantidad), estado: e.estado })),
      totalDiferenciaPendiente: integral.totalDiferenciaPendiente,
    };
  }

  async function cargarContextoCuadre(tx: any, guiaId: string) {
    const guia = await tx.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
    if (!guia) return null;
    const camion = guia.camionId ? await tx.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
    const [ventasRutaLegacy, ventasRutaKg, retornosLegacy, stockCamion, etiquetasGuia, detalleCarga, desperdiciosTodas, facturasGuia, catalogo, cuarentenas] = await Promise.all([
      tx.query.ventas_ruta.findMany({ where: eq(ventas_ruta.guiaId, guiaId) }),
      tx.query.ventas_ruta_kg.findMany({ where: eq(ventas_ruta_kg.guiaId, guiaId) }).catch(() => []),
      tx.query.retornos_camion.findMany({ where: eq(retornos_camion.guiaId, guiaId) }),
      camion ? tx.query.inventario.findMany({ where: eq(inventario.ubicacion, camion.nombre) }) : Promise.resolve([]),
      tx.query.etiquetas.findMany({ where: eq(etiquetas.guiaDespachoId, guia.id) }),
      tx.query.guias_despacho_detalle.findMany({ where: eq(guias_despacho_detalle.guiaId, guiaId) }),
      tx.query.desperdicios.findMany({ where: eq(desperdicios.guiaId, guiaId) }),
      tx.query.facturas.findMany({ where: eq(facturas.guiaId, guiaId) }),
      tx.query.productosCatalogo.findMany(),
      tx.query.inventario_cuarentena.findMany({ where: eq(schema.inventario_cuarentena.guiaId, guiaId) }),
    ]);
    const facturaIds = facturasGuia.map((factura: any) => factura.id);
    const detallesTodas = facturaIds.length
      ? await tx.query.detallesFactura.findMany({ where: inArray(schema.detallesFactura.facturaId, facturaIds) })
      : [];
    const ventasRuta = [...ventasRutaLegacy, ...ventasRutaKg.map((v: any) => ({ ...v, cartones: Number(v.cantidadKg), cantidadKg: Number(v.cantidadKg), precioUnitario: Number(v.precioKg), cantidadInventario: v.cantidadInventario, unidad: 'kg', kgAutoritativo: true }))];
    // Los retornos ya viven una sola vez en retornos_camion. En guías kg se
    // respetan los que tienen unidad explícita; filas antiguas ligadas a un
    // tiquete kg heredan kg para evitar convertirlas o sumarlas dos veces.
    const retornos = retornosLegacy.map((r: any) => {
      const ventaKg = ventasRutaKg.find((v: any) => v.id === r.ventaRutaId);
      if (!ventaKg || r.unidad === 'kg') return r;
      return { ...r, unidad: 'kg', cartones: Number(r.cartones), kgAutoritativo: true };
    });
    const desperdiciosGuia = desperdiciosTodas.filter((d: any) => ['Ruta', 'Camion', 'Camión', 'Cuadre Central'].includes(d.origen));
    const facturasYaRepresentadas = new Set(ventasRuta.map((v: any) => v.facturaId).filter(Boolean));
    const ventasDeFactura = facturasGuia
      .filter((f: any) => f.estado !== 'Anulada' && !facturasYaRepresentadas.has(f.id))
      .flatMap((f: any) => {
        const lineas = detallesTodas.filter((d: any) => d.facturaId === f.id);
        const subtotalLineas = lineas.reduce((s: number, d: any) => s + Number(d.subtotal || 0), 0);
        return lineas.map((d: any) => {
          const proporcion = subtotalLineas > 0 ? Number(d.subtotal || 0) / subtotalLineas : 0;
          const totalNeto = Number(d.subtotal || 0) - Number(f.descuento || 0) * proporcion;
          return {
            id: `${f.id}:${d.id}`, facturaId: f.id, guiaId, camionId: f.camionId || guia.camionId,
            tiqueteConsecutivo: f.consecutivo, fechaHora: f.fecha, clienteId: f.clienteId,
            producto: d.producto, cartones: Number(d.cantidad) || 0, precioUnitario: Number(d.precio_unitario) || 0,
            subtotal: Number(d.subtotal) || 0, descuento: Number(d.subtotal || 0) - totalNeto,
            total: totalNeto, cobro: f.condicion_pago === 'Credito' ? 'Credito' : 'Efectivo', estado: 'Emitida',
          };
        });
      });
    const ventas = [...ventasRuta, ...ventasDeFactura];
    return { guia, camion, ventas, retornos, stockCamion, etiquetasGuia, detalleCarga, desperdiciosGuia, catalogo, cuarentenas };
  }

  app.get("/api/logistica/cuadre-central", requirePermission('inventario_bodega', 'view'), async (req, res) => {
    try {
      const guiaId = req.query.guiaId as string;
      if (!guiaId) return res.status(400).json({ error: "Se requiere guiaId" });
      const ctx = await cargarContextoCuadre(db, guiaId);
      if (!ctx) return res.status(404).json({ error: "Guía no encontrada" });
      if (ctx.guia.estado === 'Cerrada' || ctx.guia.estado === 'Anulada') {
        return res.status(400).json({ error: `La guía ya quedó ${ctx.guia.estado.toLowerCase()}` });
      }
      if (!ctx.guia.finDiaFecha) {
        return res.status(409).json({ error: "La caja aún no ha cerrado el día (fin de día pendiente en el dispositivo del vendedor)" });
      }
      const cuadre = cuadreGuiaData(ctx.guia, ctx.camion, ctx.ventas, ctx.retornos, ctx.etiquetasGuia, ctx.stockCamion, ctx.detalleCarga, ctx.desperdiciosGuia, ctx.catalogo, ctx.cuarentenas);
      const tieneRetornoRechazado = cuadre.retornoRechazado > 0;
      res.json({ success: true, puedeCuadrar: !cuadre.tieneRetornosPendientes && !tieneRetornoRechazado && cuadre.saldoBajoCustodiaCamion <= 0.0001,
        requiereAprobacion: cuadre.tieneDiferencias || cuadre.tieneRetornosPendientes || tieneRetornoRechazado || cuadre.conversionesPendientes.length > 0 || cuadre.merma > TOLERANCIA_MERMA_DEFAULT * cuadre.cargado,
        toleranciaMermaDefault: TOLERANCIA_MERMA_DEFAULT, cuadre });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistica/cuadre-central", requirePermission('aprobaciones', 'approve'), async (req, res) => {
    try {
      const { guiaId, responsable, pesoLlegada, mermaMotivo, toleranciaMerma } = req.body || {};
      const usuarioId = String((req as any).usuario?.id || '');
      if (!guiaId) return res.status(400).json({ error: "Se requiere guiaId" });

      const ctx = await cargarContextoCuadre(db, guiaId);
      if (!ctx) return res.status(404).json({ error: "Guía no encontrada" });
      if (ctx.guia.estado === 'Cerrada' || ctx.guia.estado === 'Anulada') {
        return res.status(400).json({ error: `La guía ya quedó ${ctx.guia.estado.toLowerCase()}` });
      }
      if (!ctx.guia.finDiaFecha) {
        return res.status(409).json({ error: "La caja aún no ha cerrado el día (fin de día pendiente en el dispositivo del vendedor)" });
      }

      const tolerancia = Number(toleranciaMerma) >= 0 ? Number(toleranciaMerma) : TOLERANCIA_MERMA_DEFAULT;
      const resultado: any = {};

      await db.transaction(async (tx) => {
        const inner = await cargarContextoCuadre(tx, guiaId);
        if (!inner) throw new ApiError(404, "Guía no encontrada");
        if (inner.guia.estado === 'Cerrada' || inner.guia.estado === 'Anulada') {
          throw new ApiError(409, `La guía ya quedó ${inner.guia.estado.toLowerCase()}`);
        }
        const { guia, camion, ventas, etiquetasGuia, detalleCarga, desperdiciosGuia } = inner;
        // La aceptación física pertenece exclusivamente al endpoint de Bodega.
        // El cuadre administrativo nunca puede cambiar ese estado ni inventario.
        const retornosFinales = await tx.query.retornos_camion.findMany({ where: eq(retornos_camion.guiaId, guia.id) });
        const pendientesAceptacion = retornosFinales.filter((r: any) => ['Registrado', 'PendienteBodega'].includes(r.estado)
          && Number(r.cartones) > Number(r.cantidadAceptada || 0));
        if (pendientesAceptacion.length) {
          throw new ApiError(409, `Hay ${pendientesAceptacion.length} retorno(s) pendiente(s) de aceptación física. Bodega debe aceptarlos o rechazarlos antes del cuadre.`);
        }
        if (retornosFinales.some((r: any) => r.estado === 'RechazadoBodega' && Number(r.cartones) > Number(r.cantidadAceptada || 0))) {
          throw new ApiError(409, 'Hay retornos rechazados por Bodega que siguen bajo custodia. Resuélvalos con una nueva revisión antes de cuadrar la guía.');
        }
        const stockCamion = camion ? await tx.query.inventario.findMany({ where: eq(inventario.ubicacion, camion.nombre) }) : [];
        const cuadre = cuadreGuiaData(guia, camion, ventas, retornosFinales, etiquetasGuia, stockCamion, detalleCarga, desperdiciosGuia, inner.catalogo, inner.cuarentenas);
        if (cuadre.conversionesPendientes.length) {
          resultado.advertenciasConversion = cuadre.conversionesPendientes;
        }
        if (cuadre.saldoBajoCustodiaCamion > 0.0001) {
          throw new ApiError(409, `No se puede cerrar la guía: quedan ${cuadre.saldoBajoCustodiaCamion} cartones bajo custodia del camión. Bodega debe contar y aceptar físicamente ese saldo.`);
        }

        // 1. Reingresar todo el stock físicamente contado que Bodega acaba de
        //    aceptar. Si sigue en el camión, no se cierra ni siquiera con aprobación.
        if (camion) {
          for (const item of stockCamion) {
            const stockAntes = Number(item.cantidad) || 0;
            const qty = stockAntes;
            const quedaEnCamion = 0;
            if (qty > 0) {
              const bodegaItem = await tx.query.inventario.findFirst({
                where: and(eq(inventario.producto, item.producto), eq(inventario.ubicacion, 'Bodega Central'), eq(inventario.unidad, item.unidad || 'cartones'))
              });
              if (bodegaItem) {
                if (bodegaItem.unidad !== item.unidad) throw new ApiError(409, `La unidad del retorno (${item.unidad}) no coincide con Bodega (${bodegaItem.unidad}) para ${item.producto}.`);
                await tx.update(inventario)
                  .set({ cantidad: Number(bodegaItem.cantidad) + qty, ultima_actualizacion: new Date().toISOString() })
                  .where(eq(inventario.id, bodegaItem.id));
              } else {
                await tx.insert(inventario).values({
                  id: crypto.randomUUID(), producto: item.producto, cantidad: qty, unidad: item.unidad || 'cartones',
                  ubicacion: 'Bodega Central', ultima_actualizacion: new Date().toISOString()
                });
              }
              await tx.insert(movimientosInventario).values({
                id: crypto.randomUUID(), producto: item.producto, cantidad: qty, tipo: 'Retorno Camión',
                unidad: item.unidad || 'cartones',
                origen: camion.nombre, destino: 'Bodega Central', fecha: new Date().toISOString(), referencia_id: guia.id
              });
            }
            await tx.update(inventario)
              .set({ cantidad: quedaEnCamion, ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, item.id));
          }
        }

        // 2. Solo es posible cerrar cuando no quedan retornos en disputa ni
        //    inventario físico bajo custodia del camión.
        for (const etiqueta of etiquetasGuia as any[]) {
          if (['Entregada', 'Mermada'].includes(etiqueta.estado)) continue;
          await tx.update(etiquetas)
            .set({ estado: 'EnBodega', ubicacionActual: 'Bodega Central', guiaDespachoId: null })
            .where(eq(etiquetas.id, etiqueta.id));
          await recordEventTx(tx, etiqueta.id, 'Reingresada', 'Bodega Central', guia.id, usuarioId, 'Cuadre central');
        }
        // Merma es únicamente la registrada antes del cuadre; no fabricar
        // desperdicio desde el residuo y no duplicar registros existentes.
        const desperdiciosRegistrados = desperdiciosGuia.map((d: any) => ({ producto: d.producto, cantidad: Number(d.cantidad), motivo: d.motivo, impactoFinanciero: Number(d.impactoFinanciero || 0) }));

        // 3. Decisión: diferencias por producto y retornos pendientes nunca se
        //    ocultan como merma; requieren revisión antes de liberar el camión.
        const descuadreFisico = cuadre.tieneDiferencias;
        const conversionPendiente = cuadre.conversionesPendientes.length > 0;
        const excedeMerma = cuadre.merma > tolerancia * cuadre.cargado;
        const requiereAprobacion = descuadreFisico || cuadre.tieneRetornosPendientes || conversionPendiente || excedeMerma;

        let aprobacionId: string | null = null;
        if (requiereAprobacion) {
          const tipo = cuadre.tieneRetornosPendientes ? 'RetornoPendiente' : (descuadreFisico || conversionPendiente ? 'DiferenciaCuadre' : 'MermaDescuadre');
          const descripcion = cuadre.tieneRetornosPendientes
            ? `Quedan ${cuadre.retornoPendiente} cartones pendientes de aceptación en Bodega en la guía ${guia.consecutivo}.`
            : (descuadreFisico || conversionPendiente
              ? `Diferencias pendientes en guía ${guia.consecutivo}: ${cuadre.diferencias.map((d: any) => `${d.tipo === 'positivo' ? 'faltan' : 'sobran'} ${d.cantidad} ${d.unidad} de ${d.producto}`).join('; ')}${conversionPendiente ? `; falta factor kg/cartón para ${cuadre.conversionesPendientes.map((c: any) => c.producto).join(', ')}` : ''}`
              : `Merma registrada ${cuadre.merma}ct (${(cuadre.mermaPct * 100).toFixed(2)}%) excede tolerancia ${(tolerancia * 100).toFixed(1)}% en guía ${guia.consecutivo}`);
          aprobacionId = crypto.randomUUID();
          await tx.insert(aprobaciones).values({
            id: aprobacionId, tipo, modulo: 'Logistica', referenciaId: guia.id,
            solicitudUsuario: usuarioId, descripcion,
            datos: JSON.stringify({ cuadre, motivoMerma: mermaMotivo || null, toleranciaMerma: tolerancia }),
            estado: 'Pendiente', fechaSolicitud: new Date().toISOString()
          });
          await tx.update(guias_despacho)
            .set({ estado: 'CerradaConDiferencia', pesoLlegada: pesoLlegada != null ? Number(pesoLlegada) : (guia.pesoLlegada || null) })
            .where(eq(guias_despacho.id, guia.id));
          resultado.aprobacion = { id: aprobacionId, tipo, estado: 'Pendiente' };
        } else {
          await tx.update(guias_despacho)
            .set({
              estado: 'Cerrada',
              pesoLlegada: pesoLlegada != null ? Number(pesoLlegada) : (guia.pesoLlegada || null),
              firmasJson: JSON.stringify({ cierre: { responsable: responsable || null, fecha: new Date().toISOString(), cuadre } }),
              recibidoEn: new Date().toISOString()
            })
            .where(eq(guias_despacho.id, guia.id));
        }

        resultado.estado = requiereAprobacion ? 'CerradaConDiferencia' : 'Cerrada';
        resultado.cuadre = cuadre;
        resultado.descuadreFisico = descuadreFisico;
        resultado.excedeMerma = excedeMerma;
        resultado.desperdicios = desperdiciosRegistrados;
        resultado.retornosRecibidos = retornosFinales.filter((r: any) => r.estado === 'AceptadoBodega').length;
        resultado.etiquetasReingresadas = cuadre.etiquetasReingresar.length;
      });

      // Punto de custodia con báscula: peso de llegada del camión vs peso de salida (control de merma en central)
      if (pesoLlegada != null) {
        const primerProducto = (ctx.stockCamion[0] as any)?.producto || (ctx.etiquetasGuia[0] as any)?.producto || 'Carga (mixto)';
        const cartonesRetorno = Number(resultado.cuadre.retornados) || Number(resultado.cuadre.cartonesReingresar) || 0;
        await registrarPesoPunto({
          referenciaId: guiaId,
          tipoReferencia: 'Cuadre Central',
          producto: primerProducto,
          cantidadUnidades: cartonesRetorno,
          pesoEsperado: ctx.guia.pesoSalida,
          pesoReal: Number(pesoLlegada),
          responsable: responsable || usuarioId,
          ubicacion: 'Bodega Central',
          observaciones: `Retorno confirmado guía ${ctx.guia.consecutivo}`
        });
      }

      await logAudit(usuarioId, 'Cerrar', 'CuadreCentral', guiaId, null, {
        estado: resultado.estado, ...resultado.cuadre, aprobacion: resultado.aprobacion?.id || null
      }, responsable || null);

      res.json({
        success: true,
        message: resultado.estado === 'Cerrada'
          ? 'Guía cuadrada en central: cartones, dinero y retornos conciliados'
          : `Guía con diferencia — solicitud de aprobación ${resultado.aprobacion ? resultado.aprobacion.tipo : ''} creada. El siguiente despacho del camión queda bloqueado hasta resolverla`,
        estado: resultado.estado,
        cuadre: resultado.cuadre,
        aprobacion: resultado.aprobacion || null,
        desperdicios: resultado.desperdicios,
        retornosRecibidos: resultado.retornosRecibidos,
        etiquetasReingresadas: resultado.etiquetasReingresadas
      });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  app.get("/api/logistica/tablero", requirePermission('tablero_operativo', 'view'), async (req, res) => {
    try {
      const todasGuias = await db.query.guias_despacho.findMany({ where: notInArray(guias_despacho.estado, ['Cerrada', 'Anulada']) });
      const idsGuias = todasGuias.map((g: any) => g.id);
      const todosCamiones = await db.query.camiones.findMany();
      const ubicacionesCamionesActivos = Array.from(new Set<string>(todasGuias.map((g: any) => todosCamiones.find((c: any) => c.id === g.camionId)?.nombre).filter((nombre: any): nombre is string => Boolean(nombre))));
      const [todasVentasLegacy, todasVentasKg, todosRetornos, todasEtiquetas, todosClientes, todoInventario, todasRutas, todosUsers, todosDetallesCarga, todosDesperdicios, catalogoProductos] = await Promise.all([
        idsGuias.length ? db.query.ventas_ruta.findMany({ where: inArray(ventas_ruta.guiaId, idsGuias) }) : Promise.resolve([]),
        idsGuias.length ? db.query.ventas_ruta_kg.findMany({ where: inArray(ventas_ruta_kg.guiaId, idsGuias) }).catch(() => []) : Promise.resolve([]),
        idsGuias.length ? db.query.retornos_camion.findMany({ where: inArray(retornos_camion.guiaId, idsGuias) }) : Promise.resolve([]),
        idsGuias.length ? db.query.etiquetas.findMany({ where: inArray(etiquetas.guiaDespachoId, idsGuias) }) : Promise.resolve([]),
        db.query.clientes.findMany(),
        ubicacionesCamionesActivos.length ? db.query.inventario.findMany({ where: inArray(inventario.ubicacion, ubicacionesCamionesActivos) }) : Promise.resolve([]),
        db.query.rutas.findMany(),
        db.query.users.findMany(),
        idsGuias.length ? db.query.guias_despacho_detalle.findMany({ where: inArray(guias_despacho_detalle.guiaId, idsGuias) }) : Promise.resolve([]),
        idsGuias.length ? db.query.desperdicios.findMany({ where: inArray(desperdicios.guiaId, idsGuias) }) : Promise.resolve([]),
        db.query.productosCatalogo.findMany()
      ]);

      const ahora = new Date();
      const todasVentas = [...todasVentasLegacy, ...todasVentasKg.map((v: any) => ({ ...v, cantidadKg: Number(v.cantidadKg), cartones: Number(v.cantidadKg), precioUnitario: Number(v.precioKg), unidad: 'kg', kgAutoritativo: true }))];
      const agrupar = (filas: any[], llave: (fila: any) => string | null | undefined) => {
        const grupos = new Map<string, any[]>();
        for (const fila of filas) {
          const clave = llave(fila);
          if (clave == null) continue;
          const grupo = grupos.get(clave);
          if (grupo) grupo.push(fila); else grupos.set(clave, [fila]);
        }
        return grupos;
      };
      const ventasPorGuia = agrupar(todasVentas, (v: any) => v.guiaId);
      const retornosPorGuia = agrupar(todosRetornos, (r: any) => r.guiaId);
      const etiquetasPorGuia = agrupar(todasEtiquetas, (e: any) => e.guiaDespachoId);
      const cargaPorGuia = agrupar(todosDetallesCarga, (d: any) => d.guiaId);
      const mermaPorGuia = agrupar(todosDesperdicios, (d: any) => d.guiaId);
      const inventarioPorUbicacion = agrupar(todoInventario, (i: any) => i.ubicacion);
      const camionesPorId = new Map<string, any>(todosCamiones.map((c: any) => [c.id, c]));
      const rutasPorId = new Map<string, any>(todasRutas.map((r: any) => [r.id, r]));
      const usuariosPorId = new Map<string, any>(todosUsers.map((u: any) => [u.id, u]));
      const clientesPorId = new Map<string, any>(todosClientes.map((c: any) => [c.id, c]));

      const lineas = todasGuias.map((g: any) => {
        const camion = camionesPorId.get(g.camionId) || null;
        const ruta = rutasPorId.get(g.rutaId) || null;
        const vendedor = camion?.vendedor_id ? usuariosPorId.get(camion.vendedor_id) : null;
        const ventas = ventasPorGuia.get(g.id) || [];
        const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
        const anuladas = ventas.filter((v: any) => v.estado === 'Anulada');
        const retornos = retornosPorGuia.get(g.id) || [];

        const cartonesRetornados = retornos.reduce((a: number, r: any) => a + Number(r.cartones), 0);
        const detalleCarga = cargaPorGuia.get(g.id) || [];
        const guiaEnKg = g.totalKg != null;
        const etiquetasGuia = etiquetasPorGuia.get(g.id) || [];
        const cargadoPorProducto = etiquetasGuia
          .reduce((acc: any[], e: any) => {
            const actual = acc.find(x => x.producto === e.producto);
            const cantidad = Number(guiaEnKg ? e.pesoNeto : e.cantidad) || 0;
            if (actual) actual.cantidad += cantidad;
            else acc.push({ producto: e.producto, unidad: guiaEnKg ? 'kg' : 'cartones', cantidad, ...(guiaEnKg ? { kgAutoritativo: true } : {}) });
            return acc;
          }, []);
        if (detalleCarga.length) {
          cargadoPorProducto.splice(0, cargadoPorProducto.length, ...detalleCarga.map((d: any) => ({ producto: d.producto, unidad: guiaEnKg ? 'kg' : 'cartones', cantidad: Number(guiaEnKg ? (d.cantidadKg ?? d.cartones) : d.cartones) || 0, ...(guiaEnKg ? { kgAutoritativo: true } : {}) })));
        } else if (cargadoPorProducto.length === 1) cargadoPorProducto[0].cantidad = Number(guiaEnKg ? g.totalKg : g.totalCartones) || cargadoPorProducto[0].cantidad;
        const detalleTablero = calcularCuadreIntegral({
          guiaId: g.id,
          cargadoPorProducto: cargadoPorProducto.length ? cargadoPorProducto : (Number(g.totalKg ?? g.totalCartones) ? [{ producto: 'Carga (sin detalle)', unidad: guiaEnKg ? 'kg' : 'cartones', cantidad: Number(g.totalKg ?? g.totalCartones), ...(guiaEnKg ? { kgAutoritativo: true } : {}) }] : []),
          ventasEmitidas: emitidas.map((v: any) => ({ producto: v.producto, unidad: v.unidad === 'kg' ? 'kg' : 'cartones', cantidad: Number(v.cantidadKg ?? v.cartones) || 0, ventaRutaId: v.id, ...(v.unidad === 'kg' ? { kgAutoritativo: true } : {}) })),
          devoluciones: retornos.map((r: any) => ({ producto: r.producto, unidad: r.unidad || 'cartones', cantidad: Number(r.cartones) || 0, ...(r.unidad === 'kg' ? { kgAutoritativo: true } : {}),
            cantidadAceptada: r.cantidadAceptada == null ? null : Number(r.cantidadAceptada), ventaRutaId: r.ventaRutaId || null,
            estado: ['Recibido', 'Cerrado'].includes(r.estado) ? 'AceptadoBodega' : (r.estado || 'Registrado'), tipo: r.tipo === 'sobrante' ? 'sobrante' : (r.tipo || 'completo') })),
          mermaRegistrada: (mermaPorGuia.get(g.id) || []).filter((d: any) => ['Ruta', 'Camion', 'Camión', 'Cuadre Central'].includes(d.origen)).map((d: any) => ({ producto: d.producto, unidad: d.unidad || 'cartones', cantidad: Number(d.cantidad) || 0, ...(guiaEnKg && d.unidad === 'kg' ? { kgAutoritativo: true } : {}), motivo: d.motivo || '', responsable: d.responsable || '' })),
          sobranteFisicoCamion: camion ? (inventarioPorUbicacion.get(camion.nombre) || []).map((i: any) => ({ producto: i.producto, unidad: i.unidad || 'cartones', cantidad: Number(i.cantidad) || 0, ...(i.unidad === 'kg' ? { kgAutoritativo: true } : {}) })) : []
          ,factoresKgPorCarton: Array.from(new Set([
            ...cargadoPorProducto.map((m: any) => m.producto), ...emitidas.map((m: any) => m.producto),
            ...retornos.map((m: any) => m.producto),
            ...(mermaPorGuia.get(g.id) || []).map((m: any) => m.producto),
            ...(camion ? (inventarioPorUbicacion.get(camion.nombre) || []).map((m: any) => m.producto) : []),
          ])).map((producto: any) => {
            const item = productoCatalogoPara(producto, catalogoProductos);
            return { producto, kgPorCarton: item?.unidad === 'cartones' ? item.kgPorCarton : null };
          })
        });
        const dineroTablero = resumenDineroVentasRuta(ventas, retornos);
        const totalCargado = detalleTablero.totalCargado || Number(g.totalKg ?? g.totalCartones) || 0;
        const stockCamion = camion ? (inventarioPorUbicacion.get(camion.nombre) || []).reduce((a: number, i: any) => a + Number(i.cantidad), 0) : 0;
        const mermaPreliminar = 0; // La merma solo se muestra desde un registro explícito; el tablero no infiere residuo.
        const avance = totalCargado > 0 ? Math.round((detalleTablero.totalVendidoNeto / totalCargado) * 100) : 0;

        // Clientes atendidos con hora del servidor
        const clientesAtendidos = emitidas.filter((v: any) => v.clienteId).map((v: any) => {
          const c = clientesPorId.get(v.clienteId);
          return { clienteId: v.clienteId, nombre: c?.nombre || 'Cliente', codigoUnico: v.tiqueteConsecutivo, tiqueteConsecutivo: v.tiqueteConsecutivo, hora: v.fechaHora, total: v.total, cobro: v.cobro, producto: v.producto, cantidadKg: Number(v.cantidadKg ?? v.cartones ?? 0) };
        });
        const atendidosSet = new Set(clientesAtendidos.map((c: any) => c.clienteId));

        // Atrasados: clientes del orden sin venta cuya ventana de entrega ya pasó
        let rutaOrden: any[] = [];
        if (g.rutaOrdenJson) { try { rutaOrden = JSON.parse(g.rutaOrdenJson); } catch { /* noop */ } }
        const atrasados = rutaOrden
          .filter((c: any) => {
            if (!c.ventanaFin || atendidosSet.has(c.clienteId)) return false;
            const partes = String(c.ventanaFin).split(':').map(Number);
            if (isNaN(partes[0])) return false;
            return ahora.getHours() * 60 + ahora.getMinutes() > partes[0] * 60 + (partes[1] || 0);
          })
          .map((c: any) => ({ clienteId: c.clienteId, nombre: c.nombre, ventanaFin: c.ventanaFin, hora: ahora.toISOString() }));

        // Paradas con ubicación real del cliente para el mapa de ruta. La guía
        // conserva su orden original y el avance se deriva solo de tiquetes emitidos.
        const paradas = rutaOrden.map((parada: any, indice: number) => {
          const cliente = clientesPorId.get(parada.clienteId);
          const venta = clientesAtendidos
            .filter((atendida: any) => atendida.clienteId === parada.clienteId)
            .sort((a: any, b: any) => String(b.hora).localeCompare(String(a.hora)))[0];
          const latitud = cliente?.latitud == null ? null : Number(cliente.latitud);
          const longitud = cliente?.longitud == null ? null : Number(cliente.longitud);
          return {
            clienteId: parada.clienteId,
            nombre: cliente?.nombre || parada.nombre || 'Cliente',
            indice: indice + 1,
            latitud: latitud != null && Number.isFinite(latitud) ? latitud : null,
            longitud: longitud != null && Number.isFinite(longitud) ? longitud : null,
            direccion: [cliente?.direccion, cliente?.distrito, cliente?.canton, cliente?.provincia, 'Costa Rica'].filter(Boolean).join(', '),
            atendida: atendidosSet.has(parada.clienteId),
            tiqueteConsecutivo: venta?.tiqueteConsecutivo || null,
            fechaHora: venta?.hora || null,
            total: venta?.total ?? null,
          };
        });

        // Saltos de secuencia: números que no tienen tiquete (la anulación queda registrada y no se marca como salto)
        const numeros = ventas.map((v: any) => ({ numero: parseInt(String(v.tiqueteConsecutivo).replace(/^TQ-0*/, ''), 10) || 0, v }));
        const maxNum = numeros.length ? Math.max(...numeros.map((n: any) => n.numero)) : 0;
        const porNumero = new Map(numeros.map((n: any) => [n.numero, n.v]));
        const saltosSecuencia: { numero: number; tiquete: string }[] = [];
        for (let i = 1; i <= maxNum; i++) {
          if (!porNumero.has(i)) {
            saltosSecuencia.push({ numero: i, tiquete: `TQ-${String(i).padStart(4, '0')}` });
          }
        }

        return {
          guiaId: g.id,
          consecutivo: g.consecutivo,
          estado: g.estado,
          estadoLogico: estadoLogicoGuia(g),
          camionId: g.camionId,
          camionNombre: camion?.nombre || g.camionId || null,
          rutaId: g.rutaId,
          rutaNombre: ruta?.nombre || null,
          vendedorNombre: vendedor?.name || null,
          finDiaFecha: g.finDiaFecha || null,
          totalCargado,
          unidad: detalleTablero.porProducto.length > 0 && detalleTablero.porProducto.every((l: any) => l.unidad === detalleTablero.porProducto[0].unidad)
            ? detalleTablero.porProducto[0].unidad : 'unidades mixtas',
          cartonesVendidos: detalleTablero.totalVendidoNeto,
          cartonesRetornados,
          restanteCamion: stockCamion,
          mermaPreliminar,
          mermaRegistrada: detalleTablero.totalMermaRegistrada,
          retornoAceptado: detalleTablero.totalRetornoAceptado,
          retornoPendiente: detalleTablero.totalRetornoPendiente,
          retornoRechazado: detalleTablero.totalRetornoRechazado,
          saldoBajoCustodiaCamion: detalleTablero.totalSaldoBajoCustodiaCamion,
          saldoNoExplicado: detalleTablero.totalSaldoNoExplicado,
          diferenciaPendiente: detalleTablero.totalDiferenciaPendiente,
          tieneDiferencias: detalleTablero.tieneDiferencias,
          conversionesPendientes: detalleTablero.conversionesPendientes,
          porProducto: detalleTablero.porProducto,
          descuadreCustodia: detalleTablero.tieneDiferencias ? detalleTablero.totalDiferenciaPendiente : 0,
          totalEfectivo: dineroTablero.efectivo,
          totalCredito: dineroTablero.credito,
          totalTransferencia: dineroTablero.transferencia,
          totalGenerado: dineroTablero.totalGenerado,
          avance,
          tiquetesEmitidos: emitidas.length,
          tiquetesAnulados: anuladas.length,
          clientesAtendidos,
          paradas,
          totalClientes: rutaOrden.length,
          atrasados,
          saltosSecuencia,
          detalleEtiquetas: etiquetasGuia.map((e: any) => ({ etiquetaId: e.id, codigoUnico: e.codigoUnico, producto: e.producto, cartones: e.cantidad, estado: e.estado }))
        };
      });

      res.json({ fecha: ahora.toISOString(), guias: lineas });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
