const fs = require('fs');
let code = fs.readFileSync('src/components/Produccion.tsx', 'utf8');

// Add gallinaza state
code = code.replace(
  "const [huevosMedianos, setHuevosMedianos] = useState(0);",
  "const [huevosMedianos, setHuevosMedianos] = useState(0);\n  const [gallinazaSacos, setGallinazaSacos] = useState(0);"
);

// Update condition
code = code.replace(
  "if (huevosGrandes <= 0 && huevosMedianos <= 0) return;",
  "if (huevosGrandes <= 0 && huevosMedianos <= 0 && gallinazaSacos <= 0) return;"
);

// Update payload
code = code.replace(
  /const payload = \{\s*galeron: galeronSeleccionadoRecoleccion,\s*detalles: \[\s*\{\s*tamano: 'Grande', cantidad: huevosGrandes\s*\},\s*\{\s*tamano: 'Mediano', cantidad: huevosMedianos\s*\}\s*\]\s*\};/m,
  `const payload = {
        galeron: galeronSeleccionadoRecoleccion,
        detalles: [
          { tamano: 'Grande', cantidad: huevosGrandes },
          { tamano: 'Mediano', cantidad: huevosMedianos },
          { tamano: 'Gallinaza', cantidad: gallinazaSacos }
        ]
      };`
);

code = code.replace(
  "setHuevosGrandes(0);\n      setHuevosMedianos(0);\n      setGaleronSeleccionadoRecoleccion('');",
  "setHuevosGrandes(0);\n      setHuevosMedianos(0);\n      setGallinazaSacos(0);\n      setGaleronSeleccionadoRecoleccion('');"
);
code = code.replace(
  "disabled={isSubmitting || (!huevosGrandes && !huevosMedianos) || !galeronSeleccionadoRecoleccion}",
  "disabled={isSubmitting || (!huevosGrandes && !huevosMedianos && !gallinazaSacos) || !galeronSeleccionadoRecoleccion}"
);


// Add field to form UI
const newField = `
                <div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">Gallinaza (Sacos)</label>
                  <input
                    type="number"
                    min="0"
                    value={gallinazaSacos || ''}
                    onChange={(e) => setGallinazaSacos(Number(e.target.value))}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    placeholder="0"
                  />
                </div>
              </div>`;

code = code.replace(
  "                </div>\n              </div>",
  newField
);

fs.writeFileSync('src/components/Produccion.tsx', code);
