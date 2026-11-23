import { getVenezuelaDate } from './parserLocal';

export interface DiaSemanaInfo {
  fechaStr: string; // YYYY-MM-DD
  nombreDia: string; // Lunes, Martes, etc.
  diaCorto: string; // Lun, Mar, Mié, etc.
  dateObj: Date;
}

export interface InfoSemanaLunesSabado {
  lunes: Date;
  sabado: Date;
  semanaInicio: string; // YYYY-MM-DD (Lunes)
  semanaFin: string; // YYYY-MM-DD (Sábado)
  dias: DiaSemanaInfo[];
  rangoTexto: string; // e.g. "Lun 23 Nov - Sáb 28 Nov 2026"
}

/**
 * Calcula la semana comercial estrictamente de Lunes a Sábado.
 * Si la fecha base cae en domingo, se asocia al lunes precedente (cierre de la semana laborada).
 */
export function getSemanaLunesSabado(fechaBase?: Date | string): InfoSemanaLunesSabado {
  let d: Date;
  if (!fechaBase) {
    const vzla = getVenezuelaDate();
    const [y, m, day] = vzla.split('-').map(Number);
    d = new Date(y, m - 1, day, 12, 0, 0);
  } else if (typeof fechaBase === 'string') {
    const [y, m, day] = fechaBase.split('-').map(Number);
    d = new Date(y, m - 1, day, 12, 0, 0);
  } else {
    d = new Date(fechaBase.getFullYear(), fechaBase.getMonth(), fechaBase.getDate(), 12, 0, 0);
  }

  const dayOfWeek = d.getDay(); // 0: Domingo, 1: Lunes, ..., 6: Sábado
  // Si es domingo (0), asociar al lunes anterior (-6 días)
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const lunesDate = new Date(d);
  lunesDate.setDate(d.getDate() + diffToMonday);
  lunesDate.setHours(0, 0, 0, 0);

  const nombresDias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const diasCortos = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const dias: DiaSemanaInfo[] = [];

  for (let i = 0; i < 6; i++) {
    const cur = new Date(lunesDate);
    cur.setDate(lunesDate.getDate() + i);
    const yyyy = cur.getFullYear();
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const dd = String(cur.getDate()).padStart(2, '0');
    dias.push({
      fechaStr: `${yyyy}-${mm}-${dd}`,
      nombreDia: nombresDias[i],
      diaCorto: diasCortos[i],
      dateObj: cur,
    });
  }

  const sabadoDate = new Date(dias[5].dateObj);
  sabadoDate.setHours(23, 59, 59, 999);

  const formatCorta = (date: Date) => {
    const diaNum = date.getDate();
    const mes = date.toLocaleString('es-VE', { month: 'short' }).replace('.', '');
    return `${diaNum} ${mes.charAt(0).toUpperCase() + mes.slice(1)}`;
  };

  const rangoTexto = `Lun ${formatCorta(lunesDate)} - Sáb ${formatCorta(sabadoDate)} ${sabadoDate.getFullYear()}`;

  return {
    lunes: lunesDate,
    sabado: sabadoDate,
    semanaInicio: dias[0].fechaStr,
    semanaFin: dias[5].fechaStr,
    dias,
    rangoTexto,
  };
}

/**
 * Desplaza una fecha en semanas (+1, -1, etc.)
 */
export function shiftSemana(fechaBase: Date, deltaSemanas: number): Date {
  const nueva = new Date(fechaBase);
  nueva.setDate(nueva.getDate() + deltaSemanas * 7);
  return nueva;
}
