const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  "m.fecha.startsWith(hoy)",
  "String(m.fecha).startsWith(hoy)"
);

code = code.replace(
  "acc + curr.cantidad",
  "acc + Number(curr.cantidad)"
);

fs.writeFileSync('server.ts', code);
