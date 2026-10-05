import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/db/schema';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import { ejecutarDdl, desactivarFks, abrirClienteDePrueba } from './helpers/db';

let app: Express;
const DB_PATH = path.resolve(process.cwd(), '.test-e2e.db');


beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['1', 'Administrador', 'admin@e2e.com', 'Admin'] });
  await client.execute({ sql: `INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)`, args: ['vendedor-e2e', 'Vendedor E2E', 'vendedor@e2e.com', 'Comercial'] });
  const testDb = drizzle(client, { schema });

  const mod = await import('../server');
  app = await mod.createApp(true, testDb);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch {}
});

describe('E2E — Cadena de Custodia', () => {
  let granjaId: string;
  let galeronId: string;
  let clienteId: string;

  it('1.1 — Crear granja y galerón', async () => {
    const res = await request(app)
      .post('/api/granjas/wizard')
      .send({
        nombre: 'Granja E2E',
        ubicacion: 'San José, CR',
        tipo_produccion: 'Postura',
        encargadoId: 'enc-001',
        galerones: [{ nombre: 'Galerón E2E-1', capacidad_maxima: 5000 }]
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const granjas = (await request(app).get('/api/granjas')).body;
    expect(Array.isArray(granjas)).toBe(true);
    const g = granjas.find((x: any) => x.nombre === 'Granja E2E');
    expect(g).toBeDefined();
    granjaId = g.id;

    const galerones = (await request(app).get('/api/galerones')).body;
    expect(Array.isArray(galerones)).toBe(true);
    const gal = galerones.find((x: any) => x.granjaId === granjaId);
    expect(gal).toBeDefined();
    galeronId = gal.id;
  });

  it('1.2 — Crear lote activo', async () => {
    const res = await request(app)
      .post('/api/lotes')
      .send({
        galeronId,
        fecha_ingreso: new Date().toISOString(),
        cantidad_inicial: 4500,
        linea_genetica: 'Hy-Line Brown',
        estado: 'Activo'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const lotes = (await request(app).get('/api/lotes')).body;
    const lote = lotes.find((l: any) => l.galeronId === galeronId);
    expect(lote).toBeDefined();
    expect(lote.cantidad_inicial).toBe(4500);
  });

  it('1.3 — Crear cliente y ruta', async () => {
    const clienteRes = await request(app)
      .post('/api/clientes')
      .send({
        nombre: 'Pulpería E2E',
        ruta: 'Ruta E2E',
        condicion_pago: 'Contado',
        precio_especial: 1500
      });
    expect(clienteRes.status).toBe(201);
    clienteId = clienteRes.body.id;

    const rutaRes = await request(app)
      .post('/api/rutas')
      .send({ nombre: 'Ruta E2E', vendedor_asignado: 'Vendedor E2E' });
    expect(rutaRes.status).toBe(201);
  });

  it('2.1 — Recolección de huevos en galerón', async () => {
    const res = await request(app)
      .post('/api/produccion/recoleccion')
      .send({
        galeron: 'Galerón E2E-1',
        detalles: [
          { tamano: 'Grande', cantidad: 100 },
          { tamano: 'Mediano', cantidad: 50 },
          { tamano: 'Gallinaza', cantidad: 5 }
        ]
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const inv = (await request(app).get('/api/inventario')).body;
    const hg = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja');
    expect(hg).toBeDefined();
    expect(hg.cantidad).toBe(100);

    const movimientos = (await request(app).get('/api/inventario/movimientos')).body;
    expect(movimientos.some((m: any) => m.tipo === 'Entrada Producción')).toBe(true);
  });

  it('2.2 — Traslado de Granja a Bodega', async () => {
    const res = await request(app)
      .post('/api/operaciones/traslado')
      .send({
        granjaId,
        producto: 'Huevos - Grande',
        cantidad: 80,
        unidad: 'cartones',
        responsable: 'Operario E2E'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const inv = (await request(app).get('/api/inventario')).body;
    const hg = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Granja');
    expect(hg.cantidad).toBe(20);

    const movimientos = (await request(app).get('/api/inventario/movimientos')).body;
    const t = movimientos.find((m: any) => m.tipo === 'Traslado' && m.producto === 'Huevos - Grande');
    expect(t).toBeDefined();
    expect(t.cantidad).toBe(80);
  });

  it('2.3 — Recepción en Bodega con diferencia', async () => {
    const movimientos = (await request(app).get('/api/inventario/movimientos')).body;
    const t = movimientos.find((m: any) => m.tipo === 'Traslado' && m.producto === 'Huevos - Grande');
    expect(t).toBeDefined();

    const res = await request(app)
      .post('/api/operaciones/recepcion')
      .send({
        trasladoId: t.referencia_id,
        cantidadEsperada: 80,
        cantidadRecibida: 78,
        motivoDiferencia: '2 cartones dañados',
        producto: 'Huevos - Grande'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const inv = (await request(app).get('/api/inventario')).body;
    const hb = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central');
    expect(hb).toBeDefined();
    expect(hb.cantidad).toBe(78);
  });

  it('3.1 — Cargar camión desde Bodega', async () => {
    const res = await request(app)
      .post('/api/logistica/cargar-camion')
      .send({
        rutaId: null,
        camionNombre: 'Camión Ruta 1',
        producto: 'Huevos - Grande',
        cantidad: 50,
        responsable: 'Bodeguero E2E'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const inv = (await request(app).get('/api/inventario')).body;
    const hb = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central');
    expect(hb.cantidad).toBe(28);

    const hc = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión Ruta 1');
    expect(hc).toBeDefined();
    expect(hc.cantidad).toBe(50);
  });

  it('3.2 — Facturar venta desde camión', async () => {
    const res = await request(app)
      .post('/api/ventas')
      .set('x-user-id', '1')
      .send({
        factura: {
          id: crypto.randomUUID(),
          consecutivo: 'E2E-001',
          fecha: new Date().toISOString(),
          clienteId,
          vendedorId: 'vendedor-e2e',
          subtotal: 75000,
          descuento: 0,
          total: 82500,
          condicion_pago: 'Contado',
          metodo_pago: 'Efectivo',
          estado: 'Pagada'
        },
        detalles: [
          { producto: 'Huevos - Grande', cantidad: 30, precio_unitario: 2500, subtotal: 75000 }
        ]
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const inv = (await request(app).get('/api/inventario')).body;
    const hc = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión Ruta 1');
    expect(hc.cantidad).toBe(20);
  });

  it('3.3 — Cierre de ruta con conciliación', async () => {
    const res = await request(app)
      .post('/api/logistica/cierre-ruta')
      .send({
        camionNombre: 'Camión Ruta 1',
        responsable: 'Admin E2E'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalCargado).toBe(50);
    expect(res.body.totalVendido).toBe(30);
    expect(res.body.totalRestante).toBe(20);
    expect(res.body.merma).toBe(0);
    expect(res.body.estado).toBe('Cuadrado');

    const inv = (await request(app).get('/api/inventario')).body;
    const hc = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Camión Ruta 1');
    expect(hc.cantidad).toBe(0);

    const hb = inv.find((i: any) => i.producto === 'Huevos - Grande' && i.ubicacion === 'Bodega Central');
    expect(hb.cantidad).toBe(48);
  });

  it('4.1 — Auditoría de ruta', async () => {
    const res = await request(app)
      .get('/api/logistica/auditoria?ruta=Camión Ruta 1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('facturas');
    expect(res.body).toHaveProperty('totalCargado');
  });

  it('4.2 — Kárdex registra toda la cadena', async () => {
    const movimientos = (await request(app).get('/api/inventario/movimientos')).body;
    expect(Array.isArray(movimientos)).toBe(true);
    const tipos = [...new Set(movimientos.map((m: any) => m.tipo))];
    expect(tipos).toContain('Entrada Producción');
    expect(tipos).toContain('Traslado');
    expect(tipos).toContain('Recepción Bodega');
    expect(tipos).toContain('Carga Camión');
    expect(tipos).toContain('Retorno Camión');
  });
});

describe('Phase 3 — Facturación Electrónica, Etiquetas y Pesos', () => {
  let facturaId: string;
  let clienteId: string;
  let documentoFEId: string;
  let etiquetaCodigo: string;

  it('5.1 — Crear cliente para facturación', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .send({ nombre: 'Cliente FE Test', ruta: 'Ruta 1', condicion_pago: 'Contado' });
    expect(res.status).toBe(201);
    clienteId = res.body.id;
  });

  it('5.2 — Crear factura para documento electrónico', async () => {
    // Insert factura directly (bypass inventory check which is Phase 1 concern)
    const client = abrirClienteDePrueba(`file:${DB_PATH}`);
    desactivarFks(client);
    facturaId = crypto.randomUUID();
    await client.execute({
      sql: `INSERT INTO facturas (id, consecutivo, fecha, cliente_id, vendedor_id, subtotal, descuento, total, condicion_pago, metodo_pago, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [facturaId, 'FAC-FE-001', new Date().toISOString(), clienteId, '1', 50000, 0, 50000, 'Contado', 'Efectivo', 'Pagada']
    });

    const facturas = (await request(app).get('/api/facturas')).body;
    expect(facturas.some((f: any) => f.id === facturaId)).toBe(true);
  });

  it('5.3 — Crear documento fiscal electrónico', async () => {
    const res = await request(app)
      .post('/api/facturacion/crear-documento')
      .set('x-user-id', '1')
      .send({
        facturaId,
        tipoDocumento: 'Factura',
        emisorNombre: 'Granja Don Paco',
        emisorCedula: '3-101-123456',
        emisorCorreo: 'test@granjadonpaco.com',
        receptorNombre: 'Cliente FE Test',
        receptorCedula: '1-234-567890',
        condicionPago: 'Contado',
        ambiente: 'Pruebas'
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.consecutivo).toContain('FE');
    documentoFEId = res.body.id;
  });

  it('5.4 — Generar XML del documento', async () => {
    const res = await request(app)
      .post('/api/facturacion/generar-xml')
      .set('x-user-id', '1')
      .send({ documentoId: documentoFEId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.xml).toContain('FacturaElectronica');
    expect(res.body.xml).toContain('Granja Don Paco');

    const doc = (await request(app).get('/api/facturacion/documentos')).body.find((d: any) => d.id === documentoFEId);
    expect(doc.estado).toBe('Pendiente');
  });

  it('5.5 — Enviar a Hacienda (simulado)', async () => {
    const res = await request(app)
      .post('/api/facturacion/enviar')
      .set('x-user-id', '1')
      .send({ documentoId: documentoFEId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const doc = (await request(app).get('/api/facturacion/documentos')).body.find((d: any) => d.id === documentoFEId);
    expect(doc.estado).toBe('Enviado');
  });

  it('5.6 — Consultar estado en Hacienda', async () => {
    const res = await request(app)
      .post('/api/facturacion/consultar-estado')
      .set('x-user-id', '1')
      .send({ documentoId: documentoFEId });
    expect(res.status).toBe(200);
    expect(['Aceptado', 'Rechazado']).toContain(res.body.estado);
  });

  it('5.7 — Generar etiqueta individual', async () => {
    const res = await request(app)
      .post('/api/etiquetas/generar')
      .send({
        producto: 'Huevos - Grande',
        cantidad: 30,
        pesoBruto: 18.5,
        pesoNeto: 17.0,
        granjaOrigen: 'Granja Principal',
        clasificacion: 'Grado A',
        lote: 'L-20260817',
        ubicacion: 'Granja'
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.codigoUnico).toContain('ETQ-');
    etiquetaCodigo = res.body.codigoUnico;
  });

  it('5.8 — Generar lote de etiquetas', async () => {
    const res = await request(app)
      .post('/api/etiquetas/generar-lote')
      .send({
        etiquetas: [
          { producto: 'Huevos - Mediano', cantidad: 30, pesoBruto: 16, pesoNeto: 14.5, ubicacion: 'Granja' },
          { producto: 'Huevos - Grande', cantidad: 30, pesoBruto: 18, pesoNeto: 16.5, ubicacion: 'Granja' }
        ]
      });
    expect(res.status).toBe(201);
    expect(res.body.etiquetas).toHaveLength(2);
  });

  it('5.9 — Escanear y cambiar estado de etiqueta', async () => {
    const res = await request(app)
      .post('/api/etiquetas/escanear')
      .send({ codigoUnico: etiquetaCodigo, nuevoEstado: 'EnBodega', ubicacion: 'Bodega Central' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const etiquetas = (await request(app).get('/api/etiquetas')).body;
    const eq = etiquetas.find((e: any) => e.codigoUnico === etiquetaCodigo);
    expect(eq.estado).toBe('EnBodega');
    expect(eq.ubicacionActual).toBe('Bodega Central');
  });

  it('5.10 — Consultar trazabilidad de etiqueta', async () => {
    const res = await request(app)
      .get(`/api/etiquetas/trazabilidad/${encodeURIComponent(etiquetaCodigo)}`);
    expect(res.status).toBe(200);
    expect(res.body.etiqueta).toBeDefined();
    expect(res.body.etiqueta.codigoUnico).toBe(etiquetaCodigo);
    expect(Array.isArray(res.body.pesos)).toBe(true);
  });

  it('5.11 — Registrar peso en punto de custodia', async () => {
    const res = await request(app)
      .post('/api/pesos/registrar')
      .send({
        tipoReferencia: 'Traslado',
        producto: 'Huevos - Grande',
        cantidadUnidades: 30,
        unidad: 'cartones',
        pesoEsperado: 18.0,
        pesoReal: 18.2,
        basculaUtilizada: 'Báscula #1',
        responsable: 'Operario Test',
        ubicacion: 'Granja'
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.estado).toBe('Conforme');
  });

  it('5.12 — Registrar peso con diferencia significativa', async () => {
    const res = await request(app)
      .post('/api/pesos/registrar')
      .send({
        tipoReferencia: 'Recepcion',
        producto: 'Huevos - Grande',
        cantidadUnidades: 30,
        unidad: 'cartones',
        pesoEsperado: 18.0,
        pesoReal: 16.0,
        responsable: 'Bodeguero Test',
        ubicacion: 'Bodega Central'
      });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ConDiferencia');
  });

  it('5.13 — Consultar trazabilidad de pesos', async () => {
    const res = await request(app)
      .get('/api/pesos/trazabilidad?producto=Huevos - Grande');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pesos)).toBe(true);
    expect(res.body.resumen).toHaveProperty('totalEsperado');
    expect(res.body.resumen).toHaveProperty('totalReal');
  });

  it('5.14 — Conciliación de pesos del día', async () => {
    const res = await request(app)
      .get('/api/pesos/conciliacion');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('porUbicacion');
    expect(res.body.totalRegistros).toBeGreaterThanOrEqual(2);
  });

  it('5.15 — Nota de crédito', async () => {
    const res = await request(app)
      .post('/api/facturacion/nota-credito')
      .set('x-user-id', '1')
      .send({
        facturaIdOriginal: facturaId,
        motivo: 'Producto defectuoso',
        monto: 10000,
        emisorNombre: 'Granja Don Paco',
        emisorCedula: '3-101-123456'
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.consecutivo).toContain('NC');
  });

  it('5.16 — Listar documentos electrónicos', async () => {
    const res = await request(app)
      .get('/api/facturacion/documentos');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2); // Factura + NC
  });
});

describe('Phase 4 — Salud Avícola, Alimento, Mantenimiento, Desperdicios, Precios, Dashboard', () => {
  let granjaId = '';
  let galeronId = '';
  let activoId = '';
  let listaId = '';

  it('6.1 — Crear granja para salud avícola', async () => {
    const res = await request(app)
      .post('/api/granjas')
      .send({ nombre: 'Granja Salud', ubicacion: 'Cartago', encargadoId: 'enc-001' });
    expect(res.status).toBe(200);
    const granjas = (await request(app).get('/api/granjas')).body;
    granjaId = granjas[granjas.length - 1].id;
  });

  it('6.2 — Crear galerón para vacunación', async () => {
    const res = await request(app)
      .post('/api/galerones')
      .send({ granjaId, nombre: 'Galerón Vacunas', capacidad_maxima: 5000 });
    expect(res.status).toBe(200);
    const galerones = (await request(app).get('/api/galerones')).body;
    galeronId = galerones[galerones.length - 1].id;
  });

  it('6.3 — Programar vacunación', async () => {
    const res = await request(app)
      .post('/api/vacunaciones')
      .send({
        granjaId, galeronId, tipoVacuna: 'Newcastle', proveedor: 'Lab Vet CR',
        dosis: '1ml', metodoAplicacion: 'Inyectable',
        fechaProgramada: new Date().toISOString().split('T')[0],
        responsable: 'Dr. Avícola', observaciones: 'Dosis única'
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('6.4 — Consultar alertas de vacunación', async () => {
    const res = await request(app).get('/api/vacunaciones/alertas');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vencidas');
    expect(res.body).toHaveProperty('proximas');
  });

  it('6.5 — Registrar alimento en silo', async () => {
    const res = await request(app)
      .post('/api/alimento')
      .send({
        tipoAlimento: 'Producción', proveedor: 'Alimentos CR',
        loteAlimento: 'ALM-001', siloUbicacion: 'Silo 1',
        cantidadRecibida: 5000, unidad: 'kg', responsable: 'Bodeguero'
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('6.6 — Registrar consumo de alimento', async () => {
    const alimento = (await request(app).get('/api/alimento')).body;
    const alimentoId = alimento[alimento.length - 1]?.id;
    const res = await request(app)
      .post('/api/alimento/consumo')
      .send({
        inventarioAlimentoId: alimentoId, galeronId,
        cantidadConsumida: 200, unidad: 'kg', responsable: 'Encargado'
      });
    expect(res.status).toBe(201);
  });

  it('6.7 — Alertas de bajo inventario', async () => {
    const res = await request(app).get('/api/alimento/alertas');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bajoInventario');
  });

  it('6.8 — Crear activo de mantenimiento', async () => {
    const res = await request(app)
      .post('/api/activos')
      .send({ nombre: 'Ventilador Galpón 1', tipo: 'Ventilación', granjaId, ubicacion: 'Galerón Vacunas', responsable: 'Técnico' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const activos = (await request(app).get('/api/activos')).body;
    activoId = activos[activos.length - 1].id;
  });

  it('6.9 — Crear orden de mantenimiento', async () => {
    const res = await request(app)
      .post('/api/ordenes-mantenimiento')
      .send({
        activoId, tipo: 'Preventivo',
        fechaProgramada: new Date().toISOString().split('T')[0],
        responsable: 'Técnico', costo: 25000, observaciones: 'Cambio de rodamientos'
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('6.10 — Alertas de mantenimiento', async () => {
    const res = await request(app).get('/api/ordenes-mantenimiento/alertas');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vencidas');
    expect(res.body).toHaveProperty('proximas');
  });

  it('6.11 — Registrar desperdicio', async () => {
    const res = await request(app)
      .post('/api/desperdicios')
      .send({
        origen: 'Granja', producto: 'Huevos - Grande', cantidad: 15,
        motivo: 'Quebrado Granja', responsable: 'Operario',
        impactoFinanciero: 30000, observaciones: 'Caja dañada'
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('6.12 — Resumen de desperdicios', async () => {
    const res = await request(app).get('/api/desperdicios/resumen');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('porOrigen');
    expect(res.body).toHaveProperty('impactoTotal');
  });

  it('6.13 — Crear lista de precios', async () => {
    const res = await request(app)
      .post('/api/precios/listas')
      .send({ nombre: 'Lista General', tipo: 'Global', aprobadoPor: 'Admin' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const listas = (await request(app).get('/api/precios/listas')).body;
    listaId = listas[listas.length - 1].id;
  });

  it('6.14 — Agregar precio a lista', async () => {
    const res = await request(app)
      .post('/api/precios/detalle')
      .send({ listaId, producto: 'Huevos - Grande', precioUnitario: 2500, descuentoMaximo: 5 });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('6.15 — Cambiar precio con historial', async () => {
    const res = await request(app)
      .post('/api/precios/cambiar')
      .send({ listaId, producto: 'Huevos - Grande', precioNuevo: 2800, cambioPor: 'Admin', motivo: 'Ajuste trimestral' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const historial = (await request(app).get('/api/precios/historial')).body;
    expect(historial.length).toBeGreaterThanOrEqual(1);
  });

  it('6.16 — Dashboard enterprise retorna KPIs', async () => {
    const res = await request(app).get('/api/dashboard/enterprise');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ingresosHoy');
    expect(res.body).toHaveProperty('cartonesProducidos');
    expect(res.body).toHaveProperty('totalAvesVivas');
    expect(res.body).toHaveProperty('alertas');
    expect(Array.isArray(res.body.alertas)).toBe(true);
  });

  it('6.17 — Auditoría registrar evento', async () => {
    const res = await request(app)
      .post('/api/auditoria')
      .send({ usuarioId: 'admin-001', accion: 'Crear', modulo: 'Vacunación', motivo: 'Nueva vacunación programada' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const auditoria = (await request(app).get('/api/auditoria')).body;
    expect(auditoria.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 5 — Aprobaciones, Precios Automáticos, Crédito, Reportes, Roles', () => {
  let clientId = '';
  let listaId = '';

  it('7.1 — Crear cliente para prueba de crédito', async () => {
    const res = await request(app)
      .post('/api/clientes')
      .send({ nombre: 'Cliente Crédito Test', ruta: 'Ruta 1', condicion_pago: 'Credito', limite_credito: 100000 });
    expect(res.status).toBe(201);
    clientId = res.body.id;
  });

  it('7.2 — Venta excede límite de crédito → requiere aprobación', async () => {
    const res = await request(app).post('/api/ventas').set('x-user-id', '1').send({
      factura: { id: crypto.randomUUID(), consecutivo: 'FAC-CREDITO-001', fecha: new Date().toISOString(), clienteId: clientId, vendedorId: '1', subtotal: 150000, descuento: 0, total: 150000, condicion_pago: 'Credito', estado: 'Pendiente' },
      detalles: [{ producto: 'Huevos - Grande', cantidad: 60, precio_unitario: 2500, subtotal: 150000 }]
    });
    expect(res.status).toBe(400);
    expect(res.body.requiereAprobacion).toBe(true);
  });

  it('7.3 — Crear solicitud de aprobación', async () => {
    const res = await request(app)
      .post('/api/aprobaciones')
      .send({
        tipo: 'DescuentoNoAutorizado', modulo: 'Ventas', solicitudUsuario: 'vendedor-001',
        descripcion: 'Cliente excede límite de crédito por ₡50,000', datos: { clienteId: clientId, monto: 150000, limite: 100000 }
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('7.4 — Verificar aprobaciones pendientes', async () => {
    const res = await request(app).get('/api/aprobaciones/pendientes');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it('7.5 — Aprobar solicitud', async () => {
    const pendientes = (await request(app).get('/api/aprobaciones/pendientes')).body.items;
    const aprobId = pendientes[pendientes.length - 1].id;
    const res = await request(app)
      .put(`/api/aprobaciones/${aprobId}`)
      .send({ estado: 'Aprobado', aprobadoPor: 'admin-001' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('7.6 — Crear lista de precios y verificar lookup', async () => {
    const listaRes = await request(app).post('/api/precios/listas').send({ nombre: 'Lista Global Test', tipo: 'Global' });
    expect(listaRes.status).toBe(201);
    listaId = listaRes.body.id;

    await request(app).post('/api/precios/detalle').send({ listaId, producto: 'Huevos - Especial TEST', precioUnitario: 2500 });
    await request(app).post('/api/precios/detalle').send({ listaId, producto: 'Huevos - Mini TEST', precioUnitario: 2200 });

    const res = await request(app).get('/api/precios/lookup?producto=Huevos - Especial TEST');
    expect(res.status).toBe(200);
    expect(res.body.precio).toBe(2500);
    expect(res.body.listaUsada).toBe('Lista Global Test');
  });

  it('7.7 — Lookup múltiple precios', async () => {
    const res = await request(app)
      .post('/api/precios/lookup-multiple')
      .send({ productos: ['Huevos - Especial TEST', 'Huevos - Mini TEST'] });
    expect(res.status).toBe(200);
    expect(res.body['Huevos - Especial TEST'].precio).toBe(2500);
    expect(res.body['Huevos - Mini TEST'].precio).toBe(2200);
  });

  it('7.8 — Reportes financieros retornan KPIs', async () => {
    const res = await request(app).get('/api/reportes/financiero');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalVentas');
    expect(res.body).toHaveProperty('utilidadNeta');
    expect(res.body).toHaveProperty('margen');
    expect(res.body).toHaveProperty('gastosPorCategoria');
  });

  it('7.9 — Reportes de ventas por ruta', async () => {
    const res = await request(app).get('/api/reportes/ventas-por-ruta');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('7.10 — Reportes de inventario', async () => {
    const res = await request(app).get('/api/reportes/inventario');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('7.11 — Permisos de rol Admin vs Vendedor', async () => {
    const adminPerms = (await request(app).get('/api/roles/permisos?role=Admin')).body;
    const vendedorPerms = (await request(app).get('/api/roles/permisos?role=Vendedor')).body;
    expect(adminPerms.view).toContain('*');
    expect(vendedorPerms.view).toContain('rutas_propias');
    expect(vendedorPerms.create).toContain('ventas');
    expect(vendedorPerms.approve).toHaveLength(0);
  });

  it('7.12 — Reject aprobación', async () => {
    // Create a new approval request
    const createRes = await request(app)
      .post('/api/aprobaciones')
      .send({ tipo: 'CambioPrecio', modulo: 'Precios', solicitudUsuario: 'vendedor-001', descripcion: 'Cambio de precio no autorizado' });
    expect(createRes.status).toBe(201);

    const pendientes = (await request(app).get('/api/aprobaciones/pendientes')).body.items;
    const aprobId = pendientes[pendientes.length - 1].id;
    const res = await request(app)
      .put(`/api/aprobaciones/${aprobId}`)
      .send({ estado: 'Rechazado', aprobadoPor: 'admin-001', motivoRechazo: 'Precio no justificado' });
    expect(res.status).toBe(200);
  });

  it('7.13 — Auditoría se registra automáticamente al crear factura', async () => {
    // The venta in 7.1 with auto-pricing should have generated audit log
    const auditoria = (await request(app).get('/api/auditoria')).body;
    const facturaAudit = auditoria.filter((a: any) => a.modulo === 'Factura');
    expect(facturaAudit.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 6 — Granja Detalle, Lotes CRUD, Recolección', () => {
  let granjaId: string;
  let galeronId: string;
  let loteId: string;

  it('8.1 — Crear granja con galerón via wizard', async () => {
    const res = await request(app)
      .post('/api/granjas/wizard')
      .send({
        nombre: 'Granja Detalle Test',
        ubicacion: 'Cartago, CR',
        tipo_produccion: 'Postura',
        galerones: [{ nombre: 'Gal Detalle-1', capacidad_maxima: 5000 }]
      });
    expect(res.status).toBe(201);
    const granjas = (await request(app).get('/api/granjas')).body;
    const g = granjas.find((x: any) => x.nombre === 'Granja Detalle Test');
    expect(g).toBeDefined();
    granjaId = g.id;
    const allGalerones = (await request(app).get('/api/galerones')).body;
    const gal = allGalerones.find((x: any) => x.granjaId === granjaId);
    expect(gal).toBeDefined();
    galeronId = gal.id;
  });

  it('8.2 — GET /api/granjas/:id/detalle retorna estructura completa', async () => {
    const res = await request(app).get(`/api/granjas/${granjaId}/detalle`);
    expect(res.status).toBe(200);
    expect(res.body.granja).toBeDefined();
    expect(res.body.granja.nombre).toBe('Granja Detalle Test');
    expect(Array.isArray(res.body.galerones)).toBe(true);
    expect(res.body.resumen).toBeDefined();
    expect(typeof res.body.resumen.totalGalerones).toBe('number');
  });

  it('8.3 — GET /api/granjas/:id/detalle retorna 404 para ID inexistente', async () => {
    const res = await request(app).get('/api/granjas/no-existe/detalle');
    expect(res.status).toBe(404);
  });

  it('8.4 — Crear lote de aves', async () => {
    const res = await request(app)
      .post('/api/lotes')
      .send({
        galeronId,
        fecha_ingreso: '2026-08-15',
        cantidad_inicial: 4500,
        linea_genetica: 'Hy-Line W-36',
        estado: 'Activo'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const lotes = (await request(app).get('/api/lotes')).body;
    const lote = lotes.find((l: any) => l.galeronId === galeronId);
    expect(lote).toBeDefined();
    loteId = lote.id;
  });

  it('8.5 — PUT /api/lotes/:id actualiza lote', async () => {
    const res = await request(app)
      .put(`/api/lotes/${loteId}`)
      .send({ cantidad_inicial: 4400, linea_genetica: 'Hy-Line W-36 Optimized' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const lotes = (await request(app).get('/api/lotes')).body;
    const lote = lotes.find((l: any) => l.id === loteId);
    expect(lote.cantidad_inicial).toBe(4400);
  });

  it('8.6 — DELETE /api/lotes/:id finaliza lote', async () => {
    const res = await request(app).delete(`/api/lotes/${loteId}`);
    expect(res.status).toBe(200);
    const lotes = (await request(app).get('/api/lotes')).body;
    const lote = lotes.find((l: any) => l.id === loteId);
    expect(lote.estado).toBe('Finalizado');
  });

  it('8.7 — PUT /api/lotes/:id retorna 404 si no existe', async () => {
    const res = await request(app).put('/api/lotes/no-id').send({ cantidad_inicial: 100 });
    expect(res.status).toBe(404);
  });

  it('8.8 — DELETE /api/lotes/:id retorna 404 si no existe', async () => {
    const res = await request(app).delete('/api/lotes/no-id');
    expect(res.status).toBe(404);
  });

  it('8.9 — GET /api/produccion/historial con filtro granjaId', async () => {
    const res = await request(app).get(`/api/produccion/historial?granjaId=${granjaId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('8.10 — Crear granja solo con nombre', async () => {
    const res = await request(app)
      .post('/api/granjas/wizard')
      .send({ nombre: 'Granja Minimal' });
    expect(res.status).toBe(201);
  });

  it('8.11 — POST /api/granjas/wizard falla sin nombre', async () => {
    const res = await request(app)
      .post('/api/granjas/wizard')
      .send({ ubicacion: 'Location' });
    expect(res.status).toBe(400);
  });

  it('8.12 — PUT /api/galerones/:id actualiza galerón', async () => {
    const res = await request(app)
      .put(`/api/galerones/${galeronId}`)
      .send({ nombre: 'Gal Detalle-1 Updated', capacidad_maxima: 6000, estado: 'Producción' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const allGalerones = (await request(app).get('/api/galerones')).body;
    const gal = allGalerones.find((g: any) => g.id === galeronId);
    expect(gal.nombre).toBe('Gal Detalle-1 Updated');
    expect(gal.capacidad_maxima).toBe(6000);
  });

  it('8.13 — Recolección de huevos en galerón de prueba', async () => {
    const res = await request(app)
      .post('/api/produccion/recoleccion')
      .send({
        galeron: 'Gal Detalle-1 Updated',
        detalles: [{ tamano: 'Grandes', cantidad: 100 }, { tamano: 'Gallinaza', cantidad: 10 }]
      });
    expect(res.status).toBe(200);
  });
});
