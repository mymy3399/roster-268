'use strict';

const TH_MONTHS = {
  'ม.ค.': 1, 'ม.ค': 1, 'มกราคม': 1,
  'ก.พ.': 2, 'ก.พ': 2, 'กุมภาพันธ์': 2,
  'มี.ค.': 3, 'มี.ค': 3, 'มีนาคม': 3,
  'เม.ย.': 4, 'เม.ย': 4, 'เมษายน': 4,
  'พ.ค.': 5, 'พ.ค': 5, 'พฤษภาคม': 5,
  'มิ.ย.': 6, 'มิ.ย': 6, 'มิถุนายน': 6,
  'ก.ค.': 7, 'ก.ค': 7, 'กรกฎาคม': 7,
  'ส.ค.': 8, 'ส.ค': 8, 'สิงหาคม': 8,
  'ก.ย.': 9, 'ก.ย': 9, 'กันยายน': 9,
  'ต.ค.': 10, 'ต.ค': 10, 'ตุลาคม': 10,
  'พ.ย.': 11, 'พ.ย': 11, 'พฤศจิกายน': 11,
  'ธ.ค.': 12, 'ธ.ค': 12, 'ธันวาคม': 12
};

const MONTH_NAMES_TH = [
  '', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

/**
 * Parse birth string like "10 พ.ค. 1996" or "30 พ.ย.2539" into day, month, year.
 */
export function parseBirthDate(str) {
  if (!str || typeof str !== 'string') return null;
  const cleaned = str.trim();
  const match = cleaned.match(/^(\d{1,2})\s*([\u0E00-\u0E7F\.]+)\s*(\d{4})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const mStr = match[2].trim();
  let year = parseInt(match[3], 10);

  // Convert BE to CE if > 2400
  if (year > 2400) year -= 543;

  const month = TH_MONTHS[mStr] || null;
  if (!month || day < 1 || day > 31) return null;

  return { day, month, year };
}

/**
 * Get days in month for leap year calculation.
 */
function getDaysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}

/**
 * Calculate next occurrence date of birthday from reference date.
 */
export function getNextBirthday(birthStr, now = new Date()) {
  const parsed = parseBirthDate(birthStr);
  if (!parsed) return null;

  const currentYear = now.getFullYear();
  let bdate = new Date(currentYear, parsed.month - 1, parsed.day);
  const today = new Date(currentYear, now.getMonth(), now.getDate());

  if (bdate < today) {
    bdate = new Date(currentYear + 1, parsed.month - 1, parsed.day);
  }

  const diffTime = bdate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
  return {
    date: bdate,
    daysUntil: diffDays,
    parsed
  };
}

/**
 * Check if birthday is today.
 */
export function isToday(birthStr, now = new Date()) {
  const parsed = parseBirthDate(birthStr);
  if (!parsed) return false;
  return parsed.day === now.getDate() && parsed.month === (now.getMonth() + 1);
}

/**
 * Check if birthday is in the current month.
 */
export function isThisMonth(birthStr, now = new Date()) {
  const parsed = parseBirthDate(birthStr);
  if (!parsed) return false;
  return parsed.month === (now.getMonth() + 1);
}

/**
 * Check if birthday is upcoming within next N days (1 to daysWindow, excluding today).
 */
export function isUpcoming(birthStr, now = new Date(), daysWindow = 14) {
  const nextInfo = getNextBirthday(birthStr, now);
  if (!nextInfo) return false;
  return nextInfo.daysUntil > 0 && nextInfo.daysUntil <= daysWindow;
}

/**
 * Calculate age turning on next birthday.
 */
export function calculateAgeTurning(birthStr, now = new Date()) {
  const nextInfo = getNextBirthday(birthStr, now);
  if (!nextInfo) return null;
  return nextInfo.date.getFullYear() - nextInfo.parsed.year;
}

/**
 * Get list of people with birthdays today.
 */
export function getBirthdaysToday(people, now = new Date()) {
  if (!Array.isArray(people)) return [];
  return people
    .filter(p => isToday(p.birth, now))
    .sort((a, b) => a.no - b.no);
}

/**
 * Get list of people with birthdays this month, sorted by day of month.
 */
export function getBirthdaysThisMonth(people, now = new Date()) {
  if (!Array.isArray(people)) return [];
  return people
    .filter(p => isThisMonth(p.birth, now))
    .map(p => {
      const parsed = parseBirthDate(p.birth);
      return { person: p, day: parsed ? parsed.day : 99 };
    })
    .sort((a, b) => a.day - b.day || a.person.no - b.person.no)
    .map(item => item.person);
}

/**
 * Get list of people with upcoming birthdays within daysWindow, sorted by days remaining.
 */
export function getBirthdaysUpcoming(people, now = new Date(), daysWindow = 14) {
  if (!Array.isArray(people)) return [];
  return people
    .map(p => {
      const nextInfo = getNextBirthday(p.birth, now);
      return { person: p, nextInfo };
    })
    .filter(item => item.nextInfo && item.nextInfo.daysUntil > 0 && item.nextInfo.daysUntil <= daysWindow)
    .sort((a, b) => a.nextInfo.daysUntil - b.nextInfo.daysUntil || a.person.no - b.person.no)
    .map(item => ({
      ...item.person,
      daysUntil: item.nextInfo.daysUntil
    }));
}

/**
 * Calculate countdown days until graduation day (18 September 2026 / 2569 BE).
 */
export function getCountdownToGraduation(now = new Date()) {
  const targetYear = 2026;
  const targetMonth = 8; // September (0-indexed: 8)
  const targetDay = 18;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(targetYear, targetMonth, targetDay);

  const diffTime = target.getTime() - today.getTime();
  const days = Math.round(diffTime / (1000 * 3600 * 24));

  return {
    days,
    targetDateStr: '18 ก.ย. 2569',
    isPassed: days < 0,
    isToday: days === 0
  };
}

export { MONTH_NAMES_TH };
