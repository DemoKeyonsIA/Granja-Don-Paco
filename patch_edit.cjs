const fs = require('fs');
let code = fs.readFileSync('src/components/Operaciones.tsx', 'utf8');

code = code.replace(
  "setGranjaForm({nombre: g.nombre, ubicacion: g.ubicacion, encargadoId: g.encargadoId});",
  "setGranjaForm({nombre: g.nombre, ubicacion: g.ubicacion, tipo_produccion: g.tipo_produccion ? g.tipo_produccion.split(',').map(s => s.trim()) : [], encargadoId: g.encargadoId});"
);

fs.writeFileSync('src/components/Operaciones.tsx', code);
