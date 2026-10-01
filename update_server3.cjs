const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf-8');

content = content.replace(
  /with: {\s*detalles: true\s*}/,
  ""
);

fs.writeFileSync('server.ts', content);
console.log("server.ts updated to remove with: {detalles}");
