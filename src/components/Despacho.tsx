import React, { useState, useEffect } from 'react';
import { Truck, ClipboardList, RefreshCw, Check, Boxes, Box, MapPin, X, Users, Navigation, Receipt, ListChecks, CheckCircle2, CalendarDays, Route, Sparkles, Search, Info, Loader2 } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { esVendedor } from '../lib/vendedores';
import { cn } from '../lib/utils';
import AuditoriaRuta from './AuditoriaRuta';
import { sessionHeaders } from '../lib/session';

interface DespachoProps {
  currentUser: User;
}

const fmtFecha = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('es-CR') : '—';
const fmtHora = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }) : '';
const fmtCRC = (n: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n || 0);

/**
 * Despacho y Guías — cuerpo del grupo Despacho y primer paso de su sub-fila
 * (`despacho-guias`). La Fase 12 sacó de aquí el maestro de camiones, que vive
 * ahora en el paso `despacho-camiones` (FlotaRutas.tsx); el detalle de la guía
 * ganó la línea de tiempo que antes solo mostraba Auditoría de Ruta.
 */
export default function Despacho({ currentUser }: DespachoProps) {
  const [guias, setGuias] = useState<any[]>([]);
  const [camiones, setCamiones] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Crear guía
  const [camionId, setCamionId] = useState('');
  const [rutaId, setRutaId] = useState('');
  const [rutas, setRutas] = useState<any[]>([]);
  const [etiquetaIds, setEtiquetaIds] = useState<string[]>([]);
  const [colchonEtiquetaIds, setColchonEtiquetaIds] = useState<string[]>([]);
  const [etiquetasDisponibles, setEtiquetasDisponibles] = useState<any[]>([]);
  const [responsableCarga, setResponsableCarga] = useState('');
  const [responsableTransporte, setResponsableTransporte] = useState('');
  const [vendedorId, setVendedorId] = useState('');
  const [clienteIds, setClienteIds] = useState<string[]>([]);
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [pesoSalida, setPesoSalida] = useState(0);
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [paso, setPaso] = useState(1);
  const [wizardAbierto, setWizardAbierto] = useState(false);
  const [guiaDetalle, setGuiaDetalle] = useState<any>(null);

  // Sugerencia IA de carga (historial de pedidos de los clientes de la guía).
  const [sug, setSug] = useState<any>(null);
  const [sugLoading, setSugLoading] = useState(false);
  const [sugError, setSugError] = useState('');

  const [modal, setModal] = useState<null | { tipo: 'cerrar'; guiaId: string }>(null);
  const [pesoLlegada, setPesoLlegada] = useState('');

  const fetchGuias = async () => {
    try {
      const res = await fetch('/api/logistica/guias', { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setGuias(await res.json());
    } catch { toast.error('Error al cargar guías.'); }
  };

  const fetchCamiones = async () => {
    try {
      const [camRes, etiqRes, rutRes, usersRes, clientesRes] = await Promise.all([
        fetch('/api/logistica/camiones', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/etiquetas', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/rutas', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/users', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/clientes', { headers: sessionHeaders(currentUser.id) })
      ]);
      if (camRes.ok) setCamiones(await camRes.json());
      if (rutRes.ok) setRutas(await rutRes.json());
      if (etiqRes.ok) {
        const todas = await etiqRes.json();
        setEtiquetasDisponibles(todas.filter((e: any) => e.estado === 'EnBodega'));
      }
      if (usersRes.ok) {
        const users = await usersRes.json();
        setVendedores(users.filter((u: any) => esVendedor(u)));
      }
      if (clientesRes.ok) {
        const cl = await clientesRes.json();
        setClientes(cl.filter((c: any) => c.estado !== 'Inactivo'));
      }
    } catch { toast.error('Error al cargar camiones/etiquetas.'); }
  };

  useEffect(() => { fetchGuias(); fetchCamiones(); }, []);

  const estadoColor = (estado: string) => {
    switch (estado) {
      case 'Cargada': return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
      case 'EnRuta': return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
      case 'Cerrada': return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
      case 'Anulada': return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
      default: return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
    }
  };

  const toggleEtiqueta = (id: string) => {
    const quitar = etiquetaIds.includes(id);
    setEtiquetaIds(prev => quitar ? prev.filter(x => x !== id) : [...prev, id]);
    if (quitar) setColchonEtiquetaIds(prev => prev.filter(x => x !== id));
  };

  const toggleCliente = (id: string) => {
    setClienteIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const clientesDeRuta = (ruta: any) => {
    if (!ruta?.cliente_ids) return [];
    try { return JSON.parse(ruta.cliente_ids); } catch { return []; }
  };

  // Recorrido que "hereda" la guía: ruta explícita o la por defecto del camión.
  const camionSel = camiones.find((c: any) => c.id === camionId);
  const rutaSeleccionada = rutas.find((r: any) => r.id === rutaId) || null;
  const rutaDefectoNombre = rutaId === '' && camionSel?.ruta_defecto ? camionSel.ruta_defecto : null;
  const recorridoNombre = rutaSeleccionada?.nombre || rutaDefectoNombre;

  // Vendedor que la ruta precargó (para marcar de dónde vino en el paso 1).
  const vendedorDeRuta = (() => {
    if (!rutaSeleccionada) return null;
    if (rutaSeleccionada.vendedor_asignado) {
      const v = vendedores.find((x: any) => x.name === rutaSeleccionada.vendedor_asignado);
      if (v) return v.id;
    }
    try {
      const arr = JSON.parse(rutaSeleccionada.vendedores || '[]');
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } catch { /* noop */ }
    return camionSel?.vendedor_id ? String(camionSel.vendedor_id) : null;
  })();

  // Nombre del vendedor heredado para mostrar en la tarjeta (aunque solo haya ids).
  const vendedorHeredadoNombre = (() => {
    if (rutaSeleccionada?.vendedor_asignado) return rutaSeleccionada.vendedor_asignado;
    if (vendedorDeRuta) return vendedores.find((v: any) => v.id === vendedorDeRuta)?.name || '—';
    return '—';
  })();

  const clientesDelRecorrido = (() => {
    if (rutaSeleccionada) return new Set(clientesDeRuta(rutaSeleccionada));
    if (rutaDefectoNombre) return new Set(clientes.filter((c: any) => c.ruta === rutaDefectoNombre).map((c: any) => c.id));
    return new Set<string>();
  })();

  // Paso 1: con ruta, el checklist es exactamente la lista de esa ruta (más los
  // extras elegidos a mano); sin ruta, se listan todos para armarlo a mano.
  const idsRutaActual = rutaSeleccionada ? clientesDeRuta(rutaSeleccionada) : null;
  const enListaBase = (c: any) => !idsRutaActual || idsRutaActual.includes(c.id);
  const coincideBusqueda = (c: any) => {
    const q = busquedaCliente.trim().toLowerCase();
    if (!q) return true;
    return [c.nombre, c.documento_id, c.direccion, c.ruta].some(v => String(v || '').toLowerCase().includes(q));
  };
  // Lo que se ve en el checklist: base de la ruta + extras ya seleccionados.
  const checklistClientes = clientes.filter((c: any) => (enListaBase(c) || clienteIds.includes(c.id)) && coincideBusqueda(c));
  // Para agregar: fuera de la ruta y sin seleccionar; solo tiene sentido con búsqueda activa.
  const candidatosAgregar = busquedaCliente.trim()
    ? clientes.filter((c: any) => !enListaBase(c) && !clienteIds.includes(c.id) && coincideBusqueda(c))
    : [];

  const kilosSeleccionados = etiquetasDisponibles
    .filter((e: any) => etiquetaIds.includes(e.id))
    .reduce((acc: number, e: any) => acc + Number(e.pesoNeto || 0), 0);
  const sinPesarSeleccionadas = etiquetasDisponibles.filter((e: any) => etiquetaIds.includes(e.id) && (!(Number(e.pesoNeto) > 0) || !e.pesoRegistradoEn || !['Manual', 'Bascula'].includes(String(e.pesoOrigen)))).length;
  const kilosColchon = etiquetasDisponibles
    .filter((e: any) => etiquetaIds.includes(e.id) && colchonEtiquetaIds.includes(e.id))
    .reduce((acc: number, e: any) => acc + Number(e.pesoNeto || 0), 0);

  // Wizard: un paso a la vez; los pasos completados quedan marcados con check.
  const pasosNav = [
    { n: 1, t: 'Ruta y clientes', ok: clienteIds.length > 0 },
    { n: 2, t: 'Camión y vendedor', ok: camionId !== '' },
    { n: 3, t: 'Carga', ok: etiquetaIds.length > 0 },
    { n: 4, t: 'Revisar y emitir', ok: false },
  ];

  // Fecha de salida sugerida según los días de frecuencia de la ruta.
  const proximaSugerencia = (raw?: string | null): string | null => {
    if (!raw) return null;
    const mapa: Record<string, number> = {
      l: 1, lun: 1, lunes: 1, m: 2, mar: 2, martes: 2, x: 3, mi: 3, mie: 3, mié: 3, miér: 3, miercoles: 3, miércoles: 3,
      j: 4, jue: 4, jueves: 4, v: 5, vie: 5, viernes: 5, s: 6, sá: 6, sab: 6, sáb: 6, sabado: 6, sábado: 6, d: 0, dom: 0, domingo: 0
    };
    const dias = [...new Set(String(raw).toLowerCase().split(/[\s,;./-]+/).filter(Boolean).map(t => mapa[t]).filter((x: any) => x !== undefined))] as number[];
    if (dias.length === 0) return null;
    const hoy = new Date();
    const hoyDia = hoy.getDay();
    let offset = 7;
    for (let i = 0; i < 7; i++) { if (dias.includes((hoyDia + i) % 7)) { offset = i; break; } }
    const fecha = new Date(hoy);
    fecha.setDate(fecha.getDate() + offset);
    const fmt = fecha.toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' });
    return offset === 0
      ? `Hoy coincide · salida sugerida ${fmt}`
      : `Próxima salida según los días de la ruta · ${fmt}`;
  };
  const sugerenciaFecha = rutaSeleccionada ? proximaSugerencia(rutaSeleccionada.dias_frecuencia) : null;

  // Chip de ruta en la tabla de guías (ruta por id, o por defecto del camión).
  const nombreRutaDe = (g: any) => {
    if (g.rutaId) { const r = rutas.find((x: any) => x.id === g.rutaId); if (r?.nombre) return r.nombre; }
    const cam = camiones.find((c: any) => c.id === g.camionId);
    return cam?.ruta_defecto || null;
  };

  // Clientes agrupados por provincia → cantón → distrito, para elegir y
  // ordenar la visita con sentido geográfico de la ruta.
  const agrupadosPorGeo = (() => {
    const grupos = new Map<string, { provincia: string; canton: string; distrito: string; lista: any[] }>();
    for (const c of [...checklistClientes].sort((a: any, b: any) => (a.nombre || '').localeCompare(b.nombre || ''))) {
      const provincia = String(c.provincia || '').trim() || 'Sin provincia';
      const canton = String(c.canton || '').trim();
      const distrito = String(c.distrito || '').trim();
      const key = `${provincia}|${canton}|${distrito}`;
      if (!grupos.has(key)) grupos.set(key, { provincia, canton, distrito, lista: [] });
      grupos.get(key)!.lista.push(c);
    }
    const ordenGeo = (a: any, b: any) => {
      const pa = a.provincia === 'Sin provincia' ? 1 : 0, pb = b.provincia === 'Sin provincia' ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return [a.provincia, a.canton, a.distrito].join('|').localeCompare([b.provincia, b.canton, b.distrito].join('|'));
    };
    return Array.from(grupos.values()).sort(ordenGeo);
  })();

  // Solo los clientes seleccionados, agrupados por geografía (paso 4: orden de visita).
  const agrupadosSeleccionados = (() => {
    const grupos = new Map<string, { provincia: string; canton: string; distrito: string; lista: any[] }>();
    for (const c of clientes.filter((c: any) => clienteIds.includes(c.id))) {
      const provincia = String(c.provincia || '').trim() || 'Sin provincia';
      const canton = String(c.canton || '').trim();
      const distrito = String(c.distrito || '').trim();
      const key = `${provincia}|${canton}|${distrito}`;
      if (!grupos.has(key)) grupos.set(key, { provincia, canton, distrito, lista: [] });
      grupos.get(key)!.lista.push(c);
    }
    return Array.from(grupos.values());
  })();

  // Orden lógico de visita: clientes elegidos ordenados por geografía.
  const clientesOrdenadosGeo = (() => {
    const seleccion = clientes.filter((c: any) => clienteIds.includes(c.id));
    const geo = (c: any) => [String(c.provincia || '').trim() || '~~~', String(c.canton || '').trim(), String(c.distrito || '').trim()].join('|');
    return [...seleccion].sort((a: any, b: any) => geo(a).localeCompare(geo(b)));
  })();

  // Elegir una ruta solo precarga sus clientes (paso 1). Camión y vendedor
  // los decide el usuario en el paso 2; la ruta puede sugerirlos, no imponerlos.
  const preseleccionarDeRuta = (ruta: any) => {
    setClienteIds(clientesDeRuta(ruta));
  };

  // Sugerencias de la ruta para el paso 2 (se aplican solo si el usuario lo pide).
  const sugerenciaCamionRuta = (() => {
    if (!rutaSeleccionada?.camion_id) return null;
    const c = camiones.find((x: any) => x.id === rutaSeleccionada.camion_id);
    return c && !c.guiaActivaId ? c : null;
  })();
  const sugerenciaVendedorRuta = (() => {
    if (!rutaSeleccionada) return null;
    try {
      const arr = JSON.parse(rutaSeleccionada.vendedores || '[]');
      if (Array.isArray(arr) && arr.length) {
        const v = vendedores.find((x: any) => arr.map(String).includes(x.id));
        if (v) return v;
      }
    } catch { /* noop */ }
    if (rutaSeleccionada.vendedor_asignado) {
      const nombres = String(rutaSeleccionada.vendedor_asignado).split(',').map((s: string) => s.trim());
      const v = vendedores.find((x: any) => nombres.includes(x.name));
      if (v) return v;
    }
    return null;
  })();
  const aplicarSugerenciasRuta = () => {
    if (sugerenciaCamionRuta) setCamionId(sugerenciaCamionRuta.id);
    if (sugerenciaVendedorRuta) {
      setVendedorId(sugerenciaVendedorRuta.id);
      setResponsableTransporte(sugerenciaVendedorRuta.name);
    }
  };

  const crearGuia = async () => {
    if (!camionId) return toast.error('Seleccione un camión');
    if (etiquetaIds.length === 0) return toast.error('Seleccione al menos una etiqueta EnBodega');
    if (sinPesarSeleccionadas > 0) return toast.error(`Pese en kg las ${sinPesarSeleccionadas} etiquetas seleccionadas antes de emitir la guía.`);
    setLoading(true);
    try {
      const res = await fetch('/api/logistica/guias', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({
          camionId, rutaId: rutaId || undefined,
          etiquetasIds: etiquetaIds,
          colchonEtiquetaIds: colchonEtiquetaIds.filter(id => etiquetaIds.includes(id)),
          responsablesCarga: responsableCarga || currentUser.name,
          responsableTransporte: responsableTransporte || vendedores.find(v => v.id === vendedorId)?.name || currentUser.name,
          vendedorId: vendedorId || undefined,
          clienteIds: clienteIds.length > 0 ? clientesOrdenadosGeo.map((c: any) => c.id) : undefined,
          pesoSalida: pesoSalida || undefined
        })
      });
      if (res.ok) {
        toast.success('Guía de despacho creada');
        setEtiquetaIds([]); setColchonEtiquetaIds([]); setCamionId(''); setRutaId(''); setVendedorId(''); setClienteIds([]);
        setPesoSalida(0); setResponsableCarga(''); setResponsableTransporte(''); setSug(null); setSugError('');
        setBusquedaCliente('');
        setPaso(1); setWizardAbierto(false);
        await fetchGuias(); await fetchCamiones();
      } else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const abrirWizard = () => {
    setPaso(1);
    setWizardAbierto(true);
  };

  const cerrarWizard = () => {
    if (loading) return;
    setWizardAbierto(false);
    setEtiquetaIds([]); setColchonEtiquetaIds([]); setCamionId(''); setRutaId(''); setVendedorId(''); setClienteIds([]);
    setPesoSalida(0); setResponsableCarga(''); setResponsableTransporte(''); setSug(null); setSugError('');
    setBusquedaCliente('');
    setPaso(1);
  };

  const pedirSugerencia = async () => {
    if (clienteIds.length === 0) return toast.error('Seleccioná al menos un cliente (paso 1) para basar la sugerencia');
    setSugLoading(true); setSugError(''); setSug(null);
    try {
      const res = await fetch(`/api/logistica/sugerir-carga?clienteIds=${encodeURIComponent(clienteIds.join(','))}`, { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setSug(await res.json());
      else { const d = await res.json(); setSugError(d.error || 'No se pudo calcular la sugerencia'); }
    } catch (e: any) { setSugError(e.message); }
    setSugLoading(false);
  };

  const aplicarSugerencia = () => {
    const lista = sug?.sugerencia?.productos;
    if (!Array.isArray(lista) || lista.length === 0) return;
    const norm = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const seleccion = new Set(etiquetaIds);
    for (const p of lista) {
      const disponibles = etiquetasDisponibles
        .filter((e: any) => norm(String(e.producto || '')) === norm(String(p.producto || '')))
        .sort((a: any, b: any) => Number(b.cantidad || 0) - Number(a.cantidad || 0));
      let quota = Number(p.cartones || 0);
      while (quota > 0) {
        const restantes = disponibles.filter((e: any) => !seleccion.has(e.id));
        if (restantes.length === 0) break;
        // Etiqueta más cercana al faltante: minimiza el sobrante cargado.
        const elegida = restantes.reduce((a: any, b: any) =>
          Math.abs(Number(a.cantidad || 0) - quota) <= Math.abs(Number(b.cantidad || 0) - quota) ? a : b);
        seleccion.add(elegida.id);
        quota -= Number(elegida.cantidad || 0);
      }
    }
    if (seleccion.size === 0) return toast.error('No hay etiquetas EnBodega de los productos sugeridos');
    setEtiquetaIds(Array.from(seleccion));
    toast.success(`Sugerencia aplicada: ${seleccion.size} etiquetas`);
  };

  const verDetalle = async (id: string) => {
    try {
      const res = await fetch(`/api/logistica/guias/${id}`, { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setGuiaDetalle(await res.json());
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
  };

  const marcarEnRuta = async (id: string) => {
    try {
      const res = await fetch(`/api/logistica/guias/${id}/marcar-en-ruta`, { method: 'POST', headers: sessionHeaders(currentUser.id) });
      if (res.ok) { toast.success('Guía marcada EnRuta'); await fetchGuias(); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
  };

  const cerrarGuia = async (id: string) => {
    setModal({ tipo: 'cerrar', guiaId: id });
    setPesoLlegada('');
  };

  // Consolidación G3: el cierre de guía ya no es un camino aparte. Antes
  // había dos botones que cerraban distinto —el de Despacho y el del Tablero—
  // y además un endpoint huérfano (`/cierre-ruta`) que no cerraba la guía.
  // Ahora todos pasan por `/cuadre-central`, el endpoint completo: reingresa
  // el sobrante, concilia dinero, manda la merma a aprobación si excede la
  // tolerancia y marca Cerrada o CerradaConDiferencia.
  const confirmarCierre = async () => {
    if (!modal || modal.tipo !== 'cerrar' || !modal.guiaId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logistica/cuadre-central`, {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ guiaId: modal.guiaId, pesoLlegada: Number(pesoLlegada) || null, responsable: currentUser.name })
      });
      if (res.ok) {
        const d = await res.json();
        toast.success(d.estado === 'CerradaConDiferencia' ? d.message : 'Guía cuadrada en central');
        await fetchGuias();
      } else {
        const d = await res.json();
        // El cuadre exige que la caja haya cerrado el día; sin eso no hay
        // qué conciliar (decisión a de G3: primero caja, después cuadre).
        toast.error(res.status === 409
          ? 'Primero el vendedor debe cerrar la caja en Caja Ruta, y después se cuadra aquí.'
          : `Error: ${d.error}`);
      }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
    setModal(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-bold flex items-center gap-2"><Truck className="w-5 h-5" /> Despacho y Guías</h3>
        <button type="button" onClick={abrirWizard} className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-2" style={{ background: 'var(--brand-primary)' }}>
          <ClipboardList className="w-4 h-4" /> Crear Guía
        </button>
      </div>

      <div className="space-y-6">
          {/* Crear guía — modal del wizard de 4 pasos */}
          {wizardAbierto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={cerrarWizard}>
            <div className="w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>

              {/* Encabezado */}
              <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 shrink-0" style={{ borderBottom: '1px solid var(--border-default)' }}>
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: 'var(--brand-primary)' }}>
                    <ClipboardList className="w-5 h-5" />
                  </span>
                  <div>
                    <h4 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Nueva Guía de Despacho</h4>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Ruta, camión, carga y emisión en 4 pasos · todo se ajusta antes de emitir</p>
                  </div>
                </div>
                <button type="button" onClick={cerrarWizard} aria-label="Cerrar" className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors" style={{ color: 'var(--text-muted)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Wizard: indicador de pasos */}
              <div className="px-6 py-3 flex flex-wrap items-center gap-1.5 shrink-0" style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-elevated, var(--bg-muted))' }}>
              {pasosNav.map((p: any, i: number) => {
                const activo = p.n === paso;
                const hecho = p.n < paso || p.ok;
                return (
                  <React.Fragment key={p.n}>
                    {i > 0 && <span className="w-4 h-px shrink-0" style={{ background: 'var(--border-default)' }} />}
                    <button key={p.n} type="button" onClick={() => setPaso(p.n)} aria-current={activo ? 'step' : undefined}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                      style={activo
                        ? { background: 'var(--brand-primary)', color: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }
                        : hecho
                          ? { background: 'rgba(5,150,105,0.12)', color: '#059669', border: '1px solid rgba(5,150,105,0.35)' }
                          : { background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>
                      {hecho && !activo
                        ? <Check className="w-3.5 h-3.5" />
                        : <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: activo ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.06)' }}>{p.n}</span>}
                      {p.t}
                    </button>
                  </React.Fragment>
                );
              })}
              </div>

              {/* Cuerpo (scroll interno) */}
              <div className="px-6 py-5 overflow-y-auto flex-1">

            {/* Paso 1 · Ruta y clientes */}
            {paso === 1 && (
            <div className="space-y-5">
              {/* 1 · Elegir la ruta */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>1 · Elegí la ruta</label>
                {rutas.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No hay rutas registradas. Creá una en <b>Flota y Rutas</b> para cargar sus clientes automáticamente.</p>
                ) : (
                  <select value={rutaId} onChange={e => {
                    const rid = e.target.value;
                    setRutaId(rid);
                    preseleccionarDeRuta(rutas.find((r: any) => r.id === rid));
                  }} className="w-full input">
                    <option value="">Sin ruta específica (armar lista a mano)</option>
                    {rutas.map((r: any) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                )}
                {sugerenciaFecha && (
                  <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <CalendarDays className="w-3.5 h-3.5 shrink-0" /> {sugerenciaFecha}
                  </p>
                )}
                {rutaSeleccionada && (
                  <div className="flex flex-wrap gap-1.5 text-[11px] pt-1">
                    <span className="px-2 py-0.5 rounded-full font-semibold flex items-center gap-1" style={{ background: 'rgba(5,150,105,0.12)', color: '#059669' }}>
                      <Users className="w-3 h-3" /> {clientesDelRecorrido.size} clientes asignados
                    </span>
                    {rutaSeleccionada.dias_frecuencia && (
                      <span className="px-2 py-0.5 rounded-full font-semibold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>Frecuencia: {rutaSeleccionada.dias_frecuencia}</span>
                    )}
                    {vendedorHeredadoNombre && vendedorHeredadoNombre !== '—' && (
                      <span className="px-2 py-0.5 rounded-full font-semibold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>Vendedor: {vendedorHeredadoNombre}</span>
                    )}
                    {sugerenciaCamionRuta && (
                      <span className="px-2 py-0.5 rounded-full font-semibold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>Camión: {sugerenciaCamionRuta.nombre}</span>
                    )}
                  </div>
                )}
                {!rutaSeleccionada && rutas.length > 0 && (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Elegí una ruta y sus clientes se cargan abajo; los podés quitar o agregar antes de seguir.</p>
                )}
              </div>

              {/* 2 · Lista de clientes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      2 · {rutaSeleccionada ? <>Clientes de <b>{rutaSeleccionada.nombre}</b></> : 'Clientes a visitar'}
                    </label>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-bold" style={clienteIds.length > 0
                      ? { background: 'var(--brand-primary)', color: '#fff' }
                      : { background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>
                      {clienteIds.length} seleccionados
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                      <input value={busquedaCliente} onChange={e => setBusquedaCliente(e.target.value)} placeholder="Buscar cliente…"
                        className="input text-xs pl-8 py-1.5 w-44" />
                    </div>
                    {clienteIds.length > 0 && (
                      <button type="button" onClick={() => setClienteIds([])}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                        Vaciar
                      </button>
                    )}
                  </div>
                </div>

                {checklistClientes.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {busquedaCliente ? 'Ningún cliente coincide con la búsqueda.' : 'La ruta no tiene clientes asignados — buscalos abajo para agregarlos.'}
                  </p>
                ) : (
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {agrupadosPorGeo.map(({ provincia, canton, distrito, lista }) => (
                      <div key={`${provincia}|${canton}|${distrito}`} className="rounded-lg p-3" style={{ background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border-default)' }}>
                        <span className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1 opacity-70"><MapPin className="w-3 h-3" />
                          {provincia}{canton ? ` › ${canton}` : ''}{distrito ? ` › ${distrito}` : ''} <span className="opacity-60">({lista.length})</span>
                        </span>
                        <div className="grid md:grid-cols-2 gap-2 mt-2">
                          {lista.map((c: any) => {
                            const marcado = clienteIds.includes(c.id);
                            const esExtra = idsRutaActual ? !idsRutaActual.includes(c.id) : false;
                            return (
                              <button key={c.id} type="button" onClick={() => toggleCliente(c.id)} aria-pressed={marcado}
                                className={cn("flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm font-medium transition-all",
                                  marcado ? "text-white shadow-sm" : "hover:opacity-80")}
                                style={marcado
                                  ? { background: 'var(--brand-primary)' }
                                  : { background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                                <span className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                                  style={marcado ? { background: 'rgba(255,255,255,0.25)' } : { border: '1.5px solid var(--border-default)' }}>
                                  {marcado && <Check className="w-3 h-3" />}
                                </span>
                                <span className="flex-1 truncate">{c.nombre}</span>
                                {esExtra && (
                                  <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full font-bold shrink-0"
                                    style={marcado ? { background: 'rgba(255,255,255,0.22)' } : { background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>
                                    agregado
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {candidatosAgregar.length > 0 && (
                  <div className="rounded-lg p-3" style={{ background: 'var(--bg-elevated, var(--bg-card))', border: '1px dashed var(--border-default)' }}>
                    <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                      Agregar a la lista
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {candidatosAgregar.map((c: any) => (
                        <button key={c.id} type="button" onClick={() => toggleCliente(c.id)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 hover:opacity-80 transition-all"
                          style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-default)', color: 'var(--text-primary)' }}>
                          {c.nombre}
                          <span style={{ color: 'var(--brand-primary)' }}>+ agregar</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {rutaSeleccionada
                    ? <>Estos son los clientes de «{rutaSeleccionada.nombre}». Desmarcá los que no visitás y, si falta alguno, buscalo para agregarlo.</>
                    : 'Sin ruta: marcá los clientes a mano con la búsqueda.'}
                </p>
              </div>
            </div>
            )}

            {/* Paso 2 · Camión y vendedor */}
            {paso === 2 && (
            <div className="space-y-5">
              {(sugerenciaCamionRuta || sugerenciaVendedorRuta) && (
                <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'var(--bg-elevated, var(--bg-muted))', border: '1px solid var(--border-default)' }}>
                  <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    <span>La ruta <b style={{ color: 'var(--text-primary)' }}>{rutaSeleccionada?.nombre}</b> sugiere
                      {sugerenciaCamionRuta && <> camión <b style={{ color: 'var(--text-primary)' }}>{sugerenciaCamionRuta.nombre}</b></>}
                      {sugerenciaCamionRuta && sugerenciaVendedorRuta && ' · '}
                      {sugerenciaVendedorRuta && <> vendedor <b style={{ color: 'var(--text-primary)' }}>{sugerenciaVendedorRuta.name}</b></>}
                    </span>
                  </p>
                  <button type="button" onClick={aplicarSugerenciasRuta}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90"
                    style={{ background: 'var(--brand-primary)' }}>
                    Usar sugerencia
                  </button>
                </div>
              )}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Camión *</label>
                  <select value={camionId} onChange={e => {
                    const id = e.target.value;
                    setCamionId(id);
                    const cam = camiones.find((c: any) => c.id === id);
                    const rutaOmatch = cam ? rutas.find((r: any) => r.nombre === cam.ruta_defecto) : undefined;
                    if (rutaId === '' && rutaOmatch) setRutaId(rutaOmatch.id);
                  }} className="w-full input">
                    <option value="">Seleccionar camión</option>
                    {camiones.filter((c: any) => !c.guiaActivaId).map((c: any) => (
                      <option key={c.id} value={c.id}>{c.nombre} ({c.capacidad_cartones} cap.)</option>
                    ))}
                  </select>
                  {sugerenciaCamionRuta && camionId === sugerenciaCamionRuta.id && (
                    <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--brand-primary)' }}>
                      <Check className="w-3 h-3" /> Camión sugerido por «{rutaSeleccionada?.nombre}»
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Vendedor</label>
                  <select value={vendedorId} onChange={e => {
                    const vid = e.target.value;
                    setVendedorId(vid);
                    setResponsableTransporte(vendedores.find(v => v.id === vid)?.name || '');
                  }} className="w-full input">
                    <option value="">Seleccionar vendedor</option>
                    {vendedores.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  {rutaSeleccionada && vendedorDeRuta && vendedorId === vendedorDeRuta && (
                    <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--brand-primary)' }}>
                      <Check className="w-3 h-3" /> Vendedor sugerido por «{rutaSeleccionada.nombre}»
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Responsable de carga</label>
                  <input value={responsableCarga} onChange={e => setResponsableCarga(e.target.value)} placeholder="Despachador" className="w-full input" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Referencia de la ruta</label>
                  <input value={recorridoNombre || 'Sin ruta'} readOnly disabled className="w-full input opacity-60" />
                </div>
              </div>
              {recorridoNombre && (
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  La ruta {recorridoNombre} dejó {clientesDelRecorrido.size} cliente(s) seleccionados en el paso 1. Ajustá si hace falta.
                </p>
              )}
            </div>
            )}

            {/* Paso 3 · Carga del camión */}
            {paso === 3 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: 'var(--brand-primary)' }}>3</span>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Carga del camión</p>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>productos con cartones y kilos · sugerencia según historial</span>
                {etiquetaIds.length > 0 && (
                  <span className="ml-auto text-[11px] px-2 py-1 rounded-full font-bold text-white" style={{ background: 'var(--brand-primary)' }}>
                    {etiquetaIds.length} etiquetas · {kilosSeleccionados.toFixed(2)} kg{sinPesarSeleccionadas ? ` · ${sinPesarSeleccionadas} sin pesar` : ``}
                  </span>
                )}
              </div>

              {/* Sugerencia IA basada en el historial de los clientes */}
              <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.4)' }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: '#6366f1' }}>
                    <Sparkles className="w-3.5 h-3.5" /> Carga sugerida
                  </p>
                  <div className="flex items-center gap-2">
                    {sug?.sugerencia && (
                      <button type="button" onClick={aplicarSugerencia} className="text-xs font-semibold px-2.5 py-1 rounded-lg text-white" style={{ background: '#6366f1' }}>
                        Aplicar sugerencia
                      </button>
                    )}
                    <button type="button" onClick={pedirSugerencia} disabled={sugLoading || clienteIds.length === 0}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50 flex items-center gap-1.5" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                      {sugLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                      {sugLoading ? 'Analizando…' : 'Sugerir con IA'}
                    </button>
                  </div>
                </div>
                {sugError && <p className="text-xs" style={{ color: '#dc2626' }}>{sugError}</p>}
                {clienteIds.length === 0 && !sug && !sugLoading && (
                  <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Seleccioná clientes en el paso 1 para que la sugerencia use el historial de sus pedidos.</p>
                )}
                {sug?.sugerencia && (
                  <div className="space-y-2 text-xs">
                    <div className="flex flex-wrap gap-2">
                      <span className="px-2 py-1 rounded-lg font-bold text-white" style={{ background: '#6366f1' }}>
                        {sug.sugerencia.totalCartones} ct
                      </span>
                      {sug.sugerencia.kgEstimados != null && (
                        <span className="px-2 py-1 rounded-lg font-semibold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>~{sug.sugerencia.kgEstimados} kg</span>
                      )}
                      <span className="px-2 py-1 rounded-lg font-semibold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                        confianza {Math.round((sug.sugerencia.confianza || 0) * 100)}%
                      </span>
                      {sug.sugerencia.fuente === 'historial' && (
                        <span className="px-2 py-1 rounded-lg font-semibold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>basado en historial</span>
                      )}
                    </div>
                    {Array.isArray(sug.sugerencia.productos) && sug.sugerencia.productos.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {sug.sugerencia.productos.map((p: any) => (
                          <span key={p.producto} className="px-2 py-1 rounded-lg font-semibold" style={{ background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border-default)' }}>
                            {p.producto}: {p.cartones} ct{p.kilos != null ? ` · ${p.kilos} kg` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{sug.sugerencia.justificacion}</p>
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Peso de salida</label>
                  <div className="relative">
                    <input type="number" min="0" value={pesoSalida} onChange={e => setPesoSalida(Number(e.target.value))} placeholder="0" className="w-full input pr-10" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold pointer-events-none" style={{ color: 'var(--text-muted)' }}>kg</span>
                  </div>
                </div>
                <div className="flex items-end">
                  <p className="text-xs pb-2" style={{ color: 'var(--text-muted)' }}>Se contrasta con el peso de llegada al cerrar la guía.</p>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted">Productos EnBodega ({etiquetasDisponibles.length} etiquetas) — seleccionar para cargar</label>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>En cada etiqueta cargada, podés marcar cuántos cartones quedan como extra para ventas imprevistas. El extra también se controla en el cuadre.</p>
                {etiquetasDisponibles.length === 0 ? (
                  <p className="text-sm text-muted">No hay etiquetas EnBodega. Aliste primero en Remisiones.</p>
                ) : (
                  (() => {
                    const grupos = etiquetasDisponibles.reduce((acc: any[], e: any) => {
                      const g = acc.find((x: any) => x.producto === e.producto);
                      if (g) g.etiquetas.push(e);
                      else acc.push({ producto: e.producto, etiquetas: [e] });
                      return acc;
                    }, []);
                    return (
                      <div className="space-y-3 mt-2 max-h-72 overflow-y-auto">
                        {grupos.map((g: any) => {
                          const idsGrupo = g.etiquetas.map((e: any) => e.id);
                          const todosEnGrupo = idsGrupo.every((id: string) => etiquetaIds.includes(id));
                          const cartonesGrupo = g.etiquetas.reduce((a: number, e: any) => a + Number(e.cantidad), 0);
                          const kilosGrupo = g.etiquetas.reduce((a: number, e: any) => a + (Number(e.peso_bodega) || 0), 0);
                          return (
                            <div key={g.producto} className="rounded-lg p-3" style={{ background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border-default)' }}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-semibold flex items-center gap-1"><Boxes className="w-3.5 h-3.5" /> {g.producto}
                                  <span className="text-xs opacity-70">({g.etiquetas.length} etiquetas{kilosGrupo > 0 ? ` · ${kilosGrupo} kg` : ''})</span>
                                </span>
                                <button type="button" onClick={() => {
                                  if (todosEnGrupo) setEtiquetaIds(prev => prev.filter(id => !idsGrupo.includes(id)));
                                  else setEtiquetaIds(prev => Array.from(new Set([...prev, ...idsGrupo])));
                                }} className="text-xs font-semibold text-brand">
                                  {todosEnGrupo ? 'Quitar todos' : 'Cargar todos'}
                                </button>
                              </div>
                              <div className="grid md:grid-cols-3 gap-2">
                                {g.etiquetas.map((e: any) => (
                                  <div key={e.id} className="space-y-1">
                                    <button type="button" onClick={() => toggleEtiqueta(e.id)}
                                      className="w-full p-3 rounded-lg text-left text-sm space-y-1 transition-all"
                                      style={etiquetaIds.includes(e.id)
                                        ? { background: 'var(--brand-primary)', color: '#fff' }
                                        : { background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                                      <span className="flex items-center gap-1 font-mono text-xs">{etiquetaIds.includes(e.id) && <Check className="w-3.5 h-3.5" />}{e.codigo_unico}</span>
                                      <span className="flex items-center gap-1 text-xs opacity-80"><Boxes className="w-3 h-3" /> {e.cantidad} cartones</span>
                                      {e.peso_bodega != null && <span className="text-xs opacity-70">peso {e.peso_bodega} kg</span>}
                                    </button>
                                    {etiquetaIds.includes(e.id) && (
                                      <label className="flex items-center gap-1.5 px-1 text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                        <input type="checkbox" checked={colchonEtiquetaIds.includes(e.id)} onChange={() => setColchonEtiquetaIds(prev => prev.includes(e.id) ? prev.filter(id => id !== e.id) : [...prev, e.id])} />
                                        Extra de ruta ({e.cantidad} ct)
                                      </label>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
            )}

            {/* Paso 4 · Revisar y emitir */}
            {paso === 4 && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {[
                  { label: 'Camión', valor: camionSel?.nombre || '—', icono: Truck },
                  { label: 'Ruta', valor: recorridoNombre || 'Sin ruta', icono: Route },
                  { label: 'Vendedor', valor: vendedores.find(v => v.id === vendedorId)?.name || '—', icono: Users },
                  { label: 'Responsable de carga', valor: responsableCarga || '—', icono: Boxes },
                  { label: 'Etiquetas', valor: `${etiquetaIds.length} · ${kilosSeleccionados.toFixed(2)} kg`, icono: Receipt },
                  { label: 'Colchón extra', valor: `${kilosColchon.toFixed(2)} kg en ${colchonEtiquetaIds.filter(id => etiquetaIds.includes(id)).length} etiquetas`, icono: Boxes },
                  { label: 'Clientes', valor: String(clienteIds.length), icono: Users },
                  { label: 'Peso de salida', valor: pesoSalida > 0 ? `${pesoSalida} kg` : 'Sin registrar', icono: Boxes },
                  { label: 'Fecha de salida', valor: new Date().toLocaleDateString('es-CR'), icono: CalendarDays },
                ].map(({ label, valor, icono: Icono }) => (
                  <div key={label} className="rounded-xl p-3 space-y-1" style={{ background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border-default)' }}>
                    <p className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1" style={{ color: 'var(--text-muted)' }}><Icono className="w-3 h-3" /> {label}</p>
                    <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{valor}</p>
                  </div>
                ))}
              </div>

              {agrupadosSeleccionados.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Navigation className="w-3.5 h-3.5" /> Orden de visita sugerido
                  </p>
                  <div className="space-y-2">
                    {agrupadosSeleccionados.map(({ provincia, canton, distrito, lista }, i: number) => (
                      <div key={`${provincia}|${canton}|${distrito}`} className="rounded-lg p-2.5 flex items-center gap-2.5 flex-wrap" style={{ background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border-default)' }}>
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: 'var(--brand-primary)' }}>{i + 1}</span>
                        <span className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                          <MapPin className="w-3 h-3" /> {provincia}{canton ? ` › ${canton}` : ''}{distrito ? ` › ${distrito}` : ''}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {lista.map((c: any) => c.nombre).join(' · ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pesoSalida === 0 && (
                <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <Info className="w-3.5 h-3.5 shrink-0" /> Sin peso de salida: el camión saldrá sin registro de kilos. Podés agregarlo al cerrar la guía.
                </p>
              )}
            </div>
            )}

            </div>

            {/* Footer sticky: resumen en vivo + navegación */}
            <div className="px-6 py-4 flex items-center justify-between gap-3 flex-wrap shrink-0 rounded-b-2xl" style={{ borderTop: '1px solid var(--border-default)', background: 'var(--bg-elevated, var(--bg-muted))' }}>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {camionSel ? `Camión: ${camionSel.nombre}` : 'Sin camión'} ·{' '}
                <span className={etiquetaIds.length > 0 ? 'font-bold' : ''} style={etiquetaIds.length > 0 ? { color: 'var(--brand-primary)' } : undefined}>
                  {etiquetaIds.length} etiquetas · {kilosSeleccionados.toFixed(2)} kg{sinPesarSeleccionadas ? ` · ${sinPesarSeleccionadas} sin pesar` : ``}
                </span>
                {' '}· {clienteIds.length} clientes
              </p>
              <div className="flex items-center gap-2">
                {paso > 1 && (
                  <button type="button" onClick={() => setPaso(paso - 1)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                    Volver
                  </button>
                )}
                {paso < 4 && (
                  <button type="button" onClick={() => {
                    if (paso === 2 && !camionId) return toast.error('Seleccione un camión para continuar');
                    if (paso === 3 && etiquetaIds.length === 0) return toast.error('Seleccione al menos un producto para cargar');
                    setPaso(paso + 1);
                  }}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: 'var(--brand-primary)' }}>
                    Siguiente
                  </button>
                )}
                {paso === 4 && (
                  <button onClick={crearGuia} disabled={loading || etiquetaIds.length === 0 || sinPesarSeleccionadas > 0}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-1.5" style={{ background: 'var(--brand-primary)' }}>
                    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {loading ? 'Creando…' : `Emitir Guía (${etiquetaIds.length} etiquetas${clienteIds.length > 0 ? ` · ${clienteIds.length} clientes` : ''})`}
                  </button>
                )}
              </div>
            </div>
            </div>
          </div>
          )}

          {/* Lista de guías */}
          <div className="p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold">Guías de despacho</h4>
              <button onClick={fetchGuias} className="p-1.5 rounded-lg hover:bg-black/5"><RefreshCw className="w-4 h-4" /></button>
            </div>
            <table className="w-full text-sm">
              <thead>
                    <tr className="text-left text-xs text-muted border-b">
                      <th className="py-2 pr-2">Consecutivo</th><th className="py-2 pr-2">Fecha</th><th className="py-2 pr-2">Camión</th>
                      <th className="py-2 pr-2">Ruta</th><th className="py-2 pr-2">Carga</th><th className="py-2 pr-2">Vendido</th>
                      <th className="py-2 pr-2">Avance</th><th className="py-2 pr-2">Estado</th><th className="py-2">Acciones</th>
                    </tr>
              </thead>
              <tbody>
                {guias.map((g: any) => (
                  <tr key={g.id} className="border-b border-dashed">
                    <td className="py-2 pr-2 font-mono text-xs">{g.consecutivo}</td>
                    <td className="py-2 pr-2">{g.camionNombre}</td>
                    <td className="py-2 pr-2">
                      {nombreRutaDe(g) ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                          <MapPin className="w-3 h-3" />{nombreRutaDe(g)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">{Number(g.totalKg ?? g.totalCartones).toFixed(2)} {g.totalKg != null ? 'kg' : 'ct'}{Number(g.colchonKg ?? g.colchonCartones) > 0 && <span className="block text-[10px] text-amber-700">{Number(g.colchonKg ?? g.colchonCartones).toFixed(2)} {g.totalKg != null ? 'kg' : 'ct'} extra</span>}</td>
                    <td className="py-2 pr-2">{g.totalVendido}</td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded bg-black/10 overflow-hidden"><div className="h-full" style={{ width: `${g.avance}%`, background: 'var(--brand-primary)' }} /></div>
                        <span className="text-xs">{g.avance}%</span>
                      </div>
                    </td>
                    <td className="py-2 pr-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${estadoColor(g.estado)}`}>{g.estado}</span></td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button onClick={() => verDetalle(g.id)} className="text-xs text-brand font-semibold">Ver</button>
                        {g.estado === 'Cargada' && <button onClick={() => marcarEnRuta(g.id)} className="text-xs text-blue-600 font-semibold">Salir Ruta</button>}
                        {(g.estado === 'Cargada' || g.estado === 'EnRuta') && <button onClick={() => cerrarGuia(g.id)} className="text-xs text-emerald-600 font-semibold">Cuadrar</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {guias.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-sm text-muted">Sin guías de despacho</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Auditoría de ruta: lo que antes era la pestaña trazabilidad de
              Logística (G2). Carga, vendido, stock y merma por camión. */}
          <AuditoriaRuta currentUser={currentUser} />

          {/* Detalle modal */}
          {guiaDetalle && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setGuiaDetalle(null)}>
              <div className="max-w-lg w-full rounded-xl p-6 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold flex items-center gap-2"><ClipboardList className="w-4 h-4" /> {guiaDetalle.consecutivo}</h4>
                  <button onClick={() => setGuiaDetalle(null)} className="text-muted hover:text-foreground">✕</button>
                </div>
                <p className="text-sm mb-2"><strong>Camion:</strong> {guiaDetalle.camionNombre} {guiaDetalle.placa && `(${guiaDetalle.placa})`} · <strong>Estado:</strong> {guiaDetalle.estado}</p>
                <p className="text-sm mb-4">
                  {guiaDetalle.vendedorNombre && <><strong>Vendedor:</strong> {guiaDetalle.vendedorNombre} · </>}
                  <strong>Responsable carga:</strong> {guiaDetalle.responsableCarga || '—'} · <strong>Transporte:</strong> {guiaDetalle.responsableTransporte || '—'}
                </p>

                <table className="w-full text-xs mb-4">
                  <thead><tr className="text-left text-muted border-b"><th className="py-1 pr-2">Etiqueta</th><th className="py-1 pr-2">Producto</th><th className="py-1 pr-2">Peso neto</th><th className="py-1">Estado etiqueta</th></tr></thead>
                  <tbody>
                    {guiaDetalle.detalle?.map((d: any) => (
                      <tr key={d.id} className="border-b border-dashed">
                        <td className="py-1 pr-2 font-mono">{d.codigoUnico}</td>
                        <td className="py-1 pr-2">{d.producto}</td>
                        <td className="py-1 pr-2">{d.saldoKg != null || d.pesoNeto != null ? `${Number(d.saldoKg ?? d.pesoNeto).toFixed(2)} kg` : 'Sin peso registrado'}</td>
                        <td className="py-1">{d.estadoEtiqueta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="text-sm font-semibold mb-3 flex items-center gap-1"><ListChecks className="w-4 h-4" /> Línea de Tiempo</p>
                <ol className="text-xs space-y-2 mb-4">
                  {(() => {
                    const emitidas = (guiaDetalle.ventas || []).filter((v: any) => v.estado === 'Emitida');
                    const pasos = [
                      { icon: <Box className="w-3 h-3 text-blue-600" />, bg: 'bg-blue-100', t: 'Guía de despacho creada', d: `${fmtFecha(guiaDetalle.fecha)} ${fmtHora(guiaDetalle.fecha)} · ${Number(guiaDetalle.totalKg ?? guiaDetalle.totalCartones).toFixed(2)} ${guiaDetalle.totalKg != null ? 'kg' : 'cartones'} cargados a ${guiaDetalle.camionNombre}`, activo: guiaDetalle.estado === 'Cargada' },
                      { icon: <Navigation className="w-3 h-3 text-amber-600" />, bg: 'bg-amber-100', t: 'Salida a ruta', d: guiaDetalle.recibidoEn ? `${fmtFecha(guiaDetalle.recibidoEn)} ${fmtHora(guiaDetalle.recibidoEn)}` : 'Pendiente de marcar EnRuta', activo: guiaDetalle.estado === 'EnRuta' || guiaDetalle.estado === 'Cerrada' },
                      { icon: <Receipt className="w-3 h-3 text-emerald-600" />, bg: 'bg-emerald-100', t: `Ventas en ruta (${emitidas.length} tiquetes de ruta)`, d: emitidas.length === 0 ? 'Sin ventas registradas aún' : emitidas.map((v: any) => `${v.tiqueteConsecutivo} · ${v.producto} × ${v.cartones} ct · ${fmtCRC(v.total)}`).join(' · '), activo: emitidas.length > 0 && guiaDetalle.estado !== 'Cerrada' },
                      { icon: <MapPin className="w-3 h-3 text-sky-600" />, bg: 'bg-sky-100', t: 'Fin de día en la caja', d: guiaDetalle.finDiaFecha ? `${fmtFecha(guiaDetalle.finDiaFecha)} ${fmtHora(guiaDetalle.finDiaFecha)} · ventas bloqueadas hasta cuadre` : 'Pendiente (lo cierra el vendedor en Caja Ruta)', activo: Boolean(guiaDetalle.finDiaFecha) && guiaDetalle.estado !== 'Cerrada' },
                      { icon: <CheckCircle2 className="w-3 h-3 text-emerald-600" />, bg: 'bg-emerald-100', t: 'Cuadre en central (cierre)', d: guiaDetalle.estado === 'Cerrada' ? 'Guía cerrada y reconciliada · sobrante reingresado a Bodega Central' : 'Pendiente (cuadre en Tablero Vivo)', activo: guiaDetalle.estado === 'Cerrada' },
                    ];
                    return pasos.map((s, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${s.bg} ${s.activo ? 'ring-2 ring-offset-1' : 'opacity-60'}`} style={s.activo ? { boxShadow: '0 0 0 2px var(--brand-primary), 0 0 0 4px var(--bg-card)' } : undefined}>{s.icon}</span>
                        <div>
                          <p className="font-semibold">{s.t}</p>
                          <p className="text-muted">{s.d}</p>
                        </div>
                      </li>
                    ));
                  })()}
                </ol>

                {guiaDetalle.rutaOrden?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-semibold mb-2 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Orden de recorrido sugerido</p>
                    <ol className="text-xs space-y-1">
                      {guiaDetalle.rutaOrden.map((c: any, i: number) => (
                        <li key={c.clienteId} className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                          {c.nombre} <span className="text-muted">{c.prioridad}{c.ventanaIni && ` · ${c.ventanaIni}-${c.ventanaFin || '∞'}`}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {guiaDetalle.facturas?.length > 0 && (
                  <p className="text-xs">({guiaDetalle.facturas.length} facturas emitidas en ruta)</p>
                )}
              </div>
            </div>
          )}
        </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setModal(null)}>
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-xl animate-in zoom-in-95"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <RefreshCw className="w-4 h-4" /> Cuadrar en central
              </h4>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Registra el peso de llegada para conciliar la guía con el inventario de retorno.
                Requiere que la caja haya cerrado el día en Caja Ruta.
              </p>
              <div>
                <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Peso de llegada (kg)</label>
                <input
                  type="number"
                  value={pesoLlegada}
                  onChange={e => setPesoLlegada(e.target.value)}
                  placeholder="Ej. 850"
                  autoFocus
                  className="w-full mt-1 input"
                  style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                  onKeyDown={e => { if (e.key === 'Enter') confirmarCierre(); }}
                />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                  Cancelar
                </button>
                <button onClick={confirmarCierre} disabled={loading} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>
                  {loading ? 'Cuadrando...' : 'Confirmar cuadre'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
