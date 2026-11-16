import React, { useState, useEffect } from 'react';
import { Truck, RefreshCw, AlertTriangle, PackageOpen, Banknote, CreditCard, RotateCcw, TrendingDown, Hash, ClipboardCheck, ShoppingCart, X, MapPin, ExternalLink, CheckCircle2, Map as MapIcon } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { SpinnerConTexto } from './Spinner';
import { useTablero } from '../hooks/useTablero';
import { sessionHeaders } from '../lib/session';
import CajaRuta from './CajaRuta';

interface TableroRutasProps {
  currentUser: User;
}

const fmtCRC = (n: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(n || 0);
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
const googleMapsEmbedKey = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_MAPS_EMBED_API_KEY || '';

const ubicacionParada = (parada: any) => {
  if (parada.latitud != null && parada.longitud != null) return `${parada.latitud},${parada.longitud}`;
  return [parada.direccion || parada.nombre, 'Costa Rica'].filter(Boolean).join(', ');
};

const urlGoogleMapsParadas = (paradas: any[]) => {
  const ubicaciones = paradas.map(ubicacionParada).filter(Boolean).slice(0, 5);
  if (ubicaciones.length === 0) return '';
  if (ubicaciones.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ubicaciones[0])}`;
  const params = new URLSearchParams({ api: '1', origin: ubicaciones[0], destination: ubicaciones[ubicaciones.length - 1], travelmode: 'driving' });
  if (ubicaciones.length > 2) params.set('waypoints', ubicaciones.slice(1, -1).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

function MapaRutaSimulada({ guia, guias, onSelectGuia }: { guia: any; guias: any[]; onSelectGuia: (id: string) => void }) {
  const paradas: any[] = Array.isArray(guia?.paradas) ? guia.paradas : [];
  const ubicaciones = paradas.map(ubicacionParada);
  const puedeMostrarGoogle = Boolean(googleMapsEmbedKey) && ubicaciones.length >= 2;
  const embedParadas = ubicaciones.slice(0, 22);
  const embedParams = new URLSearchParams({ key: googleMapsEmbedKey, origin: embedParadas[0] || '', destination: embedParadas[embedParadas.length - 1] || '', mode: 'driving', language: 'es', region: 'cr', units: 'metric' });
  if (embedParadas.length > 2) embedParams.set('waypoints', embedParadas.slice(1, -1).join('|'));
  const embedUrl = puedeMostrarGoogle ? `https://www.google.com/maps/embed/v1/directions?${embedParams.toString()}` : '';
  const urlAbrirMaps = urlGoogleMapsParadas(paradas);
  const atendidas = paradas.filter(p => p.atendida).length;
  const siguiente = paradas.find(p => !p.atendida);
  const progreso = paradas.length ? Math.round((atendidas / paradas.length) * 100) : 0;
  const coords = paradas.map((p, i) => ({ ...p, i })).filter(p => p.latitud != null && p.longitud != null && Number.isFinite(Number(p.latitud)) && Number.isFinite(Number(p.longitud)));
  const todasConCoords = paradas.length > 1 && coords.length === paradas.length;
  const w = 900, h = 450, padX = 90, padY = 72;
  const lngs = coords.map(p => Number(p.longitud)), lats = coords.map(p => Number(p.latitud));
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const spanLng = Math.max(maxLng - minLng, 0.0001), spanLat = Math.max(maxLat - minLat, 0.0001);
  const puntos = paradas.map((p: any, i: number) => {
    if (todasConCoords) return { x: padX + ((Number(p.longitud) - minLng) / spanLng) * (w - padX * 2), y: h - padY - ((Number(p.latitud) - minLat) / spanLat) * (h - padY * 2) };
    const t = paradas.length <= 1 ? 0.5 : i / (paradas.length - 1);
    return { x: padX + t * (w - padX * 2), y: h / 2 + Math.sin(i * 1.25) * Math.min(92, h * 0.22) };
  });
  const polyline = puntos.map(p => `${p.x},${p.y}`).join(' ');
  const primeraPendiente = paradas.findIndex((p: any) => !p.atendida);
  const ultimoAtendido = primeraPendiente < 0 ? paradas.length - 1 : primeraPendiente - 1;
  const progresoPuntos = puntos.slice(0, Math.max(ultimoAtendido + 1, 1)).map(p => `${p.x},${p.y}`).join(' ');
  const unidad = guia?.unidad || 'kg';
  const unidadLabel = unidad === 'unidades mixtas' ? unidad : unidad;

  return (
    <section className="overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }} aria-label="Seguimiento visual de ruta">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-xl p-2.5" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}><MapIcon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>Recorrido de la ruta</h3>
            <p className="truncate text-sm" style={{ color: 'var(--text-secondary)' }}>{guia?.camionNombre || 'Camión'} · {guia?.consecutivo || 'Guía seleccionada'}{guia?.vendedorNombre ? ` · ${guia.vendedorNombre}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {guias.length > 1 && <label className="sr-only" htmlFor="guia-mapa-activa">Seleccionar ruta para ver en el mapa</label>}
          {guias.length > 1 && <select id="guia-mapa-activa" value={guia?.guiaId || ''} onChange={e => onSelectGuia(e.target.value)} className="min-h-10 max-w-full rounded-xl border px-3 py-2 text-sm font-semibold" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>
            {guias.map((g: any) => <option key={g.guiaId} value={g.guiaId}>{g.camionNombre} · {g.consecutivo}</option>)}
          </select>}
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }}><span className="h-2 w-2 rounded-full" style={{ background: 'var(--status-warning)' }} />Simulación por entregas · sin GPS</span>
          {urlAbrirMaps && <a href={urlAbrirMaps} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--brand-primary)', background: 'var(--bg-card)' }}><ExternalLink className="h-4 w-4" />Abrir paradas en Google Maps</a>}
        </div>
      </div>

      <div className="grid min-w-0 lg:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.7fr)]">
        <aside className="min-w-0 border-b p-4 lg:border-b-0 lg:border-r sm:p-5" style={{ borderColor: 'var(--border-default)' }}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Avance registrado</p><p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{atendidas}<span className="text-base font-semibold" style={{ color: 'var(--text-muted)' }}> / {paradas.length} paradas</span></p></div>
            <span className="rounded-full px-3 py-1 text-sm font-extrabold" style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}>{progreso}%</span>
          </div>
          <div className="mb-4 h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-muted)' }}><div className="h-full rounded-full transition-all" style={{ width: `${progreso}%`, background: 'var(--brand-primary)' }} /></div>
          {paradas.length > 0 ? <ol className="max-h-[370px] space-y-1 overflow-y-auto pr-1">
            {paradas.map((p: any, i: number) => {
              const esSiguiente = !p.atendida && p.clienteId === siguiente?.clienteId;
              return <li key={`${p.clienteId}-${i}`} className="relative flex gap-3 rounded-xl px-2.5 py-2.5" style={{ background: esSiguiente ? 'var(--brand-primary-soft)' : 'transparent' }}>
                <span className="relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold" style={{ background: p.atendida ? 'var(--status-success-soft)' : esSiguiente ? 'var(--brand-primary)' : 'var(--bg-muted)', color: p.atendida ? 'var(--status-success)' : esSiguiente ? 'var(--text-on-action)' : 'var(--text-muted)' }}>{p.atendida ? <CheckCircle2 className="h-4 w-4" /> : <span>{i + 1}</span>}</span>
                <span className="min-w-0 flex-1"><strong className="block truncate text-sm" style={{ color: 'var(--text-primary)' }}>{p.nombre}</strong><span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>{p.atendida ? `${p.fechaHora ? fmtHora(p.fechaHora) + ' · ' : ''}${p.tiqueteConsecutivo || 'Entrega registrada'}` : esSiguiente ? 'Siguiente parada estimada' : 'Pendiente'}</span></span>
                {esSiguiente && <MapPin className="mt-1 h-4 w-4 shrink-0" style={{ color: 'var(--brand-primary)' }} />}
              </li>;
            })}
          </ol> : <p className="rounded-xl p-3 text-sm" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>Esta guía no tiene paradas asociadas. Asigne clientes a la ruta para ver su secuencia.</p>}
          {paradas.length > 5 && <p className="mt-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>Google Maps abre hasta 5 paradas por enlace; el listado conserva el recorrido completo.</p>}
        </aside>

        <div className="min-w-0 p-3 sm:p-4">
          <div className="relative min-h-[320px] overflow-hidden rounded-xl sm:min-h-[430px]" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
            {embedUrl ? <iframe title={`Ruta de ${guia?.camionNombre || 'camión'} en Google Maps`} src={embedUrl} className="absolute inset-0 h-full w-full border-0" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : paradas.length > 0 ? (
              <>
                <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={todasConCoords ? 'Secuencia de paradas sobre coordenadas registradas' : 'Diagrama secuencial de paradas, no geográfico'}>
                  <defs><pattern id="ruta-grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M 48 0 L 0 0 0 48" fill="none" stroke="var(--border-default)" strokeWidth="1" opacity=".5" /></pattern></defs>
                  <rect width={w} height={h} fill="var(--bg-card)" /><rect width={w} height={h} fill="url(#ruta-grid)" />
                  <path d="M0 105 C190 65 180 210 360 178 S600 95 900 135 M-20 360 C160 290 270 390 430 326 S690 250 930 310 M240 -20 C275 115 210 225 270 470 M650 -20 C600 100 705 215 640 470" fill="none" stroke="var(--border-default)" strokeWidth="12" opacity=".55" />
                  {puntos.length > 1 && <polyline points={polyline} fill="none" stroke="var(--brand-primary)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={todasConCoords ? undefined : '14 12'} opacity=".72" />}
                  {puntos.length > 1 && ultimoAtendido >= 1 && <polyline points={progresoPuntos} fill="none" stroke="var(--status-success)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />}
                  {puntos.map((pt, i) => {
                    const parada = paradas[i]; const siguienteParada = !parada.atendida && parada.clienteId === siguiente?.clienteId;
                    const color = parada.atendida ? 'var(--status-success)' : siguienteParada ? 'var(--brand-primary)' : 'var(--text-muted)';
                    return <g key={`${parada.clienteId}-${i}`}><circle cx={pt.x} cy={pt.y} r={siguienteParada ? 26 : 22} fill="var(--bg-card)" stroke={color} strokeWidth="7" /><text x={pt.x} y={pt.y + 7} textAnchor="middle" fontSize="20" fontWeight="800" fill={color}>{i + 1}</text></g>;
                  })}
                </svg>
                {!googleMapsEmbedKey && <span className="absolute left-3 top-3 rounded-lg px-2.5 py-1.5 text-[11px] font-bold" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>{todasConCoords ? 'Coordenadas registradas · recorrido esquemático' : 'Secuencia esquemática · falta geolocalizar clientes'}</span>}
                {googleMapsEmbedKey && embedParadas.length < paradas.length && <span className="absolute bottom-2 left-2 rounded-lg px-2 py-1 text-[11px] font-semibold" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>Mapa limitado a 22 paradas; el avance completo está a la izquierda.</span>}
              </>
            ) : <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 p-6 text-center sm:min-h-[430px]"><MapPin className="h-10 w-10" style={{ color: 'var(--text-muted)' }} /><strong style={{ color: 'var(--text-primary)' }}>No hay paradas para mostrar</strong><span className="max-w-md text-sm" style={{ color: 'var(--text-secondary)' }}>Cuando la guía tenga clientes asignados, aquí aparecerá la secuencia de entrega.</span></div>}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl p-3" style={{ background: 'var(--bg-muted)' }}>
            {[["Cargado", guia?.totalCargado], ["Vendido", guia?.cartonesVendidos], ["Disponible", guia?.restanteCamion]].map(([label, value]) => <div key={String(label)} className="min-w-0 text-center"><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p><p className="truncate text-base font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{Number(value || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })} {unidadLabel}</p></div>)}
          </div>
          {!googleMapsEmbedKey && <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>Para mostrar el mapa interactivo de Google dentro de la app, configure una clave restringida de Maps Embed API. El enlace externo a Google Maps está disponible sin clave.</p>}
        </div>
      </div>
    </section>
  );
}

const estadoBarStyle = (estado: string) => {
  switch (estado) {
    case 'Cargada': return { color: 'var(--status-info)', bg: 'var(--status-info-soft)' };
    case 'EnRuta': return { color: 'var(--status-warning)', bg: 'var(--status-warning-soft)' };
    case 'Cerrada': return { color: 'var(--status-success)', bg: 'var(--status-success-soft)' };
    case 'CerradaConDiferencia': return { color: 'var(--status-danger)', bg: 'var(--status-danger-soft)' };
    default: return { color: 'var(--text-muted)', bg: 'var(--bg-muted)' };
  }
};

export default function TableroRutas({ currentUser }: TableroRutasProps) {
  const { guias, fecha, loading, error, refetch } = useTablero(currentUser.id);

  const [cuadreActivo, setCuadreActivo] = useState<any>(null);
  const [previewCuadre, setPreviewCuadre] = useState<any>(null);
  const [cargandoCuadre, setCargandoCuadre] = useState(false);
  const [pesoLlegada, setPesoLlegada] = useState('');
  const [mermaMotivo, setMermaMotivo] = useState('');
  const [enviandoCuadre, setEnviandoCuadre] = useState(false);
  const [guiaVenta, setGuiaVenta] = useState<any>(null);
  const [guiaMapaId, setGuiaMapaId] = useState('');
  const guiaMapa = guias.find((g: any) => g.guiaId === guiaMapaId) || guias[0] || null;

  // El error llega como string estable: un fallo continuo avisa una sola vez en
  // vez de reventar el toast cada 15 s del polling.
  useEffect(() => { if (error) toast.error(`Error: ${error}`); }, [error]);
  useEffect(() => {
    if (!guias.length) { setGuiaMapaId(''); return; }
    if (!guias.some((g: any) => g.guiaId === guiaMapaId)) setGuiaMapaId(guias[0].guiaId);
  }, [guias, guiaMapaId]);
  useEffect(() => {
    if (!guiaVenta) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setGuiaVenta(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [guiaVenta]);

  const abrirCuadre = async (g: any) => {
    setCuadreActivo(g);
    setPreviewCuadre(null);
    setPesoLlegada('');
    setMermaMotivo('');
    setCargandoCuadre(true);
    try {
      const res = await fetch(`/api/logistica/cuadre-central?guiaId=${g.guiaId}`, { headers: sessionHeaders(currentUser.id) });
      const body = await res.json();
      if (!res.ok) {
        toast.error(`Cuadre no disponible: ${body.error}`);
        setCuadreActivo(null);
        return;
      }
      setPreviewCuadre(body);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
      setCuadreActivo(null);
    } finally {
      setCargandoCuadre(false);
    }
  };

  const confirmarCuadre = async () => {
    if (!cuadreActivo) return;
    if (previewCuadre?.puedeCuadrar === false) {
      toast.error('Bodega debe resolver retornos y recibir físicamente todo el sobrante antes de cuadrar la guía.');
      return;
    }
    if (previewCuadre?.requiereAprobacion) {
      const ok = window.confirm('Este cuadre tiene diferencia y quedará pendiente de aprobación. ¿Confirmar de todas formas?');
      if (!ok) return;
    }
    setEnviandoCuadre(true);
    try {
      const res = await fetch('/api/logistica/cuadre-central', {
        method: 'POST',
        headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({
          guiaId: cuadreActivo.guiaId,
          responsable: currentUser.name,
          ...(pesoLlegada ? { pesoLlegada: Number(pesoLlegada) } : {}),
          ...(mermaMotivo ? { mermaMotivo } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(`Error: ${body.error}`); return; }
      if (body.estado === 'CerradaConDiferencia') {
        toast.warning(`Cuadre cerrado con diferencia · aprobación pendiente (${body.aprobacion?.tipo})`);
      } else {
        toast.success(`Cuadre completado · guía cerrada`);
      }
      setCuadreActivo(null);
      setPreviewCuadre(null);
      refetch(true);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setEnviandoCuadre(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Rutas y ventas</h2>
          <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <span>Supervise las entregas y registre ventas directamente desde cada guía · actualización cada 15 s · {fecha ? fmtHora(fecha) : '—'}</span>
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold"
          style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refrescar
        </button>
      </div>

      {guiaMapa && <MapaRutaSimulada guia={guiaMapa} guias={guias} onSelectGuia={setGuiaMapaId} />}

      {guias.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <Truck className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No hay guías activas en este momento.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {guias.map((g: any) => (
            <div key={g.guiaId} className="rounded-2xl p-4 sm:p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              {/* Cabecera camión */}
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl" style={{ background: estadoBarStyle(g.estado).bg }}>
                    <Truck className="w-6 h-6" style={{ color: estadoBarStyle(g.estado).color }} />
                  </div>
                  <div>
                    <p className="text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>{g.camionNombre}</p>
                    <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                      {g.consecutivo} · {g.estado}{g.finDiaFecha ? ` · caja cerrada ${fmtHora(g.finDiaFecha)}` : ''}
                    </p>
                  </div>
                </div>
                <span className="rounded-full px-3 py-1 text-xs font-extrabold" style={{ background: estadoBarStyle(g.estado).bg, color: estadoBarStyle(g.estado).color }}>
                  {g.avance}% vendido
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {g.finDiaFecha || ['Cerrada', 'CerradaConDiferencia'].includes(g.estado)
                    ? <>La caja de esta guía está cerrada. <span className="font-semibold">Use el cuadre central para completar el cierre.</span></>
                    : <>Guía abierta para ventas. El registro actualizará sus tiquetes y métricas.</>}
                </div>
                <button
                  type="button"
                  onClick={() => setGuiaVenta(g)}
                  disabled={Boolean(g.finDiaFecha) || ['Cerrada', 'CerradaConDiferencia'].includes(g.estado)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}
                >
                  <ShoppingCart className="h-4 w-4" /> Registrar venta
                </button>
              </div>

              {g.finDiaFecha && g.estado !== 'Cerrada' && (
                <div className="rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-xs" style={{ background: g.estado === 'CerradaConDiferencia' ? 'var(--status-danger-soft)' : 'var(--status-warning-soft, #fef3c7)', border: '1px solid ' + (g.estado === 'CerradaConDiferencia' ? 'var(--status-danger)' : 'var(--status-warning, #f59e0b)') }}>
                  <span className="font-bold flex items-center gap-1.5" style={{ color: g.estado === 'CerradaConDiferencia' ? 'var(--status-danger)' : 'var(--status-warning, #d97706)' }}>
                    <ClipboardCheck className="w-4 h-4 shrink-0" />
                    {g.estado === 'CerradaConDiferencia' ? 'Cuadre con diferencia pendiente de aprobación' : 'Caja cerrada · lista para cuadrar en central'}
                  </span>
                  <button
                    onClick={() => abrirCuadre(g)}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-extrabold uppercase"
                    style={{ background: 'var(--brand-primary)', color: '#fff' }}
                  >
                    Cuadrar en central
                  </button>
                </div>
              )}

              {/* Resumen de custodia: cantidades respetan la unidad real reportada por la guía. */}
              <section aria-label={`Resumen de custodia de ${g.consecutivo}`} className="grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-4" style={{ background: 'var(--border-default)', border: '1px solid var(--border-default)' }}>
                {[
                  ['Cargado', g.totalCargado],
                  ['Vendido', g.cartonesVendidos],
                  ['Retorno aceptado', g.retornoAceptado ?? 0],
                  ['Merma registrada', g.mermaRegistrada ?? 0],
                ].map(([label, value]) => (
                  <div key={String(label)} className="min-w-0 px-3 py-3 sm:px-4" style={{ background: 'var(--bg-card)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</p>
                    <p className="mt-1 text-lg font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{Number(value || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })} <span className="text-sm font-semibold">{g.unidad || 'unidades'}</span></p>
                  </div>
                ))}
              </section>

              {/* Barra de progreso */}
              <div>
                <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(g.avance, 100)}%`, background: estadoBarStyle(g.estado).color }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                  <span>{g.cartonesVendidos} / {g.totalCargado} {g.unidad || 'unidades'} vendidos</span>
                  <span>{fmtCRC(g.totalGenerado)}</span>
                </div>
              </div>

              {/* Métricas */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <Banknote className="w-3 h-3" /> Efectivo
                  </p>
                  <p className="text-sm font-extrabold" style={{ color: 'var(--status-success)' }}>{fmtCRC(g.totalEfectivo)}</p>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <CreditCard className="w-3 h-3" /> Crédito
                  </p>
                  <p className="text-sm font-extrabold" style={{ color: 'var(--brand-primary)' }}>{fmtCRC(g.totalCredito)}</p>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <RotateCcw className="w-3 h-3" /> Retornos
                  </p>
                  <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>{g.cartonesRetornados} {g.unidad || 'unidades'}</p>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: g.mermaRegistrada > 0 || g.diferenciaPendiente > 0 ? 'var(--status-danger-soft)' : 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: g.mermaRegistrada > 0 || g.diferenciaPendiente > 0 ? 'var(--status-danger)' : 'var(--text-muted)' }}>
                    <TrendingDown className="w-3 h-3" /> Merma
                  </p>
                  <p className="text-sm font-extrabold" style={{ color: g.mermaRegistrada > 0 || g.diferenciaPendiente > 0 ? 'var(--status-danger)' : 'var(--text-primary)' }}>
                    {g.mermaRegistrada ?? 0} {g.unidad || 'unidades'} registrada
                  </p>
                  {g.diferenciaPendiente > 0 && <p className="mt-1 text-[11px] font-bold" style={{ color: 'var(--status-danger)' }}>Falta explicar: {g.diferenciaPendiente} {g.unidad || 'unidades'}</p>}
                  {(g.retornoPendiente ?? 0) > 0 && <p className="mt-1 text-[11px] font-bold" style={{ color: 'var(--status-warning)' }}>Pendiente Bodega: {g.retornoPendiente} {g.unidad || 'unidades'}</p>}
                  {(g.conversionesPendientes ?? []).length > 0 && <p className="mt-1 text-[11px] font-bold" style={{ color: 'var(--status-warning)' }}>Falta configurar kg/cartón para: {g.conversionesPendientes.map((x: any) => x.producto).join(', ')}</p>}
                </div>
              </div>

              {/* Clientes de la ruta */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <PackageOpen className="w-3.5 h-3.5" /> Progreso por cliente ({g.clientesAtendidos.length}/{g.totalClientes}) · tiquetes {g.tiquetesEmitidos} emitidos · {g.tiquetesAnulados} anulados
                </p>
                <div className="flex flex-wrap gap-2">
                  {g.clientesAtendidos.map((c: any) => (
                    <span key={c.clienteId} className="inline-flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'var(--status-success-soft)', color: 'var(--status-success)', border: '1px solid var(--status-success)' }}>
                      <span>
                        {c.nombre}
                        <span className="block font-medium">{fmtHora(c.hora)} · {c.codigoUnico} · {fmtCRC(c.total)}</span>
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Alertas */}
              {(g.atrasados.length > 0 || g.saltosSecuencia.length > 0) && (
                <div className="space-y-2">
                  {g.atrasados.length > 0 && (
                    <div className="rounded-xl px-3 py-2 flex items-start gap-2 text-xs font-bold" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>Atrasados: {g.atrasados.map((a: any) => `${a.nombre} (ventana hasta ${a.ventanaFin})`).join(', ')}</span>
                    </div>
                  )}
                  {g.saltosSecuencia.length > 0 && (
                    <div className="rounded-xl px-3 py-2 flex items-start gap-2 text-xs font-bold" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
                      <Hash className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>Saltos de secuencia en tiquetes: {g.saltosSecuencia.map((s: any) => s.tiquete).join(', ')}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Registro de venta contextual a la guía seleccionada. */}
      {guiaVenta && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onClick={() => setGuiaVenta(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Registrar venta en ${guiaVenta.camionNombre}`}
            className="max-h-[96dvh] w-full max-w-7xl overflow-y-auto rounded-t-2xl p-3 sm:max-h-[92vh] sm:rounded-2xl sm:p-5"
            style={{ background: 'var(--bg-page)', border: '1px solid var(--border-default)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <div className="min-w-0">
                <h3 className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Registrar venta</h3>
                <p className="truncate text-sm" style={{ color: 'var(--text-secondary)' }}>{guiaVenta.camionNombre} · {guiaVenta.consecutivo}</p>
              </div>
              <button type="button" onClick={() => setGuiaVenta(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }} aria-label="Cerrar ventana de venta"><X className="h-5 w-5" /></button>
            </div>
            <CajaRuta currentUser={currentUser} initialGuideId={guiaVenta.guiaId} />
          </section>
        </div>
      )}

      {/* Modal Cuadre en Central */}
      {cuadreActivo && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,.55)' }} onClick={() => !enviandoCuadre && setCuadreActivo(null)}>
          <div
            className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold" style={{ color: 'var(--text-primary)' }}>Cuadrar en central</h3>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {cuadreActivo.camionNombre} · {cuadreActivo.consecutivo}
                </p>
              </div>
              <span className="rounded-full px-3 py-1 text-xs font-extrabold uppercase" style={{ background: estadoBarStyle(cuadreActivo.estado).bg, color: estadoBarStyle(cuadreActivo.estado).color }}>
                {cuadreActivo.estado}
              </span>
            </div>

            {cargandoCuadre ? (
              <div className="text-center py-8 text-sm font-bold" style={{ color: 'var(--text-muted)' }}>
                <SpinnerConTexto tamano="md" className="justify-center">Cargando cuadre…</SpinnerConTexto>
              </div>
            ) : previewCuadre ? (
              <>
                {/* Cuadre doble */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Cargado</p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>{previewCuadre.cuadre.cargado} ct</p>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>A reingresar</p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--brand-primary)' }}>{previewCuadre.cuadre.cartonesReingresar} ct</p>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: previewCuadre.cuadre.merma > 0 ? 'var(--status-danger-soft)' : 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: previewCuadre.cuadre.merma > 0 ? 'var(--status-danger)' : 'var(--text-muted)' }}>Merma</p>
                    <p className="text-sm font-extrabold" style={{ color: previewCuadre.cuadre.merma > 0 ? 'var(--status-danger)' : 'var(--text-primary)' }}>{previewCuadre.cuadre.merma} ct</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <Banknote className="w-3 h-3" /> Efectivo
                    </p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--status-success)' }}>{fmtCRC(previewCuadre.cuadre.efectivo)}</p>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <CreditCard className="w-3 h-3" /> Crédito
                    </p>
                    <p className="text-sm font-extrabold" style={{ color: 'var(--brand-primary)' }}>{fmtCRC(previewCuadre.cuadre.credito)}</p>
                  </div>
                </div>

                {previewCuadre.cuadre.detalleRetornos.length > 0 && (
                  <div className="rounded-xl px-3 py-2.5 space-y-1" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Retornos a recibir</p>
                    {previewCuadre.cuadre.detalleRetornos.map((r: any, i: number) => (
                      <p key={i} className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                        {r.producto} · {r.cartones} ct · {r.etiqueta || ''}
                      </p>
                    ))}
                  </div>
                )}

                {previewCuadre.requiereAprobacion && (
                  <div className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-xs font-bold" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', border: '1px solid var(--status-danger)' }}>
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      {previewCuadre.cuadre.tieneRetornosPendientes
                        ? `Hay ${previewCuadre.cuadre.retornoPendiente} ct pendientes de aceptación de Bodega.`
                        : previewCuadre.cuadre.retornoRechazado > 0
                        ? `Hay ${previewCuadre.cuadre.retornoRechazado} ct de retornos rechazados que siguen bajo custodia.`
                        : previewCuadre.cuadre.saldoBajoCustodiaCamion > 0
                        ? `Bodega todavía debe recibir ${previewCuadre.cuadre.saldoBajoCustodiaCamion} ct que permanecen en el camión.`
                        : previewCuadre.cuadre.descuadreFisico > 0
                        ? `Descuadre físico de ${previewCuadre.cuadre.descuadreFisico} ct: el inventario del camión (${previewCuadre.cuadre.restanteCamion} ct) no coincide con los reingresos (${previewCuadre.cuadre.cartonesReingresar} ct).`
                        : `Merma de ${previewCuadre.cuadre.merma} ct (${(previewCuadre.cuadre.mermaPct * 100).toFixed(1)}%) supera la tolerancia (${(previewCuadre.toleranciaMermaDefault * 100).toFixed(1)}%).`}
                      {' '}Se cerrará con diferencia y quedará pendiente de aprobación.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Peso de llegada (kg)</label>
                    <input
                      type="number"
                      value={pesoLlegada}
                      onChange={(e) => setPesoLlegada(e.target.value)}
                      placeholder="Opcional"
                      className="w-full rounded-xl px-3 py-2 text-sm font-bold"
                      style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Motivo de merma</label>
                    <input
                      type="text"
                      value={mermaMotivo}
                      onChange={(e) => setMermaMotivo(e.target.value)}
                      placeholder="Opcional"
                      className="w-full rounded-xl px-3 py-2 text-sm font-bold"
                      style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCuadreActivo(null)}
                    disabled={enviandoCuadre}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-bold uppercase"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmarCuadre}
                    disabled={enviandoCuadre}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-extrabold uppercase"
                    style={{ background: 'var(--brand-primary)', color: '#fff' }}
                  >
                    {enviandoCuadre ? 'Cuadrando…' : `Confirmar cuadre`}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
