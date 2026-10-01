const fs = require('fs');
let code = fs.readFileSync('src/components/Produccion.tsx', 'utf8');

const regex = /const fetchData = async \(\) => \{[\s\S]*?\}\s*};\s*useEffect/m;

const newFetch = `const fetchData = async () => {
    setIsLoading(true);
    try {
      const [resGranjas, resGalerones, resLotes, resHistorial] = await Promise.all([
        fetch('/api/granjas'),
        fetch('/api/galerones'),
        fetch('/api/lotes'),
        fetch('/api/produccion/historial')
      ]);
      if (resGranjas.ok) setGranjas(await resGranjas.json());
      if (resGalerones.ok) setGalerones(await resGalerones.json());
      if (resLotes.ok) setLotes(await resLotes.json());
      if (resHistorial && resHistorial.ok) setHistorialProduccion(await resHistorial.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect`;

code = code.replace(regex, newFetch);
fs.writeFileSync('src/components/Produccion.tsx', code);
