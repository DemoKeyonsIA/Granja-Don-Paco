import React, { useState, useEffect } from 'react';
import { Package, Plus, Edit2, Trash2, Search, Check, X, DollarSign, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { rotuloFactor } from '../lib/kilos';
import Breadcrumb from './Breadcrumb';
import { User } from '../types';
import { sessionHeaders } from '../lib/session';

interface Props { currentUser: User; }

interface ProductoCatalogo {
  id: string;
  nombre: string;
  descripcion: string;
  unidad: string;
  kgPorCarton?: number;
  precioBase: number;
  categoria: string;
  estado: string;
  fechaCreacion: string;
  vidaUtilDias?: number;
  diasAvisoVencimiento?: number;
}

interface TipoCarton {
  id: string;
  nombre: string;
  unidades: number;
  estado: string;
}

export default function ProductosCatalogo({ currentUser }: Props) {
  const [productos, setProductos] = useState<ProductoCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ nombre: '', descripcion: '', unidad: 'kg', kgPorCarton: 0, precioBase: 0, categoria: 'Huevos', vidaUtilDias: 28, diasAvisoVencimiento: 7 });
  const [editForm, setEditForm] = useState({ nombre: '', descripcion: '', unidad: 'kg', kgPorCarton: 0, precioBase: 0, categoria: 'Huevos', estado: 'Activo', vidaUtilDias: 28, diasAvisoVencimiento: 7 });

  const [tipos, setTipos] = useState<TipoCarton[]>([]);
  const [tipoForm, setTipoForm] = useState({ nombre: '', unidades: 30 });
  const [addingTipo, setAddingTipo] = useState(false);
  const [editandoTipoId, setEditandoTipoId] = useState<string | null>(null);
  const [tipoEditForm, setTipoEditForm] = useState({ nombre: '', unidades: 30, estado: 'Activo' });

  const cargar = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/productos-catalogo', { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setProductos(await res.json());
    } catch { toast.error('No se pudo cargar el catálogo de productos.'); }
    setLoading(false);
  };

  const cargarTipos = async () => {
    try {
      const res = await fetch('/api/tipos-carton');
      if (res.ok) setTipos(await res.json());
    } catch { toast.error('No se pudieron cargar los tipos de cartón.'); }
  };

  useEffect(() => { cargar(); cargarTipos(); }, []);

  const agregarTipo = async () => {
    if (!tipoForm.nombre) { toast.error('Nombre es requerido'); return; }
    if (!(Number(tipoForm.unidades) > 0)) { toast.error('Unidades debe ser mayor a 0'); return; }
    const res = await fetch('/api/tipos-carton', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tipoForm)
    });
    if (res.ok) {
      toast.success('Tipo de cartón agregado');
      setAddingTipo(false);
      setTipoForm({ nombre: '', unidades: 30 });
      cargarTipos();
    } else {
      const e = await res.json();
      toast.error(e.error || 'Error al agregar');
    }
  };

  const eliminarTipo = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar "${nombre}"?`)) return;
    const res = await fetch(`/api/tipos-carton/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Tipo de cartón eliminado'); cargarTipos(); }
  };

  const iniciarEdicionTipo = (t: TipoCarton) => {
    setEditandoTipoId(t.id);
    setTipoEditForm({ nombre: t.nombre, unidades: t.unidades, estado: t.estado });
  };

  const guardarTipoEdicion = async (id: string) => {
    if (!tipoEditForm.nombre) { toast.error('Nombre es requerido'); return; }
    if (!(Number(tipoEditForm.unidades) > 0)) { toast.error('Unidades debe ser mayor a 0'); return; }
    const res = await fetch(`/api/tipos-carton/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tipoEditForm)
    });
    if (res.ok) {
      toast.success('Tipo de cartón actualizado');
      setEditandoTipoId(null);
      cargarTipos();
    } else {
      const e = await res.json();
      toast.error(e.error || 'Error al actualizar');
    }
  };

  const agregar = async () => {
    if (!form.nombre) { toast.error('Nombre es requerido'); return; }
    const res = await fetch('/api/productos-catalogo', {
      method: 'POST', headers: sessionHeaders(currentUser.id, true),
      body: JSON.stringify(form)
    });
    if (res.ok) {
      toast.success('Producto agregado al catálogo');
      setIsAdding(false);
      setForm({ nombre: '', descripcion: '', unidad: 'kg', kgPorCarton: 0, precioBase: 0, categoria: 'Huevos', vidaUtilDias: 28, diasAvisoVencimiento: 7 });
      cargar();
    } else {
      const e = await res.json();
      toast.error(e.error || 'Error al agregar');
    }
  };

  const guardarEdicion = async (id: string) => {
    const res = await fetch(`/api/productos-catalogo/${id}`, {
      method: 'PUT', headers: sessionHeaders(currentUser.id, true),
      body: JSON.stringify(editForm)
    });
    if (res.ok) {
      toast.success('Producto actualizado');
      setEditingId(null);
      cargar();
    }
  };

  const eliminar = async (id: string, nombre: string) => {
    if (!confirm(`¿Archivar "${nombre}"? Se conservará su historial y ya no podrá usarse en nuevas operaciones.`)) return;
    const res = await fetch(`/api/productos-catalogo/${id}`, { method: 'DELETE', headers: sessionHeaders(currentUser.id) });
    if (res.ok) { toast.success('Producto archivado'); cargar(); }
  };

  const iniciarEdicion = (p: ProductoCatalogo) => {
    setEditingId(p.id);
    setEditForm({ nombre: p.nombre, descripcion: p.descripcion, unidad: p.unidad, kgPorCarton: p.kgPorCarton ?? 0, precioBase: p.precioBase, categoria: p.categoria, estado: p.estado, vidaUtilDias: p.vidaUtilDias ?? 28, diasAvisoVencimiento: p.diasAvisoVencimiento ?? 7 });
  };

  const filtered = productos.filter(p =>
    p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.descripcion.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.categoria.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatCRC = (n: number) => `₡${n.toLocaleString()}`;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[
        { label: 'Operaciones', onClick: () => {} },
        { label: 'Catálogo de Productos' }
      ]} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
          <h2 className="text-2xl font-black text-neutral-800 dark:text-white">Catálogo de Productos</h2>
        </div>
        {currentUser.role === 'Admin' && (
          <button onClick={() => setIsAdding(true)} className="flex items-center gap-1 text-white px-3 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
            <Plus className="w-4 h-4" /> Nuevo Producto
          </button>
        )}
      </div>

      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Productos base del sistema. El precio base se usa cuando no hay lista de precios, ruta o excepción de cliente configurada.
      </p>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
        <input
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full pl-9 pr-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm bg-white dark:bg-neutral-800 text-neutral-800 dark:text-white"
        />
      </div>

      {isAdding && (
        <div className="bg-white dark:bg-neutral-800 border-2 border-emerald-400 rounded-xl p-4 space-y-3">
          <h3 className="font-bold text-emerald-700 dark:text-emerald-400">Nuevo Producto</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre *" className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            <input value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Descripción" className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            <div className="rounded-lg border px-3 py-2 text-sm text-neutral-600 dark:text-neutral-300">Unidad comercial: <strong>kilogramos (kg)</strong></div>
            <div>
              <input type="number" step="0.01" min={0} value={form.kgPorCarton || ''} onChange={e => setForm({ ...form, kgPorCarton: Number(e.target.value) })} placeholder="Peso por presentación (kg)" className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
              <p className="text-[10px] text-neutral-400 mt-0.5">Peso neto de una presentación, expresado en kilos. Se usa para calcular existencias en kg.</p>
            </div>
            <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
              <option value="Huevos">Huevos</option>
              <option value="Subproductos">Subproductos</option>
              <option value="Insumos">Insumos</option>
              <option value="Otros">Otros</option>
            </select>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input type="number" value={form.precioBase || ''} onChange={e => setForm({ ...form, precioBase: Number(e.target.value) })} placeholder="Precio base (₡)" className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            </div>
            <div>
              <input type="number" min={1} value={form.vidaUtilDias || ''} onChange={e => setForm({ ...form, vidaUtilDias: Number(e.target.value) })} placeholder="Vida útil (días)" className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
              <p className="text-[10px] text-neutral-400 mt-0.5">Vida útil en días (FEFO: vencimiento = empaque + vida útil)</p>
            </div>
            <div>
              <input type="number" min={0} value={form.diasAvisoVencimiento ?? ''} onChange={e => setForm({ ...form, diasAvisoVencimiento: Number(e.target.value) })} placeholder="Aviso antes de vencer (días)" className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
              <p className="text-[10px] text-neutral-400 mt-0.5">Días de aviso "por vencer" en bodega</p>
            </div>
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
          <div className="p-8 text-center text-neutral-400">No hay productos en el catálogo</div>
        ) : (
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="bg-neutral-50 dark:bg-neutral-750 border-b dark:border-neutral-700">
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Producto</th>
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Categoría</th>
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Unidad</th>
                <th className="text-right px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Kilos</th>
                <th className="text-right px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Precio Base</th>
                <th className="text-center px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Vida útil</th>
                <th className="text-center px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Estado</th>
                {currentUser.role === 'Admin' && <th className="text-center px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-750">
                  {editingId === p.id ? (
                    <>
                      <td className="min-w-[200px] px-4 py-2">
                        <input value={editForm.nombre} onChange={e => setEditForm({ ...editForm, nombre: e.target.value })} className="w-full px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                        <input value={editForm.descripcion} onChange={e => setEditForm({ ...editForm, descripcion: e.target.value })} placeholder="Descripción" className="w-full px-2 py-1 border rounded text-xs mt-1 dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                      </td>
                      <td className="px-4 py-2">
                        <select value={editForm.categoria} onChange={e => setEditForm({ ...editForm, categoria: e.target.value })} className="px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
                          <option>Huevos</option><option>Subproductos</option><option>Insumos</option><option>Otros</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-xs font-semibold">kg (unidad comercial)</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input type="number" value={editForm.precioBase} onChange={e => setEditForm({ ...editForm, precioBase: Number(e.target.value) })} className="w-24 px-2 py-1 border rounded text-sm text-right dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex flex-col gap-1 items-center">
                          <input type="number" min={1} title="Vida útil (días)" value={editForm.vidaUtilDias} onChange={e => setEditForm({ ...editForm, vidaUtilDias: Number(e.target.value) })} className="w-16 px-2 py-1 border rounded text-xs text-center dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                          <input type="number" min={0} title="Aviso antes de vencer (días)" value={editForm.diasAvisoVencimiento} onChange={e => setEditForm({ ...editForm, diasAvisoVencimiento: Number(e.target.value) })} className="w-16 px-2 py-1 border rounded text-xs text-center dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <select value={editForm.estado} onChange={e => setEditForm({ ...editForm, estado: e.target.value })} className="px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
                          <option>Activo</option><option>Inactivo</option>{p.estado === 'Archivado' && <option>Archivado</option>}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button onClick={() => guardarEdicion(p.id)} className="text-emerald-600 hover:text-emerald-800 mr-2"><Check className="w-4 h-4 inline" /></button>
                        <button onClick={() => setEditingId(null)} className="text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4 inline" /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="min-w-[200px] px-4 py-3">
                        <div className="font-bold text-neutral-800 dark:text-white">{p.nombre}</div>
                        {p.descripcion && <div className="text-xs text-neutral-500 dark:text-neutral-400">{p.descripcion}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold',
                          p.categoria === 'Huevos' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
                          p.categoria === 'Subproductos' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
                          p.categoria === 'Insumos' && 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
                          p.categoria === 'Otros' && 'bg-neutral-100 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-300'
                        )}>
                          <Tag className="w-3 h-3" /> {p.categoria}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{p.unidad}</td>
                      <td className="px-4 py-3 text-right">
                        {rotuloFactor(p.kgPorCarton, p.unidad) ? (
                          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{rotuloFactor(p.kgPorCarton, p.unidad)}</span>
                        ) : (
                          <span className="text-xs text-neutral-400">sin conversión</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-black text-emerald-700 dark:text-emerald-400">{formatCRC(p.precioBase)}</td>
                      <td className="px-4 py-3 text-center text-xs text-neutral-600 dark:text-neutral-400">
                        <div className="font-bold text-neutral-800 dark:text-white">{p.vidaUtilDias ?? 28} d</div>
                        <div className="text-[10px]">aviso {p.diasAvisoVencimiento ?? 7} d</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-bold',
                          p.estado === 'Activo' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                        )}>{p.estado}</span>
                      </td>
                      {currentUser.role === 'Admin' && (
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => iniciarEdicion(p)} className="text-blue-600 hover:text-blue-800 mr-2"><Edit2 className="w-4 h-4 inline" /></button>
                          {p.estado !== 'Archivado' && <button onClick={() => eliminar(p.id, p.nombre)} title="Archivar producto" className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4 inline" /></button>}
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== TIPOS DE CARTÓN ===== */}
      <div className="admin-table-scroll mt-6 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700">
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-neutral-800 dark:text-white">Tipos de cartón</h3>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Cada etiqueta corresponde a un cartón (1 etiqueta = 1 cartón)</span>
          </div>
          {currentUser.role === 'Admin' && (
            <button onClick={() => setAddingTipo(true)} className="flex items-center gap-1 text-white px-3 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
              <Plus className="w-4 h-4" /> Nuevo tipo
            </button>
          )}
        </div>
        {addingTipo && (
          <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={tipoForm.nombre} onChange={e => setTipoForm({ ...tipoForm, nombre: e.target.value })} placeholder="Nombre * (ej. Cartón de 24 huevos)" className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
              <input type="number" min={1} value={tipoForm.unidades || ''} onChange={e => setTipoForm({ ...tipoForm, unidades: Number(e.target.value) })} placeholder="Unidades por cartón *" className="px-3 py-2 border rounded-lg text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
            </div>
            <div className="flex gap-2">
              <button onClick={agregarTipo} className="flex items-center gap-1 text-white px-4 py-2 rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)' }}>
                <Check className="w-4 h-4" /> Guardar
              </button>
              <button onClick={() => setAddingTipo(false)} className="flex items-center gap-1 bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 px-4 py-2 rounded-lg text-sm font-bold">
                <X className="w-4 h-4" /> Cancelar
              </button>
            </div>
          </div>
        )}
        {tipos.length === 0 ? (
          <div className="p-6 text-center text-neutral-400 text-sm">No hay tipos de cartón configurados.</div>
        ) : (
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="bg-neutral-50 dark:bg-neutral-750 border-b dark:border-neutral-700">
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Tipo</th>
                <th className="text-left px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Unidades</th>
                <th className="text-center px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Estado</th>
                {currentUser.role === 'Admin' && <th className="text-center px-4 py-3 font-bold text-neutral-600 dark:text-neutral-300">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {tipos.map(t => (
                <tr key={t.id} className="border-b dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-750">
                  {editandoTipoId === t.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input value={tipoEditForm.nombre} onChange={e => setTipoEditForm({ ...tipoEditForm, nombre: e.target.value })} className="w-full px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" min={1} value={tipoEditForm.unidades || ''} onChange={e => setTipoEditForm({ ...tipoEditForm, unidades: Number(e.target.value) })} className="w-28 px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600" />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <select value={tipoEditForm.estado} onChange={e => setTipoEditForm({ ...tipoEditForm, estado: e.target.value })} className="px-2 py-1 border rounded text-sm dark:bg-neutral-700 dark:text-white dark:border-neutral-600">
                          <option>Activo</option><option>Inactivo</option>
                        </select>
                      </td>
                      {currentUser.role === 'Admin' && (
                        <td className="px-4 py-2 text-center">
                          <button onClick={() => guardarTipoEdicion(t.id)} className="text-emerald-600 hover:text-emerald-800 mr-2"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => setEditandoTipoId(null)} className="text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4 inline" /></button>
                        </td>
                      )}
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-bold text-neutral-800 dark:text-white">{t.nombre}</td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{t.unidades} unidades</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', t.estado === 'Activo' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400')}>{t.estado}</span>
                      </td>
                      {currentUser.role === 'Admin' && (
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => iniciarEdicionTipo(t)} className="text-blue-600 hover:text-blue-800 mr-2"><Edit2 className="w-4 h-4 inline" /></button>
                          <button onClick={() => eliminarTipo(t.id, t.nombre)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      )}
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
