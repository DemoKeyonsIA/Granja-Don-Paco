import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Truck, Check, ChevronRight, QrCode, X, History, PackageCheck } from 'lucide-react';
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

type Traslado = {
  id: string;
  cargaId: string;
  granjaOrigenId: string;
  fechaSalida: string;
  responsableEntrega: string;
  vehiculo: string | null;
  estado: string;
};
type ItemCarga = Traslado & {
  producto: string;
  cantidad: number;
  unidad: string;
  nombreGranja: string;
  recibida: boolean;
  recepcionId: string | null;
  cantidadRecibida: number | null;
  diferencia: number | null;
  motivoDiferencia: string | null;
  fechaRecepcion: string | null;
  responsableRecepcion: string | null;
};
type Carga = {
  cargaId: string;
  granjaId: string;
  nombreGranja: string;
  vehiculo: string;
  fechaSalida: string;
  responsableEntrega: string;
  items: ItemCarga[];
};

type RecepcionesMovilResponse = {
  pendientes: Carga[];
  recientes: Carga[];
  hayMasRecientes: boolean;
  siguienteOffset: number;
};

function fusionarHistorial(previas: Carga[], nuevas: Carga[]): Carga[] {
  const porCarga = new Map(previas.map(carga => [carga.cargaId, carga]));
  nuevas.forEach(carga => {
    const previa = porCarga.get(carga.cargaId);
    if (!previa) {
      porCarga.set(carga.cargaId, carga);
      return;
    }
    const items = new Map(previa.items.map(item => [item.id, item]));
    carga.items.forEach(item => items.set(item.id, item));
    porCarga.set(carga.cargaId, { ...previa, ...carga, items: Array.from(items.values()) });
  });
  const fechaMasReciente = (carga: Carga) => Math.max(0, ...carga.items.map(item => {
    const fecha = new Date(item.fechaRecepcion || '').getTime();
    return Number.isFinite(fecha) ? fecha : 0;
  }));
  return Array.from(porCarga.values()).sort((a, b) => fechaMasReciente(b) - fechaMasReciente(a));
}

export default function BodegaMovil({ currentUser }: BodegaMovilProps) {
  const [pantalla, setPantalla] = useState<'recibir' | 'detalleRecibir' | 'exito'>('recibir');
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [historial, setHistorial] = useState<Carga[]>([]);
  const [selCarga, setSelCarga] = useState<Carga | null>(null);
  const [recibidos, setRecibidos] = useState<Record<string, number>>({});
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [escaneos, setEscaneos] = useState<Escan[]>([]);
  const [ultimoScan, setUltimoScan] = useState<{ ok: boolean; msg: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorRecepcion, setErrorRecepcion] = useState('');
  const [vistaRecepciones, setVistaRecepciones] = useState<'pendientes' | 'recientes'>('pendientes');
  const [recibidaOk, setRecibidaOk] = useState<Carga | null>(null);
  const [hayMasHistorial, setHayMasHistorial] = useState(false);
  const [siguienteOffsetHistorial, setSiguienteOffsetHistorial] = useState(0);
  const [cargandoMasHistorial, setCargandoMasHistorial] = useState(false);
  const scanRef = useRef<HTMLInputElement | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga('');
    try {
      const response = await fetch('/api/operaciones/recepciones/movil', { headers: sessionHeaders(currentUser.id) });
      if (!response.ok) {
        throw new Error('No se pudieron cargar las recepciones. Revisa la conexión e inténtalo de nuevo.');
      }
      const data: RecepcionesMovilResponse = await response.json();
      if (!Array.isArray(data.pendientes) || !Array.isArray(data.recientes)) {
        throw new Error('La respuesta del servidor está incompleta. Vuelve a cargar la pantalla.');
      }
      setCargas(data.pendientes);
      setHistorial(data.recientes);
      setHayMasHistorial(Boolean(data.hayMasRecientes));
      setSiguienteOffsetHistorial(Number(data.siguienteOffset) || data.recientes.reduce((n, carga) => n + carga.items.length, 0));
    } catch (error) {
      setErrorCarga(error instanceof Error ? error.message : 'No se pudieron cargar las recepciones. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [currentUser.id]);

  const cargarMasHistorial = async () => {
    if (cargandoMasHistorial || !hayMasHistorial) return;
    setCargandoMasHistorial(true);
    try {
      const response = await fetch(`/api/operaciones/recepciones/movil?offset=${siguienteOffsetHistorial}`, { headers: sessionHeaders(currentUser.id) });
      if (!response.ok) throw new Error('No se pudieron cargar recepciones anteriores. Inténtalo de nuevo.');
      const data: RecepcionesMovilResponse = await response.json();
      if (!Array.isArray(data.recientes)) throw new Error('La respuesta del historial está incompleta.');
      setHistorial(prev => fusionarHistorial(prev, data.recientes));
      setHayMasHistorial(Boolean(data.hayMasRecientes));
      setSiguienteOffsetHistorial(Number(data.siguienteOffset) || siguienteOffsetHistorial + data.recientes.reduce((n, carga) => n + carga.items.length, 0));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar recepciones anteriores.');
    } finally {
      setCargandoMasHistorial(false);
    }
  };

  useEffect(() => { cargar(); }, [cargar]);

  const nombreGranja = (carga: Pick<Carga, 'nombreGranja'>) => carga.nombreGranja || 'Granja';

  const referenciaCarga = (carga: Pick<Carga, 'cargaId'>) => {
    const id = String(carga.cargaId || '').trim();
    const corto = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? id.slice(0, 8) : id;
    return corto ? `Carga · ${corto.toUpperCase()}` : 'Carga sin referencia';
  };

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
    !item.recibida && /huevo/i.test(item.producto) && item.unidad !== 'kg'
  ) || [];

  if (errorCarga && !cargando) {
    return (
      <div className="bodega-movil mx-auto max-w-md px-4 py-12 text-center" role="alert">
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
    setErrorRecepcion('');
    let cargaActualizada = selCarga;
    let guardadosEnIntento = 0;
    try {
      for (const it of cargaActualizada.items) {
        if (it.recibida) continue;
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
        const resultado = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(resultado.error || `No se pudo registrar ${it.producto}. Revisa la conexión e inténtalo de nuevo.`);
        }
        const fechaRecepcion = resultado.fechaRecepcion || new Date().toISOString();
        const cantidadConfirmada = esKg ? Number(resultado.cantidadKgRecibida ?? recibida) : Number(resultado.cantidadRecibida ?? recibida);
        cargaActualizada = {
          ...cargaActualizada,
          items: cargaActualizada.items.map(item => item.id === it.id ? {
            ...item,
            recibida: true,
            recepcionId: resultado.recepcionId || null,
            cantidadRecibida: cantidadConfirmada,
            diferencia: it.cantidad - cantidadConfirmada,
            motivoDiferencia: motivos[it.id] || null,
            fechaRecepcion,
            responsableRecepcion: resultado.responsableRecepcion || currentUser.name,
            estado: (it.cantidad - cantidadConfirmada) === 0 ? 'Recibido' : 'RecibidoConDiferencia',
          } : item),
        };
        guardadosEnIntento += 1;
        setSelCarga(cargaActualizada);
        setCargas(prev => prev.map(c => c.cargaId === cargaActualizada.cargaId ? cargaActualizada : c));
      }
      setRecibidaOk(cargaActualizada);
      setSelCarga(null);
      setRecibidos({});
      setMotivos({});
      setEscaneos([]);
      setUltimoScan(null);
      setPantalla('exito');
      setCargas(prev => prev.filter(c => c.cargaId !== cargaActualizada.cargaId));
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo completar la recepción. Revisa la conexión e inténtalo de nuevo.';
      const resumen = guardadosEnIntento > 0
        ? `Se registraron ${guardadosEnIntento} producto${guardadosEnIntento !== 1 ? 's' : ''} en este intento. ${mensaje} Continúa con los pendientes.`
        : mensaje;
      setErrorRecepcion(resumen);
      toast.error(resumen);
    } finally {
      setEnviando(false);
    }
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
      <div className="bodega-movil max-w-md mx-auto px-4 py-8 pb-28 animate-in fade-in">
        <section className="rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--status-success-soft)' }}>
              <Check className="w-6 h-6" style={{ color: 'var(--status-success)' }} />
            </div>
            <div>
              <h2 className="text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>Carga recibida</h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{nombreGranja(carga || { nombreGranja: '' })} · {carga?.vehiculo || 'Sin vehículo indicado'}</p>
              {carga && <p className="text-xs font-semibold mt-1 tabular-nums" style={{ color: 'var(--text-muted)' }}>{referenciaCarga(carga)}</p>}
            </div>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-default)' }}>
            {carga?.items.map(item => (
              <div key={item.id} className="py-3 flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{item.producto}</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Esperado {mostrarCantidad(item.cantidad, item.unidad)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-extrabold tabular-nums" style={{ color: 'var(--text-primary)' }}>{mostrarCantidad(item.cantidadRecibida ?? 0, item.unidad)}</p>
                  {(() => {
                    const diferencia = Number(item.diferencia ?? ((item.cantidad || 0) - (item.cantidadRecibida || 0)));
                    return <p className="text-sm font-semibold" style={{ color: diferencia ? 'var(--status-warning)' : 'var(--status-success)' }}>
                      {diferencia > 0 ? `Faltaron ${mostrarCantidad(diferencia, item.unidad)}` : diferencia < 0 ? `Sobraron ${mostrarCantidad(Math.abs(diferencia), item.unidad)}` : 'Conforme'}
                    </p>;
                  })()}
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {item.responsableRecepcion ? `Por ${item.responsableRecepcion} · ` : ''}{fechaHora(item.fechaRecepcion || '').hora}
                  </p>
                  {item.motivoDiferencia && <p className="text-xs mt-1 max-w-48" style={{ color: 'var(--text-secondary)' }}>{item.motivoDiferencia}</p>}
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>Resumen de cantidades y diferencias registradas por producto.</p>
          <button onClick={() => { setPantalla('recibir'); setVistaRecepciones('pendientes'); setRecibidaOk(null); void cargar(); }}
            className="mt-5 w-full min-h-12 px-5 py-3 rounded-xl font-bold transition-all"
            style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
            Volver a recepciones
          </button>
        </section>
      </div>
    );
  }

  // --- DETALLE: RECIBIR CARGA ---
  if (pantalla === 'detalleRecibir' && selCarga) {
    const fh = fechaHora(selCarga.fechaSalida);
    const totalesPorUnidad = selCarga.items.reduce<Record<string, { recibido: number; esperado: number }>>((totales, item) => {
      const unidad = item.unidad || 'unidades';
      const total = totales[unidad] || { recibido: 0, esperado: 0 };
      total.recibido += item.recibida ? item.cantidadRecibida ?? 0 : recibidos[item.id] ?? 0;
      total.esperado += item.cantidad;
      totales[unidad] = total;
      return totales;
    }, {});
    const historicos = huevosEnUnidadHistorica(selCarga);
    const completado = historicos.length === 0 && selCarga.items.every(i => {
      if (i.recibida) return true;
      if (!(i.id in recibidos)) return false;
      const diferencia = i.cantidad - recibidos[i.id];
      return diferencia === 0 || Boolean(motivos[i.id]);
    });
    const porContar = selCarga.items.filter(i => !i.recibida).length;
    return (
      <div className="bodega-movil max-w-md mx-auto px-4 pb-32 lg:pb-8 animate-in fade-in">
        <button onClick={() => { setPantalla('recibir'); setVistaRecepciones('pendientes'); setRecibidos({}); setMotivos({}); setEscaneos([]); setUltimoScan(null); setErrorRecepcion(''); void cargar(); }} className="flex min-h-11 items-center gap-1 px-1 py-2 text-sm font-semibold mb-4" style={{ color: 'var(--brand-primary)' }}>
          <ChevronRight className="w-4 h-4 rotate-180" /> Volver
        </button>
        <h2 className="text-xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Conteo de recepción</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          {historicos.length === 0
            ? 'Compara lo enviado con lo recibido y registra cada diferencia.'
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

        <div className="rounded-xl p-4 mb-4" style={{ background: 'var(--bg-muted)' }}>
          <p className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{nombreGranja(selCarga)}{selCarga.vehiculo ? ` · ${selCarga.vehiculo}` : ''}</p>
          <p className="text-xs font-semibold mt-1 tabular-nums break-all" style={{ color: 'var(--text-secondary)' }}>{referenciaCarga(selCarga)} · ID {selCarga.cargaId}</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{fh.fecha} · {fh.hora}{selCarga.responsableEntrega ? ` · Entrega: ${selCarga.responsableEntrega}` : ''}</p>
          <p className="text-sm font-semibold mt-2" style={{ color: 'var(--text-primary)' }}>{selCarga.items.length - porContar} de {selCarga.items.length} productos confirmados</p>
        </div>

        <details className="rounded-xl mb-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <summary className="min-h-12 px-4 py-3 flex items-center gap-2 cursor-pointer text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            <QrCode className="w-4 h-4" /> Escaneo de etiquetas (opcional)
          </summary>
          <div className="px-4 pb-4">
            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>Solo si usas un lector externo conectado al teléfono. No necesitas escanear para recibir.</p>
            <label htmlFor="bodega-scan" className="sr-only">Código de etiqueta de trazabilidad</label>
            <input
              id="bodega-scan"
              ref={scanRef}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarEscan((e.target as HTMLInputElement).value); } }}
              className="w-full min-h-12 text-base font-semibold py-3 px-3 rounded-xl outline-none"
              style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
              placeholder="Enfoca aquí y escanea"
              autoComplete="off"
            />
            {ultimoScan && <p role="status" aria-live="polite" className="text-sm font-semibold mt-2" style={{ color: ultimoScan.ok ? 'var(--status-success)' : 'var(--status-danger)' }}>{ultimoScan.msg}</p>}
            {escaneos.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
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
                  return <span key={es.codigo} className="inline-flex min-h-11 items-center gap-2 text-xs font-bold px-2 rounded-full" style={{ background: s.bg, color: s.color }}>
                    {es.codigo}<span className="normal-case font-semibold">{s.etiqueta}</span>
                    <button type="button" onClick={() => quitarEscan(es.codigo)} className="flex min-h-11 min-w-11 items-center justify-center rounded-full opacity-80 hover:opacity-100" aria-label={`Quitar ${es.codigo}`}><X className="w-4 h-4" /></button>
                  </span>;
                })}
              </div>
            )}
          </div>
        </details>

        <div className="rounded-2xl px-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <h3 className="text-sm font-bold py-4" style={{ color: 'var(--text-muted)' }}>Productos de la carga</h3>
          {selCarga.items.map(it => {
            const recibida = it.recibida ? it.cantidadRecibida ?? 0 : recibidos[it.id] ?? 0;
            const diferencia = it.cantidad - recibida;
            const tieneConteo = it.recibida || it.id in recibidos;
            const conDiferencia = tieneConteo && diferencia !== 0;
            return (
              <div key={it.id} className="py-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
                <div className="flex justify-between items-start mb-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{it.producto}</p>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Esperado: {mostrarCantidad(it.cantidad, it.unidad)}</p>
                  </div>
                  <span className="text-xs font-bold px-2 py-1 rounded-full shrink-0" style={{ background: conDiferencia ? 'var(--status-warning-soft)' : it.recibida ? 'var(--status-success-soft)' : 'var(--status-neutral-soft)', color: 'var(--text-primary)' }}>
                    {conDiferencia ? diferencia > 0 ? `Faltan ${mostrarCantidad(diferencia, it.unidad)}` : `Sobran ${mostrarCantidad(Math.abs(diferencia), it.unidad)}` : it.recibida ? 'Recibido' : tieneConteo ? 'Conforme' : 'Por contar'}
                  </span>
                </div>
                {escaneos.filter(e => e.estado === 'pendiente' && e.producto === it.producto).length > 0 ? (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold px-2 py-1 rounded-lg" style={{ background: 'var(--status-success-soft)', color: 'var(--status-success)' }}>
                      {escaneos.filter(e => e.estado === 'pendiente' && e.producto === it.producto).length} etiqueta(s) vinculada(s)
                    </span>
                  </div>
                ) : null}
                {it.recibida ? (
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recibido: {mostrarCantidad(recibida, it.unidad)}{it.motivoDiferencia ? ` · ${it.motivoDiferencia}` : ''}</p>
                ) : /huevo/i.test(it.producto) && it.unidad !== 'kg' ? (
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
                {conDiferencia && !it.recibida && !(/huevo/i.test(it.producto) && it.unidad !== 'kg') && (
                  <div>
                  <label htmlFor={`motivo-${it.id}`} className="text-sm font-semibold mt-3 mb-1 block" style={{ color: 'var(--text-primary)' }}>Indica el motivo</label>
                  <select id={`motivo-${it.id}`} value={motivos[it.id] || ''}
                    onChange={e => setMotivos(m => ({ ...m, [it.id]: e.target.value }))}
                    className="w-full min-h-12 text-base py-2 px-3 rounded-lg outline-none"
                    style={{ background: 'var(--bg-muted)', border: '1px solid var(--status-warning)', color: 'var(--text-primary)' }}>
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

        {errorRecepcion && <div role="alert" className="mt-4 rounded-xl p-4 text-sm font-semibold" style={{ background: 'var(--status-danger-soft)', color: 'var(--text-primary)' }}>{errorRecepcion}</div>}

        <div className="mt-4 rounded-xl p-4 flex justify-between items-center" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
          <div>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Conteo digitado / esperado</span>
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
              {enviando ? <SpinnerConTexto>Registrando...</SpinnerConTexto> : porContar > 0 ? `Confirmar recepción · ${porContar} pendiente${porContar !== 1 ? 's' : ''}` : 'Recepción completa'}
            </button>
            {!completado && (
              <p className="text-xs text-center mt-2" style={{ color: 'var(--text-muted)' }}>
                {historicos.length > 0
                  ? 'Administración debe corregir el peso histórico antes de confirmar.'
                  : 'Cuenta cada producto; si no coincide, indica el motivo.'}
              </p>
            )}
          </div>
        </AccionFijaMovil>
      </div>
    );
  }

  const pendientes = cargas;

  const renderCargasList = () => {
    if (vistaRecepciones === 'pendientes') {
      if (pendientes.length === 0) return (
        <div className="rounded-2xl px-5 py-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <Check className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--status-success)' }} />
          <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Todo recibido</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Las nuevas cargas aparecerán aquí.</p>
        </div>
      );
      return <div className="space-y-3">{pendientes.map(c => {
        const fh = fechaHora(c.fechaSalida);
        const yaRecibidos = c.items.filter(i => i.recibida).length;
        const enTransito = c.items.some(i => i.estado === 'EnTransito');
        return <button type="button" key={c.cargaId} onClick={() => {
          setSelCarga(c); setRecibidos({}); setMotivos({}); setEscaneos([]); setErrorRecepcion(''); setPantalla('detalleRecibir');
        }} className="w-full text-left rounded-2xl p-4 flex items-center gap-3 transition-all active:scale-[0.99]"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--status-info-soft)' }}><Truck className="w-5 h-5" style={{ color: 'var(--text-primary)' }} /></div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>{nombreGranja(c)}{c.vehiculo ? ` · ${c.vehiculo}` : ''}</p>
            <p className="text-xs font-semibold mt-1 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{referenciaCarga(c)}</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{c.items.length} producto{c.items.length !== 1 ? 's' : ''} · {fh.fecha} · {fh.hora}</p>
            {yaRecibidos > 0 && <p className="text-sm font-semibold mt-1" style={{ color: 'var(--status-warning)' }}>{yaRecibidos} producto{yaRecibidos !== 1 ? 's' : ''} ya confirmado{yaRecibidos !== 1 ? 's' : ''}</p>}
          </div>
          <div className="text-right shrink-0">
            <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: enTransito ? 'var(--status-info-soft)' : 'var(--status-warning-soft)', color: 'var(--text-primary)' }}>{enTransito ? 'En tránsito' : 'Pendiente'}</span>
            <ChevronRight className="w-5 h-5 ml-auto mt-2" style={{ color: 'var(--text-muted)' }} />
          </div>
        </button>;
      })}</div>;
    }

    if (historial.length === 0) return (
      <div className="rounded-2xl px-5 py-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        <History className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
        <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Aún no hay recepciones</p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Las cargas confirmadas aparecerán aquí.</p>
      </div>
    );
    return <div className="space-y-3">
      {historial.map(c => {
        const ultimaRecepcion = c.items.reduce((ultima, item) =>
          new Date(item.fechaRecepcion || '').getTime() > ultima ? new Date(item.fechaRecepcion || '').getTime() : ultima, 0);
        const fh = fechaHora(ultimaRecepcion ? new Date(ultimaRecepcion).toISOString() : c.fechaSalida);
        const diferencia = c.items.some(i => Number(i.diferencia || 0) !== 0);
        return <details key={c.cargaId} className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <summary className="cursor-pointer list-none">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{nombreGranja(c)}{c.vehiculo ? ` · ${c.vehiculo}` : ''}</p>
                <p className="text-xs font-semibold mt-1 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{referenciaCarga(c)}</p>
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{fh.fecha} · {fh.hora} · {c.items.length} producto{c.items.length !== 1 ? 's' : ''}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full shrink-0" style={{ background: diferencia ? 'var(--status-warning-soft)' : 'var(--status-success-soft)', color: 'var(--text-primary)' }}>
                <PackageCheck className="w-3.5 h-3.5" /> {diferencia ? 'Con diferencia' : 'Conforme'}
              </span>
            </div>
            <span className="flex items-center gap-1 text-xs font-bold mt-3" style={{ color: 'var(--brand-primary)' }}>
              <span className="bodega-detalle-cerrado">Ver detalle</span>
              <span className="bodega-detalle-abierto">Cerrar detalle</span>
              <ChevronRight className="w-4 h-4 bodega-detalle-flecha" />
            </span>
          </summary>
          <div className="mt-3 pt-3 border-t space-y-3" style={{ borderColor: 'var(--border-default)' }}>
            <p className="text-xs break-all" style={{ color: 'var(--text-muted)' }}>ID completo: {c.cargaId}</p>
            {c.items.map(item => {
              const cantidadRecibida = item.cantidadRecibida ?? 0;
              const delta = Number(item.diferencia ?? (item.cantidad - cantidadRecibida));
              const momento = fechaHora(item.fechaRecepcion || '');
              return <div key={item.id} className="border-t pt-3" style={{ borderColor: 'var(--border-default)' }}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 font-semibold" style={{ color: 'var(--text-primary)' }}>{item.producto}</span>
                  <span className="text-right shrink-0 font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{mostrarCantidad(cantidadRecibida, item.unidad)} / {mostrarCantidad(item.cantidad, item.unidad)}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: delta ? 'var(--status-warning)' : 'var(--status-success)' }}>
                  {delta > 0 ? `Faltaron ${mostrarCantidad(delta, item.unidad)}` : delta < 0 ? `Sobraron ${mostrarCantidad(Math.abs(delta), item.unidad)}` : 'Recibido conforme'}
                </p>
                {item.motivoDiferencia && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Motivo: {item.motivoDiferencia}</p>}
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {item.responsableRecepcion || 'Responsable no registrado'} · {momento.fecha} {momento.hora}
                </p>
              </div>;
            })}
          </div>
        </details>;
      })}
      {hayMasHistorial && (
        <div className="pt-1">
          <p className="text-xs text-center mb-2" style={{ color: 'var(--text-muted)' }}>Hay recepciones anteriores disponibles.</p>
          <button type="button" disabled={cargandoMasHistorial} onClick={() => void cargarMasHistorial()}
            className="w-full min-h-12 px-4 py-3 font-bold disabled:opacity-60"
            style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', borderRadius: 'var(--r-control)', border: '1px solid var(--border-default)' }}>
            {cargandoMasHistorial ? 'Cargando…' : 'Mostrar recepciones anteriores'}
          </button>
        </div>
      )}
    </div>;
  };

  // La única tarea del rol abre directamente la lista de recepciones.
  return (
      <div className="bodega-movil max-w-md mx-auto px-4 pb-8 animate-in fade-in">
        <h2 className="text-xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Recepciones</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Confirma lo que llegó y consulta lo recibido.</p>

        <div className="grid grid-cols-2 p-1 rounded-xl mb-4" role="group" aria-label="Filtrar recepciones" style={{ background: 'var(--bg-muted)' }}>
          <button type="button" aria-pressed={vistaRecepciones === 'pendientes'} onClick={() => setVistaRecepciones('pendientes')} className="min-h-11 rounded-lg px-3 text-sm font-bold"
            style={{ background: vistaRecepciones === 'pendientes' ? 'var(--bg-card)' : 'transparent', color: 'var(--text-primary)' }}>
            Por recibir <span className="tabular-nums">{pendientes.length}</span>
          </button>
          <button type="button" aria-pressed={vistaRecepciones === 'recientes'} onClick={() => setVistaRecepciones('recientes')} className="min-h-11 rounded-lg px-3 text-sm font-bold"
            style={{ background: vistaRecepciones === 'recientes' ? 'var(--bg-card)' : 'transparent', color: 'var(--text-primary)' }}>
            Recibidas <span className="tabular-nums">{historial.length}</span>
          </button>
        </div>

        {cargando ? (
          <BloqueCarga className="py-16" />
        ) : renderCargasList()}
      </div>
    );
}
