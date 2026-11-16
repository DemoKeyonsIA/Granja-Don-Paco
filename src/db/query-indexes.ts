/** Índices de las consultas operativas y financieras más frecuentes. */
const INDICES_CONSULTA: { nombre: string; tabla: string; columnas: string[] }[] = [
  { nombre: 'idx_facturas_fecha', tabla: 'facturas', columnas: ['fecha'] },
  { nombre: 'idx_facturas_cliente_fecha', tabla: 'facturas', columnas: ['cliente_id', 'fecha'] },
  { nombre: 'idx_facturas_guia', tabla: 'facturas', columnas: ['guia_id'] },
  { nombre: 'idx_pagos_fecha', tabla: 'pagos', columnas: ['fecha'] },
  { nombre: 'idx_gastos_fecha', tabla: 'gastos', columnas: ['fecha'] },
  { nombre: 'idx_ventas_ruta_fecha', tabla: 'ventas_ruta', columnas: ['fecha_hora'] },
  { nombre: 'idx_ventas_ruta_guia', tabla: 'ventas_ruta', columnas: ['guia_id'] },
  { nombre: 'idx_ventas_ruta_cliente_fecha', tabla: 'ventas_ruta', columnas: ['cliente_id', 'fecha_hora'] },
  { nombre: 'idx_ventas_ruta_kg_fecha', tabla: 'ventas_ruta_kg', columnas: ['fecha_hora'] },
  { nombre: 'idx_ventas_ruta_kg_guia', tabla: 'ventas_ruta_kg', columnas: ['guia_id'] },
  { nombre: 'idx_ventas_ruta_kg_cliente_fecha', tabla: 'ventas_ruta_kg', columnas: ['cliente_id', 'fecha_hora'] },
  { nombre: 'idx_produccion_diaria_fecha', tabla: 'produccion_diaria', columnas: ['fecha'] },
  { nombre: 'idx_recepciones_fecha', tabla: 'recepciones', columnas: ['fecha_recepcion'] },
  { nombre: 'idx_desperdicios_fecha', tabla: 'desperdicios', columnas: ['fecha'] },
  { nombre: 'idx_desperdicios_guia', tabla: 'desperdicios', columnas: ['guia_despacho_id'] },
  { nombre: 'idx_cierres_caja_fecha', tabla: 'cierres_caja_ruta', columnas: ['fecha'] },
  { nombre: 'idx_depositos_caja_fecha', tabla: 'depositos_caja', columnas: ['fecha'] },
  { nombre: 'idx_guias_despacho_detalle_guia', tabla: 'guias_despacho_detalle', columnas: ['guia_id'] },
  { nombre: 'idx_retornos_camion_guia', tabla: 'retornos_camion', columnas: ['guia_id'] },
  { nombre: 'idx_retornos_camion_venta', tabla: 'retornos_camion', columnas: ['venta_ruta_id'] },
  { nombre: 'idx_facturas_electronicas_factura_tipo', tabla: 'facturas_electronicas', columnas: ['factura_id', 'tipo_documento'] },
  { nombre: 'idx_guias_despacho_estado_fecha', tabla: 'guias_despacho', columnas: ['estado', 'fecha'] },
];

/**
 * Aplica índices idempotentes. Comprueba columnas para tolerar instalaciones
 * antiguas y tablas opcionales que todavía no existen en esa versión.
 */
export async function aplicarIndicesDeConsulta(client: any): Promise<void> {
  const columnasPorTabla = new Map<string, Set<string>>();
  for (const indice of INDICES_CONSULTA) {
    let columnas = columnasPorTabla.get(indice.tabla);
    if (!columnas) {
      try {
        const resultado = await client.execute(`PRAGMA table_info("${indice.tabla}")`);
        columnas = new Set((resultado.rows || []).map((fila: any) => String(fila.name)));
      } catch {
        columnas = new Set();
      }
      columnasPorTabla.set(indice.tabla, columnas);
    }
    if (!indice.columnas.every(columna => columnas!.has(columna))) continue;
    const lista = indice.columnas.map(columna => `"${columna}"`).join(', ');
    await client.execute(`CREATE INDEX IF NOT EXISTS "${indice.nombre}" ON "${indice.tabla}" (${lista})`);
  }
}

