import React, { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, CircleDollarSign, Upload, RefreshCw } from 'lucide-react';
import type { User } from '../types';
import { loadSession } from '../lib/session';
import { fmtCRC } from '../lib/finanzas';
import { toast } from 'sonner';

type Cierre = {
  id: string; consecutivo: string; fecha: string; estado: string;
  efectivoContado: number | null; deposito: null | { montoEsperado: number; montoDepositado: number; referencia: string; comprobante?: string | null; fecha: string; estado: string };
};

export default function ConciliacionDepositos({ currentUser }: { currentUser: User }) {
  const [cierres, setCierres] = useState<Cierre[]>([]);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [referencias, setReferencias] = useState<Record<string, string>>({});
  const [comprobantes, setComprobantes] = useState<Record<string, string>>({});
  const roles = currentUser.roles?.length ? currentUser.roles : [currentUser.role];
  const puedeRegistrar = roles.includes('Admin');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const token = loadSession()?.token;
      const res = await fetch('/api/finanzas/depositos', { headers: { 'x-user-id': currentUser.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
      if (!res.ok) throw new Error('No se pudieron cargar los cierres y depósitos.');
      const data = await res.json();
      setCierres(Array.isArray(data) ? data : []);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al cargar depósitos.'); }
    finally { setCargando(false); }
  }, [currentUser.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const registrar = async (cierre: Cierre) => {
    const monto = Number(montos[cierre.id]);
    const referencia = String(referencias[cierre.id] || '').trim();
    if (!Number.isFinite(monto) || monto < 0 || !referencia) return toast.error('Indique el monto depositado y la referencia del comprobante.');
    setEnviando(cierre.id);
    try {
      const token = loadSession()?.token;
      const res = await fetch('/api/finanzas/depositos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ cierreId: cierre.id, montoDepositado: monto, referencia, comprobante: comprobantes[cierre.id] || null, idempotencyKey: crypto.randomUUID() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar el depósito.');
      toast.success(data.deposito?.estado === 'Conciliado' ? 'Depósito conciliado.' : 'Depósito guardado; la diferencia quedó pendiente de aprobación.');
      await cargar();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al registrar el depósito.'); }
    finally { setEnviando(null); }
  };

  return (
    <section className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-5" data-testid="finanzas-depositos">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <span className="rounded-xl p-2 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><Building2 className="h-5 w-5" /></span>
          <div><h3 className="font-bold text-neutral-900 dark:text-white">Depósitos bancarios</h3><p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Compare cada depósito con el efectivo contado al cerrar la ruta.</p></div>
        </div>
        <button type="button" onClick={cargar} disabled={cargando} className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-2 text-neutral-600 dark:text-neutral-300 disabled:opacity-50" aria-label="Actualizar depósitos"><RefreshCw className="h-4 w-4" /></button>
      </div>
      {cargando ? <p className="py-3 text-sm text-neutral-500">Cargando cierres…</p> : cierres.length === 0 ? <p className="py-3 text-sm text-neutral-500">Aún no hay cierres de caja para depositar.</p> : (
        <div className="space-y-3">
          {cierres.map(cierre => (
            <article key={cierre.id} className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-bold text-neutral-900 dark:text-white">{cierre.consecutivo}</p><p className="text-xs text-neutral-500">Cierre {cierre.estado} · efectivo contado {cierre.efectivoContado == null ? 'pendiente' : fmtCRC(cierre.efectivoContado)}</p></div>
                {cierre.deposito && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cierre.deposito.estado === 'Conciliado' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{cierre.deposito.estado === 'Conciliado' ? 'Conciliado' : cierre.deposito.estado === 'DiferenciaPendiente' ? 'Diferencia pendiente' : cierre.deposito.estado}</span>}
              </div>
              {cierre.deposito ? (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                  <p><span className="text-neutral-500">Depositado:</span> {fmtCRC(cierre.deposito.montoDepositado)}</p><p><span className="text-neutral-500">Referencia:</span> {cierre.deposito.referencia}</p><p><span className="text-neutral-500">Esperado:</span> {fmtCRC(cierre.deposito.montoEsperado)}</p>
                  {cierre.deposito.comprobante && <p className="sm:col-span-3 break-all"><span className="text-neutral-500">Comprobante:</span> {cierre.deposito.comprobante}</p>}
                </div>
              ) : puedeRegistrar && ['Cuadrada', 'Aprobada'].includes(cierre.estado) && cierre.efectivoContado != null ? (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_1.4fr_auto] gap-2 items-end">
                  <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Monto depositado (₡)<input type="number" min="0" step="1" inputMode="decimal" value={montos[cierre.id] ?? ''} onChange={e => setMontos(v => ({ ...v, [cierre.id]: e.target.value }))} className="mt-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Referencia bancaria<input value={referencias[cierre.id] ?? ''} onChange={e => setReferencias(v => ({ ...v, [cierre.id]: e.target.value }))} placeholder="Número de depósito" className="mt-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm" /></label>
                  <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Comprobante (enlace opcional)<input value={comprobantes[cierre.id] ?? ''} onChange={e => setComprobantes(v => ({ ...v, [cierre.id]: e.target.value }))} placeholder="Enlace al documento" className="mt-1 w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm" /></label>
                  <button type="button" onClick={() => registrar(cierre)} disabled={enviando === cierre.id} className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Upload className="h-4 w-4" />{enviando === cierre.id ? 'Guardando…' : 'Registrar'}</button>
                </div>
              ) : !cierre.deposito ? <p className="mt-3 flex items-center gap-2 text-xs text-neutral-500"><CircleDollarSign className="h-4 w-4" />El depósito estará disponible cuando el conteo de caja quede cuadrado o aprobado.</p> : <p className="mt-3 flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />Referencia guardada para auditoría.</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
