import React, { useState } from 'react';
import { Pencil, LogOut, Store } from 'lucide-react';
import { formatNumber } from '../utils/format';
import { ModalTasa } from './ModalTasa';
import { PerfilUsuario } from '../types';

interface Props {
  tasaDia: number;
  onActualizarTasa: (nuevaTasa: number) => Promise<void>;
  perfil?: PerfilUsuario | null;
  onCerrarSesion: () => void;
  onAbrirGestionPuestos?: () => void;
}

export const Header: React.FC<Props> = ({
  tasaDia,
  onActualizarTasa,
  perfil,
  onCerrarSesion,
  onAbrirGestionPuestos,
}) => {
  const [modalAbierto, setModalAbierto] = useState(false);
  const esVendedor = perfil?.rol === 'vendedor';

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#2C474E] text-white shadow-sm border-b border-[#23393e] safe-top">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          {/* Izquierda: Logo + Nombre del Negocio / Puesto */}
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/logo.svg"
              alt="YnaCaja Logo"
              className="w-8 h-8 rounded-md shrink-0"
            />
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-sm sm:text-base tracking-tight leading-none text-white truncate">
                  YnaCaja
                </span>
                {esVendedor ? (
                  <span className="text-[10px] font-bold bg-[#86EFAC]/20 text-[#86EFAC] border border-[#86EFAC]/30 px-1.5 py-0.5 rounded truncate">
                    {perfil?.puesto?.nombre || 'Vendedor'}
                  </span>
                ) : (
                  <span className="text-[9px] font-bold bg-white/15 text-zinc-200 px-1.5 py-0.5 rounded uppercase tracking-wider">
                    Admin
                  </span>
                )}
              </div>
              <span className="text-[10px] text-[#86EFAC] font-medium tracking-wider uppercase leading-tight mt-0.5 truncate">
                Chicha Adictiva
              </span>
            </div>
          </div>

          {/* Derecha: Acciones (Tasa, Gestionar Puestos, Logout) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Si es vendedor: Tasa en modo SOLO LECTURA */}
            {esVendedor ? (
              <div
                className="flex items-center gap-1 px-2 py-1 bg-[#23393e] border border-[#3d5e67] rounded text-xs font-semibold text-white"
                title="Tasa oficial del día"
              >
                <span className="text-zinc-300 font-normal hidden xs:inline">Tasa:</span>
                <span className="text-[#86EFAC] font-bold tabular-nums">
                  {formatNumber(tasaDia)} Bs/$
                </span>
              </div>
            ) : (
              /* Si es Admin: Tasa editable + Botón Gestionar Puestos */
              <>
                {onAbrirGestionPuestos && (
                  <button
                    type="button"
                    onClick={onAbrirGestionPuestos}
                    className="flex items-center gap-1 px-2 py-1.5 bg-[#23393e] hover:bg-[#1b2c30] active:bg-[#152326] border border-[#3d5e67] rounded text-xs font-semibold text-white transition-colors"
                    title="Gestionar puestos de venta"
                  >
                    <Store size={13} className="text-[#86EFAC]" />
                    <span className="hidden sm:inline">Puestos</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setModalAbierto(true)}
                  className="flex items-center gap-1.5 px-2 py-1.5 bg-[#23393e] hover:bg-[#1b2c30] active:bg-[#152326] border border-[#3d5e67] rounded text-xs font-semibold text-white transition-colors"
                  title="Presiona para actualizar la tasa del día"
                >
                  <span className="text-zinc-300 font-normal hidden xs:inline">Tasa:</span>
                  <span className="text-[#86EFAC] font-bold tabular-nums">
                    {formatNumber(tasaDia)} Bs/$
                  </span>
                  <Pencil size={11} className="text-zinc-400" />
                </button>
              </>
            )}

            {/* Botón discreto de Cerrar Sesión */}
            <button
              type="button"
              onClick={onCerrarSesion}
              className="p-1.5 text-zinc-300 hover:text-white hover:bg-white/10 active:bg-white/15 rounded transition-colors"
              title="Cerrar sesión"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Modal para editar la tasa (solo disponible para admin) */}
      {!esVendedor && (
        <ModalTasa
          isOpen={modalAbierto}
          tasaActual={tasaDia}
          onClose={() => setModalAbierto(false)}
          onGuardar={onActualizarTasa}
        />
      )}
    </>
  );
};
