import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { agingPorFacturas, dso as dsoDe, diasVencidoDe, estaSaldada, esCredito, round2, saldoDe } from '../../lib/cobranza';
import { clienteDisponibleParaUsuario, clientesVisiblesDelVendedor, tieneRol } from '../clientes-scope';

/** Registra la cartera, análisis y perfil 360 de clientes. */
export function registrarRutasCrmClientes(app: any, db: any, mapaPagadoPorFactura: (facturas: { id: string }[], pagosCargados?: any[]) => Promise<Map<string, number>>, requirePermission: (...args: any[]) => any) {
  const clientes = schema.clientes;
  function diasTranscurridos(fechaISO: string | null | undefined, ref = Date.now()): number {
    if (!fechaISO) return 0;
    const t = new Date(fechaISO).getTime();
    if (Number.isNaN(t)) return 0;
    return Math.floor((ref - t) / 86400000);
  }

  // Segmento por comportamiento de pago a partir de los días de mayor vencido.
  function comportamientoPago(diasVencidoMax: number): { clave: string; label: string } {
    if (diasVencidoMax <= 3) return { clave: 'Puntual', label: 'Puntual' };
    if (diasVencidoMax <= 15) return { clave: 'Atraso leve', label: 'Atraso leve' };
    if (diasVencidoMax <= 30) return { clave: 'Atraso frecuente', label: 'Atraso frecuente' };
    return { clave: 'Crónico', label: 'Crónico' };
  }

  // Score de riesgo 0–100 (menor = mejor). Sin scorecard único:
  // puntualidad 12m + uso de línea + frecuencia reciente (regla del boceto v6).
  function calcularScore(cliente: any, diasVencidoMax: number, facturas30d: number): { score: number; nivel: 'Bajo' | 'Medio' | 'Alto' } {
    const uso = Number(cliente.limite_credito || 0) > 0
      ? Math.min(1, Number(cliente.saldo_pendiente || 0) / Number(cliente.limite_credito))
      : 0;
    let score = 0;
    score += Math.min(45, diasVencidoMax * 1.15);              // hasta 45 pts por morosidad
    score += Math.min(35, uso * 40);                            // hasta 35 pts por uso de línea
    if (facturas30d <= 2) score += 8;                           // actividad reciente baja
    score = Math.round(Math.min(100, score));
    const nivel: 'Bajo' | 'Medio' | 'Alto' = score <= 40 ? 'Bajo' : score <= 70 ? 'Medio' : 'Alto';
    return { score, nivel };
  }

  async function cargarCartera() {
    const [clientesTbl, facturasTbl, ventasRutaTbl] = await Promise.all([
      db.query.clientes.findMany(),
      db.query.facturas.findMany().catch(() => []),
      db.query.ventas_ruta.findMany().catch(() => []),
    ]);
    const fechaRef = Date.now();
    const ultimoMes = fechaRef - 30 * 86400000;
    const ultimoTrimestre = fechaRef - 90 * 86400000;
    const ultimoAnio = fechaRef - 365 * 86400000;

    const agruparPorCliente = (filas: any[]) => {
      const grupos = new Map<string, any[]>();
      for (const fila of filas) {
        if (!fila.clienteId) continue;
        const grupo = grupos.get(fila.clienteId);
        if (grupo) grupo.push(fila); else grupos.set(fila.clienteId, [fila]);
      }
      return grupos;
    };
    const facturasPorCliente = agruparPorCliente(facturasTbl as any[]);
    const tiquetesPorCliente = agruparPorCliente(ventasRutaTbl as any[]);
    const facturasPorIdGlobal = new Map<string, any>((facturasTbl as any[]).map((f: any) => [f.id, f]));

    // El saldo ya descuenta lo pagado: `facturas.total` no es lo que se debe.
    const pagadoPorFactura = await mapaPagadoPorFactura(facturasTbl as any[]);

    // Archivados permanecen disponibles en su perfil 360 e historial, pero no
    // deben aparecer como cuentas activas en la cartera de trabajo.
    const filas = clientesTbl.filter((c: any) => c.estado !== 'Archivado').map((c: any) => {
      const facturasCliente = facturasPorCliente.get(c.id) || [];
      const facturasActivas = facturasCliente.filter((f: any) => f.estado !== 'Anulada');
      const facturas90d = facturasActivas.filter((f: any) => new Date(f.fecha).getTime() >= ultimoTrimestre);
      const facturas30d = facturasActivas.filter((f: any) => new Date(f.fecha).getTime() >= ultimoMes);
      const facturas12m = facturasActivas.filter((f: any) => new Date(f.fecha).getTime() >= ultimoAnio);

      const tiquetesCliente = (tiquetesPorCliente.get(c.id) || []).filter((v: any) => v.estado !== 'Anulada');
      const tiquetesSinFactura = tiquetesCliente.filter((v: any) => {
        const facturaVinculada = v.facturaId ? facturasPorIdGlobal.get(v.facturaId) : null;
        return !facturaVinculada || facturaVinculada.estado === 'Anulada';
      });
      const tiquetesSinFactura90d = tiquetesSinFactura.filter((v: any) => new Date(v.fechaHora).getTime() >= ultimoTrimestre);
      const tiquetesSinFactura30d = tiquetesSinFactura.filter((v: any) => new Date(v.fechaHora).getTime() >= ultimoMes);
      const tiquetesSinFactura12m = tiquetesSinFactura.filter((v: any) => new Date(v.fechaHora).getTime() >= ultimoAnio);
      const ventas90d = [
        ...facturas90d.map((f: any) => Number(f.total || 0)),
        ...tiquetesSinFactura90d.map((v: any) => Number(v.total || 0)),
      ];
      const ventas12mTotal = facturas12m.reduce((a: number, f: any) => a + Number(f.total || 0), 0) +
        tiquetesSinFactura12m.reduce((a: number, v: any) => a + Number(v.total || 0), 0);
      const ticketProm = ventas90d.length > 0 ? Math.round(ventas90d.reduce((a, total) => a + total, 0) / ventas90d.length) : 0;
      const monto90d = ventas90d.reduce((a, total) => a + total, 0);
      const pedidos30d = facturas30d.length + tiquetesSinFactura30d.length;

      // Días de mayor atraso y monto vencido, ya sobre el vencimiento real
      // (fecha + crédito) y solo sobre el saldo que queda. Antes se medía desde
      // `fecha` y se sumaba `total` de facturas que ni habían vencido, así que
      // "vencido" incluía dinero que aún no se debía.
      const pendientes = facturasCliente.filter((f: any) =>
        esCredito(f.condicion_pago) && !estaSaldada(f.estado));
      const conSaldo = pendientes.filter((f: any) =>
        saldoDe(f, pagadoPorFactura.get(f.id) ?? 0) > 0);

      const diasVencidoMax = conSaldo.length > 0
        ? Math.max(...conSaldo.map((f: any) => diasVencidoDe(f, fechaRef)))
        : 0;
      const vencido = round2(conSaldo.reduce((a: number, f: any) => {
        const saldo = saldoDe(f, pagadoPorFactura.get(f.id) ?? 0);
        // Solo lo que además ya pasó la fecha de vencimiento.
        return diasVencidoDe(f, fechaRef) > 0 ? a + saldo : a;
      }, 0));
      const carteraCliente = round2(conSaldo.reduce((a: number, f: any) =>
        a + saldoDe(f, pagadoPorFactura.get(f.id) ?? 0), 0));

      const comp = comportamientoPago(diasVencidoMax);
      const { score, nivel } = calcularScore(c, diasVencidoMax, pedidos30d);

      return {
        id: c.id,
        nombre: c.nombre,
        tipoDocumento: c.tipo_documento,
        documentoId: c.documento_id,
        telefono: c.telefono,
        email: c.email,
        direccion: c.direccion,
        provincia: c.provincia,
        canton: c.canton,
        distrito: c.distrito,
        ruta: c.ruta || '',
        condicionPago: c.condicion_pago,
        precioEspecial: c.precio_especial,
        limiteCredito: Number(c.limite_credito || 0),
        // El saldo real, derivado de las facturas. `clientes.saldo_pendiente`
        // se queda como campo propio del cliente para los otros que lo leen,
        // pero el aging necesita el que cuadra con `pagos`.
        saldoPendiente: carteraCliente,
        promedioCompra: c.promedio_compra || 0,
        notas: c.notas || '',
        fechaCreacion: c.fecha_creacion,
        segmento: monto90d >= 400000 ? 'A' : monto90d >= 120000 ? 'B' : 'C',
        comportamiento: comp.clave,
        pedidos90d: facturas90d.length + tiquetesSinFactura90d.length,
        ticketPromedio: ticketProm,
        monto90d,
        venta12m: Math.round(ventas12mTotal),
        usoLinea: ventas12mTotal > 0 || Number(c.saldo_pendiente || 0) > 0 ? Number(c.limite_credito || 0) > 0 ? Math.round((Number(c.saldo_pendiente || 0) / Number(c.limite_credito)) * 100) : 0 : 0,
        score,
        riesgo: nivel,
        diasVencido: diasVencidoMax,
        vencido,
        facturas30d: pedidos30d,
        tiquetes30d: tiquetesSinFactura30d.length,
        ultimaCompra: [...facturasActivas.map((f: any) => f.fecha), ...tiquetesSinFactura.map((v: any) => v.fechaHora)].filter(Boolean).sort().pop() || null,
      };
    });

    const ventaTotal12m = filas.reduce((a: number, f: any) => a + Number(f.venta12m || 0), 0);
    return { filas, ventaTotal12m, fechaRef };
  }

  // Cartera enriquecida (riesgo-score, segmento, ticket, uso de línea).
  app.get("/api/clientes/cartera", requirePermission('clientes', 'view'), async (req, res) => {
    try {
      const { filas } = await cargarCartera();
      const usuario = (req as any).usuario;
      const cartera = tieneRol(usuario, 'Comercial') && !tieneRol(usuario, 'Admin')
        ? await clientesVisiblesDelVendedor(db, String(usuario.id)).then(asignados => {
            const ids = new Set(asignados.map((c: any) => String(c.id)));
            return filas.filter((f: any) => ids.has(String(f.id)));
          })
        : filas;
      res.json({ total: cartera.length, clientes: cartera });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Panel "Hoy" + Segmentación del Análisis.
  app.get("/api/clientes/analisis", requirePermission('crm_insights', 'view'), async (req, res) => {
    try {
      const { filas, ventaTotal12m } = await cargarCartera();
      const fechaRef = Date.now();
      const iniMes = new Date(fechaRef); iniMes.setDate(1); iniMes.setHours(0, 0, 0, 0);
      const finMes = new Date(fechaRef);

      const [facturasTbl, ventasRutaTbl] = await Promise.all([
        db.query.facturas.findMany().catch(() => []),
        db.query.ventas_ruta.findMany().catch(() => []),
      ]);

      const facturasMes = facturasTbl.filter((f: any) => new Date(f.fecha) >= iniMes && new Date(f.fecha) <= finMes && f.estado !== 'Anulada');
      const tiquetesMes = ventasRutaTbl.filter((v: any) => new Date(v.fechaHora) >= iniMes && new Date(v.fechaHora) <= finMes && v.estado !== 'Anulada');
      const ventaMes = facturasMes.reduce((a: number, f: any) => a + Number(f.total || 0), 0) +
        tiquetesMes.reduce((a: number, v: any) => a + Number(v.total || 0), 0);

      // Un solo mapa de lo pagado por factura sirve para el DSO, el aging y la
      // lista de vencidas: leerlo una vez evita que las tres lecturas midan
      // cosas distintas.
      const pagadoPorFactura = await mapaPagadoPorFactura(facturasTbl as any[]);
      // DSO sobre facturas que están vencidas y tienen saldo.
      const dso = dsoDe(facturasTbl as any[], pagadoPorFactura, fechaRef);

      const carteraTotal = round2(filas.reduce((a: number, f: any) => a + Number(f.saldoPendiente || 0), 0));
      const vencidoTotal = round2(filas.reduce((a: number, f: any) => a + Number(f.vencido || 0), 0));
      const enRiesgo = filas.filter((f: any) => f.riesgo !== 'Bajo');

      // El aging se recalcula sobre las facturas con el helper compartido, para
      // que sus buckets no puedan apartarse de `diasVencido` ni de `vencido`
      // que ya salen de `cargarCartera`.
      const agingCrudo = agingPorFacturas(facturasTbl as any[], pagadoPorFactura, fechaRef);
      const aging = {
        alDia: round2(agingCrudo.alDia),
        d1_30: round2(agingCrudo.d1_30),
        d31_60: round2(agingCrudo.d31_60),
        d60: round2(agingCrudo.d60),
      };

      const worklist = filas
        .filter((f: any) => f.saldoPendiente > 0 || f.diasVencido > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 4)
        .map((f: any) => ({
          clienteId: f.id,
          nombre: f.nombre,
          score: f.score,
          diasVencido: f.diasVencido,
          saldo: f.saldoPendiente,
          usoLinea: f.usoLinea,
          riesgo: f.riesgo,
          siguientePaso: f.riesgo === 'Alto'
            ? 'Llamada + carta L4 (crédito en hold)'
            : f.riesgo === 'Medio'
              ? 'Gestionar vencido antes de cobrar (SLA 5d)'
              : 'Recordatorio suave + enlace de pago',
        }));

      const porSegmento = (['A', 'B', 'C'] as const).map((seg) => {
        const cuentas = filas.filter((f: any) => f.segmento === seg);
        return { segmento: seg, cuentas: cuentas.length, vencido: cuentas.reduce((a: number, f: any) => a + Number(f.vencido || 0), 0) };
      });

      // Ranking por venta 12m con nivel de riesgo (para Top 10 / Top 5).
      const topVenta = filas.slice().sort((a: any, b: any) => b.venta12m - a.venta12m).slice(0, 10)
        .map((f: any) => ({ nombre: f.nombre, venta12m: f.venta12m, riesgo: f.riesgo, score: f.score }));

      res.json({
        periodo: { etiqueta: finMes.toLocaleDateString('es', { month: 'long', year: 'numeric' }) },
        totalClientes: filas.length,
        ventaDelMes: Math.round(ventaMes),
        carteraTotal: Math.round(carteraTotal),
        vencidoTotal: Math.round(vencidoTotal),
        pctVencido: carteraTotal > 0 ? Math.round((vencidoTotal / carteraTotal) * 100) : 0,
        dso,
        bestPossible: Math.max(20, dso - 7),
        cei: 86,
        clientesEnRiesgo: enRiesgo.length,
        aging,
        worklist,
        porSegmento,
        topVenta,
        ventaTotal12m,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Perfil 360 del cliente: KPIs, facturas, tiquetes, mix, aging, documentos.
  app.get("/api/clientes/:id/360", requirePermission('clientes', 'view'), async (req, res) => {
    try {
      const { id } = req.params;
      const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, id) });
      if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
      if (!await clienteDisponibleParaUsuario(db, (req as any).usuario, id)) return res.status(404).json({ error: 'Cliente no encontrado en sus rutas asignadas.' });

      const fechaRef = Date.now();
      const desde30d = new Date(fechaRef - 30 * 86400000);

      const [facturasTbl, ventasRutaTbl, ventasRutaKgTbl, excepcionesTbl, catalogoTbl] = await Promise.all([
        db.query.facturas.findMany({ where: eq(schema.facturas.clienteId, id) }).catch(() => []),
        db.query.ventas_ruta.findMany({ where: eq(schema.ventas_ruta.clienteId, id) }).catch(() => []),
        db.query.ventas_ruta_kg.findMany({ where: eq(schema.ventas_ruta_kg.clienteId, id) }).catch(() => []),
        db.query.precioExcepcionesCliente.findMany({ where: eq(schema.precioExcepcionesCliente.clienteId, id) }).catch(() => []),
        db.query.productosCatalogo.findMany().catch(() => []),
      ]);
      const detallesTbl = facturasTbl.length > 0
        ? await db.query.detallesFactura.findMany({ where: inArray(schema.detallesFactura.facturaId, facturasTbl.map((f: any) => f.id)) }).catch(() => [])
        : [];

      const excepciones = excepcionesTbl.filter((e: any) => e.clienteId === id);

      const facturas = facturasTbl.filter((f: any) => f.clienteId === id);
      const tiquetes = [
        ...ventasRutaTbl,
        ...ventasRutaKgTbl.map((v: any) => ({ ...v, unidad: 'kg', cartones: v.cantidadKg, cantidadKg: v.cantidadKg })),
      ].filter((v: any) => v.clienteId === id && v.estado !== 'Anulada');
      const facturasPorId = new Map<string, any>(facturas.map((f: any) => [f.id, f]));
      const tiquetesSinFactura = tiquetes.filter((v: any) => {
        const facturaVinculada = v.facturaId ? facturasPorId.get(v.facturaId) : null;
        return !facturaVinculada || facturaVinculada.estado === 'Anulada';
      });
      const comprasRegistradas = [
        ...facturas.filter((f: any) => f.estado !== 'Anulada').map((f: any) => ({ fecha: f.fecha, monto: Number(f.total || 0) })),
        ...tiquetesSinFactura.map((v: any) => ({ fecha: v.fechaHora, monto: Number(v.total || 0) })),
      ];
      const parsePrecio = (raw: any) => {
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
      };
      const lineasFactura = (facturaId: string) => detallesTbl.filter((d: any) => d.facturaId === facturaId).map((d: any) => ({
        producto: d.producto, cantidad: Number(d.cantidad || 0), precioUnitario: Number(d.precio_unitario || 0),
        subtotal: Number(d.subtotal || 0), resolucionPrecio: parsePrecio(d.resolucionPrecioJson),
      }));

      const facturasAbiertas = facturas.filter((f: any) => !estaSaldada(f.estado));
      const pendientesCredito = facturasAbiertas.filter((f: any) => esCredito(f.condicion_pago));
      const pagosCliente = facturas.length > 0
        ? await db.query.pagos.findMany({ where: inArray(schema.pagos.facturaId, facturas.map((f: any) => f.id)) }).catch(() => [])
        : [];
      const pagadoPorFactura = await mapaPagadoPorFactura(facturas as any[], pagosCliente as any[]);
      // Vencida = pasado el vencimiento y con saldo. Antes era "más de 0 días
      // desde la emisión", que daba por vencida lo que aún no se debía.
      const vencidas = pendientesCredito.filter((f: any) =>
        diasVencidoDe(f, fechaRef) > 0 && saldoDe(f, pagadoPorFactura.get(f.id) ?? 0) > 0);
      const facturas30d = facturas.filter((f: any) => new Date(f.fecha) >= desde30d && f.estado !== 'Anulada');
      const tiquetesSinFactura30d = tiquetesSinFactura.filter((v: any) => new Date(v.fechaHora) >= desde30d);
      const ticketProm = comprasRegistradas.length > 0 ? Math.round(comprasRegistradas.reduce((s, compra) => s + compra.monto, 0) / comprasRegistradas.length) : 0;
      const pedidos30d = facturas30d.length + tiquetesSinFactura30d.length;
      const ultimaCompra = comprasRegistradas.map(c => c.fecha).filter(Boolean).sort().pop() || null;
      const diasUltima = ultimaCompra ? diasTranscurridos(ultimaCompra, fechaRef) : null;
      const fechaUnAno = new Date(fechaRef - 365 * 86400000);
      const venta12m = comprasRegistradas.filter(c => new Date(c.fecha) >= fechaUnAno).reduce((s, c) => s + c.monto, 0);
      const compras90d = comprasRegistradas.filter(c => new Date(c.fecha).getTime() >= fechaRef - 90 * 86400000);
      const venta90d = compras90d.reduce((s, c) => s + c.monto, 0);
      const segmento = venta90d >= 400000 ? 'A' : venta90d >= 120000 ? 'B' : 'C';

      const catalogoPorProducto = new Map((catalogoTbl as any[]).map(p => [String(p.nombre).trim().toLocaleLowerCase(), p]));
      const kilosDesdeCartones = (producto: string, cantidad: number) => {
        const ficha: any = catalogoPorProducto.get(String(producto).trim().toLocaleLowerCase());
        const factorKg = Number(ficha?.kgPorCarton || 0);
        return factorKg > 0 ? cantidad * factorKg : null;
      };
      const mix: Record<string, { kilos: number; monto: number; pesoPendiente: boolean }> = {};
      const detalles90: any[] = Array.isArray(detallesTbl) ? (detallesTbl as any[]) : [];
      if (facturas.length > 0 && detalles90.length > 0) {
        const ids90 = new Set(facturas.filter((f: any) => f.estado !== 'Anulada' && new Date(f.fecha) >= new Date(fechaRef - 90 * 86400000)).map((f: any) => f.id));
        for (const d of detalles90) {
          if (ids90.has(d.facturaId)) {
            mix[d.producto] = mix[d.producto] || { kilos: 0, monto: 0, pesoPendiente: false };
            // Las líneas de factura vigentes se registran en kg. Los documentos
            // antiguos que declaren explícitamente cartones se convierten solo
            // cuando la ficha del producto tiene un peso por cartón configurado.
            const resolucion = parsePrecio(d.resolucionPrecioJson);
            const unidadDetalle = String(d.unidad || d.unidadInventario || resolucion?.unidad || '').toLowerCase();
            const cantidad = Number(d.cantidadKg ?? d.cantidad ?? 0);
            const kg = d.cantidadKg != null || unidadDetalle === 'kg'
              ? cantidad
              : unidadDetalle.includes('cart')
                ? kilosDesdeCartones(d.producto, cantidad)
                : cantidad;
            if (kg == null) mix[d.producto].pesoPendiente = true;
            else mix[d.producto].kilos += kg;
            mix[d.producto].monto += Number(d.subtotal || 0);
          }
        }
      }
      for (const venta of tiquetesSinFactura.filter((v: any) => new Date(v.fechaHora) >= new Date(fechaRef - 90 * 86400000))) {
        mix[venta.producto] = mix[venta.producto] || { kilos: 0, monto: 0, pesoPendiente: false };
        const cantidad = Number(venta.cantidadKg ?? venta.cartones ?? 0);
        const kg = venta.cantidadKg != null || venta.unidad === 'kg'
          ? cantidad
          : kilosDesdeCartones(venta.producto, cantidad);
        if (kg == null) mix[venta.producto].pesoPendiente = true;
        else mix[venta.producto].kilos += kg;
        mix[venta.producto].monto += Number(venta.total || 0);
      }
      const mixArr = Object.entries(mix).map(([producto, v]: any) => ({ producto, ...v })).sort((a: any, b: any) => b.monto - a.monto);

      const documentos = [
        ...facturas.map((f: any) => ({ tipo: 'Factura' as const, consecutivo: f.consecutivo, monto: Number(f.total || 0), fecha: f.fecha, estado: f.estado })),
        ...tiquetesSinFactura.map((v: any) => ({ tipo: 'Tiquete' as const, consecutivo: v.tiqueteConsecutivo, monto: Number(v.total || 0), fecha: v.fechaHora, estado: v.estado })),
      ].sort((a: any, b: any) => (a.fecha < b.fecha ? 1 : -1));

      res.json({
        cliente: {
          id: cliente.id, nombre: cliente.nombre, tipoDocumento: cliente.tipo_documento, documentoId: cliente.documento_id,
          telefono: cliente.telefono, email: cliente.email, direccion: cliente.direccion,
          provincia: cliente.provincia, canton: cliente.canton, distrito: cliente.distrito, ruta: cliente.ruta,
          segmento, monto90d: venta90d, pedidos90d: compras90d.length,
          condicionPago: cliente.condicion_pago, precioEspecial: cliente.precio_especial,
          limiteCredito: Number(cliente.limite_credito || 0), saldoPendiente: Number(cliente.saldo_pendiente || 0), notas: cliente.notas,
        },
        kpis: {
          pedidos30d, ticketProm, ultimaCompra, diasUltima, venta12m,
          deuda: Number(cliente.saldo_pendiente || 0),
          usoLinea: Number(cliente.limite_credito || 0) > 0 ? Math.round((Number(cliente.saldo_pendiente || 0) / Number(cliente.limite_credito)) * 100) : 0,
          facturasAbiertas: facturasAbiertas.length,
          montoPorCobrar: facturasAbiertas.reduce((a: number, f: any) => a + saldoDe(f, pagadoPorFactura.get(f.id) ?? 0), 0),
          vencidas: vencidas.length,
          tiquetes30d: tiquetesSinFactura30d.length,
          montoTiquetes30d: tiquetesSinFactura30d.reduce((a: number, v: any) => a + Number(v.total || 0), 0),
          ultimoTiquete: tiquetes.length > 0 ? { consecutivo: tiquetes.map((t: any) => t.tiqueteConsecutivo).sort().pop(), fecha: tiquetes.map((t: any) => t.fechaHora).sort().pop() } : null,
        },
        facturas: facturas.map((f: any) => ({
          id: f.id, consecutivo: f.consecutivo, fecha: f.fecha, total: Number(f.total || 0),
          condicionPago: f.condicion_pago, estado: f.estado,
          diasVencido: f.estado === 'Pagada' ? 0 : diasTranscurridos(f.fecha, fechaRef),
          lineas: lineasFactura(f.id),
        })),
        tiquetes: tiquetes.map((v: any) => ({
          id: v.id, consecutivo: v.tiqueteConsecutivo, fecha: v.fechaHora, monto: Number(v.total || 0),
          cobro: v.cobro, estado: v.estado, producto: v.producto, cantidad: Number(v.cartones || 0),
          precioUnitario: Number(v.precioUnitario || 0), facturaId: v.facturaId || null,
          facturaConsecutivo: v.facturaId ? facturasPorId.get(v.facturaId)?.consecutivo || null : null,
          resolucionPrecio: parsePrecio(v.resolucionPrecioJson),
        })),
        documentos,
        mix: mixArr,
        excepciones: excepciones.map((e: any) => {
          const hoy = new Date(fechaRef).toISOString().slice(0, 10);
          const inicio = e.fechaInicio ? String(e.fechaInicio).slice(0, 10) : null;
          const fin = e.fechaFin ? String(e.fechaFin).slice(0, 10) : null;
          const estadoVigencia = e.estado !== 'Activa' ? 'Inactiva'
            : (inicio && inicio > hoy ? 'Programada' : (fin && fin < hoy ? 'Vencida' : 'Vigente'));
          return {
            id: e.id, producto: (catalogoTbl as any[]).find((p: any) => p.id === e.productoId)?.nombre || e.productoId,
            precioBase: (catalogoTbl as any[]).find((p: any) => p.id === e.productoId)?.precioBase || 0,
            precioExcepcion: e.precioExcepcion, justificacion: e.justificacion || '', aprobadoPor: e.aprobadoPor || '',
            fechaInicio: inicio, fechaFin: fin, estado: e.estado, estadoVigencia,
          };
        }),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
