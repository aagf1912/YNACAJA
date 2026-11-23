import { ExtractedMovimiento } from '../services/api';

/**
 * Retorna la fecha actual en zona horaria Venezuela (UTC-4) en formato YYYY-MM-DD
 */
export function getVenezuelaDate(): string {
  const vzlaTime = new Date(Date.now() - 4 * 3600 * 1000);
  const yyyy = vzlaTime.getUTCFullYear();
  const mm = String(vzlaTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vzlaTime.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parser local en el cliente para vista previa instantánea mientras el usuario escribe o pega
 */
export function parseTextoLocal(
  texto: string,
  fechaReferencia?: string,
  rolUsuario: 'admin' | 'vendedor' = 'admin'
): ExtractedMovimiento[] {
  const refDate = fechaReferencia || getVenezuelaDate();
  const [refY] = refDate.split('-').map(Number);
  const esRolVendedor = rolUsuario === 'vendedor';

  function resolverFecha(textoSegmento: string, fallback: string): string {
    if (!textoSegmento) return fallback;

    const isoMatch = textoSegmento.match(/\b(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
    if (isoMatch) {
      return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
    }

    const dateMatch = textoSegmento.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (dateMatch) {
      const d = parseInt(dateMatch[1], 10);
      const m = parseInt(dateMatch[2], 10);
      let y = dateMatch[3] ? parseInt(dateMatch[3], 10) : refY;
      if (y < 100) y += 2000;
      if (d <= 31 && m <= 12) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    return fallback;
  }

  const lineas = texto.split(/\r?\n/);
  const resultados: ExtractedMovimiento[] = [];
  let fechaActualCursor = refDate;
  let seccionActual: 'ventas' | 'gastos' | 'general' = 'general';

  for (let linea of lineas) {
    linea = linea.trim();
    if (!linea) continue;

    if (/\btotal(?:es)?\b/i.test(linea) && !/\b(ventas?|gastos?|egresos?|ingresos?)\s*[:=-]/i.test(linea)) {
      continue;
    }

    const dateRegex = /\b(?:(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})|(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?))\b/;
    const dateMatch = linea.match(dateRegex);
    if (dateMatch) {
      const fechaDetectada = resolverFecha(dateMatch[0], '');
      if (fechaDetectada) {
        fechaActualCursor = fechaDetectada;
        linea = linea.replace(dateMatch[0], ' ');
      }
    }

    linea = linea.replace(/\b(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/gi, ' ');
    linea = linea.replace(/^[\s#*_\-:\.]+\s*/, '').replace(/[*_]+$/, '').trim();
    if (!linea) continue;

    if (/^(?:ventas?|ingresos?)\s*[:=-]?$/i.test(linea)) {
      seccionActual = 'ventas';
      continue;
    }
    if (/^(?:gastos?|egresos?)\s*[:=-]?$/i.test(linea)) {
      seccionActual = 'gastos';
      continue;
    }

    let partesSeccion: { seccion: 'ventas' | 'gastos' | 'general'; texto: string }[] = [
      { seccion: seccionActual, texto: linea },
    ];
    if (/ventas?\s*[:=-]/i.test(linea) || /gastos?\s*[:=-]/i.test(linea) || /egresos?\s*[:=-]/i.test(linea)) {
      partesSeccion = [];
      const tokens = linea.split(/(ventas?\s*[:=-]|gastos?\s*[:=-]|egresos?\s*[:=-])/i);
      let sec = seccionActual;
      for (const t of tokens) {
        if (/^ventas?\s*[:=-]/i.test(t)) {
          sec = 'ventas';
          seccionActual = 'ventas';
        } else if (/^(?:gastos?|egresos?)\s*[:=-]/i.test(t)) {
          sec = 'gastos';
          seccionActual = 'gastos';
        } else if (t.trim()) {
          partesSeccion.push({ seccion: sec, texto: t.trim() });
        }
      }
    }

    for (const parte of partesSeccion) {
      const secItem = parte.seccion;
      const chunks = parte.texto
        .split(/(?:[\,\;]\s+|\s+y\s+|\.\s+(?=[a-zA-Z\d]))/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const chunk of chunks) {
        if (/\btotal(?:es)?\b/i.test(chunk)) continue;

        const regexMonto = /(?:\$|usd)?\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+\.\d+|\d+)\s*(?:\$|usd|divisas?|dolares?|dólares?|bs|ves|bolivares|bolívares)?/i;
        const montoMatch = chunk.match(regexMonto);
        if (!montoMatch) continue;

        const rawMontoStr = montoMatch[1];
        if (!rawMontoStr) continue;

        let montoNum = 0;
        if (/^\d{1,3}(?:\.\d{3})+$/.test(rawMontoStr)) {
          montoNum = parseFloat(rawMontoStr.replace(/\./g, ''));
        } else if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(rawMontoStr)) {
          montoNum = parseFloat(rawMontoStr.replace(/\./g, '').replace(',', '.'));
        } else if (/^\d+,\d+$/.test(rawMontoStr)) {
          montoNum = parseFloat(rawMontoStr.replace(',', '.'));
        } else {
          montoNum = parseFloat(rawMontoStr);
        }

        if (isNaN(montoNum) || montoNum <= 0) continue;
        montoNum = Math.abs(montoNum);

        const norm = chunk.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        let moneda: 'VES' | 'USD' = 'VES';
        if (norm.includes('$') || norm.includes('usd') || norm.includes('divisa') || norm.includes('dolar')) {
          moneda = 'USD';
        }

        let metodo: 'pago_movil' | 'punto_venta' | 'efectivo_bs' | 'divisa' = 'efectivo_bs';
        if (moneda === 'USD') {
          metodo = 'divisa';
        } else if (/\b(?:pm|pmovil|p\s*movil|pago\s*movil|transferencia|transf|bcv|banesco|mercantil)\b/.test(norm)) {
          metodo = 'pago_movil';
        } else if (/\b(?:punto|pos|tarjeta|tdc|debito|biopago)\b/.test(norm)) {
          metodo = 'punto_venta';
        } else if (/\befectivo\b/.test(norm)) {
          metodo = 'efectivo_bs';
        }

        const tienePalabraEgreso =
          /\b(?:gastos?|compras?|hielo|insumos?)\b/.test(norm) ||
          /\bpago\s+a\b/.test(norm) ||
          norm.includes('-') ||
          /\b(?:leche|pasta|espagueti|azucar|canela|vainilla)\b/.test(norm) ||
          /\b(?:vasos?|pitillos?|tapas?|bolsas?|servilletas?|empaques?)\b/.test(norm) ||
          /\b(?:cashea|krece|cuotas?|prestamos?)\b/.test(norm) ||
          /\b(?:hamburguesas?|empanadas?|almuerzos?|desayunos?|cenas?|comidas?|refrescos?)\b/.test(norm) ||
          /\b(?:para\s+mi|mio|mia|ropa|regalos?|ocio|personal)\b/.test(norm) ||
          /\b(?:recargas?|saldos?|luz|cantv|internet|servicios?)\b/.test(norm) ||
          /\b(?:pasajes?|taxis?|gasolina|transporte|carreras?|fletes?)\b/.test(norm) ||
          /\b(?:nominas?|sueldos?|salarios?)\b/.test(norm) ||
          /\b(?:limpieza|cloro|jabon)\b/.test(norm);

        let esGasto = false;
        if (esRolVendedor) {
          esGasto = false;
        } else if (secItem === 'gastos') {
          esGasto = true;
        } else if (secItem === 'ventas') {
          esGasto = false;
        } else {
          esGasto = tienePalabraEgreso;
        }

        let tipo: 'venta' | 'gasto' = esGasto ? 'gasto' : 'venta';
        let categoria = 'Ventas';
        let naturaleza: 'Negocio' | 'Personal' | 'Créditos / Otros' = 'Negocio';
        let descripcion = chunk;

        if (tipo === 'venta') {
          categoria = 'Ventas';
          naturaleza = 'Negocio';
          if (metodo === 'pago_movil') descripcion = 'Venta Pago Móvil';
          else if (metodo === 'punto_venta') descripcion = 'Venta Punto de Venta';
          else if (metodo === 'divisa') descripcion = 'Venta Divisa';
          else descripcion = 'Venta Efectivo Bs';
        } else {
          if (/\b(?:nominas?|sueldos?|salarios?)\b/.test(norm)) {
            categoria = 'Nómina / Sueldos';
            naturaleza = 'Negocio';
            descripcion = 'Nómina / Sueldos';
          } else if (/\b(?:cashea|krece|cuotas?|prestamos?)\b/.test(norm)) {
            categoria = 'Créditos (Cashea / Krece)';
            naturaleza = 'Créditos / Otros';
            descripcion = norm.includes('cashea') ? 'Cuota Cashea' : norm.includes('krece') ? 'Cuota Krece' : 'Cuota Crédito';
          } else if (/\b(?:leche|pasta|espagueti|azucar|canela|vainilla|materia\s*prima)\b/.test(norm)) {
            categoria = 'Materia Prima';
            naturaleza = 'Negocio';
            if (norm.includes('leche condensada')) descripcion = 'Leche condensada';
            else if (norm.includes('leche')) descripcion = 'Leche';
            else if (norm.includes('pasta') || norm.includes('espagueti')) descripcion = 'Pasta';
            else if (norm.includes('azucar')) descripcion = 'Azúcar';
            else if (norm.includes('canela')) descripcion = 'Canela';
            else descripcion = 'Materia Prima';
          } else if (/\b(?:hamburguesas?|empanadas?|almuerzos?|desayunos?|cenas?|comidas?|refrescos?)\b/.test(norm)) {
            categoria = 'Comidas y Bebidas';
            naturaleza = 'Personal';
            if (norm.includes('hamburguesa')) descripcion = 'Hamburguesa personal';
            else if (norm.includes('empanada')) descripcion = 'Empanada personal';
            else if (norm.includes('almuerzo')) descripcion = 'Almuerzo personal';
            else if (norm.includes('refresco')) descripcion = 'Refresco personal';
            else descripcion = 'Comida personal';
          } else if (/\b(?:vasos?|pitillos?|tapas?|bolsas?|servilletas?|empaques?|insumos?)\b/.test(norm)) {
            categoria = 'Insumos y Empaques';
            naturaleza = 'Negocio';
            descripcion = 'Insumos y empaques';
          } else if (/\b(?:pasajes?|taxis?|gasolina|transporte|carreras?|fletes?)\b/.test(norm)) {
            categoria = 'Transporte y Logística';
            naturaleza = 'Negocio';
            descripcion = 'Transporte / Logística';
          } else if (/\b(?:recargas?|saldos?|luz|cantv|internet|servicios?)\b/.test(norm)) {
            categoria = 'Recargas y Servicios';
            naturaleza = 'Negocio';
            descripcion = 'Recargas y Servicios';
          } else if (/\b(?:ropa|regalos?|ocio|para\s+mi|mio|mia|personal)\b/.test(norm)) {
            categoria = 'Personal / Ocio / Regalos';
            naturaleza = 'Personal';
            descripcion = 'Gasto personal / ocio';
          } else {
            categoria = 'Hielo y Varios Operativos';
            naturaleza = 'Negocio';
            descripcion = norm.includes('hielo') ? 'Hielo' : norm.includes('limpieza') ? 'Limpieza' : 'Varios operativos';
          }
        }

        resultados.push({
          fecha: fechaActualCursor,
          descripcion,
          tipo,
          naturaleza,
          categoria: categoria as any,
          metodo_pago: metodo,
          moneda_original: moneda,
          monto_original: montoNum,
        });
      }
    }
  }

  return resultados;
}
