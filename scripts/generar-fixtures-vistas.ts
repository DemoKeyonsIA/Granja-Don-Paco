/**
 * Generador de `tests/fixtures/vistas.json`.
 *
 * Las vistas se prueban contra las respuestas REALES del servidor, no contra
 * objetos escritos a mano. Es la misma disciplina del smoke maestro: un
 * `{ total: 100 }` invented en el test pasa aunque el endpoint nunca devuelva
 * esa forma, y entonces el test no está probando nada.
 *
 * El procedimiento es el inverso del de un test normal:
 *
 *   1. siembra un dataset realista usando la API real (granja, aves, lote,
 *      ruta, clientes, camión, etiquetas, inventario, producción, facturas,
 *      pagos, gastos, Guides, Reception…),
 *   2. consulta los 79 endpoints que consumen las vistas,
 *   3. vuelca `{ status, body }` de cada uno a disco.
 *
 * Después, `tests/ui/vistas-smoke.test.tsx` sirve esos bodies a `fetch` y monta
 * cada vista. Si el contrato de un endpoint cambia, el fixture queda viejo y el
 * test se rompe en el punto donde importa: el componente que lo consume.
 *
 * Uso:  npm run fixtures:vistas
 *
 * El fixture es un artefacto versionado a propósito. Regenerarlo es un acto
 * deliberado, no algo que pase en cada `npm test`: si se regenerara solo, un
 * cambio de contrato se llevaría por delante el test que debería haberlo detectado.
 */
import fs from 'fs';
import path from 'path';

// La app se importa sin listener: con el puerto abierto, el proceso mantiene
// tomado el archivo de base de datos y el script no puede borrarlo al terminar.
process.env.GDP_NO_LISTEN = '1';

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import { ejecutarDdl } from '../tests/helpers/db';

const DB_PATH = path.resolve(process.cwd(), '.test-fixtures-vistas.db');
const OUT = path.resolve(process.cwd(), 'tests/fixtures/vistas.json');

/** Usuario Admin: `x-user-id` contra la BD, que es como el shell real resuelve el rol. */
const ADMIN = 'u-admin';

/**
 * Los endpoints que las vistas piden al montar, extraídos de los
 * `fetch('/api/...')` de `src/components` y filtrados a los que son GET.
 *
 * `cobertura()` cruza esta lista contra los `fetch` de `src/components` y avisa de
 * lo que se separe. Va al final de `main()` y no aborta la generación: el fixture
 * es útil aunque se quede corto, y volver inútil el script por una diferencia de
 * nombres sería el peor resultado posible.
 *
 * El contraste tiene que ser por prefijo, no por igualdad exacta: las vistas piden
 * `/api/granjas/${id}` y `/api/etiquetas?tipo=X`, y ninguna de las dos formas
 * aparece literalmente en la lista.
 */
const ENDPOINTS: string[] = [
  '/api/camiones', '/api/users',
  '/api/alimento', '/api/alimento/consumo', '/api/alimento/alertas',
  '/api/operaciones/traslados', '/api/granjas', '/api/inventario/movimientos',
  '/api/logistica/guias-activas', '/api/logistica/camiones', '/api/productos-catalogo', '/api/inventario',
  '/api/clientes', '/api/clientes/cartera', '/api/clientes/analisis', '/api/rutas',
  '/api/facturas',
  '/api/logistica/guias', '/api/etiquetas',
  '/api/galerones',
  '/api/desperdicios', '/api/desperdicios/resumen',
  '/api/tipos-carton',
  '/api/facturacion/documentos', '/api/facturacion/rutas-dia',
  '/api/finanzas/resumen', '/api/dashboard/enterprise',
  '/api/lotes', '/api/mantenimientos',
  '/api/incidentes',
  '/api/activos', '/api/ordenes-mantenimiento', '/api/ordenes-mantenimiento/alertas',
  '/api/office/cuentas', '/api/office/mensajes', '/api/office/vinculaciones', '/api/office/documentos',
  '/api/office/arbol', '/api/office/resumen',
  '/api/bodega/stock', '/api/logistica/tablero', '/api/operaciones/recepciones',
  '/api/operaciones/remisiones',
  '/api/pesos', '/api/pesos/conciliacion',
  '/api/precios/listas', '/api/precios/historial',
  '/api/vacunaciones', '/api/vacunaciones/alertas',
  '/api/gastos',
];

/**
 * Rutas con `:param` que las vistas siguen tras un id. Se resuelven con ids
 * reales del dataset sembrado; si el id no existe, el fixture guarda el 404 y el
 * test de la vista lo señala en vez de esconderse detrás de un stub.
 */
const ENDPOINTS_PARAM: { patron: string; etiqueta: string }[] = [
  { patron: '/api/granjas/{granjaId}/detalle', etiqueta: 'granja-detalle' },
  { patron: '/api/clientes/{clienteId}/360', etiqueta: 'cliente-360' },
  { patron: '/api/precio-excepciones/{clienteId}', etiqueta: 'precio-excepciones' },
  { patron: '/api/etiquetas/trazabilidad/{codigo}', etiqueta: 'etiqueta-trazabilidad' },
];

const HOY = new Date().toISOString().split('T')[0];
const AYER = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const HACE_5 = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];

/**
 * Los `fetch("/api/...")` de lectura de los componentes.
 *
 * Solo los GET. Un POST no es una brecha de cobertura de este fixture: son las
 * escrituras que `smoke-flujos.test.tsx` intercepta con su propio parche de red, y
 * reportar 29 escrituras como "endpoints que faltan" cada vez que se regenera solo
 * entrena al ejecutor a ignorar la salida.
 *
 * El método se lee de la ventana de texto que sigue a la llamada, no de un mapa
 * aparte, porque en los componentes el `method` va en el mismo objeto de opciones.
 */
function fetchesDeLasVistas(): string[] {
  const raiz = path.join(process.cwd(), 'src', 'components');
  const encontrados = new Set<string>();
  const patron = /fetch\(\s*[`'"](?<ruta>\/api\/[^`'"]*)/g;
  const visitar = (dir: string) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        visitar(completo);
        continue;
      }
      if (!/\.tsx?$/.test(entrada.name)) continue;
      const texto = fs.readFileSync(completo, 'utf8');
      for (const m of texto.matchAll(patron)) {
        // La ventana cubre hasta el cierre del objeto de opciones. Si no cabe,
        // preferimos omitir el endpoint a reportar una escritura como lectura.
        const ventana = texto.slice(m.index, m.index + 300);
        if (/method\s*:\s*[`'"](POST|PUT|PATCH|DELETE)/i.test(ventana)) continue;
        // `${granjaId}/confirmar` deja el hueco vacío: sin esto salen rutas como
        // `/api/operaciones/carga//confirmar` que no existen en el servidor.
        const ruta = (m.groups?.ruta ?? '')
          .replace(/\$\{[^}]*\}/g, '')
          .split('?')[0]
          .replace(/\/{2,}/g, '/')
          .replace(/\/$/, '');
        if (ruta) encontrados.add(ruta);
      }
    }
  };
  visitar(raiz);
  return [...encontrados].sort();
}

/** Los GET de `ENDPOINTS` contra lo que las vistas piden, por prefijo. */
function cobertura(): { faltan: string[]; sobran: string[] } {
  const pedidas = fetchesDeLasVistas();
  const declarados = ENDPOINTS.map(e => e.replace(/:.*$/, '')).sort();
  const calza = (k: string, p: string) => p === k || p.startsWith(k + '/');
  return {
    faltan: pedidas.filter(p => !declarados.some(k => calza(k, p))),
    sobran: declarados.filter(k => !pedidas.some(p => calza(k, p))),
  };
}

async function main() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = createClient({ url: `file:${DB_PATH}` });
  await ejecutarDdl(client);

  await client.execute({
    sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`,
    args: [ADMIN, 'Administrador', 'admin@test.com', 'Admin'],
  });
  await client.execute({
    sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`,
    args: ['u-ven', 'Vendedor Ruta', 'vendedor@test.com', 'Vendedor'],
  });
  await client.execute({
    sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`,
    args: ['u-bod', 'Bodeguero', 'bodeguero@test.com', 'Bodeguero'],
  });
  await client.execute({
    sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`,
    args: ['u-cam', 'Camionero', 'camionero@test.com', 'Camionero'],
  });
  await client.execute({
    sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`,
    args: ['u-enc', 'Encargado', 'encargado@test.com', 'Encargado'],
  });

  for (const [slug, nombre, precio, cat] of [
    ['p-grande', 'Huevos - Grande', 16000, 'Huevos'],
    ['p-chico', 'Huevos - Chico', 13500, 'Huevos'],
    ['p-alimento', 'Alimento balanceado', 9000, 'Alimento'],
  ] as const) {
    await client.execute({
      sql: `INSERT INTO productos_catalogo (id, nombre, descripcion, unidad, precio_base, categoria, estado, fecha_creacion)
            VALUES (?, ?, ?, ?, ?, ?, 'Activo', ?)`,
      args: [slug, nombre, nombre, 'cartones', precio, cat, new Date().toISOString()],
    });
  }

  const testDb = drizzle(client, { schema });
  const mod = await import('../server');
  const app = await mod.createApp(true, testDb);
  const request = (await import('supertest')).default;

  const semillas: { paso: string; status: number }[] = [];
  /** Registra cada escritura con su ruta, para que un 500 en la siembra sea rastreable. */
  const sembrar = (paso: string, status: number) => {
    semillas.push({ paso, status });
  };

  /** Escrituras tolerantes: la siembra no debe romperse si un contrato cambia. */
  const post = async (url: string, body: unknown) => {
    const r = await request(app).post(url).set('x-user-id', ADMIN).send(body as object);
    sembrar(`POST ${url}`, r.status);
    if (r.status >= 400) {
      console.log(`  [semilla] POST ${url} -> ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    }
    return r;
  };
  const put = async (url: string, body: unknown) => {
    const r = await request(app).put(url).set('x-user-id', ADMIN).send(body as object);
    sembrar(`PUT ${url}`, r.status);
    return r;
  };
  const get = async (url: string) => {
    const r = await request(app).get(url).set('x-user-id', ADMIN);
    return { status: r.status, body: r.body };
  };

  // --- Granja, galerón, aves, lote ------------------------------------------------
  const wiz = await post('/api/granjas/wizard', {
    nombre: 'Granja El Alto',
    ubicacion: 'Alajuela, CR',
    tipo_produccion: 'Posture',
    encargadoId: 'u-enc',
    galerones: [
      { nombre: 'Galerón Núcleo', capacidad_maxima: 6000 },
      { nombre: 'Galerón 2', capacidad_maxima: 4000 },
    ],
  });

  const granjaId = (await get('/api/granjas')).body.find((g: any) => g.nombre === 'Granja El Alto')?.id;
  const galerones = (await get('/api/galerones')).body.filter((g: any) => g.granjaId === granjaId);
  const galeronId = galerones[0]?.id;
  if (galeronId) await put(`/api/galerones/${galeronId}`, { aves_en_produccion: 4500 });
  if (galeronId) {
    await post('/api/lotes', {
      galeronId, fecha_ingreso: new Date().toISOString(),
      cantidad_inicial: 4500, linea_genetica: 'ISA Brown', estado: 'Activo',
    });
  }

  // --- Ruta, clientes, camión ----------------------------------------------------
  await post('/api/rutas', { nombre: 'Ruta Norte', vendedor_asignado: 'u-ven' });
  const rutaId = (await get('/api/rutas')).body.find((r: any) => r.nombre === 'Ruta Norte')?.id;

  await post('/api/clientes', { nombre: 'Pulpería El Ángel', ruta: 'Ruta Norte', condicion_pago: 'Contado' });
  await post('/api/clientes', {
    nombre: 'Supermercado Don Pepito', ruta: 'Ruta Norte',
    condicion_pago: 'Credito', limite_credito: 1_000_000,
  });

  const camion = await post('/api/logistica/camiones', {
    nombre: 'Camión 9', placa: 'CR-009', ruta_defecto: 'Ruta Norte',
    vendedor_id: 'u-ven', capacidad_cartones: 300,
  });

  // --- Inventario y etiquetas ----------------------------------------------------
  // No existe `POST /api/inventario/ingreso`: el stock entra por
  // `/api/bodega/ingreso-manual`, que exige observación por auditoría.
  await post('/api/bodega/ingreso-manual', {
    producto: 'Huevos - Grande', cantidad: 800, unidad: 'cartones',
    procedencia: 'Granja El Alto', observaciones: 'Stock inicial de la partida',
    usuarioId: ADMIN,
  });
  await post('/api/etiquetas/generar-lote', {
    etiquetas: Array.from({ length: 24 }, (_, i) => ({
      producto: 'Huevos - Grande', cantidad: 30,
      pesoBruto: 15, pesoNeto: 14.2,
      granjaOrigen: 'Granja El Alto', galeronOrigen: 'Galerón Núcleo',
      ubicacion: 'Granja',
      lote: `L-${i + 1}`,
    })),
  });

  // --- Producción y traslado -----------------------------------------------------
  // `galeron` es el NOMBRE del galerón, no su id, y la búsqueda no se filtra por
  // granja: dos granjas con un galerón homónimo se pisarían. Se anota como
  // hallazgo; aquí el dataset tiene un solo "Galerón Núcleo".
  await post('/api/produccion/recoleccion', {
    galeron: 'Galerón Núcleo',
    detalles: [{ producto: 'Huevos - Grande', cantidad: 60 }],
  });
  await post('/api/operaciones/traslado', {
    producto: 'Huevos - Grande', cantidad: 40, origen: 'Galerón Núcleo', destino: 'Bodega Central',
  });

  // --- Facturación, pago, gasto --------------------------------------------------
  // No existe `POST /api/facturas`: las facturas nacen de `POST /api/ventas`, que
  // recibe `{ factura, detalles }`. `detalles` va en snake_case y los totales los
  // manda el cliente (`factura.subtotal` / `factura.total`), no el servidor: solo
  // se recalculan si el backend autoaplicó un precio de lista.
  const clientes = (await get('/api/clientes')).body as any[];
  const pepito = clientes.find(c => c.nombre === 'Supermercado Don Pepito');
  const angel = clientes.find(c => c.nombre === 'Pulpería El Ángel');

  const venta = (clienteId: string, fecha: string, condicion: string, producto: string, cantidad: number, precio: number) =>
    post('/api/ventas', {
      factura: {
        clienteId, fecha, condicion_pago: condicion, metodo_pago: condicion === 'Contado' ? 'Efectivo' : null,
        subtotal: cantidad * precio, descuento: 0, total: cantidad * precio, estado: 'Pendiente',
      },
      detalles: [{ producto, cantidad, precio_unitario: precio, subtotal: cantidad * precio }],
    });

  await venta(pepito?.id, AYER, 'Credito', 'Huevos - Grande', 30, 16000);
  await venta(angel?.id, HOY, 'Contado', 'Huevos - Chico', 12, 13500);
  const facturas = (await get('/api/facturas')).body as any[];
  const fCredito = facturas.find(f => f.estado !== 'Anulada');
  if (fCredito) {
    await post('/api/pagos', {
      facturaId: fCredito.id, monto: Math.round(Number(fCredito.total) / 2),
      fecha: HOY, metodo: 'Efectivo',
    });
  }
  await post('/api/gastos', {
    categoria: 'Diésel', monto: 45000, descripcion: 'Peaje ruta 27', usuarioId: ADMIN, fecha: HOY,
  });
  await post('/api/gastos', {
    categoria: 'Planilla', monto: 900000, descripcion: 'Quincena', usuarioId: ADMIN, fecha: AYER,
  });

  // --- Vacunación, mantenimiento, peso -------------------------------------------
  await post('/api/vacunaciones', {
    granjaId, galeronId, tipoVacuna: 'Newcastle', proveedor: 'Vecinal',
    dosis: '1ml', metodoAplicacion: 'Inyección', fechaProgramada: HACE_5,
    responsable: 'Encargado', observaciones: 'Segunda dosis del lote',
  });
  // Una orden de mantenimiento exige un `activoId` de `activos_mantenimiento`, no
  // un galerón: la FK es a la tabla de activos.
  const activo = await post('/api/activos', {
    nombre: 'Bebedero línea 1', tipo: 'Bebedero', granjaId, galeronId,
    ubicacion: 'Galerón Núcleo', responsable: 'Encargado',
  });
  // `checklist` e `insumosUsados` se insertan crudo en una columna TEXT: un array
  // no se puede enlazar en SQLite y revienta con 500 en vez de un 400 de validación.
  // Es un hallazgo, no una decisión de diseño; aquí se mandan serializados.
  await post('/api/ordenes-mantenimiento', {
    activoId: activo.body?.id, tipo: 'Correctivo', fechaProgramada: HOY,
    responsable: 'Encargado', costo: 45000,
    observaciones: 'Fuga en la línea 1',
    checklist: JSON.stringify([{ item: 'Revisar válvula', ok: false }, { item: 'Reemplazar empaque', ok: false }]),
  });
  await post('/api/pesos/registrar', {
    referenciaId: camion.body?.id, tipoReferencia: 'Camion', producto: 'Huevos - Grande',
    cantidadUnidades: 60, unidad: 'cartones', pesoEsperado: 900, pesoReal: 915,
    basculaUtilizada: 'Báscula 1', responsable: 'Bodeguero', ubicacion: 'Bodega Central',
  });

  // --- Guías de despacho ---------------------------------------------------------
  // Necesitan camión + etiquetas, y las etiquetas tienen que estar `EnBodega`: una
  // etiqueta recién generada está en `Generada` y el endpoint la rechaza con un 400
  // que no explica que primero hay que receptar. El escaneo es lo que la mueve.
  const etiquetasGeneradas = (await get('/api/etiquetas')).body as any[];
  const aCargar = etiquetasGeneradas.filter(e => e.estado === 'Generada').slice(0, 9);
  for (const e of aCargar) {
    await post('/api/etiquetas/escanear', {
      codigoUnico: e.codigoUnico, nuevoEstado: 'EnBodega', ubicacion: 'Bodega Central',
    });
  }
  const guia = await post('/api/logistica/guias', {
    camionId: camion.body?.id, rutaId,
    etiquetasIds: aCargar.map(e => e.id), responsablesCarga: 'Bodeguero',
    responsableTransporte: 'Camionero', pesoSalida: 915,
  });

  // --- Catálogos que las vistas muestrean ----------------------------------------
  await post('/api/tipos-carton', { nombre: 'Cartón de 30 huevos', unidades: 30 });
  await post('/api/tipos-carton', { nombre: 'Cartón de 12 huevos', unidades: 12 });

  const lista = await post('/api/precios/listas', {
    nombre: 'Lista Ruta Norte 2026', tipo: 'Ruta', rutaAsociada: rutaId,
    aprobadoPor: ADMIN, fechaFin: HOY,
  });
  if (lista.body?.id) {
    await post('/api/precios/detalle', {
      listaId: lista.body.id, producto: 'Huevos - Grande', precioUnitario: 16000,
      descuentoMaximo: 5, unidad: 'cartones',
    });
    await post('/api/precios/detalle', {
      listaId: lista.body.id, producto: 'Huevos - Chico', precioUnitario: 13500,
      descuentoMaximo: 0, unidad: 'cartones',
    });
  }

  // --- Mantenimiento, salud avícola, incidentes, alimento, desperdicio -----------
  await post('/api/mantenimientos', {
    galeronId, fecha: HACE_5, tipo: 'Correctivo', descripcion: 'Cambio de cama', estado: 'Pendiente',
  });
  await post('/api/incidentes', {
    granjaId, galeronId, categoria: 'Mortalidad', severidad: 'Alta',
    descripcion: 'Aumento de mortalidad en el sector 3 del galerón',
    cantidadAfectada: 24, causaProbable: 'Estrés térmico',
    reportadoPorId: ADMIN, reportadoPorNombre: 'Administrador',
  });
  const alimento = await post('/api/alimento', {
    tipoAlimento: 'Alimento balanceado', proveedor: 'Nutrimental',
    loteAlimento: 'AL-001', siloUbicacion: 'Silo 1', cantidadRecibida: 40,
    unidad: 'sacos', galeronAsociado: galeronId, responsable: 'Bodeguero',
  });
  if (galeronId) {
    await post('/api/alimento/consumo', {
      inventarioAlimentoId: alimento.body?.id, galeronId,
      cantidadConsumida: 3, unidad: 'sacos', responsable: 'Encargado',
      observaciones: 'Ración de la mañana',
    });
  }
  await post('/api/desperdicios', {
    origen: 'Granja', producto: 'Huevos - Grande', cantidad: 6, peso: 85,
    motivo: 'Quebrado Granja', responsable: 'Encargado',
    impactoFinanciero: 96000, observaciones: 'Cajones mojados en el galerón',
  });

  // --- Captura --------------------------------------------------------------------
  const fixtures: Record<string, { status: number; body: unknown }> = {};
  for (const url of ENDPOINTS) {
    fixtures[url] = await get(url);
  }

  // Las rutas con `:param` se resuelven contra los ids que dejó la siembra.
  const etiquetas = (await get('/api/etiquetas')).body as any[];
  const reales: Record<string, string | undefined> = {
    granjaId,
    clienteId: pepito?.id,
    codigo: etiquetas[0]?.codigoUnico,
  };
  for (const { patron, etiqueta } of ENDPOINTS_PARAM) {
    const url = patron.replace(/\{(\w+)\}/g, (_, k: string) => String(reales[k] ?? 'inexistente'));
    fixtures[etiqueta] = await get(url);
  }

  const nombres = (await get('/api/precios/listas')).body as any[];
  const listaPrecios = (nombres[0]?.id ?? lista.body?.id);
  if (listaPrecios) {
    fixtures['precio-detalle'] = await get(`/api/precios/detalle/${listaPrecios}`);
  }
  const hilos = (await get('/api/office/mensajes')).body as any[];
  if (hilos[0]?.threadId ?? hilos[0]?.id) {
    fixtures['office-thread'] = await get(`/api/office/mensajes/${hilos[0].threadId ?? hilos[0].id}`);
  }

  const out = {
    _generatedAt: new Date().toISOString(),
    _nota:
      'Generado por scripts/generar-fixtures-vistas.ts contra el servidor real sobre un dataset sembrado. ' +
      'Las respuestas son literales: si un endpoint cambia de forma, regenerar y revisar el diff es parte del cambio.',
    _semilla: semillas,
    endpoints: fixtures,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

  const conError = Object.entries(fixtures).filter(([, v]) => v.status >= 400);
  console.log(`fixtures escritos: ${Object.keys(fixtures).length} endpoints -> ${path.relative(process.cwd(), OUT)}`);
  console.log(`semilla: ${semillas.length} pasos`);
  const fallos = semillas.filter(s => s.status >= 400);
  if (fallos.length) {
    console.log('\nPASOS DE SIEMBRA QUE NO ESPERABAN (revisar dataset):');
    fallos.forEach(f => console.log(`  ${f.paso} -> ${f.status}`));
  }
  if (conError.length) {
    console.log('\nENDPOINTS QUE RESPONDIERON 4xx/5xx (esto NO es bug del endpoint: es que el fixture necesita datos o permisos):');
    conError.forEach(([u, v]) => console.log(`  ${u} -> ${v.status}`));
  }

  const cov = cobertura();
  // La lista cubre lo que las vistas piden al montar. Por eso lo que sale aquí suele
  // ser un GET condicional (abrir un detalle, elegir una lista de precios, cambiar una
  // fecha) o un resto de una fase anterior, y no un fallo. Se imprime para que la
  // diferencia sea una decisión tomada y no un olvido.
  if (cov.faltan.length) {
    console.log('\nGET QUE LAS VISTAS PIDEN Y NO ESTÁN EN LA LISTA (¿condicional?):');
    cov.faltan.forEach(u => console.log(`  ${u}`));
  }
  if (cov.sobran.length) {
    console.log('\nEN LA LISTA PERO QUE NINGUNA VISTA PIDE (suelen ser restos):');
    cov.sobran.forEach(u => console.log(`  ${u}`));
  }
  if (!cov.faltan.length && !cov.sobran.length) {
    console.log('cobertura: la lista y las vistas coinciden');
  }

  try { client.close(); } catch {}
  // El archivo suele quedar tomado por el cliente libsql hasta que el proceso baja.
  // `.test-*.db` está en `.gitignore`, así que dejarlo no ensucia el repo; fallar
  // aquí solo convertiría un warning en un exit code 1.
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch { /* EBUSY: se limpia en la próxima corrida */ }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
