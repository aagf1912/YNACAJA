import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Navigation, TabKey } from './components/Navigation';
import { RegistrarView } from './views/RegistrarView';
import { MovimientosView } from './views/MovimientosView';
import { BalanceView } from './views/BalanceView';
import { VendedorView } from './views/VendedorView';
import { LoginView } from './views/LoginView';
import { ModalGestionPuestos } from './components/ModalGestionPuestos';
import { Movimiento, PerfilUsuario, Puesto } from './types';
import {
  getConfigNegocio,
  getMovimientos,
  insertMovimientos,
  updateMovimiento,
  deleteMovimiento,
  updateTasaDia,
  getPuestos,
  getPerfilUsuario,
  signOutUsuario,
  supabase,
} from './services/supabase';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('registrar');
  const [tasaDia, setTasaDia] = useState<number>(100.0);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [puestos, setPuestos] = useState<Puesto[]>([]);
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [cargandoAuth, setCargandoAuth] = useState<boolean>(true);
  const [cargandoDatos, setCargandoDatos] = useState<boolean>(false);
  const [modalPuestosAbierto, setModalPuestosAbierto] = useState<boolean>(false);

  // 1. Cargar Sesión y Perfil
  const verificarSesion = useCallback(async () => {
    setCargandoAuth(true);
    if (!supabase) {
      // Si no hay Supabase configurado, usar perfil admin de respaldo
      setPerfil({
        id: 'admin-local',
        nombre: 'Admin Local',
        rol: 'admin',
        puesto_id: null,
      });
      setCargandoAuth(false);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const perf = await getPerfilUsuario(session.user.id);
        setPerfil(perf);
      } else {
        setPerfil(null);
      }
    } catch (err) {
      console.warn('Error verificando sesión:', err);
      setPerfil(null);
    } finally {
      setCargandoAuth(false);
    }
  }, []);

  useEffect(() => {
    verificarSesion();

    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          const perf = await getPerfilUsuario(session.user.id);
          setPerfil(perf);
        } else {
          setPerfil(null);
        }
      });

      return () => {
        subscription.unsubscribe();
      };
    }
  }, [verificarSesion]);

  // 2. Carga de datos contables y puestos una vez autenticado
  const cargarDatos = useCallback(async () => {
    if (!perfil) return;
    setCargandoDatos(true);
    try {
      const [cfg, pts, movs] = await Promise.all([
        getConfigNegocio(),
        getPuestos(),
        getMovimientos(perfil.rol, perfil.puesto_id),
      ]);

      if (cfg?.tasa_dia) {
        setTasaDia(Number(cfg.tasa_dia));
      }
      setPuestos(pts);
      setMovimientos(movs);
    } catch (err) {
      console.warn('Error cargando datos contables:', err);
    } finally {
      setCargandoDatos(false);
    }
  }, [perfil]);

  useEffect(() => {
    if (perfil) {
      cargarDatos();
    }
  }, [perfil, cargarDatos]);

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

  // Cerrar Sesión
  const handleCerrarSesion = async () => {
    if (window.confirm('¿Deseas cerrar tu sesión?')) {
      await signOutUsuario();
      setPerfil(null);
      setMovimientos([]);
    }
  };

  // Pantalla de carga mientras se verifica auth
  if (cargandoAuth) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F4F5] text-[#52525B] gap-3">
        <Loader2 size={36} className="animate-spin text-[#2C474E]" />
        <span className="text-xs font-bold tracking-tight">Iniciando YnaCaja...</span>
      </div>
    );
  }

  // Si no está autenticado, mostrar pantalla de Login
  if (!perfil) {
    return <LoginView onLoginSuccess={verificarSesion} />;
  }

  const esVendedor = perfil.rol === 'vendedor';

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F4F5] text-[#18181B]">
      {/* Header Fijo */}
      <Header
        tasaDia={tasaDia}
        onActualizarTasa={handleActualizarTasa}
        perfil={perfil}
        onCerrarSesion={handleCerrarSesion}
        onAbrirGestionPuestos={() => setModalPuestosAbierto(true)}
      />

      {/* Contenido Principal */}
      <main className="flex-1 w-full">
        {cargandoDatos ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-[#52525B]">
            <Loader2 size={32} className="animate-spin text-[#2C474E]" />
            <span className="text-xs font-semibold">Cargando datos contables...</span>
          </div>
        ) : esVendedor ? (
          /* VISTA DEL VENDEDOR (Simplificada, solo ventas de hoy, comisión 22%) */
          <VendedorView
            perfil={perfil}
            tasaDia={tasaDia}
            movimientos={movimientos}
            onGuardarMovimientos={handleGuardarMovimientos}
            onActualizarMovimiento={handleActualizarMovimiento}
            onEliminarMovimiento={handleEliminarMovimiento}
          />
        ) : (
          /* VISTA DEL ADMINISTRADOR (YNAIDES: Pestañas Registrar, Movimientos, Balance) */
          <>
            {activeTab === 'registrar' && (
              <RegistrarView
                tasaDia={tasaDia}
                puestos={puestos}
                onGuardarMovimientos={handleGuardarMovimientos}
                onActualizarMovimiento={handleActualizarMovimiento}
                onEliminarMovimiento={handleEliminarMovimiento}
              />
            )}

            {activeTab === 'movimientos' && (
              <MovimientosView
                movimientos={movimientos}
                tasaDia={tasaDia}
                puestos={puestos}
                onActualizarMovimiento={handleActualizarMovimiento}
                onEliminarMovimiento={handleEliminarMovimiento}
                onCrearMovimiento={handleCrearUnico}
              />
            )}

            {activeTab === 'balance' && (
              <BalanceView movimientos={movimientos} puestos={puestos} />
            )}
          </>
        )}
      </main>

      {/* Navegación Inferior Fija (Solo para Admin; Vendedor tiene vista única dedicada) */}
      {!esVendedor && <Navigation activeTab={activeTab} onSelectTab={setActiveTab} />}

      {/* Modal para Gestión de Puestos de Venta (Solo Admin) */}
      {!esVendedor && (
        <ModalGestionPuestos
          isOpen={modalPuestosAbierto}
          puestos={puestos}
          onClose={() => setModalPuestosAbierto(false)}
          onPuestosActualizados={(actualizados) => setPuestos(actualizados)}
        />
      )}
    </div>
  );
};

export default App;
