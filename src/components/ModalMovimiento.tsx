import React, { useState, useEffect } from 'react';
import {
  X,
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
  Tag,
  Layers,
} from 'lucide-react';
import {
  CategoriaMovimiento,
  CATEGORIAS_GASTO,
  MetodoPago,
  Movimiento,
  NaturalezaMovimiento,
  normalizarCategoriaGasto,
  Puesto,
  TipoMovimiento,
} from '../types';
import { formatNumber, limpiarInputDecimal } from '../utils/format';
import { getVenezuelaDate } from '../utils/parserLocal';
import { supabaseUrl, supabaseAnonKey, getAccessTokenFromStorage } from '../lib/supabase';

export interface CambioModalInfo {
  accion: 'creado' | 'actualizado' | 'mixto';
  eliminadoId?: string | null;
  registros: Movimiento[];
}

interface Props {
  isOpen: boolean;
  movimientoAEditar?: Movimiento | null;
  grupoMixtoEditar?: Movimiento[] | null;
  tasaActual: number;
  soloVenta?: boolean;
  puestos?: Puesto[];
  puestoIdPorDefecto?: string | null;
  onClose: () => void;
  onGuardar?: (movimiento: Omit<Movimiento, 'id' | 'created_at'> & { id?: string }) => Promise<void>;
  onRecargarDatos?: () => Promise<void>;
  onCambioCompletado?: (info: CambioModalInfo) => void;
}

type ModoRegistro = 'gastos' | 'personal' | 'ventas';
type MetodoPagoFormulario = MetodoPago | 'pago_mixto';

const normalizarMetodoPago = (raw?: string): MetodoPago => {
  const norm = (raw || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (norm.includes('divisa') || norm.includes('dolar') || norm.includes('usd') || norm === '$') {
    return 'divisa';
  }
  if (norm.includes('efectivo')) {
    return 'efectivo_bs';
  }
  if (norm.includes('punto') || norm === 'pos' || norm.includes('tarjeta')) {
    return 'punto_venta';
  }
  return 'pago_movil';
};

export const ModalMovimiento: React.FC<Props> = ({
  isOpen,
  movimientoAEditar,
  grupoMixtoEditar,
  tasaActual,
  soloVenta = false,
  puestos = [],
  puestoIdPorDefecto = null,
  onClose,
  onGuardar,
  onRecargarDatos,
  onCambioCompletado,
}) => {
  const fechaHoyVzla = getVenezuelaDate();

  const [modo, setModo] = useState<ModoRegistro>(soloVenta ? 'ventas' : 'gastos');
  const [puestoId, setPuestoId] = useState<string>('');
  const [fecha, setFecha] = useState<string>(fechaHoyVzla);
  const [metodoPago, setMetodoPago] = useState<MetodoPagoFormulario>('pago_movil');
  const [categoriaGasto, setCategoriaGasto] = useState<CategoriaMovimiento>('Materia Prima');
  const [descripcion, setDescripcion] = useState<string>('');
  const [monto, setMonto] = useState<string>('');
  const [tasaAplicada, setTasaAplicada] = useState<string>(
    tasaActual > 0 ? tasaActual.toString() : '100'
  );

  // Montos por bolsillo para Pago Mixto
  const [montoBancoBs, setMontoBancoBs] = useState<string>('');
  const [montoEfectivoBs, setMontoEfectivoBs] = useState<string>('');
  const [montoDivisasUsd, setMontoDivisasUsd] = useState<string>('');

  const [guardando, setGuardando] = useState(false);
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const hoyVzla = getVenezuelaDate();
    if (grupoMixtoEditar && grupoMixtoEditar.length > 0) {
      const base = grupoMixtoEditar[0];
      const esPersonal =
        base.naturaleza === 'Personal' ||
        base.categoria === 'Personal / Ocio / Regalos' ||
        base.categoria === 'Comidas y Bebidas';

      setModo(esPersonal ? 'personal' : 'gastos');
      setPuestoId(base.puesto_id || '');
      setFecha(base.fecha || hoyVzla);
      setMetodoPago('pago_mixto');
      const catInicial = normalizarCategoriaGasto(
        base.categoria,
        esPersonal ? 'Personal / Ocio / Regalos' : 'Materia Prima'
      );
      setCategoriaGasto(catInicial);
      setDescripcion(
        (base.descripcion || '').replace(/\s*\(Pago Mixto\)\s*$/i, '').trim()
      );
      setMonto('');

      const tasaInit =
        Number(base.tasa_aplicada) ||
        Number(base.tasa) ||
        (tasaActual > 0 ? tasaActual : 100);
      setTasaAplicada(String(tasaInit));

      let bancoBs = 0;
      let efectivoBs = 0;
      let divisasUsd = 0;

      for (const item of grupoMixtoEditar) {
        const mNorm = normalizarMetodoPago(item.metodo_pago);
        const orig = Number(item.monto_original) || 0;
        if (mNorm === 'pago_movil' || mNorm === 'punto_venta') {
          bancoBs +=
            Number(item.monto_bs) ||
            (item.moneda_original === 'VES' ? orig : orig * tasaInit);
        } else if (mNorm === 'efectivo_bs') {
          efectivoBs +=
            Number(item.monto_bs) ||
            (item.moneda_original === 'VES' ? orig : orig * tasaInit);
        } else if (mNorm === 'divisa') {
          divisasUsd +=
            Number(item.monto_usd) ||
            (item.moneda_original === 'USD' ? orig : tasaInit > 0 ? orig / tasaInit : 0);
        }
      }

      setMontoBancoBs(
        bancoBs > 0 ? String(Math.round(bancoBs * 100) / 100) : ''
      );
      setMontoEfectivoBs(
        efectivoBs > 0 ? String(Math.round(efectivoBs * 100) / 100) : ''
      );
      setMontoDivisasUsd(
        divisasUsd > 0 ? String(Math.round(divisasUsd * 100) / 100) : ''
      );
    } else if (movimientoAEditar) {
      const esVenta =
        movimientoAEditar.tipo === 'venta' || movimientoAEditar.tipo === 'ingreso';
      const esPersonal =
        !esVenta &&
        (movimientoAEditar.naturaleza === 'Personal' ||
          movimientoAEditar.categoria === 'Personal / Ocio / Regalos' ||
          movimientoAEditar.categoria === 'Comidas y Bebidas');

      setModo(esVenta ? 'ventas' : esPersonal ? 'personal' : 'gastos');
      setPuestoId(movimientoAEditar.puesto_id || '');
      setFecha(movimientoAEditar.fecha || hoyVzla);
      setMetodoPago(normalizarMetodoPago(movimientoAEditar.metodo_pago));
      const catAEditar = normalizarCategoriaGasto(
        movimientoAEditar.categoria,
        esPersonal ? 'Personal / Ocio / Regalos' : 'Materia Prima'
      );
      setCategoriaGasto(catAEditar);
      setDescripcion(movimientoAEditar.descripcion || '');
      setMonto(
        movimientoAEditar.monto_original !== undefined &&
          movimientoAEditar.monto_original !== null
          ? String(movimientoAEditar.monto_original)
          : ''
      );
      const tasaInit =
        Number(movimientoAEditar.tasa_aplicada) ||
        Number(movimientoAEditar.tasa) ||
        (tasaActual > 0 ? tasaActual : 100);
      setTasaAplicada(String(tasaInit));
      setMontoBancoBs('');
      setMontoEfectivoBs('');
      setMontoDivisasUsd('');
    } else {
      setModo(soloVenta ? 'ventas' : 'gastos');
      setPuestoId(puestoIdPorDefecto || '');
      setFecha(hoyVzla);
      setMetodoPago('pago_movil');
      setCategoriaGasto(soloVenta ? 'Ventas' : 'Materia Prima');
      setDescripcion('');
      setMonto('');
      setTasaAplicada(String(tasaActual > 0 ? tasaActual : 100));
      setMontoBancoBs('');
      setMontoEfectivoBs('');
      setMontoDivisasUsd('');
    }

    setErrorMensaje(null);
  }, [movimientoAEditar, grupoMixtoEditar, isOpen, tasaActual, soloVenta, puestoIdPorDefecto]);

  if (!isOpen) return null;

  const esEdicionMixto = Boolean(grupoMixtoEditar && grupoMixtoEditar.length > 0);
  const esEdicion = Boolean(movimientoAEditar?.id || esEdicionMixto);
  const esEdicionFechaAnterior = Boolean(
    esEdicion && fecha && fecha < fechaHoyVzla
  );

  // Tasa efectiva para cálculos en vivo y guardado
  const tasaParsed = parseFloat(tasaAplicada.replace(',', '.'));
  const tasaSegura =
    !isNaN(tasaParsed) && tasaParsed > 0
      ? tasaParsed
      : tasaActual > 0
      ? tasaActual
      : 100;

  // Cálculos en vivo para Pago Simple
  const montoNumerico = parseFloat(monto.replace(',', '.')) || 0;
  const esDolar = metodoPago === 'divisa';
  const montoEquivalente = esDolar
    ? montoNumerico * tasaSegura
    : tasaSegura > 0
    ? montoNumerico / tasaSegura
    : 0;

  // Cálculos en vivo para Pago Mixto
  const numBancoBs = parseFloat(montoBancoBs.replace(',', '.')) || 0;
  const numEfectivoBs = parseFloat(montoEfectivoBs.replace(',', '.')) || 0;
  const numDivisasUsd = parseFloat(montoDivisasUsd.replace(',', '.')) || 0;
  const totalMixtoBs = numBancoBs + numEfectivoBs + numDivisasUsd * tasaSegura;
  const totalMixtoUsd = tasaSegura > 0 ? totalMixtoBs / tasaSegura : 0;

  // Categorías filtradas según modo
  const categoriasFiltradas = CATEGORIAS_GASTO.filter((c) =>
    modo === 'personal' ? c.naturaleza === 'Personal' : c.naturaleza === 'Negocio'
  );
  const categoriaActualEnLista = categoriasFiltradas.some(
    (c) => c.nombre === categoriaGasto
  );

  // Sugerencias rápidas
  const sugerencias: Record<ModoRegistro, string[]> = {
    gastos: [
      'Hielo',
      'Vasos',
      'Materia prima',
      'Transporte',
      'Cuota negocio',
      'Emergencia / Arreglo',
    ],
    personal: [
      'Retiro personal Ynaides',
      'Almuerzo / Comida',
      'Gasto personal',
      'Ocio / Varios',
    ],
    ventas: ['Venta del día', 'Venta especial evento', 'Venta mayor'],
  };

  // Cambiar a Pago Mixto precargando automáticamente el bolsillo que ya tenía monto
  const handleSeleccionarPagoMixto = () => {
    setErrorMensaje(null);

    const yaTieneMontosMixtos =
      Boolean(montoBancoBs.trim()) ||
      Boolean(montoEfectivoBs.trim()) ||
      Boolean(montoDivisasUsd.trim());

    if (!yaTieneMontosMixtos && metodoPago !== 'pago_mixto') {
      const valorRaw =
        monto.trim() ||
        (movimientoAEditar && movimientoAEditar.monto_original
          ? String(movimientoAEditar.monto_original)
          : '');
      const valorNum = parseFloat(valorRaw.replace(',', '.')) || 0;

      if (valorNum > 0) {
        const esUsdOriginal =
          movimientoAEditar?.moneda_original === 'USD' ||
          movimientoAEditar?.moneda === 'USD';

        if (metodoPago === 'pago_movil' || metodoPago === 'punto_venta') {
          const valorBs =
            esUsdOriginal && movimientoAEditar
              ? movimientoAEditar.monto_bs ?? Math.round(valorNum * tasaSegura * 100) / 100
              : valorNum;
          setMontoBancoBs(String(valorBs));
        } else if (metodoPago === 'efectivo_bs') {
          const valorBs =
            esUsdOriginal && movimientoAEditar
              ? movimientoAEditar.monto_bs ?? Math.round(valorNum * tasaSegura * 100) / 100
              : valorNum;
          setMontoEfectivoBs(String(valorBs));
        } else if (metodoPago === 'divisa') {
          const valorUsd =
            !esUsdOriginal && movimientoAEditar && movimientoAEditar.moneda_original === 'VES'
              ? movimientoAEditar.monto_usd ??
                Math.round((valorNum / tasaSegura) * 100) / 100
              : valorNum;
          setMontoDivisasUsd(String(valorUsd));
        }
      }
    }

    setMetodoPago('pago_mixto');
  };

  const handleSeleccionarModo = (nuevoModo: ModoRegistro) => {
    if (soloVenta && nuevoModo !== 'ventas') return;
    setModo(nuevoModo);
    setErrorMensaje(null);

    if (nuevoModo === 'ventas') {
      if (metodoPago === 'pago_mixto') setMetodoPago('pago_movil');
    } else if (nuevoModo === 'personal') {
      const esCatPersonal = CATEGORIAS_GASTO.some(
        (c) => c.nombre === categoriaGasto && c.naturaleza === 'Personal'
      );
      if (!esCatPersonal) setCategoriaGasto('Personal / Ocio / Regalos');
    } else {
      const esCatNegocio = CATEGORIAS_GASTO.some(
        (c) => c.nombre === categoriaGasto && c.naturaleza === 'Negocio'
      );
      if (!esCatNegocio) setCategoriaGasto('Materia Prima');
    }
  };

  const extraerErrorResponse = async (res: Response, fallback: string): Promise<string> => {
    try {
      const errJson = await res.json();
      return errJson?.message || errJson?.error_description || errJson?.error || fallback;
    } catch {
      try {
        const txt = await res.text();
        if (txt) return txt;
      } catch {}
    }
    return fallback;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMensaje(null);

    if (!descripcion.trim()) {
      setErrorMensaje('Por favor escribe el concepto o descripción del movimiento.');
      return;
    }

    if (isNaN(tasaParsed) || tasaParsed <= 0) {
      setErrorMensaje('Por favor ingresa una tasa BCV válida mayor a 0.');
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
      catMov = categoriaGasto || 'Personal / Ocio / Regalos';
    } else {
      tipoMov = 'gasto';
      natMov = 'Negocio';
      catMov = categoriaGasto || 'Materia Prima';
    }

    const token = getAccessTokenFromStorage() || supabaseAnonKey;
    const headersJson = {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      Prefer: 'return=representation',
    };

    const esPagoMixto =
      metodoPago === 'pago_mixto' && (modo === 'gastos' || modo === 'personal');

    // =========================================================================
    // CASO 1: PAGO MIXTO (Creación o Edición convirtiendo el registro original)
    // =========================================================================
    if (esPagoMixto) {
      const numBanco = parseFloat(montoBancoBs.replace(',', '.')) || 0;
      const numEfectivo = parseFloat(montoEfectivoBs.replace(',', '.')) || 0;
      const numDivisas = parseFloat(montoDivisasUsd.replace(',', '.')) || 0;

      const camposConMonto =
        (numBanco > 0 ? 1 : 0) + (numEfectivo > 0 ? 1 : 0) + (numDivisas > 0 ? 1 : 0);
      if (camposConMonto === 0 || numBanco + numEfectivo + numDivisas <= 0) {
        setErrorMensaje(
          'Por favor ingresa un monto válido mayor a 0 en al menos uno de los bolsillos.'
        );
        return;
      }

      const descConSufijo = descripcion.trim().toLowerCase().includes('pago mixto')
        ? descripcion.trim()
        : `${descripcion.trim()} (Pago Mixto)`;

      const itemsAInsertar: Record<string, any>[] = [];

      if (numBanco > 0) {
        const mBs = Math.round(numBanco * 100) / 100;
        const mUsd = Math.round((numBanco / tasaSegura) * 100) / 100;
        itemsAInsertar.push({
          id: crypto.randomUUID
            ? crypto.randomUUID()
            : `mov_${Date.now()}_b_${Math.random().toString(36).substring(2, 6)}`,
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
          ...(movimientoAEditar?.creado_por ? { creado_por: movimientoAEditar.creado_por } : {}),
          ...(movimientoAEditar?.user_id ? { user_id: movimientoAEditar.user_id } : {}),
        });
      }

      if (numEfectivo > 0) {
        const mBs = Math.round(numEfectivo * 100) / 100;
        const mUsd = Math.round((numEfectivo / tasaSegura) * 100) / 100;
        itemsAInsertar.push({
          id: crypto.randomUUID
            ? crypto.randomUUID()
            : `mov_${Date.now()}_e_${Math.random().toString(36).substring(2, 6)}`,
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
          ...(movimientoAEditar?.creado_por ? { creado_por: movimientoAEditar.creado_por } : {}),
          ...(movimientoAEditar?.user_id ? { user_id: movimientoAEditar.user_id } : {}),
        });
      }

      if (numDivisas > 0) {
        const mUsd = Math.round(numDivisas * 100) / 100;
        const mBs = Math.round(numDivisas * tasaSegura * 100) / 100;
        itemsAInsertar.push({
          id: crypto.randomUUID
            ? crypto.randomUUID()
            : `mov_${Date.now()}_d_${Math.random().toString(36).substring(2, 6)}`,
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
          ...(movimientoAEditar?.creado_por ? { creado_por: movimientoAEditar.creado_por } : {}),
          ...(movimientoAEditar?.user_id ? { user_id: movimientoAEditar.user_id } : {}),
        });
      }

      setGuardando(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        // Si estamos editando (un movimiento individual o un grupo mixto), eliminamos primero los registros anteriores para evitar duplicados
        if (esEdicionMixto && grupoMixtoEditar) {
          const idsAEliminar = grupoMixtoEditar.map((m) => m.id).filter(Boolean);
          if (idsAEliminar.length > 0) {
            const resDeleteGrupo = await fetch(
              `${supabaseUrl}/rest/v1/movimientos?id=in.(${idsAEliminar.join(',')})`,
              {
                method: 'DELETE',
                headers: {
                  apikey: supabaseAnonKey,
                  Authorization: `Bearer ${token}`,
                },
                signal: controller.signal,
              }
            );

            if (!resDeleteGrupo.ok) {
              const errMsg = await extraerErrorResponse(
                resDeleteGrupo,
                `Error ${resDeleteGrupo.status} al eliminar los registros anteriores del pago mixto`
              );
              throw new Error(errMsg);
            }
          }
        } else if (esEdicion && movimientoAEditar?.id) {
          const resDelete = await fetch(
            `${supabaseUrl}/rest/v1/movimientos?id=eq.${movimientoAEditar.id}`,
            {
              method: 'DELETE',
              headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
              },
              signal: controller.signal,
            }
          );

          if (!resDelete.ok) {
            const errMsg = await extraerErrorResponse(
              resDelete,
              `Error ${resDelete.status} al eliminar el movimiento original`
            );
            throw new Error(errMsg);
          }
        }

        // Insertar los nuevos registros divididos por bolsillo
        const resPost = await fetch(`${supabaseUrl}/rest/v1/movimientos`, {
          method: 'POST',
          headers: headersJson,
          body: JSON.stringify(itemsAInsertar),
          signal: controller.signal,
        });

        if (!resPost.ok) {
          const errMsg = await extraerErrorResponse(
            resPost,
            `Error ${resPost.status} al guardar el pago mixto`
          );
          throw new Error(errMsg);
        }

        const dataPost = await resPost.json();
        const registrosGuardados: Movimiento[] =
          Array.isArray(dataPost) && dataPost.length > 0
            ? dataPost
            : (itemsAInsertar as Movimiento[]);

        onCambioCompletado?.({
          accion: 'mixto',
          eliminadoId: esEdicion ? movimientoAEditar?.id || null : null,
          registros: registrosGuardados,
        });

        if (onRecargarDatos) {
          await onRecargarDatos();
        }

        onClose();
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          setErrorMensaje('Tiempo de espera agotado (8s). Verificá tu conexión e intentá nuevamente.');
        } else {
          setErrorMensaje(err?.message || 'Error al guardar el pago mixto.');
        }
      } finally {
        clearTimeout(timeoutId);
        setGuardando(false);
      }
      return;
    }

    // =========================================================================
    // CASO 2: PAGO SIMPLE (Edición vía PATCH o Creación vía POST)
    // =========================================================================
    const mNum = parseFloat(monto.replace(',', '.'));
    if (isNaN(mNum) || mNum <= 0) {
      setErrorMensaje('Por favor ingresa un monto válido mayor a 0.');
      return;
    }

    const metodoFinal = metodoPago as MetodoPago;
    const monedaOriginal: 'USD' | 'VES' = metodoFinal === 'divisa' ? 'USD' : 'VES';
    const montoBs =
      monedaOriginal === 'USD' ? Math.round(mNum * tasaSegura * 100) / 100 : mNum;
    const montoUSD =
      monedaOriginal === 'USD'
        ? mNum
        : Math.round((mNum / tasaSegura) * 100) / 100;

    setGuardando(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      if (esEdicionMixto && grupoMixtoEditar) {
        const idsAEliminar = grupoMixtoEditar.map((m) => m.id).filter(Boolean);
        if (idsAEliminar.length > 0) {
          const resDeleteGrupo = await fetch(
            `${supabaseUrl}/rest/v1/movimientos?id=in.(${idsAEliminar.join(',')})`,
            {
              method: 'DELETE',
              headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
              },
              signal: controller.signal,
            }
          );

          if (!resDeleteGrupo.ok) {
            const errMsg = await extraerErrorResponse(
              resDeleteGrupo,
              `Error ${resDeleteGrupo.status} al reemplazar el pago mixto`
            );
            throw new Error(errMsg);
          }
        }

        const nuevoId = crypto.randomUUID
          ? crypto.randomUUID()
          : `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const postPayload = {
          id: nuevoId,
          fecha,
          descripcion: descripcion.trim(),
          tipo: tipoMov,
          naturaleza: natMov,
          categoria: catMov,
          metodo_pago: metodoFinal,
          moneda_original: monedaOriginal,
          moneda: monedaOriginal,
          monto_original: mNum,
          monto_bs: montoBs,
          monto_usd: montoUSD,
          tasa_aplicada: tasaSegura,
          tasa: tasaSegura,
          puesto_id: puestoId || null,
        };

        const resPost = await fetch(`${supabaseUrl}/rest/v1/movimientos`, {
          method: 'POST',
          headers: headersJson,
          body: JSON.stringify([postPayload]),
          signal: controller.signal,
        });

        if (!resPost.ok) {
          const errMsg = await extraerErrorResponse(
            resPost,
            `Error ${resPost.status} al guardar el movimiento`
          );
          throw new Error(errMsg);
        }

        const dataPost = await resPost.json();
        const creados: Movimiento[] =
          Array.isArray(dataPost) && dataPost.length > 0
            ? dataPost
            : [postPayload as Movimiento];

        onCambioCompletado?.({
          accion: 'creado',
          registros: creados,
        });

        if (onRecargarDatos) {
          await onRecargarDatos();
        }

        onClose();
      } else if (esEdicion && movimientoAEditar?.id) {
        const patchPayload = {
          fecha,
          descripcion: descripcion.trim(),
          tipo: tipoMov,
          naturaleza: natMov,
          categoria: catMov,
          metodo_pago: metodoFinal,
          moneda_original: monedaOriginal,
          moneda: monedaOriginal,
          monto_original: mNum,
          monto_bs: montoBs,
          monto_usd: montoUSD,
          tasa_aplicada: tasaSegura,
          tasa: tasaSegura,
          puesto_id: puestoId || null,
        };

        const resPatch = await fetch(
          `${supabaseUrl}/rest/v1/movimientos?id=eq.${movimientoAEditar.id}`,
          {
            method: 'PATCH',
            headers: headersJson,
            body: JSON.stringify(patchPayload),
            signal: controller.signal,
          }
        );

        if (!resPatch.ok) {
          const errMsg = await extraerErrorResponse(
            resPatch,
            `Error ${resPatch.status} al actualizar el movimiento`
          );
          throw new Error(errMsg);
        }

        const dataPatch = await resPatch.json();
        const actualizado: Movimiento =
          Array.isArray(dataPatch) && dataPatch.length > 0
            ? dataPatch[0]
            : ({ ...movimientoAEditar, ...patchPayload } as Movimiento);

        onCambioCompletado?.({
          accion: 'actualizado',
          eliminadoId: movimientoAEditar.id,
          registros: [actualizado],
        });

        if (onRecargarDatos) {
          await onRecargarDatos();
        } else if (onGuardar) {
          // Solo si el padre no proveyó onRecargarDatos, no re-invocamos DB: onCambioCompletado ya actualiza estado local
        }

        onClose();
      } else {
        const nuevoId = crypto.randomUUID
          ? crypto.randomUUID()
          : `mov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const postPayload = {
          id: nuevoId,
          fecha,
          descripcion: descripcion.trim(),
          tipo: tipoMov,
          naturaleza: natMov,
          categoria: catMov,
          metodo_pago: metodoFinal,
          moneda_original: monedaOriginal,
          moneda: monedaOriginal,
          monto_original: mNum,
          monto_bs: montoBs,
          monto_usd: montoUSD,
          tasa_aplicada: tasaSegura,
          tasa: tasaSegura,
          puesto_id: puestoId || null,
        };

        const resPost = await fetch(`${supabaseUrl}/rest/v1/movimientos`, {
          method: 'POST',
          headers: headersJson,
          body: JSON.stringify([postPayload]),
          signal: controller.signal,
        });

        if (!resPost.ok) {
          if (onGuardar && resPost.status >= 500) {
            const { id: _omitId, ...sinIdPayload } = postPayload;
            await onGuardar(sinIdPayload);
            onClose();
            return;
          }
          const errMsg = await extraerErrorResponse(
            resPost,
            `Error ${resPost.status} al crear el movimiento`
          );
          throw new Error(errMsg);
        }

        const dataPost = await resPost.json();
        const creados: Movimiento[] =
          Array.isArray(dataPost) && dataPost.length > 0
            ? dataPost
            : [postPayload as Movimiento];

        onCambioCompletado?.({
          accion: 'creado',
          registros: creados,
        });

        if (onRecargarDatos) {
          await onRecargarDatos();
        }

        onClose();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setErrorMensaje('Tiempo de espera agotado (8s). Verificá tu conexión e intentá nuevamente.');
      } else {
        setErrorMensaje(err?.message || 'Error guardando el movimiento.');
      }
    } finally {
      clearTimeout(timeoutId);
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl border border-zinc-200 w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Encabezado Modal */}
        <div className="bg-[#1E3A3A] text-white px-4 sm:px-5 py-3.5 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-sm sm:text-base tracking-tight leading-tight">
              {esEdicionMixto
                ? 'Editar Pago Mixto'
                : esEdicion
                ? 'Editar Movimiento'
                : soloVenta
                ? 'Registrar Venta'
                : 'Nuevo Movimiento'}
            </h2>
            <p className="text-[11px] text-[#86EFAC]/90 font-medium">
              Tasa BCV: {formatNumber(tasaSegura)} Bs/$
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Cuerpo Scrollable con la estética de la pestaña Registrar */}
        <form
          onSubmit={handleSubmit}
          className="overflow-y-auto p-4 sm:p-5 space-y-4 sm:space-y-5 text-[#18181B]"
        >
          {/* 1. Selector superior de 3 tarjetas: Gastos, Personal, Ventas */}
          {!soloVenta && (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-2">
                Tipo de Movimiento
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                {/* GASTOS */}
                <button
                  type="button"
                  onClick={() => handleSeleccionarModo('gastos')}
                  className={`min-h-[54px] flex flex-col items-center justify-center py-2.5 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    modo === 'gastos'
                      ? 'border-[#EF4444] bg-[#FEF2F2] text-[#991B1B] font-bold shadow-xs ring-1 ring-[#EF4444]'
                      : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <TrendingDown
                      size={16}
                      className={modo === 'gastos' ? 'text-[#DC2626]' : 'text-zinc-400'}
                    />
                    <span className="text-xs sm:text-sm">Gastos</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 mt-0.5">Negocio</span>
                </button>

                {/* PERSONAL */}
                <button
                  type="button"
                  onClick={() => handleSeleccionarModo('personal')}
                  className={`min-h-[54px] flex flex-col items-center justify-center py-2.5 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    modo === 'personal'
                      ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#92400E] font-bold shadow-xs ring-1 ring-[#F59E0B]'
                      : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <User
                      size={16}
                      className={modo === 'personal' ? 'text-[#D97706]' : 'text-zinc-400'}
                    />
                    <span className="text-xs sm:text-sm">Personal</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 mt-0.5">Retiros</span>
                </button>

                {/* VENTAS */}
                <button
                  type="button"
                  onClick={() => handleSeleccionarModo('ventas')}
                  className={`min-h-[54px] flex flex-col items-center justify-center py-2.5 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    modo === 'ventas'
                      ? 'border-[#10B981] bg-[#ECFDF5] text-[#065F46] font-bold shadow-xs ring-1 ring-[#10B981]'
                      : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 font-medium'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <TrendingUp
                      size={16}
                      className={modo === 'ventas' ? 'text-[#059669]' : 'text-zinc-400'}
                    />
                    <span className="text-xs sm:text-sm">Ventas</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 mt-0.5">Ingresos</span>
                </button>
              </div>
            </div>
          )}

          {/* 2. Selectores limpios de Puesto de Venta y Fecha */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {!soloVenta && (
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
                  className="w-full min-h-[44px] px-3 py-2 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
                >
                  <option value="">Sin puesto específico (General)</option>
                  {puestos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} {p.activo === false ? '(Inactivo)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={soloVenta ? 'sm:col-span-2' : ''}>
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
                className="w-full min-h-[44px] px-3 py-2 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
              />
            </div>
          </div>

          {/* 3. Selector de Método de Pago con botones táctiles y botón ancho Pago Mixto */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-2">
              Método de Pago
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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

              {/* Efectivo (Bs) */}
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

              {/* Botón ancho Pago Mixto (Solo para Gastos y Personal) */}
              {(modo === 'gastos' || modo === 'personal') && (
                <button
                  type="button"
                  onClick={handleSeleccionarPagoMixto}
                  className={`col-span-2 sm:col-span-4 min-h-[44px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border text-xs transition-all cursor-pointer ${
                    metodoPago === 'pago_mixto'
                      ? 'border-[#2C474E] bg-[#2C474E] text-white font-bold shadow-xs'
                      : 'border-zinc-200/80 bg-zinc-50/80 text-zinc-700 hover:bg-zinc-100 font-semibold'
                  }`}
                >
                  <Layers
                    size={15}
                    className={metodoPago === 'pago_mixto' ? 'text-[#86EFAC]' : 'text-[#1E3A3A]'}
                  />
                  <span>Pago Mixto (Combinar Banco, Efectivo y/o Divisas)</span>
                </button>
              )}
            </div>
          </div>

          {/* 4. Selector de Categoría (oculto si es Ventas) */}
          {modo !== 'ventas' && !soloVenta && (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Tag size={13} />
                  Categoría
                </span>
              </label>
              <select
                value={categoriaGasto}
                onChange={(e) => setCategoriaGasto(e.target.value as CategoriaMovimiento)}
                className="w-full min-h-[44px] px-3 py-2 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
              >
                {!categoriaActualEnLista && categoriaGasto && (
                  <option value={categoriaGasto}>{categoriaGasto}</option>
                )}
                {categoriasFiltradas.map((c) => (
                  <option key={c.nombre} value={c.nombre}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 5. Monto(s) */}
          {metodoPago === 'pago_mixto' && (modo === 'gastos' || modo === 'personal') ? (
            /* Modo Pago Mixto: 3 bolsillos + resumen en vivo */
            <div className="space-y-3 p-3.5 bg-zinc-50/70 border border-zinc-200/90 rounded-2xl">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold text-[#18181B] flex items-center gap-1.5">
                  <Layers size={14} className="text-[#2C474E]" />
                  <span>Distribución por Bolsillo</span>
                </label>
                <span className="text-[11px] text-zinc-500 font-medium">
                  Llena 2 o los 3 bolsillos
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* Banco / Pago Móvil (Bs) */}
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
                      className="w-full min-h-[42px] pl-9 pr-2.5 py-2 text-sm font-bold border border-zinc-200 rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A] tabular-nums"
                    />
                  </div>
                </div>

                {/* Efectivo (Bs) */}
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
                      className="w-full min-h-[42px] pl-9 pr-2.5 py-2 text-sm font-bold border border-zinc-200 rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A] tabular-nums"
                    />
                  </div>
                </div>

                {/* Divisas ($ USD) */}
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
                      className="w-full min-h-[42px] pl-7 pr-2.5 py-2 text-sm font-bold border border-zinc-200 rounded-lg bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A] tabular-nums"
                    />
                  </div>
                </div>
              </div>

              {/* Resumen en vivo del Total Combinado */}
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
                    ${formatNumber(totalMixtoUsd)}{' '}
                    <span className="text-xs font-bold text-zinc-500">USD</span>
                  </div>
                  <div className="text-xs font-semibold text-zinc-500 tabular-nums">
                    ≈ Bs. {formatNumber(totalMixtoBs)}
                  </div>
                </div>
              </div>

              {esEdicionFechaAnterior && (
                <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-zinc-500">
                  <span>Tasa histórica aplicada (Bs/$):</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={tasaAplicada}
                    onChange={(e) => setTasaAplicada(limpiarInputDecimal(e.target.value))}
                    className="w-24 px-2 py-1 text-xs font-mono font-bold text-right border border-zinc-200 rounded-lg bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#1E3A3A] tabular-nums"
                  />
                </div>
              )}
            </div>
          ) : (
            /* Modo Un Solo Método: input de monto con conversión automática en vivo */
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#18181B]">
                  {esDolar ? 'Monto en Divisas ($ USD)' : 'Monto en Bolívares (Bs)'}
                </label>
                {montoNumerico > 0 && (
                  <span className="text-[11px] font-semibold text-[#1E3A3A] tabular-nums bg-emerald-50 border border-emerald-200/70 px-2.5 py-0.5 rounded-full">
                    {esDolar
                      ? `≈ Bs. ${formatNumber(montoEquivalente)}`
                      : `≈ $ ${formatNumber(montoEquivalente)}`}
                  </span>
                )}
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

              {/* Campo discreto para ajustar la tasa solo si se edita un movimiento de una fecha anterior */}
              {esEdicionFechaAnterior && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-zinc-50 border border-zinc-200/70 rounded-xl text-[11px] text-zinc-500">
                  <span>Ajustar tasa aplicada (fecha anterior):</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={tasaAplicada}
                      onChange={(e) => setTasaAplicada(limpiarInputDecimal(e.target.value))}
                      className="w-24 px-2 py-1 text-xs font-mono font-bold text-right border border-zinc-200 rounded-lg bg-white text-[#18181B] focus:outline-none focus:ring-1 focus:ring-[#1E3A3A] tabular-nums"
                    />
                    <span className="text-[10px] font-semibold text-zinc-400">Bs/$</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 6. Campo de Descripción / Concepto */}
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
              className="w-full min-h-[44px] px-3.5 py-2.5 text-xs sm:text-sm border border-zinc-200 rounded-xl bg-[#FAFAFA] text-[#18181B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A3A]"
            />

            {/* Chips de sugerencias rápidas */}
            {!esEdicion && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {sugerencias[modo].map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => setDescripcion(sug)}
                    className="px-2.5 py-1 text-[11px] font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg transition-colors cursor-pointer"
                  >
                    + {sug}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Alerta de Error */}
          {errorMensaje && (
            <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMensaje}</span>
            </div>
          )}

          {/* Botones de Acción */}
          <div className="pt-2 flex items-center gap-2.5 border-t border-zinc-100">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="px-4 min-h-[46px] text-xs sm:text-sm font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className={`flex-1 min-h-[46px] px-4 py-2.5 text-xs sm:text-sm font-bold text-white rounded-xl flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ${
                modo === 'ventas'
                  ? 'bg-[#15803D] hover:bg-[#166534] active:bg-[#14532D]'
                  : modo === 'personal'
                  ? 'bg-[#D97706] hover:bg-[#B45309] active:bg-[#92400E]'
                  : 'bg-[#1E3A3A] hover:bg-[#172e2e] active:bg-[#102222]'
              } disabled:opacity-60`}
            >
              {guardando ? (
                <>
                  <Loader2 size={16} className="animate-spin text-white" />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>
                    {esEdicionMixto
                      ? metodoPago === 'pago_mixto'
                        ? 'Guardar Pago Mixto'
                        : 'Guardar Cambios'
                      : esEdicion
                      ? metodoPago === 'pago_mixto' && (modo === 'gastos' || modo === 'personal')
                        ? 'Convertir a Pago Mixto'
                        : 'Guardar Cambios'
                      : metodoPago === 'pago_mixto' && (modo === 'gastos' || modo === 'personal')
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
          </div>
        </form>
      </div>
    </div>
  );
};
