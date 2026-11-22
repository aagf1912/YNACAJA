import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Navigation, TabKey } from './components/Navigation';
import { RegistrarView } from './views/RegistrarView';
import { MovimientosView } from './views/MovimientosView';
import { BalanceView } from './views/BalanceView';
import { Movimiento } from './types';
import {
  getConfigNegocio,
  getMovimientos,
  insertMovimientos,
  updateMovimiento,
  deleteMovimiento,
  updateTasaDia,
} from './services/supabase';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('registrar');
  const [tasaDia, setTasaDia] = useState<number>(100.0);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargandoInicial, setCargandoInicial] = useState<boolean>(true);

  // Carga inicial de datos
  const cargarDatos = useCallback(async () => {
    try {
      const [cfg, movs] = await Promise.all([getConfigNegocio(), getMovimientos()]);
      if (cfg?.tasa_dia) {
        setTasaDia(Number(cfg.tasa_dia));
      }
      setMovimientos(movs);
    } catch (err) {
      console.warn('Error cargando datos iniciales:', err);
    } finally {
      setCargandoInicial(false);
    }
  }, []);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Manejo de actualización de tasa
  const handleActualizarTasa = async (nuevaTasa: number) => {
    const updated = await updateTasaDia(nuevaTasa);
    setTasaDia(Number(updated.tasa_dia));
  };

  // Manejo de inserción de movimientos
  const handleGuardarMovimientos = async (
    movs: Omit<Movimiento, 'id' | 'created_at'>[]
  ): Promise<Movimiento[]> => {
    const guardados = await insertMovimientos(movs);
    setMovimientos((prev) => [...guardados, ...prev]);
    return guardados;
  };

  // Manejo de actualización de un movimiento
  const handleActualizarMovimiento = async (mov: Movimiento) => {
    const updated = await updateMovimiento(mov);
    setMovimientos((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  // Manejo de eliminación
  const handleEliminarMovimiento = async (id: string) => {
    await deleteMovimiento(id);
    setMovimientos((prev) => prev.filter((m) => m.id !== id));
  };

  // Carga individual
  const handleCrearUnico = async (
    mov: Omit<Movimiento, 'id' | 'created_at'>
  ): Promise<Movimiento[]> => {
    return handleGuardarMovimientos([mov]);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F4F5] text-[#18181B]">
      {/* Header Fijo */}
      <Header tasaDia={tasaDia} onActualizarTasa={handleActualizarTasa} />

      {/* Contenido Principal */}
      <main className="flex-1 w-full">
        {cargandoInicial ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-[#52525B]">
            <Loader2 size={32} className="animate-spin text-[#2C474E]" />
            <span className="text-xs font-semibold">Cargando datos contables...</span>
          </div>
        ) : (
          <>
            {activeTab === 'registrar' && (
              <RegistrarView
                tasaDia={tasaDia}
                onGuardarMovimientos={handleGuardarMovimientos}
                onActualizarMovimiento={handleActualizarMovimiento}
                onEliminarMovimiento={handleEliminarMovimiento}
              />
            )}

            {activeTab === 'movimientos' && (
              <MovimientosView
                movimientos={movimientos}
                tasaDia={tasaDia}
                onActualizarMovimiento={handleActualizarMovimiento}
                onEliminarMovimiento={handleEliminarMovimiento}
                onCrearMovimiento={handleCrearUnico}
              />
            )}

            {activeTab === 'balance' && (
              <BalanceView movimientos={movimientos} />
            )}
          </>
        )}
      </main>

      {/* Navegación Inferior Fija */}
      <Navigation activeTab={activeTab} onSelectTab={setActiveTab} />
    </div>
  );
};

export default App;
