import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpFromLine, CheckCircle2, AlertTriangle, Inbox, X, Scale, ShieldAlert,
  ArrowDownFromLine, ArrowUpRight, Search, ChevronDown, ChevronRight, QrCode,
  Boxes, RefreshCcw, Truck,
  Trash2,
} from 'lucide-react';
import { User } from '../../types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import Desperdicios from '../Desperdicios';
import DespachoAdmin from './DespachoAdmin';
import { Spinner, SpinnerConTexto } from '../Spinner';
import { OPCIONES_DIFERENCIA_RECEPCION, ETIQUETA_TIPO_DIFERENCIA, OpcionDiferencia } from '../../lib/opcionesRecepcion';
import { useTablero } from '../../hooks/useTablero';
import { sessionHeaders } from '../../lib/session';

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

export type VistaBodega = 'existencias' | 'entradas' | 'control' | 'unificada';
type HistTab = 'ingresos' | 'salidas';
type PeriodoBodega = 'semana' | 'mes' | 'ano' | 'custom';
type SeccionControl = 'pendientes' | 'movimientos' | 'trazabilidad';

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
function normalizarBusquedaMovimiento(v: unknown) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}
function fechaLocalISO(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function cantidadesPorUnidad(cantidades?: Record<string, number> | null, valor?: number | null, unidad?: string) {
  if (cantidades && Object.keys(cantidades).length) {
    return Object.entries(cantidades)
      .filter(([, cantidad]) => Number(cantidad) > 0.0001)
      .map(([u, cantidad]) => `${Number(cantidad).toLocaleString('es-CR', { maximumFractionDigits: 2 })} ${u}`)
      .join(' · ') || '0';
  }
  if (unidad === 'unidades mixtas') return 'Ver detalle por producto';
  return `${Number(valor || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })}${unidad ? ` ${unidad}` : ''}`;
}
function totalPorUnidad(cantidades?: Record<string, number> | null, valor?: number | null) {
  return cantidades && Object.keys(cantidades).length
    ? Object.values(cantidades).reduce((total, cantidad) => total + (Number(cantidad) || 0), 0)
    : Number(valor) || 0;
}
function formatoStockPorUnidad(cantidades: Record<string, number>) {
  const filas = Object.entries(cantidades).filter(([, cantidad]) => Number(cantidad) > 0.0001);
  if (!filas.length) return '0 kg';
  return filas.map(([unidad, cantidad]) => {
    const numero = Number(cantidad).toLocaleString('es-CR', { maximumFractionDigits: 2 });
    if (unidad === 'cartones') return `${numero} empaques · kg pendiente`;
    return `${numero} ${unidad}`;
  }).join(' · ');
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
  const [seccionControl, setSeccionControl] = useState<SeccionControl>('pendientes');
  const [mermaAbierta, setMermaAbierta] = useState(false);
  const [pestanaEntradas, setPestanaEntradas] = useState<'camino' | 'recepcion' | 'completados'>('camino');
  const [busquedaEntradas, setBusquedaEntradas] = useState('');
  const [fechaEntradas, setFechaEntradas] = useState('');
  const [borradoresRecepcion, setBorradoresRecepcion] = useState<any[]>([]);
  const [cargandoBorradores, setCargandoBorradores] = useState(false);

  // Wizard de recepción (ventana modal) — estado
  const [wizardGrupo, setWizardGrupo] = useState<any>(null);       // agrupación por camión
  const [wizardPaso, setWizardPaso] = useState<1 | 2>(1);
  const [cantidadesWizard, setCantidadesWizard] = useState<Record<string, number>>({});
  const [motivosWizard, setMotivosWizard] = useState<Record<string, string>>({});
  const [enviandoWizard, setEnviandoWizard] = useState(false);
  const [pesoCorreccionKg, setPesoCorreccionKg] = useState<Record<string, string>>({});
  const [motivoCorreccionKg, setMotivoCorreccionKg] = useState<Record<string, string>>({});
  const [conteoHistoricoKg, setConteoHistoricoKg] = useState<Record<string, string>>({});
  const [motivoConteoHistorico, setMotivoConteoHistorico] = useState<Record<string, string>>({});
  const [conciliandoInventarioId, setConciliandoInventarioId] = useState<string | null>(null);

  // Ingreso manual (excepción: producto sin traslado)
  const [ingresoManualAbierto, setIngresoManualAbierto] = useState(false);
  const [nuevaRemisionAbierta, setNuevaRemisionAbierta] = useState(false);
  const [manualProducto, setManualProducto] = useState('');
  const [manualCantidad, setManualCantidad] = useState('');
  const [manualLote, setManualLote] = useState('');
  const [manualVencimiento, setManualVencimiento] = useState('');
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
  const [resultadosTraz, setResultadosTraz] = useState<any[]>([]);
  const [lotesTraz, setLotesTraz] = useState<any[]>([]);
  const [cargandoLotesTraz, setCargandoLotesTraz] = useState(false);
  const [busquedaTrazHecha, setBusquedaTrazHecha] = useState(false);
  const [buscandoTraz, setBuscandoTraz] = useState(false);
  const lotesTrazInicializados = useRef(false);
  const mostrarExistencias = vista === 'existencias' || vista === 'unificada';
  const mostrarEntradas = vista === 'entradas' || vista === 'unificada';
  const mostrarControl = vista === 'control' || vista === 'unificada';

  // Cuadre / historial
  const [histTab, setHistTab] = useState<HistTab>('ingresos');
  const [busquedaActividad, setBusquedaActividad] = useState('');
  const [desdeActividad, setDesdeActividad] = useState('');
  const [hastaActividad, setHastaActividad] = useState('');
  const [tipoActividad, setTipoActividad] = useState<'todos' | 'entradas' | 'salidas'>('todos');
  // Consolida G4: el tablero vivo comparte hook con TableroRutas, así que las
  // alertas de custodia se refrescan cada 15 s en vez de congelarse al montar.
  const { guias: guiasTablero, loading: cargandoTablero } = useTablero(currentUser.id);
  const [alertasDiferencia, setAlertasDiferencia] = useState<any[]>([]);
  const [retornosPendientes, setRetornosPendientes] = useState<any[]>([]);
  const [procesandoRetorno, setProcesandoRetorno] = useState<string | null>(null);
  const [cantidadRecibidaRetorno, setCantidadRecibidaRetorno] = useState<Record<string, string>>({});
  const [procesandoSobrante, setProcesandoSobrante] = useState<string | null>(null);
  const [conteoSobrante, setConteoSobrante] = useState<Record<string, Record<string, string>>>({});
  const [motivoDiferenciaSobrante, setMotivoDiferenciaSobrante] = useState<Record<string, Record<string, string>>>({});
  const [reconteosPendientes, setReconteosPendientes] = useState<any[]>([]);
  const [inventarioCuarentena, setInventarioCuarentena] = useState<any[]>([]);
  const [etiquetasReempaqueSeleccionadas, setEtiquetasReempaqueSeleccionadas] = useState<Record<string, string[]>>({});
  const [valoresReconteo, setValoresReconteo] = useState<Record<string, Record<string, string>>>({});
  const [procesandoReconteo, setProcesandoReconteo] = useState<string | null>(null);

  // Control unificado · movimientos
  const [periodo, setPeriodo] = useState<PeriodoBodega>('semana');
  const [desdeCustom, setDesdeCustom] = useState('');
  const [hastaCustom, setHastaCustom] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [unidadGrafico, setUnidadGrafico] = useState('');
  const [densidadCompacta, setDensidadCompacta] = useState(false);
  const [expandMov, setExpandMov] = useState<string[]>([]);
  const [ttInfo, setTtInfo] = useState<{ x: number; y: number; label: string; entradas: number; salidas: number } | null>(null);

  const cargarStock = useCallback(async () => {
    setCargandoStock(true);
    setErrorStock(null);
    try {
      const res = await fetch('/api/bodega/stock', { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setStock(await res.json());
      else setErrorStock(`Error al cargar existencias (${res.status}). Reintentá la conexión.`);
    } catch {
      setErrorStock('No se pudieron cargar las existencias. Revisá la conexión con el servidor.');
    }
    finally { setCargandoStock(false); }
  }, []);

  const cargarPendientes = useCallback(async () => {
    try {
      const res = await fetch('/api/etiquetas', { headers: sessionHeaders(currentUser.id) });
      if (res.ok) {
        const all = await res.json();
        setEtiquetasGeneradas((Array.isArray(all) ? all : []).filter((e: any) => e.estado === 'Generada'));
      }
    } catch { /* sin pendientes */ }
  }, []);

  const cargarRetornosPendientes = useCallback(async () => {
    try {
      const res = await fetch('/api/logistica/retornos/pendientes', { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setRetornosPendientes(await res.json());
    } catch { /* se mantiene visible el último resultado */ }
  }, []);

  const cargarReconteos = useCallback(async () => {
    try {
      const [pendientes, cuarentena] = await Promise.all([
        fetch('/api/logistica/bodega/reconteos-pendientes', { headers: sessionHeaders(currentUser.id) }).then(r => r.ok ? r.json() : { items: [] }),
        fetch('/api/logistica/bodega/cuarentena', { headers: sessionHeaders(currentUser.id) }).then(r => r.ok ? r.json() : []),
      ]);
      setReconteosPendientes(Array.isArray(pendientes.items) ? pendientes.items : []);
      setInventarioCuarentena(Array.isArray(cuarentena) ? cuarentena : []);
    } catch { /* se conserva la última lectura */ }
  }, []);

  useEffect(() => { cargarStock(); }, [cargarStock]);
  useEffect(() => { cargarPendientes(); }, [cargarPendientes]);
  useEffect(() => { cargarRetornosPendientes(); }, [cargarRetornosPendientes]);
  useEffect(() => { cargarReconteos(); }, [cargarReconteos]);
  useEffect(() => {
    let vigente = true;
    setCargandoBorradores(true);
    fetch('/api/operaciones/recepciones/borradores', { headers: sessionHeaders(currentUser.id) })
      .then(async r => r.ok ? r.json() : [])
      .then(data => { if (vigente) setBorradoresRecepcion(Array.isArray(data) ? data : []); })
      .catch(() => { if (vigente) setBorradoresRecepcion([]); })
      .finally(() => { if (vigente) setCargandoBorradores(false); });
    return () => { vigente = false; };
  }, [currentUser.id]);

  const enviarReconteo = async (item: any) => {
    const datos = item.datos || {};
    const lineas = datos.primerConteo?.lineas || [];
    const conteoPorProducto = lineas.map((l: any) => ({ producto: l.producto, cantidad: Number(valoresReconteo[item.id]?.[l.producto] ?? l.cantidadContada) }));
    setProcesandoReconteo(item.id);
    try {
      const res = await fetch(`/api/logistica/bodega/reconteos/${item.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({ responsable: currentUser.name || currentUser.id, conteoPorProducto }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar el reconteo');
      toast.success(data.conforme ? 'El reconteo coincide. Confirme la recepción normal del sobrante.' : 'Diferencia confirmada; quedó en cuarentena para aprobación de Administración.');
      await Promise.all([cargarReconteos(), cargarRetornosPendientes(), cargarStock()]);
      onRefresh();
    } catch (e: any) { toast.error(e.message || 'Error al registrar el reconteo'); }
    finally { setProcesandoReconteo(null); }
  };

  const liberarCuarentena = async (caso: any) => {
    const motivo = window.prompt(`¿Qué verificaste para liberar ${caso.cantidad} ${caso.unidad} de ${caso.producto}?`);
    if (!motivo?.trim()) return;
    try {
      const res = await fetch(`/api/logistica/bodega/cuarentena/${caso.id}/liberar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo liberar el producto');
      toast.success(`${data.cantidad} ${caso.unidad} liberados a Bodega Central`);
      await Promise.all([cargarReconteos(), cargarStock()]);
      onRefresh();
    } catch (e: any) { toast.error(e.message || 'Error al liberar cuarentena'); }
  };

  const vincularEtiquetasReempaque = async (caso: any) => {
    const etiquetaIds = etiquetasReempaqueSeleccionadas[caso.id] || [];
    if (!etiquetaIds.length) { toast.error('Seleccione las etiquetas nuevas del reempaque.'); return; }
    const motivo = window.prompt(`Describa el reempaque verificado para ${caso.producto} (${caso.cantidad} ${caso.unidad}).`);
    if (!motivo?.trim()) return;
    try {
      const res = await fetch(`/api/logistica/bodega/cuarentena/${caso.id}/etiquetas-reemplazo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({ etiquetaIds, motivo: motivo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron vincular las etiquetas nuevas');
      toast.success(`${data.etiquetasNuevas.length} etiquetas vinculadas al reempaque`);
      setEtiquetasReempaqueSeleccionadas(prev => ({ ...prev, [caso.id]: [] }));
      await Promise.all([cargarReconteos(), cargarPendientes(), cargarStock()]);
      onRefresh();
    } catch (e: any) { toast.error(e.message || 'Error al vincular etiquetas'); }
  };

  const resolverRetorno = async (retornoId: string, accion: 'aceptar' | 'rechazar', cantidadParcial?: number) => {
    const retorno = retornosPendientes.find(r => r.id === retornoId);
    if (!retorno) return;
    setProcesandoRetorno(retornoId);
    try {
      const res = await fetch('/api/logistica/bodega/retorno/aceptar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({ retornoId, cantidadAceptada: accion === 'aceptar' ? Math.min(Number(retorno.cartones), Number(retorno.cantidadAceptada || 0) + (cantidadParcial ?? Number(retorno.cantidadPendiente))) : Number(retorno.cantidadAceptada || 0), rechazado: accion === 'rechazar', responsable: currentUser.name || currentUser.id, condicion: accion === 'aceptar' ? 'bueno' : 'dañado' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo actualizar el retorno');
      toast.success(accion === 'aceptar' ? 'Retorno aceptado y agregado al inventario' : 'Retorno rechazado; cuéntelo otra vez antes de aceptarlo');
      await Promise.all([cargarRetornosPendientes(), cargarStock()]);
      onRefresh();
    } catch (e: any) { toast.error(e.message || 'Error al procesar el retorno'); }
    finally { setProcesandoRetorno(null); }
  };

  const aceptarSobranteFisico = async (guia: any) => {
    const guiaId = guia.guiaId;
    const saldo = Number(guia.restanteCamion || 0);
    if (!guiaId || saldo <= 0) return;
    const conteoPorProducto = (guia.porProducto || []).filter((linea: any) => Number(linea.saldoBajoCustodiaCamion) > 0.0001)
      .map((linea: any) => ({ producto: linea.producto, cantidad: Number(conteoSobrante[guiaId]?.[linea.producto] ?? linea.saldoBajoCustodiaCamion),
        motivoDiferencia: motivoDiferenciaSobrante[guiaId]?.[linea.producto] || '' }));
    const confirmado = window.confirm(`Confirmás que pesaste físicamente ${saldo} ${guia.unidad || 'kg'} del camión ${guia.camionNombre || ''} para la guía ${guia.consecutivo}?`);
    if (!confirmado) return;
    setProcesandoSobrante(guiaId);
    try {
      const res = await fetch('/api/logistica/bodega/retorno/aceptar-sobrante', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
        body: JSON.stringify({ guiaId, responsable: currentUser.name || currentUser.id, conteoPorProducto }),
      });
      const data = await res.json();
      if (!res.ok && data.diferenciaPendiente) {
        toast.error(data.error || 'Conteo discrepante; quedó pendiente de revisión.');
        await Promise.all([cargarRetornosPendientes(), cargarStock()]);
        onRefresh();
        return;
      }
      if (!res.ok) throw new Error(data.error || 'No se pudo confirmar el sobrante');
      toast.success(`Recibidos ${data.totalAceptado} ${data.unidad || 'kg'} en Bodega`);
      await Promise.all([cargarRetornosPendientes(), cargarStock()]);
      onRefresh();
    } catch (e: any) { toast.error(e.message || 'Error al recibir el sobrante'); }
    finally { setProcesandoSobrante(null); }
  };

  useEffect(() => {
    (async () => {
      try {
      const res = await fetch('/api/operaciones/recepciones', { headers: sessionHeaders(currentUser.id) });
        if (res.ok) {
          const recepciones = await res.json();
          // Filtro por tipoDiferencia (la columna canónica) y no por esPosibleRobo (nombre
          // heredado): así la UI no depende de un campo que afirma una conclusión.
          setAlertasDiferencia((recepciones || []).filter((r: any) => ['alerta', 'sobrante'].includes(r.tipoDiferencia)));
        }
      } catch { /* sin alertas de diferencia */ }
    })();
  }, []);

  // ===== Cuadre (custodia + bodega) =====
  const bodegaItems = inventario.filter(i => i.ubicacion === 'Bodega Central');
  const saldosHistoricosGranja = inventario.filter(i => i.ubicacion === 'Granja' && String(i.unidad).toLowerCase() !== 'kg' && /huevo/i.test(String(i.producto)));
  // La entrada puede venir del flujo de traslados o de una guía de remisión.
  // Ambos deben aparecer en la misma lista de camiones pendientes.
  const traslados = movimientos.filter(m => m.tipo === 'Traslado' || m.tipo === 'Remisión');
  const ingresosBodega = movimientos.filter(m => m.destino === 'Bodega Central').sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  const salidasBodega = movimientos.filter(m => m.origen === 'Bodega Central').sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  // Una tarjeta por viaje (traslado: camión + fecha; remisión: guía). Se deriva
  // la etapa del estado real del servidor y del borrador persistido.
  const gruposEntradas = useMemo(() => {
    const byViaje = new Map<string, any[]>();
    for (const m of traslados.filter(m => m.destino === 'Bodega Central')) {
      if (['Anulado', 'Anulada', 'Rechazada'].includes(String(m.estado))) continue;
      const fechaClave = String(m.fecha || '').slice(0, 10);
      const llave = m.tipo === 'Remisión'
        ? `remision:${m.referencia_id || m.id}`
        : `traslado:${m.camionId || m.camionNombre || m.vehiculo || 'camion'}:${fechaClave}`;
      if (!byViaje.has(llave)) byViaje.set(llave, []);
      byViaje.get(llave)!.push(m);
    }
    const drafts = new Map(borradoresRecepcion.map(d => [d.id, d]));
    return Array.from(byViaje.entries()).map(([key, movs]) => {
      const ordenados = [...movs].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
      const pendientes = ordenados.filter(m => !['Recibido', 'RecibidoConDiferencia', 'Recibida', 'RecibidaConDiferencia', 'Alistada'].includes(String(m.estado)));
      const completados = pendientes.length === 0;
      const borrador = drafts.get(key);
      const enRecepcion = !completados && (!!borrador || ordenados.some(m => ['Recibido', 'RecibidoConDiferencia', 'Recibida', 'RecibidaConDiferencia'].includes(String(m.estado))));
      const movsActivos = completados ? ordenados : pendientes;
      const productosUnicos = Array.from(new Set(ordenados.map(m => m.producto)));
      return {
        key, camionNombre: ordenados[0].camionNombre || ordenados[0].transporte || ordenados[0].vehiculo || (ordenados[0].tipo === 'Remisión' ? `Remisión ${ordenados[0].consecutivo || String(ordenados[0].referencia_id || '').slice(0, 8)}` : 'Camión'),
        origen: ordenados[0].granjaOrigenNombre || (ordenados[0].origen === 'Granja' ? 'Granja' : ordenados[0].origen) || 'Granja',
        reportadoPorNombre: ordenados[0].reportadoPorNombre, fecha: ordenados[0].fecha, tipo: ordenados[0].tipo,
        movs: movsActivos, movsTodos: ordenados, borrador, completados, enRecepcion,
        totalKg: ordenados.filter(m => m.unidad === 'kg').reduce((sum, m) => sum + Number(m.cantidad || 0), 0),
        totalCantidad: ordenados.reduce((sum, m) => sum + Number(m.cantidad || 0), 0),
        productosUnicos, productos: productosUnicos.join(', '),
      };
    }).sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  }, [traslados, borradoresRecepcion]);
  const gruposEnCamino = gruposEntradas.filter(g => !g.completados && !g.enRecepcion);
  const gruposEnRecepcion = gruposEntradas.filter(g => !g.completados && g.enRecepcion);
  const gruposCompletados = gruposEntradas.filter(g => g.completados);
  const gruposTraslados = gruposEnCamino;
  const gruposPorPestana = pestanaEntradas === 'camino' ? gruposEnCamino : pestanaEntradas === 'recepcion' ? gruposEnRecepcion : gruposCompletados;
  const gruposFiltrados = gruposPorPestana.filter(g => {
    const q = normalizarBusquedaMovimiento(busquedaEntradas.trim());
    const texto = normalizarBusquedaMovimiento([g.camionNombre, g.origen, g.productos, ...g.movsTodos.map((m: any) => m.consecutivo || m.referencia_id)].join(' '));
    return (!q || texto.includes(q)) && (!fechaEntradas || fechaLocalISO(g.fecha) === fechaEntradas);
  });

  const guardarBorradorRecepcion = useCallback(async (grupo: any, cantidades: Record<string, number>, motivos: Record<string, string>) => {
    if (!grupo?.key || !grupo.movs?.length) return;
    const borrador = {
      id: grupo.key,
      tipo: grupo.tipo === 'Remisión' ? 'remision' : 'traslado',
      referencias: grupo.movs.map((m: any) => m.referencia_id || m.id),
      datos: { cantidades, motivos },
    };
    try {
      const res = await fetch('/api/operaciones/recepciones/borradores', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true), body: JSON.stringify(borrador),
      });
      if (!res.ok) throw new Error('No se pudo guardar el avance de recepción.');
      const guardado = await res.json();
      setBorradoresRecepcion(prev => [...prev.filter(d => d.id !== guardado.id), guardado]);
    } catch (error) { console.error('No se pudo guardar el borrador de recepción:', error); }
  }, [currentUser.id]);

  useEffect(() => {
    if (!wizardGrupo || enviandoWizard) return;
    const timer = window.setTimeout(() => {
      void guardarBorradorRecepcion(wizardGrupo, cantidadesWizard, motivosWizard);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [wizardGrupo, cantidadesWizard, motivosWizard, enviandoWizard, guardarBorradorRecepcion]);

  const eliminarBorradorRecepcion = async (id: string) => {
    try {
      const res = await fetch(`/api/operaciones/recepciones/borradores/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: sessionHeaders(currentUser.id),
      });
      if (!res.ok) throw new Error('No se pudo limpiar el borrador de recepción.');
    } catch (error) { console.warn('La recepción se confirmó, pero no se pudo limpiar su borrador:', error); }
    setBorradoresRecepcion(prev => prev.filter(d => d.id !== id));
  };

  const clavesCuadre = Array.from(new Set([...bodegaItems, ...ingresosBodega, ...salidasBodega]
    .filter(i => i.producto).map(i => `${i.producto}||${i.unidad || 'Unidad no especificada'}`)));
  const cuadre = clavesCuadre.map(clave => {
    const [producto, unidad] = clave.split('||');
    const mismaUnidad = (i: any) => i.producto === producto && String(i.unidad || 'Unidad no especificada') === unidad;
    const st = bodegaItems.filter(mismaUnidad).reduce((a, i) => a + Number(i.cantidad), 0);
    const entradas = ingresosBodega.filter(mismaUnidad).reduce((a, m) => a + Number(m.cantidad), 0);
    const salidas = salidasBodega.filter(mismaUnidad).reduce((a, m) => a + Number(m.cantidad), 0);
    return { producto, unidad, stock: st, entradas, salidas, sobrante: entradas - salidas - st };
  });
  const alertasBodega = cuadre.filter(c => c.salidas > c.entradas + c.stock);

  const guiasActivas = guiasTablero.filter(g => g.estado !== 'Cerrada' && g.estado !== 'Anulada');
  // Consolida G4: el descuadre viene calculado en el payload (descuadreCustodia),
  // no se vuelve a armar en el cliente.
  const alertasCustodia = guiasActivas
    .map(g => ({
      ...g,
      cargado: Number(g.totalCargado) || 0,
      vendidos: Number(g.cartonesVendidos) || 0,
      retornados: Number(g.cartonesRetornados) || 0,
      restante: Number(g.restanteCamion) || 0,
      descuadre: Number(g.descuadreCustodia) || 0,
    }))
    .filter(g => g.descuadre !== 0);
  const sobrantesPorAceptar = guiasActivas.filter(g => g.finDiaFecha && Number(g.restanteCamion) > 0.0001);

  const totalAlertas = alertasBodega.length + alertasCustodia.length + alertasDiferencia.length + sobrantesPorAceptar.length;

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

  const unidadesMovimientos = useMemo(() => Array.from(new Set([
    ...movimientosFiltrados.ingresos, ...movimientosFiltrados.salidas,
  ].map(m => String(m.unidad || 'Unidad no especificada')))), [movimientosFiltrados]);
  const unidadActivaGrafico = unidadesMovimientos.includes(unidadGrafico) ? unidadGrafico : (unidadesMovimientos[0] || '');

  // Datos del gráfico time-series (agrupados por día del período)
  const graficoSeries = useMemo(() => {
    const puntos: { label: string; entradas: number; salidas: number }[] = [];
    const acum = new Map<string, { entradas: number; salidas: number }>();
    movimientosFiltrados.ingresos.filter(m => String(m.unidad || 'Unidad no especificada') === unidadActivaGrafico).forEach(m => {
      const clave = formatFechaCorta(m.fecha);
      const cur = acum.get(clave) || { entradas: 0, salidas: 0 }; cur.entradas += Number(m.cantidad) || 0; acum.set(clave, cur);
    });
    movimientosFiltrados.salidas.filter(m => String(m.unidad || 'Unidad no especificada') === unidadActivaGrafico).forEach(m => {
      const clave = formatFechaCorta(m.fecha);
      const cur = acum.get(clave) || { entradas: 0, salidas: 0 }; cur.salidas += Number(m.cantidad) || 0; acum.set(clave, cur);
    });
    Array.from(acum.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([label, v]) => puntos.push({ label, ...v }));
    return puntos;
  }, [movimientosFiltrados, unidadActivaGrafico]);

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
  const sumarProductosPorUnidad = (obtenerCantidad: (producto: any) => number) => productos.reduce((acc: Record<string, number>, p: any) => {
    const unidad = String(p.unidad || 'Unidad no especificada');
    acc[unidad] = (acc[unidad] || 0) + (Number(obtenerCantidad(p)) || 0);
    return acc;
  }, {});
  const elegirMapa = (primario: Record<string, number> | undefined, alterno: Record<string, number>) =>
    primario && Object.keys(primario).length ? primario : alterno;
  const stockPorUnidadUI = elegirMapa(kpis.stockPorUnidad, sumarProductosPorUnidad(p => p.total));
  const sumarLotesPorEstado = (estado: string) => colaFEFO.reduce((acc: Record<string, number>, l: any) => {
    if (l.estado === estado) {
      const unidad = String(l.unidad || 'kg');
      acc[unidad] = (acc[unidad] || 0) + (Number(l.cantidad) || 0);
    }
    return acc;
  }, {});
  const porVencerPorUnidadUI = elegirMapa(kpis.porVencerPorUnidad, sumarLotesPorEstado('pronto'));
  const vencidosPorUnidadUI = elegirMapa(kpis.vencidosPorUnidad, sumarLotesPorEstado('vencido'));
  const existenciaPorUnidad = formatoStockPorUnidad(stockPorUnidadUI);
  const porVencerPorUnidad = formatoStockPorUnidad(porVencerPorUnidadUI);
  const vencidosPorUnidad = formatoStockPorUnidad(vencidosPorUnidadUI);
  // La pantalla principal informa kilos confirmados por separado de registros
  // heredados cuyo peso todavía no se ha validado.
  const totalKgDisponibles = Object.entries(stockPorUnidadUI)
    .filter(([unidad]) => unidad.toLowerCase() === 'kg')
    .reduce((total, [, cantidad]) => total + (Number(cantidad) || 0), 0);
  const empaquesPendientesPesaje = Object.entries(stockPorUnidadUI)
    .filter(([unidad]) => unidad.toLowerCase().includes('cart'))
    .reduce((total, [, cantidad]) => total + (Number(cantidad) || 0), 0);
  const movimientosRecientes = [...ingresosBodega, ...salidasBodega]
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    .slice(0, 3);
  const movimientosActividad = Array.from(new Map([...ingresosBodega, ...salidasBodega].map((mov: any) => [mov.id, mov])).values())
    .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  const movimientosActividadFiltrados = movimientosActividad.filter((mov: any) => {
    const entrada = mov.destino === 'Bodega Central';
    if (tipoActividad === 'entradas' && !entrada) return false;
    if (tipoActividad === 'salidas' && entrada) return false;
    const fecha = fechaLocalISO(mov.fecha);
    if (desdeActividad && fecha && fecha < desdeActividad) return false;
    if (hastaActividad && fecha && fecha > hastaActividad) return false;
    const lotes = Array.isArray(mov.lotes) ? mov.lotes : mov.lote ? [mov.lote] : [];
    const etiquetas = Array.isArray(mov.codigosEtiquetas) ? mov.codigosEtiquetas : [];
    const contenido = normalizarBusquedaMovimiento([
      mov.producto, mov.tipo, mov.referencia_id, mov.consecutivo, mov.camionNombre,
      mov.granjaOrigenNombre, mov.origen, mov.destino, mov.reportadoPor, mov.reportadoPorNombre,
      ...lotes, ...etiquetas,
    ].join(' '));
    return !busquedaActividad.trim() || contenido.includes(normalizarBusquedaMovimiento(busquedaActividad.trim()));
  });
  let custodiaKg = 0;
  let empaquesPorPesar = 0;
  let otrasCantidades: Record<string, number> = {};
  for (const guia of guiasActivas) {
    const lineas = Array.isArray(guia.porProducto) ? guia.porProducto : [];
    if (lineas.length) {
      for (const linea of lineas) {
        const cantidad = Number(linea.saldoBajoCustodiaCamion) || 0;
        const unidad = String(linea.unidad || guia.unidad || '').toLowerCase();
        if (unidad === 'kg') custodiaKg += cantidad;
        else if (unidad.includes('cart') || unidad.includes('mixt') || !unidad) empaquesPorPesar += cantidad;
        else otrasCantidades[unidad] = (otrasCantidades[unidad] || 0) + cantidad;
      }
    } else {
      const cantidad = Number(guia.restanteCamion) || 0;
      const unidad = String(guia.unidad || '').toLowerCase();
      if (unidad === 'kg') custodiaKg += cantidad;
      else if (unidad.includes('cart') || unidad.includes('mixt') || !unidad) empaquesPorPesar += cantidad;
      else otrasCantidades[unidad] = (otrasCantidades[unidad] || 0) + cantidad;
    }
  }
  const custodiaPorUnidad = [
    custodiaKg > 0.0001 ? `${custodiaKg.toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg` : '',
    empaquesPorPesar > 0.0001 ? `${empaquesPorPesar.toLocaleString('es-CR', { maximumFractionDigits: 2 })} empaques · kg pendiente` : '',
    formatoStockPorUnidad(otrasCantidades).replace(/^0 kg$/, ''),
  ].filter(Boolean).join(' · ') || '0 kg';

  const tieneVencidos = totalPorUnidad(vencidosPorUnidadUI, kpis.vencidos) > 0.0001;
  const tienePorVencer = totalPorUnidad(porVencerPorUnidadUI, kpis.porVencer) > 0.0001;
  const toggleExpandido = (key: string) =>
    setExpandidos(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const irALotesFEFO = () => {
    const proximo = kpis.proximoSalir || colaFEFO.find((l: any) => l.dias !== null);
    const productoObjetivo = String(proximo?.producto || '').trim();
    if (!productoObjetivo) { toast.info('No hay lotes con fecha de vencimiento para ordenar.'); return; }
    setBusqueda(productoObjetivo);
    const producto = productos.find(p => p.key === proximo?.productoKey)
      || productos.find(p => String(p.producto || '').toLocaleLowerCase() === productoObjetivo.toLocaleLowerCase());
    if (producto?.key) setExpandidos(prev => prev.includes(producto.key) ? prev : [...prev, producto.key]);
    else toast.info('No encontramos el lote en existencias; actualizá la lista para volver a cargarla.');
    if (vista === 'control') onVista('existencias');
    window.setTimeout(() => document.getElementById('bodega-existencias-lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };

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
    const datosGuardados = grupo.borrador?.datos || {};
    setCantidadesWizard({ ...inicial, ...(datosGuardados.cantidades || {}) });
    setMotivosWizard(datosGuardados.motivos || {});
    setCodigos([]); codigosRef.current.clear(); setCodigoInput('');
    setWizardPaso(1);
    setWizardGrupo(grupo);
    void guardarBorradorRecepcion(grupo, { ...inicial, ...(datosGuardados.cantidades || {}) }, datosGuardados.motivos || {});
  };

  const ejecutarRecepcion = async (mov: any, recibido: number, motivo: string, etiquetasCodigos: string[] = []) => {
    if (mov.tipo === 'Remisión') {
      const res = await fetch('/api/operaciones/recepcion-remision', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({
          guiaId: mov.referencia_id,
          ...(mov.unidad === 'kg' ? { cantidadKg: recibido } : { cantidadRecibida: recibido }),
          motivoDiferencia: motivo,
          responsable: currentUser.name || currentUser.id,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al validar recepción de la remisión'); }
      return res.json();
    }
    const cantidadBase = mov.unidad === 'kg'
      ? { cantidadKgEsperada: Number(mov.cantidad), cantidadKgRecibida: recibido }
      : { cantidadEsperada: Number(mov.cantidad), cantidadRecibida: recibido };
    const res = await fetch('/api/operaciones/recepcion', {
      method: 'POST', headers: sessionHeaders(currentUser.id, true),
      body: JSON.stringify({ trasladoId: mov.referencia_id, ...cantidadBase, motivoDiferencia: motivo, producto: mov.producto, etiquetasCodigos })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error al validar recepción'); }
    return res.json();
  };

  const corregirPesoHistorico = async (mov: any) => {
    const pesoKg = Number(pesoCorreccionKg[mov.referencia_id]);
    const motivo = (motivoCorreccionKg[mov.referencia_id] || '').trim();
    if (!Number.isFinite(pesoKg) || pesoKg <= 0) return toast.error('Ingresá el peso real medido en báscula.');
    if (motivo.length < 8) return toast.error('Explicá la corrección con al menos 8 caracteres.');
    try {
      const ruta = mov.tipo === 'Remisión' ? 'remisiones' : 'traslados';
      const res = await fetch(`/api/operaciones/${ruta}/${encodeURIComponent(mov.referencia_id)}/corregir-peso-kg`, {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ pesoKg, motivo })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar la corrección.');
      toast.success(`Peso real registrado: ${pesoKg.toLocaleString('es-CR')} kg. Vuelve a elegir el camión para completar la recepción.`);
      setPesoCorreccionKg(prev => ({ ...prev, [mov.referencia_id]: '' }));
      setMotivoCorreccionKg(prev => ({ ...prev, [mov.referencia_id]: '' }));
      setWizardGrupo(null);
      setWizardPaso(1);
      await cargarStock(); await cargarPendientes(); onRefresh();
    } catch (error: any) { toast.error(error.message || 'No se pudo registrar la corrección.'); }
  };

  const conciliarSaldoHistoricoGranja = async (saldo: any) => {
    const cantidadKg = Number(conteoHistoricoKg[saldo.id]);
    const motivo = (motivoConteoHistorico[saldo.id] || '').trim();
    if (!Number.isFinite(cantidadKg) || cantidadKg < 0) return toast.error('Ingresá el total medido en kg; puede ser cero.');
    if (motivo.length < 8) return toast.error('Anotá cómo se hizo el conteo y su evidencia.');
    const confirmado = window.confirm(`¿Confirmás el conteo físico de ${cantidadKg} kg para ${saldo.producto}? El saldo anterior de ${saldo.cantidad} ${saldo.unidad} se conservará en auditoría.`);
    if (!confirmado) return;
    setConciliandoInventarioId(saldo.id);
    try {
      const res = await fetch('/api/operaciones/inventario/granja/conciliar-kg', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ inventarioId: saldo.id, cantidadKg, motivo })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo conciliar el saldo.');
      toast.success(`Saldo de ${saldo.producto} actualizado a ${cantidadKg.toLocaleString('es-CR')} kg con auditoría.`);
      setConteoHistoricoKg(prev => ({ ...prev, [saldo.id]: '' }));
      setMotivoConteoHistorico(prev => ({ ...prev, [saldo.id]: '' }));
      await Promise.all([cargarStock(), cargarPendientes()]);
      onRefresh();
    } catch (error: any) { toast.error(error.message || 'No se pudo conciliar el saldo.'); }
    finally { setConciliandoInventarioId(null); }
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
      await eliminarBorradorRecepcion(wizardGrupo.key);
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
        method: 'POST', headers: sessionHeaders(currentUser?.id || '', true),
        body: JSON.stringify({ producto: manualProducto, cantidad: cant, unidad: 'kg', lote: manualLote.trim(), fechaVencimiento: manualVencimiento || null, procedencia: manualProcedencia, observaciones: manualObservacion.trim(), usuarioId: currentUser?.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al registrar ingreso manual');
      toast.success(`Ingreso manual registrado · +${cant} ${manualProducto}`);
      setIngresoManualAbierto(false);
      setManualProducto(''); setManualCantidad(''); setManualLote(''); setManualVencimiento(''); setManualProcedencia('Granja (sin traslado)'); setManualObservacion('');
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
      const res = await fetch(`/api/etiquetas/trazabilidad/${encodeURIComponent(cod)}`, { headers: sessionHeaders(currentUser.id) });
      if (res.ok) {
        const d = await res.json();
        const est = d.etiqueta?.estado;
        const valido = est === 'Generada';
        setCodigos(prev => prev.map(c => c.codigo === cod
          ? { codigo: cod, estado: valido ? 'pendiente' : 'yaIngresada', producto: d.etiqueta?.producto, estadoEtiqueta: est }
          : c));
        if (valido) toast.success(`Etiqueta de ${d.etiqueta?.producto || 'producto'} lista para ingresar`);
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
    setBusquedaTrazHecha(true);
    setTraz(null);
    try {
      const res = await fetch(`/api/etiquetas/trazabilidad/buscar?q=${encodeURIComponent(cod)}`, { headers: sessionHeaders(currentUser.id) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo buscar la trazabilidad');
      const resultados = Array.isArray(data.resultados) ? data.resultados : [];
      setResultadosTraz(resultados);
      if (resultados.length === 1) {
        await abrirTrazabilidad(resultados[0].codigo);
      } else if (resultados.length === 0) {
        // Compatibilidad: un escaneo QR puede apuntar a un código exacto que
        // todavía no esté indexado por los campos de búsqueda.
        await abrirTrazabilidad(cod);
      }
    } catch (e: any) { toast.error(e.message); setTraz(null); setResultadosTraz([]); }
    finally { setBuscandoTraz(false); }
  };
  const abrirTrazabilidad = async (codigo: string) => {
    setBuscandoTraz(true);
    try {
      const res = await fetch(`/api/etiquetas/trazabilidad/${encodeURIComponent(codigo)}`, { headers: sessionHeaders(currentUser.id) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Etiqueta no encontrada');
      setTraz(data);
      setResultadosTraz([]);
    } catch (e: any) { toast.error(e.message); setTraz(null); }
    finally { setBuscandoTraz(false); }
  };
  useEffect(() => {
    if (!mostrarControl || seccionControl !== 'trazabilidad' || lotesTrazInicializados.current) return;
    lotesTrazInicializados.current = true;
    let cancelado = false;
    const cargarLotes = async () => {
      setCargandoLotesTraz(true);
      try {
        const res = await fetch('/api/etiquetas', { headers: sessionHeaders(currentUser.id) });
        const data = await res.json();
        if (!res.ok || !Array.isArray(data)) throw new Error('No se pudieron cargar los lotes');
        const porLote = new Map<string, any>();
        data.forEach((etiqueta: any) => {
          const lote = String(etiqueta.lote || '').trim();
          if (!lote) return;
          const actual = porLote.get(lote) || {
            lote, producto: etiqueta.producto, codigo: etiqueta.codigoUnico, etiquetas: 0, kg: 0,
            ubicaciones: new Set<string>(), estados: new Set<string>(), vencimientos: [], demo: false,
          };
          actual.etiquetas += 1;
          actual.kg += Number(etiqueta.saldoKg ?? etiqueta.pesoNeto ?? 0);
          if (etiqueta.ubicacionActual) actual.ubicaciones.add(String(etiqueta.ubicacionActual));
          if (etiqueta.estado) actual.estados.add(String(etiqueta.estado));
          if (etiqueta.fechaVencimiento) actual.vencimientos.push(String(etiqueta.fechaVencimiento));
          porLote.set(lote, actual);
        });
        const lotesReales = Array.from(porLote.values()).map(lote => ({
          ...lote,
          ubicacion: Array.from(lote.ubicaciones).join(', ') || 'Sin ubicación',
          estado: Array.from(lote.estados).join(', ') || 'Sin estado',
          vencimiento: lote.vencimientos.sort()[0] || null,
          demo: /^DEMO/i.test(lote.lote),
        })).sort((a, b) => (a.vencimiento || '9999').localeCompare(b.vencimiento || '9999'));
        const muestra = {
          lote: 'DEMO-TRAZA-NOV-2026', producto: 'Huevos - Grande', codigo: 'DEMO-TRAZA-GRANDE-001',
          etiquetas: 1, kg: 18.5, ubicacion: 'Bodega Central', estado: 'En bodega',
          vencimiento: new Date(Date.now() + 21 * 86400000).toISOString(), demo: true,
        };
        const lotesSinMuestra = lotesReales.filter(lote => lote.lote !== muestra.lote);
        if (!cancelado) setLotesTraz([muestra, ...lotesSinMuestra]);
      } catch {
        if (!cancelado) setLotesTraz([{
          lote: 'DEMO-TRAZA-NOV-2026', producto: 'Huevos - Grande', codigo: 'DEMO-TRAZA-GRANDE-001',
          etiquetas: 1, kg: 18.5, ubicacion: 'Bodega Central', estado: 'En bodega',
          vencimiento: new Date(Date.now() + 21 * 86400000).toISOString(), demo: true,
        }]);
      } finally { if (!cancelado) setCargandoLotesTraz(false); }
    };
    void cargarLotes();
    return () => { cancelado = true; lotesTrazInicializados.current = false; };
  }, [seccionControl, mostrarControl]);
  const abrirLoteDemo = () => {
    const ahora = Date.now();
    const horasAtras = (horas: number) => new Date(ahora - horas * 60 * 60 * 1000).toISOString();
    setTrazCodigo('DEMO-TRAZA-GRANDE-001');
    setTraz({
      etiqueta: { codigoUnico: 'DEMO-TRAZA-GRANDE-001', producto: 'Huevos - Grande', lote: 'DEMO-TRAZA-NOV-2026', estado: 'EnBodega', ubicacionActual: 'Bodega Central', fechaVencimiento: new Date(ahora + 21 * 86400000).toISOString(), saldoKg: 18.5 },
      traza: [
        { id: 'demo-traza-1', fecha: horasAtras(38), tipoEvento: 'Generada', origenDerivado: null, ubicacion: 'Granja Concepción · Galerón 2', usuario: { name: 'Encargado de Galerón', role: 'Producción' }, documentoRef: 'PROD-DEMO-001', observaciones: 'DEMO · Empaque del lote y creación de etiqueta. Peso inicial: 18.5 kg.' },
        { id: 'demo-traza-2', fecha: horasAtras(30), tipoEvento: 'En tránsito', origenDerivado: 'Granja Concepción · Galerón 2', ubicacion: 'Camión Ruta 10', usuario: { name: 'Chofer de demostración', role: 'Transporte' }, documentoRef: 'REM-DEMO-001', observaciones: 'DEMO · Salida hacia Bodega Central; carga protegida durante el traslado.' },
        { id: 'demo-traza-3', fecha: horasAtras(27), tipoEvento: 'Recibida en bodega', origenDerivado: 'Camión Ruta 10', ubicacion: 'Bodega Central', usuario: { name: 'Bodeguero de demostración', role: 'Bodega' }, documentoRef: 'REC-DEMO-001', observaciones: 'DEMO · Recepción física confirmada. Cantidad recibida: 18.5 kg.' },
        { id: 'demo-traza-4', fecha: horasAtras(26), tipoEvento: 'Pesada', origenDerivado: 'Bodega Central', ubicacion: 'Bodega Central', usuario: { name: 'Bodeguero de demostración', role: 'Bodega' }, documentoRef: 'PESO-DEMO-001', observaciones: 'DEMO · Peso neto verificado y asociado al lote.' },
      ],
    });
    setBusquedaTrazHecha(true);
  };
  const buscarConSugerencia = (s: string) => { setTrazCodigo(s); void buscarTraz(s); };
  const esAdminBodega = (currentUser.roles?.length ? currentUser.roles : [currentUser.role]).includes('Admin');
  const lotesTrazFiltrados = useMemo(() => {
    const q = trazCodigo.trim().toLocaleLowerCase();
    if (!q) return lotesTraz;
    return lotesTraz.filter((lote: any) => [lote.producto, lote.lote, lote.codigo, lote.ubicacion, lote.estado].some(valor => String(valor || '').toLocaleLowerCase().includes(q)));
  }, [lotesTraz, trazCodigo]);
  const pendientesBodegaCount = retornosPendientes.length + (esAdminBodega ? saldosHistoricosGranja.length : 0) + reconteosPendientes.length + inventarioCuarentena.length + sobrantesPorAceptar.length;
  const wizardRequierePesaje = Boolean(wizardGrupo?.movs?.some((m: any) => /huevo/i.test(String(m.producto)) && m.unidad !== 'kg'));
  const wizardPermiteEtiquetas = Boolean(wizardGrupo?.movs?.every((m: any) => m.tipo !== 'Remisión'));

  return (
    <div className="space-y-6 animate-in fade-in">

      {/* Existencias es el primer destino: muestra stock y la acción frecuente. */}
      {mostrarExistencias && <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-primary-soft)] text-[var(--text-primary)]"><Boxes className="h-7 w-7" /></span>
            <div>
              <p className="text-sm font-bold text-[var(--text-secondary)]">Kilos disponibles en bodega</p>
              <p className="text-4xl font-black tracking-tight text-[var(--text-primary)]">{cargandoStock ? '…' : errorStock ? '—' : totalKgDisponibles.toLocaleString('es-CR', { maximumFractionDigits: 2 })} <span className="text-xl">kg</span></p>
              {empaquesPendientesPesaje > 0 && <p className="mt-1 text-sm text-[var(--text-muted)]">{empaquesPendientesPesaje.toLocaleString('es-CR')} empaques pendientes de pesaje; no incluidos en este total.</p>}
              {errorStock && <p className="mt-1 text-sm text-red-700">No se pudo actualizar el stock. <button type="button" onClick={() => void cargarStock()} className="font-bold underline">Reintentar</button></p>}
            </div>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">Busca un producto y revisa sus lotes antes de alistarlo.</p>
        </div>
        {(tieneVencidos || tienePorVencer || kpis.proximoSalir) && (
          <div className={cn('mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3', tieneVencidos ? 'border-red-200 bg-red-50' : tienePorVencer ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50')}>
            <p className="text-sm text-[var(--text-primary)]">
              {tieneVencidos ? <><strong>{vencidosPorUnidad}</strong> vencidos: requieren revisión.</> : tienePorVencer ? <><strong>{porVencerPorUnidad}</strong> por vencer pronto.</> : <>Siguiente lote: <strong>{kpis.proximoSalir.producto || 'producto'}</strong> · {Number(kpis.proximoSalir.cantidad || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })} {kpis.proximoSalir.unidad || 'kg'}</>}
            </p>
            <div className="flex flex-wrap gap-3">
              {tieneVencidos && <button type="button" onClick={() => { setMermaAbierta(true); if (vista === 'existencias') onVista('control'); }} className="text-sm font-bold text-red-700">Registrar merma</button>}
              {kpis.proximoSalir && <button type="button" onClick={irALotesFEFO} className="text-sm font-bold text-[var(--text-link)]">Ver lote que vence primero</button>}
            </div>
          </div>
        )}
      </section>}

      {mostrarEntradas && <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-[var(--text-primary)]">Entradas a bodega</h2>
          <p className="text-sm text-[var(--text-secondary)]">Elige cómo registrar el producto que llega.</p>
        </div>
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
          <button type="button" onClick={() => setNuevaRemisionAbierta(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold text-white shadow-sm transition hover:brightness-95" style={{ background: 'var(--brand-primary)' }}>
            <Truck className="h-4 w-4" /> Nueva remisión
          </button>
          <button type="button" onClick={() => setIngresoManualAbierto(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 text-sm font-bold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-card-hover)]">
            <ArrowUpFromLine className="h-4 w-4" /> Nueva entrada manual
          </button>
        </div>
      </section>}

      {mostrarControl && <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-xl font-extrabold text-[var(--text-primary)]">Control de bodega</h2><p className="text-sm text-[var(--text-secondary)]">Revisa pendientes, consulta movimientos o sigue un lote.</p></div>
          <button type="button" onClick={() => setMermaAbierta(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:brightness-95" style={{ background: 'var(--brand-primary)' }}><Trash2 className="h-4 w-4" /> Registrar merma</button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-[var(--border-default)]" role="tablist" aria-label="Secciones de control de bodega">
          {([
            ['pendientes', 'Pendientes', pendientesBodegaCount + totalAlertas],
            ['movimientos', 'Movimientos', null],
            ['trazabilidad', 'Trazabilidad', null],
          ] as [SeccionControl, string, number | null][]).map(([id, label, count]) => (
            <button key={id} id={`control-tab-${id}`} type="button" role="tab" aria-controls={`control-panel-${id}`} aria-selected={seccionControl === id} onClick={() => setSeccionControl(id)}
              className={cn('min-h-11 border-b-2 px-4 text-sm font-bold transition-colors', seccionControl === id ? 'border-[var(--brand-primary)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
              {label}{count !== null ? <span className="ml-2 rounded-full bg-[var(--brand-primary-soft)] px-2 py-0.5 text-xs">{count}</span> : null}
            </button>
          ))}
        </div>
      </section>}

      {/* ===== EXISTENCIAS: RECIBIR + EXISTENCIAS (unificadas) ===== */}
      {mostrarControl && seccionControl === 'pendientes' && (
        <section id="control-panel-pendientes" role="tabpanel" aria-labelledby="control-tab-pendientes" tabIndex={0} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] shadow-sm">
          <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 text-[var(--text-primary)]">
            <div><span className="font-extrabold">Pendientes de bodega</span><p className="mt-0.5 text-xs font-normal text-[var(--text-secondary)]">Abre solo el grupo que necesitas atender.</p></div>
            <span className="rounded-full bg-[var(--brand-primary-soft)] px-3 py-1 text-sm font-bold text-[var(--text-primary)]">{pendientesBodegaCount} {pendientesBodegaCount === 1 ? 'pendiente' : 'pendientes'}</span>
          </div>
          {pendientesBodegaCount > 0 ? <div className="space-y-3 border-t border-[var(--border-default)] p-4">
      {retornosPendientes.length > 0 && (
        <details className="group rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] open:border-amber-200 open:bg-amber-50/40">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-[var(--bg-card-hover)] [&::-webkit-details-marker]:hidden">
            <div><h3 className="text-sm font-extrabold text-[var(--text-primary)]">Devoluciones de ruta</h3><p className="text-xs text-[var(--text-secondary)]">Confirma los kilos recibidos para devolverlos al inventario.</p></div>
            <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">{retornosPendientes.length} por aceptar</span>
          </summary>
          <div className="space-y-3 border-t border-[var(--border-default)] p-4">
          <div className="space-y-3">
              {retornosPendientes.map((r: any) => (
                <article key={r.id} className="rounded-xl border border-amber-100 bg-white p-4">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-base font-extrabold text-neutral-900">{r.producto}</p>
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-extrabold text-amber-950">Pendiente: {Number(r.cantidadPendiente).toLocaleString('es-CR', { maximumFractionDigits: 2 })} {r.unidad || 'kg'}</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-neutral-700">
                        {r.rutaNombre || 'Ruta no especificada'}
                        {r.camionNombre ? ` · ${r.camionNombre}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-neutral-600">
                        {r.tipo === 'sobrante' ? 'Sobrante sin vender' : r.ventaRutaId ? 'Devolución de cliente' : 'Retorno de ruta'}
                        {r.guiaConsecutivo ? ` · Guía ${r.guiaConsecutivo}` : ''}
                        {r.guiaFecha ? ` · ${formatFechaHora(r.guiaFecha)}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">Reportó: {r.responsable || '—'} · Devuelto: {formatFechaHora(r.fecha)}</p>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <label className="flex items-center justify-between gap-3 text-xs font-bold text-neutral-600">Cantidad recibida
                        <span className="flex items-center gap-2"><input aria-label={`Cantidad recibida en ${r.unidad || 'kg'} ${r.producto}`} type="number" min="0" max={r.cantidadPendiente} step={r.unidad === 'kg' ? '0.01' : '1'} value={cantidadRecibidaRetorno[r.id] ?? String(r.cantidadPendiente)} onChange={e => setCantidadRecibidaRetorno(prev => ({ ...prev, [r.id]: e.target.value }))} className="w-28 rounded-lg border border-neutral-200 px-2 py-2 text-sm font-bold text-neutral-800" />{r.unidad || 'kg'}</span>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button disabled={procesandoRetorno === r.id || Number(cantidadRecibidaRetorno[r.id] ?? r.cantidadPendiente) <= 0 || Number(cantidadRecibidaRetorno[r.id] ?? r.cantidadPendiente) > Number(r.cantidadPendiente)} onClick={() => void resolverRetorno(r.id, 'aceptar', Number(cantidadRecibidaRetorno[r.id] ?? r.cantidadPendiente))} className="min-h-10 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50">Aceptar</button>
                        <button disabled={procesandoRetorno === r.id} onClick={() => void resolverRetorno(r.id, 'rechazar')} className="min-h-10 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">Rechazar</button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
          </div>
          </div>
        </details>
      )}

      {saldosHistoricosGranja.length > 0 && (currentUser.roles?.includes('Admin') || currentUser.role === 'Admin') && (
        <details className="group rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] open:border-amber-200 open:bg-amber-50/40">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-[var(--bg-card-hover)] [&::-webkit-details-marker]:hidden">
            <div><h3 className="text-sm font-extrabold text-[var(--text-primary)]">Saldos históricos de granja</h3><p className="text-xs text-[var(--text-secondary)]">Requieren conteo y pesaje para conciliar en kg.</p></div>
            <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">{saldosHistoricosGranja.length} por conciliar</span>
          </summary>
          <div className="space-y-3 border-t border-[var(--border-default)] p-4">
          <p className="text-xs leading-relaxed text-amber-950">Estos saldos aún están en cartones. Hacé el conteo físico y pesá el producto; ingresá el total real en kg. La app no convierte cartones a kilos. El inventario legado no está separado por granja, así que anotá en el motivo las granjas, pesajes y evidencia que componen el conteo.</p>
          <div className="grid gap-3 xl:grid-cols-2">
            {saldosHistoricosGranja.map((saldo: any) => (
              <article key={saldo.id} className="rounded-xl border border-amber-200 bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h4 className="font-bold text-neutral-900">{saldo.producto}</h4><p className="text-xs text-neutral-600">Saldo registrado: {Number(saldo.cantidad).toLocaleString('es-CR')} {saldo.unidad} · ubicación compartida Granja</p></div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-950">Requiere pesaje</span>
                </div>
                <label className="block text-xs font-bold text-neutral-800">Conteo físico total (kg)
                  <input aria-label={`Conteo físico kg ${saldo.producto}`} type="number" min="0" step="0.01" inputMode="decimal" value={conteoHistoricoKg[saldo.id] ?? ''} onChange={e => setConteoHistoricoKg(prev => ({ ...prev, [saldo.id]: e.target.value }))} placeholder="Ej. 248.75" className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base text-neutral-900" />
                </label>
                <label className="block text-xs font-bold text-neutral-800">Detalle y evidencia del conteo
                  <textarea aria-label={`Detalle y evidencia ${saldo.producto}`} rows={2} value={motivoConteoHistorico[saldo.id] || ''} onChange={e => setMotivoConteoHistorico(prev => ({ ...prev, [saldo.id]: e.target.value }))} placeholder="Granja, fecha, báscula y referencia del comprobante…" className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900" />
                </label>
                <button type="button" disabled={conciliandoInventarioId === saldo.id} onClick={() => void conciliarSaldoHistoricoGranja(saldo)} className="min-h-11 w-full rounded-lg bg-amber-800 px-4 py-2 text-sm font-extrabold text-white hover:bg-amber-900 disabled:opacity-50">{conciliandoInventarioId === saldo.id ? 'Guardando conteo…' : 'Confirmar conteo físico y conciliar en kg'}</button>
              </article>
            ))}
          </div>
          </div>
        </details>
      )}

      {reconteosPendientes.length > 0 && (
        <details className="group rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] open:border-orange-200 open:bg-orange-50/40">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-[var(--bg-card-hover)] [&::-webkit-details-marker]:hidden">
            <div><h3 className="text-sm font-extrabold text-[var(--text-primary)]">Recuentos por confirmar</h3><p className="text-xs text-[var(--text-secondary)]">Una segunda persona debe verificar el saldo.</p></div>
            <span className="shrink-0 rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-900">{reconteosPendientes.length} por contar</span>
          </summary>
          <div className="space-y-3 border-t border-[var(--border-default)] p-4">
          {reconteosPendientes.map(item => {
            const datos = item.datos || {};
            const ultimoConteo = (datos.reconteos || [datos.primerConteo]).filter(Boolean).slice(-1)[0];
            const lineas = ultimoConteo?.lineas || [];
            return <article key={item.id} className="rounded-xl border border-orange-200 bg-white p-4 space-y-3">
              <div><p className="font-bold text-neutral-900">Guía {datos.guiaId || item.referenciaId}</p><p className="text-xs text-neutral-600">Último conteo: {ultimoConteo?.responsable || 'Bodega'} · {formatFechaHora(ultimoConteo?.fecha)} · {item.estado === 'RecuentoRequerido' ? 'Administración pidió volver a contar' : 'Hace falta un segundo conteo'}</p></div>
              <div className="grid gap-3 sm:grid-cols-2">{lineas.map((l: any) => <label key={l.producto} className="text-xs font-bold text-neutral-700">{l.producto} · {l.unidad}
                <span className="block font-normal text-neutral-500">Sistema {l.cantidadSistema} · conteo anterior {l.cantidadRecontada ?? l.cantidadContada}</span>
                <input aria-label={`Reconteo ${l.producto} guía ${item.referenciaId}`} type="number" min="0" step="0.001" value={valoresReconteo[item.id]?.[l.producto] ?? String(l.cantidadContada)}
                  onChange={e => setValoresReconteo(prev => ({ ...prev, [item.id]: { ...(prev[item.id] || {}), [l.producto]: e.target.value } }))}
                  className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-base font-bold" />
              </label>)}</div>
              <button type="button" disabled={procesandoReconteo === item.id} onClick={() => void enviarReconteo(item)} className="min-h-11 rounded-lg bg-orange-700 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50">{procesandoReconteo === item.id ? 'Guardando…' : 'Guardar reconteo independiente'}</button>
            </article>;
          })}
          </div>
        </details>
      )}

      {inventarioCuarentena.length > 0 && (
        <details className="group rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] open:border-violet-200 open:bg-violet-50/40">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-[var(--bg-card-hover)] [&::-webkit-details-marker]:hidden">
            <div><h3 className="text-sm font-extrabold text-[var(--text-primary)]">Producto en cuarentena</h3><p className="text-xs text-[var(--text-secondary)]">No está disponible hasta resolver su revisión.</p></div>
            <span className="shrink-0 rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-900">{inventarioCuarentena.length} en revisión</span>
          </summary>
          <div className="space-y-3 border-t border-[var(--border-default)] p-4">
          {inventarioCuarentena.map(caso => {
            const esAdmin = (currentUser.roles?.length ? currentUser.roles : [currentUser.role]).includes('Admin');
            const candidatas = etiquetasGeneradas.filter(e => e.producto === caso.producto);
            const seleccionadas = etiquetasReempaqueSeleccionadas[caso.id] || [];
            const totalSeleccionado = candidatas.filter(e => seleccionadas.includes(e.id)).reduce((s, e) => s + Number(e.cantidad || 0), 0);
            let etiquetasVinculadas: any[] = [];
            try { etiquetasVinculadas = JSON.parse(caso.etiquetasReemplazoJson || '[]'); } catch { etiquetasVinculadas = []; }
            return <article key={caso.id} className="rounded-xl border border-violet-100 bg-white p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="font-bold text-neutral-900">{caso.producto} · {caso.cantidad} {caso.unidad}</p><p className="text-xs text-neutral-600">Guía {caso.guiaId} · diferencia sistema {Number(caso.cantidad) - Number(caso.cantidadSistema)} · {caso.estado}</p></div>
                {esAdmin && caso.estado === 'Aprobada' && <button type="button" onClick={() => void liberarCuarentena(caso)} className="min-h-11 rounded-lg bg-violet-700 px-4 py-2 text-sm font-extrabold text-white">Liberar tras investigar</button>}
              </div>
              {caso.estado === 'Aprobada' && esAdmin && !caso.etiquetasReemplazoJson && <div className="rounded-lg border border-violet-100 bg-violet-50 p-3 space-y-2">
                <p className="text-xs font-bold text-violet-950">¿Se reempacó el producto?</p>
                <p className="text-xs text-violet-900">Seleccione etiquetas nuevas ya generadas para este producto. Deben sumar {caso.cantidad} {caso.unidad}.</p>
                {candidatas.length === 0 ? <p className="text-xs text-neutral-600">No hay etiquetas nuevas disponibles. Genérelas primero desde Etiquetas.</p> : <div className="max-h-36 space-y-1 overflow-auto rounded-lg bg-white p-2">
                  {candidatas.map((etiqueta: any) => <label key={etiqueta.id} className="flex min-h-9 items-center gap-2 text-xs text-neutral-800">
                    <input type="checkbox" checked={seleccionadas.includes(etiqueta.id)} onChange={e => setEtiquetasReempaqueSeleccionadas(prev => ({ ...prev, [caso.id]: e.target.checked ? [...(prev[caso.id] || []), etiqueta.id] : (prev[caso.id] || []).filter(id => id !== etiqueta.id) }))} />
                    <span className="font-mono">{etiqueta.codigoUnico}</span><span>· {etiqueta.cantidad} {caso.unidad}</span>
                  </label>)}
                </div>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={cn('text-xs font-bold', Math.abs(totalSeleccionado - Number(caso.cantidad)) < 0.0001 ? 'text-emerald-700' : 'text-neutral-600')}>Seleccionado: {totalSeleccionado} / {caso.cantidad} {caso.unidad}</p>
                  <button type="button" disabled={!seleccionadas.length} onClick={() => void vincularEtiquetasReempaque(caso)} className="min-h-10 rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs font-extrabold text-violet-900 disabled:opacity-40">Vincular etiquetas de reempaque</button>
                </div>
              </div>}
              {etiquetasVinculadas.length > 0 && <p className="text-xs text-emerald-800">Reempaque vinculado: {etiquetasVinculadas.map(e => e.codigoUnico).join(', ')}. Se liberarán al resolver el caso.</p>}
            </article>;
          })}
          </div>
        </details>
      )}
          </div> : <p className="border-t border-[var(--border-default)] px-4 py-8 text-center text-sm text-[var(--text-secondary)]">No hay acciones de bodega pendientes.</p>}
        </section>
      )}

      {(mostrarExistencias || mostrarEntradas) && (
        <div className="grid gap-5 lg:grid-cols-1 lg:items-start">
{/* Columna EXISTENCIAS */}
          <div className={cn('space-y-4', !mostrarExistencias && 'hidden')}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 id="bodega-existencias-lista" className="scroll-mt-6 font-bold text-neutral-800">Existencias por producto</h3>
              <p className="text-xs text-neutral-600">El huevo se controla en kg. Los registros antiguos en cartones requieren pesaje antes de entrar al flujo normal.</p>
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
              <button onClick={() => void cargarStock()} className="btn-danger">
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
                        <p className="truncate text-xs text-neutral-600">
                          {lotes.length > 0 ? <>
                            <span className="sm:hidden">Lote: {lotes[0].lote || 'Sin lote registrado'}{lotes.length > 1 ? ` · +${lotes.length - 1}` : ''}</span>
                            <span className="hidden sm:inline">Lote{lotes.length === 1 ? '' : 's'}: {lotes.slice(0, 2).map((l: any) => l.lote || 'Sin lote registrado').join(' · ')}{lotes.length > 2 ? ` · +${lotes.length - 2}` : ''}</span>
                          </> : 'Sin lote etiquetado'}
                          {lotes.length > 0 && ` · ${lotes.length} etiqueta${lotes.length === 1 ? '' : 's'}`}
                          {p.agregado > 0 && p.etiquetados > 0 && ` · ${p.etiquetados} etiquetados + ${p.agregado} agregados`}
                        </p>
                      </div>
                      <div className="hidden sm:flex flex-col items-end mr-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Próximo vencimiento</span>
                        <span className="text-xs font-bold text-neutral-600">{p.fechaVencimientoProxima ? `${formatFecha(p.fechaVencimientoProxima)}${p.diasProximo !== null ? ` · ${p.diasProximo}d` : ''}` : '—'}</span>
                      </div>
                      <div className="text-right mr-2">
                        <p className="text-2xl font-black text-neutral-800 leading-none">{p.total}</p>
                        <p className="text-[10px] text-neutral-500 font-medium">{p.unidad === 'cartones' && /huevo/i.test(String(p.producto)) ? 'empaques · kg pendiente' : p.unidad}</p>
                      </div>
                      <ChipEstado estado={p.estado} />
                    </button>
                    {abierto && (
                      <div className="border-t border-neutral-100 bg-neutral-50/40">
                        {lotes.length === 0 ? (
                          <p className="px-6 py-4 text-sm text-neutral-400">Saldo sin etiqueta individual. Pesa el producto en kg para alistarlo y mantener su trazabilidad.</p>
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

          {/* Seguimiento de entradas: etapas claras y avance recuperable. */}
          <div id="bodega-ingresos-pendientes" className={cn('space-y-3 scroll-mt-6', !mostrarEntradas && 'hidden')}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-extrabold text-[var(--text-primary)]">Seguimiento de entradas</h3>
                <p className="text-sm text-[var(--text-secondary)]">Ubica la carga y retoma su recepción cuando estés listo.</p>
              </div>
              <span className="shrink-0 rounded-full bg-[var(--brand-primary-soft)] px-3 py-1.5 text-sm font-bold text-[var(--text-primary)]">{gruposEntradas.length} cargas</span>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)]">
              <div className="grid grid-cols-3 border-b border-[var(--border-default)] bg-[var(--bg-page)] p-2 sm:p-3" role="tablist" aria-label="Etapa de entradas">
                {([
                  ['camino', 'En camino', gruposEnCamino.length, Truck],
                  ['recepcion', 'En recepción', gruposEnRecepcion.length, Scale],
                  ['completados', 'Completados', gruposCompletados.length, CheckCircle2],
                ] as const).map(([id, label, count, Icon]) => (
                  <button key={id} type="button" role="tab" aria-selected={pestanaEntradas === id} onClick={() => setPestanaEntradas(id)}
                    className={cn('flex min-h-12 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-extrabold transition sm:gap-2 sm:text-sm', pestanaEntradas === id ? 'bg-[var(--brand-primary)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]')}>
                    <Icon className="h-4 w-4 shrink-0" /><span>{label}</span><span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', pestanaEntradas === id ? 'bg-white/20 text-white' : 'bg-[var(--bg-card)] text-[var(--text-secondary)]')}>{count}</span>
                  </button>
                ))}
              </div>
              <div className="grid gap-2 border-b border-[var(--border-default)] p-3 sm:grid-cols-[1fr_190px_auto] sm:items-center">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input aria-label="Buscar entradas" value={busquedaEntradas} onChange={e => setBusquedaEntradas(e.target.value)} placeholder="Buscar camión, granja, producto o guía…" className="min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-page)] pl-10 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
                </label>
                <label className="sr-only" htmlFor="bodega-fecha-entrada">Filtrar por fecha</label>
                <input id="bodega-fecha-entrada" aria-label="Filtrar entradas por fecha" type="date" value={fechaEntradas} onChange={e => setFechaEntradas(e.target.value)} className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--bg-page)] px-3 text-sm text-[var(--text-primary)]" />
                <button type="button" onClick={() => { setBusquedaEntradas(''); setFechaEntradas(''); }} disabled={!busquedaEntradas && !fechaEntradas} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[var(--text-link)] hover:bg-[var(--bg-card-hover)] disabled:opacity-40">Limpiar</button>
              </div>
              <div className="flex items-center justify-between px-4 py-2 text-xs text-[var(--text-muted)]"><span>{gruposFiltrados.length} {gruposFiltrados.length === 1 ? 'carga' : 'cargas'}</span>{cargandoBorradores && <span>Actualizando avances…</span>}</div>
              {gruposFiltrados.length === 0 ? (
                <div className="px-4 py-9 text-center">
                  {pestanaEntradas === 'completados' ? <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600" /> : <Truck className="mx-auto mb-2 h-8 w-8 text-[var(--text-muted)]" />}
                  <p className="font-bold text-[var(--text-primary)]">{busquedaEntradas || fechaEntradas ? 'No encontramos cargas' : pestanaEntradas === 'camino' ? 'No hay cargas en camino' : pestanaEntradas === 'recepcion' ? 'No hay recepciones iniciadas' : 'Aún no hay cargas completadas'}</p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{busquedaEntradas || fechaEntradas ? 'Prueba con otro término o fecha.' : 'Las cargas aparecerán aquí conforme avance su recepción.'}</p>
                </div>
              ) : <div className="divide-y divide-[var(--border-default)]">{gruposFiltrados.map(grupo => {
                const requierePeso = grupo.movs.some((m: any) => /huevo/i.test(String(m.producto)) && m.unidad !== 'kg');
                const etapa = grupo.completados ? 'Completado' : grupo.enRecepcion ? 'En recepción' : 'En camino';
                const etapaStyle = grupo.completados ? 'bg-[var(--status-success-soft)] text-[var(--status-success)]' : grupo.enRecepcion ? 'bg-[var(--status-warning-soft)] text-[var(--status-warning)]' : 'bg-[var(--brand-primary-soft)] text-[var(--text-primary)]';
                return <article key={grupo.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', grupo.completados ? 'bg-[var(--status-success-soft)] text-[var(--status-success)]' : grupo.enRecepcion ? 'bg-[var(--status-warning-soft)] text-[var(--status-warning)]' : 'bg-[var(--brand-primary-soft)] text-[var(--text-primary)]')}>
                      {grupo.completados ? <CheckCircle2 className="h-5 w-5" /> : grupo.enRecepcion ? <Scale className="h-5 w-5" /> : <Truck className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><p className="truncate font-extrabold text-[var(--text-primary)]">{grupo.camionNombre}</p><span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', etapaStyle)}>{etapa}</span></div>
                      <p className="truncate text-sm text-[var(--text-secondary)]">{grupo.origen.startsWith('Granja') ? grupo.origen : `Granja ${grupo.origen}`} · {formatFechaCorta(grupo.fecha)}</p>
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{grupo.productos} · {grupo.productosUnicos.length} {grupo.productosUnicos.length === 1 ? 'producto' : 'productos'}{grupo.tipo === 'Remisión' && grupo.movsTodos[0].consecutivo ? ` · Guía ${grupo.movsTodos[0].consecutivo}` : ''}</p>
                      {grupo.borrador && <p className="mt-1 text-xs font-semibold text-[var(--status-warning)]">Avance guardado · puedes continuar donde quedaste</p>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-left sm:text-right"><p className="font-extrabold text-[var(--text-primary)]">{grupo.completados ? grupo.totalKg > 0 ? `${grupo.totalKg.toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg` : 'Recepción registrada' : requierePeso ? 'Peso pendiente' : `${grupo.totalKg.toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg`}</p><p className="text-xs text-[var(--text-muted)]">{grupo.completados ? 'Recepción registrada' : requierePeso ? 'requiere báscula' : `${grupo.movs.length} ${grupo.movs.length === 1 ? 'línea pendiente' : 'líneas pendientes'}`}</p></div>
                    {!grupo.completados && <button type="button" onClick={() => abrirWizard(grupo)} className="min-h-11 shrink-0 rounded-xl px-4 py-2 text-sm font-extrabold text-white hover:brightness-95" style={{ background: 'var(--brand-primary)' }}>{grupo.enRecepcion ? 'Continuar' : requierePeso ? 'Ver detalle' : 'Iniciar recepción'}</button>}
                  </div>
                </article>;
              })}</div>}
            </div>
          </div>
        </div>
      )}

      {mostrarEntradas && <details className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)]">
        <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
          <span>Actividad e historial · {movimientosActividad.length} movimientos</span><ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
        </summary>
        <div className="space-y-4 border-t border-[var(--border-default)] p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input aria-label="Buscar en actividad de bodega" value={busquedaActividad} onChange={e => setBusquedaActividad(e.target.value)} placeholder="Producto, lote, etiqueta, camión o referencia…" className="min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-page)] pl-10 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr_auto] sm:items-end">
            <label className="text-xs font-bold text-[var(--text-secondary)]">Desde
              <input type="date" value={desdeActividad} onChange={e => setDesdeActividad(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-page)] px-3 text-sm text-[var(--text-primary)]" />
            </label>
            <label className="text-xs font-bold text-[var(--text-secondary)]">Hasta
              <input type="date" value={hastaActividad} onChange={e => setHastaActividad(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-page)] px-3 text-sm text-[var(--text-primary)]" />
            </label>
            <label className="text-xs font-bold text-[var(--text-secondary)]">Movimiento
              <select value={tipoActividad} onChange={e => setTipoActividad(e.target.value as 'todos' | 'entradas' | 'salidas')} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-page)] px-3 text-sm text-[var(--text-primary)]">
                <option value="todos">Todos</option><option value="entradas">Entradas</option><option value="salidas">Salidas</option>
              </select>
            </label>
            <button type="button" onClick={() => { setBusquedaActividad(''); setDesdeActividad(''); setHastaActividad(''); setTipoActividad('todos'); }} disabled={!busquedaActividad && !desdeActividad && !hastaActividad && tipoActividad === 'todos'} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[var(--text-link)] hover:bg-[var(--bg-card-hover)] disabled:cursor-default disabled:opacity-45">Limpiar</button>
          </div>
          <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-2 text-sm">
            <span className="font-bold text-[var(--text-primary)]">{movimientosActividadFiltrados.length} {movimientosActividadFiltrados.length === 1 ? 'resultado' : 'resultados'}</span>
            <span className="text-xs text-[var(--text-muted)]">Lote y etiqueta aparecen cuando están vinculados.</span>
          </div>
          {movimientosActividadFiltrados.length === 0 ? <p className="rounded-xl bg-[var(--bg-page)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">No encontramos movimientos con esos filtros.</p> : (
            <div className="divide-y divide-[var(--border-default)]">
              {movimientosActividadFiltrados.map((mov: any) => {
            const entrada = mov.destino === 'Bodega Central';
            const cantidadTexto = mov.unidad === 'kg' ? `${Number(mov.cantidad).toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg` : `${Number(mov.cantidad).toLocaleString('es-CR')} empaques · kg pendiente`;
            const lotes = Array.isArray(mov.lotes) ? mov.lotes : mov.lote ? [mov.lote] : [];
            const codigos = Array.isArray(mov.codigosEtiquetas) ? mov.codigosEtiquetas : [];
            return <div key={mov.id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-bold text-[var(--text-primary)]">{entrada ? 'Entrada' : 'Salida'} · {mov.producto || 'Producto'}</span><span className="rounded-full bg-[var(--brand-primary-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--text-primary)]">{mov.tipo || 'Movimiento'}</span></div>
                <p className="text-xs text-[var(--text-muted)]">{formatFechaHora(mov.fecha)} · {mov.camionNombre || mov.granjaOrigenNombre || mov.origen || mov.destino || 'Bodega'} · {mov.reportadoPor || mov.reportadoPorNombre || mov.usuarioNombre || 'Responsable no indicado'}</p>
                {(lotes.length > 0 || codigos.length > 0 || mov.referencia_id) && <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{lotes.length > 0 ? `Lote: ${lotes.join(', ')}` : ''}{codigos.length > 0 ? `${lotes.length ? ' · ' : ''}Etiqueta: ${codigos.slice(0, 2).join(', ')}${codigos.length > 2 ? ` +${codigos.length - 2}` : ''}` : ''}{mov.referencia_id ? `${lotes.length || codigos.length ? ' · ' : ''}Ref. ${mov.consecutivo || mov.referencia_id}` : ''}</p>}
              </div>
              <span className="shrink-0 font-extrabold text-[var(--text-primary)]">{entrada ? '+' : '−'}{cantidadTexto}</span>
            </div>;
              })}
            </div>
          )}
        </div>
      </details>}

      {/* ===== CONTROL (cuadre + movimientos + trazabilidad) ===== */}
      {mostrarControl && (
        <div className="space-y-6">
          {/* Zona A · semáforo + alertas */}
          {seccionControl === 'pendientes' && (
          <details className="group rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] shadow-sm">
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--bg-card-hover)] [&::-webkit-details-marker]:hidden">
              <div><h3 className="font-bold text-[var(--text-primary)]">Alertas y cuadre de inventario</h3><p className="text-xs text-[var(--text-secondary)]">Diferencias de recepción, movimientos y custodia.</p></div>
              <span className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-extrabold', totalAlertas > 0 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900')}>{totalAlertas > 0 ? `${totalAlertas} por revisar` : 'Todo cuadra'}</span>
            </summary>
          <div className={cn('rounded-2xl border shadow-sm overflow-hidden', totalAlertas > 0 ? 'border-red-200' : 'border-emerald-200')}>
            <div className={cn('px-6 py-4 flex items-center gap-3 border-b flex-wrap', totalAlertas > 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100')}>
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', totalAlertas > 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600')}>
                <Scale className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-neutral-800">Cuadre de inventario y custodia</h3>
                <p className="text-xs text-neutral-500">Todo lo que entra y sale debe cuadrar, inclusive la custodia</p>
              </div>
              {!cargandoTablero && (
                <div className="ml-auto flex items-center gap-4 flex-wrap">
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Stock bodega</p>
                    <p className="text-sm font-bold text-neutral-900 leading-tight">{existenciaPorUnidad}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">En custodia</p>
                    <p className="text-sm font-bold text-neutral-900 leading-tight">{custodiaPorUnidad || '0'}</p>
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
                  {alertasDiferencia.map(r => (
                    <div key={r.id} className={cn('flex items-start gap-3 border rounded-xl p-4', r.tipoDiferencia === 'sobrante' ? 'bg-amber-50 border-amber-300' : 'bg-red-50 border-red-300')}>
                      <ShieldAlert className={cn('w-5 h-5 shrink-0 mt-0.5', r.tipoDiferencia === 'sobrante' ? 'text-amber-600' : 'text-red-600')} />
                      <div className="flex-1 min-w-0">
                        <p className={cn('font-bold', r.tipoDiferencia === 'sobrante' ? 'text-amber-800' : 'text-red-700')}>{ETIQUETA_TIPO_DIFERENCIA[r.tipoDiferencia as 'alerta' | 'sobrante']}</p>
                        <p className={cn('text-sm', r.tipoDiferencia === 'sobrante' ? 'text-amber-700' : 'text-red-600')}>
                          Recepción del {r.fechaRecepcion ? new Date(r.fechaRecepcion).toLocaleDateString() : ''}: esperado <strong>{r.cantidadKgEsperada ?? r.cantidadEsperada} {r.cantidadKgEsperada != null ? 'kg' : 'unidades'}</strong>, recibido <strong>{r.cantidadKgRecibida ?? r.cantidadRecibida} {r.cantidadKgRecibida != null ? 'kg' : 'unidades'}</strong>
                          {r.tipoDiferencia === 'sobrante' ? ' (sobran ' : ' (faltan '}
                          <strong>{Math.abs(Number(r.diferenciaKg ?? r.diferencia))} {r.cantidadKgEsperada != null ? 'kg' : 'unidades'}</strong>) — {r.motivoDiferencia || 'diferencia sin causa'}. Responsable: {r.responsableRecepcion || '—'}.
                        </p>
                      </div>
                      <button onClick={() => onVista('existencias')} className="shrink-0 text-sm font-bold text-red-700 hover:text-red-900 whitespace-nowrap">Revisar recepción →</button>
                    </div>
                  ))}
                  {alertasBodega.map(a => (
                    <div key={a.producto} className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                      <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-red-700">{a.producto}</p>
                        <p className="text-sm text-red-600"><strong>{a.salidas.toLocaleString('es-CR')} {a.unidad}</strong> de salidas superan lo ingresado (<strong>{a.entradas.toLocaleString('es-CR')} {a.unidad}</strong>) más lo que hay en bodega (<strong>{a.stock.toLocaleString('es-CR')} {a.unidad}</strong>). Hay <strong>{(a.salidas - a.entradas - a.stock).toLocaleString('es-CR')} {a.unidad}</strong> sin reportar.</p>
                      </div>
                      <button onClick={() => { setHistTab('salidas'); setSeccionControl('movimientos'); }} className="shrink-0 text-sm font-bold text-red-700 hover:text-red-900 whitespace-nowrap">Ver movimientos →</button>
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
                  {sobrantesPorAceptar.map(g => (
                    <div key={`sobrante-${g.guiaId}`} className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <Boxes className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-neutral-800">Sobrante físico · Guía {g.consecutivo} · {g.camionNombre || 'Sin camión'}</p>
                        <p className="text-sm text-neutral-600">Quedan <strong>{g.restanteCamion} {g.unidad || 'kg'}</strong> bajo custodia. Contá cada producto y confirmá antes del cierre.</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(g.porProducto || []).filter((linea: any) => Number(linea.saldoBajoCustodiaCamion) > 0.0001).map((linea: any) => (
                            <label key={linea.producto} className="text-[10px] font-bold text-neutral-600">{linea.producto} · {linea.unidad}
                              <input aria-label={`Conteo físico ${linea.producto} guía ${g.consecutivo}`} type="number" min="0" step="0.001"
                                value={conteoSobrante[g.guiaId]?.[linea.producto] ?? String(linea.saldoBajoCustodiaCamion)}
                                onChange={e => setConteoSobrante(prev => ({ ...prev, [g.guiaId]: { ...(prev[g.guiaId] || {}), [linea.producto]: e.target.value } }))}
                                className="ml-2 w-24 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm font-bold text-neutral-800" />
                              {Math.abs(Number(conteoSobrante[g.guiaId]?.[linea.producto] ?? linea.saldoBajoCustodiaCamion) - Number(linea.saldoBajoCustodiaCamion)) > 0.0001 && (
                                <input aria-label={`Motivo diferencia ${linea.producto} guía ${g.consecutivo}`} type="text" placeholder="Motivo de diferencia"
                                  value={motivoDiferenciaSobrante[g.guiaId]?.[linea.producto] || ''}
                                  onChange={e => setMotivoDiferenciaSobrante(prev => ({ ...prev, [g.guiaId]: { ...(prev[g.guiaId] || {}), [linea.producto]: e.target.value } }))}
                                  className="mt-1 w-52 rounded-lg border border-amber-300 px-2 py-1.5 text-sm font-normal text-neutral-800" />
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                      <button disabled={procesandoSobrante === g.guiaId} onClick={() => void aceptarSobranteFisico(g)} className="shrink-0 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50">
                        {procesandoSobrante === g.guiaId ? 'Guardando…' : 'Confirmar recepción'}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          </details>
          )}

          {/* Zona B · movimientos con gráfico time-series */}
          {seccionControl === 'movimientos' && (
          <div id="control-panel-movimientos" role="tabpanel" aria-labelledby="control-tab-movimientos" tabIndex={0} className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-visible">
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
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">Flujo por período</p>
                    {unidadesMovimientos.length > 1 && <select aria-label="Unidad del gráfico" value={unidadActivaGrafico} onChange={e => setUnidadGrafico(e.target.value)} className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs font-semibold text-neutral-700">{unidadesMovimientos.map(unidad => <option key={unidad} value={unidad}>{unidad}</option>)}</select>}
                    {unidadActivaGrafico && <span className="text-xs text-neutral-500">({unidadActivaGrafico})</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs font-bold">
                    <span className="flex items-center gap-1.5 text-emerald-700"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" /> entran +{sumasSeries.entradas.toLocaleString('es-CR')}</span>
                    <span className="flex items-center gap-1.5 text-orange-700"><span className="w-2.5 h-2.5 rounded-full bg-orange-600 inline-block" /> salen −{sumasSeries.salidas.toLocaleString('es-CR')}</span>
                  </div>
                </div>
                {graficoSeries.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-sm text-neutral-400">{unidadActivaGrafico ? `Sin movimientos en ${unidadActivaGrafico} para el período seleccionado.` : 'Sin movimientos para el período seleccionado.'}</div>
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
                                  <button onClick={() => { setTrazCodigo(''); setTraz(null); setResultadosTraz([]); setBusquedaTrazHecha(false); setSeccionControl('trazabilidad'); }} className="text-blue-600 hover:text-blue-800 font-bold">
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
          )}

          {/* Zona C · trazabilidad */}
          {seccionControl === 'trazabilidad' && (
          <div id="control-panel-trazabilidad" role="tabpanel" aria-labelledby="control-tab-trazabilidad" tabIndex={0} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4 shadow-sm sm:p-6">
            <style>{`
              @media (max-width: 640px) {
                .bodega-trace-table thead { display: none; }
                .bodega-trace-table, .bodega-trace-table tbody, .bodega-trace-table tr, .bodega-trace-table td { display: block; width: 100%; }
                .bodega-trace-table tr { border-bottom: 1px solid var(--border-default); padding: .75rem 0; }
                .bodega-trace-table td { display: grid; grid-template-columns: 7.5rem minmax(0,1fr); gap: .5rem; padding: .35rem .75rem; }
                .bodega-trace-table td::before { content: attr(data-label); color: var(--text-secondary); font-size: .75rem; font-weight: 700; }
              }
            `}</style>
            <div className="mb-5 flex items-start gap-3 border-b border-[var(--border-default)] pb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]"><QrCode className="h-5 w-5" /></div>
              <div><h3 className="font-bold text-[var(--text-primary)]">Recorrido del producto</h3><p className="text-sm text-[var(--text-secondary)]">Busca por etiqueta, lote o documento para consultar cada movimiento registrado.</p></div>
            </div>
            <div className="mb-5 flex flex-col gap-2 sm:flex-row">
              <input value={trazCodigo} onChange={e => { setTrazCodigo(e.target.value); setTraz(null); setBusquedaTrazHecha(false); setResultadosTraz([]); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void buscarTraz(); } }}
                placeholder="Filtrar por lote, producto o etiqueta" aria-label="Filtrar lotes o buscar una referencia" className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-4 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--brand-primary)]" />
              <button onClick={() => void buscarTraz()} disabled={buscandoTraz || trazCodigo.trim().length < 2} className="btn-primary min-h-11 justify-center disabled:cursor-not-allowed disabled:opacity-50">
                {buscandoTraz ? <Spinner /> : <Search className="h-4 w-4" />} Buscar
              </button>
            </div>
            {sugerenciasTraz.length > 0 && trazCodigo.trim().length >= 3 && (
              <div className="mb-4 flex flex-wrap gap-2" aria-label="Etiquetas sugeridas">
                {sugerenciasTraz.map(s => <button key={s} onClick={() => void buscarTraz(s)} className="rounded-full border border-[var(--border-default)] bg-[var(--bg-card-hover)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] hover:border-[var(--brand-primary)]">{s}</button>)}
              </div>
            )}
            {resultadosTraz.length > 1 && !traz && (
              <div className="mb-5 overflow-hidden rounded-xl border border-[var(--border-default)]">
                <p className="bg-[var(--bg-card-hover)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">Hay {resultadosTraz.length} coincidencias. Selecciona el producto que quieres revisar.</p>
                <ul className="divide-y divide-[var(--border-default)]">
                  {resultadosTraz.map((resultado: any) => <li key={resultado.codigo}><button onClick={() => void abrirTrazabilidad(resultado.codigo)} className="flex min-h-14 w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[var(--bg-card-hover)]"><span><span className="block font-semibold text-[var(--text-primary)]">{resultado.producto} {resultado.lote ? `· Lote ${resultado.lote}` : ''}</span><span className="font-mono text-xs text-[var(--text-secondary)]">{resultado.codigo}</span></span><span className="text-right text-xs text-[var(--text-secondary)]">{resultado.ubicacion || resultado.estado}{resultado.saldoKg > 0 ? ` · ${resultado.saldoKg.toLocaleString('es-CR')} kg` : ''}</span></button></li>)}
                </ul>
              </div>
            )}
            <section className="mb-6">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div><h4 className="font-bold text-[var(--text-primary)]">Lotes disponibles</h4><p className="text-xs text-[var(--text-secondary)]">Selecciona un lote para ver su recorrido completo.</p></div>
                <span className="rounded-full bg-[var(--brand-primary-soft)] px-3 py-1 text-xs font-bold text-[var(--text-primary)]">{lotesTrazFiltrados.length} {lotesTrazFiltrados.length === 1 ? 'lote' : 'lotes'}</span>
              </div>
              <div className="overflow-hidden rounded-xl border border-[var(--border-default)]">
                {cargandoLotesTraz && lotesTraz.length === 0 ? <p className="p-5 text-sm text-[var(--text-secondary)]">Cargando lotes…</p> : lotesTrazFiltrados.length === 0 ? <p className="p-5 text-sm text-[var(--text-secondary)]">No hay lotes que coincidan con el filtro.</p> : (
                  <table className="bodega-trace-table w-full text-left text-sm text-[var(--text-primary)]">
                    <thead className="bg-[var(--bg-card-hover)] text-xs uppercase tracking-wide text-[var(--text-secondary)]"><tr><th className="px-4 py-3">Lote</th><th className="px-4 py-3">Producto</th><th className="px-4 py-3">Etiquetas</th><th className="px-4 py-3">Saldo</th><th className="px-4 py-3">Ubicación</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Recorrido</th></tr></thead>
                    <tbody className="divide-y divide-[var(--border-default)]">{lotesTrazFiltrados.map((lote: any) => (
                      <tr key={lote.lote} className="align-middle hover:bg-[var(--bg-card-hover)]">
                        <td data-label="Lote" className="px-4 py-3"><span className="font-semibold">{lote.lote}</span>{lote.demo && <span className="ml-2 rounded-full bg-[var(--brand-primary-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-primary)]">Demo</span>}</td>
                        <td data-label="Producto" className="px-4 py-3">{lote.producto}</td>
                        <td data-label="Etiquetas" className="px-4 py-3">{lote.etiquetas}</td>
                        <td data-label="Saldo" className="px-4 py-3 font-bold">{Number(lote.kg || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg</td>
                        <td data-label="Ubicación" className="px-4 py-3">{lote.ubicacion}</td>
                        <td data-label="Estado" className="px-4 py-3">{lote.estado}{lote.vencimiento ? <span className="block text-xs text-[var(--text-secondary)]">Vence {formatFecha(lote.vencimiento)}</span> : null}</td>
                        <td data-label="Recorrido" className="px-4 py-3"><button type="button" onClick={() => lote.demo ? abrirLoteDemo() : void abrirTrazabilidad(lote.codigo)} className="min-h-10 rounded-lg px-3 text-xs font-bold text-[var(--text-link)] hover:bg-[var(--brand-primary-soft)]">Ver recorrido →</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </section>
            {traz ? (
              <div>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card-hover)] p-4">
                  <div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{traz.etiqueta?.producto}{traz.etiqueta?.lote ? ` · Lote ${traz.etiqueta.lote}` : ''}</p>{String(traz.etiqueta?.codigoUnico || '').startsWith('DEMO-') && <span className="rounded-full bg-[var(--brand-primary-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--text-primary)]">Datos demo</span>}</div><p className="font-mono text-sm font-semibold text-[var(--text-primary)]">{traz.etiqueta?.codigoUnico}</p></div>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm"><span className="text-[var(--text-primary)]"><strong>Estado:</strong> {traz.etiqueta?.estado}</span><span className="text-[var(--text-primary)]"><strong>Ubicación actual:</strong> {traz.etiqueta?.ubicacionActual || 'Sin ubicación'}</span><span className="text-[var(--text-primary)]"><strong>Vence:</strong> {formatFecha(traz.etiqueta?.fechaVencimiento)}</span></div>
                </div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold text-[var(--text-primary)]">Historial de movimientos</h4><p className="text-xs text-[var(--text-secondary)]">Fecha mostrada: momento en que el sistema registró el evento.</p></div>
                {(!traz.traza || traz.traza.length === 0) ? <p className="rounded-xl border border-[var(--border-default)] p-6 text-center text-sm text-[var(--text-secondary)]">No hay movimientos registrados para esta etiqueta.</p> : (
                  <div className="overflow-hidden rounded-xl border border-[var(--border-default)]">
                    <table className="bodega-trace-table w-full text-left text-sm text-[var(--text-primary)]">
                      <thead className="bg-[var(--bg-card-hover)] text-xs uppercase tracking-wide text-[var(--text-secondary)]"><tr><th className="px-4 py-3">Fecha y hora</th><th className="px-4 py-3">Movimiento</th><th className="px-4 py-3">Origen → destino</th><th className="px-4 py-3">Registrado por</th><th className="px-4 py-3">Documento / detalle</th></tr></thead>
                      <tbody className="divide-y divide-[var(--border-default)]">{traz.traza.map((evento: any) => {
                        const documento = String(evento.documentoRef || '');
                        const referenciaVisible = /^([0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{32})$/i.test(documento) ? 'Referencia interna' : documento;
                        const rutaUbicacion = evento.origenDerivado && evento.origenDerivado !== evento.ubicacion ? `${evento.origenDerivado} → ${evento.ubicacion || 'Sin destino'}` : evento.ubicacion || 'Ubicación no registrada';
                        return <tr key={evento.id} className="align-top"><td data-label="Fecha y hora" className="px-4 py-3">{formatFechaHora(evento.fecha)}</td><td data-label="Movimiento" className="px-4 py-3 font-semibold">{evento.tipoEvento}</td><td data-label="Origen → destino" className="px-4 py-3">{rutaUbicacion}{evento.origenDerivado && evento.origenDerivado !== evento.ubicacion ? <span className="ml-1 text-[10px] text-[var(--text-secondary)]">(origen deducido)</span> : null}</td><td data-label="Registrado por" className="px-4 py-3">{evento.usuario?.name || (evento.usuarioId ? 'Usuario no disponible' : 'Sistema / sin usuario')}<span className="block text-xs text-[var(--text-secondary)]">{evento.usuario?.role || ''}</span></td><td data-label="Documento / detalle" className="max-w-xs px-4 py-3"><span className="block break-words">{referenciaVisible || '—'}</span>{evento.observaciones ? <span className="mt-1 block break-words text-xs text-[var(--text-secondary)]">{evento.observaciones}</span> : null}</td></tr>;
                      })}</tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : resultadosTraz.length === 0 && busquedaTrazHecha && !buscandoTraz ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />No encontramos resultados para <strong>{trazCodigo}</strong>. Prueba con el código de etiqueta completo, el lote o una referencia de documento.</div>
            ) : !busquedaTrazHecha ? (
              <p className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card-hover)] p-4 text-center text-sm text-[var(--text-secondary)]">Elige un lote de la tabla para consultar sus movimientos, responsables y documentos.</p>
            ) : null}
          </div>
          )}

        </div>
      )}

      {mermaAbierta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setMermaAbierta(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="bodega-merma-title" className="max-h-[92dvh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-[var(--bg-card)] p-4 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--border-default)] pb-3">
              <div><h2 id="bodega-merma-title" className="text-lg font-extrabold text-[var(--text-primary)]">Merma y desperdicio</h2><p className="text-sm text-[var(--text-secondary)]">Registra y consulta pérdidas de producto.</p></div>
              <button type="button" onClick={() => setMermaAbierta(false)} aria-label="Cerrar merma" className="min-h-11 min-w-11 rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"><X className="mx-auto h-5 w-5" /></button>
            </div>
            <Desperdicios currentUser={currentUser} />
          </section>
        </div>
      )}

      {/* ===== MODAL WIZARD RECEPCIÓN (ventana nueva con escáner) ===== */}
      {wizardGrupo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
          <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[var(--bg-card)] shadow-2xl">
            {/* Header */}
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-black text-[var(--text-primary)]">Recibir producto</h3>
                <p className="truncate text-sm text-[var(--text-secondary)]">{wizardGrupo.camionNombre} · {wizardGrupo.origen.startsWith('Granja') ? wizardGrupo.origen : `Granja ${wizardGrupo.origen}`}</p>
              </div>
              <button type="button" aria-label="Guardar y cerrar recepción" onClick={() => void guardarBorradorRecepcion(wizardGrupo, cantidadesWizard, motivosWizard).finally(() => setWizardGrupo(null))} className="ml-3 min-h-11 min-w-11 shrink-0 rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"><X className="mx-auto h-5 w-5" /></button>
            </div>

            {/* Steps are hidden while a legacy shipment needs weighing first. */}
            {!wizardRequierePesaje && <div className="px-5 pt-4 flex items-center gap-2">
              <span className={cn('flex items-center gap-1 text-xs font-bold', wizardPaso === 1 ? 'text-[var(--text-primary)]' : 'text-green-700')}>
                <span className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[9px]', wizardPaso === 2 ? 'bg-green-600 text-white' : wizardPaso === 1 ? 'bg-neutral-800 text-white' : 'bg-green-600 text-white')}>
                  {wizardPaso === 2 ? '✓' : '1'}
                </span> Confirmar kilos
              </span>
              <div className={cn('h-px flex-1', wizardPaso === 2 ? 'bg-green-500' : 'bg-neutral-200')}></div>
              <span className={cn('flex items-center gap-1 text-xs font-bold', wizardPaso === 2 ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}>
                <span className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[9px]', wizardPaso === 2 ? 'bg-neutral-800 text-white' : 'bg-neutral-300 text-neutral-500')}>2</span> Etiquetas opcionales
              </span>
            </div>}

            {wizardPaso === 1 ? (
              <div className="space-y-4 p-5">
                <p className="text-sm text-[var(--text-secondary)]">{wizardRequierePesaje ? 'Este envío tiene registros antiguos. Antes de recibirlo, registra el peso real medido.' : 'Compara lo esperado con lo que llegó. Si coincide, puedes confirmar de inmediato.'}</p>
                <div className="space-y-2">
                  {wizardGrupo.movs.map((m: any) => {
                    const requierePesaje = /huevo/i.test(String(m.producto)) && m.unidad !== 'kg';
                    const recibido = cantidadesWizard[m.id] ?? Number(m.cantidad);
                    const esperado = Number(m.cantidad);
                    const difiere = recibido !== esperado;
                    if (requierePesaje) return (
                      <div key={m.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <p className="font-extrabold text-amber-950">{m.producto}</p>
                        <p className="mt-1 text-sm text-amber-900">Este envío tiene un registro antiguo de {m.cantidad} {m.unidad || 'empaques'}. Para recibirlo, primero registra el peso real en kg.</p>
                        {m.cantidadOriginal != null && <p className="mt-1 text-xs text-amber-900">El dato original se conserva en el historial.</p>}
                        {esAdminBodega ? <div className="mt-3 space-y-3">
                          <label className="block text-sm font-bold text-amber-950">Peso medido en báscula (kg)
                            <input type="number" min="0.01" step="0.01" inputMode="decimal" value={pesoCorreccionKg[m.referencia_id] || ''} onChange={e => setPesoCorreccionKg(prev => ({ ...prev, [m.referencia_id]: e.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-amber-300 bg-white px-3 text-base font-bold text-neutral-900" placeholder="Ej. 450.50" />
                          </label>
                          <label className="block text-sm font-bold text-amber-950">Motivo o referencia del pesaje
                            <input value={motivoCorreccionKg[m.referencia_id] || ''} onChange={e => setMotivoCorreccionKg(prev => ({ ...prev, [m.referencia_id]: e.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-amber-300 bg-white px-3 text-sm text-neutral-900" placeholder="Ej. Báscula de bodega, comprobante B-104" />
                          </label>
                          <button type="button" onClick={() => void corregirPesoHistorico(m)} disabled={!Number(pesoCorreccionKg[m.referencia_id]) || (motivoCorreccionKg[m.referencia_id] || '').trim().length < 8} className="min-h-11 w-full rounded-xl bg-amber-800 px-4 py-2 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">Guardar peso real</button>
                        </div> : <p className="mt-3 text-sm text-amber-900">Pide a Administración que registre el peso real. Después podrás completar la recepción desde esta lista.</p>}
                      </div>
                    );
                    return (
                      <div key={m.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-page)] p-4">
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                          <div className="min-w-0">
                            <p className="truncate font-extrabold text-[var(--text-primary)]">{m.producto}</p>
                            <p className="mt-1 text-sm text-[var(--text-secondary)]">Esperábamos <strong className="text-[var(--text-primary)]">{esperado.toLocaleString('es-CR', { maximumFractionDigits: 2 })} {m.unidad === 'kg' ? 'kg' : m.unidad || 'unidades'}</strong></p>
                          </div>
                          <label className="text-sm font-bold text-[var(--text-primary)]">¿Cuánto llegó?
                          <span className="mt-1 flex items-center gap-2">
                          <input type="number" inputMode={m.unidad === 'kg' ? 'decimal' : 'numeric'} step={m.unidad === 'kg' ? '0.01' : '1'} aria-label={`Cantidad recibida de ${m.producto} en ${m.unidad || 'unidades'}`} value={recibido} min={0}
                            onChange={e => setCantidadesWizard(prev => ({ ...prev, [m.id]: Number(e.target.value) }))}
                            className="min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-right text-lg font-extrabold text-neutral-900 focus:ring-2 focus:ring-blue-500 sm:w-36" />
                            <span className="text-sm font-bold text-[var(--text-secondary)]">{m.unidad === 'kg' ? 'kg' : m.unidad || 'unidades'}</span>
                          </span></label>
                        </div>
                        {difiere ? (
                          <label className="mt-3 block text-sm font-bold text-amber-950">La cantidad no coincide. ¿Qué pasó?
                          <select value={motivosWizard[m.id] || ''} onChange={e => setMotivosWizard(prev => ({ ...prev, [m.id]: e.target.value }))}
                            className={cn('mt-1 min-h-11 w-full rounded-xl border bg-white px-3 text-sm text-neutral-900 focus:ring-2 focus:ring-blue-500', difiere && !motivosWizard[m.id] ? 'border-amber-400' : 'border-neutral-200')}>
                            <option value="">Selecciona el motivo *</option>
                            {OPCIONES_DIFERENCIA_RECEPCION.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                          </label>
                        ) : (
                          <p className="mt-2 flex items-center gap-1 text-sm font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> La cantidad coincide</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {!wizardRequierePesaje ? <div className="grid gap-2">
                  <button type="button" onClick={() => void finalizarWizard(true)} disabled={enviandoWizard || wizardGrupo.movs.some((m: any) => Number(cantidadesWizard[m.id] ?? m.cantidad) !== Number(m.cantidad) && !(motivosWizard[m.id] || '').trim())}
                    className="min-h-12 w-full rounded-xl px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>
                    {enviandoWizard ? <SpinnerConTexto className="justify-center">Guardando recepción…</SpinnerConTexto> : 'Confirmar recepción'}
                  </button>
                  {wizardPermiteEtiquetas && <button type="button" onClick={() => setWizardPaso(2)} disabled={enviandoWizard}
                    className="min-h-11 rounded-xl px-4 py-2 text-sm font-bold text-[var(--text-link)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50">
                    Agregar etiquetas (opcional)
                  </button>}
                </div> : <p className="rounded-xl bg-[var(--bg-page)] px-3 py-3 text-sm text-[var(--text-secondary)]">Al guardar el peso real se actualiza el envío. Después vuelve a seleccionarlo para confirmar los kilos recibidos.</p>}
              </div>
            ) : (
              <div className="p-5">
                <p className="mb-3 text-sm text-[var(--text-secondary)]">Si tienes etiquetas, escanéalas para guardar la trazabilidad. Este paso es opcional.</p>

                {/* Scan input */}
                <div className="relative mb-3">
                  <input ref={scanRef} id="scan-input" value={codigoInput} onChange={e => setCodigoInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void agregarCodigo(); } }}
                    placeholder="Escanear código ETQ-… y Enter" autoFocus
                    className="w-full pl-4 pr-3 py-3 border-2 border-green-400 rounded-xl text-sm font-mono text-neutral-800 outline-none ring-2 ring-green-100 focus:ring-green-300" />
                </div>

                {codigos.length === 0 ? (
                  <p className="text-xs text-neutral-400 rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2.5 mb-3">
                    Las etiquetas válidas se marcarán en bodega con su producto identificado. Puedes continuar sin escanear.
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
                  <span className="text-neutral-500">Etiquetas escaneadas</span>
                  <span className="font-bold text-neutral-800">{codigos.filter(c => c.estado === 'pendiente').length}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void finalizarWizard(false)} disabled={enviandoWizard}
                    className="min-h-12 flex-1 rounded-xl px-4 py-3 text-sm font-extrabold text-white disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>
                    {enviandoWizard ? <SpinnerConTexto className="justify-center">Guardando recepción…</SpinnerConTexto> : 'Confirmar recepción'}
                  </button>
                  <button type="button" onClick={() => void finalizarWizard(true)} disabled={enviandoWizard}
                    className="min-h-12 rounded-xl border border-[var(--border-default)] px-3 py-2 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50">
                    Sin etiquetas
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
                <h3 className="text-lg font-black text-neutral-800">Registrar ingreso manual</h3>
                <p className="text-xs font-medium text-neutral-600">Usa esta opción si el producto llegó sin un traslado registrado.</p>
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
                <label className="block text-xs font-semibold text-neutral-600 mb-1">Cantidad (kg)</label>
                <input type="number" min="0.01" step="0.01" value={manualCantidad} onChange={e => setManualCantidad(e.target.value)} placeholder="Ej.: 12.5 kg"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm font-bold text-neutral-800 focus:ring-1 focus:ring-green-500" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-neutral-600">Lote <span className="font-normal text-neutral-400">(si se conoce)</span><input value={manualLote} onChange={e => setManualLote(e.target.value)} placeholder="Código o nombre del lote" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-normal" /></label>
                <label className="block text-xs font-semibold text-neutral-600">Vencimiento <span className="font-normal text-neutral-400">(si consta en el documento)</span><input type="date" value={manualVencimiento} onChange={e => setManualVencimiento(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-normal" /></label>
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

      <div hidden={!nuevaRemisionAbierta} aria-hidden={!nuevaRemisionAbierta} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6">
          <section role="dialog" aria-modal="true" aria-labelledby="modal-nueva-remision-titulo" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-page)] shadow-2xl">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--bg-card)] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-primary-soft)] text-[var(--text-primary)]"><Truck className="h-5 w-5" /></span>
                <div><h2 id="modal-nueva-remision-titulo" className="font-extrabold text-[var(--text-primary)]">Nueva remisión desde granja</h2><p className="text-sm text-[var(--text-secondary)]">Registra la salida que llegará a bodega.</p></div>
              </div>
              <button type="button" aria-label="Cerrar nueva remisión" onClick={() => setNuevaRemisionAbierta(false)} className="min-h-11 min-w-11 rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"><X className="mx-auto h-5 w-5" /></button>
            </header>
            <div className="overflow-y-auto p-4 sm:p-6"><DespachoAdmin currentUser={currentUser} onRefresh={onRefresh} /></div>
          </section>
      </div>
    </div>
  );
}
