import React from "react";
import { useState, useRef, useEffect, useMemo } from "react";
import { Activity, Bot, ChevronRight, ChevronDown, DollarSign, LayoutDashboard, LogOut, PackageOpen, Plus, Send, Settings, User as UserIcon, X, Loader2, Info, Navigation, Truck, RefreshCcw, Sparkles, Menu, Search, Egg, BarChart3, Sun, Moon, Shield, FileText, Users, ClipboardList, CreditCard, Tag, Mail } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { cn } from './lib/utils';
import { ErrorBoundary } from './components/ErrorBoundary';
import Login from "./components/Login";
import Clientes from "./components/Clientes";
import Facturacion from "./components/Facturacion";
import Logistica from "./components/Logistica";
import CajaRuta from "./components/CajaRuta";
import TableroRutas from "./components/TableroRutas";
import Cobranza from "./components/Cobranza";
import Granjas from "./components/Granjas";
import OperacionesAdmin from "./components/operaciones";
import DespachoMovil from "./components/DespachoMovil";
import BodegaMovil from "./components/BodegaMovil";
import CamioneroMovil from "./components/CamioneroMovil";
import IncidentesMovil from "./components/IncidentesMovil";
import Finanzas from "./components/Finanzas";
import Etiquetas from "./components/Etiquetas";
import Pesos from "./components/Pesos";
import DashboardEnterprise from "./components/DashboardEnterprise";
import SaludAvicola from "./components/SaludAvicola";
import Alimento from "./components/Alimento";
import Mantenimiento from "./components/Mantenimiento";
import Precios from "./components/Precios";
import Admin from "./components/Admin";
import Office from "./components/Office";
import Reportes from "./components/Reportes";
import { User, Role } from './types';
import { loadSession, clearSession } from './lib/session';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      return loadSession()?.user ?? null;
    }
    return null;
  });
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('darkMode') === 'true' ||
        (!localStorage.getItem('darkMode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  const handleLogout = () => {
    const session = loadSession();
    clearSession();
    setCurrentUser(null);
    if (session?.token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      }).catch(() => {});
    }
  };
  
  if (!currentUser) {
    return (
      <>
        <Toaster richColors position="top-center" />
        <ErrorBoundary>
          <Login onLogin={setCurrentUser} />
        </ErrorBoundary>
      </>
    );
  }

  return (
    <>
      <Toaster richColors position="top-center" />
      <ErrorBoundary>
        <AppLayout currentUser={currentUser} onLogout={handleLogout} darkMode={darkMode} onToggleDark={() => setDarkMode(!darkMode)} />
      </ErrorBoundary>
    </>
  );
}

function AppLayout({ currentUser, onLogout, darkMode, onToggleDark }: { currentUser: User, onLogout: () => void, darkMode: boolean, onToggleDark: () => void }) {
  const ROLE_LABELS: Record<string, string> = {
    Admin: 'Administrador',
    Socio: 'Socio',
    Comercial: 'Comercial',
    Despachador: 'Encargado de Galerón',
    Bodeguero: 'Bodeguero',
    Camionero: 'Camionero',
  };
  const [activeTab, setActiveTab] = useState<string>(
    currentUser.role === 'Admin' ? 'dashboard' : currentUser.role === 'Despachador' || currentUser.role === 'Bodeguero' || currentUser.role === 'Camionero' ? 'operaciones' : 'logistica'
  );
  
  // For sub-tabs within macro modules
  const [subTab, setSubTab] = useState<string>(''); 
  // Marca que la sub-vista fue elegida explícitamente (búsqueda o menú Nuevo)
  // para que el reset por cambio de macro-módulo no la pise.
  const subTabManual = useRef(false);

  useEffect(() => {
    // Reset subtab when changing main tab
    if (activeTab === 'logistica') {
      setSubTab(currentUser.role === 'Comercial' ? 'caja' : 'logistica');
    }
    if (activeTab === 'finanzas') setSubTab('flujo');
    if (activeTab === 'granja') setSubTab('granjas');
    if (activeTab === 'admin' && !subTabManual.current) setSubTab('productos');
    subTabManual.current = false;
    if (activeTab === 'operaciones') {
      const roles = currentUser.roles?.length ? currentUser.roles : [currentUser.role];
      if (roles.some(r => r === 'Camionero')) setSubTab(roles.some(r => r === 'Bodeguero') ? 'recibir' : 'confirmar');
      else if (roles.some(r => r === 'Bodeguero')) setSubTab('recibir');
      else if (roles.some(r => r === 'Despachador')) setSubTab('carga');
      else setSubTab('produccion');
    }
  }, [activeTab, currentUser.role, currentUser.roles]);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEstelaOpen, setIsEstelaOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNuevoOpen, setIsNuevoOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || loading) return;

    const userMessage = message.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setMessage('');
    
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat/estela', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar el mensaje');
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
      
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const nuevoItems = useMemo(() => {
    const items: { label: string; icon: any; tab: string; subTab?: string }[] = [];
    if (currentUser.role === 'Despachador' || currentUser.role === 'Bodeguero') return items;
    if (activeTab === 'logistica') {
      items.push({ label: 'Guía de Despacho', icon: ClipboardList, tab: 'logistica', subTab: 'guias' });
      items.push({ label: 'Venta (Caja)', icon: CreditCard, tab: 'logistica', subTab: 'caja' });
    } else if (activeTab === 'clientes') {
      items.push({ label: 'Cliente', icon: Users, tab: 'clientes' });
    } else if (activeTab === 'admin') {
      if (subTab === 'vinculaciones') {
        items.push({ label: 'Nueva regla', icon: Settings, tab: 'admin', subTab: 'vinculaciones' });
      } else {
        items.push({ label: 'Producto Catálogo', icon: Tag, tab: 'admin', subTab: 'productos' });
        items.push({ label: 'Camión', icon: Truck, tab: 'admin', subTab: 'infraestructura' });
        items.push({ label: 'Usuario', icon: Users, tab: 'admin', subTab: 'usuarios' });
      }
    } else if (activeTab === 'finanzas') {
      items.push({ label: 'Gasto', icon: DollarSign, tab: 'finanzas', subTab: 'flujo' });
    } else if (activeTab === 'granja') {
      items.push({ label: 'Granja', icon: Egg, tab: 'granja', subTab: 'granjas' });
    } else if (activeTab === 'operaciones') {
      items.push({ label: 'Producción', icon: PackageOpen, tab: 'operaciones', subTab: 'produccion' });
      items.push({ label: 'Remisión', icon: FileText, tab: 'operaciones', subTab: 'remisiones' });
    } else if (activeTab === 'office') {
      items.push({ label: 'Conectar cuenta', icon: Mail, tab: 'office', subTab: 'correo' });
      items.push({ label: 'Subir documento', icon: FileText, tab: 'office', subTab: 'documentos' });
    }
    if (items.length === 0) {
      items.push({ label: 'Guía de Despacho', icon: ClipboardList, tab: 'logistica', subTab: 'guias' });
      items.push({ label: 'Cliente', icon: Users, tab: 'clientes' });
    }
    return items;
  }, [activeTab, subTab, currentUser.role]);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) return;
    const lower = q.toLowerCase();
    if (lower.includes('vinculo') || lower.includes('vínculo') || lower.includes('regla') || lower.includes('integracion') || lower.includes('integración')) {
      subTabManual.current = true;
      setActiveTab('admin'); setSubTab('vinculaciones');
    } else if (lower.includes('correo') || lower.includes('email') || lower.includes('gmail') || lower.includes('bandeja')) {
      setActiveTab('office'); setSubTab('correo');
    } else if (lower.includes('drive') || lower.includes('documento') || lower.includes('carpeta') || lower.includes('adjunto')) {
      setActiveTab('office'); setSubTab('documentos');
    } else if (lower.includes('guia') || lower.includes('despacho') || lower.includes('camion')) {
      setActiveTab('logistica'); setSubTab('guias');
    } else if (lower.includes('remision')) {
      setActiveTab('logistica'); setSubTab('remisiones');
    } else if (lower.includes('cliente')) {
      setActiveTab('clientes');
    } else if (lower.includes('venta') || lower.includes('caja') || lower.includes('tiquete')) {
      setActiveTab('logistica'); setSubTab('caja');
    } else if (lower.includes('factura') || lower.includes('cobro')) {
      setActiveTab('logistica'); setSubTab('facturacion');
    } else if (lower.includes('tablero') || lower.includes('ruta')) {
      setActiveTab('logistica'); setSubTab('tablero');
    } else if (lower.includes('gasto') || lower.includes('flujo')) {
      setActiveTab('finanzas'); setSubTab('flujo');
    } else if (lower.includes('granja') || lower.includes('galero')) {
      setActiveTab('granja'); setSubTab('granjas');
    } else if (lower.includes('etiqueta') || lower.includes('qr')) {
      setActiveTab('logistica'); setSubTab('etiquetas');
    } else if (lower.includes('usuario') || lower.includes('rol') || lower.includes('admin')) {
      setActiveTab('admin'); setSubTab('usuarios');
    } else if (lower.includes('camion') && (lower.includes('admin') || lower.includes('config'))) {
      setActiveTab('admin'); setSubTab('infraestructura');
    } else if (lower.includes('producto') && (lower.includes('tipo') || lower.includes('admin'))) {
      setActiveTab('admin'); setSubTab('productos');
    } else if (lower.includes('reporte')) {
      setActiveTab('finanzas'); setSubTab('reportes');
    } else if (lower.includes('peso')) {
      setActiveTab('logistica'); setSubTab('pesos');
    } else if (lower.includes('precio')) {
      setActiveTab('logistica'); setSubTab('precios');
    }
  };

  const macroModules = [
    { id: 'dashboard' as const, label: 'Centro de Mando', icon: LayoutDashboard, roles: ['Admin', 'Socio'] },
    { id: 'finanzas' as const, label: 'Finanzas', icon: DollarSign, roles: ['Admin', 'Socio'] },
    { id: 'granja' as const, label: 'Granja', icon: Egg, roles: ['Admin'] },
    { id: 'admin' as const, label: 'Admin', icon: Settings, roles: ['Admin'] },
    { id: 'office' as const, label: 'Office', icon: Mail, roles: ['Admin', 'Socio', 'Comercial'] },
    { id: 'operaciones' as const, label: currentUser.role === 'Despachador' ? 'Carga a Bodega' : currentUser.role === 'Bodeguero' ? 'Recepción' : currentUser.role === 'Camionero' ? 'Confirmar Cargas' : 'Operaciones y Bodegas', icon: PackageOpen, roles: ['Admin', 'Bodeguero', 'Despachador', 'Camionero', 'Comercial'] },
    { id: 'logistica' as const, label: 'Logística', icon: Truck, roles: ['Admin', 'Comercial'] },
    { id: 'clientes' as const, label: 'Clientes', icon: Users, roles: ['Admin', 'Comercial'] },
  ];

  const userRoles = useMemo(() => {
    const r = currentUser.roles || [currentUser.role];
    return r.filter(Boolean);
  }, [currentUser.roles, currentUser.role]);

  const renderSidebarContent = (isMobile = false) => (
    <>
      <div className="pt-8 pb-6 px-6 shrink-0" style={{ background: 'var(--bg-sidebar)' }}>
        {isMobile && (
          <button 
            onClick={() => setIsMenuOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        )}
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2.5 rounded-xl" style={{ background: 'var(--brand-primary)', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
            <Egg className="w-7 h-7" style={{ color: 'var(--text-inverse)' }} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight leading-none" style={{ color: 'var(--text-inverse)' }}>Granja</h1>
            <p className="text-sm font-bold tracking-wide" style={{ color: 'var(--brand-secondary-light)' }}>Don Paco</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-6 space-y-0.5">
        <p className="px-3 text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Modulos</p>
        {macroModules.filter(item => userRoles.some(r => item.roles.includes(r))).map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id as any);
                if (isMobile) setIsMenuOpen(false);
              }}
              className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-[13px] font-semibold"
              style={{
                background: isActive ? 'var(--bg-sidebar-active)' : 'transparent',
                color: isActive ? 'var(--brand-primary-light)' : 'var(--text-secondary)',
              }}
            >
              <Icon className="w-[18px] h-[18px]" style={{ color: isActive ? 'var(--brand-primary-light)' : 'var(--text-muted)' }} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="px-3 pb-4 mt-auto shrink-0 space-y-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex items-center space-x-3 px-3 py-3 rounded-xl mt-4" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0" style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>
            {currentUser.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--text-inverse)' }}>{currentUser.name}</p>
            <p className="text-xs font-medium truncate" style={{ color: 'var(--text-muted)' }}>{ROLE_LABELS[currentUser.role] || currentUser.role}</p>
          </div>
        </div>
        <button 
          onClick={onLogout}
          className="w-full flex items-center space-x-2 px-3 py-2.5 rounded-xl transition-colors font-semibold text-[13px]"
          style={{ color: 'var(--text-muted)' }}
        >
          <LogOut className="w-4 h-4" />
          <span>Cerrar Sesion</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen flex overflow-hidden font-sans" style={{ color: 'var(--text-primary)', background: 'var(--bg-page)' }}>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 z-10 shrink-0" style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-default)' }}>
        {renderSidebarContent()}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setIsMenuOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] h-full flex flex-col" style={{ background: 'var(--bg-sidebar)' }}>
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        
        {/* Top Bar (Desktop & Mobile) */}
        <div className="backdrop-blur-sm px-4 py-3 flex items-center justify-between shrink-0 z-20" style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-default)' }}>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setIsMenuOpen(true)}
              className="p-2 -ml-2 rounded-lg lg:hidden transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="hidden md:flex items-center rounded-lg px-3 py-2 w-64 transition-all" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
              <Search className="w-4 h-4 mr-2" style={{ color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                placeholder="Buscar módulo..." 
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="bg-transparent border-none focus:outline-none text-sm w-full font-medium"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onToggleDark}
              className="p-2 rounded-lg transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              title={darkMode ? 'Modo claro' : 'Modo oscuro'}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className="relative">
              {nuevoItems.length > 0 && (
                <>
                  <button onClick={() => setIsNuevoOpen(!isNuevoOpen)} className="flex items-center space-x-1 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all hover:opacity-90 active:scale-[0.97]" style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)', boxShadow: '0 2px 10px color-mix(in srgb, var(--brand-primary) 35%, transparent)', border: '1px solid color-mix(in srgb, var(--brand-primary) 60%, transparent)' }}>
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Nuevo</span>
                  </button>
                  {isNuevoOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsNuevoOpen(false)} />
                      <div className="absolute right-0 top-full mt-2 w-56 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in py-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                        {nuevoItems.map((item) => {
                          const Icon = item.icon;
                          return (
                            <button key={item.label} onClick={() => { setActiveTab(item.tab as any); if (item.subTab) setSubTab(item.subTab); setIsNuevoOpen(false); }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors hover:opacity-80" style={{ color: 'var(--text-primary)' }}>
                              <Icon className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* User Dropdown Menu */}
            <div className="relative">
              <button onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg transition-colors">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>
                  {currentUser.name.charAt(0)}
                </div>
                <div className="hidden md:flex flex-col items-start">
                  <span className="text-[13px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{currentUser.name}</span>
                  <span className="text-[10px] font-medium leading-tight" style={{ color: 'var(--text-muted)' }}>{ROLE_LABELS[currentUser.role] || currentUser.role}</span>
                </div>
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isUserMenuOpen && "rotate-180")} style={{ color: 'var(--text-muted)' }} />
              </button>

              {isUserMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                    <div className="p-4" style={{ borderBottom: '1px solid var(--border-muted)', background: 'var(--bg-muted)' }}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>
                          {currentUser.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{currentUser.name}</p>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
                            <Shield className="w-2.5 h-2.5" /> {ROLE_LABELS[currentUser.role] || currentUser.role}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="p-2">
                      <button onClick={() => { setIsUserMenuOpen(false); toast.info('Mi Cuenta: funcionalidad próximamente'); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors" style={{ color: 'var(--text-secondary)' }}>
                        <UserIcon className="w-4 h-4" />
                        Mi Cuenta
                      </button>
                      <button onClick={() => { setIsUserMenuOpen(false); toast.info('Configuración: funcionalidad próximamente'); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors" style={{ color: 'var(--text-secondary)' }}>
                        <Settings className="w-4 h-4" />
                        Configuracion
                      </button>
                      <div className="my-1" style={{ borderTop: '1px solid var(--border-muted)' }} />
                      <button onClick={() => { setIsUserMenuOpen(false); onLogout(); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors" style={{ color: 'var(--status-danger)' }}>
                        <LogOut className="w-4 h-4" />
                        Cerrar Sesion
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Estela AI - chat bubble */}
        {['Admin', 'Socio', 'Comercial'].includes(currentUser.role) && (
          <>
            {isEstelaOpen && (
              <div className="fixed bottom-24 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-7rem)] rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <div className="px-4 py-3 flex justify-between items-center shrink-0" style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}>
                  <div className="flex items-center space-x-2">
                    <Bot className="w-5 h-5" />
                    <span className="font-bold">Estela AI</span>
                  </div>
                  <button onClick={() => setIsEstelaOpen(false)} className="p-1 rounded-md hover:bg-white/10 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Estela Chat Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ background: 'var(--bg-page)' }}>
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>
                        <Sparkles className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Hola, soy Estela</h3>
                        <p className="text-sm mt-1 max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>Tu analista de operaciones. En que te ayudo hoy?</p>
                      </div>
                    </div>
                  ) : (
                    messages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[85%] p-3 rounded-2xl text-sm"
                          style={msg.role === 'user'
                            ? { background: 'var(--brand-primary)', color: 'var(--text-inverse)', borderBottomRightRadius: '4px' }
                            : { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-default)', borderBottomLeftRadius: '4px' }
                          }>
                          {msg.content}
                        </div>
                      </div>
                    ))
                  )}
                  {error && (
                    <div className="p-3 rounded-xl text-sm flex items-start" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
                      <Info className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                      <p>{error}</p>
                    </div>
                  )}
                </div>
                <div className="p-3 shrink-0" style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border-default)' }}>
                  <form onSubmit={handleSubmit} className="relative flex items-end rounded-xl p-1" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <textarea
                      ref={textareaRef}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Mensaje..."
                      className="w-full bg-transparent border-none focus:ring-0 resize-none py-2 pl-3 pr-10 text-sm min-h-[40px] leading-relaxed"
                      style={{ color: 'var(--text-primary)' }}
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
                        className="w-8 h-8 flex items-center justify-center text-white rounded-lg disabled:opacity-50 transition-all hover:opacity-90"
                        style={{ background: 'var(--brand-primary)' }}
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Floating Bubble */}
            <button
              onClick={() => setIsEstelaOpen(!isEstelaOpen)}
              className="fixed bottom-4 right-4 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105"
              style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}
              aria-label="Abrir Estela AI"
            >
              {isEstelaOpen ? <X className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
              {!isEstelaOpen && (
                <span className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full border-2" style={{ background: '#34d399', borderColor: 'var(--bg-card)' }} />
              )}
            </button>
          </>
        )}

        <main className="flex-1 overflow-y-auto w-full p-4 lg:p-6 pb-24 lg:pb-6" style={{ background: 'var(--bg-page)' }}>
          {(() => {
            const moduleLabels: Record<string, string> = { dashboard: 'Centro de Mando', finanzas: 'Finanzas', granja: 'Granja', operaciones: 'Operaciones', logistica: 'Logística', admin: 'Admin', clientes: 'Clientes' };
            const subLabels: Record<string, string> = { logistica: 'Logística', guias: 'Guías y Camiones', remisiones: 'Remisiones', caja: 'Caja Ruta', tablero: 'Tablero Vivo', facturacion: 'Facturación', catalogo: 'Catálogo', etiquetas: 'Etiquetas QR', pesos: 'Control Pesos', precios: 'Precios', flujo: 'Flujo de Caja', cobranza: 'Cuentas por Cobrar', reportes: 'Reportes', granjas: 'Granjas', salud: 'Salud Avícola', alimento: 'Alimento/Silos', mantenimiento: 'Mantenimiento', produccion: 'Producción', desperdicios: 'Desperdicios', productos: 'Productos', infraestructura: 'Infraestructura', usuarios: 'Usuarios' };
            const mLabel = moduleLabels[activeTab] || activeTab;
            const sLabel = activeTab === 'operaciones' ? '' : (subLabels[subTab] || '');
            if (activeTab === 'dashboard' || activeTab === 'clientes') return null;
            return (
              <div className="flex items-center gap-2 text-xs font-medium mb-4" style={{ color: 'var(--text-muted)' }}>
                <span>{mLabel}</span>
                {sLabel && (<><ChevronRight className="w-3 h-3" /><span style={{ color: 'var(--text-primary)' }}>{sLabel}</span></>)}
              </div>
            );
          })()}
          {activeTab === 'dashboard' && (
            <DashboardEnterprise currentUser={currentUser} />
          )}

          {activeTab === 'granja' && (
            <div className="space-y-6">
              <div className="flex space-x-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-default)' }}>
                {[['granjas', 'Granjas'], ['salud', 'Salud Avicola'], ['alimento', 'Alimento/Silos'], ['mantenimiento', 'Mantenimiento']].map(([key, label]) => (
                  <button key={key} onClick={() => setSubTab(key)}
                    className="pb-3 text-sm font-semibold capitalize transition-colors whitespace-nowrap border-b-2"
                    style={subTab === key 
                      ? { color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' }
                      : { color: 'var(--text-muted)', borderColor: 'transparent' }
                    }>
                    {label}
                  </button>
                ))}
              </div>
              <div className="animate-in fade-in">
                {subTab === 'granjas' && <Granjas currentUser={currentUser} />}
                {subTab === 'salud' && <SaludAvicola currentUser={currentUser} />}
                {subTab === 'alimento' && <Alimento currentUser={currentUser} />}
                {subTab === 'mantenimiento' && <Mantenimiento currentUser={currentUser} />}
              </div>
            </div>
          )}

          {activeTab === 'admin' && <Admin currentUser={currentUser} initialTab={subTab as any} />}

          {activeTab === 'operaciones' && userRoles.some(r => ['Despachador', 'Bodeguero', 'Camionero'].includes(r)) && (() => {
            const mobileRoles: Role[] = (['Despachador', 'Bodeguero', 'Camionero'] as Role[]).filter(r => userRoles.includes(r) || currentUser.role === r);
            const subTabsByRole: Record<string, string[]> = { Despachador: ['carga', 'incidencias'], Camionero: ['confirmar'], Bodeguero: ['recibir'] };
            const subTabLabels: Record<string, string> = { carga: 'Carga', incidencias: 'Incidencias', confirmar: 'Confirmar', recibir: 'Recibir' };
            const subTabs = Array.from(new Set(mobileRoles.flatMap(r => subTabsByRole[r] || [])));
            const effectiveSub = (subTabs.includes(subTab) ? subTab : subTabs[0]) || 'carga';
            return (
              <div className="space-y-6">
                {subTabs.length > 1 && (
                  <div className="flex space-x-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-default)' }}>
                    {subTabs.map(key => (
                      <button key={key} onClick={() => setSubTab(key)}
                        className="pb-3 text-sm font-semibold capitalize transition-colors whitespace-nowrap border-b-2"
                        style={effectiveSub === key
                          ? { color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' }
                          : { color: 'var(--text-muted)', borderColor: 'transparent' }
                        }>
                        {subTabLabels[key]}
                      </button>
                    ))}
                  </div>
                )}
                <div className="max-w-md mx-auto">
                  {effectiveSub === 'carga' && <DespachoMovil currentUser={currentUser} />}
                  {effectiveSub === 'incidencias' && <IncidentesMovil currentUser={currentUser} />}
                  {effectiveSub === 'confirmar' && <CamioneroMovil currentUser={currentUser} />}
                  {effectiveSub === 'recibir' && <BodegaMovil currentUser={currentUser} />}
                </div>
              </div>
            );
          })()}
          {activeTab === 'operaciones' && !userRoles.some(r => ['Despachador', 'Bodeguero', 'Camionero'].includes(r)) && (
            <OperacionesAdmin currentUser={currentUser} />
          )}

          {activeTab === 'logistica' && (
            <div className="space-y-6">
              <div className="space-y-0">
                {(() => {
                  const core = ['logistica', 'caja', 'tablero'];
                  const admin = ['facturacion'];
                  const config = ['etiquetas', 'pesos', 'precios'];
                  const f3Core = currentUser.role === 'Admin' ? core : currentUser.role === 'Comercial' ? ['logistica', 'caja'] : currentUser.role === 'Despachador' ? ['logistica', 'tablero'] : ['logistica'];
                  const f3Admin = currentUser.role === 'Admin' ? admin : currentUser.role === 'Comercial' ? ['facturacion'] : [];
                  const f3Config = currentUser.role === 'Admin' ? config : [];
                  const allTabs = [...new Set([...f3Core, ...f3Admin, ...f3Config])];
                  const labels: Record<string, string> = { logistica: 'Logística', caja: 'Caja Ruta', tablero: 'Tablero Vivo', facturacion: 'Facturación', catalogo: 'Catálogo', etiquetas: 'Etiquetas QR', pesos: 'Control Pesos', precios: 'Precios' };
                  return (
                    <>
                      <div className="flex space-x-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-default)' }}>
                        {allTabs.filter(t => f3Core.includes(t)).map(t => (
                          <button key={t} onClick={() => setSubTab(t)}
                            className="pb-3 text-sm font-semibold capitalize transition-colors whitespace-nowrap border-b-2"
                            style={subTab === t ? { color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' } : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
                            {labels[t] || t}
                          </button>
                        ))}
                      </div>
                      {f3Admin.length > 0 && (
                        <div className="flex space-x-6 overflow-x-auto pt-1" style={{ borderBottom: '1px solid var(--border-default)' }}>
                          {allTabs.filter(t => f3Admin.includes(t)).map(t => (
                            <button key={t} onClick={() => setSubTab(t)}
                              className="pb-3 text-[13px] font-medium capitalize transition-colors whitespace-nowrap border-b-2"
                              style={subTab === t ? { color: 'var(--brand-secondary)', borderColor: 'var(--brand-secondary)' } : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
                              {labels[t] || t}
                            </button>
                          ))}
                        </div>
                      )}
                      {f3Config.length > 0 && (
                        <div className="flex space-x-6 overflow-x-auto pt-1" style={{ borderBottom: '1px solid var(--border-default)' }}>
                          {allTabs.filter(t => f3Config.includes(t)).map(t => (
                            <button key={t} onClick={() => setSubTab(t)}
                              className="pb-3 text-[13px] font-medium capitalize transition-colors whitespace-nowrap border-b-2"
                              style={subTab === t ? { color: 'var(--text-secondary)', borderColor: 'var(--text-secondary)' } : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
                              {labels[t] || t}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              
              <div className="animate-in fade-in">
                {subTab === 'logistica' && <Logistica currentUser={currentUser} />}
                {subTab === 'guias' && <Logistica currentUser={currentUser} initialTab="guias" />}
                {subTab === 'remisiones' && <Logistica currentUser={currentUser} initialTab="remisiones" />}
                {subTab === 'caja' && <CajaRuta currentUser={currentUser} />}
                {subTab === 'tablero' && <TableroRutas currentUser={currentUser} />}
                {subTab === 'facturacion' && <Facturacion currentUser={currentUser} />}
                {subTab === 'etiquetas' && <Etiquetas currentUser={currentUser} />}
                {subTab === 'pesos' && <Pesos currentUser={currentUser} />}
                {subTab === 'precios' && <Precios currentUser={currentUser} />}
              </div>
            </div>
          )}

          {activeTab === 'finanzas' && (
            <div className="space-y-6">
              <div className="flex space-x-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-default)' }}>
                {[
                  ...(currentUser.role === 'Admin' ? [['flujo', 'Flujo de Caja'], ['cobranza', 'Cuentas por Cobrar']] : []),
                  ['reportes', 'Reportes']
                ].map(([key, label]) => (
                  <button key={key} onClick={() => setSubTab(key)}
                    className="pb-3 text-sm font-semibold capitalize transition-colors whitespace-nowrap border-b-2"
                    style={subTab === key 
                      ? { color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' }
                      : { color: 'var(--text-muted)', borderColor: 'transparent' }
                    }>
                    {label}
                  </button>
                ))}
              </div>
              <div className="animate-in fade-in">
                {subTab === 'flujo' && <Finanzas currentUser={currentUser} />}
                {subTab === 'cobranza' && <Cobranza currentUser={currentUser} />}
                {subTab === 'reportes' && <Reportes currentUser={currentUser} />}
              </div>
            </div>
          )}

          {activeTab === 'office' && <Office currentUser={currentUser} initialEspacio={subTab === 'documentos' ? 'documentos' : 'correo'} />}

          {activeTab === 'clientes' && (
            <Clientes currentUser={currentUser} />
          )}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 backdrop-blur-lg z-40 px-2 py-1 safe-area-pb" style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border-default)' }}>
        <div className="flex items-center justify-around">
          {macroModules.filter(item => userRoles.some(r => item.roles.includes(r))).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className="flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all min-w-[60px]"
                style={isActive ? { color: 'var(--brand-primary)' } : { color: 'var(--text-muted)' }}
              >
                <Icon className={cn("w-5 h-5 mb-1", isActive && "scale-110")} />
                <span className="text-[10px] font-bold leading-tight truncate max-w-[60px]">
                  {item.id === 'operaciones' ? 'Ops' : item.id === 'dashboard' ? 'Centro' : item.label.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

