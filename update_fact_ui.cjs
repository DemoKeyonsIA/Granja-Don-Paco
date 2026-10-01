const fs = require('fs');
let content = fs.readFileSync('src/components/Facturacion.tsx', 'utf-8');

// Add InventarioItem type
if (!content.includes('InventarioItem')) {
  content = content.replace(
    "import { Factura, User, DetalleFactura, Cliente } from '../types';",
    "import { Factura, User, DetalleFactura, Cliente, InventarioItem } from '../types';"
  );
}

// Add state and fetchInventario
const componentStart = 'export default function Facturacion({ currentUser }: { currentUser: User }) {';
const fetchCode = `
  const [inventario, setInventario] = useState<InventarioItem[]>([]);

  const fetchInventario = async () => {
    try {
      const res = await fetch('/api/inventario');
      if (res.ok) {
        const data = await res.json();
        setInventario(data);
      }
    } catch (err) {
      console.error('Error fetching inventario', err);
    }
  };

  useEffect(() => {
    fetchInventario();
  }, []);
`;

if (content.includes(componentStart)) {
  content = content.replace(componentStart, componentStart + fetchCode);
}

// Add fetchInventario to handleCreate success
const handleCreateTarget = `      // Si fue exitoso, actualizamos la vista local
      setFacturas([newFactura, ...facturas]);
      setIsCreating(false);
      resetForm();
      alert('Factura creada y sincronizada exitosamente.');`;
const handleCreateReplacement = `      // Si fue exitoso, actualizamos la vista local
      setFacturas([newFactura, ...facturas]);
      setIsCreating(false);
      resetForm();
      await fetchInventario(); // <--- Sincronización de UI
      alert('Factura creada y sincronizada exitosamente.');`;

content = content.replace(handleCreateTarget, handleCreateReplacement);

// Update Quick Products UI
const uiTarget = `                  {['Huevos - Grande', 'Huevos - Mediano', 'Aves (Pollo Entero)', 'Aves (Pollo Pierna)', 'Alimento'].map(prodName => {
                    const existingDetIndex = detalles.findIndex(d => d.producto === prodName);
                    const isAdded = existingDetIndex >= 0;
                    const cantidad = isAdded ? detalles[existingDetIndex].cantidad : 0;
                    
                    const handleIncrement = () => {`;

const uiReplacement = `                  {['Huevos - Grande', 'Huevos - Mediano', 'Aves (Pollo Entero)', 'Aves (Pollo Pierna)', 'Alimento'].map(prodName => {
                    const existingDetIndex = detalles.findIndex(d => d.producto === prodName);
                    const isAdded = existingDetIndex >= 0;
                    const cantidad = isAdded ? detalles[existingDetIndex].cantidad : 0;
                    const invItem = inventario.find(i => i.producto === prodName && i.ubicacion === 'Camión Ruta 1');
                    const stockDisponible = invItem ? invItem.cantidad : 0;
                    
                    const handleIncrement = () => {
                      if (cantidad >= stockDisponible) {
                        alert(\`No hay más \${prodName} en el inventario del camión.\`);
                        return;
                      }`;

content = content.replace(uiTarget, uiReplacement);

const htmlTarget = `<p className="font-bold text-neutral-800 text-sm text-center mb-2 leading-tight">{prodName}</p>`;
const htmlReplacement = `<p className="font-bold text-neutral-800 text-sm text-center mb-0 leading-tight">{prodName}</p>
                        <p className="text-[10px] text-neutral-500 font-medium mb-2">Disp: {stockDisponible}</p>`;

content = content.replace(htmlTarget, htmlReplacement);

fs.writeFileSync('src/components/Facturacion.tsx', content);
console.log("Facturacion.tsx updated with fetchInventario and UI sync");
