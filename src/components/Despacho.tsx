import React, { useState, useEffect } from 'react';
import { Truck, ClipboardList, RefreshCw, Check, Boxes, MapPin, X } from 'lucide-react';
import { User } from '../types';
import { toast } from 'sonner';

interface DespachoProps {
  currentUser: User;
}

export default function Despacho({ currentUser }: DespachoProps) {
  const [tab, setTab] = useState<'guias' | 'camiones'>('guias');
  const [guias, setGuias] = useState<any[]>([]);
  const [camiones, setCamiones] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Crear guía
  const [camionId, setCamionId] = useState('');
  const [rutaId, setRutaId] = useState('');
  const [rutas, setRutas] = useState<any[]>([]);
  const [etiquetaIds, setEtiquetaIds] = useState<string[]>([]);
  const [etiquetasDisponibles, setEtiquetasDisponibles] = useState<any[]>([]);
  const [responsableCarga, setResponsableCarga] = useState('');
  const [responsableTransporte, setResponsableTransporte] = useState('');
  const [pesoSalida, setPesoSalida] = useState(0);
  const [guiaDetalle, setGuiaDetalle] = useState<any>(null);

  const [modal, setModal] = useState<null | { tipo: 'cerrar' | 'camion'; guiaId?: string }>(null);
  const [pesoLlegada, setPesoLlegada] = useState('');
  const [camionNombre, setCamionNombre] = useState('');
  const [camionPlaca, setCamionPlaca] = useState('');

  const fetchGuias = async () => {
    try {
      const res = await fetch('/api/logistica/guias');
      if (res.ok) setGuias(await res.json());
    } catch { toast.error('Error al cargar guías.'); }
  };

  const fetchCamiones = async () => {
    try {
      const [camRes, etiqRes, rutRes] = await Promise.all([
        fetch('/api/logistica/camiones'),
        fetch('/api/etiquetas'),
        fetch('/api/rutas')
      ]);
      if (camRes.ok) setCamiones(await camRes.json());
      if (rutRes.ok) setRutas(await rutRes.json());
      if (etiqRes.ok) {
        const todas = await etiqRes.json();
        setEtiquetasDisponibles(todas.filter((e: any) => e.estado === 'EnBodega'));
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
    setEtiquetaIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const crearGuia = async () => {
    if (!camionId) return toast.error('Seleccione un camión');
    if (etiquetaIds.length === 0) return toast.error('Seleccione al menos una etiqueta EnBodega');
    setLoading(true);
    try {
      const res = await fetch('/api/logistica/guias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camionId, rutaId: rutaId || undefined,
          etiquetasIds: etiquetaIds,
          responsablesCarga: responsableCarga || currentUser.name,
          responsableTransporte: responsableTransporte || currentUser.name,
          pesoSalida: pesoSalida || undefined
        })
      });
      if (res.ok) {
        toast.success('Guía de despacho creada');
        setEtiquetaIds([]); setCamionId(''); setRutaId('');
        await fetchGuias(); await fetchCamiones();
      } else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const verDetalle = async (id: string) => {
    try {
      const res = await fetch(`/api/logistica/guias/${id}`);
      if (res.ok) setGuiaDetalle(await res.json());
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
  };

  const marcarEnRuta = async (id: string) => {
    try {
      const res = await fetch(`/api/logistica/guias/${id}/marcar-en-ruta`, { method: 'POST' });
      if (res.ok) { toast.success('Guía marcada EnRuta'); await fetchGuias(); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
  };

  const cerrarGuia = async (id: string) => {
    setModal({ tipo: 'cerrar', guiaId: id });
    setPesoLlegada('');
  };

  const confirmarCierre = async () => {
    if (!modal || modal.tipo !== 'cerrar' || !modal.guiaId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logistica/guias/${modal.guiaId}/cerrar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pesoLlegada: Number(pesoLlegada) || null, responsable: currentUser.name })
      });
      if (res.ok) { toast.success('Guía cerrada y reconciliada'); await fetchGuias(); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
    setModal(null);
  };

  const crearCamion = () => {
    setModal({ tipo: 'camion' });
    setCamionNombre('');
    setCamionPlaca('');
  };

  const confirmarCamion = async () => {
    const nombre = camionNombre.trim();
    if (!nombre) return toast.error('Ingresa el nombre del camión');
    setLoading(true);
    try {
      const res = await fetch('/api/logistica/camiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, placa: camionPlaca.trim() || undefined, capacidad_cartones: 500 })
      });
      if (res.ok) { toast.success('Camión creado'); await fetchCamiones(); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
    setModal(null);
  };

  const rutaActual = (camion: any) => camion.ruta_defecto || 'Sin ruta';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2"><Truck className="w-5 h-5" /> Despacho y Guías</h3>
        <button onClick={crearCamion} className="btn-neutral text-sm">+ Camión</button>
      </div>

      <div className="flex space-x-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-default)' }}>
        {[['guias', 'Guías de Despacho'], ['camiones', 'Camiones']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as any)}
            className="pb-3 text-sm font-semibold capitalize transition-colors whitespace-nowrap border-b-2"
            style={tab === key ? { color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' } : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'guias' && (
        <div className="space-y-6">
          {/* Crear guía */}
          <div className="p-4 rounded-xl space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <h4 className="font-semibold flex items-center gap-2"><ClipboardList className="w-4 h-4" /> Crear Guía de Despacho</h4>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted">Camión *</label>
                <select value={camionId} onChange={e => {
                  const id = e.target.value;
                  setCamionId(id);
                  const cam = camiones.find((c: any) => c.id === id);
                  const rutaOmatch = rutas.find((r: any) => cam && r.nombre === cam.ruta_defecto);
                  setRutaId(rutaOmatch ? rutaOmatch.id : '');
                  if (cam?.ruta_defecto) {
                    toast.info(`Ruta autocompletada: ${cam.ruta_defecto}`);
                  }
                }} className="w-full input">
                  <option value="">Seleccionar camión</option>
                  {camiones.filter((c: any) => !c.guiaActivaId).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.nombre} ({c.capacidad_cartones} cap.)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted">Ruta</label>
                {rutas.length === 0 ? (
                  <input value={rutaId} onChange={e => setRutaId(e.target.value)} placeholder="Sin rutas registradas (opcional)" disabled className="w-full input opacity-60" />
                ) : (
                  <select value={rutaId} onChange={e => setRutaId(e.target.value)} className="w-full input">
                    <option value="">Sin ruta específica</option>
                    {rutas.map((r: any) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-muted">Responsable de carga</label>
                <input value={responsableCarga} onChange={e => setResponsableCarga(e.target.value)} placeholder="Despachador" className="w-full input" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted">Responsable transporte</label>
                <input value={responsableTransporte} onChange={e => setResponsableTransporte(e.target.value)} placeholder="Vendedor/Conductor" className="w-full input" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted">Peso de salida (kg)</label>
                <input type="number" value={pesoSalida} onChange={e => setPesoSalida(Number(e.target.value))} className="w-full input" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted">Etiquetas EnBodega ({etiquetasDisponibles.length}) — seleccionar para cargar</label>
              {etiquetasDisponibles.length === 0 ? (
                <p className="text-sm text-muted">No hay etiquetas EnBodega. Aliste primero en Remisiones.</p>
              ) : (
                <div className="grid md:grid-cols-3 gap-2 mt-2 max-h-64 overflow-y-auto">
                  {etiquetasDisponibles.map((e: any) => (
                    <button key={e.id} onClick={() => toggleEtiqueta(e.id)}
                      className="p-3 rounded-lg text-left text-sm space-y-1 transition-all"
                      style={etiquetaIds.includes(e.id)
                        ? { background: 'var(--brand-primary)', color: '#fff' }
                        : { background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border-default)' }}>
                      <span className="flex items-center gap-1 font-mono text-xs">{etiquetaIds.includes(e.id) && <Check className="w-3.5 h-3.5" />}{e.codigo_unico}</span>
                      <span className="flex items-center gap-1 text-xs opacity-80"><Boxes className="w-3 h-3" /> {e.cantidad} cartones · {e.producto}</span>
                      {e.peso_bodega != null && <span className="text-xs opacity-70">peso {e.peso_bodega} kg</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={crearGuia} disabled={loading || etiquetaIds.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>
              {loading ? 'Creando...' : `Crear Guía (${etiquetaIds.length} etiquetas)`}
            </button>
          </div>

          {/* Lista de guías */}
          <div className="p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold">Guías de despacho</h4>
              <button onClick={fetchGuias} className="p-1.5 rounded-lg hover:bg-black/5"><RefreshCw className="w-4 h-4" /></button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b">
                  <th className="py-2 pr-2">Consecutivo</th><th className="py-2 pr-2">Camión</th>
                  <th className="py-2 pr-2">Cartones</th><th className="py-2 pr-2">Vendido</th>
                  <th className="py-2 pr-2">Avance</th><th className="py-2 pr-2">Estado</th><th className="py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {guias.map((g: any) => (
                  <tr key={g.id} className="border-b border-dashed">
                    <td className="py-2 pr-2 font-mono text-xs">{g.consecutivo}</td>
                    <td className="py-2 pr-2">{g.camionNombre}</td>
                    <td className="py-2 pr-2">{g.totalCartones}</td>
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
                        {(g.estado === 'Cargada' || g.estado === 'EnRuta') && <button onClick={() => cerrarGuia(g.id)} className="text-xs text-emerald-600 font-semibold">Cerrar</button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {guias.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-sm text-muted">Sin guías de despacho</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Detalle modal */}
          {guiaDetalle && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setGuiaDetalle(null)}>
              <div className="max-w-lg w-full rounded-xl p-6 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold flex items-center gap-2"><ClipboardList className="w-4 h-4" /> {guiaDetalle.consecutivo}</h4>
                  <button onClick={() => setGuiaDetalle(null)} className="text-muted hover:text-foreground">✕</button>
                </div>
                <p className="text-sm mb-2"><strong>Camion:</strong> {guiaDetalle.camionNombre} {guiaDetalle.placa && `(${guiaDetalle.placa})`} · <strong>Estado:</strong> {guiaDetalle.estado}</p>
                <p className="text-sm mb-4"><strong>Responsable carga:</strong> {guiaDetalle.responsableCarga || '—'} · <strong>Transporte:</strong> {guiaDetalle.responsableTransporte || '—'}</p>

                <table className="w-full text-xs mb-4">
                  <thead><tr className="text-left text-muted border-b"><th className="py-1 pr-2">Etiqueta</th><th className="py-1 pr-2">Producto</th><th className="py-1 pr-2">Cartones</th><th className="py-1">Estado etiqueta</th></tr></thead>
                  <tbody>
                    {guiaDetalle.detalle?.map((d: any) => (
                      <tr key={d.id} className="border-b border-dashed">
                        <td className="py-1 pr-2 font-mono">{d.codigoUnico}</td>
                        <td className="py-1 pr-2">{d.producto}</td>
                        <td className="py-1 pr-2">{d.cartones}</td>
                        <td className="py-1">{d.estadoEtiqueta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

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
      )}

      {/* Camiones */}
      {tab === 'camiones' && (
        <div className="p-4 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b">
                <th className="py-2 pr-2">Nombre</th><th className="py-2 pr-2">Placa</th>
                <th className="py-2 pr-2">Ruta</th><th className="py-2 pr-2">Capacidad</th><th className="py-2 pr-2">Estado</th><th className="py-2">Guía activa</th>
              </tr>
            </thead>
            <tbody>
              {camiones.map((c: any) => (
                <tr key={c.id} className="border-b border-dashed">
                  <td className="py-2 pr-2 font-semibold">{c.nombre}</td>
                  <td className="py-2 pr-2">{c.placa || '—'}</td>
                  <td className="py-2 pr-2">{rutaActual(c)}</td>
                  <td className="py-2 pr-2">{c.capacidad_cartones} cartones</td>
                  <td className="py-2 pr-2"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">{c.estado}</span></td>
                  <td className="py-2">{c.guiaActiva?.consecutivo || <span className="text-muted">Sin guía</span>}</td>
                </tr>
              ))}
              {camiones.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-sm text-muted">Sin camiones registrados. Cree uno con "+ Camión".</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setModal(null)}>
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-xl animate-in zoom-in-95"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                {modal.tipo === 'cerrar' ? <><RefreshCw className="w-4 h-4" /> Cerrar guía</> : <><Truck className="w-4 h-4" /> Nuevo camión</>}
              </h4>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {modal.tipo === 'cerrar' ? (
              <div className="space-y-4">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Registra el peso de llegada para reconciliar la guía con el inventario de retorno.
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
                    {loading ? 'Cerrando...' : 'Confirmar cierre'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Nombre del camión *</label>
                  <input
                    type="text"
                    value={camionNombre}
                    onChange={e => setCamionNombre(e.target.value)}
                    placeholder="Ej. Camión Ruta 3"
                    autoFocus
                    className="w-full mt-1 input"
                    style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                    onKeyDown={e => { if (e.key === 'Enter') confirmarCamion(); }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Placa (opcional)</label>
                  <input
                    type="text"
                    value={camionPlaca}
                    onChange={e => setCamionPlaca(e.target.value)}
                    placeholder="Ej. ABC-123"
                    className="w-full mt-1 input"
                    style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                    Cancelar
                  </button>
                  <button onClick={confirmarCamion} disabled={loading} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand-primary)' }}>
                    {loading ? 'Creando...' : 'Crear camión'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}