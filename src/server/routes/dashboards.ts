import { ETIQUETA_TIPO_DIFERENCIA } from '../../lib/opcionesRecepcion';
import { ingresosFacturadosDe, ingresosCobradosDe, cuentasPorCobrarDe, gastosDe } from '../../lib/finanzas';
import { and, gte, lt, sum } from 'drizzle-orm';
import * as schema from '../../db/schema';

/** Dashboards empresariales y de producción con fuentes financieras compartidas. */
export function registrarRutasDashboards(app: any, db: any, mapaPagadoPorFactura: (facturas: { id: string }[], pagosCargados?: any[]) => Promise<Map<string, number>>, requirePermission: (...args: any[]) => any) {
  // ==================== DASHBOARD ENTERPRISE ====================

  app.get("/api/dashboard/enterprise", requirePermission('dashboard', 'view'), async (req, res) => {
    try {
      const hoy = new Date().toISOString().split('T')[0];
      const manana = new Date(Date.parse(`${hoy}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      const hace7Dias = new Date(Date.parse(`${hoy}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
      const [todasFacturas, gastosHoy, produccionHoy, inventarioTotal, todasVacunaciones, todasOrdenes, desperdicioHoy, todosClientes, todasRutas, todosGalerones, recepcionesRecientes, ventasRutaHoy, pagosHoy, pagosAgregados] = await Promise.all([
        // Facturas y pagos conservan el historial completo: se requiere para cartera y aging.
        db.query.facturas.findMany(), db.query.gastos.findMany({ where: and(gte(schema.gastos.fecha, hoy), lt(schema.gastos.fecha, manana)) }), db.query.produccion_diaria.findMany({ where: and(gte(schema.produccion_diaria.fecha, hoy), lt(schema.produccion_diaria.fecha, manana)) }),
        db.query.inventario.findMany(), db.query.vacunaciones.findMany(),
        db.query.ordenes_mantenimiento.findMany(), db.query.desperdicios.findMany({ where: gte(schema.desperdicios.fecha, hace7Dias) }),
        db.query.clientes.findMany(), db.query.rutas.findMany(), db.query.galerones.findMany(),
        db.query.recepciones.findMany({ where: gte(schema.recepciones.fechaRecepcion, hace7Dias) }),
        db.query.ventas_ruta.findMany({ where: and(gte(schema.ventas_ruta.fechaHora, hoy), lt(schema.ventas_ruta.fechaHora, manana)) }).catch(() => [] as any[]),
        db.query.pagos.findMany({ where: and(gte(schema.pagos.fecha, hoy), lt(schema.pagos.fecha, manana)) }).catch(() => [] as any[]),
        db.select({ facturaId: schema.pagos.facturaId, monto: sum(schema.pagos.monto) }).from(schema.pagos).groupBy(schema.pagos.facturaId).catch(() => [] as any[])
      ]);

      const facturasHoy = todasFacturas.filter(f => String(f.fecha).startsWith(hoy));

      // Devengado y cobrado, por separado: una venta a crédito cuenta como ingreso
      // aunque no se haya cobrado. Antes `ingresosHoy` filtraba `estado ===
      // 'Pagada'` y por eso no incluía las facturas de crédito del mismo día.
      // `ingresosCobradosHoy` conserva ese número en efectivo para el bloque de
      // caja, sin que ninguno de los dos se confunda con el otro.
      const ingresosHoy = ingresosFacturadosDe(facturasHoy, ventasRutaHoy, { desde: hoy, hasta: hoy });
      const ingresosCobradosHoy = ingresosCobradosDe(
        facturasHoy,
        pagosHoy as any[],
        { desde: hoy, hasta: hoy },
        ventasRutaHoy as any[],
      );
      const gastosHoyTotal = gastosDe(gastosHoy as any[], { desde: hoy, hasta: hoy });
      const cartonesHoy = produccionHoy.filter(p => String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0);
      const stockBodega = inventarioTotal.filter(i => i.ubicacion === 'Bodega Central' && String(i.producto).includes('Huevos')).reduce((a, i) => a + Number(i.cantidad), 0);
      const avesVivas = todosGalerones.filter(g => g.estado !== 'Archivado').reduce((a, g) => a + (g.aves_en_produccion || 0), 0);
      const vacunasVencidas = todasVacunaciones.filter(v => v.estado === 'Programada' && v.fechaProgramada < hoy);
      const mantenimientosVencidos = todasOrdenes.filter(o => o.estado === 'Pendiente' && o.fechaProgramada < hoy);
      // Última jornada (7 días) para desperdicios y diferencias de recepción
      const impactoDesperdicio = desperdicioHoy.reduce((a, d) => a + Number(d.impactoFinanciero), 0);
      // Diferencias de recepción recientes (7 días): alertan aunque no sean del mismo día
      const recepcionesConDiferenciaRecientes = recepcionesRecientes.filter(r =>
        Number(r.diferenciaKg ?? r.diferencia) > 0
      );

      res.json({
        ingresosHoy, ingresosCobradosHoy, gastosHoy: gastosHoyTotal, utilidadNeta: ingresosHoy - gastosHoyTotal,
        cartonesProducidos: cartonesHoy, stockBodegaCentral: stockBodega, totalAvesVivas: avesVivas,
        facturasEmitidas: facturasHoy.length, clientesActivos: todosClientes.filter(c => c.estado === 'Activo' && c.id !== 'consumidor-final').length,
        rutasActivas: todasRutas.filter(r => r.estado === 'Activa').length,
        vacunasVencidas: vacunasVencidas.length, mantenimientosVencidos: mantenimientosVencidos.length,
        desperdiciosHoy: desperdicioHoy.length, impactoDesperdicioHoy: impactoDesperdicio,
        // Saldo real, no `SUM(total)` de las pendientes: así coincide con el
        // aging de la misma pantalla y una factura pagada a medias no cuenta doble.
        cuentasPorCobrar: cuentasPorCobrarDe(todasFacturas as any[], await mapaPagadoPorFactura(todasFacturas as any[], pagosAgregados as any[])),
        alertas: [
          ...vacunasVencidas.map(v => ({ tipo: 'Vacuna vencida', detalle: `${v.tipoVacuna} — ${v.granjaId}`, nivel: 'Crítica' })),
          ...mantenimientosVencidos.map(m => ({ tipo: 'Mantenimiento vencido', detalle: `${m.tipo} — ${m.activoId}`, nivel: 'Alta' })),
          ...recepcionesConDiferenciaRecientes.filter(r => r.tipoDiferencia === 'alerta').map(r => {
            const esperado = r.cantidadKgEsperada ?? r.cantidadEsperada;
            const recibido = r.cantidadKgRecibida ?? r.cantidadRecibida;
            const diferencia = Number(r.diferenciaKg ?? r.diferencia);
            const unidad = r.cantidadKgEsperada != null ? 'kg' : 'unidades';
            return { tipo: ETIQUETA_TIPO_DIFERENCIA.alerta, detalle: `Recepción: esperado ${esperado} ${unidad}, recibido ${recibido} ${unidad} (${diferencia > 0 ? 'faltan' : 'sobran'} ${Math.abs(diferencia)} ${unidad})${r.motivoDiferencia ? ` — ${r.motivoDiferencia}` : ''}`, nivel: 'Alta' };
          }),
          ...recepcionesConDiferenciaRecientes.filter(r => r.tipoDiferencia !== 'alerta').map(r => {
            const esperado = r.cantidadKgEsperada ?? r.cantidadEsperada;
            const recibido = r.cantidadKgRecibida ?? r.cantidadRecibida;
            const diferencia = Number(r.diferenciaKg ?? r.diferencia);
            const unidad = r.cantidadKgEsperada != null ? 'kg' : 'unidades';
            const tipo = r.tipoDiferencia === 'sobrante' ? ETIQUETA_TIPO_DIFERENCIA.sobrante : 'Diferencia en recepción';
            return { tipo, detalle: `Esperado ${esperado} ${unidad}, recibido ${recibido} ${unidad} (${diferencia > 0 ? 'faltan' : 'sobran'} ${Math.abs(diferencia)} ${unidad})${r.motivoDiferencia ? ` — ${r.motivoDiferencia}` : ''}`, nivel: 'Alta' };
          })
        ]
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/dashboard/produccion-detalle", requirePermission('produccion', 'view'), async (req, res) => {
    try {
      const hoy = new Date().toISOString().split('T')[0];
      const [todasGranjas, todosGalerones, todosLotes, todaProduccion, todasVacunaciones, todasOrdenes, todosDesperdicios, todoAlimento] = await Promise.all([
        db.query.granjas.findMany(), db.query.galerones.findMany(), db.query.lotes_aves.findMany(),
        db.query.produccion_diaria.findMany(), db.query.vacunaciones.findMany(),
        db.query.ordenes_mantenimiento.findMany(), db.query.desperdicios.findMany(),
        db.query.inventario_alimento.findMany()
      ]);

      const produccionHoy = todaProduccion.filter(p => String(p.fecha).startsWith(hoy));

      const porGranja = todasGranjas.map(g => {
        const galerones = todosGalerones.filter(gl => gl.granjaId === g.id);
        const galeronIds = galerones.map(gl => gl.id);
        const lotes = todosLotes.filter(l => galeronIds.includes(l.galeronId) && l.estado === 'Activo' && l.id !== 'NO_LOTE_ACTIVO');
        const produccion = produccionHoy.filter(p => p.granjaId === g.id);
        const cartones = produccion.filter(p => String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0);
        const aves = galerones.reduce((a, g) => a + (g.aves_en_produccion || 0), 0);
        const vacunasPendientes = todasVacunaciones.filter(v => v.granjaId === g.id && v.estado === 'Programada' && v.fechaProgramada < hoy);
        const mantenimientosPendientes = todasOrdenes.filter(o => o.estado === 'Pendiente' && o.fechaProgramada < hoy);
        const desperdiciosGranja = todosDesperdicios.filter(d => String(d.fecha).startsWith(hoy)).length;

        return {
          id: g.id, nombre: g.nombre, ubicacion: g.ubicacion, estado: g.estado,
          galerones: galerones.map(gl => {
            const glLotes = lotes.filter(l => l.galeronId === gl.id);
            const glProduccion = produccion.filter(p => p.galeronId === gl.id);
            const glCartones = glProduccion.filter(p => String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0);
            const glAves = gl.aves_en_produccion || 0;
            const glConsumo = todoAlimento.filter(a => a.galeron_id === gl.id);
            return {
              id: gl.id, nombre: gl.nombre, capacidad_maxima: gl.capacidad_maxima, estado: gl.estado,
              lotes: glLotes.map(l => ({ id: l.id, cantidad_inicial: l.cantidad_inicial, linea_genetica: l.linea_genetica, estado: l.estado })),
              cartones: glCartones, aves: glAves, consumoAlimentoTotal: glConsumo.reduce((a, c) => a + Number(c.cantidad_consumida), 0),
              ocupacion: gl.capacidad_maxima > 0 ? Math.round((glAves / gl.capacidad_maxima) * 100) : 0
            };
          }),
          cartones, aves, lotesActivos: lotes.length,
          vacunasPendientes: vacunasPendientes.length, mantenimientosPendientes: mantenimientosPendientes.length,
          desperdicios: desperdiciosGranja
        };
      });

      res.json({ porGranja, resumen: {
        totalGranjas: todasGranjas.filter(g => g.estado === 'Activo').length,
        totalGalerones: todosGalerones.filter(g => g.estado === 'Activo').length,
        totalLotes: todosLotes.filter(l => l.estado === 'Activo' && l.id !== 'NO_LOTE_ACTIVO').length,
        totalCartones: produccionHoy.filter(p => String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0),
        totalAves: todosGalerones.filter(g => g.estado !== 'Archivado').reduce((a, g) => a + Number(g.aves_en_produccion || 0), 0)
      }});
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });


}
