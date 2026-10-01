import React, { useState, useEffect } from 'react';
import { Truck, Plus, Edit2, Trash2, Search, Check, X, Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { User } from '../types';

interface Props { currentUser: User; }

interface Camion {
  id: string;
  nombre: string;
  placa?: string;
  camioneroId?: string | null;
  camioneroNombre?: string | null;
  capacidad_cartones?: number;
  capacidadCartones?: number;
  estado?: string;
}

export default function AdminCamiones({ }: Props) {
  const [camiones, setCamiones] = useState<Camion[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ nombre: '', placa: '', camioneroId: '', capacidadCartones: 500, estado: 'Activo' });
  const [editForm, setEditForm] = useState({ nombre: '', placa: '', camioneroId: '', capacidadCartones: 500, estado: 'Activo' });

  const capacidad = (c: Camion): number => Number(c.capacidad_cartones ?? c.capacidadCartones ?? 500);

  const cargar = async () => {
    setLoading(true);
    try {
      const [cRes, uRes] = await Promise.all([
        fetch('/api/camiones'),
        fetch('/api/users'),
      ]);
      if (cRes.ok) setCamiones(await cRes.json());
      if (uRes.ok) setUsers(await uRes.json());
    } catch { toast.error('No se pudieron cargar los camiones.'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const camioneros = users.filter((u: any) =>
    u.role === 'Camionero' || (u.roles || '').split(',').map((r: string) => r.trim()).includes('Camionero')
  );

  const agregar = async () => {
    if (!form.nombre.trim()) return toast.error('El nombre del camión es requerido');
    const res = await fetch('/api/camiones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, nombre: form.nombre.trim(), camioneroId: form.camioneroId || null }),
    });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'No se pudo crear el camión');
    toast.success('Camión creado');
    setIsAdding(false);
    setForm({ nombre: '', placa: '', camioneroId: '', capacidadCartones: 500, estado: 'Activo' });
    cargar();
  };

  const iniciarEdicion = (c: Camion) => {
    setEditingId(c.id);
    setEditForm({ nombre: c.nombre, placa: c.placa || '', camioneroId: c.camioneroId || '', capacidadCartones: capacidad(c), estado: c.estado || 'Activo' });
  };

  const guardar = async (c: Camion) => {
    const res = await fetch(`/api/camiones/${c.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editForm, camioneroId: editForm.camioneroId || null }),
    });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'No se pudo actualizar el camión');
    toast.success('Camión actualizado');
    setEditingId(null);
    cargar();
  };

  const eliminar = async (c: Camion) => {
    if (!window.confirm(`¿Eliminar el camión "${c.nombre}"?`)) return;
    const res = await fetch(`/api/camiones/${c.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'No se pudo eliminar el camión');
    toast.success('Camión eliminado');
    cargar();
  };

  const filtered = camiones.filter(c =>
    c.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.placa || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
          <h2 className="text-2xl font-black text-neutral-800 dark:text-white">Camiones</h2>
        </div>
        <button onClick={() => setIsAdding(true)} className="flex items-center gap-1 text-white px-3 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
          <Plus className="w-4 h-4" /> Nuevo Camión
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
        <input
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Buscar camión..."
          className="w-full pl-9 pr-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm bg-white dark:bg-neutral-800 text-neutral-800 dark:text-white"
        />
      </div>

      {isAdding && (
        <div className="bg-white dark:bg-neutral-800 border-2 border-emerald-400 rounded-xl p-4 space-y-3">
          <h3 className="font-bold text-emerald-700 dark:text-emerald-400">Nuevo Camión</h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre *" className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            <input value={form.placa} onChange={e => setForm({ ...form, placa: e.target.value })} placeholder="Placa" className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            <select value={form.camioneroId} onChange={e => setForm({ ...form, camioneroId: e.target.value })} className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
              <option value="">Sin camionero asignado</option>
              {camioneros.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <div className="relative">
              <Gauge className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input type="number" min={1} value={form.capacidadCartones || ''} onChange={e => setForm({ ...form, capacidadCartones: Number(e.target.value) })} placeholder="Capacidad (cartones)" className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            </div>
            <select value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value })} className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
              <option value="Activo">Activo</option>
              <option value="Inactivo">Inactivo</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={agregar} className="flex items-center gap-1 text-white px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
              <Check className="w-4 h-4" /> Guardar
            </button>
            <button onClick={() => setIsAdding(false)} className="flex items-center gap-1 bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 px-4 py-2 rounded-lg text-sm font-bold">
              <X className="w-4 h-4" /> Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-neutral-400">Cargando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-neutral-400">No hay camiones</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 dark:bg-neutral-750 border-b dark:border-neutral-700">
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Nombre</th>
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Placa</th>
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Camionero</th>
                <th className="text-right px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Capacidad</th>
                <th className="text-center px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Estado</th>
                <th className="text-center px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-750">
                  {editingId === c.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input value={editForm.nombre} onChange={e => setEditForm({ ...editForm, nombre: e.target.value })} className="w-full px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                      </td>
                      <td className="px-4 py-2">
                        <input value={editForm.placa} onChange={e => setEditForm({ ...editForm, placa: e.target.value })} className="w-full px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                      </td>
                      <td className="px-4 py-2">
                        <select value={editForm.camioneroId} onChange={e => setEditForm({ ...editForm, camioneroId: e.target.value })} className="px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
                          <option value="">Sin asignar</option>
                          {camioneros.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input type="number" min={1} value={editForm.capacidadCartones || ''} onChange={e => setEditForm({ ...editForm, capacidadCartones: Number(e.target.value) })} className="w-24 px-2 py-1 border rounded text-sm text-right dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <select value={editForm.estado} onChange={e => setEditForm({ ...editForm, estado: e.target.value })} className="px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
                          <option>Activo</option><option>Inactivo</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => guardar(c)} className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200" title="Guardar"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} className="p-1.5 rounded-lg bg-neutral-100 text-neutral-500 hover:bg-neutral-200" title="Cancelar"><X className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 font-bold text-neutral-800 dark:text-white">{c.nombre}</td>
                      <td className="px-4 py-2 text-neutral-500 dark:text-neutral-300">{c.placa || '—'}</td>
                      <td className="px-4 py-2">
                        {c.camioneroNombre ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{c.camioneroNombre}</span>
                        ) : (<span className="text-xs text-neutral-400">Sin asignar</span>)}
                      </td>
                      <td className="px-4 py-2 text-right text-neutral-700 dark:text-neutral-300">{capacidad(c).toLocaleString()} cartones</td>
                      <td className="px-4 py-2 text-center">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', c.estado === 'Inactivo' ? 'bg-neutral-200 text-neutral-500' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300')}>{c.estado}</span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => iniciarEdicion(c)} className="p-1.5 rounded-lg bg-neutral-100 text-neutral-600 hover:bg-neutral-200" title="Editar"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => eliminar(c)} className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}