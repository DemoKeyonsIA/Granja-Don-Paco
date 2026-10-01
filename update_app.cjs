const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Replace imports
code = code.replace(
  "import Produccion from \"./components/Produccion\";\nimport Finanzas from \"./components/Finanzas\";\n",
  "import Operaciones from \"./components/Operaciones\";\nimport Finanzas from \"./components/Finanzas\";\n"
);
code = code.replace(
  "import Inventario from \"./components/Inventario\";\n",
  ""
);

// State replacement
code = code.replace(
  "const [activeTab, setActiveTab] = useState<'dashboard' | 'finanzas' | 'produccion' | 'inventario' | 'logistica'>(",
  "const [activeTab, setActiveTab] = useState<'dashboard' | 'finanzas' | 'operaciones' | 'logistica'>("
);

// macroModules replacement
const macroModulesOld = `  const macroModules = [
    { id: 'dashboard' as const, label: 'Centro de Mando', icon: LayoutDashboard, roles: ['Admin'] },
    { id: 'finanzas' as const, label: 'Finanzas', icon: DollarSign, roles: ['Admin'] },
    { id: 'produccion' as const, label: 'Producción', icon: Activity, roles: ['Admin', 'Operario'] },
    { id: 'inventario' as const, label: 'Bodegas', icon: PackageOpen, roles: ['Admin', 'Facturador', 'Vendedor'] },
    { id: 'logistica' as const, label: 'Logística', icon: Truck, roles: ['Admin', 'Vendedor', 'Facturador'] },
  ];`;
const macroModulesNew = `  const macroModules = [
    { id: 'dashboard' as const, label: 'Centro de Mando', icon: LayoutDashboard, roles: ['Admin'] },
    { id: 'finanzas' as const, label: 'Finanzas', icon: DollarSign, roles: ['Admin'] },
    { id: 'operaciones' as const, label: 'Operaciones y Bodegas', icon: PackageOpen, roles: ['Admin', 'Operario', 'Facturador', 'Vendedor'] },
    { id: 'logistica' as const, label: 'Logística', icon: Truck, roles: ['Admin', 'Vendedor', 'Facturador'] },
  ];`;
code = code.replace(macroModulesOld, macroModulesNew);

// Tab Content replacement
const tabsContentOld = `{activeTab === 'produccion' && (
            <Produccion currentUser={currentUser} />
          )}
          {activeTab === 'inventario' && (
            <Inventario currentUser={currentUser} />
          )}`;
const tabsContentNew = `{activeTab === 'operaciones' && (
            <Operaciones currentUser={currentUser} />
          )}`;
code = code.replace(tabsContentOld, tabsContentNew);

fs.writeFileSync('src/App.tsx', code);
