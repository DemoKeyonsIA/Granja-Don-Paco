import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, ArrowRightLeft, Box, Receipt, Truck } from 'lucide-react';
import { User } from '../types';
import { cn } from '../lib/utils';
import { BloqueCarga } from './Spinner';

/**
 * Panel de auditoría de ruta: carga, vendido, stock y merma del camión.
 *
 * La consolidación G2 sacó al módulo Logística de la navegación: su pestaña
 * `trazabilidad` dejó de ser pantalla propia y solo lo que no estaba en
 * `Despacho.tsx` se mudó acá. La lista de guías, la línea de tiempo de cinco
 * hitos, las etiquetas con estado y el orden con ventana ya vivían en el detalle
 * de Despacho, así que **no** se duplican; lo que faltaba era esta cuenta con
 * `/api/inventario`, y eso es todo lo que traído este panel.
 *
 * El selector de camión es propio porque la merma se calcula por camión.
 */
export default function AuditoriaRuta({ currentUser: _currentUser }: { currentUser: User }) {
  const [camiones, setCamiones] = useState<any[]>([]);
  const [guias, setGuias] = useState<any[]>([]);
  const [inventario, setInventario] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [camionId, setCamionId] = useState<string>('');

  const camion = camiones.find((c: any) => c.id === camionId) || null;
  const guiasDelCamion = guias.filter((g: any) => g.camionId === camionId);
  const camionObjetivo = camion?.nombre || 'Este camión';

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [resCam, resGuias, resInv] = await Promise.all([
        fetch('/api/logistica/camiones'),
        fetch('/api/logistica/guias'),
        fetch('/api/inventario'),
      ]);
      if (resCam.ok) setCamiones(await resCam.json());
      if (resGuias.ok) setGuias(await resGuias.json());
      if (resInv.ok) setInventario(await resInv.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!camionId && camiones.length > 0) setCamionId(camiones[0].id);
  }, [camiones, camionId]);

  if (isLoading) return <BloqueCarga className="min-h-[20vh]" />;

  if (camiones.length === 0) {
    return (
      <div className="rounded-2xl p-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
        <Truck className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
          No hay camiones registrados. Créelos en el paso Flota y Rutas.
        </p>
      </div>
    );
  }

  const totalCargado = guiasDelCamion.reduce((acc: number, g: any) => acc + Number(g.totalCartones || 0), 0);
  const totalVendido = guiasDelCamion.reduce((acc: number, g: any) => acc + Number(g.totalVendido || 0), 0);
  // `camion` es `null` en el primer render, hasta que el efecto elige el primero.
  // Leer `camion.nombre` sin guardar tumbaba el grupo entero con una pantalla en
  // blanco (el ErrorBoundary se come la excepción), así que el stock se cuenta
  // solo si hay camión seleccionado.
  const stockCamion = camion
    ? inventario.filter((i: any) => i.ubicacion === camion.nombre).reduce((acc: number, i: any) => acc + Number(i.cantidad), 0)
    : 0;
  const merma = totalCargado - totalVendido - stockCamion;

  return (
    <div className="p-4 rounded-xl space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h4 className="font-semibold flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
          Auditoría de ruta — KPIs de stock y merma
        </h4>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
          <Truck className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />
          <select value={camionId} onChange={e => setCamionId(e.target.value)} className="bg-transparent outline-none font-bold" style={{ color: 'var(--text-primary)' }}>
            {camiones.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl p-5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center space-x-2 mb-2">
            <Box className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} />
            <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Carga en guías</h4>
          </div>
          <p className="text-3xl font-black" style={{ color: 'var(--text-primary)' }}>{totalCargado} <span className="text-lg font-bold opacity-50">cts</span></p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{guiasDelCamion.length} guías · Bodega → {camionObjetivo}</p>
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center space-x-2 mb-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Vendido (tiquetes de ruta)</h4>
          </div>
          <p className="text-3xl font-black text-emerald-600">{totalVendido} <span className="text-lg font-bold opacity-50">cts</span></p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Ventas en vivo de la caja de ruta</p>
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center space-x-2 mb-2">
            <ArrowRightLeft className="w-5 h-5 text-orange-600" />
            <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Stock actual</h4>
          </div>
          <p className="text-3xl font-black" style={{ color: 'var(--text-primary)' }}>{stockCamion} <span className="text-lg font-bold opacity-50">cts</span></p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Inventario físico en {camionObjetivo}</p>
        </div>

        <div className="rounded-2xl p-5 border" style={{ background: merma === 0 ? 'var(--status-success-soft)' : 'var(--status-danger-soft)', borderColor: merma === 0 ? 'var(--status-success)' : 'var(--status-danger)' }}>
          <div className="flex items-center space-x-2 mb-2">
            <AlertTriangle className={cn('w-5 h-5', merma === 0 ? 'text-emerald-600' : 'text-red-600')} />
            <h4 className={cn('font-bold text-xs uppercase tracking-wider', merma === 0 ? 'text-emerald-700' : 'text-red-700')}>Merma</h4>
          </div>
          <p className={cn('text-3xl font-black', merma === 0 ? 'text-emerald-800' : 'text-red-800')}>
            {merma} <span className="text-lg font-bold opacity-70">cts</span>
          </p>
          <p className={cn('text-xs mt-1 font-medium', merma === 0 ? 'text-emerald-600' : 'text-red-600')}>
            {merma === 0 ? 'Cuadre matemático exacto' : 'Discrepancia detectada'}
          </p>
        </div>
      </div>
    </div>
  );
}
