const fs = require('fs');
let code = fs.readFileSync('src/components/Logistica.tsx', 'utf8');

// Change initial state
code = code.replace(
  "const [auditoriaData, setAuditoriaData] = useState<any[]>([]);",
  "const [auditoriaData, setAuditoriaData] = useState<any>({ facturas: [], totalCargado: 0 });"
);

// Change fetch URL to pass ruta
code = code.replace(
  "fetch('/api/logistica/auditoria'),",
  "fetch(`/api/logistica/auditoria?ruta=${encodeURIComponent(selectedRuta)}`),"
);

// We also need to add selectedRuta to the dependency array of useEffect
code = code.replace(
  "  }, [activeTab]);",
  "  }, [activeTab, selectedRuta]);"
);

// Replace calculation block
const oldCalc = `  // Filtrar facturas (en una app real filtraríamos por la ruta seleccionada)
  const facturasDeRuta = auditoriaData; 
  
  // Calcular total vendido matemáticamente leyendo los detalles
  let totalVendido = 0;
  facturasDeRuta.forEach(f => {
    f.detalles?.forEach((d: any) => {
      totalVendido += Number(d.cantidad);
    });
  });

  // Calcular inventario físico actual en el camión según la base de datos
  const inventarioCamion = inventarioGlobal.filter(i => i.ubicacion === selectedRuta);
  const totalActualCamion = inventarioCamion.reduce((acc, curr) => acc + Number(curr.cantidad), 0);

  // Como no hay tabla de devoluciones, la asumo matemáticamente como 0 
  // para que el cálculo sea 100% real a partir de lo que sí existe.
  const totalDevuelto = 0; 

  // Reconstrucción matemática de la carga inicial 
  // Carga Inicial = Lo que quedó en el camión + Lo que se vendió + Lo que se devolvió
  const totalCargado = totalActualCamion + totalVendido + totalDevuelto;

  // Merma Matemática
  const merma = totalCargado - totalVendido - totalDevuelto - totalActualCamion;`;

const newCalc = `  // Filtrar facturas
  const facturasDeRuta = auditoriaData.facturas || []; 
  const totalCargado = auditoriaData.totalCargado || 0;
  
  // Calcular total vendido matemáticamente leyendo los detalles
  let totalVendido = 0;
  facturasDeRuta.forEach((f: any) => {
    f.detalles?.forEach((d: any) => {
      totalVendido += Number(d.cantidad);
    });
  });

  // Calcular inventario físico actual en el camión según la base de datos
  const inventarioCamion = inventarioGlobal.filter(i => i.ubicacion === selectedRuta);
  const totalActualCamion = inventarioCamion.reduce((acc, curr) => acc + Number(curr.cantidad), 0);

  // Merma Matemática (Ecuación Obligatoria)
  const merma = totalCargado - totalVendido - totalActualCamion;`;

code = code.replace(oldCalc, newCalc);

fs.writeFileSync('src/components/Logistica.tsx', code);
