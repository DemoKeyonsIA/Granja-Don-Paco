import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import * as schema from "./src/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "./src/lib/password";
import { round2 } from "./src/lib/cobranza";
import { resolverPrecioParaProducto } from "./src/lib/precios";
import { registrarRutasLookupPrecios } from "./src/server/routes/precios-lookup";
import { registrarRutasAdministracionPrecios } from "./src/server/routes/precios-admin";
import { registrarRutasReportesOperativos } from "./src/server/routes/reportes-operativos";
import { registrarRutasFinanzas } from "./src/server/routes/finanzas";
import { registrarRutasActivosGranja } from "./src/server/routes/activos-granja";
import { registrarRutasFacturacion } from "./src/server/routes/facturacion";
import { registrarRutasUsuarios } from "./src/server/routes/usuarios";
import { registrarRutasDashboards } from "./src/server/routes/dashboards";
import { registrarRutasYCaminones } from "./src/server/routes/rutas-camiones";
import { registrarRutasCajaCustodia } from "./src/server/routes/logistica/caja-custodia";
import { registrarRutasAprobaciones } from "./src/server/routes/aprobaciones";
import { registrarRutasEtiquetas } from "./src/server/routes/etiquetas";
import { registrarRutasAuditoria } from "./src/server/routes/auditoria";
import { registrarRutasAsistentesIA } from "./src/server/routes/asistentes-ia";
import { registrarRutasCatalogo } from "./src/server/routes/catalogo";
import { registrarChatEstela } from "./src/server/routes/chat-estela";
import { registrarRutasIncidentes } from "./src/server/routes/incidentes";
import { registrarRutaRecoleccion } from "./src/server/routes/recoleccion";
import { registrarRutasGranjas } from "./src/server/routes/granjas";
import { registrarAuditoriaLogistica } from "./src/server/routes/auditoria-logistica";
import { registrarRutasIACampo } from "./src/server/routes/ia-campo";
import { registrarRutasAutenticacion } from "./src/server/routes/autenticacion";
import { registrarRutasGuias } from "./src/server/routes/logistica/guias";
import { registrarCreacionGuia } from "./src/server/routes/logistica/crear-guia";
import { registrarRutasOffice } from "./src/server/routes/office";
import { registrarRutasLecturaInventario } from "./src/server/routes/inventario-lectura";
import { registrarRutaStockBodega } from "./src/server/routes/inventario-lectura";
import { registrarRutasEscrituraBodega } from "./src/server/routes/inventario-escritura";
import { registrarRutasOperaciones } from "./src/server/routes/operaciones-custodia";
import { registrarRutasClientes } from "./src/server/routes/clientes";
import { registrarRutasCrmClientes } from "./src/server/routes/clientes-crm";
import { registrarRutasComerciales } from "./src/server/routes/ventas";
import { registrarRutasGastos } from "./src/server/routes/gastos";
import { getNeonDatabase } from "./src/db/neon";
import { initializeNeonDatabase } from "./src/db/initialize-neon";
export { getNeonDatabase } from "./src/db/neon";
export { initializeNeonDatabase } from "./src/db/initialize-neon";
import { normalizarRol, permisosParaRoles } from "./src/lib/role-permissions";
export { backfillRecepcionesDesperdicio } from "./src/db/initialize";

dotenv.config({ path: ".env.local" });
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ==================== FEFO / VIDA ÚTIL ====================
// Vida útil configurable por producto (productos_catalogo.vida_util_dias).
// FEFO: primero sale el lote que antes vence; la fecha de recepción es el desempate.
export const VIDA_UTIL_DEFAULT_DIAS = 28;
export const DIAS_AVISO_DEFAULT = 7;

// Normaliza nombres para mapear etiquetas ("Huevos - Grande") con el catálogo ("Huevos Grandes").
export function normalizarProducto(nombre: string): string {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function resolverVidaUtil(
  producto: string,
  catalogo: { nombre: string; vidaUtilDias?: number | null; diasAvisoVencimiento?: number | null }[],
): { vidaUtilDias: number; diasAvisoVencimiento: number } {
  const norm = normalizarProducto(producto);
  let mejor: { nombre: string; vidaUtilDias?: number | null; diasAvisoVencimiento?: number | null } | null = null;
  for (const p of catalogo) {
    const np = normalizarProducto(p.nombre);
    if (np === norm) { mejor = p; break; }
    if (!mejor && np && (norm.includes(np) || np.includes(norm))) mejor = p;
  }
  const vida = Number(mejor?.vidaUtilDias) > 0 ? Number(mejor!.vidaUtilDias) : VIDA_UTIL_DEFAULT_DIAS;
  const aviso = mejor && Number(mejor.diasAvisoVencimiento) >= 0 ? Number(mejor.diasAvisoVencimiento) : DIAS_AVISO_DEFAULT;
  return { vidaUtilDias: vida, diasAvisoVencimiento: aviso };
}

export function calcularVencimiento(fechaBaseISO: string, vidaUtilDias: number): string {
  const base = new Date(fechaBaseISO).getTime();
  return new Date(base + vidaUtilDias * 86400000).toISOString();
}

// Días restantes hasta el vencimiento (negativo = vencido). null si no hay fecha.
export function diasHastaVencimiento(fechaVencimiento?: string | null, ahora = Date.now()): number | null {
  if (!fechaVencimiento) return null;
  const t = new Date(fechaVencimiento).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - ahora) / 86400000);
}

// Estado semántico de vencimiento para UI/FEFO.
export function estadoVencimiento(dias: number | null, diasAviso: number): 'vencido' | 'pronto' | 'ok' | 'sin-fecha' {
  if (dias === null) return 'sin-fecha';
  if (dias < 0) return 'vencido';
  if (dias <= diasAviso) return 'pronto';
  return 'ok';
}

export async function createApp(testMode = false, testDb?: any, serveFrontend = true) {
  const app = express();
  app.use(express.json());

  let db: any;
  if (testDb) {
    db = testDb;
  } else {
    db = getNeonDatabase().db;
  }

  const { pesos_por_punto, auditoria, sesiones, traza_etiqueta } = schema;

  // ==================== PHASE 5 — ROLE-BASED AUTH ====================

  // Role definitions: what each role can see and do
  // Resuelve el usuario real: primero Bearer token (sesión válida), luego x-user-id contra la BD.
  // El rol SIEMPRE sale de la BD, nunca del header x-user-role (evita spoofing).
  async function resolveUsuario(req: any) {
    const autenticado = await authUser(req);
    if (autenticado) return autenticado;
    const uid = String(req.headers['x-user-id'] || '').trim();
    if (!uid || uid === 'system') return null;
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, uid)).limit(1);
    if (!u || (u.activo ?? true) === false) return null;
    const roles = String(u.roles || u.role).split(',').map(normalizarRol).filter(Boolean);
    return { id: u.id, name: u.name, email: u.email, role: normalizarRol(u.role), roles };
  }

  // Permission check middleware. El rol se resuelve de la BD (nunca del header).
  // Uso: requirePermission('facturacion', 'create') o requirePermission(['ventas','facturacion'], 'create')
  function requirePermission(modulos: string | string[], accion: 'view' | 'create' | 'approve') {
    const modulosArr = Array.isArray(modulos) ? modulos : [modulos];
    return async (req: any, res: any, next: any) => {
      const usuario = await resolveUsuario(req);
      if (!usuario) return res.status(401).json({ error: 'Autenticación requerida' });
      const perms = permisosParaRoles(usuario.roles?.length ? usuario.roles : [usuario.role]);
      if (!perms) return res.status(403).json({ error: `Rol ${usuario.role} no configurado` });
      const allowed = perms[accion] || [];
      const ok = allowed.includes('*') || allowed.some((m: string) => modulosArr.some((mo) => mo === m || mo.startsWith(m)));
      if (ok) { (req as any).usuario = usuario; return next(); }
      return res.status(403).json({ error: `Rol ${usuario.role} no tiene permiso de ${accion} en ${modulosArr.join(', ')}` });
    };
  }

  // ==================== PHASE 0 — AUTH (login real, sesión por token) ====================

  function getTokenFromReq(req: any): string | null {
    const header = req.headers['authorization'] as string | undefined;
    if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
    return null;
  }

  async function authUser(req: any) {
    const token = getTokenFromReq(req);
    if (!token) return null;
    const [sesion] = await db.select().from(sesiones).where(eq(sesiones.token, token)).limit(1);
    if (!sesion || new Date(sesion.expiresAt).getTime() < Date.now()) return null;
    const [usuario] = await db.select().from(schema.users).where(eq(schema.users.id, sesion.userId)).limit(1);
    if (!usuario || (usuario.activo ?? true) === false) return null;
    const roles = (usuario.roles && usuario.roles.trim()) ? usuario.roles.split(',').map(normalizarRol).filter(Boolean) : [normalizarRol(usuario.role)];
    return { id: usuario.id, name: usuario.name, email: usuario.email, role: normalizarRol(usuario.role), roles };
  }

  registrarRutasAutenticacion(app, db, authUser, getTokenFromReq, verifyPassword, normalizarRol);

  // ==================== PHASE 5 — AUTO-AUDIT HELPER ====================

  async function recordEvent(etiquetaId: string, tipoEvento: string, ubicacion?: string, documentoRef?: string, usuarioId?: string, observaciones?: string) {
    try {
      await db.insert(traza_etiqueta).values({
        id: crypto.randomUUID(),
        etiquetaId,
        tipoEvento,
        ubicacion: ubicacion || null,
        documentoRef: documentoRef || null,
        usuarioId: usuarioId || null,
        fecha: new Date().toISOString(),
        observaciones: observaciones || null,
      });
    } catch (e: any) { /* traza es soporte de auditoría — no rompe el flujo si falla */ }
  }

  async function recordEventTx(tx: any, etiquetaId: string, tipoEvento: string, ubicacion: string | null, documentoRef: string | null, usuarioId: string, observaciones?: string) {
    await tx.insert(traza_etiqueta).values({
      id: crypto.randomUUID(), etiquetaId, tipoEvento, ubicacion, documentoRef, usuarioId,
      fecha: new Date().toISOString(), observaciones: observaciones || null,
    });
  }

  async function registrarPesoPunto(opts: {
    cliente?: any;
    referenciaId?: string | null;
    tipoReferencia: string;
    producto: string;
    cantidadUnidades?: number;
    pesoEsperado?: number | null;
    pesoReal?: number | null;
    responsable?: string | null;
    ubicacion: string;
    observaciones?: string | null;
  }) {
    if (opts.pesoReal == null && opts.pesoEsperado == null) return;
    const pesoReal = Number(opts.pesoReal) || 0;
    const pesoEsperado = Number(opts.pesoEsperado) || pesoReal;
    try {
      await (opts.cliente || db).insert(pesos_por_punto).values({
        id: crypto.randomUUID(),
        referenciaId: opts.referenciaId || null,
        tipoReferencia: opts.tipoReferencia,
        producto: opts.producto,
        cantidadUnidades: Number(opts.cantidadUnidades) || 0,
        unidad: 'cartones',
        pesoEsperado,
        pesoReal,
        diferencia: pesoReal - pesoEsperado,
        basculaUtilizada: null,
        responsable: opts.responsable || null,
        fecha: new Date().toISOString(),
        ubicacion: opts.ubicacion,
        observaciones: opts.observaciones || null,
        estado: Math.abs(pesoReal - pesoEsperado) <= pesoEsperado * 0.02 ? 'Conforme' : 'ConDiferencia'
      });
    } catch (e) { /* el control de peso es auditoría — no rompe el flujo si falla */ }
  }

  // Impacto financiero real de un desperdicio generado por el sistema (recepción/cuadre).
  // Usa el precio vigente del producto; si no hay precio disponible, devuelve 0 sin romper el flujo.
  async function calcularImpactoDesperdicio(producto: string, cantidad: number): Promise<number> {
    try {
      const precio = await getPrecioParaProducto(producto);
      return precio ? Number((cantidad * precio.precio).toFixed(2)) : 0;
    } catch {
      return 0;
    }
  }

  // Estado lógico de una guía: normaliza la combinación de `estado` y `fin_dia_fecha`.
  // Evita que la UI/frontend tenga que adivinar el estado real de una guía.
  function estadoLogicoGuia(g: any): string {
    if (g.estado === 'Cerrada' || g.estado === 'CerradaConDiferencia' || g.estado === 'Anulada') return g.estado;
    if (g.finDiaFecha) return 'CajaCerrada';
    return g.estado;
  }

  const leerColchonExtra = (raw: any) => {
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
  };

  // Error de negocio con código HTTP explícito: evita que validaciones esperables
  // se devuelvan como 500 (error de servidor) y se confundan con fallos reales.
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  // Catch unificado: respeta el status de ApiError (400/4xx) y solo devuelve 500
  // para errores inesperados (logueándolos para diagnóstico).
  function httpError(res: any, error: any) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status >= 500) console.error('[API error]', error?.message || error);
    return res.status(status).json({ error: error?.message || 'Error interno del servidor' });
  }

  function nextRemisionConsecutivo(): string {
    const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefijo = `GR-${fecha}-`;
    return `${prefijo}${Date.now()}`;
  }

  function nextGuiaDespachoConsecutivo(): string {
    const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `GD-${fecha}-${Date.now()}`;
  }

  async function logAudit(usuarioId: string, accion: string, modulo: string, referenciaId?: string, valoresAntes?: any, valoresDespues?: any, motivo?: string) {
    try {
      await db.insert(auditoria).values({
        id: crypto.randomUUID(),
        usuarioId,
        accion,
        modulo,
        referenciaId: referenciaId || null,
        valoresAntes: valoresAntes ? JSON.stringify(valoresAntes) : null,
        valoresDespues: valoresDespues ? JSON.stringify(valoresDespues) : null,
        motivo: motivo || null,
        fecha: new Date().toISOString()
      });
    } catch (e) { /* audit failure should not break operations */ }
  }

  // ==================== PHASE 5 — PRICE LOOKUP ====================

  async function getPrecioParaProducto(producto: string, clienteId?: string, ruta?: string): Promise<{ precio: number; precioMinimo: number; precioMaximo: number; descuentoMaximo: number; listaUsada: string } | null> {
    const [todasListas, todosDetalles, todosClientes, todasExcepciones, todosCatalogos] = await Promise.all([
      db.query.listas_precios.findMany(),
      db.query.precios_detalle.findMany(),
      db.query.clientes.findMany(),
      db.query.precioExcepcionesCliente.findMany(),
      db.query.productosCatalogo.findMany()
    ]);

    return resolverPrecioParaProducto(producto, clienteId, ruta, {
      listas: todasListas,
      detalles: todosDetalles,
      clientes: todosClientes,
      excepciones: todasExcepciones,
      catalogo: todosCatalogos.filter((p: any) => p.estado === 'Activo'),
    });
  }

  registrarRutasIACampo(app, ai, requirePermission);

  registrarRutasComerciales(app, db, { requirePermission, ApiError, getPrecioParaProducto, logAudit, recordEvent });

  registrarRutaRecoleccion(app, db, requirePermission);

  // GET /api/produccion/historial se registra más abajo, con filtros de
  // granja/fecha. Este duplicado sin filtros ganaba la resolución de Express y
  // hacía que `Granjas.tsx:1009` pidiera granja+fechas y recibiera el histórico
  // completo en silencio.

  registrarRutasLecturaInventario(app, db, requirePermission);
  registrarRutaStockBodega(app, db, { normalizarProducto, resolverVidaUtil, diasHastaVencimiento, estadoVencimiento }, requirePermission);

  registrarRutasGastos(app, db, requirePermission);

  registrarRutasGranjas(app, db, requirePermission, logAudit);

  // Logistica Traslados
  registrarRutasOperaciones(app, db, { ApiError, httpError, registrarPesoPunto, calcularImpactoDesperdicio, nextRemisionConsecutivo, requirePermission, logAudit });

  registrarAuditoriaLogistica(app, db, requirePermission);

  registrarRutasClientes(app, db, requirePermission, logAudit);

  /** `facturaId -> pagado`, para no consultar la tabla de pagos factura por factura. */
  async function mapaPagadoPorFactura(facturas: { id: string }[], pagosCargados?: any[]): Promise<Map<string, number>> {
    if (facturas.length === 0) return new Map();
    const todos = pagosCargados ?? await db.query.pagos.findMany();
    const porFactura = new Map<string, number>();
    for (const p of (todos as any[])) {
      porFactura.set(p.facturaId, round2((porFactura.get(p.facturaId) ?? 0) + Number(p.monto || 0)));
    }
    return porFactura;
  }

  registrarRutasCrmClientes(app, db, mapaPagadoPorFactura, requirePermission);
  registrarRutasYCaminones(app, db, requirePermission, logAudit);

  registrarCreacionGuia({ app, db, nextGuiaDespachoConsecutivo, registrarPesoPunto, recordEvent, httpError, ApiError, requirePermission });

  registrarRutasGuias(app, db, {
    estadoLogicoGuia,
    leerColchonExtra,
    round2,
    requirePermission,
  });

  // ==================== F3 — CAJA DEL VENDEDOR ====================

  registrarRutasCajaCustodia(app, db, { ApiError, httpError, recordEvent, recordEventTx, registrarPesoPunto, getPrecioParaProducto, requirePermission, logAudit, round2, estadoLogicoGuia, testMode });
  registrarRutasFacturacion(app, db, requirePermission, testMode, logAudit);

  registrarRutasEtiquetas(app, db, { recordEvent, resolverVidaUtil, calcularVencimiento, requirePermission, logAudit });

  registrarRutasEscrituraBodega(app, db, requirePermission);

  registrarRutasActivosGranja(app, db, requirePermission, logAudit);
  registrarRutasAdministracionPrecios(app, db, requirePermission, logAudit);

  registrarRutasDashboards(app, db, mapaPagadoPorFactura, requirePermission);

  registrarRutasAuditoria(app, db, requirePermission);

  registrarRutasAsistentesIA(app, db, ai, requirePermission);

  registrarRutasAprobaciones(app, db, { requirePermission, ApiError, httpError, logAudit, recordEventTx });

  registrarRutasLookupPrecios(app, db, getPrecioParaProducto, requirePermission);

  registrarRutasReportesOperativos(app, db, requirePermission);

  registrarRutasFinanzas(app, db, requirePermission, logAudit, mapaPagadoPorFactura);

  registrarRutasUsuarios(app, db, hashPassword, requirePermission, logAudit);

  registrarRutasCatalogo(app, db, { requirePermission, logAudit, vidaUtilDefaultDias: VIDA_UTIL_DEFAULT_DIAS, diasAvisoDefault: DIAS_AVISO_DEFAULT });

  // VITE/STATIC movido al final para no eclipsar rutas API posteriores

  registrarChatEstela(app, db, ai, requirePermission);

  registrarRutasIncidentes(app, db, requirePermission);

  registrarRutasOffice(app, db, requirePermission, resolveUsuario);

  // ==================== VITE / STATIC (al final para no eclipsar rutas API) ====================
  if (!testMode && serveFrontend) {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }


  return app;
}

// Backfill histórico: recepciones con diferencia registradas ANTES del fix de recepción
// no generaron desperdicio. Se procesan al arrancar (solo producción), de forma idempotente:
// se salta cualquier recepción que ya tenga su movimiento 'Pérdida en Tránsito'.
async function startServer() {
  const { db: dbInstance } = getNeonDatabase();
  await initializeNeonDatabase(dbInstance);

  const app = await createApp();
  const PORT = Number(process.env.PORT) || 5174;
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// El listener solo arranca cuando este archivo es el punto de entrada. Las pruebas
// y `scripts/generar-fixtures-vistas.ts` necesitan la app sin un puerto abierto: con
// él abierto, la base del fixture queda bloqueada por el proceso y el script no
// puede borrarla al terminar.
if (!process.env.VERCEL && process.argv[1] && !process.argv[1].includes('vitest') && !process.env.GDP_NO_LISTEN) {
  startServer();
}
