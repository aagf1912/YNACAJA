import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { formatNumber } from '../utils/format';
import { ModalTasa } from './ModalTasa';

interface Props {
  tasaDia: number;
  onActualizarTasa: (nuevaTasa: number) => Promise<void>;
}

export const Header: React.FC<Props> = ({ tasaDia, onActualizarTasa }) => {
  const [modalAbierto, setModalAbierto] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#2C474E] text-white shadow-sm border-b border-[#23393e] safe-top">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Izquierda: Logo + Nombre */}
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.svg"
              alt="YnaCaja Logo"
              className="w-8 h-8 rounded-md shrink-0"
            />
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight leading-none text-white">
                YnaCaja
              </span>
              <span className="text-[10px] text-[#86EFAC] font-medium tracking-wider uppercase leading-tight mt-0.5">
                Chicha Adictiva
              </span>
            </div>
          </div>

          {/* Derecha: Selector compacto de Tasa Bs/$ */}
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#23393e] hover:bg-[#1b2c30] active:bg-[#152326] border border-[#3d5e67] rounded text-xs font-semibold text-white transition-colors"
            title="Presiona para actualizar la tasa del día"
          >
            <span className="text-zinc-300 font-normal">Tasa:</span>
            <span className="text-[#86EFAC] font-bold tabular-nums">
              {formatNumber(tasaDia)} Bs/$
            </span>
            <Pencil size={12} className="text-zinc-400 ml-0.5" />
          </button>
        </div>
      </header>

      {/* Modal para editar la tasa */}
      <ModalTasa
        isOpen={modalAbierto}
        tasaActual={tasaDia}
        onClose={() => setModalAbierto(false)}
        onGuardar={onActualizarTasa}
      />
    </>
  );
};
