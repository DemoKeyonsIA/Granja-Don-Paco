const fs = require('fs');
let code = fs.readFileSync('src/components/Clientes.tsx', 'utf8');

const oldSelect = /<select\s+value=\{newCliente\.ruta\}[\s\S]*?<\/select>/m;

const newUbicacionInput = `<div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MapPin className="h-4 w-4 text-neutral-400" />
                </div>
                <input 
                  type="text" 
                  value={newCliente.ruta || ''} 
                  onChange={e => setNewCliente({...newCliente, ruta: e.target.value})}
                  className="w-full bg-neutral-50 border-2 border-neutral-200 rounded-lg pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                  placeholder="Buscar ubicación en Google Maps..."
                />
              </div>`;

code = code.replace(oldSelect, newUbicacionInput);
code = code.replace("Ruta Asignada", "Ruta / Ubicación");
code = code.replace("ruta: rutasDisponibles[0]", "ruta: ''");

fs.writeFileSync('src/components/Clientes.tsx', code);
