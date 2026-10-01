const fs = require('fs');
const prodCode = fs.readFileSync('produccion_full.txt', 'utf8');
const invCode = fs.readFileSync('inventario_full.txt', 'utf8');

// I'll extract some useful snippets from prodCode and invCode using regex or just combine them properly
// To save context size, I will construct Operaciones.tsx directly since I know the required parts.

const newCode = `import React, { useState, useEffect } from 'react';
import { Activity, ShieldAlert, Scale, ThermometerSun, Zap, Droplet, Wrench, ListChecks, CheckCircle2, ChevronRight, PackageCheck, AlertTriangle, Building, X, ChevronLeft, CalendarPlus, HeartCrack, Edit, Archive, Plus, Package, Database, Inbox, PackageOpen, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Camera, History, Upload } from 'lucide-react';
import { Granja, Galeron, LoteAves, User, InventarioItem, MovimientoInventario } from '../types';
import { rutasDisponibles } from '../data';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface OperacionesProps {
  currentUser: User;
}

export default function Operaciones({ currentUser }: OperacionesProps) {
  const [activeTab, setActiveTab] = useState<'infraestructura' | 'recoleccion' | 'bodega' | 'kardex'>('infraestructura');
  
  // Data states
  const [granjas, setGranjas] = useState<Granja[]>([]);
  const [galerones, setGalerones] = useState<Galeron[]>([]);
  const [lotes, setLotes] = useState<LoteAves[]>([]);
  const [inventario, setInventario] = useState<any[]>([]);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Form states for Granjas
  const [showGranjaForm, setShowGranjaForm] = useState(false);
  const [editingGranja, setEditingGranja] = useState<Granja | null>(null);
  const [granjaForm, setGranjaForm] = useState({ nombre: '', ubicacion: '', encargadoId: currentUser.id });
  const [configSelectedGranja, setConfigSelectedGranja] = useState<Granja | null>(null);

  // Form states for Galerones
  const [showGaleronForm, setShowGaleronForm] = useState(false);
  const [editingGaleron, setEditingGaleron] = useState<Galeron | null>(null);
  const [galeronForm, setGaleronForm] = useState({ nombre: '', capacidad_maxima: '', estado_fisico: 'Óptimo' });

  // Form states for Recolección
  const [galeronSeleccionadoRecoleccion, setGaleronSeleccionadoRecoleccion] = useState('');
  const [huevosGrandes, setHuevosGrandes] = useState(0);
  const [huevosMedianos, setHuevosMedianos] = useState(0);
  const [gallinazaSacos, setGallinazaSacos] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [resGranjas, resGalerones, resLotes, resInv, resMov] = await Promise.all([
        fetch('/api/granjas'),
        fetch('/api/galerones'),
        fetch('/api/lotes'),
        fetch('/api/inventario'),
        fetch('/api/inventario/movimientos')
      ]);
      if (resGranjas.ok) setGranjas(await resGranjas.json());
      if (resGalerones.ok) setGalerones(await resGalerones.json());
      if (resLotes.ok) setLotes(await resLotes.json());
      if (resInv.ok) setInventario(await resInv.json());
      if (resMov.ok) setMovimientos(await resMov.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Handlers for Granjas
  const handleSaveGranja = async () => {
    try {
      const payload = { ...granjaForm };
      const method = editingGranja ? 'PUT' : 'POST';
      const url = editingGranja ? \`/api/granjas/\${editingGranja.id}\` : '/api/granjas';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setShowGranjaForm(false);
        fetchData();
      }
    } catch (e) { console.error(e); }
  };

  const handleArchiveGranja = async (granja: Granja) => {
    if (!confirm("¿Archivar granja?")) return;
    try {
      const res = await fetch(\`/api/granjas/\${granja.id}\`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...granja, estado: 'Archivado' })
      });
      if (res.ok) fetchData();
    } catch(e) { console.error(e); }
  };

  // Handlers for Galerones
  const handleSaveGaleron = async () => {
    if (!configSelectedGranja) return;
    try {
      const payload = {
        granjaId: configSelectedGranja.id,
        nombre: galeronForm.nombre,
        capacidad_maxima: Number(galeronForm.capacidad_maxima),
        estado_fisico: galeronForm.estado_fisico
      };
      
      const method = editingGaleron ? 'PUT' : 'POST';
      const url = editingGaleron ? \`/api/galerones/\${editingGaleron.id}\` : '/api/galerones';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        setShowGaleronForm(false);
        fetchData();
      }
    } catch(e) { console.error(e); }
  };

  const handleArchiveGaleron = async (galeron: Galeron) => {
    if(!confirm("¿Archivar galerón?")) return;
    try {
      const res = await fetch(\`/api/galerones/\${galeron.id}\`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...galeron, estado: 'Archivado' })
      });
      if (res.ok) fetchData();
    } catch(e) { console.error(e); }
  };

  // Handlers for Recoleccion
  const handleRecoleccion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (huevosGrandes <= 0 && huevosMedianos <= 0 && gallinazaSacos <= 0) return;
    setIsSubmitting(true);
    try {
      const payload = {
        galeron: galeronSeleccionadoRecoleccion,
        detalles: [
          { tamano: 'Grande', cantidad: huevosGrandes },
          { tamano: 'Mediano', cantidad: huevosMedianos },
          { tamano: 'Gallinaza', cantidad: gallinazaSacos }
        ]
      };

      const res = await fetch('/api/produccion/recoleccion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error registrando recolección');
      }

      alert('Recolección registrada exitosamente. El inventario ha sido actualizado.');
      setHuevosGrandes(0);
      setHuevosMedianos(0);
      setGallinazaSacos(0);
      setGaleronSeleccionadoRecoleccion('');
      fetchData(); // Refresh kardex & stock
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabs = [
    { id: 'infraestructura', label: 'Infraestructura' },
    { id: 'recoleccion', label: 'Recolección' },
    { id: 'bodega', label: 'Existencias (Bodega)' },
    { id: 'kardex', label: 'Kárdex de Movimientos' },
  ];

  return (
    <div className="space-y-6">
      {/* Header and Tabs */}
      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-neutral-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600">
              <PackageOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-neutral-800 tracking-tight">Operaciones y Bodegas</h2>
              <p className="text-sm font-medium text-neutral-500">Gestión de infraestructura, recolección y trazabilidad</p>
            </div>
          </div>
        </div>

        <div className="flex border-b border-neutral-200 space-x-6 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "pb-3 text-sm font-bold transition-colors relative whitespace-nowrap",
                activeTab === tab.id ? "text-blue-600" : "text-neutral-500 hover:text-neutral-800"
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2">
        {isLoading && (
          <div className="flex items-center justify-center min-h-[30vh]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        )}

        {!isLoading && activeTab === 'infraestructura' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            {!configSelectedGranja ? (
              <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold text-neutral-800">Listado de Granjas</h3>
                  <button
                    onClick={() => {
                      setEditingGranja(null);
                      setGranjaForm({ nombre: '', ubicacion: '', encargadoId: currentUser.id });
                      setShowGranjaForm(true);
                    }}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm flex items-center space-x-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Nueva Granja</span>
                  </button>
                </div>

                {showGranjaForm && (
                  <div className="mb-6 bg-neutral-50 p-4 rounded-xl border border-neutral-200 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-600 uppercase">Nombre</label>
                      <input 
                        value={granjaForm.nombre} 
                        onChange={e => setGranjaForm({...granjaForm, nombre: e.target.value})}
                        className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        placeholder="Ej. Granja El Sol"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-600 uppercase">Ubicación</label>
                      <input 
                        value={granjaForm.ubicacion} 
                        onChange={e => setGranjaForm({...granjaForm, ubicacion: e.target.value})}
                        className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        placeholder="Ej. Sector Norte"
                      />
                    </div>
                    <div className="flex space-x-3">
                      <button onClick={handleSaveGranja} disabled={!granjaForm.nombre || !granjaForm.ubicacion} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">Guardar</button>
                      <button onClick={() => setShowGranjaForm(false)} className="bg-neutral-200 text-neutral-700 px-4 py-2 rounded-lg text-sm font-bold">Cancelar</button>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-bold text-[10px] border-b border-neutral-200">
                      <tr>
                        <th className="px-4 py-3">Nombre</th>
                        <th className="px-4 py-3">Ubicación</th>
                        <th className="px-4 py-3 text-center">Galerones</th>
                        <th className="px-4 py-3 text-center">Estado</th>
                        <th className="px-4 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {granjas.map(g => (
                        <tr key={g.id} className="hover:bg-neutral-50/50 cursor-pointer" onClick={() => setConfigSelectedGranja(g)}>
                          <td className="px-4 py-3 font-bold text-neutral-800">{g.nombre}</td>
                          <td className="px-4 py-3 text-neutral-500">{g.ubicacion}</td>
                          <td className="px-4 py-3 text-center font-medium text-neutral-600">
                            {galerones.filter(gal => gal.granjaId === g.id).length}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn("px-2 py-1 rounded text-xs font-bold", g.estado === 'Archivado' ? "bg-neutral-100 text-neutral-600" : "bg-emerald-100 text-emerald-700")}>
                              {g.estado || 'Activo'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right space-x-2" onClick={e => e.stopPropagation()}>
                            <button onClick={() => { setEditingGranja(g); setGranjaForm({nombre: g.nombre, ubicacion: g.ubicacion, encargadoId: g.encargadoId}); setShowGranjaForm(true); }} className="text-neutral-500 hover:text-blue-600"><Edit className="w-4 h-4 inline"/></button>
                            {g.estado !== 'Archivado' && (
                              <button onClick={() => handleArchiveGranja(g)} className="text-neutral-500 hover:text-red-600"><Archive className="w-4 h-4 inline"/></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
                <button 
                  onClick={() => setConfigSelectedGranja(null)}
                  className="mb-6 flex items-center text-sm font-bold text-neutral-500 hover:text-neutral-800 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Volver a Granjas
                </button>
                <div className="flex justify-between items-center mb-6 pb-4 border-b border-neutral-100">
                  <div>
                    <h3 className="text-xl font-bold text-neutral-800">{configSelectedGranja.nombre}</h3>
                    <p className="text-sm text-neutral-500">Gestión de Galerones</p>
                  </div>
                  <button
                    onClick={() => {
                      setEditingGaleron(null);
                      setGaleronForm({ nombre: '', capacidad_maxima: '', estado_fisico: 'Óptimo' });
                      setShowGaleronForm(true);
                    }}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm flex items-center space-x-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Nuevo Galerón</span>
                  </button>
                </div>

                {showGaleronForm && (
                  <div className="mb-6 bg-neutral-50 p-4 rounded-xl border border-neutral-200 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-600 uppercase">Nombre / ID</label>
                      <input 
                        value={galeronForm.nombre} 
                        onChange={e => setGaleronForm({...galeronForm, nombre: e.target.value})}
                        className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        placeholder="Ej. Galpón 01"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-600 uppercase">Capacidad Máxima</label>
                      <input 
                        type="number"
                        value={galeronForm.capacidad_maxima} 
                        onChange={e => setGaleronForm({...galeronForm, capacidad_maxima: e.target.value})}
                        className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        placeholder="Cantidad aves"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-600 uppercase">Estado Físico</label>
                      <select 
                        value={galeronForm.estado_fisico} 
                        onChange={e => setGaleronForm({...galeronForm, estado_fisico: e.target.value})}
                        className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                      >
                        <option value="Óptimo">Óptimo</option>
                        <option value="Mantenimiento">Mantenimiento</option>
                        <option value="Deteriorado">Deteriorado</option>
                      </select>
                    </div>
                    <div className="flex space-x-3">
                      <button onClick={handleSaveGaleron} disabled={!galeronForm.nombre || !galeronForm.capacidad_maxima} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">Guardar</button>
                      <button onClick={() => setShowGaleronForm(false)} className="bg-neutral-200 text-neutral-700 px-4 py-2 rounded-lg text-sm font-bold">Cancelar</button>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-bold text-[10px] border-b border-neutral-200">
                      <tr>
                        <th className="px-4 py-3">Nombre</th>
                        <th className="px-4 py-3">Capacidad</th>
                        <th className="px-4 py-3">Estado Físico</th>
                        <th className="px-4 py-3 text-center">Estado Sist.</th>
                        <th className="px-4 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {galerones.filter(g => g.granjaId === configSelectedGranja.id).map(g => (
                        <tr key={g.id} className="hover:bg-neutral-50/50">
                          <td className="px-4 py-3 font-bold text-neutral-800">{g.nombre}</td>
                          <td className="px-4 py-3 text-neutral-500">{Number(g.capacidad_maxima).toLocaleString()} aves</td>
                          <td className="px-4 py-3 text-neutral-500">{g.estado_fisico}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn("px-2 py-1 rounded text-xs font-bold", g.estado === 'Archivado' ? "bg-neutral-100 text-neutral-600" : "bg-emerald-100 text-emerald-700")}>
                              {g.estado || 'Activo'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right space-x-2">
                            <button onClick={() => { setEditingGaleron(g); setGaleronForm({nombre: g.nombre, capacidad_maxima: g.capacidad_maxima.toString(), estado_fisico: g.estado_fisico}); setShowGaleronForm(true); }} className="text-neutral-500 hover:text-blue-600"><Edit className="w-4 h-4 inline"/></button>
                            {g.estado !== 'Archivado' && (
                              <button onClick={() => handleArchiveGaleron(g)} className="text-neutral-500 hover:text-red-600"><Archive className="w-4 h-4 inline"/></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {!isLoading && activeTab === 'recoleccion' && (
          <div className="max-w-xl mx-auto animate-in fade-in slide-in-from-bottom-4">
            <form onSubmit={handleRecoleccion} className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm space-y-6">
              <div className="flex items-center space-x-3 pb-4 border-b border-neutral-100">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <PackageCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-neutral-800">Ingreso de Recolección</h3>
                  <p className="text-xs text-neutral-500">Los cartones se sumarán a la Bodega Central</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-neutral-700">Galerón de Origen</label>
                <select
                  value={galeronSeleccionadoRecoleccion}
                  onChange={(e) => setGaleronSeleccionadoRecoleccion(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                >
                  <option value="">Seleccione un galerón</option>
                  {galerones.filter(g => g.estado !== 'Archivado').map(g => (
                    <option key={g.id} value={g.nombre}>{g.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">Cartones (Grande)</label>
                  <input
                    type="number"
                    min="0"
                    value={huevosGrandes || ''}
                    onChange={(e) => setHuevosGrandes(Number(e.target.value))}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">Cartones (Mediano)</label>
                  <input
                    type="number"
                    min="0"
                    value={huevosMedianos || ''}
                    onChange={(e) => setHuevosMedianos(Number(e.target.value))}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">Gallinaza (Sacos)</label>
                  <input
                    type="number"
                    min="0"
                    value={gallinazaSacos || ''}
                    onChange={(e) => setGallinazaSacos(Number(e.target.value))}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    placeholder="0"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || (!huevosGrandes && !huevosMedianos && !gallinazaSacos) || !galeronSeleccionadoRecoleccion}
                className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-sm flex justify-center items-center"
              >
                {isSubmitting ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                  'Registrar Producción'
                )}
              </button>
            </form>
          </div>
        )}

        {!isLoading && activeTab === 'bodega' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {inventario.map(item => {
                const isBodega = item.ubicacion === 'Bodega Central';
                const daysToExpire = item.fecha_caducidad ? Math.ceil((new Date(item.fecha_caducidad).getTime() - Date.now()) / (1000 * 3600 * 24)) : null;
                const isExpiringSoon = daysToExpire !== null && daysToExpire <= 7;
                return (
                <div key={item.id} className={cn("bg-white p-5 rounded-2xl shadow-sm border transition-colors", isExpiringSoon ? "border-amber-300 bg-amber-50" : "border-neutral-200")}>
                  <div className="flex justify-between items-start mb-3">
                    <span className={cn("px-2.5 py-1 rounded-md text-xs font-bold border", 
                      isBodega ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                    )}>
                      {item.ubicacion}
                    </span>
                    <span className="text-xs text-neutral-400 font-medium">
                      {new Date(item.ultima_actualizacion).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                  <h4 className="text-2xl font-bold text-neutral-800 flex items-end space-x-1">
                    <span>{item.cantidad}</span>
                    <span className="text-base text-neutral-500 font-medium mb-1">{item.unidad}</span>
                  </h4>
                  <p className="text-sm font-semibold text-neutral-800 mt-1">{item.producto}</p>
                  {(item.lote || item.fecha_caducidad) && (
                    <div className="mt-3 pt-3 border-t border-neutral-100 flex flex-col gap-1">
                      {item.lote && <p className="text-xs text-neutral-500"><span className="font-bold">Lote:</span> {item.lote}</p>}
                      {item.fecha_caducidad && (
                        <p className={cn("text-xs", isExpiringSoon ? "text-amber-700 font-bold" : "text-neutral-500")}>
                          <span className="font-bold">Vence:</span> {new Date(item.fecha_caducidad).toLocaleDateString()} {isExpiringSoon && \`(en \${daysToExpire} días)\`}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )})}
            </div>
            
            {inventario.length === 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-12 text-center flex flex-col items-center">
                <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mb-4 text-neutral-400">
                  <Inbox className="w-8 h-8" />
                </div>
                <h4 className="text-lg font-bold text-neutral-700 mb-1">Sin Existencias</h4>
                <p className="text-neutral-500">La bodega está vacía.</p>
              </div>
            )}
          </div>
        )}

        {!isLoading && activeTab === 'kardex' && (
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
            {movimientos.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center">
                <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mb-4 text-neutral-400">
                  <Inbox className="w-8 h-8" />
                </div>
                <h4 className="text-lg font-bold text-neutral-700 mb-1">Sin Movimientos</h4>
                <p className="text-neutral-500">No hay movimientos registrados en el kardex.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-bold text-xs border-b border-neutral-200">
                    <tr>
                      <th className="px-6 py-4">Fecha</th>
                      <th className="px-6 py-4">Tipo</th>
                      <th className="px-6 py-4">Origen</th>
                      <th className="px-6 py-4">Destino</th>
                      <th className="px-6 py-4">Producto</th>
                      <th className="px-6 py-4 text-right">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {[...movimientos].sort((a,b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()).map(mov => (
                      <tr key={mov.id} className="hover:bg-neutral-50/50 transition-colors">
                        <td className="px-6 py-4 text-neutral-500 text-xs">
                          {new Date(mov.fecha).toLocaleString()}
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold",
                            mov.tipo === 'Entrada Producción' ? "bg-green-100 text-green-700" :
                            mov.tipo === 'Venta' || mov.tipo === 'Salida' ? "bg-orange-100 text-orange-700" :
                            mov.tipo === 'Traslado' ? "bg-blue-100 text-blue-700" :
                            "bg-neutral-100 text-neutral-700"
                          )}>
                            {mov.tipo}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-neutral-600">{mov.origen || '-'}</td>
                        <td className="px-6 py-4 text-neutral-600">{mov.destino || '-'}</td>
                        <td className="px-6 py-4 font-bold text-neutral-800">{mov.producto}</td>
                        <td className="px-6 py-4 text-right font-bold text-neutral-700">
                          {mov.cantidad} <span className="font-normal text-neutral-500 text-xs">{mov.unidad || ''}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
`;
fs.writeFileSync('src/components/Operaciones.tsx', newCode);
