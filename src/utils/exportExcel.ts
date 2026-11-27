import ExcelJS from 'exceljs';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Movimiento, normalizarCategoriaGasto, Puesto } from '../types';
import { calcularMontos } from './format';

export interface CajaDisponibleExport {
  digitalBs: number;
  efectivoBs: number;
  divisasUsd: number;
  totalConsolidadoUsd: number;
  totalConsolidadoBs: number;
}

export interface DiaSemanaExport {
  fechaStr: string;
  nombreDia: string;
}

export interface ExportExcelParams {
  modoPeriodo: 'semanal' | 'mensual';
  periodoTexto: string;
  nombreArchivo: string;
  nombreFiltroPuesto: string;
  filtroPuestoId: string;
  tasaBcv: number;
  movimientosFiltrados: Movimiento[];
  movimientosComisionPeriodo: Movimiento[];
  puestos: Puesto[];
  cajaDisponible: CajaDisponibleExport;
  diasSemana?: DiaSemanaExport[];
}

const COLOR_HEADER_BG = 'FF1B3B36';
const COLOR_TOTAL_BG = 'FFF1F5F9';
const COLOR_ALT_ROW_BG = 'FFF8FAFC';
const COLOR_HIGHLIGHT_OP_BG = 'FFECFDF5';
const COLOR_BORDER = 'FFE2E8F0';
const COLOR_TEXT_DARK = 'FF18181B';
const COLOR_TEXT_MUTED = 'FF475569';
const COLOR_GREEN = 'FF047857';
const COLOR_RED = 'FFB91C1C';

const METODOS_LABELS: Record<string, string> = {
  pago_movil: 'Pago Móvil',
  punto_venta: 'Punto de Venta',
  efectivo_bs: 'Efectivo Bs',
  divisa: 'Divisas ($)',
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: COLOR_BORDER } },
  left: { style: 'thin', color: { argb: COLOR_BORDER } },
  bottom: { style: 'thin', color: { argb: COLOR_BORDER } },
  right: { style: 'thin', color: { argb: COLOR_BORDER } },
};

function styleHeaderRow(row: ExcelJS.Row, colCount: number, centerCols: number[] = []) {
  row.height = 24;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLOR_HEADER_BG },
    };
    cell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: centerCols.includes(c) ? 'center' : c === 1 ? 'left' : 'right',
    };
    cell.border = BORDER_THIN;
  }
}

function styleDataRow(
  row: ExcelJS.Row,
  colCount: number,
  leftCols: number[] = [1],
  isEven = false,
  centerCols: number[] = []
) {
  row.height = 20;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    if (isEven) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLOR_ALT_ROW_BG },
      };
    }
    cell.font = {
      name: 'Calibri',
      size: 10.5,
      color: { argb: COLOR_TEXT_DARK },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: centerCols.includes(c)
        ? 'center'
        : leftCols.includes(c)
        ? 'left'
        : 'right',
    };
    cell.border = BORDER_THIN;
  }
}

function styleTotalRow(
  row: ExcelJS.Row,
  colCount: number,
  leftCols: number[] = [1],
  bgColor: string = COLOR_TOTAL_BG,
  centerCols: number[] = []
) {
  row.height = 22;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgColor },
    };
    cell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: COLOR_TEXT_DARK },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: centerCols.includes(c)
        ? 'center'
        : leftCols.includes(c)
        ? 'left'
        : 'right',
    };
    cell.border = BORDER_THIN;
  }
}

function setCellColor(cell: ExcelJS.Cell, argb: string, bold = false) {
  cell.font = {
    name: 'Calibri',
    size: cell.font?.size || 10.5,
    bold: bold || Boolean(cell.font?.bold),
    color: { argb },
  };
}

function autoFitColumns(ws: ExcelJS.Worksheet, skipRows: number[] = []) {
  const colWidths: Record<number, number> = {};

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (skipRows.includes(rowNumber)) return;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.isMerged && cell.master !== cell) return;
      if (cell.isMerged && cell.master === cell) {
        const merges = (ws.model as any).merges as string[] | undefined;
        if (merges && merges.some((m) => m.startsWith(`${cell.address}:`))) {
          return;
        }
      }

      let len = 0;
      let rawVal: any = cell.value;
      if (rawVal && typeof rawVal === 'object' && 'result' in rawVal) {
        rawVal = rawVal.result;
      }

      if (rawVal === null || rawVal === undefined) {
        len = 0;
      } else if (typeof rawVal === 'number') {
        const formatted = rawVal.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const numFmt = cell.numFmt || '';
        const prefixLen = numFmt.includes('$') ? 2 : numFmt.includes('%') ? 1 : 0;
        len = formatted.length + prefixLen;
      } else {
        len = String(rawVal).length;
      }

      if (!colWidths[colNumber] || len > colWidths[colNumber]) {
        colWidths[colNumber] = len;
      }
    });
  });

  Object.entries(colWidths).forEach(([colIdxStr, maxLen]) => {
    const colIdx = Number(colIdxStr);
    const col = ws.getColumn(colIdx);
    col.width = Math.max(13, maxLen + 5);
  });
}

function cleanZero(val: number): number {
  return Math.abs(val) < 0.005 || Object.is(val, -0) ? 0 : Math.round(val * 100) / 100;
}

export async function generarYDescargarExcel(params: ExportExcelParams): Promise<void> {
  const {
    modoPeriodo,
    periodoTexto,
    nombreArchivo,
    nombreFiltroPuesto,
    filtroPuestoId,
    tasaBcv,
    movimientosFiltrados,
    movimientosComisionPeriodo,
    puestos,
    cajaDisponible,
    diasSemana = [],
  } = params;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'YNACAJA - Chicha Adictiva';
  wb.created = new Date();

  const mapaPuestos: Record<string, string> = {};
  for (const p of puestos) {
    mapaPuestos[p.id] = p.nombre;
  }

  // ====================================================================
  // CÁLCULOS BASE DEL PERÍODO FILTRADO
  // ====================================================================
  let ingUSD = 0;
  let ingBs = 0;
  let cantIng = 0;
  let gasOpUSD = 0;
  let gasOpBs = 0;
  let cantGasOp = 0;
  let retPersUSD = 0;
  let retPersBs = 0;
  let cantRetPers = 0;

  const ventasPorMetodo: Record<string, { usd: number; bs: number; count: number }> = {
    pago_movil: { usd: 0, bs: 0, count: 0 },
    punto_venta: { usd: 0, bs: 0, count: 0 },
    efectivo_bs: { usd: 0, bs: 0, count: 0 },
    divisa: { usd: 0, bs: 0, count: 0 },
  };

  const gastosPorCategoriaMap: Record<
    string,
    { categoria: string; naturaleza: string; usd: number; bs: number; count: number }
  > = {};

  for (const m of movimientosFiltrados) {
    if (m.categoria === 'Descuento Tardanza') continue;
    const { monto_usd, monto_bs } = calcularMontos(m);
    if (m.tipo === 'venta' || m.tipo === 'ingreso') {
      ingUSD += monto_usd;
      ingBs += monto_bs;
      cantIng += 1;

      const met = (m.metodo_pago || '').toLowerCase();
      if (met === 'pago_movil' || met.includes('pago')) {
        ventasPorMetodo.pago_movil.usd += monto_usd;
        ventasPorMetodo.pago_movil.bs += monto_bs;
        ventasPorMetodo.pago_movil.count += 1;
      } else if (met === 'punto_venta' || met.includes('punto')) {
        ventasPorMetodo.punto_venta.usd += monto_usd;
        ventasPorMetodo.punto_venta.bs += monto_bs;
        ventasPorMetodo.punto_venta.count += 1;
      } else if (met === 'divisa' || met.includes('divisa') || met.includes('dolar') || met.includes('usd')) {
        ventasPorMetodo.divisa.usd += monto_usd;
        ventasPorMetodo.divisa.bs += monto_bs;
        ventasPorMetodo.divisa.count += 1;
      } else {
        ventasPorMetodo.efectivo_bs.usd += monto_usd;
        ventasPorMetodo.efectivo_bs.bs += monto_bs;
        ventasPorMetodo.efectivo_bs.count += 1;
      }
    } else {
      const esPersonal = m.naturaleza === 'Personal';
      if (esPersonal) {
        retPersUSD += monto_usd;
        retPersBs += monto_bs;
        cantRetPers += 1;
      } else {
        gasOpUSD += monto_usd;
        gasOpBs += monto_bs;
        cantGasOp += 1;
      }

      const catKey = normalizarCategoriaGasto(m.categoria, 'Hielo');
      const natLabel = esPersonal ? 'Personal' : 'Gastos';

      if (!gastosPorCategoriaMap[catKey]) {
        gastosPorCategoriaMap[catKey] = {
          categoria: catKey,
          naturaleza: natLabel,
          usd: 0,
          bs: 0,
          count: 0,
        };
      }
      gastosPorCategoriaMap[catKey].usd += monto_usd;
      gastosPorCategoriaMap[catKey].bs += monto_bs;
      gastosPorCategoriaMap[catKey].count += 1;
    }
  }

  const totalGastosUSD = cleanZero(gasOpUSD + retPersUSD);
  const totalGastosBs = cleanZero(gasOpBs + retPersBs);
  const utilOpUSD = cleanZero(ingUSD - gasOpUSD);
  const utilOpBs = cleanZero(ingBs - gasOpBs);
  const balanceNetoUSD = cleanZero(utilOpUSD - retPersUSD);
  const balanceNetoBs = cleanZero(utilOpBs - retPersBs);

  const listaCategorias = Object.values(gastosPorCategoriaMap).sort((a, b) => b.usd - a.usd);

  // ====================================================================
  // HOJA 1: RESUMEN (Acabado Ejecutivo sin cuadrícula)
  // ====================================================================
  const wsResumen = wb.addWorksheet('Resumen');
  wsResumen.views = [{ showGridLines: false }];

  // Encabezado Principal A1:E1 (altura 28, negrita 13pt)
  wsResumen.mergeCells('A1:E1');
  const titleCell = wsResumen.getCell('A1');
  titleCell.value = 'YNACAJA — REPORTE FINANCIERO CHICHA ADICTIVA';
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_HEADER_BG },
  };
  titleCell.font = {
    name: 'Calibri',
    size: 13,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsResumen.getRow(1).height = 28;

  // Subtítulo con fecha/hora de exportación, período, puesto y tasa BCV
  const ahoraStr = new Date().toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const modoLabel = modoPeriodo === 'semanal' ? 'Vista Semanal' : 'Vista Mensual / Anual';

  wsResumen.mergeCells('A2:E2');
  const subCell = wsResumen.getCell('A2');
  subCell.value = `Período (${modoLabel}): ${periodoTexto}  |  Puesto: ${nombreFiltroPuesto}  |  Tasa BCV: ${tasaBcv.toFixed(2)} Bs/$  |  Exportado: ${ahoraStr}`;
  subCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_TOTAL_BG },
  };
  subCell.font = {
    name: 'Calibri',
    size: 9.5,
    italic: true,
    color: { argb: COLOR_TEXT_MUTED },
  };
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsResumen.getRow(2).height = 20;

  wsResumen.addRow([]);

  // --------------------------------------------------------------------
  // TABLA 1: RESUMEN GENERAL (5 columnas estándar)
  // --------------------------------------------------------------------
  const sec1Title = wsResumen.addRow(['RESUMEN GENERAL']);
  sec1Title.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_HEADER_BG } };

  const hdrResGen = wsResumen.addRow([
    'Concepto / Categoría / Método',
    'Detalle',
    'Monto ($ USD)',
    'Monto (Bs)',
    '% del Total',
  ]);
  styleHeaderRow(hdrResGen, 5, [2]);

  const rIng = wsResumen.addRow(['Ingresos', `${cantIng} operaciones`, cleanZero(ingUSD), cleanZero(ingBs), 1]);
  styleDataRow(rIng, 5, [1, 2], false);
  rIng.getCell(3).numFmt = '$#,##0.00';
  rIng.getCell(4).numFmt = '#,##0.00';
  rIng.getCell(5).numFmt = '0.0%';
  setCellColor(rIng.getCell(3), COLOR_GREEN, true);
  setCellColor(rIng.getCell(4), COLOR_GREEN);

  const rowIngNum = rIng.number;

  const rGasOp = wsResumen.addRow([
    'Gastos Operativos',
    `${cantGasOp} operaciones`,
    cleanZero(gasOpUSD),
    cleanZero(gasOpBs),
    {
      formula: `IF(C${rowIngNum}>0,C${rowIngNum + 1}/C${rowIngNum},0)`,
      result: ingUSD > 0 ? gasOpUSD / ingUSD : 0,
    },
  ]);
  styleDataRow(rGasOp, 5, [1, 2], true);
  rGasOp.getCell(3).numFmt = '$#,##0.00';
  rGasOp.getCell(4).numFmt = '#,##0.00';
  rGasOp.getCell(5).numFmt = '0.0%';
  setCellColor(rGasOp.getCell(3), COLOR_RED, true);
  setCellColor(rGasOp.getCell(4), COLOR_RED);

  const rowGasOpNum = rGasOp.number;

  const rUtilOp = wsResumen.addRow([
    'Utilidad Operativa del Negocio',
    'Ingresos - Gastos Operativos',
    { formula: `C${rowIngNum}-C${rowGasOpNum}`, result: utilOpUSD },
    { formula: `D${rowIngNum}-D${rowGasOpNum}`, result: utilOpBs },
    {
      formula: `IF(C${rowIngNum}>0,C${rowGasOpNum + 1}/C${rowIngNum},0)`,
      result: ingUSD > 0 ? utilOpUSD / ingUSD : 0,
    },
  ]);
  styleTotalRow(rUtilOp, 5, [1, 2], COLOR_HIGHLIGHT_OP_BG);
  rUtilOp.getCell(3).numFmt = '$#,##0.00';
  rUtilOp.getCell(4).numFmt = '#,##0.00';
  rUtilOp.getCell(5).numFmt = '0.0%';
  setCellColor(rUtilOp.getCell(3), utilOpUSD >= 0 ? COLOR_GREEN : COLOR_RED, true);
  setCellColor(rUtilOp.getCell(4), utilOpBs >= 0 ? COLOR_GREEN : COLOR_RED, true);

  const rowUtilOpNum = rUtilOp.number;

  const rRetPers = wsResumen.addRow([
    'Retiros Personales',
    `${cantRetPers} operaciones`,
    cleanZero(retPersUSD),
    cleanZero(retPersBs),
    {
      formula: `IF(C${rowIngNum}>0,C${rowUtilOpNum + 1}/C${rowIngNum},0)`,
      result: ingUSD > 0 ? retPersUSD / ingUSD : 0,
    },
  ]);
  styleDataRow(rRetPers, 5, [1, 2], false);
  rRetPers.getCell(3).numFmt = '$#,##0.00';
  rRetPers.getCell(4).numFmt = '#,##0.00';
  rRetPers.getCell(5).numFmt = '0.0%';
  setCellColor(rRetPers.getCell(3), COLOR_RED, true);
  setCellColor(rRetPers.getCell(4), COLOR_RED);

  const rowRetPersNum = rRetPers.number;

  const rBalNeto = wsResumen.addRow([
    'Balance Neto',
    'Utilidad Operativa - Retiros',
    { formula: `C${rowUtilOpNum}-C${rowRetPersNum}`, result: balanceNetoUSD },
    { formula: `D${rowUtilOpNum}-D${rowRetPersNum}`, result: balanceNetoBs },
    {
      formula: `IF(C${rowIngNum}>0,C${rowRetPersNum + 1}/C${rowIngNum},0)`,
      result: ingUSD > 0 ? balanceNetoUSD / ingUSD : 0,
    },
  ]);
  styleTotalRow(rBalNeto, 5, [1, 2], COLOR_TOTAL_BG);
  rBalNeto.getCell(3).numFmt = '$#,##0.00';
  rBalNeto.getCell(4).numFmt = '#,##0.00';
  rBalNeto.getCell(5).numFmt = '0.0%';
  setCellColor(rBalNeto.getCell(3), balanceNetoUSD >= 0 ? COLOR_GREEN : COLOR_RED, true);
  setCellColor(rBalNeto.getCell(4), balanceNetoBs >= 0 ? COLOR_GREEN : COLOR_RED, true);

  wsResumen.addRow([]);

  // --------------------------------------------------------------------
  // TABLA 2: ARQUEO DE DINERO DISPONIBLE ACTUAL
  // --------------------------------------------------------------------
  const secCajaTitle = wsResumen.addRow(['ARQUEO DE DINERO DISPONIBLE ACTUAL']);
  secCajaTitle.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_HEADER_BG } };

  const hdrCaja = wsResumen.addRow([
    'Concepto / Categoría / Método',
    'Detalle',
    'Monto ($ USD)',
    'Monto (Bs)',
    '% del Total',
  ]);
  styleHeaderRow(hdrCaja, 5, [2]);

  const tasaSegura = tasaBcv > 0 ? tasaBcv : 1;
  const digitalUsd = cleanZero(cajaDisponible.digitalBs / tasaSegura);
  const efectivoUsd = cleanZero(cajaDisponible.efectivoBs / tasaSegura);
  const divisasUsd = cleanZero(cajaDisponible.divisasUsd);
  const divisasBs = cleanZero(divisasUsd * tasaSegura);
  const totalCajaUsd = cleanZero(digitalUsd + efectivoUsd + divisasUsd);

  const rCajaStart = hdrCaja.number + 1;
  const rCajaTotNum = rCajaStart + 3;

  const filasCaja: [string, string, number, number][] = [
    ['Banco / PM', 'Pago Móvil y Punto de Venta', digitalUsd, cleanZero(cajaDisponible.digitalBs)],
    ['Efectivo (Bs)', 'Billetes en Bolívares', efectivoUsd, cleanZero(cajaDisponible.efectivoBs)],
    ['Divisas ($)', 'Efectivo en Dólares', divisasUsd, divisasBs],
  ];

  filasCaja.forEach(([nom, det, usd, bs], idx) => {
    const row = wsResumen.addRow([
      nom,
      det,
      usd,
      bs,
      {
        formula: `IF($C$${rCajaTotNum}>0,C${rCajaStart + idx}/$C$${rCajaTotNum},0)`,
        result: totalCajaUsd > 0 ? usd / totalCajaUsd : 0,
      },
    ]);
    styleDataRow(row, 5, [1, 2], idx % 2 === 1);
    row.getCell(3).numFmt = '$#,##0.00';
    row.getCell(4).numFmt = '#,##0.00';
    row.getCell(5).numFmt = '0.0%';
  });

  const rowTotCaja = wsResumen.addRow([
    'Total Consolidado',
    'Disponibilidad Real en Caja',
    { formula: `SUM(C${rCajaStart}:C${rCajaStart + 2})`, result: cleanZero(cajaDisponible.totalConsolidadoUsd) },
    { formula: `SUM(D${rCajaStart}:D${rCajaStart + 2})`, result: cleanZero(cajaDisponible.totalConsolidadoBs) },
    { formula: `SUM(E${rCajaStart}:E${rCajaStart + 2})`, result: totalCajaUsd > 0 ? 1 : 0 },
  ]);
  styleTotalRow(rowTotCaja, 5, [1, 2], COLOR_TOTAL_BG);
  rowTotCaja.getCell(3).numFmt = '$#,##0.00';
  rowTotCaja.getCell(4).numFmt = '#,##0.00';
  rowTotCaja.getCell(5).numFmt = '0.0%';
  setCellColor(rowTotCaja.getCell(3), COLOR_GREEN, true);
  setCellColor(rowTotCaja.getCell(4), COLOR_GREEN, true);

  wsResumen.addRow([]);

  // --------------------------------------------------------------------
  // TABLA 3: GASTOS POR CATEGORÍA (5 columnas estándar)
  // --------------------------------------------------------------------
  const sec2Title = wsResumen.addRow(['GASTOS POR CATEGORÍA']);
  sec2Title.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_HEADER_BG } };

  const hdrCat = wsResumen.addRow([
    'Concepto / Categoría / Método',
    'Detalle',
    'Monto ($ USD)',
    'Monto (Bs)',
    '% del Total',
  ]);
  styleHeaderRow(hdrCat, 5, [2]);

  const rCatStart = hdrCat.number + 1;
  const cantCatRows = listaCategorias.length > 0 ? listaCategorias.length : 1;
  const rCatTotNum = rCatStart + cantCatRows;

  if (listaCategorias.length === 0) {
    const emptyRow = wsResumen.addRow(['Sin gastos registrados en este período', '-', 0, 0, 0]);
    styleDataRow(emptyRow, 5, [1, 2], false);
    emptyRow.getCell(3).numFmt = '$#,##0.00';
    emptyRow.getCell(4).numFmt = '#,##0.00';
    emptyRow.getCell(5).numFmt = '0.0%';
  } else {
    listaCategorias.forEach((c, idx) => {
      const rNum = rCatStart + idx;
      const row = wsResumen.addRow([
        c.categoria,
        `${c.naturaleza} · ${c.count} movs`,
        cleanZero(c.usd),
        cleanZero(c.bs),
        {
          formula: `IF($C$${rCatTotNum}>0,C${rNum}/$C$${rCatTotNum},0)`,
          result: totalGastosUSD > 0 ? c.usd / totalGastosUSD : 0,
        },
      ]);
      styleDataRow(row, 5, [1, 2], idx % 2 === 1);
      row.getCell(3).numFmt = '$#,##0.00';
      row.getCell(4).numFmt = '#,##0.00';
      row.getCell(5).numFmt = '0.0%';
      setCellColor(row.getCell(3), COLOR_RED, true);
      setCellColor(row.getCell(4), COLOR_RED);
    });
  }

  const rowTotCat = wsResumen.addRow([
    'TOTAL GASTOS',
    `${cantGasOp + cantRetPers} movimientos`,
    { formula: `SUM(C${rCatStart}:C${rCatTotNum - 1})`, result: totalGastosUSD },
    { formula: `SUM(D${rCatStart}:D${rCatTotNum - 1})`, result: totalGastosBs },
    { formula: `SUM(E${rCatStart}:E${rCatTotNum - 1})`, result: totalGastosUSD > 0 ? 1 : 0 },
  ]);
  styleTotalRow(rowTotCat, 5, [1, 2], COLOR_TOTAL_BG);
  rowTotCat.getCell(3).numFmt = '$#,##0.00';
  rowTotCat.getCell(4).numFmt = '#,##0.00';
  rowTotCat.getCell(5).numFmt = '0.0%';
  setCellColor(rowTotCat.getCell(3), COLOR_RED, true);
  setCellColor(rowTotCat.getCell(4), COLOR_RED, true);

  wsResumen.addRow([]);

  // --------------------------------------------------------------------
  // TABLA 4: VENTAS POR MÉTODO DE PAGO (5 columnas estándar con % del Total)
  // --------------------------------------------------------------------
  const sec3Title = wsResumen.addRow(['VENTAS POR MÉTODO DE PAGO']);
  sec3Title.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_HEADER_BG } };

  const hdrMet = wsResumen.addRow([
    'Concepto / Categoría / Método',
    'Detalle',
    'Monto ($ USD)',
    'Monto (Bs)',
    '% del Total',
  ]);
  styleHeaderRow(hdrMet, 5, [2]);

  const rMetStart = hdrMet.number + 1;
  const rMetTotNum = rMetStart + 4;

  const filasMetodos: [string, string, number, number][] = [
    ['Pago Móvil', `${ventasPorMetodo.pago_movil.count} ventas`, cleanZero(ventasPorMetodo.pago_movil.usd), cleanZero(ventasPorMetodo.pago_movil.bs)],
    ['Punto de Venta', `${ventasPorMetodo.punto_venta.count} ventas`, cleanZero(ventasPorMetodo.punto_venta.usd), cleanZero(ventasPorMetodo.punto_venta.bs)],
    ['Efectivo Bs', `${ventasPorMetodo.efectivo_bs.count} ventas`, cleanZero(ventasPorMetodo.efectivo_bs.usd), cleanZero(ventasPorMetodo.efectivo_bs.bs)],
    ['Divisas ($)', `${ventasPorMetodo.divisa.count} ventas`, cleanZero(ventasPorMetodo.divisa.usd), cleanZero(ventasPorMetodo.divisa.bs)],
  ];

  filasMetodos.forEach(([metNombre, det, usd, bs], idx) => {
    const rNum = rMetStart + idx;
    const row = wsResumen.addRow([
      metNombre,
      det,
      usd,
      bs,
      {
        formula: `IF($C$${rMetTotNum}>0,C${rNum}/$C$${rMetTotNum},0)`,
        result: ingUSD > 0 ? usd / ingUSD : 0,
      },
    ]);
    styleDataRow(row, 5, [1, 2], idx % 2 === 1);
    row.getCell(3).numFmt = '$#,##0.00';
    row.getCell(4).numFmt = '#,##0.00';
    row.getCell(5).numFmt = '0.0%';
    setCellColor(row.getCell(3), COLOR_GREEN, true);
  });

  const rowTotMet = wsResumen.addRow([
    'TOTAL VENTAS',
    `${cantIng} ventas`,
    { formula: `SUM(C${rMetStart}:C${rMetStart + 3})`, result: cleanZero(ingUSD) },
    { formula: `SUM(D${rMetStart}:D${rMetStart + 3})`, result: cleanZero(ingBs) },
    { formula: `SUM(E${rMetStart}:E${rMetStart + 3})`, result: ingUSD > 0 ? 1 : 0 },
  ]);
  styleTotalRow(rowTotMet, 5, [1, 2], COLOR_TOTAL_BG);
  rowTotMet.getCell(3).numFmt = '$#,##0.00';
  rowTotMet.getCell(4).numFmt = '#,##0.00';
  rowTotMet.getCell(5).numFmt = '0.0%';
  setCellColor(rowTotMet.getCell(3), COLOR_GREEN, true);
  setCellColor(rowTotMet.getCell(4), COLOR_GREEN, true);

  // --------------------------------------------------------------------
  // TABLA 5 (Solo Vista Semanal): RENDIMIENTO DIARIO (LUNES A SÁBADO)
  // --------------------------------------------------------------------
  if (modoPeriodo === 'semanal' && diasSemana.length > 0) {
    wsResumen.addRow([]);

    const sec5Title = wsResumen.addRow(['RENDIMIENTO DIARIO (LUNES A SÁBADO)']);
    sec5Title.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_HEADER_BG } };

    const hdrDiario = wsResumen.addRow([
      'Día',
      'Ingresos ($)',
      'Gastos Operativos ($)',
      'Retiros Personales ($)',
      'Balance Neto ($)',
    ]);
    styleHeaderRow(hdrDiario, 5);

    const rDiaStart = hdrDiario.number + 1;

    diasSemana.forEach((d, idx) => {
      const movsDia = movimientosFiltrados.filter((m) => m.fecha === d.fechaStr);
      let dIng = 0;
      let dGasOp = 0;
      let dRetPers = 0;
      for (const m of movsDia) {
        if (m.categoria === 'Descuento Tardanza') continue;
        const { monto_usd } = calcularMontos(m);
        if (m.tipo === 'venta' || m.tipo === 'ingreso') {
          dIng += monto_usd;
        } else if (m.naturaleza === 'Personal') {
          dRetPers += monto_usd;
        } else {
          dGasOp += monto_usd;
        }
      }
      const dBal = cleanZero(dIng - dGasOp - dRetPers);
      const rNum = rDiaStart + idx;

      const row = wsResumen.addRow([
        `${d.nombreDia} (${d.fechaStr.slice(5)})`,
        cleanZero(dIng),
        cleanZero(dGasOp),
        cleanZero(dRetPers),
        { formula: `B${rNum}-C${rNum}-D${rNum}`, result: dBal },
      ]);
      styleDataRow(row, 5, [1], idx % 2 === 1);
      for (let c = 2; c <= 5; c++) {
        row.getCell(c).numFmt = '$#,##0.00';
      }
      setCellColor(row.getCell(2), COLOR_GREEN);
      setCellColor(row.getCell(3), COLOR_RED);
      setCellColor(row.getCell(4), COLOR_RED);
      setCellColor(row.getCell(5), dBal >= 0 ? COLOR_GREEN : COLOR_RED, true);
    });

    const rDiaEnd = rDiaStart + diasSemana.length - 1;
    const rowTotDia = wsResumen.addRow([
      'TOTAL SEMANA',
      { formula: `SUM(B${rDiaStart}:B${rDiaEnd})`, result: cleanZero(ingUSD) },
      { formula: `SUM(C${rDiaStart}:C${rDiaEnd})`, result: cleanZero(gasOpUSD) },
      { formula: `SUM(D${rDiaStart}:D${rDiaEnd})`, result: cleanZero(retPersUSD) },
      { formula: `SUM(E${rDiaStart}:E${rDiaEnd})`, result: balanceNetoUSD },
    ]);
    styleTotalRow(rowTotDia, 5, [1], COLOR_TOTAL_BG);
    for (let c = 2; c <= 5; c++) {
      rowTotDia.getCell(c).numFmt = '$#,##0.00';
    }
    setCellColor(rowTotDia.getCell(2), COLOR_GREEN, true);
    setCellColor(rowTotDia.getCell(3), COLOR_RED, true);
    setCellColor(rowTotDia.getCell(4), COLOR_RED, true);
    setCellColor(rowTotDia.getCell(5), balanceNetoUSD >= 0 ? COLOR_GREEN : COLOR_RED, true);
  }

  autoFitColumns(wsResumen, [1, 2]);

  // ====================================================================
  // HOJA 2: COMISIONES
  // ====================================================================
  const wsComisiones = wb.addWorksheet('Comisiones');

  wsComisiones.mergeCells('A1:G1');
  const comTitle = wsComisiones.getCell('A1');
  comTitle.value = `LIQUIDACIÓN DE COMISIONES — ${periodoTexto.toUpperCase()}`;
  comTitle.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_HEADER_BG },
  };
  comTitle.font = {
    name: 'Calibri',
    size: 12,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };
  comTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsComisiones.getRow(1).height = 28;

  wsComisiones.addRow([]);

  const hdrCom = wsComisiones.addRow([
    'Puesto',
    'Cant. Cierres',
    'Ventas ($)',
    'Comisión 22% ($)',
    'Adelantos / Pagado ($)',
    'Saldo Pendiente ($)',
    'Neto Negocio ($)',
  ]);
  styleHeaderRow(hdrCom, 7, [2]);

  const puestosConsiderados =
    filtroPuestoId === 'todos' ? puestos : puestos.filter((p) => p.id === filtroPuestoId);

  const rComStart = hdrCom.number + 1;
  let sumCant = 0;
  let sumVentas = 0;
  let sumComision = 0;
  let sumPagado = 0;
  let sumPendiente = 0;
  let sumNetoNegocio = 0;

  puestosConsiderados.forEach((p, idx) => {
    const ventasP = movimientosFiltrados.filter(
      (m) => (m.tipo === 'venta' || m.tipo === 'ingreso') && m.puesto_id === p.id
    );
    let totalV = 0;
    for (const v of ventasP) {
      totalV += calcularMontos(v).monto_usd;
    }

    const pct = Number(p.porcentaje_comision) || 22.0;
    const comUSD = Math.round(((totalV * pct) / 100) * 100) / 100;
    const netoUSD = Math.round((totalV - comUSD) * 100) / 100;

    const pagosP = movimientosComisionPeriodo.filter((m) => m.puesto_id === p.id);
    let pagadoUSD = 0;
    for (const pg of pagosP) {
      pagadoUSD += calcularMontos(pg).monto_usd;
    }
    pagadoUSD = Math.round(pagadoUSD * 100) / 100;

    const pendienteUSD = Math.max(0, Math.round((comUSD - pagadoUSD) * 100) / 100);

    sumCant += ventasP.length;
    sumVentas += totalV;
    sumComision += comUSD;
    sumPagado += pagadoUSD;
    sumPendiente += pendienteUSD;
    sumNetoNegocio += netoUSD;

    const row = wsComisiones.addRow([
      p.nombre,
      ventasP.length,
      cleanZero(totalV),
      cleanZero(comUSD),
      cleanZero(pagadoUSD),
      cleanZero(pendienteUSD),
      cleanZero(netoUSD),
    ]);
    styleDataRow(row, 7, [1], idx % 2 === 1, [2]);
    row.getCell(2).numFmt = '#,##0';
    for (let c = 3; c <= 7; c++) {
      row.getCell(c).numFmt = '$#,##0.00';
    }
    setCellColor(row.getCell(7), COLOR_GREEN, true);
  });

  const rComEnd = rComStart + Math.max(0, puestosConsiderados.length - 1);
  const hasComRows = puestosConsiderados.length > 0;

  const rowTotCom = wsComisiones.addRow([
    'TOTAL',
    hasComRows ? { formula: `SUM(B${rComStart}:B${rComEnd})`, result: sumCant } : 0,
    hasComRows ? { formula: `SUM(C${rComStart}:C${rComEnd})`, result: cleanZero(sumVentas) } : 0,
    hasComRows ? { formula: `SUM(D${rComStart}:D${rComEnd})`, result: cleanZero(sumComision) } : 0,
    hasComRows ? { formula: `SUM(E${rComStart}:E${rComEnd})`, result: cleanZero(sumPagado) } : 0,
    hasComRows ? { formula: `SUM(F${rComStart}:F${rComEnd})`, result: cleanZero(sumPendiente) } : 0,
    hasComRows ? { formula: `SUM(G${rComStart}:G${rComEnd})`, result: cleanZero(sumNetoNegocio) } : 0,
  ]);
  styleTotalRow(rowTotCom, 7, [1], COLOR_TOTAL_BG, [2]);
  rowTotCom.getCell(2).numFmt = '#,##0';
  for (let c = 3; c <= 7; c++) {
    rowTotCom.getCell(c).numFmt = '$#,##0.00';
  }
  setCellColor(rowTotCom.getCell(7), COLOR_GREEN, true);

  autoFitColumns(wsComisiones, [1]);

  // ====================================================================
  // HOJA 3: MOVIMIENTOS
  // ====================================================================
  const wsMovs = wb.addWorksheet('Movimientos');

  wsMovs.mergeCells('A1:J1');
  const movTitle = wsMovs.getCell('A1');
  movTitle.value = `DETALLE DE MOVIMIENTOS — ${periodoTexto.toUpperCase()} (${nombreFiltroPuesto})`;
  movTitle.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_HEADER_BG },
  };
  movTitle.font = {
    name: 'Calibri',
    size: 12,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };
  movTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsMovs.getRow(1).height = 28;

  wsMovs.addRow([]);

  const hdrMovs = wsMovs.addRow([
    'Fecha',
    'Tipo',
    'Naturaleza',
    'Puesto',
    'Categoría',
    'Método de Pago',
    'Descripción',
    'Tasa BCV',
    'Monto Bs',
    'Monto USD',
  ]);
  styleHeaderRow(hdrMovs, 10);

  const movsOrdenados = [...movimientosFiltrados].sort((a, b) =>
    (b.fecha || '').localeCompare(a.fecha || '')
  );

  const rMovStart = hdrMovs.number + 1;
  let sumMovBs = 0;
  let sumMovUsd = 0;

  movsOrdenados.forEach((m, idx) => {
    const { monto_usd, monto_bs } = calcularMontos(m);
    const esVenta = m.tipo === 'venta' || m.tipo === 'ingreso';
    const signo = esVenta ? 1 : -1;
    const tasaItem = Number(m.tasa_aplicada ?? m.tasa ?? tasaBcv) || 0;
    const puestoNombre = m.puesto?.nombre || (m.puesto_id ? mapaPuestos[m.puesto_id] : '') || 'General';
    const metodoNombre = METODOS_LABELS[m.metodo_pago] || m.metodo_pago;

    const bsVal = cleanZero(monto_bs * signo);
    const usdVal = cleanZero(monto_usd * signo);
    sumMovBs += bsVal;
    sumMovUsd += usdVal;

    const row = wsMovs.addRow([
      m.fecha,
      esVenta ? 'Ingreso / Venta' : 'Gasto / Egreso',
      m.naturaleza || (esVenta ? 'Ventas' : 'Negocio'),
      puestoNombre,
      esVenta ? m.categoria || 'Ventas' : normalizarCategoriaGasto(m.categoria, 'Hielo'),
      metodoNombre,
      m.descripcion || '',
      tasaItem,
      bsVal,
      usdVal,
    ]);
    styleDataRow(row, 10, [1, 2, 3, 4, 5, 6, 7], idx % 2 === 1);
    row.getCell(8).numFmt = '#,##0.00';
    row.getCell(9).numFmt = '#,##0.00';
    row.getCell(10).numFmt = '$#,##0.00';
    setCellColor(row.getCell(9), esVenta ? COLOR_GREEN : COLOR_RED);
    setCellColor(row.getCell(10), esVenta ? COLOR_GREEN : COLOR_RED, true);
  });

  const rMovEnd = rMovStart + Math.max(0, movsOrdenados.length - 1);
  const hasMovRows = movsOrdenados.length > 0;

  const rowTotMovs = wsMovs.addRow([
    'BALANCE NETO MOVIMIENTOS',
    `${movsOrdenados.length} registros`,
    '',
    '',
    '',
    '',
    '',
    '',
    hasMovRows ? { formula: `SUM(I${rMovStart}:I${rMovEnd})`, result: cleanZero(sumMovBs) } : 0,
    hasMovRows ? { formula: `SUM(J${rMovStart}:J${rMovEnd})`, result: cleanZero(sumMovUsd) } : 0,
  ]);
  styleTotalRow(rowTotMovs, 10, [1, 2], COLOR_TOTAL_BG);
  rowTotMovs.getCell(9).numFmt = '#,##0.00';
  rowTotMovs.getCell(10).numFmt = '$#,##0.00';
  setCellColor(rowTotMovs.getCell(9), sumMovBs >= 0 ? COLOR_GREEN : COLOR_RED, true);
  setCellColor(rowTotMovs.getCell(10), sumMovUsd >= 0 ? COLOR_GREEN : COLOR_RED, true);

  autoFitColumns(wsMovs, [1]);

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

  // ====================================================================
  // GENERAR Y DESCARGAR / COMPARTIR ARCHIVO .XLSX
  // ====================================================================
  const buffer = await wb.xlsx.writeBuffer();
  const fileNameFinal = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`;

  if (Capacitor.isNativePlatform()) {
    const base64Data = arrayBufferToBase64(buffer as ArrayBuffer);
    const savedFile = await Filesystem.writeFile({
      path: fileNameFinal,
      data: base64Data,
      directory: Directory.Cache,
    });

    await Share.share({
      title: fileNameFinal,
      url: savedFile.uri,
      dialogTitle: 'Compartir o guardar reporte Excel',
    });
    return;
  }

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameFinal;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
