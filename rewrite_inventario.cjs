const fs = require('fs');
let code = fs.readFileSync('src/components/Inventario.tsx', 'utf8');

// Add Inbox
code = code.replace(
  "import { PackageOpen, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Camera, History, Upload } from 'lucide-react';",
  "import { PackageOpen, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Camera, History, Upload, Inbox } from 'lucide-react';"
);

// Add useEffect
code = code.replace(
  "import React, { useState } from 'react';",
  "import React, { useState, useEffect } from 'react';"
);

// Update initial states
code = code.replace(
  "const [inventario, setInventario] = useState<InventarioItem[]>(mockInventario);",
  "const [inventario, setInventario] = useState<any[]>([]);"
);
code = code.replace(
  "const [movimientos, setMovimientos] = useState<MovimientoInventario[]>(mockMovimientos);",
  "const [movimientos, setMovimientos] = useState<any[]>([]);"
);

// Insert fetch logic
const fetchLogic = `  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchInventario = async () => {
      setIsLoading(true);
      try {
        const [resInv, resMov] = await Promise.all([
          fetch('/api/inventario'),
          fetch('/api/inventario/movimientos')
        ]);
        if (resInv.ok) setInventario(await resInv.json());
        if (resMov.ok) setMovimientos(await resMov.json());
      } catch (e) {
        console.error("Error fetching inventory:", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchInventario();
  }, []);

  const [activeTab`;

code = code.replace("const [activeTab", fetchLogic);

// Replace empty state for movimientos
const oldMovimientosHtml = /<div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">[\s\S]*?<\/div>\s*<\/div>\s*\)\}\s*<\/div>\s*\);\s*\}/;

const newMovimientosHtml = `<div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          {movimientos.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mb-4 text-neutral-400">
                <Inbox className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-bold text-neutral-700 mb-1">Sin Movimientos</h4>
              <p className="text-neutral-500">No hay movimientos registrados en el kardex.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-bold text-xs border-b border-neutral-200">
                  <tr>
                    <th className="px-6 py-4">Fecha</th>
                    <th className="px-6 py-4">Tipo</th>
                    <th className="px-6 py-4">Origen</th>
                    <th className="px-6 py-4">Destino</th>
                    <th className="px-6 py-4">Producto</th>
                    <th className="px-6 py-4 text-right">Cantidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {[...movimientos].sort((a,b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()).map(mov => (
                    <tr key={mov.id} className="hover:bg-neutral-50/50 transition-colors">
                      <td className="px-6 py-4 text-neutral-500 text-xs">
                        {new Date(mov.fecha).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold",
                          mov.tipo === 'Entrada Producción' ? "bg-green-100 text-green-700" :
                          mov.tipo === 'Venta' || mov.tipo === 'Salida' ? "bg-orange-100 text-orange-700" :
                          mov.tipo === 'Traslado' ? "bg-blue-100 text-blue-700" :
                          "bg-neutral-100 text-neutral-700"
                        )}>
                          {mov.tipo}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-neutral-600">{mov.origen || '-'}</td>
                      <td className="px-6 py-4 text-neutral-600">{mov.destino || '-'}</td>
                      <td className="px-6 py-4 font-bold text-neutral-800">{mov.producto}</td>
                      <td className="px-6 py-4 text-right font-bold text-neutral-700">
                        {mov.cantidad} <span className="font-normal text-neutral-500 text-xs">{mov.unidad || ''}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}`;

code = code.replace(oldMovimientosHtml, newMovimientosHtml);

fs.writeFileSync('src/components/Inventario.tsx', code);
