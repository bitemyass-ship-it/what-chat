import {
  formatCallInfo,
  formatReportCsvDocument,
  formatReportCsvLine,
  REPORT_CSV_HEADER
} from '../../src/reports/report-csv';

const localTimestamp = (
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second = 0
): number =>
  Math.floor(new Date(year, monthIndex, day, hour, minute, second, 0).getTime() / 1_000);

describe('report CSV formatting', () => {
  it('should include the UTF-8 BOM and exact header', () => {
    const csv = formatReportCsvDocument([]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(`${REPORT_CSV_HEADER}\n`);
  });

  it('should escape delimiter, newline and quotes in values', () => {
    const line = formatReportCsvLine({
      body: 'hello; "there"\nnext',
      callMediaType: 'voice',
      callStatus: 'missed',
      chatPhoneNumber: '050@lid',
      direction: 'incoming',
      messageType: 'call',
      timestamp: localTimestamp(2026, 4, 3, 7, 8, 59)
    });

    expect(line).toBe(
      '2026-05-03 07:08;050@lid;incoming;"hello; ""there""\nnext";call;missed voice'
    );
  });

  it.each(['=2+2', '+SUM(1,1)', '-10+20', '@command'])(
    'should sanitize spreadsheet formula-like message bodies: %s',
    (body) => {
      const line = formatReportCsvLine({
        body,
        callMediaType: null,
        callStatus: null,
        chatPhoneNumber: '050@lid',
        direction: 'incoming',
        messageType: 'chat',
        timestamp: localTimestamp(2026, 4, 3, 7, 8)
      });

      expect(line.split(';')[3]).toBe(`'${body}`);
    }
  );

  it('should format call info from available call fields', () => {
    expect(formatCallInfo('missed', 'voice')).toBe('missed voice');
    expect(formatCallInfo('outgoing', null)).toBe('outgoing');
    expect(formatCallInfo(null, null)).toBe('');
  });
});
