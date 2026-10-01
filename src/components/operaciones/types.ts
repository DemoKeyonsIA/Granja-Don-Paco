export type Granja = {
  id: string;
  nombre: string;
  ubicacion: string;
  tipo_produccion?: string;
  encargadoId: string;
  estado?: string;
};

export type Galeron = {
  id: string;
  granjaId: string;
  nombre: string;
  capacidad_maxima: number | string;
  aves_en_produccion?: number;
  tipo_galeron?: string;
  produccion_diaria_esperada?: number;
  notas?: string;
  fecha_ultimo_mantenimiento?: string;
  estado?: string;
};

export type LoteAves = {
  id: string;
  galeronId: string;
  fecha_ingreso: string;
  cantidad_inicial: number;
  linea_genetica: string;
  estado: string;
};
