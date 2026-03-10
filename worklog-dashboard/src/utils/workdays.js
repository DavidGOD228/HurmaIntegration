/**
 * Working-day and working-hours utilities.
 *
 * Ukrainian standard: Mon–Fri, 8h/day, national public holidays excluded.
 * Public holidays are fetched from the `public_holidays` DB table and can be
 * imported manually or via an admin action.
 */

/**
 * Returns true if `date` is a Saturday (6) or Sunday (0).
 * @param {Date} date
 */
function isWeekend(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Returns true if `dateStr` (YYYY-MM-DD) appears in `holidaySet` (Set of YYYY-MM-DD strings).
 * @param {string} dateStr
 * @param {Set<string>} holidaySet
 */
function isPublicHoliday(dateStr, holidaySet) {
  return holidaySet.has(dateStr);
}

/**
 * Format a Date as YYYY-MM-DD (UTC).
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Iterate all dates from `from` to `to` (inclusive), call `cb(dateStr)`.
 * Both arguments may be Date objects or YYYY-MM-DD strings.
 */
function eachDay(from, to, cb) {
  const start = new Date(from + (typeof from === 'string' ? 'T00:00:00Z' : ''));
  const end   = new Date(to   + (typeof to   === 'string' ? 'T00:00:00Z' : ''));
  const cur = new Date(start);
  while (cur <= end) {
    cb(toDateString(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/**
 * Count working days between `from` and `to` (inclusive), excluding weekends
 * and any date in `holidaySet`.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 * @param {Set<string>} holidaySet
 * @returns {number}
 */
function countWorkingDays(from, to, holidaySet = new Set()) {
  let count = 0;
  eachDay(from, to, (dateStr) => {
    if (!isWeekend(dateStr) && !isPublicHoliday(dateStr, holidaySet)) count++;
  });
  return count;
}

/**
 * Given a day string, absence records and the employee work-hours-per-day,
 * return the expected hours for that specific day.
 *
 * @param {string}   dateStr     YYYY-MM-DD
 * @param {number}   hoursPerDay Default working hours (e.g. 8)
 * @param {Set<string>} holidaySet
 * @param {Array}    absences    rows from the `absences` table for this employee
 * @returns {{ expectedHours: number, leaveType: string|null }}
 */
function getDayExpectation(dateStr, hoursPerDay, holidaySet, absences) {
  if (isWeekend(dateStr) || isPublicHoliday(dateStr, holidaySet)) {
    return { expectedHours: 0, leaveType: null };
  }

  // Check if any absence covers this day
  for (const absence of absences) {
    const from = absence.date_from instanceof Date
      ? toDateString(absence.date_from)
      : absence.date_from;
    const to   = absence.date_to instanceof Date
      ? toDateString(absence.date_to)
      : absence.date_to;
    if (dateStr >= from && dateStr <= to) {
      const absenceHours = parseFloat(absence.hours) || hoursPerDay;
      // Full day absence
      if (absenceHours >= hoursPerDay) {
        return { expectedHours: 0, leaveType: absence.absence_type };
      }
      // Partial absence — reduce expected by absence hours
      return {
        expectedHours: Math.max(0, hoursPerDay - absenceHours),
        leaveType: absence.absence_type,
      };
    }
  }

  return { expectedHours: hoursPerDay, leaveType: null };
}

/**
 * Ukrainian public holidays 2025–2026 (fixed-date holidays only).
 * Movable holidays (Easter, Trinity) should be loaded from DB.
 * @returns {string[]} Array of YYYY-MM-DD strings
 */
function getUkrainianHolidays2025_2026() {
  return [
    '2025-01-01', // New Year
    '2025-01-07', // Orthodox Christmas (old calendar)
    '2025-03-08', // International Women's Day
    '2025-05-01', // International Labour Day
    '2025-05-09', // Victory Day
    '2025-06-28', // Constitution Day
    '2025-08-24', // Independence Day
    '2025-10-14', // Defenders' Day
    '2025-12-25', // Christmas (new calendar, officially added)
    '2026-01-01',
    '2026-01-07',
    '2026-03-08',
    '2026-05-01',
    '2026-05-09',
    '2026-06-28',
    '2026-08-24',
    '2026-10-14',
    '2026-12-25',
  ];
}

module.exports = {
  isWeekend,
  isPublicHoliday,
  toDateString,
  eachDay,
  countWorkingDays,
  getDayExpectation,
  getUkrainianHolidays2025_2026,
};
