const fs = require('fs');
let content = fs.readFileSync('src/components/Facturacion.tsx', 'utf-8');

const target = 'export default function Facturacion({ currentUser }: FacturacionProps) {';
const replacement = `export default function Facturacion({ currentUser }: FacturacionProps) {
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

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('src/components/Facturacion.tsx', content);
  console.log('Added fetchInventario');
}
