const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(/estado_fisico/g, 'fecha_ultimo_mantenimiento');
code = code.replace(/fecha_ultimo_mantenimiento: 'Óptimo'/g, 'fecha_ultimo_mantenimiento: null');
code = code.replace("if (!granjaId || !nombre || !capacidad_maxima || !fecha_ultimo_mantenimiento) return", "if (!granjaId || !nombre || !capacidad_maxima) return");

// I also need to add endpoints to fetch/create `mantenimientos` for a Galeron
// First let's just do the replace.

fs.writeFileSync('server.ts', code);
