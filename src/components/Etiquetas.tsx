import React, { useState, useEffect } from 'react';
import { Tag, Plus, Search, QrCode, Check, X, Package, MapPin, Clock, CheckCircle, XCircle, Printer } from 'lucide-react';
import { Etiqueta, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { Spinner } from './Spinner';

interface EtiquetasProps {
  currentUser: User;
}

export default function Etiquetas({ currentUser }: EtiquetasProps) {
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [catalogo, setCatalogo] = useState<{id:string;nombre:string}[]>([]);
  const [tiposCarton, setTiposCarton] = useState<{id:string;nombre:string;unidades:number;estado:string}[]>([]);

  // Form state
  const [producto, setProducto] = useState('Huevos - Grande');
  const [cantidad, setCantidad] = useState(30);
  const [tipoCarton, setTipoCarton] = useState('');
  const [pesoBruto, setPesoBruto] = useState(18);
  const [pesoNeto, setPesoNeto] = useState(16.5);
  const [granjaOrigen, setGranjaOrigen] = useState('Granja Principal');
  const [galeronOrigen, setGaleronOrigen] = useState('');
  const [clasificacion, setClasificacion] = useState('Grado A');
  const [lote, setLote] = useState('');
  const [ubicacion, setUbicacion] = useState('Granja');
  const [cantidadEtiquetas, setCantidadEtiquetas] = useState(1);

  // Scan state
  const [scanCode, setScanCode] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);

  const fetchEtiquetas = async () => {
    try {
      const [res, cRes, tRes] = await Promise.all([fetch('/api/etiquetas'), fetch('/api/productos-catalogo'), fetch('/api/tipos-carton')]);
      if (res.ok) setEtiquetas(await res.json());
      if (cRes.ok) setCatalogo(await cRes.json());
      if (tRes.ok) {
        const tipos = await tRes.json();
        setTiposCarton(tipos);
        if (!tipos.length) { setTipoCarton(''); return; }
        const activo = tipos.find((t: any) => t.estado === 'Activo') || tipos[0];
        setTipoCarton(activo.id);
        setCantidad(Number(activo.unidades) || 30);
      }
    } catch (err) { toast.error('Error al cargar etiquetas.'); }
  };

  useEffect(() => { fetchEtiquetas(); }, []);

  const handlePrint = (etiqueta: Etiqueta) => {
    const printWindow = window.open('', '_blank', 'width=400,height=300');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Etiqueta ${etiqueta.codigoUnico}</title>
      <style>
        body { font-family: monospace; padding: 10px; font-size: 11px; }
        .label { border: 1px solid #000; padding: 8px; width: 280px; }
        .code { font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 4px; }
        .qr { text-align: center; margin: 6px 0; }
        .row { display: flex; justify-content: space-between; margin: 2px 0; }
        .label-name { color: #666; }
        .brand { text-align: center; font-weight: bold; font-size: 13px; margin-bottom: 4px; }
      </style></head><body>
      <div class="label">
        <div class="brand">GRANJA DON PACO</div>
        <div class="code">${etiqueta.codigoUnico}</div>
        <div class="qr"><img src="/api/etiquetas/${etiqueta.codigoUnico}/qr.png" width="110" height="110" /></div>
        <div class="row"><span class="label-name">Producto:</span> <span>${etiqueta.producto}</span></div>
        <div class="row"><span class="label-name">Cantidad:</span> <span>${etiqueta.cantidad} unidades</span></div>
        ${etiqueta.pesoNeto ? `<div class="row"><span class="label-name">Peso Neto:</span> <span>${etiqueta.pesoNeto} kg</span></div>` : ''}
        ${etiqueta.pesoBruto ? `<div class="row"><span class="label-name">Peso Bruto:</span> <span>${etiqueta.pesoBruto} kg</span></div>` : ''}
        ${etiqueta.clasificacion ? `<div class="row"><span class="label-name">Clasificación:</span> <span>${etiqueta.clasificacion}</span></div>` : ''}
        ${etiqueta.granjaOrigen ? `<div class="row"><span class="label-name">Granja:</span> <span>${etiqueta.granjaOrigen}</span></div>` : ''}
        ${etiqueta.lote ? `<div class="row"><span class="label-name">Lote:</span> <span>${etiqueta.lote}</span></div>` : ''}
        <div class="row"><span class="label-name">Fecha:</span> <span>${etiqueta.fechaProduccion ? new Date(etiqueta.fechaProduccion).toLocaleDateString() : '—'}</span></div>
      </div>
      <script>window.onload=function(){window.print();}</script>
      </body></html>
    `);
    printWindow.document.close();
  };

  const handleGenerar = async () => {
    if (cantidadEtiquetas === 1) {
      setLoading(true);
      try {
        const res = await fetch('/api/etiquetas/generar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ producto, cantidad, pesoBruto, pesoNeto, granjaOrigen, galeronOrigen, clasificacion, lote, ubicacion, tipoCarton })
        });
        if (res.ok) { await fetchEtiquetas(); setIsCreating(false); toast.success('Etiqueta generada.'); }
        else { const data = await res.json(); toast.error(`Error: ${data.error}`); }
      } catch (err: any) { toast.error(`Error: ${err.message}`); }
      setLoading(false);
    } else {
      // Generate batch
      setLoading(true);
      try {
        const batch = Array.from({ length: cantidadEtiquetas }, () => ({
producto, cantidad, pesoBruto, pesoNeto, granjaOrigen, galeronOrigen, clasificacion, lote, ubicacion, tipoCarton
        }));
        const res = await fetch('/api/etiquetas/generar-lote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ etiquetas: batch })
        });
        if (res.ok) { await fetchEtiquetas(); setIsCreating(false); toast.success(`${cantidadEtiquetas} etiquetas generadas.`); }
      } catch (err: any) { toast.error(`Error: ${err.message}`); }
      setLoading(false);
    }
  };

  const handleEscanear = async () => {
    if (!scanCode.trim()) return;
    try {
      const res = await fetch(`/api/etiquetas/trazabilidad/${encodeURIComponent(scanCode.trim())}`);
      if (res.ok) { setScanResult(await res.json()); }
      else { setScanResult(null); toast.error('Etiqueta no encontrada.'); }
    } catch (err: any) { toast.error(`Error: ${err.message}`); }
  };

  const handleActualizarEstado = async (codigo: string, nuevoEstado: string) => {
    try {
      await fetch('/api/etiquetas/escanear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigoUnico: codigo, nuevoEstado, ubicacion: nuevoEstado === 'EnBodega' ? 'Bodega Central' : nuevoEstado === 'Cargada' ? 'Camión Ruta 1' : undefined })
      });
      await fetchEtiquetas();
      if (scanResult?.etiqueta?.codigoUnico === codigo) {
        handleEscanear(); // Refresh scan result
      }
    } catch (err: any) { toast.error(`Error: ${err.message}`); }
  };

  const getEstadoColor = (estado: string) => {
    switch (estado) {
      case 'Generada': return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
      case 'EnBodega': return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
      case 'Cargada': return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
      case 'Entregada': return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
      case 'Retornada': return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
      case 'Merma': return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
      default: return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
    }
  };

  const filteredEtiquetas = etiquetas.filter(e =>
    e.codigoUnico.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.producto.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.lote && e.lote.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-neutral-800 dark:text-white flex items-center">
            <Tag className="w-6 h-6 mr-2 text-purple-600" />
            Etiquetas y Trazabilidad
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Generar, escanear y rastrear etiquetas de cartones.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setIsCreating(!isCreating)}
            className={cn("flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm",
              isCreating ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200" : "bg-purple-600 text-white hover:bg-purple-700")}>
            {isCreating ? <><X className="w-5 h-5 mr-2" /> Cancelar</> : <><Plus className="w-5 h-5 mr-2" /> Nueva Etiqueta</>}
          </button>
        </div>
      </div>

      {/* Scanner */}
      <div className="bg-white dark:bg-neutral-800 p-4 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700">
        <h3 className="font-bold text-neutral-800 dark:text-white mb-3 flex items-center"><QrCode className="w-5 h-5 mr-2 text-purple-600" /> Escanear Etiqueta</h3>
        <div className="flex gap-2">
          <input type="text" value={scanCode} onChange={e => setScanCode(e.target.value)}
            placeholder="Escanear o escribir código de etiqueta..."
            className="flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white placeholder:text-neutral-400"
            onKeyDown={e => e.key === 'Enter' && handleEscanear()} />
          <button onClick={handleEscanear}
            className="px-4 py-2.5 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors">
            Buscar
          </button>
        </div>
        {scanResult && (
          <div className="mt-4 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-100 dark:border-purple-800 animate-in fade-in">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Código</span><p className="font-mono font-bold text-purple-700 dark:text-purple-300">{scanResult.etiqueta.codigoUnico}</p></div>
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Producto</span><p className="font-bold text-neutral-800 dark:text-white">{scanResult.etiqueta.producto}</p></div>
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Estado</span>
                <p className={cn("inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold", getEstadoColor(scanResult.etiqueta.estado))}>{scanResult.etiqueta.estado}</p>
              </div>
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Ubicación</span><p className="font-medium text-neutral-700 dark:text-neutral-300">{scanResult.etiqueta.ubicacionActual}</p></div>
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Peso Neto</span><p className="font-bold text-neutral-800 dark:text-white">{scanResult.etiqueta.pesoNeto ? `${scanResult.etiqueta.pesoNeto} kg` : 'N/A'}</p></div>
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Granja</span><p className="font-medium text-neutral-700 dark:text-neutral-300">{scanResult.etiqueta.granjaOrigen || 'N/A'}</p></div>
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Clasificación</span><p className="font-medium text-neutral-700 dark:text-neutral-300">{scanResult.etiqueta.clasificacion || 'N/A'}</p></div>
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Lote</span><p className="font-medium text-neutral-700 dark:text-neutral-300">{scanResult.etiqueta.lote || 'N/A'}</p></div>
            </div>
            <div className="mt-3 flex gap-2">
              {scanResult.etiqueta.estado === 'Generada' && (
                <button onClick={() => handleActualizarEstado(scanResult.etiqueta.codigoUnico, 'EnBodega')}
                  className="px-3 py-1.5 text-white rounded-lg text-xs font-bold" style={{ background: 'var(--brand-secondary)' }}>Mover a Bodega</button>
              )}
              {scanResult.etiqueta.estado === 'EnBodega' && (
                <button onClick={() => handleActualizarEstado(scanResult.etiqueta.codigoUnico, 'Cargada')}
                  className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-xs font-bold hover:bg-purple-600">Cargar a Camión</button>
              )}
              {scanResult.etiqueta.estado === 'Cargada' && (
                <button onClick={() => handleActualizarEstado(scanResult.etiqueta.codigoUnico, 'Entregada')}
                  className="px-3 py-1.5 text-white rounded-lg text-xs font-bold" style={{ background: 'var(--brand-primary)' }}>Marcar Entregada</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Form */}
      {isCreating && (
        <div className="bg-neutral-50 dark:bg-neutral-900 p-4 md:p-6 rounded-3xl animate-in slide-in-from-top-4 border border-neutral-200 dark:border-neutral-700">
          <h3 className="font-bold text-lg text-neutral-800 dark:text-white mb-4">Generar Nueva Etiqueta</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Producto</label>
              <select value={producto} onChange={e => setProducto(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white">
                {catalogo.length > 0 ? catalogo.map(p => <option key={p.id}>{p.nombre}</option>) : (
                  <>
                    <option>Huevos - Grande</option>
                    <option>Huevos - Mediano</option>
                    <option>Huevos - Pequeño</option>
                    <option>Gallinaza</option>
                  </>
                )}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Tipo de cartón</label>
              <select value={tipoCarton} onChange={e => {
                const t = tiposCarton.find(x => x.id === e.target.value);
                setTipoCarton(e.target.value);
                if (t) setCantidad(Number(t.unidades) || cantidad);
              }}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white">
                {tiposCarton.filter(t => t.estado === 'Activo').map(t => <option key={t.id} value={t.id}>{t.nombre} ({t.unidades} uds)</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Cantidad (unidades)</label>
              <input type="number" min="1" value={cantidad} onChange={e => setCantidad(Number(e.target.value))}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Clasificación</label>
              <select value={clasificacion} onChange={e => setClasificacion(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white">
                <option>Grado A</option>
                <option>Grado B</option>
                <option>Grado C</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Peso Bruto (kg)</label>
              <input type="number" step="0.1" value={pesoBruto} onChange={e => setPesoBruto(Number(e.target.value))}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Peso Neto (kg)</label>
              <input type="number" step="0.1" value={pesoNeto} onChange={e => setPesoNeto(Number(e.target.value))}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Ubicación Inicial</label>
              <select value={ubicacion} onChange={e => setUbicacion(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white">
                <option>Granja</option>
                <option>Bodega Central</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Granja Origen</label>
              <input type="text" value={granjaOrigen} onChange={e => setGranjaOrigen(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Galerón Origen</label>
              <input type="text" value={galeronOrigen} onChange={e => setGaleronOrigen(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white placeholder:text-neutral-400" placeholder="Opcional" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Lote</label>
              <input type="text" value={lote} onChange={e => setLote(e.target.value)}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white placeholder:text-neutral-400" placeholder="Opcional" />
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Cantidad de Etiquetas</label>
              <input type="number" min="1" max="100" value={cantidadEtiquetas} onChange={e => setCantidadEtiquetas(Number(e.target.value))}
                className="w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-sm focus:border-purple-500 outline-none text-neutral-800 dark:text-white" />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={handleGenerar} disabled={loading}
              className="px-6 py-2.5 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center">
                {loading ? <Spinner className="mr-2" /> : <Tag className="w-4 h-4 mr-2" />}
              Generar {cantidadEtiquetas > 1 ? `${cantidadEtiquetas} Etiquetas` : 'Etiqueta'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white dark:bg-neutral-800 rounded-3xl shadow-sm border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
            <input type="text" placeholder="Buscar por código, producto o lote..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-xl text-sm focus:border-purple-500 outline-none shadow-sm text-neutral-800 dark:text-white placeholder:text-neutral-400" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 uppercase tracking-wider font-bold text-xs border-b border-neutral-200 dark:border-neutral-700">
              <tr>
                <th className="px-6 py-4">Código</th>
                <th className="px-6 py-4">Producto</th>
                <th className="px-6 py-4">Cantidad</th>
                <th className="px-6 py-4">Peso Neto</th>
                <th className="px-6 py-4">Ubicación</th>
                <th className="px-6 py-4 text-center">Estado</th>
                <th className="px-6 py-4">Fecha</th>
                <th className="px-6 py-4">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
              {filteredEtiquetas.map(eq => (
                <tr key={eq.id} className="hover:bg-purple-50/30 dark:hover:bg-neutral-700/50 transition-colors">
                  <td className="px-6 py-4 font-mono font-bold text-purple-700 dark:text-purple-300 text-xs">{eq.codigoUnico}</td>
                  <td className="px-6 py-4 font-medium text-neutral-800 dark:text-white">{eq.producto}</td>
                  <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300">{eq.cantidad}</td>
                  <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300">{eq.pesoNeto ? `${eq.pesoNeto} kg` : '—'}</td>
                  <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300 flex items-center gap-1"><MapPin className="w-3 h-3" /> {eq.ubicacionActual || '—'}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={cn("inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase", getEstadoColor(eq.estado))}>{eq.estado}</span>
                  </td>
                  <td className="px-6 py-4 text-neutral-500 dark:text-neutral-400 text-xs">{eq.fechaProduccion ? new Date(eq.fechaProduccion).toLocaleDateString() : '—'}</td>
                  <td className="px-6 py-4">
                    <button onClick={() => handlePrint(eq)} className="p-1.5 text-neutral-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-neutral-700 rounded-lg transition-colors" title="Imprimir etiqueta">
                      <Printer className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredEtiquetas.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-neutral-500 dark:text-neutral-400">No se encontraron etiquetas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
