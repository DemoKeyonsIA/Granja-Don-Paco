import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowDownToLine, Truck, Check, AlertTriangle, ChevronRight, Loader2, QrCode, X } from 'lucide-react';
import { User } from '../types';
import { OPCIONES_DIFERENCIA_RECEPCION } from '../lib/opcionesRecepcion';

type ScanEstado = 'validando' | 'pendiente' | 'yaIngresada' | 'noExiste' | 'otroProducto' | 'duplicado';
type Escan = { codigo: string; estado: ScanEstado; detalle?: string; producto?: string; cartones?: number };

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
    try {
      const [tRes, gRes, mRes] = await Promise.all([
        fetch('/api/operaciones/traslados').then(r => r.json()),
        fetch('/api/granjas').then(r => r.json()),
        fetch('/api/inventario/movimientos').then(r => r.json()),
      ]);
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
          item.unidad = String(mv.producto).includes('Gallinaza') ? 'sacos' : 'cartones';
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
    } catch { /* ignore */ }
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const [granjaMap, setGranjaMap] = useState<Map<string, Granja>>(new Map());
  const nombreGranja = (id: string) => granjaMap.get(id)?.nombre || 'Granja';

  const fechaHora = (iso: string) => {
    const d = new Date(iso);
    const fecha = isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });
    const hora = isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    return { fecha, hora };
  };

  const recibirCarga = async () => {
    if (!selCarga || enviando) return;
    setEnviando(true);
    try {
      let ok = true;
      for (const it of selCarga.items) {
        const recibida = recibidos[it.id] ?? 0;
        const pendientes = escaneos
          .filter(e => e.estado === 'pendiente' && e.producto === it.producto)
          .map(e => e.codigo);
        const resp = await fetch('/api/operaciones/recepcion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trasladoId: it.id,
            cantidadEsperada: it.cantidad,
            cantidadRecibida: recibida,
            motivoDiferencia: motivos[it.id] || undefined,
            producto: it.producto,
            responsableRecepcion: currentUser.name,
            etiquetasCodigos: pendientes.length > 0 ? pendientes : undefined,
          }),
        });
        if (!resp.ok) { ok = false; break; }
      }
      if (ok) {
        setRecibidaOk(selCarga);
        setSelCarga(null);
        setRecibidos({});
        setMotivos({});
        setEscaneos([]);
        setUltimoScan(null);
        setPantalla('exito');
        cargar();
      } else {
        alert('Ocurrió un error registrando la recepción. Intenta de nuevo.');
      }
    } catch { /* ignore */ }
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
      const res = await fetch(`/api/etiquetas/trazabilidad/${encodeURIComponent(codigo)}`);
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
      const cartones = 1;
      setEscaneos(prev => prev.map(e => e.codigo === codigo ? { ...e, estado: 'pendiente', producto: etiqueta.producto, cartones } : e));
      setRecibidos(r => ({ ...r, [item.id]: (r[item.id] ?? 0) + 1 }));
      setUltimoScan({ ok: true, msg: `✓ ${etiqueta.producto}: +1 cartón` });
    } catch {
      setEscaneos(prev => prev.map(e => e.codigo === codigo ? { ...e, estado: 'noExiste' } : e));
      setUltimoScan({ ok: false, msg: `${codigo}: error de conexión` });
    }
  };

  const quitarEscan = (codigo: string) => {
    const e = escaneos.find(x => x.codigo === codigo);
    setEscaneos(prev => prev.filter(x => x.codigo !== codigo));
    if (e?.estado === 'pendiente' && e.producto && selCarga) {
      const item = selCarga.items.find(i => i.producto === e.producto);
      if (item) setRecibidos(r => ({ ...r, [item.id]: Math.max(0, (r[item.id] ?? 0) - (e.cartones || 1)) }));
    }
    setUltimoScan(null);
  };

  // --- EXITO ---
  if (pantalla === 'exito') {
    const carga = recibidaOk;
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 animate-in fade-in">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: '#dcfce7' }}>
          <Check className="w-10 h-10" style={{ color: '#16a34a' }} />
        </div>
        <h2 className="text-2xl font-extrabold mb-2 text-center" style={{ color: 'var(--text-primary)' }}>
          ¡Carga recibida!
        </h2>
        <p className="text-sm mb-8 text-center" style={{ color: 'var(--text-muted)' }}>
          {carga?.items.length === 1 ? '1 artículo registrado en la bodega.' : `${carga?.items.length || 0} artículos registrados en la bodega.`}
        </p>
        <button onClick={() => { setPantalla('inicio'); setRecibidaOk(null); }}
          className="px-6 py-3 rounded-xl font-bold text-white transition-all"
          style={{ background: 'var(--brand-primary)' }}>
          Volver al inicio
        </button>
      </div>
    );
  }

  // --- DETALLE: RECIBIR CARGA ---
  if (pantalla === 'detalleRecibir' && selCarga) {
    const fh = fechaHora(selCarga.fechaSalida);
    const totalItems = selCarga.items.reduce((a, i) => a + (recibidos[i.id] ?? 0), 0);
    const totalEsperado = selCarga.items.reduce((a, i) => a + i.cantidad, 0);
    const completado = selCarga.items.every(i => (recibidos[i.id] ?? 0) > 0);
    return (
      <div className="max-w-md mx-auto px-4 pb-8 animate-in fade-in">
        <button onClick={() => { setPantalla('recibir'); setRecibidos({}); setMotivos({}); setEscaneos([]); setUltimoScan(null); }} className="flex items-center gap-1 text-sm font-semibold mb-4" style={{ color: 'var(--brand-primary)' }}>
          <ChevronRight className="w-4 h-4 rotate-180" /> Volver
        </button>
        <h2 className="text-xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Recibir carga</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Escanea cada cartón y confirma lo que recibes</p>

        <div className="rounded-2xl p-4 mb-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center gap-2 text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
            <QrCode className="w-4 h-4" /> ESCANEAR CARTÓN (1 etiqueta = 1 cartón)
          </div>
          <input
            ref={scanRef}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarEscan((e.target as HTMLInputElement).value); } }}
            className="w-full text-base font-bold py-3 px-3 rounded-xl outline-none"
            style={{ background: 'var(--bg-muted)', border: '2px solid var(--brand-primary)', color: 'var(--text-primary)' }}
            placeholder="Apunta el escáner y pulsa Enter…"
          />
          {ultimoScan && (
            <p className="text-xs font-bold mt-2" style={{ color: ultimoScan.ok ? '#16a34a' : '#b91c1c' }}>{ultimoScan.msg}</p>
          )}
          {escaneos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {escaneos.map(es => {
                const estilos: Record<ScanEstado, { bg: string; color: string; etiqueta: string }> = {
                  validando: { bg: '#e0e7ff', color: '#4338ca', etiqueta: 'Validando…' },
                  pendiente: { bg: '#dcfce7', color: '#16a34a', etiqueta: `✓ ${es.producto || ''}` },
                  yaIngresada: { bg: '#fee2e2', color: '#b91c1c', etiqueta: es.detalle || 'Ya ingresada' },
                  noExiste: { bg: '#f3f4f6', color: '#6b7280', etiqueta: 'No existe' },
                  otroProducto: { bg: '#fef9c3', color: '#a16207', etiqueta: `No en carga${es.detalle ? ` (${es.detalle})` : ''}` },
                  duplicado: { bg: '#f3f4f6', color: '#6b7280', etiqueta: 'Duplicado' },
                };
                const s = estilos[es.estado];
                return (
                  <span key={es.codigo} className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: s.bg, color: s.color }}>
                    {es.codigo}
                    <span className="normal-case font-semibold">{s.etiqueta}</span>
                    <button onClick={() => quitarEscan(es.codigo)} className="opacity-70 hover:opacity-100" aria-label={`Quitar ${es.codigo}`}>
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
            const conDiferencia = recibida > 0 && diferencia !== 0;
            return (
              <div key={it.id} className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{it.producto}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Esperado: {it.cantidad} {it.unidad}</p>
                  </div>
                  <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: conDiferencia ? '#fef9c3' : '#dcfce7', color: conDiferencia ? '#a16207' : '#16a34a' }}>
                    {conDiferencia ? `Faltan ${diferencia}` : recibida > 0 ? 'Conforme' : 'Pendiente'}
                  </span>
                </div>
                {escaneos.filter(e => e.estado === 'pendiente' && e.producto === it.producto).length > 0 ? (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold px-2 py-1 rounded-lg" style={{ background: '#dcfce7', color: '#166534' }}>
                      {escaneos.filter(e => e.estado === 'pendiente' && e.producto === it.producto).length} escaneado(s)
                    </span>
                    {it.unidad !== 'sacos' && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>esto suma al campo de abajo</span>}
                  </div>
                ) : null}
                <label className="text-xs font-bold mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  RECIBIDO ({it.unidad})
                </label>
                <input type="number" min={0} value={recibida || ''}
                  onChange={e => setRecibidos(r => ({ ...r, [it.id]: Number(e.target.value) }))}
                  className="w-full text-center text-2xl font-extrabold py-3 rounded-xl outline-none"
                  style={{
                    background: 'var(--bg-muted)',
                    border: conDiferencia ? '2px solid #f59e0b' : '2px solid var(--border-default)',
                    color: conDiferencia ? '#b45309' : 'var(--text-primary)',
                  }}
                  placeholder="0" />
                {conDiferencia && (
                  <select value={motivos[it.id] || ''}
                    onChange={e => setMotivos(m => ({ ...m, [it.id]: e.target.value }))}
                    className="w-full text-sm mt-2 py-2 px-3 rounded-lg outline-none bg-white"
                    style={{ border: '1px solid #f59e0b', color: 'var(--text-primary)' }}>
                    <option value="">Motivo de la diferencia…</option>
                    {OPCIONES_DIFERENCIA_RECEPCION.map(o => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl p-4 flex justify-between items-center" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Total recibido</span>
          <span className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>{totalItems} / {totalEsperado}</span>
        </div>

        <button disabled={enviando || !completado}
          onClick={recibirCarga}
          className="w-full mt-6 py-4 rounded-2xl text-lg font-extrabold text-white transition-all active:scale-[0.98]"
          style={{ background: enviando || !completado ? 'var(--text-muted)' : 'var(--brand-primary)', opacity: enviando || !completado ? 0.5 : 1 }}>
          {enviando ? <><Loader2 className="w-5 h-5 animate-spin inline" /> Registrando...</> : '✅ Confirmar recepción'}
        </button>
        {!completado && (
          <p className="text-xs text-center mt-2" style={{ color: 'var(--text-muted)' }}>
            Registra la cantidad recibida de cada producto para confirmar
          </p>
        )}
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
            <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#fef9c3' }}>
              <Truck className="w-7 h-7" style={{ color: '#a16207' }} />
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
              <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: c.items.some(i => i.estado === 'EnTransito') ? '#dbeafe' : '#fef9c3', color: c.items.some(i => i.estado === 'EnTransito') ? '#1d4ed8' : '#a16207' }}>
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
        <Truck className="w-8 h-8" style={{ color: '#16a34a' }} />
      </div>
      <p className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Nada pendiente</p>
      <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>Los camiones enviados por el encargado aparecerán aquí</p>
    </div>
  );

  // --- LISTA: CARGAR CAMION ---
  if (pantalla === 'camion') {
    return (
      <div className="max-w-md mx-auto px-4 pb-8 animate-in fade-in">
        <button onClick={() => setPantalla('inicio')} className="flex items-center gap-1 text-sm font-semibold mb-4" style={{ color: 'var(--brand-primary)' }}>
          <ChevronRight className="w-4 h-4 rotate-180" /> Volver
        </button>
        <h2 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Cargar camión</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          {pendientes.length === 0 ? 'Camiones enviados de la granja' : `${pendientes.length} camión${pendientes.length !== 1 ? 'es' : ''} enviado${pendientes.length !== 1 ? 's' : ''}`}
        </p>
        {cargando ? (
          <div className="flex flex-col items-center py-16">
            <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--brand-primary)' }} />
          </div>
        ) : pendientes.length === 0 ? renderVacio() : renderCargasList()}
      </div>
    );
  }

  // --- LISTA: RECIBIR CARGA ---
  if (pantalla === 'recibir') {
    return (
      <div className="max-w-md mx-auto px-4 pb-8 animate-in fade-in">
        <button onClick={() => setPantalla('inicio')} className="flex items-center gap-1 text-sm font-semibold mb-4" style={{ color: 'var(--brand-primary)' }}>
          <ChevronRight className="w-4 h-4 rotate-180" /> Volver
        </button>
        <h2 className="text-2xl font-extrabold mb-1" style={{ color: 'var(--text-primary)' }}>Recibir carga</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          {pendientes.length === 0 ? 'No hay camiones por recibir' : `${pendientes.length} camión${pendientes.length !== 1 ? 'es' : ''} esperando`}
        </p>

        {cargando ? (
          <div className="flex flex-col items-center py-16">
            <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--brand-primary)' }} />
          </div>
        ) : pendientes.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--bg-muted)' }}>
              <Check className="w-8 h-8" style={{ color: '#16a34a' }} />
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
        <div className="flex flex-col items-center py-16">
          <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--brand-primary)' }} />
        </div>
      ) : (
        <div className="space-y-4">
          <button onClick={() => setPantalla('recibir')}
            className="w-full text-left rounded-3xl p-6 transition-all active:scale-[0.98]"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#fef9c3' }}>
                <ArrowDownToLine className="w-7 h-7" style={{ color: '#a16207' }} />
              </div>
              <div className="flex-1">
                <p className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Recibir carga</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargas que llegan de la granja</p>
              </div>
              {recPend > 0 && (
                <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: '#fef9c3', color: '#a16207' }}>
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
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#dbeafe' }}>
                <Truck className="w-7 h-7" style={{ color: '#1d4ed8' }} />
              </div>
              <div className="flex-1">
                <p className="text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>Cargar camión</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Camiones enviados de la granja</p>
              </div>
              {camPend > 0 && (
                <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
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