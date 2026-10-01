const fs = require('fs');
let code = fs.readFileSync('src/components/Operaciones.tsx', 'utf8');

// Change initial state of granjaForm
code = code.replace(
  "const [granjaForm, setGranjaForm] = useState({ nombre: '', ubicacion: '', tipo_produccion: 'Postura Comercial', encargadoId: currentUser.id });",
  "const [granjaForm, setGranjaForm] = useState({ nombre: '', ubicacion: '', tipo_produccion: [] as string[], encargadoId: currentUser.id });"
);

// We also have a second place where it is reset
code = code.replace(
  "setGranjaForm({ nombre: '', ubicacion: '', tipo_produccion: 'Postura Comercial', encargadoId: currentUser.id });",
  "setGranjaForm({ nombre: '', ubicacion: '', tipo_produccion: [], encargadoId: currentUser.id });"
);

// We might have a third place where it is reset (in the wizard complete)
code = code.replace(
  "setGranjaForm({ nombre: '', ubicacion: '', tipo_produccion: 'Postura Comercial', encargadoId: currentUser.id });",
  "setGranjaForm({ nombre: '', ubicacion: '', tipo_produccion: [], encargadoId: currentUser.id });"
);

const selectRegex = /<div className="space-y-2">\s*<label className="text-xs font-bold text-neutral-600 uppercase">Tipo de Producción<\/label>\s*<select[\s\S]*?<\/select>\s*<\/div>/m;

const checkboxes = `<div className="space-y-2">
                          <label className="text-xs font-bold text-neutral-600 uppercase">Tipo de Producción</label>
                          <div className="flex flex-col space-y-2 mt-2">
                            <label className="flex items-center space-x-2 cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={granjaForm.tipo_produccion.includes('Producción de huevos')}
                                onChange={e => {
                                  const newTipos = e.target.checked 
                                    ? [...granjaForm.tipo_produccion, 'Producción de huevos']
                                    : granjaForm.tipo_produccion.filter(t => t !== 'Producción de huevos');
                                  setGranjaForm({...granjaForm, tipo_produccion: newTipos});
                                }}
                                className="rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-neutral-700">Producción de huevos</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={granjaForm.tipo_produccion.includes('Producción de gallinaza')}
                                onChange={e => {
                                  const newTipos = e.target.checked 
                                    ? [...granjaForm.tipo_produccion, 'Producción de gallinaza']
                                    : granjaForm.tipo_produccion.filter(t => t !== 'Producción de gallinaza');
                                  setGranjaForm({...granjaForm, tipo_produccion: newTipos});
                                }}
                                className="rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-neutral-700">Producción de gallinaza</span>
                            </label>
                          </div>
                        </div>`;

code = code.replace(selectRegex, checkboxes);

const postRegex = /body: JSON\.stringify\(\{\s*\.\.\.granjaForm,\s*galerones: wizardGalerones\s*\}\)/m;

const newPost = `body: JSON.stringify({
                                ...granjaForm,
                                tipo_produccion: granjaForm.tipo_produccion.join(', '),
                                galerones: wizardGalerones
                              })`;

code = code.replace(postRegex, newPost);

fs.writeFileSync('src/components/Operaciones.tsx', code);
