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

const TIMEOUT_MS = 20000;

export interface MovimientoExtracted {
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
 * Retorna la fecha actual en zona horaria Venezuela (UTC-4) en formato YYYY-MM-DD
 */
function getVenezuelaDate(): string {
  const vzlaTime = new Date(Date.now() - 4 * 3600 * 1000);
  const yyyy = vzlaTime.getUTCFullYear();
  const mm = String(vzlaTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vzlaTime.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parser ultrarrápido en JavaScript puro para extraer movimientos en milisegundos sin consumir cuota
 */
export function extraerMovimientosLocal(
  texto: string,
  fechaReferencia?: string,
  rolUsuario?: string
): MovimientoExtracted[] {
  const refDate = fechaReferencia || getVenezuelaDate();
  const [refY] = refDate.split('-').map(Number);
  const esRolVendedor = rolUsuario === 'vendedor';

  function resolverFecha(textoSegmento: string, fallback: string): string {
    if (!textoSegmento) return fallback;

    // YYYY-MM-DD o YYYY/MM/DD
    const isoMatch = textoSegmento.match(/\b(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
    if (isoMatch) {
      return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
    }

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

    return fallback;
  }

  const lineas = texto.split(/\r?\n/);
  const resultados: MovimientoExtracted[] = [];
  let fechaActualCursor = refDate;
  let seccionActual: 'ventas' | 'gastos' | 'general' = 'general';

  for (let linea of lineas) {
    linea = linea.trim();
    if (!linea) continue;

    // 2. Ignorar cualquier línea completa que contenga la palabra "total" (ej: "Total: 50,33$" o "Total ventas: 100")
    if (/\btotal(?:es)?\b/i.test(linea) && !/\b(ventas?|gastos?|egresos?|ingresos?)\s*[:=-]/i.test(linea)) {
      continue;
    }

    // 1. Extraer la fecha primero (DD-MM-YY o DD/MM/YYYY) y BORRAR ese texto antes de buscar montos
    const dateRegex = /\b(?:(20\d{2}[\/\-]\d{1,2}[\/\-]\d{1,2})|(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?))\b/;
    const dateMatch = linea.match(dateRegex);
    if (dateMatch) {
      const fechaDetectada = resolverFecha(dateMatch[0], '');
      if (fechaDetectada) {
        fechaActualCursor = fechaDetectada;
        // Borrar el texto de la fecha para que el año (ej. "26" en "19-11-26") nunca se lea como monto
        linea = linea.replace(dateMatch[0], ' ');
      }
    }

    // Borrar nombres de día de la semana si quedaron sueltos
    linea = linea.replace(/\b(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/gi, ' ');

    // Limpiar caracteres de markdown, dos puntos o guiones al inicio/final
    linea = linea.replace(/^[\s#*_\-:\.]+\s*/, '').replace(/[*_]+$/, '').trim();
    if (!linea) continue;

    // 4. Soportar encabezados de sección ("Ventas:" vs "Gastos:")
    if (/^(?:ventas?|ingresos?)\s*[:=-]?$/i.test(linea)) {
      seccionActual = 'ventas';
      continue;
    }
    if (/^(?:gastos?|egresos?)\s*[:=-]?$/i.test(linea)) {
      seccionActual = 'gastos';
      continue;
    }

    // Si la línea contiene "Ventas: ... Gastos: ..." en la misma línea
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
      // Separar ítems por comas, punto y coma, " y ", o puntos seguidos de espacio o letra
      const chunks = parte.texto
        .split(/(?:[\,\;]\s+|\s+y\s+|\.\s+(?=[a-zA-Z\d]))/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const chunk of chunks) {
        // 2. Ignorar cualquier bloque individual que diga "total" (ej: "Total: 50,33$")
        if (/\btotal(?:es)?\b/i.test(chunk)) {
          continue;
        }

        // 3. Aceptar montos CON o SIN unidad después de un método de pago (ej. "efectivo: 10950", "Pmovil: 52646", "6.500bs", "1$")
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

        // 4. Normalizar tildes y mayúsculas
        const norm = chunk.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // 3. Moneda original: si no tiene "$", "usd" ni "divisa", asumir Bolívares (VES)
        let moneda: 'VES' | 'USD' = 'VES';
        if (norm.includes('$') || norm.includes('usd') || norm.includes('divisa') || norm.includes('dolar')) {
          moneda = 'USD';
        }

        // 4. Detectar método de pago normalizado
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

        // 5. Palabras explícitas de egreso ("gasto", "compra", "hielo", "insumo", "pago a", "-")
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

        // Si el body indica rol: 'vendedor', forzarlo SIEMPRE a ingreso (Ventas)
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
          // Gasto: clasificar en las 9 categorías oficiales
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
          categoria,
          metodo_pago: metodo,
          moneda_original: moneda,
          monto_original: montoNum,
        });
      }
    }
  }

  return resultados;
}

/**
 * Respaldo: Ejecuta llamada a Gemini 3.8 Flash con thinkingBudget: 0 y timeout de 20s
 */
async function llamarGeminiRespaldo(
  apiKey: string,
  payload: any,
  usarThinkingConfig: boolean = true
): Promise<{ ok: boolean; status: number; text: string; data?: any }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

  const copiaPayload = JSON.parse(JSON.stringify(payload));
  if (!usarThinkingConfig && copiaPayload?.generationConfig?.thinkingConfig) {
    delete copiaPayload.generationConfig.thinkingConfig;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(copiaPayload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.ok) {
      const data = await res.json();
      return { ok: true, status: res.status, text: '', data };
    }

    const text = await res.text();
    // Si falla por parámetro 400 y estábamos usando thinkingConfig, reintentar sin thinkingConfig
    if (res.status === 400 && usarThinkingConfig) {
      console.warn('Gemini 3.8 Flash rechazó thinkingConfig, reintentando sin él...');
      return llamarGeminiRespaldo(apiKey, payload, false);
    }

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

    const body = (await request.json()) as { texto?: string; fecha_actual?: string; rol?: string };
    const texto = body?.texto?.trim();
    const fechaActual = body?.fecha_actual || getVenezuelaDate();
    const rolUsuario = body?.rol || 'admin';

    if (!texto) {
      return new Response(
        JSON.stringify({ error: 'El campo texto es requerido para el análisis.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Intentar primero extraer directamente en JavaScript local (ultrarrápido en milisegundos)
    const movimientosLocales = extraerMovimientosLocal(texto, fechaActual, rolUsuario);

    if (movimientosLocales.length > 0) {
      return new Response(JSON.stringify({ movimientos: movimientosLocales }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Solo si el parser local no encontró movimientos, llamar a gemini-3.8-flash como respaldo
    const rawKey = env.GEMINI_API_KEY || (typeof process !== 'undefined' ? (process.env as any)?.GEMINI_API_KEY : '') || '';
    const apiKeys = rawKey.split(',').map((k: string) => k.trim()).filter(Boolean);

    if (apiKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No se encontraron movimientos en la nota y GEMINI_API_KEY no está configurada.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemInstruction = `Eres el asistente contable del negocio "Chicha Adictiva". Tu misión es extraer y estructurar cada movimiento de ingresos y egresos.
La fecha de referencia de hoy es: ${fechaActual}.
${rolUsuario === 'vendedor' ? 'El usuario es vendedor: TODO movimiento debe ser de tipo "venta", categoría "Ventas" y naturaleza "Negocio".' : ''}
Clasifica tipo ("venta"|"gasto"), naturaleza ("Negocio"|"Personal"|"Créditos / Otros"), categoría (Ventas si es ingreso, o una de las 9 categorías oficiales de gasto), metodo_pago ("pago_movil"|"punto_venta"|"efectivo_bs"|"divisa"), moneda_original ("VES"|"USD") y monto_original numérico.`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: texto }] }],
      systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
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

    let geminiResultado: { ok: boolean; status: number; text: string; data?: any } = {
      ok: false,
      status: 500,
      text: 'No se ejecutó la petición a Gemini.',
    };

    // Recorrer las claves en orden: si una devuelve 429 (cuota agotada), pasa automáticamente a la siguiente clave
    for (const key of apiKeys) {
      geminiResultado = await llamarGeminiRespaldo(key, payload, true);
      if (geminiResultado.ok) {
        break;
      }
      if (geminiResultado.status === 429) {
        console.warn('Clave de Gemini con cuota agotada (429), pasando a la siguiente clave...');
        continue;
      }
      console.warn(`Clave de Gemini devolvió status ${geminiResultado.status}, probando con la siguiente clave...`);
    }

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
