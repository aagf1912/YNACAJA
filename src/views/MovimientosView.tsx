import React, { useState, useMemo } from 'react';
import {
  Search,
  Pencil,
  Trash2,
  Calendar,
  Plus,
  Store,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Movimiento, Puesto, TipoMovimiento } from '../types';
import { BadgeNaturaleza } from '../components/BadgeNaturaleza';
import { calcularMontos, formatMontoMovimiento, formatUSD, formatVES, formatNumber } from '../utils/format';
import { METODOS_PAGO_LABELS } from '../types';
import { ModalMovimiento } from '../components/ModalMovimiento';
import { ModalCierrePuesto } from '../components/ModalCierrePuesto';
import { supabaseUrl, supabaseAnonKey, getAccessTokenFromStorage } from '../lib/supabase';

interface Props {
  movimientos: Movimiento[];
  tasaDia: number;
  puestos?: Puesto[];
  onActualizarMovimiento: (mov: Movimiento) => Promise<void>;
  onEliminarMovimiento: (id: string) => Promise<void>;
  onCrearMovimiento: (mov: Omit<Movimiento, 'id' | 'created_at'>) => Promise<Movimiento[]>;
}

type FiltroTipo = 'todos' | 'ventas' | 'gastos' | 'personal';

interface GrupoCierreRender {
  tipo: 'cierre';
  key: string; // `${fecha}_${puesto_id}`
  fecha: string;
  puestoId: string;
  puestoNombre: string;
  items: Movimiento[];
  totalUSD: number;
  totalBs: number;
}

interface ItemIndividualRender {
  tipo: 'individual';
  movimiento: Movimiento;
}

type ElementoRender = GrupoCierreRender | ItemIndividualRender;

export const MovimientosView: React.FC<Props> = ({
  movimientos,
  tasaDia,
  puestos = [],
  onActualizarMovimiento,
  onEliminarMovimiento,
  onCrearMovimiento,
}) => {
  const [filtro, setFiltro] = useState<FiltroTipo>('todos');
  const [filtroPuesto, setFiltroPuesto] = useState<string>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [movimientoParaEditar, setMovimientoParaEditar] = useState<Movimiento | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  // Estados para Modal de Cierre de Puesto (Administrador)
  const [modalCierreAbierto, setModalCierreAbierto] = useState<boolean>(false);
  const [cierreParaEditar, setCierreParaEditar] = useState<{ puestoId: string; fecha: string } | null>(null);
  const [cierresExpandidos, setCierresExpandidos] = useState<Record<string, boolean>>({});

  const toggleCierre = (cierreKey: string) => {
    setCierresExpandidos((prev) => ({
      ...prev,
      [cierreKey]: !prev[cierreKey],
    }));
  };

  // Mapa rápido de ID de puesto a Nombre
  const mapaPuestos = useMemo(() => {
    const mapa: Record<string, string> = {};
    puestos.forEach((p) => {
      mapa[p.id] = p.nombre;
    });
    return mapa;
  }, [puestos]);

  // Filtrado
  const movimientosFiltrados = useMemo(() => {
    return movimientos.filter((m) => {
      // Filtro por puesto
      if (filtroPuesto !== 'todos') {
        if (m.puesto_id !== filtroPuesto) return false;
      }

      // Filtro tipo / naturaleza
      if (filtro === 'ventas' && m.tipo !== 'venta' && m.tipo !== 'ingreso') return false;
      if (
        filtro === 'gastos' &&
        ((m.tipo !== 'gasto' && m.tipo !== 'egreso') ||
          (m.naturaleza !== 'Gastos' && m.naturaleza !== 'Negocio' && m.naturaleza !== 'Créditos / Otros'))
      )
        return false;
      if (filtro === 'personal' && ((m.tipo !== 'gasto' && m.tipo !== 'egreso') || m.naturaleza !== 'Personal'))
        return false;

      // Búsqueda por texto
      if (busqueda.trim()) {
        const query = busqueda.toLowerCase();
        const matchDesc = m.descripcion.toLowerCase().includes(query);
        const matchCat = m.categoria.toLowerCase().includes(query);
        const matchMetodo = (METODOS_PAGO_LABELS[m.metodo_pago] || '').toLowerCase().includes(query);
        const matchPuesto = m.puesto_id && mapaPuestos[m.puesto_id]?.toLowerCase().includes(query);
        if (!matchDesc && !matchCat && !matchMetodo && !matchPuesto) return false;
      }

      return true;
    });
  }, [movimientos, filtro, filtroPuesto, busqueda, mapaPuestos]);

  // Agrupamiento cronológico por fecha (descendente) y agrupación de cierres diarios por puesto
  const gruposPorFecha = useMemo(() => {
    const grupos: Record<string, Movimiento[]> = {};
    for (const m of movimientosFiltrados) {
      if (!grupos[m.fecha]) {
        grupos[m.fecha] = [];
      }
      grupos[m.fecha].push(m);
    }

    const fechasOrdenadas = Object.keys(grupos).sort((a, b) => b.localeCompare(a));

    return fechasOrdenadas.map((fecha) => {
      const items = grupos[fecha];
      let totalIngresosUSD = 0;
      let totalGastosUSD = 0;

      for (const item of items) {
        const { monto_usd } = calcularMontos(item);
        if (item.tipo === 'venta' || item.tipo === 'ingreso') {
          totalIngresosUSD += monto_usd;
        } else {
          totalGastosUSD += monto_usd;
        }
      }

      // Agrupar cierres diarios de puestos en una sola tarjeta unificada
      const mapaCierres: Record<string, GrupoCierreRender> = {};
      const ordenCierres: string[] = [];
      const individuales: Movimiento[] = [];

      for (const m of items) {
        const esCierre = m.tipo === 'venta' && Boolean(m.puesto_id) && (m.descripcion || '').startsWith('Cierre ');
        if (esCierre && m.puesto_id) {
          const pId = m.puesto_id;
          if (!mapaCierres[pId]) {
            ordenCierres.push(pId);
            const nombrePuesto = m.puesto?.nombre || mapaPuestos[pId] || 'Puesto';
            mapaCierres[pId] = {
              tipo: 'cierre',
              key: `${fecha}_${pId}`,
              fecha,
              puestoId: pId,
              puestoNombre: nombrePuesto,
              items: [],
              totalUSD: 0,
              totalBs: 0,
            };
          }
          const { monto_usd, monto_bs } = calcularMontos(m);
          mapaCierres[pId].items.push(m);
          mapaCierres[pId].totalUSD += monto_usd;
          mapaCierres[pId].totalBs += monto_bs;
        } else {
          individuales.push(m);
        }
      }

      const elementos: ElementoRender[] = [];
      for (const pId of ordenCierres) {
        elementos.push(mapaCierres[pId]);
      }
      for (const ind of individuales) {
        elementos.push({ tipo: 'individual', movimiento: ind });
      }

      return {
        fecha,
        items,
        elementos,
        totalIngresosUSD,
        totalGastosUSD,
      };
    });
  }, [movimientosFiltrados, mapaPuestos]);

  const handleEliminar = async (id: string) => {
    if (window.confirm('¿Deseas eliminar definitivamente este movimiento?')) {
      await onEliminarMovimiento(id);
    }
  };

  const handleEliminarCierre = async (cierre: GrupoCierreRender) => {
    const confirmacion = window.confirm(
      `¿Estás seguro de que deseas eliminar el Cierre Diario de ${cierre.puestoNombre} del día ${cierre.fecha}? Se eliminarán los ${cierre.items.length} registros de este cierre.`
    );
    if (!confirmacion) return;

    try {
      const token = getAccessTokenFromStorage() || supabaseAnonKey;
      const url = `${supabaseUrl}/rest/v1/movimientos?puesto_id=eq.${cierre.puestoId}&fecha=eq.${cierre.fecha}&tipo=eq.venta&descripcion=ilike.Cierre%25`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        let errMsg = 'Error al eliminar el cierre';
        try {
          const errData = await res.json();
          errMsg = errData?.message || errData?.error_description || errMsg;
        } catch {
          const text = await res.text();
          if (text) errMsg = text;
        }
        throw new Error(errMsg);
      }
    } catch (err: any) {
      console.error('Error al eliminar cierre:', err);
      alert(err?.message || 'Error al eliminar el cierre.');
    }
  };

  const handleGuardarModal = async (mov: Omit<Movimiento, 'id' | 'created_at'> & { id?: string }) => {
    const tipoNormalizado: TipoMovimiento = mov.tipo === 'ingreso' || mov.tipo === 'venta' ? 'venta' : 'gasto';
    const movLimpio = { ...mov, tipo: tipoNormalizado };
    if (mov.id) {
      await onActualizarMovimiento(movLimpio as Movimiento);
    } else {
      await onCrearMovimiento(movLimpio);
    }
  };

  return (
    <div className="space-y-4 pb-20 pt-2 px-3 sm:px-4 max-w-4xl mx-auto">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-[#18181B] tracking-tight">
            Movimientos Contables
          </h1>
          <p className="text-xs text-[#52525B]">
            Historial ordenado cronológicamente ({movimientosFiltrados.length} registros)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* BOTÓN + CIERRE DE PUESTO (ADMINISTRADOR) */}
          <button
            type="button"
            onClick={() => {
              setCierreParaEditar(null);
              setModalCierreAbierto(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-[#166534] hover:bg-[#14532d] active:bg-[#0f3d21] text-white rounded transition-colors shadow-xs cursor-pointer"
          >
            <Store size={14} />
            <span>+ Cierre de Puesto</span>
          </button>

          {/* BOTÓN + NUEVO MOVIMIENTO GENERAL */}
          <button
            type="button"
            onClick={() => {
              setMovimientoParaEditar(null);
              setModalAbierto(true);
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-[#2C474E] text-white rounded hover:bg-[#23393e] active:bg-[#1a2b2f] transition-colors cursor-pointer"
          >
            <Plus size={14} />
            <span>+ Nuevo</span>
          </button>
        </div>
      </div>

      {/* SELECTOR DE FILTRO POR PUESTO DE VENTA */}
      {puestos.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-[11px] font-bold text-[#52525B] flex items-center gap-1 shrink-0">
            <Store size={13} className="text-[#2C474E]" />
            Puesto:
          </span>
          <button
            type="button"
            onClick={() => setFiltroPuesto('todos')}
            className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors shrink-0 cursor-pointer ${
              filtroPuesto === 'todos'
                ? 'bg-[#2C474E] text-white'
                : 'bg-white border border-[#E4E4E7] text-[#52525B] hover:bg-zinc-100'
            }`}
          >
            Todos los puestos
          </button>
          {puestos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setFiltroPuesto(p.id)}
              className={`px-2.5 py-1 text-xs rounded-full font-semibold transition-colors shrink-0 cursor-pointer ${
                filtroPuesto === p.id
                  ? 'bg-[#2C474E] text-white'
                  : 'bg-white border border-[#E4E4E7] text-[#52525B] hover:bg-zinc-100'
              }`}
            >
              {p.nombre}
            </button>
          ))}
        </div>
      )}

      {/* Barra de Búsqueda y Filtros de Categoría */}
      <div className="bg-white border border-[#E4E4E7] rounded-lg p-3 space-y-2.5 shadow-xs">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-[#52525B]" />
          <input
            type="text"
            placeholder="Buscar por descripción, categoría, método o puesto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-[#E4E4E7] rounded bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#2C474E]"
          />
        </div>

        {/* Botones de Filtro por Tipo */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setFiltro('todos')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition-colors shrink-0 cursor-pointer ${
              filtro === 'todos'
                ? 'bg-[#18181B] text-white font-bold'
                : 'bg-[#F4F4F5] text-[#52525B] hover:bg-zinc-200'
            }`}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setFiltro('ventas')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition-colors shrink-0 cursor-pointer ${
              filtro === 'ventas'
                ? 'bg-[#166534] text-white font-bold'
                : 'bg-[#F4F4F5] text-[#166534] hover:bg-green-100'
            }`}
          >
            Ventas
          </button>
          <button
            type="button"
            onClick={() => setFiltro('gastos')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition-colors shrink-0 cursor-pointer ${
              filtro === 'gastos'
                ? 'bg-[#2C474E] text-white font-bold'
                : 'bg-[#F4F4F5] text-[#2C474E] hover:bg-zinc-200'
            }`}
          >
            Gastos
          </button>
          <button
            type="button"
            onClick={() => setFiltro('personal')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition-colors shrink-0 cursor-pointer ${
              filtro === 'personal'
                ? 'bg-[#4B5563] text-white font-bold'
                : 'bg-[#F4F4F5] text-[#4B5563] hover:bg-zinc-200'
            }`}
          >
            Personal
          </button>
        </div>
      </div>

      {/* Lista agrupada por fecha */}
      {gruposPorFecha.length === 0 ? (
        <div className="bg-white border border-[#E4E4E7] rounded-lg p-8 text-center text-[#52525B] text-xs">
          No se encontraron movimientos con los filtros seleccionados.
        </div>
      ) : (
        <div className="space-y-4">
          {gruposPorFecha.map((grupo) => (
            <div
              key={grupo.fecha}
              className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs"
            >
              {/* Encabezado del Día */}
              <div className="bg-[#FAFAFA] border-b border-[#E4E4E7] px-3.5 py-2 flex items-center justify-between text-xs flex-wrap gap-2">
                <div className="flex items-center gap-1.5 font-bold text-[#18181B]">
                  <Calendar size={14} className="text-[#52525B]" />
                  <span className="tabular-nums font-mono">{grupo.fecha}</span>
                  <span className="text-[11px] font-normal text-[#52525B]">
                    ({grupo.items.length} {grupo.items.length === 1 ? 'registro' : 'registros'})
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-bold tabular-nums">
                  <span className="text-[#166534]">
                    Ing: +{formatUSD(grupo.totalIngresosUSD)}
                  </span>
                  <span className="text-[#991B1B]">
                    Egr: -{formatUSD(grupo.totalGastosUSD)}
                  </span>
                </div>
              </div>

              {/* Items del Día: Tarjetas unificadas de cierre diario + Movimientos individuales */}
              <div className="divide-y divide-[#E4E4E7]">
                {grupo.elementos.map((elem) => {
                  if (elem.tipo === 'cierre') {
                    const cierre = elem;
                    const estaExpandido = Boolean(cierresExpandidos[cierre.key]);

                    return (
                      <div
                        key={cierre.key}
                        className="bg-white transition-colors"
                      >
                        {/* Cabecera Clickeable para Expandir/Contraer */}
                        <div
                          onClick={() => toggleCierre(cierre.key)}
                          className="p-3 flex items-center justify-between gap-2 hover:bg-zinc-50 cursor-pointer transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                              {/* Insignia Cierre Diario */}
                              <span className="text-[10px] font-bold text-[#2C474E] bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded">
                                Cierre Diario
                              </span>
                              {/* Insignia Verde del Puesto */}
                              <span className="text-[10px] font-bold text-[#166534] bg-[#ECFDF5] border border-[#BBF7D0] px-1.5 py-0.5 rounded flex items-center gap-1">
                                <Store size={10} />
                                <span>{cierre.puestoNombre}</span>
                              </span>
                              {/* Contador de métodos incluidos */}
                              <span className="text-[10px] text-[#52525B] bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                                {cierre.items.length} {cierre.items.length === 1 ? 'método' : 'métodos'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-[#52525B]">
                              <span className="tabular-nums font-medium">
                                Total en Bs: {formatVES(cierre.totalBs)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Total Sumado en USD */}
                            <div className="text-right">
                              <span className="block text-xs sm:text-sm font-black tabular-nums text-[#166534]">
                                +{formatUSD(cierre.totalUSD)}
                              </span>
                            </div>

                            {/* Botones Rápidos y Flecha */}
                            <div className="flex items-center gap-1 border-l border-[#E4E4E7] pl-2 ml-1">
                              {/* Editar Cierre */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCierreParaEditar({
                                    puestoId: cierre.puestoId,
                                    fecha: cierre.fecha,
                                  });
                                  setModalCierreAbierto(true);
                                }}
                                className="p-1.5 text-[#52525B] hover:text-[#2C474E] hover:bg-zinc-100 rounded transition-colors cursor-pointer"
                                title="Editar cierre de puesto"
                              >
                                <Pencil size={14} />
                              </button>

                              {/* Eliminar Cierre */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEliminarCierre(cierre);
                                }}
                                className="p-1.5 text-[#52525B] hover:text-[#991B1B] hover:bg-red-50 rounded transition-colors cursor-pointer"
                                title="Eliminar cierre completo"
                              >
                                <Trash2 size={14} />
                              </button>

                              {/* Flecha Desplegar */}
                              <div className="p-1 text-zinc-400">
                                {estaExpandido ? (
                                  <ChevronUp size={16} />
                                ) : (
                                  <ChevronDown size={16} />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Detalle Desplegable con los movimientos que componen el cierre */}
                        {estaExpandido && (
                          <div className="bg-[#FAFAFA] border-t border-[#E4E4E7] px-3.5 py-2.5 space-y-2">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">
                              Desglose de Métodos del Cierre ({cierre.puestoNombre} • {cierre.fecha}):
                            </span>
                            <div className="divide-y divide-zinc-200 bg-white border border-zinc-200 rounded-lg overflow-hidden">
                              {cierre.items.map((m) => {
                                const { monto_usd, monto_bs } = calcularMontos(m);
                                const tasaItem = m.tasa_aplicada || m.tasa || tasaDia;

                                return (
                                  <div
                                    key={m.id}
                                    className="p-2.5 flex items-center justify-between text-xs hover:bg-zinc-50/50"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-[#18181B]">
                                        {METODOS_PAGO_LABELS[m.metodo_pago] || m.metodo_pago}
                                      </span>
                                      <span className="text-[10px] text-zinc-400 font-mono">
                                        (Tasa: {formatNumber(tasaItem)} Bs/$)
                                      </span>
                                    </div>
                                    <div className="text-right">
                                      <span className="font-mono font-bold text-[#166534] mr-2.5">
                                        +{formatUSD(monto_usd)}
                                      </span>
                                      <span className="font-mono text-[11px] text-zinc-500">
                                        {formatVES(monto_bs)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Movimiento Individual (Gastos, retiros o ventas manuales)
                  const item = elem.movimiento;
                  const nombrePuesto = item.puesto?.nombre || (item.puesto_id ? mapaPuestos[item.puesto_id] : null);

                  return (
                    <div
                      key={item.id}
                      className="p-3 flex items-center justify-between gap-2 hover:bg-zinc-50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className="text-xs font-bold text-[#18181B] truncate">
                            {item.descripcion}
                          </span>
                          <BadgeNaturaleza naturaleza={item.naturaleza} tipo={item.tipo} />
                          <span className="text-[10px] text-[#52525B] bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                            {METODOS_PAGO_LABELS[item.metodo_pago] || item.metodo_pago}
                          </span>
                          {/* BADGE DEL PUESTO DE VENTA */}
                          {nombrePuesto && (
                            <span className="text-[10px] font-bold text-[#166534] bg-[#ECFDF5] border border-[#BBF7D0] px-1.5 py-0.5 rounded flex items-center gap-1">
                              <Store size={10} />
                              <span>{nombrePuesto}</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#52525B]">
                          <span className="truncate">{item.categoria}</span>
                          <span>•</span>
                          <span className="tabular-nums">
                            Tasa: {item.tasa_aplicada} Bs/$
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <span
                            className={`block text-xs sm:text-sm font-bold tabular-nums ${
                              item.tipo === 'venta' ? 'text-[#166534]' : 'text-[#991B1B]'
                            }`}
                          >
                            {item.tipo === 'venta' ? '+' : '-'} {formatMontoMovimiento(item)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 border-l border-[#E4E4E7] pl-2 ml-1">
                          <button
                            type="button"
                            onClick={() => {
                              setMovimientoParaEditar(item);
                              setModalAbierto(true);
                            }}
                            className="p-1.5 text-[#52525B] hover:text-[#2C474E] hover:bg-zinc-100 rounded transition-colors cursor-pointer"
                            title="Editar movimiento"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEliminar(item.id)}
                            className="p-1.5 text-[#52525B] hover:text-[#991B1B] hover:bg-red-50 rounded transition-colors cursor-pointer"
                            title="Eliminar movimiento"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal para Nuevo o Editar Movimiento General */}
      <ModalMovimiento
        isOpen={modalAbierto}
        movimientoAEditar={movimientoParaEditar}
        tasaActual={tasaDia}
        puestos={puestos}
        onClose={() => {
          setModalAbierto(false);
          setMovimientoParaEditar(null);
        }}
        onGuardar={handleGuardarModal}
      />

      {/* Modal Cierre de Puesto (Administrador) */}
      <ModalCierrePuesto
        isOpen={modalCierreAbierto}
        onClose={() => {
          setModalCierreAbierto(false);
          setCierreParaEditar(null);
        }}
        puestos={puestos}
        tasaActual={tasaDia}
        movimientos={movimientos}
        cierreInicial={cierreParaEditar}
      />
    </div>
  );
};
