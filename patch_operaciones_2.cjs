const fs = require('fs');
let code = fs.readFileSync('src/components/Operaciones.tsx', 'utf8');

// Insert handleSaveMantenimiento
const handleArchiveRegex = /const handleArchiveGaleron = /;
const handleSaveMantenimiento = `const handleSaveMantenimiento = async () => {
    if (!selectedMantenimientoGaleron || !mantenimientoForm.fecha || !mantenimientoForm.descripcion) return;
    try {
      const res = await fetch('/api/mantenimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          galeronId: selectedMantenimientoGaleron.id,
          ...mantenimientoForm
        })
      });
      if (res.ok) {
        setShowMantenimientoForm(false);
        setSelectedMantenimientoGaleron(null);
        fetchData();
      }
    } catch (e) { console.error(e); }
  };

  const handleArchiveGaleron = `;
code = code.replace(handleArchiveRegex, handleSaveMantenimiento);

// Insert Mantenimiento Modal JSX
const modalRegex = /\{showGaleronForm && \([\s\S]*?<\/div>\s*\)\}/;

const modalCode = `{showMantenimientoForm && selectedMantenimientoGaleron && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-neutral-100 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-neutral-800">Registrar Mantenimiento</h3>
                <p className="text-sm text-neutral-500">Galerón: {selectedMantenimientoGaleron.nombre}</p>
              </div>
              <button onClick={() => setShowMantenimientoForm(false)} className="text-neutral-400 hover:text-neutral-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-600 uppercase">Fecha</label>
                <input 
                  type="date" 
                  value={mantenimientoForm.fecha} 
                  onChange={e => setMantenimientoForm({...mantenimientoForm, fecha: e.target.value})}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-600 uppercase">Tipo</label>
                <select 
                  value={mantenimientoForm.tipo} 
                  onChange={e => setMantenimientoForm({...mantenimientoForm, tipo: e.target.value})}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="Preventivo">Preventivo</option>
                  <option value="Correctivo">Correctivo</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-600 uppercase">Trazas / Descripción de Tareas</label>
                <textarea 
                  value={mantenimientoForm.descripcion} 
                  onChange={e => setMantenimientoForm({...mantenimientoForm, descripcion: e.target.value})}
                  rows={3}
                  placeholder="Ej. Revisión de bebederos, limpieza de extractores..."
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                />
              </div>
            </div>
            <div className="p-4 bg-neutral-50 border-t border-neutral-100 flex justify-end space-x-3">
              <button onClick={() => setShowMantenimientoForm(false)} className="bg-white text-neutral-700 px-5 py-2.5 rounded-xl text-sm font-bold border border-neutral-200 hover:bg-neutral-50">
                Cancelar
              </button>
              <button 
                onClick={handleSaveMantenimiento}
                disabled={!mantenimientoForm.descripcion}
                className="bg-orange-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-orange-700 disabled:opacity-50"
              >
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}

      $&`;
code = code.replace(modalRegex, modalCode);

fs.writeFileSync('src/components/Operaciones.tsx', code);
