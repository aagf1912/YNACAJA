import React, { useState, useMemo, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  Calendar,
  DollarSign,
  TrendingUp,
  TrendingDown,
  PieChart as PieIcon,
  BarChart2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { toPng } from 'html-to-image';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Movimiento, CATEGORIAS_GASTO, NaturalezaMovimiento, CategoriaMovimiento } from '../types';
import { calcularMontos, formatNumber, formatPorcentaje, formatUSD, formatVES } from '../utils/format';
import { BadgeNaturaleza } from '../components/BadgeNaturaleza';

interface Props {
  movimientos: Movimiento[];
}

export const BalanceView: React.FC<Props> = ({ movimientos }) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [compartiendo, setCompartiendo] = useState(false);

  // Fecha base para la semana (por defecto hoy)
  const [fechaSemana, setFechaSemana] = useState<Date>(() => {
    const hoy = new Date();
    return hoy;
  });

  // Calcula lunes y domingo de la semana seleccionada
  const { lunes, domingo, diasSemana, rangoTexto } = useMemo(() => {
    const d = new Date(fechaSemana);
    const day = d.getDay(); // 0 es domingo
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const lunesDate = new Date(d.setDate(diff));
    lunesDate.setHours(0, 0, 0, 0);

    const dias: { fechaStr: string; nombreDia: string; dateObj: Date }[] = [];
    const nombresDias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

    for (let i = 0; i < 7; i++) {
      const cur = new Date(lunesDate);
      cur.setDate(lunesDate.getDate() + i);
      const yyyy = cur.getFullYear();
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      const dd = String(cur.getDate()).padStart(2, '0');
      dias.push({
        fechaStr: `${yyyy}-${mm}-${dd}`,
        nombreDia: nombresDias[i],
        dateObj: cur,
      });
    }

    const domingoDate = dias[6].dateObj;
    domingoDate.setHours(23, 59, 59, 999);

    // Texto formato: "16 AL 22 NOV 2026"
    const mesLunes = lunesDate.toLocaleString('es-VE', { month: 'short' }).toUpperCase().replace('.', '');
    const mesDomingo = domingoDate.toLocaleString('es-VE', { month: 'short' }).toUpperCase().replace('.', '');
    const anio = domingoDate.getFullYear();

    const rango =
      mesLunes === mesDomingo
        ? `${lunesDate.getDate()} AL ${domingoDate.getDate()} ${mesDomingo} ${anio}`
        : `${lunesDate.getDate()} ${mesLunes} AL ${domingoDate.getDate()} ${mesDomingo} ${anio}`;

    return {
      lunes: lunesDate,
      domingo: domingoDate,
      diasSemana: dias,
      rangoTexto: rango,
    };
  }, [fechaSemana]);

  // Movimientos dentro de la semana
  const movimientosSemana = useMemo(() => {
    const fechaInicioStr = diasSemana[0].fechaStr;
    const fechaFinStr = diasSemana[6].fechaStr;
    return movimientos.filter((m) => m.fecha >= fechaInicioStr && m.fecha <= fechaFinStr);
  }, [movimientos, diasSemana]);

  // 1. KPI Totales
  const { totalIngresosUSD, totalGastosUSD, balanceNetoUSD, totalIngresosBs, totalGastosBs, balanceNetoBs } =
    useMemo(() => {
      let ingUSD = 0;
      let gasUSD = 0;
      let ingBs = 0;
      let gasBs = 0;

      for (const m of movimientosSemana) {
        const { monto_usd, monto_bs } = calcularMontos(m);
        if (m.tipo === 'venta') {
          ingUSD += monto_usd;
          ingBs += monto_bs;
        } else {
          gasUSD += monto_usd;
          gasBs += monto_bs;
        }
      }

      return {
        totalIngresosUSD: ingUSD,
        totalGastosUSD: gasUSD,
        balanceNetoUSD: ingUSD - gasUSD,
        totalIngresosBs: ingBs,
        totalGastosBs: gasBs,
        balanceNetoBs: ingBs - gasBs,
      };
    }, [movimientosSemana]);

  // 2. Resumen de Ingresos por Método de Pago
  const ingresosPorMetodo = useMemo(() => {
    const metodos = {
      pago_movil: { bs: 0, usd: 0 },
      punto_venta: { bs: 0, usd: 0 },
      efectivo_bs: { bs: 0, usd: 0 },
      divisa: { bs: 0, usd: 0 },
    };

    for (const m of movimientosSemana) {
      if (m.tipo === 'venta') {
        const { monto_usd, monto_bs } = calcularMontos(m);
        if (metodos[m.metodo_pago]) {
          metodos[m.metodo_pago].bs += monto_bs;
          metodos[m.metodo_pago].usd += monto_usd;
        }
      }
    }

    return metodos;
  }, [movimientosSemana]);

  // 3. Tabla 1: Detalle Diario (7 filas Lunes a Domingo)
  const detalleDiario = useMemo(() => {
    return diasSemana.map((d) => {
      const movsDia = movimientosSemana.filter((m) => m.fecha === d.fechaStr);
      let ingBs = 0;
      let ingUSD = 0;
      let gasBs = 0;
      let gasUSD = 0;

      for (const m of movsDia) {
        const { monto_usd, monto_bs } = calcularMontos(m);
        if (m.tipo === 'venta') {
          ingBs += monto_bs;
          ingUSD += monto_usd;
        } else {
          gasBs += monto_bs;
          gasUSD += monto_usd;
        }
      }

      return {
        fecha: d.fechaStr,
        dia: d.nombreDia,
        ingresosBs: ingBs,
        ingresosUSD: ingUSD,
        gastosBs: gasBs,
        gastosUSD: gasUSD,
        balanceBs: ingBs - gasBs,
        balanceUSD: ingUSD - gasUSD,
      };
    });
  }, [diasSemana, movimientosSemana]);

  // 4. Tabla 2: Resumen de Gastos por Categoría y Naturaleza
  const resumenCategorias = useMemo(() => {
    const mapa: Record<
      string,
      {
        categoria: CategoriaMovimiento;
        naturaleza: NaturalezaMovimiento;
        pagoMovilBs: number;
        efectivoBs: number;
        puntoDivisaBs: number;
        totalBs: number;
        totalUSD: number;
        itemsCount: number;
      }
    > = {};

    // Inicializar las 9 categorías
    for (const cat of CATEGORIAS_GASTO) {
      mapa[cat.nombre] = {
        categoria: cat.nombre,
        naturaleza: cat.naturaleza,
        pagoMovilBs: 0,
        efectivoBs: 0,
        puntoDivisaBs: 0,
        totalBs: 0,
        totalUSD: 0,
        itemsCount: 0,
      };
    }

    for (const m of movimientosSemana) {
      if (m.tipo === 'gasto') {
        const { monto_usd, monto_bs } = calcularMontos(m);
        if (!mapa[m.categoria]) {
          mapa[m.categoria] = {
            categoria: m.categoria,
            naturaleza: m.naturaleza,
            pagoMovilBs: 0,
            efectivoBs: 0,
            puntoDivisaBs: 0,
            totalBs: 0,
            totalUSD: 0,
            itemsCount: 0,
          };
        }

        const reg = mapa[m.categoria];
        reg.itemsCount += 1;
        reg.totalBs += monto_bs;
        reg.totalUSD += monto_usd;

        if (m.metodo_pago === 'pago_movil') {
          reg.pagoMovilBs += monto_bs;
        } else if (m.metodo_pago === 'efectivo_bs') {
          reg.efectivoBs += monto_bs;
        } else {
          // punto_venta o divisa
          reg.puntoDivisaBs += monto_bs;
        }
      }
    }

    // Ordenar de mayor a menor totalUSD
    const lista = Object.values(mapa).sort((a, b) => b.totalUSD - a.totalUSD);

    return lista;
  }, [movimientosSemana]);

  const totalGastosItemsCount = useMemo(() => {
    return resumenCategorias.reduce((acc, c) => acc + c.itemsCount, 0);
  }, [resumenCategorias]);

  // 5. Tabla 3: Desglose por Naturaleza del Gasto (Operativo vs Personal)
  const desgloseNaturaleza = useMemo(() => {
    const tipos: NaturalezaMovimiento[] = ['Negocio', 'Créditos / Otros', 'Personal'];
    return tipos.map((nat) => {
      let bs = 0;
      let usd = 0;

      for (const m of movimientosSemana) {
        if (m.tipo === 'gasto' && m.naturaleza === nat) {
          const { monto_usd, monto_bs } = calcularMontos(m);
          bs += monto_bs;
          usd += monto_usd;
        }
      }

      const porcGasto = totalGastosUSD > 0 ? (usd / totalGastosUSD) * 100 : 0;
      const impactoIngresos = totalIngresosUSD > 0 ? (usd / totalIngresosUSD) * 100 : 0;

      return {
        naturaleza: nat,
        totalBs: bs,
        totalUSD: usd,
        porcGasto,
        impactoIngresos,
      };
    });
  }, [movimientosSemana, totalGastosUSD, totalIngresosUSD]);

  // 6. Datos Gráficos
  const datosGraficoBarras = useMemo(() => {
    return detalleDiario.map((d) => ({
      dia: d.dia.slice(0, 3), // Lun, Mar, Mié...
      Ingresos: parseFloat(d.ingresosUSD.toFixed(2)),
      Gastos: parseFloat(d.gastosUSD.toFixed(2)),
    }));
  }, [detalleDiario]);

  const datosGraficoCircular = useMemo(() => {
    return resumenCategorias
      .filter((c) => c.totalUSD > 0)
      .map((c) => ({
        name: c.categoria,
        value: parseFloat(c.totalUSD.toFixed(2)),
      }));
  }, [resumenCategorias]);

  const COLORES_PIE = [
    '#2C474E',
    '#3B5B64',
    '#4E7985',
    '#991B1B',
    '#B91C1C',
    '#D97706',
    '#92400E',
    '#1E40AF',
    '#15803D',
  ];

  // Navegación Semanas
  const anteriorSemana = () => {
    setFechaSemana((prev) => {
      const n = new Date(prev);
      n.setDate(n.getDate() - 7);
      return n;
    });
  };

  const siguienteSemana = () => {
    setFechaSemana((prev) => {
      const n = new Date(prev);
      n.setDate(n.getDate() + 7);
      return n;
    });
  };

  // Exportar Excel (CSV con UTF-8 BOM)
  const exportarCSV = () => {
    const BOM = '\uFEFF';
    let csv = `${BOM}"BALANCE SEMANAL COMPLETO — CHICHA ADICTIVA"\n`;
    csv += `"Período:","${rangoTexto}"\n\n`;

    // Resumen KPI
    csv += `"TOTAL INGRESOS ($)","${totalIngresosUSD.toFixed(2)}","Bs","${totalIngresosBs.toFixed(2)}"\n`;
    csv += `"TOTAL GASTOS ($)","${totalGastosUSD.toFixed(2)}","Bs","${totalGastosBs.toFixed(2)}"\n`;
    csv += `"BALANCE NETO ($)","${balanceNetoUSD.toFixed(2)}","Bs","${balanceNetoBs.toFixed(2)}"\n\n`;

    // Tabla 1: Detalle Diario
    csv += `"DETALLE DIARIO (LUNES A DOMINGO)"\n`;
    csv += `"Fecha","Día","Ingresos (Bs)","Ingresos ($)","Gastos (Bs)","Gastos ($)","Balance Día (Bs)","Balance Día ($)"\n`;
    for (const d of detalleDiario) {
      csv += `"${d.fecha}","${d.dia}","${d.ingresosBs.toFixed(2)}","${d.ingresosUSD.toFixed(2)}","${d.gastosBs.toFixed(2)}","${d.gastosUSD.toFixed(2)}","${d.balanceBs.toFixed(2)}","${d.balanceUSD.toFixed(2)}"\n`;
    }
    csv += `"TOTAL SEMANA","7 días","${totalIngresosBs.toFixed(2)}","${totalIngresosUSD.toFixed(2)}","${totalGastosBs.toFixed(2)}","${totalGastosUSD.toFixed(2)}","${balanceNetoBs.toFixed(2)}","${balanceNetoUSD.toFixed(2)}"\n\n`;

    // Tabla 2: Resumen de Gastos por Categoría
    csv += `"RESUMEN DE GASTOS POR CATEGORÍA Y NATURALEZA"\n`;
    csv += `"Categoría","Naturaleza","Pago Móvil (Bs)","Efectivo (Bs)","Punto / Divisa (Bs)","Total (Bs)","Total ($)","% del Gasto"\n`;
    for (const c of resumenCategorias) {
      const pct = totalGastosUSD > 0 ? (c.totalUSD / totalGastosUSD) * 100 : 0;
      csv += `"${c.categoria}","${c.naturaleza}","${c.pagoMovilBs.toFixed(2)}","${c.efectivoBs.toFixed(2)}","${c.puntoDivisaBs.toFixed(2)}","${c.totalBs.toFixed(2)}","${c.totalUSD.toFixed(2)}","${pct.toFixed(1)}%"\n`;
    }
    csv += `"TOTAL GASTOS","${totalGastosItemsCount} items","","","","${totalGastosBs.toFixed(2)}","${totalGastosUSD.toFixed(2)}","100.0%"\n\n`;

    // Tabla 3: Desglose por Naturaleza
    csv += `"DESGLOSE POR NATURALEZA DEL GASTO (OPERATIVO VS PERSONAL)"\n`;
    csv += `"Naturaleza","Total (Bs)","Total ($)","% del Gasto","Impacto sobre Ingresos"\n`;
    for (const n of desgloseNaturaleza) {
      csv += `"${n.naturaleza}","${n.totalBs.toFixed(2)}","${n.totalUSD.toFixed(2)}","${n.porcGasto.toFixed(1)}%","${n.impactoIngresos.toFixed(1)}%"\n`;
    }
    csv += `"TOTAL","${totalGastosBs.toFixed(2)}","${totalGastosUSD.toFixed(2)}","100.0%","${totalIngresosUSD > 0 ? ((totalGastosUSD / totalIngresosUSD) * 100).toFixed(1) : '0.0'}%"\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Balance_Chicha_Adictiva_${diasSemana[0].fechaStr}_al_${diasSemana[6].fechaStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Compartir Imagen con html-to-image y Capacitor Share
  const compartirImagen = async () => {
    if (!reportRef.current) return;
    try {
      setCompartiendo(true);

      const dataUrl = await toPng(reportRef.current, {
        quality: 0.95,
        backgroundColor: '#F4F4F5',
        pixelRatio: 2,
      });

      const fileName = `Balance_ChichaAdictiva_${diasSemana[0].fechaStr}.png`;

      // Si está en Capacitor Android
      try {
        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: dataUrl,
          directory: Directory.Cache,
        });

        await Share.share({
          title: 'Balance Semanal - Chicha Adictiva',
          text: `Balance semanal del ${rangoTexto} — Chicha Adictiva`,
          url: savedFile.uri,
          dialogTitle: 'Compartir Balance Semanal',
        });
        setCompartiendo(false);
        return;
      } catch {
        // En entorno Web o si Capacitor Share falla
      }

      // Fallback a descarga de imagen tradicional
      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Error generando o compartiendo imagen:', err);
      alert('No se pudo generar la imagen del reporte.');
    } finally {
      setCompartiendo(false);
    }
  };

  return (
    <div className="space-y-4 pb-24 pt-2 px-3 sm:px-4 max-w-4xl mx-auto">
      {/* Barra de Período Semanal */}
      <div className="bg-white border border-[#E4E4E7] rounded-lg p-2.5 flex items-center justify-between shadow-xs">
        <button
          type="button"
          onClick={anteriorSemana}
          className="min-h-[40px] px-2.5 py-1.5 flex items-center gap-1 text-xs font-semibold text-[#2C474E] hover:bg-zinc-100 rounded active:bg-zinc-200"
        >
          <ChevronLeft size={16} />
          <span className="hidden sm:inline">Semana ant.</span>
        </button>

        <div className="flex items-center gap-2 text-center">
          <Calendar size={16} className="text-[#2C474E] shrink-0" />
          <span className="text-xs sm:text-sm font-bold tracking-wider text-[#18181B] uppercase tabular-nums">
            {rangoTexto}
          </span>
        </div>

        <button
          type="button"
          onClick={siguienteSemana}
          className="min-h-[40px] px-2.5 py-1.5 flex items-center gap-1 text-xs font-semibold text-[#2C474E] hover:bg-zinc-100 rounded active:bg-zinc-200"
        >
          <span className="hidden sm:inline">Semana sig.</span>
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Botones de Acción: Exportar Excel y Compartir Imagen */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={exportarCSV}
          className="flex-1 min-h-[44px] px-3 py-2 text-xs font-bold border border-[#E4E4E7] bg-white text-[#18181B] rounded hover:bg-zinc-50 active:bg-zinc-100 flex items-center justify-center gap-1.5 shadow-xs"
        >
          <Download size={15} className="text-[#52525B]" />
          <span>Exportar Excel (CSV)</span>
        </button>

        <button
          type="button"
          onClick={compartirImagen}
          disabled={compartiendo}
          className="flex-1 min-h-[44px] px-3 py-2 text-xs font-bold bg-[#2C474E] text-white rounded hover:bg-[#23393e] active:bg-[#1a2b2f] flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-70"
        >
          <Share2 size={15} className="text-[#86EFAC]" />
          <span>{compartiendo ? 'Generando...' : 'Compartir Imagen'}</span>
        </button>
      </div>

      {/* CONTENEDOR REPORTE PARA CAPTURA Y VISUALIZACIÓN */}
      <div ref={reportRef} className="space-y-4 bg-[#F4F4F5] p-1 rounded-md">
        {/* Barra de Subtítulo Corporativo */}
        <div className="bg-[#2C474E] text-white px-4 py-2.5 rounded-lg flex items-center justify-between shadow-xs">
          <div className="flex flex-col">
            <span className="text-xs sm:text-sm font-bold uppercase tracking-wider">
              BALANCE SEMANAL COMPLETO — CHICHA ADICTIVA
            </span>
            <span className="text-[11px] text-[#86EFAC] font-medium uppercase tracking-wide tabular-nums">
              {rangoTexto}
            </span>
          </div>
        </div>

        {/* 1. 3 TARJETAS KPI EN FILA */}
        <div className="grid grid-cols-3 gap-2">
          {/* TOTAL INGRESOS */}
          <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-lg p-2.5 text-center shadow-xs">
            <span className="block text-[10px] sm:text-xs font-bold text-[#166534] uppercase tracking-wider mb-1">
              TOTAL INGRESOS ($)
            </span>
            <span className="block text-sm sm:text-lg font-black text-[#166534] tabular-nums">
              {formatUSD(totalIngresosUSD)}
            </span>
            <span className="block text-[10px] text-[#166534] opacity-80 tabular-nums font-medium mt-0.5">
              {formatVES(totalIngresosBs)}
            </span>
          </div>

          {/* TOTAL GASTOS */}
          <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-2.5 text-center shadow-xs">
            <span className="block text-[10px] sm:text-xs font-bold text-[#991B1B] uppercase tracking-wider mb-1">
              TOTAL GASTOS ($)
            </span>
            <span className="block text-sm sm:text-lg font-black text-[#991B1B] tabular-nums">
              {formatUSD(totalGastosUSD)}
            </span>
            <span className="block text-[10px] text-[#991B1B] opacity-80 tabular-nums font-medium mt-0.5">
              {formatVES(totalGastosBs)}
            </span>
          </div>

          {/* BALANCE NETO */}
          <div className="bg-[#FEFCE8] border border-[#FEF08A] rounded-lg p-2.5 text-center shadow-xs">
            <span className="block text-[10px] sm:text-xs font-bold text-[#18181B] uppercase tracking-wider mb-1">
              BALANCE NETO ($)
            </span>
            <span
              className={`block text-sm sm:text-lg font-black tabular-nums ${
                balanceNetoUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
              }`}
            >
              {balanceNetoUSD >= 0 ? '+' : ''}
              {formatUSD(balanceNetoUSD)}
            </span>
            <span className="block text-[10px] text-[#18181B] opacity-80 tabular-nums font-medium mt-0.5">
              {formatVES(balanceNetoBs)}
            </span>
          </div>
        </div>

        {/* 2. RESUMEN COMPACTO DE INGRESOS POR MÉTODO DE PAGO */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] text-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider">
            Ingresos de la Semana por Método de Pago
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#E4E4E7] p-2">
            {/* Pago Móvil */}
            <div className="p-2 text-center">
              <span className="block text-[11px] text-[#52525B] font-semibold mb-0.5">
                Pago Móvil
              </span>
              <span className="block text-xs font-bold text-[#18181B] tabular-nums">
                {formatNumber(ingresosPorMetodo.pago_movil.bs)} Bs
              </span>
              <span className="block text-[10px] text-[#52525B] tabular-nums">
                ({formatUSD(ingresosPorMetodo.pago_movil.usd)})
              </span>
            </div>

            {/* Punto de Venta */}
            <div className="p-2 text-center">
              <span className="block text-[11px] text-[#52525B] font-semibold mb-0.5">
                Punto de Venta
              </span>
              <span className="block text-xs font-bold text-[#18181B] tabular-nums">
                {formatNumber(ingresosPorMetodo.punto_venta.bs)} Bs
              </span>
              <span className="block text-[10px] text-[#52525B] tabular-nums">
                ({formatUSD(ingresosPorMetodo.punto_venta.usd)})
              </span>
            </div>

            {/* Efectivo Bs */}
            <div className="p-2 text-center">
              <span className="block text-[11px] text-[#52525B] font-semibold mb-0.5">
                Efectivo (Bs)
              </span>
              <span className="block text-xs font-bold text-[#18181B] tabular-nums">
                {formatNumber(ingresosPorMetodo.efectivo_bs.bs)} Bs
              </span>
              <span className="block text-[10px] text-[#52525B] tabular-nums">
                ({formatUSD(ingresosPorMetodo.efectivo_bs.usd)})
              </span>
            </div>

            {/* Divisa ($) */}
            <div className="p-2 text-center">
              <span className="block text-[11px] text-[#52525B] font-semibold mb-0.5">
                Divisa ($)
              </span>
              <span className="block text-xs font-bold text-[#166534] tabular-nums">
                {formatUSD(ingresosPorMetodo.divisa.usd)}
              </span>
              <span className="block text-[10px] text-[#52525B] tabular-nums">
                ({formatNumber(ingresosPorMetodo.divisa.bs)} Bs)
              </span>
            </div>
          </div>
        </div>

        {/* 3. TABLA 1 — DETALLE DIARIO (Lunes a Domingo) */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] text-white px-3 py-2 text-xs font-bold uppercase tracking-wider">
            Detalle Diario (Lunes a Domingo)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left border-collapse">
              <thead>
                <tr className="bg-[#2C474E] text-white border-b border-[#3d5e67]">
                  <th className="py-2 px-2.5 font-bold sticky left-0 bg-[#2C474E] z-10">Fecha</th>
                  <th className="py-2 px-2.5 font-bold">Día</th>
                  <th className="py-2 px-2.5 font-bold text-right">Ingresos (Bs)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Ingresos ($)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Gastos (Bs)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Gastos ($)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Balance Día (Bs)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Balance Día ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {detalleDiario.map((d) => (
                  <tr key={d.fecha} className="hover:bg-zinc-50">
                    <td className="py-2 px-2.5 font-medium tabular-nums sticky left-0 bg-white z-10 border-r border-[#E4E4E7]">
                      {d.fecha}
                    </td>
                    <td className="py-2 px-2.5 font-medium text-[#18181B]">{d.dia}</td>
                    <td className="py-2 px-2.5 text-right tabular-nums text-[#166534]">
                      {formatNumber(d.ingresosBs)}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-[#166534]">
                      {formatUSD(d.ingresosUSD)}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums text-[#991B1B]">
                      {formatNumber(d.gastosBs)}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-[#991B1B]">
                      {formatUSD(d.gastosUSD)}
                    </td>
                    <td
                      className={`py-2 px-2.5 text-right tabular-nums font-semibold ${
                        d.balanceBs >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                      }`}
                    >
                      {formatNumber(d.balanceBs)}
                    </td>
                    <td
                      className={`py-2 px-2.5 text-right tabular-nums font-bold ${
                        d.balanceUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                      }`}
                    >
                      {formatUSD(d.balanceUSD)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-100 font-bold border-t-2 border-[#2C474E] text-[#18181B]">
                  <td className="py-2.5 px-2.5 sticky left-0 bg-zinc-100 z-10 border-r border-[#E4E4E7]">
                    TOTAL SEMANA
                  </td>
                  <td className="py-2.5 px-2.5">7 días</td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums text-[#166534]">
                    {formatNumber(totalIngresosBs)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums text-[#166534]">
                    {formatUSD(totalIngresosUSD)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums text-[#991B1B]">
                    {formatNumber(totalGastosBs)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums text-[#991B1B]">
                    {formatUSD(totalGastosUSD)}
                  </td>
                  <td
                    className={`py-2.5 px-2.5 text-right tabular-nums ${
                      balanceNetoBs >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                    }`}
                  >
                    {formatNumber(balanceNetoBs)}
                  </td>
                  <td
                    className={`py-2.5 px-2.5 text-right tabular-nums ${
                      balanceNetoUSD >= 0 ? 'text-[#166534]' : 'text-[#991B1B]'
                    }`}
                  >
                    {formatUSD(balanceNetoUSD)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 4. TABLA 2 — RESUMEN DE GASTOS POR CATEGORÍA Y NATURALEZA */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] text-white px-3 py-2 text-xs font-bold uppercase tracking-wider">
            Resumen de Gastos por Categoría y Naturaleza
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left border-collapse">
              <thead>
                <tr className="bg-[#2C474E] text-white border-b border-[#3d5e67]">
                  <th className="py-2 px-2.5 font-bold sticky left-0 bg-[#2C474E] z-10">Categoría de Gasto</th>
                  <th className="py-2 px-2.5 font-bold">Naturaleza</th>
                  <th className="py-2 px-2.5 font-bold text-right">Pago Móvil (Bs)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Efectivo (Bs)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Punto / Divisa (Bs)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Total (Bs)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Total ($)</th>
                  <th className="py-2 px-2.5 font-bold text-right">% del Gasto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {resumenCategorias.map((c) => {
                  const pct = totalGastosUSD > 0 ? (c.totalUSD / totalGastosUSD) * 100 : 0;
                  return (
                    <tr key={c.categoria} className="hover:bg-zinc-50">
                      <td className="py-2 px-2.5 font-semibold text-[#18181B] sticky left-0 bg-white z-10 border-r border-[#E4E4E7]">
                        {c.categoria}
                      </td>
                      <td className="py-2 px-2.5">
                        <BadgeNaturaleza naturaleza={c.naturaleza} />
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-[#52525B]">
                        {formatNumber(c.pagoMovilBs)}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-[#52525B]">
                        {formatNumber(c.efectivoBs)}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums text-[#52525B]">
                        {formatNumber(c.puntoDivisaBs)}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-[#18181B]">
                        {formatNumber(c.totalBs)}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums font-bold text-[#991B1B]">
                        {formatUSD(c.totalUSD)}
                      </td>
                      <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-[#52525B]">
                        {formatPorcentaje(pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-100 font-bold border-t-2 border-[#2C474E] text-[#18181B]">
                  <td className="py-2.5 px-2.5 sticky left-0 bg-zinc-100 z-10 border-r border-[#E4E4E7]">
                    TOTAL GASTOS
                  </td>
                  <td className="py-2.5 px-2.5 text-[10px] text-[#52525B]">
                    {totalGastosItemsCount} items
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">
                    {formatNumber(resumenCategorias.reduce((a, b) => a + b.pagoMovilBs, 0))}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">
                    {formatNumber(resumenCategorias.reduce((a, b) => a + b.efectivoBs, 0))}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">
                    {formatNumber(resumenCategorias.reduce((a, b) => a + b.puntoDivisaBs, 0))}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums text-[#18181B]">
                    {formatNumber(totalGastosBs)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums text-[#991B1B]">
                    {formatUSD(totalGastosUSD)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">100.0%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 5. TABLA 3 — DESGLOSE POR NATURALEZA DEL GASTO (OPERATIVO VS PERSONAL) */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden shadow-xs">
          <div className="bg-[#2C474E] text-white px-3 py-2 text-xs font-bold uppercase tracking-wider">
            Desglose por Naturaleza del Gasto (Operativo vs Personal)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left border-collapse">
              <thead>
                <tr className="bg-[#2C474E] text-white border-b border-[#3d5e67]">
                  <th className="py-2 px-2.5 font-bold sticky left-0 bg-[#2C474E] z-10">Naturaleza</th>
                  <th className="py-2 px-2.5 font-bold text-right">Total (Bs)</th>
                  <th className="py-2 px-2.5 font-bold text-right">Total ($)</th>
                  <th className="py-2 px-2.5 font-bold text-right">% del Gasto</th>
                  <th className="py-2 px-2.5 font-bold text-right">
                    Impacto sobre Ingresos ({formatUSD(totalIngresosUSD)})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {desgloseNaturaleza.map((n) => (
                  <tr key={n.naturaleza} className="hover:bg-zinc-50">
                    <td className="py-2 px-2.5 font-semibold text-[#18181B] sticky left-0 bg-white z-10 border-r border-[#E4E4E7]">
                      <BadgeNaturaleza naturaleza={n.naturaleza} />
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums text-[#52525B]">
                      {formatNumber(n.totalBs)}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-bold text-[#991B1B]">
                      {formatUSD(n.totalUSD)}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-[#52525B]">
                      {formatPorcentaje(n.porcGasto)}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-bold text-[#18181B]">
                      {formatPorcentaje(n.impactoIngresos)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-100 font-bold border-t-2 border-[#2C474E] text-[#18181B]">
                  <td className="py-2.5 px-2.5 sticky left-0 bg-zinc-100 z-10 border-r border-[#E4E4E7]">
                    TOTAL
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">{formatNumber(totalGastosBs)}</td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums text-[#991B1B]">
                    {formatUSD(totalGastosUSD)}
                  </td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">100.0%</td>
                  <td className="py-2.5 px-2.5 text-right tabular-nums">
                    {totalIngresosUSD > 0
                      ? formatPorcentaje((totalGastosUSD / totalIngresosUSD) * 100)
                      : '0.0%'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 6. GRÁFICOS (RECHARTS RESPONSIVOS CON COLORES SÓLIDOS CORPORATIVOS) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Gráfico 1: Barras agrupadas Ingresos vs Gastos Diarios ($ USD) */}
          <div className="bg-white border border-[#E4E4E7] rounded-lg p-3 shadow-xs">
            <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-[#E4E4E7]">
              <BarChart2 size={15} className="text-[#2C474E]" />
              <span className="text-xs font-bold text-[#18181B]">
                Ingresos vs Gastos Diarios ($ USD)
              </span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={datosGraficoBarras} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#52525B' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#52525B' }} />
                  <Tooltip
                    formatter={(val: any) => [`$${formatNumber(Number(val))}`, '']}
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      borderColor: '#E4E4E7',
                      fontSize: '11px',
                      borderRadius: '6px',
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }}
                    iconType="rect"
                  />
                  <Bar dataKey="Ingresos" fill="#2C474E" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Gastos" fill="#B91C1C" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráfico 2: Circular Distribución de Gastos por Categoría */}
          <div className="bg-white border border-[#E4E4E7] rounded-lg p-3 shadow-xs">
            <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-[#E4E4E7]">
              <PieIcon size={15} className="text-[#2C474E]" />
              <span className="text-xs font-bold text-[#18181B]">
                Distribución de Gastos por Categoría
              </span>
            </div>
            {datosGraficoCircular.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-xs text-[#52525B]">
                No hay gastos registrados en esta semana.
              </div>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <Pie
                      data={datosGraficoCircular}
                      cx="50%"
                      cy="45%"
                      innerRadius={38}
                      outerRadius={68}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {datosGraficoCircular.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORES_PIE[index % COLORES_PIE.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any) => [`$${formatNumber(Number(val))}`, '']}
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderColor: '#E4E4E7',
                        fontSize: '11px',
                        borderRadius: '6px',
                      }}
                    />
                    <Legend
                      wrapperStyle={{
                        fontSize: '10px',
                        lineHeight: '14px',
                        maxHeight: '48px',
                        overflowY: 'auto',
                      }}
                      iconType="circle"
                      iconSize={8}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
