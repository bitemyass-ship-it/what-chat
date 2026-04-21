import {
  assertReportPeriodNotFuture,
  parseReportPeriod,
  REPORT_PERIOD_FUTURE_ERROR,
  REPORT_PERIOD_FORMAT_ERROR
} from '../../src/reports/report-period';

const toUnixSeconds = (date: Date): number => Math.floor(date.getTime() / 1_000);

describe('report period parsing', () => {
  it.each([
    ['202605', 2026, 4, 5],
    ['202601', 2026, 0, 1],
    ['202612', 2026, 11, 12]
  ])('should parse %s as a local calendar month', (period, year, monthIndex) => {
    const range = parseReportPeriod(period);
    const expectedStartDate = new Date(year, monthIndex, 1, 0, 0, 0, 0);
    const expectedEndDate = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);

    expect(range).toEqual({
      endDate: expectedEndDate,
      endTimestamp: toUnixSeconds(expectedEndDate),
      period,
      startDate: expectedStartDate,
      startTimestamp: toUnixSeconds(expectedStartDate)
    });
  });

  it.each(['202600', '202613', '2026', '20260501', 'abc'])(
    'should reject invalid period %s',
    (period) => {
      expect(() => parseReportPeriod(period)).toThrow(REPORT_PERIOD_FORMAT_ERROR);
    }
  );

  it('should reject periods after the current local calendar month', () => {
    const now = new Date(2026, 3, 21, 12, 0, 0, 0);

    expect(() => {
      assertReportPeriodNotFuture(parseReportPeriod('202605'), now);
    }).toThrow(REPORT_PERIOD_FUTURE_ERROR);
    expect(() => {
      assertReportPeriodNotFuture(parseReportPeriod('202604'), now);
    }).not.toThrow();
    expect(() => {
      assertReportPeriodNotFuture(parseReportPeriod('202603'), now);
    }).not.toThrow();
  });
});
