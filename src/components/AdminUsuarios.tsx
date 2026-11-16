import React, { useState, useEffect } from 'react';
import { User as UserIcon, Plus, Edit2, Trash2, Search, Check, X, ShieldCheck, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { User } from '../types';
import { sessionHeaders } from '../lib/session';

interface Props { currentUser: User; }

interface Usuario {
  id: string;
  name: string;
  email: string;
  role: string;
  roles?: string;
  activo?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin',
  Socio: 'Socio',
  Comercial: 'Comercial',
  Despachador: 'Encargado de Galerón',
  Bodeguero: 'Bodeguero',
};

const ROLES = Object.keys(ROLE_LABELS);

const rolesCsv = (u: Usuario) => (u.roles || '').split(',').map(r => r.trim()).filter(Boolean);

export default function AdminUsuarios({ currentUser }: Props) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'Comercial', roles: [] as string[], password: '', activo: true });
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', roles: [] as string[], password: '', activo: true });
  const [confirmUser, setConfirmUser] = useState<Usuario | null>(null);
  const [bajaProcesando, setBajaProcesando] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users', { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setUsuarios(await res.json());
    } catch { toast.error('No se pudieron cargar los usuarios.'); }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const toggleRol = (rol: string) => {
    setForm(f => ({ ...f, roles: f.roles.includes(rol) ? f.roles.filter(r => r !== rol) : [...f.roles, rol] }));
  };
  const toggleRolEdit = (rol: string) => {
    setEditForm(f => ({ ...f, roles: f.roles.includes(rol) ? f.roles.filter(r => r !== rol) : [...f.roles, rol] }));
  };

  const agregar = async () => {
    if (!form.name.trim() || !form.email.trim()) return toast.error('Nombre y email son requeridos');
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: sessionHeaders(currentUser.id, true),
      body: JSON.stringify({
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        roles: form.roles.join(','),
        password: form.password || '1234',
        activo: form.activo,
      }),
    });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'No se pudo crear el usuario');
    toast.success('Usuario creado');
    setIsAdding(false);
    setForm({ name: '', email: '', role: 'Comercial', roles: [], password: '', activo: true });
    cargar();
  };

  const iniciarEdicion = (u: Usuario) => {
    setEditingId(u.id);
    setEditForm({ name: u.name, email: u.email, role: u.role, roles: rolesCsv(u), password: '', activo: u.activo !== false });
  };

  const guardar = async (u: Usuario) => {
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PUT',
      headers: sessionHeaders(currentUser.id, true),
      body: JSON.stringify({
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        role: editForm.role,
        roles: editForm.roles.join(','),
        activo: editForm.activo,
        password: editForm.password || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'No se pudo actualizar el usuario');
    toast.success('Usuario actualizado');
    setEditingId(null);
    cargar();
  };

  const desactivar = async (u: Usuario) => {
    setBajaProcesando(true);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: 'PUT',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ activo: false }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'No se pudo desactivar el usuario');
      toast.success(`${u.name} quedó inactivo (conserva su historia)`);
      setConfirmUser(null);
      cargar();
    } finally { setBajaProcesando(false); }
  };

  const eliminar = async (u: Usuario) => {
    setBajaProcesando(true);
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE', headers: sessionHeaders(currentUser.id) });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'No se pudo eliminar el usuario');
      toast.success('Usuario eliminado');
      setConfirmUser(null);
      cargar();
    } finally { setBajaProcesando(false); }
  };

  const filtered = usuarios.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
          <h2 className="text-2xl font-black text-neutral-800 dark:text-white">Usuarios y Roles</h2>
        </div>
        <button onClick={() => setIsAdding(true)} className="flex items-center gap-1 text-white px-3 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
          <Plus className="w-4 h-4" /> Nuevo Usuario
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
        <input
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Buscar usuario..."
          className="w-full pl-9 pr-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm bg-white dark:bg-neutral-800 text-neutral-800 dark:text-white"
        />
      </div>

      {isAdding && (
        <div className="bg-white dark:bg-neutral-800 border-2 border-emerald-400 rounded-xl p-4 space-y-3">
          <h3 className="font-bold text-emerald-700 dark:text-emerald-400">Nuevo Usuario</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nombre *" className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email *" className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Contraseña (default 1234)" className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            </div>
            <div className="sm:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400 mb-1">Roles adicionales</p>
              <div className="flex flex-wrap gap-2">
                {ROLES.map(r =>
                  r !== form.role && (
                    <button key={r} onClick={() => toggleRol(r)}
                      className={cn('px-2 py-1 rounded-full text-xs font-bold border transition-colors',
                        form.roles.includes(r) ? 'border-emerald-400 text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/20' : 'border-neutral-300 text-neutral-500 hover:border-neutral-400')}>
                      {ROLE_LABELS[r]}
                    </button>
                  )
                )}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300 sm:col-span-2">
              <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4" />
              Cuenta activa
            </label>
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

      <div className="admin-table-scroll bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700">
        {loading ? (
          <div className="p-8 text-center text-neutral-400">Cargando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-neutral-400">No hay usuarios</div>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-neutral-50 dark:bg-neutral-750 border-b dark:border-neutral-700">
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Nombre</th>
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Email</th>
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Rol principal</th>
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Roles</th>
                <th className="text-center px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Estado</th>
                <th className="text-center px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const rolRoles = rolesCsv(u);
                const todos = [u.role, ...rolRoles];
                return (
                  <tr key={u.id} className={cn('border-b dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-750', u.activo === false && 'opacity-60')}>
                    {editingId === u.id ? (
                      <>
                        <td className="px-4 py-2">
                          <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                        </td>
                        <td className="px-4 py-2">
                          <input value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className="w-full px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                        </td>
                        <td className="px-4 py-2">
                          <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} className="px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
                            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {ROLES.filter(r => r !== editForm.role).map(r => (
                              <button key={r} onClick={() => toggleRolEdit(r)}
                                className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-bold border',
                                  editForm.roles.includes(r) ? 'border-emerald-400 text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/20' : 'border-neutral-300 text-neutral-500')}>
                                {ROLE_LABELS[r]}
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-1 mt-1">
                            <input value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })} placeholder="Nueva clave (opcional)" className="w-full px-2 py-1 border rounded text-xs dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <label className="inline-flex items-center gap-1 text-xs">
                            <input type="checkbox" checked={editForm.activo} onChange={e => setEditForm({ ...editForm, activo: e.target.checked })} className="w-4 h-4" />
                            {editForm.activo ? 'Activo' : 'Inactivo'}
                          </label>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => guardar(u)} className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200" title="Guardar"><Check className="w-4 h-4" /></button>
                            <button onClick={() => setEditingId(null)} className="p-1.5 rounded-lg bg-neutral-100 text-neutral-500 hover:bg-neutral-200" title="Cancelar"><X className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 font-bold text-neutral-800 dark:text-white">{u.name}</td>
                        <td className="px-4 py-2 text-neutral-500 dark:text-neutral-300">{u.email}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{ROLE_LABELS[u.role] || u.role}</span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {todos.length === 1 && <span className="text-xs text-neutral-400">—</span>}
                            {todos.map(r => (
                              <span key={r} className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', r === u.role ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300')}>{ROLE_LABELS[r] || r}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', u.activo === false ? 'bg-neutral-200 text-neutral-500' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300')}>{u.activo === false ? 'Inactivo' : 'Activo'}</span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => iniciarEdicion(u)} className="p-1.5 rounded-lg bg-neutral-100 text-neutral-600 hover:bg-neutral-200" title="Editar"><Edit2 className="w-4 h-4" /></button>
                            {u.email !== currentUser.email && (
                              <button onClick={() => setConfirmUser(u)} className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200" title="Dar de baja"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {confirmUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => !bajaProcesando && setConfirmUser(null)} />
          <div className="relative bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5 max-w-md w-full shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-3">
                <div className="p-2 rounded-lg bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300"><Trash2 className="w-5 h-5" /></div>
                <div>
                  <h3 className="text-lg font-black text-neutral-800 dark:text-white">Dar de baja a {confirmUser.name}</h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                    La baja definitiva borra al usuario. Si ya tiene actividad (granjas, camiones, ventas, facturas…), solo podrás <b>desactivarlo</b>.
                  </p>
                </div>
              </div>
              <button onClick={() => setConfirmUser(null)} disabled={bajaProcesando} className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex flex-col gap-2 mt-4">
              <button onClick={() => desactivar(confirmUser)} disabled={bajaProcesando} className="btn-secondary">
                <UserIcon className="w-4 h-4" /> Desactivar cuenta (recomendado)
              </button>
              <button onClick={() => eliminar(confirmUser)} disabled={bajaProcesando} className="btn-danger">
                <Trash2 className="w-4 h-4" /> {bajaProcesando ? 'Procesando...' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
