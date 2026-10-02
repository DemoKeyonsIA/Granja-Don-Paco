/**
 * SMOKE MAESTRO — cobertura de endpoints.
 *
 * Este archivo responde una sola pregunta: ¿está toda la API de pie? Antes
 * vivía como 74 casos escritos a mano, lo que hacía imposible saber si faltaba
 * alguno. Ahora el inventario vive en tablas y un guard (bloque "Cobertura")
 * parsea `server.ts` para fallar en el momento en que se registre una ruta que
 * las tablas no conocen. Agregar un endpoint obliga a decidir su contrato.
 *
 * Contrato por clase de ruta, medido contra la app real:
 *   - GET de lectura sin parámetros -> 200 con la forma declarada.
 *   - GET que exige parámetro        -> 400 (no 200 con datos inventados).
 *   - GET que exige sesión           -> 401.
 *   - POST de escritura             -> 4xx con cuerpo vacío; nunca 500.
 *   - Ruta con :param               -> 4xx ante un id inexistente.
 *
 * Excluidas a propósito: las rutas que llaman a Gemini (`/api/extract`,
 * `/api/predict-load`, `/api/ai/*`, `/api/chat/estela`) necesitan
 * `GEMINI_API_KEY`, así que no son verificables en un smoke sin red. El guard de
 * cobertura las conoce por nombre para que la exclusión sea explícita y no una
 * ruta que se pierde en silencio.
 *
 * La profundidad de comportamiento (cadena de custodia, precios, roles,
 * conciliaciones) vive en los archivos e2e-*. Este archivo no los repite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl } from './helpers/db';

let app: Express;
const DB_PATH = path.resolve(process.cwd(), '.test-smoke.db');

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@granja.com', 'Admin'] });
  const testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

// ---------------------------------------------------------------------------
// Inventario de rutas
// ---------------------------------------------------------------------------

/** Lecturas que responden 200 con una lista. */
const LECTURAS_LISTA: string[] = [
  '/api/inventario', '/api/inventario/movimientos', '/api/facturas', '/api/gastos',
  '/api/granjas', '/api/galerones', '/api/lotes', '/api/mantenimientos', '/api/produccion/historial',
  '/api/camiones', '/api/rutas', '/api/etiquetas', '/api/pesos', '/api/vacunaciones',
  '/api/alimento', '/api/alimento/consumo', '/api/activos', '/api/ordenes-mantenimiento',
  '/api/desperdicios', '/api/precios/listas', '/api/precios/historial', '/api/auditoria',
  '/api/aprobaciones', '/api/reportes/ventas-por-ruta', '/api/reportes/produccion',
  '/api/reportes/inventario', '/api/reportes/desperdicios', '/api/users', '/api/clientes',
  '/api/productos-catalogo', '/api/tipos-carton', '/api/incidentes',
  '/api/operaciones/traslados', '/api/operaciones/cargas', '/api/operaciones/recepciones',
  '/api/operaciones/remisiones', '/api/logistica/camiones', '/api/logistica/guias',
  '/api/logistica/guias-activas', '/api/facturacion/documentos',
];

/**
 * Lecturas que responden 200 con un objeto. `claves` son las que la UI consume
 * por nombre: si una se renombra en el servidor, la pantalla se cae en silencio
 * y un `200` no lo delata.
 */
const LECTURAS_OBJETO: Array<{ ruta: string; claves: string[] }> = [
  { ruta: '/api/logistica/auditoria', claves: ['facturas', 'totalCargado'] },
  { ruta: '/api/clientes/cartera', claves: ['total', 'clientes'] },
  { ruta: '/api/clientes/analisis', claves: ['periodo', 'totalClientes', 'ventaDelMes'] },
  { ruta: '/api/logistica/tablero', claves: ['fecha', 'guias'] },
  { ruta: '/api/facturacion/rutas-dia', claves: ['fecha', 'rutas'] },
  { ruta: '/api/bodega/stock', claves: ['ubicacion', 'kpis', 'productos', 'colaFEFO'] },
  { ruta: '/api/pesos/trazabilidad', claves: ['pesos', 'resumen'] },
  { ruta: '/api/pesos/conciliacion', claves: ['porUbicacion', 'totalRegistros'] },
  { ruta: '/api/vacunaciones/alertas', claves: ['proximas', 'vencidas', 'totalProgramadas'] },
  { ruta: '/api/alimento/alertas', claves: ['bajoInventario', 'totalSilos'] },
  { ruta: '/api/ordenes-mantenimiento/alertas', claves: ['vencidas', 'proximas', 'totalPendientes'] },
  { ruta: '/api/desperdicios/resumen', claves: ['porOrigen', 'impactoTotal', 'totalRegistros'] },
  { ruta: '/api/desperdicios/patrones', claves: ['rango', 'totales', 'porRuta', 'porVendedor'] },
  { ruta: '/api/dashboard/enterprise', claves: ['ingresosHoy', 'gastosHoy', 'utilidadNeta'] },
  { ruta: '/api/dashboard/produccion-detalle', claves: ['porGranja', 'resumen'] },
  { ruta: '/api/aprobaciones/pendientes', claves: ['count', 'items'] },
  { ruta: '/api/finanzas/resumen', claves: ['periodo', 'ingresosFacturados', 'gastos', 'utilidad'] },
  { ruta: '/api/reportes/flujo-caja', claves: ['periodo', 'ingresosFacturados', 'gastos', 'utilidad'] },
  { ruta: '/api/reportes/financiero', claves: ['totalVentas', 'totalGastos', 'utilidadNeta', 'margen'] },
];

/** Lecturas que sin el parámetro obligatorio deben pedirlo (400), no improvisar. */
const LECTURAS_EXIGEN_PARAMETRO: string[] = [
  '/api/logistica/cuadre-central', '/api/precios/lookup', '/api/roles/permisos',
];

/** Lecturas detrás de sesión: sin cookie responden 401 y no 200 con datos de otro. */
const LECTURAS_EXIGEN_SESION: string[] = [
  '/api/auth/me',
  '/api/office/resumen', '/api/office/cuentas', '/api/office/mensajes',
  '/api/office/arbol', '/api/office/documentos', '/api/office/vinculaciones',
];

/** Escrituras que validan el cuerpo y responden 400. */
const ESCRITURAS_VALIDAN: string[] = [
  '/api/produccion/recoleccion', '/api/gastos', '/api/granjas/wizard', '/api/granjas',
  '/api/galerones',
  '/api/lotes', '/api/mantenimientos', '/api/operaciones/traslado', '/api/camiones',
  '/api/operaciones/recepcion', '/api/operaciones/remision', '/api/operaciones/recepcion-remision',
  '/api/operaciones/alistamiento', '/api/clientes', '/api/rutas', '/api/logistica/camiones',
  '/api/logistica/guias', '/api/logistica/cargar-camion', '/api/logistica/cierre-ruta',
  '/api/logistica/caja/venta', '/api/logistica/caja/devolucion', '/api/logistica/caja/fin-dia',
  '/api/logistica/cuadre-central', '/api/etiquetas/generar', '/api/etiquetas/generar-lote',
  '/api/etiquetas/escanear', '/api/bodega/ingresar-etiquetas', '/api/bodega/ingreso-manual',
  '/api/pesos/registrar', '/api/vacunaciones', '/api/alimento', '/api/alimento/consumo',
  '/api/activos', '/api/ordenes-mantenimiento', '/api/desperdicios', '/api/precios/listas',
  '/api/precios/detalle', '/api/precios/cambiar', '/api/auditoria', '/api/aprobaciones',
  '/api/precios/lookup-multiple', '/api/users', '/api/productos-catalogo', '/api/tipos-carton',
  '/api/precio-excepciones', '/api/incidentes', '/api/auth/login',
];

/** Escrituras detrás de sesión. */
const ESCRITURAS_EXIGEN_SESION: string[] = [
  '/api/ventas', '/api/pagos',
  '/api/facturacion/crear-documento', '/api/facturacion/generar-xml', '/api/facturacion/enviar',
  '/api/facturacion/consultar-estado', '/api/facturacion/nota-credito', '/api/facturacion/consolidar-ruta',
  '/api/office/cuentas', '/api/office/sync', '/api/office/mensajes', '/api/office/documentos',
  '/api/office/vinculaciones', '/api/office/vinculaciones/probar',
];

/**
 * Rutas con :param contra un id inexistente. Tres devuelven 200 a propósito y por
 * eso están anotadas: son borrados idempotentes y listados de "sin resultados",
 * no recursos que existen. El resto debe rechazar.
 */
const CON_PARAMETRO: Array<{ metodo: string; patron: string; esperado: number; nota?: string }> = [
  { metodo: 'GET', patron: '/api/facturas/:id/pagos', esperado: 404 },
  { metodo: 'GET', patron: '/api/granjas/:id/detalle', esperado: 404 },
  { metodo: 'GET', patron: '/api/clientes/:id/360', esperado: 404 },
  { metodo: 'GET', patron: '/api/logistica/guias/:id', esperado: 404 },
  { metodo: 'GET', patron: '/api/etiquetas/trazabilidad/:codigo', esperado: 404 },
  { metodo: 'GET', patron: '/api/etiquetas/:codigo/qr.png', esperado: 404 },
  { metodo: 'GET', patron: '/api/precios/detalle/:listaId', esperado: 200, nota: 'lista inexistente -> detalle vacío, no error' },
  { metodo: 'GET', patron: '/api/precio-excepciones/:clienteId', esperado: 200, nota: 'cliente sin excepciones -> lista vacía' },

  { metodo: 'PUT', patron: '/api/mantenimientos/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/granjas/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/galerones/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/lotes/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/camiones/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/clientes/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/rutas/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/vacunaciones/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/ordenes-mantenimiento/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/users/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/productos-catalogo/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/tipos-carton/:id', esperado: 404 },
  { metodo: 'PUT', patron: '/api/aprobaciones/:id', esperado: 400, nota: 'rechaza el cuerpo vacío antes de buscar el id' },

  { metodo: 'PATCH', patron: '/api/incidentes/:id', esperado: 404 },

  { metodo: 'DELETE', patron: '/api/galerones/:id', esperado: 404 },
  { metodo: 'DELETE', patron: '/api/lotes/:id', esperado: 404 },
  { metodo: 'DELETE', patron: '/api/camiones/:id', esperado: 404 },
  { metodo: 'DELETE', patron: '/api/clientes/:id', esperado: 200, nota: 'borrado idempotente' },
  { metodo: 'DELETE', patron: '/api/users/:id', esperado: 404 },
  { metodo: 'DELETE', patron: '/api/productos-catalogo/:id', esperado: 404 },
  { metodo: 'DELETE', patron: '/api/tipos-carton/:id', esperado: 404 },
  { metodo: 'DELETE', patron: '/api/precio-excepciones/:id', esperado: 404 },

  { metodo: 'POST', patron: '/api/operaciones/carga/:cargaId/confirmar', esperado: 400 },
  { metodo: 'POST', patron: '/api/operaciones/carga/:cargaId/rechazar', esperado: 400 },
  { metodo: 'POST', patron: '/api/logistica/guias/:id/marcar-en-ruta', esperado: 404 },
  { metodo: 'POST', patron: '/api/logistica/guias/:id/cerrar', esperado: 404 },
  { metodo: 'POST', patron: '/api/office/mensajes/:id/leer', esperado: 401 },
  { metodo: 'POST', patron: '/api/office/documentos/:id/vincular', esperado: 401 },
  { metodo: 'DELETE', patron: '/api/office/cuentas/:id', esperado: 401 },
  { metodo: 'DELETE', patron: '/api/office/vinculaciones/:id', esperado: 401 },
  { metodo: 'GET', patron: '/api/office/mensajes/:threadId', esperado: 401 },
];

/** Rutas que dependen de Gemini y por eso el smoke no las puede sondear. */
const EXCLUIDAS_POR_GEMINI: string[] = [
  '/api/extract', '/api/predict-load', '/api/chat/estela',
  '/api/ai/ceres', '/api/ai/vega', '/api/ai/nash', '/api/ai/houston',
  '/api/ai/magnetar', '/api/ai/nova', '/api/ai/tales',
];

const ID_FALSO = 'no-existe-000';

// ---------------------------------------------------------------------------
// Runner agregado
// ---------------------------------------------------------------------------

type Sondeo = { etiqueta: string; ejecutar: () => Promise<{ status: number; body: any }>; verificar?: (res: { status: number; body: any }) => string | null };

/**
 * Corre todos los sondeos y acumula los fallos en vez de cortar en el primero:
 * un smoke que se detiene en el primer endpoint caído esconde los otros. El
 * mensaje final lista los que fallaron juntos.
 */
async function sondeosAgregados(sondeos: Sondeo[]): Promise<void> {
  const fallos: string[] = [];
  for (const s of sondeos) {
    const res = await s.ejecutar();
    const problema = res.status >= 500
      ? ` — 500 con ${JSON.stringify(res.body).slice(0, 160)}`
      : s.verificar?.(res);
    if (problema) fallos.push(`${s.etiqueta}${problema}`);
  }
  expect(fallos, fallos.length ? `\n${fallos.join('\n')}` : '').toEqual([]);
}

const metodo = (m: string) => (m === 'GET' ? 'get' : m === 'PUT' ? 'put' : m === 'PATCH' ? 'patch' : m === 'DELETE' ? 'delete' : 'post') as 'get' | 'post' | 'put' | 'patch' | 'delete';

function llamar(m: string, ruta: string, cuerpo?: any) {
  return (request(app) as any)[metodo(m)](ruta).send(cuerpo);
}

/** El sufijo del mensaje; la etiqueta la antepone el runner. */
const esperando = (esperado: number) => (res: { status: number }) =>
  res.status === esperado ? null : ` — esperaba ${esperado} y recibió ${res.status}`;

// ---------------------------------------------------------------------------

describe('SMOKE maestro — inventario de endpoints', () => {
  describe('Cobertura: toda ruta registrada en server.ts está en una tabla', () => {
    it('ninguna ruta registrada quedó fuera del inventario', () => {
      const fuente = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
      const registradas: Array<{ metodo: string; ruta: string }> = [];
      const re = /app\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(fuente))) {
        const ruta = m[3].split('?')[0];
        if (ruta === '*') continue; // fallback SPA, no es un endpoint
        registradas.push({ metodo: m[1].toUpperCase(), ruta });
      }

      const aPatron = (ruta: string) => ruta.replace(/\/:\w+/g, '/*');
      const cubiertas = new Set<string>([
        ...LECTURAS_LISTA.map((r) => `GET ${aPatron(r)}`),
        ...LECTURAS_OBJETO.map((l) => `GET ${aPatron(l.ruta)}`),
        ...LECTURAS_EXIGEN_PARAMETRO.map((r) => `GET ${aPatron(r)}`),
        ...LECTURAS_EXIGEN_SESION.map((r) => `GET ${aPatron(r)}`),
        ...ESCRITURAS_VALIDAN.map((r) => `POST ${aPatron(r)}`),
        ...ESCRITURAS_EXIGEN_SESION.map((r) => `POST ${aPatron(r)}`),
        ...EXCLUIDAS_POR_GEMINI.map((r) => `POST ${aPatron(r)}`),
        ...CON_PARAMETRO.map((r) => `${r.metodo} ${aPatron(r.patron)}`),
        'POST /api/auth/logout', // 200 sin cuerpo: cierra sesión, no valida nada
      ]);

      const sinCubrir = registradas
        .map((r) => `${r.metodo} ${aPatron(r.ruta)}`)
        .filter((clave) => !cubiertas.has(clave));

      expect(sinCubrir, `rutas nuevas sin smoke:\n${sinCubrir.join('\n')}`).toEqual([]);
      expect(registradas.length, 'el inventario de server.ts cambió de tamaño; revisá las tablas').toBeGreaterThan(140);
    });
  });

  describe('Lecturas', () => {
    it('todo GET de lista responde 200 con un arreglo', () => {
      return sondeosAgregados(LECTURAS_LISTA.map((ruta) => ({
        etiqueta: `GET ${ruta}`,
        ejecutar: () => request(app).get(ruta),
        verificar: (res) => {
          if (res.status !== 200) return `GET ${ruta} — esperaba 200 y recibió ${res.status}`;
          if (!Array.isArray(res.body)) return `GET ${ruta} — esperaba un arreglo y recibió ${JSON.stringify(res.body).slice(0, 80)}`;
          return null;
        },
      })));
    });

    it('todo GET de objeto responde 200 con las claves que la UI consume', () => {
      return sondeosAgregados(LECTURAS_OBJETO.map(({ ruta, claves }) => ({
        etiqueta: `GET ${ruta}`,
        ejecutar: () => request(app).get(ruta),
        verificar: (res) => {
          if (res.status !== 200) return `GET ${ruta} — esperaba 200 y recibió ${res.status}`;
          const faltantes = claves.filter((k) => !(k in (res.body ?? {})));
          return faltantes.length ? `GET ${ruta} — le faltan las claves ${faltantes.join(', ')}` : null;
        },
      })));
    });

    it('los GET que exigen parámetro responden 400 en vez de improvisar datos', () => {
      return sondeosAgregados(LECTURAS_EXIGEN_PARAMETRO.map((ruta) => ({
        etiqueta: `GET ${ruta}`,
        ejecutar: () => request(app).get(ruta),
        verificar: esperando(400),
      })));
    });

    it('los GET detrás de sesión responden 401 y no datos', () => {
      return sondeosAgregados(LECTURAS_EXIGEN_SESION.map((ruta) => ({
        etiqueta: `GET ${ruta}`,
        ejecutar: () => request(app).get(ruta),
        verificar: esperando(401),
      })));
    });
  });

  describe('Escrituras', () => {
    it('todo POST de escritura rechaza el cuerpo vacío con 400', () => {
      return sondeosAgregados(ESCRITURAS_VALIDAN.map((ruta) => ({
        etiqueta: `POST ${ruta}`,
        ejecutar: () => request(app).post(ruta).send({}),
        verificar: esperando(400),
      })));
    });

    it('los POST detrás de sesión responden 401 y no escriben', () => {
      return sondeosAgregados(ESCRITURAS_EXIGEN_SESION.map((ruta) => ({
        etiqueta: `POST ${ruta}`,
        ejecutar: () => request(app).post(ruta).send({}),
        verificar: esperando(401),
      })));
    });

    it('POST /api/auth/logout responde 200 sin cuerpo', async () => {
      const res = await request(app).post('/api/auth/logout').send({});
      expect(res.status).toBe(200);
    });
  });

  describe('Rutas con :param', () => {
    it('ninguna revienta ni se hace la loca ante un id inexistente', () => {
      return sondeosAgregados(CON_PARAMETRO.map(({ metodo: m, patron, esperado, nota }) => ({
        etiqueta: `${m} ${patron}`,
        ejecutar: () => llamar(m, patron.replace(/:(\w+)/g, ID_FALSO), {}),
        verificar: (res) => {
          if (res.status === esperado) return null;
          return ` — esperaba ${esperado} y recibió ${res.status}${nota ? ` (${nota})` : ''}`;
        },
      })));
    });
  });
});

describe('SMOKE maestro — contratos que la UI consume por nombre', () => {
  /**
   * Desde que el módulo Centro de Mando salió del sidebar, este endpoint no
   * alimenta una pantalla propia sino la columna "Salud del negocio" de Resumen.
   * `FinanzasResumen` elige las claves una por una y, si falta alguna, oculta el
   * bloque en vez de inventar ceros; este caso avisa del cambio de nombre antes
   * de que el bloque desaparezca en silencio.
   */
  it('GET /api/dashboard/enterprise — las 7 claves que lee Resumen', async () => {
    const res = await request(app).get('/api/dashboard/enterprise');
    expect(res.status).toBe(200);
    for (const clave of [
      'cartonesProducidos', 'stockBodegaCentral', 'totalAvesVivas', 'rutasActivas',
      'clientesActivos', 'desperdiciosHoy', 'impactoDesperdicioHoy',
    ]) {
      expect(typeof res.body[clave], clave).toBe('number');
    }
  });

  it('GET /api/finanzas/resumen — la fuente única que Resumen muestra', async () => {
    const res = await request(app).get('/api/finanzas/resumen');
    expect(res.status).toBe(200);
    for (const clave of [
      'ingresosFacturados', 'ingresosCobrados', 'gastos', 'utilidad', 'margen',
      'cuentasPorCobrar', 'aging', 'cicloDelDinero', 'documentosEmitidos',
    ]) {
      expect(res.body, clave).toHaveProperty(clave);
    }
    // Con una base vacía todo es cero, pero la estructura sigue ahí: un resumen
    // que devuelve `{}` con 200 hace creer que el mes cerró en cero.
    expect(res.body.cicloDelDinero).toHaveLength(6);
  });

  // Resumen y Flujo de Caja muestran el mismo P&L: si divergieran, una de las dos
  // pantallas estaría mintiendo. La comparación exacta vive en
  // `e2e-finanzas-roles.test.ts`; acá solo se ata que ambas rutas existen.
  it('finanzas/resumen y reportes/flujo-caja exponen el mismo P&L', async () => {
    const [resumen, flujo] = await Promise.all([
      request(app).get('/api/finanzas/resumen'),
      request(app).get('/api/reportes/flujo-caja'),
    ]);
    for (const cuerpo of [resumen.body, flujo.body]) {
      expect(Array.isArray(cuerpo.cicloDelDinero)).toBe(true);
      expect(cuerpo).toHaveProperty('aging');
      expect(cuerpo).toHaveProperty('cuentasPorCobrar');
    }
  });

  // Los reportes ya se cubren uno a uno arriba. Este caso ata el conjunto: los ids
  // que Reportes.tsx pide tienen que existir como rutas. El bug 1 fue precisamente
  // un id (`ventas-ruta`) que el cliente pedía y el servidor no servía, de modo
  // que el reporte se veía vacío en vez de roto.
  it('todos los reportes que consume Reportes.tsx resuelven 200', async () => {
    const ids = ['financiero', 'flujo-caja', 'ventas-por-ruta', 'produccion', 'inventario', 'desperdicios'];
    for (const id of ids) {
      const res = await request(app).get(`/api/reportes/${id}`);
      expect(res.status, `reporte ${id}`).toBe(200);
    }
  });

  it('GET /api/roles/permisos — Admin, Vendedor y rol inválido', async () => {
    const admin = await request(app).get('/api/roles/permisos?role=Admin');
    expect(admin.status).toBe(200);
    expect(admin.body.view).toContain('*');
    expect(admin.body.approve).toContain('*');

    const vendedor = await request(app).get('/api/roles/permisos?role=Vendedor');
    expect(vendedor.status).toBe(200);
    expect(vendedor.body.view).toContain('rutas_propias');
    expect(vendedor.body.create).toContain('ventas');

    const invalido = await request(app).get('/api/roles/permisos?role=FakeRole');
    expect(invalido.status).toBe(400);
  });

  it('GET /api/precios/lookup — 400 sin producto, 404 si no existe', async () => {
    expect((await request(app).get('/api/precios/lookup')).status).toBe(400);
    expect((await request(app).get('/api/precios/lookup?producto=NoExiste')).status).toBe(404);
  });

  it('POST /api/produccion/recoleccion — falla sin galerón', async () => {
    const res = await request(app).post('/api/produccion/recoleccion').send({ galeron: null, detalles: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/granjas/wizard — crea con nombre, rechaza sin nombre', async () => {
    const creada = await request(app).post('/api/granjas/wizard').send({ nombre: 'Test Smoke Wizard' });
    expect(creada.status).toBe(201);
    const sinNombre = await request(app).post('/api/granjas/wizard').send({});
    expect(sinNombre.status).toBe(400);
  });
});

describe('SMOKE maestro — escrituras detrás de sesión', () => {
  /**
   * Las seis rutas de facturación responden 401 sin sesión, así que el sondeo
   * anterior solo probó el candado y nunca su validación. Con `x-user-id` se
   * comprueba la segunda mitad del contrato: una vez autenticado, el cuerpo
   * vacío tiene que rechazarse con 400 y no reventar con 500.
   */
  const FACTURACION: string[] = [
    '/api/facturacion/crear-documento', '/api/facturacion/generar-xml', '/api/facturacion/enviar',
    '/api/facturacion/consultar-estado', '/api/facturacion/nota-credito', '/api/facturacion/consolidar-ruta',
  ];

  it('con sesión, facturación rechaza el cuerpo vacío con 400', () => {
    return sondeosAgregados(FACTURACION.map((ruta) => ({
      etiqueta: `POST ${ruta} (autenticado)`,
      ejecutar: () => request(app).post(ruta).set('x-user-id', '1').send({}),
      verificar: esperando(400),
    })));
  });

  // Escrituras felices mínimas: prueban que el camino de éxito sigue en pie, no
  // solo que el endpoint rechaza. La profundidad vive en los e2e-*.
  it('gastos, rutas y clientes aceptan una escritura válida', async () => {
    const gasto = await request(app).post('/api/gastos').send({
      fecha: new Date().toISOString(),
      categoria: 'Diesel',
      monto: 15000,
      descripcion: 'Prueba smoke test',
      usuarioId: 'test-user-001',
    });
    expect(gasto.status).toBe(200);
    expect(gasto.body.success).toBe(true);

    const ruta = await request(app).post('/api/rutas').send({ nombre: 'Ruta Test', vendedor_asignado: 'Vendedor Test' });
    expect(ruta.status).toBe(201);
    expect(ruta.body.success).toBe(true);

    const cliente = await request(app).post('/api/clientes').send({ nombre: 'Cliente Test', telefono: '8888-0000', ruta: 'Ruta Test', condicion_pago: 'Contado' });
    expect(cliente.status).toBe(201);
    expect(cliente.body.success).toBe(true);
  });

  it('el historial de producción acepta el filtro de granja', async () => {
    const res = await request(app).get('/api/produccion/historial?granjaId=any');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('SMOKE maestro — flujos con estado', () => {
  it('POST /api/ventas — auto-aplica el precio de lista', async () => {
    const clientRes = await request(app).post('/api/clientes').send({ nombre: 'Test Client Precio', ruta: 'Ruta 1' });
    expect(clientRes.status).toBe(201);
    const clientId = clientRes.body.id;

    const listaRes = await request(app).post('/api/precios/listas').send({ nombre: 'Lista Test', tipo: 'Global' });
    expect(listaRes.status).toBe(201);
    const listaId = listaRes.body.id;

    const detRes = await request(app).post('/api/precios/detalle').send({ listaId, producto: 'Huevos - Smoke TEST', precioUnitario: 2500 });
    expect(detRes.status).toBe(201);

    const ventaRes = await request(app).post('/api/ventas').set('x-user-id', '1').send({
      factura: { id: crypto.randomUUID(), consecutivo: 'FAC-TEST-001', fecha: new Date().toISOString(), clienteId: clientId, vendedorId: '1', subtotal: 0, descuento: 0, total: 0, condicion_pago: 'Contado', estado: 'Pagada' },
      detalles: [{ producto: 'Huevos - Smoke TEST', cantidad: 10, precio_unitario: 0, subtotal: 0 }]
    });
    expect(ventaRes.status).toBe(200);
    expect(ventaRes.body.preciosAplicados).toBeDefined();
    expect(ventaRes.body.preciosAplicados[0].precio).toBe(2500);
  });

  describe('Galerón — ocupación y aves_en_produccion', () => {
    let testGranjaId: string;
    let testGaleronId: string;

    it('wizard crea granja con galerón en cero', async () => {
      const res = await request(app)
        .post('/api/granjas/wizard')
        .send({
          nombre: 'Granja Test Ocupación',
          ubicacion: 'Heredia',
          tipo_produccion: 'Postura',
          encargadoId: 'admin-001',
          galerones: [{ nombre: 'Galpón Ocupación', capacidad_maxima: 1000 }]
        });
      expect(res.status).toBe(201);

      const g = (await request(app).get('/api/granjas')).body.find((x: any) => x.nombre === 'Granja Test Ocupación');
      expect(g).toBeDefined();
      testGranjaId = g.id;

      const gal = (await request(app).get('/api/galerones')).body.find((x: any) => x.granjaId === testGranjaId && x.nombre === 'Galpón Ocupación');
      expect(gal).toBeDefined();
      expect(gal.capacidad_maxima).toBe(1000);
      expect(gal.aves_en_produccion).toBe(0);
      testGaleronId = gal.id;
    });

    it('PUT actualiza aves_en_produccion y el detalle calcula la ocupación', async () => {
      await request(app).put(`/api/galerones/${testGaleronId}`).send({ aves_en_produccion: 800 });

      const res = await request(app).get(`/api/granjas/${testGranjaId}/detalle`);
      expect(res.status).toBe(200);
      const gal = res.body.galerones.find((g: any) => g.id === testGaleronId);
      expect(gal.aves).toBe(800);
      expect(gal.ocupacion).toBe(80);
      expect(res.body.resumen.avesTotal).toBe(800);
      expect(res.body.resumen.ocupacion).toBe(80);
    });

    it('la ocupación se recalcula al cambiar la capacidad, no solo las aves', async () => {
      await request(app).put(`/api/galerones/${testGaleronId}`).send({ capacidad_maxima: 1200, aves_en_produccion: 360 });
      let gal = (await request(app).get(`/api/granjas/${testGranjaId}/detalle`)).body.galerones.find((g: any) => g.id === testGaleronId);
      expect(gal.aves).toBe(360);
      expect(gal.ocupacion).toBe(30);

      await request(app).put(`/api/galerones/${testGaleronId}`).send({ capacidad_maxima: 1000, aves_en_produccion: 950 });
      gal = (await request(app).get(`/api/granjas/${testGranjaId}/detalle`)).body.galerones.find((g: any) => g.id === testGaleronId);
      expect(gal.aves).toBe(950);
      expect(gal.ocupacion).toBe(95);
    });
  });
});
