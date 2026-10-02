import React, { useState, useEffect } from 'react';
import { Truck, PackageCheck, ScanLine, RefreshCw, Check, Boxes, Printer, ArrowDownToLine, X } from 'lucide-react';
import { User } from '../../types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { OPCIONES_DIFERENCIA_RECEPCION } from '../../lib/opcionesRecepcion';
import { Spinner } from '../Spinner';

interface Props {
  currentUser: User;
  onRefresh?: () => void;
}

const CARTONES_POR_GALERON = 30;

export default function DespachoAdmin({ currentUser, onRefresh }: Props) {
  const [tab, setTab] = useState<'emitir' | 'recibir' | 'alistar'>('emitir');
  const [remisiones, setRemisiones] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [showTraslado, setShowTraslado] = useState(false);
  const [productoTraslado, setProductoTraslado] = useState('');
  const [cantidadTraslado, setCantidadTraslado] = useState(0);
  const [responsableTraslado, setResponsableTraslado] = useState('');
  const [isSubmittingTraslado, setIsSubmittingTraslado] = useState(false);

  const handleTraslado = async () => {
    if (!productoTraslado || cantidadTraslado <= 0 || !responsableTraslado) return;
    setIsSubmittingTraslado(true);
    try {
      const res = await fetch('/api/operaciones/traslado', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ producto: productoTraslado, cantidad: cantidadTraslado, unidad: 'cartones', responsable: responsableTraslado })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Error registrando traslado'); }
      toast.success('Traslado a Bodega registrado.');
      setProductoTraslado(''); setCantidadTraslado(0); setResponsableTraslado('');
      setShowTraslado(false);
      onRefresh?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setIsSubmittingTraslado(false); }
  };

  const [granjaId, setGranjaId] = useState('Granja Principal');
  const [producto, setProducto] = useState('Huevos - Grande');
  const [cartones, setCartones] = useState(120);
  const [lote, setLote] = useState('');
  const [transporte, setTransporte] = useState('Camión Ruta 1');

  const [guiaIdRecibir, setGuiaIdRecibir] = useState('');
  const [cantidadRecibida, setCantidadRecibida] = useState(0);
  const [pesoBruto, setPesoBruto] = useState(0);
  const [motivoDiferencia, setMotivoDiferencia] = useState('');

  const [guiaIdAlistar, setGuiaIdAlistar] = useState('');
  const [cartonesAlistar, setCartonesAlistar] = useState(120);
  const [pesoAlistar, setPesoAlistar] = useState(72);
  const [granjaOrigen, setGranjaOrigen] = useState('Granja Principal');
  const [loteAlistar, setLoteAlistar] = useState('');
  const [ultimasEtiquetas, setUltimasEtiquetas] = useState<any[]>([]);

  const fetchRemisiones = async () => {
    try {
      const res = await fetch('/api/operaciones/remisiones');
      if (res.ok) setRemisiones(await res.json());
    } catch { toast.error('Error al cargar remisiones.'); }
  };

  useEffect(() => { fetchRemisiones(); }, []);

  const estadoColor = (estado: string) => {
    switch (estado) {
      case 'EnTransito': return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
      case 'Recibida': return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
      case 'RecibidaConDiferencia': return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
      case 'Alistada': return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
      default: return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
    }
  };

  const emitir = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/operaciones/remision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ granjaId, producto, cartones: Number(cartones), lote, transporte, responsable: currentUser.name })
      });
      if (res.ok) { toast.success('Guía de remisión emitida'); await fetchRemisiones(); setCartones(120); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const recibir = async () => {
    if (!guiaIdRecibir) return toast.error('Seleccione una guía en tránsito');
    setLoading(true);
    try {
      const res = await fetch('/api/operaciones/recepcion-remision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guiaId: guiaIdRecibir, cantidadRecibida: Number(cantidadRecibida), pesoBruto: Number(pesoBruto) || null, motivoDiferencia, responsable: currentUser.name })
      });
      if (res.ok) { toast.success('Remisión recibida en bodega'); await fetchRemisiones(); setGuiaIdRecibir(''); }
      else { const d = await res.json(); toast.error(`Error: ${d.error}`); }
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setLoading(false);
  };

  const alistar = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/operaciones/alistamiento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guiaId: guiaIdAlistar || null, producto, cartones: Number(cartonesAlistar), granjaOrigen, lote: loteAlistar, clasificacion: 'Grado A', pesoBruto: Number(pesoAlistar) || null, responsable: currentUser.name })
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

  const transito = remisiones.filter(r => r.estado === 'EnTransito');
  const recibidas = remisiones.filter(r => r.estado === 'Recibida' || r.estado === 'RecibidaConDiferencia' || r.estado === 'Alistada');

  const fieldStyle = "w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white";

  return (
    <div className="max-w-6xl space-y-6 animate-in fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex space-x-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-default)' }}>
          {([['emitir', 'Emitir Guía', Truck], ['recibir', 'Recibir en Bodega', PackageCheck], ['alistar', 'Alistar / Etiquetar', Boxes]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className="pb-3 text-sm font-semibold capitalize transition-colors whitespace-nowrap border-b-2 flex items-center gap-2"
              style={tab === key
                ? { color: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' }
                : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowTraslado(true)}
          className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm flex items-center gap-2 transition-colors">
          <ArrowDownToLine className="w-4 h-4" /> Nuevo Traslado a Bodega
        </button>
      </div>

      {showTraslado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-5">
              <div className="flex items-center space-x-2">
                <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center"><ArrowDownToLine className="w-4 h-4" /></div>
                <div><h3 className="font-bold text-neutral-800">Nuevo Traslado a Bodega</h3></div>
              </div>
              <button onClick={() => setShowTraslado(false)}><X className="w-5 h-5 text-neutral-500" /></button>
            </div>
            <div className="space-y-4">
              <div className="space-y-2"><label className="text-sm font-bold text-neutral-700">Producto</label>
                <select value={productoTraslado} onChange={e => setProductoTraslado(e.target.value)} className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-orange-500 outline-none" required>
                  <option value="">Seleccione...</option><option value="Huevos - Grande">Huevos Grande</option><option value="Huevos - Mediano">Huevos Mediano</option><option value="Gallinaza">Gallinaza</option>
                </select></div>
              <div className="space-y-2"><label className="text-sm font-bold text-neutral-700">Cantidad (Cartones)</label>
                <input type="number" min="1" value={cantidadTraslado || ''} onChange={e => setCantidadTraslado(Number(e.target.value))} className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-orange-500 outline-none" placeholder="Ej. 50 cartones" required /></div>
              <div className="space-y-2"><label className="text-sm font-bold text-neutral-700">Responsable de Entrega</label>
                <input type="text" value={responsableTraslado} onChange={e => setResponsableTraslado(e.target.value)} className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-orange-500 outline-none" placeholder="Nombre de quien entrega en Granja" required /></div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={() => setShowTraslado(false)} className="px-4 py-2.5 rounded-lg text-sm font-bold bg-neutral-100 text-neutral-600 hover:bg-neutral-200">Cancelar</button>
              <button onClick={handleTraslado} disabled={isSubmittingTraslado || !productoTraslado || cantidadTraslado <= 0 || !responsableTraslado} className="bg-orange-600 hover:bg-orange-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 flex items-center">
                {isSubmittingTraslado ? <Spinner className="mr-2" /> : <ArrowDownToLine className="w-4 h-4 mr-2" />}Registrar Salida de Granja
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'emitir' && (
        <div className="bg-white dark:bg-neutral-800 p-4 md:p-6 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 space-y-4">
          <div className="flex items-center space-x-3"><Truck className="w-5 h-5 text-purple-600" /><h3 className="font-bold text-neutral-800 dark:text-white">Emitir Guía de Remisión</h3></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Granja</label>
              <input type="text" value={granjaId} onChange={e => setGranjaId(e.target.value)} className={fieldStyle} /></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Producto</label>
              <select value={producto} onChange={e => setProducto(e.target.value)} className={fieldStyle}>
                <option>Huevos - Grande</option><option>Huevos - Mediano</option><option>Huevos - Pequeño</option><option>Gallinaza</option>
              </select></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Cartones</label>
              <input type="number" min="1" value={cartones} onChange={e => setCartones(Number(e.target.value))} className={fieldStyle} /></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Lote</label>
              <input type="text" value={lote} onChange={e => setLote(e.target.value)} placeholder="Opcional" className={fieldStyle} /></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Transporte</label>
              <input type="text" value={transporte} onChange={e => setTransporte(e.target.value)} className={fieldStyle} /></div>
          </div>
          <div className="flex justify-end">
            <button onClick={emitir} disabled={loading || !cartones}
              className="px-6 py-2.5 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center">
              {loading ? <Spinner className="mr-2" /> : <Truck className="w-4 h-4 mr-2" />}Emitir Guía
            </button>
          </div>
        </div>
      )}

      {tab === 'recibir' && (
        <div className="bg-white dark:bg-neutral-800 p-4 md:p-6 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 space-y-4">
          <h3 className="font-bold text-neutral-800 dark:text-white flex items-center"><PackageCheck className="w-5 h-5 mr-2 text-purple-600" /> Recepción con Báscula</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Guía en Tránsito</label>
              <select value={guiaIdRecibir} onChange={e => setGuiaIdRecibir(e.target.value)} className={fieldStyle}>
                <option value="">Seleccionar...</option>
                {transito.map((g: any) => <option key={g.id} value={g.id}>{g.consecutivo} — {g.producto} ({g.cartonesEsperados} cartones)</option>)}
              </select></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Cantidad Recibida</label>
              <input type="number" min="0" value={cantidadRecibida} onChange={e => setCantidadRecibida(Number(e.target.value))} className={fieldStyle} /></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Peso Bruto (kg)</label>
              <input type="number" step="0.1" value={pesoBruto} onChange={e => setPesoBruto(Number(e.target.value))} className={fieldStyle} /></div>
            <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Motivo Diferencia</label>
              <select value={motivoDiferencia} onChange={e => setMotivoDiferencia(e.target.value)} className={fieldStyle}>
                <option value="">Opcional — seleccione…</option>
                {OPCIONES_DIFERENCIA_RECEPCION.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select></div>
          </div>
          <div className="flex justify-end">
            <button onClick={recibir} disabled={loading || !guiaIdRecibir}
              className="px-6 py-2.5 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center">
              {loading ? <Spinner className="mr-2" /> : <Check className="w-4 h-4 mr-2" />}Registrar Recepción
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
                  <option>Huevos - Grande</option><option>Huevos - Mediano</option><option>Huevos - Pequeño</option><option>Gallinaza</option>
                </select></div>
              <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Cartones a Alistar</label>
                <input type="number" min="1" value={cartonesAlistar} onChange={e => setCartonesAlistar(Number(e.target.value))} className={fieldStyle} /></div>
              <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Granja Origen</label>
                <input type="text" value={granjaOrigen} onChange={e => setGranjaOrigen(e.target.value)} className={fieldStyle} /></div>
              <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Lote</label>
                <input type="text" value={loteAlistar} onChange={e => setLoteAlistar(e.target.value)} placeholder="Opcional" className={fieldStyle} /></div>
              <div><label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Peso por Galerón (kg)</label>
                <input type="number" step="0.1" value={pesoAlistar} onChange={e => setPesoAlistar(Number(e.target.value))} className={fieldStyle} /></div>
            </div>
            <div className="flex justify-end">
              <button onClick={alistar} disabled={loading || !cartonesAlistar}
                className="px-6 py-2.5 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center">
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
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">{e.cantidad} cartones</p>
                    <button onClick={() => imprimirEtiqueta(e.codigoUnico)} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg px-3 py-1.5">
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
              <tr><th className="px-6 py-4">Consecutivo</th><th className="px-6 py-4">Producto</th><th className="px-6 py-4">Cartones</th><th className="px-6 py-4">Lote</th><th className="px-6 py-4">Transporte</th><th className="px-6 py-4 text-center">Estado</th><th className="px-6 py-4">Fecha</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {remisiones.map((g: any) => (
                <tr key={g.id} className="hover:bg-purple-50/30 dark:hover:bg-neutral-700/50 transition-colors">
                  <td className="px-6 py-4 font-mono font-bold text-purple-700 dark:text-purple-300 text-xs">{g.consecutivo}</td>
                  <td className="px-6 py-4 font-medium text-neutral-800 dark:text-white">{g.producto}</td>
                  <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300">{g.cartonesEsperados}</td>
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