// Cloudflare Pages Function: functions/api/analizar.ts
// Backend serverless para analizar texto de ventas y gastos de Chicha Adictiva
// Extrae primero en JavaScript local (milisegundos) y usa Gemini 3.8 Flash como respaldo si es necesario

interface Env {
  GEMINI_API_KEY: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const TIMEOUT_MS = 10000;

interface MovimientoExtracted {
  fecha: string;
  descripcion: string;
  tipo: 'venta' | 'gasto';
  naturaleza: 'Negocio' | 'Personal' | 'Créditos / Otros';
  categoria: string;
  metodo_pago: 'pago_movil' | 'punto_venta' | 'efectivo_bs' | 'divisa';
  moneda_original: 'VES' | 'USD';
  monto_original: number;
}

/**
 * Parser ultrarrápido en JavaScript puro para extraer movimientos en milisegundos sin consumir cuota
 */
function extraerMovimientosLocal(texto: string, fechaReferencia: string): MovimientoExtracted[] {
  const refDate = fechaReferencia || new Date().toISOString().split('T')[0];
  const [refY, refM] = refDate.split('-').map(Number);

  function resolverFecha(textoSegmento: string, fechaActualContexto: string): string {
    if (!textoSegmento) return fechaActualContexto;

    // DD-MM-YYYY o DD/MM/YYYY o DD-MM-YY o DD/MM/YY
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

    // YYYY-MM-DD
    const isoMatch = textoSegmento.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    // Nombres de día: lunes 18, martes 18/11, etc.
    const diaNumMatch = textoSegmento.match(/\b(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\s+(\d{1,2})\b/i);
    if (diaNumMatch) {
      const d = parseInt(diaNumMatch[1], 10);
      if (d <= 31) {
        return `${refY}-${String(refM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    return fechaActualContexto;
  }

  const lineas = texto.split(/\r?\n/);
  const resultados: MovimientoExtracted[] = [];
  let fechaActualCursor = refDate;

  for (let linea of lineas) {
    linea = linea.trim();
    if (!linea) continue;

    // 1. Si la línea es SOLAMENTE una fecha o día (ej. "20-11-26", "18/11/2026:", "Martes 18:")
    const fechaPuraMatch = linea.match(/^(?:(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\s+)?(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{1,2})\:?$/i);
    if (fechaPuraMatch) {
      fechaActualCursor = resolverFecha(linea, fechaActualCursor);
      continue;
    }

    // 2. Si la línea empieza con un prefijo de fecha tipo "Martes 18: ..." o "18-11-26: ..."
    const headerMatch = linea.match(/^((?:(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\s+)?(?:\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{1,2}))\s*[\:\-]\s*(.*)$/i);
    let itemsStr = linea;
    if (headerMatch) {
      fechaActualCursor = resolverFecha(headerMatch[1], fechaActualCursor);
      itemsStr = headerMatch[2];
    }

    if (!itemsStr.trim()) continue;

    // Separar ítems por comas, punto y coma, " y ", o puntos seguidos de espacio o letra
    const items = itemsStr
      .split(/(?:[\,\;]\s+|\s+y\s+|\.\s+(?=[a-zA-Z\d]))/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const item of items) {
      // Buscar monto numérico (45.000, 45000, 15$, $15, 12,500.00, etc.)
      const regexMonto = /(?:\$|usd)?\s*(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+\.\d+|\d+)\s*(?:\$|usd|divisas?|dolares?|dólares?|bs|ves|bolivares|bolívares)?/i;
      const montoMatch = item.match(regexMonto);

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

      const norm = item.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // Detectar moneda original
      let moneda: 'VES' | 'USD' = 'VES';
      if (norm.includes('$') || norm.includes('usd') || norm.includes('divisa') || norm.includes('dolar')) {
        moneda = 'USD';
      }

      // Detectar método de pago
      let metodo: 'pago_movil' | 'punto_venta' | 'efectivo_bs' | 'divisa' = 'efectivo_bs';
      if (moneda === 'USD') {
        metodo = 'divisa';
      } else if (/\bpm\b|pago\s*movil|transferencia|transf|bcv|banesco|mercantil/.test(norm)) {
        metodo = 'pago_movil';
      } else if (/punto|pos|tarjeta|tdc|debito|biopago/.test(norm)) {
        metodo = 'punto_venta';
      } else if (/efectivo/.test(norm)) {
        metodo = 'efectivo_bs';
      }

      // Palabras clave de gastos
      const esGasto =
        norm.includes('hielo') ||
        norm.includes('leche') ||
        norm.includes('pasta') ||
        norm.includes('espagueti') ||
        norm.includes('azucar') ||
        norm.includes('canela') ||
        norm.includes('vainilla') ||
        norm.includes('vaso') ||
        norm.includes('pitillo') ||
        norm.includes('tapa') ||
        norm.includes('bolsa') ||
        norm.includes('servilleta') ||
        norm.includes('empaque') ||
        norm.includes('cashea') ||
        norm.includes('krece') ||
        norm.includes('cuota') ||
        norm.includes('prestamo') ||
        norm.includes('hamburguesa') ||
        norm.includes('empanada') ||
        norm.includes('almuerzo') ||
        norm.includes('desayuno') ||
        norm.includes('cena') ||
        norm.includes('comida') ||
        norm.includes('refresco') ||
        norm.includes('para mi') ||
        norm.includes('mio') ||
        norm.includes('ropa') ||
        norm.includes('recarga') ||
        norm.includes('saldo') ||
        norm.includes('pasaje') ||
        norm.includes('taxi') ||
        norm.includes('gasolina') ||
        norm.includes('nomina') ||
        norm.includes('sueldo') ||
        norm.includes('limpieza') ||
        norm.includes('cloro') ||
        norm.includes('jabon') ||
        norm.includes('gasto') ||
        norm.includes('compra');

      let tipo: 'venta' | 'gasto' = 'gasto';
      let categoria = 'Hielo y Varios Operativos';
      let naturaleza: 'Negocio' | 'Personal' | 'Créditos / Otros' = 'Negocio';
      let descripcion = item;

      if (!esGasto && (norm.includes('venta') || /\bpm\b|pago\s*movil/.test(norm) || norm.includes('punto') || norm.includes('divisa') || norm.includes('ingreso') || norm.includes('caja'))) {
        tipo = 'venta';
        categoria = 'Ventas';
        naturaleza = 'Negocio';
        if (metodo === 'pago_movil') descripcion = 'Venta Pago Móvil';
        else if (metodo === 'punto_venta') descripcion = 'Venta Punto de Venta';
        else if (metodo === 'divisa') descripcion = 'Venta Divisa';
        else descripcion = 'Venta Efectivo Bs';
      } else {
        tipo = 'gasto';

        // Clasificar en las 9 categorías obligatorias
        if (norm.includes('nomina') || norm.includes('sueldo') || norm.includes('salario')) {
          categoria = 'Nómina / Sueldos';
          naturaleza = 'Negocio';
          descripcion = 'Nómina / Sueldos';
        } else if (norm.includes('cashea') || norm.includes('krece') || norm.includes('cuota') || norm.includes('prestamo')) {
          categoria = 'Créditos (Cashea / Krece)';
          naturaleza = 'Créditos / Otros';
          descripcion = norm.includes('cashea') ? 'Cuota Cashea' : (norm.includes('krece') ? 'Cuota Krece' : 'Cuota Crédito');
        } else if (norm.includes('leche') || norm.includes('pasta') || norm.includes('espagueti') || norm.includes('azucar') || norm.includes('canela') || norm.includes('vainilla') || norm.includes('materia prima')) {
          categoria = 'Materia Prima';
          naturaleza = 'Negocio';
          if (norm.includes('leche condensada')) descripcion = 'Leche condensada';
          else if (norm.includes('leche')) descripcion = 'Leche';
          else if (norm.includes('pasta') || norm.includes('espagueti')) descripcion = 'Pasta';
          else if (norm.includes('azucar')) descripcion = 'Azúcar';
          else if (norm.includes('canela')) descripcion = 'Canela';
          else descripcion = 'Materia Prima';
        } else if (norm.includes('hamburguesa') || norm.includes('empanada') || norm.includes('almuerzo') || norm.includes('desayuno') || norm.includes('cena') || norm.includes('comida') || norm.includes('refresco')) {
          categoria = 'Comidas y Bebidas';
          naturaleza = 'Personal';
          if (norm.includes('hamburguesa')) descripcion = 'Hamburguesa personal';
          else if (norm.includes('empanada')) descripcion = 'Empanada personal';
          else if (norm.includes('almuerzo')) descripcion = 'Almuerzo personal';
          else if (norm.includes('refresco')) descripcion = 'Refresco personal';
          else descripcion = 'Comida personal';
        } else if (norm.includes('vaso') || norm.includes('pitillo') || norm.includes('tapa') || norm.includes('bolsa') || norm.includes('servilleta') || norm.includes('empaque')) {
          categoria = 'Insumos y Empaques';
          naturaleza = 'Negocio';
          descripcion = 'Insumos y empaques';
        } else if (norm.includes('pasaje') || norm.includes('taxi') || norm.includes('gasolina') || norm.includes('transporte') || norm.includes('carrera') || norm.includes('flete')) {
          categoria = 'Transporte y Logística';
          naturaleza = 'Negocio';
          descripcion = 'Transporte / Logística';
        } else if (norm.includes('recarga') || norm.includes('saldo') || norm.includes('luz') || norm.includes('cantv') || norm.includes('internet') || norm.includes('servicio')) {
          categoria = 'Recargas y Servicios';
          naturaleza = 'Negocio';
          descripcion = 'Recargas y Servicios';
        } else if (norm.includes('ropa') || norm.includes('regalo') || norm.includes('ocio') || norm.includes('para mi') || norm.includes('mio') || norm.includes('personal')) {
          categoria = 'Personal / Ocio / Regalos';
          naturaleza = 'Personal';
          descripcion = 'Gasto personal / ocio';
        } else {
          categoria = 'Hielo y Varios Operativos';
          naturaleza = 'Negocio';
          descripcion = norm.includes('hielo') ? 'Hielo' : (norm.includes('limpieza') ? 'Limpieza' : 'Varios operativos');
        }
      }

      resultados.push({
        fecha: fechaActualCursor,
        descripcion,
        tipo,
        naturaleza,
        categoria,
        metodo_pago: metodo,
        moneda_original: moneda,
        monto_original: montoNum,
      });
    }
  }

  return resultados;
}

/**
 * Respaldo: Ejecuta llamada a Gemini 3.8 Flash con AbortSignal.timeout(10000)
 */
async function llamarGeminiRespaldo(
  apiKey: string,
  payload: any
): Promise<{ ok: boolean; status: number; text: string; data?: any }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.ok) {
      const data = await res.json();
      return { ok: true, status: res.status, text: '', data };
    }

    const text = await res.text();
    return { ok: false, status: res.status, text };
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || err?.message?.toLowerCase().includes('timeout');
    return {
      ok: false,
      status: isTimeout ? 504 : 500,
      text: err?.message || 'Error de conexión / Timeout',
    };
  }
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;

    const body = (await request.json()) as { texto?: string; fecha_actual?: string };
    const texto = body?.texto?.trim();
    const fechaActual = body?.fecha_actual || new Date().toISOString().split('T')[0];

    if (!texto) {
      return new Response(
        JSON.stringify({ error: 'El campo texto es requerido para el análisis.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Intentar primero extraer directamente en JavaScript (ultrarrápido en milisegundos)
    const movimientosLocales = extraerMovimientosLocal(texto, fechaActual);

    if (movimientosLocales.length > 0) {
      return new Response(JSON.stringify({ movimientos: movimientosLocales }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Solo si el parser local no encontró movimientos, llamar a gemini-3.8-flash como respaldo
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'No se encontraron movimientos en la nota y GEMINI_API_KEY no está configurada.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemInstruction = `Eres el asistente contable del negocio "Chicha Adictiva". Tu misión es extraer y estructurar cada movimiento de ingresos y egresos.
La fecha de referencia de hoy es: ${fechaActual}.
Clasifica tipo ("venta"|"gasto"), naturaleza ("Negocio"|"Personal"|"Créditos / Otros"), categoría (Ventas si es ingreso, o una de las 9 categorías oficiales de gasto), metodo_pago ("pago_movil"|"punto_venta"|"efectivo_bs"|"divisa"), moneda_original ("VES"|"USD") y monto_original numérico.`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: texto }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            movimientos: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  fecha: { type: 'STRING' },
                  descripcion: { type: 'STRING' },
                  tipo: { type: 'STRING', enum: ['venta', 'gasto'] },
                  naturaleza: { type: 'STRING', enum: ['Negocio', 'Personal', 'Créditos / Otros'] },
                  categoria: {
                    type: 'STRING',
                    enum: [
                      'Ventas',
                      'Nómina / Sueldos',
                      'Créditos (Cashea / Krece)',
                      'Materia Prima',
                      'Personal / Ocio / Regalos',
                      'Transporte y Logística',
                      'Insumos y Empaques',
                      'Comidas y Bebidas',
                      'Hielo y Varios Operativos',
                      'Recargas y Servicios',
                    ],
                  },
                  metodo_pago: { type: 'STRING', enum: ['pago_movil', 'punto_venta', 'efectivo_bs', 'divisa'] },
                  moneda_original: { type: 'STRING', enum: ['VES', 'USD'] },
                  monto_original: { type: 'NUMBER' },
                },
                required: ['fecha', 'descripcion', 'tipo', 'naturaleza', 'categoria', 'metodo_pago', 'moneda_original', 'monto_original'],
              },
            },
          },
          required: ['movimientos'],
        },
      },
    };

    const geminiResultado = await llamarGeminiRespaldo(apiKey, payload);

    if (!geminiResultado.ok) {
      return new Response(
        JSON.stringify({ error: `Error desde Gemini API (${geminiResultado.status}): ${geminiResultado.text}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = geminiResultado.data as any;
    const rawJson = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJson) {
      return new Response(
        JSON.stringify({ error: 'No se obtuvo respuesta procesable de Gemini.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const parsed = JSON.parse(rawJson);
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error?.message || 'Error interno en el servidor.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};
