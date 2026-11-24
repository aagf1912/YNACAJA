// Cloudflare Pages Function: functions/api/analizar.ts
// Función deprecada: la carga de texto por IA fue eliminada en favor del registro manual directo.

export async function onRequest(): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'La funcionalidad de análisis por IA ha sido eliminada. Utilice el registro manual directo.',
      movimientos: [],
    }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
