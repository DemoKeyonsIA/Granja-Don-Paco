import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { User } from '../../types';
import SaludDelNegocio, { operativoDe, type SaludNegocio } from '../SaludDelNegocio';
import { sessionHeaders } from '../../lib/session';

/**
 * El primer grupo del hub de Operaciones: cómo está la operación hoy.
 *
 * Este componente estaba muerto: nadie lo importaba y el tab `resumen` que la
 * configuración declaraba no lo montaba nadie, así que el hub de cinco grupos
 * habría tenido una puerta vacía. La Fase 7 lo convierte en el cuerpo de ese tab.
 *
 * Los números salen de `/api/dashboard/enterprise`, el mismo endpoint que
 * alimenta el bloque "Salud del negocio" de Finanzas. Se leen solo los campos
 * operativos: producción, bodega, rutas y desperdicios. Los cinco campos de
 * dinero que el endpoint también devuelve quedan fuera a propósito, porque
 * `/api/finanzas/resumen` los calcula mejor y copiar los dos sería volver a abrir
 * la brecha que la Fase 3 cerró.
 *
 * Antes este archivo tomaba cuatro números por props y las invocaba con los
 * nombres rotos por una codificación anterior ("ProducciA3n Hoy"), y su
 * `enTransito` no existía en ningún payload.
 */

export default function ResumenDelDia({ currentUser, onNavigate }: { currentUser: User; onNavigate?: (id: string) => void }) {
  const [operativo, setOperativo] = useState<SaludNegocio | null>(null);
  const [guias, setGuias] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [res, guiasRes] = await Promise.all([
        fetch('/api/dashboard/enterprise', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/logistica/guias', { headers: sessionHeaders(currentUser.id) }).catch(() => null),
      ]);
      if (!res.ok) throw new Error(`El resumen no respondió (${res.status})`);
      setOperativo(operativoDe(await res.json()));
      if (guiasRes?.ok) {
        const data = await guiasRes.json();
        setGuias(Array.isArray(data) ? data : []);
      } else setGuias([]);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el resumen del día.');
    } finally {
      setCargando(false);
    }
  }, [currentUser.id]);

  useEffect(() => { void cargar(); }, [cargar]);

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-[30vh] text-sm" style={{ color: 'var(--text-muted)' }}>
        Cargando el resumen del día…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex items-center justify-between gap-4">
        <span>{error}</span>
        <button onClick={() => void cargar()} className="font-bold underline whitespace-nowrap">Reintentar</button>
      </div>
    );
  }

  // Sin los cinco números no se pinta nada. Mostrar ceros cuando el endpoint vino
  // incompleto es la misma mentira que pintar "todo en cero" cuando el resumen
  // financier da 404, y acá significaría "hoy no se produjo nada" frente a
  // "no se pudo saber cuánto se produjo".
  if (!operativo) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>El resumen vino incompleto, así que no se muestran números. Los otros grupos del hub siguen disponibles.</span>
        <button onClick={() => void cargar()} className="ml-auto font-bold underline whitespace-nowrap">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in" data-testid="operaciones-resumen">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Operación de hoy</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Producción, bodega y estado de las guías en una vista.</p></div>
        <button onClick={() => void cargar()} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>Actualizar</button>
      </div>
      <SaludDelNegocio salud={operativo} variante="operaciones" />
      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-4">
        <section className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
          <header className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--border-default)' }}>
            <div><h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Guías de despacho</h3><p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Carga, venta documentada y estado de cada ruta.</p></div>
            <button onClick={() => onNavigate?.('despacho-guias')} className="text-sm font-semibold" style={{ color: 'var(--text-link)' }}>Abrir guías</button>
          </header>
          {guias.length === 0 ? <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>No hay guías para mostrar.</div> : (
            <div className="divide-y" style={{ borderColor: 'var(--border-default)' }}>
              {guias.slice(0, 6).map((g: any) => {
                const estado = g.estadoLogico || g.estado || 'Sin estado';
                const activa = !String(estado).toLowerCase().includes('cerrada');
                const tienePesoKg = g.totalKg != null;
                const cargado = Number(tienePesoKg ? g.totalKg : g.totalCartones ?? 0);
                const vendido = Number(g.totalVendidoKg ?? g.totalVendido ?? 0);
                return <button key={g.id} onClick={() => onNavigate?.('despacho-guias')} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--bg-muted)]">
                  <div className="min-w-[180px]"><div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{g.consecutivo || 'Guía de despacho'} · {g.camionNombre || 'Camión sin asignar'}</div><div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{g.rutaNombre || g.ruta || (g.camionNombre ? `Ruta de ${g.camionNombre}` : 'Ruta sin asignar')} · {g.fecha ? new Date(g.fecha).toLocaleDateString('es-CR') : 'fecha pendiente'}</div></div>
                  <div className="flex flex-wrap items-center gap-4 text-sm"><span><b>{cargado.toLocaleString('es-CR')} {tienePesoKg ? 'kg' : 'ct'}</b><small className="block" style={{ color: 'var(--text-muted)' }}>{tienePesoKg ? 'cargados' : 'carga histórica'}</small></span><span><b>{vendido.toLocaleString('es-CR')}{tienePesoKg ? ' kg' : ''}</b><small className="block" style={{ color: 'var(--text-muted)' }}>{tienePesoKg ? 'vendidos' : 'venta en unidad histórica'}</small></span><span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: activa ? 'var(--status-info-soft)' : 'var(--status-neutral-soft)', color: 'var(--text-primary)' }}>{estado}</span></div>
                </button>;
              })}
            </div>
          )}
        </section>
        <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}>
          <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Qué revisar</h3>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>Elementos operativos derivados de guías y alertas disponibles.</p>
          <div className="space-y-3">
            {guias.filter((g: any) => /CerradaConDiferencia|diferencia/i.test(String(g.estadoLogico || g.estado || ''))).slice(0, 3).map((g: any) => <div key={g.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--status-warning)', background: 'var(--status-warning-soft)' }}><b className="text-sm">Diferencia por revisar</b><p className="text-xs mt-1">{g.consecutivo || 'Guía'} · {g.camionNombre || 'camión'} requiere seguimiento.</p></div>)}
            {guias.filter((g: any) => !/cerrada/i.test(String(g.estadoLogico || g.estado || ''))).length > 0 ? <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-muted)' }}><b className="text-sm">{guias.filter((g: any) => !/cerrada/i.test(String(g.estadoLogico || g.estado || ''))).length} guía(s) en proceso</b><p className="text-xs mt-1">Al terminar la ruta, registra venta, retorno aceptado y merma para cuadrar custodia.</p></div> : null}
            {guias.filter((g: any) => /CerradaConDiferencia|diferencia/i.test(String(g.estadoLogico || g.estado || ''))).length === 0 && guias.filter((g: any) => !/cerrada/i.test(String(g.estadoLogico || g.estado || ''))).length === 0 && <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--status-success-soft)', color: 'var(--text-primary)' }}>No hay guías activas ni diferencias reportadas.</div>}
            <button onClick={() => onNavigate?.('bodega-entradas')} className="w-full rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-link)' }}>Revisar entradas de bodega</button>
          </div>
        </section>
      </div>
    </div>
  );
}
