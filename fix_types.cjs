const fs = require('fs');
let code = fs.readFileSync('src/components/Operaciones.tsx', 'utf8');

code = code.replace(
  "import { Granja, Galeron, LoteAves, User, InventarioItem, MovimientoInventario } from '../types';",
  "import { User, InventarioItem, MovimientoInventario } from '../types';"
);

const types = `
type Granja = {
  id: string;
  nombre: string;
  ubicacion: string;
  encargadoId: string;
  estado?: string;
};

type Galeron = {
  id: string;
  granjaId: string;
  nombre: string;
  capacidad_maxima: number | string;
  estado_fisico: string;
  estado?: string;
};

type LoteAves = {
  id: string;
  galeronId: string;
  fecha_ingreso: string;
  cantidad_inicial: number;
  linea_genetica: string;
  estado: string; // Activo / Finalizado
};
`;

code = code.replace(
  "function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}",
  `function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n${types}`
);

fs.writeFileSync('src/components/Operaciones.tsx', code);
