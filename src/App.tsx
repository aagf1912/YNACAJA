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
import { getVenezuelaDate } from './utils/parserLocal';
import { obtenerTasaBCVOficial } from './lib/bcv';
import { Loader2, CheckCircle2 } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('registrar');
  const [tasaDia, setTasaDia] = useState<number>(100.0);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [puestos, setPuestos] = useState<Puesto[]>([]);
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [cargandoAuth, setCargandoAuth] = useState<boolean>(true);
  const [cargandoDatos, setCargandoDatos] = useState<boolean>(false);
  const [modalPuestosAbierto, setModalPuestosAbierto] = useState<boolean>(false);
  const [sincronizandoBCV, setSincronizandoBCV] = useState<boolean>(false);
  const [toastTasa, setToastTasa] = useState<string | null>(null);

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
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        // Envolver en setTimeout 0 para no ejecutar await de consultas directamente dentro del callback y evitar bloquear el lock interno de Supabase
        setTimeout(async () => {
          if (session?.user) {
            try {
              const perf = await getPerfilUsuario(session.user.id);
              setPerfil(perf);
            } catch (err) {
              console.warn('Error cargando perfil en onAuthStateChange:', err);
            }
          } else {
            setPerfil(null);
          }
        }, 0);
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

      let tasaFinal = cfg?.tasa_dia ? Number(cfg.tasa_dia) : 100.0;

      // Sincronización automática con BCV si la fecha guardada es anterior a hoy (UTC-4)
      const fechaHoyVzla = getVenezuelaDate();
      let fechaCfgVzla = '';
      if (cfg?.updated_at) {
        try {
          const d = new Date(cfg.updated_at);
          const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Caracas',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          });
          fechaCfgVzla = formatter.format(d);
        } catch {}
      }

      if (!fechaCfgVzla || fechaCfgVzla < fechaHoyVzla) {
        try {
          const tasaBcv = await obtenerTasaBCVOficial();
          if (tasaBcv > 0 && tasaBcv !== tasaFinal) {
            const updated = await updateTasaDia(tasaBcv);
            tasaFinal = Number(updated.tasa_dia);
            console.log(`✓ Tasa BCV sincronizada automáticamente a hoy (${fechaHoyVzla}): ${tasaBcv} Bs/$`);
          }
        } catch (e) {
          console.warn('Aviso sincronizando tasa BCV automática al inicio:', e);
        }
      }

      setTasaDia(tasaFinal);
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

  // Suscripción en tiempo real a cambios en la tabla movimientos
  useEffect(() => {
    const client = supabase;
    if (!client || !perfil) return;

    const channel = client
      .channel('realtime-movimientos-global')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'movimientos' },
        () => {
          cargarDatos();
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [perfil, cargarDatos]);

  // Manejo de actualización de tasa
  const handleActualizarTasa = async (nuevaTasa: number) => {
    const updated = await updateTasaDia(nuevaTasa);
    setTasaDia(Number(updated.tasa_dia));
  };

  // Sincronización manual bajo demanda desde el botón "↻ BCV"
  const handleSincronizarBCV = async () => {
    if (sincronizandoBCV) return;
    setSincronizandoBCV(true);
    try {
      const nuevaTasa = await obtenerTasaBCVOficial();
      if (nuevaTasa > 0) {
        await handleActualizarTasa(nuevaTasa);
        setToastTasa(`✓ Tasa BCV actualizada a ${nuevaTasa} Bs/$`);
        setTimeout(() => setToastTasa(null), 3500);
      }
    } catch (err: any) {
      alert(err?.message || 'Error al obtener la tasa oficial del BCV.');
    } finally {
      setSincronizandoBCV(false);
    }
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

  // Cerrar Modal Puestos
  const handleCerrarModalPuestos = useCallback(() => {
    setModalPuestosAbierto(false);
  }, []);

  // Actualización de puestos desde el modal
  const handlePuestosActualizados = useCallback((actualizados: Puesto[]) => {
    setPuestos(actualizados);
  }, []);

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
      {/* Toast Flotante de confirmación de Tasa */}
      {toastTasa && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#166534] text-white px-4 py-2 rounded-xl shadow-lg border border-[#86EFAC]/30 flex items-center gap-2 animate-bounce">
          <CheckCircle2 size={16} className="text-[#86EFAC]" />
          <span className="text-xs sm:text-sm font-bold">{toastTasa}</span>
        </div>
      )}

      {/* Header Fijo */}
      <Header
        tasaDia={tasaDia}
        onActualizarTasa={handleActualizarTasa}
        onSincronizarBCV={handleSincronizarBCV}
        sincronizandoBCV={sincronizandoBCV}
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
              <BalanceView
                movimientos={movimientos}
                puestos={puestos}
                tasaActual={tasaDia}
                onGuardarMovimientos={handleGuardarMovimientos}
              />
            )}
          </>
        )}
      </main>

      {/* Navegación Inferior Fija (Solo para Admin; Vendedor tiene vista única dedicada) */}
      {!esVendedor && <Navigation activeTab={activeTab} onSelectTab={setActiveTab} />}

      {/* Modal para Gestión de Puestos de Venta (Solo Admin) */}
      {!esVendedor && modalPuestosAbierto && (
        <ModalGestionPuestos
          isOpen={modalPuestosAbierto}
          puestos={puestos}
          onClose={handleCerrarModalPuestos}
          onPuestosActualizados={handlePuestosActualizados}
        />
      )}
    </div>
  );
};

export default App;
