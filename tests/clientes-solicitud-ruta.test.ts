import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registrarRutasClientes } from '../src/server/routes/clientes';

type Ruta = { id: string; nombre: string; vendedor_asignado: string };

const crearEndpointSolicitud = (rutasAsignadas: Ruta[]) => {
  const handlers = new Map<string, Function[]>();
  const saved: any[] = [];
  const app = {
    get: (path: string, ...fns: Function[]) => handlers.set(`GET ${path}`, fns),
    post: (path: string, ...fns: Function[]) => handlers.set(`POST ${path}`, fns),
    put: (path: string, ...fns: Function[]) => handlers.set(`PUT ${path}`, fns),
    delete: (path: string, ...fns: Function[]) => handlers.set(`DELETE ${path}`, fns),
  };
  const db = {
    query: {
      rutas: { findMany: vi.fn(async () => rutasAsignadas) },
      clientes: { findFirst: vi.fn(async () => null) },
    },
    insert: vi.fn(() => ({ values: vi.fn(async (row: any) => { saved.push(row); }) })),
  };
  const requirePermission = vi.fn(() => (_req: any, _res: any, next: () => void) => next());

  registrarRutasClientes(app as any, db as any, requirePermission as any);

  return {
    handler: handlers.get('POST /api/clientes/solicitudes')?.at(-1),
    db,
    saved,
  };
};

const crearResponse = () => {
  const res: any = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};

describe('solicitud de alta de cliente desde ruta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa la ruta asignada por Administración e ignora la ruta enviada por el vendedor', async () => {
    const ruta: Ruta = { id: 'ruta-1', nombre: 'Ruta Occidente', vendedor_asignado: 'vendedor-1' };
    const { handler, saved } = crearEndpointSolicitud([ruta]);
    const req = {
      usuario: { id: 'vendedor-1', role: 'Comercial' },
      body: { nombre: 'Cliente nuevo', ruta: 'Ruta no asignada' },
    };
    const res = crearResponse();

    await handler!(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].datos)).toMatchObject({ ruta: 'Ruta Occidente', rutaId: 'ruta-1' });
    expect(saved[0].referenciaId).toBe('ruta-1');
  });

  it.each([
    { titulo: 'sin ruta', rutas: [] },
    { titulo: 'con más de una ruta', rutas: [
      { id: 'ruta-1', nombre: 'Ruta 1', vendedor_asignado: 'vendedor-1' },
      { id: 'ruta-2', nombre: 'Ruta 2', vendedor_asignado: 'vendedor-1' },
    ] },
  ])('rechaza la solicitud $titulo y no crea la aprobación', async ({ rutas }) => {
    const { handler, saved } = crearEndpointSolicitud(rutas as Ruta[]);
    const res = crearResponse();

    await handler!({ usuario: { id: 'vendedor-1', role: 'Comercial' }, body: { nombre: 'Cliente nuevo' } }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(saved).toHaveLength(0);
  });
});
