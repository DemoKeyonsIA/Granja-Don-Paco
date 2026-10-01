const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf-8');

// The new nav items
const navTarget = `  const navItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard, roles: ['Admin'] },
    { id: 'bot' as const, label: 'Estela (AI)', icon: Bot, roles: ['Admin', 'Vendedor'] },
    { id: 'produccion' as const, label: 'Producción', icon: Activity, roles: ['Admin', 'Operario'] },
    { id: 'logistica' as const, label: 'Ruta/Facel', icon: Map, roles: ['Admin', 'Vendedor'] },
    { id: 'clientes' as const, label: 'Clientes', icon: Users, roles: ['Admin', 'Facturador', 'Vendedor'] },
    { id: 'inventario' as const, label: 'Inventario', icon: PackageOpen, roles: ['Admin', 'Facturador', 'Vendedor'] },
    { id: 'ventas' as const, label: 'Ventas', icon: Package, roles: ['Admin', 'Facturador', 'Vendedor'] },
    { id: 'cobranza' as const, label: 'Cobranza', icon: DollarSign, roles: ['Admin', 'Facturador', 'Vendedor'] },
    { id: 'gastos' as const, label: 'Gastos', icon: Truck, roles: ['Admin', 'Vendedor'] },
  ];`;

const newNav = `  const macroModules = [
    { id: 'dashboard' as const, label: 'Centro de Mando', icon: LayoutDashboard, roles: ['Admin'] },
    { id: 'finanzas' as const, label: 'Finanzas', icon: DollarSign, roles: ['Admin'] },
    { id: 'produccion' as const, label: 'Producción', icon: Activity, roles: ['Admin', 'Operario'] },
    { id: 'inventario' as const, label: 'Inventario y Bodegas', icon: PackageOpen, roles: ['Admin', 'Facturador', 'Vendedor'] },
    { id: 'logistica' as const, label: 'Logística y Comercial', icon: Truck, roles: ['Admin', 'Vendedor', 'Facturador'] },
  ];`;

if (content.includes(navTarget)) {
  content = content.replace(navTarget, newNav);
} else {
  console.log("Nav items not found");
}

// Update ActiveTab type
const tabTypeTarget = `const [activeTab, setActiveTab] = useState<'bot' | 'logistica' | 'clientes' | 'inventario' | 'ventas' | 'cobranza' | 'gastos' | 'produccion' | 'dashboard'>(currentUser.role === 'Admin' ? 'dashboard' : 'bot');`;
const newTabType = `  const [activeTab, setActiveTab] = useState<'dashboard' | 'finanzas' | 'produccion' | 'inventario' | 'logistica'>(currentUser.role === 'Admin' ? 'dashboard' : 'logistica');
  const [subTab, setSubTab] = useState<string>(''); // For sub-navigation
  const [isEstelaOpen, setIsEstelaOpen] = useState(false);
`;
if (content.includes(tabTypeTarget)) {
  content = content.replace(tabTypeTarget, newTabType);
}

// Update Sidebar mapping
const sidebarMapTarget = `{filteredNav.map((item) => {`;
const sidebarMapReplacement = `{macroModules.filter(item => item.roles.includes(currentUser.role)).map((item) => {`;
if (content.includes(sidebarMapTarget)) {
  content = content.replace(sidebarMapTarget, sidebarMapReplacement);
}

// Update TopBar and Estela button
const headerTarget = `{/* Header Mobile Only */}`;
const headerReplacement = `
        {/* Top Bar (Desktop & Mobile) */}
        <div className="bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setIsMenuOpen(true)}
              className="p-2 -ml-2 text-neutral-600 hover:bg-neutral-100 rounded-lg lg:hidden"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="hidden md:flex items-center bg-neutral-100 rounded-lg px-3 py-2 w-64 border border-neutral-200 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
              <Search className="w-4 h-4 text-neutral-400 mr-2" />
              <input 
                type="text" 
                placeholder="Buscar cliente, factura..." 
                className="bg-transparent border-none focus:outline-none text-sm w-full"
              />
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="relative group">
              <button className="flex items-center space-x-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nuevo</span>
              </button>
              {/* Dropdown for quick actions can go here */}
            </div>
            <button 
              onClick={() => setIsEstelaOpen(!isEstelaOpen)}
              className={cn(
                "flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors border",
                isEstelaOpen ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
              )}
            >
              <Bot className="w-4 h-4" />
              <span className="hidden sm:inline">Estela AI</span>
            </button>
          </div>
        </div>

        {/* Floating Estela Panel */}
        {isEstelaOpen && (
          <div className="absolute top-16 right-4 w-96 max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-5rem)] bg-white rounded-2xl shadow-2xl border border-neutral-200 flex flex-col z-50 overflow-hidden flex flex-col">
            <div className="bg-indigo-600 px-4 py-3 flex justify-between items-center shrink-0">
              <div className="flex items-center space-x-2 text-white">
                <Bot className="w-5 h-5" />
                <span className="font-bold">Estela AI</span>
              </div>
              <button onClick={() => setIsEstelaOpen(false)} className="text-white/80 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Estela Chat Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50">
              {!result && !loading && !error && (
               <div className="bg-white rounded-xl p-5 shadow-sm border border-neutral-200 text-center">
                 <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3">
                   <Bot className="w-6 h-6 text-indigo-600" />
                 </div>
                 <h3 className="text-sm font-bold text-neutral-800 mb-1">Soy Estela</h3>
                 <p className="text-xs text-neutral-500">¿Qué datos de ventas o gastos quieres procesar?</p>
               </div>
              )}
              {error && (
                <div className="bg-red-50 text-red-700 p-3 rounded-xl border border-red-200 text-sm flex items-start">
                  <Info className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}
              {result && (
                <div className="space-y-4">
                  {result.modulo_ventas && <VentaCard data={result.modulo_ventas} />}
                  {result.modulo_cobranza && <CobranzaCard data={result.modulo_cobranza} />}
                  {result.modulo_gastos && result.modulo_gastos.length > 0 && <GastosCard data={result.modulo_gastos} />}
                </div>
              )}
            </div>

            <div className="bg-white border-t border-neutral-200 p-3 shrink-0">
              <form onSubmit={handleSubmit} className="relative flex items-end bg-neutral-100 rounded-xl border border-neutral-300 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition-all p-1">
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Mensaje..."
                  className="w-full bg-transparent border-none focus:ring-0 resize-none py-2 pl-3 pr-10 text-sm text-neutral-900 min-h-[40px] leading-relaxed"
                  rows={1}
                  disabled={loading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                />
                <div className="absolute right-1 bottom-1">
                  <button
                    type="submit"
                    disabled={!message.trim() || loading}
                    className="w-8 h-8 flex items-center justify-center bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-all"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        
        {/* Header Mobile Only (Removed original mobile header, now using TopBar) */}
`;

if (content.includes(headerTarget)) {
  // We need to replace the original mobile header and the content area with sub-tabs.
  // Actually let's just find the start of the layout:
}

fs.writeFileSync('update_app_layout_script.js', '');
