const fs = require('fs');
let code = fs.readFileSync('src/components/Operaciones.tsx', 'utf8');

const importRegex = /import \{ Activity.*\} from 'lucide-react';/;
code = code.replace(importRegex, "import { Activity, ShieldAlert, Scale, ThermometerSun, Zap, Droplet, Wrench, ListChecks, CheckCircle2, ChevronRight, PackageCheck, AlertTriangle, Building, X, ChevronLeft, CalendarPlus, HeartCrack, Edit, Archive, Plus, Package, Database, Inbox, PackageOpen, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Camera, History, Upload, MapPin, Trash2 } from 'lucide-react';");

// Update Granja type
code = code.replace(
  "type Granja = { id: string; nombre: string; ubicacion: string; encargadoId: string; estado?: string; };",
  "type Granja = { id: string; nombre: string; ubicacion: string; tipo_produccion?: string; encargadoId: string; estado?: string; };"
);

// Add wizard states
code = code.replace(
  "const [granjaForm, setGranjaForm] = useState({ nombre: '', ubicacion: '', encargadoId: currentUser.id });",
  "const [granjaForm, setGranjaForm] = useState({ nombre: '', ubicacion: '', tipo_produccion: 'Postura Comercial', encargadoId: currentUser.id });\n  const [wizardGalerones, setWizardGalerones] = useState<{nombre: string, capacidad_maxima: string}[]>([]);\n  const [wizardError, setWizardError] = useState('');\n  const [isSavingWizard, setIsSavingWizard] = useState(false);"
);

// Update handleSaveGranja to handleSaveWizard (Actually replace the old form)
const oldFormRegex = /\{showGranjaForm && \([\s\S]*?<\/div>\s*\)\}/;

const newWizard = `{showGranjaForm && (
                  <div className="mb-6 bg-white p-6 rounded-2xl border-2 border-blue-100 shadow-sm space-y-6">
                    <div className="border-b border-neutral-100 pb-4">
                      <h3 className="text-xl font-bold text-neutral-800">Nueva Infraestructura (Asistente de Creación)</h3>
                      <p className="text-sm text-neutral-500">Configure la granja y sus galerones en un solo paso.</p>
                    </div>
                    
                    {wizardError && (
                      <div className="p-3 bg-red-50 text-red-700 text-sm font-bold border border-red-200 rounded-lg">
                        {wizardError}
                      </div>
                    )}

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-neutral-800 uppercase tracking-wider">1. Datos Generales</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-neutral-600 uppercase">Nombre de la Granja</label>
                          <input 
                            value={granjaForm.nombre} 
                            onChange={e => setGranjaForm({...granjaForm, nombre: e.target.value})}
                            className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                            placeholder="Ej. Granja El Sol"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-neutral-600 uppercase">Tipo de Producción</label>
                          <select 
                            value={granjaForm.tipo_produccion} 
                            onChange={e => setGranjaForm({...granjaForm, tipo_produccion: e.target.value})}
                            className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                          >
                            <option value="Postura Comercial">Postura Comercial</option>
                            <option value="Engorde">Engorde</option>
                            <option value="Mixto">Mixto</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-neutral-800 uppercase tracking-wider">2. Ubicación Geográfica</h4>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <MapPin className="h-5 w-5 text-neutral-400" />
                        </div>
                        <input
                          type="text"
                          value={granjaForm.ubicacion} 
                          onChange={e => setGranjaForm({...granjaForm, ubicacion: e.target.value})}
                          className="w-full bg-neutral-50 border-2 border-neutral-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                          placeholder="Buscar ubicación en Google Maps..."
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <h4 className="text-sm font-bold text-neutral-800 uppercase tracking-wider">3. Galerones Iniciales</h4>
                        <button
                          onClick={() => setWizardGalerones([...wizardGalerones, {nombre: '', capacidad_maxima: ''}])}
                          className="bg-neutral-100 text-blue-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-neutral-200 transition-colors flex items-center"
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Añadir Galerón
                        </button>
                      </div>
                      
                      {wizardGalerones.length === 0 ? (
                        <p className="text-sm text-neutral-500 italic">No se crearán galerones iniciales.</p>
                      ) : (
                        <div className="space-y-3">
                          {wizardGalerones.map((gal, idx) => (
                            <div key={idx} className="flex space-x-3 items-center bg-neutral-50 p-3 rounded-xl border border-neutral-200">
                              <input 
                                value={gal.nombre} 
                                onChange={e => {
                                  const newGal = [...wizardGalerones];
                                  newGal[idx].nombre = e.target.value;
                                  setWizardGalerones(newGal);
                                }}
                                className="flex-1 bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none"
                                placeholder="Nombre (Ej. Galpón A)"
                              />
                              <input 
                                type="number"
                                value={gal.capacidad_maxima} 
                                onChange={e => {
                                  const newGal = [...wizardGalerones];
                                  newGal[idx].capacidad_maxima = e.target.value;
                                  setWizardGalerones(newGal);
                                }}
                                className="w-32 bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none"
                                placeholder="Capacidad"
                              />
                              <button
                                onClick={() => {
                                  const newGal = [...wizardGalerones];
                                  newGal.splice(idx, 1);
                                  setWizardGalerones(newGal);
                                }}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="pt-4 border-t border-neutral-100 flex justify-end space-x-3">
                      <button onClick={() => setShowGranjaForm(false)} className="bg-neutral-200 text-neutral-700 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-neutral-300">
                        Cancelar
                      </button>
                      <button 
                        onClick={async () => {
                          if (!granjaForm.nombre || !granjaForm.ubicacion) {
                            setWizardError("El nombre y la ubicación son obligatorios.");
                            return;
                          }
                          for (const g of wizardGalerones) {
                            if (!g.nombre || !g.capacidad_maxima) {
                              setWizardError("Todos los galerones deben tener nombre y capacidad.");
                              return;
                            }
                          }
                          setWizardError('');
                          setIsSavingWizard(true);
                          try {
                            const res = await fetch('/api/granjas/wizard', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                ...granjaForm,
                                galerones: wizardGalerones
                              })
                            });
                            if (!res.ok) {
                              const data = await res.json();
                              throw new Error(data.error || 'Error al guardar');
                            }
                            setShowGranjaForm(false);
                            setWizardGalerones([]);
                            setGranjaForm({ nombre: '', ubicacion: '', tipo_produccion: 'Postura Comercial', encargadoId: currentUser.id });
                            fetchData();
                          } catch (e: any) {
                            setWizardError(e.message);
                          } finally {
                            setIsSavingWizard(false);
                          }
                        }}
                        disabled={isSavingWizard || !granjaForm.nombre || !granjaForm.ubicacion} 
                        className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isSavingWizard ? 'Guardando...' : 'Guardar Todo'}
                      </button>
                    </div>
                  </div>
                )}`;

code = code.replace(oldFormRegex, newWizard);

// Now update the button to reset wizard state when clicked
const newGranjaBtnRegex = /setEditingGranja\(null\);\s*setGranjaForm\(\{ nombre: '', ubicacion: '', encargadoId: currentUser\.id \}\);\s*setShowGranjaForm\(true\);/;

code = code.replace(newGranjaBtnRegex, "setEditingGranja(null); setGranjaForm({ nombre: '', ubicacion: '', tipo_produccion: 'Postura Comercial', encargadoId: currentUser.id }); setWizardGalerones([]); setWizardError(''); setShowGranjaForm(true);");

fs.writeFileSync('src/components/Operaciones.tsx', code);
