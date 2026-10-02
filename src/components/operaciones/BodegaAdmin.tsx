import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpFromLine, CheckCircle2, AlertTriangle, Inbox, X, Scale, ShieldAlert,
  ArrowDownFromLine, ArrowUpRight, Search, ChevronDown, ChevronRight, QrCode,
  ClipboardList, Boxes, CalendarClock, PackageX, Layers, RefreshCcw,
} from 'lucide-react';
import { User } from '../../types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import Desperdicios from '../Desperdicios';
import { Spinner, SpinnerConTexto } from '../Spinner';
import { TarjetaKpi } from '../TarjetaKpi';
import { OPCIONES_DIFERENCIA_RECEPCION, ETIQUETA_TIPO_DIFERENCIA, OpcionDiferencia } from '../../lib/opcionesRecepcion';

interface Props {
  currentUser: User;
  inventario: any[];
  movimientos: any[];
  onRefresh: () => void;
  /**
   * Vista activa de Bodega, y cómo cambiarla.
   *
   * La Fase 7 movió la fila de estas dos vistas al shell, junto a la de los cinco
   * grupos del hub. La fila vive donde está `subTab` para que el breadcrumb y la
   * navegación coincidan con lo que se ve; con la vista en un `useState` interno,
   * un enlace a `/operaciones/control` abriría siempre Existencias y cambiar de
   * vista no movería el breadcrumb.
   */
  vista: VistaBodega;
  onVista: (vista: VistaBodega) => void;
}

export type VistaBodega = 'existencias' | 'control';
type HistTab = 'ingresos' | 'salidas';
type PeriodoBodega = 'semana' | 'mes' | 'ano' | 'custom';

type EstadoCodigo = 'validando' | 'pendiente' | 'yaIngresada' | 'noExiste';
type CodigoEscaneado = { codigo: string; estado: EstadoCodigo; producto?: string; estadoEtiqueta?: string };

const CHIP_CODIGO: Record<EstadoCodigo, string> = {
  validando: 'bg-neutral-50 border-neutral-200 text-neutral-500',
  pendiente: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  yaIngresada: 'bg-amber-50 border-amber-200 text-amber-700',
  noExiste: 'bg-red-50 border-red-200 text-red-700',
};

const ESTADO_BODEGA: Record<string, { label: string; chip: string; dot: string }> = {
  vencido: { label: 'Vencido', chip: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500' },
  pronto: { label: 'Por vencer', chip: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  ok: { label: 'Disponible', chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  'sin-fecha': { label: 'Sin fecha', chip: 'bg-neutral-100 text-neutral-600 border-neutral-200', dot: 'bg-neutral-400' },
};

function formatFecha(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatFechaHora(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function formatFechaCorta(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit' });
}
function dentroDeRango(fecha: string | undefined, desde: string, hasta: string): boolean {
  if (!fecha) return true;
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t)) return true;
  if (desde && new Date(desde).getTime() > t) return false;
  if (hasta && new Date(hasta).getTime() < t) return false;
  return true;
}
function MovimientosChart({ puntos, tooltip, onHover, onLeave }: {
  puntos: { label: string; entradas: number; salidas: number }[];
  tooltip: { x: number; y: number; label: string; entradas: number; salidas: number } | null;
  onHover: (v: { x: number; y: number; label: string; entradas: number; salidas: number }) => void;
  onLeave: () => void;
}) {
  const W = 720, H = 150, P = 12;
  const maxV = Math.max(1, ...puntos.map(p => Math.max(p.entradas, p.salidas)));
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, puntos.length - 1);
  const y = (v: number) => H - P - (v / maxV) * (H - 2 * P);
  const paso = Math.max(1, Math.ceil(puntos.length / 7));
  const path = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }} onMouseLeave={onLeave}>
        {[0, 1, 2].map(g => (
          <line key={g} x1={P} x2={W - P} y1={y((maxV / 2) * g)} y2={y((maxV / 2) * g)} stroke="#eef1f4" strokeWidth={1} />
        ))}
        <path d={path(puntos.map(p => p.entradas))} fill="none" stroke="#059669" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <path d={path(puntos.map(p => p.salidas))} fill="none" stroke="#ea580c" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
        {puntos.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            <circle cx={x(i)} cy={y(p.entradas)} r={3.5} fill="#059669" stroke="#fff" strokeWidth={1.5} />
            <circle cx={x(i)} cy={y(p.salidas)} r={3.5} fill="#ea580c" stroke="#fff" strokeWidth={1.5} />
            <rect
              x={x(i) - (W - 2 * P) / Math.max(1, puntos.length - 1) / 2} y={0}
              width={(W - 2 * P) / Math.max(1, puntos.length - 1)} height={H}
              fill="transparent"
              onMouseEnter={() => onHover({ x: x(i) / W, y: Math.max(p.entradas, p.salidas) / maxV, label: p.label, entradas: p.entradas, salidas: p.salidas })}
            />
          </g>
        ))}
      </svg>
      {puntos.map((p, i) => (
        <span key={`${p.label}-x`} className={cn('absolute top-full mt-0.5 text-[10px] text-neutral-400', i % paso === 0 || i === puntos.length - 1 ? '' : 'hidden')}
          style={{ left: `calc(${(x(i) / W) * 100}% - ${i % paso === 0 ? 8 : 0}px)` }}>{p.label}</span>
      ))}
      {tooltip && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 bg-neutral-900 text-white text-[11px] rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap"
          style={{ left: `${tooltip.x * 100}%`, top: 0 }}>
          <p className="font-bold">{tooltip.label}</p>
          <p className="text-emerald-300">entran {tooltip.entradas}</p>
          <p className="text-orange-300">salen {tooltip.salidas}</p>
        </div>
      )}
    </div>
  );
}

function ChipEstado({ estado }: { estado: string }) {
  const e = ESTADO_BODEGA[estado] || ESTADO_BODEGA['sin-fecha'];
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border', e.chip)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', e.dot)} /> {e.label}
    </span>
  );
}
export default function BodegaAdmin({ currentUser, inventario, movimientos, onRefresh, vista, onVista }: Props) {
  const [stock, setStock] = useState<any>(null);
  const [cargandoStock, setCargandoStock] = useState(true);
  const [errorStock, setErrorStock] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<string[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [resumenAbierto, setResumenAbierto] = useState(true);

  // Wizard de recepción (ventana modal) — estado
  const [wizardGrupo, setWizardGrupo] = useState<any>(null);       // agrupación por camión
  const [wizardPaso, setWizardPaso] = useState<1 | 2>(1);
  const [cantidadesWizard, setCantidadesWizard] = useState<Record<string, number>>({});
  const [motivosWizard, setMotivosWizard] = useState<Record<string, string>>({});
  const [enviandoWizard, setEnviandoWizard] = useState(false);

  // Ingreso manual (excepción: producto sin traslado)
  const [ingresoManualAbierto, setIngresoManualAbierto] = useState(false);
  const [manualProducto, setManualProducto] = useState('');
  const [manualCantidad, setManualCantidad] = useState('');
  const [manualProcedencia, setManualProcedencia] = useState('Granja (sin traslado)');
  const [manualObservacion, setManualObservacion] = useState('');
  const [enviandoManual, setEnviandoManual] = useState(false);

  // Recepción por escaneo (vive solo dentro del wizard)
  const [codigoInput, setCodigoInput] = useState('');
  const [codigos, setCodigos] = useState<CodigoEscaneado[]>([]);
  const [etiquetasGeneradas, setEtiquetasGeneradas] = useState<any[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  const codigosRef = useRef<Set<string>>(new Set());

  // Trazabilidad
  const [trazCodigo, setTrazCodigo] = useState('');
  const [traz, setTraz] = useState<any>(null);
  const [buscandoTraz, setBuscandoTraz] = useState(false);

  // Cuadre / historial
  const [histTab, setHistTab] = useState<HistTab>('ingresos');
  const [guiasTablero, setGuiasTablero] = useState<any[]>([]);
  const [alertaRobos, setAlertaRobos] = useState<any[]>([]);
  const [cargandoTablero, setCargandoTablero] = useState(true);

  // Control unificado · movimientos
  const [periodo, setPeriodo] = useState<PeriodoBodega>('semana');
  const [desdeCustom, setDesdeCustom] = useState('');
  const [hastaCustom, setHastaCustom] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [densidadCompacta, setDensidadCompacta] = useState(false);
  const [expandMov, setExpandMov] = useState<string[]>([]);
  const [ttInfo, setTtInfo] = useState<{ x: number; y: number; label: string; entradas: number; salidas: number } | null>(null);

  const cargarStock = useCallback(async () => {
    setCargandoStock(true);
    setErrorStock(null);
    try {
      const res = await fetch('/api/bodega/stock');
      if (res.ok) setStock(await res.json());
      else setErrorStock(`Error al cargar existencias (${res.status}). Reintentá la conexión.`);
    } catch {
      setErrorStock('No se pudieron cargar las existencias. Revisá la conexión con el servidor.');
    }
    finally { setCargandoStock(false); }
  }, []);

  const cargarPendientes = useCallback(async () => {
    try {
      const res = await fetch('/api/etiquetas');
      if (res.ok) {
        const all = await res.json();
        setEtiquetasGeneradas((Array.isArray(all) ? all : []).filter((e: any) => e.estado === 'Generada'));
      }
    } catch { /* sin pendientes */ }
  }, []);

  useEffect(() => { cargarStock(); }, [cargarStock]);
  useEffect(() => { cargarPendientes(); }, [cargarPendientes]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/logistica/tablero');
        if (res.ok) {
          const data = await res.json();
          setGuiasTablero(Array.isArray(data.guias) ? data.guias : []);
        }
      } catch { /* sin alertas de custodia */ }
      finally { setCargandoTablero(false); }
    })();
    (async () => {
      try {
        const res = await fetch('/api/operaciones/recepciones');
        if (res.ok) {
          const recepciones = await res.json();
          setAlertaRobos((recepciones || []).filter((r: any) => r.esPosibleRobo));
        }
      } catch { /* sin alertas de robo */ }
    })();
  }, []);

  // ===== Cuadre (custodia + bodega) =====
  const bodegaItems = inventario.filter(i => i.ubicacion === 'Bodega Central');
  const traslados = movimientos.filter(m => m.tipo === 'Traslado');
  const ingresosBodega = movimientos.filter(m => m.destino === 'Bodega Central').sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  const salidasBodega = movimientos.filter(m => m.origen === 'Bodega Central').sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  // Traslados pendientes (en tránsito/pendiente) hacia Bodega Central, agrupados por camión
  const gruposTraslados = useMemo(() => {
    const pend = traslados.filter(m =>
      m.destino === 'Bodega Central' &&
      (!m.estado || m.estado === 'EnTransito' || m.estado === 'Pendiente')
    ).sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
    const byCamion = new Map<string, any[]>();
    for (const m of pend) {
      const key = m.camionId || m.camionNombre || m.vehiculo || encodeURIComponent(m.referencia_id || m.id);
      if (!byCamion.has(key)) byCamion.set(key, []);
      byCamion.get(key)!.push(m);
    }
    return Array.from(byCamion.values()).map(movs => ({
      key: movs.map(m => m.referencia_id || m.id).join('|'),
      camionNombre: movs[0].camionNombre || movs[0].vehiculo || 'Camión',
      origen: movs[0].granjaOrigenNombre || (movs[0].origen === 'Granja' ? 'Granja' : movs[0].origen) || 'Granja',
      reportadoPorNombre: movs[0].reportadoPorNombre,
      fecha: movs[0].fecha,
      movs,
      totalCartones: movs.reduce((a, m) => a + (Number(m.cantidad) || 0), 0),
      producto: movs.length === 1 ? movs[0].producto : `${movs.length} productos`,
    }));
  }, [traslados]);

  const productosCuadre = Array.from(new Set([...bodegaItems.map(i => i.producto), ...ingresosBodega.map(m => m.producto), ...salidasBodega.map(m => m.producto)].filter(Boolean)));
  const cuadre = productosCuadre.map(producto => {
    const st = bodegaItems.filter(i => i.producto === producto).reduce((a, i) => a + Number(i.cantidad), 0);
    const entradas = ingresosBodega.filter(m => m.producto === producto).reduce((a, m) => a + Number(m.cantidad), 0);
    const salidas = salidasBodega.filter(m => m.producto === producto).reduce((a, m) => a + Number(m.cantidad), 0);
    return { producto, stock: st, entradas, salidas, sobrante: entradas - salidas - st };
  });
  const alertasBodega = cuadre.filter(c => c.salidas > c.entradas + c.stock);

  const guiasActivas = guiasTablero.filter(g => g.estado !== 'Cerrada' && g.estado !== 'Anulada');
  const alertasCustodia = guiasActivas.map(g => {
    const cargado = Number(g.totalCargado) || 0;
    const vendidos = Number(g.cartonesVendidos) || 0;
    const retornados = Number(g.cartonesRetornados) || 0;
    const restante = Number(g.restanteCamion) || 0;
    return { ...g, cargado, vendidos, retornados, restante, descuadre: cargado - vendidos - retornados - restante };
  }).filter(g => g.descuadre !== 0);

  const totalAlertas = alertasBodega.length + alertasCustodia.length + alertaRobos.length;

  // ===== Control · período y rangos de fecha =====
  const aplicarPeriodo = (p: PeriodoBodega) => {
    setPeriodo(p);
    const hoy = new Date();
    let desde = '';
    let hasta = hoy.toISOString().slice(0, 10);
    if (p === 'semana') {
      const d = new Date(hoy); d.setDate(d.getDate() - 6); desde = d.toISOString().slice(0, 10);
    } else if (p === 'mes') {
      const d = new Date(hoy); d.setMonth(d.getMonth() - 1); desde = d.toISOString().slice(0, 10);
    } else if (p === 'ano') {
      const d = new Date(hoy); d.setFullYear(d.getFullYear() - 1); desde = d.toISOString().slice(0, 10);
    }
    setFechaDesde(desde); setFechaHasta(hasta);
  };
  useEffect(() => { aplicarPeriodo('semana'); }, []);

  const aplicarCustom = () => {
    if (!desdeCustom || !hastaCustom) return;
    if (desdeCustom > hastaCustom) { toast.error('La fecha inicial no puede ser posterior a la final'); return; }
    setFechaDesde(desdeCustom); setFechaHasta(hastaCustom);
  };

  const etiquetaPeriodo = {
    semana: '7 días', mes: 'Último mes', ano: 'Último año',
    custom: `${formatFechaCorta(fechaDesde)} → ${formatFechaCorta(fechaHasta)}`,
  }[periodo];

  const movimientosFiltrados = useMemo(() => {
    const filtrados = movimientos.filter(m => dentroDeRango(m.fecha, fechaDesde, fechaHasta));
    return {
      ingresos: filtrados.filter(m => m.destino === 'Bodega Central').sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()),
      salidas: filtrados.filter(m => m.origen === 'Bodega Central').sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()),
    };
  }, [movimientos, fechaDesde, fechaHasta]);

  // Datos del gráfico time-series (agrupados por día del período)
  const graficoSeries = useMemo(() => {
    const puntos: { label: string; entradas: number; salidas: number }[] = [];
    const acum = new Map<string, { entradas: number; salidas: number }>();
    movimientosFiltrados.ingresos.forEach(m => {
      const clave = formatFechaCorta(m.fecha);
      const cur = acum.get(clave) || { entradas: 0, salidas: 0 }; cur.entradas += Number(m.cantidad) || 0; acum.set(clave, cur);
    });
    movimientosFiltrados.salidas.forEach(m => {
      const clave = formatFechaCorta(m.fecha);
      const cur = acum.get(clave) || { entradas: 0, salidas: 0 }; cur.salidas += Number(m.cantidad) || 0; acum.set(clave, cur);
    });
    Array.from(acum.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([label, v]) => puntos.push({ label, ...v }));
    if (puntos.length === 0) {
      const hoy = new Date();
      for (let i = 6; i >= 0; i--) { const d = new Date(hoy); d.setDate(d.getDate() - i); puntos.push({ label: formatFechaCorta(d.toISOString()), entradas: 0, salidas: 0 }); }
    }
    return puntos;
  }, [movimientosFiltrados]);

  const sumasSeries = useMemo(() => ({
    entradas: graficoSeries.reduce((a, p) => a + p.entradas, 0),
    salidas: graficoSeries.reduce((a, p) => a + p.salidas, 0),
  }), [graficoSeries]);

  const toggleMov = (id: string) =>
    setExpandMov(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]);

  // ===== Stock / FEFO =====
  const kpis = stock?.kpis || {};
  const productos: any[] = stock?.productos || [];
  const colaFEFO: any[] = stock?.colaFEFO || [];
  const productosFiltrados = useMemo(
    () => productos.filter(p => !busqueda.trim() || String(p.producto).toLowerCase().includes(busqueda.toLowerCase())),
    [productos, busqueda],
  );
  const lotesPorProducto = useMemo(() => {
    const m: Record<string, any[]> = {};
    colaFEFO.forEach((l: any) => { (m[l.productoKey] ||= []).push(l); });
    return m;
  }, [colaFEFO]);

  const etiquetadosUnidades = useMemo(
    () => colaFEFO.filter((l: any) => l.tipo === 'etiqueta').reduce((a, l) => a + (Number(l.unidades) || 0), 0),
    [colaFEFO],
  );
  const tieneVencidos = (kpis.vencidos || 0) > 0;
  const tienePorVencer = (kpis.porVencer || 0) > 0;
  const porVencerTone = tieneVencidos ? 'bg-red-100 text-red-600' : tienePorVencer ? 'bg-amber-100 text-amber-600' : 'bg-orange-100 text-orange-600';

  const toggleExpandido = (key: string) =>
    setExpandidos(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  // Autosugerencia de trazabilidad (códigos de etiqueta reales)
  const sugerenciasTraz = useMemo(() => {
    const q = trazCodigo.trim().toLowerCase();
    if (!q) return [];
    const fuentes = [...colaFEFO.map((l: any) => l.codigoUnico), ...etiquetasGeneradas.map((e: any) => e.codigo)].filter(Boolean) as string[];
    return Array.from(new Set(fuentes)).filter(c => c.toLowerCase().includes(q)).slice(0, 5);
  }, [trazCodigo, colaFEFO, etiquetasGeneradas]);

  // ===== Acciones =====
  const abrirWizard = (grupo: any) => {
    const inicial: Record<string, number> = {};
    (grupo.movs || []).forEach((m: any) => { inicial[m.id] = Number(m.cantidad); });
    setCantidadesWizard(inicial);
    setMotivosWizard({});
    setCodigos([]); codigosRef.current.clear(); setCodigoInput('');
    setWizardPaso(1);
    setWizardGrupo(grupo);
  };

  const ejecutarRecepcion = async (mov: any, recibido: number, motivo: string, etiquetasCodigos: string[] = []) => {
    const res = await fetch('/api/operaciones/recepcion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trasladoId: mov.referencia_id, cantidadEsperada: mov.cantidad, cantidadRecibida: recibido, motivoDiferencia: motivo, producto: mov.producto, etiquetasCodigos })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al validar recepción'); }
    return res.json();
  };

  const finalizarWizard = async (sinEscanear = false) => {
    if (!wizardGrupo) return;
    const etiquetasPorProducto: Record<string, string[]> = {};
    if (!sinEscanear) {
      codigos.forEach(c => {
        if (c.estado === 'pendiente' && c.producto) (etiquetasPorProducto[c.producto] ||= []).push(c.codigo);
      });
    }
    setEnviandoWizard(true);
    try {
      for (const mov of wizardGrupo.movs) {
        const recibido = Number(cantidadesWizard[mov.id] ?? mov.cantidad);
        const motivo = (motivosWizard[mov.id] || '').trim();
        if (recibido !== Number(mov.cantidad) && !motivo) throw new Error(`Indicá el motivo de diferencia para ${mov.producto}`);
        await ejecutarRecepcion(mov, recibido, motivo, etiquetasPorProducto[mov.producto] || []);
      }
      toast.success(`Recepción validada · ${wizardGrupo.camionNombre || 'camión'}`);
      setWizardGrupo(null); setWizardPaso(1); setCantidadesWizard({}); setMotivosWizard({});
      setCodigos([]); codigosRef.current.clear(); setCodigoInput('');
      await cargarStock(); await cargarPendientes(); onRefresh();
    } catch (e: any) {
      console.error('Error en wizard recepción:', e);
      toast.error(e.message || 'Error al validar la recepción. Procesá los movimientos uno a uno.');
      const movsPendientes = wizardGrupo.movs.filter((m: any) => !(cantidadesWizard[m.id] !== undefined));
      if (movsPendientes.length === 0) movsPendientes.push(...wizardGrupo.movs);
    }
    finally { setEnviandoWizard(false); }
  };

  const registrarIngresoManual = async () => {
    if (!manualProducto) { toast.error('Seleccioná el producto a ingresar'); return; }
    const cant = Number(manualCantidad);
    if (!Number.isFinite(cant) || cant <= 0) { toast.error('La cantidad debe ser mayor a 0'); return; }
    if (!manualObservacion.trim()) { toast.error('La observación es obligatoria para el ingreso manual (auditoría)'); return; }
    setEnviandoManual(true);
    try {
      const res = await fetch('/api/bodega/ingreso-manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser?.id || '' },
        body: JSON.stringify({ producto: manualProducto, cantidad: cant, unidad: 'cartones', procedencia: manualProcedencia, observaciones: manualObservacion.trim(), usuarioId: currentUser?.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al registrar ingreso manual');
      toast.success(`Ingreso manual registrado · +${cant} ${manualProducto}`);
      setIngresoManualAbierto(false);
      setManualProducto(''); setManualCantidad(''); setManualProcedencia('Granja (sin traslado)'); setManualObservacion('');
      await cargarStock(); onRefresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setEnviandoManual(false); }
  };

  const agregarCodigo = async (raw?: string) => {
    const cod = (raw ?? codigoInput).trim();
    if (!cod) return;
    if (codigosRef.current.has(cod)) { toast.info('Ese código ya está en la lista'); setCodigoInput(''); return; }
    codigosRef.current.add(cod);
    setCodigoInput('');
    setCodigos(prev => [...prev, { codigo: cod, estado: 'validando' }]);
    scanRef.current?.focus();
    try {
      const res = await fetch(`/api/etiquetas/trazabilidad/${encodeURIComponent(cod)}`);
      if (res.ok) {
        const d = await res.json();
        const est = d.etiqueta?.estado;
        const valido = est === 'Generada';
        setCodigos(prev => prev.map(c => c.codigo === cod
          ? { codigo: cod, estado: valido ? 'pendiente' : 'yaIngresada', producto: d.etiqueta?.producto, estadoEtiqueta: est }
          : c));
        if (valido) toast.success(`Cartón ${d.etiqueta?.producto || ''} listo para ingresar`);
        else toast.warning(`La etiqueta ya está en estado "${est}"`);
      } else {
        setCodigos(prev => prev.map(c => c.codigo === cod ? { codigo: cod, estado: 'noExiste' } : c));
        toast.error('Código no encontrado');
      }
    } catch {
      setCodigos(prev => prev.map(c => c.codigo === cod ? { codigo: cod, estado: 'noExiste' } : c));
      toast.error('No se pudo validar el código');
    }
  };

  const quitarCodigo = (cod: string) => { codigosRef.current.delete(cod); setCodigos(prev => prev.filter(c => c.codigo !== cod)); };

  const buscarTraz = async (codigoOverride?: string) => {
    const cod = (codigoOverride ?? trazCodigo).trim();
    if (!cod) return;
    setBuscandoTraz(true);
    try {
      const res = await fetch(`/api/etiquetas/trazabilidad/${encodeURIComponent(cod)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Etiqueta no encontrada');
      setTraz(data);
    } catch (e: any) { toast.error(e.message); setTraz(null); }
    finally { setBuscandoTraz(false); }
  };
  const buscarConSugerencia = (s: string) => { setTrazCodigo(s); void buscarTraz(s); };

  return (
    <div className="space-y-6 animate-in fade-in">

      {/* ===== RESUMEN INTELIGENTE ===== */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 p-4">
          <TarjetaKpi variante="fila" icono={Boxes} etiqueta="Stock total" valor={kpis.stockTotal ?? '—'} unidad="cartones" ayuda="entradas − salidas (bodega)" tonoIcono="bg-blue-100 text-blue-600" />
          <TarjetaKpi variante="fila" icono={Layers} etiqueta="Etiquetados" valor={kpis.etiquetas ?? '—'} unidad="cartones" ayuda={etiquetadosUnidades > 0 ? `${etiquetadosUnidades} huevos` : '1 etiqueta = 1 cartón'} tonoIcono="bg-indigo-100 text-indigo-600" />
          <TarjetaKpi variante="fila" icono={PackageX} etiqueta="Por etiquetar" valor={kpis.porEtiquetar ?? '—'} unidad="cartones" ayuda="sin etiqueta individual" tonoIcono="bg-amber-100 text-amber-600" />
          <TarjetaKpi variante="fila" icono={CalendarClock} etiqueta="Por vencer" valor={kpis.porVencer ?? '—'} unidad="cartones" ayuda={tieneVencidos ? 'hay vencidos' : tienePorVencer ? 'dentro del aviso' : 'sin riesgo'} tonoIcono={porVencerTone} />
          <TarjetaKpi variante="fila" icono={ClipboardList} etiqueta="Tipos de producto" valor={productos.length ?? '—'} unidad="tipos" ayuda="configurables en Admin → Productos" tonoIcono="bg-teal-100 text-teal-600" />
        </div>

        {((kpis.vencidos || 0) > 0 || (kpis.porVencer || 0) > 0 || kpis.proximoSalir) && (
          <div className={cn('border-t px-4 py-2.5 flex items-center gap-3', tieneVencidos ? 'bg-red-50 border-red-200' : tienePorVencer ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200')}>
            <button onClick={() => setResumenAbierto(!resumenAbierto)} className="shrink-0 text-neutral-400 hover:text-neutral-600" title={resumenAbierto ? 'Ocultar detalle' : 'Mostrar detalle'}>
              <ChevronDown className={cn('w-4 h-4 transition-transform', resumenAbierto && 'rotate-180')} />
            </button>
            {resumenAbierto && (
              <>
                <div className="flex-1 min-w-0">
                  {tieneVencidos && (
                    <p className="text-sm text-neutral-700">
                      <strong className="text-red-700">{kpis.vencidos}</strong> cartones vencidos · registralos en Desperdicios (categoría Vencido).
                    </p>
                  )}
                  {!tieneVencidos && tienePorVencer && (
                    <p className="text-sm text-neutral-700">
                      <strong className="text-amber-700">{kpis.porVencer}</strong> cartones vencen dentro del aviso configurado.
                    </p>
                  )}
                  {!tieneVencidos && !tienePorVencer && kpis.proximoSalir && (
                    <p className="text-sm text-neutral-700">
                      Próximo a salir (FEFO): <strong className="text-neutral-800">{kpis.proximoSalir.cantidad} cartón(es)</strong>
                      {kpis.proximoSalir.producto && <> de <strong className="text-neutral-800">{kpis.proximoSalir.producto}</strong></>}
                      {kpis.proximoSalir.lote && <> · lote <strong className="text-neutral-800">{kpis.proximoSalir.lote}</strong></>}
                      {kpis.proximoSalir.dias !== null && kpis.proximoSalir.dias !== undefined && <> · vence en <strong className={kpis.proximoSalir.dias < 0 ? 'text-red-700' : 'text-amber-700'}>{kpis.proximoSalir.dias}d</strong></>}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {tieneVencidos && (
                    <button onClick={() => onVista('control')} className="text-sm font-bold text-red-700 hover:text-red-900 whitespace-nowrap">Registrar en Desperdicios →</button>
                  )}
                  <button onClick={() => onVista('existencias')} className="text-sm font-bold text-blue-600 hover:text-blue-800 whitespace-nowrap">Ver lotes FEFO →</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ===== EXISTENCIAS: RECIBIR + EXISTENCIAS (unificadas) ===== */}
      {vista === 'existencias' && (
        <div className="grid gap-4 lg:grid-cols-[400px_1fr] lg:items-start">
{/* Columna EXISTENCIAS */}
          <div className="space-y-4 order-2 lg:order-none lg:col-start-2 lg:row-start-1">
            <div className="flex items-center gap-2">
              <Boxes className="w-4 h-4 text-neutral-400" />
              <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Existencias por producto</h3>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-neutral-800">Existencias por producto</h3>
              <p className="text-xs text-neutral-500">Un cartón = una etiqueta. Expandí para ver los lotes y su orden FEFO.</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar producto…"
                className="w-full pl-9 pr-3 py-2 border border-neutral-300 rounded-lg text-sm bg-white outline-none focus:ring-1 focus:ring-green-500" />
            </div>
          </div>

          {cargandoStock ? (
            <div className="bg-white rounded-2xl border border-neutral-200 p-12 flex items-center justify-center text-neutral-400"><Spinner /></div>
          ) : errorStock ? (
            <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-12 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4 text-red-400"><AlertTriangle className="w-8 h-8" /></div>
              <h4 className="text-lg font-bold text-neutral-700 mb-1">No se pudieron cargar las existencias</h4>
              <p className="text-neutral-500 mb-5">{errorStock}</p>
              <button onClick={() => void cargarStock()}
                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                <RefreshCcw className="w-4 h-4" /> Reintentar
              </button>
            </div>
          ) : productosFiltrados.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-12 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mb-4 text-neutral-400"><Inbox className="w-8 h-8" /></div>
              <h4 className="text-lg font-bold text-neutral-700 mb-1">Sin existencias</h4>
              <p className="text-neutral-500 mb-5">No hay stock disponible en bodega. Recepcioná un traslado en camino o registrá un ingreso manual.</p>
              <button onClick={() => { if (gruposTraslados.length > 0) abrirWizard(gruposTraslados[0]); else setIngresoManualAbierto(true); }}
                className="flex items-center gap-1.5 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors" style={{ background: 'var(--brand-primary)' }}>
                <ArrowUpFromLine className="w-4 h-4" /> {gruposTraslados.length > 0 ? 'Recepcionar traslado' : 'Ingreso manual'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {productosFiltrados.map(p => {
                const abierto = expandidos.includes(p.key);
                const lotes = lotesPorProducto[p.key] || [];
                return (
                  <div key={p.key} className={cn('bg-white rounded-2xl border shadow-sm overflow-hidden',
                    p.estado === 'vencido' ? 'border-red-300' : p.estado === 'pronto' ? 'border-amber-300' : 'border-neutral-200')}>
                    <button onClick={() => toggleExpandido(p.key)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-neutral-50/70">
                      {abierto ? <ChevronDown className="w-4 h-4 text-neutral-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-neutral-800 truncate">{p.producto}</p>
                        <p className="text-xs text-neutral-500">
                          {lotes.length > 0 ? `${lotes.length} lote${lotes.length === 1 ? '' : 's'}` : 'stock agregado (sin etiqueta)'}
                          {p.agregado > 0 && p.etiquetados > 0 && ` · ${p.etiquetados} etiquetados + ${p.agregado} agregados`}
                        </p>
                      </div>
                      <div className="hidden sm:flex flex-col items-end mr-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Próximo vencimiento</span>
                        <span className="text-xs font-bold text-neutral-600">{p.fechaVencimientoProxima ? `${formatFecha(p.fechaVencimientoProxima)}${p.diasProximo !== null ? ` · ${p.diasProximo}d` : ''}` : '—'}</span>
                      </div>
                      <div className="text-right mr-2">
                        <p className="text-2xl font-black text-neutral-800 leading-none">{p.total}</p>
                        <p className="text-[10px] text-neutral-400 font-medium">{p.unidad}</p>
                      </div>
                      <ChipEstado estado={p.estado} />
                    </button>
                    {abierto && (
                      <div className="border-t border-neutral-100 bg-neutral-50/40">
                        {lotes.length === 0 ? (
                          <p className="px-6 py-4 text-sm text-neutral-400">Stock agregado sin etiquetas. Recepcioná por escaneo para trazarlo por cartón.</p>
                        ) : lotes.map((l: any) => (
                          <div key={l.id} className="px-6 py-3 border-b border-neutral-100 last:border-0 flex flex-wrap items-center gap-x-6 gap-y-1">
                            <div className="flex items-center gap-2 min-w-[190px]">
                              {l.ordenFEFO === 1 && <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black px-1.5 py-0.5 rounded">1º A SALIR</span>}
                              <span className="font-mono text-xs text-neutral-700">{l.codigoUnico || 'agregado'}</span>
                            </div>
                            <div className="text-xs text-neutral-500">Lote: <span className="font-bold text-neutral-700">{l.lote || '—'}</span></div>
                            <div className="text-xs text-neutral-500">Recibido: <span className="font-bold text-neutral-700">{formatFecha(l.fechaRecepcion || l.fechaProduccion)}</span></div>
                            <div className="text-xs text-neutral-500">Vence: <span className={cn('font-bold', l.estado === 'vencido' ? 'text-red-700' : l.estado === 'pronto' ? 'text-amber-700' : 'text-neutral-700')}>{formatFecha(l.fechaVencimiento)}{l.dias !== null ? ` (${l.dias}d)` : ''}</span></div>
                            <div className="text-xs text-neutral-500">Ubicación: <span className="font-bold text-neutral-700">{l.ubicacion}</span></div>
                            <div className="ml-auto flex items-center gap-3">
                              <span className="font-bold text-neutral-800">{l.cantidad} <span className="text-xs font-normal text-neutral-400">{l.unidad}</span></span>
                              <ChipEstado estado={l.estado} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

          {/* Columna RECIBIR */}
          <div className="space-y-6 order-1 lg:order-none lg:col-start-1 lg:row-start-1">
            <div className="flex items-center gap-2">
              <ArrowUpFromLine className="w-4 h-4 text-neutral-400" />
              <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Recibir</h3>
            </div>

            {/* Traslados pendientes — cards en modo lectura (resumen ejecutivo por camión) */}
            <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
              <div className="flex items-center space-x-3 pb-4 border-b border-neutral-100 mb-4">
                <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center"><ArrowUpFromLine className="w-5 h-5" /></div>
                <div className="flex-1">
                  <h3 className="font-bold text-neutral-800">Ingresos pendientes</h3>
                  <p className="text-xs text-neutral-500">Traslados en camino · tocá Recepcionar para procesar</p>
                </div>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                  {gruposTraslados.length} en camino
                </span>
              </div>

              {gruposTraslados.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm text-neutral-500">No hay traslados en camino.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {gruposTraslados.map(grupo => (
                    <div key={grupo.key} className="rounded-xl border border-neutral-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                            <ArrowDownFromLine className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-neutral-800 truncate">{grupo.camionNombre}</h4>
                            <p className="text-xs text-neutral-500">Salió {formatFechaHora(grupo.fecha)}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 uppercase tracking-wider shrink-0">En tránsito</span>
                      </div>

                      <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
                        <span className="font-semibold text-neutral-700">Desde:</span> {grupo.origen.startsWith('Granja') ? grupo.origen : `Granja ${grupo.origen}`}
                        {grupo.reportadoPorNombre && <span className="text-neutral-400">· {grupo.reportadoPorNombre}</span>}
                      </div>

                      <ul className="mt-3 space-y-1.5 border-t border-neutral-100 pt-3">
                        {grupo.movs.map((m: any) => (
                          <li key={m.id} className="flex items-center justify-between text-sm">
                            <span className="text-neutral-700 truncate">{m.producto}</span>
                            <span className="font-bold text-neutral-800 shrink-0">{m.cantidad} {m.unidad || 'uds'}</span>
                          </li>
                        ))}
                      </ul>

                      <button onClick={() => abrirWizard(grupo)}
                        className="mt-3 w-full border border-green-200 bg-white text-green-700 hover:bg-green-50 text-sm font-bold py-2 rounded-lg">
                        Recepcionar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Ingreso manual (producto que no vino de la granja) */}
            <button onClick={() => setIngresoManualAbierto(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1 text-xs text-neutral-400 hover:text-neutral-600 transition-colors">
              <PackageX className="w-3.5 h-3.5" /> ¿Llegó producto sin traslado? Registralo como ingreso manual
            </button>
          </div>
        </div>
      )}

      {/* ===== CONTROL (cuadre + movimientos + trazabilidad) ===== */}
      {vista === 'control' && (
        <div className="space-y-6">
          {/* Zona A · semáforo + alertas */}
          <div className={cn('rounded-2xl border shadow-sm overflow-hidden', totalAlertas > 0 ? 'border-red-200' : 'border-emerald-200')}>
            <div className={cn('px-6 py-4 flex items-center gap-3 border-b flex-wrap', totalAlertas > 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100')}>
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', totalAlertas > 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600')}>
                <Scale className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-neutral-800">Control de Bodega</h3>
                <p className="text-xs text-neutral-500">Todo lo que entra y sale debe cuadrar, inclusive la custodia</p>
              </div>
              {!cargandoTablero && (
                <div className="ml-auto flex items-center gap-4 flex-wrap">
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Stock bodega</p>
                    <p className="text-lg font-bold text-neutral-800 leading-tight">{kpis.stockTotal ?? 0} <span className="text-xs font-medium text-neutral-500">cartones</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">En custodia</p>
                    <p className="text-lg font-bold text-neutral-800 leading-tight">{guiasActivas.reduce((a, g) => a + (Number(g.restanteCamion) || 0), 0)} <span className="text-xs font-medium text-neutral-500">uds</span></p>
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 space-y-3">
              {totalAlertas === 0 ? (
                <div className="flex items-center gap-3 py-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                  <p className="text-sm font-bold text-emerald-700">¡Todo cuadra!</p>
                  <p className="text-sm text-neutral-500">No hay faltantes en bodega ni descuadres en custodia.</p>
                </div>
              ) : (
                <>
                  {alertaRobos.map(r => (
                    <div key={r.id} className="flex items-start gap-3 bg-red-50 border border-red-300 rounded-xl p-4">
                      <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-red-700">Posible robo de huevos</p>
                        <p className="text-sm text-red-600">Recepción del {r.fechaRecepcion ? new Date(r.fechaRecepcion).toLocaleDateString() : ''}: esperado <strong>{r.cantidadEsperada}</strong>, recibido <strong>{r.cantidadRecibida}</strong> (faltan <strong>{r.diferencia}</strong>) — {r.motivoDiferencia || 'faltante sin causa'}. Responsable: {r.responsableRecepcion || '—'}.</p>
                      </div>
                      <button onClick={() => onVista('existencias')} className="shrink-0 text-sm font-bold text-red-700 hover:text-red-900 whitespace-nowrap">Revisar recepción →</button>
                    </div>
                  ))}
                  {alertasBodega.map(a => (
                    <div key={a.producto} className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                      <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-red-700">{a.producto}</p>
                        <p className="text-sm text-red-600"><strong>{a.salidas}</strong> salidas registradas superan lo ingresado (<strong>{a.entradas}</strong>) más lo que hay en bodega (<strong>{a.stock}</strong>). Hay <strong>{a.salidas - a.entradas - a.stock}</strong> unidades sin reportar.</p>
                      </div>
                      <button onClick={() => setHistTab('salidas')} className="shrink-0 text-sm font-bold text-red-700 hover:text-red-900 whitespace-nowrap">Ver movimientos →</button>
                    </div>
                  ))}
                  {alertasCustodia.map(g => (
                    <div key={g.guiaId} className={cn('flex items-start gap-3 border rounded-xl p-4', g.descuadre > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200')}>
                      <ShieldAlert className={cn('w-5 h-5 shrink-0 mt-0.5', g.descuadre > 0 ? 'text-red-600' : 'text-amber-600')} />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-neutral-800">Guía {g.consecutivo} · {g.camionNombre || 'Sin camión'}</p>
                        <p className="text-sm text-neutral-600">
                          {g.descuadre > 0
                            ? <>Faltan <strong className="text-red-700">{g.descuadre}</strong> unidades por devolver a bodega del control de custodia (cargó {g.cargado} · vendió {g.vendidos} · retornó {g.retornados} · quedan {g.restante} en camión).</>
                            : <>Sobran <strong className="text-amber-700">{Math.abs(g.descuadre)}</strong> unidades registradas frente al control de custodia (cargó {g.cargado} · vendió {g.vendidos} · retornó {g.retornados} · quedan {g.restante} en camión).</>}
                        </p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Zona B · movimientos con gráfico time-series */}
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-visible">
            <div className="px-6 pt-4 pb-0">
              <div className="flex flex-wrap items-center gap-2 justify-between border-b border-neutral-100 pb-3">
                <h3 className="font-bold text-neutral-800">Movimientos <span className="font-normal text-neutral-400 text-sm">· {etiquetaPeriodo}</span></h3>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex bg-neutral-100 rounded-lg p-1 text-xs font-bold">
                    {([['semana', 'Semana'], ['mes', 'Mes'], ['ano', 'Año'], ['custom', 'Personalizado']] as [PeriodoBodega, string][]).map(([p, lbl]) => (
                      <button key={p} onClick={() => aplicarPeriodo(p)} className={cn('px-3 py-1.5 rounded-md transition-colors', periodo === p ? 'bg-white text-green-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-700')}>{lbl}</button>
                    ))}
                  </div>
                  {periodo === 'custom' && (
                    <div className="flex items-center gap-1.5">
                      <input type="date" value={desdeCustom} onChange={e => setDesdeCustom(e.target.value)} className="border border-neutral-300 rounded-lg px-2 py-1.5 text-xs" />
                      <span className="text-neutral-400 text-xs">→</span>
                      <input type="date" value={hastaCustom} onChange={e => setHastaCustom(e.target.value)} className="border border-neutral-300 rounded-lg px-2 py-1.5 text-xs" />
                      <button onClick={aplicarCustom} className="bg-neutral-200 hover:bg-neutral-300 rounded-lg px-3 py-1.5 text-xs font-bold">Aplicar</button>
                    </div>
                  )}
                  <div className="flex bg-neutral-100 rounded-lg p-1 text-xs font-bold">
                    <button onClick={() => setHistTab('ingresos')} className={cn('px-3 py-1.5 rounded-md transition-colors flex items-center gap-1', histTab === 'ingresos' ? 'bg-white text-emerald-700 shadow-sm' : 'text-neutral-500')}>
                      <ArrowDownFromLine className="w-3.5 h-3.5" /> Ingresos
                    </button>
                    <button onClick={() => setHistTab('salidas')} className={cn('px-3 py-1.5 rounded-md transition-colors flex items-center gap-1', histTab === 'salidas' ? 'bg-white text-orange-700 shadow-sm' : 'text-neutral-500')}>
                      <ArrowUpRight className="w-3.5 h-3.5" /> Salidas
                    </button>
                  </div>
                  <button onClick={() => setDensidadCompacta(!densidadCompacta)} className={cn('text-[11px] font-bold px-2.5 py-1.5 rounded-lg border', densidadCompacta ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-neutral-500 border-neutral-200')} title="Alternar densidad de filas">
                    Fila {densidadCompacta ? '40px' : '48px'}
                  </button>
                </div>
              </div>

              {/* Gráfico time-series */}
              <div className="py-4">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Flujo por período (cartones)</p>
                  <div className="flex items-center gap-3 text-xs font-bold">
                    <span className="flex items-center gap-1.5 text-emerald-700"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" /> entran +{sumasSeries.entradas}</span>
                    <span className="flex items-center gap-1.5 text-orange-700"><span className="w-2.5 h-2.5 rounded-full bg-orange-600 inline-block" /> salen −{sumasSeries.salidas}</span>
                  </div>
                </div>
                {graficoSeries.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-sm text-neutral-400">Sin datos en el período seleccionado.</div>
                ) : (
                  <MovimientosChart
                    puntos={graficoSeries}
                    tooltip={ttInfo}
                    onHover={setTtInfo}
                    onLeave={() => setTtInfo(null)}
                  />
                )}
              </div>
            </div>

            {/* Tabla de movimientos */}
            <div className="overflow-x-auto border-t border-neutral-100">
              <table className={cn('w-full text-left text-sm whitespace-nowrap', densidadCompacta ? 'text-xs' : 'text-sm')}>
                <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-bold text-xs border-b border-neutral-200">
                  <tr>
                    <th className="px-6 py-3"></th><th className="px-6 py-3">Fecha</th><th className="px-6 py-3">Tipo</th><th className="px-6 py-3">Origen</th>
                    <th className="px-6 py-3">Destino</th><th className="px-6 py-3">Producto</th><th className="px-6 py-3 text-right">Cantidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(histTab === 'ingresos' ? movimientosFiltrados.ingresos : movimientosFiltrados.salidas).map(mov => {
                    const abiertoMov = expandMov.includes(mov.id);
                    return (
                      <React.Fragment key={mov.id}>
                        <tr className={cn('hover:bg-neutral-50/50 transition-colors', abiertoMov ? 'bg-neutral-50/60' : '')}>
                          <td className="px-6 py-3">
                            <button onClick={() => toggleMov(mov.id)} className="text-neutral-400 hover:text-neutral-600">
                              {abiertoMov ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-6 py-3 text-neutral-500 text-xs">{formatFechaHora(mov.fecha)}</td>
                          <td className="px-6 py-3">
                            <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold',
                              mov.tipo === 'Recepcion Bodega' || mov.tipo === 'Recepción Bodega' ? 'bg-emerald-100 text-emerald-700'
                              : mov.tipo === 'Retorno Camión' || mov.tipo === 'Retorno Camion' ? 'bg-sky-100 text-sky-700'
                              : mov.tipo === 'Carga Camión' || mov.tipo === 'Carga Camion' ? 'bg-orange-100 text-orange-700'
                              : mov.tipo === 'Traslado' ? 'bg-blue-100 text-blue-700'
                              : 'bg-neutral-100 text-neutral-700')}>{mov.tipo}</span>
                          </td>
                          <td className="px-6 py-3 text-neutral-600">{mov.origen || '-'}</td>
                          <td className="px-6 py-3 text-neutral-600">{mov.destino || '-'}</td>
                          <td className="px-6 py-3 font-bold text-neutral-800">{mov.producto}</td>
                          <td className="px-6 py-3 text-right">
                            <span className={cn('font-bold inline-flex items-center gap-1', histTab === 'ingresos' ? 'text-emerald-700' : 'text-orange-700')}>
                              {histTab === 'ingresos' ? '+' : '−'}{mov.cantidad} <span className="font-normal text-neutral-500 text-xs">{mov.unidad || ''}</span>
                            </span>
                          </td>
                        </tr>
                        {abiertoMov && (
                          <tr className="bg-neutral-50/70">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="text-xs text-neutral-600 space-y-1">
                                <p>Referencia: <span className="font-mono font-bold text-neutral-800">{mov.referencia_id || '—'}</span></p>
                                <p>Unitario: <span className="font-bold text-neutral-800">{mov.cantidad}</span> · {mov.unidad || 'uds'} · <span className="text-neutral-500">{formatFechaHora(mov.fecha)}</span></p>
                                {histTab === 'salidas' && (
                                  <button onClick={() => { setTrazCodigo(''); setTraz(null); }} className="text-blue-600 hover:text-blue-800 font-bold">
                                    Ver línea de custodia →
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {(histTab === 'ingresos' ? movimientosFiltrados.ingresos : movimientosFiltrados.salidas).length === 0 && (
                    <tr><td colSpan={7} className="px-6 py-10 text-center text-neutral-400 text-sm">{histTab === 'ingresos' ? 'No hay ingresos en este período.' : 'No hay salidas en este período.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Zona C · trazabilidad */}
          <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
            <div className="flex items-center space-x-3 pb-4 border-b border-neutral-100 mb-5">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center"><QrCode className="w-5 h-5" /></div>
              <div><h3 className="font-bold text-neutral-800">Trazabilidad por etiqueta</h3><p className="text-xs text-neutral-500">Buscá el código de un cartón para ver su línea de vida</p></div>
            </div>
            <div className="relative mb-5">
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={trazCodigo} onChange={e => setTrazCodigo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarTraz(); } }}
                  placeholder="Escanear / escribir código ETQ-… y Enter" className="flex-1 border border-neutral-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-1 focus:ring-purple-500 outline-none" />
                <button onClick={() => void buscarTraz()} disabled={buscandoTraz} className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                    {buscandoTraz ? <Spinner /> : <Search className="w-4 h-4" />} Buscar
                </button>
              </div>
              {sugerenciasTraz.length > 0 && (
                <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-neutral-200 rounded-xl shadow-lg overflow-hidden">
                  {sugerenciasTraz.map(s => (
                    <button key={s} onClick={() => { setTrazCodigo(s); buscarConSugerencia(s); }} className="w-full text-left px-4 py-2 text-sm font-mono text-neutral-700 hover:bg-purple-50">{s}</button>
                  ))}
                </div>
              )}
            </div>
            {traz ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-3"><p className="text-[10px] font-bold uppercase text-neutral-400">Producto</p><p className="font-bold text-neutral-800 text-sm">{traz.etiqueta?.producto}</p></div>
                  <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-3"><p className="text-[10px] font-bold uppercase text-neutral-400">Estado</p><p className="font-bold text-neutral-800 text-sm">{traz.etiqueta?.estado}</p></div>
                  <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-3"><p className="text-[10px] font-bold uppercase text-neutral-400">Ubicación</p><p className="font-bold text-neutral-800 text-sm">{traz.etiqueta?.ubicacionActual || '—'}</p></div>
                  <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-3"><p className="text-[10px] font-bold uppercase text-neutral-400">Vence</p><p className="font-bold text-neutral-800 text-sm">{formatFecha(traz.etiqueta?.fechaVencimiento)}</p></div>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-neutral-400 mb-2">Línea de custodia</p>
                  {(!traz.traza || traz.traza.length === 0) ? (
                    <p className="text-sm text-neutral-400">Sin eventos registrados.</p>
                  ) : (
                    <ol className="relative border-l-2 border-neutral-200 ml-2 space-y-4">
                      {[...traz.traza].sort((a: any, b: any) => String(a.fecha).localeCompare(String(b.fecha))).map((t: any) => (
                        <li key={t.id} className="ml-4">
                          <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-purple-400 border-2 border-white" />
                          <p className="text-sm font-bold text-neutral-800">{t.tipoEvento} <span className="font-normal text-neutral-400 text-xs">· {formatFechaHora(t.fecha)}</span></p>
                          <p className="text-xs text-neutral-500">{t.ubicacion || ''}{t.documentoRef ? ` · Doc: ${t.documentoRef}` : ''}{t.observaciones ? ` · ${t.observaciones}` : ''}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ) : trazCodigo.trim() === '' ? (
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-8 text-center">
                <QrCode className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
                <p className="text-sm text-neutral-500">Ingresá un código de etiqueta para ver su trazabilidad completa (generación → bodega → camión → cliente).</p>
              </div>
            ) : (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>No encontramos <strong className="font-mono">{trazCodigo}</strong>. Revisá que el código esté completo (formato ETQ-…).</span>
              </div>
            )}
          </div>

          {/* Zona D · desperdicios y merma */}
          <Desperdicios currentUser={currentUser} />
        </div>
      )}

      {/* ===== MODAL WIZARD RECEPCIÓN (ventana nueva con escáner) ===== */}
      {wizardGrupo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-black text-neutral-800 truncate">Recepción · {wizardGrupo.camionNombre}</h3>
                <p className="text-xs text-neutral-500 truncate">{wizardGrupo.origen.startsWith('Granja') ? wizardGrupo.origen : `Granja ${wizardGrupo.origen}`} → Bodega Central · Salió {formatFechaHora(wizardGrupo.fecha)}</p>
              </div>
              <button onClick={() => setWizardGrupo(null)} className="text-neutral-400 hover:text-neutral-600 text-xl leading-none ml-3 shrink-0"><X className="w-5 h-5" /></button>
            </div>

            {/* Steps */}
            <div className="px-5 pt-4 flex items-center gap-2">
              <span className={cn('flex items-center gap-1 text-[10px] font-bold', wizardPaso === 1 ? 'text-neutral-800' : 'text-green-700')}>
                <span className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[9px]', wizardPaso === 2 ? 'bg-green-600 text-white' : wizardPaso === 1 ? 'bg-neutral-800 text-white' : 'bg-green-600 text-white')}>
                  {wizardPaso === 2 ? '✓' : '1'}
                </span> Verificar
              </span>
              <div className={cn('h-px flex-1', wizardPaso === 2 ? 'bg-green-500' : 'bg-neutral-200')}></div>
              <span className={cn('flex items-center gap-1 text-[10px] font-bold', wizardPaso === 2 ? 'text-neutral-800' : 'text-neutral-400')}>
                <span className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[9px]', wizardPaso === 2 ? 'bg-neutral-800 text-white' : 'bg-neutral-300 text-neutral-500')}>2</span> Escanear
              </span>
            </div>

            {wizardPaso === 1 ? (
              <div className="p-5">
                <p className="text-sm text-neutral-500 mb-3">Confirmá los productos y cantidades que trae el camión.</p>
                <div className="space-y-2">
                  {wizardGrupo.movs.map((m: any) => {
                    const recibido = cantidadesWizard[m.id] ?? Number(m.cantidad);
                    const esperado = Number(m.cantidad);
                    const difiere = recibido !== esperado;
                    return (
                      <div key={m.id} className="rounded-lg border border-neutral-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-neutral-800 truncate">{m.producto}</p>
                            <p className="text-xs text-neutral-400">esperado <strong className="text-neutral-600">{esperado}</strong> {m.unidad || 'uds'}</p>
                          </div>
                          <input type="number" value={recibido} min={0}
                            onChange={e => setCantidadesWizard(prev => ({ ...prev, [m.id]: Number(e.target.value) }))}
                            className="w-24 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-right font-bold text-neutral-800 focus:ring-1 focus:ring-green-500" />
                        </div>
                        {difiere ? (
                          <select value={motivosWizard[m.id] || ''} onChange={e => setMotivosWizard(prev => ({ ...prev, [m.id]: e.target.value }))}
                            className={cn('mt-2 w-full border rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-1 focus:ring-green-500', difiere && !motivosWizard[m.id] ? 'border-amber-300' : 'border-neutral-200')}>
                            <option value="">Motivo de la diferencia *</option>
                            {OPCIONES_DIFERENCIA_RECEPCION.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                        ) : (
                          <p className="mt-1.5 text-[11px] font-bold text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Conforme</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setWizardPaso(2)}
                  className="mt-4 w-full bg-green-600 hover:bg-green-700 text-white text-sm font-bold py-2.5 rounded-lg">
                  Siguiente: escanear cartones →
                </button>
              </div>
            ) : (
              <div className="p-5">
                <p className="text-sm text-neutral-500 mb-3">Escaneá cada cartón del camión. Se valida trazabilidad y entra a bodega directo.</p>

                {/* Scan input */}
                <div className="relative mb-3">
                  <input ref={scanRef} id="scan-input" value={codigoInput} onChange={e => setCodigoInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void agregarCodigo(); } }}
                    placeholder="Escanear código ETQ-… y Enter" autoFocus
                    className="w-full pl-4 pr-3 py-3 border-2 border-green-400 rounded-xl text-sm font-mono text-neutral-800 outline-none ring-2 ring-green-100 focus:ring-green-300" />
                </div>

                {codigos.length === 0 ? (
                  <p className="text-xs text-neutral-400 rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2.5 mb-3">
                    Los cartones válidos se marcan <strong>EnBodega</strong> con su producto identificado. También podés confirmar la recepción sin escanear.
                  </p>
                ) : (
                  <div className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
                    {codigos.map(c => (
                      <div key={c.codigo} className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-xs', CHIP_CODIGO[c.estado])}>
                        <span className="font-mono text-neutral-600 truncate">{c.codigo}</span>
                        <span className="flex items-center gap-1 font-bold shrink-0 ml-2">
                          {c.estado === 'validando' && <Spinner tamano="xs" className="w-3 h-3" />}
                          {c.estado === 'pendiente' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                          {c.estado === 'yaIngresada' && <AlertTriangle className="w-3 h-3 text-amber-600" />}
                          {c.estado === 'noExiste' && <X className="w-3 h-3 text-red-600" />}
                          {c.producto ? c.producto : c.estado === 'validando' ? 'validando…' : c.estado === 'pendiente' ? 'válido' : c.estado === 'yaIngresada' ? c.estadoEtiqueta : 'no existe'}
                        </span>
                        <button onClick={() => quitarCodigo(c.codigo)} className="opacity-60 hover:opacity-100 ml-2 text-neutral-400"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Progreso + escaneadas */}
                <div className="flex items-center justify-between text-sm bg-neutral-50 rounded-lg px-3 py-2 mb-4">
                  <span className="text-neutral-500">Cartones escaneados</span>
                  <span className="font-bold text-neutral-800">{codigos.filter(c => c.estado === 'pendiente').length}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => void finalizarWizard(false)} disabled={enviandoWizard}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-bold py-2.5 rounded-lg disabled:opacity-50">
                    {enviandoWizard ? <SpinnerConTexto className="justify-center">Procesando…</SpinnerConTexto> : 'Finalizar recepción'}
                  </button>
                  <button onClick={() => void finalizarWizard(true)} disabled={enviandoWizard}
                    className="border border-neutral-200 text-neutral-600 hover:bg-neutral-50 text-xs font-bold px-3 py-2.5 rounded-lg disabled:opacity-50">
                    Confirmar sin escanear
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== MODAL INGRESO MANUAL (excepción: producto sin traslado) ===== */}
      {ingresoManualAbierto && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-neutral-800">Ingreso manual de producto</h3>
                <p className="text-xs font-medium text-amber-700">Excepción · no hay traslado registrado</p>
              </div>
              <button onClick={() => setIngresoManualAbierto(false)} className="text-neutral-400 hover:text-neutral-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Producto</label>
                <select value={manualProducto} onChange={e => setManualProducto(e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:ring-1 focus:ring-green-500">
                  <option value="">Seleccioná un producto…</option>
                  {productos.length > 0 ? productos.map((p: any) => (
                    <option key={p.key || p.producto} value={p.producto}>{p.producto}</option>
                  )) : (
                    <>
                      <option value="Huevos - Grande">Huevos - Grande</option>
                      <option value="Huevos - Mediano">Huevos - Mediano</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Cantidad (cartones)</label>
                <input type="number" value={manualCantidad} onChange={e => setManualCantidad(e.target.value)} placeholder="Ej.: 12"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm font-bold text-neutral-800 focus:ring-1 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Procedencia</label>
                <div className="flex gap-2">
                  <button onClick={() => setManualProcedencia('Granja (sin traslado)')}
                    className={cn('flex-1 border rounded-lg text-xs font-bold px-2 py-2 transition-colors', manualProcedencia === 'Granja (sin traslado)' ? 'border-green-300 bg-green-50 text-green-700' : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100')}>
                    🧺 Granja (sin traslado)
                  </button>
                  <button onClick={() => setManualProcedencia('Otra fuente')}
                    className={cn('flex-1 border rounded-lg text-xs font-bold px-2 py-2 transition-colors', manualProcedencia === 'Otra fuente' ? 'border-green-300 bg-green-50 text-green-700' : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100')}>
                    🏪 Otra fuente
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Observación <span className="font-normal text-neutral-400">(obligatoria para excepción)</span></label>
                <textarea rows={2} value={manualObservacion} onChange={e => setManualObservacion(e.target.value)}
                  placeholder="Ej.: producto olvidado en el camión, no vino en el manifiesto…"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-green-500 resize-none" />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800">
                Esto crea una excepción de stock visible en alertas y el reporte del día. Requiere observación para auditoría.
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button onClick={() => void registrarIngresoManual()} disabled={enviandoManual}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-bold py-2.5 rounded-lg disabled:opacity-50">
                    {enviandoManual ? <SpinnerConTexto className="justify-center">Registrando…</SpinnerConTexto> : 'Agregar al stock'}
                </button>
                <button onClick={() => setIngresoManualAbierto(false)} disabled={enviandoManual}
                  className="border border-neutral-200 text-neutral-600 text-xs font-bold px-3 py-2.5 rounded-lg disabled:opacity-50">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
