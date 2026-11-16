import { describe, expect, it } from 'vitest';
import { resolverPrecioParaProducto } from '../src/lib/precios';

const datosBase = {
  fecha: '2026-11-04',
  clientes: [{ id: 'c1', precio_especial: 0 }],
  catalogo: [{ id: 'p1', nombre: 'Huevos - Grande', precioBase: 1200 }],
  excepciones: [],
  listas: [{ id: 'global', nombre: 'General', tipo: 'Global', estado: 'Activa', fechaInicio: '2026-01-01', fechaFin: null }],
  detalles: [{ listaId: 'global', producto: 'Huevos - Grande', precioUnitario: 1000, precioMinimo: 900, precioMaximo: 1100, descuentoMaximo: 0, unidad: 'cartones' }],
};

describe('resolverPrecioParaProducto', () => {
  it('retorna el rango de negociación de la lista global vigente', () => {
    expect(resolverPrecioParaProducto('Huevos - Grande', 'c1', undefined, datosBase)).toMatchObject({
      precio: 1000, precioMinimo: 900, precioMaximo: 1100, listaUsada: 'General',
    });
  });

  it('elige de forma determinista la lista vigente con inicio más reciente cuando hay datos históricos solapados', () => {
    const datos = {
      ...datosBase,
      listas: [
        { id: 'global-anterior', nombre: 'General anterior', tipo: 'Global', estado: 'Activa', fechaInicio: '2026-01-01' },
        { id: 'global-reciente', nombre: 'General vigente', tipo: 'Global', estado: 'Activa', fechaInicio: '2026-11-01' },
      ],
      detalles: [
        { listaId: 'global-anterior', producto: 'Huevos - Grande', precioUnitario: 1000, precioMinimo: 900, precioMaximo: 1100 },
        { listaId: 'global-reciente', producto: 'Huevos - Grande', precioUnitario: 1050, precioMinimo: 1000, precioMaximo: 1100 },
      ],
    };
    expect(resolverPrecioParaProducto('Huevos - Grande', undefined, undefined, datos)).toMatchObject({
      precio: 1050, listaUsada: 'General vigente',
    });
  });

  it('respeta precedencia de precio fijo por cliente sobre lista de ruta/global', () => {
    const datos = {
      ...datosBase,
      clientes: [{ id: 'c1', precio_especial: 950 }],
      listas: [...datosBase.listas, { id: 'ruta', nombre: 'Ruta Norte', tipo: 'Ruta', rutaAsociada: 'Norte', estado: 'Activa', fechaInicio: '2026-01-01', fechaFin: null }],
      detalles: [...datosBase.detalles, { listaId: 'ruta', producto: 'Huevos - Grande', precioUnitario: 1050, precioMinimo: 1000, precioMaximo: 1200, descuentoMaximo: 0 }],
    };
    expect(resolverPrecioParaProducto('Huevos - Grande', 'c1', 'Norte', datos)).toMatchObject({
      precio: 950, precioMinimo: 950, precioMaximo: 950, listaUsada: 'Precio Especial Cliente',
    });
  });

  it('la excepción aprobada por cliente y producto prevalece sobre tarifa general y lista del cliente', () => {
    const datos = {
      ...datosBase,
      clientes: [{ id: 'c1', precio_especial: 1400 }],
      listas: [
        ...datosBase.listas,
        { id: 'cliente', nombre: 'Contrato Cliente', tipo: 'Cliente', clienteId: 'c1', estado: 'Activa', fechaInicio: '2026-01-01' },
      ],
      detalles: [...datosBase.detalles, { listaId: 'cliente', producto: 'Huevos - Grande', precioUnitario: 1300, precioMinimo: 1200, precioMaximo: 1350 }],
      excepciones: [{ clienteId: 'c1', productoId: 'p1', precioExcepcion: 1150, justificacion: 'Convenio firmado', estado: 'Activa' }],
    };
    expect(resolverPrecioParaProducto('Huevos - Grande', 'c1', undefined, datos)).toMatchObject({
      precio: 1150, precioMinimo: 1150, precioMaximo: 1150, listaUsada: 'Excepción: Convenio firmado',
    });
  });

  it('ignora listas vencidas y usa precio base fijo de catálogo como último recurso', () => {
    const datos = { ...datosBase, listas: [{ ...datosBase.listas[0], fechaFin: '2026-10-31' }] };
    expect(resolverPrecioParaProducto('Huevos - Grande', undefined, undefined, datos)).toMatchObject({
      precio: 1200, precioMinimo: 1200, precioMaximo: 1200, listaUsada: 'Precio Base Catálogo',
    });
  });

  it('ignora excepciones todavía no vigentes o ya vencidas', () => {
    const excepciones = [
      { clienteId: 'c1', productoId: 'p1', precioExcepcion: 700, justificacion: 'futura', estado: 'Activa', fechaInicio: '2026-11-05', fechaFin: '2026-12-01' },
      { clienteId: 'c1', productoId: 'p1', precioExcepcion: 800, justificacion: 'vencida', estado: 'Activa', fechaInicio: '2026-10-01', fechaFin: '2026-11-03' },
    ];
    expect(resolverPrecioParaProducto('Huevos - Grande', 'c1', undefined, { ...datosBase, excepciones }))
      .toMatchObject({ precio: 1000, listaUsada: 'General' });
  });

  it('usa la excepción aprobada mientras está dentro de su vigencia inclusiva', () => {
    const excepciones = [{ clienteId: 'c1', productoId: 'p1', precioExcepcion: 850, justificacion: 'contrato temporal', estado: 'Activa', fechaInicio: '2026-11-04', fechaFin: '2026-11-04' }];
    expect(resolverPrecioParaProducto('Huevos - Grande', 'c1', undefined, { ...datosBase, excepciones }))
      .toMatchObject({ precio: 850, precioMinimo: 850, precioMaximo: 850 });
  });

  it('devuelve null cuando no existe precio autorizado ni catálogo', () => {
    expect(resolverPrecioParaProducto('Huevos - Especial', undefined, undefined, datosBase)).toBeNull();
  });
});
