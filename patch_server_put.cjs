const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  "const { nombre, ubicacion, encargadoId, estado } = req.body;",
  "const { nombre, ubicacion, tipo_produccion, encargadoId, estado } = req.body;"
);

code = code.replace(
  "if (ubicacion) updateData.ubicacion = ubicacion;",
  "if (ubicacion) updateData.ubicacion = ubicacion;\n      if (tipo_produccion) updateData.tipo_produccion = tipo_produccion;"
);

fs.writeFileSync('server.ts', code);
