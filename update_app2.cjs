const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /\{activeTab === 'produccion' && \([\s\S]*?<Produccion currentUser=\{currentUser\} \/>\s*\)\}\s*\{activeTab === 'inventario' && \([\s\S]*?<Inventario currentUser=\{currentUser\} \/>\s*\)\}/m;

code = code.replace(regex, `{activeTab === 'operaciones' && (
            <Operaciones currentUser={currentUser} />
          )}`);

fs.writeFileSync('src/App.tsx', code);
