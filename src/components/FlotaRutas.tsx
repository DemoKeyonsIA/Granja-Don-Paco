import React, { useState, useEffect, useCallback } from 'react';
import { Truck, Users, Map, Plus, X, CheckCircle2, Check, MapPin, Route, Search, Edit2, Trash2 } from 'lucide-react';
import { User, Ruta, Cliente } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { BloqueCarga } from './Spinner';
import { esCamionero, esVendedor } from '../lib/vendedores';
import FranjaProceso from './FranjaProceso';
import { sessionHeaders } from '../lib/session';

interface FlotaRutasProps {
  currentUser: User;
}

/**
 * Flota y Rutas — paso `despacho-camiones` de la sub-fila de Despacho.
 *
 * Fusiona dos maestros que la Fase 8 dejó separados: la flota de camiones
 * (tab interno "Camiones" del cuerpo Despacho.tsx) y el CRUD de rutas que
 * venía de Logística. Antes el paso se llamaba "Camiones y Rutas" pero solo
 * mostraba rutas; el boceto `boceto-despacho-unificado.html` la nombra con
 * lo que realmente es: una pantalla con la flota y las rutas.
 */
export default function FlotaRutas({ currentUser }: FlotaRutasProps) {
  const [camiones, setCamiones] = useState<any[]>([]);
  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Camión nuevo (modal)
  const [camionModal, setCamionModal] = useState(false);
  const [camionNombre, setCamionNombre] = useState('');
  const [camionPlaca, setCamionPlaca] = useState('');
  const [camionCapacidad, setCamionCapacidad] = useState(500);
  const [camionCamioneroId, setCamionCamioneroId] = useState('');
  const [camionEstado, setCamionEstado] = useState('Activo');
  const [creandoCamion, setCreandoCamion] = useState(false);

  // Edición de camión (fila en línea, heredada de Admin → Camiones)
  const [editandoCamionId, setEditandoCamionId] = useState<string | null>(null);
  const [editCamion, setEditCamion] = useState({ nombre: '', placa: '', camioneroId: '', capacidad_cartones: 500, estado: 'Activo' });
  const [guardandoCamion, setGuardandoCamion] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  // Ruta (formulario)
  const [isAddingRuta, setIsAddingRuta] = useState(false);
  const [editandoRutaId, setEditandoRutaId] = useState<string | null>(null);
  const [newRuta, setNewRuta] = useState({
    nombre: '', vendedor_asignado: '', dias_frecuencia: '', kilometraje_aprox: 0,
    cliente_ids: [] as string[], camion_id: '', vendedores: [] as string[]
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [resCam, resRutas, resClientes, resUsers] = await Promise.all([
        fetch('/api/logistica/camiones'),
        fetch('/api/rutas'),
        fetch('/api/clientes', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/users', { headers: sessionHeaders(currentUser.id) })
      ]);
      if (resCam.ok) setCamiones(await resCam.json());
      if (resRutas.ok) setRutas(await resRutas.json());
      if (resClientes.ok) setClientes(await resClientes.json());
      if (resUsers.ok) setUsuarios(await resUsers.json());
    } catch (err) {
      console.error(err);
      toast.error('Error al cargar flota y rutas.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const canEdit = currentUser.role === 'Admin' || currentUser.role === 'Despachador';

  const crearCamion = async () => {
    const nombre = camionNombre.trim();
    if (!nombre) return toast.error('Ingresa el nombre del camión');
    setCreandoCamion(true);
    try {
      const res = await fetch('/api/logistica/camiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre,
          placa: camionPlaca.trim() || undefined,
          capacidad_cartones: camionCapacidad,
          camioneroId: camionCamioneroId || null,
          estado: camionEstado,
        })
      });
      if (res.ok) { toast.success('Camión creado'); await fetchData(); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setCreandoCamion(false);
    setCamionModal(false);
  };

  const camioneros = usuarios.filter((u: any) => esCamionero(u));

  const camionesFiltrados = camiones.filter((c: any) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return c.nombre.toLowerCase().includes(q) || String(c.placa || '').toLowerCase().includes(q);
  });

  const iniciarEdicionCamion = (c: any) => {
    setEditandoCamionId(c.id);
    setEditCamion({
      nombre: c.nombre || '',
      placa: c.placa || '',
      camioneroId: c.camioneroId || '',
      capacidad_cartones: Number(c.capacidad_cartones ?? 500),
      estado: c.estado || 'Activo',
    });
  };

  const cancelarEdicionCamion = () => {
    setEditandoCamionId(null);
    setEditCamion({ nombre: '', placa: '', camioneroId: '', capacidad_cartones: 500, estado: 'Activo' });
  };

  const guardarCamion = async (id: string) => {
    if (!editCamion.nombre.trim()) return toast.error('El nombre del camión es requerido');
    setGuardandoCamion(true);
    try {
      const res = await fetch(`/api/logistica/camiones/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editCamion, camioneroId: editCamion.camioneroId || null })
      });
      if (!res.ok) { const d = await res.json(); return toast.error(`Error: ${d.error}`); }
      toast.success('Camión actualizado');
      cancelarEdicionCamion();
      await fetchData();
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setGuardandoCamion(false);
  };

  const eliminarCamion = async (c: any) => {
    if (!window.confirm(`¿Eliminar el camión "${c.nombre}"?`)) return;
    try {
      const res = await fetch(`/api/logistica/camiones/${c.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); return toast.error(`Error: ${d.error}`); }
      toast.success('Camión eliminado');
      await fetchData();
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
  };

  const parseIDs = (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  };

  const vendedoresDisponibles = usuarios.filter((u: any) => esVendedor(u));
  const nombreDe = (id: string) => usuarios.find((u: any) => u.id === id)?.name || '';

  const editarRuta = (r: any) => {
    setEditandoRutaId(r.id);
    setNewRuta({
      nombre: r.nombre || '',
      vendedor_asignado: r.vendedor_asignado || '',
      dias_frecuencia: r.dias_frecuencia || '',
      kilometraje_aprox: r.kilometraje_aprox || 0,
      cliente_ids: parseIDs(r.cliente_ids),
      camion_id: r.camion_id || '',
      vendedores: parseIDs(r.vendedores),
    });
    setIsAddingRuta(true);
  };

  const cancelarEdicionRuta = () => {
    setIsAddingRuta(false);
    setEditandoRutaId(null);
    setNewRuta({ nombre: '', vendedor_asignado: '', dias_frecuencia: '', kilometraje_aprox: 0, cliente_ids: [], camion_id: '', vendedores: [] });
  };

  const toggleEnLista = (lista: string[], v: string) =>
    lista.includes(v) ? lista.filter(x => x !== v) : [...lista, v];

  // Días de frecuencia como chips de la semana (guardados así: "Lunes,Miércoles,Viernes").
  const DIAS_FREC = [
    { token: 'L', full: 'Lunes' }, { token: 'M', full: 'Martes' }, { token: 'X', full: 'Miércoles' },
    { token: 'J', full: 'Jueves' }, { token: 'V', full: 'Viernes' }, { token: 'S', full: 'Sábado' }, { token: 'D', full: 'Domingo' }
  ];
  const parseDiasFrecuencia = (raw: string): number[] => {
    const mapa: Record<string, number> = {
      l: 0, lunes: 0, m: 1, martes: 1, x: 2, mi: 2, mie: 2, mié: 2, miér: 2, miercoles: 2, miércoles: 2,
      j: 3, jueves: 3, v: 4, viernes: 4, s: 5, sá: 5, sab: 5, sáb: 5, sabado: 5, sábado: 5, d: 6, dom: 6, domingo: 6
    };
    return [...new Set(String(raw || '').toLowerCase().split(/[\s,;./-]+/).filter(Boolean).map(t => mapa[t] as number).filter((x: any) => x !== undefined))].sort((a: any, b: any) => a - b) as number[];
  };
  const diasSeleccionados = parseDiasFrecuencia(newRuta.dias_frecuencia || '');
  const toggleDia = (idx: number) => {
    const sel = diasSeleccionados.includes(idx)
      ? diasSeleccionados.filter(i => i !== idx)
      : [...diasSeleccionados, idx];
    sel.sort((a: any, b: any) => a - b);
    setNewRuta({ ...newRuta, dias_frecuencia: sel.map(i => DIAS_FREC[i].full).join(',') });
  };

  // Clientes activos agrupados por geografía (provincia → cantón), para elegir la entrega.
  const clientesGeoGrupos = (() => {
    const activos = clientes.filter((c: any) => c.estado !== 'Inactivo');
    const grupos = new globalThis.Map<string, { provincia: string; canton: string; distrito: string; lista: any[] }>();
    for (const c of [...activos].sort((a: any, b: any) => (a.nombre || '').localeCompare(b.nombre || ''))) {
      const provincia = String(c.provincia || '').trim() || 'Sin provincia';
      const canton = String(c.canton || '').trim();
      const distrito = String(c.distrito || '').trim();
      const key = `${provincia}|${canton}|${distrito}`;
      if (!grupos.has(key)) grupos.set(key, { provincia, canton, distrito, lista: [] });
      grupos.get(key)!.lista.push(c);
    }
    return Array.from(grupos.values()).sort((a: any, b: any) => {
      const pa = a.provincia === 'Sin provincia' ? 1 : 0, pb = b.provincia === 'Sin provincia' ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return [a.provincia, a.canton, a.distrito].join('|').localeCompare([b.provincia, b.canton, b.distrito].join('|'));
    });
  })();

  const handleAddRuta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuta.nombre.trim()) return;
    try {
      const url = editandoRutaId ? `/api/rutas/${editandoRutaId}` : '/api/rutas';
      const res = await fetch(url, {
        method: editandoRutaId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: newRuta.nombre.trim(),
          vendedor_asignado: newRuta.vendedor_asignado,
          dias_frecuencia: newRuta.dias_frecuencia,
          kilometraje_aprox: newRuta.kilometraje_aprox,
          cliente_ids: newRuta.cliente_ids,
          camion_id: newRuta.camion_id || null,
          vendedores: newRuta.vendedores,
        })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error guardando ruta'); }
      toast.success(editandoRutaId ? 'Ruta actualizada.' : 'Ruta creada.');
      await fetchData();
      cancelarEdicionRuta();
    } catch (err: any) { toast.error(`Error guardando ruta: ${err.message}`); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in pb-20">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Flota y Rutas</h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Camiones registrados y rutas de distribución con sus clientes
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input
              value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o placa…"
              className="pl-8 pr-3 py-2 rounded-lg text-sm outline-none w-52"
              style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
            />
          </div>
          {canEdit && (
            <button
              onClick={() => { setCamionNombre(''); setCamionPlaca(''); setCamionCapacidad(500); setCamionCamioneroId(''); setCamionEstado('Activo'); setCamionModal(true); }}
              className="btn-neutral text-sm flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Camión
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => (isAddingRuta ? cancelarEdicionRuta() : setIsAddingRuta(true))}
              className={cn("flex items-center px-4 py-2.5 rounded-xl font-bold transition-all shadow-sm text-sm", isAddingRuta ? "" : "text-white")}
              style={isAddingRuta ? { background: 'var(--bg-muted)', color: 'var(--text-secondary)' } : { background: 'var(--brand-primary)' }}
            >
              {isAddingRuta ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              {isAddingRuta ? "Cancelar" : "Nueva Ruta"}
            </button>
          )}
        </div>
      </div>

      <FranjaProceso actual="ruta" />

      {/* Flota de camiones */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        <div className="px-5 py-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--border-default)' }}>
          <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Truck className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
            Camiones
          </h3>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {busqueda.trim() ? `${camionesFiltrados.length} de ${camiones.length}` : `${camiones.length} registrado(s)`}
          </span>
        </div>
        <div className="px-5 py-2 text-[11px] border-b" style={{ background: 'var(--bg-elevated, var(--bg-muted))', color: 'var(--text-muted)', borderColor: 'var(--border-default)' }}>
          La ruta por defecto es la que la Guía de Despacho autocompleta al elegir este camión.
        </div>
        {isLoading ? (
          <BloqueCarga />
        ) : camiones.length === 0 ? (
          <p className="p-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            Sin camiones registrados. Cree uno con «+ Camión».
          </p>
        ) : camionesFiltrados.length === 0 ? (
          <p className="p-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            Ningún camión coincide con «{busqueda}».
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)' }}>
                <th className="py-2 px-5">Nombre</th><th className="py-2">Placa</th>
                <th className="py-2">Comercial asignado</th><th className="py-2">Ruta por defecto</th>
                <th className="py-2">Guía activa</th><th className="py-2">Capacidad</th>
                <th className="py-2">Estado</th><th className="py-2 pr-5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {camionesFiltrados.map((c: any) => (
                <React.Fragment key={c.id}>
                  <tr style={{ borderBottom: '1px dashed var(--border-muted, var(--border-default))' }}>
                    {editandoCamionId === c.id ? (
                      <>
                        <td className="py-1.5 px-5">
                          <input value={editCamion.nombre} onChange={e => setEditCamion({ ...editCamion, nombre: e.target.value })}
                            className="w-full rounded px-2 py-1 text-sm outline-none" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                        </td>
                        <td className="py-1.5">
                          <input value={editCamion.placa} onChange={e => setEditCamion({ ...editCamion, placa: e.target.value })}
                            className="w-full rounded px-2 py-1 text-sm outline-none" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                        </td>
                        <td className="py-1.5">
                          <select value={editCamion.camioneroId} onChange={e => setEditCamion({ ...editCamion, camioneroId: e.target.value })}
                            className="w-full rounded px-2 py-1 text-sm outline-none" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                            <option value="">Sin asignar</option>
                            {camioneros.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5" style={{ color: 'var(--text-secondary)' }}>{c.ruta_defecto || 'Sin ruta'}</td>
                        <td className="py-1.5" style={{ color: 'var(--text-muted)' }}>{c.guiaActiva?.consecutivo || 'Sin guía'}</td>
                        <td className="py-1.5">
                          <input type="number" min={1} value={editCamion.capacidad_cartones || ''}
                            onChange={e => setEditCamion({ ...editCamion, capacidad_cartones: Number(e.target.value) })}
                            className="w-24 rounded px-2 py-1 text-sm outline-none" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                        </td>
                        <td className="py-1.5">
                          <select value={editCamion.estado} onChange={e => setEditCamion({ ...editCamion, estado: e.target.value })}
                            className="w-full rounded px-2 py-1 text-sm outline-none" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                            <option>Activo</option><option>Inactivo</option><option>EnMantenimiento</option>
                          </select>
                        </td>
                        <td className="py-1.5 pr-5">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => guardarCamion(c.id)} disabled={guardandoCamion} title="Guardar"
                              className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={cancelarEdicionCamion} title="Cancelar"
                              className="p-1.5 rounded-lg bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 px-5 font-semibold" style={{ color: 'var(--text-primary)' }}>{c.nombre}</td>
                        <td className="py-2" style={{ color: 'var(--text-secondary)' }}>{c.placa || '—'}</td>
                        <td className="py-2">
                          {c.camioneroNombre ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{c.camioneroNombre}</span>
                          ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Sin asignar</span>}
                        </td>
                        <td className="py-2" style={{ color: 'var(--text-secondary)' }}>{c.ruta_defecto || 'Sin ruta'}</td>
                        <td className="py-2" style={{ color: 'var(--text-muted)' }}>
                          {c.guiaActiva?.consecutivo
                            ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{c.guiaActiva.consecutivo}</span>
                            : <span>Sin guía</span>}
                        </td>
                        <td className="py-2" style={{ color: 'var(--text-secondary)' }}>{Number(c.capacidad_cartones ?? 0).toLocaleString()} ct</td>
                        <td className="py-2">
                          <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold',
                            c.estado === 'Inactivo' ? 'bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300'
                              : c.estado === 'EnMantenimiento' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300')}>
                            {c.estado || 'Activo'}
                          </span>
                        </td>
                        <td className="py-2 pr-5">
                          {canEdit && (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => iniciarEdicionCamion(c)} title="Editar"
                                className="p-1.5 rounded-lg bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => eliminarCamion(c)} title="Eliminar"
                                className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Rutas */}
      <div className="space-y-6 animate-in fade-in">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Rutas Registradas</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Administra las rutas de distribución y sus clientes asignados</p>
          </div>
        </div>

        {isAddingRuta && (
          <form onSubmit={handleAddRuta} className="rounded-2xl p-6 shadow-sm animate-in space-y-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <h4 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
              {editandoRutaId ? 'Editar ruta' : 'Nueva ruta'}
            </h4>

            {/* Zona 1 · Datos del recorrido */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Route className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
                <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Datos del recorrido</p>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>nombre, días, camión y vendedores</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Nombre Ruta *</label>
                  <input
                    required type="text" value={newRuta.nombre}
                    onChange={e => setNewRuta({ ...newRuta, nombre: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    placeholder="Ej. Ruta San José Norte"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Días de frecuencia</label>
                  <div className="rounded-lg px-2 py-1.5 flex flex-wrap gap-1.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    {DIAS_FREC.map((d, i) => {
                      const activo = diasSeleccionados.includes(i);
                      return (
                        <button
                          key={d.token} type="button" onClick={() => toggleDia(i)} title={d.full}
                          className="w-8 h-8 rounded-full text-xs font-bold transition-all"
                          style={activo
                            ? { background: 'var(--brand-primary)', color: '#fff' }
                            : { background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                        >
                          {d.token}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {newRuta.dias_frecuencia ? `Guardado como: ${newRuta.dias_frecuencia}` : 'Sin días definidos'}
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Km Aprox</label>
                  <input
                    type="number" value={newRuta.kilometraje_aprox || ''}
                    onChange={e => setNewRuta({ ...newRuta, kilometraje_aprox: Number(e.target.value) })}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    placeholder="45"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Camión</label>
                  <select
                    value={newRuta.camion_id}
                    onChange={e => setNewRuta({ ...newRuta, camion_id: e.target.value })}
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                  >
                    <option value="">Sin camión asignado</option>
                    {camiones.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}{c.placa ? ` (${c.placa})` : ''}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Vendedores</label>
                <div className="rounded-lg p-2 max-h-40 overflow-y-auto" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                  {vendedoresDisponibles.length === 0 && (
                    <p className="text-xs px-1 py-1" style={{ color: 'var(--text-muted)' }}>No hay vendedores registrados.</p>
                  )}
                  {vendedoresDisponibles.map(u => (
                    <label key={u.id} className="flex items-center gap-2 px-1 py-1.5 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                      <input
                        type="checkbox"
                        checked={newRuta.vendedores.includes(u.id)}
                        onChange={() => setNewRuta({ ...newRuta, vendedores: toggleEnLista(newRuta.vendedores, u.id) })}
                      />
                      <span className="truncate">{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Zona 2 · Clientes a visitar */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <MapPin className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
                <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Clientes a visitar</p>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{newRuta.cliente_ids.length} seleccionado(s)</span>
                <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(184,134,11,0.12)', color: '#8a6d0a', border: '1px solid rgba(184,134,11,0.35)' }}>
                  guardado en la ruta → la Guía de Despacho lo precarga
                </span>
              </div>
              <div className="rounded-lg p-3 max-h-72 overflow-y-auto space-y-3" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                {clientesGeoGrupos.length === 0 && (
                  <p className="text-xs px-1 py-1" style={{ color: 'var(--text-muted)' }}>No hay clientes activos.</p>
                )}
                {clientesGeoGrupos.map(({ provincia, canton, distrito, lista }) => (
                  <div key={`${provincia}|${canton}|${distrito}`}>
                    <span className="text-[11px] font-bold uppercase tracking-wide opacity-70">
                      {provincia}{canton ? ` › ${canton}` : ''}{distrito ? ` › ${distrito}` : ''} <span className="opacity-60">({lista.length})</span>
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {lista.map((c: any) => {
                        const nombreRutaEdit = editandoRutaId ? (rutas.find(r => r.id === editandoRutaId)?.nombre || '') : newRuta.nombre;
                        const enOtraRuta = !!c.ruta && c.ruta !== nombreRutaEdit;
                        const sel = newRuta.cliente_ids.includes(c.id);
                        return (
                          <button
                            key={c.id} type="button"
                            disabled={enOtraRuta && !sel}
                            title={enOtraRuta ? `Ya está en «${c.ruta}»` : undefined}
                            onClick={() => setNewRuta({ ...newRuta, cliente_ids: toggleEnLista(newRuta.cliente_ids, c.id) })}
                            className="px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all disabled:cursor-not-allowed"
                            style={sel
                              ? { background: 'var(--brand-primary)', color: '#fff' }
                              : { background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', opacity: enOtraRuta ? 0.45 : 1 }}
                          >
                            {sel && <Check className="w-3 h-3 inline mr-1" />}{c.nombre}
                            {enOtraRuta && <span className="ml-1 opacity-70">en «{c.ruta}»</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl p-3 text-xs flex items-start gap-2" style={{ background: 'rgba(184,134,11,0.1)', border: '1px solid rgba(184,134,11,0.35)', color: 'var(--text-secondary)' }}>
                <Route className="w-4 h-4 shrink-0" style={{ color: '#b45309' }} />
                <span className="flex-1">
                  Lo que definís acá (<strong>vendedor, camión, días y clientes</strong>) es lo que la Guía de Despacho autocompleta al crear la entrega: la guía sale casi llena.
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={cancelarEdicionRuta} className="btn-neutral">Cancelar</button>
              <button type="submit" className="btn-primary">
                <CheckCircle2 className="w-4 h-4 mr-1 inline" /> {editandoRutaId ? 'Guardar Cambios' : 'Crear Ruta'}
              </button>
            </div>
          </form>
        )}

        {isLoading ? (
          <BloqueCarga />
        ) : rutas.length === 0 ? (
          <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <Map className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Sin rutas registradas</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Crea la primera ruta para comenzar a organizar la distribución.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rutas.map(ruta => {
              const clientesEnRuta = clientes.filter(c => c.ruta === ruta.nombre);
              const camionRuta = camiones.find((c: any) => c.id === ruta.camion_id) || null;
              const idsVendedores = parseIDs(ruta.vendedores);
              const nombresVendedores = idsVendedores.map(nombreDe).filter(Boolean);
              return (
                <div key={ruta.id} className="rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                  <div className="flex justify-between items-start mb-3">
                    <div className="min-w-0">
                      <h4 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{ruta.nombre}</h4>
                      {nombresVendedores.length > 0 && (
                        <p className="text-sm mt-1 flex items-center truncate" style={{ color: 'var(--text-muted)' }}>
                          <Users className="w-3.5 h-3.5 mr-1 shrink-0" /> {nombresVendedores.join(', ')}
                        </p>
                      )}
                      {camionRuta && (
                        <p className="text-sm mt-0.5 flex items-center truncate" style={{ color: 'var(--text-muted)' }}>
                          <Truck className="w-3.5 h-3.5 mr-1 shrink-0" /> {camionRuta.nombre}{camionRuta.placa ? ` (${camionRuta.placa})` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={cn("px-2.5 py-1 rounded-full text-xs font-bold", ruta.estado === 'Activa' ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500")}>
                        {ruta.estado}
                      </span>
                      {canEdit && (
                        <button onClick={() => editarRuta(ruta)} className="btn-neutral btn-sm" title="Editar ruta">Editar</button>
                      )}
                    </div>
                  </div>
                  <div className="pt-3 space-y-2" style={{ borderTop: '1px solid var(--border-muted, var(--border-default))' }}>
                    <div className="flex justify-between text-sm">
                      <span style={{ color: 'var(--text-muted)' }}>Clientes asignados</span>
                      <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{clientesEnRuta.length}</span>
                    </div>
                    {ruta.dias_frecuencia && (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--text-muted)' }}>Frecuencia</span>
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{ruta.dias_frecuencia}</span>
                      </div>
                    )}
                    {ruta.kilometraje_aprox && (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--text-muted)' }}>Km aprox.</span>
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{ruta.kilometraje_aprox} km</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal nuevo camión */}
      {camionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setCamionModal(false)}>
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-xl animate-in zoom-in-95"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Truck className="w-4 h-4" /> Nuevo camión
              </h4>
              <button onClick={() => setCamionModal(false)} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Nombre del camión *</label>
                <input
                  type="text"
                  value={camionNombre}
                  onChange={e => setCamionNombre(e.target.value)}
                  placeholder="Ej. Camión Ruta 3"
                  autoFocus
                  className="w-full mt-1 input"
                  style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                  onKeyDown={e => { if (e.key === 'Enter') crearCamion(); }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Placa (opcional)</label>
                <input
                  type="text"
                  value={camionPlaca}
                  onChange={e => setCamionPlaca(e.target.value)}
                  placeholder="Ej. ABC-123"
                  className="w-full mt-1 input"
                  style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Capacidad (cartones)</label>
                <input
                  type="number"
                  value={camionCapacidad}
                  onChange={e => setCamionCapacidad(Number(e.target.value))}
                  className="w-full mt-1 input"
                  style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Comercial asignado</label>
                <select
                  value={camionCamioneroId}
                  onChange={e => setCamionCamioneroId(e.target.value)}
                  className="w-full mt-1 input"
                  style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                >
                  <option value="">Sin camionero asignado</option>
                  {camioneros.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Estado</label>
                <select
                  value={camionEstado}
                  onChange={e => setCamionEstado(e.target.value)}
                  className="w-full mt-1 input"
                  style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                >
                  <option>Activo</option><option>Inactivo</option><option>EnMantenimiento</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setCamionModal(false)} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                  Cancelar
                </button>
                <button onClick={crearCamion} disabled={creandoCamion} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>
                  {creandoCamion ? 'Creando...' : 'Crear camión'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
