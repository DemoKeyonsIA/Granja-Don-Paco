import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./src/db/schema";
import { eq, like, and, lt, ne, inArray, gt, desc, sql } from "drizzle-orm";
import { hashPassword, verifyPassword } from "./src/lib/password";
import { CREATE_TABLES } from "./src/db/ddl";
import QRCode from "qrcode";
import { clasificarDiferencia, OPCIONES_DIFERENCIA_RECEPCION } from "./src/lib/opcionesRecepcion";
import { saldoDe, round2, agingPorFacturas, dso as dsoDe, fechaVencimientoDe, diasVencidoDe, estaSaldada, esCredito } from "./src/lib/cobranza";
import {
  ingresosFacturadosDe, ingresosCobradosDe, cuentasPorCobrarDe,
  gastosDe, gastosPorCategoriaDe, utilidadYMargenDe, variacionDe,
  cicloDelDineroDe, mesEnCursoDe, periodoAnteriorDe, dentroDePeriodo,
} from "./src/lib/finanzas";

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

export async function createApp(testMode = false, testDb?: any) {
  const app = express();
  app.use(express.json());

  let db: any;
  if (testDb) {
    db = testDb;
  } else {
    const client = createClient({ url: `file:${path.resolve(process.cwd(), 'local.db')}` });
    db = drizzle(client, { schema });
  }

  const { facturas, detallesFactura, inventario, gastos, granjas, galerones, lotes_aves, mantenimientos, movimientosInventario, produccion_diaria, clientes, rutas, traslados, recepciones, etiquetas, facturas_electronicas, pesos_por_punto, vacunaciones, inventario_alimento, consumo_alimento, activos_mantenimiento, ordenes_mantenimiento, desperdicios, listas_precios, precios_detalle, historial_precios, auditoria, aprobaciones, sesiones, guias_remision, traza_etiqueta, camiones, guias_despacho, guias_despacho_detalle, consecutivos, ventas_ruta, retornos_camion, pagos } = schema;

  // ==================== PHASE 5 — ROLE-BASED AUTH ====================

  // Role definitions: what each role can see and do
  const ROLE_PERMISSIONS: Record<string, { view: string[], create: string[], approve: string[] }> = {
    Admin: { view: ['*'], create: ['*'], approve: ['*'] },
    Socio: { view: ['dashboard', 'produccion', 'ventas', 'inventario', 'rutas', 'finanzas_resumen', 'office'], create: ['office'], approve: [] },
    Vendedor: { view: ['rutas_propias', 'clientes_propios', 'ventas_propias', 'inventario_camion', 'precios'], create: ['ventas', 'gastos_ruta'], approve: [] },
    Facturador: { view: ['facturacion', 'clientes', 'inventario', 'ventas'], create: ['facturacion', 'notas_credito'], approve: [] },
    Comercial: { view: ['rutas_propias', 'clientes_propios', 'ventas_propias', 'inventario_camion', 'precios', 'facturacion', 'clientes', 'inventario', 'ventas', 'office'], create: ['ventas', 'gastos_ruta', 'facturacion', 'notas_credito'], approve: [] },
    Despachador: { view: ['bodega', 'etiquetas', 'pesos', 'inventario_bodega'], create: ['etiquetas', 'pesos', 'carga_camion'], approve: [] },
    Bodeguero: { view: ['inventario_bodega', 'recepciones', 'etiquetas', 'pesos', 'desperdicios'], create: ['recepciones', 'desperdicios', 'inventario_bodega'], approve: [] },
    Camionero: { view: ['cargas_asignadas', 'traslados'], create: [], approve: ['carga'] },
  };

  // Resuelve el usuario real: primero Bearer token (sesión válida), luego x-user-id contra la BD.
  // El rol SIEMPRE sale de la BD, nunca del header x-user-role (evita spoofing).
  async function resolveUsuario(req: any) {
    const autenticado = await authUser(req);
    if (autenticado) return autenticado;
    const uid = String(req.headers['x-user-id'] || '').trim();
    if (!uid || uid === 'system') return null;
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, uid)).limit(1);
    if (!u || (u.activo ?? true) === false) return null;
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  }

  // Permission check middleware. El rol se resuelve de la BD (nunca del header).
  // Uso: requirePermission('facturacion', 'create') o requirePermission(['ventas','facturacion'], 'create')
  function requirePermission(modulos: string | string[], accion: 'view' | 'create' | 'approve') {
    const modulosArr = Array.isArray(modulos) ? modulos : [modulos];
    return async (req: any, res: any, next: any) => {
      const usuario = await resolveUsuario(req);
      if (!usuario) return res.status(401).json({ error: 'Autenticación requerida' });
      const perms = ROLE_PERMISSIONS[usuario.role] || ROLE_PERMISSIONS.Vendedor;
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
    const roles = (usuario.roles && usuario.roles.trim()) ? usuario.roles.split(',').map((r: string) => r.trim()).filter(Boolean) : [usuario.role];
    return { id: usuario.id, name: usuario.name, email: usuario.email, role: usuario.role, roles };
  }

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: "Correo y contraseña son requeridos" });
      const [usuario] = await db.select().from(schema.users)
        .where(eq(schema.users.email, String(email).toLowerCase().trim()))
        .limit(1);
      if (!usuario || !verifyPassword(password, usuario.password_hash || '')) {
        return res.status(401).json({ error: "Credenciales incorrectas" });
      }
      if ((usuario.activo ?? true) === false) {
        return res.status(401).json({ error: "Cuenta inactiva. Contacte al administrador" });
      }
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      await db.insert(sesiones).values({
        id: crypto.randomUUID(),
        userId: usuario.id,
        token,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await db.delete(sesiones).where(lt(sesiones.expiresAt, new Date().toISOString()));
      const roles = (usuario.roles && usuario.roles.trim()) ? usuario.roles.split(',').map((r: string) => r.trim()).filter(Boolean) : [usuario.role];
      res.json({ token, user: { id: usuario.id, name: usuario.name, email: usuario.email, role: usuario.role, roles } });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const token = getTokenFromReq(req);
    if (token) await db.delete(sesiones).where(eq(sesiones.token, token));
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: "No autenticado" });
    res.json({ user });
  });

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

  async function getPrecioParaProducto(producto: string, clienteId?: string, ruta?: string): Promise<{ precio: number; descuentoMaximo: number; listaUsada: string } | null> {
    const [todasListas, todosDetalles, todosClientes, todasExcepciones, todosCatalogos] = await Promise.all([
      db.query.listas_precios.findMany(),
      db.query.precios_detalle.findMany(),
      db.query.clientes.findMany(),
      db.query.precioExcepcionesCliente.findMany(),
      db.query.productosCatalogo.findMany()
    ]);

    const hoy = new Date().toISOString().split('T')[0];
    const listasActivas = todasListas.filter(l => l.estado === 'Activa' && (!l.fechaFin || l.fechaFin >= hoy));

    // Priority 1: Client-specific price list
    if (clienteId) {
      const cliente = todosClientes.find(c => c.id === clienteId);
      const listaCliente = listasActivas.find(l => l.tipo === 'Cliente' && l.clienteId === clienteId);
      if (listaCliente) {
        const detalle = todosDetalles.find(d => d.listaId === listaCliente.id && d.producto === producto);
        if (detalle) return { precio: Number(detalle.precioUnitario), descuentoMaximo: Number(detalle.descuentoMaximo), listaUsada: listaCliente.nombre };
      }
      // Client has precio_especial set
      if (cliente?.precio_especial) {
        return { precio: Number(cliente.precio_especial), descuentoMaximo: 0, listaUsada: 'Precio Especial Cliente' };
      }
      // Client has price exception from catalog
      const catalogMatch = todosCatalogos.find(c => c.nombre === producto);
      if (catalogMatch) {
        const excepcion = todasExcepciones.find(e => e.clienteId === clienteId && e.productoId === catalogMatch.id && e.estado === 'Activa');
        if (excepcion) {
          return { precio: Number(excepcion.precioExcepcion), descuentoMaximo: 0, listaUsada: `Excepción: ${excepcion.justificacion || 'Sin justificación'}` };
        }
      }
    }

    // Priority 2: Route-specific price list
    if (ruta) {
      const listaRuta = listasActivas.find(l => l.tipo === 'Ruta' && l.rutaAsociada === ruta);
      if (listaRuta) {
        const detalle = todosDetalles.find(d => d.listaId === listaRuta.id && d.producto === producto);
        if (detalle) return { precio: Number(detalle.precioUnitario), descuentoMaximo: Number(detalle.descuentoMaximo), listaUsada: listaRuta.nombre };
      }
    }

    // Priority 3: Global price list (check all active global lists)
    for (const listaGlobal of listasActivas.filter(l => l.tipo === 'Global')) {
      const detalle = todosDetalles.find(d => d.listaId === listaGlobal.id && d.producto === producto);
      if (detalle) return { precio: Number(detalle.precioUnitario), descuentoMaximo: Number(detalle.descuentoMaximo), listaUsada: listaGlobal.nombre };
    }

    // Priority 4: Product catalog base price
    const catalogProduct = todosCatalogos.find(c => c.nombre === producto);
    if (catalogProduct) {
      return { precio: Number(catalogProduct.precioBase), descuentoMaximo: 0, listaUsada: 'Precio Base Catálogo' };
    }

    return null;
  }

  app.post("/api/extract", async (req, res) => {
    try {
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const prompt = `Eres "Estela", el asistente de inteligencia artificial interno de la aplicación móvil de Granja Don Paco admin. Tu trabajo es leer los mensajes de los vendedores en ruta (ya sean de texto o transcripciones de voz) y extraer la información clave para enviarla a los módulos de Facturación, Inventario y Gastos.

Reglas obligatorias:
1. Extrae siempre: nombre_cliente, peso_kilos, precio_por_kilo, metodo_pago.
2. Si el vendedor menciona cantidades en "cartones", "bandejas" o "cajas de huevos", asegúrate de extraerlo bajo la propiedad "cantidad_cartones". Esto es CRÍTICO para la logística.
3. Si el vendedor menciona un gasto operativo (diésel, viático, mantenimiento, peaje), extráelo en la categoría de "gastos".
4. Calcula el total de la venta si no se especifica.
5. Tu respuesta debe ser ÚNICA y EXCLUSIVAMENTE un objeto JSON válido, sin formato Markdown ni texto adicional.

Estructura del JSON esperado:
{
  "modulo_ventas": {
    "cliente": "String",
    "peso_kilos": Number,
    "cantidad_cartones": Number,
    "precio_por_kilo": Number,
    "total_venta": Number,
    "condicion": "Contado" | "Credito"
  },
  "modulo_cobranza": {
    "metodo_pago": "Efectivo" | "SINPE" | "Transferencia" | "Pendiente",
    "monto_pagado": Number
  },
  "modulo_gastos": [
    {
      "categoria": "Viatico" | "Diesel" | "Mantenimiento" | "Proveedores" | "Otro",
      "monto": Number,
      "descripcion": "String"
    }
  ]
}

Mensaje del vendedor:
"${message}"`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });

      const jsonStr = response.text;
      if (!jsonStr) {
        throw new Error("No response from Gemini");
      }

      const parsedData = JSON.parse(jsonStr);
      res.json(parsedData);
    } catch (error: any) {
      console.error("Error processing message:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });


  app.post("/api/predict-load", async (req, res) => {
    try {
      const { historicalData } = req.body;
      
      if (!historicalData) {
        return res.status(400).json({ error: "historicalData is required" });
      }

      const prompt = `Rol: Eres "Estela", la Inteligencia Artificial analista de operaciones de Granja Don Paco. Tu tono es profesional, directo y enfocado en la rentabilidad y eficiencia.

Tarea: El usuario te proporcionará un JSON con el historial de compras de los clientes de una ruta específica en las últimas 4 semanas, así como el clima esperado para el día de hoy. Debes analizar estos datos y sugerir la cantidad exacta de cartones de huevos y kilos de pollo que se deben cargar en el camión.

Reglas de Negocio:
1. Nunca sugieras cargar menos del promedio histórico de venta de los días equivalentes.
2. Añade siempre un "margen de seguridad" del 10% adicional al cálculo base para imprevistos o ventas extra.
3. Si el JSON indica un evento atípico (ej. un cliente moroso o cancelado), réstalo de la proyección.

Formato de Salida: Tu respuesta debe ser estrictamente un JSON válido con la siguiente estructura, sin formato markdown:
{ "carga_sugerida": { "cartones_huevos": 0, "kilos_pollo": 0 }, "porcentaje_confianza": 0, "justificacion_breve": "string" }

Datos históricos provistos:
${JSON.stringify(historicalData, null, 2)}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });

      const jsonStr = response.text;
      if (!jsonStr) {
        throw new Error("No response from Gemini");
      }

      const parsedData = JSON.parse(jsonStr);
      res.json(parsedData);
    } catch (error: any) {
      console.error("Error predicting load:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/ventas", requirePermission(['ventas', 'facturacion'], 'create'), async (req, res) => {
    try {
      const { factura, detalles } = req.body;
      const usuario = (req as any).usuario; // resuelto por requirePermission (Bearer o x-user-id → BD)
      const usuarioId = (usuario && usuario.id) || 'system';
      
      if (!factura || !detalles || !Array.isArray(detalles)) {
        return res.status(400).json({ error: "Datos de factura y detalles inválidos" });
      }

      const facturaId = factura.id || crypto.randomUUID();
      factura.id = facturaId;

      // Validar vendedor y cliente existen (FKs NOT NULL de facturas). Un id del body
      // inexistente antes derivaba en 500 por violación de foreign key en BDs con FKs activas.
      // R5: sin fallback hardcodeado a '3'; un Vendedor factura SIEMPRE a su propio id,
      // los demás roles pueden delegar a otro usuario válido (o default a ellos mismos).
      const vendedorId = usuario?.role === 'Vendedor'
        ? usuario.id
        : (factura.vendedorId || usuario?.id);
      const [vendedorValido] = await db.select().from(schema.users).where(eq(schema.users.id, vendedorId)).limit(1);
      if (!vendedorValido) {
        return res.status(400).json({ error: `Vendedor no existe: ${vendedorId}` });
      }
      // R2: el cliente sentinel 'consumidor-final' se auto-crea (FK satisfecha) — no se rechaza.
      const esConsumidorFinal = factura.clienteId === 'consumidor-final';
      const clienteValido = factura.clienteId && !esConsumidorFinal
        ? await db.query.clientes.findFirst({ where: eq(clientes.id, factura.clienteId) })
        : null;
      if (factura.clienteId && !esConsumidorFinal && !clienteValido) {
        return res.status(400).json({ error: `Cliente no existe: ${factura.clienteId}` });
      }

      // F2: resolve truck from guía despacho (or camion_id) — bug antiguo usaba 'Camión Ruta 1' hardcodeado
      let camionNombre = 'Camión Ruta 1';
      let camionResueltoId: string | null = null;
      const etiquetasEntregadas: { etiquetaId: string }[] = [];
      if (factura.guiaId) {
        const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, factura.guiaId) });
        if (guia?.camionId) {
          const camion = await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) });
          camionNombre = camion?.nombre || 'Camión Ruta 1';
          camionResueltoId = guia.camionId || null;
        }
      } else if (factura.camionId) {
        const camion = await db.query.camiones.findFirst({ where: eq(camiones.id, factura.camionId) });
        camionNombre = camion?.nombre || 'Camión Ruta 1';
        camionResueltoId = factura.camionId;
      }

      // PHASE 5: Credit limit validation
      if (factura.condicion_pago === 'Credito') {
        const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, factura.clienteId) });
        if (cliente) {
          const nuevoSaldo = Number(cliente.saldo_pendiente || 0) + Number(factura.total);
          const limite = Number(cliente.limite_credito || 0);
          if (limite > 0 && nuevoSaldo > limite) {
            return res.status(400).json({ 
              error: `Cliente excede límite de crédito. Saldo actual: ${cliente.saldo_pendiente}, Límite: ${limite}, Total factura: ${factura.total}`,
              requiereAprobacion: true,
              tipoAprobacion: 'DescuentoNoAutorizado'
            });
          }
        }
      }

      // PHASE 5: Auto-apply prices from price lists if not provided
      const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, factura.clienteId) });
      const clienteRuta = cliente?.ruta || factura.ruta;
      let preciosAplicados: any[] = [];
      
      for (const det of detalles) {
        if (!det.precio_unitario || det.precio_unitario === 0) {
          const precioLista = await getPrecioParaProducto(det.producto, factura.clienteId, clienteRuta);
          if (precioLista) {
            det.precio_unitario = precioLista.precio;
            det.subtotal = det.cantidad * precioLista.precio;
            preciosAplicados.push({ producto: det.producto, precio: precioLista.precio, lista: precioLista.listaUsada });
          }
        }
      }

      // Recalculate totals if prices were auto-applied
      if (preciosAplicados.length > 0) {
        const subtotalCalc = detalles.reduce((a: number, d: any) => a + Number(d.subtotal || d.cantidad * d.precio_unitario), 0);
        factura.subtotal = subtotalCalc;
        factura.total = subtotalCalc - Number(factura.descuento || 0);
      }

      let consecutivoAsignado = '';
      await db.transaction(async (tx) => {
        // R1: el consecutivo se expide en el backend (nunca lo reparte el cliente) —
        // elimina los FAC duplicados del frontend (`array.length + 1`).
        const consec = await siguienteConsecutivo(tx, 'FACTURA', 'GLOBAL', 'FAC', 4);
        consecutivoAsignado = consec.s;
        // R2: garantiza la fila consumidor final para satisfacer la FK de facturas.
        if (esConsumidorFinal) await getClienteConsumidorFinal(tx);

        // 1. Insert Factura
        await tx.insert(facturas).values({
          id: factura.id,
          consecutivo: consecutivoAsignado,
          fecha: factura.fecha,
          // Vencimiento resuelto al crear, para que el aging no dependa de
          // recalcularlo cada lectura. `Credito` no tiene plazo fijo definido en
          // la app, así que vence el mismo día y no se inventa ninguno.
          fechaVencimiento: fechaVencimientoDe(factura as any) || null,
          clienteId: factura.clienteId,
          vendedorId,
          subtotal: factura.subtotal,
          descuento: factura.descuento,
          total: factura.total,
          condicion_pago: factura.condicion_pago,
          metodo_pago: factura.metodo_pago,
          estado: factura.estado,
          guiaId: factura.guiaId || null,
          camionId: camionResueltoId
        });

        // 2. Update client saldo if credit sale
        if (factura.condicion_pago === 'Credito' && cliente) {
          await tx.update(clientes).set({
            saldo_pendiente: Number(cliente.saldo_pendiente || 0) + Number(factura.total)
          }).where(eq(clientes.id, factura.clienteId));
        }

        // 3. Insert Detalles & Update Inventario
        for (const det of detalles) {
          await tx.insert(detallesFactura).values({
            id: crypto.randomUUID(),
            facturaId: factura.id,
            producto: det.producto,
            cantidad: det.cantidad,
            precio_unitario: det.precio_unitario,
            subtotal: det.subtotal
          });

          const inventoryItem = await tx.query.inventario.findFirst({
            where: and(
              eq(inventario.producto, det.producto),
              eq(inventario.ubicacion, camionNombre)
            )
          });

          if (inventoryItem) {
            if (inventoryItem.cantidad < det.cantidad) {
              throw new Error(`Inventario insuficiente para ${det.producto}`);
            }
            await tx.update(inventario)
              .set({ cantidad: inventoryItem.cantidad - det.cantidad })
              .where(eq(inventario.id, inventoryItem.id));
          }

          if (det.etiquetaId) {
            await tx.update(etiquetas)
              .set({ estado: 'Entregada', ubicacionActual: camionNombre })
              .where(eq(etiquetas.id, det.etiquetaId));
            etiquetasEntregadas.push({ etiquetaId: det.etiquetaId });
          }
        }
      });

      // PHASE 5: Log audit
      await logAudit(usuarioId, 'Crear', 'Factura', factura.id, null, { total: factura.total, cliente: factura.clienteId, condicion: factura.condicion_pago });

      // Traza de entregas (fuera de la transacción para evitar SQLITE_BUSY)
      for (const e of etiquetasEntregadas) {
        await recordEvent(e.etiquetaId, 'Entregada Venta', camionNombre, factura.guiaId || 'FACT-' + factura.id, usuarioId);
      }

      res.status(200).json({ 
        success: true, 
        consecutivo: consecutivoAsignado,
        message: 'Factura creada exitosamente',
        preciosAplicados: preciosAplicados.length > 0 ? preciosAplicados : undefined
      });
    } catch (error: any) {
      console.error("Error creating venta:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });


  app.get("/api/inventario", async (req, res) => {
    try {
      const data = await db.query.inventario.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/facturas", async (req, res) => {
    try {
      const data = await db.query.facturas.findMany({
        
      });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Registrar pago de una cuenta por cobrar.
  // Un pago es append-only: cada uno es una fila en `pagos` y el saldo de la
  // factura es `total - SUM(pagos.monto)`. Antes ponía `estado = 'Pagada'` sin
  // más, así que un pago parcial marcaba la factura entera como pagada y no
  // quedaba historial.
  app.post("/api/pagos", requirePermission(['facturacion', 'ventas'], 'create'), async (req, res) => {
    try {
      const { facturaId, metodoPago, monto, nota } = req.body;
      // El autor del pago es el autenticado, nunca uno del body: aceptar el
      // `usuarioId` del body firmaría la auditoría de un cobro ajeno.
      const usuarioId = ((req as any).usuario && (req as any).usuario.id) || 'system';
      if (!facturaId) return res.status(400).json({ error: "facturaId requerido" });

      const factura = await db.query.facturas.findFirst({ where: eq(facturas.id, facturaId) });
      if (!factura) return res.status(404).json({ error: "Factura no encontrada" });
      if (factura.estado === 'Anulada') {
        // Una factura anulada no debe dinero; aceptarle un pago la reviviría
        // como "Pagada" y devolvería una cartera que nunca existió.
        return res.status(409).json({ error: "No se puede pagar una factura anulada" });
      }

      const pagadoPrevio = await totalPagado(facturaId);
      const saldoPrevio = saldoDe(factura as any, pagadoPrevio);
      if (saldoPrevio <= 0) {
        return res.status(409).json({ error: "La factura ya está saldada" });
      }

      const montoPago = monto === undefined || monto === null || Number(monto) <= 0
        ? saldoPrevio
        : round2(Number(monto));
      if (!Number.isFinite(montoPago) || montoPago <= 0) {
        return res.status(400).json({ error: "monto inválido" });
      }
      if (montoPago > saldoPrevio) {
        return res.status(400).json({
          error: `El monto (${montoPago}) supera el saldo pendiente (${saldoPrevio})`,
        });
      }

      const pagoId = crypto.randomUUID();
      const saldoRestante = round2(saldoPrevio - montoPago);
      // Solo queda `Pagada` cuando no debe nada. Antes cualquier monto la marcaba.
      const estadoResultante = saldoRestante <= 0 ? 'Pagada' : factura.estado;

      await db.transaction(async (tx) => {
        await tx.insert(pagos).values({
          id: pagoId,
          facturaId,
          fecha: new Date().toISOString().slice(0, 10),
          monto: montoPago,
          metodo: metodoPago ?? null,
          usuarioId: usuarioId ?? null,
          nota: nota ?? null,
        });

        await tx.update(facturas).set({
          estado: estadoResultante,
          ...(metodoPago ? { metodo_pago: metodoPago } : {}),
        }).where(eq(facturas.id, facturaId));

        // El saldo del cliente baja por lo efectivamente pagado, no por el total.
        if (factura.condicion_pago === 'Credito') {
          await tx.update(clientes).set({
            saldo_pendiente: sql`MAX(0, COALESCE(saldo_pendiente, 0) - ${montoPago})`,
          }).where(eq(clientes.id, factura.clienteId));
        }
      });

      await logAudit(
        usuarioId,
        'Pago registrado',
        'Cobranza',
        facturaId,
        { estado: factura.estado, saldo: saldoPrevio },
        { estado: estadoResultante, saldo: saldoRestante },
        saldoRestante > 0
          ? `Pago parcial: ${montoPago} de ${saldoPrevio}`
          : `Pago total: ${montoPago}`
      );

      const actualizada = await db.query.facturas.findFirst({ where: eq(facturas.id, facturaId) });
      res.json({
        ok: true,
        pago: { id: pagoId, facturaId, monto: montoPago, metodo: metodoPago ?? null },
        pagado: round2(pagadoPrevio + montoPago),
        saldo: saldoRestante,
        factura: actualizada,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Historial de pagos de una factura, del más reciente al más antiguo. */
  app.get("/api/facturas/:id/pagos", async (req, res) => {
    try {
      const { id } = req.params;
      const factura = await db.query.facturas.findFirst({ where: eq(facturas.id, id) });
      if (!factura) return res.status(404).json({ error: "Factura no encontrada" });

      const lista = await db.query.pagos.findMany({ where: eq(pagos.facturaId, id) });
      const pagado = lista.reduce((a: number, p: any) => a + Number(p.monto || 0), 0);

      res.json({
        pagos: lista.sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha))),
        pagado: round2(pagado),
        saldo: saldoDe(factura as any, pagado),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/produccion/recoleccion", async (req, res) => {
    try {
      const { galeron, detalles } = req.body;
      
      if (!galeron || !detalles || !Array.isArray(detalles)) {
        return res.status(400).json({ error: "Datos de recolección inválidos" });
      }

      await db.transaction(async (tx) => {
        // Find galeron ID
        const galeronRecord = await tx.query.galerones.findFirst({
          where: eq(galerones.nombre, galeron)
        });

        if (!galeronRecord) throw new Error("Galerón no encontrado");

        // Find active lote for this galeron
        const loteRecord = await tx.query.lotes_aves.findFirst({
          where: and(
            eq(lotes_aves.galeronId, galeronRecord.id),
            eq(lotes_aves.estado, 'Activo')
          )
        });

        const loteId = loteRecord ? loteRecord.id : "NO_LOTE_ACTIVO";
        const fecha = new Date().toISOString();
        
        // Create placeholder lote if none exists (FK constraint requires valid lote_id)
        if (!loteRecord) {
          const placeholderId = "NO_LOTE_ACTIVO";
          const existingPlaceholder = await tx.query.lotes_aves.findFirst({ where: eq(lotes_aves.id, placeholderId) });
          if (!existingPlaceholder) {
            await tx.insert(lotes_aves).values({
              id: placeholderId,
              galeronId: galeronRecord.id,
              fecha_ingreso: fecha,
              cantidad_inicial: 0,
              linea_genetica: 'Sin lote activo',
              estado: 'Activo'
            });
          }
        }

        for (const det of detalles) {
          if (det.cantidad <= 0) continue;
          
          let productName: string;
          let unidad: string;
          
          if (det.producto) {
            productName = det.producto;
            const catalogItem = await tx.query.productosCatalogo.findFirst({
              where: eq(schema.productosCatalogo.nombre, det.producto)
            });
            unidad = catalogItem ? catalogItem.unidad : (det.producto.toLowerCase().includes('gallinaza') ? 'sacos' : 'cartones');
          } else {
            productName = det.tamano === 'Gallinaza' ? 'Gallinaza' : `Huevos - ${det.tamano}`;
            unidad = det.tamano === 'Gallinaza' ? 'sacos' : 'cartones';
          }
          
          const inventoryItem = await tx.query.inventario.findFirst({
            where: and(
              eq(inventario.producto, productName),
              eq(inventario.ubicacion, 'Granja')
            )
          });

          if (inventoryItem) {
            await tx.update(inventario)
              .set({ 
                cantidad: inventoryItem.cantidad + det.cantidad,
                ultima_actualizacion: fecha
              })
              .where(eq(inventario.id, inventoryItem.id));
          } else {
            // If it doesn't exist, we insert it
            await tx.insert(inventario).values({
              id: crypto.randomUUID(),
              producto: productName,
              cantidad: det.cantidad,
              unidad: unidad,
              ubicacion: 'Granja',
              ultima_actualizacion: fecha
            });
          }

          const prodId = crypto.randomUUID();

          // Insert into produccion_diaria
          await tx.insert(produccion_diaria).values({
            id: prodId,
            loteId: loteId,
            granjaId: galeronRecord.granjaId,
            galeronId: galeronRecord.id,
            fecha: fecha,
            tipo_producto: productName,
            cantidad: det.cantidad,
            unidad: unidad
          });

          // Insert into movimientosInventario
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: productName,
            cantidad: det.cantidad,
            tipo: 'Entrada Producción',
            origen: galeronRecord.id,
            destino: 'Granja',
            fecha: fecha,
            referencia_id: prodId
          });
        }
      });
      
      res.status(200).json({ success: true, message: 'Recolección registrada exitosamente' });
    } catch (error: any) {
      console.error("Error registrando recolección:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // GET /api/produccion/historial se registra más abajo, con filtros de
  // granja/fecha. Este duplicado sin filtros ganaba la resolución de Express y
  // hacía que `Granjas.tsx:1009` pidiera granja+fechas y recibiera el histórico
  // completo en silencio.

  // GET /api/inventario/movimientos — enriquecido con camión/guía/estado/responsable para el árbol día → camión → eventos
  app.get("/api/inventario/movimientos", async (req, res) => {
    try {
      const [movimientos, guiasData, camionesData, trasladosData, recepcionesData, remisionesData, usersData, granjasData] =
        await Promise.all([
          db.query.movimientosInventario.findMany(),
          db.query.guias_despacho.findMany(),
          db.query.camiones.findMany(),
          db.query.traslados.findMany(),
          db.query.recepciones.findMany(),
          db.query.guias_remision.findMany(),
          db.query.users.findMany(),
          db.query.granjas.findMany()
        ]) as any[];

      const guiaPorId = new Map(guiasData.map((g: any) => [g.id, g]) as any) as Map<string, any>;
      const camionPorId = new Map(camionesData.map((c: any) => [c.id, c]) as any) as Map<string, any>;
      const trasladoPorId = new Map(trasladosData.map((t: any) => [t.id, t]) as any) as Map<string, any>;
      const granjaPorId = new Map(granjasData.map((g: any) => [g.id, g]) as any) as Map<string, any>;
      const recepcionPorId = new Map(recepcionesData.map((r: any) => [r.id, r]) as any) as Map<string, any>;
      const remisionPorId = new Map(remisionesData.map((r: any) => [r.id, r]) as any) as Map<string, any>;
      const userPorId = new Map(usersData.map((u: any) => [u.id, u]) as any) as Map<string, any>;

      const enriquecidos = movimientos.map((mv: any) => {
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

        return {
          ...mv,
          estado,
          reportadoPor,
          guiaId,
          consecutivo,
          camionId: camion?.id ?? null,
          camionNombre: camion?.nombre ?? null,
          granjaOrigenId: (traslado && traslado.granjaOrigenId) || null,
          granjaOrigenNombre: (traslado && traslado.granjaOrigenId)
            ? (granjaPorId.get(traslado.granjaOrigenId)?.nombre ?? null) : null,
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

  app.post("/api/gastos", async (req, res) => {
    try {
      const { id, fecha, categoria, monto, descripcion, usuarioId } = req.body;
      
      if (!categoria || !monto || !descripcion || !usuarioId) {
        return res.status(400).json({ error: "Datos de gasto inválidos" });
      }

      await db.insert(gastos).values({
        id: id || crypto.randomUUID(),
        fecha: fecha || new Date().toISOString(),
        categoria,
        monto,
        descripcion,
        usuarioId
      });
      
      res.status(200).json({ success: true, message: 'Gasto registrado exitosamente' });
    } catch (error: any) {
      console.error("Error registrando gasto:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.get("/api/gastos", async (req, res) => {
    try {
      const data = await db.query.gastos.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Granja Hierarchy Endpoints
  app.get("/api/granjas", async (req, res) => {
    try {
      const data = await db.query.granjas.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  

  app.post("/api/granjas/wizard", async (req, res) => {
    try {
      const { nombre, ubicacion, tipo_produccion, encargadoId, galerones: galeronesData } = req.body;
      if (!nombre) {
        return res.status(400).json({ error: "Falta nombre de la granja" });
      }

      await db.transaction(async (tx) => {
        const granjaId = crypto.randomUUID();
        await tx.insert(granjas).values({
          id: granjaId,
          nombre,
          ubicacion: ubicacion || '',
          tipo_produccion: tipo_produccion || '',
          encargadoId: encargadoId || 'admin-001',
          estado: 'Activo'
        });

        if (galeronesData && Array.isArray(galeronesData) && galeronesData.length > 0) {
          const galeronesToInsert = galeronesData.map((g: any) => ({
            id: crypto.randomUUID(),
            granjaId,
            nombre: g.nombre,
            capacidad_maxima: Number(g.capacidad_maxima),
            fecha_ultimo_mantenimiento: null,
            estado: 'Activo'
          }));
          await tx.insert(galerones).values(galeronesToInsert);
        }
      });

      res.status(201).json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/granjas", async (req, res) => {
    try {
      const { nombre, ubicacion, encargadoId } = req.body;
      if (!nombre || !ubicacion || !encargadoId) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(granjas).values({
        id: crypto.randomUUID(),
        nombre,
        ubicacion,
        encargadoId
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/galerones", async (req, res) => {
    try {
      const data = await db.query.galerones.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/galerones", async (req, res) => {
    try {
      const { granjaId, nombre, capacidad_maxima, fecha_ultimo_mantenimiento, aves_en_produccion, tipo_galeron, produccion_diaria_esperada, notas, estado } = req.body;
      if (!granjaId || !nombre || !capacidad_maxima) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(galerones).values({
        id: crypto.randomUUID(),
        granjaId,
        nombre,
        capacidad_maxima: Number(capacidad_maxima),
        aves_en_produccion: Number(aves_en_produccion) || 0,
        tipo_galeron: tipo_galeron || 'Productora',
        produccion_diaria_esperada: Number(produccion_diaria_esperada) || 0,
        notas: notas || '',
        fecha_ultimo_mantenimiento,
        estado: estado || 'Activo'
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/lotes", async (req, res) => {
    try {
      const data = await db.query.lotes_aves.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/lotes", async (req, res) => {
    try {
      const { galeronId, fecha_ingreso, cantidad_inicial, linea_genetica, estado } = req.body;
      if (!galeronId || !fecha_ingreso || !cantidad_inicial || !linea_genetica || !estado) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(lotes_aves).values({
        id: crypto.randomUUID(),
        galeronId,
        fecha_ingreso,
        cantidad_inicial: Number(cantidad_inicial),
        linea_genetica,
        estado
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/mantenimientos", async (req, res) => {
    try {
      const data = await db.query.mantenimientos.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/mantenimientos", async (req, res) => {
    try {
      const { galeronId, fecha, tipo, descripcion, estado } = req.body;
      if (!galeronId || !fecha || !tipo || !descripcion || !estado) return res.status(400).json({ error: "Faltan datos" });
      await db.insert(mantenimientos).values({
        id: crypto.randomUUID(),
        galeronId,
        fecha,
        tipo,
        descripcion,
        estado
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update mantenimiento
  app.put("/api/mantenimientos/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { estado } = req.body;
      const updateData: any = {};
      if (estado) updateData.estado = estado;
      await db.update(mantenimientos).set(updateData).where(eq(mantenimientos.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });


  // CRUD Updates Granjas
  app.put("/api/granjas/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, ubicacion, tipo_produccion, encargadoId, estado } = req.body;
      const updateData: any = {};
      if (nombre) updateData.nombre = nombre;
      if (ubicacion) updateData.ubicacion = ubicacion;
      if (tipo_produccion) updateData.tipo_produccion = tipo_produccion;
      if (encargadoId) updateData.encargadoId = encargadoId;
      if (estado) updateData.estado = estado;
      
      await db.update(granjas).set(updateData).where(eq(granjas.id, id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // CRUD Updates Galerones
  app.put("/api/galerones/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query.galerones.findFirst({ where: eq(galerones.id, id) });
      if (!existing) return res.status(404).json({ error: 'Galerón no encontrado' });
      const { nombre, capacidad_maxima, fecha_ultimo_mantenimiento, estado, aves_en_produccion, tipo_galeron, produccion_diaria_esperada, notas } = req.body;
      const updateData: any = {};
      if (nombre) updateData.nombre = nombre;
      if (capacidad_maxima) updateData.capacidad_maxima = Number(capacidad_maxima);
      if (fecha_ultimo_mantenimiento) updateData.fecha_ultimo_mantenimiento = fecha_ultimo_mantenimiento;
      if (estado) updateData.estado = estado;
      if (aves_en_produccion !== undefined) updateData.aves_en_produccion = Number(aves_en_produccion);
      if (tipo_galeron) updateData.tipo_galeron = tipo_galeron;
      if (produccion_diaria_esperada !== undefined) updateData.produccion_diaria_esperada = Number(produccion_diaria_esperada);
      if (notas !== undefined) updateData.notas = notas;
      
      await db.update(galerones).set(updateData).where(eq(galerones.id, id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete Galerón
  app.delete("/api/galerones/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query.galerones.findFirst({ where: eq(galerones.id, id) });
      if (!existing) return res.status(404).json({ error: 'Galerón no encontrado' });
      await db.update(galerones).set({ estado: 'Archivado' }).where(eq(galerones.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Lotes CRUD
  app.put("/api/lotes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query.lotes_aves.findFirst({ where: eq(lotes_aves.id, id) });
      if (!existing) return res.status(404).json({ error: 'Lote no encontrado' });
      const { cantidad_inicial, linea_genetica, estado } = req.body;
      const updateData: any = {};
      if (cantidad_inicial !== undefined) updateData.cantidad_inicial = Number(cantidad_inicial);
      if (linea_genetica) updateData.linea_genetica = linea_genetica;
      if (estado) updateData.estado = estado;
      await db.update(lotes_aves).set(updateData).where(eq(lotes_aves.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete("/api/lotes/:id", async (req, res) => {
    try {
      const existing = await db.query.lotes_aves.findFirst({ where: eq(lotes_aves.id, req.params.id) });
      if (!existing) return res.status(404).json({ error: 'Lote no encontrado' });
      await db.update(lotes_aves).set({ estado: 'Finalizado' }).where(eq(lotes_aves.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Detalle de granja
  app.get("/api/granjas/:id/detalle", async (req, res) => {
    try {
      const { id } = req.params;
      const granja = await db.query.granjas.findFirst({ where: eq(granjas.id, id) });
      if (!granja) return res.status(404).json({ error: 'Granja no encontrada' });

      const todosGalerones = await db.query.galerones.findMany();
      const todosLotes = await db.query.lotes_aves.findMany();
      const todaProduccion = await db.query.produccion_diaria.findMany();
      const todasVacunaciones = await db.query.vacunaciones.findMany();
      const todasOrdenes = await db.query.ordenes_mantenimiento.findMany();
      const todoAlimento = await db.query.consumo_alimento.findMany();
      const hoy = new Date().toISOString().split('T')[0];

      const galeronesGranja = todosGalerones.filter(g => g.granjaId === id);
      const galeronIds = galeronesGranja.map(g => g.id);

      const galerones = galeronesGranja.map(gl => {
        const lotesGranja = todosLotes.filter(l => l.galeronId === gl.id);
        const lotesActivos = lotesGranja.filter(l => l.estado === 'Activo');
        const produccionHoy = todaProduccion.filter(p => p.galeronId === gl.id && String(p.fecha).startsWith(hoy));
        const produccion7d = todaProduccion.filter(p => p.galeronId === gl.id);
        const cartonesHoy = produccionHoy.filter(p => String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0);
        const aves = gl.aves_en_produccion || 0;
        const ocupacion = gl.capacidad_maxima > 0 ? Math.round((aves / gl.capacidad_maxima) * 100) : 0;
        const vacunas = todasVacunaciones.filter(v => v.galeronId === gl.id);
        const vacunasPendientes = vacunas.filter(v => v.estado === 'Programada' && v.fechaProgramada < hoy);
        const ordenes = todasOrdenes.filter(o => o.galeronId === gl.id);
        const ordenesPendientes = ordenes.filter(o => o.estado === 'Pendiente');
        const consumo = todoAlimento.filter(c => c.galeronId === gl.id);

        return {
          id: gl.id, nombre: gl.nombre, capacidad_maxima: gl.capacidad_maxima, estado: gl.estado,
          aves_en_produccion: gl.aves_en_produccion, tipo_galeron: gl.tipo_galeron,
          produccion_diaria_esperada: gl.produccion_diaria_esperada, notas: gl.notas,
          lotes: lotesGranja, lotesActivos: lotesActivos.length,
          cartonesHoy, aves, ocupacion,
          vacunasTotales: vacunas.length, vacunasPendientes: vacunasPendientes.length,
          ordenesTotales: ordenes.length, ordenesPendientes: ordenesPendientes.length,
          consumoTotal: consumo.reduce((a, c) => a + Number(c.cantidadConsumida), 0),
          produccionHistorial: produccion7d.map(p => ({ fecha: p.fecha, tipo: p.tipo_producto, cantidad: Number(p.cantidad) })),
          mantenimientos: ordenes.map(o => ({ id: o.id, tipo: o.tipo, fecha_programada: o.fecha_programada, fecha_ejecutada: o.fecha_ejecutada, estado: o.estado, responsable: o.responsable, costo: o.costo, observaciones: o.observaciones }))
        };
      });

      const produccionGranja = todaProduccion.filter(p => p.granjaId === id);
      const cartonesHoy = produccionGranja.filter(p => String(p.fecha).startsWith(hoy) && String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0);
      const avesTotal = galerones.reduce((a, g) => a + (g.aves_en_produccion || 0), 0);
      const capacidadTotal = galeronesGranja.reduce((a, g) => a + Number(g.capacidad_maxima), 0);
      const vacunasVencidas = todasVacunaciones.filter(v => v.granjaId === id && v.estado === 'Programada' && v.fechaProgramada < hoy);
      const ordenesVencidas = todasOrdenes.filter(o => galeronIds.includes(o.galeronId) && o.estado === 'Pendiente' && o.fechaProgramada < hoy);

      res.json({
        granja, galerones,
        resumen: {
          totalGalerones: galeronesGranja.filter(g => g.estado === 'Activo').length,
          totalLotes: galerones.reduce((a, g) => a + g.lotesActivos, 0),
          avesTotal, capacidadTotal, ocupacion: capacidadTotal > 0 ? Math.round((avesTotal / capacidadTotal) * 100) : 0,
          cartonesHoy,
          vacunasVencidas: vacunasVencidas.length, ordenesVencidas: ordenesVencidas.length
        }
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Produccion historial filtrado. Único handler de esta ruta: ver el comentario
  // en el lugar donde estaba el duplicado que lo precedía.
  app.get("/api/produccion/historial", async (req, res) => {
    try {
      const { granjaId, desde, hasta } = req.query;
      let data = await db.query.produccion_diaria.findMany();
      if (granjaId) data = data.filter(p => p.granjaId === granjaId);
      if (desde) data = data.filter(p => String(p.fecha) >= String(desde));
      if (hasta) data = data.filter(p => String(p.fecha) <= String(hasta));
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Logistica Traslados
  app.post("/api/operaciones/traslado", async (req, res) => {
    try {
      const { granjaId, producto, cantidad, unidad, responsable, cargaId, vehiculo, camionId, creadoPorId } = req.body;

      await db.transaction(async (tx) => {
        // 1. Verify stock in Granja
        const stockGranja = await tx.query.inventario.findFirst({
          where: and(
            eq(inventario.producto, producto),
            eq(inventario.ubicacion, 'Granja')
          )
        });

        if (!stockGranja || stockGranja.cantidad < cantidad) {
          throw new Error("Stock insuficiente en granja para este traslado");
        }

        // Resolver vehículo: si se envía camionId, tomar el nombre del camión
        let vehiculoFinal = vehiculo || null;
        if (camionId && !vehiculoFinal) {
          const camion = await tx.query.camiones.findFirst({ where: eq(camiones.id, camionId) });
          vehiculoFinal = camion ? camion.nombre : null;
        }

        // 2. Create Traslado
        const trasladoId = crypto.randomUUID();
        await tx.insert(traslados).values({
          id: trasladoId,
          cargaId: cargaId || trasladoId,
          vehiculo: vehiculoFinal,
          camionId: camionId || null,
          creadoPorId: creadoPorId || null,
          granjaOrigenId: granjaId,
          bodegaDestinoId: 'Bodega Central',
          fechaSalida: new Date().toISOString(),
          responsableEntrega: responsable,
          responsableTransporte: 'Pendiente',
          estado: 'Pendiente'
        });

        // 3. Update Inventory
        await tx.update(inventario)
          .set({ cantidad: stockGranja.cantidad - cantidad })
          .where(eq(inventario.id, stockGranja.id));

        // 4. Add inventory in Transit (Optional logic, or just keep status)
        // For now, we assume the item is in "Transito" status
        
        // 5. Record Movement
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto: producto,
          cantidad: cantidad,
          tipo: 'Traslado',
          origen: 'Granja',
          destino: 'Bodega Central',
          fecha: new Date().toISOString(),
          referencia_id: trasladoId
        });
      });
      
      res.status(200).json({ success: true, message: 'Traslado registrado. Pendiente de confirmación del camionero' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/operaciones/traslados", async (req, res) => {
    try {
      const data = await db.query.traslados.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CAMIONES — CRUD (admin gestiona) ====================

  app.get("/api/camiones", async (req, res) => {
    try {
      const rows = await db.query.camiones.findMany({ orderBy: (c: any, { asc }: any) => [asc(c.nombre)] });
      const users = await db.query.users.findMany();
      const userMap = new Map(users.map((u: any) => [u.id, u]));
      const data = rows.map((c: any) => ({
        ...c,
        camioneroNombre: c.camioneroId ? ((userMap.get(c.camioneroId) as any)?.name || null) : null,
      }));
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/camiones", async (req, res) => {
    try {
      const { nombre, placa, camioneroId, capacidadCartones, estado } = req.body || {};
      if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: "El nombre del camión es requerido" });
      const existente = await db.query.camiones.findFirst({ where: eq(camiones.nombre, String(nombre).trim()) });
      if (existente) return res.status(400).json({ error: "Ya existe un camión con ese nombre" });
      const id = crypto.randomUUID();
      await db.insert(camiones).values({
        id,
        nombre: String(nombre).trim(),
        placa: placa || null,
        camioneroId: camioneroId || null,
        capacidad_cartones: Number(capacidadCartones) || 500,
        estado: estado || 'Activo',
      });
      res.status(201).json({ success: true, id, message: 'Camión creado' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/camiones/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const { nombre, placa, camioneroId, capacidadCartones, estado } = req.body || {};
      const existente = await db.query.camiones.findFirst({ where: eq(camiones.id, id) });
      if (!existente) return res.status(404).json({ error: "Camión no encontrado" });
      await db.update(camiones).set({
        nombre: nombre !== undefined && nombre !== null ? String(nombre).trim() : existente.nombre,
        placa: placa !== undefined ? placa : existente.placa,
        camioneroId: camioneroId !== undefined ? camioneroId : existente.camioneroId,
        capacidad_cartones: capacidadCartones !== undefined ? Number(capacidadCartones) : existente.capacidad_cartones,
        estado: estado !== undefined ? estado : existente.estado,
      }).where(eq(camiones.id, id));
      res.json({ success: true, message: 'Camión actualizado' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/camiones/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const existente = await db.query.camiones.findFirst({ where: eq(camiones.id, id) });
      if (!existente) return res.status(404).json({ error: "Camión no encontrado" });
      await db.delete(camiones).where(eq(camiones.id, id));
      res.json({ success: true, message: 'Camión eliminado' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CARGA — Confirmar / Rechazar (Camionero) ====================

  // Listar cargas pendientes para un camionero (todas las asignadas a sus camiones)
  app.get("/api/operaciones/cargas", async (req, res) => {
    try {
      const camioneroId = req.query.camioneroId as string | undefined;
      const allTraslados = await db.query.traslados.findMany({ orderBy: (t: any, { desc }: any) => [desc(t.fechaSalida)] });
      const camionesRows = await db.query.camiones.findMany();
      const camionById = new Map<string, any>(camionesRows.map((c: any) => [c.id, c]));
      const users = await db.query.users.findMany();
      const userMap = new Map<string, any>(users.map((u: any) => [u.id, u]));
      const allMovimientos = await db.query.movimientosInventario.findMany();
      const movByRef = new Map<string, any[]>();
      for (const m of allMovimientos) {
        if (m.tipo === 'Traslado' && m.referencia_id) {
          if (!movByRef.has(m.referencia_id)) movByRef.set(m.referencia_id, []);
          movByRef.get(m.referencia_id)!.push(m);
        }
      }

      // Cargar 1 camión → N traslados. Mostrar solo los Pendiente (o los no recibidos), agrupados por carga_id.
      const groups = new Map<string, any>();
      for (const t of allTraslados) {
        if (!t.cargaId) continue;
        const camion = t.camionId ? camionById.get(t.camionId) : null;
        // Si se filtra por camionero: solo las cargas en camiones donde camionero_id = camioneroId.
        // Si el camión no existe o no tiene camionero asignado, la carga NO debe ocultarse: debe
        // poder ser revisada y aprobada por el camionero (bug: cargas del encargado invisibles).
        const camioneroDelCamion = camion?.camioneroId || null;
        if (camioneroId && camioneroDelCamion && camioneroDelCamion !== camioneroId) continue;
        if (!groups.has(t.cargaId)) {
          groups.set(t.cargaId, {
            cargaId: t.cargaId,
            camionId: t.camionId,
            camionNombre: camion?.nombre || null,
            camionPlaca: camion?.placa || null,
            camioneroId: camion?.camioneroId || null,
            camioneroNombre: camion?.camioneroId ? ((userMap.get(camion.camioneroId) as any)?.name || null) : null,
            creadoPorNombre: t.creadoPorId ? ((userMap.get(t.creadoPorId) as any)?.name || null) : null,
            creadoPorId: t.creadoPorId || null,
            fechaSalida: t.fechaSalida,
            estado: t.estado,
            motivoRechazo: t.motivoRechazo || null,
            items: [],
          });
        }
        const g = groups.get(t.cargaId)!;
        g.estado = t.estado;
        g.motivoRechazo = t.motivoRechazo || g.motivoRechazo;
        const movimientos = movByRef.get(t.id) || [];
        for (const m of movimientos) {
          g.items.push({
            trasladoId: t.id,
            granjaOrigenId: t.granjaOrigenId,
            producto: m.producto,
            cantidad: m.cantidad,
            unidad: m.unidad,
          });
        }
      }
      const cargas = Array.from(groups.values());
      res.json(cargas);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Confirmar carga: todos los traslados de la carga pasan a EnTransito
  app.post("/api/operaciones/carga/:cargaId/confirmar", async (req, res) => {
    try {
      const { cargaId } = req.params;
      const { camioneroId } = req.body || {};
      if (!camioneroId) return res.status(400).json({ error: "Se requiere el id del camionero que confirma" });

      const trasladosCarga = await db.query.traslados.findMany({ where: eq(traslados.cargaId, cargaId) });
      if (trasladosCarga.length === 0) return res.status(404).json({ error: "Carga no encontrada" });

      // Regla: quien crea NO puede confirmar
      const creadores = new Set(trasladosCarga.map((t: any) => t.creadoPorId));
      if (creadores.has(camioneroId)) {
        return res.status(403).json({ error: "La persona que crea la solicitud no puede confirmarla" });
      }

      // Descartar cargas que ya fueron recibidas
      if (trasladosCarga.every((t: any) => t.estado === 'Recibido' || t.estado === 'RecibidoConDiferencia')) {
        return res.status(400).json({ error: "La carga ya fue recibida en bodega" });
      }

      await db.transaction(async (tx) => {
        for (const t of trasladosCarga) {
          if (t.estado === 'Pendiente') {
            await tx.update(traslados)
              .set({ estado: 'EnTransito', confirmadoPorId: camioneroId, motivoRechazo: null })
              .where(eq(traslados.id, t.id));
          }
        }
      });

      res.json({ success: true, message: 'Carga confirmada. En tránsito a bodega' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rechazar carga: vuelve a Pendiente/Rechazada con motivo
  app.post("/api/operaciones/carga/:cargaId/rechazar", async (req, res) => {
    try {
      const { cargaId } = req.params;
      const { camioneroId, motivo } = req.body || {};
      if (!camioneroId) return res.status(400).json({ error: "Se requiere el id del camionero que rechaza" });
      if (!motivo || !String(motivo).trim()) return res.status(400).json({ error: "Se requiere el motivo del rechazo" });

      const trasladosCarga = await db.query.traslados.findMany({ where: eq(traslados.cargaId, cargaId) });
      if (trasladosCarga.length === 0) return res.status(404).json({ error: "Carga no encontrada" });

      // Regla: quien crea NO puede rechazar tampoco
      const creadores = new Set(trasladosCarga.map((t: any) => t.creadoPorId));
      if (creadores.has(camioneroId)) {
        return res.status(403).json({ error: "La persona que crea la solicitud no puede rechazarla" });
      }

      await db.transaction(async (tx) => {
        for (const t of trasladosCarga) {
          if (t.estado === 'Pendiente' || t.estado === 'Rechazada') {
            await tx.update(traslados)
              .set({ estado: 'Rechazada', confirmadoPorId: camioneroId, motivoRechazo: String(motivo).trim() })
              .where(eq(traslados.id, t.id));
            // Restaurar stock a Granja (se descontó al crear el traslado)
            const movs = await tx.query.movimientosInventario.findMany({ where: eq(movimientosInventario.referencia_id, t.id) });
            for (const m of movs) {
              if (m.tipo !== 'Traslado') continue;
              const inv = await tx.query.inventario.findFirst({
                where: and(
                  eq(inventario.producto, m.producto),
                  eq(inventario.ubicacion, 'Granja')
                )
              });
              if (inv) {
                await tx.update(inventario)
                  .set({ cantidad: inv.cantidad + m.cantidad, ultima_actualizacion: new Date().toISOString() })
                  .where(eq(inventario.id, inv.id));
              }
            }
          }
        }
      });

      res.json({ success: true, message: 'Carga rechazada: se devuelve al encargado' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/operaciones/recepcion", async (req, res) => {
    try {
      const { trasladoId, cantidadEsperada, cantidadRecibida, motivoDiferencia, producto, responsableRecepcion, etiquetasCodigos } = req.body;
      const diferencia = Number(cantidadEsperada) - Number(cantidadRecibida);
      const recepcionResponsable = responsableRecepcion || 'Bodeguero Actual';
      const usuarioId = req.headers['x-user-id'] as string || null;

      // Etiquetas escaneadas por el bodeguero (opcional): se validan y se marcan EnBodega
      // al confirmar. Cada etiqueta es 1 cartón (1 etiqueta = 1 cartón del galerón).
      const codigos = Array.isArray(etiquetasCodigos) ? etiquetasCodigos.map(c => String(c).trim()).filter(Boolean) : [];
      const etiquetasAIngresar: any[] = [];
      if (codigos.length > 0) {
        for (const codigo of codigos) {
          const etiqueta = await db.query.etiquetas.findFirst({ where: eq(etiquetas.codigoUnico, codigo) });
          if (!etiqueta) {
            return res.status(400).json({ error: `Etiqueta ${codigo} no encontrada` });
          }
          if (etiqueta.producto !== producto) {
            return res.status(400).json({ error: `Etiqueta ${codigo} corresponde a ${etiqueta.producto}, no a ${producto}` });
          }
          if (etiqueta.estado !== 'Generada') {
            return res.status(400).json({ error: `Etiqueta ${codigo} está ${etiqueta.estado} — ya fue recibida o está en otro proceso` });
          }
          etiquetasAIngresar.push(etiqueta);
        }
      }

      // Motivo categorizado: según la opción seleccionada es Desperdicio o Posible Robo
      const opcionMotivo = clasificarDiferencia(motivoDiferencia);
      const tipoDiferencia = diferencia > 0 ? (opcionMotivo?.tipo ?? 'desperdicio') : null;
      const esIdMotivo = OPCIONES_DIFERENCIA_RECEPCION.some(o => o.id === motivoDiferencia);
      const motivoFinal = diferencia > 0
        ? (esIdMotivo ? (opcionMotivo?.label || motivoDiferencia) : (motivoDiferencia || 'Diferencia en recepción'))
        : null;

      await db.transaction(async (tx) => {
        // 1. Create Recepcion
        const recepcionId = crypto.randomUUID();
        await tx.insert(recepciones).values({
          id: recepcionId,
          trasladoId: trasladoId,
          fechaRecepcion: new Date().toISOString(),
          cantidadEsperada: Number(cantidadEsperada),
          cantidadRecibida: Number(cantidadRecibida),
          diferencia,
          motivoDiferencia: motivoFinal,
          tipoDiferencia,
          responsableRecepcion: recepcionResponsable,
          estado: diferencia === 0 ? 'Conforme' : 'ConDiferencia'
        });

        // 2. Update Traslado Status
        await tx.update(traslados)
          .set({ 
            estado: diferencia === 0 ? 'Recibido' : 'RecibidoConDiferencia',
            fechaLlegada: new Date().toISOString()
          })
          .where(eq(traslados.id, trasladoId));

        // 3. Update Inventory in Bodega (Sum received amount)
        const inventoryItem = await tx.query.inventario.findFirst({
          where: and(
            eq(inventario.producto, producto),
            eq(inventario.ubicacion, 'Bodega Central')
          )
        });

        if (inventoryItem) {
          await tx.update(inventario)
            .set({ 
              cantidad: inventoryItem.cantidad + Number(cantidadRecibida),
              ultima_actualizacion: new Date().toISOString()
            })
            .where(eq(inventario.id, inventoryItem.id));
        } else {
          await tx.insert(inventario).values({
            id: crypto.randomUUID(),
            producto: producto,
            cantidad: Number(cantidadRecibida),
            unidad: 'cartones',
            ubicacion: 'Bodega Central',
            ultima_actualizacion: new Date().toISOString()
          });
        }

        // 4. Register Final Movement
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto: producto,
          cantidad: Number(cantidadRecibida),
          tipo: 'Recepción Bodega',
          origen: 'Granja',
          destino: 'Bodega Central',
          fecha: new Date().toISOString(),
          referencia_id: recepcionId
        });

        // 5. Diferencia → clasificación según la opción de motivo seleccionada:
        //    - 'desperdicio': merma en tránsito (huevos rotos, sucios, vencidos)
        //    - 'alerta': POSIBLE ROBO — los cartones no aparecen, NO se registra desperdicio
        if (diferencia > 0 && tipoDiferencia !== 'alerta') {
          const impacto = await calcularImpactoDesperdicio(producto, diferencia);
          await tx.insert(desperdicios).values({
            id: crypto.randomUUID(),
            origen: 'Recepción Bodega',
            producto: producto,
            lote: null,
            cantidad: diferencia,
            motivo: motivoFinal || 'Diferencia en recepción',
            responsable: recepcionResponsable,
            fecha: new Date().toISOString(),
            impactoFinanciero: impacto
          });
        }

        // 6. La diferencia sale como pérdida en tránsito (kárdex equilibrado en ambos casos)
        if (diferencia > 0) {
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: producto,
            cantidad: diferencia,
            tipo: 'Pérdida en Tránsito',
            origen: 'Granja',
            destino: 'Desperdicio',
            fecha: new Date().toISOString(),
            referencia_id: recepcionId
          });
        }

        // 7. Etiquetas escaneadas → EnBodega con fecha de recepción + traza
        const ahora = new Date().toISOString();
        for (const etiqueta of etiquetasAIngresar) {
          await tx.update(etiquetas).set({
            estado: 'EnBodega',
            ubicacionActual: 'Bodega Central',
            fechaRecepcion: ahora,
          }).where(eq(etiquetas.id, etiqueta.id));
          await tx.insert(traza_etiqueta).values({
            id: crypto.randomUUID(),
            etiquetaId: etiqueta.id,
            tipoEvento: 'Recibida',
            ubicacion: 'Bodega Central',
            documentoRef: trasladoId,
            usuarioId: usuarioId,
            fecha: ahora,
            observaciones: `Recibida de granja (traslado ${trasladoId}) por ${recepcionResponsable}`,
          });
        }
      });
      
      res.status(200).json({
        success: true,
        message: 'Recepción registrada y bodega actualizada',
        tipoDiferencia,
        esPosibleRobo: tipoDiferencia === 'alerta',
        etiquetasIngresadas: etiquetasAIngresar.map(e => e.codigoUnico),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Recepciones registradas (para alertas de posible robo y control de bodega)
  app.get("/api/operaciones/recepciones", async (req, res) => {
    try {
      const rows = await db.query.recepciones.findMany({
        orderBy: desc(recepciones.fechaRecepcion)
      });
      res.json(rows.map((r: any) => ({
        ...r,
        esPosibleRobo: r.tipoDiferencia === 'alerta'
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== F1 — GUÍAS DE REMISIÓN (cadena granja → bodega) ====================

  // Emitir guía de remisión (la granja no pesa ni etiqueta: solo remite cartones)
  app.post("/api/operaciones/remision", async (req, res) => {
    try {
      const { granjaId, producto, cartones, lote, responsable, transporte } = req.body;
      if (!granjaId || !producto || !cartones || !responsable) {
        return res.status(400).json({ error: "Granja, producto, cartones y responsable son requeridos" });
      }
      const cantidad = Number(cartones);

      await db.transaction(async (tx) => {
        // 1. Verify stock in Granja
        const stockGranja = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, 'Granja'))
        });
        if (!stockGranja || stockGranja.cantidad < cantidad) {
          throw new ApiError(400, "Stock insuficiente en granja para esta remisión");
        }

        // 2. Create guía
        const guiaId = crypto.randomUUID();
        await tx.insert(guias_remision).values({
          id: guiaId,
          consecutivo: nextRemisionConsecutivo(),
          granjaId,
          fecha: new Date().toISOString(),
          producto,
          cartonesEsperados: cantidad,
          lote: lote || null,
          responsable,
          transporte: transporte || 'Camión Ruta 1',
          estado: 'EnTransito'
        });

        // 3. Decrement Granja stock, add EnTransito
        await tx.update(inventario)
          .set({ cantidad: stockGranja.cantidad - cantidad, ultima_actualizacion: new Date().toISOString() })
          .where(eq(inventario.id, stockGranja.id));

        const enTransito = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, 'EnTransito'))
        });
        if (enTransito) {
          await tx.update(inventario)
            .set({ cantidad: enTransito.cantidad + cantidad, ultima_actualizacion: new Date().toISOString() })
            .where(eq(inventario.id, enTransito.id));
        } else {
          await tx.insert(inventario).values({
            id: crypto.randomUUID(),
            producto,
            cantidad,
            unidad: 'cartones',
            ubicacion: 'EnTransito',
            ultima_actualizacion: new Date().toISOString()
          });
        }

        // 4. Movement record
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto,
          cantidad,
          tipo: 'Remisión',
          origen: 'Granja',
          destino: 'Bodega Central',
          fecha: new Date().toISOString(),
          referencia_id: guiaId
        });
      });

      res.status(201).json({ success: true, message: 'Guía de remisión emitida', consecutivo: undefined });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  // Listar guías de remisión
  app.get("/api/operaciones/remisiones", async (req, res) => {
    try {
      const data = await db.query.guias_remision.findMany({ orderBy: (g: any, { desc }: any) => [desc(g.fecha)] });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Recepción de remisión en bodega (conteo + báscula → diferencia controlada)
  app.post("/api/operaciones/recepcion-remision", async (req, res) => {
    try {
      const { guiaId, cantidadRecibida, pesoBruto, motivoDiferencia, responsable } = req.body;
      if (!guiaId || cantidadRecibida == null) {
        return res.status(400).json({ error: "Guía y cantidad recibida son requeridos" });
      }

      await db.transaction(async (tx) => {
        const guia = await tx.query.guias_remision.findFirst({ where: eq(guias_remision.id, guiaId) });
        if (!guia) throw new ApiError(404, "Guía de remisión no encontrada");
        if (guia.estado !== 'EnTransito') throw new ApiError(409, `No se puede recibir una guía en estado ${guia.estado}`);

        const recibida = Number(cantidadRecibida);
        const esperada = Number(guia.cartonesEsperados);
        const diferencia = esperada - recibida;

        // Motivo categorizado: desperdicio vs posible robo
        const opcionMotivo = clasificarDiferencia(motivoDiferencia);
        const tipoDiferencia = diferencia > 0 ? (opcionMotivo?.tipo ?? 'desperdicio') : null;
        const esIdMotivo = OPCIONES_DIFERENCIA_RECEPCION.some(o => o.id === motivoDiferencia);
        const motivoFinal = diferencia > 0
          ? (esIdMotivo ? (opcionMotivo?.label || motivoDiferencia) : (motivoDiferencia || 'Diferencia en recepción'))
          : null;

        // 1. Recepción
        const recepcionId = crypto.randomUUID();
        await tx.insert(recepciones).values({
          id: recepcionId,
          guiaRemisionId: guiaId,
          fechaRecepcion: new Date().toISOString(),
          cantidadEsperada: esperada,
          cantidadRecibida: recibida,
          diferencia,
          pesoBruto: pesoBruto != null ? Number(pesoBruto) : null,
          motivoDiferencia: motivoFinal,
          tipoDiferencia,
          responsableRecepcion: responsable || 'Bodeguero Actual',
          estado: diferencia === 0 ? 'Conforme' : 'ConDiferencia'
        });

        // 2. Guía → Recibida
        await tx.update(guias_remision)
          .set({
            estado: diferencia === 0 ? 'Recibida' : 'RecibidaConDiferencia',
            recibidoEn: new Date().toISOString()
          })
          .where(eq(guias_remision.id, guiaId));

        // 3. EnTransito → Bodega Central (descontar lo despachado, no solo lo recibido:
        //    la diferencia es pérdida en tránsito y se contabiliza como desperdicio)
        const enTransito = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, guia.producto), eq(inventario.ubicacion, 'EnTransito'))
        });
        if (enTransito) {
          const salida = Math.min(esperada, enTransito.cantidad);
          const restante = enTransito.cantidad - salida;
          if (restante <= 0) {
            await tx.delete(inventario).where(eq(inventario.id, enTransito.id));
          } else {
            await tx.update(inventario)
              .set({ cantidad: restante, ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, enTransito.id));
          }
        }

        const bodegaItem = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, guia.producto), eq(inventario.ubicacion, 'Bodega Central'))
        });
        if (bodegaItem) {
          await tx.update(inventario)
            .set({ cantidad: bodegaItem.cantidad + recibida, ultima_actualizacion: new Date().toISOString() })
            .where(eq(inventario.id, bodegaItem.id));
        } else {
          await tx.insert(inventario).values({
            id: crypto.randomUUID(),
            producto: guia.producto,
            cantidad: recibida,
            unidad: 'cartones',
            ubicacion: 'Bodega Central',
            ultima_actualizacion: new Date().toISOString()
          });
        }

        // 4. Diferencia → desperdicio controlado SOLO si no es posible robo
        if (diferencia > 0 && tipoDiferencia !== 'alerta') {
          const impacto = await calcularImpactoDesperdicio(guia.producto, diferencia);
          await tx.insert(desperdicios).values({
            id: crypto.randomUUID(),
            origen: 'Remisión ' + guia.consecutivo,
            producto: guia.producto,
            lote: guia.lote || null,
            cantidad: diferencia,
            motivo: motivoFinal || 'Diferencia en recepción',
            responsable: responsable || 'Bodeguero Actual',
            fecha: new Date().toISOString(),
            impactoFinanciero: impacto
          });
        }

        // 5. Movement record
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto: guia.producto,
          cantidad: recibida,
          tipo: 'Recepción Bodega',
          origen: 'EnTransito',
          destino: 'Bodega Central',
          fecha: new Date().toISOString(),
          referencia_id: recepcionId
        });

        // 6. La diferencia sale del tránsito como pérdida controlada (kárdex equilibrado)
        if (diferencia > 0) {
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: guia.producto,
            cantidad: diferencia,
            tipo: 'Pérdida en Tránsito',
            origen: 'EnTransito',
            destino: 'Desperdicio',
            fecha: new Date().toISOString(),
            referencia_id: recepcionId
          });
        }

        // 7. Punto de custodia con báscula: peso de llegada a bodega
        if (pesoBruto != null) {
          await registrarPesoPunto({
            cliente: tx,
            referenciaId: recepcionId,
            tipoReferencia: 'Recepción de Remisión',
            producto: guia.producto,
            cantidadUnidades: recibida,
            pesoReal: Number(pesoBruto),
            responsable,
            ubicacion: 'Bodega Central',
            observaciones: `Remisión ${guia.consecutivo}`
          });
        }
      });

      res.json({ success: true, message: 'Remisión recibida en bodega' });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  // Alistamiento en bodega: arma galerones de N cartones y emite etiquetas QR (nacen en bodega)
  app.post("/api/operaciones/alistamiento", async (req, res) => {
    const CARTONES_POR_GALERON = 30; // decisión pendiente #1: configurable
    try {
      const { guiaId, producto, cartones, granjaOrigen, lote, clasificacion, pesoBruto, responsable } = req.body;
      if (!producto || !cartones) {
        return res.status(400).json({ error: "Producto y cartones son requeridos" });
      }
      const constPorGaleron = Number(req.body.cartonesPorGaleron) || CARTONES_POR_GALERON;
      const total = Number(cartones);
      if (total <= 0) return res.status(400).json({ error: "Cartones debe ser mayor a 0" });

      const etiquetasCreadas: { id: string; codigoUnico: string; cantidad: number }[] = [];

      await db.transaction(async (tx) => {
        // 1. Validar stock en Bodega Central (las etiquetas identifican existencia ya contada)
        const stockBodega = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, 'Bodega Central'))
        });
        if (!stockBodega || stockBodega.cantidad < total) {
          throw new ApiError(400, "Stock insuficiente en Bodega Central para alistar");
        }

        // 2. Armar galerones
        const galerones = [];
        let restante = total;
        while (restante > 0) {
          galerones.push(Math.min(constPorGaleron, restante));
          restante -= Math.min(constPorGaleron, restante);
        }

        const fechaDia = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const bodega = 'BOD';
        const sec = Date.now();
        // El pesoBruto recibido es del lote completo: se reparte equitativamente entre los galerones armados
        const pesoPorGaleron = pesoBruto != null ? Number(pesoBruto) / galerones.length : null;

        for (let i = 0; i < galerones.length; i++) {
          const id = crypto.randomUUID();
          const codigoUnico = `ETQ-${fechaDia}-${bodega}-${sec}-${i + 1}`;
          await tx.insert(etiquetas).values({
            id,
            codigoUnico,
            producto,
            cantidad: galerones[i],
            pesoBruto: pesoPorGaleron,
            pesoBodega: pesoPorGaleron,
            fechaProduccion: new Date().toISOString(),
            fechaEmpaque: new Date().toISOString(),
            granjaOrigen: granjaOrigen || null,
            galeronOrigen: `Galerón ${i + 1}`,
            clasificacion: clasificacion || null,
            estado: 'EnBodega',
            ubicacionActual: 'Bodega Central',
            lote: lote || null,
            guiaRemisionId: guiaId || null
          });
          await tx.insert(traza_etiqueta).values({
            id: crypto.randomUUID(),
            etiquetaId: id,
            tipoEvento: 'Alistamiento',
            ubicacion: 'Bodega Central',
            documentoRef: guiaId || null,
            usuarioId: responsable || null,
            fecha: new Date().toISOString(),
            observaciones: `Galerón armado con ${galerones[i]} cartones`
          });
          etiquetasCreadas.push({ id, codigoUnico, cantidad: galerones[i] });
        }

        // 3. Si viene guía, marcarla como Alistada
        if (guiaId) {
          const guia = await tx.query.guias_remision.findFirst({ where: eq(guias_remision.id, guiaId) });
          if (!guia) throw new ApiError(404, "Guía de remisión no encontrada");
          if (guia.estado === 'Recibida' || guia.estado === 'RecibidaConDiferencia') {
            await tx.update(guias_remision).set({ estado: 'Alistada' }).where(eq(guias_remision.id, guiaId));
          }
        }

        // 4. Punto de custodia con báscula: peso del lote alistado en bodega
        if (pesoBruto != null) {
          await registrarPesoPunto({
            cliente: tx,
            referenciaId: guiaId || null,
            tipoReferencia: 'Alistamiento',
            producto,
            cantidadUnidades: total,
            pesoReal: Number(pesoBruto),
            responsable,
            ubicacion: 'Bodega Central',
            observaciones: `${galerones.length} galerón(es) armados`
          });
        }
      });

      res.status(201).json({ success: true, message: `${total} cartones alistados en galerones`, etiquetas: etiquetasCreadas });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  // Logistica Auditoria
  app.get("/api/logistica/auditoria", async (req, res) => {
    try {
      const rutaSeleccionada = (req.query.ruta as string) || 'Camión Ruta 1';

      const todasFacturas = await db.query.facturas.findMany();
      const todosDetalles = await db.query.detallesFactura.findMany();
      const todosClientes = await db.query.clientes.findMany();
      
      const facturasCompletas = todasFacturas.map(f => ({
        ...f,
        cliente: todosClientes.find(c => c.id === f.clienteId),
        detalles: todosDetalles.filter(d => d.facturaId === f.id)
      }));
      
      const facturasDeRuta = facturasCompletas.filter(f => f.cliente && f.cliente.ruta === rutaSeleccionada);

      const todosMovimientos = await db.query.movimientosInventario.findMany();
      const hoy = new Date().toISOString().split('T')[0];
      const movimientosCarga = todosMovimientos.filter(m => 
        m.destino === rutaSeleccionada && 
        m.origen === 'Bodega Central' && 
        String(m.fecha).startsWith(hoy)
      );
      
      const totalCargado = movimientosCarga.reduce((acc, curr) => acc + Number(curr.cantidad), 0);

      res.json({
        facturas: facturasDeRuta,
        totalCargado: totalCargado
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CLIENTES CRUD ====================
  app.get("/api/clientes", async (req, res) => {
    try {
      const data = await db.query.clientes.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clientes", async (req, res) => {
    try {
      const { nombre, tipo_documento, documento_id, telefono, email, direccion, latitud, longitud, ruta, condicion_pago, precio_especial, limite_credito, notas } = req.body;
      if (!nombre) return res.status(400).json({ error: "Nombre es requerido" });
      
      const id = crypto.randomUUID();
      await db.insert(clientes).values({
        id,
        nombre,
        tipo_documento: tipo_documento || 'Fisica',
        documento_id: documento_id || null,
        telefono: telefono || null,
        email: email || null,
        direccion: direccion || null,
        latitud: latitud ? Number(latitud) : null,
        longitud: longitud ? Number(longitud) : null,
        ruta: ruta || null,
        condicion_pago: condicion_pago || 'Contado',
        precio_especial: precio_especial ? Number(precio_especial) : null,
        limite_credito: limite_credito ? Number(limite_credito) : 0,
        saldo_pendiente: 0,
        promedio_compra: 0,
        estado: 'Activo',
        notas: notas || null,
        fecha_creacion: new Date().toISOString()
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/clientes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, tipo_documento, documento_id, telefono, email, direccion, latitud, longitud, ruta, condicion_pago, precio_especial, limite_credito, notas, estado } = req.body;
      const updateData: any = {};
      if (nombre !== undefined) updateData.nombre = nombre;
      if (tipo_documento !== undefined) updateData.tipo_documento = tipo_documento;
      if (documento_id !== undefined) updateData.documento_id = documento_id;
      if (telefono !== undefined) updateData.telefono = telefono;
      if (email !== undefined) updateData.email = email;
      if (direccion !== undefined) updateData.direccion = direccion;
      if (latitud !== undefined) updateData.latitud = latitud ? Number(latitud) : null;
      if (longitud !== undefined) updateData.longitud = longitud ? Number(longitud) : null;
      if (ruta !== undefined) updateData.ruta = ruta;
      if (condicion_pago !== undefined) updateData.condicion_pago = condicion_pago;
      if (precio_especial !== undefined) updateData.precio_especial = precio_especial ? Number(precio_especial) : null;
      if (limite_credito !== undefined) updateData.limite_credito = Number(limite_credito);
      if (notas !== undefined) updateData.notas = notas;
      if (estado !== undefined) updateData.estado = estado;
      
      await db.update(clientes).set(updateData).where(eq(clientes.id, id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/clientes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(clientes).where(eq(clientes.id, id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CLIENTES CRM — CARTERA / ANÁLISIS / PERFIL 360 ====================

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

  /** Suma de `pagos.monto` de una factura. Base del saldo pendiente. */
  async function totalPagado(facturaId: string): Promise<number> {
    const lista = await db.query.pagos.findMany({ where: eq(pagos.facturaId, facturaId) });
    return round2(lista.reduce((a: number, p: any) => a + Number(p.monto || 0), 0));
  }

  /** `facturaId -> pagado`, para no consultar la tabla de pagos factura por factura. */
  async function mapaPagadoPorFactura(facturas: { id: string }[]): Promise<Map<string, number>> {
    if (facturas.length === 0) return new Map();
    const todos = await db.query.pagos.findMany();
    const porFactura = new Map<string, number>();
    for (const p of (todos as any[])) {
      porFactura.set(p.facturaId, round2((porFactura.get(p.facturaId) ?? 0) + Number(p.monto || 0)));
    }
    return porFactura;
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

    // El saldo ya descuenta lo pagado: `facturas.total` no es lo que se debe.
    const pagadoPorFactura = await mapaPagadoPorFactura(facturasTbl as any[]);

    const filas = clientesTbl.map((c: any) => {
      const facturasCliente = facturasTbl.filter((f: any) => f.clienteId === c.id);
      const facturas90d = facturasCliente.filter((f: any) => new Date(f.fecha).getTime() >= ultimoTrimestre);
      const facturas30d = facturasCliente.filter((f: any) => new Date(f.fecha).getTime() >= ultimoMes);
      const facturas12m = facturasCliente.filter((f: any) => new Date(f.fecha).getTime() >= ultimoAnio && !['Anulada'].includes(f.estado));

      const tiquetesCliente = ventasRutaTbl.filter((v: any) => v.clienteId === c.id && v.estado !== 'Anulada');
      const tiquetes30d = tiquetesCliente.filter((v: any) => new Date(v.fechaHora).getTime() >= ultimoMes);

      const ventas12mTotal = facturas12m.reduce((a: number, f: any) => a + Number(f.total || 0), 0) +
        tiquetesCliente.filter((v: any) => new Date(v.fechaHora).getTime() >= ultimoAnio).reduce((a: number, v: any) => a + Number(v.total || 0), 0);
      const ticketProm = facturas90d.length > 0 ? Math.round(facturas90d.reduce((a: number, f: any) => a + Number(f.total || 0), 0) / facturas90d.length) : 0;
      const monto90d = facturas90d.reduce((a: number, f: any) => a + Number(f.total || 0), 0);

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
      const { score, nivel } = calcularScore(c, diasVencidoMax, facturas30d.length);

      return {
        id: c.id,
        nombre: c.nombre,
        tipoDocumento: c.tipo_documento,
        documentoId: c.documento_id,
        telefono: c.telefono,
        email: c.email,
        direccion: c.direccion,
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
        pedidos90d: facturas90d.length,
        ticketPromedio: ticketProm,
        monto90d,
        venta12m: Math.round(ventas12mTotal),
        usoLinea: ventas12mTotal > 0 || Number(c.saldo_pendiente || 0) > 0 ? Number(c.limite_credito || 0) > 0 ? Math.round((Number(c.saldo_pendiente || 0) / Number(c.limite_credito)) * 100) : 0 : 0,
        score,
        riesgo: nivel,
        diasVencido: diasVencidoMax,
        vencido,
        facturas30d: facturas30d.length,
        tiquetes30d: tiquetes30d.length,
        ultimaCompra: facturasCliente.length > 0 ? facturasCliente.map((f: any) => f.fecha).sort().pop() : null,
      };
    });

    const ventaTotal12m = filas.reduce((a: number, f: any) => a + Number(f.venta12m || 0), 0);
    return { filas, ventaTotal12m, fechaRef };
  }

  // Cartera enriquecida (riesgo-score, segmento, ticket, uso de línea).
  app.get("/api/clientes/cartera", async (req, res) => {
    try {
      const { filas } = await cargarCartera();
      res.json({ total: filas.length, clientes: filas });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Panel "Hoy" + Segmentación del Análisis.
  app.get("/api/clientes/analisis", async (req, res) => {
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
  app.get("/api/clientes/:id/360", async (req, res) => {
    try {
      const { id } = req.params;
      const cliente = await db.query.clientes.findFirst({ where: eq(clientes.id, id) });
      if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });

      const fechaRef = Date.now();
      const iniMes = new Date(fechaRef); iniMes.setDate(1); iniMes.setHours(0, 0, 0, 0);

      const [facturasTbl, ventasRutaTbl, excepcionesTbl, catalogoTbl, detallesTbl] = await Promise.all([
        db.query.facturas.findMany().catch(() => []),
        db.query.ventas_ruta.findMany().catch(() => []),
        db.query.precioExcepcionesCliente.findMany().catch(() => []),
        db.query.productosCatalogo.findMany().catch(() => []),
        db.query.detallesFactura.findMany().catch(() => []),
      ]);

      const excepciones = excepcionesTbl.filter((e: any) => e.clienteId === id);

      const facturas = facturasTbl.filter((f: any) => f.clienteId === id);
      const tiquetes = ventasRutaTbl.filter((v: any) => v.clienteId === id && v.estado !== 'Anulada');

      const facturasAbiertas = facturas.filter((f: any) => !estaSaldada(f.estado));
      const pendientesCredito = facturasAbiertas.filter((f: any) => esCredito(f.condicion_pago));
      const pagadoPorFactura = await mapaPagadoPorFactura(facturas as any[]);
      // Vencida = pasado el vencimiento y con saldo. Antes era "más de 0 días
      // desde la emisión", que daba por vencida lo que aún no se debía.
      const vencidas = pendientesCredito.filter((f: any) =>
        diasVencidoDe(f, fechaRef) > 0 && saldoDe(f, pagadoPorFactura.get(f.id) ?? 0) > 0);
      const facturas30d = facturas.filter((f: any) => new Date(f.fecha) >= iniMes && f.estado !== 'Anulada');
      const tiquetes30d = tiquetes.filter((v: any) => new Date(v.fechaHora) >= iniMes);

      const tickets = [...facturas.map((f: any) => ({ tipo: 'Factura', consecutivo: f.consecutivo, monto: f.total, fecha: f.fecha, estado: f.estado, detalle: 'f' }))];
      const montosFactura = facturas.filter((f: any) => f.estado !== 'Anulada').map((f: any) => Number(f.total || 0));
      const ticketProm = montosFactura.length > 0 ? Math.round(montosFactura.reduce((a, b) => a + b, 0) / montosFactura.length) : 0;
      const pedidos30d = facturas30d.length;
      const ultimaCompra = facturas.length > 0 ? facturas.map((f: any) => f.fecha).sort().pop() : null;
      const diasUltima = ultimaCompra ? diasTranscurridos(ultimaCompra, fechaRef) : null;
      const venta12m = facturas.filter((f: any) => new Date(f.fecha) >= new Date(fechaRef - 365 * 86400000) && f.estado !== 'Anulada')
        .reduce((a: number, f: any) => a + Number(f.total || 0), 0);

      const mix: Record<string, { unidades: number; monto: number }> = {};
      const detalles90: any[] = Array.isArray(detallesTbl) ? (detallesTbl as any[]) : [];
      if (facturas.length > 0 && detalles90.length > 0) {
        const ids90 = new Set(facturas.filter((f: any) => new Date(f.fecha) >= new Date(fechaRef - 90 * 86400000)).map((f: any) => f.id));
        for (const d of detalles90) {
          if (ids90.has(d.facturaId)) {
            mix[d.producto] = mix[d.producto] || { unidades: 0, monto: 0 };
            mix[d.producto].unidades += Number(d.cantidad || 0);
            mix[d.producto].monto += Number(d.subtotal || 0);
          }
        }
      }
      const mixArr = Object.entries(mix).map(([producto, v]: any) => ({ producto, ...v })).sort((a: any, b: any) => b.monto - a.monto);

      const documentos = [
        ...facturas.map((f: any) => ({ tipo: 'Factura' as const, consecutivo: f.consecutivo, monto: Number(f.total || 0), fecha: f.fecha, estado: f.estado })),
        ...tiquetes.map((v: any) => ({ tipo: 'Tiquete' as const, consecutivo: v.tiqueteConsecutivo, monto: Number(v.total || 0), fecha: v.fechaHora, estado: v.estado })),
      ].sort((a: any, b: any) => (a.fecha < b.fecha ? 1 : -1));

      res.json({
        cliente: {
          id: cliente.id, nombre: cliente.nombre, tipoDocumento: cliente.tipo_documento, documentoId: cliente.documento_id,
          telefono: cliente.telefono, email: cliente.email, direccion: cliente.direccion, ruta: cliente.ruta,
          condicionPago: cliente.condicion_pago, precioEspecial: cliente.precio_especial,
          limiteCredito: Number(cliente.limite_credito || 0), saldoPendiente: Number(cliente.saldo_pendiente || 0), notas: cliente.notas,
        },
        kpis: {
          pedidos30d, ticketProm, ultimaCompra, diasUltima, venta12m,
          deuda: Number(cliente.saldo_pendiente || 0),
          usoLinea: Number(cliente.limite_credito || 0) > 0 ? Math.round((Number(cliente.saldo_pendiente || 0) / Number(cliente.limite_credito)) * 100) : 0,
          facturasAbiertas: facturasAbiertas.length,
          montoPorCobrar: facturasAbiertas.reduce((a: number, f: any) => a + Number(f.total || 0), 0),
          vencidas: vencidas.length,
          tiquetes30d: tiquetes30d.length,
          montoTiquetes30d: tiquetes30d.reduce((a: number, v: any) => a + Number(v.total || 0), 0),
          ultimoTiquete: tiquetes.length > 0 ? { consecutivo: tiquetes.map((t: any) => t.tiqueteConsecutivo).sort().pop(), fecha: tiquetes.map((t: any) => t.fechaHora).sort().pop() } : null,
        },
        facturas: facturas.map((f: any) => ({
          id: f.id, consecutivo: f.consecutivo, fecha: f.fecha, total: Number(f.total || 0),
          condicionPago: f.condicion_pago, estado: f.estado,
          diasVencido: f.estado === 'Pagada' ? 0 : diasTranscurridos(f.fecha, fechaRef),
        })),
        tiquetes: tiquetes.map((v: any) => ({
          id: v.id, consecutivo: v.tiqueteConsecutivo, fecha: v.fechaHora, monto: Number(v.total || 0),
          cobro: v.cobro, estado: v.estado, producto: v.producto,
        })),
        documentos,
        mix: mixArr,
        excepciones: excepciones.map((e: any) => ({
          id: e.id, producto: (catalogoTbl as any[]).find((p: any) => p.id === e.productoId)?.nombre || e.productoId,
          precioBase: (catalogoTbl as any[]).find((p: any) => p.id === e.productoId)?.precioBase || 0,
          precioExcepcion: e.precioExcepcion, justificacion: e.justificacion || '', aprobadoPor: e.aprobadoPor || '',
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== RUTAS CRUD ====================
  app.get("/api/rutas", async (req, res) => {
    try {
      const data = await db.query.rutas.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/rutas", async (req, res) => {
    try {
      const { nombre, vendedor_asignado, cliente_ids, dias_frecuencia, kilometraje_aprox } = req.body;
      if (!nombre) return res.status(400).json({ error: "Nombre de ruta es requerido" });
      
      const id = crypto.randomUUID();
      await db.insert(rutas).values({
        id,
        nombre,
        vendedor_asignado: vendedor_asignado || null,
        cliente_ids: cliente_ids ? JSON.stringify(cliente_ids) : null,
        dias_frecuencia: dias_frecuencia || null,
        kilometraje_aprox: kilometraje_aprox ? Number(kilometraje_aprox) : null,
        estado: 'Activa'
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/rutas/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, vendedor_asignado, cliente_ids, dias_frecuencia, kilometraje_aprox, estado } = req.body;
      const updateData: any = {};
      if (nombre !== undefined) updateData.nombre = nombre;
      if (vendedor_asignado !== undefined) updateData.vendedor_asignado = vendedor_asignado;
      if (cliente_ids !== undefined) updateData.cliente_ids = JSON.stringify(cliente_ids);
      if (dias_frecuencia !== undefined) updateData.dias_frecuencia = dias_frecuencia;
      if (kilometraje_aprox !== undefined) updateData.kilometraje_aprox = Number(kilometraje_aprox);
      if (estado !== undefined) updateData.estado = estado;
      
      await db.update(rutas).set(updateData).where(eq(rutas.id, id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== PLAN DE CARGA ====================

  // ---- CAMIONES ----
  app.get("/api/logistica/camiones", async (req, res) => {
    try {
      const data = await db.query.camiones.findMany();
      const guiasActivas = await db.query.guias_despacho.findMany({
        where: and(
          ne(guias_despacho.estado, 'Cerrada'),
          ne(guias_despacho.estado, 'Anulada')
        )
      });
      const dataConGuia = data.map((c: any) => ({
        ...c,
        guiaActivaId: guiasActivas.find(g => g.camionId === c.id)?.id || null,
        guiaActiva: guiasActivas.find(g => g.camionId === c.id) || null
      }));
      res.json(dataConGuia);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistica/camiones", async (req, res) => {
    try {
      const { nombre, placa, ruta_defecto, vendedor_id, capacidad_cartones } = req.body;
      if (!nombre || !capacidad_cartones) {
        return res.status(400).json({ error: "Faltan datos: nombre y capacidad_cartones son obligatorios" });
      }
      const existente = await db.query.camiones.findFirst({ where: eq(camiones.nombre, nombre) });
      if (existente) return res.status(400).json({ error: `Ya existe un camión llamado "${nombre}"` });

      const id = crypto.randomUUID();
      await db.insert(camiones).values({
        id,
        nombre,
        placa: placa || null,
        ruta_defecto: ruta_defecto || null,
        vendedor_id: vendedor_id || null,
        capacidad_cartones: Number(capacidad_cartones),
        estado: 'Activo'
      });
      res.status(201).json({ success: true, id, message: 'Camión creado exitosamente' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- GUÍA / MANIOBRA DE DESPACHO ----
  app.post("/api/logistica/guias", async (req, res) => {
    try {
      const { camionId, rutaId, etiquetasIds, responsablesCarga, responsableTransporte, pesoSalida } = req.body;
      if (!camionId || !Array.isArray(etiquetasIds) || etiquetasIds.length === 0) {
        return res.status(400).json({ error: "Se requiere camionId y al menos una etiqueta para la guía" });
      }
      const camion = await db.query.camiones.findFirst({ where: eq(camiones.id, camionId) });
      if (!camion) return res.status(400).json({ error: "Camión no encontrado" });

      let totalCartonesResumen = 0;
      let etiquetasParaTraza: any[] = [];
      let guiaIdRef: string | null = null;
      await db.transaction(async (tx) => {
        // 1. Un camión no puede tener 2 guías abiertas a la vez
        const guiaAbierta = await tx.query.guias_despacho.findFirst({
          where: and(
            eq(guias_despacho.camionId, camionId),
            ne(guias_despacho.estado, 'Cerrada'),
            ne(guias_despacho.estado, 'Anulada')
          )
        });
        if (guiaAbierta) throw new ApiError(409, `El camión "${camion.nombre}" ya tiene una guía activa: ${guiaAbierta.consecutivo}`);

        // 2. Cargar etiquetas candidatas (solo estado EnBodega)
        const etiquetasCargar = await tx.query.etiquetas.findMany({
          where: and(
            inArray(etiquetas.id, etiquetasIds),
            eq(etiquetas.estado, 'EnBodega')
          )
        });
        const etiquetasSolicitadas = await tx.query.etiquetas.findMany({ where: inArray(etiquetas.id, etiquetasIds) });
        if (etiquetasCargar.length !== etiquetasIds.length) {
          const noCargables = etiquetasSolicitadas.filter(e => e.estado !== 'EnBodega').map(e => `${e.codigoUnico} (${e.estado})`);
          throw new ApiError(400, `Etiquetas no cargables (deben estar EnBodega): ${noCargables.join(', ')}`);
        }

        // 3. Capacidad del camión
        const totalCartones = etiquetasCargar.reduce((a, e: any) => a + Number(e.cantidad), 0);
        totalCartonesResumen = totalCartones;
        if (totalCartones > Number(camion.capacidad_cartones)) {
          throw new ApiError(400, `Excede capacidad del camión: ${totalCartones} cartones > ${camion.capacidad_cartones}`);
        }

        // 4. Stock Bodega Central suficiente (no cargar más de lo que hay)
        for (const etiqueta of etiquetasCargar as any[]) {
          const stockBodega = await tx.query.inventario.findFirst({
            where: and(
              eq(inventario.producto, etiqueta.producto),
              eq(inventario.ubicacion, 'Bodega Central')
            )
          });
          if (!stockBodega || stockBodega.cantidad < Number(etiqueta.cantidad)) {
            throw new ApiError(400, `Stock insuficiente en Bodega Central para ${etiqueta.producto} (etiqueta ${etiqueta.codigoUnico})`);
          }
        }

        // 5. Orden de recorrido sugerido (nearest neighbor desde el centróide de la ruta)
        const ruta = rutaId ? await tx.query.rutas.findFirst({ where: eq(rutas.id, rutaId) }) : undefined;
        let rutaOrdenJson = null;
        let clienteIds: string[] = [];
        if (ruta?.cliente_ids) {
          try { clienteIds = JSON.parse(ruta.cliente_ids); } catch { /* noop */ }
        }
        const clientesRuta = clienteIds.length > 0 ? await tx.query.clientes.findMany({ where: inArray(clientes.id, clienteIds) }) : [];
        const conUbicacion = clientesRuta.filter(c => c.latitud != null && c.longitud != null);
        if (conUbicacion.length > 0) {
          let actualLat = Number(ruta.centroide_lat || 0), actualLng = Number(ruta.centroide_lng || 0);
          const pendientes = [...conUbicacion];
          const orden: any[] = [];
          while (pendientes.length > 0) {
            let idx = 0, mejorDist = Infinity;
            for (let i = 0; i < pendientes.length; i++) {
              const c = pendientes[i] as any;
              const d = Math.pow(Number(c.latitud) - actualLat, 2) + Math.pow(Number(c.longitud) - actualLng, 2);
              if (d < mejorDist) { mejorDist = d; idx = i; }
            }
            const c = pendientes.splice(idx, 1)[0] as any;
            orden.push({ clienteId: c.id, nombre: c.nombre, prioridad: c.prioridad || 'Normal', ventanaIni: c.ventana_entrega_ini, ventanaFin: c.ventana_entrega_fin });
            actualLat = Number(c.latitud); actualLng = Number(c.longitud);
          }
          rutaOrdenJson = JSON.stringify(orden);
        }

        // 6. Crear guía + detalle
        const guiaId = crypto.randomUUID();
        guiaIdRef = guiaId;
        await tx.insert(guias_despacho).values({
          id: guiaId,
          consecutivo: nextGuiaDespachoConsecutivo(),
          camionId,
          rutaId: rutaId || null,
          fecha: new Date().toISOString(),
          horaCarga: new Date().toTimeString().slice(0, 8),
          responsableCarga: responsablesCarga || null,
          responsableTransporte: responsableTransporte || null,
          totalCartones,
          pesoSalida: pesoSalida != null ? Number(pesoSalida) : null,
          estado: 'Cargada',
          rutaOrdenJson
        });

        for (const etiqueta of etiquetasCargar as any[]) {
          await tx.insert(guias_despacho_detalle).values({
            id: crypto.randomUUID(),
            guiaId,
            etiquetaId: etiqueta.id,
            producto: etiqueta.producto,
            cartones: Number(etiqueta.cantidad),
            pesoAnden: etiqueta.pesoBruto || null,
            estadoSalida: 'checked'
          });

          // Marcar etiqueta Cargada + guía de despacho
          await tx.update(etiquetas)
            .set({ estado: 'Cargada', ubicacionActual: camion.nombre, guiaDespachoId: guiaId })
            .where(eq(etiquetas.id, etiqueta.id));

          // Bodega → Camión (bloquear stock)
          const stockBodega = await tx.query.inventario.findFirst({
            where: and(
              eq(inventario.producto, etiqueta.producto),
              eq(inventario.ubicacion, 'Bodega Central')
            )
          });
          if (stockBodega) {
            await tx.update(inventario)
              .set({ cantidad: stockBodega.cantidad - Number(etiqueta.cantidad), ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, stockBodega.id));
          }
          const camionStock = await tx.query.inventario.findFirst({
            where: and(
              eq(inventario.producto, etiqueta.producto),
              eq(inventario.ubicacion, camion.nombre)
            )
          });
          if (camionStock) {
            await tx.update(inventario)
              .set({ cantidad: camionStock.cantidad + Number(etiqueta.cantidad), ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, camionStock.id));
          } else {
            await tx.insert(inventario).values({
              id: crypto.randomUUID(),
              producto: etiqueta.producto,
              cantidad: Number(etiqueta.cantidad),
              unidad: 'cartones',
              ubicacion: camion.nombre,
              ultima_actualizacion: new Date().toISOString()
            });
          }
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: etiqueta.producto,
            cantidad: Number(etiqueta.cantidad),
            tipo: 'Carga Camión',
            origen: 'Bodega Central',
            destino: camion.nombre,
            fecha: new Date().toISOString(),
            referencia_id: guiaId
          });

          etiquetasParaTraza.push({ etiquetaId: etiqueta.id, codigo: etiqueta.codigoUnico });
        }

        // 7. Punto de custodia con báscula: peso andén (esperado) vs peso de salida del camión
        if (pesoSalida != null && totalCartones > 0) {
          const totalPesoAnden = etiquetasCargar.reduce((a: number, e: any) => a + Number(e.pesoBruto || 0), 0);
          await registrarPesoPunto({
            cliente: tx,
            referenciaId: guiaId,
            tipoReferencia: 'Carga Camión',
            producto: (etiquetasCargar[0] as any)?.producto || 'Carga (mixto)',
            cantidadUnidades: totalCartones,
            pesoEsperado: totalPesoAnden || null,
            pesoReal: Number(pesoSalida),
            responsable: responsablesCarga,
            ubicacion: camion.nombre,
            observaciones: `Carga de ${totalCartones} cartones`
          });
        }
      });

      // Traza por etiqueta (fuera de la transacción para evitar SQLITE_BUSY)
      for (const e of etiquetasParaTraza) {
        await recordEvent(e.etiquetaId, 'Cargada', camion.nombre, guiaIdRef, req.headers['x-user-id'] as string || 'system');
      }

      res.status(201).json({ success: true, message: `Guía de despacho creada: ${totalCartonesResumen}` });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  app.get("/api/logistica/guias", async (req, res) => {
    try {
      const [guias, detalles, camionesData, etiquetasData, facturasData, detallesFacturaData] = await Promise.all([
        db.query.guias_despacho.findMany({ orderBy: guias_despacho.fecha }),
        db.query.guias_despacho_detalle.findMany(),
        db.query.camiones.findMany(),
        db.query.etiquetas.findMany(),
        db.query.facturas.findMany(),
        db.query.detallesFactura.findMany()
      ]);
      // Tabla ventas_ruta (caja) puede no existir en bases legacy/tests → ventas en vivo es opcional
      let ventasRutaData: any[] = [];
      try { ventasRutaData = await db.query.ventas_ruta.findMany(); } catch { ventasRutaData = []; }
      const resumen = guias.map((g: any) => {
        const camion = camionesData.find(c => c.id === g.camionId) || null;
        const detallesGuia = detalles.filter(d => d.guiaId === g.id);
        // Vendido en vivo: prioridad a tiquetes de ruta (flujo con caja); retro-compatible con facturas directas
        const tiquetesGuia = ventasRutaData.filter(v => v.guiaId === g.id && v.estado === 'Emitida');
        const vendido = tiquetesGuia.length > 0
          ? tiquetesGuia.reduce((acc, v: any) => acc + Number(v.cartones), 0)
          : facturasData.filter(f => f.guiaId === g.id)
            .reduce((acc, f) => acc + detallesFacturaData.filter(d => d.facturaId === f.id).reduce((a, d: any) => a + Number(d.cantidad), 0), 0);
        const entregadas = etiquetasData.filter(e => e.guiaDespachoId === g.id && e.estado === 'Entregada').length;
        return {
          ...g,
          estadoLogico: estadoLogicoGuia(g),
          camionNombre: camion?.nombre || g.camionId || null,
          placa: camion?.placa || null,
          totalEtiquetas: detallesGuia.length,
          totalVendido: vendido,
          avance: g.totalCartones > 0 ? Math.round((vendido / g.totalCartones) * 100) : 0,
          entregadas
        };
      });
      res.json(resumen);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/logistica/guias-activas", async (req, res) => {
    try {
      const todas = await db.query.guias_despacho.findMany();
      const activas = todas.filter(g => g.estado !== 'Cerrada' && g.estado !== 'Anulada');
      const [camionesData, detallesData] = [await db.query.camiones.findMany(), await db.query.guias_despacho_detalle.findMany()];
      res.json(activas.map((g: any) => {
        const camion = camionesData.find(c => c.id === g.camionId) || null;
        return {
          ...g,
          estadoLogico: estadoLogicoGuia(g),
          camionNombre: camion?.nombre || g.camionId || null,
          totalEtiquetas: detallesData.filter(d => d.guiaId === g.id).length
        };
      }));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/logistica/guias/:id", async (req, res) => {
    try {
      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, req.params.id) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      const [detalles, etiquetasData, camionesData, facturasData, rutasData, clientesData] = await Promise.all([
        db.query.guias_despacho_detalle.findMany({ where: eq(guias_despacho_detalle.guiaId, guia.id) }),
        db.query.etiquetas.findMany(),
        db.query.camiones.findMany(),
        db.query.facturas.findMany({ where: eq(facturas.guiaId, guia.id) }),
        db.query.rutas.findMany(),
        db.query.clientes.findMany()
      ]);
      // Tabla ventas_ruta (caja) puede no existir en bases legacy/tests → tiquetes en vivo es opcional
      let ventasRutaData: any[] = [];
      try { ventasRutaData = await db.query.ventas_ruta.findMany({ where: eq(ventas_ruta.guiaId, guia.id) }); } catch { ventasRutaData = []; }
      const camion = camionesData.find(c => c.id === guia.camionId) || null;
      const detalleConEtiquetas = detalles.map((d: any) => {
        const e = etiquetasData.find(et => et.id === d.etiquetaId);
        return { ...d, codigoUnico: e?.codigoUnico || null, estadoEtiqueta: e?.estado || null, lote: e?.lote || null, pesoBodega: e?.pesoBodega || null };
      });
      // Clientes de la ruta (fallback a todos los activos si no hay ruta/coordenadas para no bloquear la venta)
      const rutaRec = guia.rutaId ? rutasData.find((r: any) => r.id === guia.rutaId) : null;
      let clienteIdsRuta: string[] = [];
      if (rutaRec?.cliente_ids) { try { clienteIdsRuta = JSON.parse(rutaRec.cliente_ids); } catch { /* noop */ } }
      let clientesRuta = clienteIdsRuta.length > 0
        ? clientesData.filter((c: any) => clienteIdsRuta.includes(c.id))
        : (camion?.ruta_defecto
          ? clientesData.filter((c: any) => c.ruta === camion.ruta_defecto)
          : clientesData);
      clientesRuta = clientesRuta.filter((c: any) => c.estado !== 'Inactivo');
      if (clientesRuta.length === 0) clientesRuta = clientesData.filter((c: any) => c.estado !== 'Inactivo');
      const ordenVisita = guia.rutaOrdenJson ? JSON.parse(guia.rutaOrdenJson) : [];
      const clientesRutaMap = clientesRuta.filter((c: any) => !(ordenVisita || []).some((o: any) => o.clienteId === c.id))
        .map((c: any) => ({ clienteId: c.id, nombre: c.nombre, prioridad: c.prioridad || 'Normal', ventanaIni: c.ventana_entrega_ini, ventanaFin: c.ventana_entrega_fin }));
      const ventas = ventasRutaData.map((v: any) => ({
        ventaId: v.id, tiqueteConsecutivo: v.tiqueteConsecutivo, producto: v.producto,
        cartones: Number(v.cartones), total: Number(v.total), cobro: v.cobro,
        fechaHora: v.fechaHora, etiquetaId: v.etiquetaId || null, estado: v.estado
      }));
      res.json({
        ...guia,
        estadoLogico: estadoLogicoGuia(guia),
        camionNombre: camion?.nombre || guia.camionId || null,
        placa: camion?.placa || null,
        detalle: detalleConEtiquetas,
        facturas: facturasData,
        ventas,
        rutaOrden: ordenVisita,
        clientesRuta: [...ordenVisita, ...clientesRutaMap]
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistica/guias/:id/marcar-en-ruta", async (req, res) => {
    try {
      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, req.params.id) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      if (guia.estado !== 'Cargada') return res.status(400).json({ error: `Solo una guía Cargada puede pasar a EnRuta (estado actual: ${guia.estado})` });
      await db.update(guias_despacho).set({ estado: 'EnRuta', recibidoEn: new Date().toISOString() }).where(eq(guias_despacho.id, guia.id));
      res.json({ success: true, message: 'Guía marcada EnRuta' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistica/guias/:id/cerrar", async (req, res) => {
    try {
      const { pesoLlegada, responsable } = req.body || {};
      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, req.params.id) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      if (guia.estado === 'Cerrada' || guia.estado === 'Anulada') return res.status(400).json({ error: `Guía ya ${guia.estado.toLowerCase()}` });

      let cuadreResumen: any = {};
      let etiquetasRetornadasTraza: { etiquetaId: string }[] = [];
      await db.transaction(async (tx) => {
        // 1. Etiquetas pendientes del camión → Retornada a Bodega
        const detalle = await tx.query.guias_despacho_detalle.findMany({ where: eq(guias_despacho_detalle.guiaId, guia.id) });
        const etiquetaIds = detalle.map((d: any) => d.etiquetaId).filter(Boolean);
        const etiquetasGuia = etiquetaIds.length > 0 ? await tx.query.etiquetas.findMany({ where: inArray(etiquetas.id, etiquetaIds) }) : [];
        const camion = guia.camionId ? await tx.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : undefined;

        let restanteCartones = 0;
        for (const etiqueta of etiquetasGuia as any[]) {
          if (etiqueta.estado === 'Entregada') continue;
          await tx.update(etiquetas)
            .set({ estado: 'Retornada', ubicacionActual: 'Bodega Central', guiaDespachoId: null })
            .where(eq(etiquetas.id, etiqueta.id));
          etiquetasRetornadasTraza.push({ etiquetaId: etiqueta.id });
        }

        // 2. Devolver inventario sobrante del camión a Bodega Central
        if (camion) {
          const camionStock = await tx.query.inventario.findMany({ where: eq(inventario.ubicacion, camion.nombre) });
          for (const item of camionStock) {
            if (Number(item.cantidad) > 0) {
              restanteCartones += Number(item.cantidad);
              const bodegaItem = await tx.query.inventario.findFirst({
                where: and(eq(inventario.producto, item.producto), eq(inventario.ubicacion, 'Bodega Central'))
              });
              if (bodegaItem) {
                await tx.update(inventario)
                  .set({ cantidad: bodegaItem.cantidad + Number(item.cantidad), ultima_actualizacion: new Date().toISOString() })
                  .where(eq(inventario.id, bodegaItem.id));
              } else {
                await tx.insert(inventario).values({
                  id: crypto.randomUUID(),
                  producto: item.producto,
                  cantidad: Number(item.cantidad),
                  unidad: item.unidad,
                  ubicacion: 'Bodega Central',
                  ultima_actualizacion: new Date().toISOString()
                });
              }
              await tx.insert(movimientosInventario).values({
                id: crypto.randomUUID(),
                producto: item.producto,
                cantidad: Number(item.cantidad),
                tipo: 'Retorno Camión',
                origen: camion.nombre,
                destino: 'Bodega Central',
                fecha: new Date().toISOString(),
                referencia_id: guia.id
              });
            }
            await tx.update(inventario)
              .set({ cantidad: 0, ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, item.id));
          }
        }

        // 3. Cierre: merma = cargado - vendido(hoy guía) - restante
        const facturasGuia = await tx.query.facturas.findMany({ where: eq(facturas.guiaId, guia.id) });
        const todasDetalles = await tx.query.detallesFactura.findMany();
        const totalVendido = facturasGuia.reduce((acc: number, f: any) => {
          return acc + todasDetalles.filter(d => d.facturaId === f.id).reduce((a, d) => a + Number(d.cantidad), 0);
        }, 0);
        const totalCargado = Number(guia.totalCartones);
        const merma = totalCargado - totalVendido - restanteCartones;
        cuadreResumen = { totalCargado, totalVendido, restanteCartones, merma };
        await tx.update(guias_despacho)
          .set({
            estado: 'Cerrada',
            pesoLlegada: pesoLlegada != null ? Number(pesoLlegada) : (guia.pesoLlegada || null),
            firmasJson: JSON.stringify({ cierre: { responsable: responsable || null, fecha: new Date().toISOString() } }),
            recibidoEn: new Date().toISOString()
          })
          .where(eq(guias_despacho.id, guia.id));
      });

      // Traza de retornos + auditoría (fuera de la transacción para evitar SQLITE_BUSY)
      for (const e of etiquetasRetornadasTraza) {
        await recordEvent(e.etiquetaId, 'Retornada', 'Bodega Central', guia.id, req.headers['x-user-id'] as string || 'system');
      }
      await logAudit(req.headers['x-user-id'] as string || 'system', 'Cerrar', 'GuiaDespacho', guia.id, null, { ...cuadreResumen });

      res.json({ success: true, message: 'Guía de despacho cerrada y reconciliada', estado: 'Cerrada', cuadre: cuadreResumen });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- END POINTS F2 ----

  app.post("/api/logistica/cargar-camion", async (req, res) => {
    try {
      const { rutaId, camionNombre, producto, cantidad, responsable } = req.body;
      
      await db.transaction(async (tx) => {
        // 1. Check stock in Bodega Central
        const stockBodega = await tx.query.inventario.findFirst({
          where: and(
            eq(inventario.producto, producto),
            eq(inventario.ubicacion, 'Bodega Central')
          )
        });

        if (!stockBodega || stockBodega.cantidad < cantidad) {
          throw new Error("Stock insuficiente en Bodega Central para cargar al camión");
        }

        // 2. Deduct from Bodega Central
        await tx.update(inventario)
          .set({ 
            cantidad: stockBodega.cantidad - cantidad,
            ultima_actualizacion: new Date().toISOString()
          })
          .where(eq(inventario.id, stockBodega.id));

        // 3. Add to Camion inventory
        const camionInventory = await tx.query.inventario.findFirst({
          where: and(
            eq(inventario.producto, producto),
            eq(inventario.ubicacion, camionNombre)
          )
        });

        if (camionInventory) {
          await tx.update(inventario)
            .set({
              cantidad: camionInventory.cantidad + cantidad,
              ultima_actualizacion: new Date().toISOString()
            })
            .where(eq(inventario.id, camionInventory.id));
        } else {
          await tx.insert(inventario).values({
            id: crypto.randomUUID(),
            producto,
            cantidad,
            unidad: 'cartones',
            ubicacion: camionNombre,
            ultima_actualizacion: new Date().toISOString()
          });
        }

        // 4. Record movement
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto,
          cantidad,
          tipo: 'Carga Camión',
          origen: 'Bodega Central',
          destino: camionNombre,
          fecha: new Date().toISOString(),
          referencia_id: rutaId
        });
      });

      res.status(200).json({ success: true, message: 'Camión cargado exitosamente' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CIERRE DE RUTA / CONCILIACIÓN ====================
  app.post("/api/logistica/cierre-ruta", async (req, res) => {
    try {
      const { camionNombre, responsable, observaciones } = req.body;
      
      await db.transaction(async (tx) => {
        // 1. Get current truck inventory
        const camionItems = await tx.query.inventario.findMany({
          where: eq(inventario.ubicacion, camionNombre)
        });

        const totalRestante = camionItems.reduce((acc, item) => acc + Number(item.cantidad), 0);

        // 2. Get total loaded today
        const hoy = new Date().toISOString().split('T')[0];
        const todosMovimientos = await tx.query.movimientosInventario.findMany();
        const cargasHoy = todosMovimientos.filter(m => 
          m.tipo === 'Carga Camión' && 
          m.destino === camionNombre && 
          String(m.fecha).startsWith(hoy)
        );
        const totalCargado = cargasHoy.reduce((acc, m) => acc + Number(m.cantidad), 0);

        // 3. Get total sold today (invoices from this truck)
        const todasFacturas = await tx.query.facturas.findMany();
        const todosDetalles = await tx.query.detallesFactura.findMany();
        const facturasConDetalles = todasFacturas.map(f => ({
          ...f,
          detalles: todosDetalles.filter(d => d.facturaId === f.id)
        }));
        
        // Filter by truck location (facturas emitted from this truck)
        const facturasDelCamion = facturasConDetalles.filter(f => {
          return String(f.fecha).startsWith(hoy);
        });

        const totalVendido = facturasDelCamion.reduce((acc, f) => {
          return acc + f.detalles.reduce((accD, d) => accD + Number(d.cantidad), 0);
        }, 0);

        // 4. Calculate merma
        const merma = totalCargado - totalVendido - totalRestante;

        // 5. Return remaining inventory to Bodega Central
        for (const item of camionItems) {
          if (item.cantidad > 0) {
            const bodegaItem = await tx.query.inventario.findFirst({
              where: and(
                eq(inventario.producto, item.producto),
                eq(inventario.ubicacion, 'Bodega Central')
              )
            });

            if (bodegaItem) {
              await tx.update(inventario)
                .set({ cantidad: bodegaItem.cantidad + item.cantidad })
                .where(eq(inventario.id, bodegaItem.id));
            } else {
              await tx.insert(inventario).values({
                id: crypto.randomUUID(),
                producto: item.producto,
                cantidad: item.cantidad,
                unidad: item.unidad,
                ubicacion: 'Bodega Central',
                ultima_actualizacion: new Date().toISOString()
              });
            }

            // Clear truck inventory
            await tx.update(inventario)
              .set({ cantidad: 0, ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, item.id));

            // Record return movement
            await tx.insert(movimientosInventario).values({
              id: crypto.randomUUID(),
              producto: item.producto,
              cantidad: item.cantidad,
              tipo: 'Retorno Camión',
              origen: camionNombre,
              destino: 'Bodega Central',
              fecha: new Date().toISOString(),
              referencia_id: null
            });
          }
        }

        res.json({
          success: true,
          totalCargado,
          totalVendido,
          totalRestante,
          merma,
          estado: merma === 0 ? 'Cuadrado' : 'Con Merma',
          observaciones: observaciones || ''
        });
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== F3 — CAJA DEL VENDEDOR ====================

  app.post("/api/logistica/caja/venta", async (req, res) => {
    try {
      const { guiaId, clienteId, etiquetaId, producto, cartones, precioUnitario, descuento, cobro, vendedorId } = req.body;
      const usuarioId = req.headers['x-user-id'] as string || 'system';

      if (!guiaId) return res.status(400).json({ error: "Se requiere guiaId (caja en ruta)" });
      if (!producto || !cartones || Number(cartones) <= 0) {
        return res.status(400).json({ error: "Se requiere producto y cartones > 0" });
      }

      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      if (guia.estado === 'Cerrada' || guia.estado === 'Anulada') {
        return res.status(400).json({ error: `La guía está ${guia.estado.toLowerCase()} — no se pueden registrar ventas` });
      }
      if (guia.finDiaFecha) {
        return res.status(409).json({ error: "El día ya fue cerrado por esta guía. Cuadre en central para reabrir las ventas." });
      }
      const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
      if (!camion) return res.status(400).json({ error: "La guía no tiene camión asignado" });

      // Vendedor efectivo: prioritario vendedorId, luego x-user-id; fallback a un Vendedor del usuario demo
      let vendedorEfectivo = vendedorId || (usuarioId !== 'system' ? usuarioId : null);
      if (!vendedorEfectivo) {
        const fallback = await db.query.users.findFirst({ where: eq(schema.users.role, 'Vendedor') });
        vendedorEfectivo = fallback?.id || usuarioId;
      }

      // Precio automático desde listas / catálogo si no viene uno
      let precio = Number(precioUnitario);
      if (!precio || precio === 0) {
        const cliente = clienteId ? await db.query.clientes.findFirst({ where: eq(clientes.id, clienteId) }) : null;
        const precioLista = await getPrecioParaProducto(producto, clienteId, cliente?.ruta || null);
        if (!precioLista) return res.status(400).json({ error: `No hay precio definido para ${producto}` });
        precio = precioLista.precio;
      }
      const subtotal = Number(cartones) * precio;
      const descuentoNum = Number(descuento || 0);
      const total = subtotal - descuentoNum;
      if (total < 0) return res.status(400).json({ error: "El descuento no puede superar el subtotal" });
      const cobroFinal = cobro === 'Credito' ? 'Credito' : 'Efectivo';

      let tiquete = '';
      let ventaId = '';
      const etiquetasEntregadas: { etiquetaId: string }[] = [];
      await db.transaction(async (tx) => {
        // 1. Stock del camión de la guía
        const camionStock = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, camion.nombre))
        });
        if (!camionStock || Number(camionStock.cantidad) < Number(cartones)) {
          throw new ApiError(400, `Stock insuficiente en ${camion.nombre} para ${producto} (disponible: ${camionStock?.cantidad ?? 0})`);
        }

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
        await tx.insert(ventas_ruta).values({
          id: ventaId,
          tiqueteConsecutivo: tiquete,
          camionId: camion.id,
          guiaId: guia.id,
          vendedorId: vendedorEfectivo,
          fechaHora: new Date().toISOString(),
          clienteId: clienteId || null,
          etiquetaId: etiquetaId || null,
          producto,
          cartones: Number(cartones),
          precioUnitario: precio,
          subtotal,
          descuento: descuentoNum,
          total,
          cobro: cobroFinal,
          estado: 'Emitida',
          facturaId: null,
          imprimido: true
        });

        // 4. Descontar inventario del camión
        await tx.update(inventario)
          .set({ cantidad: Number(camionStock.cantidad) - Number(cartones), ultima_actualizacion: new Date().toISOString() })
          .where(eq(inventario.id, camionStock.id));

        // 5. Movimiento de inventario
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(),
          producto,
          cantidad: Number(cartones),
          tipo: 'Venta',
          origen: camion.nombre,
          destino: clienteId ? 'Cliente' : 'Venta',
          fecha: new Date().toISOString(),
          referencia_id: ventaId
        });

        // 6. Etiqueta → Entregada si se vende el galerón completo; si es parcial, queda Cargada con el restante
        if (etiquetaId) {
          const etiqueta = await tx.query.etiquetas.findFirst({ where: eq(etiquetas.id, etiquetaId) });
          if (etiqueta && etiqueta.guiaDespachoId === guia.id && etiqueta.estado === 'Cargada') {
            const restante = Number(etiqueta.cantidad) - Number(cartones);
            if (restante <= 0) {
              await tx.update(etiquetas)
                .set({ estado: 'Entregada', ubicacionActual: camion.nombre })
                .where(eq(etiquetas.id, etiqueta.id));
              etiquetasEntregadas.push({ etiquetaId: etiqueta.id });
            } else {
              // Venta parcial: el galerón conserva los cartones que vuelven y se reingresan en el cuadre central
              await tx.update(etiquetas)
                .set({ cantidad: restante, ubicacionActual: camion.nombre })
                .where(eq(etiquetas.id, etiqueta.id));
            }
          }
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
      await logAudit(usuarioId, 'Crear', 'VentaRuta', ventaId, null, { tiquete, producto, cartones: Number(cartones), total, cobro: cobroFinal });

      res.status(201).json({
        success: true,
        ventaId,
        tiqueteConsecutivo: tiquete,
        fechaHora: new Date().toISOString(),
        producto,
        cartones: Number(cartones),
        etiquetaId: etiquetaId || null,
        total,
        cobro: cobroFinal
      });
    } catch (error: any) {
      httpError(res, error);
    }
  });

  app.post("/api/logistica/caja/devolucion", async (req, res) => {
    try {
      const { guiaId, etiquetaId, ventaRutaId, responsable, peso } = req.body;
      const usuarioId = req.headers['x-user-id'] as string || 'system';

      if (!guiaId || !etiquetaId) {
        return res.status(400).json({ error: "Se requiere guiaId y etiquetaId para la devolución" });
      }
      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      if (guia.estado === 'Cerrada' || guia.estado === 'Anulada') {
        return res.status(400).json({ error: `La guía está ${guia.estado.toLowerCase()} — no se pueden registrar retornos` });
      }
      const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
      const etiqueta = await db.query.etiquetas.findFirst({ where: eq(etiquetas.id, etiquetaId) });
      if (!etiqueta) return res.status(404).json({ error: "Etiqueta no encontrada" });

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
        if (!venta) return res.status(404).json({ error: "Tiquete no encontrado" });
        if (venta.guiaId !== guia.id) return res.status(400).json({ error: "El tiquete no pertenece a esta guía" });
        if (venta.estado !== 'Emitida') return res.status(400).json({ error: `El tiquete ya está ${venta.estado.toLowerCase()}` });
        if (venta.etiquetaId && venta.etiquetaId !== etiqueta.id) return res.status(400).json({ error: "El tiquete no corresponde a esta etiqueta" });
      }

      // Cartones que FÍSICAMENTE vuelven al camión:
      //  - Con tiquete: los cartones de la venta (no el restante del galerón).
      //  - Sin tiquete (devolución directa de un cartón ya vendido completo): la cantidad de la etiqueta.
      const cartonesRetorno = venta ? Number(venta.cartones) : Number(etiqueta.cantidad);
      if (cartonesRetorno <= 0) return res.status(400).json({ error: "Cartones de retorno no válidos" });

      // Restaurar la cantidad de la etiqueta a la íntegra del cartón físico que regresa
      const cantidadRestaurada = venta && etiqueta.estado === 'Cargada'
        ? Number(etiqueta.cantidad) + cartonesRetorno
        : cartonesRetorno;

      // Si no hay tiquete y la etiqueta nunca salió del camión (Cargada sin vender),
      // el stock del camión ya la incluye: no hay nada que sumar.
      const esSinTiqueteSinVenta = !venta && etiqueta.estado === 'Cargada';

      let ventaResumen: { tiquete?: string; cobro?: string; total?: number } = {};
      await db.transaction(async (tx) => {
        // 1. Anular el tiquete asociado (la anulación queda registrada)
        if (venta) {
          await tx.update(ventas_ruta).set({
            estado: 'Anulada',
            anuladoEn: new Date().toISOString(),
            anuladoPor: usuarioId
          }).where(eq(ventas_ruta.id, venta.id));
          ventaResumen = { tiquete: venta.tiqueteConsecutivo, cobro: venta.cobro, total: venta.total };
          // Revertir saldo si la venta original fue a crédito
          if (venta.cobro === 'Credito' && venta.clienteId) {
            const cliente = await tx.query.clientes.findFirst({ where: eq(clientes.id, venta.clienteId) });
            if (cliente) {
              const nuevoSaldo = Math.max(0, Number(cliente.saldo_pendiente || 0) - Number(venta.total));
              await tx.update(clientes).set({ saldo_pendiente: nuevoSaldo }).where(eq(clientes.id, venta.clienteId));
            }
          }
        }

        // 2. Etiqueta → Retornada con la cantidad física restaurada (vuelve al camión y luego a bodega)
        await tx.update(etiquetas)
          .set({ estado: 'Retornada', cantidad: cantidadRestaurada, ubicacionActual: camion?.nombre || 'Bodega Central' })
          .where(eq(etiquetas.id, etiqueta.id));

        // 3. Liberar inventario en el camión (solo si el cartón salió del camión con la venta)
        if (!esSinTiqueteSinVenta) {
          const camionStock = camion ? await tx.query.inventario.findFirst({
            where: and(eq(inventario.producto, etiqueta.producto), eq(inventario.ubicacion, camion.nombre))
          }) : null;
          if (camionStock) {
            await tx.update(inventario)
              .set({ cantidad: Number(camionStock.cantidad) + cartonesRetorno, ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, camionStock.id));
          } else if (camion) {
            await tx.insert(inventario).values({
              id: crypto.randomUUID(),
              producto: etiqueta.producto,
              cantidad: cartonesRetorno,
              unidad: 'cartones',
              ubicacion: camion.nombre,
              ultima_actualizacion: new Date().toISOString()
            });
          }
        }

        // 4. Registrar retorno en retornos_camion
        await tx.insert(retornos_camion).values({
          id: crypto.randomUUID(),
          guiaId: guia.id,
          etiquetaId: etiqueta.id,
          ventaRutaId: venta?.id || null,
          fecha: new Date().toISOString(),
          responsable: responsable || usuarioId,
          producto: etiqueta.producto,
          cartones: cartonesRetorno,
          etiquetasJson: JSON.stringify([{ etiquetaId: etiqueta.id, codigoUnico: etiqueta.codigoUnico, producto: etiqueta.producto, cartones: cartonesRetorno }]),
          peso: peso != null ? Number(peso) : null,
          estado: 'Registrado'
        });

        // 5. Movimiento de inventario (solo si hay flujo físico real)
        if (!esSinTiqueteSinVenta) {
          await tx.insert(movimientosInventario).values({
            id: crypto.randomUUID(),
            producto: etiqueta.producto,
            cantidad: cartonesRetorno,
            tipo: 'Retorno Camión',
            origen: 'Cliente',
            destino: camion?.nombre || 'Bodega Central',
            fecha: new Date().toISOString(),
            referencia_id: guia.id
          });
        }
      });

      await recordEvent(etiqueta.id, 'Retornada', camion?.nombre || 'Bodega Central', guia.id, usuarioId, `Restauró ${cantidadRestaurada}ct`);
      await logAudit(usuarioId, 'Crear', 'RetornoCamion', guia.id, null, { etiquetaId, cartones: cartonesRetorno, cantidadRestaurada, tiqueteAnulado: ventaResumen.tiquete || null });

      res.status(201).json({ success: true, message: 'Devolución registrada', tiqueteAnulado: ventaResumen.tiquete || null, etiquetaId, cartones: cartonesRetorno });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistica/caja/fin-dia", async (req, res) => {
    try {
      const { guiaId, responsable } = req.body || {};
      const usuarioId = req.headers['x-user-id'] as string || 'system';
      if (!guiaId) return res.status(400).json({ error: "Se requiere guiaId" });

      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;

      const [ventas, retornos, stockCamion] = await Promise.all([
        db.query.ventas_ruta.findMany({ where: eq(ventas_ruta.guiaId, guia.id) }),
        db.query.retornos_camion.findMany({ where: eq(retornos_camion.guiaId, guia.id) }),
        camion ? db.query.inventario.findMany({ where: eq(inventario.ubicacion, camion.nombre) }) : Promise.resolve([])
      ]);

      const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
      const anuladas = ventas.filter((v: any) => v.estado === 'Anulada');
      const cartonesVendidos = emitidas.reduce((a: number, v: any) => a + Number(v.cartones), 0);
      const totalEfectivo = emitidas.filter((v: any) => v.cobro === 'Efectivo').reduce((a: number, v: any) => a + Number(v.total), 0);
      const totalCredito = emitidas.filter((v: any) => v.cobro === 'Credito').reduce((a: number, v: any) => a + Number(v.total), 0);
      const cartonesRetornados = retornos.reduce((a: number, r: any) => a + Number(r.cartones), 0);
      const restanteCamion = stockCamion.reduce((a: number, i: any) => a + Number(i.cantidad), 0);
      const totalCargado = Number(guia.totalCartones) || 0;
      const mermaPreliminar = totalCargado - cartonesVendidos - restanteCamion;

      // Bloquear nuevas ventas hasta el cuadre en central
      if (!guia.finDiaFecha) {
        await db.update(guias_despacho).set({ finDiaFecha: new Date().toISOString() }).where(eq(guias_despacho.id, guia.id));
      }

      const clientesAtendidos = emitidas
        .filter((v: any) => v.clienteId)
        .map((v: any) => ({ clienteId: v.clienteId, tiquete: v.tiqueteConsecutivo, hora: v.fechaHora, total: v.total, cobro: v.cobro }));

      await logAudit(usuarioId, 'Cerrar', 'VentaRuta', guia.id, null, { cartonesVendidos, totalEfectivo, totalCredito, cartonesRetornados, restanteCamion, mermaPreliminar }, responsable || null);

      res.json({
        success: true,
        estado: 'CajaCerrada',
        guiaId: guia.id,
        cuadre: {
          tiquetesEmitidos: emitidas.length,
          tiquetesAnulados: anuladas.length,
          cartonesVendidos,
          cartonesCargados: totalCargado,
          cartonesRetornados,
          restanteCamion,
          mermaPreliminar,
          totalEfectivo,
          totalCredito,
          totalGenerado: totalEfectivo + totalCredito
        },
        clientesAtendidos
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== CUADRE EN CENTRAL (F4) ====================

  const TOLERANCIA_MERMA_DEFAULT = 0.02;

  function cuadreGuiaData(guia: any, camion: any | null, ventas: any[], retornos: any[], etiquetasGuia: any[], stockCamion: any[]) {
    const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
    const anuladas = ventas.filter((v: any) => v.estado === 'Anulada');
    const cargado = Number(guia.totalCartones) || 0;
    const vendidos = emitidas.reduce((a: number, v: any) => a + Number(v.cartones), 0);
    const cartonesAnulados = anuladas.reduce((a: number, v: any) => a + Number(v.cartones), 0);
    const retornados = retornos.reduce((a: number, r: any) => a + Number(r.cartones), 0);

    // Etiquetas físicamente en el camión al cuadrar: todo lo que no se entregó (Cargada directa o Retornada)
    const noEntregadas = etiquetasGuia.filter((e: any) => e.estado !== 'Entregada');
    const cartonesReingresar = noEntregadas.reduce((a: number, e: any) => a + Number(e.cantidad), 0);
    const restanteCamion = stockCamion.reduce((a: number, i: any) => a + Number(i.cantidad), 0);

    // Merma global: cargado = vendido + reingresado + merma (el resto vuelve a bodega)
    const merma = Math.max(0, cargado - vendidos - cartonesReingresar);
    const mermaPct = cargado > 0 ? merma / cargado : 0;
    const descuadreFisico = Math.abs(cartonesReingresar - restanteCamion);

    // Distribución de la merma por producto para el registro de desperdicios
    const productos = Array.from(new Set(etiquetasGuia.map((e: any) => e.producto).filter(Boolean) as string[]));
    const reingresarPorProducto = (p: string) => noEntregadas.filter((e: any) => e.producto === p).reduce((a: number, e: any) => a + Number(e.cantidad), 0);
    let repartoPendiente = merma;
    const mermaPorProducto = productos.map((p, i) => {
      let mP = 0;
      if (merma > 0) {
        if (productos.length === 1 || i === productos.length - 1) {
          mP = repartoPendiente;
        } else {
          const share = cartonesReingresar > 0 ? reingresarPorProducto(p) / cartonesReingresar : 1 / productos.length;
          mP = Math.floor(merma * share);
          repartoPendiente -= mP;
        }
      }
      return { producto: p, cargado: reingresarPorProducto(p) + (mP > 0 ? 0 : 0), reingresar: reingresarPorProducto(p), merma: mP };
    });
    const efectivo = emitidas.filter((v: any) => v.cobro === 'Efectivo').reduce((a: number, v: any) => a + Number(v.total), 0);
    const credito = emitidas.filter((v: any) => v.cobro === 'Credito').reduce((a: number, v: any) => a + Number(v.total), 0);

    return {
      guiaId: guia.id,
      consecutivo: guia.consecutivo,
      estado: guia.estado,
      finDiaFecha: guia.finDiaFecha || null,
      camionNombre: camion?.nombre || guia.camionId || null,
      cargado,
      vendidos,
      cartonesAnulados,
      retornados,
      cartonesReingresar,
      restanteCamion,
      merma,
      mermaPct,
      descuadreFisico,
      mermaPorProducto,
      efectivo,
      credito,
      totalGenerado: efectivo + credito,
      detalleRetornos: retornos.map((r: any) => ({ id: r.id, etiquetaId: r.etiquetaId, producto: r.producto, cartones: Number(r.cartones), peso: r.peso, estado: r.estado })),
      etiquetasReingresar: noEntregadas.map((e: any) => ({ etiquetaId: e.id, codigoUnico: e.codigoUnico, producto: e.producto, cartones: Number(e.cantidad), estado: e.estado }))
    };
  }

  async function cargarContextoCuadre(tx: any, guiaId: string) {
    const guia = await tx.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
    if (!guia) return null;
    const camion = guia.camionId ? await tx.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
    const [ventas, retornos, stockCamion, etiquetasGuia] = await Promise.all([
      tx.query.ventas_ruta.findMany({ where: eq(ventas_ruta.guiaId, guiaId) }),
      tx.query.retornos_camion.findMany({ where: eq(retornos_camion.guiaId, guiaId) }),
      camion ? tx.query.inventario.findMany({ where: eq(inventario.ubicacion, camion.nombre) }) : Promise.resolve([]),
      tx.query.etiquetas.findMany({ where: eq(etiquetas.guiaDespachoId, guia.id) })
    ]);
    return { guia, camion, ventas, retornos, stockCamion, etiquetasGuia };
  }

  app.get("/api/logistica/cuadre-central", async (req, res) => {
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
      const cuadre = cuadreGuiaData(ctx.guia, ctx.camion, ctx.ventas, ctx.retornos, ctx.etiquetasGuia, ctx.stockCamion);
      res.json({ success: true, puedeCuadrar: true, requiereAprobacion: cuadre.descuadreFisico !== 0 || cuadre.merma > TOLERANCIA_MERMA_DEFAULT * cuadre.cargado, toleranciaMermaDefault: TOLERANCIA_MERMA_DEFAULT, cuadre });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistica/cuadre-central", async (req, res) => {
    try {
      const { guiaId, responsable, pesoLlegada, mermaMotivo, mermaObservaciones, toleranciaMerma } = req.body || {};
      const usuarioId = req.headers['x-user-id'] as string || 'system';
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
        const { guia, camion, ventas, retornos, stockCamion, etiquetasGuia } = inner;
        const cuadre = cuadreGuiaData(guia, camion, ventas, retornos, etiquetasGuia, stockCamion);

        // 1. Reingresar inventario sobrante del camión → Bodega Central + cero en camión
        if (camion) {
          for (const item of stockCamion) {
            const qty = Number(item.cantidad);
            if (qty > 0) {
              const bodegaItem = await tx.query.inventario.findFirst({
                where: and(eq(inventario.producto, item.producto), eq(inventario.ubicacion, 'Bodega Central'))
              });
              if (bodegaItem) {
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
                origen: camion.nombre, destino: 'Bodega Central', fecha: new Date().toISOString(), referencia_id: guia.id
              });
            }
            await tx.update(inventario)
              .set({ cantidad: 0, ultima_actualizacion: new Date().toISOString() })
              .where(eq(inventario.id, item.id));
          }
        }

        // 2. Reingresar etiquetas no entregadas (Cargada → EnBodega) y marcar retornos Recibidos con peso
        for (const etiqueta of etiquetasGuia as any[]) {
          if (etiqueta.estado === 'Entregada') continue;
          await tx.update(etiquetas)
            .set({ estado: 'EnBodega', ubicacionActual: 'Bodega Central', guiaDespachoId: null })
            .where(eq(etiquetas.id, etiqueta.id));
        }
        if (retornos.length > 0) {
          const upd: any = { estado: 'Recibido' };
          if (pesoLlegada != null) upd.peso = Number(pesoLlegada);
          await tx.update(retornos_camion)
            .set(upd)
            .where(eq(retornos_camion.guiaId, guia.id));
        }

        // 3. Merma por producto → desperdicios
        const desperdiciosRegistrados: any[] = [];
        const vendedorGuia = (ventas && ventas.length > 0 && ventas[0].vendedorId) || (camion && camion.vendedorId) || null;
        for (const mp of cuadre.mermaPorProducto) {
          if (mp.merma > 0) {
            const impacto = await calcularImpactoDesperdicio(mp.producto, mp.merma);
            await tx.insert(desperdicios).values({
              id: crypto.randomUUID(), origen: 'Camión', producto: mp.producto, etiquetaId: null, lote: null,
              cantidad: mp.merma, peso: null, motivo: mermaMotivo || 'Ajuste Administrativo',
              responsable: responsable || usuarioId, evidencia: null, aprobacion: null,
              impactoFinanciero: impacto, fecha: new Date().toISOString(), observaciones: mermaObservaciones || `Cuadre central guía ${guia.consecutivo}`,
              rutaId: guia.rutaId || null, guiaId: guia.id, camionId: guia.camionId || null, vendedorId: vendedorGuia
            });
            desperdiciosRegistrados.push({ producto: mp.producto, cantidad: mp.merma, motivo: mermaMotivo || 'Ajuste Administrativo', impactoFinanciero: impacto });
          }
        }

        // 4. Decisión: cuadrar, o marcar diferencia + solicitar aprobación (bloquea el siguiente despacho)
        const descuadreFisico = cuadre.descuadreFisico !== 0;
        const excedeMerma = cuadre.merma > tolerancia * cuadre.cargado;
        const requiereAprobacion = descuadreFisico || excedeMerma;

        let aprobacionId: string | null = null;
        if (requiereAprobacion) {
          const tipo = descuadreFisico ? 'AjusteInventario' : 'MermaDescuadre';
          const descripcion = descuadreFisico
            ? `Descuadre físico en guía ${guia.consecutivo}: reingreso ${cuadre.cartonesReingresar}ct vs stock camión ${cuadre.restanteCamion}ct`
            : `Merma ${cuadre.merma}ct (${(cuadre.mermaPct * 100).toFixed(2)}%) excede tolerancia ${(tolerancia * 100).toFixed(1)}% en guía ${guia.consecutivo}`;
          aprobacionId = crypto.randomUUID();
          await tx.insert(aprobaciones).values({
            id: aprobacionId, tipo, modulo: 'Logistica', referenciaId: guia.id,
            solicitudUsuario: responsable || usuarioId, descripcion,
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
        resultado.retornosRecibidos = retornos.length;
        resultado.etiquetasReingresadas = cuadre.etiquetasReingresar.length;
      });

      // Trazas + auditoría (fuera de la transacción para evitar SQLITE_BUSY)
      for (const e of resultado.cuadre.etiquetasReingresar as any[]) {
        await recordEvent(e.etiquetaId, 'Reingresada', 'Bodega Central', guiaId, usuarioId, 'Cuadre central');
      }

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

  app.get("/api/logistica/tablero", async (req, res) => {
    try {
      const [todasGuias, todosCamiones, todasVentas, todosRetornos, todasEtiquetas, todosClientes, todoInventario, todasRutas, todosUsers] = await Promise.all([
        db.query.guias_despacho.findMany(),
        db.query.camiones.findMany(),
        db.query.ventas_ruta.findMany(),
        db.query.retornos_camion.findMany(),
        db.query.etiquetas.findMany(),
        db.query.clientes.findMany(),
        db.query.inventario.findMany(),
        db.query.rutas.findMany(),
        db.query.users.findMany()
      ]);

      const ahora = new Date();
      const activas = todasGuias.filter((g: any) => g.estado !== 'Cerrada' && g.estado !== 'Anulada');

      const lineas = activas.map((g: any) => {
        const camion = todosCamiones.find((c: any) => c.id === g.camionId) || null;
        const ruta = todasRutas.find((r: any) => r.id === g.rutaId) || null;
        const vendedor = camion?.vendedor_id ? todosUsers.find((u: any) => u.id === camion.vendedor_id) : null;
        const ventas = todasVentas.filter((v: any) => v.guiaId === g.id);
        const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
        const anuladas = ventas.filter((v: any) => v.estado === 'Anulada');
        const retornos = todosRetornos.filter((r: any) => r.guiaId === g.id);

        const cartonesVendidos = emitidas.reduce((a: number, v: any) => a + Number(v.cartones), 0);
        const totalEfectivo = emitidas.filter((v: any) => v.cobro === 'Efectivo').reduce((a: number, v: any) => a + Number(v.total), 0);
        const totalCredito = emitidas.filter((v: any) => v.cobro === 'Credito').reduce((a: number, v: any) => a + Number(v.total), 0);
        const cartonesRetornados = retornos.reduce((a: number, r: any) => a + Number(r.cartones), 0);
        const totalCargado = Number(g.totalCartones) || 0;
        const stockCamion = camion ? todoInventario.filter((i: any) => i.ubicacion === camion.nombre).reduce((a: number, i: any) => a + Number(i.cantidad), 0) : 0;
        const mermaPreliminar = totalCargado - cartonesVendidos - stockCamion;
        const avance = totalCargado > 0 ? Math.round((cartonesVendidos / totalCargado) * 100) : 0;

        // Clientes atendidos con hora del servidor
        const clientesAtendidos = emitidas.filter((v: any) => v.clienteId).map((v: any) => {
          const c = todosClientes.find((cl: any) => cl.id === v.clienteId);
          return { clienteId: v.clienteId, nombre: c?.nombre || 'Cliente', codigoUnico: v.tiqueteConsecutivo, tiqueteConsecutivo: v.tiqueteConsecutivo, hora: v.fechaHora, total: v.total, cobro: v.cobro };
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
          cartonesVendidos,
          cartonesRetornados,
          restanteCamion: stockCamion,
          mermaPreliminar,
          totalEfectivo,
          totalCredito,
          totalGenerado: totalEfectivo + totalCredito,
          avance,
          tiquetesEmitidos: emitidas.length,
          tiquetesAnulados: anuladas.length,
          clientesAtendidos,
          totalClientes: rutaOrden.length,
          atrasados,
          saltosSecuencia,
          detalleEtiquetas: todasEtiquetas.filter((e: any) => e.guiaDespachoId === g.id).map((e: any) => ({ etiquetaId: e.id, codigoUnico: e.codigoUnico, producto: e.producto, cartones: e.cantidad, estado: e.estado }))
        };
      });

      res.json({ fecha: ahora.toISOString(), guias: lineas });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== FACTURACIÓN ELECTRÓNICA ====================

  // Consecutivo atómico por tipo+entidad (tabla consecutivos). Reemplaza el count+1
  // de filas existentes (raza y números repetidos). Entidad 'GLOBAL' = serie única
  // para todo el sistema (FAC, FE, NC, NCR). Devuelve { n, s } con prefijo y padding.
  async function siguienteConsecutivo(tx: any, tipo: string, entidad: string, prefijo: string, longitud: number) {
    const seq = await tx.query.consecutivos.findFirst({
      where: and(eq(consecutivos.tipo, tipo), eq(consecutivos.entidad, entidad))
    });
    if (seq) {
      const n = Number(seq.ultimo) + 1;
      if (n > Number(seq.rangoHasta)) throw new Error(`Rango de consecutivos agotado para ${prefijo}`);
      await tx.update(consecutivos).set({ ultimo: n }).where(eq(consecutivos.id, seq.id));
      return { n, s: `${prefijo}-${String(n).padStart(longitud, '0')}` };
    }
    const id = crypto.randomUUID();
    await tx.insert(consecutivos).values({ id, tipo, entidad, prefijo, rangoDesde: 1, rangoHasta: 999999999, ultimo: 1 });
    return { n: 1, s: `${prefijo}-${String(1).padStart(longitud, '0')}` };
  }

  // Garantiza la fila "Consumidor Final" (tiquetes sin cliente / ventas de mostrador).
  // facturas.cliente_id es NOT NULL con FK, así que el sentinel debe existir.
  async function getClienteConsumidorFinal(tx: any) {
    const [existente] = await tx.select().from(clientes).where(eq(clientes.id, 'consumidor-final')).limit(1);
    if (existente) return existente;
    await tx.insert(clientes).values({ id: 'consumidor-final', nombre: 'Consumidor Final', tipo_documento: 'Fisica', documento_id: '000000000', condicion_pago: 'Contado', estado: 'Activo' });
    return (await tx.select().from(clientes).where(eq(clientes.id, 'consumidor-final')).limit(1))[0];
  }

  // Generar documento fiscal (Borrador)
  app.post("/api/facturacion/crear-documento", requirePermission(['facturacion', 'ventas'], 'create'), async (req, res) => {
    try {
      const { facturaId, tipoDocumento, emisorNombre, emisorCedula, emisorCorreo, receptorNombre, receptorCedula, receptorCorreo, condicionPago, medioPago, ambiente, proveedor } = req.body;
      
      if (!facturaId || !tipoDocumento || !emisorNombre || !emisorCedula) {
        return res.status(400).json({ error: "Faltan datos requeridos del documento fiscal" });
      }

      // Fetch the parent factura for amounts
      const facturaOriginal = await db.query.facturas.findFirst({
        where: eq(facturas.id, facturaId)
      });

      if (!facturaOriginal) {
        return res.status(404).json({ error: "Factura original no encontrada" });
      }

      const tipoPrefix = tipoDocumento === 'Factura' ? 'FE' : tipoDocumento === 'Tiquete' ? 'TE' : 'NC';
      const documentoId = crypto.randomUUID();
      const hoy = new Date().toISOString();
      let consecutivoFinal = '';
      let claveFinal = '';

      // R1: consecutivo por serie (DOCUMENTO_FISCAL + tipo) vía tabla consecutivos,
      // no por count+1 de filas (raza / números repetidos).
      await db.transaction(async (tx) => {
        const consec = await siguienteConsecutivo(tx, 'DOCUMENTO_FISCAL', tipoDocumento, tipoPrefix, 10);
        consecutivoFinal = consec.s;
        claveFinal = `${emisorCedula.replace(/-/g, '')}${hoy.slice(0, 10).replace(/-/g, '')}${consecutivoFinal.replace(/-/g, '')}`;

        await tx.insert(facturas_electronicas).values({
          id: documentoId,
          facturaId,
          tipoDocumento,
          consecutivo: consecutivoFinal,
          clave: claveFinal,
          fechaEmision: hoy,
          emisorNombre,
          emisorCedula,
          emisorCorreo: emisorCorreo || null,
          receptorNombre: receptorNombre || null,
          receptorCedula: receptorCedula || null,
          receptorCorreo: receptorCorreo || null,
          subtotal: facturaOriginal.subtotal,
          descuento: facturaOriginal.descuento,
          total: facturaOriginal.total,
          condicionPago: condicionPago || facturaOriginal.condicion_pago,
          medioPago: medioPago || null,
          estado: 'Borrador',
          ambiente: ambiente || 'Pruebas',
          proveedor: proveedor || null
        });
      });

      res.status(201).json({ success: true, id: documentoId, consecutivo: consecutivoFinal, clave: claveFinal });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generar XML del documento fiscal
  app.post("/api/facturacion/generar-xml", requirePermission('facturacion', 'create'), async (req, res) => {
    try {
      const { documentoId } = req.body;
      
      const doc = await db.query.facturas_electronicas.findFirst({
        where: eq(facturas_electronicas.id, documentoId)
      });

      if (!doc) return res.status(404).json({ error: "Documento fiscal no encontrado" });

      // Build XML for Costa Rica electronic invoice (simplified)
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FacturaElectronica xmlns="https://www.hacienda.go.cr/dte/0.0.0">
  <Clave>${doc.clave}</Clave>
  <NumeroConsecutivo>${doc.consecutivo}</NumeroConsecutivo>
  <FechaEmision>${doc.fechaEmision}</FechaEmision>
  <Emisor>
    <Nombre>${doc.emisorNombre}</Nombre>
    <Identificacion>${doc.emisorCedula}</Identificacion>
    ${doc.emisorCorreo ? `<CorreoElectronico>${doc.emisorCorreo}</CorreoElectronico>` : ''}
  </Emisor>
  ${doc.receptorNombre ? `<Receptor>
    <Nombre>${doc.receptorNombre}</Nombre>
    ${doc.receptorCedula ? `<Identificacion>${doc.receptorCedula}</Identificacion>` : ''}
    ${doc.receptorCorreo ? `<CorreoElectronico>${doc.receptorCorreo}</CorreoElectronico>` : ''}
  </Receptor>` : ''}
  <ResumenFactura>
    <CodigoMoneda>CRC</CodigoMoneda>
    <TotalServGravados>${doc.subtotal}</TotalServGravados>
    <TotalDescuentos>${doc.descuento || 0}</TotalDescuentos>
    <TotalVentas>${doc.total}</TotalVentas>
    <TotalImpuestos>${doc.impuestos || 0}</TotalImpuestos>
    <TotalComprobante>${doc.total}</TotalComprobante>
  </ResumenFactura>
  <MedioPago>${doc.medioPago || 'Efectivo'}</MedioPago>
  <CondicionVenta>${doc.condicionPago}</CondicionVenta>
</FacturaElectronica>`;

      await db.update(facturas_electronicas)
        .set({ 
          xmlGenerado: xml,
          estado: 'Pendiente'
        })
        .where(eq(facturas_electronicas.id, documentoId));

      res.json({ success: true, xml });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Enviar a proveedor/Hacienda (simulado)
  app.post("/api/facturacion/enviar", requirePermission('facturacion', 'create'), async (req, res) => {
    try {
      const { documentoId } = req.body;
      
      const doc = await db.query.facturas_electronicas.findFirst({
        where: eq(facturas_electronicas.id, documentoId)
      });

      if (!doc) return res.status(404).json({ error: "Documento fiscal no encontrado" });

      if (!doc.xmlGenerado) {
        return res.status(400).json({ error: "Debe generar el XML primero" });
      }

      // Simulate sending to Hacienda/provider
      await db.update(facturas_electronicas)
        .set({ 
          estado: 'Enviado',
          fechaEnvio: new Date().toISOString(),
          xmlFirmado: doc.xmlGenerado // Simulated signed XML
        })
        .where(eq(facturas_electronicas.id, documentoId));

      res.json({ success: true, message: 'Documento enviado al proveedor exitosamente' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Consultar estado / Simular respuesta de Hacienda
  app.post("/api/facturacion/consultar-estado", requirePermission('facturacion', 'create'), async (req, res) => {
    try {
      const { documentoId } = req.body;
      
      const doc = await db.query.facturas_electronicas.findFirst({
        where: eq(facturas_electronicas.id, documentoId)
      });

      if (!doc) return res.status(404).json({ error: "Documento fiscal no encontrado" });

      // Simulate Hacienda response (80% acceptance rate in test mode)
      const aceptado = Math.random() > 0.2;
      const nuevoEstado = aceptado ? 'Aceptado' : 'Rechazado';
      const respuesta = aceptado 
        ? JSON.stringify({ estado: 'Aceptado', fechaRespuesta: new Date().toISOString(), mensaje: 'Comprobante aceptado por Hacienda' })
        : JSON.stringify({ estado: 'Rechazado', fechaRespuesta: new Date().toISOString(), motivo: 'Error en formato de datos' });

      await db.update(facturas_electronicas)
        .set({ 
          estado: nuevoEstado,
          fechaRespuesta: new Date().toISOString(),
          respuestaHacienda: respuesta,
          motivoRechazo: aceptado ? null : 'Error en formato de datos'
        })
        .where(eq(facturas_electronicas.id, documentoId));

      res.json({ success: true, estado: nuevoEstado, respuesta: JSON.parse(respuesta) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Emitir Nota de Crédito
  app.post("/api/facturacion/nota-credito", requirePermission(['facturacion', 'notas_credito'], 'create'), async (req, res) => {
    try {
      const { facturaIdOriginal, motivo, monto, emisorNombre, emisorCedula } = req.body;
      
      if (!facturaIdOriginal || !motivo || !monto) {
        return res.status(400).json({ error: "Faltan datos para nota de crédito" });
      }

      const facturaOriginal = await db.query.facturas.findFirst({
        where: eq(facturas.id, facturaIdOriginal)
      });

      if (!facturaOriginal) {
        return res.status(404).json({ error: "Factura original no encontrada" });
      }

      // R3: la NC NO vuelve a sumar ingreso. Antes se insertaba estado 'Pagada' con
      // monto positivo → doble ingreso contable. Ahora usa el estado 'NotaCredito'
      // (misma convención que las NC de consolidar), que finanzas/dashboard excluyen.
      const nuevaFacturaId = crypto.randomUUID();
      const ncId = crypto.randomUUID();
      const hoy = new Date().toISOString();
      let consecutivo = '';
      let consecutivoNCR = '';

      await db.transaction(async (tx) => {
        const ncr = await siguienteConsecutivo(tx, 'NOTA_CREDITO', 'GLOBAL', 'NCR', 6);
        consecutivoNCR = ncr.s;
        await tx.insert(facturas).values({
          id: nuevaFacturaId,
          consecutivo: consecutivoNCR,
          fecha: hoy,
          clienteId: facturaOriginal.clienteId,
          vendedorId: facturaOriginal.vendedorId,
          subtotal: Number(monto),
          descuento: 0,
          total: Number(monto),
          condicion_pago: 'Contado',
          estado: 'NotaCredito',
          guiaId: facturaOriginal.guiaId || null,
          camionId: facturaOriginal.camionId || null
        });

        const nc = await siguienteConsecutivo(tx, 'DOCUMENTO_FISCAL', 'NotaCredito', 'NC', 10);
        consecutivo = nc.s;
        await tx.insert(facturas_electronicas).values({
          id: ncId,
          facturaId: nuevaFacturaId,
          tipoDocumento: 'NotaCredito',
          consecutivo,
          fechaEmision: hoy,
          emisorNombre: emisorNombre || 'Granja Don Paco',
          emisorCedula: emisorCedula || '3-101-XXXXXX',
          subtotal: Number(monto),
          total: Number(monto),
          condicionPago: 'Contado',
          estado: 'Borrador',
          notasCreditoId: facturaIdOriginal,
          ambiente: 'Pruebas'
        });
      });

      res.status(201).json({ success: true, id: ncId, consecutivo });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Listar documentos electrónicos
  app.get("/api/facturacion/documentos", async (req, res) => {
    try {
      const data = await db.query.facturas_electronicas.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // -------------------- CONSOLIDACIÓN DE RUTA → FACTURACIÓN ELECTRÓNICA (F4) --------------------

  // Factura electrónica consolidada por consumidor final a partir de los tiquetes Emitidos de la guía.
  // Devuelve: 404 si no existe la guía · 409 si no está cerrada o ya fue consolidada · 400 si no hay ventas.
  app.post("/api/facturacion/consolidar-ruta", requirePermission('facturacion', 'create'), async (req, res) => {
    try {
      const { guiaId, emisorNombre, emisorCedula, emisorCorreo } = req.body || {};
      const usuarioId = (req as any).usuario?.id || req.headers['x-user-id'] || 'system';
      if (!guiaId) return res.status(400).json({ error: "Falta guiaId" });

      // Validaciones (lectura) fuera de la transacción
      const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, guiaId) });
      if (!guia) return res.status(404).json({ error: "Guía no encontrada" });
      if (guia.estado !== 'Cerrada' && guia.estado !== 'CerradaConDiferencia') {
        return res.status(409).json({ error: `La guía debe estar cerrada (cuadre completado). Estado actual: ${guia.estado}` });
      }

      const ventas = await db.query.ventas_ruta.findMany({ where: eq(ventas_ruta.guiaId, guiaId) });
      const emitidas = ventas.filter((v: any) => v.estado === 'Emitida');
      const anuladas = ventas.filter((v: any) => v.estado === 'Anulada');
      if (emitidas.some((v: any) => v.facturaId)) {
        return res.status(409).json({ error: "Esta guía ya fue consolidada en facturación" });
      }
      if (emitidas.length === 0 && anuladas.length === 0) {
        return res.status(400).json({ error: "No hay ventas (emitidas ni anuladas) para consolidar" });
      }

      const camion = guia.camionId ? await db.query.camiones.findFirst({ where: eq(camiones.id, guia.camionId) }) : null;
      const clientes = await db.query.clientes.findMany();

      let resultado: any = null;
      await db.transaction(async (tx) => {
        const clienteDe = (id: string | null) => (id ? clientes.find((c: any) => c.id === id) : null);
        const hoy = new Date().toISOString();
        const facturasCreadas: any[] = [];
        const documentosCreados: any[] = [];
        // R2: tiquetes sin cliente se facturan a Consumidor Final (nunca se descarta el dinero).
        const consumidorFinal = await getClienteConsumidorFinal(tx);

        // 1) Factura electrónica por (cliente, cobro): separa efectivo vs crédito.
        //    Antes se agrupaba solo por cliente y un tiquete de crédito "contaminaba"
        //    todo el grupo → factura 100% crédito mezclando medios de pago (R4).
        const porCliente = new Map<string, { cliente: any; ventas: any[]; subtotal: number; descuento: number; total: number; productos: Map<string, { cantidad: number; subtotal: number }>; cobro: string }>();
        for (const v of emitidas) {
          const cobro = v.cobro === 'Credito' ? 'Credito' : 'Contado';
          const key = `${v.clienteId || '__consumidor_final__'}|${cobro}`;
          if (!porCliente.has(key)) porCliente.set(key, { cliente: clienteDe(v.clienteId) || (!v.clienteId ? consumidorFinal : null), ventas: [], subtotal: 0, descuento: 0, total: 0, productos: new Map(), cobro });
          const g = porCliente.get(key)!;
          g.ventas.push(v);
          g.subtotal += Number(v.subtotal);
          g.descuento += Number(v.descuento || 0);
          g.total += Number(v.total);
          const prod = g.productos.get(v.producto) || { cantidad: 0, subtotal: 0 };
          prod.cantidad += Number(v.cartones);
          prod.subtotal += Number(v.subtotal);
          g.productos.set(v.producto, prod);
        }

        for (const [, g] of porCliente) {
          const clienteReal = g.cliente || consumidorFinal;
          const esCredito = g.cobro === 'Credito';
          const facturaId = crypto.randomUUID();
          // R1: consecutivo global único FAC (tabla consecutivos) — no reusa números por guía.
          const consec = await siguienteConsecutivo(tx, 'FACTURA', 'GLOBAL', 'FAC', 6);
          const consecutivo = consec.s;
          await tx.insert(facturas).values({
            id: facturaId,
            consecutivo,
            fecha: hoy,
            clienteId: clienteReal.id,
            vendedorId: g.ventas[0].vendedorId,
            subtotal: g.subtotal,
            descuento: g.descuento,
            total: g.total,
            condicion_pago: esCredito ? 'Credito' : 'Contado',
            metodo_pago: esCredito ? 'Credito' : (g.cobro === 'Credito' ? 'SINPE' : (g.ventas.some((v: any) => v.cobro === 'Efectivo') ? 'Efectivo' : 'SINPE')),
            estado: esCredito ? 'Pendiente' : 'Pagada',
            guiaId,
            camionId: guia.camionId
          });
          for (const [producto, p] of g.productos) {
            await tx.insert(detallesFactura).values({
              id: crypto.randomUUID(),
              facturaId,
              producto,
              cantidad: p.cantidad,
              precio_unitario: p.cantidad > 0 ? Number((p.subtotal / p.cantidad).toFixed(2)) : 0,
              subtotal: p.subtotal
            });
          }
          for (const v of g.ventas) {
            await tx.update(ventas_ruta).set({ facturaId }).where(eq(ventas_ruta.id, v.id));
          }

          // Documento electrónico Borrador por factura consolidada
          const idFE = crypto.randomUUID();
          const consecFE = (await siguienteConsecutivo(tx, 'DOCUMENTO_FISCAL', 'Factura', 'FE', 10)).s;
          const clave = `${(emisorCedula || '3-101-000000').replace(/-/g, '')}${hoy.slice(0, 10).replace(/-/g, '')}${consecFE.replace(/-/g, '')}`;
          await tx.insert(facturas_electronicas).values({
            id: idFE,
            facturaId,
            tipoDocumento: 'Factura',
            consecutivo: consecFE,
            clave,
            fechaEmision: hoy,
            emisorNombre: emisorNombre || 'Granja Don Paco',
            emisorCedula: emisorCedula || '3-101-000000',
            emisorCorreo: emisorCorreo || null,
            receptorNombre: clienteReal.nombre || 'Consumidor Final',
            receptorCedula: clienteReal.documento_id || null,
            receptorCorreo: clienteReal.email || null,
            subtotal: g.subtotal,
            descuento: g.descuento,
            total: g.total,
            condicionPago: esCredito ? 'Credito' : 'Contado',
            medioPago: esCredito ? 'Credito' : (g.ventas.some((v: any) => v.cobro === 'Efectivo') ? 'Efectivo' : 'SINPE'),
            estado: 'Borrador',
            ambiente: 'Pruebas',
            proveedor: null
          });
          facturasCreadas.push({ consecutivo, cliente: clienteReal.nombre || 'Consumidor Final', total: g.total, condicion: esCredito ? 'Credito' : 'Contado' });
          documentosCreados.push({ id: idFE, consecutivo: consecFE, tipoDocumento: 'Factura', estado: 'Borrador' });
        }

        // 2) Nota de crédito por cada venta anulada (devolución) de la guía
        for (const v of anuladas) {
          const cli = clienteDe(v.clienteId);
          if (!cli) continue; // devolución sin cliente: no se emite documento fiscal
          // Factura receptora de la NC (no suma a ingresos: estado NotaCredito)
          const ncFacturaId = crypto.randomUUID();
          const ncrCons = await siguienteConsecutivo(tx, 'NOTA_CREDITO', 'GLOBAL', 'NCR', 6);
          await tx.insert(facturas).values({
            id: ncFacturaId,
            consecutivo: ncrCons.s,
            fecha: hoy,
            clienteId: v.clienteId!,
            vendedorId: v.vendedorId,
            subtotal: Number(v.total),
            descuento: 0,
            total: Number(v.total),
            condicion_pago: 'Contado',
            estado: 'NotaCredito',
            guiaId,
            camionId: guia.camionId
          });
          const idNC = crypto.randomUUID();
          const consecNC = (await siguienteConsecutivo(tx, 'DOCUMENTO_FISCAL', 'NotaCredito', 'NC', 10)).s;
          await tx.insert(facturas_electronicas).values({
            id: idNC,
            facturaId: ncFacturaId,
            tipoDocumento: 'NotaCredito',
            consecutivo: consecNC,
            clave: `${(emisorCedula || '3-101-000000').replace(/-/g, '')}${hoy.slice(0, 10).replace(/-/g, '')}${consecNC.replace(/-/g, '')}`,
            fechaEmision: hoy,
            emisorNombre: emisorNombre || 'Granja Don Paco',
            emisorCedula: emisorCedula || '3-101-000000',
            receptorNombre: cli.nombre,
            receptorCedula: cli.documento_id || null,
            subtotal: Number(v.total),
            descuento: 0,
            total: Number(v.total),
            condicionPago: 'Contado',
            estado: 'Borrador',
            notasCreditoId: v.id,
            ambiente: 'Pruebas'
          });
          documentosCreados.push({ id: idNC, consecutivo: consecNC, tipoDocumento: 'NotaCredito', estado: 'Borrador' });
        }

        resultado = { guiaId, facturas: facturasCreadas, documentos: documentosCreados, emitidas: emitidas.length, anuladas: anuladas.length };
      });

      await logAudit(usuarioId, 'Crear', 'ConsolidacionRuta', guiaId, null, { facturas: resultado.facturas.length, documentos: resultado.documentos.length, emitidas: resultado.emitidas, anuladas: resultado.anuladas });
      res.json({ success: true, ...resultado });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rutas del día para el Facturador: estado de consolidación fiscal por guía
  app.get("/api/facturacion/rutas-dia", async (req, res) => {
    try {
      const [guias, ventas, camionesData, facturasData] = await Promise.all([
        db.query.guias_despacho.findMany(),
        db.query.ventas_ruta.findMany(),
        db.query.camiones.findMany(),
        db.query.facturas.findMany()
      ]);
      const hoy = new Date().toISOString().slice(0, 10);
      const rutas = guias
        .filter((g: any) => !!g.finDiaFecha && String(g.finDiaFecha).slice(0, 10) === hoy)
        .map((g: any) => {
          const gv = ventas.filter((v: any) => v.guiaId === g.id);
          const camion = camionesData.find((c: any) => c.id === g.camionId);
          const consolidadas = gv.filter((v: any) => v.estado === 'Emitida' && v.facturaId).length;
          const facturasFiscales = facturasData.filter((f: any) => f.guiaId === g.id && f.estado !== 'NotaCredito');
          return {
            guiaId: g.id,
            consecutivo: g.consecutivo,
            camionNombre: camion?.nombre || '—',
            fecha: g.finDiaFecha,
            estado: g.estado,
            totalCartones: g.totalCartones,
            vendidos: gv.filter((v: any) => v.estado === 'Emitida').reduce((a: number, v: any) => a + Number(v.cartones), 0),
            totalGenerado: gv.filter((v: any) => v.estado === 'Emitida').reduce((a: number, v: any) => a + Number(v.total), 0),
            tiquetesEmitidos: gv.filter((v: any) => v.estado === 'Emitida').length,
            retornos: gv.filter((v: any) => v.estado === 'Anulada').length,
            consolidada: facturasFiscales.length > 0 || consolidadas > 0,
            nFacturas: facturasFiscales.length
          };
        })
        .sort((a: any, b: any) => String(b.fecha).localeCompare(String(a.fecha)));
      res.json({ fecha: hoy, rutas });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ETIQUETAS / QR ====================

  // Generar etiqueta para cartón
  app.post("/api/etiquetas/generar", async (req, res) => {
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

      await recordEvent(id, 'Generada', ubicacion || 'Granja', codigoUnico, undefined, lote ? `Lote ${lote}` : undefined);

      res.status(201).json({ success: true, id, codigoUnico });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generar múltiples etiquetas (lote)
  app.post("/api/etiquetas/generar-lote", async (req, res) => {
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

        await recordEvent(id, 'Generada', eq_data.ubicacion || 'Granja', codigoUnico, undefined, eq_data.lote ? `Lote ${eq_data.lote}` : undefined);

        results.push({ id, codigoUnico });
      }

      res.status(201).json({ success: true, etiquetas: results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Escanear/Actualizar estado de etiqueta
  app.post("/api/etiquetas/escanear", async (req, res) => {
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

  // Consultar trazabilidad por código de etiqueta
  app.get("/api/etiquetas/trazabilidad/:codigo", async (req, res) => {
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
      const traza = await db.query.traza_etiqueta.findMany({
        where: eq(traza_etiqueta.etiquetaId, etiqueta.id)
      });

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
  app.get("/api/etiquetas", async (req, res) => {
    try {
      const data = await db.query.etiquetas.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== BODEGA — STOCK FEFO ====================
  // Fuente principal: etiquetas serializadas (un cartón = una etiqueta) con estado EnBodega.
  // Se expone además el inventario agregado de bodega (filas sin etiqueta) para no perder stock.
  app.get("/api/bodega/stock", async (req, res) => {
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
            // 1 etiqueta = 1 cartón. `e.cantidad` son las UNIDADES (huevos) del cartón.
            cantidad: 1,
            unidad: 'cartones',
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

      const todos = [...lotes, ...inventarioAgregado];
      // FEFO: primero vence primero sale; sin fecha al final. Desempate por fecha de recepción.
      const conFecha = todos.filter(x => x.dias !== null);
      const sinFecha = todos.filter(x => x.dias === null);
      conFecha.sort((a, b) => (a.dias! - b.dias!) || String(a.fechaRecepcion || a.fechaProduccion || '').localeCompare(String(b.fechaRecepcion || b.fechaProduccion || '')));
      const colaFEFO = [...conFecha, ...sinFecha].map((x, idx) => ({ ...x, ordenFEFO: idx + 1, productoKey: norm(x.producto) || String(x.producto).toLowerCase() }));

      // Agrupar por producto (normalizado para unir "Huevos - Grande" con "Huevos Grandes").
      const porProducto = new Map<string, any>();
      for (const item of colaFEFO) {
        const key = norm(item.producto) || String(item.producto).toLowerCase();
        if (!porProducto.has(key)) {
          porProducto.set(key, {
            key,
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
        const stockTotal = inventarioAgregado.reduce((a, x) => a + x.cantidad, 0);
        // 1 etiqueta = 1 cartón: los cartones con etiqueta individual en bodega.
        const etiquetados = lotes.length;
        const porEtiquetar = Math.max(0, stockTotal - etiquetados);
        return {
          stockTotal,
          etiquetados,
          etiquetas: etiquetados,
          cartonesEtiquetados: etiquetados,
          porEtiquetar,
          lotes: new Set(lotes.map(l => l.lote).filter(Boolean)).size,
          porVencer: todos.filter(x => x.estado === 'pronto').reduce((a, x) => a + x.cantidad, 0),
          vencidos: todos.filter(x => x.estado === 'vencido').reduce((a, x) => a + x.cantidad, 0),
          sinFecha: sinFecha.reduce((a, x) => a + x.cantidad, 0),
          proximoSalir: conFecha[0] ? {
            codigoUnico: conFecha[0].codigoUnico,
            producto: conFecha[0].producto,
            lote: conFecha[0].lote,
            cantidad: conFecha[0].cantidad,
            fechaVencimiento: conFecha[0].fechaVencimiento,
            dias: conFecha[0].dias,
          } : null,
        };
      })();

      res.json({ ubicacion: 'Bodega Central', generadoEn: new Date().toISOString(), kpis, productos, colaFEFO, inventarioAgregado });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== BODEGA — INGRESO POR ESCANEO (Fase 2) ====================
  // Escanea códigos de etiqueta y las ingresa a bodega: estado EnBodega + fecha_recepcion + traza.
  app.post("/api/bodega/ingresar-etiquetas", async (req, res) => {
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
      res.status(500).json({ error: error.message });
    }
  });

  // Ingreso manual de producto a bodega (excepción: no hay traslado registrado)
  app.post("/api/bodega/ingreso-manual", async (req, res) => {
    try {
      const { producto, cantidad, unidad, procedencia, observaciones, usuarioId } = req.body;
      if (!producto || !String(producto).trim()) return res.status(400).json({ error: "El producto es requerido" });
      const cant = Number(cantidad);
      if (!Number.isFinite(cant) || cant <= 0) return res.status(400).json({ error: "La cantidad debe ser mayor a 0" });
      if (!observaciones || !String(observaciones).trim()) {
        return res.status(400).json({ error: "La observación es obligatoria en un ingreso manual (auditoría)" });
      }
      const origenExcepcion = procedencia || 'Granja (sin traslado)';
      const destino = 'Bodega Central';
      const ahora = new Date().toISOString();
      const referente = String(usuarioId) || (req.headers['x-user-id'] as string) || null;
      const responsable = referente || 'Bodeguero Actual';
      const id = crypto.randomUUID();

      await db.transaction(async (tx) => {
        // 1. Sumar al inventario de Bodega Central
        const item = await tx.query.inventario.findFirst({
          where: and(eq(inventario.producto, producto), eq(inventario.ubicacion, destino)),
        });
        if (item) {
          await tx.update(inventario).set({
            cantidad: item.cantidad + cant,
            ultima_actualizacion: ahora,
          }).where(eq(inventario.id, item.id));
        } else {
          await tx.insert(inventario).values({
            id: crypto.randomUUID(), producto, cantidad: cant, unidad: unidad || 'cartones', ubicacion: destino, ultima_actualizacion: ahora,
          });
        }

        // 2. Registrar movimiento tipo excepción
        await tx.insert(movimientosInventario).values({
          id: crypto.randomUUID(), producto, cantidad: cant, tipo: 'Ingreso Manual', origen: origenExcepcion, destino, fecha: ahora, referencia_id: id,
        });

        // 3. Auditoría de la excepción
        await tx.insert(auditoria).values({
          id: crypto.randomUUID(),
          usuarioId: referente || 'sistema',
          accion: 'Ingreso manual de producto a bodega',
          modulo: 'Bodega',
          referenciaId: id,
          valoresDespues: JSON.stringify({ producto, cantidad: cant, procedencia: origenExcepcion }),
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
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== PESOS POR PUNTO DE CUSTODIA ====================

  // Registrar peso en un punto de custodia
  app.post("/api/pesos/registrar", async (req, res) => {
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
  app.get("/api/pesos/trazabilidad", async (req, res) => {
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
  app.get("/api/pesos", async (req, res) => {
    try {
      const data = await db.query.pesos_por_punto.findMany();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Conciliación de pesos (resumen por Custodia)
  app.get("/api/pesos/conciliacion", async (req, res) => {
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

  // ==================== VACUNACIONES / SALUD AVÍCOLA ====================

  app.get("/api/vacunaciones", async (req, res) => {
    try {
      const data = await db.query.vacunaciones.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/vacunaciones", async (req, res) => {
    try {
      const { granjaId, galeronId, loteId, tipoVacuna, proveedor, dosis, metodoAplicacion, fechaProgramada, responsable, observaciones } = req.body;
      if (!granjaId || !tipoVacuna || !fechaProgramada || !responsable) {
        return res.status(400).json({ error: "Faltan datos requeridos de vacunación" });
      }
      const id = crypto.randomUUID();
      await db.insert(vacunaciones).values({
        id, granjaId, galeronId: galeronId || null, loteId: loteId || null,
        tipoVacuna, proveedor: proveedor || null, dosis: dosis || null,
        metodoAplicacion: metodoAplicacion || null, fechaProgramada,
        responsable, estado: 'Programada', observaciones: observaciones || null,
        fechaCreacion: new Date().toISOString()
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.put("/api/vacunaciones/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { estado, fechaAplicada, reaccionIncidencia, proximaFecha, evidencia } = req.body;
      const updateData: any = {};
      if (estado) updateData.estado = estado;
      if (fechaAplicada) updateData.fechaAplicada = fechaAplicada;
      if (reaccionIncidencia) updateData.reaccionIncidencia = reaccionIncidencia;
      if (proximaFecha) updateData.proximaFecha = proximaFecha;
      if (evidencia) updateData.evidencia = evidencia;
      await db.update(vacunaciones).set(updateData).where(eq(vacunaciones.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/vacunaciones/alertas", async (req, res) => {
    try {
      const todas = await db.query.vacunaciones.findMany();
      const hoy = new Date().toISOString().split('T')[0];
      const proximas = todas.filter(v => v.estado === 'Programada' && v.fechaProgramada <= hoy);
      const vencidas = todas.filter(v => v.estado === 'Programada' && v.fechaProgramada < hoy);
      res.json({ proximas, vencidas, totalProgramadas: todas.filter(v => v.estado === 'Programada').length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== ALIMENTO / SILOS ====================

  app.get("/api/alimento", async (req, res) => {
    try {
      const data = await db.query.inventario_alimento.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/alimento", async (req, res) => {
    try {
      const { tipoAlimento, proveedor, loteAlimento, siloUbicacion, cantidadRecibida, unidad, galeronAsociado, loteAvesAsociado, responsable } = req.body;
      if (!tipoAlimento || !cantidadRecibida || !responsable) {
        return res.status(400).json({ error: "Faltan datos requeridos de alimento" });
      }
      const id = crypto.randomUUID();
      await db.insert(inventario_alimento).values({
        id, tipoAlimento, proveedor: proveedor || null, loteAlimento: loteAlimento || null,
        siloUbicacion: siloUbicacion || null, cantidadRecibida: Number(cantidadRecibida),
        cantidadActual: Number(cantidadRecibida), unidad: unidad || 'kg',
        galeronAsociado: galeronAsociado || null, loteAvesAsociado: loteAvesAsociado || null,
        fechaIngreso: new Date().toISOString(), responsable, merma: 0, estado: 'Activo'
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/alimento/consumo", async (req, res) => {
    try {
      const { inventarioAlimentoId, galeronId, loteAvesId, cantidadConsumida, unidad, responsable, observaciones } = req.body;
      if (!cantidadConsumida || !responsable) {
        return res.status(400).json({ error: "Faltan datos de consumo" });
      }
      await db.transaction(async (tx) => {
        const id = crypto.randomUUID();
        await tx.insert(consumo_alimento).values({
          id, inventarioAlimentoId: inventarioAlimentoId || null,
          galeronId: galeronId || null, loteAvesId: loteAvesId || null,
          cantidadConsumida: Number(cantidadConsumida), unidad: unidad || 'kg',
          fecha: new Date().toISOString(), responsable, observaciones: observaciones || null
        });
        if (inventarioAlimentoId) {
          const inv = await tx.query.inventario_alimento.findFirst({ where: eq(inventario_alimento.id, inventarioAlimentoId) });
          if (inv) {
            await tx.update(inventario_alimento).set({ cantidadActual: inv.cantidadActual - Number(cantidadConsumida) }).where(eq(inventario_alimento.id, inventarioAlimentoId));
          }
        }
      });
      res.status(201).json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/alimento/consumo", async (req, res) => {
    try {
      const data = await db.query.consumo_alimento.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/alimento/alertas", async (req, res) => {
    try {
      const data = await db.query.inventario_alimento.findMany();
      const bajoInventario = data.filter(i => i.cantidadActual < i.cantidadRecibida * 0.2 && i.estado === 'Activo');
      res.json({ bajoInventario, totalSilos: data.length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== MANTENIMIENTO MEJORADO ====================

  app.get("/api/activos", async (req, res) => {
    try {
      const data = await db.query.activos_mantenimiento.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/activos", async (req, res) => {
    try {
      const { nombre, tipo, granjaId, galeronId, ubicacion, responsable } = req.body;
      if (!nombre || !tipo) return res.status(400).json({ error: "Faltan datos del activo" });
      const id = crypto.randomUUID();
      await db.insert(activos_mantenimiento).values({
        id, nombre, tipo, granjaId: granjaId || null, galeronId: galeronId || null,
        ubicacion: ubicacion || null, estado: 'Operativo', responsable: responsable || null
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/ordenes-mantenimiento", async (req, res) => {
    try {
      const data = await db.query.ordenes_mantenimiento.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ordenes-mantenimiento", async (req, res) => {
    try {
      const { activoId, tipo, fechaProgramada, responsable, insumosUsados, costo, observaciones, checklist } = req.body;
      if (!activoId || !tipo || !fechaProgramada || !responsable) {
        return res.status(400).json({ error: "Faltan datos de orden de mantenimiento" });
      }
      const id = crypto.randomUUID();
      await db.insert(ordenes_mantenimiento).values({
        id, activoId, tipo, fechaProgramada, responsable, estado: 'Pendiente',
        insumosUsados: insumosUsados || null, costo: Number(costo) || 0,
        observaciones: observaciones || null, checklist: checklist || null
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.put("/api/ordenes-mantenimiento/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { estado, fechaEjecutada, costo, observaciones, proximaFecha, insumosUsados } = req.body;
      const updateData: any = {};
      if (estado) updateData.estado = estado;
      if (fechaEjecutada) updateData.fechaEjecutada = fechaEjecutada;
      if (costo !== undefined) updateData.costo = Number(costo);
      if (observaciones) updateData.observaciones = observaciones;
      if (proximaFecha) updateData.proximaFecha = proximaFecha;
      if (insumosUsados) updateData.insumosUsados = insumosUsados;
      await db.update(ordenes_mantenimiento).set(updateData).where(eq(ordenes_mantenimiento.id, id));
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/ordenes-mantenimiento/alertas", async (req, res) => {
    try {
      const todas = await db.query.ordenes_mantenimiento.findMany();
      const hoy = new Date().toISOString().split('T')[0];
      const vencidas = todas.filter(o => o.estado === 'Pendiente' && o.fechaProgramada < hoy);
      const proximas = todas.filter(o => o.estado === 'Pendiente' && o.fechaProgramada >= hoy && o.fechaProgramada <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);
      res.json({ vencidas, proximas, totalPendientes: todas.filter(o => o.estado === 'Pendiente').length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== DESPERDICIO / MERMA ====================

  app.get("/api/desperdicios", async (req, res) => {
    try {
      const data = await db.query.desperdicios.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/desperdicios", async (req, res) => {
    try {
      const { origen, producto, etiquetaId, lote, cantidad, peso, motivo, responsable, evidencia, aprobacion, impactoFinanciero, observaciones, rutaId, guiaId, camionId, vendedorId } = req.body;
      if (!origen || !producto || !cantidad || !motivo || !responsable) {
        return res.status(400).json({ error: "Faltan datos del desperdicio" });
      }
      const id = crypto.randomUUID();
      await db.insert(desperdicios).values({
        id, origen, producto, etiquetaId: etiquetaId || null, lote: lote || null,
        cantidad: Number(cantidad), peso: peso ? Number(peso) : null,
        motivo, responsable, evidencia: evidencia || null, aprobacion: aprobacion || null,
        impactoFinanciero: Number(impactoFinanciero) || 0,
        fecha: new Date().toISOString(), observaciones: observaciones || null,
        rutaId: rutaId || null, guiaId: guiaId || null, camionId: camionId || null, vendedorId: vendedorId || null
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/desperdicios/resumen", async (req, res) => {
    try {
      const todos = await db.query.desperdicios.findMany();
      // Ventana de la última jornada (7 días): hoy más los últimos 6 días
      const inicioHoy = new Date(new Date().toISOString().split('T')[0]).getTime();
      const hace7Dias = new Date(inicioHoy - 6 * 24 * 60 * 60 * 1000).toISOString();
      const ventanaData = todos.filter(d => String(d.fecha) >= hace7Dias);
      const porOrigen = ventanaData.reduce((acc, d) => {
        acc[d.origen] = (acc[d.origen] || 0) + d.cantidad;
        return acc;
      }, {} as Record<string, number>);
      const impactoTotal = ventanaData.reduce((acc, d) => acc + Number(d.impactoFinanciero), 0);
      res.json({ porOrigen, impactoTotal, totalRegistros: ventanaData.length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/desperdicios/patrones", async (req, res) => {
    try {
      const fechaInicio = req.query.fechaInicio as string;
      const fechaFin = req.query.fechaFin as string;
      const [todos, usersData, rutasData, camionesData, ventasData, guiasData] = await Promise.all([
        db.query.desperdicios.findMany(),
        db.query.users.findMany(),
        db.query.rutas.findMany(),
        db.query.camiones.findMany(),
        db.query.ventas_ruta.findMany().catch(() => []),
        db.query.guias_despacho.findMany()
      ]);

      let filtrados = todos;
      if (fechaInicio) filtrados = filtrados.filter(d => String(d.fecha) >= fechaInicio);
      if (fechaFin) filtrados = filtrados.filter(d => String(d.fecha) <= fechaFin);

      const userName = (id: string | null | undefined) => {
        if (!id) return 'Sin asignar';
        const u = usersData.find((x: any) => x.id === id);
        return u ? u.name : id;
      };
      const rutaNombre = (id: string | null | undefined) => {
        if (!id) return 'Sin ruta';
        const r = rutasData.find((x: any) => x.id === id);
        return r ? r.nombre : id;
      };
      const camionNombre = (id: string | null | undefined) => {
        if (!id) return null;
        const c = camionesData.find((x: any) => x.id === id);
        return c ? c.nombre : null;
      };

      // Mapa guía → ruta/vendedor (para registrar histórico que no trae los campos)
      const guiaRuta = new Map(guiasData.map((g: any) => [g.id, g.rutaId]));

      const withRuta = filtrados.map((d: any) => ({
        ...d,
        rutaId: d.rutaId || d.guiaId ? guiaRuta.get(d.guiaId) || null : null
      }));

      // Ranking por ruta
      const porRutaAcc: Record<string, any> = {};
      for (const d of withRuta) {
        const key = d.rutaId || 'SIN_RUTA';
        if (!porRutaAcc[key]) porRutaAcc[key] = { rutaId: d.rutaId || null, ruta: rutaNombre(d.rutaId), cartones: 0, impacto: 0, registros: 0, motivos: {} as Record<string, number>, vendedores: new Set<string>(), camiones: new Set<string>() };
        const item = porRutaAcc[key];
        item.cartones += Number(d.cantidad);
        item.impacto += Number(d.impactoFinanciero);
        item.registros += 1;
        item.motivos[d.motivo] = (item.motivos[d.motivo] || 0) + Number(d.cantidad);
        if (d.vendedorId) item.vendedores.add(userName(d.vendedorId));
        const cn = camionNombre(d.camionId);
        if (cn) item.camiones.add(cn);
      }
      // Complementar vendedores reales de la ruta desde las ventas (guía → ruta)
      for (const guia of guiasData as any[]) {
        const rutaKey = guia.rutaId || 'SIN_RUTA';
        if (!porRutaAcc[rutaKey]) {
          porRutaAcc[rutaKey] = { rutaId: guia.rutaId || null, ruta: rutaNombre(guia.rutaId), cartones: 0, impacto: 0, registros: 0, motivos: {}, vendedores: new Set<string>(), camiones: new Set<string>() };
        }
        for (const v of ventasData as any[]) {
          if (v.guiaId !== guia.id || v.estado === 'Anulada') continue;
          if (v.vendedorId) porRutaAcc[rutaKey].vendedores.add(userName(v.vendedorId));
        }
      }
      const porRuta = Object.values(porRutaAcc)
        .map((x: any) => ({
          rutaId: x.rutaId, ruta: x.ruta,
          cartones: x.cartones, impacto: x.impacto, registros: x.registros,
          motivoTop: Object.entries(x.motivos).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] || null,
          vendedores: [...x.vendedores].sort(),
          camiones: [...x.camiones].sort()
        }))
        .filter(x => x.cartones > 0)
        .sort((a, b) => b.cartones - a.cartones);

      // Ranking por vendedor
      const porVendedorAcc: Record<string, any> = {};
      for (const d of withRuta) {
        const key = d.vendedorId || 'SIN_VENDEDOR';
        if (!porVendedorAcc[key]) porVendedorAcc[key] = { vendedorId: d.vendedorId || null, vendedor: userName(d.vendedorId), cartones: 0, impacto: 0, registros: 0, rutas: new Set<string>() };
        const item = porVendedorAcc[key];
        item.cartones += Number(d.cantidad);
        item.impacto += Number(d.impactoFinanciero);
        item.registros += 1;
        item.rutas.add(rutaNombre(d.rutaId));
      }
      const porVendedor = Object.values(porVendedorAcc)
        .map((x: any) => ({ vendedorId: x.vendedorId, vendedor: x.vendedor, cartones: x.cartones, impacto: x.impacto, registros: x.registros, rutas: [...x.rutas].sort() }))
        .filter(x => x.cartones > 0)
        .sort((a, b) => b.cartones - a.cartones);

      // Por producto
      const porProductoAcc: Record<string, any> = {};
      for (const d of filtrados) {
        if (!porProductoAcc[d.producto]) porProductoAcc[d.producto] = { producto: d.producto, cartones: 0, impacto: 0, registros: 0 };
        porProductoAcc[d.producto].cartones += Number(d.cantidad);
        porProductoAcc[d.producto].impacto += Number(d.impactoFinanciero);
        porProductoAcc[d.producto].registros += 1;
      }
      const porProducto = Object.values(porProductoAcc).sort((a, b) => b.cartones - a.cartones);

      // Por motivo
      const porMotivoAcc: Record<string, any> = {};
      for (const d of filtrados) {
        if (!porMotivoAcc[d.motivo]) porMotivoAcc[d.motivo] = { motivo: d.motivo, cartones: 0, impacto: 0, registros: 0 };
        porMotivoAcc[d.motivo].cartones += Number(d.cantidad);
        porMotivoAcc[d.motivo].impacto += Number(d.impactoFinanciero);
        porMotivoAcc[d.motivo].registros += 1;
      }
      const porMotivo = Object.values(porMotivoAcc).sort((a, b) => b.cartones - a.cartones);

      // Tendencia diaria
      const tendenciaAcc: Record<string, any> = {};
      for (const d of filtrados) {
        const dia = String(d.fecha).slice(0, 10);
        if (!tendenciaAcc[dia]) tendenciaAcc[dia] = { fecha: dia, cartones: 0, impacto: 0, registros: 0 };
        tendenciaAcc[dia].cartones += Number(d.cantidad);
        tendenciaAcc[dia].impacto += Number(d.impactoFinanciero);
        tendenciaAcc[dia].registros += 1;
      }
      const tendencia = Object.values(tendenciaAcc).sort((a: any, b: any) => (a.fecha < b.fecha ? -1 : 1));

      res.json({
        rango: { fechaInicio: fechaInicio || null, fechaFin: fechaFin || null },
        totales: {
          cartones: filtrados.reduce((a, d) => a + Number(d.cantidad), 0),
          impacto: filtrados.reduce((a, d) => a + Number(d.impactoFinanciero), 0),
          registros: filtrados.length
        },
        porRuta, porVendedor, porProducto, porMotivo, tendencia
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== PRECIOS / POLÍTICAS COMERCIALES ====================

  app.get("/api/precios/listas", async (req, res) => {
    try {
      const data = await db.query.listas_precios.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/precios/listas", async (req, res) => {
    try {
      const { nombre, tipo, rutaAsociada, clienteId, aprobadoPor, fechaFin } = req.body;
      if (!nombre || !tipo) return res.status(400).json({ error: "Faltan datos de lista de precios" });
      const id = crypto.randomUUID();
      await db.insert(listas_precios).values({
        id, nombre, tipo, rutaAsociada: rutaAsociada || null, clienteId: clienteId || null,
        estado: 'Activa', fechaInicio: new Date().toISOString(),
        fechaFin: fechaFin || null, aprobadoPor: aprobadoPor || null
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/precios/detalle/:listaId", async (req, res) => {
    try {
      const { listaId } = req.params;
      const data = await db.query.precios_detalle.findMany();
      res.json(data.filter(p => p.listaId === listaId));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/precios/detalle", async (req, res) => {
    try {
      const { listaId, producto, precioUnitario, descuentoMaximo, unidad } = req.body;
      if (!listaId || !producto || precioUnitario === undefined) {
        return res.status(400).json({ error: "Faltan datos del precio" });
      }
      const id = crypto.randomUUID();
      await db.insert(precios_detalle).values({
        id, listaId, producto, precioUnitario: Number(precioUnitario),
        descuentoMaximo: Number(descuentoMaximo) || 0, unidad: unidad || 'cartones'
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/precios/historial", async (req, res) => {
    try {
      const data = await db.query.historial_precios.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/precios/cambiar", async (req, res) => {
    try {
      const { listaId, producto, precioNuevo, cambioPor, motivo } = req.body;
      if (!listaId || !producto || !precioNuevo || !cambioPor) {
        return res.status(400).json({ error: "Faltan datos para cambio de precio" });
      }
      const precioActual = await db.query.precios_detalle.findFirst({
        where: and(eq(precios_detalle.listaId, listaId), eq(precios_detalle.producto, producto))
      });
      await db.insert(historial_precios).values({
        id: crypto.randomUUID(), producto, precioAnterior: precioActual?.precioUnitario || null,
        precioNuevo: Number(precioNuevo), tipoLista: 'Detalle', listaId,
        cambioPor, motivo: motivo || null, fecha: new Date().toISOString()
      });
      if (precioActual) {
        await db.update(precios_detalle).set({ precioUnitario: Number(precioNuevo) }).where(eq(precios_detalle.id, precioActual.id));
      }
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== DASHBOARD ENTERPRISE ====================

  app.get("/api/dashboard/enterprise", async (req, res) => {
    try {
      const hoy = new Date().toISOString().split('T')[0];
      const [todasFacturas, todosGastos, todaProduccion, inventarioTotal, lotesAves, todasVacunaciones, todasOrdenes, todosDesperdicios, todosClientes, todasRutas, todosGalerones, todasRecepciones] = await Promise.all([
        db.query.facturas.findMany(), db.query.gastos.findMany(), db.query.produccion_diaria.findMany(),
        db.query.inventario.findMany(), db.query.lotes_aves.findMany(), db.query.vacunaciones.findMany(),
        db.query.ordenes_mantenimiento.findMany(), db.query.desperdicios.findMany(),
        db.query.clientes.findMany(), db.query.rutas.findMany(), db.query.galerones.findMany(),
        db.query.recepciones.findMany()
      ]);

      const facturasHoy = todasFacturas.filter(f => String(f.fecha).startsWith(hoy));
      const gastosHoy = todosGastos.filter(g => String(g.fecha).startsWith(hoy));
      const produccionHoy = todaProduccion.filter(p => String(p.fecha).startsWith(hoy));

      // Devengado y cobrado, por separado: una venta a crédito cuenta como ingreso
      // aunque no se haya cobrado. Antes `ingresosHoy` filtraba `estado ===
      // 'Pagada'` y por eso no incluía las facturas de crédito del mismo día.
      // `ingresosCobradosHoy` conserva ese número en efectivo para el bloque de
      // caja, sin que ninguno de los dos se confunda con el otro.
      const ingresosHoy = ingresosFacturadosDe(facturasHoy, [], { desde: hoy, hasta: hoy });
      const ingresosCobradosHoy = ingresosCobradosDe(
        facturasHoy,
        (await db.query.pagos.findMany().catch(() => [] as any[])).filter(p => String(p.fecha ?? '').slice(0, 10) === hoy),
        { desde: hoy, hasta: hoy },
      );
      const gastosHoyTotal = gastosDe(gastosHoy as any[], { desde: hoy, hasta: hoy });
      const cartonesHoy = produccionHoy.filter(p => String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0);
      const stockBodega = inventarioTotal.filter(i => i.ubicacion === 'Bodega Central' && String(i.producto).includes('Huevos')).reduce((a, i) => a + Number(i.cantidad), 0);
      const avesVivas = todosGalerones.filter(g => g.estado !== 'Archivado').reduce((a, g) => a + (g.aves_en_produccion || 0), 0);
      const vacunasVencidas = todasVacunaciones.filter(v => v.estado === 'Programada' && v.fechaProgramada < hoy);
      const mantenimientosVencidos = todasOrdenes.filter(o => o.estado === 'Pendiente' && o.fechaProgramada < hoy);
      // Última jornada (7 días) para desperdicios y diferencias de recepción
      const inicioHoy = new Date(new Date().toISOString().split('T')[0]).getTime();
      const hace7Dias = new Date(inicioHoy - 6 * 24 * 60 * 60 * 1000).toISOString();
      const desperdicioHoy = todosDesperdicios.filter(d => String(d.fecha) >= hace7Dias);
      const impactoDesperdicio = desperdicioHoy.reduce((a, d) => a + Number(d.impactoFinanciero), 0);
      // Diferencias de recepción recientes (7 días): alertan aunque no sean del mismo día
      const recepcionesConDiferenciaRecientes = todasRecepciones.filter(r =>
        Number(r.diferencia) > 0 && String(r.fechaRecepcion) >= hace7Dias
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
        cuentasPorCobrar: cuentasPorCobrarDe(todasFacturas as any[], await mapaPagadoPorFactura(todasFacturas as any[])),
        alertas: [
          ...vacunasVencidas.map(v => ({ tipo: 'Vacuna vencida', detalle: `${v.tipoVacuna} — ${v.granjaId}`, nivel: 'Crítica' })),
          ...mantenimientosVencidos.map(m => ({ tipo: 'Mantenimiento vencido', detalle: `${m.tipo} — ${m.activoId}`, nivel: 'Alta' })),
          ...recepcionesConDiferenciaRecientes.filter(r => r.tipoDiferencia === 'alerta').map(r => ({ tipo: 'Posible robo de huevos', detalle: `Recepción: esperado ${r.cantidadEsperada}, recibido ${r.cantidadRecibida} (faltan ${r.diferencia})${r.motivoDiferencia ? ` — ${r.motivoDiferencia}` : ''}`, nivel: 'Alta' })),
          ...recepcionesConDiferenciaRecientes.filter(r => r.tipoDiferencia !== 'alerta').map(r => ({ tipo: 'Diferencia en recepción', detalle: `Esperado ${r.cantidadEsperada}, recibido ${r.cantidadRecibida} (faltan ${r.diferencia})${r.motivoDiferencia ? ` — ${r.motivoDiferencia}` : ''}`, nivel: 'Alta' }))
        ]
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/dashboard/produccion-detalle", async (req, res) => {
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
        const lotes = todosLotes.filter(l => galeronIds.includes(l.galeronId) && l.estado === 'Activo');
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
        totalLotes: todosLotes.filter(l => l.estado === 'Activo').length,
        totalCartones: produccionHoy.filter(p => String(p.tipo_producto).includes('Huevos')).reduce((a, p) => a + Number(p.cantidad), 0),
        totalAves: todosLotes.filter(l => l.estado === 'Activo').reduce((a, l) => a + Number(l.cantidad_inicial), 0)
      }});
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== AUDITORÍA ====================

  app.get("/api/auditoria", async (req, res) => {
    try {
      const data = await db.query.auditoria.findMany();
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/auditoria", async (req, res) => {
    try {
      const { usuarioId, accion, modulo, referenciaId, valoresAntes, valoresDespues, motivo } = req.body;
      if (!usuarioId || !accion || !modulo) return res.status(400).json({ error: "Faltan datos de auditoría" });
      const id = crypto.randomUUID();
      await db.insert(auditoria).values({
        id, usuarioId, accion, modulo, referenciaId: referenciaId || null,
        valoresAntes: valoresAntes || null, valoresDespues: valoresDespues || null,
        motivo: motivo || null, fecha: new Date().toISOString()
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== IA ASISTENTES ====================

  app.post("/api/ai/ceres", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const hoy = new Date().toISOString().split('T')[0];
      const [produccion, vacunacionesData, alimentoData, mantenimientosData] = await Promise.all([
        db.query.produccion_diaria.findMany(), db.query.vacunaciones.findMany(),
        db.query.inventario_alimento.findMany(), db.query.ordenes_mantenimiento.findMany()
      ]);
      const contexto = {
        produccion_hoy: produccion.filter(p => String(p.fecha).startsWith(hoy)),
        vacunaciones_pendientes: vacunacionesData.filter(v => v.estado === 'Programada'),
        inventario_alimento: alimentoData.filter(a => a.estado === 'Activo'),
        mantenimientos_pendientes: mantenimientosData.filter(m => m.estado === 'Pendiente')
      };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Ceres, la asistente avícola de Granja Don Paco. Respondes sobre producción, vacunación, alimento, mantenimiento y alertas de rendimiento. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/vega", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const [clientesData, facturasData] = await Promise.all([db.query.clientes.findMany(), db.query.facturas.findMany()]);
      const contexto = { clientes: clientesData, facturas_recientes: facturasData.slice(-20) };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Vega, la asistente de servicio al cliente de Granja Don Paco. Respondes sobre clientes, pedidos, estados de factura y reclamos. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/nash", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const [facturasData, gastosData] = await Promise.all([db.query.facturas.findMany(), db.query.gastos.findMany()]);
      const totalVentas = facturasData.reduce((a, f) => a + Number(f.total), 0);
      const totalGastos = gastosData.reduce((a, g) => a + Number(g.monto), 0);
      const contexto = { totalVentas, totalGastos, utilidadTotal: totalVentas - totalGastos, facturas: facturasData.slice(-20), gastos: gastosData.slice(-20) };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Nash, el analista financiero de Granja Don Paco. Respondes sobre ventas, cartera, rentabilidad y margen por ruta. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/houston", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const [rutasData, ordenesData] = await Promise.all([db.query.rutas.findMany(), db.query.ordenes_mantenimiento.findMany()]);
      const contexto = { rutas: rutasData, ordenes_pendientes: ordenesData.filter(o => o.estado === 'Pendiente') };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Houston, el coordinador operativo de Granja Don Paco. Respondes sobre rutas, tareas, mantenimiento y atrasos. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/magnetar", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const [clientesData, facturasData] = await Promise.all([db.query.clientes.findMany(), db.query.facturas.findMany()]);
      const contexto = { clientes: clientesData, facturas: facturasData };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Magnetar, el especialista en retención de clientes de Granja Don Paco. Respondes sobre recompra, clientes en riesgo y patrones de compra. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/nova", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Nova, la asistente de marketing y redes sociales de Granja Don Paco. Ayudas con contenido, campañas y comunicación digital.`, temperature: 0.7 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/ai/tales", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: "Message is required" });
      const docsFE = await db.query.facturas_electronicas.findMany();
      const contexto = { documentos_electronicos: docsFE };
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: message,
        config: { systemInstruction: `Eres Tales, el experto en control fiscal y documentos electrónicos de Granja Don Paco. Respondes sobre facturación electrónica, Hacienda, XML y notas de crédito. Contexto: ${JSON.stringify(contexto)}`, temperature: 0.2 }
      });
      res.json({ text: response.text });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== PHASE 5 — APROBACIONES ====================

  app.get("/api/aprobaciones", async (req, res) => {
    try {
      const estado = req.query.estado as string;
      const data = await db.query.aprobaciones.findMany();
      const filtered = estado ? data.filter(a => a.estado === estado) : data;
      res.json(filtered);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/aprobaciones", async (req, res) => {
    try {
      const { tipo, modulo, referenciaId, solicitudUsuario, descripcion, datos } = req.body;
      if (!tipo || !modulo || !solicitudUsuario || !descripcion) {
        return res.status(400).json({ error: "Faltan datos de la solicitud de aprobación" });
      }
      const id = crypto.randomUUID();
      await db.insert(aprobaciones).values({
        id, tipo, modulo, referenciaId: referenciaId || null,
        solicitudUsuario, descripcion, datos: datos ? JSON.stringify(datos) : null,
        estado: 'Pendiente', fechaSolicitud: new Date().toISOString()
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.put("/api/aprobaciones/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { estado, aprobadoPor, motivoRechazo } = req.body;
      if (!estado || !aprobadoPor) return res.status(400).json({ error: "Estado y aprobador requeridos" });
      if (!['Aprobado', 'Rechazado'].includes(estado)) return res.status(400).json({ error: "Estado inválido" });

      const updateData: any = {
        estado,
        aprobadoPor,
        fechaResolucion: new Date().toISOString()
      };
      if (estado === 'Rechazado') updateData.motivoRechazo = motivoRechazo || null;

      await db.update(aprobaciones).set(updateData).where(eq(aprobaciones.id, id));

      // Hook cuadre en central: al aprobar una diferencia de la guía, completar el cierre (CerradaConDiferencia → Cerrada)
      if (estado === 'Aprobado') {
        const aprobacion = await db.query.aprobaciones.findFirst({ where: eq(aprobaciones.id, id) });
        if (aprobacion && (aprobacion.tipo === 'MermaDescuadre' || aprobacion.tipo === 'AjusteInventario') && aprobacion.modulo === 'Logistica' && aprobacion.referenciaId) {
          const guia = await db.query.guias_despacho.findFirst({ where: eq(guias_despacho.id, aprobacion.referenciaId) });
          if (guia && guia.estado === 'CerradaConDiferencia') {
            await db.update(guias_despacho)
              .set({ estado: 'Cerrada', recibidoEn: new Date().toISOString() })
              .where(eq(guias_despacho.id, guia.id));
            await logAudit(aprobadoPor, 'Cerrar', 'GuiaDespacho', guia.id, { estado: 'CerradaConDiferencia' }, { estado: 'Cerrada' }, 'Cuadre completado tras aprobación');
          }
        }
      }

      await logAudit(aprobadoPor, estado, 'Aprobación', id, null, updateData, motivoRechazo);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/aprobaciones/pendientes", async (req, res) => {
    try {
      const data = await db.query.aprobaciones.findMany();
      const pendientes = data.filter(a => a.estado === 'Pendiente');
      res.json({ count: pendientes.length, items: pendientes });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== PHASE 5 — PRICE LOOKUP ENDPOINTS ====================

  app.get("/api/precios/lookup", async (req, res) => {
    try {
      const producto = req.query.producto as string;
      const clienteId = req.query.clienteId as string;
      const ruta = req.query.ruta as string;
      if (!producto) return res.status(400).json({ error: "Producto es requerido" });
      const resultado = await getPrecioParaProducto(producto, clienteId, ruta);
      if (!resultado) return res.status(404).json({ error: "No se encontró precio para este producto" });
      res.json(resultado);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/precios/lookup-multiple", async (req, res) => {
    try {
      const { productos, clienteId, ruta } = req.body;
      if (!productos || !Array.isArray(productos)) return res.status(400).json({ error: "Array de productos requerido" });
      const resultados: Record<string, any> = {};
      for (const p of productos) {
        resultados[p] = await getPrecioParaProducto(p, clienteId, ruta);
      }
      res.json(resultados);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== PHASE 5 — REPORTES ====================

  app.get("/api/reportes/ventas-por-ruta", async (req, res) => {
    try {
      const fechaInicio = req.query.fechaInicio as string;
      const fechaFin = req.query.fechaFin as string;
      const [todasFacturas, todosClientes, todosDetalles] = await Promise.all([
        db.query.facturas.findMany(), db.query.clientes.findMany(), db.query.detallesFactura.findMany()
      ]);

      const facturasConCliente = todasFacturas.map(f => ({
        ...f, cliente: todosClientes.find(c => c.id === f.clienteId)
      }));

      let filtradas = facturasConCliente;
      if (fechaInicio) filtradas = filtradas.filter(f => String(f.fecha) >= fechaInicio);
      if (fechaFin) filtradas = filtradas.filter(f => String(f.fecha) <= fechaFin);

      const porRuta = filtradas.reduce((acc: Record<string, any>, f) => {
        const ruta = (f as any).cliente?.ruta || 'Sin ruta';
        if (!acc[ruta]) acc[ruta] = { ruta, facturas: 0, totalVentas: 0, totalDescuento: 0, productos: {} };
        acc[ruta].facturas += 1;
        acc[ruta].totalVentas += Number(f.total);
        acc[ruta].totalDescuento += Number(f.descuento);
        const detalles = todosDetalles.filter(d => d.facturaId === f.id);
        for (const d of detalles) {
          if (!acc[ruta].productos[d.producto]) acc[ruta].productos[d.producto] = { cantidad: 0, total: 0 };
          acc[ruta].productos[d.producto].cantidad += Number(d.cantidad);
          acc[ruta].productos[d.producto].total += Number(d.subtotal);
        }
        return acc;
      }, {});

      res.json(Object.values(porRuta));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/reportes/produccion", async (req, res) => {
    try {
      const fechaInicio = req.query.fechaInicio as string;
      const fechaFin = req.query.fechaFin as string;
      const [todaProduccion, todasGranjas, todosGalerones] = await Promise.all([
        db.query.produccion_diaria.findMany(), db.query.granjas.findMany(), db.query.galerones.findMany()
      ]);

      let filtrada = todaProduccion;
      if (fechaInicio) filtrada = filtrada.filter(p => String(p.fecha) >= fechaInicio);
      if (fechaFin) filtrada = filtrada.filter(p => String(p.fecha) <= fechaFin);

      const porGranja = filtrada.reduce((acc: Record<string, any>, p) => {
        const granja = todasGranjas.find(g => g.id === p.granjaId);
        const key = granja?.nombre || p.granjaId || 'Sin granja';
        if (!acc[key]) acc[key] = { granja: key, totalProduccion: 0, porProducto: {} };
        acc[key].totalProduccion += Number(p.cantidad);
        if (!acc[key].porProducto[p.tipo_producto]) acc[key].porProducto[p.tipo_producto] = 0;
        acc[key].porProducto[p.tipo_producto] += Number(p.cantidad);
        return acc;
      }, {});

      res.json(Object.values(porGranja));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/reportes/inventario", async (req, res) => {
    try {
      const inventarioTotal = await db.query.inventario.findMany();
      const porUbicacion = inventarioTotal.reduce((acc: Record<string, any>, i) => {
        if (!acc[i.ubicacion]) acc[i.ubicacion] = { ubicacion: i.ubicacion, productos: [], valorTotal: 0 };
        acc[i.ubicacion].productos.push({ producto: i.producto, cantidad: i.cantidad, unidad: i.unidad });
        return acc;
      }, {});
      res.json(Object.values(porUbicacion));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/reportes/desperdicios", async (req, res) => {
    try {
      const fechaInicio = req.query.fechaInicio as string;
      const fechaFin = req.query.fechaFin as string;
      const todosDesperdicios = await db.query.desperdicios.findMany();

      let filtrados = todosDesperdicios;
      if (fechaInicio) filtrados = filtrados.filter(d => String(d.fecha) >= fechaInicio);
      if (fechaFin) filtrados = filtrados.filter(d => String(d.fecha) <= fechaFin);

      const porOrigen = filtrados.reduce((acc: Record<string, any>, d) => {
        if (!acc[d.origen]) acc[d.origen] = { origen: d.origen, cantidadTotal: 0, impactoTotal: 0, porMotivo: {} };
        acc[d.origen].cantidadTotal += Number(d.cantidad);
        acc[d.origen].impactoTotal += Number(d.impactoFinanciero);
        if (!acc[d.origen].porMotivo[d.motivo]) acc[d.origen].porMotivo[d.motivo] = { cantidad: 0, impacto: 0 };
        acc[d.origen].porMotivo[d.motivo].cantidad += Number(d.cantidad);
        acc[d.origen].porMotivo[d.motivo].impacto += Number(d.impactoFinanciero);
        return acc;
      }, {});

      res.json(Object.values(porOrigen));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  /**
   * Fuente única del P&L. Todas las pantallas de dinero leen de acá.
   *
   * Distingue **devengado** (lo vendido en el periodo, cobrado o no) de
   * **cobrado** (el dinero que entró). Ver `src/lib/finanzas.ts` para por qué
   * no son la misma cifra.
   *
   * `?desde`/`?hasta` en `YYYY-MM-DD`; sin parámetros, el mes en curso.
   */
  app.get("/api/finanzas/resumen", async (req, res) => {
    try {
      const mesActual = mesEnCursoDe();
      const desde = (req.query.desde as string) || mesActual.desde;
      const hasta = (req.query.hasta as string) || mesActual.hasta;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
        return res.status(400).json({ error: "Las fechas deben ir en YYYY-MM-DD" });
      }
      if (desde > hasta) {
        return res.status(400).json({ error: "La fecha inicial no puede ser posterior a la final" });
      }
      const periodo = { desde, hasta };
      const periodoAnterior = periodoAnteriorDe(periodo);

      // `pagos` y `ventas_ruta` no existen en toda instalación vieja: sin ellas
      // el resumen debe servir ceros, no reventar.
      const [facturas, tiquetes, gastos, pagos] = await Promise.all([
        db.query.facturas.findMany(),
        db.query.ventas_ruta.findMany().catch(() => [] as any[]),
        db.query.gastos.findMany(),
        db.query.pagos.findMany().catch(() => [] as any[]),
      ]);

      const pagadoPorFactura = await mapaPagadoPorFactura(facturas as any[]);

      const ingresosFacturados = ingresosFacturadosDe(facturas as any[], tiquetes as any[], periodo);
      const ingresosCobrados = ingresosCobradosDe(facturas as any[], pagos as any[], periodo);
      const totalGastos = gastosDe(gastos as any[], periodo);
      const { utilidad, margen } = utilidadYMargenDe(ingresosFacturados, totalGastos);

      // La cartera es el estado actual, no una medida del periodo: se debe lo que
      // se debe hoy, sin importar cuándo se vendió.
      const cuentasPorCobrar = cuentasPorCobrarDe(facturas as any[], pagadoPorFactura);

      const ingresosFacturadosAnterior = ingresosFacturadosDe(facturas as any[], tiquetes as any[], periodoAnterior);
      const ingresosCobradosAnterior = ingresosCobradosDe(facturas as any[], pagos as any[], periodoAnterior);
      const gastosAnterior = gastosDe(gastos as any[], periodoAnterior);

      const aging = agingPorFacturas(facturas as any[], pagadoPorFactura);
      const documentos = facturas.filter((f: any) => String(f.estado ?? '') !== 'Anulada' && dentroDePeriodo(String(f.fecha ?? ''), periodo));

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
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  /**
   * Reporte financiero: ahora es un alias de la fuente única.
   *
   * Antes recalculaba sus propias cifras, y su `cuentasPorCobrar` como
   * `SUM(total)` de las pendientes — que ignora los pagos parciales y no cuadraba
   * con el aging. Los nombres antiguos se conservan para no romper a
   * `Reportes.tsx`; los siguientes de la Fase 4.
   */
  app.get("/api/reportes/financiero", async (req, res) => {
    try {
      const [facturas, tiquetes, gastos, pagos] = await Promise.all([
        db.query.facturas.findMany(),
        db.query.ventas_ruta.findMany().catch(() => [] as any[]),
        db.query.gastos.findMany(),
        db.query.pagos.findMany().catch(() => [] as any[]),
      ]);
      const pagadoPorFactura = await mapaPagadoPorFactura(facturas as any[]);

      const totalVentas = ingresosFacturadosDe(facturas as any[], tiquetes as any[]);
      const totalGastos = gastosDe(gastos as any[]);
      const { utilidad, margen } = utilidadYMargenDe(totalVentas, totalGastos);

      res.json({
        totalVentas,
        totalGastos,
        utilidadNeta: utilidad,
        cuentasPorCobrar: cuentasPorCobrarDe(facturas as any[], pagadoPorFactura),
        gastosPorCategoria: Object.fromEntries(
          gastosPorCategoriaDe(gastos as any[]).map(g => [g.categoria, g.monto]),
        ),
        margen,
        ingresosCobrados: ingresosCobradosDe(facturas as any[], pagos as any[]),
      });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ==================== PHASE 5 — USERS ====================

  app.get("/api/users", async (req, res) => {
    try {
      const data = await db.select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        roles: schema.users.roles,
        activo: schema.users.activo,
      }).from(schema.users);
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const { name, email, role, roles, password, activo } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: "Faltan datos del usuario" });
      const existente = await db.query.users.findFirst({ where: eq(schema.users.email, String(email).trim()) });
      if (existente) return res.status(400).json({ error: "Ya existe un usuario con ese email" });
      const id = crypto.randomUUID();
      await db.insert(schema.users).values({
        id, name, email, role,
        roles: roles ? String(roles) : '',
        activo: activo !== undefined ? !!activo : true,
      });
      try {
        await db.update(schema.users)
          .set({ password_hash: hashPassword(password || '1234') })
          .where(eq(schema.users.id, id));
      } catch { /* columna ausente en DBs de prueba */ }
      res.status(201).json({ success: true, id });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.put("/api/users/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const { name, email, role, roles, activo, password } = req.body || {};
      const existente = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
      if (!existente) return res.status(404).json({ error: "Usuario no encontrado" });
      if (email && String(email).trim() !== existente.email) {
        const dup = await db.query.users.findFirst({ where: eq(schema.users.email, String(email).trim()) });
        if (dup) return res.status(400).json({ error: "Ya existe un usuario con ese email" });
      }
      await db.update(schema.users).set({
        name: name !== undefined && name !== null ? String(name) : existente.name,
        email: email !== undefined && email !== null ? String(email) : existente.email,
        role: role !== undefined && role !== null ? String(role) : existente.role,
        roles: roles !== undefined ? String(roles) : existente.roles,
        activo: activo !== undefined ? !!activo : existente.activo,
      }).where(eq(schema.users.id, id));
      if (password) {
        try {
          await db.update(schema.users)
            .set({ password_hash: hashPassword(String(password)) })
            .where(eq(schema.users.id, id));
        } catch { /* columna ausente en DBs de prueba */ }
      }
      res.json({ success: true, message: 'Usuario actualizado' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete("/api/users/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const existente = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
      if (!existente) return res.status(404).json({ error: "Usuario no encontrado" });
      // Integridad referencial: no permitir borrar un usuario que ya tiene actividad
      // (así las granjas/camiones/ventas no quedan huérfanos). Mejor desactivarlo.
      const [granjasR, camionesR, ventasR, facturasR, gastosR, incidentesR] = await Promise.all([
        db.select({ id: granjas.id }).from(granjas).where(eq(granjas.encargadoId, id)).limit(1),
        db.select({ id: camiones.id }).from(camiones).where(eq(camiones.camioneroId, id)).limit(1),
        db.select({ id: ventas_ruta.id }).from(ventas_ruta).where(eq(ventas_ruta.vendedorId, id)).limit(1),
        db.select({ id: facturas.id }).from(facturas).where(eq(facturas.vendedorId, id)).limit(1),
        db.select({ id: gastos.id }).from(gastos).where(eq(gastos.usuarioId, id)).limit(1),
        db.select({ id: schema.incidentes.id }).from(schema.incidentes).where(eq(schema.incidentes.reportadoPorId, id)).limit(1),
      ]);
      const refs = [
        granjasR.length > 0 && 'granja(s) a cargo',
        camionesR.length > 0 && 'camión(es) asignado(s)',
        ventasR.length > 0 && 'ventas registradas',
        facturasR.length > 0 && 'facturas emitidas',
        gastosR.length > 0 && 'gastos registrados',
        incidentesR.length > 0 && 'incidentes reportados',
      ].filter(Boolean);
      if (refs.length > 0) {
        return res.status(409).json({ error: `No se puede eliminar: tiene ${refs.join(', ')}. Desactivalo (cuenta inactiva) para conservar la historia.` });
      }
      await db.delete(sesiones).where(eq(sesiones.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
      res.json({ success: true, message: 'Usuario eliminado' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/roles/permisos", async (req, res) => {
    const role = req.query.role as string;
    const ROLE_PERMISSIONS: Record<string, any> = {
      Admin: { view: ['*'], create: ['*'], approve: ['*'] },
      Gerente: { view: ['*'], create: [], approve: ['*'] },
      Socio: { view: ['dashboard', 'produccion', 'ventas', 'inventario', 'rutas'], create: [], approve: [] },
      Vendedor: { view: ['rutas_propias', 'clientes_propios', 'ventas_propias', 'inventario_camion'], create: ['ventas', 'gastos_ruta'], approve: [] },
      Facturador: { view: ['facturacion', 'clientes', 'inventario', 'ventas'], create: ['facturacion', 'notas_credito'], approve: [] },
      Comercial: { view: ['rutas_propias', 'clientes_propios', 'ventas_propias', 'inventario_camion', 'precios', 'facturacion', 'clientes', 'inventario', 'ventas', 'office'], create: ['ventas', 'gastos_ruta', 'facturacion', 'notas_credito', 'office'], approve: [] },
      Despachador: { view: ['bodega', 'etiquetas', 'pesos', 'inventario_bodega'], create: ['etiquetas', 'pesos', 'carga_camion'], approve: [] },
      Bodeguero: { view: ['inventario_bodega', 'recepciones', 'etiquetas', 'pesos', 'desperdicios'], create: ['recepciones', 'desperdicios'], approve: [] },
      EncargadoGranja: { view: ['granja_propia', 'produccion', 'vacunacion', 'alimento'], create: ['produccion', 'vacunacion', 'alimento', 'mantenimiento'], approve: [] },
    };
    if (!role || !ROLE_PERMISSIONS[role]) return res.status(400).json({ error: "Rol no válido" });
    res.json(ROLE_PERMISSIONS[role]);
  });

  // ─── Productos Catálogo ────────────────────────────────────
  app.get('/api/productos-catalogo', async (_req, res) => {
    const productos = await db.select().from(schema.productosCatalogo);
    res.json(productos);
  });

  app.post('/api/productos-catalogo', async (req, res) => {
    const { nombre, descripcion, unidad, precioBase, categoria, vidaUtilDias, diasAvisoVencimiento } = req.body;
    if (!nombre) { res.status(400).json({ error: 'Nombre es requerido' }); return; }
    const id = crypto.randomUUID();
    await db.insert(schema.productosCatalogo).values({
      id, nombre, descripcion: descripcion || '', unidad: unidad || 'cartones',
      precioBase: precioBase || 0, categoria: categoria || 'Huevos',
      estado: 'Activo', fechaCreacion: new Date().toISOString(),
      vidaUtilDias: Number(vidaUtilDias) > 0 ? Number(vidaUtilDias) : VIDA_UTIL_DEFAULT_DIAS,
      diasAvisoVencimiento: Number(diasAvisoVencimiento) >= 0 ? Number(diasAvisoVencimiento) : DIAS_AVISO_DEFAULT,
    });
    res.status(201).json({ success: true, id });
  });

  app.put('/api/productos-catalogo/:id', async (req, res) => {
    const { nombre, descripcion, unidad, precioBase, categoria, estado, vidaUtilDias, diasAvisoVencimiento } = req.body;
    const existing = await db.select().from(schema.productosCatalogo).where(eq(schema.productosCatalogo.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Producto no encontrado' }); return; }
    await db.update(schema.productosCatalogo).set({
      ...(nombre !== undefined && { nombre }),
      ...(descripcion !== undefined && { descripcion }),
      ...(unidad !== undefined && { unidad }),
      ...(precioBase !== undefined && { precioBase }),
      ...(categoria !== undefined && { categoria }),
      ...(estado !== undefined && { estado }),
      ...(vidaUtilDias !== undefined && { vidaUtilDias: Number(vidaUtilDias) > 0 ? Number(vidaUtilDias) : VIDA_UTIL_DEFAULT_DIAS }),
      ...(diasAvisoVencimiento !== undefined && { diasAvisoVencimiento: Number(diasAvisoVencimiento) >= 0 ? Number(diasAvisoVencimiento) : DIAS_AVISO_DEFAULT }),
    }).where(eq(schema.productosCatalogo.id, req.params.id));
    res.json({ success: true });
  });

  app.delete('/api/productos-catalogo/:id', async (req, res) => {
    const existing = await db.select().from(schema.productosCatalogo).where(eq(schema.productosCatalogo.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Producto no encontrado' }); return; }
    await db.delete(schema.productosCatalogo).where(eq(schema.productosCatalogo.id, req.params.id));
    res.json({ success: true });
  });

  // ─── Tipos de Cartón ────────────────────────────────────────
  app.get('/api/tipos-carton', async (_req, res) => {
    const tipos = await db.select().from(schema.tiposCarton);
    res.json(tipos);
  });

  app.post('/api/tipos-carton', async (req, res) => {
    const { nombre, unidades } = req.body;
    if (!nombre) { res.status(400).json({ error: 'Nombre es requerido' }); return; }
    if (!(Number(unidades) > 0)) { res.status(400).json({ error: 'Unidades debe ser mayor a 0' }); return; }
    const id = crypto.randomUUID();
    await db.insert(schema.tiposCarton).values({
      id, nombre, unidades: Number(unidades), estado: 'Activo', fechaCreacion: new Date().toISOString(),
    });
    res.status(201).json({ success: true, id });
  });

  app.put('/api/tipos-carton/:id', async (req, res) => {
    const { nombre, unidades, estado } = req.body;
    const existing = await db.select().from(schema.tiposCarton).where(eq(schema.tiposCarton.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Tipo de cartón no encontrado' }); return; }
    await db.update(schema.tiposCarton).set({
      ...(nombre !== undefined && { nombre }),
      ...(unidades !== undefined && Number(unidades) > 0 && { unidades: Number(unidades) }),
      ...(estado !== undefined && { estado }),
    }).where(eq(schema.tiposCarton.id, req.params.id));
    res.json({ success: true });
  });

  app.delete('/api/tipos-carton/:id', async (req, res) => {
    const existing = await db.select().from(schema.tiposCarton).where(eq(schema.tiposCarton.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Tipo de cartón no encontrado' }); return; }
    await db.delete(schema.tiposCarton).where(eq(schema.tiposCarton.id, req.params.id));
    res.json({ success: true });
  });

  // ─── Excepciones de Precio por Cliente ──────────────────────
  app.get('/api/precio-excepciones/:clienteId', async (req, res) => {
    const excepciones = await db.select().from(schema.precioExcepcionesCliente)
      .where(eq(schema.precioExcepcionesCliente.clienteId, req.params.clienteId));
    res.json(excepciones);
  });

  app.post('/api/precio-excepciones', async (req, res) => {
    const { clienteId, productoId, precioExcepcion, justificacion, aprobadoPor } = req.body;
    if (!clienteId || !productoId || precioExcepcion === undefined) {
      res.status(400).json({ error: 'clienteId, productoId y precioExcepcion son requeridos' }); return;
    }
    const id = crypto.randomUUID();
    await db.insert(schema.precioExcepcionesCliente).values({
      id, clienteId, productoId, precioExcepcion,
      justificacion: justificacion || '', aprobadoPor: aprobadoPor || '',
      fechaCreacion: new Date().toISOString(), estado: 'Activa',
    });
    res.status(201).json({ success: true, id });
  });

  app.delete('/api/precio-excepciones/:id', async (req, res) => {
    const existing = await db.select().from(schema.precioExcepcionesCliente)
      .where(eq(schema.precioExcepcionesCliente.id, req.params.id));
    if (!existing.length) { res.status(404).json({ error: 'Excepción no encontrada' }); return; }
    await db.delete(schema.precioExcepcionesCliente).where(eq(schema.precioExcepcionesCliente.id, req.params.id));
    res.json({ success: true });
  });

  // VITE/STATIC movido al final para no eclipsar rutas API posteriores

  // Chat RAG Estela
  app.post("/api/chat/estela", async (req, res) => {
    try {
      const { message, history } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const hoy = new Date().toISOString().split('T')[0];

      // 1. Ingresos, Cuentas por Cobrar y Gastos
      const todasFacturas = await db.query.facturas.findMany();
      const facturasHoy = todasFacturas.filter(f => String(f.fecha).startsWith(hoy));
      
      const ingresosHoyPagados = facturasHoy
        .filter(f => f.estado === 'Pagada')
        .reduce((acc, f) => acc + Number(f.total), 0);

      const cuentasPorCobrar = todasFacturas
        .filter(f => f.estado === 'Pendiente')
        .reduce((acc, f) => acc + Number(f.total), 0);

      const todosGastos = await db.query.gastos.findMany();
      const gastosHoy = todosGastos
        .filter(g => String(g.fecha).startsWith(hoy))
        .reduce((acc, g) => acc + Number(g.monto), 0);
        
      const utilidadNetaHoy = ingresosHoyPagados - gastosHoy;

      // 2. Producción de Hoy
      const todaProduccion = await db.query.produccion_diaria.findMany();
      const produccionHoy = todaProduccion.filter(p => String(p.fecha).startsWith(hoy));
      
      const cartonesHoy = produccionHoy
        .filter(p => String(p.tipo_producto).includes('Huevos'))
        .reduce((acc, p) => acc + Number(p.cantidad), 0);
        
      const gallinazaHoy = produccionHoy
        .filter(p => String(p.tipo_producto).includes('Gallinaza'))
        .reduce((acc, p) => acc + Number(p.cantidad), 0);

      // 3. Stock actual de Huevos en Bodega Central
      const inventarioTotal = await db.query.inventario.findMany();
      const stockHuevosBodega = inventarioTotal
        .filter(i => String(i.producto).includes('Huevos') && i.ubicacion === 'Bodega Central')
        .reduce((acc, i) => acc + Number(i.cantidad), 0);

      // 4. Total de Aves Vivas
      const todosGalerones = await db.query.galerones.findMany();
      const avesVivas = todosGalerones
        .filter(g => g.estado !== 'Archivado')
        .reduce((acc, g) => acc + (g.aves_en_produccion || 0), 0);

      const contextoGranja = {
        ingresos_pagados_hoy: ingresosHoyPagados,
        cuentas_por_cobrar: cuentasPorCobrar,
        gastos_hoy: gastosHoy,
        utilidad_neta_hoy: utilidadNetaHoy,
        produccion_hoy_cartones: cartonesHoy,
        produccion_hoy_gallinaza: gallinazaHoy,
        stock_huevos_bodega_central: stockHuevosBodega,
        total_aves_vivas: avesVivas
      };

      const systemInstruction = `Eres Estela, la Directora de Operaciones (COO) de Granja Don Paco. Tu rol es dar respuestas ejecutivas, analíticas y directas al administrador basadas estrictamente en el siguiente JSON en tiempo real. Si te preguntan por rentabilidad, cruza los ingresos con los gastos. Si te preguntan por producción, lee los cartones y gallinaza de hoy. Nunca inventes datos, si la respuesta no está en el JSON, dilo. Contexto: ${JSON.stringify(contextoGranja)}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: message,
        config: {
           systemInstruction: systemInstruction,
           temperature: 0.2
        }
      });

      res.json({ text: response.text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== INCIDENTES DE GALERÓN ====================
  app.get("/api/incidentes", async (req, res) => {
    try {
      const { granjaId, soloActivos } = req.query;
      const rows = await db.query.incidentes.findMany({
        orderBy: (i: any, { desc }: any) => [desc(i.fecha)],
      });
      let data = rows;
      if (granjaId) data = data.filter((i: any) => i.granjaId === granjaId);
      if (soloActivos === 'true') data = data.filter((i: any) => i.estado === 'Reportado' || i.estado === 'EnRevision');
      const [todasGranjas, todosGalerones] = await Promise.all([db.query.granjas.findMany(), db.query.galerones.findMany()]);
      const granjaMap = new Map<string, any>(todasGranjas.map((g: any) => [g.id, g]));
      const galeronMap = new Map<string, any>(todosGalerones.map((g: any) => [g.id, g]));
      res.json(data.map((i: any) => ({
        ...i,
        granjaNombre: i.granjaId ? granjaMap.get(i.granjaId)?.nombre || null : null,
        galeronNombre: i.galeronId ? galeronMap.get(i.galeronId)?.nombre || null : null,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/incidentes", async (req, res) => {
    try {
      const { granjaId, galeronId, categoria, severidad, descripcion, cantidadAfectada, causaProbable, equipoAfectado, accionTomada, reportadoPorId, reportadoPorNombre } = req.body || {};
      if (!granjaId) return res.status(400).json({ error: "Se requiere la granja del incidente" });
      if (!categoria) return res.status(400).json({ error: "Se requiere la categoría del incidente" });
      if (!descripcion || String(descripcion).trim().length < 10) return res.status(400).json({ error: "Describe el incidente con al menos 10 caracteres" });
      if ((categoria === 'Mortalidad' || categoria === 'Enfermedad') && (!cantidadAfectada || Number(cantidadAfectada) < 1)) {
        return res.status(400).json({ error: "Indica cuántas aves se ven afectadas" });
      }
      const id = crypto.randomUUID();
      await db.insert(schema.incidentes).values({
        id,
        granjaId,
        galeronId: galeronId || null,
        categoria,
        severidad: severidad || 'Media',
        descripcion: String(descripcion).trim(),
        cantidadAfectada: cantidadAfectada ? Number(cantidadAfectada) : null,
        causaProbable: causaProbable ? String(causaProbable).trim() : null,
        equipoAfectado: equipoAfectado || null,
        accionTomada: accionTomada && String(accionTomada).trim() ? String(accionTomada).trim() : null,
        estado: 'Reportado',
        reportadoPorId: reportadoPorId || 'system',
        reportadoPorNombre: reportadoPorNombre || null,
        fecha: new Date().toISOString(),
      });
      res.status(201).json({ success: true, id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/incidentes/:id", async (req, res) => {
    try {
      const { estado, resumen, resueltoPor } = req.body || {};
      const existente = await db.query.incidentes.findFirst({ where: eq(schema.incidentes.id, req.params.id) });
      if (!existente) return res.status(404).json({ error: "Incidente no encontrado" });
      await db.update(schema.incidentes)
        .set({
          ...(estado !== undefined && { estado }),
          ...(resumen !== undefined && { resumen: resumen || null }),
          ...(resueltoPor !== undefined && { resueltoPor: resueltoPor || null }),
        })
        .where(eq(schema.incidentes.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== MÓDULO OFFICE (correo + documentos) ====================
  // Provider 'local': los mensajes y archivos viven en las tablas office_*.
  // El shape es idéntico al que usaría el provider 'google' (boceto §7), así que
  // cambiar de proveedor no obliga a tocar ni la UI ni los endpoints.
  //
  // Permisos: Office se ve para Admin/Socio/Comercial. Las REGLAS de correlación
  // (office_links) son configuración global: solo Admin las administra.

  function requireOfficeViewer(req: any, res: any, next: any) {
    return requirePermission('office', 'view')(req, res, next);
  }

  // Las 4 cuentas del provider local son buzones COMPARTIDOS de la empresa
  // (gerencia/proveedores/contabilidad/ventas), no buzones personales. Por eso
  // todo rol con office:view las ve; lo que se restringe por rol es escribir
  // configuración (conectar cuentas y reglas), no leer la bandeja.
  async function officeCuentasDe(user: { id: string; role: string }) {
    return await db.select().from(schema.officeAccounts);
  }

  // Conectar/desconectar cuentas y administrar reglas es solo Admin.
  async function requireOfficeAdmin(req: any, res: any, next: any) {
    const usuario = await resolveUsuario(req);
    if (!usuario) return res.status(401).json({ error: 'Autenticación requerida' });
    if (usuario.role === 'Admin') { (req as any).usuario = usuario; return next(); }
    return res.status(403).json({ error: 'Solo un Admin puede administrar las cuentas y reglas de Office' });
  }

  // Aplica una regla (office_links) a un mensaje. Devuelve la regla que aplicó o null.
  function officeReglaAplica(reglas: any[], msg: any) {
    const texto = `${msg.asunto || ''} ${msg.preview || ''}`.toLowerCase();
    const remitente = String(msg.remitenteEmail || '').toLowerCase();
    const labels = String(msg.labelIds || '').toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean);
    for (const r of reglas) {
      if (r.estado !== 'Activa') continue;
      const valor = String(r.criterioValor || '').toLowerCase().trim();
      if (!valor) continue;
      if (r.criterioTipo === 'label') { if (labels.includes(valor)) return r; continue; }
      if (r.criterioTipo === 'from') { if (remitente.includes(valor)) return r; continue; }
      if (r.criterioTipo === 'subject') { if (texto.includes(valor)) return r; continue; }
    }
    return null;
  }

  // GET /api/office/resumen - contadores para el viewhead y el sidebar de cuentas.
  app.get("/api/office/resumen", requireOfficeViewer, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const ids = cuentas.map((c: any) => c.id);
      const mensajes = ids.length
        ? (await db.select().from(schema.officeMessages)).filter((m: any) => ids.includes(m.accountId))
        : [];
      const docs = await db.select().from(schema.officeDriveIndex);
      const reglas = await db.select().from(schema.officeLinks);
      const sinLeer = mensajes.filter((m: any) => m.leido === 0).length;
      const sinCarpeta = reglas.filter((r: any) => r.estado === 'Activa' && !r.carpeta).length;
      const huérfanos = docs.filter((d: any) => !d.threadId).length;
      res.json({
        cuentas: cuentas.length,
        mensajes: mensajes.length,
        sinLeer,
        documentos: docs.length,
        reglasActivas: reglas.filter((r: any) => r.estado === 'Activa').length,
        reglas: reglas.length,
        cuentasSinCarpeta: sinCarpeta,
        documentosHuerfanos: huérfanos,
        ultimoSync: cuentas.map((c: any) => c.lastSync).filter(Boolean).sort().slice(-1)[0] || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/cuentas - listado de cuentas con su contador de no leídos.
  app.get("/api/office/cuentas", requireOfficeViewer, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const mensajes = await db.select().from(schema.officeMessages);
      res.json(cuentas.map((c: any) => ({
        ...c,
        mensajes: mensajes.filter((m: any) => m.accountId === c.id).length,
        sinLeer: mensajes.filter((m: any) => m.accountId === c.id && m.leido === 0).length,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/cuentas - "Conectar cuenta". Con provider local no hay OAuth:
  // se registra la cuenta y queda lista para sincronizar. Solo Admin.
  app.post("/api/office/cuentas", requireOfficeViewer, requireOfficeAdmin, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const { email, etiqueta, color, provider } = req.body || {};
      if (!email || !/^\S+@\S+\.\S+$/.test(String(email))) return res.status(400).json({ error: "Email es requerido y debe ser válido" });
      if (!etiqueta) return res.status(400).json({ error: "Etiqueta es requerida" });
      const existentes = await db.select().from(schema.officeAccounts);
      if (existentes.some((c: any) => String(c.email).toLowerCase() === String(email).toLowerCase())) {
        return res.status(409).json({ error: "La cuenta ya está conectada" });
      }
      const id = crypto.randomUUID();
      await db.insert(schema.officeAccounts).values({
        id, userId: usuario.id, email, etiqueta,
        color: color || '#3D7A4A',
        provider: provider || 'local',
        scope: provider === 'google' ? 'gmail.readonly drive.file' : '',
        estado: 'Conectada',
        lastSync: null,
      });
      const [creada] = await db.select().from(schema.officeAccounts).where(eq(schema.officeAccounts.id, id));
      res.status(201).json(creada);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/office/cuentas/:id - desconectar. Borra los mensajes de esa cuenta
  // (si no, la FK account_id impide el DELETE) y deja los documentos como huérfanos
  // para que sigan visibles en Admin › Vinculaciones. Solo Admin.
  app.delete("/api/office/cuentas/:id", requireOfficeAdmin, async (req, res) => {
    try {
      const [cuenta] = await db.select().from(schema.officeAccounts).where(eq(schema.officeAccounts.id, req.params.id));
      if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });
      const mensajes = (await db.select().from(schema.officeMessages)).filter((m: any) => m.accountId === req.params.id);
      const threadIds = mensajes.map((m: any) => m.threadId);
      await db.delete(schema.officeMessages).where(eq(schema.officeMessages.accountId, req.params.id));
      // Los documentos de esos hilos quedan sin vínculo (huérfanos), no se borran.
      for (const doc of await db.select().from(schema.officeDriveIndex)) {
        if (doc.threadId && threadIds.includes(doc.threadId)) {
          await db.update(schema.officeDriveIndex).set({ threadId: null, messageId: null, origen: 'manual' }).where(eq(schema.officeDriveIndex.id, doc.id));
        }
      }
      await db.delete(schema.officeAccounts).where(eq(schema.officeAccounts.id, req.params.id));
      res.json({ ok: true, id: req.params.id, mensajesEliminados: mensajes.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/sync - "Actualizar". Con provider local NO inventa mensajes:
  // solo sella last_sync. Un provider real llenaría la bandeja aquí (ej. con
  // Gmail History API/watch para incremental, o full sync bajo demanda).
  app.post("/api/office/sync", requirePermission('office', 'create'), async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const now = new Date().toISOString();
      for (const c of cuentas) {
        await db.update(schema.officeAccounts).set({ lastSync: now }).where(eq(schema.officeAccounts.id, c.id));
      }
      res.json({ ok: true, sincronizado: cuentas.length, lastSync: now });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/mensajes - bandeja unificada. Filtros: cuenta, vista, q, conAdjuntos.
  // vista: todos | con-documentos | sin-responder
  app.get("/api/office/mensajes", requireOfficeViewer, async (req, res) => {    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const ids = cuentas.map((c: any) => c.id);
      const porId = new Map<string, any>(cuentas.map((c: any) => [c.id, c]));
      const docs = await db.select().from(schema.officeDriveIndex);
      const reglas = await db.select().from(schema.officeLinks);

      let filas: any[] = (await db.select().from(schema.officeMessages)).filter((m: any) => ids.includes(m.accountId));
      const vista = String(req.query.vista || 'todos');
      if (req.query.cuenta) filas = filas.filter((m: any) => m.accountId === req.query.cuenta);
      if (req.query.conAdjuntos === 'true') filas = filas.filter((m: any) => Number(m.adjuntoCount) > 0);
      if (req.query.desde) filas = filas.filter((m: any) => new Date(m.fecha).getTime() >= new Date(String(req.query.desde)).getTime());
      if (vista === 'con-documentos') filas = filas.filter((m: any) => Number(m.adjuntoCount) > 0);
      if (vista === 'sin-responder') filas = filas.filter((m: any) => Number(m.recibidos) < 2 && m.leido === 0);
      const q = String(req.query.q || '').trim().toLowerCase();
      if (q) filas = filas.filter((m: any) => `${m.asunto} ${m.remitente} ${m.preview}`.toLowerCase().includes(q));

      filas = filas.map((m: any) => {
        const regla = officeReglaAplica(reglas.filter((r: any) => !r.accountId || r.accountId === m.accountId), m);
        return {
          ...m,
          etiquetaCuenta: porId.get(m.accountId)?.etiqueta || '',
          colorCuenta: porId.get(m.accountId)?.color || '#3D7A4A',
          carpeta: regla?.carpeta || null,
          reglaId: regla?.id || null,
          documentos: docs.filter((d: any) => d.threadId === m.threadId),
        };
      });
      filas.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      res.json(filas);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/mensajes - ingesta de un mensaje al buzón.
  // Con provider local la bandeja se siembra por esta vía; un provider 'google'
  // llamaría el mismo endpoint desde su worker de messages.list/watch.
  app.post("/api/office/mensajes", requirePermission('office', 'create'), async (req, res) => {
    try {
      const { accountId, threadId, remitente, remitenteEmail, asunto, preview, labelIds, recibidos, leido, adjuntoCount, fecha } = req.body || {};
      if (!accountId || !threadId || !remitente || !remitenteEmail || !asunto) {
        return res.status(400).json({ error: "accountId, threadId, remitente, remitenteEmail y asunto son requeridos" });
      }
      const [cuenta] = await db.select().from(schema.officeAccounts).where(eq(schema.officeAccounts.id, accountId));
      if (!cuenta) return res.status(400).json({ error: "La cuenta indicada no existe" });
      const id = crypto.randomUUID();
      await db.insert(schema.officeMessages).values({
        id, accountId, threadId,
        remitente,
        remitenteEmail,
        asunto,
        preview: preview || '',
        labelIds: labelIds || '',
        recibidos: Number(recibidos || 1),
        leido: Number(leido || 0),
        adjuntoCount: Number(adjuntoCount || 0),
        fecha: fecha || new Date().toISOString(),
      });
      const [creado] = await db.select().from(schema.officeMessages).where(eq(schema.officeMessages.id, id));
      res.status(201).json(creado);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/mensajes/:threadId - hilo completo + documentos vinculados.
  app.get("/api/office/mensajes/:threadId", requireOfficeViewer, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const cuentas = await officeCuentasDe(usuario);
      const ids = cuentas.map((c: any) => c.id);
      const mensajes = (await db.select().from(schema.officeMessages)).filter((m: any) => m.threadId === req.params.threadId);
      if (!mensajes.length || !ids.includes(mensajes[0].accountId)) return res.status(404).json({ error: "Hilo no encontrado" });
      const docs = (await db.select().from(schema.officeDriveIndex)).filter((d: any) => d.threadId === req.params.threadId);
      const reglas = await db.select().from(schema.officeLinks);
      const regla = officeReglaAplica(reglas.filter((r: any) => !r.accountId || r.accountId === mensajes[0].accountId), mensajes[0]);
      const orden = [...mensajes].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
      res.json({ hilo: orden, documentos: docs, carpeta: regla?.carpeta || null });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/mensajes/:id/leer - marcar leído/no leído.
  app.post("/api/office/mensajes/:id/leer", requireOfficeViewer, async (req, res) => {
    try {
      const leido = req.body?.leido === false ? 0 : 1;
      const [msg] = await db.select().from(schema.officeMessages).where(eq(schema.officeMessages.id, req.params.id));
      if (!msg) return res.status(404).json({ error: "Mensaje no encontrado" });
      await db.update(schema.officeMessages).set({ leido }).where(eq(schema.officeMessages.id, req.params.id));
      res.json({ ok: true, leido });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/arbol - árbol de carpetas + contador de faltantes (para Documentos).
  app.get("/api/office/arbol", requireOfficeViewer, async (req, res) => {
    try {
      const reglas = (await db.select().from(schema.officeLinks)).filter((r: any) => r.estado === 'Activa');
      const docs = await db.select().from(schema.officeDriveIndex);
      const carpetas = Array.from(new Set(reglas.map((r: any) => r.carpeta).filter(Boolean))) as string[];
      const arbol = carpetas.map((carpeta: string) => {
        const enCarpeta = docs.filter((d: any) => d.carpeta === carpeta);
        return {
          carpeta,
          total: enCarpeta.length,
          huerfanos: enCarpeta.filter((d: any) => !d.threadId).length,
        };
      });
      const sinCarpeta = reglas.filter((r: any) => !r.carpeta).map((r: any) => ({ nombreCuenta: r.nombreCuenta, id: r.id }));
      res.json({ arbol, sinCarpeta, totalDocs: docs.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/office/documentos - índice de archivos. Filtros: carpeta, q, tipo.
  app.get("/api/office/documentos", requireOfficeViewer, async (req, res) => {
    try {
      let docs: any[] = await db.select().from(schema.officeDriveIndex);
      if (req.query.carpeta) docs = docs.filter((d: any) => d.carpeta === req.query.carpeta);
      if (req.query.tipo) docs = docs.filter((d: any) => d.archivoTipo === req.query.tipo);
      const q = String(req.query.q || '').trim().toLowerCase();
      if (q) docs = docs.filter((d: any) => d.archivoNombre.toLowerCase().includes(q));
      docs = docs.map((d: any) => ({ ...d, huerfano: !d.threadId }));
      docs.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/documentos - "Subir documento" (sin binario: registra metadata).
  app.post("/api/office/documentos", requirePermission('office', 'create'), async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const { archivoNombre, archivoTipo, carpeta, bytes, linkId, origen } = req.body || {};
      if (!archivoNombre) return res.status(400).json({ error: "Nombre de archivo es requerido" });
      if (!carpeta) return res.status(400).json({ error: "Carpeta destino es requerida" });
      const [regla] = linkId
        ? await db.select().from(schema.officeLinks).where(eq(schema.officeLinks.id, linkId))
        : [null];
      const id = crypto.randomUUID();
      await db.insert(schema.officeDriveIndex).values({
        id,
        archivoNombre,
        archivoTipo: archivoTipo || 'PDF',
        archivoBytes: Number(bytes || 0),
        linkId: regla?.id || null,
        carpeta,
        threadId: req.body?.threadId || null,
        messageId: req.body?.messageId || null,
        origen: origen || (regla ? 'hilo' : 'manual'),
        fecha: new Date().toISOString(),
      });
      await db.insert(schema.auditoria).values({
        id: crypto.randomUUID(), usuarioId: usuario.id, accion: 'Subir documento', modulo: 'Office',
        referenciaId: id, fecha: new Date().toISOString(),
      });
      const [creado] = await db.select().from(schema.officeDriveIndex).where(eq(schema.officeDriveIndex.id, id));
      res.status(201).json({ ...creado, huerfano: !creado.threadId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/documentos/:id/vincular - liga un archivo huérfano a un hilo.
  app.post("/api/office/documentos/:id/vincular", requirePermission('office', 'create'), async (req, res) => {
    try {
      const { threadId, messageId, carpeta, linkId } = req.body || {};
      if (!threadId) return res.status(400).json({ error: "threadId es requerido" });
      const mensajes = (await db.select().from(schema.officeMessages)).filter((m: any) => m.threadId === threadId);
      if (!mensajes.length) return res.status(404).json({ error: "Hilo no encontrado" });
      const [doc] = await db.select().from(schema.officeDriveIndex).where(eq(schema.officeDriveIndex.id, req.params.id));
      if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
      await db.update(schema.officeDriveIndex).set({
        threadId, messageId: messageId || mensajes[0].id,
        linkId: linkId || doc.linkId || null,
        carpeta: carpeta || doc.carpeta || null,
        origen: 'hilo',
      }).where(eq(schema.officeDriveIndex.id, req.params.id));
      const [actualizado] = await db.select().from(schema.officeDriveIndex).where(eq(schema.officeDriveIndex.id, req.params.id));
      res.json({ ...actualizado, huerfano: !actualizado.threadId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ---- Reglas de correlación (Admin › Vinculaciones) ----
  // Solo Admin: es configuración global del sistema, no una vista de correo.

  app.get("/api/office/vinculaciones", requireOfficeAdmin, async (req, res) => {
    try {
      const reglas = await db.select().from(schema.officeLinks);
      const docs = await db.select().from(schema.officeDriveIndex);
      res.json(reglas.map((r: any) => ({
        ...r,
        archivos: docs.filter((d: any) => d.linkId === r.id).length,
        requiereAccion: r.estado === 'Activa' && !r.carpeta,
      })));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/office/vinculaciones", requireOfficeAdmin, async (req, res) => {
    try {
      const usuario = (req as any).usuario;
      const { nombreCuenta, carpeta, criterioTipo, criterioValor, automatico, accountId } = req.body || {};
      if (!nombreCuenta) return res.status(400).json({ error: "Cuenta es requerida" });
      if (!criterioTipo || !['label', 'from', 'subject', 'manual'].includes(criterioTipo)) {
        return res.status(400).json({ error: "Criterio inválido (label | from | subject | manual)" });
      }
      if (criterioTipo !== 'manual' && !criterioValor) {
        return res.status(400).json({ error: "El criterio automático necesita un valor" });
      }
      if (!carpeta && criterioTipo !== 'manual') {
        return res.status(400).json({ error: "Una regla automática necesita carpeta destino" });
      }
      const id = crypto.randomUUID();
      await db.insert(schema.officeLinks).values({
        id,
        accountId: accountId || null,
        nombreCuenta,
        driveFolderId: carpeta || null,
        carpeta: carpeta || null,
        criterioTipo,
        criterioValor: criterioValor || '',
        automatico: automatico === false ? 0 : 1,
        estado: 'Activa',
        creadoPor: usuario.id,
        fechaCreacion: new Date().toISOString(),
      });
      const [creada] = await db.select().from(schema.officeLinks).where(eq(schema.officeLinks.id, id));
      res.status(201).json({ ...creada, archivos: 0, requiereAccion: !creada.carpeta });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/office/vinculaciones/:id", requireOfficeAdmin, async (req, res) => {
    try {
      const [regla] = await db.select().from(schema.officeLinks).where(eq(schema.officeLinks.id, req.params.id));
      if (!regla) return res.status(404).json({ error: "Regla no encontrada" });
      await db.delete(schema.officeLinks).where(eq(schema.officeLinks.id, req.params.id));
      res.json({ ok: true, id: req.params.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/office/vinculaciones/probar - dry-run: qué regla aplicaría a qué mensajes.
  app.post("/api/office/vinculaciones/probar", requireOfficeAdmin, async (req, res) => {
    try {
      const reglas = await db.select().from(schema.officeLinks);
      const mensajes = await db.select().from(schema.officeMessages);
      const porRegla = new Map<string, any[]>();
      for (const m of mensajes) {
        const r = officeReglaAplica(reglas.filter((x: any) => !x.accountId || x.accountId === m.accountId), m);
        const key = r ? r.id : 'sin-regla';
        if (!porRegla.has(key)) porRegla.set(key, []);
        porRegla.get(key)!.push({ asunto: m.asunto, remitente: m.remitente, adjuntoCount: m.adjuntoCount });
      }
      res.json({
        reglas: reglas.map((r: any) => ({ id: r.id, nombreCuenta: r.nombreCuenta, carpeta: r.carpeta, coincide: porRegla.get(r.id)?.length || 0, ejemplos: (porRegla.get(r.id) || []).slice(0, 3) })),
        sinRegla: { coincide: porRegla.get('sin-regla')?.length || 0, ejemplos: (porRegla.get('sin-regla') || []).slice(0, 5) },
        totalMensajes: mensajes.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== VITE / STATIC (al final para no eclipsar rutas API) ====================
  if (!testMode) {
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
export async function backfillRecepcionesDesperdicio(db: any) {
  try {
    const conDiferencia = await db.select().from(schema.recepciones).where(gt(schema.recepciones.diferencia, 0));
    if (conDiferencia.length === 0) return;

    let procesadas = 0;
    let reclasificadas = 0;

    // Fase 1 — reclasificar históricos: el backfill anterior registró TODAS las diferencias como
    // desperdicio. Ahora el motivo se clasifica:
    //   - 'alerta' (posible robo): se elimina el desperdicio incorrecto y se marca la recepción.
    //   - 'desperdicio': simplemente se completa la clasificación (el registro ya es correcto).
    for (const r of conDiferencia) {
      if (r.tipoDiferencia) continue;
      const opcion = clasificarDiferencia(r.motivoDiferencia);
      if (!opcion) continue;
      if (opcion.tipo === 'alerta') {
        const despBackfill = await db.select().from(schema.desperdicios).where(and(
          eq(schema.desperdicios.origen, 'Recepción Bodega'),
          eq(schema.desperdicios.observaciones, `Backfill: recepción ${r.id}`)
        )).limit(1);
        if (despBackfill.length > 0) {
          await db.delete(schema.desperdicios).where(eq(schema.desperdicios.id, despBackfill[0].id));
        }
      }
      await db.update(schema.recepciones).set({ tipoDiferencia: opcion.tipo }).where(eq(schema.recepciones.id, r.id));
      reclasificadas++;
    }

    // Fase 2 — backfill de recepciones que aún no tienen su movimiento de pérdida
    for (const r of conDiferencia) {
      const yaRegistrado = await db.select().from(schema.movimientosInventario).where(and(
        eq(schema.movimientosInventario.referencia_id, r.id),
        eq(schema.movimientosInventario.tipo, 'Pérdida en Tránsito')
      )).limit(1);
      if (yaRegistrado.length > 0) continue;

      // Producto de la recepción: de su propio movimiento 'Recepción Bodega', o del 'Traslado'
      let producto: string | null = null;
      const movRecepcion = await db.select().from(schema.movimientosInventario).where(and(
        eq(schema.movimientosInventario.referencia_id, r.id),
        eq(schema.movimientosInventario.tipo, 'Recepción Bodega')
      )).limit(1);
      if (movRecepcion.length > 0) {
        producto = movRecepcion[0].producto;
      } else if (r.trasladoId) {
        const movTraslado = await db.select().from(schema.movimientosInventario).where(and(
          eq(schema.movimientosInventario.referencia_id, r.trasladoId),
          eq(schema.movimientosInventario.tipo, 'Traslado')
        )).limit(1);
        if (movTraslado.length > 0) producto = movTraslado[0].producto;
      }
      if (!producto) continue;

      const opcion = clasificarDiferencia(r.motivoDiferencia);
      const tipo = opcion?.tipo ?? 'desperdicio';

      // Desperdicio SOLO si no es posible robo; el movimiento de pérdida se registra siempre (kárdex)
      if (tipo === 'desperdicio') {
        let impacto = 0;
        try {
          const cat = await db.select().from(schema.productosCatalogo).where(eq(schema.productosCatalogo.nombre, producto)).limit(1);
          if (cat.length > 0 && cat[0].precio_base) {
            impacto = Number((r.diferencia * Number(cat[0].precio_base)).toFixed(2));
          }
        } catch { /* sin precio → 0 */ }
        await db.insert(schema.desperdicios).values({
          id: crypto.randomUUID(),
          origen: 'Recepción Bodega',
          producto,
          lote: null,
          cantidad: r.diferencia,
          motivo: r.motivoDiferencia || 'Diferencia en recepción',
          responsable: r.responsableRecepcion || 'Bodeguero Actual',
          fecha: r.fechaRecepcion,
          impactoFinanciero: impacto,
          observaciones: `Backfill: recepción ${r.id}`
        });
      }

      await db.update(schema.recepciones).set({ tipoDiferencia: tipo }).where(eq(schema.recepciones.id, r.id));
      await db.insert(schema.movimientosInventario).values({
        id: crypto.randomUUID(),
        producto,
        cantidad: r.diferencia,
        tipo: 'Pérdida en Tránsito',
        origen: 'Granja',
        destino: 'Desperdicio',
        fecha: r.fechaRecepcion,
        referencia_id: r.id
      });
      procesadas++;
    }
    if (procesadas > 0) {
      console.log(`[Backfill] ${procesadas} recepción(es) con diferencia → movimiento de pérdida registrado retroactivamente`);
    }
    if (reclasificadas > 0) {
      console.log(`[Backfill] ${reclasificadas} recepción(es) reclasificada(s) como posible robo (se quitó el desperdicio incorrecto)`);
    }
  } catch (e: any) {
    console.error('[Backfill] Error procesando recepciones:', e.message);
  }
}

async function startServer() {
  const client = createClient({ url: `file:${path.resolve(process.cwd(), 'local.db')}` });
  const dbInstance = drizzle(client, { schema });
  
  // Ensure all tables exist (DDL canónico compartido con los tests)
  const createTables = CREATE_TABLES;
  
  for (const sql of createTables) {
    await client.execute(sql);
  }

  // Auto-migrate: users — roles
  const userColNames = (await client.execute("PRAGMA table_info(users)")).rows.map((r: any) => r.name);
  if (!userColNames.includes('roles')) {
    await client.execute("ALTER TABLE users ADD COLUMN roles TEXT DEFAULT ''");
  }
  if (!userColNames.includes('password_hash')) {
    await client.execute("ALTER TABLE users ADD COLUMN password_hash TEXT");
  }
  if (!userColNames.includes('activo')) {
    await client.execute("ALTER TABLE users ADD COLUMN activo INTEGER DEFAULT 1");
  }

  // Seed default admin user if users table is empty
  const demoHash = hashPassword('1234');
  const demoUsers = [
    { id: '1', name: 'Administrador', email: 'admin@granja.com', role: 'Admin', roles: 'Admin' },
    { id: '2', name: 'Comercial Central', email: 'facturacion@granja.com', role: 'Comercial', roles: 'Comercial' },
    { id: '3', name: 'Comercial Ruta 1', email: 'vendedor@granja.com', role: 'Comercial', roles: 'Comercial' },
    { id: '6', name: 'Socio Inversor', email: 'socio@granja.com', role: 'Socio', roles: 'Socio' },
    { id: '7', name: 'Bodeguero Principal', email: 'bodega@granja.com', role: 'Bodeguero', roles: 'Bodeguero' },
    { id: '8', name: 'Encargado de Galerón', email: 'despacho@granja.com', role: 'Despachador', roles: 'Despachador' },
    { id: '9', name: 'Camionero Demo', email: 'camionero@granja.com', role: 'Camionero', roles: 'Camionero' },
  ];
  for (const u of demoUsers) {
    await client.execute({
      sql: `INSERT INTO users (id, name, email, role, roles, password_hash, activo) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, roles = excluded.roles, password_hash = excluded.password_hash, activo = 1`,
      args: [u.id, u.name, u.email, u.role, u.roles, demoHash]
    });
  }
  // Renombrar rol Despachador → Encargado de Galerón (BD persistente)
  await client.execute({ sql: `UPDATE users SET name = 'Encargado de Galerón' WHERE email = 'despacho@granja.com' AND name = 'Despachador'` });
  // Usuarios preexistentes sin password → demo '1234'
  await client.execute({ sql: `UPDATE users SET password_hash = ? WHERE password_hash IS NULL`, args: [demoHash] });
  // Usuarios preexistentes sin roles → roles = role
  await client.execute({ sql: `UPDATE users SET roles = role WHERE roles IS NULL OR roles = ''` });
  // Migración: unificar rol Facturador + Vendedor → Comercial
  await client.execute(`UPDATE users SET role = 'Comercial', roles = 'Comercial' WHERE role IN ('Facturador', 'Vendedor') OR roles IN ('Facturador', 'Vendedor')`);
  console.log('Demo users seeded (password 1234)');

  // Seed default camión for Camionero Demo if camiones table is empty
  const camionCount = await client.execute('SELECT COUNT(*) as count FROM camiones');
  if (camionCount.rows[0].count === 0) {
    await client.execute({
      sql: `INSERT INTO camiones (id, nombre, placa, camionero_id, capacidad_cartones, estado) VALUES (?, ?, ?, ?, 500, 'Activo')`,
      args: [crypto.randomUUID(), 'Camión Jhon', 'ABC-123', '9']
    });
    console.log('Default camión seeded');
  }

  // Auto-migrate: add new columns to galerones if missing
  const galeronCols = await client.execute("PRAGMA table_info(galerones)");
  const galeronColNames = galeronCols.rows.map((r: any) => r.name);
  if (!galeronColNames.includes('aves_en_produccion')) {
    await client.execute("ALTER TABLE galerones ADD COLUMN aves_en_produccion INTEGER DEFAULT 0");
  }
  if (!galeronColNames.includes('tipo_galeron')) {
    await client.execute("ALTER TABLE galerones ADD COLUMN tipo_galeron TEXT DEFAULT 'Productora'");
  }
  if (!galeronColNames.includes('produccion_diaria_esperada')) {
    await client.execute("ALTER TABLE galerones ADD COLUMN produccion_diaria_esperada INTEGER DEFAULT 0");
  }
  if (!galeronColNames.includes('notas')) {
    await client.execute("ALTER TABLE galerones ADD COLUMN notas TEXT");
  }

  // Auto-migrate: camiones — camionero_id
  const camionCols = (await client.execute("PRAGMA table_info(camiones)")).rows.map((r: any) => r.name);
  if (!camionCols.includes('camionero_id')) {
    await client.execute("ALTER TABLE camiones ADD COLUMN camionero_id TEXT");
  }

  // Auto-migrate: traslados — camion_id, creado_por_id, confirmado_por_id, motivo_rechazo
  const trasladoColNames = (await client.execute("PRAGMA table_info(traslados)")).rows.map((r: any) => r.name);
  const trasladoMigraciones: Record<string, string> = {
    carga_id: "ALTER TABLE traslados ADD COLUMN carga_id TEXT",
    vehiculo: "ALTER TABLE traslados ADD COLUMN vehiculo TEXT",
    camion_id: "ALTER TABLE traslados ADD COLUMN camion_id TEXT",
    creado_por_id: "ALTER TABLE traslados ADD COLUMN creado_por_id TEXT",
    confirmado_por_id: "ALTER TABLE traslados ADD COLUMN confirmado_por_id TEXT",
    motivo_rechazo: "ALTER TABLE traslados ADD COLUMN motivo_rechazo TEXT",
  };
  for (const [col, sql] of Object.entries(trasladoMigraciones)) {
    if (!trasladoColNames.includes(col)) {
      await client.execute(sql);
    }
  }

  // Auto-migrate: etiquetas — columnas F1 (guia_remision_id / peso_bodega)
  const etiquetaCols = await client.execute("PRAGMA table_info(etiquetas)");
  const etiquetaColNames = etiquetaCols.rows.map((r: any) => r.name);
  if (!etiquetaColNames.includes('guia_remision_id')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN guia_remision_id TEXT");
  }
  if (!etiquetaColNames.includes('peso_bodega')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN peso_bodega REAL");
  }
  if (!etiquetaColNames.includes('guia_despacho_id')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN guia_despacho_id TEXT");
  }
  if (!etiquetaColNames.includes('fecha_recepcion')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN fecha_recepcion TEXT");
  }
  if (!etiquetaColNames.includes('tipo_carton')) {
    await client.execute("ALTER TABLE etiquetas ADD COLUMN tipo_carton TEXT");
  }

  // Auto-migrate: productos_catalogo — vida útil (FEFO) y días de aviso
  const productoColNames = (await client.execute("PRAGMA table_info(productos_catalogo)")).rows.map((r: any) => r.name);
  if (!productoColNames.includes('vida_util_dias')) {
    await client.execute("ALTER TABLE productos_catalogo ADD COLUMN vida_util_dias INTEGER DEFAULT 28");
  }
  if (!productoColNames.includes('dias_aviso_vencimiento')) {
    await client.execute("ALTER TABLE productos_catalogo ADD COLUMN dias_aviso_vencimiento INTEGER DEFAULT 7");
  }

  // Auto-migrate: desperdicios — vínculos a ruta/guía/camión/vendedor (patrones)
  const desperdicioCols = await client.execute("PRAGMA table_info(desperdicios)");
  const desperdicioColNames = desperdicioCols.rows.map((r: any) => r.name);
  const desperdicioMigraciones: Record<string, string> = {
    ruta_id: "ALTER TABLE desperdicios ADD COLUMN ruta_id TEXT",
    guia_despacho_id: "ALTER TABLE desperdicios ADD COLUMN guia_despacho_id TEXT",
    camion_id: "ALTER TABLE desperdicios ADD COLUMN camion_id TEXT",
    vendedor_id: "ALTER TABLE desperdicios ADD COLUMN vendedor_id TEXT",
  };
  for (const [col, sql] of Object.entries(desperdicioMigraciones)) {
    if (!desperdicioColNames.includes(col)) {
      await client.execute(sql);
    }
  }

  // recepciones — tipo_diferencia (desperdicio | alerta)
  const recepcionCols = await client.execute("PRAGMA table_info(recepciones)");
  const recepcionColNames = recepcionCols.rows.map((r: any) => r.name);
  if (!recepcionColNames.includes("tipo_diferencia")) {
    await client.execute("ALTER TABLE recepciones ADD COLUMN tipo_diferencia TEXT");
  }

  // Auto-migrate: clientes — columnas F2 (prioridad / ventana entrega / frecuencia / demanda)
  const clienteCols = await client.execute("PRAGMA table_info(clientes)");
  const clienteColNames = clienteCols.rows.map((r: any) => r.name);
  const clienteMigraciones: Record<string, string> = {
    prioridad: "ALTER TABLE clientes ADD COLUMN prioridad TEXT DEFAULT 'Normal'",
    ventana_entrega_ini: 'ALTER TABLE clientes ADD COLUMN ventana_entrega_ini TEXT',
    ventana_entrega_fin: 'ALTER TABLE clientes ADD COLUMN ventana_entrega_fin TEXT',
    dias_frecuencia: 'ALTER TABLE clientes ADD COLUMN dias_frecuencia TEXT',
    demanda_promedio_cartones: 'ALTER TABLE clientes ADD COLUMN demanda_promedio_cartones INTEGER DEFAULT 0',
  };
  for (const [col, sql] of Object.entries(clienteMigraciones)) {
    if (!clienteColNames.includes(col)) {
      await client.execute(sql);
    }
  }

  // Auto-migrate: rutas — columnas F2 (capacidad / centroide)
  const rutaCols = await client.execute("PRAGMA table_info(rutas)");
  const rutaColNames = rutaCols.rows.map((r: any) => r.name);
  const rutaMigraciones: Record<string, string> = {
    capacidad_max_cartones: 'ALTER TABLE rutas ADD COLUMN capacidad_max_cartones INTEGER',
    centroide_lat: 'ALTER TABLE rutas ADD COLUMN centroide_lat REAL',
    centroide_lng: 'ALTER TABLE rutas ADD COLUMN centroide_lng REAL',
  };
  for (const [col, sql] of Object.entries(rutaMigraciones)) {
    if (!rutaColNames.includes(col)) {
      await client.execute(sql);
    }
  }

  // Auto-migrate: facturas — columnas F2 (guia_id / camion_id)
  const facturaCols = await client.execute("PRAGMA table_info(facturas)");
  const facturaColNames = facturaCols.rows.map((r: any) => r.name);
  if (!facturaColNames.includes('guia_id')) {
    await client.execute("ALTER TABLE facturas ADD COLUMN guia_id TEXT");
  }
  if (!facturaColNames.includes('camion_id')) {
    await client.execute("ALTER TABLE facturas ADD COLUMN camion_id TEXT");
  }

  // Auto-migrate: cobranza — fecha_vencimiento + tabla pagos.
  // El aging se medía desde `fecha`, así que una factura a 30 días de crédito
  // figuraba vencida desde el día 1. `fecha_vencimiento` se rellena con la
  // fecha + los días que implica su `condicion_pago`.
  if (!facturaColNames.includes('fecha_vencimiento')) {
    await client.execute("ALTER TABLE facturas ADD COLUMN fecha_vencimiento TEXT");
  }
  await client.execute(`CREATE TABLE IF NOT EXISTS pagos (
    id TEXT PRIMARY KEY,
    factura_id TEXT NOT NULL REFERENCES facturas(id),
    fecha TEXT NOT NULL,
    monto REAL NOT NULL,
    metodo TEXT,
    usuario_id TEXT,
    nota TEXT
  )`);
  await client.execute("CREATE INDEX IF NOT EXISTS idx_pagos_factura ON pagos(factura_id)");
  // Backfill: solo facturas que aún no tienen vencimiento explícito.
  // El plazo lo decide `diasDeCredito`, no un CASE en SQL: dos copias de la
  // misma regla se apartan (un `LIKE '%8%'` antes que `%15%` le daba 8 días a
  // un "Credito 18").
  const facturasParaVencer = await client.execute(
    `SELECT id, fecha, condicion_pago FROM facturas
     WHERE (fecha_vencimiento IS NULL OR fecha_vencimiento = '') AND fecha IS NOT NULL`
  );
  for (const fila of facturasParaVencer.rows) {
    const f = fila as any;
    const vencimiento = fechaVencimientoDe({
      fecha: String(f.fecha),
      fechaVencimiento: null,
      condicion_pago: f.condicion_pago ?? null,
    });
    if (vencimiento) {
      await client.execute({
        sql: `UPDATE facturas SET fecha_vencimiento = ? WHERE id = ?`,
        args: [vencimiento, f.id],
      });
    }
  }

  // Auto-migrate: guias_despacho — columna F3 (fin_dia_fecha)
  const guiaCols = await client.execute("PRAGMA table_info(guias_despacho)");
  const guiaColNames = guiaCols.rows.map((r: any) => r.name);
  if (!guiaColNames.includes('fin_dia_fecha')) {
    await client.execute("ALTER TABLE guias_despacho ADD COLUMN fin_dia_fecha TEXT");
  }

  // Seed default product catalog if empty
  const existingProducts = await client.execute('SELECT COUNT(*) as count FROM productos_catalogo');
  if (existingProducts.rows[0].count === 0) {
    const now = new Date().toISOString();
    const defaultProducts = [
      { id: crypto.randomUUID(), nombre: 'Huevos Extra Grandes', descripcion: 'Huevos de tamaño extra grande (≥70g)', unidad: 'cartones', precio_base: 18500, categoria: 'Huevos', estado: 'Activo', fecha_creacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Grandes', descripcion: 'Huevos de tamaño grande (60-69g)', unidad: 'cartones', precio_base: 16000, categoria: 'Huevos', estado: 'Activo', fecha_creacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Medianos', descripcion: 'Huevos de tamaño mediano (50-59g)', unidad: 'cartones', precio_base: 13500, categoria: 'Huevos', estado: 'Activo', fecha_creacion: now },
      { id: crypto.randomUUID(), nombre: 'Huevos Pequeños', descripcion: 'Huevos de tamaño pequeño (<50g)', unidad: 'cartones', precio_base: 11000, categoria: 'Huevos', estado: 'Activo', fecha_creacion: now },
      { id: crypto.randomUUID(), nombre: 'Gallinaza', descripcion: 'Excremento de gallina procesado, fertilizante', unidad: 'sacos', precio_base: 3500, categoria: 'Subproductos', estado: 'Activo', fecha_creacion: now },
    ];
    for (const p of defaultProducts) {
      await client.execute({ sql: 'INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [p.id, p.nombre, p.descripcion, p.unidad, p.precio_base, p.categoria, p.estado, p.fecha_creacion] });
    }
    console.log('Default product catalog seeded');
  }

  // Seed default carton types if empty
  const existingTiposCarton = await client.execute('SELECT COUNT(*) as count FROM tipos_carton');
  if (existingTiposCarton.rows[0].count === 0) {
    const now = new Date().toISOString();
    const defaultTipos = [
      { nombre: 'Cartón de 30 huevos', unidades: 30 },
      { nombre: 'Cartón de 12 huevos', unidades: 12 },
      { nombre: 'Cartón de 6 huevos', unidades: 6 },
    ];
    for (const t of defaultTipos) {
      await client.execute({ sql: 'INSERT INTO tipos_carton (id, nombre, unidades, estado, fecha_creacion) VALUES (?, ?, ?, ?, ?)', args: [crypto.randomUUID(), t.nombre, t.unidades, 'Activo', now] });
    }
    console.log('Default carton types seeded');
  }

  // Backfill idempotente: desperdicio retroactivo para recepciones previas al fix
  await backfillRecepcionesDesperdicio(dbInstance);

  const app = await createApp();
  const PORT = 5174;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

if (process.argv[1] && !process.argv[1].includes('vitest')) {
  startServer();
}
