const fs = require('fs');
let code = fs.readFileSync('src/components/Operaciones.tsx', 'utf8');

code = code.replace(
  'if (!granjaForm.nombre || !granjaForm.ubicacion) {',
  'if (!granjaForm.nombre || !granjaForm.ubicacion || granjaForm.tipo_produccion.length === 0) {'
);

code = code.replace(
  'setWizardError("El nombre y la ubicación son obligatorios.");',
  'setWizardError("El nombre, la ubicación y el tipo de producción son obligatorios.");'
);

fs.writeFileSync('src/components/Operaciones.tsx', code);
