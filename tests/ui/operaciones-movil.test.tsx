// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BodegaMovil from '../../src/components/BodegaMovil';
import DespachoMovil from '../../src/components/DespachoMovil';
import type { User } from '../../src/types';

const USUARIO: User = { id: 'u1', name: 'Ana Bodega', email: 'ana@granja.test', role: 'Bodeguero', roles: ['Bodeguero'] };
const respuesta = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => data });
const respuestaRecepciones = (pendientes: unknown[] = []) => respuesta({
  pendientes,
  recientes: [],
  hayMasRecientes: false,
  siguienteOffset: 0,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('operación móvil de Bodega', () => {
  it('distingue una falla al cargar del estado sin recepciones y permite reintentar', async () => {
    let fallar = true;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (fallar) return respuesta({ error: 'Sin conexión' }, false);
      return respuestaRecepciones();
    }));

    const user = userEvent.setup();
    render(<BodegaMovil currentUser={USUARIO} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('No se cargaron las recepciones')).toBeTruthy();

    fallar = false;
    await user.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(await screen.findByText('Todo recibido')).toBeTruthy();
  });

  it('permite registrar cero recibido cuando se indica el motivo y confirma el resultado', async () => {
    const post = vi.fn(async () => respuesta({ ok: true }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') return post();
      if (url.includes('/api/operaciones/recepciones/movil')) return respuestaRecepciones([{
        cargaId: 'c1', granjaId: 'g1', nombreGranja: 'Granja Norte', vehiculo: 'Camión 1',
        fechaSalida: '2026-11-06T10:00:00Z', responsableEntrega: 'Luis',
        items: [{
          id: 't1', cargaId: 'c1', granjaOrigenId: 'g1', fechaSalida: '2026-11-06T10:00:00Z',
          responsableEntrega: 'Luis', vehiculo: 'Camión 1', estado: 'EnTransito', producto: 'Huevos - Grande',
          cantidad: 10, unidad: 'kg', nombreGranja: 'Granja Norte', recibida: false, recepcionId: null,
          cantidadRecibida: null, diferencia: null, motivoDiferencia: null, fechaRecepcion: null,
          responsableRecepcion: null,
        }],
      }]);
      if (url.includes('/api/operaciones/traslados')) return respuesta([{
        id: 't1', cargaId: 'c1', granjaOrigenId: 'g1', fechaSalida: '2026-11-06T10:00:00Z',
        responsableEntrega: 'Luis', vehiculo: 'Camión 1', estado: 'EnTransito',
      }]);
      if (url.includes('/api/granjas')) return respuesta([{ id: 'g1', nombre: 'Granja Norte' }]);
      if (url.includes('/api/inventario/movimientos')) return respuesta([{
        id: 'm1', referencia_id: 't1', tipo: 'Traslado', producto: 'Huevos - Grande', cantidad: 10, unidad: 'kg',
      }]);
      return respuesta([]);
    }));

    const user = userEvent.setup();
    render(<BodegaMovil currentUser={USUARIO} />);
    await user.click(await screen.findByRole('button', { name: /Granja Norte.*Camión 1/i }));

    const recibido = await screen.findByLabelText('Peso recibido (kg)');
    expect(screen.getByRole('region', { name: 'Confirmar recepción' })).toBeTruthy();
    await user.type(recibido, '0');
    expect(screen.getByText('Faltan 10.00 kg')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Confirmar recepción/i }) as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText('Indica el motivo'), 'no-aparece');
    const confirmar = screen.getByRole('button', { name: /Confirmar recepción/i });
    expect((confirmar as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirmar);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Carga recibida' })).toBeTruthy());
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('carga móvil de Despacho', () => {
  it('muestra un error de conexión y permite volver a cargar los catálogos', async () => {
    let fallar = true;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (fallar) return respuesta({ error: 'Sin conexión' }, false);
      return respuesta([]);
    }));

    const user = userEvent.setup();
    render(<DespachoMovil currentUser={USUARIO} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('No se cargaron los datos de la carga')).toBeTruthy();

    fallar = false;
    await user.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(await screen.findByRole('button', { name: /Registrar carga nueva/i })).toBeTruthy();
  });

  it('presenta el avance correcto al llegar al paso de cantidades', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/granjas')) return respuesta([{ id: 'g1', nombre: 'Granja Norte' }]);
      if (url.includes('/api/galerones')) return respuesta([{ id: 'gal1', granjaId: 'g1', nombre: 'Galpón 1' }]);
      if (url.includes('/api/camiones')) return respuesta([{ id: 'c1', nombre: 'Camión 1' }]);
      return respuesta([]);
    }));

    const user = userEvent.setup();
    render(<DespachoMovil currentUser={USUARIO} />);
    await user.click(await screen.findByRole('button', { name: /Registrar carga nueva/i }));
    await user.click(await screen.findByRole('button', { name: /Granja Norte/i }));
    await user.click(await screen.findByRole('button', { name: /Galpón 1/i }));

    expect(await screen.findByRole('heading', { name: 'Cantidades de la carga' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Paso 3 de 4' })).toBeTruthy();
    expect(screen.getByText(/Registra kilos pesados de huevo/i)).toBeTruthy();

    await user.clear(screen.getByLabelText('Cantidad Huevo grande (kg)'));
    await user.type(screen.getByLabelText('Cantidad Huevo grande (kg)'), '5');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(await screen.findByRole('button', { name: /Camión 1/i }));
    expect(screen.getByRole('region', { name: 'Confirmar carga' })).toBeTruthy();
  });
});



