import {
  buildEmployeeCodeBase,
  buildEmployeeCodeCandidate,
  normalizeEmployeeDisplayNameForCode,
  transliterateCyrillicToLatin
} from '../../src/utils/employee-code';

describe('employee code utils', () => {
  it.each([
    ['Anna', 'anna'],
    ['Anna Petrova', 'anna-petrova'],
    ['  Anna   Petrova  ', 'anna-petrova'],
    ['Anna/Petrova', 'anna-petrova'],
    ['Anna 2', 'anna-2'],
    ['Anna (Sales)', 'anna-sales'],
    ['!!!', 'user'],
    ['Анна Петрова', 'anna-petrova']
  ])('should build code %s -> %s', (displayName, expectedCode) => {
    expect(buildEmployeeCodeBase(displayName)).toBe(expectedCode);
  });

  it('should normalize whitespace before code generation', () => {
    expect(normalizeEmployeeDisplayNameForCode('  Anna   Petrova  ')).toBe(
      'Anna Petrova'
    );
  });

  it('should transliterate Cyrillic to Latin', () => {
    expect(transliterateCyrillicToLatin('Анна Петрова')).toBe('anna petrova');
  });

  it('should build unique code candidates with numeric suffixes', () => {
    expect(buildEmployeeCodeCandidate('anna', 1)).toBe('anna');
    expect(buildEmployeeCodeCandidate('anna', 2)).toBe('anna-2');
    expect(buildEmployeeCodeCandidate('anna', 3)).toBe('anna-3');
  });
});
