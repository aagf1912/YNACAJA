import React, { useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Store,
  DollarSign,
  TrendingUp,
  TrendingDown,
  User,
  CheckCircle2,
  BarChart3,
} from 'lucide-react';
import { Movimiento, Puesto } from '../types';
import { calcularMontos, formatNumber, formatUSD, formatVES } from '../utils/format';

interface Props {
  fechaMes: Date;
  onMesChange: (nuevaFecha: Date) => void;
  movimientos: Movimiento[];
  filtroPuesto: string;
  onFiltroPuestoChange: (puestoId: string) => void;
  puestos: Puesto[];
  tasaActual: number;
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export const ResumenMensualView: React.FC<Props> = ({
  fechaMes,
  onMesChange,
  movimientos,
  filtroPuesto,
  onFiltroPuestoChange,
  puestos,
  tasaActual,
}) => {
  const mesIndex = fechaMes.getMonth();
  const anoSeleccionado = fechaMes.getFullYear();
  const mesNombre = MESES[mesIndex];
  const mesTexto = `${mesNombre} ${anoSeleccionado}`;

  const anteriorMes = () => {
    onMesChange(new Date(anoSeleccionado, mesIndex - 1, 1));
  };

  const siguienteMes = () => {
    onMesChange(new Date(anoSeleccionado, mesIndex + 1, 1));
  };

  // Nombre del puesto actualmente filtrado
  const nombreFiltroPuesto = useMemo(() => {
    if (filtroPuesto === 'todos') return 'Todos los puestos (Consolidado)';
    const match = puestos.find((p) => p.id === filtroPuesto);
    return match ? match.nombre : 'Puesto seleccionado';
  }, [filtroPuesto, puestos]);

  // Movimientos del mes seleccionado
  const prefijoMes = `${anoSeleccionado}-${String(mesIndex + 1).padStart(2, '0')}`;

  const movimientosMes = useMemo(() => {
    return movimientos.filter((m) => m.fecha && m.fecha.startsWith(prefijoMes));
  }, [movimientos, prefijoMes]);

  const movimientosMesFiltrados = useMemo(() => {
    if (filtroPuesto === 'todos') return movimientosMes;
    return movimientosMes.filter((m) => m.puesto_id === filtroPuesto);
  }, [movimientosMes, filtroPuesto]);

  // 4 KPIs del Mes Seleccionado
  const kpisMes = useMemo(() => {
    let ingUSD = 0;
    let ingBs = 0;
    let gasOperativosUSD = 0;
    let gasOperativosBs = 0;
    let retirosUSD = 0;
    let retirosBs = 0;

    for (const m of movimientosMesFiltrados) {
      const { monto_usd, monto_bs } = calcularMontos(m);
      if (m.tipo === 'venta' || m.tipo === 'ingreso') {
        ingUSD += monto_usd;
        ingBs += monto_bs;
      } else {
        if (m.naturaleza === 'Personal') {
          retirosUSD += monto_usd;
          retirosBs += monto_bs;
        } else {
          // Negocio / Gastos / Materia Prima
          gasOperativosUSD += monto_usd;
          gasOperativosBs += monto_bs;
        }
      }
    }

    const gananciaNetaUSD = ingUSD - (gasOperativosUSD + retirosUSD);
    const gananciaNetaBs = ingBs - (gasOperativosBs + retirosBs);

    return {
      ingresosUSD: ingUSD,
      ingresosBs: ingBs,
      gastosOperativosUSD: gasOperativosUSD,
      gastosOperativosBs: gasOperativosBs,
      retirosUSD,
      retirosBs,
      gananciaNetaUSD,
      gananciaNetaBs,
    };
  }, [movimientosMesFiltrados]);

  // Resumen Anual Enero - Diciembre para el año seleccionado
  const resumenAnual = useMemo(() => {
    const filteredBase =
      filtroPuesto === 'todos'
        ? movimientos
        : movimientos.filter((m) => m.puesto_id === filtroPuesto);

    const fechaHoy = new Date();
    const anoHoy = fechaHoy.getFullYear();
    const mesHoyIdx = fechaHoy.getMonth();

    const mesesData = MESES.map((nombre, i) => {
      const prefijo = `${anoSeleccionado}-${String(i + 1).padStart(2, '0')}`;
      const movsDelMes = filteredBase.filter((m) => m.fecha && m.fecha.startsWith(prefijo));

      let ingUSD = 0;
      let gasUSD = 0;
      let retUSD = 0;

      for (const m of movsDelMes) {
        const { monto_usd } = calcularMontos(m);
        if (m.tipo === 'venta' || m.tipo === 'ingreso') {
          ingUSD += monto_usd;
        } else {
          if (m.naturaleza === 'Personal') {
            retUSD += monto_usd;
          } else {
            gasUSD += monto_usd;
          }
        }
      }

      const balanceNetoUSD = ingUSD - (gasUSD + retUSD);

      return {
        mesIndex: i,
        nombre,
        ingresosUSD: ingUSD,
        gastosUSD: gasUSD,
        retirosUSD: retUSD,
        balanceNetoUSD,
        totalMovs: movsDelMes.length,
        esMesSeleccionado: i === mesIndex,
        esMesActual: anoHoy === anoSeleccionado && mesHoyIdx === i,
      };
    });

    const totalAnual = mesesData.reduce(
      (acc, cur) => {
        acc.ingresosUSD += cur.ingresosUSD;
        acc.gastosUSD += cur.gastosUSD;
        acc.retirosUSD += cur.retirosUSD;
        acc.balanceNetoUSD += cur.balanceNetoUSD;
        return acc;
      },
      { ingresosUSD: 0, gastosUSD: 0, retirosUSD: 0, balanceNetoUSD: 0 }
    );

    return {
      meses: mesesData,
      totalAnual,
    };
  }, [movimientos, filtroPuesto, anoSeleccionado, mesIndex]);

  return (
    <div className="space-y-4">
      {/* 1. Selector de Filtro por Puesto */}
      {puestos.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-[11px] font-bold text-[#52525B] flex items-center gap-1 shrink-0">
            <Store size={13} className="text-[#2C474E]" />
            Ver puesto:
          </span>
          <button
            type="button"
            onClick={() => onFiltroPuestoChange('todos')}
            className={`px-3 py-1 text-xs rounded-full font-bold transition-colors shrink-0 ${
              filtroPuesto === 'todos'
                ? 'bg-[#2C474E] text-white shadow-xs'
                : 'bg-white border border-[#E4E4E7] text-[#52525B] hover:bg-zinc-100'
            }`}
          >
            Todos los puestos (Consolidado)
          </button>
          {puestos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onFiltroPuestoChange(p.id)}
              className={`px-3 py-1 text-xs rounded-full font-bold transition-colors shrink-0 ${
                filtroPuesto === p.id
                  ? 'bg-[#2C474E] text-white shadow-xs'
                  : 'bg-white border border-[#E4E4E7] text-[#52525B] hover:bg-zinc-100'
              }`}
            >
              {p.nombre}
            </button>
          ))}
        </div>
      )}

      {/* 2. Barra de Navegación Mensual */}
      <div className="bg-white border border-[#E4E4E7] rounded-lg p-2.5 flex items-center justify-between shadow-xs">
        <button
          type="button"
          onClick={anteriorMes}
          className="min-h-[40px] px-2.5 py-1.5 flex items-center gap-1 text-xs font-semibold text-[#2C474E] hover:bg-zinc-100 rounded active:bg-zinc-200"
        >
          <ChevronLeft size={16} />
          <span className="hidden sm:inline">Mes anterior</span>
        </button>

        <div className="flex items-center gap-2 text-center">
          <Calendar size={16} className="text-[#2C474E] shrink-0" />
          <span className="text-xs sm:text-sm font-bold tracking-wider text-[#18181B] uppercase tabular-nums">
            {mesTexto}
          </span>
        </div>

        <button
          type="button"
          onClick={siguienteMes}
          className="min-h-[40px] px-2.5 py-1.5 flex items-center gap-1 text-xs font-semibold text-[#2C474E] hover:bg-zinc-100 rounded active:bg-zinc-200"
        >
          <span className="hidden sm:inline">Mes siguiente</span>
          <ChevronRight size={16} />
        </button>
      </div>

      {/* 3. Subtítulo Corporativo */}
      <div className="bg-[#2C474E] text-white px-4 py-2.5 rounded-lg flex items-center justify-between shadow-xs">
        <div className="flex flex-col">
          <span className="text-xs sm:text-sm font-bold uppercase tracking-wider">
            BALANCE MENSUAL — CHICHA ADICTIVA
          </span>
          <span className="text-[11px] text-[#86EFAC] font-medium uppercase tracking-wide tabular-nums">
            {mesTexto} • {nombreFiltroPuesto}
          </span>
        </div>
      </div>

      {/* 4. Tarjetas KPI del Mes Seleccionado */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* Ingresos del Mes */}
        <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-3 text-center shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-center gap-1 text-[#166534] mb-1">
              <TrendingUp size={14} />
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                Ingresos Mes ($)
              </span>
            </div>
            <span className="block text-base sm:text-xl font-black text-[#166534] tabular-nums">
              {formatUSD(kpisMes.ingresosUSD)}
            </span>
          </div>
          <span className="block text-[11px] text-[#166534] opacity-80 tabular-nums font-semibold mt-1">
            {formatVES(kpisMes.ingresosBs)}
          </span>
        </div>

        {/* Gastos Operativos (Negocio) */}
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-3 text-center shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-center gap-1 text-[#991B1B] mb-1">
              <TrendingDown size={14} />
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                Gastos Operativos
              </span>
            </div>
            <span className="block text-base sm:text-xl font-black text-[#991B1B] tabular-nums">
              {formatUSD(kpisMes.gastosOperativosUSD)}
            </span>
          </div>
          <span className="block text-[11px] text-[#991B1B] opacity-80 tabular-nums font-semibold mt-1">
            {formatVES(kpisMes.gastosOperativosBs)}
          </span>
        </div>

        {/* Retiros Personales */}
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-3 text-center shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-center gap-1 text-[#92400E] mb-1">
              <User size={14} />
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                Retiros Personales
              </span>
            </div>
            <span className="block text-base sm:text-xl font-black text-[#92400E] tabular-nums">
              {formatUSD(kpisMes.retirosUSD)}
            </span>
          </div>
          <span className="block text-[11px] text-[#92400E] opacity-80 tabular-nums font-semibold mt-1">
            {formatVES(kpisMes.retirosBs)}
          </span>
        </div>

        {/* Ganancia Neta del Mes */}
        <div
          className={`rounded-xl p-3 text-center shadow-xs border flex flex-col justify-between ${
            kpisMes.gananciaNetaUSD >= 0
              ? 'bg-[#F0FDF4] border-[#86EFAC]'
              : 'bg-[#FFF1F2] border-[#FDA4AF]'
          }`}
        >
          <div>
            <div className="flex items-center justify-center gap-1 mb-1 text-[#18181B]">
              <DollarSign size={14} />
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                Ganancia Neta ($)
              </span>
            </div>
            <span
              className={`block text-base sm:text-xl font-black tabular-nums ${
                kpisMes.gananciaNetaUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
              }`}
            >
              {kpisMes.gananciaNetaUSD >= 0 ? '+' : ''}
              {formatUSD(kpisMes.gananciaNetaUSD)}
            </span>
          </div>
          <span
            className={`block text-[11px] font-semibold tabular-nums mt-1 ${
              kpisMes.gananciaNetaUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
            }`}
          >
            {kpisMes.gananciaNetaBs >= 0 ? '+' : ''}
            {formatVES(kpisMes.gananciaNetaBs)}
          </span>
        </div>
      </div>

      {/* 5. Tabla: Resumen Anual (Enero - Diciembre) */}
      <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-xs">
        <div className="bg-[#2C474E] text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-[#86EFAC]" />
            <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider">
              Resumen Anual {anoSeleccionado} (Enero — Diciembre)
            </h3>
          </div>
          <span className="text-[11px] text-[#86EFAC] font-semibold">
            Haz clic en un mes para seleccionarlo
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-[#FAFAFA] border-b border-[#E4E4E7] text-[#52525B] font-bold">
              <tr>
                <th className="py-2.5 px-3">Mes</th>
                <th className="py-2.5 px-3 text-right">Ingresos ($)</th>
                <th className="py-2.5 px-3 text-right">Gastos Operativos ($)</th>
                <th className="py-2.5 px-3 text-right">Retiros Personales ($)</th>
                <th className="py-2.5 px-3 text-right">Balance Neto ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E4E7]">
              {resumenAnual.meses.map((m) => {
                const esSeleccionado = m.esMesSeleccionado;
                return (
                  <tr
                    key={m.nombre}
                    onClick={() => onMesChange(new Date(anoSeleccionado, m.mesIndex, 1))}
                    className={`transition-colors cursor-pointer ${
                      esSeleccionado
                        ? 'bg-[#ECFDF5] font-bold text-[#166534] border-l-4 border-l-[#166534]'
                        : 'hover:bg-zinc-50 text-[#18181B]'
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{m.nombre}</span>
                        {esSeleccionado && (
                          <span className="text-[10px] bg-[#BBF7D0] text-[#166534] px-1.5 py-0.2 rounded font-bold">
                            Activo
                          </span>
                        )}
                        {m.esMesActual && !esSeleccionado && (
                          <span className="text-[10px] bg-zinc-200 text-zinc-700 px-1.5 py-0.2 rounded">
                            Actual
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#166534]">
                      {m.ingresosUSD > 0 ? formatUSD(m.ingresosUSD) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#991B1B]">
                      {m.gastosUSD > 0 ? formatUSD(m.gastosUSD) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#92400E]">
                      {m.retirosUSD > 0 ? formatUSD(m.retirosUSD) : '—'}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right tabular-nums font-bold ${
                        m.balanceNetoUSD > 0
                          ? 'text-[#166534]'
                          : m.balanceNetoUSD < 0
                          ? 'text-[#991B1B]'
                          : 'text-zinc-400'
                      }`}
                    >
                      {m.ingresosUSD === 0 && m.gastosUSD === 0 && m.retirosUSD === 0
                        ? '—'
                        : `${m.balanceNetoUSD >= 0 ? '+' : ''}${formatUSD(m.balanceNetoUSD)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Fila Total Anual */}
            <tfoot className="bg-[#2C474E] text-white font-bold border-t-2 border-[#18181B]">
              <tr>
                <td className="py-3 px-3 uppercase tracking-wider text-xs">
                  Total Anual {anoSeleccionado}
                </td>
                <td className="py-3 px-3 text-right tabular-nums text-[#86EFAC]">
                  {formatUSD(resumenAnual.totalAnual.ingresosUSD)}
                </td>
                <td className="py-3 px-3 text-right tabular-nums text-[#FCA5A5]">
                  {formatUSD(resumenAnual.totalAnual.gastosUSD)}
                </td>
                <td className="py-3 px-3 text-right tabular-nums text-[#FCD34D]">
                  {formatUSD(resumenAnual.totalAnual.retirosUSD)}
                </td>
                <td
                  className={`py-3 px-3 text-right tabular-nums text-sm font-black ${
                    resumenAnual.totalAnual.balanceNetoUSD >= 0 ? 'text-[#86EFAC]' : 'text-[#FCA5A5]'
                  }`}
                >
                  {resumenAnual.totalAnual.balanceNetoUSD >= 0 ? '+' : ''}
                  {formatUSD(resumenAnual.totalAnual.balanceNetoUSD)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
