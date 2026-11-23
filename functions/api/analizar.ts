// Cloudflare Pages Function: functions/api/analizar.ts
// Backend serverless para analizar texto de ventas y gastos de Chicha Adictiva usando Gemini con reintentos y fallback dinámico

interface Env {
  GEMINI_API_KEY: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const TIMEOUT_MS = 15000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta una petición directa a generateContent con timeout de 15s
 */
async function ejecutarLlamadaGemini(
  modelo: string,
  apiKey: string,
  payload: any
): Promise<{ ok: boolean; status: number; text: string; data?: any }> {
  const modelClean = modelo.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelClean}:generateContent?key=${apiKey}`;

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

/**
 * Llama a Gemini con hasta N reintentos si responde 503 o 429
 */
async function llamarConReintentos(
  modelo: string,
  apiKey: string,
  payload: any,
  maxReintentos: number = 3,
  delayMs: number = 2000
): Promise<{ ok: boolean; status: number; text: string; data?: any }> {
  let resultado = await ejecutarLlamadaGemini(modelo, apiKey, payload);

  for (let r = 1; r <= maxReintentos; r++) {
    // Si respondió OK o el error NO es 429 ni 503, no reintentamos
    if (resultado.ok || (resultado.status !== 429 && resultado.status !== 503)) {
      break;
    }
    await delay(delayMs);
    resultado = await ejecutarLlamadaGemini(modelo, apiKey, payload);
  }

  return resultado;
}

/**
 * Consulta la lista de modelos de Gemini y devuelve el primer modelo
 * disponible que contenga "flash" y soporte "generateContent"
 */
async function obtenerPrimerModeloFlashDisponible(apiKey: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
    };
    const models = data?.models || [];

    // Elegir el primer modelo disponible que contenga "flash" y soporte "generateContent"
    const match = models.find((m) => {
      const name = (m.name || '').toLowerCase();
      const supportsGen = Array.isArray(m.supportedGenerationMethods)
        ? m.supportedGenerationMethods.includes('generateContent')
        : false;
      return name.includes('flash') && supportsGen;
    });

    if (match) {
      return match.name.replace(/^models\//, '');
    }
  } catch (err) {
    console.warn('Error listando modelos disponibles de Gemini:', err);
  }
  return null;
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

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Configuración de servidor incompleta: GEMINI_API_KEY no encontrada.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = (await request.json()) as { texto?: string; fecha_actual?: string };
    const texto = body?.texto?.trim();
    const fechaActual = body?.fecha_actual || new Date().toISOString().split('T')[0];

    if (!texto) {
      return new Response(
        JSON.stringify({ error: 'El campo texto es requerido para el análisis.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemInstruction = `Eres el asistente contable del negocio "Chicha Adictiva". Tu misión es extraer y estructurar con precisión matemática y contable cada uno de los movimientos de ingresos (ventas) y egresos (gastos) que el usuario copie desde mensajes informales de WhatsApp o notas diarias.
La fecha de referencia de hoy es: ${fechaActual}.

Reglas estrictas de clasificación:
1. tipo:
   - "venta" para todo ingreso por ventas del negocio.
   - "gasto" para cualquier egreso o salida de dinero.

2. naturaleza:
   - "Negocio": todas las ventas del negocio, y todos los gastos operativos del puesto de chicha (materia prima, nómina, insumos, hielo, servicios operativos, transporte del negocio).
   - "Créditos / Otros": cuotas, financiamientos, préstamos o pagos de servicios como Cashea, Krece.
   - "Personal": cualquier consumo o gasto propio del dueño o su familia (ej: "hamburguesa para mí", "almuerzo mío", "refresco", "ropa", "regalos", "ocio", "casa").

3. categoria:
   - Si tipo === "venta", SIEMPRE debe ser "Ventas" (naturaleza: "Negocio").
   - Si tipo === "gasto", DEBE ser exactamente una de estas 9 categorías:
     1. "Nómina / Sueldos" (naturaleza: "Negocio")
     2. "Créditos (Cashea / Krece)" (naturaleza: "Créditos / Otros")
     3. "Materia Prima" (leche, pasta, azúcar, canela, leche condensada, vainilla, ingredientes) (naturaleza: "Negocio")
     4. "Personal / Ocio / Regalos" (gastos personales no alimenticios, compras personales, ropa, ocio) (naturaleza: "Personal")
     5. "Transporte y Logística" (pasajes, taxis, carreras, fletes, gasolina) (naturaleza: "Negocio")
     6. "Insumos y Empaques" (vasos, pitillos, tapas, bolsas, servilletas, empaques) (naturaleza: "Negocio")
     7. "Comidas y Bebidas" (comidas y bebidas personales del día: hamburguesa, empanada, almuerzo, refresco propio) (naturaleza: "Personal")
     8. "Hielo y Varios Operativos" (hielo, limpieza, cloro, jabón, reparaciones del carrito, bolsas de basura) (naturaleza: "Negocio")
     9. "Recargas y Servicios" (recargas de saldo, telefonía, internet, luz, servicios públicos) (naturaleza: "Negocio")

4. metodo_pago:
   - "pago_movil" si menciona: "pm", "pago movil", "transferencia", "banesco", "mercantil", "bancaribe", "bcv".
   - "punto_venta" si menciona: "punto", "tarjeta", "tdc", "debito", "biopago".
   - "divisa" si menciona: "divisa", "$", "dolar", "dolares", "efectivo $", "cash $".
   - "efectivo_bs" si menciona efectivo en bolívares, o si es un gasto en bolívares sin método especificado.

5. moneda_original:
   - "USD" si el monto fue pagado o cobrado en dólares/divisas o lleva símbolo $.
   - "VES" si el monto está en bolívares o sin divisa explícita.

6. monto_original:
   - Número positivo limpio (float/integer), sin letras ni símbolos.

7. descripcion:
   - Texto breve, limpio y representativo (ej: "Venta Pago Móvil", "Hielo para el carrito", "Hamburguesa personal", "Cuota Cashea", "Vasos y pitillos").

8. fecha:
   - Formato estricto YYYY-MM-DD. Si el texto indica días de la semana ("lunes", "martes", "ayer", "hoy", "18/11"), calcula la fecha exacta en base a ${fechaActual}. Si no indica fecha, usa ${fechaActual}.`;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: texto }],
        },
      ],
      systemInstruction: {
        role: 'system',
        parts: [{ text: systemInstruction }],
      },
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
                  fecha: { type: 'STRING', description: 'Fecha en formato YYYY-MM-DD' },
                  descripcion: { type: 'STRING', description: 'Descripción clara del movimiento' },
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
                  metodo_pago: {
                    type: 'STRING',
                    enum: ['pago_movil', 'punto_venta', 'efectivo_bs', 'divisa'],
                  },
                  moneda_original: { type: 'STRING', enum: ['VES', 'USD'] },
                  monto_original: { type: 'NUMBER', description: 'Monto numérico positivo' },
                },
                required: [
                  'fecha',
                  'descripcion',
                  'tipo',
                  'naturaleza',
                  'categoria',
                  'metodo_pago',
                  'moneda_original',
                  'monto_original',
                ],
              },
            },
          },
          required: ['movimientos'],
        },
      },
    };

    // 1. Usar gemini-3.8-flash como modelo principal con hasta 3 reintentos esperando 2s ante 503 o 429
    let geminiResultado = await llamarConReintentos('gemini-3.8-flash', apiKey, payload, 3, 2000);

    // 2. Si después de los reintentos sigue fallando o da 404, consultar la lista de modelos disponibles
    if (!geminiResultado.ok) {
      console.warn(`Modelo principal gemini-3.8-flash falló (${geminiResultado.status}). Buscando modelo Flash disponible...`);
      const modeloFallback = await obtenerPrimerModeloFlashDisponible(apiKey);

      if (modeloFallback && modeloFallback !== 'gemini-3.8-flash') {
        console.info(`Ejecutando petición con modelo fallback: ${modeloFallback}`);
        geminiResultado = await llamarConReintentos(modeloFallback, apiKey, payload, 2, 2000);
      }
    }

    if (!geminiResultado.ok) {
      return new Response(
        JSON.stringify({ error: `Error desde Gemini API (${geminiResultado.status}): ${geminiResultado.text}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = geminiResultado.data as any;
    const candidates = geminiData?.candidates;
    const rawJson = candidates?.[0]?.content?.parts?.[0]?.text;

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
