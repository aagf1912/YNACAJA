import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  Store,
  Calendar,
  Banknote,
  Smartphone,
  CreditCard,
  CircleDollarSign,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Movimiento, Puesto } from '../types';
import { formatNumber, formatUSD, formatVES } from '../utils/format';
import { getVenezuelaDate } from '../utils/parserLocal';
import { supabaseUrl, supabaseAnonKey, getAccessTokenFromStorage } from '../lib/supabase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  puestos: Puesto[];
  tasaActual: number;
  movimientos: Movimiento[];
  cierreInicial?: { puestoId: string; fecha: string } | null;
  onGuardadoExitoso?: () => void;
}

export const ModalCierrePuesto: React.FC<Props> = ({
  isOpen,
  onClose,
  puestos = [],
  tasaActual,
  movimientos = [],
  cierreInicial = null,
  onGuardadoExitoso,
}) => {
  const [puestoId, setPuestoId] = useState<string>('');
  const [fecha, setFecha] = useState<string>(() => getVenezuelaDate());
  const [tasaInput, setTasaInput] = useState<string>('');

  const [montoEfectivoBs, setMontoEfectivoBs] = useState<string>('');
  const [montoPagoMovilBs, setMontoPagoMovilBs] = useState<string>('');
  const [montoPuntoVentaBs, setMontoPuntoVentaBs] = useState<string>('');
  const [montoDivisasUSD, setMontoDivisasUSD] = useState<string>('');

  const [tieneCierrePrevio, setTieneCierrePrevio] = useState<boolean>(false);
  const [guardando, setGuardando] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Inicializar al abrir
  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (cierreInicial) {
        setPuestoId(cierreInicial.puestoId);
        setFecha(cierreInicial.fecha);
      } else {
        if (!puestoId && puestos.length > 0) {
          setPuestoId(puestos[0].id);
        }
        setFecha(getVenezuelaDate());
      }
      setTasaInput(tasaActual > 0 ? String(tasaActual) : '100');
    }
  }, [isOpen, cierreInicial, puestos, tasaActual]);

  // Pre-cargar datos del cierre existente cuando cambie puestoId o fecha
  useEffect(() => {
    if (!isOpen || !puestoId || !fecha) return;

    let cancelado = false;

    const cargarCierrePuesto = async () => {
      // 1. Primero buscar en los movimientos locales
      const movsLocales = movimientos.filter(
        (m) =>
          m.puesto_id === puestoId &&
          m.fecha === fecha &&
          (m.tipo === 'venta' || m.tipo === 'ingreso') &&
          (m.descripcion || '').startsWith('Cierre ')
      );

      let movs: any[] = movsLocales;

      // 2. Si no están en memoria o para asegurar datos completos, consultar vía fetch directo
      try {
        const token = getAccessTokenFromStorage() || supabaseAnonKey;
        const res = await fetch(
          `${supabaseUrl}/rest/v1/movimientos?puesto_id=eq.${puestoId}&fecha=eq.${fecha}&tipo=eq.venta&descripcion=ilike.Cierre%25&select=*`,
          {
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${token}`,
            },
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            movs = data;
          }
        }
      } catch (err) {
        console.warn('Error al consultar cierre previo:', err);
      }

      if (cancelado) return;

      if (movs.length > 0) {
        let efBs = 0;
        let pmBs = 0;
        let ptBs = 0;
        let divUSD = 0;
        let tasaCierre = 0;

        for (const m of movs) {
          const metodo = (m.metodo_pago || '').toLowerCase();
          const desc = (m.descripcion || '').toLowerCase();
          const orig = Number(m.monto_original) || 0;
          const mBs = Number(m.monto_bs) || (m.moneda_original === 'VES' || m.moneda === 'VES' ? orig : 0);
          const mUSD = Number(m.monto_usd) || (m.moneda_original === 'USD' || m.moneda === 'USD' ? orig : 0);

          if (Number(m.tasa_aplicada) > 0) tasaCierre = Number(m.tasa_aplicada);
          else if (Number(m.tasa) > 0) tasaCierre = Number(m.tasa);

          if (metodo === 'efectivo_bs' || desc.includes('efectivo')) {
            efBs += mBs || orig;
          } else if (metodo === 'pago_movil' || desc.includes('pago')) {
            pmBs += mBs || orig;
          } else if (metodo === 'punto_venta' || desc.includes('punto')) {
            ptBs += mBs || orig;
          } else if (metodo === 'divisa' || metodo.includes('divisa') || desc.includes('divisa') || desc.includes('dolar') || desc.includes('usd')) {
            divUSD += mUSD || orig;
          }
        }

        setMontoEfectivoBs(efBs > 0 ? String(efBs) : '');
        setMontoPagoMovilBs(pmBs > 0 ? String(pmBs) : '');
        setMontoPuntoVentaBs(ptBs > 0 ? String(ptBs) : '');
        setMontoDivisasUSD(divUSD > 0 ? String(divUSD) : '');
        if (tasaCierre > 0) {
          setTasaInput(String(tasaCierre));
        }
        setTieneCierrePrevio(true);
      } else {
        setMontoEfectivoBs('');
        setMontoPagoMovilBs('');
        setMontoPuntoVentaBs('');
        setMontoDivisasUSD('');
        setTasaInput(tasaActual > 0 ? String(tasaActual) : '100');
        setTieneCierrePrevio(false);
      }
    };

    cargarCierrePuesto();

    return () => {
      cancelado = true;
    };
  }, [isOpen, puestoId, fecha, movimientos, tasaActual]);

  if (!isOpen) return null;

  // Cálculos en vivo
  const puestoSeleccionado = puestos.find((p) => p.id === puestoId);
  const comisionPorcentaje = puestoSeleccionado?.comision_porcentaje ?? puestoSeleccionado?.porcentaje_comision ?? 10;
  const tasaNum = parseFloat(tasaInput) || tasaActual || 100;

  const efBs = parseFloat(montoEfectivoBs) || 0;
  const pmBs = parseFloat(montoPagoMovilBs) || 0;
  const ptBs = parseFloat(montoPuntoVentaBs) || 0;
  const divUSD = parseFloat(montoDivisasUSD) || 0;

  const totalBs = efBs + pmBs + ptBs;
  const totalVendidoUSD = (tasaNum > 0 ? totalBs / tasaNum : 0) + divUSD;
  const comisionUSD = (totalVendidoUSD * comisionPorcentaje) / 100;

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;

    if (!puestoId) {
      setError('Selecciona un puesto de venta.');
      return;
    }
    if (!fecha) {
      setError('Selecciona una fecha válida.');
      return;
    }

    const totalVendido = efBs + pmBs + ptBs + divUSD;
    if (totalVendido <= 0) {
      setError('Ingresa al menos un monto de venta.');
      return;
    }

    if (isNaN(tasaNum) || tasaNum <= 0) {
      setError('Ingresa una tasa BCV válida mayor a 0.');
      return;
    }

    setGuardando(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const token = getAccessTokenFromStorage() || supabaseAnonKey;
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/guardar_cierre_puesto_admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          p_puesto_id: puestoId,
          p_efectivo_bs: efBs,
          p_pago_movil_bs: pmBs,
          p_punto_bs: ptBs,
          p_divisas_usd: divUSD,
          p_tasa: tasaNum,
          p_fecha: fecha,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errMsg = 'Error al guardar el cierre de puesto';
        try {
          const errData = await res.json();
          errMsg = errData?.message || errData?.error_description || errMsg;
        } catch {
          const text = await res.text();
          if (text) errMsg = text;
        }
        throw new Error(errMsg);
      }

      if (onGuardadoExitoso) {
        onGuardadoExitoso();
      }
      onClose();
    } catch (err: any) {
      console.error('Error al guardar cierre de puesto:', err);
      if (err.name === 'AbortError') {
        setError('Tiempo de espera agotado al conectar con Supabase (8s).');
      } else {
        setError(err?.message || 'Error al guardar el cierre en Supabase.');
      }
    } finally {
      clearTimeout(timeoutId);
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-zinc-200 w-full max-w-lg overflow-hidden my-4">
        {/* Cabecera */}
        <div className="bg-[#2C474E] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#86EFAC]/20 rounded-lg text-[#86EFAC]">
              <Store size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold leading-tight">
                {tieneCierrePrevio ? 'Modificar Cierre de Puesto' : 'Registrar Cierre de Puesto'}
              </h2>
              <p className="text-[11px] text-zinc-300">
                Gestión administrativa de ventas por puesto y fecha
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleGuardar} className="p-4 sm:p-5 space-y-4">
          {error && (
            <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {tieneCierrePrevio && (
            <div className="p-2.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-xs text-[#065F46] flex items-center gap-2">
              <CheckCircle2 size={15} className="text-[#10B981] shrink-0" />
              <span className="font-semibold">
                ✓ Se encontraron datos cargados para este puesto y fecha. Podés modificarlos.
              </span>
            </div>
          )}

          {/* Selector de Puesto y Fecha */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#18181B] mb-1">
                Puesto de Venta:
              </label>
              <div className="relative">
                <select
                  value={puestoId}
                  onChange={(e) => setPuestoId(e.target.value)}
                  className="w-full p-2.5 text-xs font-semibold border border-zinc-300 rounded-lg bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none"
                  required
                >
                  <option value="" disabled>Selecciona un puesto...</option>
                  {puestos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} ({p.comision_porcentaje ?? p.porcentaje_comision ?? 10}%)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#18181B] mb-1">
                Fecha del Cierre:
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="w-full p-2.5 text-xs font-semibold border border-zinc-300 rounded-lg bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none"
                  required
                />
              </div>
            </div>
          </div>

          {/* Input Tasa BCV */}
          <div>
            <label className="block text-xs font-bold text-[#18181B] mb-1">
              Tasa BCV Aplicada (Bs/$):
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                value={tasaInput}
                onChange={(e) => setTasaInput(e.target.value)}
                placeholder="0.00"
                className="w-full p-2.5 text-xs font-mono font-bold border border-zinc-300 rounded-lg bg-white text-[#18181B] focus:ring-2 focus:ring-[#2C474E] focus:outline-none"
                required
              />
              <span className="absolute right-3 top-2.5 text-xs text-zinc-400 font-bold pointer-events-none">
                Bs/$
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 mt-0.5 block">
              Tasa oficial actual: {formatNumber(tasaActual)} Bs/$. Editable si el cierre aplicó otra tasa.
            </span>
          </div>

          {/* 4 Inputs de Venta */}
          <div className="border border-zinc-200 rounded-xl p-3 bg-zinc-50/50 space-y-2.5">
            <span className="block text-xs font-bold text-[#18181B] uppercase tracking-wide">
              Montos de Venta del Cierre
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Efectivo Bs */}
              <div className="p-2.5 bg-white border border-zinc-200 rounded-lg">
                <label className="flex items-center justify-between text-xs font-bold text-[#18181B] mb-1">
                  <span className="flex items-center gap-1.5">
                    <Banknote size={14} className="text-[#166534]" />
                    <span>Efectivo (Bs)</span>
                  </span>
                </label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={montoEfectivoBs}
                  onChange={(e) => setMontoEfectivoBs(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2 text-xs font-mono font-bold border border-zinc-300 rounded bg-white text-[#18181B] focus:ring-1 focus:ring-[#2C474E] focus:outline-none"
                />
              </div>

              {/* Pago Móvil Bs */}
              <div className="p-2.5 bg-white border border-zinc-200 rounded-lg">
                <label className="flex items-center justify-between text-xs font-bold text-[#18181B] mb-1">
                  <span className="flex items-center gap-1.5">
                    <Smartphone size={14} className="text-[#2563EB]" />
                    <span>Pago Móvil (Bs)</span>
                  </span>
                </label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={montoPagoMovilBs}
                  onChange={(e) => setMontoPagoMovilBs(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2 text-xs font-mono font-bold border border-zinc-300 rounded bg-white text-[#18181B] focus:ring-1 focus:ring-[#2C474E] focus:outline-none"
                />
              </div>

              {/* Punto de Venta Bs */}
              <div className="p-2.5 bg-white border border-zinc-200 rounded-lg">
                <label className="flex items-center justify-between text-xs font-bold text-[#18181B] mb-1">
                  <span className="flex items-center gap-1.5">
                    <CreditCard size={14} className="text-[#7C3AED]" />
                    <span>Punto de Venta (Bs)</span>
                  </span>
                </label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={montoPuntoVentaBs}
                  onChange={(e) => setMontoPuntoVentaBs(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2 text-xs font-mono font-bold border border-zinc-300 rounded bg-white text-[#18181B] focus:ring-1 focus:ring-[#2C474E] focus:outline-none"
                />
              </div>

              {/* Divisas $ */}
              <div className="p-2.5 bg-white border border-zinc-200 rounded-lg">
                <label className="flex items-center justify-between text-xs font-bold text-[#18181B] mb-1">
                  <span className="flex items-center gap-1.5">
                    <CircleDollarSign size={14} className="text-[#059669]" />
                    <span>Divisas ($ efectivo)</span>
                  </span>
                </label>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={montoDivisasUSD}
                  onChange={(e) => setMontoDivisasUSD(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2 text-xs font-mono font-bold border border-zinc-300 rounded bg-white text-[#18181B] focus:ring-1 focus:ring-[#2C474E] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Resumen en vivo */}
          <div className="p-3 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="text-[11px] font-semibold text-[#065F46] block">
                Total Vendido ($):
              </span>
              <div className="text-lg sm:text-xl font-black font-mono text-[#065F46] tabular-nums">
                {formatUSD(totalVendidoUSD)}
              </div>
              <span className="text-[10px] text-[#047857]">
                Equivalente: {formatVES(totalBs + divUSD * tasaNum)}
              </span>
            </div>

            <div className="text-right">
              <span className="text-[11px] font-semibold text-[#065F46] block">
                Comisión Puesto ({comisionPorcentaje}%):
              </span>
              <div className="text-base sm:text-lg font-black font-mono text-[#047857] tabular-nums">
                ({formatUSD(comisionUSD)})
              </div>
              <span className="text-[10px] text-[#059669]">
                Sobre venta bruta
              </span>
            </div>
          </div>

          {/* Footer de Acciones */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="px-4 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="px-4 py-2 text-xs font-bold bg-[#166534] hover:bg-[#14532d] active:bg-[#0f3d21] text-white rounded-lg flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {guardando ? (
                <>
                  <Loader2 size={14} className="animate-spin text-white" />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} className="text-[#86EFAC]" />
                  <span>
                    {tieneCierrePrevio ? 'Actualizar Cierre de Puesto' : 'Guardar Cierre de Puesto'}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
