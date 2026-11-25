import ExcelJS from 'exceljs';
import { Movimiento, Puesto } from '../types';
import { calcularMontos } from './format';

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
}

const COLOR_HEADER_BG = 'FF1B3B36';
const COLOR_TOTAL_BG = 'FFF1F5F9';
const COLOR_BORDER = 'FFE2E8F0';
const COLOR_TEXT_DARK = 'FF18181B';
const COLOR_TEXT_MUTED = 'FF475569';

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

function styleHeaderRow(row: ExcelJS.Row, colCount: number) {
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
      horizontal: c === 1 ? 'left' : 'right',
    };
    cell.border = BORDER_THIN;
  }
}

function styleDataRow(
  row: ExcelJS.Row,
  colCount: number,
  leftCols: number[] = [1]
) {
  row.height = 20;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = {
      name: 'Calibri',
      size: 10.5,
      color: { argb: COLOR_TEXT_DARK },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: leftCols.includes(c) ? 'left' : 'right',
    };
    cell.border = BORDER_THIN;
  }
}

function styleTotalRow(
  row: ExcelJS.Row,
  colCount: number,
  leftCols: number[] = [1]
) {
  row.height = 22;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLOR_TOTAL_BG },
    };
    cell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: COLOR_TEXT_DARK },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: leftCols.includes(c) ? 'left' : 'right',
    };
    cell.border = BORDER_THIN;
  }
}

function autoFitColumns(ws: ExcelJS.Worksheet, skipRows: number[] = []) {
  const colWidths: Record<number, number> = {};

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (skipRows.includes(rowNumber)) return;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      // Ignorar celdas fusionadas horizontalmente para no inflar la columna 1
      if (cell.isMerged && cell.master !== cell) return;
      if (cell.isMerged && cell.master === cell) {
        // Si la celda master abarca varias columnas, no usar su longitud para una sola columna
        const merges = (ws.model as any).merges as string[] | undefined;
        if (merges && merges.some((m) => m.startsWith(`${cell.address}:`))) {
          return;
        }
      }

      let len = 0;
      const val = cell.value;
      if (val === null || val === undefined) {
        len = 0;
      } else if (typeof val === 'number') {
        // Estimar longitud con formato numérico (ej. $12,345.67 o 12,345.67)
        const formatted = val.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const numFmt = cell.numFmt || '';
        const prefixLen = numFmt.includes('$') ? 2 : 0;
        len = formatted.length + prefixLen;
      } else {
        len = String(val).length;
      }

      if (!colWidths[colNumber] || len > colWidths[colNumber]) {
        colWidths[colNumber] = len;
      }
    });
  });

  Object.entries(colWidths).forEach(([colIdxStr, maxLen]) => {
    const colIdx = Number(colIdxStr);
    const col = ws.getColumn(colIdx);
    col.width = Math.max(12, maxLen + 5);
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
  let gasOpUSD = 0;
  let gasOpBs = 0;
  let retPersUSD = 0;
  let retPersBs = 0;

  const ventasPorMetodo: Record<string, { usd: number; bs: number }> = {
    pago_movil: { usd: 0, bs: 0 },
    punto_venta: { usd: 0, bs: 0 },
    efectivo_bs: { usd: 0, bs: 0 },
    divisa: { usd: 0, bs: 0 },
  };

  const gastosPorCategoriaMap: Record<
    string,
    { categoria: string; naturaleza: string; usd: number; bs: number }
  > = {};

  for (const m of movimientosFiltrados) {
    const { monto_usd, monto_bs } = calcularMontos(m);
    if (m.tipo === 'venta' || m.tipo === 'ingreso') {
      ingUSD += monto_usd;
      ingBs += monto_bs;

      const met = (m.metodo_pago || '').toLowerCase();
      if (met === 'pago_movil' || met.includes('pago')) {
        ventasPorMetodo.pago_movil.usd += monto_usd;
        ventasPorMetodo.pago_movil.bs += monto_bs;
      } else if (met === 'punto_venta' || met.includes('punto')) {
        ventasPorMetodo.punto_venta.usd += monto_usd;
        ventasPorMetodo.punto_venta.bs += monto_bs;
      } else if (met === 'divisa' || met.includes('divisa') || met.includes('dolar') || met.includes('usd')) {
        ventasPorMetodo.divisa.usd += monto_usd;
        ventasPorMetodo.divisa.bs += monto_bs;
      } else {
        ventasPorMetodo.efectivo_bs.usd += monto_usd;
        ventasPorMetodo.efectivo_bs.bs += monto_bs;
      }
    } else {
      const esPersonal = m.naturaleza === 'Personal';
      if (esPersonal) {
        retPersUSD += monto_usd;
        retPersBs += monto_bs;
      } else {
        gasOpUSD += monto_usd;
        gasOpBs += monto_bs;
      }

      const catKey =
        (m.categoria as string) === 'Nómina / Sueldos'
          ? 'Sueldos / Comisiones'
          : m.categoria || 'Sin categoría';
      const natLabel = esPersonal ? 'Personal' : 'Gastos';

      if (!gastosPorCategoriaMap[catKey]) {
        gastosPorCategoriaMap[catKey] = {
          categoria: catKey,
          naturaleza: natLabel,
          usd: 0,
          bs: 0,
        };
      }
      gastosPorCategoriaMap[catKey].usd += monto_usd;
      gastosPorCategoriaMap[catKey].bs += monto_bs;
    }
  }

  const totalGastosUSD = gasOpUSD + retPersUSD;
  const totalGastosBs = gasOpBs + retPersBs;
  const balanceNetoUSD = cleanZero(ingUSD - totalGastosUSD);
  const balanceNetoBs = cleanZero(ingBs - totalGastosBs);

  const listaCategorias = Object.values(gastosPorCategoriaMap).sort((a, b) => b.usd - a.usd);

  // ====================================================================
  // HOJA 1: RESUMEN
  // ====================================================================
  const wsResumen = wb.addWorksheet('Resumen');

  // Título principal estilizado
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
  wsResumen.getRow(1).height = 30;

  // Sub-encabezado
  const modoLabel = modoPeriodo === 'semanal' ? 'Vista Semanal' : 'Vista Mensual / Anual';
  const r2 = wsResumen.addRow([`Período (${modoLabel}):`, periodoTexto]);
  r2.getCell(1).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLOR_TEXT_MUTED } };
  r2.getCell(2).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLOR_TEXT_DARK } };

  const r3 = wsResumen.addRow(['Puesto Filtrado:', nombreFiltroPuesto]);
  r3.getCell(1).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLOR_TEXT_MUTED } };
  r3.getCell(2).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLOR_TEXT_DARK } };

  const r4 = wsResumen.addRow(['Tasa BCV Activa:', tasaBcv]);
  r4.getCell(1).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLOR_TEXT_MUTED } };
  r4.getCell(2).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLOR_TEXT_DARK } };
  r4.getCell(2).numFmt = '#,##0.00 "Bs/$"';
  r4.getCell(2).alignment = { horizontal: 'left' };

  wsResumen.addRow([]);

  // Sección 1: Resumen General
  const sec1Title = wsResumen.addRow(['RESUMEN GENERAL']);
  sec1Title.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_HEADER_BG } };

  const hdrResGen = wsResumen.addRow(['Concepto', 'Monto ($ USD)', 'Monto (Bs)']);
  styleHeaderRow(hdrResGen, 3);

  const filasResGen: [string, number, number][] = [
    ['Ingresos', cleanZero(ingUSD), cleanZero(ingBs)],
    ['Gastos Operativos', cleanZero(gasOpUSD), cleanZero(gasOpBs)],
    ['Retiros Personales', cleanZero(retPersUSD), cleanZero(retPersBs)],
  ];

  for (const [concepto, usd, bs] of filasResGen) {
    const row = wsResumen.addRow([concepto, usd, bs]);
    styleDataRow(row, 3, [1]);
    row.getCell(2).numFmt = '$#,##0.00';
    row.getCell(3).numFmt = '#,##0.00';
  }

  const rowBalNeto = wsResumen.addRow(['Balance Neto', balanceNetoUSD, balanceNetoBs]);
  styleTotalRow(rowBalNeto, 3, [1]);
  rowBalNeto.getCell(2).numFmt = '$#,##0.00';
  rowBalNeto.getCell(3).numFmt = '#,##0.00';

  wsResumen.addRow([]);

  // Sección 2: Gastos por Categoría
  const sec2Title = wsResumen.addRow(['GASTOS POR CATEGORÍA']);
  sec2Title.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_HEADER_BG } };

  const hdrCat = wsResumen.addRow(['Categoría', 'Naturaleza', 'Monto (Bs)', 'Monto ($ USD)', '% del Gasto']);
  styleHeaderRow(hdrCat, 5);
  hdrCat.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };

  if (listaCategorias.length === 0) {
    const emptyRow = wsResumen.addRow(['Sin gastos registrados en este período', '-', 0, 0, 0]);
    styleDataRow(emptyRow, 5, [1, 2]);
    emptyRow.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
    emptyRow.getCell(3).numFmt = '#,##0.00';
    emptyRow.getCell(4).numFmt = '$#,##0.00';
    emptyRow.getCell(5).numFmt = '0.0%';
  } else {
    for (const c of listaCategorias) {
      const pct = totalGastosUSD > 0 ? c.usd / totalGastosUSD : 0;
      const row = wsResumen.addRow([
        c.categoria,
        c.naturaleza,
        cleanZero(c.bs),
        cleanZero(c.usd),
        pct,
      ]);
      styleDataRow(row, 5, [1, 2]);
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(3).numFmt = '#,##0.00';
      row.getCell(4).numFmt = '$#,##0.00';
      row.getCell(5).numFmt = '0.0%';
    }
  }

  const rowTotCat = wsResumen.addRow([
    'TOTAL GASTOS',
    '-',
    cleanZero(totalGastosBs),
    cleanZero(totalGastosUSD),
    totalGastosUSD > 0 ? 1 : 0,
  ]);
  styleTotalRow(rowTotCat, 5, [1, 2]);
  rowTotCat.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
  rowTotCat.getCell(3).numFmt = '#,##0.00';
  rowTotCat.getCell(4).numFmt = '$#,##0.00';
  rowTotCat.getCell(5).numFmt = '0.0%';

  wsResumen.addRow([]);

  // Sección 3: Ventas por Método de Pago
  const sec3Title = wsResumen.addRow(['VENTAS POR MÉTODO DE PAGO']);
  sec3Title.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_HEADER_BG } };

  const hdrMet = wsResumen.addRow(['Método de Pago', 'Monto ($ USD)', 'Monto (Bs)']);
  styleHeaderRow(hdrMet, 3);

  const filasMetodos: [string, number, number][] = [
    ['Pago Móvil', cleanZero(ventasPorMetodo.pago_movil.usd), cleanZero(ventasPorMetodo.pago_movil.bs)],
    ['Punto de Venta', cleanZero(ventasPorMetodo.punto_venta.usd), cleanZero(ventasPorMetodo.punto_venta.bs)],
    ['Efectivo Bs', cleanZero(ventasPorMetodo.efectivo_bs.usd), cleanZero(ventasPorMetodo.efectivo_bs.bs)],
    ['Divisas ($)', cleanZero(ventasPorMetodo.divisa.usd), cleanZero(ventasPorMetodo.divisa.bs)],
  ];

  for (const [metNombre, usd, bs] of filasMetodos) {
    const row = wsResumen.addRow([metNombre, usd, bs]);
    styleDataRow(row, 3, [1]);
    row.getCell(2).numFmt = '$#,##0.00';
    row.getCell(3).numFmt = '#,##0.00';
  }

  const rowTotMet = wsResumen.addRow(['TOTAL VENTAS', cleanZero(ingUSD), cleanZero(ingBs)]);
  styleTotalRow(rowTotMet, 3, [1]);
  rowTotMet.getCell(2).numFmt = '$#,##0.00';
  rowTotMet.getCell(3).numFmt = '#,##0.00';

  autoFitColumns(wsResumen, [1]);

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
  styleHeaderRow(hdrCom, 7);
  hdrCom.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };

  const puestosConsiderados =
    filtroPuestoId === 'todos' ? puestos : puestos.filter((p) => p.id === filtroPuestoId);

  let sumCant = 0;
  let sumVentas = 0;
  let sumComision = 0;
  let sumPagado = 0;
  let sumPendiente = 0;
  let sumNetoNegocio = 0;

  for (const p of puestosConsiderados) {
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
    styleDataRow(row, 7, [1]);
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(2).numFmt = '#,##0';
    for (let c = 3; c <= 7; c++) {
      row.getCell(c).numFmt = '$#,##0.00';
    }
  }

  const rowTotCom = wsComisiones.addRow([
    'TOTAL',
    sumCant,
    cleanZero(sumVentas),
    cleanZero(sumComision),
    cleanZero(sumPagado),
    cleanZero(sumPendiente),
    cleanZero(sumNetoNegocio),
  ]);
  styleTotalRow(rowTotCom, 7, [1]);
  rowTotCom.getCell(2).alignment = { vertical: 'middle', horizontal: 'center' };
  rowTotCom.getCell(2).numFmt = '#,##0';
  for (let c = 3; c <= 7; c++) {
    rowTotCom.getCell(c).numFmt = '$#,##0.00';
  }

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

  let sumMovBs = 0;
  let sumMovUsd = 0;

  for (const m of movsOrdenados) {
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
      m.categoria || (esVenta ? 'Ventas' : 'General'),
      metodoNombre,
      m.descripcion || '',
      tasaItem,
      bsVal,
      usdVal,
    ]);
    styleDataRow(row, 10, [1, 2, 3, 4, 5, 6, 7]);
    row.getCell(8).numFmt = '#,##0.00';
    row.getCell(9).numFmt = '#,##0.00';
    row.getCell(10).numFmt = '$#,##0.00';
  }

  const rowTotMovs = wsMovs.addRow([
    'BALANCE NETO MOVIMIENTOS',
    `${movsOrdenados.length} registros`,
    '',
    '',
    '',
    '',
    '',
    '',
    cleanZero(sumMovBs),
    cleanZero(sumMovUsd),
  ]);
  styleTotalRow(rowTotMovs, 10, [1, 2]);
  rowTotMovs.getCell(9).numFmt = '#,##0.00';
  rowTotMovs.getCell(10).numFmt = '$#,##0.00';

  autoFitColumns(wsMovs, [1]);

  // ====================================================================
  // GENERAR Y DESCARGAR ARCHIVO .XLSX
  // ====================================================================
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
