type ClienteConUbicacion = {
  id: string;
  nombre: string;
  prioridad?: string | null;
  ventana_entrega_ini?: string | null;
  ventana_entrega_fin?: string | null;
  latitud?: number | string | null;
  longitud?: number | string | null;
  provincia?: string | null;
  canton?: string | null;
  distrito?: string | null;
};

type RutaConCentroide = {
  centroide_lat?: number | string | null;
  centroide_lng?: number | string | null;
} | null | undefined;

/** Devuelve el orden sugerido de visita, conservando las reglas actuales de despacho. */
export function calcularOrdenRuta(clientesRuta: ClienteConUbicacion[], ruta?: RutaConCentroide): string | null {
  const conUbicacion = clientesRuta.filter((cliente) => cliente.latitud != null && cliente.longitud != null);

  if (conUbicacion.length > 0) {
    let actualLat = Number(ruta?.centroide_lat || 0);
    let actualLng = Number(ruta?.centroide_lng || 0);
    const pendientes = [...conUbicacion];
    const orden: Array<Record<string, unknown>> = [];

    while (pendientes.length > 0) {
      let idx = 0;
      let mejorDist = Infinity;
      for (let i = 0; i < pendientes.length; i++) {
        const cliente = pendientes[i];
        const distancia = Math.pow(Number(cliente.latitud) - actualLat, 2)
          + Math.pow(Number(cliente.longitud) - actualLng, 2);
        if (distancia < mejorDist) {
          mejorDist = distancia;
          idx = i;
        }
      }
      const cliente = pendientes.splice(idx, 1)[0];
      orden.push({
        clienteId: cliente.id,
        nombre: cliente.nombre,
        prioridad: cliente.prioridad || 'Normal',
        ventanaIni: cliente.ventana_entrega_ini,
        ventanaFin: cliente.ventana_entrega_fin,
      });
      actualLat = Number(cliente.latitud);
      actualLng = Number(cliente.longitud);
    }
    return JSON.stringify(orden);
  }

  if (clientesRuta.length === 0) return null;
  const orden = [...clientesRuta]
    .sort((a, b) => [a.provincia, a.canton, a.distrito, a.nombre]
      .map((value) => String(value || '')).join('|')
      .localeCompare([b.provincia, b.canton, b.distrito, b.nombre]
        .map((value) => String(value || '')).join('|'), 'es'))
    .map((cliente) => ({
      clienteId: cliente.id,
      nombre: cliente.nombre,
      prioridad: cliente.prioridad || 'Normal',
      ventanaIni: cliente.ventana_entrega_ini,
      ventanaFin: cliente.ventana_entrega_fin,
    }));
  return JSON.stringify(orden);
}
