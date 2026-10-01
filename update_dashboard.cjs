const fs = require('fs');
let content = fs.readFileSync('src/components/DashboardAdmin.tsx', 'utf-8');

// Replace fetch data block to include gastos
const fetchTarget = `        const [resFacturas, resInventario] = await Promise.all([
          fetch('/api/facturas'),
          fetch('/api/inventario')
        ]);`;
const fetchReplacement = `        const [resFacturas, resInventario, resGastos] = await Promise.all([
          fetch('/api/facturas'),
          fetch('/api/inventario'),
          fetch('/api/gastos')
        ]);`;
if (content.includes(fetchTarget)) {
  content = content.replace(fetchTarget, fetchReplacement);
}

// Add gastos state
const stateTarget = `  const [inventario, setInventario] = useState<InventarioItem[]>([]);`;
const stateReplacement = `  const [inventario, setInventario] = useState<InventarioItem[]>([]);\n  const [gastos, setGastos] = useState<any[]>([]);`;
if (content.includes(stateTarget)) {
  content = content.replace(stateTarget, stateReplacement);
}

// Add state update for gastos
const updateTarget = `        if (resInventario.ok) {
          const dataInv = await resInventario.json();
          setInventario(dataInv);
        }`;
const updateReplacement = `        if (resInventario.ok) {
          const dataInv = await resInventario.json();
          setInventario(dataInv);
        }
        if (resGastos.ok) {
          const dataGastos = await resGastos.json();
          setGastos(dataGastos);
        }`;
if (content.includes(updateTarget)) {
  content = content.replace(updateTarget, updateReplacement);
}

// Update the gastosOperativos calculation
const calculationTarget = `  // Gastos Simulados (ya que no están en DB aún)
  const gastosOperativos = 25000; // Diesel, viáticos simulados
  const utilidadNeta = ingresosHoy - gastosOperativos;`;
const calculationReplacement = `  // Gastos Reales
  const gastosOperativos = gastos.reduce((acc, g) => acc + g.monto, 0);
  const utilidadNeta = ingresosHoy - gastosOperativos;`;
if (content.includes(calculationTarget)) {
  content = content.replace(calculationTarget, calculationReplacement);
}

fs.writeFileSync('src/components/DashboardAdmin.tsx', content);
console.log("Dashboard updated with real gastos.");
