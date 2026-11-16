import React, { useState, useEffect } from 'react';
import { Truck, ScanLine, RefreshCw, Boxes, Printer, ArrowDownToLine, X, Plus, Trash2 } from 'lucide-react';
import { User } from '../../types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { factorPara, redondear2, singularUnidad, type ProductoCatalogoParaKilos } from '../../lib/kilos';
import { esCamionero } from '../../lib/vendedores';
import { Spinner } from '../Spinner';
import { sessionHeaders } from '../../lib/session';

type LineaTraslado = { producto: string; cantidad: number; unidad: 'kg' | 'origen' };
type StockGranja = { producto: string; cantidad: number; unidad: string };

interface Props {
  currentUser: User;
  onRefresh?: () => void;
}

const CARTONES_POR_GALERON = 30;

export default function DespachoAdmin({ currentUser, onRefresh }: Props) {
  const [tab, setTab] = useState<'emitir' | 'alistar'>('emitir');
  const [remisiones, setRemisiones] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [showTraslado, setShowTraslado] = useState(false);
  const [lineasTraslado, setLineasTraslado] = useState<LineaTraslado[]>([{ producto: '', cantidad: 0, unidad: 'kg' }]);
  const [camionTraslado, setCamionTraslado] = useState('');
  const [camioneroTraslado, setCamioneroTraslado] = useState('');
  const [isSubmittingTraslado, setIsSubmittingTraslado] = useState(false);
  const [stockGranja, setStockGranja] = useState<StockGranja[]>([]);
  const [catalogoKilos, setCatalogoKilos] = useState<ProductoCatalogoParaKilos[]>([]);
  const [camiones, setCamiones] = useState<any[]>([]);
  const [usuariosTraslado, setUsuariosTraslado] = useState<any[]>([]);
  const [granjasLista, setGranjasLista] = useState<any[]>([]);
  const [granjaId, setGranjaId] = useState('Granja Principal');

  // El stock real de Granja manda: de ahí salen los productos que se pueden trasladar.
  // También se cargan camiones y camioneros (dados de alta en Admin) para asignarlos al traslado.
  // En Emitir Guía el mismo stock se muestra para no intentar emitir de más.
  useEffect(() => {
    if (!showTraslado && tab !== 'emitir') return;
    const cargar = async (url: string) => {
      const res = await fetch(url, { headers: sessionHeaders(currentUser.id) });
      if (!res.ok) throw new Error(`${url} (${res.status})`);
      return res.json();
    };
    Promise.all([
      cargar('/api/inventario'),
      cargar('/api/productos-catalogo'),
      cargar('/api/camiones'),
      cargar('/api/users'),
      cargar('/api/granjas'),
    ]).then(([inv, cat, cams, usrs, grs]) => {
      const visto = new Set<string>();
      setStockGranja((inv || [])
        .filter((i: any) => i.ubicacion === 'Granja' && i.cantidad > 0)
        .filter((i: any) => (visto.has(i.producto) ? false : (visto.add(i.producto), true))));
      setCatalogoKilos(cat || []);
      setCamiones(cams || []);
      setUsuariosTraslado(usrs || []);
      setGranjasLista(grs || []);
      setGranjaId(prev => ((grs || []).some((g: any) => g.nombre === prev) ? prev : (grs?.[0]?.nombre || prev)));
    }).catch((error: any) => toast.error(`No se pudieron cargar los datos para remitir. ${error.message || 'Revisa permisos y conexión.'}`));
  }, [showTraslado, tab, currentUser.id]);

  // Usuarios Comerciales que pueden quedar asignados al traslado.
  const camionerosTraslado = usuariosTraslado.filter((u: any) => u.activo !== false && esCamionero(u));
  const nombreCamionero = (id: string) => usuariosTraslado.find((u: any) => u.id === id)?.name || '';

  const unidadesOrigen = (nombre: string) => stockGranja.find(s => s.producto === nombre)?.unidad ?? 'cartones';
  const factorDe = (nombre: string) => (nombre ? factorPara(nombre, catalogoKilos) : null);

  /**
   * Qué termina saliendo realmente de Granja por esta línea, en la unidad en la
   * que vive el inventario. Los cartones no se parten, así que un pedido en
   * kilos se redondea al cartón más cercano y aquí se ve el equivalente exacto.
   */
  const resumenLinea = (l: LineaTraslado): { ok: boolean; nota: string; origen: number; kg: number | null } => {
    const stock = stockGranja.find(s => s.producto === l.producto);
    if (!stock) return { ok: false, nota: '', origen: 0, kg: null };
    if (l.cantidad <= 0) return { ok: false, nota: `Quedan ${stock.cantidad} ${stock.unidad} en Granja`, origen: 0, kg: null };

    const factor = factorDe(l.producto);
    const u = singularUnidad(stock.unidad);

    if (l.unidad === 'kg') {
      if (factor === null) return { ok: false, nota: 'Este producto no tiene kilos por unidad en el catálogo', origen: 0, kg: null };
      const origen = Math.round(l.cantidad / factor);
      if (origen < 1) return { ok: false, nota: `No alcanza ni 1 ${u}`, origen: 0, kg: null };
      if (origen > stock.cantidad) return { ok: false, nota: `Solo quedan ${stock.cantidad} ${stock.unidad} en Granja`, origen, kg: null };
      const kg = redondear2(origen * factor);
      return { ok: true, origen, kg, nota: `= ${origen} ${stock.unidad} · ${kg} kg` };
    }

    if (l.cantidad > stock.cantidad) return { ok: false, nota: `Solo quedan ${stock.cantidad} ${stock.unidad} en Granja`, origen: l.cantidad, kg: null };
    const kg = factor === null ? null : redondear2(l.cantidad * factor);
    return { ok: true, origen: l.cantidad, kg, nota: kg !== null ? `${kg} kg` : `${l.cantidad} ${stock.unidad}` };
  };

  const lineasListas = lineasTraslado.every(l => !l.producto || (l.cantidad > 0 && resumenLinea(l).ok))
    && lineasTraslado.some(l => l.producto && l.cantidad > 0)
    && !!camioneroTraslado
    && (!!camionTraslado || camiones.length === 0);

  const handleTraslado = async () => {
    const validas = lineasTraslado.filter(l => l.producto && l.cantidad > 0);
    const responsable = nombreCamionero(camioneroTraslado);
    if (!validas.length || !responsable || (!camionTraslado && camiones.length)) return;
    setIsSubmittingTraslado(true);
    try {
      const res = await fetch('/api/operaciones/traslado', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({
          responsable,
          camionId: camionTraslado || undefined,
          creadoPorId: currentUser?.id,
          lineas: validas.map(l => ({ producto: l.producto, cantidad: l.cantidad, unidad: l.unidad === 'kg' ? 'kg' : 'origen' })),
        })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error registrando traslado'); }
      toast.success('Traslado a Bodega registrado.');
      setLineasTraslado([{ producto: '', cantidad: 0, unidad: 'kg' }]);
      setCamionTraslado('');
      setCamioneroTraslado('');
      setShowTraslado(false);
      onRefresh?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setIsSubmittingTraslado(false); }
  };

const [producto, setProducto] = useState('Huevos - Grande');
  const [cantEmitir, setCantEmitir] = useState(0);
  const [emitirUnidad, setEmitirUnidad] = useState<'cartones' | 'kg'>('kg');
  const [lote, setLote] = useState('');
  const [transporte, setTransporte] = useState('Camión Ruta 1');

  const [guiaIdAlistar, setGuiaIdAlistar] = useState('');
  const [pesoAlistar, setPesoAlistar] = useState(72);
  const [granjaOrigen, setGranjaOrigen] = useState('Granja Principal');
  const [loteAlistar, setLoteAlistar] = useState('');
  const [ultimasEtiquetas, setUltimasEtiquetas] = useState<any[]>([]);

  const fetchRemisiones = async () => {
    try {
      const res = await fetch('/api/operaciones/remisiones', { headers: sessionHeaders(currentUser.id) });
      if (!res.ok) throw new Error(`No se pudieron cargar las remisiones (${res.status}).`);
      setRemisiones(await res.json());
    } catch (error: any) { toast.error(error.message || 'Error al cargar remisiones.'); }
  };

  useEffect(() => { fetchRemisiones(); }, [currentUser.id]);

  const estadoColor = (estado: string) => {
    switch (estado) {
      case 'EnTransito': return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
      case 'Recibida': return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
      case 'RecibidaConDiferencia': return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
      case 'Alistada': return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
      default: return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
    }
  };

  // Validación de Emitir Guía: mismo criterio que el traslado. Nunca se emite
  // más de lo que hay en Granja, y se puede contar en kilos o en la unidad real.
  const stockEmitir = () => stockGranja.find(s => s.producto === producto);
  const resumenEmitir = (): { ok: boolean; nota: string; origen: number } => {
    const stock = stockEmitir();
    const factor = factorDe(producto);
    const u = singularUnidad(unidadesOrigen(producto));
    if (!stock) return { ok: false, nota: `No hay stock de ${producto} en Granja`, origen: 0 };
    if (cantEmitir <= 0) return { ok: false, nota: `Disponible: ${stock.cantidad} ${stock.unidad}${factor !== null ? ` · ${redondear2(stock.cantidad * factor)} kg` : ''}`, origen: 0 };
    if (emitirUnidad === 'kg') {
      if (stock.unidad === 'kg') {
        if (cantEmitir > stock.cantidad) return { ok: false, nota: `Solo quedan ${stock.cantidad} kg en Granja`, origen: cantEmitir };
        return { ok: true, origen: cantEmitir, nota: `${redondear2(stock.cantidad - cantEmitir)} kg quedarían en Granja` };
      }
      if (factor === null) return { ok: false, nota: 'Este producto no tiene kilos por unidad en el catálogo', origen: 0 };
      const origen = Math.round(cantEmitir / factor);
      if (origen < 1) return { ok: false, nota: `No alcanza ni 1 ${u}`, origen: 0 };
      if (origen > stock.cantidad) return { ok: false, nota: `Solo quedan ${stock.cantidad} ${stock.unidad} en Granja (≈ ${redondear2(stock.cantidad * factor)} kg)`, origen };
      return { ok: true, origen, nota: `= ${origen} ${stock.unidad} · ${redondear2(origen * factor)} kg` };
    }
    if (cantEmitir > stock.cantidad) return { ok: false, nota: `Solo quedan ${stock.cantidad} ${stock.unidad} en Granja (≈ ${factor !== null ? redondear2(stock.cantidad * factor) + ' kg' : ''})`, origen: cantEmitir };
    const kg = factor === null ? null : redondear2(cantEmitir * factor);
    return { ok: true, origen: cantEmitir, nota: kg !== null ? `= ${cantEmitir} ${stock.unidad} · ${kg} kg` : `${cantEmitir} ${stock.unidad}` };
  };

  const emitir = async () => {
    const r = resumenEmitir();
    if (!r.ok) return toast.error(r.nota);
    setLoading(true);
    try {
      const res = await fetch('/api/operaciones/remision', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify(emitirUnidad === 'kg'
          ? { granjaId, producto, cantidadKg: unidadesOrigen(producto) === 'kg' ? cantEmitir : redondear2(r.origen * (factorDe(producto) || 0)), lote, transporte, responsable: currentUser.name }
          : { granjaId, producto, cartones: r.origen, lote, transporte, responsable: currentUser.name })
      });
      if (res.ok) { toast.success('Guía de remisión emitida'); await fetchRemisiones(); setCantEmitir(0); onRefresh?.(); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const alistar = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/operaciones/alistamiento', {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ guiaId: guiaIdAlistar || null, producto, cantidadKg: Number(pesoAlistar), kgPorEtiqueta: 30, granjaOrigen, lote: loteAlistar, clasificacion: 'Grado A', pesoBruto: Number(pesoAlistar), responsable: currentUser.name })
      });
      if (res.ok) {
        const d = await res.json();
        setUltimasEtiquetas(d.etiquetas || []);
        toast.success(`${d.message}`);
        await fetchRemisiones();
      } else { const e = await res.json(); toast.error(`Error: ${e.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const imprimirEtiqueta = (codigo: string) => {
    const printWindow = window.open('', '_blank', 'width=400,height=300');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Etiqueta ${codigo}</title>
      <style>
        body { font-family: monospace; padding: 10px; font-size: 11px; }
        .label { border: 1px solid #000; padding: 8px; width: 280px; }
        .code { font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 8px; }
        .qr { text-align: center; margin: 6px 0; }
        .brand { text-align: center; font-weight: bold; font-size: 13px; margin-bottom: 4px; }
      </style></head><body>
      <div class="label">
        <div class="brand">GRANJA DON PACO</div>
        <div class="code">${codigo}</div>
        <div class="qr"><img src="/api/etiquetas/${codigo}/qr.png" width="120" height="120" /></div>
        <div style="text-align:center;font-size:9px;color:#666;margin-bottom:6px">Escanee para ver trazabilidad</div>
      </div>
      <script>window.onload=function(){window.print();}</script>
      </body></html>
    `);
    printWindow.document.close();
  };

  const recibidas = remisiones.filter(r => r.estado === 'Recibida' || r.estado === 'RecibidaConDiferencia' || r.estado === 'Alistada');

  const fieldStyle = "w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white";

  return (
    <div className="max-w-6xl space-y-6 animate-in fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex space-x-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-default)' }}>
          {([['emitir', 'Emitir Remisión', Truck], ['alistar', 'Alistar / Etiquetar', Boxes]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className="pb-3 text-sm font-semibold capitalize transition-colors whitespace-nowrap border-b-2 flex items-center gap-2"
              style={tab === key
                ? { color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' }
                : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowTraslado(true)} className="btn-primary">
          <ArrowDownToLine className="w-4 h-4" /> Nuevo Traslado a Bodega
        </button>
      </div>

      {showTraslado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-5">
              <div className="flex items-center space-x-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><ArrowDownToLine className="w-4 h-4" /></div>
                <div>
                  <h3 className="font-bold text-neutral-800">Nuevo Traslado a Bodega</h3>
                  <p className="text-xs text-neutral-500">Cuenta en kilos o en la unidad de origen, lo que le quede más cómodo</p>
                </div>
              </div>
              <button onClick={() => setShowTraslado(false)}><X className="w-5 h-5 text-neutral-500" /></button>
            </div>

            <div className="space-y-3">
              {lineasTraslado.map((l, i) => {
                const r = resumenLinea(l);
                const stock = stockGranja.find(s => s.producto === l.producto);
                const setLinea = (campo: Partial<LineaTraslado>) =>
                  setLineasTraslado(lineas => lineas.map((x, j) => (j === i ? { ...x, ...campo } : x)));
                const sinResolver = !!l.producto && l.cantidad > 0 && !r.ok;
                return (
                  <div key={i} className={cn('rounded-xl border p-3 space-y-2',
                    sinResolver ? 'border-red-300 bg-red-50' : 'border-neutral-200 bg-neutral-50')}>
                    <div className="flex items-center gap-2">
                      <select value={l.producto} onChange={e => setLinea({ producto: e.target.value })}
                        className="flex-1 bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500">
                        <option value="">Seleccione producto...</option>
                        {stockGranja.map(s => <option key={s.producto} value={s.producto}>{s.producto} — {s.cantidad} {s.unidad}</option>)}
                      </select>
                      {lineasTraslado.length > 1 && (
                        <button onClick={() => setLineasTraslado(lineas => lineas.filter((_, j) => j !== i))}
                          className="p-2 text-neutral-400 hover:text-red-600" title="Quitar producto">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="flex gap-2 items-center">
                      <input type="number" min="0" step="any" value={l.cantidad || ''} onChange={e => setLinea({ cantidad: Number(e.target.value) })}
                        placeholder="Cantidad" className="flex-1 bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                      <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs font-bold shrink-0">
                        <button onClick={() => setLinea({ unidad: 'kg' })}
                          className={cn('px-3 py-2', l.unidad === 'kg' ? 'bg-emerald-600 text-white' : 'bg-white text-neutral-500')}>Kilos</button>
                        <button onClick={() => setLinea({ unidad: 'origen' })}
                          className={cn('px-3 py-2', l.unidad === 'origen' ? 'bg-emerald-600 text-white' : 'bg-white text-neutral-500')}>
                          {l.producto ? singularUnidad(unidadesOrigen(l.producto)) : 'Unidad'}
                        </button>
                      </div>
                    </div>

                    {(l.producto || l.cantidad > 0) && (
                      <p className={cn('text-xs', r.ok ? 'text-neutral-500' : 'text-red-600 font-semibold')}>
                        {r.nota || 'Complete la línea'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <button onClick={() => setLineasTraslado(lineas => [...lineas, { producto: '', cantidad: 0, unidad: 'kg' }])}
              className="btn-secondary btn-sm mt-3">
              <Plus className="w-4 h-4" /> Agregar producto
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <div>
                <label className="text-sm font-bold text-neutral-700">Camión</label>
                <select value={camionTraslado} onChange={e => setCamionTraslado(e.target.value)}
                  className="w-full mt-1 bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-emerald-500 outline-none"
                  required={camiones.length > 0}>
                  <option value="">Seleccione camión...</option>
                  {camiones.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                {camiones.length === 0 &&
                  <p className="text-xs text-neutral-500 mt-1">No hay camiones dados de alta en Admin → Camiones.</p>}
              </div>
              <div>
                <label className="text-sm font-bold text-neutral-700">Comercial asignado</label>
                <select value={camioneroTraslado} onChange={e => setCamioneroTraslado(e.target.value)}
                  className="w-full mt-1 bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-emerald-500 outline-none"
                  required>
                  <option value="">Seleccione camionero...</option>
                  {camionerosTraslado.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-xs text-neutral-500 mt-1">
                  {camionerosTraslado.length === 0
                    ? 'No hay camioneros dados de alta en Admin → Usuarios y Roles.'
                    : 'Quién lleva el traslado. Se administra en Admin → Usuarios y Roles.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={() => setShowTraslado(false)} className="btn-neutral">Cancelar</button>
              <button onClick={handleTraslado} disabled={isSubmittingTraslado || !lineasListas} className="btn-primary">
                {isSubmittingTraslado ? <Spinner className="mr-2" /> : <ArrowDownToLine className="w-4 h-4 mr-2" />}Registrar Salida de Granja
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'emitir' && (
        <div className="bg-white dark:bg-neutral-800 p-4 md:p-6 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 space-y-4">
          <div className="flex items-center space-x-3"><Truck className="w-5 h-5 text-purple-600" /><h3 className="font-bold text-neutral-800 dark:text-white">Emitir Remisión (Granja → Bodega)</h3></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Granja</label>
              <select value={granjaId} onChange={e => setGranjaId(e.target.value)} className={fieldStyle}>
                {granjasLista.map((g: any) => <option key={g.id} value={g.nombre}>{g.nombre}</option>)}
              </select></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Producto</label>
              <select value={producto} onChange={e => { const next = e.target.value; setProducto(next); if (next === 'Gallinaza') setEmitirUnidad('cartones'); else setEmitirUnidad('kg'); }} className={fieldStyle}>
                <option>Huevos - Grande</option><option>Huevos - Mediano</option><option>Huevos - Pequeño</option><option>Gallinaza</option>
              </select></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Cantidad</label>
              <div className="flex items-center mt-1 rounded-xl border border-neutral-200 overflow-hidden bg-white dark:bg-neutral-800 dark:border-neutral-700 focus-within:border-purple-500">
                <input type="number" min="0" step="any" value={cantEmitir || ''} onChange={e => setCantEmitir(Number(e.target.value))} placeholder="0"
                  className="flex-1 min-w-0 px-3 py-2 text-sm bg-transparent outline-none text-neutral-800 dark:text-white" />
                <div className="flex text-xs font-bold shrink-0 border-l border-neutral-200 dark:border-neutral-700">
                  {unidadesOrigen(producto) !== 'kg' && !/huevo/i.test(producto) && <button type="button" onClick={() => setEmitirUnidad('cartones')}
                    className={cn('px-3 py-2.5', emitirUnidad === 'cartones' ? 'bg-purple-600 text-white' : 'bg-white text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400')}>
                    {producto ? singularUnidad(unidadesOrigen(producto)) : 'Cartones'}
                  </button>}
                  {producto !== 'Gallinaza' && <button type="button" onClick={() => setEmitirUnidad('kg')}
                    className={cn('px-3 py-2.5', emitirUnidad === 'kg' ? 'bg-purple-600 text-white' : 'bg-white text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400')}>Kg</button>
                  }
                </div>
              </div>
              <p className={cn('text-xs mt-1', resumenEmitir().ok ? 'text-neutral-500' : 'text-red-600 font-semibold')}>
                {resumenEmitir().nota}
              </p>
            </div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Lote</label>
              <input type="text" value={lote} onChange={e => setLote(e.target.value)} placeholder="Opcional" className={fieldStyle} /></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Transporte</label>
              <input type="text" value={transporte} onChange={e => setTransporte(e.target.value)} className={fieldStyle} /></div>
          </div>
          <div className="flex justify-end">
            <button onClick={emitir} disabled={loading || !resumenEmitir().ok} className="btn-primary">
              {loading ? <Spinner className="mr-2" /> : <Truck className="w-4 h-4 mr-2" />}Emitir Remisión
            </button>
          </div>
        </div>
      )}

      {tab === 'alistar' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-neutral-800 p-4 md:p-6 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 space-y-4">
            <h3 className="font-bold text-neutral-800 dark:text-white flex items-center"><Boxes className="w-5 h-5 mr-2 text-purple-600" /> Armar Galerones y Generar Etiquetas</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Guía (opcional)</label>
                <select value={guiaIdAlistar} onChange={e => setGuiaIdAlistar(e.target.value)} className={fieldStyle}>
                  <option value="">Sin guía</option>
                  {recibidas.map((g: any) => <option key={g.id} value={g.id}>{g.consecutivo} — {g.estado}</option>)}
                </select></div>
              <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Producto</label>
                <select value={producto} onChange={e => setProducto(e.target.value)} className={fieldStyle}>
                  <option>Huevos - Grande</option><option>Huevos - Mediano</option><option>Huevos - Pequeño</option>
                </select></div>
              <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Cantidad a alistar (kg)</label>
                <input type="number" min="0.01" step="0.01" value={pesoAlistar} onChange={e => setPesoAlistar(Number(e.target.value))} className={fieldStyle} /></div>
              <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Granja Origen</label>
                <input type="text" value={granjaOrigen} onChange={e => setGranjaOrigen(e.target.value)} className={fieldStyle} /></div>
              <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Lote</label>
                <input type="text" value={loteAlistar} onChange={e => setLoteAlistar(e.target.value)} placeholder="Opcional" className={fieldStyle} /></div>
            </div>
            <div className="flex justify-end">
              <button onClick={alistar} disabled={loading || pesoAlistar <= 0} className="btn-primary">
                {loading ? <Spinner className="mr-2" /> : <Boxes className="w-4 h-4 mr-2" />}Alistar y Etiquetar
              </button>
            </div>
          </div>

          {ultimasEtiquetas.length > 0 && (
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-2xl border border-purple-100 dark:border-purple-800 p-4 animate-in fade-in">
              <h4 className="font-bold text-sm text-neutral-800 dark:text-white mb-3 flex items-center"><ScanLine className="w-4 h-4 mr-2 text-purple-600" /> Etiquetas generadas</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {ultimasEtiquetas.map((e: any) => (
                  <div key={e.id} className="bg-white dark:bg-neutral-900 rounded-xl border border-purple-200 dark:border-purple-700 p-3 text-center">
                    <img src={`/api/etiquetas/${e.codigoUnico}/qr.png`} width="96" height="96" className="mx-auto rounded" alt={e.codigoUnico} />
                    <p className="font-mono font-bold text-purple-700 dark:text-purple-300 text-[10px] mt-2 break-all">{e.codigoUnico}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{e.cantidad} kg</p>
                    <button onClick={() => imprimirEtiqueta(e.codigoUnico)} className="btn-secondary btn-sm mt-2">
                      <Printer className="w-3 h-3" /> Imprimir
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-neutral-800 rounded-3xl shadow-sm border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50">
          <h3 className="font-bold text-neutral-800 dark:text-white">Guías de Remisión</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 uppercase tracking-wider font-bold text-xs border-b border-neutral-200 dark:border-neutral-700">
              <tr><th className="px-6 py-4">Consecutivo</th><th className="px-6 py-4">Producto</th><th className="px-6 py-4">Cantidad</th><th className="px-6 py-4">Lote</th><th className="px-6 py-4">Transporte</th><th className="px-6 py-4 text-center">Estado</th><th className="px-6 py-4">Fecha</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {remisiones.map((g: any) => (
                <tr key={g.id} className="hover:bg-purple-50/30 dark:hover:bg-neutral-700/50 transition-colors">
                  <td className="px-6 py-4 font-mono font-bold text-purple-700 dark:text-purple-300 text-xs">{g.consecutivo}</td>
                  <td className="px-6 py-4 font-medium text-neutral-800 dark:text-white">{g.producto}</td>
                  <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300">{g.unidad === 'kg' ? `${Number(g.cantidadKgEsperada || 0).toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg` : `${g.cartonesEsperados} empaques · kg pendiente`}</td>
                  <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300">{g.lote || '—'}</td>
                  <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300">{g.transporte || '—'}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={cn('inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase', estadoColor(g.estado))}>{g.estado}</span>
                  </td>
                  <td className="px-6 py-4 text-neutral-500 dark:text-neutral-400 text-xs">{new Date(g.fecha).toLocaleString()}</td>
                </tr>
              ))}
              {remisiones.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-neutral-500 dark:text-neutral-400">No hay guías de remisión.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
