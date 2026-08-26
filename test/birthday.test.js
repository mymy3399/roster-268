'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

test('birthday module parses Thai date strings correctly', async () => {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'public', 'js', 'birthday.mjs')
  ).href;
  const { parseBirthDate, isToday, isThisMonth, isUpcoming, getBirthdaysToday, getBirthdaysThisMonth, getBirthdaysUpcoming } = await import(moduleUrl);

  // Test parseBirthDate
  assert.deepEqual(parseBirthDate('10 พ.ค. 1996'), { day: 10, month: 5, year: 1996 });
  assert.deepEqual(parseBirthDate('30 พ.ย.2539'), { day: 30, month: 11, year: 1996 });
  assert.deepEqual(parseBirthDate('3 เม.ย. 1991'), { day: 3, month: 4, year: 1991 });
  assert.equal(parseBirthDate('invalid date'), null);

  // Test date matching with fixed reference date (e.g. May 10, 2026)
  const refDate = new Date(2026, 4, 10); // Month index 4 is May (May 10)

  assert.equal(isToday('10 พ.ค. 1996', refDate), true);
  assert.equal(isToday('11 พ.ค. 1996', refDate), false);

  assert.equal(isThisMonth('25 พ.ค. 1990', refDate), true);
  assert.equal(isThisMonth('1 มิ.ย. 1990', refDate), false);

  assert.equal(isUpcoming('15 พ.ค. 1990', refDate, 14), true); // 5 days away
  assert.equal(isUpcoming('10 พ.ค. 1996', refDate, 14), false); // Today (not upcoming)
  assert.equal(isUpcoming('30 พ.ค. 1990', refDate, 14), false); // 20 days away

  // Test lists filtering
  const people = [
    { no: 1, name: 'กนกกาญจน์', birth: '10 พ.ค. 1996' },
    { no: 2, name: 'กรวิทย์', birth: '15 พ.ค. 1988' },
    { no: 3, name: 'กฤตยา', birth: '3 เม.ย. 1991' },
    { no: 4, name: 'กฤษฎา', birth: '28 พ.ค. 1988' }
  ];

  const todayList = getBirthdaysToday(people, refDate);
  assert.equal(todayList.length, 1);
  assert.equal(todayList[0].no, 1);

  const monthList = getBirthdaysThisMonth(people, refDate);
  assert.equal(monthList.length, 3); // 10, 15, 28 May
  assert.equal(monthList[0].no, 1); // May 10 first
  assert.equal(monthList[1].no, 2); // May 15 second
  assert.equal(monthList[2].no, 4); // May 28 third

  const upcomingList = getBirthdaysUpcoming(people, refDate, 14);
  assert.equal(upcomingList.length, 1); // May 15 is 5 days away (within 14 days)
  assert.equal(upcomingList[0].no, 2);
  assert.equal(upcomingList[0].daysUntil, 5);
});

test('graduation countdown calculates days until September 18, 2026', async () => {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'public', 'js', 'birthday.mjs')
  ).href;
  const { getCountdownToGraduation } = await import(moduleUrl);

  const refDateBefore = new Date(2026, 7, 26); // Aug 26, 2026
  const resultBefore = getCountdownToGraduation(refDateBefore);
  assert.equal(resultBefore.days, 23);
  assert.equal(resultBefore.isToday, false);
  assert.equal(resultBefore.isPassed, false);

  const refDateToday = new Date(2026, 8, 18); // Sep 18, 2026
  const resultToday = getCountdownToGraduation(refDateToday);
  assert.equal(resultToday.days, 0);
  assert.equal(resultToday.isToday, true);
  assert.equal(resultToday.isPassed, false);
});
