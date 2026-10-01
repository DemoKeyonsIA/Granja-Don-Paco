const fs = require('fs');
let code = fs.readFileSync('src/components/Produccion.tsx', 'utf8');

code = code.replace(
  "const [lotes, setLotes] = useState<LoteAves[]>([]);",
  "const [lotes, setLotes] = useState<LoteAves[]>([]);\n  const [historialProduccion, setHistorialProduccion] = useState<any[]>([]);"
);

fs.writeFileSync('src/components/Produccion.tsx', code);
