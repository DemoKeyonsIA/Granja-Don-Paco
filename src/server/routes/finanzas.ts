import { and, eq, gte, lt, sum } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { agingPorFacturas } from '../../lib/cobranza';
import {
  ingresosFacturadosDe, ingresosCobradosDe, cuentasPorCobrarDe, gastosDe,
  gastosPorCategoriaDe, utilidadYMargenDe, variacionDe, cicloDelDineroDe,
  mesEnCursoDe, periodoAnteriorDe, dentroDePeriodo,
} from '../../lib/finanzas';

/** Registra depósitos, resumen financiero y sus alias de reportes. */
export function registrarRutasFinanzas(
  app: any,
  db: any,
  requirePermission: (...args: any[]) => any,
  logAudit: (...args: any[]) => Promise<void>,
  mapaPagadoPorFactura: (facturas: { id: string }[], pagosCargados?: any[]) => Promise<Map<string, number>>,
) {
  const { cierres_caja_ruta, depositos_caja, aprobaciones } = schema;
  const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  /**
   * Fuente única del P&L. Todas las pantallas de dinero leen de acá.
   *
   * Distingue **devengado** (lo vendido en el periodo, cobrado o no) de
   * **cobrado** (el dinero que entró). Ver `src/lib/finanzas.ts` para por qué
   * no son la misma cifra.
   *
   * `?desde`/`?hasta` en `YYYY-MM-DD`; sin parámetros, el mes en curso.
   *
   * Se registra además como `/api/reportes/flujo-caja`: el reporte nuevo de
   * Analítica muestra el ciclo del dinero, y duplicar el cálculo ahí le
   * devolvería cifras distintas a las de Resumen.
   */
  app.get("/api/finanzas/depositos", requirePermission('finanzas_resumen', 'view'), async (_req, res) => {
    try {
      const [cierres, depositos, guiasData] = await Promise.all([
        db.query.cierres_caja_ruta.findMany().catch(() => [] as any[]),
        db.query.depositos_caja.findMany().catch(() => [] as any[]),
        db.query.guias_despacho.findMany(),
      ]);
      const depositoPorCierre = new Map((depositos as any[]).map((d: any) => [d.cierreId, d]));
      res.json((cierres as any[]).map((c: any) => ({
        ...c, consecutivo: guiasData.find((g: any) => g.id === c.guiaId)?.consecutivo || c.guiaId,
        deposito: depositoPorCierre.get(c.id) || null,
      })).sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha))));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/finanzas/depositos", requirePermission('finanzas_resumen', 'create'), async (req, res) => {
    try {
      const { cierreId, montoDepositado, referencia, comprobante } = req.body || {};
      const usuarioId = String((req as any).usuario?.id || '');
      const rawKey = req.get('Idempotency-Key') || req.body.idempotencyKey;
      const idempotencyKey = rawKey == null ? null : String(rawKey).trim();
      const monto = Number(montoDepositado);
      if (!cierreId || !Number.isFinite(monto) || monto < 0 || !String(referencia || '').trim()) {
        return res.status(400).json({ error: 'Indique cierre, monto depositado y referencia del comprobante bancario.' });
      }
      if (idempotencyKey !== null && (!idempotencyKey || idempotencyKey.length > 160)) return res.status(400).json({ error: 'Idempotency-Key debe tener entre 1 y 160 caracteres.' });
      if (idempotencyKey) {
        const existente = await db.query.depositos_caja.findFirst({ where: eq(depositos_caja.idempotencyKey, idempotencyKey) });
        if (existente) {
          const igual = existente.cierreId === cierreId && round2(Number(existente.montoDepositado)) === round2(monto) && existente.referencia === String(referencia).trim();
          return igual ? res.json({ success: true, repetido: true, deposito: existente }) : res.status(409).json({ error: 'Idempotency-Key ya usada para otro depósito.' });
        }
      }
      const cierre = await db.query.cierres_caja_ruta.findFirst({ where: eq(cierres_caja_ruta.id, cierreId) });
      if (!cierre) return res.status(404).json({ error: 'Cierre de caja no encontrado.' });
      if (!['Cuadrada', 'Aprobada'].includes(cierre.estado) || cierre.efectivoContado == null) return res.status(409).json({ error: 'El conteo de caja debe estar cuadrado o aprobado antes de registrar el depósito.' });
      const repetido = await db.query.depositos_caja.findFirst({ where: eq(depositos_caja.cierreId, cierreId) });
      if (repetido) return res.status(409).json({ error: 'Este cierre ya tiene un depósito registrado.', deposito: repetido });
      const esperado = round2(Number(cierre.efectivoContado));
      const montoRedondeado = round2(monto);
      const diferencia = round2(montoRedondeado - esperado);
      const estadoDeposito = Math.abs(diferencia) <= 0.01 ? 'Conciliado' : 'DiferenciaPendiente';
      const depositoId = crypto.randomUUID();
      const aprobacionId = estadoDeposito === 'DiferenciaPendiente' ? crypto.randomUUID() : null;
      const fecha = new Date().toISOString();
      await db.transaction(async (tx: any) => {
        if (aprobacionId) await tx.insert(aprobaciones).values({
          id: aprobacionId, tipo: 'DiferenciaDeposito', modulo: 'Finanzas', referenciaId: cierre.guiaId,
          solicitudUsuario: usuarioId, descripcion: `El depósito (${montoRedondeado.toLocaleString('es-CR')}) no coincide con el efectivo contado (${esperado.toLocaleString('es-CR')}). Referencia: ${String(referencia).trim()}.`,
          datos: JSON.stringify({ cierreId, montoEsperado: esperado, montoDepositado: montoRedondeado, diferencia, referencia: String(referencia).trim() }), estado: 'Pendiente', fechaSolicitud: fecha,
        });
        await tx.insert(depositos_caja).values({
          id: depositoId, cierreId, montoEsperado: esperado, montoDepositado: montoRedondeado,
          referencia: String(referencia).trim(), comprobante: comprobante ? String(comprobante).trim() : null,
          registradoPor: usuarioId, fecha, estado: estadoDeposito, aprobacionId, idempotencyKey,
        });
      });
      await logAudit(usuarioId, 'Crear', 'DepositoCaja', depositoId, null, { cierreId, esperado, montoDepositado: montoRedondeado, diferencia, estado: estadoDeposito, referencia });
      const deposito = await db.query.depositos_caja.findFirst({ where: eq(depositos_caja.id, depositoId) });
      res.status(201).json({ success: true, deposito });
    } catch (error: any) {
      if (String(error?.message || '').includes('idx_depositos_caja_idempotency_key')) return res.status(409).json({ error: 'El depósito ya fue registrado; recargue la lista antes de continuar.' });
      res.status(500).json({ error: error.message });
    }
  });

  const handlerFinanzasResumen = async (req: any, res: any) => {
    try {
      const mesActual = mesEnCursoDe();
// Los reportes de `Reportes.tsx` mandan `fechaInicio`/`fechaFin` (así lo
      // hacen los cinco endpoints legacy) y el resumen usaba `desde`/`hasta`.
      // Se aceptan los dos nombres: con un solo par, el filtro de fechas de
      // Analítica se ignoraba en silencio y parecía que el reporte salía
      // completo cuando en realidad venía sin filtrar.
      const desde = (req.query.desde as string) || (req.query.fechaInicio as string) || mesActual.desde;
      const hasta = (req.query.hasta as string) || (req.query.fechaFin as string) || mesActual.hasta;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
        return res.status(400).json({ error: "Las fechas deben ir en YYYY-MM-DD" });
      }
      if (desde > hasta) {
        return res.status(400).json({ error: "La fecha inicial no puede ser posterior a la final" });
      }
      const periodo = { desde, hasta };
      const periodoAnterior = periodoAnteriorDe(periodo);
      const desdeConsulta = periodoAnterior.desde < periodo.desde ? periodoAnterior.desde : periodo.desde;
      const hastaConsulta = periodoAnterior.hasta > periodo.hasta ? periodoAnterior.hasta : periodo.hasta;
      const hastaExclusivo = new Date(Date.parse(`${hastaConsulta}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      const hastaActualExclusivo = new Date(Date.parse(`${hasta}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

      // `pagos` y `ventas_ruta` no existen en toda instalación vieja: sin ellas
      // el resumen debe servir ceros, no reventar.
      const [facturas, tiquetes, gastos, pagos, cierresCaja, depositosCaja] = await Promise.all([
        db.query.facturas.findMany(),
        db.query.ventas_ruta.findMany({ where: and(gte(schema.ventas_ruta.fechaHora, desdeConsulta), lt(schema.ventas_ruta.fechaHora, hastaExclusivo)) }).catch(() => [] as any[]),
        db.query.gastos.findMany({ where: and(gte(schema.gastos.fecha, desdeConsulta), lt(schema.gastos.fecha, hastaExclusivo)) }),
        db.query.pagos.findMany({ where: and(gte(schema.pagos.fecha, desdeConsulta), lt(schema.pagos.fecha, hastaExclusivo)) }).catch(() => [] as any[]),
        db.query.cierres_caja_ruta.findMany({ where: and(gte(cierres_caja_ruta.fecha, desde), lt(cierres_caja_ruta.fecha, hastaActualExclusivo)) }).catch(() => [] as any[]),
        db.query.depositos_caja.findMany({ where: and(gte(depositos_caja.fecha, desde), lt(depositos_caja.fecha, hastaActualExclusivo)) }).catch(() => [] as any[]),
      ]);

      // La cartera necesita pagos históricos, pero solo se transporta al proceso
      // un total por factura; los pagos del periodo siguen disponibles para caja.
      const pagosAgregados = await db.select({ facturaId: schema.pagos.facturaId, monto: sum(schema.pagos.monto) }).from(schema.pagos).groupBy(schema.pagos.facturaId).catch(() => [] as any[]);
      const pagadoPorFactura = await mapaPagadoPorFactura(facturas as any[], pagosAgregados as any[]);

      const ingresosFacturados = ingresosFacturadosDe(facturas as any[], tiquetes as any[], periodo);
      const ingresosCobrados = ingresosCobradosDe(facturas as any[], pagos as any[], periodo, tiquetes as any[]);
      const totalGastos = gastosDe(gastos as any[], periodo);
      const { utilidad, margen } = utilidadYMargenDe(ingresosFacturados, totalGastos);

      // La cartera es el estado actual, no una medida del periodo: se debe lo que
      // se debe hoy, sin importar cuándo se vendió.
      const cuentasPorCobrar = cuentasPorCobrarDe(facturas as any[], pagadoPorFactura);

      const ingresosFacturadosAnterior = ingresosFacturadosDe(facturas as any[], tiquetes as any[], periodoAnterior);
      const ingresosCobradosAnterior = ingresosCobradosDe(facturas as any[], pagos as any[], periodoAnterior, tiquetes as any[]);
      const gastosAnterior = gastosDe(gastos as any[], periodoAnterior);

      const aging = agingPorFacturas(facturas as any[], pagadoPorFactura);
      const documentos = facturas.filter((f: any) => String(f.estado ?? '') !== 'Anulada' && dentroDePeriodo(String(f.fecha ?? ''), periodo));
      const cierresCajaPeriodo = (cierresCaja as any[]).filter((c: any) => dentroDePeriodo(String(c.fecha || ''), periodo));
      const depositosCajaPeriodo = (depositosCaja as any[]).filter((d: any) => dentroDePeriodo(String(d.fecha || ''), periodo));
      const efectivoContadoCierres = cierresCajaPeriodo.filter((c: any) => c.efectivoContado != null);
      const conciliacionCaja = {
        cierres: cierresCajaPeriodo.length,
        pendientesConteo: cierresCajaPeriodo.filter((c: any) => c.estado === 'PendienteConteo').length,
        diferenciasPendientes: cierresCajaPeriodo.filter((c: any) => c.estado === 'DiferenciaPendiente').length,
        cierresCuadrados: cierresCajaPeriodo.filter((c: any) => c.estado === 'Cuadrada').length,
        depositosPendientes: depositosCajaPeriodo.filter((d: any) => d.estado === 'DiferenciaPendiente').length,
        depositosConciliados: depositosCajaPeriodo.filter((d: any) => d.estado === 'Conciliado').length,
        montoDepositado: round2(depositosCajaPeriodo.reduce((s: number, d: any) => s + Number(d.montoDepositado || 0), 0)),
        gastosEfectivo: round2(cierresCajaPeriodo.reduce((s: number, c: any) => s + Number(c.gastosEfectivo || 0), 0)),
        efectivoEsperado: round2(cierresCajaPeriodo.reduce((s: number, c: any) => s + Number(c.efectivoEsperado || 0), 0)),
        efectivoContado: round2(efectivoContadoCierres.reduce((s: number, c: any) => s + Number(c.efectivoContado || 0), 0)),
        diferenciaNeta: round2(cierresCajaPeriodo.reduce((s: number, c: any) => s + Number(c.diferencia || 0), 0)),
      };

      res.json({
        periodo,
        periodoAnterior,
        // Devengado: base del P&L. Incluye crédito no cobrado.
        ingresosFacturados,
        // Cobrado: dinero que efectivamente entró.
        ingresosCobrados,
        gastos: totalGastos,
        utilidad,
        margen,
        cuentasPorCobrar,
        variacion: {
          ingresosFacturados: variacionDe(ingresosFacturados, ingresosFacturadosAnterior),
          ingresosCobrados: variacionDe(ingresosCobrados, ingresosCobradosAnterior),
          gastos: variacionDe(totalGastos, gastosAnterior),
          utilidad: variacionDe(utilidad, round2(ingresosFacturadosAnterior - gastosAnterior)),
        },
        anterior: {
          ingresosFacturados: ingresosFacturadosAnterior,
          ingresosCobrados: ingresosCobradosAnterior,
          gastos: gastosAnterior,
          utilidad: round2(ingresosFacturadosAnterior - gastosAnterior),
        },
        gastosPorCategoria: gastosPorCategoriaDe(gastos as any[], periodo),
        cicloDelDinero: cicloDelDineroDe({ ingresosFacturados, ingresosCobrados, cuentasPorCobrar, gastos: totalGastos, utilidad }),
        aging,
        documentosEmitidos: documentos.length,
        conciliacionCaja,
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  };

  app.get("/api/finanzas/resumen", requirePermission('finanzas_resumen', 'view'), handlerFinanzasResumen);
  app.get("/api/reportes/flujo-caja", requirePermission('finanzas_resumen', 'view'), handlerFinanzasResumen);

  /**
   * Reporte financiero: ahora es un alias de la fuente única.
   *
   * Antes recalculaba sus propias cifras, y su `cuentasPorCobrar` como
   * `SUM(total)` de las pendientes — que ignora los pagos parciales y no cuadraba
   * con el aging. Los nombres antiguos se conservan para no romper a
   * `Reportes.tsx`; los siguientes de la Fase 4.
   */
  app.get("/api/reportes/financiero", requirePermission('finanzas_resumen', 'view'), async (req, res) => {
    try {
      const mesActual = mesEnCursoDe();
      const desde = String(req.query.fechaInicio || req.query.desde || mesActual.desde);
      const hasta = String(req.query.fechaFin || req.query.hasta || mesActual.hasta);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) {
        return res.status(400).json({ error: "Indique un periodo válido con fecha inicial no posterior a la final." });
      }
      const periodo = { desde, hasta };
      const [facturas, tiquetes, gastos, pagos] = await Promise.all([
        db.query.facturas.findMany(),
        db.query.ventas_ruta.findMany().catch(() => [] as any[]),
        db.query.gastos.findMany(),
        db.query.pagos.findMany().catch(() => [] as any[]),
      ]);
      const pagosAgregados = await db.select({ facturaId: schema.pagos.facturaId, monto: sum(schema.pagos.monto) }).from(schema.pagos).groupBy(schema.pagos.facturaId).catch(() => [] as any[]);
      const pagadoPorFactura = await mapaPagadoPorFactura(facturas as any[], pagosAgregados as any[]);

      const totalVentas = ingresosFacturadosDe(facturas as any[], tiquetes as any[], periodo);
      const totalGastos = gastosDe(gastos as any[], periodo);
      const { utilidad, margen } = utilidadYMargenDe(totalVentas, totalGastos);

      res.json({
        totalVentas,
        totalGastos,
        utilidadNeta: utilidad,
        cuentasPorCobrar: cuentasPorCobrarDe(facturas as any[], pagadoPorFactura),
        gastosPorCategoria: Object.fromEntries(gastosPorCategoriaDe(gastos as any[], periodo).map(g => [g.categoria, g.monto])),
        margen,
        ingresosCobrados: ingresosCobradosDe(facturas as any[], pagos as any[], periodo, tiquetes as any[]),
        periodo,
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });


}
