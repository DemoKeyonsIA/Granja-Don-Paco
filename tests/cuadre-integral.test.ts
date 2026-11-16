import { describe, it, expect } from 'vitest';
import { calcularCuadreIntegral } from '../src/lib/cuadre-integral';

const P = 'Huevos - Grande';
const U = 'cartones';

function base(over: Partial<Parameters<typeof calcularCuadreIntegral>[0]> = {}) {
  return calcularCuadreIntegral({
    guiaId: 'g1',
    cargadoPorProducto: [{ producto: P, unidad: U, cantidad: 500 }],
    ventasEmitidas: [],
    devoluciones: [],
    mermaRegistrada: [],
    ...over,
  });
}

describe('calcularCuadreIntegral — ejemplos de cuadre', () => {
  it('Caso 1: 500 cargados, 450 vendidos, 50 aceptados en Bodega → saldo 0, sin diferencias', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 450 }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 50, estado: 'AceptadoBodega', tipo: 'sobrante' }],
    });
    expect(c.totalSaldoNoExplicado).toBe(0);
    expect(c.tieneDiferencias).toBe(false);
    expect(c.puedeCerrarSinDiferencia).toBe(true);
    expect(c.totalRetornoAceptado).toBe(50);
  });

  it('Caso 2: 500, 448 vendidos, 2 merma registrada, 50 aceptados → saldo 0', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 448 }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 50, estado: 'AceptadoBodega', tipo: 'sobrante' }],
      mermaRegistrada: [{ producto: P, unidad: U, cantidad: 2, motivo: 'Quebrado Camión', responsable: 'Camionero' }],
    });
    expect(c.totalMermaRegistrada).toBe(2);
    expect(c.totalSaldoNoExplicado).toBe(0);
    expect(c.tieneDiferencias).toBe(false);
  });

  it('Caso 3: 500, 450 vendidos, 48 aceptados → saldo 2 como diferencia pendiente (NO merma)', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 450 }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 48, estado: 'AceptadoBodega', tipo: 'sobrante' }],
    });
    expect(c.totalSaldoNoExplicado).toBe(2);
    expect(c.tieneDiferencias).toBe(true);
    expect(c.puedeCerrarSinDiferencia).toBe(false);
    expect(c.totalMermaRegistrada).toBe(0);
    expect(c.diferencias).toHaveLength(1);
    expect(c.diferencias[0]).toMatchObject({ producto: P, tipo: 'positivo', cantidad: 2 });
  });

  it('ajuste aprobado por faltante explica el saldo sin convertirlo en merma', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 450 }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 49, estado: 'AceptadoBodega', tipo: 'sobrante' }],
      ajustesAprobados: [{ producto: P, unidad: U, cantidad: 1, diferenciaFirmada: -1 }],
    });
    expect(c.totalSaldoNoExplicado).toBe(0);
    expect(c.totalAjusteInventarioAprobado).toBe(-1);
    expect(c.totalMermaRegistrada).toBe(0);
    expect(c.puedeCerrarSinDiferencia).toBe(true);
  });

  it('ajuste aprobado por excedente aumenta la diferencia pendiente hasta su resolución', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 450 }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 51, estado: 'AceptadoBodega', tipo: 'sobrante' }],
      ajustesAprobados: [{ producto: P, unidad: U, cantidad: 1, diferenciaFirmada: 1 }],
    });
    expect(c.totalSaldoNoExplicado).toBe(0);
    expect(c.totalAjusteInventarioAprobado).toBe(1);
    expect(c.totalMermaRegistrada).toBe(0);
  });
});

describe('calcularCuadreIntegral — por producto y unidad', () => {
  it('convierte merma en kg a cartones usando el factor configurado en catálogo', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 450 }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 48, estado: 'AceptadoBodega' }],
      mermaRegistrada: [{ producto: P, unidad: 'kg', cantidad: 3.8, motivo: 'Quebrado', responsable: 'Ruta' }],
      factoresKgPorCarton: [{ producto: P, kgPorCarton: 1.9 }],
    });
    expect(c.totalMermaRegistrada).toBe(2);
    expect(c.porProducto).toHaveLength(1);
    expect(c.totalSaldoNoExplicado).toBe(0);
    expect(c.conversionesPendientes).toEqual([]);
  });

  it('no inventa conversión cuando falta el factor y exige resolución antes de cerrar sin diferencia', () => {
    const c = base({
      mermaRegistrada: [{ producto: P, unidad: 'kg', cantidad: 3.8, motivo: 'Quebrado', responsable: 'Ruta' }],
    });
    expect(c.conversionesPendientes).toEqual([{ producto: P, cantidadKg: 3.8 }]);
    expect(c.puedeCerrarSinDiferencia).toBe(false);
  });

  it('no suma cartones de productos distintos', () => {
    const c = calcularCuadreIntegral({
      guiaId: 'g1',
      cargadoPorProducto: [
        { producto: 'Huevos - Grande', unidad: 'cartones', cantidad: 300 },
        { producto: 'Huevos - Mediano', unidad: 'cartones', cantidad: 200 },
      ],
      ventasEmitidas: [
        { producto: 'Huevos - Grande', unidad: 'cartones', cantidad: 300 },
        { producto: 'Huevos - Mediano', unidad: 'cartones', cantidad: 150 },
      ],
      devoluciones: [
        { producto: 'Huevos - Grande', unidad: 'cartones', cantidad: 0, estado: 'AceptadoBodega' },
        { producto: 'Huevos - Mediano', unidad: 'cartones', cantidad: 50, estado: 'AceptadoBodega' },
      ],
      mermaRegistrada: [],
    });
    expect(c.totalSaldoNoExplicado).toBe(0);
    expect(c.tieneDiferencias).toBe(false);
    expect(c.porProducto).toHaveLength(2);
  });

  it('diferencia positiva y negativa por producto se reportan concretas', () => {
    const c = calcularCuadreIntegral({
      guiaId: 'g1',
      cargadoPorProducto: [
        { producto: 'Huevos - Grande', unidad: 'cartones', cantidad: 300 },
        { producto: 'Huevos - Mediano', unidad: 'cartones', cantidad: 200 },
      ],
      ventasEmitidas: [{ producto: 'Huevos - Grande', unidad: 'cartones', cantidad: 290 }],
      devoluciones: [
        { producto: 'Huevos - Grande', unidad: 'cartones', cantidad: 0, estado: 'AceptadoBodega' },
        { producto: 'Huevos - Mediano', unidad: 'cartones', cantidad: 210, estado: 'AceptadoBodega' },
      ],
      mermaRegistrada: [],
    });
    // Grande: 300 - 290 - 0 - 0 = 10 faltante (positivo)
    // Mediano: 200 - 0 - 0 - 210 = -10 sobrante (negativo)
    const grande = c.diferencias.find(d => d.producto === 'Huevos - Grande');
    const mediano = c.diferencias.find(d => d.producto === 'Huevos - Mediano');
    expect(grande?.tipo).toBe('positivo');
    expect(grande?.cantidad).toBe(10);
    expect(mediano?.tipo).toBe('negativo');
    expect(mediano?.cantidad).toBe(10);
    expect(c.tieneDiferencias).toBe(true);
  });
});

describe('calcularCuadreIntegral — devoluciones y retornos', () => {
  it('devolución parcial reduce el tiquete que sigue emitido y el retorno una sola vez', () => {
    const c = base({
      cargadoPorProducto: [{ producto: P, unidad: U, cantidad: 30 }],
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 10, ventaRutaId: 'v1' }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 4, cantidadAceptada: 4, ventaRutaId: 'v1', estado: 'AceptadoBodega', tipo: 'parcial' }],
      sobranteFisicoCamion: [{ producto: P, unidad: U, cantidad: 20 }],
    });
    expect(c.porProducto[0]).toMatchObject({ vendidoNeto: 6, retornoAceptado: 4, sobranteFisicoCamion: 20, saldoBajoCustodiaCamion: 20, saldoNoExplicado: 0 });
    expect(c.tieneDiferencias).toBe(false);
    expect(c.puedeCerrarSinDiferencia).toBe(false); // queda saldo que Bodega debe recibir
  });

  it('tiquete anulado sale de venta neta y la devolución aceptada se cuenta una sola vez', () => {
    const c = base({
      cargadoPorProducto: [{ producto: P, unidad: U, cantidad: 30 }],
      ventasEmitidas: [],
      devoluciones: [{ producto: P, unidad: U, cantidad: 10, cantidadAceptada: 10, ventaRutaId: 'v1', estado: 'AceptadoBodega', tipo: 'completo' }],
      sobranteFisicoCamion: [{ producto: P, unidad: U, cantidad: 20 }],
    });
    expect(c.porProducto[0]).toMatchObject({ vendidoNeto: 0, retornoAceptado: 10, saldoBajoCustodiaCamion: 20, saldoNoExplicado: 0 });
    expect(c.puedeCerrarSinDiferencia).toBe(false); // los 20 cartones siguen bajo custodia
  });

  it('rechazo Bodega mantiene el retorno en custodia y no suma inventario aceptado', () => {
    const c = base({
      cargadoPorProducto: [{ producto: P, unidad: U, cantidad: 30 }],
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 10, ventaRutaId: 'v1' }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 4, cantidadAceptada: 0, ventaRutaId: 'v1', estado: 'RechazadoBodega', tipo: 'parcial' }],
      sobranteFisicoCamion: [{ producto: P, unidad: U, cantidad: 24 }],
    });
    expect(c.porProducto[0]).toMatchObject({ vendidoNeto: 6, retornoAceptado: 0, retornoRechazado: 4, saldoBajoCustodiaCamion: 24, saldoNoExplicado: 0 });
    expect(c.tieneDiferencias).toBe(false);
    expect(c.puedeCerrarSinDiferencia).toBe(false);
  });

  it('un retorno parcialmente aceptado deja pendiente solo la diferencia y resta lo aceptado del stock del camión', () => {
    const c = base({
      cargadoPorProducto: [{ producto: P, unidad: U, cantidad: 30 }],
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 10, ventaRutaId: 'v1' }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 6, cantidadAceptada: 2, ventaRutaId: 'v1', estado: 'PendienteBodega', tipo: 'parcial' }],
      sobranteFisicoCamion: [{ producto: P, unidad: U, cantidad: 24 }],
    });
    expect(c.totalRetornoAceptado).toBe(2);
    expect(c.totalRetornoPendiente).toBe(4);
    expect(c.porProducto[0].saldoNoExplicado).toBe(0);
    expect(c.porProducto[0].saldoBajoCustodiaCamion).toBe(24);
    expect(c.puedeCerrarSinDiferencia).toBe(false);
  });

  it('devolución ligada a venta no se cuenta dos veces (venta anulada + retorno)', () => {
    // La venta fue anulada, así que NO aparece en ventasEmitidas.
    // El retorno de esa devolución solo cuenta cuando Bodega lo acepta.
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 400 }],
      devoluciones: [
        { producto: P, unidad: U, cantidad: 50, ventaRutaId: 'v1', estado: 'AceptadoBodega', tipo: 'completo' },
      ],
    });
    // 500 - 400 - 0 - 50 = 50 → faltan 50 por explicar (los que aun no estan vendidos ni aceptados)
    expect(c.totalDevolucionVinculada).toBe(50);
    expect(c.totalSaldoNoExplicado).toBe(50);
    expect(c.tieneDiferencias).toBe(true);
  });

  it('retorno pendiente no repone existencias hasta ser aceptado', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 450 }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 48, estado: 'PendienteBodega', tipo: 'sobrante' }],
    });
    expect(c.totalRetornoAceptado).toBe(0);
    expect(c.totalRetornoPendiente).toBe(48);
    expect(c.tieneRetornosPendientes).toBe(true);
    // 500 - 450 - 0 - 0 (no aceptado) = 50 no explicados todavia
    expect(c.totalSaldoNoExplicado).toBe(50);
  });

  it('aceptación usa cantidadAceptada cuando difiere (aceptación parcial)', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 450 }],
      devoluciones: [
        { producto: P, unidad: U, cantidad: 50, cantidadAceptada: 48, estado: 'AceptadoBodega', tipo: 'sobrante' },
      ],
    });
    expect(c.totalRetornoAceptado).toBe(48);
    expect(c.totalSaldoNoExplicado).toBe(2);
    expect(c.tieneDiferencias).toBe(true);
  });

  it('retorno Rechazado no repone existencias', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 450 }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 50, estado: 'RechazadoBodega', tipo: 'sobrante' }],
    });
    expect(c.totalRetornoAceptado).toBe(0);
    expect(c.totalRetornoPendiente).toBe(0);
    expect(c.totalSaldoNoExplicado).toBe(50);
  });

  it('reporta la ecuación completa incluyendo stock contado que permanece bajo custodia', () => {
    const c = base({
      cargadoPorProducto: [{ producto: P, unidad: U, cantidad: 500 }],
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 430 }],
      devoluciones: [{ producto: P, unidad: U, cantidad: 20, cantidadAceptada: 20, estado: 'AceptadoBodega', tipo: 'sobrante' }],
      sobranteFisicoCamion: [{ producto: P, unidad: U, cantidad: 50 }],
    });
    expect(c.totalSaldoBajoCustodiaCamion).toBe(50);
    expect(c.totalSaldoNoExplicado).toBe(0);
    expect(c.puedeCerrarSinDiferencia).toBe(false); // saldo físico no puede quedar en camión al cerrar
    expect(c.diferencias).toEqual([]);
  });

  it('sobrante nunca vendido se distingue de devolución ligada a venta', () => {
    const c = base({
      ventasEmitidas: [{ producto: P, unidad: U, cantidad: 400 }],
      devoluciones: [
        { producto: P, unidad: U, cantidad: 50, ventaRutaId: 'v1', estado: 'AceptadoBodega', tipo: 'completo' },
        { producto: P, unidad: U, cantidad: 50, estado: 'AceptadoBodega', tipo: 'sobrante' },
      ],
    });
    expect(c.totalDevolucionVinculada).toBe(50);
    expect(c.totalDevolucionSobrante).toBe(50);
    expect(c.totalSaldoNoExplicado).toBe(0);
    expect(c.tieneDiferencias).toBe(false);
  });
});
