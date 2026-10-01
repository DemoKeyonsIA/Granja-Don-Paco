const fs = require('fs');
let code = fs.readFileSync('src/components/Produccion.tsx', 'utf8');

// The faulty insert was around line 385
// We need to carefully remove it from the wrong place.
// The wrong place was right after "No hay galerones registrados en esta granja."
const wrongPart = `
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

code = code.replace(wrongPart, "\n                </div>\n              </div>");
// Actually, it might not match exactly due to whitespace, let's use a regex
code = code.replace(/<div className="col-span-full bg-white p-10 rounded-2xl border border-neutral-200 shadow-sm text-center">\s*<p className="text-neutral-500">No hay galerones registrados en esta granja\.<\/p>\s*<\/div>\s*\)\}\s*<div className="space-y-2">\s*<label className="text-sm font-bold text-neutral-700">Gallinaza \(Sacos\)<\/label>\s*<input\s*type="number"\s*min="0"\s*value=\{gallinazaSacos \|\| ''\}\s*onChange=\{\(e\) => setGallinazaSacos\(Number\(e\.target\.value\)\)\}\s*className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"\s*placeholder="0"\s*\/>\s*<\/div>\s*<\/div>/g, 
`<div className="col-span-full bg-white p-10 rounded-2xl border border-neutral-200 shadow-sm text-center">
                      <p className="text-neutral-500">No hay galerones registrados en esta granja.</p>
                    </div>
                  )}
                </div>
              </div>`
);


// And we need to add it to the correct place
// Find Cartones (Mediano) and append it before the </div> </div>
const medianoHtml = `<div className="space-y-2">
                  <label className="text-sm font-bold text-neutral-700">Cartones (Mediano)</label>
                  <input
                    type="number"
                    min="0"
                    value={huevosMedianos || ''}
                    onChange={(e) => setHuevosMedianos(Number(e.target.value))}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    placeholder="0"
                  />
                </div>`;

const newMedianoHtml = `${medianoHtml}
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
                </div>`;
code = code.replace(medianoHtml, newMedianoHtml);

fs.writeFileSync('src/components/Produccion.tsx', code);
