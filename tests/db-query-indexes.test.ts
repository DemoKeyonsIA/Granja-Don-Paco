import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { ejecutarDdl } from './helpers/db';
import { aplicarIndicesDeConsulta } from '../src/db/query-indexes';

describe('índices de consultas frecuentes', () => {
  const client = createClient({ url: ':memory:' });

  beforeAll(async () => { await ejecutarDdl(client); });
  afterAll(() => client.close());

  it('crea índices para fechas, historial por cliente y custodia por guía', async () => {
    const resultado = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'index'`);
    const nombres = new Set(resultado.rows.map((fila: any) => String(fila.name)));
    for (const nombre of [
      'idx_facturas_fecha', 'idx_facturas_cliente_fecha', 'idx_pagos_fecha',
      'idx_gastos_fecha', 'idx_ventas_ruta_fecha', 'idx_ventas_ruta_guia',
      'idx_produccion_diaria_fecha', 'idx_recepciones_fecha', 'idx_desperdicios_fecha',
      'idx_cierres_caja_fecha', 'idx_depositos_caja_fecha', 'idx_guias_despacho_detalle_guia',
      'idx_retornos_camion_guia', 'idx_facturas_electronicas_factura_tipo',
      'idx_guias_despacho_estado_fecha',
    ]) expect(nombres.has(nombre), nombre).toBe(true);
  });

  it('es idempotente y el plan usa el índice de guía del tiquete', async () => {
    await aplicarIndicesDeConsulta(client);
    const plan = await client.execute("EXPLAIN QUERY PLAN SELECT * FROM ventas_ruta WHERE guia_id = 'guia-demo'");
    expect(plan.rows.map((fila: any) => String(fila.detail)).join(' ')).toContain('idx_ventas_ruta_guia');
    const count = await client.execute("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'index' AND name = 'idx_ventas_ruta_guia'");
    expect(Number(count.rows[0].total)).toBe(1);
  });
});
