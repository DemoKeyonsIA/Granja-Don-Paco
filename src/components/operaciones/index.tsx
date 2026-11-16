import React, { useState, useEffect, useCallback } from 'react';
import { User } from '../../types';
import BodegaAdmin, { type VistaBodega } from './BodegaAdmin';
import { BloqueCarga } from '../Spinner';
import { sessionHeaders } from '../../lib/session';

interface Props {
  currentUser: User;
  /**
   * La vista de Bodega y el sub-tab activo viajan como props desde el shell.
   *
   * Este componente solo carga el inventario y sus movimientos, que son los dos
   * datos que la vista de Control necesita para el cuadre. Elegir la vista sigue
   * siendo del shell: si se decidiera aquí, el breadcrumb del hub no podría
   * nombrarla.
   */
  vista: VistaBodega;
  onVista: (vista: VistaBodega) => void;
}

export default function OperacionesAdmin({ currentUser, vista, onVista }: Props) {
  const [inventario, setInventario] = useState<any[]>([]);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [resInv, resMov] = await Promise.all([
        fetch('/api/inventario', { headers: sessionHeaders(currentUser.id) }),
        fetch('/api/inventario/movimientos', { headers: sessionHeaders(currentUser.id) }),
      ]);
      if (resInv.ok) setInventario(await resInv.json());
      if (resMov.ok) setMovimientos(await resMov.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (isLoading) {
    return (
      <BloqueCarga className="min-h-[30vh]" />
    );
  }

  return (
    <div className="animate-in fade-in">
      <BodegaAdmin currentUser={currentUser} inventario={inventario} movimientos={movimientos} onRefresh={fetchData} vista={vista} onVista={onVista} />
    </div>
  );
}
