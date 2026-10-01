const fs = require('fs');

const appTsx = `import React from "react";
import { useState, useRef, useEffect } from "react";
import { Send, Bot, Loader2, DollarSign, Package, Truck, Info, Menu, CheckCircle2, X, Users, LogOut, PackageOpen, Map, Activity, LayoutDashboard, Search, Plus } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import Login from "./components/Login";
import Clientes from "./components/Clientes";
import Inventario from "./components/Inventario";
import Facturacion from "./components/Facturacion";
import Logistica from "./components/Logistica";
import Cobranza from "./components/Cobranza";
import Produccion from "./components/Produccion";
import DashboardAdmin from "./components/DashboardAdmin";
import { User, ExtractedData } from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  if (!currentUser) {
    return <Login onLogin={setCurrentUser} />;
  }

  return <AppLayout currentUser={currentUser} onLogout={() => setCurrentUser(null)} />;
}

function AppLayout({ currentUser, onLogout }: { currentUser: User, onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'finanzas' | 'produccion' | 'inventario' | 'logistica'>(
    currentUser.role === 'Admin' ? 'dashboard' : 'logistica'
  );
  
  // For sub-tabs within macro modules
  const [subTab, setSubTab] = useState<string>(''); 

  useEffect(() => {
    // Reset subtab when changing main tab
    if (activeTab === 'logistica') setSubTab('rutas');
    if (activeTab === 'finanzas') setSubTab('flujo');
  }, [activeTab]);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEstelaOpen, setIsEstelaOpen] = useState(false);

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar el mensaje');
      }

      setResult(data);
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const macroModules = [
    { id: 'dashboard' as const, label: 'Centro de Mando', icon: LayoutDashboard, roles: ['Admin'] },
    { id: 'finanzas' as const, label: 'Finanzas', icon: DollarSign, roles: ['Admin'] },
    { id: 'produccion' as const, label: 'Producción', icon: Activity, roles: ['Admin', 'Operario'] },
    { id: 'inventario' as const, label: 'Bodegas', icon: PackageOpen, roles: ['Admin', 'Facturador', 'Vendedor'] },
    { id: 'logistica' as const, label: 'Logística', icon: Truck, roles: ['Admin', 'Vendedor', 'Facturador'] },
  ];

  const renderSidebarContent = (isMobile = false) => (
    <>
      <div className="bg-neutral-900 pt-8 pb-6 px-6 text-white shrink-0 relative">
        {isMobile && (
          <button 
            onClick={() => setIsMenuOpen(false)}
            className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        )}
        <div className="flex items-center space-x-3 mb-2">
          <div className="bg-blue-600 p-2.5 rounded-xl shadow-lg border border-blue-500/30">
            <Bot className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight leading-none text-white">Granja</h1>
            <p className="text-sm font-bold text-blue-400 tracking-wide">Don Paco</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
        <p className="px-3 text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">Módulos</p>
        {macroModules.filter(item => item.roles.includes(currentUser.role)).map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id as any);
                if (isMobile) setIsMenuOpen(false);
              }}
              className={cn(
                "w-full flex items-center space-x-3 px-3 py-3 rounded-xl transition-all duration-200 text-sm font-bold border",
                isActive 
                  ? "bg-white text-blue-700 shadow-sm border-neutral-200" 
                  : "text-neutral-500 hover:bg-neutral-200/50 hover:text-neutral-900 border-transparent"
              )}
            >
              <Icon className={cn("w-5 h-5", isActive ? "text-blue-600" : "text-neutral-400")} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="p-4 border-t border-neutral-200 shrink-0">
        <div className="bg-white rounded-xl p-3 flex items-center space-x-3 border border-neutral-200 shadow-sm mb-3">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 border border-blue-200 text-blue-700 font-bold">
            {currentUser.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-neutral-800 truncate leading-tight">{currentUser.name}</p>
            <p className="text-xs text-neutral-500 font-medium truncate">{currentUser.role}</p>
          </div>
        </div>
        <button 
          onClick={onLogout}
          className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl text-neutral-600 hover:bg-neutral-200/50 hover:text-neutral-900 transition-colors font-bold text-sm"
        >
          <LogOut className="w-4 h-4" />
          <span>Cerrar Sesión</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen bg-neutral-100 flex overflow-hidden font-sans text-neutral-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-72 bg-neutral-100 border-r border-neutral-200 z-10 shrink-0">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm" onClick={() => setIsMenuOpen(false)} />
          <aside className="relative w-80 max-w-[85vw] bg-neutral-100 h-full flex flex-col shadow-2xl">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        
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
                className="bg-transparent border-none focus:outline-none text-sm w-full font-medium"
              />
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="relative group">
              <button className="flex items-center space-x-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nuevo</span>
              </button>
            </div>
            <button 
              onClick={() => setIsEstelaOpen(!isEstelaOpen)}
              className={cn(
                "flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors border",
                isEstelaOpen ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"
              )}
            >
              <Bot className="w-4 h-4 text-indigo-600" />
              <span className="hidden sm:inline text-indigo-900">Estela AI</span>
            </button>
          </div>
        </div>

        {/* Floating Estela Panel */}
        {isEstelaOpen && (
          <div className="absolute top-16 right-4 w-96 max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-5rem)] bg-white rounded-2xl shadow-2xl border border-neutral-200 flex flex-col z-50 overflow-hidden">
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

        <main className="flex-1 overflow-y-auto w-full bg-neutral-50/50 p-4 lg:p-6">
          {activeTab === 'dashboard' && (
            <DashboardAdmin />
          )}

          {activeTab === 'produccion' && (
            <Produccion currentUser={currentUser} />
          )}

          {activeTab === 'inventario' && (
            <Inventario currentUser={currentUser} />
          )}

          {activeTab === 'logistica' && (
            <div className="space-y-6">
              <div className="flex border-b border-neutral-200 space-x-6 overflow-x-auto">
                {['rutas', 'facturacion', 'clientes'].map(t => (
                  <button
                    key={t}
                    onClick={() => setSubTab(t)}
                    className={cn(
                      "pb-3 text-sm font-bold capitalize transition-colors whitespace-nowrap",
                      subTab === t ? "text-blue-600 border-b-2 border-blue-600" : "text-neutral-500 hover:text-neutral-800"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              
              <div className="animate-in fade-in">
                {subTab === 'rutas' && <Logistica currentUser={currentUser} />}
                {subTab === 'facturacion' && <Facturacion currentUser={currentUser} />}
                {subTab === 'clientes' && <Clientes currentUser={currentUser} />}
              </div>
            </div>
          )}

          {activeTab === 'finanzas' && (
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
          )}
        </main>
      </div>
    </div>
  );
}

// --- Subcomponents ---

function VentaCard({ data }: { data: ExtractedData['modulo_ventas'] }) {
  if (!data) return null;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
      <div className="bg-emerald-50/50 px-4 py-2.5 border-b border-emerald-100 flex items-center space-x-2">
        <Package className="w-4 h-4 text-emerald-600" />
        <h3 className="font-bold text-emerald-900 text-[11px] tracking-wide">MÓDULO DE VENTAS</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider mb-0.5">Cliente</p>
            <p className="font-bold text-neutral-900 text-sm leading-tight">{data.cliente}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider mb-0.5">Condición</p>
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide shadow-sm",
              data.condicion === "Contado" ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-amber-100 text-amber-800 border border-amber-200"
            )}>
              {data.condicion}
            </span>
          </div>
        </div>
        
        <div className="h-px bg-neutral-100 w-full my-1"></div>
        
        <div className="flex justify-between items-end">
          <div className="space-y-1">
            <p className="text-xs text-neutral-600"><span className="font-bold text-neutral-900">{data.peso_kilos}</span> kg</p>
            <p className="text-xs text-neutral-600">₡{data.precio_por_kilo?.toLocaleString()} / kg</p>
          </div>
          <div className="text-right bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100">
            <p className="text-[9px] text-emerald-700 font-bold uppercase tracking-wider mb-0.5">Total Venta</p>
            <p className="font-black text-lg text-emerald-700">₡{data.total_venta?.toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CobranzaCard({ data }: { data: ExtractedData['modulo_cobranza'] }) {
  if (!data) return null;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
      <div className="bg-blue-50/50 px-4 py-2.5 border-b border-blue-100 flex items-center space-x-2">
        <DollarSign className="w-4 h-4 text-blue-600" />
        <h3 className="font-bold text-blue-900 text-[11px] tracking-wide">MÓDULO DE COBRANZA</h3>
      </div>
      <div className="p-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider mb-0.5">Método de Pago</p>
          <p className="font-bold text-neutral-900 text-sm">{data.metodo_pago}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider mb-0.5">Monto Cobrado</p>
          <p className="font-black text-lg text-blue-700">₡{data.monto_pagado?.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

function GastosCard({ data }: { data: ExtractedData['modulo_gastos'] }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden mb-4">
      <div className="bg-orange-50/50 px-4 py-2.5 border-b border-orange-100 flex items-center space-x-2">
        <Truck className="w-4 h-4 text-orange-600" />
        <h3 className="font-bold text-orange-900 text-[11px] tracking-wide">MÓDULO DE GASTOS</h3>
      </div>
      <div className="divide-y divide-neutral-100">
        {data.map((gasto, idx) => (
          <div key={idx} className="p-4 flex justify-between items-center bg-white">
            <div>
              <p className="font-bold text-neutral-900 text-sm">{gasto.categoria}</p>
              <p className="text-xs text-neutral-500 mt-0.5 leading-snug">{gasto.descripcion}</p>
            </div>
            <div className="text-right pl-4">
               <p className="font-black text-base text-orange-600 whitespace-nowrap">
                - ₡{gasto.monto?.toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
`;

fs.writeFileSync('src/App.tsx', appTsx);
console.log("App.tsx replaced successfully");
