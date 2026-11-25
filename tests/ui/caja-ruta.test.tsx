// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CajaRuta from '../../src/components/CajaRuta';

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });

describe('CajaRuta — venta móvil guiada', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('muestra pasos legibles, total y bloquea cantidades mayores al stock', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/logistica/guias-activas') return json([{ id: 'g-1', consecutivo: 'GD-001', camionId: 'cam-1', camionNombre: 'Camión 1', vendedorId: 'v-1', estado: 'EnRuta' }]);
      if (url === '/api/logistica/camiones') return json([]);
      if (url === '/api/logistica/guias/g-1') return json({
        id: 'g-1', consecutivo: 'GD-001', camionNombre: 'Camión 1', estado: 'EnRuta', totalCartones: 2,
        detalle: [{ etiquetaId: 'etq-1', estadoEtiqueta: 'Cargada', producto: 'Huevos Grandes', saldoKg: 2, pesoNeto: 2 }], ventas: [],
        rutaOrden: [{ clienteId: 'cli-1', nombre: 'Pulpería Central' }],
      });
      if (url === '/api/inventario') return json([{ id: 'inv-1', producto: 'Huevos Grandes', cantidad: 2, unidad: 'kg', ubicacion: 'Camión 1' }]);
      if (url.startsWith('/api/precios/lookup')) return json({ 'Huevos Grandes': { precio: 1000, precioMinimo: 900, precioMaximo: 1100, descuentoMaximo: 10, listaUsada: 'Ruta Norte' } });
      return json([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CajaRuta currentUser={{ id: 'v-1', name: 'Vendedora Demo', email: 'vendedor@example.com', role: 'Comercial' }} />);

    expect(await screen.findByText('Ruta asignada')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar entrega' }));
    fireEvent.click(await screen.findByRole('button', { name: /Factura electrónica/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: /Huevos Grandes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(screen.getByText(/Puede cobrar entre/)).toBeTruthy());
    expect(screen.getAllByText(/₡1,000|₡ 1,000|₡1 000|₡ 1 000/).length).toBeGreaterThan(0);

    const cantidad = screen.getByLabelText('¿Cuántos kilos?') as HTMLInputElement;
    expect(cantidad.value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar un kilo' }));
    expect(cantidad.value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar un kilo' }));
    expect(cantidad.value).toBe('3');
    expect(screen.getByRole('alert').textContent).toContain('Solo quedan 2.00 kg');
    expect((screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
