/**
 * Utilidades de fecha para YnaCaja
 */

/**
 * Retorna la fecha actual en la zona horaria de Venezuela (UTC-4) en formato YYYY-MM-DD
 */
export function getVenezuelaDate(): string {
  const vzlaTime = new Date(Date.now() - 4 * 3600 * 1000);
  const yyyy = vzlaTime.getUTCFullYear();
  const mm = String(vzlaTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vzlaTime.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
