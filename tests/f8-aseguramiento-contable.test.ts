import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/libsql';
import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import * as schema from '../src/db/schema.sqlite';
import { createContabilidadXlsx } from '../src/lib/xlsx';
import { abrirClienteDePrueba, ejecutarDdl } from './helpers/db';
import { requestAs } from './helpers/request-as';
import { expectApi } from './helpers/http';

const DB_PATH = path.resolve(process.cwd(), '.test-f8-contabilidad.db');
const adminId = 'f8-admin';
const vendedorId = 'f8-vendedor';
const invoiceId = 'f8-invoice';
const period = { desde: '2026-10-01', hasta: '2026-10-31' };
let app: Express;

beforeAll(async () => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const client = abrirClienteDePrueba(`file:${DB_PATH}`);
  await ejecutarDdl(client);
  const db = drizzle(client, { schema });
  await db.insert(schema.users).values([
    { id: adminId, name: 'Admin F8', email: 'admin-f8@example.cr', role: 'Admin' },
    { id: vendedorId, name: 'Vendedor F8', email: 'vendedor-f8@example.cr', role: 'Vendedor' },
  ]);
  await db.insert(schema.clientes).values({ id: 'f8-cliente', nombre: 'Cliente F8', condicion_pago: 'Contado', estado: 'Activo' });
  await db.insert(schema.facturas).values({ id: invoiceId, consecutivo: 'F8-001', fecha: '2026-10-05', clienteId: 'f8-cliente', vendedorId: vendedorId, subtotal: 1000, descuento: 0, total: 1000, condicion_pago: 'Contado', estado: 'Pendiente' });
  await db.insert(schema.pagos).values({ id: 'f8-pago', facturaId: invoiceId, fecha: '2026-10-06', monto: 400, metodo: 'Efectivo', usuarioId: vendedorId });
  await db.insert(schema.facturas_electronicas).values({
    id: 'f8-doc', facturaId: invoiceId, tipoDocumento: 'Factura', consecutivo: 'DEMO-F8-001', clave: 'DEMO-KEY-F8', fechaEmision: '2026-10-05',
    emisorNombre: 'Demo', emisorCedula: '000000000', receptorNombre: 'Cliente F8', subtotal: 1000, descuento: 0, impuestos: 0, total: 1000,
    condicionPago: 'Contado', estado: 'Pendiente', ambiente: 'Pruebas', proveedor: 'Simulado', xmlGenerado: '<Factura>DEMO</Factura>',
    respuestaHacienda: JSON.stringify({ simulado: true, estado: 'Pendiente' }),
    datosFiscalSnapshot: JSON.stringify({ modo: 'SIMULACION_NO_FISCAL', importesFuenteFactura: { subtotal: 1000, descuento: 0, impuestos: 0, total: 1000 }, lineas: [{ descripcionFactura: 'Huevo', subtotal: 1000, cabysCodigo: null, tratamientoFiscal: null, estadoRevisionFiscal: 'Pendiente' }] }),
  });
  const mod = await import('../server');
  app = await mod.createApp(true, db);
});

afterAll(() => {
  try { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); } catch { /* db helper handles close */ }
});

describe('F8 — regresión de conciliación y exportación contable', () => {
  it('protege la conciliación por permiso y valida el período', async () => {
    const denied = await requestAs(app, vendedorId).get('/api/contabilidad/conciliacion-f7').query(period);
    expectApi(denied, 403);
    const invalid = await requestAs(app, adminId).get('/api/contabilidad/conciliacion-f7').query({ desde: 'octubre', hasta: period.hasta });
    expectApi(invalid, 400);
    const reversed = await requestAs(app, adminId).get('/api/contabilidad/conciliacion-f7').query({ desde: period.hasta, hasta: period.desde });
    expectApi(reversed, 400);
  });

  it('detecta abono parcial, observaciones tributarias de demo y pago sin asiento', async () => {
    const res = await requestAs(app, adminId).get('/api/contabilidad/conciliacion-f7').query(period);
    expectApi(res, 200);
    expect(res.body.facturas[0]).toMatchObject({ id: invoiceId, pagadoAlCorte: 400, saldoPorPagos: 600, documentosDemo: 1 });
    expect(res.body.facturas[0].observacionesTributariasDemo).toContain('Impuesto declarado como ₡0 en la simulación; confirmar tratamiento fiscal con CPA.');
    expect(res.body.pagos[0].alertas).toContain('Sin asiento contabilizado por referencia');
    expect(res.body.resumen.pagosSinAsientoContabilizado).toBe(1);
  });

  it('exporta filas de conciliación fuente junto al CSV/Excel', async () => {
    const res = await requestAs(app, adminId).get('/api/contabilidad/exportar').query(period);
    expectApi(res, 200);
    expect(res.body.filas.some((row: any) => row.seccion === 'CONCILIACION_F7_FACTURA' && row.id === invoiceId)).toBe(true);
    expect(res.body.filas.some((row: any) => row.seccion === 'CONCILIACION_F7_PAGO' && row.id === 'f8-pago')).toBe(true);
  });

  it('exporta anexos simulados con huellas y manifiesto, sin presentarlos como fiscales', async () => {
    const res = await requestAs(app, adminId).get('/api/contabilidad/exportar-anexos').query(period);
    expectApi(res, 200);
    expect(res.body.tipoPaquete).toBe('ANEXOS_CONTADOR_DEMO');
    expect(res.body.documentos[0].simulado).toBe(true);
    expect(res.body.documentos[0].hashesSha256.xmlGenerado).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.manifiesto.some((item: any) => item.tipo === 'xmlGeneradoDemo' && item.sha256)).toBe(true);
  });

  it('produce un paquete XLSX OOXML con estructura ZIP y hojas nombradas por sección', async () => {
    const blob = createContabilidadXlsx(['seccion', 'monto', 'descripcion'], [{ seccion: 'ASIENTOS', monto: 1200, descripcion: '=texto' }, { seccion: 'PAGOS', monto: 500, descripcion: 'Pago' }]);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x04034b50);
    const content = new TextDecoder().decode(bytes);
    expect(content).toContain('[Content_Types].xml');
    expect(content).toContain('xl/worksheets/sheet2.xml');
    expect(content).toContain('ASIENTOS');
    expect(content).toContain('PAGOS');
    expect(content).toContain('=texto');
  });
});
