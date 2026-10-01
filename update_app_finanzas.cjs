const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Add import
const importTarget = 'import Produccion from "./components/Produccion";';
const importReplacement = 'import Produccion from "./components/Produccion";\nimport Finanzas from "./components/Finanzas";';
if (content.includes(importTarget)) {
  content = content.replace(importTarget, importReplacement);
}

// Replace the finanzas block in App.tsx
const finanzasTarget = `          {activeTab === 'finanzas' && (
            <div className="space-y-6">
              <div className="flex border-b border-neutral-200 space-x-6 overflow-x-auto">
                {['flujo', 'cobranza', 'gastos'].map(t => (
                  <button
                    key={t}
                    onClick={() => setSubTab(t)}
                    className={cn(
                      "pb-3 text-sm font-bold capitalize transition-colors whitespace-nowrap",
                      subTab === t ? "text-blue-600 border-b-2 border-blue-600" : "text-neutral-500 hover:text-neutral-800"
                    )}
                  >
                    {t === 'flujo' ? 'Flujo de Caja' : t}
                  </button>
                ))}
              </div>
              
              <div className="animate-in fade-in">
                {subTab === 'flujo' && (
                  <div className="bg-white rounded-3xl p-10 border border-neutral-200 text-center">
                    <DollarSign className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-neutral-800 mb-2">Flujo de Caja</h3>
                    <p className="text-neutral-500">Módulo en construcción.</p>
                  </div>
                )}
                {subTab === 'cobranza' && <Cobranza currentUser={currentUser} />}
                {subTab === 'gastos' && (
                  <div className="bg-white rounded-3xl p-10 border border-neutral-200 text-center">
                    <Truck className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-neutral-800 mb-2">Gastos Registrados</h3>
                    <p className="text-neutral-500">Ingresa gastos vía Estela AI o crea uno nuevo manualmente.</p>
                  </div>
                )}
              </div>
            </div>
          )}`;
          
const finanzasReplacement = `          {activeTab === 'finanzas' && (
            <Finanzas currentUser={currentUser} />
          )}`;

if (content.includes(finanzasTarget)) {
  content = content.replace(finanzasTarget, finanzasReplacement);
  fs.writeFileSync('src/App.tsx', content);
  console.log('App.tsx updated to use Finanzas component');
} else {
  console.log('Target block not found in App.tsx');
}
