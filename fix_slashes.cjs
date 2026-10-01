const fs = require('fs');
let content = fs.readFileSync('src/components/Produccion.tsx', 'utf-8');
content = content.replace(/\\\`/g, '`');
content = content.replace(/\\\$/g, '$');
fs.writeFileSync('src/components/Produccion.tsx', content);
