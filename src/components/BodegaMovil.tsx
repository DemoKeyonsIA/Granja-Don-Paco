import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowDownToLine, Truck, Check, AlertTriangle, ChevronRight, QrCode, X } from 'lucide-react';
import { User } from '../types';
import { OPCIONES_DIFERENCIA_RECEPCION } from '../lib/opcionesRecepcion';
import { sessionHeaders } from '../lib/session';
import { BloqueCarga, SpinnerConTexto } from './Spinner';
import { toast } from 'sonner';
import AccionFijaMovil from './AccionFijaMovil';

type ScanEstado = 'validando' | 'pendiente' | 'yaIngresada' | 'noExiste' | 'otroProducto' | 'duplicado';
type Escan = { codigo: string; estado: ScanEstado; detalle?: string; producto?: string };

interface BodegaMovilProps {
  currentUser: User;
}

type Granja = { id: string; nombre: string };
type Traslado = {
  id: string;
  cargaId: string;
  granjaOrigenId: string;
  fechaSalida: string;
  responsableEntrega: string;
  vehiculo: string | null;
  estado: string;
};
type Movimiento = {
  id: string;
  producto: string;
  cantidad: number;
  unidad?: string | null;
  tipo: string;
  referencia_id: string;
};
type ItemCarga = Traslado & { producto: string; cantidad: number; unidad: string };
type Carga = {
  cargaId: string;
  granjaId: string;
  vehiculo: string;
  fechaSalida: string;
  responsableEntrega: string;
  items: ItemCarga[];
  recibida: boolean;
};

export default function BodegaMovil({ currentUser }: BodegaMovilProps) {
  const [pantalla, setPantalla] = useState<'inicio' | 'recibir' | 'camion' | 'detalleRecibir' | 'exito'>('inicio');
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [selCarga, setSelCarga] = useState<Carga | null>(null);
  const [recibidos, setRecibidos] = useState<Record<string, number>>({});
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [escaneos, setEscaneos] = useState<Escan[]>([]);
  const [ultimoScan, setUltimoScan] = useState<{ ok: boolean; msg: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [recibidaOk, setRecibidaOk] = useState<Carga | null>(null);
  const scanRef = useRef<HTMLInputElement | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga('');
    try {
      const [trasladosRes, granjasRes, movimientosRes] = await Promise.all([
        fetch('/api/operaciones/traslados', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/granjas', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/inventario/movimientos', { headers: sessionHeaders(currentUser.id) }),
      ]);
      if (!trasladosRes.ok || !granjasRes.ok || !movimientosRes.ok) {
        throw new Error('No se pudieron cargar las cargas pendientes. Revisa la conexión e inténtalo de nuevo.');
      }
      const [tRes, gRes, mRes] = await Promise.all([trasladosRes.json(), granjasRes.json(), movimientosRes.json()]);
      if (!Array.isArray(tRes) || !Array.isArray(gRes) || !Array.isArray(mRes)) {
        throw new Error('La respuesta del servidor está incompleta. Vuelve a cargar la pantalla.');
      }
      const traslados: Traslado[] = tRes || [];
      const movs: Movimiento[] = mRes || [];
      const granjas: Granja[] = gRes || [];

      const agrupadas = new Map<string, Carga>();
      for (const t of traslados) {
        const cid = t.cargaId || t.id;
        if (!agrupadas.has(cid)) {
          agrupadas.set(cid, {
            cargaId: cid,
            granjaId: t.granjaOrigenId,
            vehiculo: t.vehiculo || '',
            fechaSalida: t.fechaSalida,
            responsableEntrega: t.responsableEntrega,
            items: [],
            recibida: false,
          });
        }
        const item: ItemCarga = { ...t, producto: 'Huevos', cantidad: 0, unidad: 'cartones' };
        const mv = movs.find(m => m.referencia_id === t.id && m.tipo === 'Traslado');
        if (mv) {
          item.producto = mv.producto;
          item.cantidad = mv.cantidad;
          item.unidad = mv.unidad || (String(mv.producto).includes('Gallinaza') ? 'sacos' : 'cartones');
        }
        const carga = agrupadas.get(cid)!;
        carga.items.push(item);
      }

      const conEstado: Carga[] = Array.from(agrupadas.values()).map(c => ({
        ...c,
        recibida: c.items.every(i => i.estado === 'Recibido' || i.estado === 'RecibidoConDiferencia'),
        granjaId: granjas.find(g => g.id === c.granjaId)?.id || c.granjaId,
        vehiculo: c.items[0]?.vehiculo || c.vehiculo || '',
        fechaSalida: c.items[0]?.fechaSalida || c.fechaSalida,
        responsableEntrega: c.items[0]?.responsableEntrega || c.responsableEntrega || '',
      }));

      const orden = new Map<string, Granja>(granjas.map(g => [g.id, g]));
      setCargas(conEstado);
      setGranjaMap(orden);
    } catch (error) {
      setErrorCarga(error instanceof Error ? error.message : 'No se pudieron cargar las cargas pendientes. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [currentUser.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const [granjaMap, setGranjaMap] = useState<Map<string, Granja>>(new Map());
  const nombreGranja = (id: string) => granjaMap.get(id)?.nombre || 'Granja';

  const fechaHora = (iso: string) => {
    const d = new Date(iso);
    const fecha = isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CR', { day: '2-digit', month: 'short' });
    const hora = isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
    return { fecha, hora };
  };

  const mostrarCantidad = (cantidad: number, unidad: string) => unidad === 'kg'
    ? `${cantidad.toFixed(2)} kg`
    : `${cantidad} ${unidad}`;

  const huevosEnUnidadHistorica = (carga: Carga | null) => carga?.items.filter(item =>
    /huevo/i.test(item.producto) && item.unidad !== 'kg'
  ) || [];

  if (errorCarga && !cargando) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center" role="alert">
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--status-danger)' }}>
          <h2 className="text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>No se cargaron las recepciones</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{errorCarga}</p>
          <button onClick={() => void cargar()} className="mt-5 min-h-12 w-full rounded-xl px-4 text-base font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
            Intentar de nuevo
          </button>
        </div>
      </div>
    );
  }

  const recibirCarga = async () => {
    if (!selCarga || enviando) return;
    if (huevosEnUnidadHistorica(selCarga).length > 0) {
      toast.error('Esta carga de huevo está registrada en cartones. Administración debe corregirla con un peso confirmado en kg.');
      return;
    }
    setEnviando(true);
    try {
      for (const it of selCarga.items) {
        const recibida = recibidos[it.id] ?? 0;
        const pendientes = escaneos
          .filter(e => e.estado === 'pendiente' && e.producto === it.producto)
          .map(e => e.codigo);
        const esKg = it.unidad === 'kg';
        const resp = await fetch('/api/operaciones/recepcion', {
          method: 'POST',
          headers: sessionHeaders(currentUser.id, true),
          body: JSON.stringify({
            trasladoId: it.id,
            ...(esKg
              ? { cantidadKgEsperada: it.cantidad, cantidadKgRecibida: recibida }
              : { cantidadEsperada: it.cantidad, cantidadRecibida: recibida }),
            motivoDiferencia: motivos[it.id] || undefined,
            producto: it.producto,
            responsableRecepcion: currentUser.name,
            etiquetasCodigos: pendientes.length > 0 ? pendientes : undefined,
          }),
        });
        if (!resp.ok) {
          const error = await resp.json().catch(() => ({}));
          throw new Error(error.error || `No se pudo registrar ${it.producto}. Revisa la conexión e inténtalo de nuevo.`);
        }
      }
      setRecibidaOk(selCarga);
      setSelCarga(null);
      setRecibidos({});
      setMotivos({});
      setEscaneos([]);
      setUltimoScan(null);
      setPantalla('exito');
      cargar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar la recepción. Revisa la conexión e inténtalo de nuevo.');
    }
    setEnviando(false);
  };

  const agregarEscan = async (codigoRaw: string) => {
    const codigo = String(codigoRaw || '').trim().toUpperCase();
    const input = scanRef.current;
    if (!codigo || !input) return;
    input.value = '';
    if (escaneos.some(e => e.codigo === codigo && e.estado !== 'noExiste')) {
      setUltimoScan({ ok: false, msg: `${codigo} ya fue escaneado` });
      return;
    }
    setEscaneos(prev => [...prev, { codigo, estado: 'validando' }]);
    setUltimoScan(null);
    try {
      const res = await fetch(`/api/etiquetas/trazabilidad/${encodeURIComponent(codigo)}`, { headers: sessionHeaders(currentUser.id) });
      if (!res.ok) {
        setEscaneos(prev => prev.map(e => e.codigo === codigo ? { ...e, estado: 'noExiste' } : e));
        setUltimoScan({ ok: false, msg: `${codigo}: etiqueta no encontrada` });
        return;
      }
      const etiqueta = await res.json();
      const item = selCarga?.items.find(i => i.producto === etiqueta.producto);
      if (!item) {
        setEscaneos(prev => prev.map(e => e.codigo === codigo ? { ...e, estado: 'otroProducto', detalle: etiqueta.producto } : e));
        setUltimoScan({ ok: false, msg: `${codigo}: ${etiqueta.producto} no está en esta carga` });
        return;
      }
      if (etiqueta.estado !== 'Generada') {
        setEscaneos(prev => prev.map(e => e.codigo === codigo ? { ...e, estado: 'yaIngresada', detalle: etiqueta.estado } : e));
        setUltimoScan({ ok: false, msg: `${codigo}: ya está ${etiqueta.estado}` });
        return;
      }
      setEscaneos(prev => prev.map(e => e.codigo === codigo ? { ...e, estado: 'pendiente', producto: etiqueta.producto } : e));
      setUltimoScan({ ok: true, msg: `✓ Etiqueta ${codigo} vinculada a ${etiqueta.producto}. Registra el peso recibido en kg.` });
    } catch {
      setEscaneos(prev => prev.map(e => e.codigo === codigo ? { ...e, estado: 'noExiste' } : e));
      setUltimoScan({ ok: false, msg: `${codigo}: error de conexión` });
    }
  };

  const quitarEscan = (codigo: string) => {
    const e = escaneos.find(x => x.codigo === codigo);
    setEscaneos(prev => prev.filter(x => x.codigo !== codigo));
    setUltimoScan(null);
  };

  // --- EXITO ---
  if (pantalla === 'exito') {
    const carga = recibidaOk;
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 animate-in fade-in">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: 'var(--status-success-soft)' }}>
          <Check className="w-10 h-10" style={{ color: 'var(--status-success)' }} />
        </div>
        <h2 className="text-2xl font-extrabold mb-2 text-center" style={{ color: 'var(--text-primary)' }}>
          ¡Carga recibida!
        </h2>
        <p className="text-sm mb-8 text-center" style={{ color: 'var(--text-muted)' }}>
          {carga?.items.length === 1 ? '1 artículo registrado en la bodega.' : `${carga?.items.length || 0} artículos registrados en la bodega.`}
        </p>
        <button onClick={() => { setPantalla('inicio'); setRecibidaOk(null); }}
          className="min-h-11 px-6 py-3 rounded-xl font-bold transition-all"
          style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
          Volver al inicio
        </button>
      </div>
    );
  }

  // --- DETALLE: RECIBIR CARGA ---
  if (pantalla === 'detalleRecibir' && selCarga) {
    const fh = fechaHora(selCarga.fechaSalida);
    const totalesPorUnidad = selCarga.items.reduce<Record<string, { recibido: number; esperado: number }>>((totales, item) => {
      const unidad = item.unidad || 'unidades';
      const total = totales[unidad] || { recibido: 0, esperado: 0 };
      total.recibido += recibidos[item.id] ?? 0;
      total.esperado += item.cantidad;
      totales[unidad] = total;
      return totales;
    }, {});
    const historicos = huevosEnUnidadHistorica(selCarga);
    const completado = historicos.length === 0 && selCarga.items.every(i => {
      if (!(i.id in recibidos)) return false;
      const diferencia = i.cantidad - recibidos[i.id];
      return diferencia === 0 || Boolean(motivos[i.id]);
    });
    return (
      <div className="max-w-md mx-auto px-4 pb-32 lg:pb-8 animate-in fade-in">
        <button onClick={() => { setPantalla('recibir'); setRecibidos({}); setMotivos({}); setEscaneos([]); setUltimoScan(null); }} className="flex min-h-11 items-center gap-1 px-1 py-2 text-sm font-semibold mb-4" style={{ color: 'var(--brand-primary)' }}>
          <ChevronRight className="w-4 h-4 rotate-180" /> Volver
        </button>
        <h2 className="text-xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Recibir carga</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          {historicos.length === 0
            ? 'Pesa la carga en kg y registra lo que recibes. Las etiquetas conservan la trazabilidad.'
            : 'Esta carga histórica está en cartones. No registres un peso estimado; solicita a Administración una corrección en kg.'}
        </p>
        {historicos.length > 0 && (
          <div role="alert" className="rounded-xl p-4 mb-5" style={{ background: 'var(--status-warning-soft)', border: '1px solid var(--status-warning)' }}>
            <p className="font-bold" style={{ color: 'var(--status-warning)' }}>Hace falta confirmar el peso</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>
              Esta carga se registró en cartones. No se puede recibir hasta convertirla con un peso real y una corrección trazable.
            </p>
          </div>
        )}

        <div className="rounded-2xl p-4 mb-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center gap-2 text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
            <QrCode className="w-4 h-4" /> ESCANEAR ETIQUETA PARA TRAZABILIDAD
          </div>
          <label htmlFor="bodega-scan" className="sr-only">Código de etiqueta de trazabilidad</label>
          <input
            id="bodega-scan"
            ref={scanRef}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarEscan((e.target as HTMLInputElement).value); } }}
            className="w-full text-base font-bold py-3 px-3 rounded-xl outline-none"
            style={{ background: 'var(--bg-muted)', border: '2px solid var(--brand-primary)', color: 'var(--text-primary)' }}
            placeholder="Escanea la etiqueta y pulsa Enter"
            autoComplete="off"
          />
          {ultimoScan && (
            <p role="status" aria-live="polite" className="text-xs font-bold mt-2" style={{ color: ultimoScan.ok ? 'var(--status-success)' : 'var(--status-danger)' }}>{ultimoScan.msg}</p>
          )}
          {escaneos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {escaneos.map(es => {
                const estilos: Record<ScanEstado, { bg: string; color: string; etiqueta: string }> = {
                  validando: { bg: 'var(--status-info-soft)', color: 'var(--status-info)', etiqueta: 'Validando…' },
                  pendiente: { bg: 'var(--status-success-soft)', color: 'var(--status-success)', etiqueta: `✓ ${es.producto || ''}` },
                  yaIngresada: { bg: 'var(--status-danger-soft)', color: 'var(--status-danger)', etiqueta: es.detalle || 'Ya ingresada' },
                  noExiste: { bg: 'var(--status-neutral-soft)', color: 'var(--text-secondary)', etiqueta: 'No existe' },
                  otroProducto: { bg: 'var(--status-warning-soft)', color: 'var(--status-warning)', etiqueta: `No en carga${es.detalle ? ` (${es.detalle})` : ''}` },
                  duplicado: { bg: 'var(--status-neutral-soft)', color: 'var(--text-secondary)', etiqueta: 'Duplicado' },
                };
                const s = estilos[es.estado];
                return (
                  <span key={es.codigo} className="inline-flex min-h-11 items-center gap-1 text-xs font-bold px-2 py-1 rounded-full" style={{ background: s.bg, color: s.color }}>
                    {es.codigo}
                    <span className="normal-case font-semibold">{s.etiqueta}</span>
                    <button onClick={() => quitarEscan(es.codigo)} className="flex min-h-11 min-w-11 items-center justify-center rounded-full opacity-80 hover:opacity-100" aria-label={`Quitar ${es.codigo}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl p-5 mb-5 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <div className="flex justify-between"><span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Granja origen</span><span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{nombreGranja(selCarga.granjaId)}</span></div>
          {selCarga.vehiculo && <div className="flex justify-between"><span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Vehículo</span><span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{selCarga.vehiculo}</span></div>}
          <div className="flex justify-between"><span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Salida</span><span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fh.fecha} · {fh.hora}</span></div>
          <div className="flex justify-between"><span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Entregó</span><span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{selCarga.responsableEntrega || '—'}</span></div>
        </div>

        <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>PRODUCTOS DE LA CARGA</p>
        <div className="space-y-4">
          {selCarga.items.map(it => {
            const recibida = recibidos[it.id] ?? 0;
            const diferencia = it.cantidad - recibida;
            const conDiferencia = it.id in recibidos && diferencia !== 0;
            return (
              <div key={it.id} className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{it.producto}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Esperado: {mostrarCantidad(it.cantidad, it.unidad)}</p>
                  </div>
                  <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: conDiferencia ? 'var(--status-warning-soft)' : 'var(--status-success-soft)', color: conDiferencia ? 'var(--status-warning)' : 'var(--status-success)' }}>
                    {conDiferencia ? diferencia > 0 ? `Faltan ${mostrarCantidad(diferencia, it.unidad)}` : `Sobran ${mostrarCantidad(Math.abs(diferencia), it.unidad)}` : it.id in recibidos ? 'Conforme' : 'Pendiente'}
                  </span>
                </div>
                {escaneos.filter(e => e.estado === 'pendiente' && e.producto === it.producto).length > 0 ? (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold px-2 py-1 rounded-lg" style={{ background: 'var(--status-success-soft)', color: 'var(--status-success)' }}>
                      {escaneos.filter(e => e.estado === 'pendiente' && e.producto === it.producto).length} etiqueta(s) vinculada(s)
                    </span>
                  </div>
                ) : null}
                {/huevo/i.test(it.producto) && it.unidad !== 'kg' ? (
                  <p className="text-sm rounded-lg p-3" style={{ background: 'var(--status-warning-soft)', color: 'var(--text-primary)' }}>
                    Registro histórico: {mostrarCantidad(it.cantidad, it.unidad)}. Se requiere convertirlo con peso confirmado en kg.
                  </p>
                ) : <>
                  <label htmlFor={`recibido-${it.id}`} className="text-sm font-bold mb-1 block" style={{ color: 'var(--text-primary)' }}>
                    {it.unidad === 'kg' ? 'Peso recibido (kg)' : `Cantidad recibida (${it.unidad})`}
                  </label>
                  <input id={`recibido-${it.id}`} type="number" inputMode={it.unidad === 'kg' ? 'decimal' : 'numeric'} step={it.unidad === 'kg' ? '0.01' : '1'} min={0} value={it.id in recibidos ? recibida : ''}
                    onChange={e => setRecibidos(r => ({ ...r, [it.id]: Number(e.target.value) }))}
                    className="w-full min-h-14 text-center text-2xl font-extrabold py-3 rounded-xl outline-none"
                    style={{
                      background: 'var(--bg-muted)',
                      border: conDiferencia ? '2px solid var(--status-warning)' : '2px solid var(--border-default)',
                      color: conDiferencia ? 'var(--status-warning)' : 'var(--text-primary)',
                    }}
                    placeholder="0" />
                </>}
                {conDiferencia && !(/huevo/i.test(it.producto) && it.unidad !== 'kg') && (
                  <div>
                  <label htmlFor={`motivo-${it.id}`} className="text-sm font-semibold mt-3 mb-1 block" style={{ color: 'var(--text-primary)' }}>Indica el motivo</label>
                  <select id={`motivo-${it.id}`} value={motivos[it.id] || ''}
                    onChange={e => setMotivos(m => ({ ...m, [it.id]: e.target.value }))}
                    className="w-full min-h-12 text-base py-2 px-3 rounded-lg outline-none bg-white"
                    style={{ border: '1px solid var(--status-warning)', color: 'var(--text-primary)' }}>
                    <option value="">Motivo de la diferencia…</option>
                    {OPCIONES_DIFERENCIA_RECEPCION.filter(o => diferencia < 0 ? o.tipo === 'sobrante' : o.tipo !== 'sobrante').map(o => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl p-4 flex justify-between items-center" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
          <div>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Recibido / esperado</span>
            {Object.entries(totalesPorUnidad).map(([unidad, total]) => (
              <p key={unidad} className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {unidad === 'kg' ? `${total.recibido.toFixed(2)} / ${total.esperado.toFixed(2)} kg` : `${total.recibido} / ${total.esperado} ${unidad}`}
              </p>
            ))}
          </div>
        </div>

        <AccionFijaMovil enLineaEnEscritorio etiquetaAccesible="Confirmar recepción">
          <div className="mx-auto max-w-md">
            <button disabled={enviando || !completado}
              onClick={recibirCarga}
              className="w-full min-h-12 rounded-xl text-lg font-extrabold transition-all active:scale-[0.98] disabled:cursor-not-allowed"
              style={{ background: enviando || !completado ? 'var(--text-muted)' : 'var(--brand-primary)', color: 'var(--text-on-action)', opacity: enviando || !completado ? 0.65 : 1 }}>
              {enviando ? <SpinnerConTexto>Registrando...</SpinnerConTexto> : 'Confirmar recepción'}
            </button>
            {!completado && (
              <p className="text-xs text-center mt-2" style={{ color: 'var(--text-muted)' }}>
                {historicos.length > 0
                  ? 'Administración debe corregir el peso histórico antes de confirmar.'
                  : 'Registra cada cantidad; si no coincide, indica el motivo.'}
              </p>
            )}
          </div>
        </AccionFijaMovil>
      </div>
    );
  }

  // --- LISTA CARGAS (compartida: recibir / cargar camión) ---
  const pendientes = cargas.filter(c => !c.recibida && c.items.some(i => i.estado === 'EnTransito' || i.estado === 'Pendiente'));

  const renderCargasList = () => (
    <div className="space-y-3">
      {pendientes.map(c => {
        const fh = fechaHora(c.fechaSalida);
        return (
          <button key={c.cargaId} onClick={() => { setSelCarga(c); setRecibidos({}); setMotivos({}); setPantalla('detalleRecibir'); }}
            className="w-full text-left rounded-2xl p-5 flex items-center gap-4 transition-all active:scale-[0.98]"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
              <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--status-warning-soft)' }}>
              <Truck className="w-7 h-7" style={{ color: 'var(--status-warning)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                {c.vehiculo || nombreGranja(c.granjaId)}
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {c.vehiculo ? nombreGranja(c.granjaId) : `${c.items.length} artículo${c.items.length !== 1 ? 's' : ''}`}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {fh.fecha} · {fh.hora} {c.responsableEntrega ? `· ${c.responsableEntrega}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: c.items.some(i => i.estado === 'EnTransito') ? 'var(--status-info-soft)' : 'var(--status-warning-soft)', color: c.items.some(i => i.estado === 'EnTransito') ? 'var(--status-info)' : 'var(--status-warning)' }}>
                {c.items.some(i => i.estado === 'EnTransito') ? 'En tránsito' : 'Pendiente'}
              </span>
              <ChevronRight className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            </div>
          </button>
        );
      })}
    </div>
  );

  const renderVacio = () => (
    <div className="flex flex-col items-center py-16">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--bg-muted)' }}>
        <Truck className="w-8 h-8" style={{ color: 'var(--status-success)' }} />
      </div>
      <p className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Nada pendiente</p>
      <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>Los camiones enviados por el encargado aparecerán aquí</p>
    </div>
  );

  // --- LISTA: CARGAR CAMION ---
  if (pantalla === 'camion') {
    return (
      <div className="max-w-md mx-auto px-4 pb-8 animate-in fade-in">
        <button onClick={() => setPantalla('inicio')} className="flex min-h-11 items-center gap-1 px-1 py-2 text-sm font-semibold mb-4" style={{ color: 'var(--brand-primary)' }}>
          <ChevronRight className="w-4 h-4 rotate-180" /> Volver
        </button>
        <h2 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Cargar camión</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          {pendientes.length === 0 ? 'Camiones enviados de la granja' : `${pendientes.length} camión${pendientes.length !== 1 ? 'es' : ''} enviado${pendientes.length !== 1 ? 's' : ''}`}
        </p>
        {cargando ? (
          <BloqueCarga className="py-16" />
        ) : pendientes.length === 0 ? renderVacio() : renderCargasList()}
      </div>
    );
  }

  // --- LISTA: RECIBIR CARGA ---
  if (pantalla === 'recibir') {
    return (
      <div className="max-w-md mx-auto px-4 pb-8 animate-in fade-in">
        <button onClick={() => setPantalla('inicio')} className="flex min-h-11 items-center gap-1 px-1 py-2 text-sm font-semibold mb-4" style={{ color: 'var(--brand-primary)' }}>
          <ChevronRight className="w-4 h-4 rotate-180" /> Volver
        </button>
        <h2 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Recibir carga</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          {pendientes.length === 0 ? 'No hay camiones por recibir' : `${pendientes.length} camión${pendientes.length !== 1 ? 'es' : ''} esperando`}
        </p>

        {cargando ? (
          <BloqueCarga className="py-16" />
        ) : pendientes.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--bg-muted)' }}>
              <Check className="w-8 h-8" style={{ color: 'var(--status-success)' }} />
            </div>
            <p className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Todo recibido</p>
            <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>No hay camiones en tránsito pendientes de recibir</p>
          </div>
        ) : renderCargasList()}
      </div>
    );
  }

  // --- INICIO ---
  const recPend = cargas.filter(c => !c.recibida && c.items.some(i => i.estado === 'EnTransito' || i.estado === 'Pendiente')).length;
  const camPend = recPend;

  return (
    <div className="max-w-md mx-auto px-4 pb-8 animate-in fade-in">
      <div className="mb-8">
        <h2 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>
          Hola, {currentUser.name.split(' ')[0]} 👋
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>¿Qué quieres hacer hoy?</p>
      </div>

      {cargando ? (
        <BloqueCarga className="py-16" />
      ) : (
        <div className="space-y-4">
          <button onClick={() => setPantalla('recibir')}
            className="w-full text-left rounded-3xl p-6 transition-all active:scale-[0.98]"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'var(--status-warning-soft)' }}>
                <ArrowDownToLine className="w-7 h-7" style={{ color: 'var(--status-warning)' }} />
              </div>
              <div className="flex-1">
                <p className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Recibir carga</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargas que llegan de la granja</p>
              </div>
              {recPend > 0 && (
                <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }}>
                  {recPend} camión{recPend !== 1 ? 'es' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm font-semibold" style={{ color: 'var(--brand-primary)' }}>
              {recPend === 0 ? 'Ver camiones recibidos' : 'Ir a recibir'} <ChevronRight className="w-4 h-4" />
            </div>
          </button>

          <button onClick={() => setPantalla('camion')}
            className="w-full text-left rounded-3xl p-6 transition-all active:scale-[0.98]"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'var(--status-info-soft)' }}>
                <Truck className="w-7 h-7" style={{ color: 'var(--status-info)' }} />
              </div>
              <div className="flex-1">
                <p className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Cargar camión</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Camiones enviados de la granja</p>
              </div>
              {camPend > 0 && (
                <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: 'var(--status-info-soft)', color: 'var(--status-info)' }}>
                  {camPend} camión{camPend !== 1 ? 'es' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm font-semibold" style={{ color: 'var(--brand-primary)' }}>
              Ver camiones <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
