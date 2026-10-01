const fs = require('fs');
let code = fs.readFileSync('src/components/Operaciones.tsx', 'utf8');

const regex = /const res = await fetch\('\/api\/granjas\/wizard', \{\s*method: 'POST',/m;
const replacement = `const url = editingGranja ? \`/api/granjas/\${editingGranja.id}\` : '/api/granjas/wizard';
                            const res = await fetch(url, {
                              method: editingGranja ? 'PUT' : 'POST',`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/components/Operaciones.tsx', code);
