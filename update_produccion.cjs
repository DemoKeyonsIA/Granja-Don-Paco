const fs = require('fs');

const produccionCode = `import React, { useState, useEffect } from 'react';
import { Activity, ShieldAlert, Scale, ThermometerSun, Zap, Droplet, Wrench, ListChecks, CheckCircle2, ChevronRight, PackageCheck, AlertTriangle, Building, X, ChevronLeft, CalendarPlus, HeartCrack } from 'lucide-react';
import { User } from '../types';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ProduccionProps = {
  currentUser: User;
};

type Granja = {
  id: string;
  nombre: string;
  ubicacion: string;
  encargadoId: string;
};

type Galeron = {
  id: string;
  granjaId: string;
  nombre: string;
  capacidad_maxima: number;
  estado_fisico: string;
};

type LoteAves = {
  id: string;
  galeronId: string;
  fecha_ingreso: string;
  cantidad_inicial: number;
  linea_genetica: string;
  estado: string; // Activo / Finalizado
};

export default function Produccion({ currentUser }: ProduccionProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'recoleccion' | 'mortalidad'>('dashboard');
  
  // Drill-down State
  const [granjas, setGranjas] = useState<Granja[]>([]);
  const [galerones, setGalerones] = useState<Galeron[]>([]);
  const [lotes, setLotes] = useState<LoteAves[]>([]);
  
  const [selectedGranja, setSelectedGranja] = useState<Granja | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // State for recoleccion form
  const [galeronSeleccionadoRecoleccion, setGaleronSeleccionadoRecoleccion] = useState('');
  const [huevosGrandes, setHuevosGrandes] = useState(0);
  const [huevosMedianos, setHuevosMedianos] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdminOrOperario = currentUser.role === 'Admin' || currentUser.role === 'Operario';

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [resGranjas, resGalerones, resLotes] = await Promise.all([
        fetch('/api/granjas'),
        fetch('/api/galerones'),
        fetch('/api/lotes')
      ]);
      if (resGranjas.ok) setGranjas(await resGranjas.json());
      if (resGalerones.ok) setGalerones(await resGalerones.json());
      if (resLotes.ok) setLotes(await resLotes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRecoleccion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (huevosGrandes <= 0 && huevosMedianos <= 0) return;

    setIsSubmitting(true);
    try {
      const payload = {
        galeron: galeronSeleccionadoRecoleccion,
        detalles: [
          { tamano: 'Grande', cantidad: huevosGrandes },
          { tamano: 'Mediano', cantidad: huevosMedianos }
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
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in pb-20">
      
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-neutral-800 tracking-tight">Módulo de Producción</h2>
        <p className="text-neutral-500 text-sm">Control biológico y operativo de galerones</p>
      </div>

      {/* Internal Navigation Tabs */}
      <div className="flex border-b border-neutral-200 space-x-8">
        {[
          { id: 'dashboard', label: 'Dashboard de Granjas' },
          { id: 'recoleccion', label: 'Recolección Diaria' },
          { id: 'mortalidad', label: 'Mortalidad' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "pb-3 text-sm font-bold transition-colors relative",
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

      {/* Tab Content */}
      <div className="pt-2">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center min-h-[30vh]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : !selectedGranja ? (
              // Nivel 1: Lista de Granjas
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                <h3 className="font-bold text-neutral-800">Seleccione una Granja</h3>
                {granjas.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {granjas.map(granja => (
                      <button
                        key={granja.id}
                        onClick={() => setSelectedGranja(granja)}
                        className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all text-left group"
                      >
                        <div className="flex justify-between items-start mb-4">
                          <div className="bg-blue-50 text-blue-600 p-3 rounded-xl group-hover:bg-blue-100 transition-colors">
                            <Building className="w-6 h-6" />
                          </div>
                          <ChevronRight className="w-5 h-5 text-neutral-400 group-hover:text-blue-500 transition-colors" />
                        </div>
                        <h4 className="text-lg font-bold text-neutral-800 mb-1">{granja.nombre}</h4>
                        <p className="text-sm text-neutral-500">{granja.ubicacion}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white p-10 rounded-2xl border border-neutral-200 shadow-sm text-center">
                    <Building className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
                    <h3 className="text-lg font-bold text-neutral-800 mb-2">No hay granjas</h3>
                    <p className="text-neutral-500 max-w-sm mx-auto">No se han registrado granjas en el sistema.</p>
                  </div>
                )}
              </div>
            ) : (
              // Nivel 2: Galerones de la Granja Seleccionada
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <button
                  onClick={() => setSelectedGranja(null)}
                  className="flex items-center text-sm font-bold text-neutral-500 hover:text-neutral-800 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Volver a Granjas
                </button>
                
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-bold text-neutral-800">{selectedGranja.nombre}</h3>
                    <p className="text-sm text-neutral-500">Galerones y Lotes</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {galerones.filter(g => g.granjaId === selectedGranja.id).map(galeron => {
                    const loteActivo = lotes.find(l => l.galeronId === galeron.id && l.estado === 'Activo');
                    const ocupacion = loteActivo ? (loteActivo.cantidad_inicial / galeron.capacidad_maxima) * 100 : 0;
                    
                    return (
                      <div key={galeron.id} className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="p-5 flex-1">
                          <div className="flex justify-between items-start mb-4">
                            <h4 className="text-lg font-bold text-neutral-800">{galeron.nombre}</h4>
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              loteActivo ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600",
                              galeron.estado_fisico === 'Mantenimiento' && "bg-orange-50 text-orange-700"
                            )}>
                              {galeron.estado_fisico === 'Mantenimiento' ? 'Mantenimiento' : loteActivo ? 'Lote Activo' : 'Vacío Sanitario'}
                            </span>
                          </div>

                          <div className="space-y-4">
                            <div>
                              <div className="flex justify-between text-sm font-bold mb-2">
                                <span className={cn(loteActivo ? "text-blue-700" : "text-neutral-500")}>
                                  {loteActivo ? \`\${loteActivo.cantidad_inicial.toLocaleString()} aves\` : '0 aves'}
                                </span>
                                <span className="text-neutral-500">Capacidad: {galeron.capacidad_maxima.toLocaleString()}</span>
                              </div>
                              <div className="w-full bg-neutral-100 rounded-full h-3">
                                <div 
                                  className={cn("h-3 rounded-full transition-all", loteActivo ? "bg-blue-600" : "bg-neutral-300")}
                                  style={{ width: \`\${Math.min(ocupacion, 100)}%\` }}
                                ></div>
                              </div>
                            </div>
                            
                            {loteActivo && (
                              <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-100 flex items-center justify-between">
                                <div>
                                  <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Línea Genética</p>
                                  <p className="text-sm font-bold text-neutral-800">{loteActivo.linea_genetica}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Ingreso</p>
                                  <p className="text-sm font-bold text-neutral-800">{new Date(loteActivo.fecha_ingreso).toLocaleDateString()}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Acciones Rápidas */}
                        {isAdminOrOperario && (
                          <div className="grid grid-cols-3 border-t border-neutral-100 divide-x divide-neutral-100 bg-neutral-50/50">
                            {!loteActivo ? (
                              <button className="flex flex-col items-center justify-center p-3 text-blue-600 hover:bg-blue-50 transition-colors col-span-3 font-bold text-sm">
                                <CalendarPlus className="w-5 h-5 mb-1" />
                                Ingresar Lote
                              </button>
                            ) : (
                              <>
                                <button className="flex flex-col items-center justify-center p-3 text-emerald-600 hover:bg-emerald-50 transition-colors font-bold text-[11px] uppercase tracking-wide">
                                  <PackageCheck className="w-4 h-4 mb-1" />
                                  Recolección
                                </button>
                                <button className="flex flex-col items-center justify-center p-3 text-red-600 hover:bg-red-50 transition-colors font-bold text-[11px] uppercase tracking-wide">
                                  <HeartCrack className="w-4 h-4 mb-1" />
                                  Mortalidad
                                </button>
                                <button className="flex flex-col items-center justify-center p-3 text-orange-600 hover:bg-orange-50 transition-colors font-bold text-[11px] uppercase tracking-wide">
                                  <Wrench className="w-4 h-4 mb-1" />
                                  Mantenimiento
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {galerones.filter(g => g.granjaId === selectedGranja.id).length === 0 && (
                    <div className="col-span-full bg-white p-10 rounded-2xl border border-neutral-200 shadow-sm text-center">
                      <p className="text-neutral-500">No hay galerones registrados en esta granja.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'recoleccion' && (
          <div className="max-w-xl">
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
                  {galerones.map(g => (
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
              </div>

              <button
                type="submit"
                disabled={isSubmitting || (!huevosGrandes && !huevosMedianos) || !galeronSeleccionadoRecoleccion}
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

        {activeTab === 'mortalidad' && (
          <div className="bg-white p-10 rounded-2xl border border-neutral-200 shadow-sm text-center">
            <HeartCrack className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-neutral-800 mb-2">Registro de Mortalidad</h3>
            <p className="text-neutral-500 max-w-sm mx-auto">Módulo en construcción. Aquí se registrarán las bajas diarias por galerón.</p>
          </div>
        )}
      </div>
    </div>
  );
}
`;

fs.writeFileSync('src/components/Produccion.tsx', produccionCode);
console.log('Replaced Produccion.tsx with Drill-down pattern');
