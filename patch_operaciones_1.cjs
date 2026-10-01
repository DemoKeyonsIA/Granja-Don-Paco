const fs = require('fs');
let code = fs.readFileSync('src/components/Operaciones.tsx', 'utf8');

// 1. Rename estado_fisico to fecha_ultimo_mantenimiento
code = code.replace(
  "estado_fisico: string;",
  "fecha_ultimo_mantenimiento?: string;"
);

// 2. Add Mantenimiento states
const stateRegex = /const \[galeronForm, setGaleronForm\] = useState\(\{ nombre: '', capacidad_maxima: '', estado_fisico: 'Óptimo' \}\);/;
const stateReplacement = `const [galeronForm, setGaleronForm] = useState({ nombre: '', capacidad_maxima: '' });
  const [showMantenimientoForm, setShowMantenimientoForm] = useState(false);
  const [selectedMantenimientoGaleron, setSelectedMantenimientoGaleron] = useState<Galeron | null>(null);
  const [mantenimientoForm, setMantenimientoForm] = useState({ fecha: new Date().toISOString().split('T')[0], tipo: 'Preventivo', descripcion: '', estado: 'Completado' });`;
code = code.replace(stateRegex, stateReplacement);

// 3. Update galeron actions to remove estado_fisico
code = code.replace(/setGaleronForm\(\{ nombre: '', capacidad_maxima: '', estado_fisico: 'Óptimo' \}\)/g, "setGaleronForm({ nombre: '', capacidad_maxima: '' })");

code = code.replace(/estado_fisico: galeronForm\.estado_fisico/g, "");
code = code.replace(/estado_fisico: g\.estado_fisico/g, "");

// 4. Find the table header
code = code.replace(
  '<th className="px-4 py-3">Estado Físico</th>',
  '<th className="px-4 py-3">Últ. Mantenimiento</th>'
);

// 5. Find the table data cell
code = code.replace(
  '<td className="px-4 py-3 text-neutral-500">{g.estado_fisico}</td>',
  '<td className="px-4 py-3 text-neutral-500">{g.fecha_ultimo_mantenimiento ? new Date(g.fecha_ultimo_mantenimiento).toLocaleDateString() : "Sin registro"}</td>'
);

// 6. Find the actions column and add wrench icon
code = code.replace(
  /<button onClick=\{\(\) => \{ setEditingGaleron\(g\); setGaleronForm\(\{nombre: g\.nombre, capacidad_maxima: g\.capacidad_maxima\.toString\(\)\}\); setShowGaleronForm\(true\); \}\} className="text-neutral-500 hover:text-blue-600"><Edit className="w-4 h-4 inline"\/><\/button>/g,
  `<button onClick={() => { setSelectedMantenimientoGaleron(g); setShowMantenimientoForm(true); setMantenimientoForm({ fecha: new Date().toISOString().split('T')[0], tipo: 'Preventivo', descripcion: '', estado: 'Completado' }); }} className="text-neutral-500 hover:text-orange-600" title="Registrar Mantenimiento"><Wrench className="w-4 h-4 inline"/></button>
                            <button onClick={() => { setEditingGaleron(g); setGaleronForm({nombre: g.nombre, capacidad_maxima: g.capacidad_maxima.toString()}); setShowGaleronForm(true); }} className="text-neutral-500 hover:text-blue-600"><Edit className="w-4 h-4 inline"/></button>`
);

// 7. Remove estado fisico input block
const estadoFisicoSelectRegex = /<div className="space-y-2">\s*<label className="text-xs font-bold text-neutral-600 uppercase">Estado Físico<\/label>\s*<select[\s\S]*?<\/select>\s*<\/div>/m;
code = code.replace(estadoFisicoSelectRegex, "");

fs.writeFileSync('src/components/Operaciones.tsx', code);
