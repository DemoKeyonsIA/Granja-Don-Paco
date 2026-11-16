import React, { useState, useEffect } from 'react';
import { Tag, Search, QrCode, MapPin, Printer } from 'lucide-react';
import { Etiqueta, User } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { sessionHeaders } from '../lib/session';

interface EtiquetasProps {
  currentUser: User;
}

/**
 * Etiquetas — trazabilidad y registro del peso neto medido por Bodega/Despacho.
 *
 * La Fase 12 le quitó la generación ad-hoc y los botones de mover estado: las
 * etiquetas QR se generan en Bodega (Entradas › Alistamiento, `DespachoAdmin`)
 * y su estado lo mueve el flujo real (carga en guía, venta en ruta). El peso
 * neto se registra manualmente ahora; el mismo contrato admite origen Báscula.
 */
export default function Etiquetas({ currentUser }: EtiquetasProps) {
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Scan state
  const [scanCode, setScanCode] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [pesajeEtiqueta, setPesajeEtiqueta] = useState<Etiqueta | null>(null);
  const [pesoKg, setPesoKg] = useState('');
  const [guardandoPeso, setGuardandoPeso] = useState(false);

  const fetchEtiquetas = async () => {
    try {
      const res = await fetch('/api/etiquetas', { headers: sessionHeaders(currentUser.id) });
      if (res.ok) setEtiquetas(await res.json());
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

  const handleEscanear = async () => {
    if (!scanCode.trim()) return;
    try {
      const res = await fetch(`/api/etiquetas/trazabilidad/${encodeURIComponent(scanCode.trim())}`, { headers: sessionHeaders(currentUser.id) });
      if (res.ok) { setScanResult(await res.json()); }
      else { setScanResult(null); toast.error('Etiqueta no encontrada.'); }
    } catch (err: any) { toast.error(`Error: ${err.message}`); }
  };

  const guardarPeso = async () => {
    if (!pesajeEtiqueta) return;
    const peso = Number(pesoKg);
    if (!Number.isFinite(peso) || peso <= 0) return toast.error('Escriba el peso neto en kg.');
    setGuardandoPeso(true);
    try {
      const res = await fetch(`/api/etiquetas/${pesajeEtiqueta.id}/peso-neto`, {
        method: 'POST', headers: sessionHeaders(currentUser.id, true),
        body: JSON.stringify({ pesoKg: peso, origen: 'Manual' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar el pesaje');
      toast.success(`Peso registrado: ${peso.toFixed(2)} kg`);
      setPesajeEtiqueta(null); setPesoKg('');
      await fetchEtiquetas();
    } catch (error: any) { toast.error(error.message); }
    finally { setGuardandoPeso(false); }
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
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">Registre el peso neto real en kg, rastree las etiquetas y consulte su recorrido. La generación ocurre en Bodega › Entradas › Alistamiento.</p>
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
          <button onClick={handleEscanear} className="btn-primary">
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
              {scanResult.etiqueta.pesoNeto && <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Registro del peso</span><p className="font-medium text-neutral-700 dark:text-neutral-300">{scanResult.etiqueta.pesoOrigen || 'Manual'} · {scanResult.etiqueta.pesoRegistradoEn ? new Date(scanResult.etiqueta.pesoRegistradoEn).toLocaleString() : 'fecha anterior'}</p></div>}
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Granja</span><p className="font-medium text-neutral-700 dark:text-neutral-300">{scanResult.etiqueta.granjaOrigen || 'N/A'}</p></div>
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Clasificación</span><p className="font-medium text-neutral-700 dark:text-neutral-300">{scanResult.etiqueta.clasificacion || 'N/A'}</p></div>
              <div><span className="text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase">Lote</span><p className="font-medium text-neutral-700 dark:text-neutral-300">{scanResult.etiqueta.lote || 'N/A'}</p></div>
            </div>
            <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">La trazabilidad se mueve con el flujo real (carga en guía, venta en ruta) — no hay pasos manuales.</p>
          </div>
        )}
      </div>

      {pesajeEtiqueta && <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="pesaje-title">
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-800 p-5 shadow-xl space-y-4">
          <div><h3 id="pesaje-title" className="text-lg font-bold text-neutral-900 dark:text-white">Registrar peso neto</h3><p className="text-sm text-neutral-500">{pesajeEtiqueta.codigoUnico} · {pesajeEtiqueta.producto}</p></div>
          <label className="block text-sm font-semibold text-neutral-700 dark:text-neutral-200">Peso neto medido (kg)
            <input autoFocus type="number" min="0.01" step="0.01" value={pesoKg} onChange={e => setPesoKg(e.target.value)} onKeyDown={e => e.key === 'Enter' && guardarPeso()} className="mt-1 w-full rounded-xl border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-3 text-lg" placeholder="Ej. 29.50" />
          </label>
          <p className="text-xs text-neutral-500">Ingrese el valor mostrado por la báscula. El registro queda asociado al usuario y la hora.</p>
          <div className="flex justify-end gap-2"><button onClick={() => setPesajeEtiqueta(null)} className="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-600">Cancelar</button><button disabled={guardandoPeso} onClick={guardarPeso} className="btn-primary">{guardandoPeso ? 'Guardando…' : 'Guardar pesaje'}</button></div>
        </div>
      </div>}

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
                    {['Generada', 'EnBodega'].includes(eq.estado) && <button onClick={() => { setPesajeEtiqueta(eq); setPesoKg(eq.pesoNeto ? String(eq.pesoNeto) : ''); }} className="mr-2 rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100" title="Registrar peso neto">{eq.pesoNeto ? 'Actualizar kg' : 'Pesar'}</button>}
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
