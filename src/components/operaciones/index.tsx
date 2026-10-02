import React, { useState, useEffect, useCallback } from 'react';
import { User } from '../../types';
import BodegaAdmin, { type VistaBodega } from './BodegaAdmin';

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
        fetch('/api/inventario'),
        fetch('/api/inventario/movimientos'),
      ]);
      if (resInv.ok) setInventario(await resInv.json());
      if (resMov.ok) setMovimientos(await resMov.json());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--brand-primary)', borderTopColor: 'transparent' }}></div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in">
      <BodegaAdmin currentUser={currentUser} inventario={inventario} movimientos={movimientos} onRefresh={fetchData} vista={vista} onVista={onVista} />
    </div>
  );
}