import React, { useState, useEffect } from 'react';
import {
  TrendingDown,
  TrendingUp,
  User,
  Store,
  Calendar,
  CreditCard,
  DollarSign,
  Banknote,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Pencil,
  Trash2,
  Tag,
  Layers,
  RotateCcw,
} from 'lucide-react';
import {
  CategoriaMovimiento,
  CATEGORIAS_GASTO,
  MetodoPago,
  METODOS_PAGO_LABELS,
  Movimiento,
  NaturalezaMovimiento,
  Puesto,
  TipoMovimiento,
} from '../types';
import { BadgeNaturaleza } from '../components/BadgeNaturaleza';
import { formatMontoMovimiento, formatNumber, limpiarInputDecimal } from '../utils/format';
import { getVenezuelaDate } from '../utils/parserLocal';
import { ModalMovimiento } from '../components/ModalMovimiento';
import { supabaseUrl, supabaseAnonKey, getAccessTokenFromStorage } from '../lib/supabase';

interface Props {
  tasaDia: number;
  puestos?: Puesto[];
  onGuardarMovimientos: (movs: Omit<Movimiento, 'id' | 'created_at'>[]) => Promise<Movimiento[]>;
  onActualizarMovimiento: (mov: Movimiento) => Promise<void>;
  onEliminarMovimiento: (id: string) => Promise<void>;
  onRecargarDatos?: () => Promise<void>;
}

type ModoRegistro = 'gastos' | 'personal' | 'ventas';
type MetodoPagoFormulario = MetodoPago | 'pago_mixto';

const BORRADOR_KEY = 'ynacaja_borrador_registro';

interface BorradorRegistro {
  tipo: TipoMovimiento;
  naturaleza: NaturalezaMovimiento;
  modo: ModoRegistro;
  puestoId: string;
  fecha: string;
  metodoPago: MetodoPagoFormulario;
  categoria: CategoriaMovimiento;
  monto: string;
  montoMixtoBanco: string;
  montoMixtoEfectivo: string;
  montoMixtoDivisas: string;
  descripcion: string;
}

const leerBorrador = (): Partial<BorradorRegistro> => {
  try {
    const raw = sessionStorage.getItem(BORRADOR_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Error leyendo borrador de sessionStorage:', err);
  }
  return {};
};

export const RegistrarView: React.FC<Props> = ({
  tasaDia,
  puestos = [],
  onGuardarMovimientos,
  onActualizarMovimiento,
  onEliminarMovimiento,
  onRecargarDatos,
}) => {
  // Estado del formulario (restaurado de borrador si existe en sessionStorage)
  const [modo, setModo] = useState<ModoRegistro>(() => {
    const b = leerBorrador();
    return b.modo || (b.tipo === 'venta' ? 'ventas' : b.naturaleza === 'Personal' ? 'personal' : 'gastos');
  });
  const [puestoId, setPuestoId] = useState<string>(() => leerBorrador().puestoId || '');
  const [fecha, setFecha] = useState<string>(() => leerBorrador().fecha || getVenezuelaDate());
  const [metodoPago, setMetodoPago] = useState<MetodoPagoFormulario>(
    () => leerBorrador().metodoPago || 'pago_movil'
  );
  const [monto, setMonto] = useState<string>(() => leerBorrador().monto || '');
  const [montoBancoBs, setMontoBancoBs] = useState<string>(
    () => leerBorrador().montoMixtoBanco || ''
  );
  const [montoEfectivoBs, setMontoEfectivoBs] = useState<string>(
    () => leerBorrador().montoMixtoEfectivo || ''
  );
  const [montoDivisasUsd, setMontoDivisasUsd] = useState<string>(
    () => leerBorrador().montoMixtoDivisas || ''
  );
  const [descripcion, setDescripcion] = useState<string>(() => leerBorrador().descripcion || '');
  const [categoriaGasto, setCategoriaGasto] = useState<CategoriaMovimiento>(
    () => leerBorrador().categoria || 'Materia Prima'
  );

  // Estado de feedback y guardado
  const [guardando, setGuardando] = useState(false);
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);
  const [exitoMensaje, setExitoMensaje] = useState<string | null>(null);

  // Historial de la sesión actual
  const [movimientosSesion, setMovimientosSesion] = useState<Movimiento[]>([]);

  // Modal para editar algún movimiento del historial de la sesión
  const [movimientoParaEditar, setMovimientoParaEditar] = useState<Movimiento | null>(null);
  const [modalEditarAbierto, setModalEditarAbierto] = useState(false);

  // Sugerencias rápidas de descripción según el tipo seleccionado
  const sugerencias = {
    gastos: ['Hielo y vasos', 'Materia prima', 'Leche condensada', 'Canela / Insumos', 'Flete / Transporte', 'Bolsas y empaques', 'Cuota negocio'],
    personal: ['Retiro personal Ynaides', 'Almuerzo / Comida', 'Gasto personal', 'Ocio / Varios'],
    ventas: ['Venta del día', 'Venta especial evento', 'Venta mayor'],
  };

  // Cálculo en vivo de conversión para Pago Simple
  const montoNumerico = parseFloat(monto.replace(',', '.')) || 0;
  const esDolar = metodoPago === 'divisa';
  const tasaSegura = tasaDia > 0 ? tasaDia : 100;
  const montoEquivalente = esDolar
    ? montoNumerico * tasaSegura
    : (tasaSegura > 0 ? montoNumerico / tasaSegura : 0);

  // Cálculos en vivo para Pago Mixto
  const numBancoBs = parseFloat(montoBancoBs.replace(',', '.')) || 0;
  const numEfectivoBs = parseFloat(montoEfectivoBs.replace(',', '.')) || 0;
  const numDivisasUsd = parseFloat(montoDivisasUsd.replace(',', '.')) || 0;
  const totalMixtoBs = numBancoBs + numEfectivoBs + (numDivisasUsd * tasaSegura);
  const totalMixtoUsd = tasaSegura > 0 ? totalMixtoBs / tasaSegura : 0;

  // Auto-guardado en sessionStorage cada vez que cambie algún campo
  useEffect(() => {
    const tipo: TipoMovimiento = modo === 'ventas' ? 'venta' : 'gasto';
    const naturaleza: NaturalezaMovimiento =
      modo === 'ventas' ? 'Ventas' : modo === 'personal' ? 'Personal' : 'Negocio';

    const borrador: BorradorRegistro = {
      tipo,
      naturaleza,
      modo,
      puestoId,
      fecha,
      metodoPago,
      categoria: categoriaGasto,
      monto,
      montoMixtoBanco: montoBancoBs,
      montoMixtoEfectivo: montoEfectivoBs,
      montoMixtoDivisas: montoDivisasUsd,
      descripcion,
    };

    try {
      sessionStorage.setItem(BORRADOR_KEY, JSON.stringify(borrador));
    } catch (err) {
      console.warn('Error guardando borrador en sessionStorage:', err);
    }
  }, [
    modo,
    puestoId,
    fecha,
    metodoPago,
    categoriaGasto,
    monto,
    montoBancoBs,
    montoEfectivoBs,
    montoDivisasUsd,
    descripcion,
  ]);

  const hayDatosEnBorrador = Boolean(
    descripcion.trim() ||
    monto.trim() ||
    montoBancoBs.trim() ||
    montoEfectivoBs.trim() ||
    montoDivisasUsd.trim()
  );

  const limpiarBorrador = () => {
    try {
      sessionStorage.removeItem(BORRADOR_KEY);
    } catch (e) {}
    setMonto('');
    setMontoBancoBs('');
    setMontoEfectivoBs('');
    setMontoDivisasUsd('');
    setDescripcion('');
    setPuestoId('');
    setFecha(getVenezuelaDate());
    setMetodoPago('pago_movil');
    setCategoriaGasto('Materia Prima');
    setErrorMensaje(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMensaje(null);
    setExitoMensaje(null);

    if (!descripcion.trim()) {
      setErrorMensaje('Por favor escribe el concepto o descripción del movimiento.');
      return;
    }

    let tipoMov: TipoMovimiento = 'gasto';
    let natMov: NaturalezaMovimiento = 'Negocio';
    let catMov: CategoriaMovimiento = categoriaGasto;

    if (modo === 'ventas') {
      tipoMov = 'venta';
      natMov = 'Ventas';
      catMov = 'Ventas';
    } else if (modo === 'personal') {
      tipoMov = 'gasto';
      natMov = 'Personal';
      catMov = 'Personal / Ocio / Regalos';
    } else {
      tipoMov = 'gasto';
      natMov = 'Negocio';
      catMov = categoriaGasto || 'Materia Prima';
    }

    // =========================================================================
    // FLUJO 1: PAGO MIXTO (Solo Gastos o Personal)
    // =========================================================================
    if (metodoPago === 'pago_mixto' && (modo === 'gastos' || modo === 'personal')) {
      const numBanco = parseFloat(montoBancoBs.replace(',', '.')) || 0;
      const numEfectivo = parseFloat(montoEfectivoBs.replace(',', '.')) || 0;
      const numDivisas = parseFloat(montoDivisasUsd.replace(',', '.')) || 0;

      const camposConMonto = (numBanco > 0 ? 1 : 0) + (numEfectivo > 0 ? 1 : 0) + (numDivisas > 0 ? 1 : 0);
      if (camposConMonto === 0 || (numBanco <= 0 && numEfectivo <= 0 && numDivisas <= 0)) {
        setErrorMensaje('Por favor ingresa un monto válido mayor a 0 en al menos uno de los bolsillos.');
        return;
      }

      setGuardando(true);

      const descConSufijo = descripcion.trim().toLowerCase().includes('pago mixto')
        ? descripcion.trim()
        : `${descripcion.trim()} (Pago Mixto)`;

      const itemsAInsertar: any[] = [];

      if (numBanco > 0) {
        const mBs = Math.round(numBanco * 100) / 100;
        const mUsd = Math.round((numBanco / tasaSegura) * 100) / 100;
        itemsAInsertar.push({
          fecha,
          descripcion: descConSufijo,
          tipo: 'gasto',
          naturaleza: natMov,
          categoria: catMov,
          metodo_pago: 'pago_movil',
          moneda_original: 'VES',
          moneda: 'VES',
          monto_original: mBs,
          monto_bs: mBs,
          monto_usd: mUsd,
          tasa_aplicada: tasaSegura,
          tasa: tasaSegura,
          puesto_id: puestoId || null,
        });
      }

      if (numEfectivo > 0) {
        const mBs = Math.round(numEfectivo * 100) / 100;
        const mUsd = Math.round((numEfectivo / tasaSegura) * 100) / 100;
        itemsAInsertar.push({
          fecha,
          descripcion: descConSufijo,
          tipo: 'gasto',
          naturaleza: natMov,
          categoria: catMov,
          metodo_pago: 'efectivo_bs',
          moneda_original: 'VES',
          moneda: 'VES',
          monto_original: mBs,
          monto_bs: mBs,
          monto_usd: mUsd,
          tasa_aplicada: tasaSegura,
          tasa: tasaSegura,
          puesto_id: puestoId || null,
        });
      }

      if (numDivisas > 0) {
        const mUsd = Math.round(numDivisas * 100) / 100;
        const mBs = Math.round(numDivisas * tasaSegura * 100) / 100;
        itemsAInsertar.push({
          fecha,
          descripcion: descConSufijo,
          tipo: 'gasto',
          naturaleza: natMov,
          categoria: catMov,
          metodo_pago: 'divisa',
          moneda_original: 'USD',
          moneda: 'USD',
          monto_original: mUsd,
          monto_bs: mBs,
          monto_usd: mUsd,
          tasa_aplicada: tasaSegura,
          tasa: tasaSegura,
          puesto_id: puestoId || null,
        });
      }

      try {
        const token = getAccessTokenFromStorage() || supabaseAnonKey;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        let guardados: Movimiento[] = [];

        try {
          const dbPayload = itemsAInsertar.map((item) => ({
            id: crypto.randomUUID ? crypto.randomUUID() : `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            ...item,
          }));

          const res = await fetch(`${supabaseUrl}/rest/v1/movimientos`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${token}`,
              Prefer: 'return=representation',
            },
            body: JSON.stringify(dbPayload),
            signal: controller.signal,
          });

          if (!res.ok) {
            let errMsg = `Error ${res.status}`;
            try {
              const errJson = await res.json();
              errMsg = errJson?.message || errJson?.error || errMsg;
            } catch {
              const txt = await res.text();
              if (txt) errMsg = txt;
            }
            throw new Error(errMsg);
          }

          const data = await res.json();
          guardados = Array.isArray(data) && data.length > 0 ? data : dbPayload;
        } catch (fetchErr: any) {
          console.warn('Direct fetch fallo o abortado, aplicando fallback onGuardarMovimientos:', fetchErr);
          guardados = await onGuardarMovimientos(itemsAInsertar);
        } finally {
          clearTimeout(timeoutId);
        }

        if (guardados && guardados.length > 0) {
          setMovimientosSesion((prev) => [...guardados, ...prev]);
          if (onRecargarDatos) {
            onRecargarDatos().catch(() => {});
          }
        }

        // Limpiar campos de pago mixto y borrador
        try {
          sessionStorage.removeItem(BORRADOR_KEY);
        } catch (e) {}
        setMontoBancoBs('');
        setMontoEfectivoBs('');
        setMontoDivisasUsd('');
        setDescripcion('');

        const totUsd = numDivisas + (numBanco + numEfectivo) / tasaSegura;
        const totBs = numBanco + numEfectivo + (numDivisas * tasaSegura);
        setExitoMensaje(
          `✓ Guardado con éxito pago mixto: $${formatNumber(totUsd)} USD (≈ Bs. ${formatNumber(totBs)}) distribuido en ${itemsAInsertar.length} bolsillo(s).`
        );
      } catch (err: any) {
        setErrorMensaje(err?.message || 'Error al guardar el pago mixto. Inténtalo nuevamente.');
      } finally {
        setGuardando(false);
      }
      return;
    }

    // =========================================================================
    // FLUJO 2: PAGO SIMPLE
    // =========================================================================
    const mNum = parseFloat(monto.replace(',', '.'));
    if (isNaN(mNum) || mNum <= 0) {
      setErrorMensaje('Por favor ingresa un monto válido mayor a 0.');
      return;
    }

    setGuardando(true);

    try {
      const montoBs = esDolar ? Math.round(mNum * tasaSegura * 100) / 100 : mNum;
      const montoUSD = esDolar ? mNum : Math.round((mNum / tasaSegura) * 100) / 100;

      const nuevoMov: Omit<Movimiento, 'id' | 'created_at'> = {
        fecha,
        descripcion: descripcion.trim(),
        tipo: tipoMov,
        naturaleza: natMov,
        categoria: catMov,
        metodo_pago: metodoPago as MetodoPago,
        moneda_original: esDolar ? 'USD' : 'VES',
        moneda: esDolar ? 'USD' : 'VES',
        monto_original: mNum,
        monto_bs: montoBs,
        monto_usd: montoUSD,
        tasa_aplicada: tasaSegura,
        tasa: tasaSegura,
        puesto_id: puestoId || null,
      };

      const guardados = await onGuardarMovimientos([nuevoMov]);

      if (guardados && guardados.length > 0) {
        setMovimientosSesion((prev) => [guardados[0], ...prev]);
        setExitoMensaje(`✓ Guardado con éxito: "${nuevoMov.descripcion}" (${formatMontoMovimiento(guardados[0])})`);
        if (onRecargarDatos) {
          onRecargarDatos().catch(() => {});
        }
      } else {
        setExitoMensaje(`✓ Guardado con éxito: "${nuevoMov.descripcion}"`);
      }

      // Limpiar únicamente monto, descripción y borrador para seguir registrando ágilmente
      try {
        sessionStorage.removeItem(BORRADOR_KEY);
      } catch (e) {}
      setMonto('');
      setDescripcion('');
    } catch (err: any) {
      setErrorMensaje(err?.message || 'Error al guardar el movimiento. Inténtalo nuevamente.');
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarItem = async (id: string) => {
    if (window.confirm('¿Deseas eliminar este registro?')) {
      try {
        await onEliminarMovimiento(id);
        setMovimientosSesion((prev) => prev.filter((m) => m.id !== id));
      } catch (err: any) {
        alert(err?.message || 'Error al eliminar');
      }
    }
  };

  const handleActualizarItem = async (mov: Omit<Movimiento, 'id' | 'created_at'> & { id?: string }) => {
    if (mov.id) {
      await onActualizarMovimiento(mov as Movimiento);
      setMovimientosSesion((prev) =>
        prev.map((item) => (item.id === mov.id ? (mov as Movimiento) : item))
      );
    }
  };

  return (
    <div className="space-y-5 pb-24 pt-3 px-3.5 sm:px-4 max-w-2xl mx-auto">
      {/* Encabezado limpio con aire */}
      <div className="pt-1 flex items-center justify-between">
        <h1 className="text-lg font-bold text-[#18181B] tracking-tight">
          Registrar Movimiento
        </h1>
        {hayDatosEnBorrador && (
          <button
            type="button"
            onClick={limpiarBorrador}
            className="text-xs text-zinc-400 hover:text-zinc-600 flex items-center gap-1.5 transition-colors px-2 py-1 rounded-lg hover:bg-zinc-100 cursor-pointer"
            title="Limpiar borrador"
          >
            <RotateCcw size={12} />
            <span>Limpiar</span>
          </button>
        )}
      </div>

      {/* Tarjeta Principal del Formulario */}
      <div className="bg-white border border-zinc-200/80 rounded-2xl p-4 sm:p-6 shadow-xs">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 1. Selector de Naturaleza / Tipo (Gastos, Personal, Ventas) */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-2">
              Tipo de Movimiento
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {/* Opción GASTOS */}
              <button
                type="button"
                onClick={() => {
                  setModo('gastos');
                  setErrorMensaje(null);
                }}
                className={`min-h-[56px] flex flex-col items-center justify-center py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                  modo === 'gastos'
                    ? 'border-[#EF4444] bg-[#FEF2F2] text-[#991B1B] font-bold shadow-xs ring-1 ring-[#EF4444]'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <TrendingDown size={16} className={modo === 'gastos' ? 'text-[#DC2626]' : 'text-zinc-400'} />
                  <span className="text-xs sm:text-sm">Gastos</span>
                </div>
                <span className="text-[10px] text-zinc-400 mt-0.5">Negocio</span>
              </button>

              {/* Opción PERSONAL */}
              <button
                type="button"
                onClick={() => {
                  setModo('personal');
                  setErrorMensaje(null);
                }}
                className={`min-h-[56px] flex flex-col items-center justify-center py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                  modo === 'personal'
                    ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#92400E] font-bold shadow-xs ring-1 ring-[#F59E0B]'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <User size={16} className={modo === 'personal' ? 'text-[#D97706]' : 'text-zinc-400'} />
                  <span className="text-xs sm:text-sm">Personal</span>
                </div>
                <span className="text-[10px] text-zinc-400 mt-0.5">Retiros</span>
              </button>

              {/* Opción VENTAS */}
              <button
                type="button"
                onClick={() => {
                  setModo('ventas');
                  if (metodoPago === 'pago_mixto') setMetodoPago('pago_movil');
                  setErrorMensaje(null);
                }}
                className={`min-h-[56px] flex flex-col items-center justify-center py-3 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                  modo === 'ventas'
                    ? 'border-[#10B981] bg-[#ECFDF5] text-[#065F46] font-bold shadow-xs ring-1 ring-[#10B981]'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={16} className={modo === 'ventas' ? 'text-[#059669]' : 'text-zinc-400'} />
                  <span className="text-xs sm:text-sm">Ventas</span>
                </div>
                <span className="text-[10px] text-zinc-400 mt-0.5">Ingresos</span>
              </button>
            </div>
          </div>

          {/* 2. Fila: Puesto y Fecha */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Selector de Puesto */}
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Store size={13} />
                  Puesto de Venta
                </span>
              </label>
              <select
                value={puestoId}
                onChange={(e) => setPuestoId(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2.5 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
              >
                <option value="">Sin puesto específico (General)</option>
                {puestos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} {p.activo === false ? '(Inactivo)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Selector de Fecha */}
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Calendar size={13} />
                  Fecha
                </span>
              </label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required
                className="w-full min-h-[44px] px-3 py-2.5 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
              />
            </div>
          </div>

          {/* 3. Selector de Método de Pago */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-2">
              Método de Pago
            </label>
            <div
              className={`grid gap-2.5 ${
                modo === 'ventas' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-5'
              }`}
            >
              {/* Pago Móvil */}
              <button
                type="button"
                onClick={() => setMetodoPago('pago_movil')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs transition-all cursor-pointer ${
                  metodoPago === 'pago_movil'
                    ? 'border-[#1E3A3A] bg-[#1E3A3A] text-white font-bold shadow-xs'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <Smartphone size={14} />
                <span>Pago Móvil</span>
              </button>

              {/* Efectivo Bs */}
              <button
                type="button"
                onClick={() => setMetodoPago('efectivo_bs')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs transition-all cursor-pointer ${
                  metodoPago === 'efectivo_bs'
                    ? 'border-[#1E3A3A] bg-[#1E3A3A] text-white font-bold shadow-xs'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <Banknote size={14} />
                <span>Efectivo (Bs)</span>
              </button>

              {/* Punto de Venta */}
              <button
                type="button"
                onClick={() => setMetodoPago('punto_venta')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs transition-all cursor-pointer ${
                  metodoPago === 'punto_venta'
                    ? 'border-[#1E3A3A] bg-[#1E3A3A] text-white font-bold shadow-xs'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <CreditCard size={14} />
                <span>Punto de Venta</span>
              </button>

              {/* Divisas ($) */}
              <button
                type="button"
                onClick={() => setMetodoPago('divisa')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs transition-all cursor-pointer ${
                  metodoPago === 'divisa'
                    ? 'border-[#15803D] bg-[#15803D] text-white font-bold shadow-xs'
                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                }`}
              >
                <DollarSign size={14} />
                <span>Divisas ($)</span>
              </button>

              {/* Pago Mixto (Solo disponible para Gastos y Personal) */}
              {(modo === 'gastos' || modo === 'personal') && (
                <button
                  type="button"
                  onClick={() => setMetodoPago('pago_mixto')}
                  className={`col-span-2 sm:col-span-1 min-h-[44px] flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs transition-all cursor-pointer ${
                    metodoPago === 'pago_mixto'
                      ? 'border-[#2C474E] bg-[#2C474E] text-white font-bold shadow-xs'
                      : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                  }`}
                >
                  <Layers
                    size={14}
                    className={metodoPago === 'pago_mixto' ? 'text-[#86EFAC]' : 'text-zinc-500'}
                  />
                  <span>Pago Mixto</span>
                </button>
              )}
            </div>
          </div>

          {/* 4. Categoría opcional para Gastos */}
          {modo === 'gastos' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Tag size={13} />
                  Categoría del Gasto
                </span>
              </label>
              <select
                value={categoriaGasto}
                onChange={(e) => setCategoriaGasto(e.target.value as CategoriaMovimiento)}
                className="w-full min-h-[44px] px-3 py-2.5 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
              >
                {CATEGORIAS_GASTO.filter((c) => c.naturaleza === 'Negocio').map((c) => (
                  <option key={c.nombre} value={c.nombre}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 5. Inputs de Monto */}
          {metodoPago === 'pago_mixto' && (modo === 'gastos' || modo === 'personal') ? (
            /* Modo Pago Mixto: 3 inputs (uno por bolsillo real) */
            <div className="space-y-3 p-3.5 sm:p-4 bg-zinc-50/70 border border-zinc-200/90 rounded-2xl">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#18181B] flex items-center gap-1.5">
                  <Layers size={14} className="text-[#2C474E]" />
                  <span>Montos por Bolsillo (Pago Mixto)</span>
                </label>
                <span className="text-[11px] text-zinc-500 font-medium">
                  Llena 2 o los 3 bolsillos
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* a) Banco / Pago Móvil (Bs) */}
                <div className="bg-white p-2.5 rounded-xl border border-zinc-200 shadow-2xs">
                  <label className="block text-[11px] font-bold text-zinc-600 mb-1 flex items-center gap-1">
                    <Smartphone size={13} className="text-[#1E3A3A] shrink-0" />
                    <span className="truncate">Banco / Pago Móvil (Bs)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">
                      Bs.
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={montoBancoBs}
                      onChange={(e) => setMontoBancoBs(limpiarInputDecimal(e.target.value))}
                      placeholder="0.00"
                      className="w-full min-h-[42px] pl-9 pr-2.5 py-2 text-sm sm:text-base font-bold border border-zinc-200 rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A] tabular-nums"
                    />
                  </div>
                </div>

                {/* b) Efectivo (Bs) */}
                <div className="bg-white p-2.5 rounded-xl border border-zinc-200 shadow-2xs">
                  <label className="block text-[11px] font-bold text-zinc-600 mb-1 flex items-center gap-1">
                    <Banknote size={13} className="text-emerald-600 shrink-0" />
                    <span className="truncate">Efectivo (Bs)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">
                      Bs.
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={montoEfectivoBs}
                      onChange={(e) => setMontoEfectivoBs(limpiarInputDecimal(e.target.value))}
                      placeholder="0.00"
                      className="w-full min-h-[42px] pl-9 pr-2.5 py-2 text-sm sm:text-base font-bold border border-zinc-200 rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A] tabular-nums"
                    />
                  </div>
                </div>

                {/* c) Divisas ($ USD) */}
                <div className="bg-white p-2.5 rounded-xl border border-zinc-200 shadow-2xs">
                  <label className="block text-[11px] font-bold text-zinc-600 mb-1 flex items-center gap-1">
                    <DollarSign size={13} className="text-amber-600 shrink-0" />
                    <span className="truncate">Divisas ($ USD)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">
                      $
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={montoDivisasUsd}
                      onChange={(e) => setMontoDivisasUsd(limpiarInputDecimal(e.target.value))}
                      placeholder="0.00"
                      className="w-full min-h-[42px] pl-7 pr-2.5 py-2 text-sm sm:text-base font-bold border border-zinc-200 rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A] tabular-nums"
                    />
                  </div>
                </div>
              </div>

              {/* Resumen en vivo: Total del Gasto Combinado */}
              <div className="bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block">
                    Total del Gasto
                  </span>
                  <span className="text-[10px] text-zinc-400 font-medium">
                    Tasa BCV: {formatNumber(tasaSegura)} Bs/$
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-base sm:text-lg font-black text-[#1E3A3A] tabular-nums">
                    ${formatNumber(totalMixtoUsd)} <span className="text-xs font-bold text-zinc-500">USD</span>
                  </div>
                  <div className="text-xs font-semibold text-zinc-500 tabular-nums">
                    ≈ Bs. {formatNumber(totalMixtoBs)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Modo Pago Simple: 1 input con conversión en vivo */
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label className="text-xs font-semibold text-[#18181B]">
                  {esDolar ? 'Monto en Divisas ($)' : 'Monto en Bolívares (Bs)'}
                </label>
                <span className="text-[11px] font-semibold text-[#1E3A3A] tabular-nums bg-emerald-50 border border-emerald-200/70 px-2.5 py-0.5 rounded-full whitespace-nowrap">
                  {esDolar
                    ? `≈ Bs. ${formatNumber(montoEquivalente)}`
                    : `≈ $${formatNumber(montoEquivalente)} USD`}
                </span>
              </div>

              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-400">
                  {esDolar ? '$' : 'Bs.'}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={monto}
                  onChange={(e) => setMonto(limpiarInputDecimal(e.target.value))}
                  placeholder="0.00"
                  required
                  className="w-full min-h-[48px] pl-11 pr-3.5 py-3 text-base sm:text-lg font-bold border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A] tabular-nums"
                />
              </div>
            </div>
          )}

          {/* 6. Input de Descripción / Concepto */}
          <div>
            <label className="block text-xs font-semibold text-[#18181B] mb-1.5">
              Descripción / Concepto
            </label>
            <input
              type="text"
              autoComplete="off"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder={
                modo === 'gastos'
                  ? 'Ej: Hielo y vasos, compra de leche condensada...'
                  : modo === 'personal'
                  ? 'Ej: Retiro personal Ynaides, almuerzo...'
                  : 'Ej: Venta del día, venta evento...'
              }
              required
              className="w-full min-h-[46px] px-3.5 py-2.5 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
            />

            {/* Chips de sugerencias rápidas */}
            <div className="flex flex-wrap gap-2 mt-2.5">
              {sugerencias[modo].map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setDescripcion(sug)}
                  className="px-2.5 py-1.5 text-[11px] font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg transition-colors cursor-pointer"
                >
                  + {sug}
                </button>
              ))}
            </div>
          </div>

          {/* Mensajes de Alerta / Éxito */}
          {errorMensaje && (
            <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMensaje}</span>
            </div>
          )}

          {exitoMensaje && (
            <div className="p-3 bg-[#ECFDF5] border border-[#BBF7D0] rounded-xl text-xs text-[#166534] flex items-start gap-2 animate-fadeIn">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-[#166534]" />
              <span className="font-semibold">{exitoMensaje}</span>
            </div>
          )}

          {/* 7. Botón Principal "Guardar Movimiento" */}
          <button
            type="submit"
            disabled={guardando}
            className={`w-full min-h-[50px] px-4 py-3 text-sm font-bold text-white rounded-xl flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ${
              modo === 'ventas'
                ? 'bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D]'
                : modo === 'personal'
                ? 'bg-[#D97706] hover:bg-[#B45309] active:bg-[#92400E]'
                : 'bg-[#1E3A3A] hover:bg-[#172e2e] active:bg-[#102222]'
            } disabled:opacity-60`}
          >
            {guardando ? (
              <>
                <Loader2 size={17} className="animate-spin text-white" />
                <span>Guardando movimiento...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={17} />
                <span>
                  {metodoPago === 'pago_mixto' && (modo === 'gastos' || modo === 'personal')
                    ? 'Guardar Pago Mixto'
                    : modo === 'ventas'
                    ? 'Guardar Venta'
                    : modo === 'personal'
                    ? 'Guardar Retiro Personal'
                    : 'Guardar Movimiento'}
                </span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* 8. Historial de la Sesión Actual */}
      {movimientosSesion.length > 0 && (
        <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] px-3.5 py-2.5 flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[#86EFAC]" />
              <span className="text-xs font-bold uppercase tracking-wider">
                Registrados en esta sesión ({movimientosSesion.length})
              </span>
            </div>
            <span className="text-[11px] text-[#86EFAC] font-semibold tabular-nums">
              Tasa: {formatNumber(tasaDia)} Bs/$
            </span>
          </div>

          <div className="divide-y divide-[#E4E4E7] max-h-80 overflow-y-auto">
            {movimientosSesion.map((item) => (
              <div
                key={item.id}
                className="p-3 flex items-center justify-between gap-2 hover:bg-zinc-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold text-[#18181B] truncate">
                      {item.descripcion}
                    </span>
                    <BadgeNaturaleza naturaleza={item.naturaleza} tipo={item.tipo} />
                    <span className="text-[11px] text-[#52525B] bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                      {METODOS_PAGO_LABELS[item.metodo_pago]}
                    </span>
                    {item.puesto && (
                      <span className="text-[10px] text-[#166534] bg-[#ECFDF5] border border-[#BBF7D0] px-1.5 py-0.5 rounded font-semibold">
                        {item.puesto.nombre}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[#52525B]">
                    <span className="tabular-nums font-medium">{item.fecha}</span>
                    <span>•</span>
                    <span className="truncate">{item.categoria}</span>
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
                        setModalEditarAbierto(true);
                      }}
                      className="p-1.5 text-[#52525B] hover:text-[#2C474E] hover:bg-zinc-100 rounded"
                      title="Editar movimiento"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEliminarItem(item.id)}
                      className="p-1.5 text-[#52525B] hover:text-[#991B1B] hover:bg-red-50 rounded"
                      title="Eliminar movimiento"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal para editar algún movimiento registrado en la sesión */}
      {modalEditarAbierto && movimientoParaEditar && (
        <ModalMovimiento
          isOpen={modalEditarAbierto}
          movimientoAEditar={movimientoParaEditar}
          tasaActual={tasaDia}
          puestos={puestos}
          puestoIdPorDefecto={puestoId || null}
          onClose={() => {
            setModalEditarAbierto(false);
            setMovimientoParaEditar(null);
          }}
          onGuardar={handleActualizarItem}
          onRecargarDatos={onRecargarDatos}
          onCambioCompletado={({ accion, eliminadoId, registros }) => {
            if (accion === 'actualizado' && eliminadoId && registros[0]) {
              setMovimientosSesion((prev) =>
                prev.map((item) => (item.id === eliminadoId ? registros[0] : item))
              );
            } else if (accion === 'mixto') {
              setMovimientosSesion((prev) => {
                const filtrados = eliminadoId
                  ? prev.filter((item) => item.id !== eliminadoId)
                  : prev;
                return [...registros, ...filtrados];
              });
            }
          }}
        />
      )}
    </div>
  );
};
