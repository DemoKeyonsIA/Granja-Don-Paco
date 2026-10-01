import React, { useState, useEffect } from 'react';
import { Package, Plus, Search, FileText, Printer, Check, X, CreditCard, ScanLine, Ticket, Wifi, WifiOff, RefreshCw, AlertTriangle, Minus, ShoppingCart, Send, Download, CheckCircle, XCircle, Clock, ArrowRight, ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import Breadcrumb from './Breadcrumb';
import WizardProgress from './WizardProgress';
import { Factura, User, DetalleFactura, Cliente, InventarioItem, FacturaElectronica } from '../types';

const DRAFT_KEY = 'granja_don_paco_draft_invoice';

interface DraftState {
  tipoDocumento: 'Factura' | 'Tiquete';
  selectedCliente: string;
  detalles: DetalleFactura[];
  condicionPago: 'Contado' | 'Credito';
  metodoPago: 'Efectivo' | 'SINPE' | 'Transferencia';
  descuento: number;
  wizardStep: number;
}

function loadDraft(): DraftState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const savedAt = Number(parsed.savedAt || 0);
      if (savedAt && Date.now() - savedAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(DRAFT_KEY);
        return null;
      }
      return parsed;
    }
  } catch {}
  return null;
}

function saveDraft(state: DraftState) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

interface FacturacionProps {
  currentUser: User;
}

interface RutaDia {
  guiaId: string;
  consecutivo: string;
  camionNombre: string;
  fecha: string;
  estado: string;
  consolidada: boolean;
  nFacturas: number;
  vendidos: number;
  totalGenerado: number;
  tiquetesEmitidos: number;
  retornos: number;
}

export default function Facturacion({ currentUser }: FacturacionProps) {
  const [inventario, setInventario] = useState<InventarioItem[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [documentosElectronicos, setDocumentosElectronicos] = useState<FacturaElectronica[]>([]);
  const [rutasDia, setRutasDia] = useState<RutaDia[]>([]);
  const [catalogo, setCatalogo] = useState<{id:string;nombre:string;precioBase:number}[]>([]);

  const precioCatalogoProd = (nombre: string) => catalogo.find(c => c.nombre === nombre)?.precioBase || 0;

  // Headers de auth: el rol NO viaja en el header (lo resuelve el server contra la BD).
  const authHeaders = { 'Content-Type': 'application/json', 'x-user-id': currentUser.id };

  const fetchData = async () => {
    try {
      const [invRes, cliRes, facRes, feRes, rutRes, cRes] = await Promise.all([
        fetch('/api/inventario'),
        fetch('/api/clientes'),
        fetch('/api/facturas'),
        fetch('/api/facturacion/documentos'),
        fetch('/api/facturacion/rutas-dia'),
        fetch('/api/productos-catalogo')
      ]);
      if (invRes.ok) setInventario(await invRes.json());
      if (cliRes.ok) setClientes(await cliRes.json());
      if (facRes.ok) setFacturas(await facRes.json());
      if (feRes.ok) setDocumentosElectronicos(await feRes.json());
      if (rutRes.ok) { const data = await rutRes.json(); setRutasDia(Array.isArray(data) ? data : (data.rutas || [])); }
      if (cRes.ok) setCatalogo(await cRes.json());
    } catch (err) {
      console.error('Error fetching data', err);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOffline, setIsOffline] = useState(currentUser.role === 'Comercial');
  const [activeTab, setActiveTab] = useState<'ventas' | 'electronicos' | 'rutas'>('ventas');

  // Load draft on mount
  const draft = loadDraft();
  const [wizardStep, setWizardStep] = useState(draft?.wizardStep || 1);
  const [tipoDocumento, setTipoDocumento] = useState<'Factura' | 'Tiquete'>(draft?.tipoDocumento || 'Factura');
  const [selectedCliente, setSelectedCliente] = useState(draft?.selectedCliente || '');
  const [detalles, setDetalles] = useState<DetalleFactura[]>(draft?.detalles || [
    { producto: 'Aves', cantidad: 0, precio_unitario: 0, subtotal: 0 }
  ]);
  const [condicionPago, setCondicionPago] = useState<'Contado' | 'Credito'>(draft?.condicionPago || 'Contado');
  const [metodoPago, setMetodoPago] = useState<'Efectivo' | 'SINPE' | 'Transferencia'>(draft?.metodoPago || 'Efectivo');
  const [descuento, setDescuento] = useState(draft?.descuento || 0);

  const [enviandoFE, setEnviandoFE] = useState<string | null>(null);
  const [consolidandoRuta, setConsolidandoRuta] = useState<string | null>(null);

  const handleConsolidarRuta = async (guiaId: string) => {
    setConsolidandoRuta(guiaId);
    try {
      const res = await fetch('/api/facturacion/consolidar-ruta', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ guiaId })
      });
      const data = await res.json();
      if (res.ok) {
        const nNotas = Array.isArray(data.documentos) ? data.documentos.filter((d: any) => d.tipoDocumento === 'NotaCredito').length : 0;
        toast.success(`Ruta consolidada: ${data.facturas.length} factura(s), ${nNotas} nota(s) de crédito`);
      } else {
        toast.error(data.error || 'No se pudo consolidar la ruta');
      }
    } catch (err) {
      toast.error('Error de conexión al consolidar la ruta');
    } finally {
      setConsolidandoRuta(null);
      await fetchData();
    }
  };

  const subtotal = detalles.reduce((acc, d) => acc + d.subtotal, 0);
  const total = subtotal - descuento;
  const itemsEnCarrito = detalles.filter(d => d.cantidad > 0);

  // Persist draft whenever state changes
  useEffect(() => {
    if (isCreating) {
      saveDraft({ tipoDocumento, selectedCliente, detalles, condicionPago, metodoPago, descuento, wizardStep });
    }
  }, [isCreating, tipoDocumento, selectedCliente, detalles, condicionPago, metodoPago, descuento, wizardStep]);

  const getCliente = (id: string) => clientes.find(c => c.id === id);

  const handleRepetirPedido = () => {
    if (!selectedCliente) return;
    const lastInvoice = [...facturas].reverse().find(f => f.clienteId === selectedCliente);
    if (lastInvoice) {
      setDetalles(lastInvoice.detalles.map(d => ({ ...d })));
      setCondicionPago(lastInvoice.condicion_pago);
      setDescuento(lastInvoice.descuento);
      if (lastInvoice.metodo_pago) setMetodoPago(lastInvoice.metodo_pago);
      toast.success('Pedido clonado del último registro');
    } else {
      toast.error('No hay pedidos anteriores para este cliente');
    }
  };

  const handleScanBarcode = () => {
    if (catalogo.length === 0) {
      toast.error('Catálogo vacío: no hay productos para escanear');
      return;
    }
    const prodName = catalogo.find(p => !detalles.some(d => d.producto === p.nombre))?.nombre || catalogo[0].nombre;
    const pUnit = precioCatalogoProd(prodName) || 2000;
    const newDetalles = [...detalles];
    const emptyIndex = newDetalles.findIndex(d => d.cantidad === 0 && d.precio_unitario === 0);
    const scannedItem = { producto: prodName, cantidad: 10, precio_unitario: pUnit, subtotal: 10 * pUnit };
    if (emptyIndex !== -1) { newDetalles[emptyIndex] = scannedItem; } else { newDetalles.push(scannedItem); }
    setDetalles(newDetalles);
    toast.info(`Escaneo de demostración: +10 ${prodName} (₡${pUnit.toLocaleString()} c/u)`);
  };

  const handleClienteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedCliente(id);
    const cliente = getCliente(id);
    if (cliente) {
      setTipoDocumento('Factura');
      setCondicionPago(cliente.condicion_pago);
      if (cliente.precio_especial) {
        setDetalles(detalles.map(d => ({ ...d, precio_unitario: cliente.precio_especial!, subtotal: d.cantidad * cliente.precio_especial! })));
      }
    }
  };

  const updateDetalle = (index: number, field: keyof DetalleFactura, value: number | string) => {
    const newDetalles = [...detalles];
    newDetalles[index] = { ...newDetalles[index], [field]: value };
    if (field === 'cantidad' || field === 'precio_unitario') {
      newDetalles[index].subtotal = Number(newDetalles[index].cantidad) * Number(newDetalles[index].precio_unitario);
    }
    setDetalles(newDetalles);
  };

  const addDetalle = () => setDetalles([...detalles, { producto: 'Aves', cantidad: 0, precio_unitario: 0, subtotal: 0 }]);
  const removeDetalle = (index: number) => setDetalles(detalles.filter((_, i) => i !== index));

  // Wizard navigation
  const canAdvance = () => {
    if (wizardStep === 1) return itemsEnCarrito.length > 0;
    if (wizardStep === 2) return tipoDocumento === 'Tiquete' || !!selectedCliente;
    return true;
  };

  const handleNext = () => {
    if (!canAdvance()) {
      if (wizardStep === 1) toast.error('Agrega al menos un producto al carrito');
      if (wizardStep === 2) toast.error('Selecciona un cliente');
      return;
    }
    setWizardStep(Math.min(wizardStep + 1, 3));
  };

  const handlePrev = () => setWizardStep(Math.max(wizardStep - 1, 1));

  const handleCreate = async () => {
    if (!selectedCliente && tipoDocumento === 'Factura') {
      toast.error('Selecciona un cliente para la factura');
      return;
    }
    if (itemsEnCarrito.length === 0) {
      toast.error('El carrito está vacío');
      return;
    }

    const newFactura: Factura = {
      id: crypto.randomUUID(),
      // R1: el consecutivo lo expide el backend (serie FAC global) — aquí va vacío.
      consecutivo: '',
      fecha: new Date().toISOString(),
      clienteId: selectedCliente || 'consumidor-final',
      vendedorId: currentUser.id,
      detalles: [...detalles.filter(d => d.cantidad > 0)],
      subtotal, descuento, total,
      condicion_pago: condicionPago,
      metodo_pago: condicionPago === 'Contado' ? metodoPago : undefined,
      estado: condicionPago === 'Contado' ? 'Pagada' : 'Pendiente'
    };

    try {
      const res = await fetch('/api/ventas', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ factura: newFactura, detalles: newFactura.detalles })
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }

      const cliente = getCliente(selectedCliente);
      await fetch('/api/facturacion/crear-documento', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          facturaId: newFactura.id, tipoDocumento,
          emisorNombre: 'Granja Don Paco', emisorCedula: '3-101-XXXXXX',
          emisorCorreo: 'facturacion@granjadonpaco.com',
          receptorNombre: cliente?.nombre, receptorCedula: cliente?.documento_id,
          receptorCorreo: cliente?.email, condicionPago, medioPago: metodoPago,
          ambiente: 'Pruebas', proveedor: 'Simulado'
        })
      });

      clearDraft();
      resetForm();
      setIsCreating(false);
      setWizardStep(1);
      await fetchData();
      toast.success('Factura creada y documento fiscal generado');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const resetForm = () => {
    setSelectedCliente('');
    setDetalles([{ producto: 'Aves', cantidad: 0, precio_unitario: 0, subtotal: 0 }]);
    setCondicionPago('Contado');
    setMetodoPago('Efectivo');
    setDescuento(0);
  };

  const handleGenerarXML = async (docId: string) => {
    try {
      const res = await fetch('/api/facturacion/generar-xml', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ documentoId: docId })
      });
      if (res.ok) { await fetchData(); toast.success('XML generado exitosamente'); }
    } catch (err: any) { toast.error(err.message); }
  };

  const handleEnviarHacienda = async (docId: string) => {
    setEnviandoFE(docId);
    try {
      const res = await fetch('/api/facturacion/enviar', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ documentoId: docId })
      });
      if (res.ok) {
        await fetch('/api/facturacion/consultar-estado', {
          method: 'POST', headers: authHeaders,
          body: JSON.stringify({ documentoId: docId })
        });
        await fetchData();
        toast.success('Documento enviado y estado consultado');
      }
    } catch (err: any) { toast.error(err.message); }
    setEnviandoFE(null);
  };

  const filteredFacturas = facturas.filter(f => {
    const cliente = getCliente(f.clienteId)?.nombre || '';
    return f.consecutivo.toLowerCase().includes(searchTerm.toLowerCase()) || cliente.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const getEstadoIcon = (estado: string) => {
    switch (estado) {
      case 'Aceptado': return <CheckCircle className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />;
      case 'Rechazado': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'Enviado': case 'Pendiente': return <Clock className="w-4 h-4" style={{ color: 'var(--brand-secondary)' }} />;
      default: return <FileText className="w-4 h-4 text-neutral-400" />;
    }
  };

  const guiaActiva = rutasDia.find(r => !r.consolidada) || rutasDia[0];
  const stockUbicacion = guiaActiva?.camionNombre || 'Bodega Central';
  const stockPara = (prodName: string) => {
    const items = inventario.filter(i => i.producto === prodName && i.ubicacion === stockUbicacion);
    return items.reduce((a, i) => a + Number(i.cantidad), 0);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6 animate-in fade-in pb-20">
      <Breadcrumb items={[
        { label: 'Logística', onClick: () => {} },
        { label: 'Facturación' }
      ]} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-neutral-800 flex items-center">
            <FileText className="w-6 h-6 mr-2" style={{ color: 'var(--brand-primary)' }} />
            Facturación y Ventas
          </h2>
          <p className="text-sm text-neutral-500 mt-1">Punto de venta, facturación electrónica y recibos.</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setIsOffline(!isOffline)}
            className={cn("flex items-center justify-center px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-sm border",
              isOffline ? "border-stone-200" : "border-stone-200")}
            style={isOffline
              ? { background: 'color-mix(in srgb, var(--brand-secondary) 8%, transparent)', color: 'var(--brand-secondary-dark)' }
              : { background: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)', color: 'var(--brand-primary-dark)' }
            }>
            {isOffline ? <><WifiOff className="w-4 h-4 mr-1.5" /> Offline</> : <><Wifi className="w-4 h-4 mr-1.5" /> En Línea</>}
          </button>
          <button onClick={() => {
            if (isCreating) { clearDraft(); resetForm(); setWizardStep(1); }
            setIsCreating(!isCreating);
          }}
            className="flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm"
            style={isCreating
              ? { background: '#E7E5E4', color: '#57534E' }
              : { background: 'var(--brand-primary)', color: 'white' }
            }>
            {isCreating ? <><X className="w-5 h-5 mr-2" /> Cancelar</> : <><Plus className="w-5 h-5 mr-2" /> Nueva Venta</>}
          </button>
        </div>
      </div>

      {/* Draft indicator */}
      {!isCreating && draft && (
        <div className="border rounded-xl p-4 flex items-center justify-between" style={{ background: 'color-mix(in srgb, var(--brand-secondary) 5%, transparent)', borderColor: 'color-mix(in srgb, var(--brand-secondary) 20%, transparent)' }}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5" style={{ color: 'var(--brand-secondary)' }} />
            <div>
              <p className="text-sm font-bold text-stone-800">Borrador guardado</p>
              <p className="text-xs" style={{ color: 'var(--brand-secondary)' }}>Tienes una factura en progreso sin finalizar.</p>
            </div>
          </div>
          <button onClick={() => { setIsCreating(true); setWizardStep(draft.wizardStep || 1); }}
            className="px-4 py-2 text-white rounded-lg text-xs font-bold transition-colors" style={{ background: 'var(--brand-secondary)' }}>
            Continuar
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-200 pb-2">
        <button onClick={() => setActiveTab('ventas')}
          className={cn("px-4 py-2 rounded-t-lg text-sm font-bold transition-colors",
            activeTab === 'ventas' ? "text-stone-800 border-b-2" : "text-stone-400 hover:text-stone-600")}
            style={activeTab === 'ventas' ? { borderColor: 'var(--brand-primary)' } : {}}>
          Ventas ({facturas.length})
        </button>
        <button onClick={() => setActiveTab('electronicos')}
          className={cn("px-4 py-2 rounded-t-lg text-sm font-bold transition-colors flex items-center gap-1",
            activeTab === 'electronicos' ? "text-stone-800 border-b-2" : "text-stone-400 hover:text-stone-600")}
          style={activeTab === 'electronicos' ? { borderColor: 'var(--brand-primary)' } : {}}>
          Docs Electrónicos ({documentosElectronicos.length})
        </button>
        <button onClick={() => setActiveTab('rutas')}
          className={cn("px-4 py-2 rounded-t-lg text-sm font-bold transition-colors flex items-center gap-1",
            activeTab === 'rutas' ? "text-stone-800 border-b-2" : "text-stone-400 hover:text-stone-600")}
          style={activeTab === 'rutas' ? { borderColor: 'var(--brand-primary)' } : {}}>
          Rutas del día ({rutasDia.length})
        </button>
      </div>

      {isCreating ? (
        <div className="bg-neutral-50 p-2 md:p-6 rounded-3xl animate-in slide-in-from-top-4">
          <WizardProgress
            steps={[
              { number: 1, label: 'Productos' },
              { number: 2, label: 'Cliente' },
              { number: 3, label: 'Confirmar' }
            ]}
            currentStep={wizardStep}
          />

          {/* Step 1: Productos */}
          {wizardStep === 1 && (
            <div className="space-y-6 animate-in fade-in">
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-neutral-200">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-lg text-neutral-800 flex items-center gap-2">
                    <Package className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Seleccionar Productos
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 bg-neutral-100 p-1 rounded-xl">
                      <button type="button" onClick={() => setTipoDocumento('Factura')}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center",
                          tipoDocumento === 'Factura' ? "bg-white shadow-sm" : "text-stone-400")}
                        style={tipoDocumento === 'Factura' ? { color: 'var(--brand-primary-dark)' } : {}}>
                        <FileText className="w-3.5 h-3.5 mr-1" /> Factura
                      </button>
                      <button type="button" onClick={() => { setTipoDocumento('Tiquete'); setSelectedCliente(''); }}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center",
                          tipoDocumento === 'Tiquete' ? "bg-white shadow-sm" : "text-stone-400")}
                        style={tipoDocumento === 'Tiquete' ? { color: 'var(--brand-primary-dark)' } : {}}>
                        <Ticket className="w-3.5 h-3.5 mr-1" /> Tiquete
                      </button>
                    </div>
                    <button type="button" onClick={handleScanBarcode}
                      className="text-xs font-bold text-neutral-600 hover:text-neutral-900 flex items-center bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-lg transition-colors">
                      <ScanLine className="w-4 h-4 mr-1.5" /> Escanear (demo)
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {catalogo.length === 0 ? (
                    <div className="col-span-full rounded-2xl border-2 border-dashed p-8 text-center" style={{ borderColor: 'var(--border-default)' }}>
                      <Package className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                      <p className="font-bold text-sm" style={{ color: 'var(--text-secondary)' }}>Catálogo sin productos</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Registre productos con precio base en el módulo de Catálogo para poder vender.</p>
                    </div>
                  ) : catalogo.map(c => c.nombre).map(prodName => {
                    const existingDetIndex = detalles.findIndex(d => d.producto === prodName);
                    const isAdded = existingDetIndex >= 0;
                    const cantidad = isAdded ? detalles[existingDetIndex].cantidad : 0;
                    const stockDisponible = stockPara(prodName);

                    const handleIncrement = () => {
                      if (cantidad >= stockDisponible) { toast.error(`No hay más ${prodName} en inventario (${stockUbicacion})`); return; }
                      if (isAdded) { updateDetalle(existingDetIndex, 'cantidad', cantidad + 1); }
                      else {
                        const emptyIdx = detalles.findIndex(d => d.cantidad === 0 && d.producto === 'Aves');
                        const pUnit = precioCatalogoProd(prodName) || 1000;
                        if (emptyIdx >= 0) {
                          setDetalles(detalles.map((d, i) => i === emptyIdx ? { ...d, producto: prodName, cantidad: 1, precio_unitario: pUnit, subtotal: pUnit } : d));
                        } else {
                          setDetalles([...detalles, { producto: prodName, cantidad: 1, precio_unitario: pUnit, subtotal: pUnit }]);
                        }
                      }
                    };
                    const handleDecrement = () => {
                      if (isAdded && cantidad > 0) {
                        if (cantidad === 1) removeDetalle(existingDetIndex);
                        else updateDetalle(existingDetIndex, 'cantidad', cantidad - 1);
                      }
                    };

                    return (
                      <div key={prodName} className={cn("relative border rounded-2xl p-3 flex flex-col items-center justify-between min-h-[120px] transition-all",
                        cantidad > 0 ? "bg-stone-50" : "bg-white")}>
                        {cantidad > 0 && (
                          <div className="absolute -top-2 -right-2 w-5 h-5 text-white rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'var(--brand-primary)' }}>
                            {cantidad}
                          </div>
                        )}
                        <p className="font-bold text-neutral-800 text-sm text-center mb-0 leading-tight">{prodName}</p>
                        <p className="text-[10px] text-neutral-500 font-medium mb-2" title={`Inventario en ${stockUbicacion}`}>Disp: {stockDisponible}</p>
                        {cantidad > 0 ? (
                          <div className="flex items-center justify-between w-full bg-white rounded-xl shadow-sm border border-stone-200 p-1">
                            <button type="button" onClick={handleDecrement} className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-50 hover:bg-stone-100" style={{ color: 'var(--brand-primary)' }}>
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="font-black" style={{ color: 'var(--brand-primary-dark)' }}>{cantidad}</span>
                            <button type="button" onClick={handleIncrement} className="w-8 h-8 flex items-center justify-center rounded-lg text-white hover:opacity-90" style={{ background: 'var(--brand-primary)' }}>
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={handleIncrement}
                            className="w-full py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-sm transition-colors">
                            Agregar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mini cart summary */}
              {itemsEnCarrito.length > 0 && (
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-neutral-200">
                  <h4 className="font-bold text-sm text-neutral-800 mb-3 flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} /> Carrito ({itemsEnCarrito.length} items)
                  </h4>
                  <div className="space-y-2">
                    {itemsEnCarrito.map((det, idx) => {
                      const realIdx = detalles.findIndex(dReal => dReal === det);
                      return (
                        <div key={idx} className="flex justify-between items-center py-2 border-b border-neutral-100 last:border-0">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-sm text-neutral-800">{det.producto}</span>
                            <span className="text-xs text-neutral-500">{det.cantidad} x ₡{det.precio_unitario.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-neutral-900">₡{det.subtotal.toLocaleString()}</span>
                            <button type="button" onClick={() => removeDetalle(realIdx)} className="text-red-400 hover:text-red-600 p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between items-center mt-3 pt-3 border-t border-neutral-200">
                    <span className="font-bold text-neutral-800">Subtotal</span>
                    <span className="font-black text-lg text-neutral-900">₡{subtotal.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Cliente */}
          {wizardStep === 2 && (
            <div className="space-y-6 animate-in fade-in">
              {tipoDocumento === 'Factura' ? (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 space-y-4">
                  <h3 className="font-bold text-lg text-neutral-800 flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Seleccionar Cliente
                  </h3>
                  <select value={selectedCliente} onChange={handleClienteChange}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none">
                    <option value="">Seleccione un cliente...</option>
                    {clientes.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre} ({c.ruta || 'Sin ruta'})</option>
                    ))}
                  </select>
                  {selectedCliente && facturas.some(f => f.clienteId === selectedCliente && f.estado === 'Pendiente') && (
                    <div className="flex items-start bg-red-50 text-red-700 p-3 rounded-xl border border-red-100">
                      <AlertTriangle className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">Alerta de Crédito</p>
                        <p className="text-xs mt-0.5">Este cliente tiene facturas vencidas o pendientes de pago.</p>
                      </div>
                    </div>
                  )}
                  {selectedCliente && (
                    <button type="button" onClick={handleRepetirPedido}
                      className="text-xs font-bold flex items-center mt-2 hover:opacity-70" style={{ color: 'var(--brand-primary)' }}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Clonar último pedido de este cliente
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-6 rounded-2xl border text-center" style={{ background: 'color-mix(in srgb, var(--brand-primary) 5%, transparent)', borderColor: 'color-mix(in srgb, var(--brand-primary) 15%, transparent)' }}>
                  <p className="font-bold" style={{ color: 'var(--brand-primary-dark)' }}>Tiquete — No requiere cliente</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--brand-primary)' }}>El documento se emitirá como Consumidor Final.</p>
                </div>
              )}

              {/* Payment details */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
                <h3 className="font-bold text-lg text-neutral-800 mb-4 flex items-center gap-2">
                  <CreditCard className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Condición de Pago
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider block mb-2">Condición</label>
                    <select value={condicionPago} onChange={e => setCondicionPago(e.target.value as any)}
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none">
                      <option value="Contado">Contado</option>
                      <option value="Credito">Crédito</option>
                    </select>
                  </div>
                  {condicionPago === 'Contado' && (
                    <div>
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider block mb-2">Método de Pago</label>
                      <select value={metodoPago} onChange={e => setMetodoPago(e.target.value as any)}
                        className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm outline-none">
                        <option value="Efectivo">Efectivo</option>
                        <option value="SINPE">SINPE Móvil</option>
                        <option value="Transferencia">Transferencia</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Confirmar */}
          {wizardStep === 3 && (
            <div className="space-y-6 animate-in fade-in">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
                <h3 className="font-bold text-lg text-neutral-800 mb-4 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Resumen de la Venta
                </h3>

                {/* Client info */}
                {selectedCliente && (
                  <div className="p-4 rounded-xl mb-4" style={{ background: 'color-mix(in srgb, var(--brand-primary) 6%, transparent)' }}>
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--brand-primary)' }}>Cliente</p>
                    <p className="font-bold text-stone-900">{getCliente(selectedCliente)?.nombre}</p>
                    <p className="text-xs" style={{ color: 'var(--brand-primary)' }}>{getCliente(selectedCliente)?.ruta} — {condicionPago} {condicionPago === 'Contado' ? `(${metodoPago})` : ''}</p>
                  </div>
                )}

                {/* Items */}
                <div className="divide-y divide-neutral-100 mb-4">
                  {itemsEnCarrito.map((det, idx) => (
                    <div key={idx} className="flex justify-between items-center py-3">
                      <div>
                        <p className="font-bold text-sm text-neutral-800">{det.producto}</p>
                        <p className="text-xs text-neutral-500">{det.cantidad} x ₡{det.precio_unitario.toLocaleString()}</p>
                      </div>
                      <p className="font-bold text-neutral-900">₡{det.subtotal.toLocaleString()}</p>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="bg-neutral-50 p-4 rounded-xl space-y-2">
                  <div className="flex justify-between text-sm text-neutral-600">
                    <span>Subtotal</span><span>₡{subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm text-neutral-600">
                    <span>Descuento</span>
                    <input type="number" value={descuento || ''} onChange={e => setDescuento(Number(e.target.value))}
                      className="w-24 bg-white border border-neutral-200 rounded px-2 py-1 text-right text-xs outline-none" placeholder="0" />
                  </div>
                  <div className="flex justify-between items-end pt-2 mt-2 border-t border-neutral-200">
                    <span className="font-bold text-neutral-900">Total a Cobrar</span>
                    <span className="text-3xl font-black" style={{ color: 'var(--brand-primary)' }}>₡{total.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex justify-between items-center mt-6">
            <button type="button" onClick={handlePrev}
              disabled={wizardStep === 1}
              className={cn("flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-colors",
                wizardStep === 1 ? "opacity-30 cursor-not-allowed text-neutral-400" : "text-neutral-700 hover:bg-neutral-200")}>
              <ArrowLeft className="w-4 h-4" /> Anterior
            </button>
            {wizardStep < 3 ? (
              <button type="button" onClick={handleNext}
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-white font-bold text-sm transition-colors shadow-md" style={{ background: 'var(--brand-primary)' }}>
                Siguiente <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button type="button" onClick={handleCreate}
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-white font-bold text-sm transition-colors shadow-md" style={{ background: 'var(--brand-primary)' }}>
                <Check className="w-5 h-5" /> Confirmar y Cobrar
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="p-4 border-b border-neutral-200 bg-neutral-50/50 flex justify-between items-center">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
              <input type="text" placeholder="Buscar por cliente o consecutivo..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-stone-300 rounded-xl text-sm outline-none shadow-sm transition-all" />
            </div>
          </div>

          {activeTab === 'ventas' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-bold text-xs border-b border-neutral-200">
                  <tr>
                    <th className="px-6 py-4">Factura</th>
                    <th className="px-6 py-4">Fecha</th>
                    <th className="px-6 py-4">Cliente</th>
                    <th className="px-6 py-4">Condición</th>
                    <th className="px-6 py-4 text-right">Total</th>
                    <th className="px-6 py-4 text-center">Estado</th>
                    <th className="px-6 py-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredFacturas.map(f => (
                    <tr key={f.id} className="hover:bg-stone-50 transition-colors">
                      <td className="px-6 py-4 font-bold text-neutral-900">{f.consecutivo}</td>
                      <td className="px-6 py-4 text-neutral-500">{new Date(f.fecha).toLocaleDateString()}</td>
                      <td className="px-6 py-4 font-medium text-neutral-800">{getCliente(f.clienteId)?.nombre || 'Desconocido'}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-neutral-700 font-medium">{f.condicion_pago}</span>
                          {f.metodo_pago && <span className="text-[10px] text-neutral-400 font-bold uppercase">{f.metodo_pago}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-black text-neutral-800">₡{f.total.toLocaleString()}</td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                          style={f.estado === 'Pagada'
                            ? { background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', color: 'var(--brand-primary-dark)' }
                            : f.estado === 'Pendiente'
                            ? { background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)', color: 'var(--brand-secondary-dark)' }
                            : { background: '#FEE2E2', color: '#DC2626' }
                          }>
                          {f.estado}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button className="p-1.5 hover:bg-stone-50 rounded-lg transition-colors inline-flex items-center space-x-1" style={{ color: 'var(--brand-primary)' }}>
                          <Printer className="w-4 h-4" /><span className="text-xs font-bold">Imprimir</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredFacturas.length === 0 && (
                    <tr><td colSpan={7} className="px-6 py-8 text-center text-neutral-500">No se encontraron facturas.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : activeTab === 'rutas' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-bold text-xs border-b border-neutral-200">
                  <tr>
                    <th className="px-6 py-4">Guía</th>
                    <th className="px-6 py-4">Camión</th>
                    <th className="px-6 py-4">Fecha</th>
                    <th className="px-6 py-4 text-center">Estado</th>
                    <th className="px-6 py-4 text-right">Vendidos</th>
                    <th className="px-6 py-4 text-right">Total</th>
                    <th className="px-6 py-4 text-center">Tiquetes</th>
                    <th className="px-6 py-4 text-center">Retornos</th>
                    <th className="px-6 py-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rutasDia.map(r => (
                    <tr key={r.guiaId} className="hover:bg-stone-50 transition-colors">
                      <td className="px-6 py-4 font-bold text-neutral-900 font-mono text-xs">{r.consecutivo}</td>
                      <td className="px-6 py-4 font-medium text-neutral-800">{r.camionNombre}</td>
                      <td className="px-6 py-4 text-neutral-500">{new Date(r.fecha).toLocaleDateString()}</td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                          style={r.consolidada
                            ? { background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', color: 'var(--brand-primary-dark)' }
                            : { background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)', color: 'var(--brand-secondary-dark)' }
                          }>
                          {r.consolidada ? 'Consolidada' : r.estado}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-neutral-800">{r.vendidos}</td>
                      <td className="px-6 py-4 text-right font-black text-neutral-800">₡{r.totalGenerado.toLocaleString()}</td>
                      <td className="px-6 py-4 text-center text-neutral-600">{r.tiquetesEmitidos}</td>
                      <td className="px-6 py-4 text-center text-neutral-600">{r.retornos}</td>
                      <td className="px-6 py-4 text-center">
                        {!r.consolidada && (
                          <button onClick={() => handleConsolidarRuta(r.guiaId)} disabled={consolidandoRuta === r.guiaId}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 hover:opacity-90"
                            style={{ background: 'var(--brand-primary)', color: 'white' }}>
                            {consolidandoRuta === r.guiaId ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                            Generar facturas
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rutasDia.length === 0 && (
                    <tr><td colSpan={9} className="px-6 py-8 text-center text-neutral-500">No hay rutas cerradas del día.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-bold text-xs border-b border-neutral-200">
                  <tr>
                    <th className="px-6 py-4">Tipo</th>
                    <th className="px-6 py-4">Consecutivo</th>
                    <th className="px-6 py-4">Fecha</th>
                    <th className="px-6 py-4">Cliente</th>
                    <th className="px-6 py-4 text-right">Total</th>
                    <th className="px-6 py-4 text-center">Estado</th>
                    <th className="px-6 py-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {documentosElectronicos.map(doc => (
                    <tr key={doc.id} className="hover:bg-stone-50 transition-colors">
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold"
                          style={doc.tipoDocumento === 'Factura'
                            ? { background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', color: 'var(--brand-primary-dark)' }
                            : doc.tipoDocumento === 'Tiquete'
                            ? { background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', color: 'var(--brand-primary-dark)' }
                            : { background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)', color: 'var(--brand-secondary-dark)' }
                          }>
                          {doc.tipoDocumento}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold text-neutral-900 font-mono text-xs">{doc.consecutivo}</td>
                      <td className="px-6 py-4 text-neutral-500">{new Date(doc.fechaEmision).toLocaleDateString()}</td>
                      <td className="px-6 py-4 font-medium text-neutral-800">{doc.receptorNombre || 'Consumidor Final'}</td>
                      <td className="px-6 py-4 text-right font-black text-neutral-800">₡{doc.total.toLocaleString()}</td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase"
                          style={doc.estado === 'Aceptado'
                            ? { background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', color: 'var(--brand-primary-dark)' }
                            : doc.estado === 'Rechazado'
                            ? { background: '#FEE2E2', color: '#DC2626' }
                            : doc.estado === 'Enviado'
                            ? { background: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)', color: 'var(--brand-primary)' }
                            : doc.estado === 'Pendiente'
                            ? { background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)', color: 'var(--brand-secondary-dark)' }
                            : { background: '#F5F5F4', color: '#78716C' }
                          }>
                          {getEstadoIcon(doc.estado)} {doc.estado}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {doc.estado === 'Borrador' && (
                            <button onClick={() => handleGenerarXML(doc.id)}
                              className="p-1.5 hover:bg-stone-50 rounded-lg transition-colors" style={{ color: 'var(--brand-secondary)' }} title="Generar XML">
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                          {(doc.estado === 'Pendiente' || doc.estado === 'Borrador') && (
                            <button onClick={() => handleEnviarHacienda(doc.id)} disabled={enviandoFE === doc.id}
                              className="p-1.5 hover:bg-stone-50 rounded-lg transition-colors disabled:opacity-50" style={{ color: 'var(--brand-primary)' }} title="Enviar a Hacienda">
                              <Send className="w-4 h-4" />
                            </button>
                          )}
                          {doc.estado === 'Enviado' && (
                            <button onClick={async () => {
                              await fetch('/api/facturacion/consultar-estado', {
                                method: 'POST', headers: authHeaders,
                                body: JSON.stringify({ documentoId: doc.id })
                              });
                              await fetchData();
                            }} className="p-1.5 hover:bg-stone-50 rounded-lg transition-colors" style={{ color: 'var(--brand-primary)' }} title="Consultar Estado">
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {documentosElectronicos.length === 0 && (
                    <tr><td colSpan={7} className="px-6 py-8 text-center text-neutral-500">No hay documentos electrónicos. Cree una factura para generar uno.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
