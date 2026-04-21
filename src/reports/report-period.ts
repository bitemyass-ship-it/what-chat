export interface ReportPeriodRange {
  endDate: Date;
  endTimestamp: number;
  period: string;
  startDate: Date;
  startTimestamp: number;
}

export const REPORT_PERIOD_FORMAT_ERROR =
  'period route parameter must use YYYYMM format';
export const REPORT_PERIOD_FUTURE_ERROR = 'period must not be in the future';

const createLocalMonthBoundary = (year: number, monthIndex: number): Date => {
  const date = new Date(0);

  date.setFullYear(year, monthIndex, 1);
  date.setHours(0, 0, 0, 0);

  return date;
};

const toUnixSeconds = (date: Date): number =>
  Math.floor(date.getTime() / 1_000);

export const parseReportPeriod = (value: string): ReportPeriodRange => {
  const period = value.trim();

  if (!/^\d{6}$/u.test(period)) {
    throw new Error(REPORT_PERIOD_FORMAT_ERROR);
  }

  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));

  if (month < 1 || month > 12) {
    throw new Error(REPORT_PERIOD_FORMAT_ERROR);
  }

  const startDate = createLocalMonthBoundary(year, month - 1);
  const endDate = createLocalMonthBoundary(year, month);

  return {
    endDate,
    endTimestamp: toUnixSeconds(endDate),
    period,
    startDate,
    startTimestamp: toUnixSeconds(startDate)
  };
};

export const assertReportPeriodNotFuture = (
  range: ReportPeriodRange,
  now: Date = new Date()
): void => {
  const currentMonthStart = createLocalMonthBoundary(
    now.getFullYear(),
    now.getMonth()
  );

  if (range.startDate.getTime() > currentMonthStart.getTime()) {
    throw new Error(REPORT_PERIOD_FUTURE_ERROR);
  }
};
