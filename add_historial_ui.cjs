const fs = require('fs');
let code = fs.readFileSync('src/components/Produccion.tsx', 'utf8');

const regex = /\{activeTab === 'dashboard' && \(/;

const newTabContent = `{activeTab === 'historial' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-500">Total Cartones Hoy</p>
                  <p className="text-2xl font-bold text-neutral-800">
                    {historialProduccion
                      .filter(p => new Date(p.fecha).toDateString() === new Date().toDateString())
                      .filter(p => p.tipo_producto.includes('Huevos'))
                      .reduce((acc, curr) => acc + curr.cantidad, 0)}
                  </p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center text-green-600">
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-500">Total Gallinaza Hoy (Sacos)</p>
                  <p className="text-2xl font-bold text-neutral-800">
                    {historialProduccion
                      .filter(p => new Date(p.fecha).toDateString() === new Date().toDateString())
                      .filter(p => p.tipo_producto.includes('Gallinaza'))
                      .reduce((acc, curr) => acc + curr.cantidad, 0)}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-neutral-200 bg-neutral-50 flex justify-between items-center">
                <h3 className="font-bold text-lg text-neutral-800">Registros de Productividad</h3>
              </div>
              
              {historialProduccion.length === 0 ? (
                <div className="p-12 text-center flex flex-col items-center">
                  <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mb-4 text-neutral-400">
                    <Inbox className="w-8 h-8" />
                  </div>
                  <h4 className="text-lg font-bold text-neutral-700 mb-1">Sin Registros</h4>
                  <p className="text-neutral-500">No hay producción registrada en el sistema.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-neutral-50 border-b border-neutral-200 text-sm">
                        <th className="p-4 font-semibold text-neutral-600">Fecha</th>
                        <th className="p-4 font-semibold text-neutral-600">Granja / Galerón</th>
                        <th className="p-4 font-semibold text-neutral-600">Producto</th>
                        <th className="p-4 font-semibold text-neutral-600">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-neutral-100">
                      {[...historialProduccion].sort((a,b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()).map((prod: any) => {
                        const loteInfo = lotes.find(l => l.id === prod.loteId);
                        const galeronInfo = loteInfo ? galerones.find(g => g.id === loteInfo.galeronId) : null;
                        const granjaInfo = galeronInfo ? granjas.find(gr => gr.id === galeronInfo.granjaId) : null;
                        
                        return (
                          <tr key={prod.id} className="hover:bg-neutral-50 transition-colors">
                            <td className="p-4 text-neutral-800">
                              {new Date(prod.fecha).toLocaleString()}
                            </td>
                            <td className="p-4 text-neutral-800 font-medium">
                              {granjaInfo?.nombre || 'Desconocida'} / {galeronInfo?.nombre || 'Desconocido'}
                            </td>
                            <td className="p-4">
                              <span className={\`px-2.5 py-1 rounded-full text-xs font-semibold \${prod.tipo_producto.includes('Gallinaza') ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}\`}>
                                {prod.tipo_producto}
                              </span>
                            </td>
                            <td className="p-4 text-neutral-800 font-bold">
                              {prod.cantidad} <span className="font-normal text-neutral-500 text-xs">{prod.unidad}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'dashboard' && (`;

code = code.replace(regex, newTabContent);
fs.writeFileSync('src/components/Produccion.tsx', code);
