const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/import Expediente from "\.\/components\/Expediente";\n/, "");
code = code.replace(/ \| 'expediente'/g, "");
code = code.replace(/ {4}\{ id: 'expediente' as const, label: 'Expediente Clínico', icon: Activity, roles: \['Admin', 'Médico'\] \},\n/, "");
code = code.replace(/ {10}\{activeTab === 'expediente' && \(\n {12}<Expediente \/>\n {10}\)\}\n/g, "");

fs.writeFileSync('src/App.tsx', code);
