import React, { useState, useEffect } from 'react';
import { Package, Plus, Search, FileText, Printer, Check, X, CreditCard, Ticket, RefreshCw, AlertTriangle, Minus, ShoppingCart, Send, Download, CheckCircle, XCircle, Clock, ArrowRight, ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import Breadcrumb from './Breadcrumb';
import WizardProgress from './WizardProgress';
import { Factura, User, DetalleFactura, Cliente, InventarioItem, FacturaElectronica } from '../types';
import { Spinner } from './Spinner';
import { sessionHeaders } from '../lib/session';
import { factorPara } from '../lib/kilos';
import AccionFijaMovil from './AccionFijaMovil';

const DRAFT_KEY = 'granja_don_paco_draft_invoice';

// El valor de compatibilidad en BD sigue siendo `'Tiquete'`.
const NOMBRE_NOTA_VENTA = 'Tiquete electrónico';
const MEDIOS_PAGO = ['Efectivo', 'Transferencia', 'SINPE', 'Tarjeta', 'Cheque', 'Plataforma Digital', 'Otro'];
const formatoCRC = (valor: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(Number(valor) || 0);

interface DraftState {
  tipoDocumento: 'Factura' | 'Tiquete' | 'Proforma';
  selectedCliente: string;
  detalles: DetalleFactura[];
  condicionPago: 'Contado' | 'Credito';
  metodoPago?: string;
  pagos?: Array<{ metodo: string; monto: string }>;
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
  const esVendedor = (currentUser.roles?.length ? currentUser.roles : [currentUser.role]).includes('Comercial');
  const [inventario, setInventario] = useState<InventarioItem[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [documentosElectronicos, setDocumentosElectronicos] = useState<FacturaElectronica[]>([]);
  const [proformas, setProformas] = useState<any[]>([]);
  const [rutasDia, setRutasDia] = useState<RutaDia[]>([]);
  const [catalogo, setCatalogo] = useState<{id:string;nombre:string;precioBase:number}[]>([]);
  const [estadoIntegracion, setEstadoIntegracion] = useState<{ modo: string; mensaje: string; limitaciones?: string[] } | null>(null);
  const fiscalBloqueado = estadoIntegracion?.modo === 'bloqueado';

  const resolverPrecio = async (nombre: string, clienteId = selectedCliente) => {
    const query = new URLSearchParams({ producto: nombre });
    if (clienteId) query.set('clienteId', clienteId);
    const response = await fetch(`/api/precios/lookup?${query}`, { headers: sessionHeaders(currentUser.id) });
    const data = await response.json();
    if (!response.ok || !Number.isFinite(Number(data.precio))) throw new Error(data.error || `No hay precio autorizado para ${nombre}`);
    return Number(data.precio);
  };

  // Headers de auth: el rol NO viaja en el header (lo resuelve el server contra la BD).
  const authHeaders = sessionHeaders(currentUser.id, true);

  const fetchData = async () => {
    try {
      const [invRes, cliRes, facRes, feRes, rutRes, cRes, intRes, proRes] = await Promise.all([
        fetch('/api/inventario', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/clientes', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/facturas', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/facturacion/documentos', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/facturacion/rutas-dia', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/productos-catalogo', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/facturacion/estado-integracion', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/proformas', { headers: sessionHeaders(currentUser.id) })
      ]);
      if (invRes.ok) setInventario(await invRes.json());
      if (cliRes.ok) setClientes(await cliRes.json());
      if (facRes.ok) setFacturas(await facRes.json());
      if (feRes.ok) setDocumentosElectronicos(await feRes.json());
      if (rutRes.ok) { const data = await rutRes.json(); setRutasDia(Array.isArray(data) ? data : (data.rutas || [])); }
      if (cRes.ok) setCatalogo(await cRes.json());
      if (intRes.ok) setEstadoIntegracion(await intRes.json());
      if (proRes.ok) setProformas(await proRes.json());
    } catch (err) {
      console.error('Error fetching data', err);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [facturaSeleccionada, setFacturaSeleccionada] = useState<Factura | null>(null);
  const [correoReenvioFactura, setCorreoReenvioFactura] = useState('');
  const [facturasExpandOf, setFacturasExpandOf] = useState<Set<string>>(() => new Set());
  const [filtroDocumentosVendedor, setFiltroDocumentosVendedor] = useState<'todos' | 'facturas' | 'proformas'>('todos');
  const [creandoFactura, setCreandoFactura] = useState(false);

  const handleImprimirFactura = () => {
    const limpiarModoImpresion = () => document.body.classList.remove('print-invoice-only');
    window.addEventListener('afterprint', limpiarModoImpresion, { once: true });
    document.body.classList.add('print-invoice-only');
    window.print();
  };

  const imprimirProforma = (proforma: any) => {
    const escapar = (valor: unknown) => String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    const detalleHtml = (proforma.detalles || []).map((d: any) => `<tr><td>${escapar(d.producto)}</td><td>${Number(d.cantidad).toLocaleString('es-CR')} kg</td><td>${formatoCRC(Number(d.precio_unitario))}</td><td>${formatoCRC(Number(d.subtotal))}</td></tr>`).join('');
    const w = window.open('', '_blank', 'noopener,noreferrer,width=820,height=900');
    if (!w) { toast.error('Permita las ventanas emergentes para imprimir la proforma.'); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(proforma.consecutivo)} · Proforma</title><style>body{font:15px Arial,sans-serif;color:#172033;max-width:780px;margin:40px auto;padding:24px}h1{margin-bottom:4px}small,.muted{color:#5c6575}.banner{margin:24px 0;padding:14px;background:#fff6dd;border:1px solid #e6c46b;border-radius:8px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:12px;border-bottom:1px solid #ddd;text-align:left}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.total{text-align:right;font-size:24px;font-weight:bold;margin-top:20px}@media print{body{margin:0 auto}}</style></head><body><h1>Proforma / cotización</h1><div class="muted">${escapar(proforma.consecutivo)} · ${new Date(proforma.fecha).toLocaleDateString('es-CR')}</div><p>Cliente: <b>${escapar(getCliente(proforma.clienteId)?.nombre || 'Cliente no indicado')}</b></p><div class="banner">DOCUMENTO COMERCIAL NO FISCAL · No es factura ni comprobante electrónico</div><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th>Importe</th></tr></thead><tbody>${detalleHtml}</tbody></table><p>Subtotal: ${formatoCRC(Number(proforma.subtotal))}</p><p>Descuento: ${formatoCRC(Number(proforma.descuento))}</p><div class="total">Total cotizado: ${formatoCRC(Number(proforma.total))}</div><p class="muted">Esta cotización no registra una venta, cobro ni salida de inventario. La venta se documenta por separado al concretarse.</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  // Load draft on mount
  const draft = loadDraft();
  const [wizardStep, setWizardStep] = useState(draft?.wizardStep || 1);
  const [tipoDocumento, setTipoDocumento] = useState<'Factura' | 'Tiquete' | 'Proforma'>(draft?.tipoDocumento || 'Factura');
  const [proformaOrigenId, setProformaOrigenId] = useState<string | null>(null);
  const [selectedCliente, setSelectedCliente] = useState(draft?.selectedCliente || '');
  const [detalles, setDetalles] = useState<DetalleFactura[]>(draft?.detalles || [
    { producto: 'Aves', cantidad: 0, precio_unitario: 0, subtotal: 0 }
  ]);
  const [condicionPago, setCondicionPago] = useState<'Contado' | 'Credito'>(draft?.condicionPago || 'Contado');
  const [pagos, setPagos] = useState<Array<{ metodo: string; monto: string }>>(
    draft?.pagos || [{ metodo: draft?.metodoPago || 'Efectivo', monto: 'total' }],
  );
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
  const pagosNormalizados = pagos.map(pago => ({
    metodo: pago.metodo,
    monto: pago.monto === 'total' ? total : Math.max(0, Number(pago.monto) || 0),
  })).filter(pago => pago.monto > 0);
  const totalRecibido = pagosNormalizados.reduce((suma, pago) => suma + pago.monto, 0);
  const saldoACredito = Math.max(0, total - totalRecibido);

  // Persist draft whenever state changes
  useEffect(() => {
    if (isCreating) {
      saveDraft({ tipoDocumento, selectedCliente, detalles, condicionPago, pagos, descuento, wizardStep });
    }
  }, [isCreating, tipoDocumento, selectedCliente, detalles, condicionPago, pagos, descuento, wizardStep]);

  const getCliente = (id: string) => clientes.find(c => c.id === id);

  const handleRepetirPedido = () => {
    if (!selectedCliente) return;
    const lastInvoice = [...facturas].reverse().find(f => f.clienteId === selectedCliente);
    if (lastInvoice) {
      setDetalles(lastInvoice.detalles.map(d => ({ ...d })));
      setCondicionPago(lastInvoice.condicion_pago);
      setDescuento(lastInvoice.descuento);
      if (lastInvoice.metodo_pago && lastInvoice.metodo_pago !== 'Mixto') setPagos([{ metodo: lastInvoice.metodo_pago, monto: 'total' }]);
      toast.success('Pedido clonado del último registro');
    } else {
      toast.error('No hay pedidos anteriores para este cliente');
    }
  };

  const handleClienteChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedCliente(id);
    const cliente = getCliente(id);
    if (cliente) {
      setCondicionPago(cliente.condicion_pago);
      if (detalles.some(d => d.cantidad > 0)) {
        try {
          const precios = await Promise.all(detalles.map(async d => d.cantidad > 0
            ? resolverPrecio(d.producto, id)
            : d.precio_unitario));
          setDetalles(detalles.map((d, i) => ({ ...d, precio_unitario: precios[i], subtotal: d.cantidad * precios[i] })));
        } catch (error: any) {
          toast.error(error.message || 'No se pudo resolver el precio del cliente');
        }
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

  const handleNext = async () => {
    if (!canAdvance()) {
      if (wizardStep === 1) toast.error('Agrega al menos un producto al carrito');
      if (wizardStep === 2) toast.error('Selecciona un cliente');
      return;
    }
    if (wizardStep === 2 && selectedCliente && tipoDocumento !== 'Tiquete') {
      try {
        const precios = await Promise.all(detalles.map(async d => d.cantidad > 0
          ? resolverPrecio(d.producto, selectedCliente)
          : d.precio_unitario));
        setDetalles(detalles.map((d, i) => ({ ...d, precio_unitario: precios[i], subtotal: d.cantidad * precios[i] })));
      } catch (error: any) {
        toast.error(error.message || 'No se pudo resolver el precio autorizado');
        return;
      }
    }
    setWizardStep(Math.min(wizardStep + 1, 3));
  };

  const handlePrev = () => setWizardStep(Math.max(wizardStep - 1, 1));

  const handleCreate = async () => {
    if (creandoFactura) return;
    if (!selectedCliente && tipoDocumento === 'Factura') {
      toast.error('Selecciona un cliente para la factura');
      return;
    }
    if (itemsEnCarrito.length === 0) {
      toast.error('El carrito está vacío');
      return;
    }
    if (tipoDocumento === 'Proforma') {
      setCreandoFactura(true);
      try {
        const lineasCotizacion = await Promise.all(detalles.filter(d => d.cantidad > 0).map(async d => {
          const precio = await resolverPrecio(d.producto, selectedCliente || undefined);
          return { ...d, precio_unitario: precio, subtotal: d.cantidad * precio };
        }));
        const respuesta = await fetch('/api/proformas', { method: 'POST', headers: authHeaders, body: JSON.stringify({ clienteId: selectedCliente || null, detalles: lineasCotizacion, descuento }) });
        const data = await respuesta.json();
        if (!respuesta.ok) throw new Error(data.error || 'No se pudo crear la proforma.');
        clearDraft(); resetForm(); setIsCreating(false); setWizardStep(1);
        await fetchData();
        toast.success(`${data.consecutivo} guardada como cotización no fiscal; no se movió inventario.`);
      } catch (error: any) { toast.error(error.message || 'No se pudo crear la proforma.'); }
      finally { setCreandoFactura(false); }
      return;
    }
    if (totalRecibido > total + 0.01) {
      toast.error('Los medios de pago superan el total de la venta.');
      return;
    }
    if (condicionPago === 'Contado' && saldoACredito > 0.01) {
      toast.error('Complete el total con los medios de pago o seleccione crédito para dejar un saldo pendiente.');
      return;
    }
    if (saldoACredito > 0.01 && !selectedCliente) {
      toast.error('Para dejar un saldo a crédito debe seleccionar un cliente.');
      return;
    }

    let detallesAutorizados: DetalleFactura[];
    try {
      detallesAutorizados = await Promise.all(detalles.filter(d => d.cantidad > 0).map(async d => {
        const precio = await resolverPrecio(d.producto, selectedCliente || undefined);
        return { ...d, precio_unitario: precio, subtotal: d.cantidad * precio };
      }));
    } catch (error: any) {
      toast.error(error.message || 'No se pudo resolver el precio autorizado');
      return;
    }
    const subtotalAutorizado = detallesAutorizados.reduce((sum, d) => sum + d.subtotal, 0);
    const newFactura: Factura = {
      id: crypto.randomUUID(),
      // R1: el consecutivo lo expide el backend (serie FAC global) — aquí va vacío.
      consecutivo: '',
      fecha: new Date().toISOString(),
      clienteId: selectedCliente || 'consumidor-final',
      vendedorId: currentUser.id,
      detalles: detallesAutorizados,
      subtotal: subtotalAutorizado, descuento, total: subtotalAutorizado - descuento,
      condicion_pago: saldoACredito > 0.01 ? 'Credito' : 'Contado',
      metodo_pago: pagosNormalizados.length > 1 ? 'Mixto' : pagosNormalizados[0]?.metodo,
      estado: saldoACredito > 0.01 ? 'Pendiente' : 'Pagada'
    };

    setCreandoFactura(true);
    try {
      const res = await fetch('/api/ventas', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ factura: newFactura, detalles: newFactura.detalles, pagos: pagosNormalizados })
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      const ventaCreada = await res.json();
      if (proformaOrigenId) {
        await fetch(`/api/proformas/${proformaOrigenId}/convertir`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ facturaId: newFactura.id }) });
        setProformaOrigenId(null);
      }
      const facturaParaAbrir: Factura = {
        ...newFactura,
        consecutivo: ventaCreada.consecutivo || newFactura.consecutivo,
      };

      const cliente = getCliente(selectedCliente);
      const resDoc = await fetch('/api/facturacion/crear-documento', {
        method: 'POST',
        headers: { ...authHeaders, 'Idempotency-Key': `documento:${newFactura.id}:${tipoDocumento}` },
        body: JSON.stringify({
          facturaId: newFactura.id, tipoDocumento,
          emisorNombre: 'Granja Don Paco', emisorCedula: '3-101-XXXXXX',
          emisorCorreo: 'facturacion@granjadonpaco.com',
          receptorNombre: cliente?.nombre, receptorCedula: cliente?.documento_id,
          receptorCorreo: cliente?.email, condicionPago: newFactura.condicion_pago,
          medioPago: pagosNormalizados.length > 1 ? 'Mixto' : pagosNormalizados[0]?.metodo,
          mediosPago: pagosNormalizados,
          ambiente: 'Pruebas', proveedor: 'Simulado'
        })
      });

      clearDraft();
      resetForm();
      setIsCreating(false);
      setWizardStep(1);
      await fetchData();
      setFacturaSeleccionada(facturaParaAbrir);

      // La factura ya quedó guardada, así que esto no es un fallo de la venta:
      // es una venta sin respaldo fiscal. Antes se avisaba "Factura creada y
      // documento fiscal generado" sin haber mirado la respuesta de este fetch,
      // así que un 500 del proveedor documentista dejaba al vendedor creyendo que
      // había facturado. Ahora el aviso dice exactamente qué pasó.
      if (!resDoc.ok) {
        const motivo = await resDoc.json().catch(() => ({}) as { error?: string });
        toast.error(
          'Factura guardada, pero el documento fiscal NO se generó' +
          (motivo?.error ? `: ${motivo.error}` : '. Revísala en Documentos.'),
        );
        return;
      }

      toast.success('Factura creada y documento fiscal generado');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreandoFactura(false);
    }
  };

  const resetForm = () => {
    setTipoDocumento('Factura'); setProformaOrigenId(null);
    setSelectedCliente('');
    setDetalles([{ producto: 'Aves', cantidad: 0, precio_unitario: 0, subtotal: 0 }]);
    setCondicionPago('Contado');
    setPagos([{ metodo: 'Efectivo', monto: 'total' }]);
    setDescuento(0);
  };

  const handleGenerarXML = async (docId: string) => {
    try {
      const res = await fetch('/api/facturacion/generar-xml', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ documentoId: docId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo preparar el XML.');
      await fetchData(); toast.success(estadoIntegracion?.modo === 'simulacion' ? 'XML de demostración generado; no válido para Hacienda' : 'XML generado');
    } catch (err: any) { toast.error(err.message || 'Error al generar XML'); }
  };

  const handleEnviarHacienda = async (docId: string) => {
    setEnviandoFE(docId);
    try {
      const res = await fetch('/api/facturacion/enviar', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ documentoId: docId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el documento.');
      if (res.ok) {
        const respuestaRes = await fetch('/api/facturacion/consultar-estado', {
          method: 'POST', headers: authHeaders,
          body: JSON.stringify({ documentoId: docId })
        });
        const respuestaData = await respuestaRes.json();
        if (!respuestaRes.ok) throw new Error(respuestaData.error || 'Se simuló el envío, pero no se pudo completar la respuesta de prueba.');
        await fetchData();
        toast.success(`Demostración completada: respuesta ${respuestaData.estado || 'simulada'}. No se envió a Hacienda.`);
      }
    } catch (err: any) { toast.error(err.message); }
    setEnviandoFE(null);
  };

  const facturasActivas = facturas.filter(f => {
    const estado = String(f.estado || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const estadoContable = String((f as any).estadoContabilidad || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const recibidaContabilidad = Boolean((f as any).recibidaPorContador || (f as any).recibidaContabilidad || (f as any).fechaRecepcionContable)
      || /recibid|contabiliz|archivad/.test(estadoContable)
      || /recibid|contabiliz/.test(estado);
    return estado !== 'anulada' && !recibidaContabilidad;
  });
  const filteredFacturas = facturasActivas.filter(f => {
    const cliente = getCliente(f.clienteId)?.nombre || '';
    return f.consecutivo.toLowerCase().includes(searchTerm.toLowerCase()) || cliente.toLowerCase().includes(searchTerm.toLowerCase());
  });
  const filteredProformas = proformas.filter(p => `${p.consecutivo} ${getCliente(p.clienteId)?.nombre || ''}`.toLocaleLowerCase('es').includes(searchTerm.toLocaleLowerCase('es')));
  const documentosVendedor = [
    ...(filtroDocumentosVendedor !== 'proformas' ? filteredFacturas.map(f => ({ tipo: 'Factura' as const, id: `factura:${f.id}`, fecha: f.fecha, consecutivo: f.consecutivo, cliente: getCliente(f.clienteId)?.nombre || 'Consumidor final', total: Number(f.total || 0), estado: f.estado, data: f })) : []),
    ...(filtroDocumentosVendedor !== 'facturas' ? filteredProformas.map(p => ({ tipo: 'Proforma' as const, id: `proforma:${p.id}`, fecha: p.fecha || p.fechaCreacion || new Date().toISOString(), consecutivo: p.consecutivo, cliente: getCliente(p.clienteId)?.nombre || 'Consumidor final', total: Number(p.total || 0), estado: p.estado || 'Vigente', data: p })) : []),
  ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  const getEstadoIcon = (estado: string) => {
    switch (estado) {
      case 'Aceptado': return <CheckCircle className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} />;
      case 'Rechazado': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'Enviado': return <Clock className="w-4 h-4" style={{ color: 'var(--status-info)' }} />;
      case 'Pendiente': return <Clock className="w-4 h-4" style={{ color: 'var(--status-warning)' }} />;
      default: return <FileText className="w-4 h-4 text-neutral-400" />;
    }
  };
  const getEstadoFiscalVisible = (estado: string) => estadoIntegracion?.modo === 'simulacion'
    && ['Enviado', 'Aceptado', 'Rechazado'].includes(estado) ? `${estado} · demo` : estado;

  const guiaActiva = rutasDia.find(r => !r.consolidada) || rutasDia[0];
  const stockUbicacion = guiaActiva?.camionNombre || 'Bodega Central';
  const stockPara = (prodName: string) => {
    const items = inventario.filter(i => i.producto === prodName && i.ubicacion === stockUbicacion);
    const itemCatalogo = catalogo.find((c: any) => c.nombre === prodName) as any;
    const factor = itemCatalogo?.unidad === 'kg' ? 1 : factorPara(prodName, itemCatalogo ? [itemCatalogo] : []);
    if (!factor) return 0;
    return items.reduce((a, i) => a + Number(i.cantidad) * (i.unidad === 'kg' ? 1 : factor), 0);
  };
  const clienteFactura = facturaSeleccionada ? getCliente(facturaSeleccionada.clienteId) : undefined;
  const documentoFiscalFactura = facturaSeleccionada
    ? documentosElectronicos.find(d => d.facturaId === facturaSeleccionada.id && ['Factura', 'Tiquete'].includes(d.tipoDocumento))
    : undefined;
  const cedulaEmisorVisible = documentoFiscalFactura?.emisorCedula && !/[xX]/.test(documentoFiscalFactura.emisorCedula)
    ? documentoFiscalFactura.emisorCedula
    : undefined;
  const claveFiscalValida = Boolean(documentoFiscalFactura?.clave && /^\d{50}$/.test(documentoFiscalFactura.clave));
  const consecutivoFiscalValido = Boolean(documentoFiscalFactura?.consecutivo && /^\d{20}$/.test(documentoFiscalFactura.consecutivo));

  const handleEnviarCorreoFactura = () => {
    if (!facturaSeleccionada) return;
    const correo = correoReenvioFactura.trim();
    if (!correo) {
      toast.error('Escriba el correo al que desea reenviar la factura.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return toast.error('Revise el formato del correo electrónico.');
    const asunto = `${documentoFiscalFactura?.tipoDocumento === 'Tiquete' ? 'Nota de venta' : 'Factura'} ${facturaSeleccionada.consecutivo} · Granja Don Paco`;
    const lineas = facturaSeleccionada.detalles?.map(d => `• ${d.producto}: ${Number(d.cantidad).toLocaleString('es-CR')} kg — ${formatoCRC(d.subtotal)}`).join('\n') || '';
    const cuerpo = [
      `Hola ${clienteFactura?.nombre || 'cliente'},`,
      '',
      `Te compartimos el detalle de ${asunto}:`,
      lineas,
      '',
      `Total: ${formatoCRC(facturaSeleccionada.total)}`,
      `Fecha: ${new Date(facturaSeleccionada.fecha).toLocaleDateString('es-CR')}`,
      '',
      'Adjunta la representación impresa de la factura antes de enviar este correo.',
      'Granja Don Paco · Siempre frescos',
    ].filter(Boolean).join('\n');
    window.location.href = `mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  };

  const abrirFactura = (factura: Factura) => {
    const documento = documentosElectronicos.find(d => d.facturaId === factura.id && ['Factura', 'Tiquete'].includes(d.tipoDocumento));
    setCorreoReenvioFactura(documento?.receptorCorreo || getCliente(factura.clienteId)?.email || '');
    setFacturaSeleccionada(factura);
  };

  const imprimirFacturaDesdeLista = (factura: Factura) => {
    abrirFactura(factura);
    window.setTimeout(handleImprimirFactura, 250);
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl overflow-x-hidden p-3 pb-36 md:space-y-6 md:p-6 md:pb-20 space-y-5 animate-in fade-in">
      <Breadcrumb items={[
        { label: 'Finanzas' },
        { label: 'Documentos' }
      ]} />

      {!esVendedor && estadoIntegracion && <div role="status" className="flex items-start gap-3 rounded-xl border p-4 text-sm" style={{ background: 'var(--status-warning-soft)', borderColor: 'var(--status-warning)', color: 'var(--text-primary)' }}>
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--status-warning)' }} />
        <div className="min-w-0"><b>{estadoIntegracion.modo === 'simulacion' ? 'Modo demostración fiscal' : 'Emisión electrónica no configurada'}</b><p className="mt-1">{estadoIntegracion.mensaje}</p>
          {!!estadoIntegracion.limitaciones?.length && <details className="mt-2"><summary className="cursor-pointer font-semibold">Límites de la demostración ({estadoIntegracion.limitaciones.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5">{estadoIntegracion.limitaciones.map((item: string, index: number) => <li key={`${item}-${index}`}>{item}</li>)}</ul></details>}
        </div>
      </div>}

      {/* Header */}
      <div className={`flex ${esVendedor ? 'items-start justify-between gap-3' : 'flex-col justify-between gap-4 md:flex-row md:items-center'}`}>
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-neutral-800 flex items-center">
            <FileText className="w-6 h-6 mr-2" style={{ color: 'var(--brand-primary)' }} />
            {esVendedor ? 'Mis documentos' : 'Documentos'}
          </h2>
          <p className="text-sm text-neutral-500 mt-1">{esVendedor ? 'Facturas y proformas de tus entregas.' : 'Facturas, documentos electrónicos y rutas por facturar.'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button onClick={() => {
            if (isCreating) { clearDraft(); resetForm(); setWizardStep(1); }
            setIsCreating(!isCreating);
          }}
            className={`flex min-h-10 items-center justify-center rounded-xl text-sm font-bold transition-all shadow-sm ${esVendedor ? 'px-3 py-2' : 'px-4 py-2.5'}`}
            style={isCreating
              ? { background: 'var(--bg-muted)', color: 'var(--text-secondary)' }
              : { background: 'var(--brand-primary)', color: 'var(--text-on-action)' }
            }>
            {isCreating ? <><X className="h-4 w-4 sm:mr-2" /><span className={esVendedor ? 'hidden sm:inline' : ''}>Cancelar</span></> : <><Plus className="h-4 w-4 sm:mr-1.5" /><span>Nueva venta</span></>}
          </button>
        </div>
      </div>

      {/* Draft indicator */}
      {!isCreating && draft && (
        <div role="status" className={`flex items-center justify-between gap-3 ${esVendedor ? 'rounded-lg px-3 py-2' : 'rounded-xl border p-4'}`} style={esVendedor ? { background: 'var(--bg-muted)' } : { background: 'var(--status-warning-soft)', borderColor: 'var(--status-warning)' }}>
          <div className="flex min-w-0 items-center gap-2">
            {!esVendedor && <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: 'var(--status-warning)' }} />}
            <p className="truncate text-sm" style={{ color: 'var(--text-secondary)' }}><strong style={{ color: 'var(--text-primary)' }}>Borrador pendiente</strong>{!esVendedor && <span> · Tienes una factura en progreso sin finalizar.</span>}</p>
          </div>
          <button onClick={() => { setIsCreating(true); setWizardStep(draft.wizardStep || 1); }}
            className="min-h-9 shrink-0 rounded-lg px-3 py-2 text-xs font-bold transition-colors" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
            Continuar
          </button>
        </div>
      )}

      {isCreating ? (
        <div className="min-w-0 overflow-x-hidden rounded-3xl p-3 pb-36 animate-in slide-in-from-top-4 md:p-6 md:pb-6" style={{ background: 'var(--bg-muted)' }}>
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
            <div className="min-w-0 space-y-4 animate-in fade-in md:space-y-6">
              <div className="min-w-0 rounded-2xl border p-3 shadow-sm sm:p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="flex items-center gap-2 text-base font-bold sm:text-lg" style={{ color: 'var(--text-primary)' }}>
                    <Package className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Seleccionar Productos
                  </h3>
                  <div className="w-full min-w-0 sm:w-auto">
                    <div className="grid w-full min-w-0 grid-cols-3 gap-1 rounded-xl p-1 sm:w-auto sm:gap-2" style={{ background: 'var(--bg-muted)' }}>
                      <button type="button" onClick={() => setTipoDocumento('Factura')}
                        className={cn("flex min-h-11 min-w-0 items-center justify-center rounded-lg px-2 py-2 text-xs font-bold leading-tight transition-colors sm:px-3",
                          tipoDocumento === 'Factura' ? "shadow-sm" : "")}
                        style={tipoDocumento === 'Factura' ? { background: 'var(--bg-card)', color: 'var(--text-link)' } : { color: 'var(--text-muted)' }}>
                        <FileText className="mr-1 h-3.5 w-3.5 shrink-0" /> <span>Factura electrónica · demo</span>
                      </button>
                      <button type="button" onClick={() => { setTipoDocumento('Tiquete'); setSelectedCliente(''); }}
                        className={cn("flex min-h-11 min-w-0 items-center justify-center rounded-lg px-2 py-2 text-xs font-bold leading-tight transition-colors sm:px-3",
                          tipoDocumento === 'Tiquete' ? "shadow-sm" : "")}
                        style={tipoDocumento === 'Tiquete' ? { background: 'var(--bg-card)', color: 'var(--text-link)' } : { color: 'var(--text-muted)' }}>
                        <Ticket className="mr-1 h-3.5 w-3.5 shrink-0" /> <span>{NOMBRE_NOTA_VENTA}</span>
                      </button>
                      <button type="button" onClick={() => setTipoDocumento('Proforma')}
                        className={cn("flex min-h-11 min-w-0 items-center justify-center rounded-lg px-2 py-2 text-xs font-bold leading-tight transition-colors sm:px-3", tipoDocumento === 'Proforma' ? "shadow-sm" : "")}
                        style={tipoDocumento === 'Proforma' ? { background: 'var(--bg-card)', color: 'var(--text-link)' } : { color: 'var(--text-muted)' }}>
                        <FileText className="mr-1 h-3.5 w-3.5 shrink-0" /> <span>Proforma · no fiscal</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
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

                    const handleIncrement = async () => {
                      if (tipoDocumento !== 'Proforma' && cantidad + 1 > stockDisponible) { toast.error(`No hay más ${prodName} en inventario (${stockUbicacion})`); return; }
                      if (isAdded) { updateDetalle(existingDetIndex, 'cantidad', Math.round((cantidad + 1) * 100) / 100); }
                      else {
                        const emptyIdx = detalles.findIndex(d => d.cantidad === 0 && d.producto === 'Aves');
                        const pUnit = selectedCliente ? await resolverPrecio(prodName, selectedCliente).catch((error: any) => { toast.error(error.message); return 0; }) : 0;
                        if (emptyIdx >= 0) {
                          setDetalles(detalles.map((d, i) => i === emptyIdx ? { ...d, producto: prodName, cantidad: 1, precio_unitario: pUnit, subtotal: pUnit } : d));
                        } else {
                          setDetalles([...detalles, { producto: prodName, cantidad: 1, precio_unitario: pUnit, subtotal: pUnit }]);
                        }
                      }
                    };
                    const handleDecrement = () => {
                      if (isAdded && cantidad > 0) {
                        if (cantidad <= 0.1) removeDetalle(existingDetIndex);
                        else updateDetalle(existingDetIndex, 'cantidad', Math.round((cantidad - 1) * 100) / 100);
                      }
                    };

                    return (
                      <div key={prodName} className="relative border-2 rounded-2xl p-4 flex flex-col items-stretch justify-between min-h-[142px] transition-all"
                        style={{ background: cantidad > 0 ? 'var(--brand-primary-soft)' : 'var(--bg-card)', borderColor: cantidad > 0 ? 'var(--brand-primary)' : 'var(--border-default)' }}>
                        {cantidad > 0 && (
                          <div className="absolute -top-2 -right-2 w-5 h-5 text-white rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'var(--brand-primary)' }}>
                            {cantidad}
                          </div>
                        )}
                        <p className="font-bold text-sm text-left leading-tight" style={{ color: 'var(--text-primary)' }}>{prodName}</p>
                        <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }} title={`Inventario en ${stockUbicacion}`}>{tipoDocumento === 'Proforma' ? 'La cotización no reserva ni descuenta existencias' : `${stockDisponible > 0 ? `${stockDisponible.toFixed(2)} kg disponibles` : 'Sin existencias'} · ${stockUbicacion}`}</p>
                        {cantidad > 0 ? (
                          <div className="flex items-center justify-between w-full bg-white rounded-xl shadow-sm border border-stone-200 p-1">
                            <button type="button" onClick={handleDecrement} className="min-h-11 min-w-11 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-muted)', color: 'var(--text-link)' }} aria-label={`Restar ${prodName}`}>
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="font-black tabular-nums" style={{ color: 'var(--text-primary)' }}>{cantidad} kg</span>
                            <button type="button" onClick={handleIncrement} disabled={tipoDocumento !== 'Proforma' && cantidad + 1 > stockDisponible} className="min-h-11 min-w-11 flex items-center justify-center rounded-lg disabled:opacity-40" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }} aria-label={`Sumar ${prodName}`}>
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={handleIncrement} disabled={tipoDocumento !== 'Proforma' && stockDisponible <= 0}
                            className="w-full min-h-11 rounded-xl font-bold text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ background: 'var(--brand-primary-soft)', color: 'var(--text-link)' }}>
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
                            <span className="text-xs text-neutral-500">{det.cantidad} kg × {det.precio_unitario > 0 ? `₡${det.precio_unitario.toLocaleString()}/kg` : 'precio al elegir cliente'}</span>
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
              {tipoDocumento !== 'Tiquete' ? (
                <div className="p-6 rounded-2xl shadow-sm border space-y-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                  <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <ShoppingCart className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Seleccionar Cliente
                  </h3>
                  <select value={selectedCliente} onChange={handleClienteChange}
                    className="w-full rounded-xl border px-4 py-3 text-sm outline-none" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                    <option value="">Seleccione un cliente...</option>
                    {clientes.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre} ({c.ruta || 'Sin ruta'})</option>
                    ))}
                  </select>
                  {selectedCliente && facturas.some(f => f.clienteId === selectedCliente && f.estado === 'Pendiente') && (
                    <div className="flex items-start p-3 rounded-xl border" style={{ background: 'var(--status-danger-soft)', color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}>
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
                  <p className="font-bold" style={{ color: 'var(--text-link)' }}>{NOMBRE_NOTA_VENTA} — Consumidor final</p>
                  <p className="mt-1 text-sm" style={{ color: 'var(--brand-primary)' }}>En producción se emitiría como comprobante fiscal electrónico. En esta demo no se transmite a Hacienda y no sirve para respaldar créditos o gastos tributarios.</p>
                </div>
              )}

              {tipoDocumento === 'Proforma' ? <div className="rounded-2xl border p-4 text-sm" style={{ background: 'var(--status-warning-soft)', borderColor: 'var(--status-warning)', color: 'var(--text-primary)' }}><b>Cotización comercial · no fiscal</b><p className="mt-1">Guardar la proforma no registra una venta, no recibe pagos y no descuenta existencias. Al concretarla, úsela para iniciar la factura o el tiquete.</p></div> : <div className="p-6 rounded-2xl shadow-sm border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <CreditCard className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> Condición de Pago
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider block mb-2" style={{ color: 'var(--text-muted)' }}>Condición</label>
                    <select value={condicionPago} onChange={e => {
                      const value = e.target.value as 'Contado' | 'Credito';
                      setCondicionPago(value);
                      if (value === 'Contado' && pagos.length === 0) setPagos([{ metodo: 'Efectivo', monto: 'total' }]);
                    }}
                      className="w-full rounded-xl border px-4 py-3 text-sm outline-none" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                      <option value="Contado">Contado</option>
                      <option value="Credito">Crédito</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Pagos recibidos</label>
                      {pagos.length < 4 && <button type="button" onClick={() => {
                        const metodo = MEDIOS_PAGO.find(opcion => !pagos.some(p => p.metodo === opcion)) || 'Otro';
                        setPagos(actual => [...actual, { metodo, monto: '0' }]);
                      }} className="min-h-10 rounded-lg border px-3 text-xs font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--brand-primary)' }}>+ Agregar medio</button>}
                    </div>
                    <div className="space-y-2">
                      {pagos.map((pago, index) => <div key={`${index}-${pago.metodo}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-xl border p-2 sm:p-3" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)' }}>
                        <label className="min-w-0 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Medio
                          <select value={pago.metodo} onChange={e => setPagos(actual => actual.map((p, i) => i === index ? { ...p, metodo: e.target.value } : p))} className="mt-1 min-h-11 w-full rounded-lg border px-2 text-sm" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>
                            {MEDIOS_PAGO.filter(opcion => opcion === pago.metodo || !pagos.some((p, i) => i !== index && p.metodo === opcion)).map(opcion => <option key={opcion} value={opcion}>{opcion}</option>)}
                          </select>
                        </label>
                        <label className="min-w-0 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Monto (₡)
                          <input type="number" min="0" step="0.01" inputMode="decimal" value={pago.monto === 'total' ? total.toFixed(2) : pago.monto} onChange={e => setPagos(actual => actual.map((p, i) => i === index ? { ...p, monto: e.target.value } : p))} className="mt-1 min-h-11 w-full rounded-lg border px-2 text-sm font-bold" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }} />
                        </label>
                        <button type="button" onClick={() => setPagos(actual => actual.filter((_, i) => i !== index))} disabled={pagos.length <= 1} className="mb-0.5 flex h-11 w-11 items-center justify-center rounded-lg border disabled:opacity-40" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }} aria-label="Quitar medio de pago"><X className="h-4 w-4" /></button>
                      </div>)}
                      {condicionPago === 'Credito' && selectedCliente && <button type="button" onClick={() => setPagos([])} className="min-h-10 rounded-lg border px-3 text-xs font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>Dejar todo pendiente a crédito</button>}
                      <div className="grid grid-cols-2 gap-3 rounded-xl p-3 text-sm" style={{ background: 'var(--brand-primary-soft)' }}>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Recibido ahora</span><strong className="block" style={{ color: 'var(--text-primary)' }}>{formatoCRC(totalRecibido)}</strong></div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Saldo a crédito</span><strong className="block" style={{ color: 'var(--text-primary)' }}>{formatoCRC(saldoACredito)}</strong></div>
                      </div>
                      {totalRecibido > total + 0.01 && <p role="alert" className="text-sm font-semibold" style={{ color: 'var(--status-danger)' }}>Los pagos superan el total de la venta.</p>}
                      {condicionPago === 'Contado' && saldoACredito > 0.01 && <p role="alert" className="text-sm" style={{ color: 'var(--status-warning)' }}>Complete el monto o seleccione crédito para registrar el saldo pendiente.</p>}
                    </div>
                  </div>
                </div>
              </div>}
            </div>
          )}

          {/* Step 3: Confirmar */}
          {wizardStep === 3 && (
            <div className="space-y-6 animate-in fade-in">
              <div className="p-6 rounded-2xl shadow-sm border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <CheckCircle className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} /> {tipoDocumento === 'Proforma' ? 'Resumen de la proforma' : 'Resumen de la Venta'}
                </h3>

                {/* Client info */}
                {selectedCliente && (
                  <div className="p-4 rounded-xl mb-4" style={{ background: 'color-mix(in srgb, var(--brand-primary) 6%, transparent)' }}>
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--brand-primary)' }}>Cliente</p>
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{getCliente(selectedCliente)?.nombre}</p>
                    <p className="text-xs" style={{ color: 'var(--brand-primary)' }}>{getCliente(selectedCliente)?.ruta} — {saldoACredito > 0.01 ? 'Crédito parcial' : 'Contado'}</p>
                  </div>
                )}

                {/* Items */}
                <div className="divide-y divide-neutral-100 mb-4">
                  {itemsEnCarrito.map((det, idx) => (
                    <div key={idx} className="flex justify-between items-center py-3">
                      <div>
                        <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{det.producto}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{det.cantidad} kg × ₡{det.precio_unitario.toLocaleString()}/kg</p>
                      </div>
                      <p className="font-bold" style={{ color: 'var(--text-primary)' }}>₡{det.subtotal.toLocaleString()}</p>
                    </div>
                  ))}
                </div>

                <div className="mb-4 rounded-xl border p-4" style={{ background: 'var(--bg-muted)', borderColor: 'var(--border-default)' }}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Cobro registrado</p>
                  {tipoDocumento === 'Proforma' ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No se registrará cobro hasta convertirla en venta.</p> : <>{pagosNormalizados.length ? pagosNormalizados.map((pago, index) => <div key={`${pago.metodo}-${index}`} className="flex justify-between gap-3 py-1 text-sm"><span style={{ color: 'var(--text-secondary)' }}>{pago.metodo}</span><strong style={{ color: 'var(--text-primary)' }}>{formatoCRC(pago.monto)}</strong></div>) : <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Sin abono</p>}<div className="mt-2 flex justify-between border-t pt-2 text-sm" style={{ borderColor: 'var(--border-default)' }}><span style={{ color: 'var(--text-secondary)' }}>Saldo pendiente</span><strong style={{ color: 'var(--text-primary)' }}>{formatoCRC(saldoACredito)}</strong></div></>}
                </div>

                {/* Totals */}
                <div className="p-4 rounded-xl space-y-2" style={{ background: 'var(--bg-muted)' }}>
                  <div className="flex justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <span>Subtotal</span><span>₡{subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <span>Descuento</span>
                    <input type="number" value={descuento || ''} onChange={e => setDescuento(Number(e.target.value))}
                      className="w-24 rounded border px-2 py-1 text-right text-xs outline-none" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} placeholder="0" />
                  </div>
                  <div className="flex justify-between items-end pt-2 mt-2 border-t border-neutral-200">
                    <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Total a Cobrar</span>
                    <span className="text-3xl font-black" style={{ color: 'var(--brand-primary)' }}>₡{total.toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <p className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--brand-primary-soft)', color: 'var(--text-secondary)' }}>
                {tipoDocumento === 'Proforma' ? 'Al guardar se almacenará una cotización separada, sin transmitirla a Hacienda ni registrar la venta.' : 'Al confirmar se guardará la venta y se abrirá su documento para imprimirlo o preparar el correo al cliente.'}
              </p>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="hidden md:flex justify-between items-center mt-6">
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
              <button type="button" onClick={handleCreate} disabled={creandoFactura}
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-white font-bold text-sm transition-colors shadow-md disabled:opacity-60" style={{ background: 'var(--brand-primary)' }}>
                  <Check className="w-5 h-5" /> {tipoDocumento === 'Proforma' ? 'Guardar proforma' : 'Confirmar y Cobrar'}
              </button>
            )}
          </div>
          <AccionFijaMovil etiquetaAccesible="Continuar creación de factura">
            <div className="mx-auto flex max-w-md gap-3">
              {wizardStep > 1 && (
                <button type="button" onClick={handlePrev} className="min-h-12 min-w-12 rounded-xl border px-4 font-bold" style={{ color: 'var(--text-primary)', borderColor: 'var(--border-default)', background: 'var(--bg-card)' }} aria-label="Paso anterior">
                  <ArrowLeft className="h-5 w-5" />
                </button>
              )}
              {wizardStep < 3 ? (
                <button type="button" onClick={handleNext} disabled={!canAdvance()} className="min-h-12 flex-1 rounded-xl px-5 font-bold shadow-sm disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
                  {wizardStep === 1 ? 'Continuar al cliente' : 'Revisar factura'} <ArrowRight className="ml-2 inline h-4 w-4" />
                </button>
              ) : (
                <button type="button" onClick={handleCreate} disabled={creandoFactura} className="min-h-12 flex-1 rounded-xl px-5 font-bold shadow-sm disabled:cursor-wait disabled:opacity-60" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
                  {creandoFactura ? <><Spinner tamano="xs" /> Guardando…</> : <><Check className="mr-2 inline h-5 w-5" /> {tipoDocumento === 'Proforma' ? 'Guardar proforma' : 'Confirmar y cobrar'}</>}
                </button>
              )}
            </div>
          </AccionFijaMovil>
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

          {esVendedor ? <section data-testid="documentos-vendedor" className="p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>Historial de documentos</h3><p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>Abra un documento para ver sus acciones.</p></div>
              <div className="flex gap-1 rounded-xl p-1" role="tablist" aria-label="Filtrar documentos" style={{ background: 'var(--bg-muted)' }}>
                {([['todos', 'Todos', facturasActivas.length + proformas.length], ['facturas', 'Facturas', facturasActivas.length], ['proformas', 'Proformas', proformas.length]] as const).map(([filtro, etiqueta, cantidad]) => <button key={filtro} type="button" role="tab" aria-selected={filtroDocumentosVendedor === filtro} onClick={() => setFiltroDocumentosVendedor(filtro)} className="min-h-9 rounded-lg px-2.5 text-xs font-bold" style={{ background: filtroDocumentosVendedor === filtro ? 'var(--bg-card)' : 'transparent', color: filtroDocumentosVendedor === filtro ? 'var(--brand-primary)' : 'var(--text-secondary)' }}>{etiqueta}<span className="ml-1 opacity-70">{cantidad}</span></button>)}
              </div>
            </div>
            {documentosVendedor.length > 1 && <div className="mb-2 flex justify-end gap-2">
              <button type="button" onClick={() => setFacturasExpandOf(new Set(documentosVendedor.map(doc => doc.id)))} className="min-h-8 rounded-lg px-2.5 text-xs font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>Expandir todo</button>
              <button type="button" onClick={() => setFacturasExpandOf(new Set())} className="min-h-8 rounded-lg px-2.5 text-xs font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>Contraer todo</button>
            </div>}
            <div className="space-y-2">
              {documentosVendedor.map(doc => {
                const expandido = facturasExpandOf.has(doc.id);
                const fecha = new Date(doc.fecha);
                const detalleProforma = doc.tipo === 'Proforma' ? (doc.data.detalles || []).map((detalle: any) => `${detalle.producto} · ${Number(detalle.cantidad || 0).toFixed(2)} kg`).join(' / ') : '';
                return <article key={doc.id} className="rounded-xl border p-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                  <button type="button" aria-expanded={expandido} onClick={() => setFacturasExpandOf(prev => { const next = new Set(prev); if (next.has(doc.id)) next.delete(doc.id); else next.add(doc.id); return next; })} className="flex min-h-12 w-full items-center justify-between gap-2 text-left">
                    <span className="min-w-0"><span className="block truncate text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>{doc.consecutivo}</span><span className="mt-1 block truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{doc.cliente} · {Number.isNaN(fecha.getTime()) ? 'Fecha sin registrar' : fecha.toLocaleDateString('es-CR')}</span></span>
                    <span className="shrink-0 text-right"><span className="block text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>{formatoCRC(doc.total)}</span><span className="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold" style={doc.estado === 'Pagada' || doc.estado === 'Vigente' ? { background: 'var(--status-success-soft)', color: 'var(--status-success)' } : doc.estado === 'Pendiente' ? { background: 'var(--status-warning-soft)', color: 'var(--status-warning)' } : { background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>{doc.tipo === 'Proforma' ? 'Proforma' : doc.estado}</span></span>
                    <span className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--brand-primary)' }}>{expandido ? '−' : '+'}</span>
                  </button>
                  {expandido && <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border-default)' }}>
                    {doc.tipo === 'Factura' ? <>
                      <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{doc.data.condicion_pago === 'Credito' ? 'Crédito' : 'Contado'}{doc.data.metodo_pago ? ` · ${doc.data.metodo_pago}` : ''}</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <button type="button" onClick={() => abrirFactura(doc.data)} className="min-h-10 rounded-lg border px-3 text-xs font-bold" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><FileText className="mr-1 inline h-4 w-4" />Ver factura</button>
                        <button type="button" onClick={() => abrirFactura(doc.data)} className="min-h-10 rounded-lg border px-3 text-xs font-bold" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><Send className="mr-1 inline h-4 w-4" />Reenviar</button>
                        <button type="button" onClick={() => imprimirFacturaDesdeLista(doc.data)} className="min-h-10 rounded-lg px-3 text-xs font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}><Printer className="mr-1 inline h-4 w-4" />Imprimir</button>
                      </div>
                    </> : <>
                      <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{detalleProforma || 'Cotización comercial'}</p>
                      <button type="button" onClick={() => imprimirProforma(doc.data)} className="min-h-10 w-full rounded-lg border px-3 text-xs font-bold sm:w-auto" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><Printer className="mr-1 inline h-4 w-4" />Ver o imprimir proforma</button>
                    </>}
                  </div>}
                </article>;
              })}
              {documentosVendedor.length === 0 && <p className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>{searchTerm ? 'No encontramos documentos con esa búsqueda.' : 'Aún no hay facturas ni proformas.'}</p>}
            </div>
          </section> : <>
          <section className="border-b" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3 md:px-6" style={{ borderColor: 'var(--border-default)' }}>
              <div><h3 className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Proformas / cotizaciones ({filteredProformas.length})</h3><p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>No fiscales; no registran ventas, pagos ni movimientos de inventario.</p></div>
            </div>
            {filteredProformas.length ? <div className="divide-y" style={{ borderColor: 'var(--border-default)' }}>
              {filteredProformas.map((p: any) => <div key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{p.consecutivo}</strong><span className="rounded-full px-2 py-1 text-[10px] font-bold" style={{ background: p.estado === 'Vigente' ? 'var(--status-success-soft)' : 'var(--brand-primary-soft)', color: 'var(--text-primary)' }}>{p.estado}</span></div><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{getCliente(p.clienteId)?.nombre || 'Cliente no indicado'} · {new Date(p.fecha).toLocaleDateString('es-CR')} · {(p.detalles || []).length} producto(s)</p></div>
                <div className="flex items-center justify-between gap-2 sm:justify-end"><strong className="mr-2" style={{ color: 'var(--text-primary)' }}>{formatoCRC(Number(p.total))}</strong><button type="button" onClick={() => imprimirProforma(p)} className="min-h-10 rounded-lg border px-3 text-xs font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><Printer className="mr-1 inline h-3.5 w-3.5" /> Imprimir</button>{p.estado === 'Vigente' && !p.guiaId && <button type="button" onClick={() => { setTipoDocumento('Factura'); setSelectedCliente(p.clienteId || ''); setDetalles((p.detalles || []).map((d: any) => ({ producto: d.producto, cantidad: Number(d.cantidad), precio_unitario: Number(d.precio_unitario), subtotal: Number(d.subtotal) }))); setDescuento(Number(p.descuento) || 0); setProformaOrigenId(p.id); setIsCreating(true); setWizardStep(1); }} className="min-h-10 rounded-lg px-3 text-xs font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>Convertir en venta</button>}{p.estado === 'Vigente' && p.guiaId && <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Convierta desde Mi Ruta</span>}</div>
              </div>)}
            </div> : <p className="px-4 py-5 text-sm md:px-6" style={{ color: 'var(--text-muted)' }}>Aún no hay proformas. Cree una desde “Nueva Venta” seleccionando “Proforma · no fiscal”.</p>}
          </section>

          <section data-testid="documentos-ventas">
            <h3 className="px-6 py-3 text-xs font-black uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
              Facturas activas ({facturasActivas.length})
            </h3>
            <div className="hidden md:block overflow-x-auto">
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
                      <td className="px-6 py-4 font-bold text-neutral-900"><button type="button" onClick={() => abrirFactura(f)} className="text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`Abrir factura ${f.consecutivo}`}>{f.consecutivo}</button></td>
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
                            ? { background: 'var(--status-success-soft)', color: 'var(--status-success)' }
                            : f.estado === 'Pendiente'
                            ? { background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }
                            : { background: 'var(--status-danger-soft)', color: 'var(--status-danger)' }
                          }>
                          {f.estado}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button onClick={() => abrirFactura(f)}
                          title={`Ver factura ${f.consecutivo}`}
                          className="p-1.5 hover:bg-stone-50 rounded-lg transition-colors inline-flex items-center space-x-1" style={{ color: 'var(--text-link)' }}>
                          <FileText className="w-4 h-4" /><span className="text-xs font-bold">Ver</span>
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
            <div className="md:hidden space-y-2 p-3" style={{ borderColor: 'var(--border-default)' }}>
              {filteredFacturas.length > 1 && <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setFacturasExpandOf(new Set(filteredFacturas.map(f => String(f.id))))} className="min-h-9 rounded-lg px-3 text-xs font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>Expandir todo</button>
                <button type="button" onClick={() => setFacturasExpandOf(new Set())} className="min-h-9 rounded-lg px-3 text-xs font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>Contraer todo</button>
              </div>}
              {filteredFacturas.map(f => {
                const expandida = facturasExpandOf.has(String(f.id));
                return <article key={f.id} className="rounded-xl border p-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)' }}>
                  <button type="button" aria-expanded={expandida} onClick={() => setFacturasExpandOf(prev => { const next = new Set(prev); const id = String(f.id); if (next.has(id)) next.delete(id); else next.add(id); return next; })} className="flex min-h-12 w-full items-center justify-between gap-3 text-left" style={{ color: 'var(--text-primary)' }}>
                    <span className="min-w-0"><span className="block truncate text-sm font-extrabold">{f.consecutivo}</span><span className="mt-1 block truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{getCliente(f.clienteId)?.nombre || 'Desconocido'} · {new Date(f.fecha).toLocaleDateString('es-CR')}</span></span>
                    <span className="shrink-0 text-right"><span className="block text-sm font-extrabold">{formatoCRC(Number(f.total))}</span><span className="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold" style={f.estado === 'Pagada' ? { background: 'var(--status-success-soft)', color: 'var(--status-success)' } : f.estado === 'Pendiente' ? { background: 'var(--status-warning-soft)', color: 'var(--status-warning)' } : { background: 'var(--status-danger-soft)', color: 'var(--status-danger)' }}>{f.estado}</span></span>
                    <span className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold" style={{ background: 'var(--bg-muted)', color: 'var(--brand-primary)' }}>{expandida ? '−' : '+'}</span>
                  </button>
                  {expandida && <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border-default)' }}>
                    <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{f.condicion_pago === 'Credito' ? 'Crédito' : 'Contado'}{f.metodo_pago ? ` · ${f.metodo_pago}` : ''}</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <button type="button" onClick={() => abrirFactura(f)} className="min-h-10 rounded-lg border px-3 text-xs font-bold" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><FileText className="mr-1 inline h-4 w-4" />Ver factura</button>
                      <button type="button" onClick={() => abrirFactura(f)} className="min-h-10 rounded-lg border px-3 text-xs font-bold" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><Send className="mr-1 inline h-4 w-4" />Reenviar</button>
                      <button type="button" onClick={() => imprimirFacturaDesdeLista(f)} className="min-h-10 rounded-lg px-3 text-xs font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}><Printer className="mr-1 inline h-4 w-4" />Imprimir</button>
                    </div>
                  </div>}
                </article>;
              })}
              {filteredFacturas.length === 0 && <p className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No se encontraron facturas.</p>}
            </div>
          </section>

          <section data-testid="documentos-rutas" className="border-t-8 border-neutral-100">
            <h3 className="px-6 py-3 text-xs font-black uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
              Rutas del día ({rutasDia.length})
            </h3>
            <div className="hidden md:block overflow-x-auto">
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
                            ? { background: 'var(--status-success-soft)', color: 'var(--status-success)' }
                            : { background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }
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
                            style={{ background: 'var(--brand-primary)', color: 'var(--text-on-action)' }}>
                            {consolidandoRuta === r.guiaId ? <Spinner tamano="xs" /> : <FileText className="w-3.5 h-3.5" />}
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
            <div className="md:hidden divide-y" style={{ borderColor: 'var(--border-default)' }}>
              {rutasDia.map(r => <div key={r.guiaId} className="p-4 space-y-3">
                <div className="flex justify-between gap-3"><div><p className="font-bold font-mono text-sm" style={{ color: 'var(--text-primary)' }}>{r.consecutivo}</p><p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{r.camionNombre}</p></div><span className="self-start rounded-full px-2 py-1 text-[11px] font-bold" style={r.consolidada ? { background: 'var(--status-success-soft)', color: 'var(--status-success)' } : { background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }}>{r.consolidada ? 'Consolidada' : r.estado}</span></div>
                <div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Fecha</p><p style={{ color: 'var(--text-primary)' }}>{new Date(r.fecha).toLocaleDateString()}</p></div><div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total vendido</p><p className="font-bold" style={{ color: 'var(--text-primary)' }}>₡{r.totalGenerado.toLocaleString()}</p></div><div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Kilos vendidos</p><p style={{ color: 'var(--text-primary)' }}>{r.vendidos} kg</p></div><div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Tiquetes · retornos</p><p style={{ color: 'var(--text-primary)' }}>{r.tiquetesEmitidos} · {r.retornos}</p></div></div>
                {!r.consolidada && <button onClick={() => handleConsolidarRuta(r.guiaId)} disabled={consolidandoRuta === r.guiaId} className="w-full min-h-11 inline-flex justify-center items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50" style={{ background: 'var(--brand-action)', color: '#fff' }}>{consolidandoRuta === r.guiaId ? <Spinner tamano="xs" /> : <FileText className="w-4 h-4" />} Generar facturas</button>}
              </div>)}
              {rutasDia.length === 0 && <p className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No hay rutas cerradas del día.</p>}
            </div>
          </section>

          <section data-testid="documentos-fisicos" className="border-t-8 border-neutral-100">
            <h3 className="px-6 py-3 text-xs font-black uppercase tracking-wider text-neutral-500 border-b border-neutral-200">
              Documentos electrónicos ({documentosElectronicos.length})
            </h3>
            <div className="hidden md:block overflow-x-auto">
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
                            ? { background: 'var(--status-info-soft)', color: 'var(--status-info)' }
                            : doc.tipoDocumento === 'Tiquete'
                            ? { background: 'var(--status-info-soft)', color: 'var(--status-info)' }
                            : { background: 'var(--bg-muted)', color: 'var(--text-secondary)' }
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
                            ? { background: 'var(--status-success-soft)', color: 'var(--status-success)' }
                            : doc.estado === 'Rechazado'
                            ? { background: 'var(--status-danger-soft)', color: 'var(--status-danger)' }
                            : doc.estado === 'Enviado'
                            ? { background: 'var(--status-info-soft)', color: 'var(--status-info)' }
                            : doc.estado === 'Pendiente'
                            ? { background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }
                            : { background: 'var(--status-neutral-soft)', color: 'var(--text-secondary)' }
                          }>
                          {getEstadoIcon(doc.estado)} {getEstadoFiscalVisible(doc.estado)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {doc.estado === 'Borrador' && (
                            <button onClick={() => handleGenerarXML(doc.id)} disabled={fiscalBloqueado}
                              className="p-1.5 hover:bg-stone-50 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40" style={{ color: 'var(--brand-secondary)' }} title={fiscalBloqueado ? 'Configure el emisor y la integración oficial primero' : 'Generar XML de demostración'}>
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                          {doc.estado === 'Pendiente' && (
                            <button onClick={() => handleEnviarHacienda(doc.id)} disabled={fiscalBloqueado || enviandoFE === doc.id}
                              className="p-1.5 hover:bg-stone-50 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40" style={{ color: 'var(--brand-primary)' }} title={fiscalBloqueado ? 'La integración oficial no está configurada' : 'Simular envío; no se envía a Hacienda'}>
                              <Send className="w-4 h-4" />
                            </button>
                          )}
                          {doc.estado === 'Enviado' && !fiscalBloqueado && (
                            <button onClick={async () => {
                              const res = await fetch('/api/facturacion/consultar-estado', {
                                method: 'POST', headers: authHeaders,
                                body: JSON.stringify({ documentoId: doc.id })
                              });
                              const data = await res.json();
                              if (!res.ok) { toast.error(data.error || 'No se pudo simular la respuesta'); return; }
                              await fetchData();
                              toast.success(`Respuesta simulada: ${data.estado || 'procesada'}.`);
                            }} className="p-1.5 hover:bg-stone-50 rounded-lg transition-colors" style={{ color: 'var(--brand-primary)' }} title="Simular respuesta de prueba; no consulta Hacienda">
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
            <div className="md:hidden divide-y" style={{ borderColor: 'var(--border-default)' }}>
              {documentosElectronicos.map(doc => <div key={doc.id} className="p-4 space-y-3">
                <div className="flex justify-between items-start gap-3"><div className="min-w-0"><span className="inline-flex rounded-full px-2 py-1 text-[11px] font-bold" style={{ background: 'var(--brand-primary-soft)', color: 'var(--text-primary)' }}>{doc.tipoDocumento}</span><p className="mt-2 font-bold font-mono text-xs break-all" style={{ color: 'var(--text-primary)' }}>{doc.consecutivo}</p><p className="text-sm mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>{doc.receptorNombre || 'Consumidor Final'}</p></div><span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold" style={doc.estado === 'Aceptado' ? { background: 'var(--status-success-soft)', color: 'var(--status-success)' } : doc.estado === 'Rechazado' ? { background: 'var(--status-danger-soft)', color: 'var(--status-danger)' } : { background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }}>{getEstadoFiscalVisible(doc.estado)}</span></div>
                <div className="flex justify-between text-sm"><span style={{ color: 'var(--text-muted)' }}>{new Date(doc.fechaEmision).toLocaleDateString()}</span><span className="font-bold" style={{ color: 'var(--text-primary)' }}>₡{doc.total.toLocaleString()}</span></div>
                <div className="flex gap-2">{doc.estado === 'Borrador' && <button onClick={() => handleGenerarXML(doc.id)} disabled={fiscalBloqueado} className="flex-1 min-h-11 rounded-xl border px-3 text-sm font-bold disabled:opacity-40" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><Download className="inline w-4 h-4 mr-2" />XML de demostración</button>}{doc.estado === 'Pendiente' && <button onClick={() => handleEnviarHacienda(doc.id)} disabled={fiscalBloqueado || enviandoFE === doc.id} className="flex-1 min-h-11 rounded-xl px-3 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--brand-action)', color: '#fff' }}><Send className="inline w-4 h-4 mr-2" />Simular ciclo</button>}{doc.estado === 'Enviado' && !fiscalBloqueado && <button onClick={async () => { const res = await fetch('/api/facturacion/consultar-estado', { method: 'POST', headers: authHeaders, body: JSON.stringify({ documentoId: doc.id }) }); const data = await res.json(); if (!res.ok) { toast.error(data.error || 'No se pudo simular la respuesta'); return; } await fetchData(); toast.success(`Respuesta simulada: ${data.estado || 'procesada'}.`); }} className="flex-1 min-h-11 rounded-xl border px-3 text-sm font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}><RefreshCw className="inline w-4 h-4 mr-2" />Simular respuesta</button>}</div>
              </div>)}
              {documentosElectronicos.length === 0 && <p className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No hay documentos electrónicos. Cree una factura para generar uno.</p>}
            </div>
          </section>
          </>}
        </div>
      )}
      {facturaSeleccionada && (
        <div className="invoice-print-overlay fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/55 p-0 sm:p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setFacturaSeleccionada(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="detalle-factura-titulo" className="invoice-print-view w-full sm:max-w-3xl max-h-[94dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl">
            <div className="invoice-paper">
              <div className="invoice-paper-topline" />
              <header className="invoice-paper-header">
                <div className="invoice-issuer-brand"><img src="/granja-don-paco-logo.png" alt="Granja Don Paco" /><div><strong>Granja Don Paco</strong><span>Siempre frescos</span>{documentoFiscalFactura?.emisorNombre && <small>{documentoFiscalFactura.emisorNombre}</small>}{cedulaEmisorVisible && <small>Cédula: {cedulaEmisorVisible}</small>}</div></div>
                <div className="invoice-document-number"><span>{documentoFiscalFactura?.tipoDocumento === 'Tiquete' ? 'TIQUETE · DEMO' : 'FACTURA · DEMO'}</span><strong id="detalle-factura-titulo">{facturaSeleccionada.consecutivo}</strong><small>Emitida {new Date(facturaSeleccionada.fecha).toLocaleString('es-CR')}</small><em className={`invoice-status invoice-status-${facturaSeleccionada.estado.toLowerCase()}`}>{facturaSeleccionada.estado}</em></div>
                <button type="button" className="invoice-close no-print" onClick={() => setFacturaSeleccionada(null)} aria-label="Cerrar detalle"><X className="w-5 h-5" /></button>
              </header>
              <div className="invoice-paper-meta"><span>Representación de demostración</span><span>{documentoFiscalFactura ? `Estado: ${getEstadoFiscalVisible(documentoFiscalFactura.estado)}` : 'Pendiente de documento demo'}</span></div>
              <p className="invoice-demo-notice">DEMO · Esta impresión no es un comprobante electrónico válido ni ha sido aceptada por Hacienda.</p>
              <div className="invoice-parties">
                <section><h4>EMISOR</h4><strong>{documentoFiscalFactura?.emisorNombre || 'Granja Don Paco'}</strong>{cedulaEmisorVisible && <span>Cédula: {cedulaEmisorVisible}</span>}{documentoFiscalFactura?.emisorCorreo && <span>{documentoFiscalFactura.emisorCorreo}</span>}</section>
                <section><h4>FACTURAR A</h4><strong>{clienteFactura?.nombre || 'Consumidor Final'}</strong>{clienteFactura?.documento_id && <span>{clienteFactura.tipo_documento || 'Identificación'}: {clienteFactura.documento_id}</span>}{clienteFactura?.telefono && <span>Tel. {clienteFactura.telefono}</span>}{clienteFactura?.email && <span>{clienteFactura.email}</span>}{clienteFactura?.direccion && <span>{clienteFactura.direccion}{[clienteFactura.distrito, clienteFactura.canton, clienteFactura.provincia].filter(Boolean).length ? ` · ${[clienteFactura.distrito, clienteFactura.canton, clienteFactura.provincia].filter(Boolean).join(', ')}` : ''}</span>}</section>
              </div>
              {documentoFiscalFactura && <div className="invoice-fiscal-identifiers"><span><b>TIPO DE DOCUMENTO</b>{documentoFiscalFactura.tipoDocumento === 'Tiquete' ? 'Tiquete · demo' : 'Factura · demo'}</span><span><b>CONSECUTIVO DE DEMOSTRACIÓN</b>{consecutivoFiscalValido ? documentoFiscalFactura.consecutivo : 'No disponible'}</span><span className="invoice-key"><b>CLAVE DE DEMOSTRACIÓN</b>{claveFiscalValida ? documentoFiscalFactura.clave : 'No disponible'}</span></div>}
              <div className="invoice-payment-strip"><span><b>CONDICIÓN</b>{facturaSeleccionada.condicion_pago === 'Credito' ? 'Crédito' : 'Contado'}</span><span><b>MEDIO DE PAGO</b>{facturaSeleccionada.metodo_pago || 'Crédito'}</span><span><b>FECHA</b>{new Date(facturaSeleccionada.fecha).toLocaleDateString('es-CR')}</span></div>
              <div className="invoice-lines-wrap"><table className="invoice-lines"><thead><tr><th>CANTIDAD</th><th>DESCRIPCIÓN</th><th>PRECIO / KG</th><th className="align-right">TOTAL</th></tr></thead><tbody>{facturaSeleccionada.detalles?.map((d, i) => <tr key={`${d.producto}-${i}`}><td>{Number(d.cantidad).toLocaleString('es-CR', { maximumFractionDigits: 2 })} kg</td><td><strong>{d.producto}</strong></td><td>{formatoCRC(d.precio_unitario)}</td><td className="align-right">{formatoCRC(d.subtotal)}</td></tr>)}</tbody></table>{!facturaSeleccionada.detalles?.length && <p className="invoice-empty-lines">No hay líneas de producto registradas en esta factura.</p>}</div>
              <div className="invoice-bottom-grid"><div className="invoice-received"><span>RECIBIDO CONFORME</span><i /><small>Nombre y firma del cliente</small></div><div className="invoice-totals"><div><span>Subtotal</span><b>{formatoCRC(facturaSeleccionada.subtotal)}</b></div>{facturaSeleccionada.descuento > 0 && <div><span>Descuento</span><b>− {formatoCRC(facturaSeleccionada.descuento)}</b></div>}{Number(documentoFiscalFactura?.impuestos || 0) > 0 && <div><span>Impuestos</span><b>{formatoCRC(Number(documentoFiscalFactura?.impuestos))}</b></div>}<div className="invoice-grand-total"><span>TOTAL</span><strong>{formatoCRC(facturaSeleccionada.total)}</strong></div>{facturaSeleccionada.saldoPendiente != null && facturaSeleccionada.saldoPendiente > 0 && <div className="invoice-balance"><span>Saldo pendiente</span><b>{formatoCRC(facturaSeleccionada.saldoPendiente)}</b></div>}</div></div>
              <footer className="invoice-paper-footer"><span>Gracias por su compra</span><small>Representación de demostración · Formato de referencia basado en comprobantes electrónicos 4.4</small></footer>
            </div>
            <label className="no-print mx-4 mb-3 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
              Correo para reenviar
              <input type="email" value={correoReenvioFactura} onChange={event => setCorreoReenvioFactura(event.target.value)} placeholder="cliente@correo.com" autoComplete="email" className="mt-1 min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-normal" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
            </label>
            <div className="invoice-actions no-print">
              <button type="button" onClick={() => setFacturaSeleccionada(null)} className="invoice-secondary-action">Cerrar</button>
              <button type="button" onClick={handleEnviarCorreoFactura} className="invoice-secondary-action" title="Preparar reenvío de la factura">
                <Send className="w-4 h-4" /> Preparar reenvío
              </button>
              <button type="button" onClick={handleImprimirFactura} className="invoice-primary-action"><Printer className="w-4 h-4" /> Imprimir factura</button>
            </div>
            <p className="no-print px-4 pb-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              El correo se prepara en tu aplicación de correo para que lo revises y adjuntes el PDF impreso.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
