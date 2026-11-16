import React, { useState, useEffect } from 'react';
import { DollarSign, Search, Calendar, AlertCircle, CheckCircle2, TrendingUp, TrendingDown, Clock, MessageSquare, CreditCard, Wallet, X, Copy } from 'lucide-react';
import { Factura, User, Cliente } from '../types';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { BloqueCarga } from './Spinner';
import { loadSession, sessionHeaders } from '../lib/session';
import { diasVencidoDe, esCredito, estaSaldada } from '../lib/cobranza';

interface CobranzaProps {
  currentUser: User;
}

export default function Cobranza({ currentUser }: CobranzaProps) {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'cuentas' | 'finanzas'>('cuentas');
  const [searchTerm, setSearchTerm] = useState('');
  const [pagoSel, setPagoSel] = useState<Factura | null>(null);
  const [metodoPago, setMetodoPago] = useState<'Efectivo' | 'SINPE' | 'Transferencia'>('Efectivo');
  const [enviandoPago, setEnviandoPago] = useState(false);
  const [clavesPago, setClavesPago] = useState<Record<string, string>>({});
  const [montoPago, setMontoPago] = useState('');
  const [recordatorioSel, setRecordatorioSel] = useState<Factura | null>(null);

  useEffect(() => {
    const cargarDatos = async () => {
      try {
        const [resFac, resCli] = await Promise.all([
          fetch('/api/facturas', { headers: sessionHeaders(currentUser.id) }),
          fetch('/api/clientes', { headers: sessionHeaders(currentUser.id) })
        ]);
        if (resFac.ok) {
          const data = await resFac.json();
          if (Array.isArray(data)) setFacturas(data);
        } else {
          toast.error("No se pudieron cargar las facturas");
        }
        if (resCli.ok) {
          const data = await resCli.json();
          if (Array.isArray(data)) setClientes(data);
        }
      } catch {
        toast.error("Error al cargar cobranza");
      } finally {
        setIsLoading(false);
      }
    };
    cargarDatos();
  }, [currentUser.id]);

  const getCliente = (id: string) => clientes.find(c => c.id === id);

  const copiarRecordatorio = async () => {
    if (!recordatorioSel) return;
    const clienteNombre = getCliente(recordatorioSel.clienteId)?.nombre || 'cliente';
    const saldo = Number(recordatorioSel.saldoPendiente ?? recordatorioSel.total);
    const mensaje = `Hola ${clienteNombre}, te recordamos que la factura ${recordatorioSel.consecutivo} tiene un saldo pendiente de ₡${saldo.toLocaleString('es-CR')}. Cuando realices el pago, por favor envíanos el comprobante. Gracias, Granja Don Paco.`;
    try {
      await navigator.clipboard.writeText(mensaje);
      toast.success('Texto del recordatorio copiado. Revísalo antes de enviarlo.');
    } catch {
      toast.error('El navegador no permitió copiar el texto. Selecciónalo y cópialo manualmente.');
    }
  };

/**
 * Días transcurridos desde `dateStr`, como mínimo 0.
 *
 * Sin el `Math.abs` que tenía antes, una factura con fecha futura reportaba una
 * antigüedad positiva y caía en "vencida" (`daysPast > 15`). El valor se usa
 * para aging, así que una fecha que aún no llega vale 0 días, no negativos.
 */
const calculateDaysPast = (dateStr: string) => {
  const diffTime = new Date().getTime() - new Date(dateStr).getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
};

  const confirmarPago = async () => {
    if (!pagoSel) return;
    const saldo = Number(pagoSel.saldoPendiente ?? pagoSel.total);
    const monto = Number(montoPago);
    if (!Number.isFinite(monto) || monto <= 0 || monto > saldo) {
      toast.error(`Ingrese un monto mayor a cero y hasta ₡${saldo.toLocaleString()}`);
      return;
    }
    setEnviandoPago(true);
    try {
      const idempotencyKey = clavesPago[pagoSel.id] || crypto.randomUUID();
      if (!clavesPago[pagoSel.id]) setClavesPago(prev => ({ ...prev, [pagoSel.id]: idempotencyKey }));
      const token = loadSession()?.token;
      const res = await fetch('/api/pagos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, 'x-user-id': currentUser.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ facturaId: pagoSel.id, metodoPago, monto, usuarioId: currentUser.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al registrar el pago');
      const facturaActualizada = data.factura || {};
      setFacturas(facturas.map(f => f.id === pagoSel.id ? {
        ...f,
        ...facturaActualizada,
        pagado: Number(data.pagado ?? (Number(f.pagado || 0) + monto)),
        saldoPendiente: Number(data.saldo ?? Math.max(0, saldo - monto)),
        estado: facturaActualizada.estado || (saldo - monto <= 0 ? 'Pagada' : 'Pendiente'),
        metodo_pago: metodoPago,
      } : f));
      setPagoSel(null);
      setClavesPago(prev => { const next = { ...prev }; delete next[pagoSel.id]; return next; });
      toast.success(`Pago de la factura ${pagoSel.consecutivo} registrado`);
    } catch (err: any) {
      toast.error(err.message || "Error al registrar el pago");
    } finally {
      setEnviandoPago(false);
    }
  };

  const facturasCreditoPendientes = facturas.filter(f =>
    esCredito(f.condicion_pago)
    && !estaSaldada(f.estado)
    && Number(f.saldoPendiente ?? f.total) > 0
  );
  
  const filteredCuentas = facturasCreditoPendientes.filter(f => {
    const cliente = getCliente(f.clienteId)?.nombre || '';
    return f.consecutivo.toLowerCase().includes(searchTerm.toLowerCase()) || 
           cliente.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Métricas de Finanzas
  const totalCobradoContado = facturas
    .filter(f => f.condicion_pago === 'Contado' && f.estado !== 'Anulada')
    .reduce((acc, f) => acc + Number(f.pagado ?? (f.estado === 'Pagada' ? f.total : 0)), 0);

  const totalCuentasPorCobrar = facturasCreditoPendientes
    .reduce((acc, f) => acc + Number(f.saldoPendiente ?? f.total), 0);

  const facturasVencidas = facturasCreditoPendientes.filter(f => diasVencidoDe(f) > 15);
  const totalVencido = facturasVencidas.reduce((acc, f) => acc + Number(f.saldoPendiente ?? f.total), 0);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in pb-20">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
           <h2 className="text-2xl font-bold text-neutral-800 flex items-center">
             <DollarSign className="w-6 h-6 mr-2" style={{ color: 'var(--brand-primary)' }} />
             Cobranza y Finanzas
           </h2>
           <p className="text-sm text-neutral-500 mt-1">
             Cuentas por cobrar, recordatorios de antigüedad y balances.
           </p>
        </div>
        
        <div className="flex bg-neutral-100 p-1 rounded-xl">
          <button 
            onClick={() => setActiveTab('cuentas')}
            className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-colors", activeTab === 'cuentas' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}
          >
            Cuentas por Cobrar
          </button>
          <button 
            onClick={() => setActiveTab('finanzas')}
            className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-colors", activeTab === 'finanzas' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}
          >
            Panel de Finanzas
          </button>
        </div>
      </div>

      {activeTab === 'finanzas' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-neutral-200">
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2.5 rounded-xl" style={{ background: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)' }}>
                  <Wallet className="w-6 h-6" style={{ color: 'var(--brand-primary)' }} />
                </div>
                <div>
                  <h4 className="font-bold text-neutral-700">Ingresos Contado</h4>
                  <p className="text-xs text-neutral-500">Recibido (Efectivo/SINPE)</p>
                </div>
              </div>
              <p className="text-3xl font-black" style={{ color: 'var(--brand-primary)' }}>₡{totalCobradoContado.toLocaleString()}</p>
              <div className="mt-4 flex items-center text-xs font-bold bg-stone-50 px-3 py-1.5 rounded-lg w-fit" style={{ color: 'var(--text-link)' }}>
                <TrendingUp className="w-4 h-4 mr-1" />
                +12% vs mes anterior
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-neutral-200">
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2.5 rounded-xl" style={{ background: 'color-mix(in srgb, var(--brand-secondary) 8%, transparent)' }}>
                  <CreditCard className="w-6 h-6" style={{ color: 'var(--brand-secondary)' }} />
                </div>
                <div>
                  <h4 className="font-bold text-neutral-700">Cuentas por Cobrar</h4>
                  <p className="text-xs text-neutral-500">Crédito Activo</p>
                </div>
              </div>
              <p className="text-3xl font-black" style={{ color: 'var(--brand-secondary)' }}>₡{totalCuentasPorCobrar.toLocaleString()}</p>
              <div className="mt-4 flex justify-between items-center text-xs text-neutral-500 font-medium">
                <span>{facturasCreditoPendientes.length} facturas pendientes</span>
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-red-200">
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2.5 bg-red-50 rounded-xl">
                  <AlertCircle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h4 className="font-bold text-neutral-700">Saldo Vencido</h4>
                  <p className="text-xs text-red-500">&gt; 15 días</p>
                </div>
              </div>
              <p className="text-3xl font-black text-red-600">₡{totalVencido.toLocaleString()}</p>
              <div className="mt-4 flex justify-between items-center text-xs text-red-700 font-bold bg-red-50 px-3 py-1.5 rounded-lg">
                <span>{facturasVencidas.length} facturas en mora</span>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-3xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="p-5 border-b border-neutral-200 flex justify-between items-center">
              <h3 className="font-bold text-neutral-800">Flujo de Caja Reciente</h3>
              <select className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none">
                <option>Últimos 7 días</option>
                <option>Este mes</option>
              </select>
            </div>
            <div className="p-8 flex flex-col items-center justify-center text-center">
               <TrendingUp className="w-12 h-12 text-neutral-300 mb-4" />
               <p className="text-neutral-500 font-medium">Gráfico de flujo de caja próximamente.</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'cuentas' && (
        <div className="bg-white rounded-3xl shadow-sm border border-neutral-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
          <div className="p-4 border-b border-neutral-200 bg-neutral-50/50 flex flex-col sm:flex-row gap-4 justify-between items-center">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
              <input 
                type="text" 
                placeholder="Buscar cliente o número de factura..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-neutral-300 rounded-xl text-sm outline-none shadow-sm transition-all"
              />
            </div>
            <div className="flex gap-2">
               <span className="flex items-center text-xs font-bold bg-red-50 text-red-700 px-3 py-1.5 rounded-lg">
                 <AlertCircle className="w-4 h-4 mr-1.5" />
                 {facturasVencidas.length} Vencidas
               </span>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-bold text-xs border-b border-neutral-200">
                <tr>
                  <th className="px-6 py-4">Cliente</th>
                  <th className="px-6 py-4">Factura</th>
                  <th className="px-6 py-4">Fecha Emisión</th>
                  <th className="px-6 py-4 text-center">Antigüedad</th>
                  <th className="px-6 py-4 text-right">Saldo</th>
                  <th className="px-6 py-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {isLoading && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center">
                      <BloqueCarga texto="Cargando cuentas por cobrar..." />
                    </td>
                  </tr>
                )}
                {!isLoading && filteredCuentas.map(f => {
                  const daysPast = diasVencidoDe(f);
                  const isPastDue = daysPast > 15;
                  const saldoPendiente = Number(f.saldoPendiente ?? f.total);
                  
                  return (
                    <tr key={f.id} className="hover:bg-neutral-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-bold text-neutral-900">{getCliente(f.clienteId)?.nombre || 'Desconocido'}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">{getCliente(f.clienteId)?.ruta}</p>
                      </td>
                      <td className="px-6 py-4 font-bold text-neutral-700">{f.consecutivo}</td>
                      <td className="px-6 py-4 text-neutral-600">
                        {new Date(f.fecha).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={cn(
                          "inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold",
                          isPastDue ? "bg-red-100 text-red-800" : "bg-stone-100 text-stone-700"
                        )}>
                          <Clock className="w-3 h-3 mr-1" />
                          {daysPast} días
                        </span>
                        {isPastDue && (
                           <p className="text-[10px] text-red-600 font-bold mt-1 uppercase tracking-wider">Vencida</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right font-black text-neutral-800">₡{saldoPendiente.toLocaleString()}</td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center space-x-2">
                          <button onClick={() => setRecordatorioSel(f)} aria-label={`Preparar recordatorio para ${getCliente(f.clienteId)?.nombre || 'cliente'} por la factura ${f.consecutivo}`} className="text-neutral-500 p-2 hover:bg-stone-50 rounded-lg transition-colors border border-transparent flex items-center justify-center group relative" style={{ color: 'var(--brand-primary)' }}>
                            <MessageSquare className="w-4 h-4" />
                            <span className="absolute bottom-full mb-2 hidden group-hover:block bg-neutral-900 text-white text-[10px] px-2 py-1 rounded font-bold whitespace-nowrap">
                              Preparar recordatorio
                            </span>
                          </button>
                          <button 
                            onClick={() => { setPagoSel(f); setMontoPago(String(Number(f.saldoPendiente ?? f.total))); setMetodoPago('Efectivo'); }}
                            className="p-2 rounded-lg transition-colors font-bold flex items-center justify-center group relative border border-stone-200 hover:opacity-90"
                            style={{ background: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)', color: 'var(--text-link)' }}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="absolute bottom-full mb-2 hidden group-hover:block bg-neutral-900 text-white text-[10px] px-2 py-1 rounded font-bold whitespace-nowrap">
                              Registrar Pago
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!isLoading && filteredCuentas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center">
                      <div className="flex flex-col items-center justify-center">
                         <CheckCircle2 className="w-12 h-12 mb-3" style={{ color: 'var(--brand-primary)' }} />
                         <p className="text-neutral-800 font-bold text-lg">Todo al día</p>
                         <p className="text-neutral-500 text-sm">No hay cuentas por cobrar pendientes.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Registrar Pago */}
      {pagoSel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-neutral-800 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Registrar Pago
              </h3>
              <button onClick={() => { if (!enviandoPago) setPagoSel(null); }}><X className="w-5 h-5 text-neutral-500" /></button>
            </div>
            <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-3 mb-4">
              <p className="text-xs text-neutral-500">Factura</p>
              <p className="font-bold text-neutral-900">{pagoSel.consecutivo}</p>
              <p className="text-xs text-neutral-500 mt-2">Cliente</p>
              <p className="font-bold text-neutral-900">{getCliente(pagoSel.clienteId)?.nombre || 'Desconocido'}</p>
              <div className="flex justify-between items-end mt-3 pt-3 border-t border-neutral-200">
                <p className="text-xs text-neutral-500">Saldo pendiente</p>
                <p className="text-2xl font-black" style={{ color: 'var(--brand-primary)' }}>₡{Number(pagoSel.saldoPendiente ?? pagoSel.total).toLocaleString()}</p>
              </div>
            </div>
            <label htmlFor="monto-pago" className="block text-xs font-bold text-neutral-500 mb-1.5">Monto recibido (₡)</label>
            <input id="monto-pago" type="number" min="0.01" max={Number(pagoSel.saldoPendiente ?? pagoSel.total)} step="0.01" value={montoPago} onChange={e => setMontoPago(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 px-3 py-3 mb-4 text-lg font-bold" />
            <label className="block text-xs font-bold text-neutral-500 mb-1.5">Método de pago</label>
            <div className="grid grid-cols-3 gap-2">
              {(['Efectivo', 'SINPE', 'Transferencia'] as const).map(m => (
                <button key={m} onClick={() => setMetodoPago(m)}
                  className={cn("px-3 py-2.5 rounded-xl text-sm font-bold border transition-colors",
                    metodoPago === m ? "text-white border-transparent" : "bg-neutral-100 text-neutral-600 border-transparent hover:bg-neutral-200")}
                  style={metodoPago === m ? { background: 'var(--brand-primary)' } : {}}>
                  {m}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button onClick={() => setPagoSel(null)} disabled={enviandoPago}
                className="px-4 py-2.5 rounded-lg text-sm font-bold bg-neutral-100 text-neutral-600 hover:bg-neutral-200 disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={confirmarPago} disabled={enviandoPago}
                className="px-4 py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'var(--brand-primary)' }}>
                {enviandoPago ? 'Registrando…' : 'Confirmar pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      {recordatorioSel && (() => {
        const clienteNombre = getCliente(recordatorioSel.clienteId)?.nombre || 'cliente';
        const saldo = Number(recordatorioSel.saldoPendiente ?? recordatorioSel.total);
        const mensaje = `Hola ${clienteNombre}, te recordamos que la factura ${recordatorioSel.consecutivo} tiene un saldo pendiente de ₡${saldo.toLocaleString('es-CR')}. Cuando realices el pago, por favor envíanos el comprobante. Gracias, Granja Don Paco.`;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRecordatorioSel(null)}>
            <section role="dialog" aria-modal="true" aria-labelledby="recordatorio-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 id="recordatorio-title" className="text-lg font-bold text-neutral-900">Preparar recordatorio</h3>
                  <p className="mt-1 text-sm text-neutral-600">Factura {recordatorioSel.consecutivo} · saldo ₡{saldo.toLocaleString('es-CR')}</p>
                </div>
                <button type="button" onClick={() => setRecordatorioSel(null)} aria-label="Cerrar" className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100"><X className="h-5 w-5" /></button>
              </div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Texto sugerido</p>
              <textarea readOnly value={mensaje} rows={4} className="w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm leading-relaxed text-neutral-800" />
              <p className="mt-2 text-xs text-neutral-600">El sistema no envía mensajes. Copia el texto y revísalo antes de compartirlo.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setRecordatorioSel(null)} className="min-h-11 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-bold text-neutral-800 hover:bg-neutral-50">Cerrar</button>
                <button type="button" onClick={() => void copiarRecordatorio()} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ background: 'var(--brand-primary)' }}><Copy className="h-4 w-4" />Copiar texto</button>
              </div>
            </section>
          </div>
        );
      })()}
    </div>
  );
}
