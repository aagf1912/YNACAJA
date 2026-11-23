// Cloudflare Pages Function: functions/api/analizar.ts
// Backend serverless para analizar texto de ventas y gastos de Chicha Adictiva usando Gemini 3.8 Flash

interface Env {
  GEMINI_API_KEY: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function llamarGeminiConReintentos(
  modelo: string,
  apiKey: string,
  payload: any
): Promise<{ ok: boolean; status: number; text: string; data?: any }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
  const maxIntentos = 3; // Intento inicial + hasta 2 reintentos (3 intentos totales)
  let ultimoStatus = 0;
  let ultimoTexto = '';

  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        return { ok: true, status: res.status, text: '', data };
      }

      ultimoStatus = res.status;
      ultimoTexto = await res.text();

      // Si es saturación (429 Too Many Requests o 503 Service Unavailable) y no es el último intento, esperar 1.5s
      if ((res.status === 429 || res.status === 503) && intento < maxIntentos) {
        await delay(1500);
        continue;
      }

      // Si es otro error de cliente (ej. 400), no tiene sentido reintentar
      return { ok: false, status: res.status, text: ultimoTexto };
    } catch (e: any) {
      ultimoStatus = 500;
      ultimoTexto = e?.message || 'Error de conexión';
      if (intento < maxIntentos) {
        await delay(1500);
      }
    }
  }

  return { ok: false, status: ultimoStatus, text: ultimoTexto };
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

    const body = await request.json() as { texto?: string; fecha_actual?: string };
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

    // 1. Intentar con modelo principal gemini-3.8-flash (con hasta 2 reintentos ante 429/503 con 1.5s de espera)
    let geminiResultado = await llamarGeminiConReintentos('gemini-3.8-flash', apiKey, payload);

    // 2. Si falló por saturación (429 Too Many Requests o 503 Service Unavailable), fallback al modelo gemini-3.8-flash-lite
    if (!geminiResultado.ok && (geminiResultado.status === 429 || geminiResultado.status === 503)) {
      geminiResultado = await llamarGeminiConReintentos('gemini-3.8-flash-lite', apiKey, payload);
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
