const fs = require('fs');
let code = fs.readFileSync('src/components/Produccion.tsx', 'utf8');

// 1. Add historial to tabs
code = code.replace(
  "const [activeTab, setActiveTab] = useState<'dashboard' | 'recoleccion' | 'mortalidad' | 'configuracion'>('dashboard');",
  "const [activeTab, setActiveTab] = useState<'dashboard' | 'recoleccion' | 'mortalidad' | 'configuracion' | 'historial'>('dashboard');"
);

code = code.replace(
  "          { id: 'mortalidad', label: 'Mortalidad' },\n          { id: 'configuracion', label: 'Configuración de Infraestructura' },",
  "          { id: 'mortalidad', label: 'Mortalidad' },\n          { id: 'configuracion', label: 'Configuración de Infraestructura' },\n          { id: 'historial', label: 'Historial de Productividad' },"
);

// 2. Add state
code = code.replace(
  "const [lotes, setLotes] = useState<LoteAves[]>([]);",
  "const [lotes, setLotes] = useState<LoteAves[]>([]);\n  const [historialProduccion, setHistorialProduccion] = useState<any[]>([]);"
);

// 3. Add to fetchData
code = code.replace(
  "fetch('/api/lotes')",
  "fetch('/api/lotes'),\n        fetch('/api/produccion/historial')"
);
code = code.replace(
  "if (resLotes.ok) setLotes(await resLotes.json());",
  "if (resLotes.ok) setLotes(await resLotes.json());\n      if (resGranjas.ok /* temp logic because res[3] is not destructured */) {\n        // let's do it better\n      }"
);
