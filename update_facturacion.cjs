const fs = require('fs');
const content = fs.readFileSync('src/components/Facturacion.tsx', 'utf-8');

const startStr = "{isCreating ? (";
const endStr = "      ) : (\n        <div className=\"bg-white rounded-3xl shadow-sm border border-neutral-200 overflow-hidden\">";

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `{isCreating ? (
        <form onSubmit={handleCreate} className="bg-neutral-50 p-2 md:p-6 rounded-3xl animate-in slide-in-from-top-4">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* POS Left Column (Products & Client) */}
            <div className="flex-1 space-y-6">
              {/* Header and Type */}
              <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-neutral-200">
                <h3 className="font-bold text-lg text-neutral-800">Nueva Venta POS</h3>
                
                <div className="flex items-center gap-2 bg-neutral-100 p-1 rounded-xl">
                  <button 
                    type="button"
                    onClick={() => setTipoDocumento('Factura')}
                    className={cn(
                      "px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center",
                      tipoDocumento === 'Factura' ? "bg-white text-blue-700 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                    )}
                  >
                    <FileText className="w-4 h-4 mr-1" /> Factura
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      setTipoDocumento('Tiquete');
                      setSelectedCliente('');
                    }}
                    className={cn(
                      "px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center",
                      tipoDocumento === 'Tiquete' ? "bg-white text-emerald-700 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                    )}
                  >
                    <Ticket className="w-4 h-4 mr-1" /> Tiquete
                  </button>
                </div>
              </div>

              {/* Client Selection */}
              {tipoDocumento === 'Factura' && (
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-neutral-200 space-y-4">
                  <div>
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2 block">Cliente</label>
                    <select 
                      value={selectedCliente}
                      onChange={e => setSelectedCliente(e.target.value)}
                      className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none"
                    >
                      <option value="">Seleccione un cliente...</option>
                      {mockClientes.map(c => (
                        <option key={c.id} value={c.id}>{c.nombre} ({c.ruta})</option>
                      ))}
                    </select>
                  </div>
                  {/* Warning if client has pending invoices */}
                  {selectedCliente && facturas.some(f => f.clienteId === selectedCliente && f.estado === 'Pendiente') && (
                    <div className="flex items-start bg-red-50 text-red-700 p-3 rounded-xl border border-red-100 animate-in fade-in">
                      <AlertTriangle className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-sm">Alerta de Crédito</p>
                        <p className="text-xs mt-0.5">Este cliente tiene facturas vencidas o pendientes de pago.</p>
                      </div>
                    </div>
                  )}
                  {selectedCliente && (
                    <button 
                      type="button" 
                      onClick={handleRepetirPedido}
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center mt-2"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Clonar último pedido de este cliente
                    </button>
                  )}
                </div>
              )}

              {/* Quick Products Grid */}
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-neutral-200">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-bold text-neutral-800">Productos Rápidos</h4>
                  <button 
                    type="button" 
                    onClick={handleScanBarcode}
                    className="text-xs font-bold text-neutral-600 hover:text-neutral-900 flex items-center bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <ScanLine className="w-4 h-4 mr-1.5" />
                    Escanear
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {['Huevos - Grande', 'Huevos - Mediano', 'Aves (Pollo Entero)', 'Aves (Pollo Pierna)', 'Alimento'].map(prodName => {
                    const existingDetIndex = detalles.findIndex(d => d.producto === prodName);
                    const isAdded = existingDetIndex >= 0;
                    const cantidad = isAdded ? detalles[existingDetIndex].cantidad : 0;
                    
                    const handleIncrement = () => {
                      if (isAdded) {
                        updateDetalle(existingDetIndex, 'cantidad', cantidad + 1);
                      } else {
                        const emptyIdx = detalles.findIndex(d => d.cantidad === 0 && d.producto === 'Aves');
                        if (emptyIdx >= 0) {
                          setDetalles(detalles.map((d, i) => i === emptyIdx ? { ...d, producto: prodName, cantidad: 1, precio_unitario: 1000, subtotal: 1000 } : d));
                        } else {
                          setDetalles([...detalles, { producto: prodName, cantidad: 1, precio_unitario: 1000, subtotal: 1000 }]);
                        }
                      }
                    };

                    const handleDecrement = () => {
                      if (isAdded && cantidad > 0) {
                        if (cantidad === 1) {
                          removeDetalle(existingDetIndex);
                        } else {
                          updateDetalle(existingDetIndex, 'cantidad', cantidad - 1);
                        }
                      }
                    };

                    return (
                      <div key={prodName} className={cn(
                        "relative border rounded-2xl p-3 flex flex-col items-center justify-between min-h-[120px] transition-all",
                        cantidad > 0 ? "border-blue-500 bg-blue-50/30" : "border-neutral-200 bg-white"
                      )}>
                        <p className="font-bold text-neutral-800 text-sm text-center mb-2 leading-tight">{prodName}</p>
                        
                        {cantidad > 0 ? (
                          <div className="flex items-center justify-between w-full bg-white rounded-xl shadow-sm border border-blue-100 p-1">
                            <button type="button" onClick={handleDecrement} className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100">
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="font-black text-blue-700">{cantidad}</span>
                            <button type="button" onClick={handleIncrement} className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button 
                            type="button"
                            onClick={handleIncrement}
                            className="w-full py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-sm transition-colors"
                          >
                            Agregar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* POS Right Column (Cart Summary) */}
            <div className="w-full lg:w-96 flex flex-col gap-6">
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-neutral-200 flex-1 flex flex-col sticky top-6">
                <h4 className="font-bold text-lg text-neutral-900 mb-4 flex items-center">
                  <ShoppingCart className="w-5 h-5 mr-2 text-blue-600" />
                  Carrito Actual
                </h4>

                <div className="flex-1 overflow-y-auto min-h-[200px] mb-4 pr-2 space-y-3">
                  {detalles.filter(d => d.cantidad > 0).length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-neutral-400">
                      <Package className="w-12 h-12 mb-2 opacity-20" />
                      <p className="text-sm">No hay productos en el carrito</p>
                    </div>
                  ) : (
                    detalles.filter(d => d.cantidad > 0).map((det, idx) => {
                      const realIdx = detalles.findIndex(dReal => dReal === det);
                      return (
                      <div key={idx} className="flex justify-between items-start border-b border-neutral-100 pb-3">
                        <div className="flex-1">
                          <p className="font-bold text-sm text-neutral-800">{det.producto}</p>
                          <div className="flex items-center text-xs text-neutral-500 mt-1">
                            <span>{det.cantidad} x ₡{det.precio_unitario.toLocaleString()}</span>
                            <button 
                              type="button" 
                              onClick={() => {
                                const newPrice = prompt('Nuevo precio unitario:', det.precio_unitario.toString());
                                if (newPrice) updateDetalle(realIdx, 'precio_unitario', Number(newPrice));
                              }}
                              className="ml-2 text-blue-600 hover:underline"
                            >
                              Editar
                            </button>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-neutral-900">₡{det.subtotal.toLocaleString()}</p>
                        </div>
                      </div>
                    )})
                  )}
                  {/* Manual Add Line */}
                  <button 
                    type="button" 
                    onClick={addDetalle}
                    className="w-full py-2 border-2 border-dashed border-neutral-200 rounded-xl text-neutral-500 font-bold text-xs hover:border-neutral-300 hover:text-neutral-700 transition-colors"
                  >
                    + Agregar línea personalizada
                  </button>
                </div>

                {/* Checkout Section */}
                <div className="pt-4 border-t border-neutral-200 mt-auto">
                  <div className="space-y-4 mb-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block mb-1">Condición</label>
                        <select 
                          value={condicionPago}
                          onChange={e => setCondicionPago(e.target.value as any)}
                          className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-2 text-xs focus:border-blue-500 outline-none"
                        >
                          <option value="Contado">Contado</option>
                          <option value="Credito">Crédito</option>
                        </select>
                      </div>
                      {condicionPago === 'Contado' && (
                        <div>
                          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block mb-1">Método</label>
                          <select 
                            value={metodoPago}
                            onChange={e => setMetodoPago(e.target.value as any)}
                            className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-2 text-xs focus:border-blue-500 outline-none"
                          >
                            <option value="Efectivo">Efectivo</option>
                            <option value="SINPE">SINPE Móvil</option>
                            <option value="Transferencia">Transferencia</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 mb-4 text-sm bg-neutral-50 p-4 rounded-xl">
                    <div className="flex justify-between text-neutral-600">
                      <span>Subtotal</span>
                      <span>₡{subtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-neutral-600">
                      <span>Descuento</span>
                      <input 
                        type="number"
                        value={descuento || ''}
                        onChange={e => setDescuento(Number(e.target.value))}
                        className="w-20 bg-white border border-neutral-200 rounded px-2 py-1 text-right text-xs focus:border-blue-500 outline-none"
                        placeholder="0"
                      />
                    </div>
                    <div className="pt-2 mt-2 border-t border-neutral-200 flex justify-between items-end">
                      <span className="font-bold text-neutral-900">Total a Cobrar</span>
                      <span className="text-3xl font-black text-emerald-600">₡{total.toLocaleString()}</span>
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="w-full flex justify-center items-center bg-blue-600 text-white px-6 py-4 rounded-xl font-bold hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-md text-lg"
                  >
                    <Check className="w-6 h-6 mr-2" />
                    Cobrar y Finalizar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
`;
  
  const newContent = content.substring(0, startIdx) + replacement + content.substring(endIdx);
  fs.writeFileSync('src/components/Facturacion.tsx', newContent);
  console.log("Updated!");
} else {
  console.log("Not found");
}
