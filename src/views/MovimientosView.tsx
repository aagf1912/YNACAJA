import React, { useState, useMemo } from 'react';
import { Search, Pencil, Trash2, Calendar, Plus } from 'lucide-react';
import { Movimiento } from '../types';
import { BadgeNaturaleza } from '../components/BadgeNaturaleza';
import { calcularMontos, formatMontoMovimiento, formatUSD } from '../utils/format';
import { METODOS_PAGO_LABELS } from '../types';
import { ModalMovimiento } from '../components/ModalMovimiento';

interface Props {
  movimientos: Movimiento[];
  tasaDia: number;
  onActualizarMovimiento: (mov: Movimiento) => Promise<void>;
  onEliminarMovimiento: (id: string) => Promise<void>;
  onCrearMovimiento: (mov: Omit<Movimiento, 'id' | 'created_at'>) => Promise<Movimiento[]>;
}

type FiltroTipo = 'todos' | 'ventas' | 'negocio' | 'personal' | 'creditos';

export const MovimientosView: React.FC<Props> = ({
  movimientos,
  tasaDia,
  onActualizarMovimiento,
  onEliminarMovimiento,
  onCrearMovimiento,
}) => {
  const [filtro, setFiltro] = useState<FiltroTipo>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [movimientoParaEditar, setMovimientoParaEditar] = useState<Movimiento | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  // Filtrado
  const movimientosFiltrados = useMemo(() => {
    return movimientos.filter((m) => {
      // Filtro tipo / naturaleza
      if (filtro === 'ventas' && m.tipo !== 'venta') return false;
      if (filtro === 'negocio' && (m.tipo !== 'gasto' || m.naturaleza !== 'Negocio')) return false;
      if (filtro === 'personal' && (m.tipo !== 'gasto' || m.naturaleza !== 'Personal')) return false;
      if (filtro === 'creditos' && (m.tipo !== 'gasto' || m.naturaleza !== 'Créditos / Otros')) return false;

      // Búsqueda por texto
      if (busqueda.trim()) {
        const query = busqueda.toLowerCase();
        const matchDesc = m.descripcion.toLowerCase().includes(query);
        const matchCat = m.categoria.toLowerCase().includes(query);
        const matchMetodo = (METODOS_PAGO_LABELS[m.metodo_pago] || '').toLowerCase().includes(query);
        if (!matchDesc && !matchCat && !matchMetodo) return false;
      }

      return true;
    });
  }, [movimientos, filtro, busqueda]);

  // Agrupamiento cronológico por fecha (descendente)
  const gruposPorFecha = useMemo(() => {
    const grupos: Record<string, Movimiento[]> = {};
    for (const m of movimientosFiltrados) {
      if (!grupos[m.fecha]) {
        grupos[m.fecha] = [];
      }
      grupos[m.fecha].push(m);
    }

    // Ordenar fechas descendente
    const fechasOrdenadas = Object.keys(grupos).sort((a, b) => b.localeCompare(a));

    return fechasOrdenadas.map((fecha) => {
      const items = grupos[fecha];
      let totalIngresosUSD = 0;
      let totalGastosUSD = 0;

      for (const item of items) {
        const { monto_usd } = calcularMontos(item);
        if (item.tipo === 'venta') {
          totalIngresosUSD += monto_usd;
        } else {
          totalGastosUSD += monto_usd;
        }
      }

      return {
        fecha,
        items,
        totalIngresosUSD,
        totalGastosUSD,
      };
    });
  }, [movimientosFiltrados]);

  const handleEliminar = async (id: string) => {
    if (window.confirm('¿Deseas eliminar definitivamente este movimiento?')) {
      await onEliminarMovimiento(id);
    }
  };

  const handleGuardarModal = async (mov: Omit<Movimiento, 'id' | 'created_at'> & { id?: string }) => {
    if (mov.id) {
      await onActualizarMovimiento(mov as Movimiento);
    } else {
      await onCrearMovimiento(mov);
    }
  };

  const getNombreDia = (fechaStr: string) => {
    try {
      const [year, month, day] = fechaStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' });
    } catch {
      return fechaStr;
    }
  };

  return (
    <div className="space-y-4 pb-24 pt-2 px-3 sm:px-4 max-w-4xl mx-auto">
      {/* Encabezado de la vista */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-[#18181B] tracking-tight">
            Libro de Movimientos
          </h1>
          <p className="text-xs text-[#52525B]">
            Histórico detallado de ingresos y egresos
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMovimientoParaEditar(null);
            setModalAbierto(true);
          }}
          className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-white bg-[#2C474E] rounded hover:bg-[#23393e] active:bg-[#1a2b2f] min-h-[38px]"
        >
          <Plus size={15} />
          <span>Nuevo</span>
        </button>
      </div>

      {/* Buscador de texto simple */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-3 text-[#52525B]" />
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por descripción, categoría o método..."
          className="w-full pl-9 pr-3 py-2 text-xs border border-[#E4E4E7] rounded bg-white text-[#18181B] focus:outline-none focus:ring-2 focus:ring-[#2C474E]"
        />
      </div>

      {/* Barra de Filtros Compacta */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {(
          [
            { key: 'todos', label: 'Todos' },
            { key: 'ventas', label: 'Ventas' },
            { key: 'negocio', label: 'Negocio' },
            { key: 'personal', label: 'Personal' },
            { key: 'creditos', label: 'Créditos' },
          ] as { key: FiltroTipo; label: string }[]
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFiltro(item.key)}
            className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded border whitespace-nowrap transition-colors ${
              filtro === item.key
                ? 'bg-[#2C474E] text-white border-[#2C474E]'
                : 'bg-white text-[#52525B] border-[#E4E4E7] hover:bg-zinc-50'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Listado de Grupos por Fecha */}
      {gruposPorFecha.length === 0 ? (
        <div className="bg-white border border-[#E4E4E7] rounded-lg p-8 text-center text-xs text-[#52525B]">
          No hay movimientos registrados que coincidan con el filtro seleccionado.
        </div>
      ) : (
        <div className="space-y-3">
          {gruposPorFecha.map((grupo) => (
            <div
              key={grupo.fecha}
              className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs"
            >
              {/* Encabezado del Día */}
              <div className="bg-[#2C474E] text-white px-3.5 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-[#86EFAC]" />
                  <span className="text-xs font-bold capitalize">
                    {getNombreDia(grupo.fecha)}
                  </span>
                  <span className="text-[11px] text-zinc-300 tabular-nums">
                    ({grupo.fecha})
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-bold tabular-nums">
                  <span className="text-[#86EFAC]">
                    +{formatUSD(grupo.totalIngresosUSD)}
                  </span>
                  <span className="text-zinc-400">/</span>
                  <span className="text-red-300">
                    -{formatUSD(grupo.totalGastosUSD)}
                  </span>
                </div>
              </div>

              {/* Filas de Movimientos del Día */}
              <div className="divide-y divide-[#E4E4E7]">
                {grupo.items.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 flex items-center justify-between gap-2 hover:bg-zinc-50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-bold text-[#18181B] truncate">
                          {m.descripcion}
                        </span>
                        <BadgeNaturaleza naturaleza={m.naturaleza} tipo={m.tipo} />
                        <span className="text-[10px] text-[#52525B] bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                          {METODOS_PAGO_LABELS[m.metodo_pago]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#52525B]">
                        <span className="truncate">{m.categoria}</span>
                        <span>•</span>
                        <span className="tabular-nums">Tasa: {m.tasa_aplicada} Bs/$</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <span
                          className={`block text-xs sm:text-sm font-bold tabular-nums ${
                            m.tipo === 'venta' ? 'text-[#166534]' : 'text-[#991B1B]'
                          }`}
                        >
                          {m.tipo === 'venta' ? '+' : '-'} {formatMontoMovimiento(m)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 border-l border-[#E4E4E7] pl-2 ml-1">
                        <button
                          type="button"
                          onClick={() => {
                            setMovimientoParaEditar(m);
                            setModalAbierto(true);
                          }}
                          className="p-1.5 text-[#52525B] hover:text-[#2C474E] hover:bg-zinc-100 rounded"
                          title="Editar"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEliminar(m.id)}
                          className="p-1.5 text-[#52525B] hover:text-[#991B1B] hover:bg-red-50 rounded"
                          title="Eliminar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal para Crear/Editar */}
      <ModalMovimiento
        isOpen={modalAbierto}
        movimientoAEditar={movimientoParaEditar}
        tasaActual={tasaDia}
        onClose={() => {
          setModalAbierto(false);
          setMovimientoParaEditar(null);
        }}
        onGuardar={handleGuardarModal}
      />
    </div>
  );
};
