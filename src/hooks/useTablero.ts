import { useCallback, useEffect, useState } from 'react';
import { sessionHeaders } from '../lib/session';

export interface TableroData {
  fecha: string;
  guias: any[];
}

/**
 * Lectura del tablero vivo de logística (consolidación G4).
 *
 * Antes cada pantalla que necesitaba `/api/logistica/tablero` escribía su propio
 * fetch y su propio intervalo: TableroRutas refrescaba cada 15 s y BodegaAdmin
 * consultaba una sola vez al montar, con lo que sus alertas de custodia se
 * congelaban. Este hook concentra fetch, intervalo y parseo en un solo lugar.
 */
export function useTablero(userId?: string, intervaloMs = 15000) {
  const [data, setData] = useState<TableroData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/logistica/tablero', { headers: userId ? sessionHeaders(userId) : {} });
      if (res.ok) {
        const d = await res.json();
        setData({ fecha: d.fecha, guias: Array.isArray(d.guias) ? d.guias : [] });
        setError(null);
      } else {
        const e = await res.json().catch(() => ({}));
        setError(e.error || 'No se pudo cargar el tablero');
      }
    } catch (e: any) {
      setError(e?.message || 'Error de red al cargar el tablero');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refetch();
    const id = setInterval(() => refetch(true), intervaloMs);
    return () => clearInterval(id);
  }, [refetch, intervaloMs]);

  return {
    data,
    guias: data?.guias ?? [],
    fecha: data?.fecha ?? null,
    loading,
    error,
    refetch,
  };
}
