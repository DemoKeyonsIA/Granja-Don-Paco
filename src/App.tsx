import React from "react";
import { lazy, Suspense, useState, useRef, useEffect, useMemo } from "react";
import { Bot, ChevronRight, ChevronDown, DollarSign, LogOut, Plus, Send, Settings, User as UserIcon, X, Info, Sparkles, Menu, Search, Egg, Sun, Moon, Shield, FileText, ClipboardList, Users, CreditCard, Tag, Mail, Truck } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { cn } from './lib/utils';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Spinner } from './components/Spinner';
import Login from "./components/Login";
const Clientes = lazy(() => import("./components/Clientes"));
const Facturacion = lazy(() => import("./components/Facturacion"));
const CajaRuta = lazy(() => import("./components/CajaRuta"));
const TableroRutas = lazy(() => import("./components/TableroRutas"));
const HistorialVentasRuta = lazy(() => import("./components/HistorialVentasRuta"));
const Despacho = lazy(() => import("./components/Despacho"));
const FlotaRutas = lazy(() => import("./components/FlotaRutas"));
const Cobranza = lazy(() => import("./components/Cobranza"));
const Granjas = lazy(() => import("./components/Granjas"));
const OperacionesAdmin = lazy(() => import("./components/operaciones"));
const ResumenDelDia = lazy(() => import("./components/operaciones/ResumenDelDia"));
const DespachoMovil = lazy(() => import("./components/DespachoMovil"));
const BodegaMovil = lazy(() => import("./components/BodegaMovil"));
const CamioneroMovil = lazy(() => import("./components/CamioneroMovil"));
const IncidentesMovil = lazy(() => import("./components/IncidentesMovil"));
const FinanzasResumen = lazy(() => import("./components/FinanzasResumen"));
const GastosRutaAdmin = lazy(() => import("./components/GastosRutaAdmin"));
const Etiquetas = lazy(() => import("./components/Etiquetas"));
const Pesos = lazy(() => import("./components/Pesos"));
const SaludAvicola = lazy(() => import("./components/SaludAvicola"));
const Alimento = lazy(() => import("./components/Alimento"));
const Mantenimiento = lazy(() => import("./components/Mantenimiento"));
const Admin = lazy(() => import("./components/Admin"));
const Office = lazy(() => import("./components/Office"));
const Reportes = lazy(() => import("./components/Reportes"));
import RegistroGasto from "./components/RegistroGasto";
import { User, Role } from './types';
import { loadSession, clearSession } from './lib/session';
import { iconoDe } from './nav/icons';
import {
  MODULOS,
  type ModuleId, type SubTabDef,
} from './nav/modulos';

function ModuleLoading() {
  return <div role="status" data-testid="module-loading" className="mx-auto flex min-h-48 max-w-md items-center justify-center gap-3" style={{ color: 'var(--text-secondary)' }}><Spinner />Cargando módulo…</div>;
}
import {
  rolesEfectivos, modulosVisibles, labelDeModulo, moduloPorDefecto,
  espacioOfficeDe,
  subTabsDe, subTabPorDefecto, subTabsOperacionesMovil, subTabMovilEfectivo,
  subTabsInternosDe, grupoQueContiene, breadcrumbDe, esRolMovil, destinoGrupoOperaciones, despachoCanonico,
  tipoReporteDe, idSubTabReporte,
} from './nav/modulos';

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
  
  return (
    <>
      {/* Uno solo para las dos ramas: dentro de cada `if` cabía perfecto, pero
          cualquier tercera rama que se añadiera después iba a duplicar los avisos. */}
      <Toaster richColors theme={darkMode ? 'dark' : 'light'} position="top-center" />
      {!currentUser ? (
        <ErrorBoundary>
          <Login onLogin={setCurrentUser} />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary>
          <AppLayout currentUser={currentUser} onLogout={handleLogout} darkMode={darkMode} onToggleDark={() => setDarkMode(!darkMode)} />
        </ErrorBoundary>
      )}
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
    Camionero: 'Comercial',
  };
  const userRoles = useMemo(
    () => rolesEfectivos(currentUser.role, currentUser.roles),
    [currentUser.role, currentUser.roles]
  );

  const [activeTab, setActiveTab] = useState<string>(
    moduloPorDefecto(rolesEfectivos(currentUser.role, currentUser.roles))
  );

  // For sub-tabs within macro modules
  const [subTab, setSubTab] = useState<string>('');
  // Marca que la sub-vista fue elegida explícitamente (búsqueda o menú Nuevo)
  // para que el reset por cambio de macro-módulo no la pise.
  const subTabManual = useRef(false);

  useEffect(() => {
    // Una sub-vista elegida a mano manda sobre el default del módulo. Antes el
    // reseteo la pisaba siempre y solo `admin` consultaba el flag: por eso
    // "+ Nuevo → Guía de Despacho", desde otro módulo, abría Logística en su tab
    // inicial en vez de en Guías, y la búsqueda de "factura" aterrizaba donde
    // el usuario no pidió.
    if (subTabManual.current) {
      subTabManual.current = false;
      return;
    }
    setSubTab(subTabPorDefecto(activeTab as ModuleId, userRoles));
  }, [activeTab, userRoles]);

  useEffect(() => {
    if (activeTab !== 'operaciones') return;
    if (subTab === 'despacho-precios' || subTab === 'ventas-precios') {
      subTabManual.current = true;
      setActiveTab('admin');
      setSubTab('precios-negociacion');
      return;
    }
    const canonico = despachoCanonico(subTab, userRoles);
    if (canonico && canonico !== subTab) setSubTab(canonico);
  }, [activeTab, subTab, userRoles]);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEstelaOpen, setIsEstelaOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNuevoOpen, setIsNuevoOpen] = useState(false);
  const nuevoMenuRef = useRef<HTMLDivElement>(null);
  const [isRegistroGastoOpen, setIsRegistroGastoOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const ocultarEstelaEnMovil = currentUser.role === 'Comercial' || activeTab === 'operaciones' || activeTab === 'admin' || activeTab === 'clientes';

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isNuevoOpen) return;
    const cerrarAlHacerClickFuera = (event: PointerEvent) => {
      if (event.target instanceof Node && !nuevoMenuRef.current?.contains(event.target)) setIsNuevoOpen(false);
    };
    const cerrarConEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsNuevoOpen(false); };
    document.addEventListener('pointerdown', cerrarAlHacerClickFuera);
    document.addEventListener('keydown', cerrarConEscape);
    return () => {
      document.removeEventListener('pointerdown', cerrarAlHacerClickFuera);
      document.removeEventListener('keydown', cerrarConEscape);
    };
  }, [isNuevoOpen]);

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

  /**
 * ¿Este rol no tiene nada que crear en el módulo actual?
 *
 * El fallback de abajo ofrecía "Guía de Despacho" a cualquiera. Para un Socio en
 * Finanzas eso era un botón a un módulo que no ve en su sidebar. En el único
 * caso donde el módulo no aporta ninguna acción (Finanzas para no-Admin) el
 * menú se oculta en vez de mentir.
 */
const finanzasEsSoloLectura = activeTab === 'finanzas' && !userRoles.includes('Admin');

const nuevoItems = useMemo(() => {
    // `accion` abre un formulario en vez de navegar: se usa para el gasto, que
    // dejó de ser un tab y pasó a ser una acción del menú.
    const items: { label: string; icon: any; tab: string; subTab?: string; accion?: 'gasto' }[] = [];
    if (currentUser.role === 'Despachador' || currentUser.role === 'Bodeguero') return items;
    if (activeTab === 'clientes') {
      if (userRoles.includes('Admin')) items.push({ label: 'Cliente', icon: Users, tab: 'clientes' });
    } else if (activeTab === 'admin') {
      items.push({ label: 'Producto Catálogo', icon: Tag, tab: 'admin', subTab: 'productos' });
      items.push({ label: 'Camión', icon: Truck, tab: 'admin', subTab: 'infraestructura' });
      items.push({ label: 'Usuario', icon: Users, tab: 'admin', subTab: 'usuarios' });
    } else if (activeTab === 'finanzas') {
      // Registrar un gasto es de Admin: el gasto baja utilidad, y un Socio
      // puede verla pero no moverla. Se lee de `userRoles`, no de `role`: un
      // usuario con Admin como segundo rol es Admin aunque su rol principal sea
      // otro, y en el resto de la app ya se le trata así.
      if (userRoles.includes('Admin')) {
        items.push({ label: 'Gasto', icon: DollarSign, tab: 'finanzas', accion: 'gasto' });
      }
    } else if (activeTab === 'operaciones') {
      // Las acciones se leen de la fila que el usuario ya ve. Así Remisión y Venta
      // (Caja) dejan de ser dos puertas fijas que se ofrecían a cualquiera —un
      // Camionero con "Nuevo > Producción" lo llevaba a un id que no montaba
      // nada— y pasan a existir donde está el trabajo: Admin y Comercial las ven,
      // un Bodeguero no.
      if (esRolMovil(userRoles)) {
        const tabsMoviles = new Set(subTabsOperacionesMovil(userRoles).map(t => t.id));
        if (tabsMoviles.has('venta-movil')) items.push({ label: 'Venta', icon: CreditCard, tab: 'operaciones', subTab: 'venta-movil' });
        if (tabsMoviles.has('facturar-movil')) items.push({ label: 'Factura o nota', icon: FileText, tab: 'operaciones', subTab: 'facturar-movil' });
        if (tabsMoviles.has('cargas-comercial') || tabsMoviles.has('confirmar')) items.push({ label: 'Cargas asignadas', icon: Truck, tab: 'operaciones', subTab: tabsMoviles.has('cargas-comercial') ? 'cargas-comercial' : 'confirmar' });
        if (tabsMoviles.has('carga')) items.push({ label: 'Nueva carga', icon: Truck, tab: 'operaciones', subTab: 'carga' });
        if (tabsMoviles.has('recibir')) items.push({ label: 'Recibir', icon: Truck, tab: 'operaciones', subTab: 'recibir' });
      } else {
        const grupos = new Set(subTabsDe('operaciones', userRoles).map(t => t.id));
        if (grupos.has('bodega')) items.push({ label: 'Remisión', icon: FileText, tab: 'operaciones', subTab: 'bodega-entradas' });
        if (grupos.has('despacho')) {
          items.push({ label: 'Guía de despacho', icon: ClipboardList, tab: 'operaciones', subTab: 'despacho-guias' });
          items.push({ label: 'Venta (Caja)', icon: CreditCard, tab: 'operaciones', subTab: 'despacho-ventas' });
        }
        // El alta de Granja sigue siendo de Admin, que es lo que declara
        // SUBTABS_GRANJA. Antes vivía en el módulo Granja que ya no existe.
        if (grupos.has('granja')) items.push({ label: 'Granja', icon: Egg, tab: 'operaciones', subTab: 'granja' });
      }
    } else if (activeTab === 'office') {
      // Office tiene dos espacios y los dos dan de alta: conectar una cuenta de
      // correo y subir un documento. "Nueva regla" ya no vive acá, está en Admin.
      if (userRoles.includes('Admin')) {
        items.push({ label: 'Conectar cuenta', icon: Mail, tab: 'office', subTab: 'correo' });
        items.push({ label: 'Subir documento', icon: FileText, tab: 'office', subTab: 'documentos' });
      }
    }
    if (items.length === 0 && userRoles.includes('Admin') && !finanzasEsSoloLectura && !esRolMovil(userRoles)) {
      // Quien está en un módulo sin acciones propias (Logística desapareció en
      // la Fase 8 y todo el resto declara su "+ Nuevo") recibe el alta de
      // Cliente, que es la única creación transversal que no depende del módulo.
      items.push({ label: 'Cliente', icon: Users, tab: 'clientes' });
    }
    return items;
  }, [activeTab, subTab, userRoles, finanzasEsSoloLectura]);

  /**
   * Navegación de la búsqueda hacia un grupo del hub de Operaciones.
   *
   * Delega en `destinoGrupoOperaciones`, que devuelve `null` cuando ese rol no
   * tiene Operaciones. El `null` es lo que evita el defecto que tenía esta
   * búsqueda: entrar al módulo igual, a ciegas, dejaba a un Socio con el módulo
   * activo sin fila y sin cuerpo. Sin destino no se toca `activeTab` ni `subTab`,
   * así que el texto buscado se queda a la vista y el usuario sigue donde estaba,
   * que es un sitio del que puede salir.
   */
  const irAGrupoOperaciones = (grupo: string, interno?: string) => {
    const destino = destinoGrupoOperaciones(grupo, userRoles);
    if (!destino) return;
    subTabManual.current = true;
    setActiveTab(destino.modulo);
    // Sin `interno` se llega al cuerpo del grupo (Despacho GD- o CajaRuta); con
    // él, directo al paso de la sub-fila (Flota y Rutas, Control Pesos…). El
    // paso se monta solo si ese rol lo ve: un Comercial que busca "peso" no
    // puede aterrizar en una pantalla de configuración que no tiene en su fila.
    const paso = interno && subTabsInternosDe('operaciones', grupo, userRoles).some(t => t.id === interno);
    setSubTab(paso ? interno : destino.subTab);
  };

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) return;
    const lower = q.toLowerCase();
    if (lower.includes('vinculo') || lower.includes('vínculo') || lower.includes('regla') || lower.includes('integracion') || lower.includes('integración')) {
      subTabManual.current = true;
      // Vinculaciones es un tab de Admin. Para los demás roles la búsqueda cae en
      // Documentos, que es donde sí se ven los adjuntos que una regla debería
      // haber vinculado.
      if (userRoles.includes('Admin')) { setActiveTab('admin'); setSubTab('vinculaciones'); }
      else { setActiveTab('office'); setSubTab('documentos'); }
    } else if (lower.includes('correo') || lower.includes('email') || lower.includes('gmail') || lower.includes('bandeja')) {
      setActiveTab('office'); setSubTab('correo');
    } else if (lower.includes('drive') || lower.includes('documento') || lower.includes('carpeta') || lower.includes('adjunto')) {
      setActiveTab('office'); setSubTab('documentos');
    } else if (lower.includes('guia') || lower.includes('despacho') || lower.includes('camion')) {
      // La guía de despacho es el cuerpo del grupo Despacho del hub (la GD-
      // completa: Bodega→Camión→Clientes) y además su primer paso, "Guías de
      // Despacho": la búsqueda aterriza ahí para que la sub-fila muestre los 4
      // pasos del grupo en vez de llegar al cuerpo anónimo. "Camión" también
      // lleva a la guía —que es donde se elige el camión de la ruta—; el maestro
      // de camiones y rutas es el paso "Flota y Rutas" de la misma sub-fila.
      irAGrupoOperaciones('despacho', 'despacho-guias');
    } else if (lower.includes('remision') || lower.includes('remisión')) {
      // Las remisiones GR- (Granja→Bodega) viven bajo el grupo Bodega, en el paso
      // "Entradas y Alistamiento", no en la ruta del camión. Las dos formas del
      // texto cuentan porque la gente escribe la tilde: la búsqueda comparaba
      // solo `remision`, así que "remisión" —como se escribe— no llevaba a
      // ninguna parte.
      irAGrupoOperaciones('bodega', 'bodega-entradas');
    } else if (lower.includes('cliente')) {
      setActiveTab('clientes');
} else if (lower.includes('flujo')) {
      // Va antes de "caja" porque "flujo de caja" contiene las dos palabras y el
      // reporte de Analítica es a donde realmente lleva.
      subTabManual.current = true;
      setActiveTab('finanzas'); setSubTab(idSubTabReporte('flujo-caja'));
    } else if (lower.includes('venta') || lower.includes('caja') || lower.includes('tiquete')) {
      // "Venta (Caja)" era una puerta suelta dentro de Logística; ahora es el grupo
      // La venta de ruta queda en Despacho y ruta junto con la entrega.
      irAGrupoOperaciones('despacho', 'despacho-ventas');
    } else if (lower.includes('factura') || lower.includes('cobro')) {
      // "Facturación" pasó a ser el tab Documentos de Finanzas. Se decide por
      // rol porque un Comercial sí lo ve y un Socio no: mandarlo a un tab
      // invisible lo dejaba en la pantalla anterior, con el texto buscado a la
      // vista pero el resultado en otro lado.
      subTabManual.current = true;
      setActiveTab('finanzas');
      setSubTab(userRoles.includes('Admin') || userRoles.includes('Comercial') ? 'documentos' : 'resumen');
    } else if (lower.includes('gasto')) {
      // El gasto ya no es un tab: es la acción "+ Nuevo → Gasto", que es de
      // Admin. Quien no es Admin aterriza en el primer tab que sí ve, no en
      // `resumen` a ciegas.
      subTabManual.current = true;
      setActiveTab('finanzas'); setSubTab(subTabPorDefecto('finanzas', userRoles));
    } else if (lower.includes('granja') || lower.includes('galero')) {
      // La granja dejó de ser módulo y pasó a ser grupo del hub de Operaciones.
      irAGrupoOperaciones('granja');
    } else if (lower.includes('etiqueta') || lower.includes('qr')) {
      irAGrupoOperaciones('bodega', 'bodega-etiquetas');
    } else if (lower.includes('usuario') || lower.includes('rol') || lower.includes('admin')) {
      setActiveTab('admin'); setSubTab('usuarios');
    } else if (lower.includes('camion') && (lower.includes('admin') || lower.includes('config'))) {
      setActiveTab('admin'); setSubTab('infraestructura');
    } else if (lower.includes('producto') && (lower.includes('tipo') || lower.includes('admin'))) {
      setActiveTab('admin'); setSubTab('productos');
    } else if (lower.includes('reporte')) {
      subTabManual.current = true;
      setActiveTab('finanzas'); setSubTab(idSubTabReporte('financiero'));
    } else if (lower.includes('peso')) {
      irAGrupoOperaciones('bodega', 'bodega-pesos');
    } else if (lower.includes('precio')) {
      if (!userRoles.includes('Admin')) { toast.error('Solo Administración puede consultar y editar los rangos de negociación.'); return; }
      subTabManual.current = true;
      setActiveTab('admin'); setSubTab('precios-negociacion');
    }
  };

  const modulos = useMemo(() => modulosVisibles(userRoles), [userRoles]);

  /**
 * Fila de tabs simple (una banda). `tono` replica los tres estilos heredados.
 *
 * `activoEn` permite que una fila resuelva el resaltado sobre otro id: la fila
 * primaria de Finanzas debe marcar `analitica` aunque el sub-tab activo sea un
 * tipo de reporte (`reporte:financiero`). Sin eso, elegir un reporte apagaba el
 * tab que lo contiene.
 */
  const renderFilaTabs = (
    tabs: SubTabDef[],
    tono: 'primario' | 'secundario' | 'terciario',
    activoEn: string = subTab,
    onSelect?: (id: string) => void,
  ) => {
    if (tabs.length === 0) return null;
    const activo = tono === 'primario'
        ? { color: 'var(--text-link)', borderColor: 'var(--brand-primary)' }
      : tono === 'secundario'
        ? { color: 'var(--text-link)', borderColor: 'var(--brand-primary)' }
              : { color: 'var(--text-secondary)', borderColor: 'var(--text-secondary)' };
    const inactivo = { color: 'var(--text-muted)', borderColor: 'transparent' };
    return (
      <div
        data-testid="nav-tabs"
        data-banda={tono}
        className={`flex space-x-6 overflow-x-auto ${tono === 'primario' ? '' : 'pt-1'}`}
        style={{ borderBottom: '1px solid var(--border-default)' }}
      >
        {tabs.map(t => (
          <button
            key={t.id}
            data-tab-id={t.id}
            aria-current={activoEn === t.id ? 'page' : undefined}
            onClick={() => (onSelect ? onSelect(t.id) : setSubTab(t.id))}
            className={`pb-3 capitalize transition-colors whitespace-nowrap border-b-2 ${
              tono === 'primario' ? 'text-sm font-semibold' : 'text-[13px] font-medium'
            }`}
            style={activoEn === t.id ? activo : inactivo}
          >
            {t.label}
          </button>
        ))}
      </div>
    );
  };

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
        <div className="flex justify-center mb-2">
          <img
            src="/granja-don-paco-logo.png"
            alt="Granja Don Paco — Siempre frescos"
            width={447}
            height={447}
            draggable={false}
            className="h-[96px] w-[168px] max-w-full rounded-lg border border-neutral-200/70 bg-white object-cover object-center shadow-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-6 space-y-0.5">
        <p className="px-3 text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Modulos</p>
        {modulos.map((item) => {
          const Icon = iconoDe(item.icon);
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              data-modulo-id={item.id}
              onClick={() => {
                setActiveTab(item.id as any);
                if (isMobile) setIsMenuOpen(false);
              }}
              className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-[13px] font-semibold"
              style={{
                background: isActive ? 'var(--brand-action)' : 'transparent',
                color: isActive ? 'var(--text-nav-active)' : 'var(--text-secondary)',
              }}
            >
              <Icon className="w-[18px] h-[18px]" style={{ color: isActive ? 'var(--text-nav-active)' : 'var(--text-muted)' }} />
              <span>{labelDeModulo(item.id, userRoles)}</span>
            </button>
          );
        })}
      </div>

      <div className="px-3 pb-4 mt-auto shrink-0 space-y-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex items-center space-x-3 px-3 py-3 rounded-xl mt-4" style={{ background: 'var(--bg-sidebar-hover)' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
            {currentUser.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--text-on-sidebar)' }}>{currentUser.name}</p>
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
    <div className="h-screen h-[100dvh] flex overflow-hidden font-sans" style={{ color: 'var(--text-primary)', background: 'var(--bg-page)' }}>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 z-10 shrink-0" style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-default)' }}>
        {renderSidebarContent()}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setIsMenuOpen(false)} />
          <aside aria-label="Navegación principal" className="relative w-72 max-w-[85vw] h-full flex flex-col" style={{ background: 'var(--bg-sidebar)' }}>
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
              aria-label="Abrir navegación"
              aria-expanded={isMenuOpen}
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
              aria-label={darkMode ? 'Activar modo claro' : 'Activar modo oscuro'}
              onClick={onToggleDark}
              className="p-2 rounded-lg transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              title={darkMode ? 'Modo claro' : 'Modo oscuro'}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className="relative" ref={nuevoMenuRef}>
              {nuevoItems.length > 0 && (
                <>
                  <button aria-expanded={isNuevoOpen} onClick={() => setIsNuevoOpen(!isNuevoOpen)} className="flex items-center space-x-1 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all hover:opacity-90 active:scale-[0.97]" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)', boxShadow: '0 2px 10px color-mix(in srgb, var(--brand-primary) 35%, transparent)', border: '1px solid color-mix(in srgb, var(--brand-primary) 60%, transparent)' }}>
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Nuevo</span>
                  </button>
                  {isNuevoOpen && (
                    <div className="absolute right-0 top-full mt-2 w-56 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in py-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                        {nuevoItems.map((item) => {
                          const Icon = item.icon;
                          return (
                            <button key={item.label} onClick={() => {
                              if (item.accion === 'gasto') { setIsRegistroGastoOpen(true); }
                              else {
                                // La sub-vista viene escrita en el ítem, así que el
                                // reseteo por cambio de módulo no debe pisarla.
                                subTabManual.current = true;
                                setActiveTab(item.tab as any);
                                if (item.subTab) setSubTab(item.subTab);
                              }
                              setIsNuevoOpen(false);
                            }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-primary)]" style={{ color: 'var(--text-primary)' }}
                              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'; }}
                              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                              onFocus={e => { e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)'; }}
                              onBlur={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                              <Icon className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
                              {item.label}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* User Dropdown Menu */}
            <div className="relative">
              <button onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg transition-colors">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
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
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
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
              <div className={`fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-24 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] rounded-2xl shadow-2xl flex flex-col overflow-hidden ${ocultarEstelaEnMovil ? 'estela-oculta-en-movil' : ''}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <div className="px-4 py-3 flex justify-between items-center shrink-0" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
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
                            ? { background: 'var(--brand-primary)', color: 'var(--text-on-action)', borderBottomRightRadius: '4px' }
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
                        {loading ? <Spinner /> : <Send className="w-4 h-4 ml-0.5" />}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Floating Bubble */}
            <button
              onClick={() => setIsEstelaOpen(!isEstelaOpen)}
              className={`fixed right-4 z-50 w-16 h-16 rounded-full items-center justify-center shadow-xl transition-transform hover:scale-105 ${isEstelaOpen ? 'hidden lg:flex bottom-4' : 'flex bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-4'} ${ocultarEstelaEnMovil ? 'estela-oculta-en-movil' : ''}`}
              style={{ background: '#5D78B8', color: '#FFFFFF' }}
              aria-label="Abrir Estela AI"
            >
              {isEstelaOpen ? <X className="w-6 h-6" /> : (
                <svg className="estela-breath w-8 h-8" viewBox="0 0 48 48" aria-hidden="true" fill="currentColor">
                  <path d="M24 3c2.7 11.8 5.2 18.3 21 21-15.8 2.7-18.3 9.2-21 21C21.3 33.2 18.8 26.7 3 24 18.8 21.3 21.3 14.8 24 3Z" />
                </svg>
              )}
              {!isEstelaOpen && (
                <span className="absolute top-0 right-0 w-4 h-4 rounded-full border-2" style={{ background: '#F4F4F4', borderColor: '#10122A' }} />
              )}
            </button>
          </>
        )}

        <main className="flex-1 overflow-y-auto w-full p-4 lg:p-6 pb-24 lg:pb-6" style={{ background: 'var(--bg-page)' }}>
          {(() => {
            const crumbs = breadcrumbDe(activeTab as ModuleId, subTab, userRoles);
            if (!crumbs) return null;
            const [mLabel, sLabel] = crumbs;
            const volverAlModulo = () => setSubTab(subTabPorDefecto(activeTab as ModuleId, userRoles));
            if (!sLabel) return <div className="flex items-center gap-2 text-xs font-medium mb-4" style={{ color: 'var(--text-muted)' }}><button type="button" onClick={volverAlModulo} className="rounded px-1 -mx-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: 'var(--text-muted)' }}>{mLabel}</button></div>;
            return (
              <div className="flex items-center gap-2 text-xs font-medium mb-4" style={{ color: 'var(--text-muted)' }}>
                <button type="button" onClick={volverAlModulo} className="rounded px-1 -mx-1 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: 'var(--text-muted)' }}>{mLabel}</button>
                <ChevronRight className="w-3 h-3" />
                <span style={{ color: 'var(--text-primary)' }}>{sLabel}</span>
              </div>
            );
          })()}
          {activeTab === 'admin' && <Suspense fallback={<ModuleLoading />}><Admin currentUser={currentUser} initialTab={subTab as any} /></Suspense>}

          {activeTab === 'operaciones' && esRolMovil(userRoles) && (() => {
            const subTabs = subTabsOperacionesMovil(userRoles);
            const effectiveSub = subTabMovilEfectivo(userRoles, subTab);
            return (
              <div className="space-y-6">
                {subTabs.length > 1 && renderFilaTabs(subTabs, 'primario')}
                <Suspense fallback={<ModuleLoading />}><div className="max-w-md mx-auto">
                  {effectiveSub === 'carga' && <DespachoMovil currentUser={currentUser} />}
                  {effectiveSub === 'incidencias' && <IncidentesMovil currentUser={currentUser} />}
                  {effectiveSub === 'confirmar' && <CamioneroMovil currentUser={currentUser} />}
                  {effectiveSub === 'recibir' && <BodegaMovil currentUser={currentUser} />}
                  {effectiveSub === 'venta-movil' && <CajaRuta currentUser={currentUser} />}
                  {effectiveSub === 'facturar-movil' && <Facturacion currentUser={currentUser} />}
                  {effectiveSub === 'cargas-comercial' && <CamioneroMovil currentUser={currentUser} />}
                </div></Suspense>
              </div>
            );
          })()}
          {activeTab === 'operaciones' && !esRolMovil(userRoles) && (
            <div className="space-y-6" data-testid="operaciones-hub">
              {/* Cinco grupos en una fila, y no los que elija el componente: la
                  fila sale de `SUBTABS_OPERACIONES_DESKTOP`, la misma fuente que
                  el default y el breadcrumb. Antes la dibujaba `BodegaAdmin` con
                  su propia lista, que por eso era dos y no cinco. */}
              {renderFilaTabs(subTabsDe('operaciones', userRoles), 'primario', grupoQueContiene('operaciones', subTab))}
              {/* Granja, Bodega y Despacho tienen sub-fila. Despacho reúne
                  preparación, seguimiento y entregas; los ids antiguos se
                  normalizan para conservar accesos y sesiones guardadas. */}
              {['bodega', 'bodega-entradas', 'existencias', 'control', 'bodega-etiquetas', 'bodega-pesos'].includes(subTab)
                ? renderFilaTabs(
                    subTabsInternosDe('operaciones', 'bodega', userRoles),
                    'secundario',
                    subTab === 'bodega' ? 'existencias' : ['bodega-etiquetas', 'bodega-pesos'].includes(subTab) ? 'control' : subTab,
                  )
                : renderFilaTabs(subTabsInternosDe('operaciones', subTab, userRoles), 'secundario',
                    despachoCanonico(subTab, userRoles) || (subTab === 'granja' ? 'granjas' : subTab))}
              <Suspense fallback={<ModuleLoading />}><div className="animate-in fade-in">
                {subTab === 'resumen' && <ResumenDelDia currentUser={currentUser} onNavigate={setSubTab} />}
                {subTab === 'granja' && <Granjas currentUser={currentUser} />}
                {subTab === 'granjas' && <Granjas currentUser={currentUser} />}
                {subTab === 'salud' && <SaludAvicola currentUser={currentUser} />}
                {subTab === 'alimento' && <Alimento currentUser={currentUser} />}
                {subTab === 'mantenimiento' && <Mantenimiento currentUser={currentUser} />}
                {['bodega', 'bodega-entradas', 'existencias', 'control', 'bodega-etiquetas', 'bodega-pesos'].includes(subTab) && (() => {
                  const vistaBodega = subTab === 'bodega-entradas' ? 'entradas'
                    : subTab === 'control' || ['bodega-etiquetas', 'bodega-pesos'].includes(subTab) ? 'control' : 'existencias';
                  return <div className="space-y-5" data-testid="bodega-unificada" data-vista-bodega={vistaBodega}>
                    <OperacionesAdmin currentUser={currentUser} vista={vistaBodega} onVista={v => setSubTab(v)} />
                  </div>;
                })()}
                {(subTab === 'despacho-preparar' || subTab === 'despacho' || subTab === 'despacho-guias' || subTab === 'despacho-camiones') && <div className="space-y-5">
                  <Despacho currentUser={currentUser} />
                  <details className="group rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] shadow-sm">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--bg-card-hover)] [&::-webkit-details-marker]:hidden">
                      <span><strong className="block text-sm text-[var(--text-primary)]">Administrar flota y rutas</strong><span className="text-xs text-[var(--text-secondary)]">Camiones, responsables y zonas de entrega</span></span>
                      <ChevronDown className="h-5 w-5 text-[var(--text-secondary)] transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-[var(--border-default)] p-4"><FlotaRutas currentUser={currentUser} /></div>
                  </details>
                </div>}
                {subTab === 'despacho-en-ruta' && userRoles.includes('Admin') && <TableroRutas currentUser={currentUser} />}
                {subTab === 'despacho-historico-ventas' && userRoles.includes('Admin') && <HistorialVentasRuta currentUser={currentUser} />}
                {subTab === 'despacho-entregas' && userRoles.includes('Comercial') && <CajaRuta currentUser={currentUser} />}
              </div></Suspense>
            </div>
          )}

          {activeTab === 'finanzas' && (
            <div className="space-y-6" data-testid="finanzas-hub">
              {renderFilaTabs(
                subTabsDe('finanzas', userRoles),
                'primario',
                // Con un tipo de reporte activo, la fila primaria sigue marcando
                // Analítica: el sub-tab no reemplaza su contenedor.
                tipoReporteDe(subTab) ? 'analitica' : subTab,
                // Elegir Analítica abre el primer reporte. Si se quedara en el id
                // del tab, la fila secundaria aparecería sin nada seleccionado y
                // el contenido de abajo no renderizaría nada.
                id => setSubTab(id === 'analitica' ? idSubTabReporte('financiero') : id),
              )}
              {/* Analítica tiene una sub-fila: los seis tipos de reporte. Vive
                  aquí, en el shell, para que el tipo activo sea el mismo estado
                  que el tab activo y el breadcrumb lo pueda leer. */}
              {renderFilaTabs(subTabsInternosDe('finanzas', subTab), 'secundario')}
              <Suspense fallback={<ModuleLoading />}><div className="animate-in fade-in">
                {subTab === 'resumen' && <FinanzasResumen currentUser={currentUser} />}
                {subTab === 'documentos' && <Facturacion currentUser={currentUser} />}
                {subTab === 'gastos-ruta' && <GastosRutaAdmin currentUser={currentUser} />}
                {subTab === 'cobranza' && <Cobranza currentUser={currentUser} />}
                {tipoReporteDe(subTab) && (
                  <Reportes currentUser={currentUser} tipo={tipoReporteDe(subTab)!} />
                )}
              </div></Suspense>
            </div>
          )}

          {activeTab === 'office' && <Suspense fallback={<ModuleLoading />}>
            <Office
              currentUser={currentUser}
              initialEspacio={espacioOfficeDe(subTab, userRoles)}
            />
          </Suspense>}

          {activeTab === 'clientes' && <Suspense fallback={<ModuleLoading />}>
            <Clientes currentUser={currentUser} />
          </Suspense>}
        </main>
      </div>

      {isRegistroGastoOpen && currentUser && (
        <RegistroGasto currentUser={currentUser} onClose={() => setIsRegistroGastoOpen(false)} />
      )}

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 backdrop-blur-lg z-40 px-2 py-1 safe-area-pb" style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border-default)' }}>
        <div className="flex items-center justify-around">
          {modulos.map((item) => {
            const Icon = iconoDe(item.icon);
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={labelDeModulo(item.id, userRoles)}
                className="flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all min-w-[60px]"
                style={isActive ? { color: 'var(--brand-primary)' } : { color: 'var(--text-muted)' }}
              >
                <Icon className={cn("w-5 h-5 mb-1", isActive && "scale-110")} />
                <span className="text-[10px] font-bold leading-tight truncate max-w-[60px]">
                  {item.shortLabel ?? labelDeModulo(item.id, userRoles).split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

