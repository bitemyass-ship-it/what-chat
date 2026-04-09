const EMPLOYEE_CODE_FALLBACK = 'user';

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ґ: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  є: 'ye',
  ж: 'zh',
  з: 'z',
  и: 'i',
  і: 'i',
  ї: 'yi',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ў: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya'
};

export const EMPLOYEE_CODE_ALLOCATION_MAX_ATTEMPTS = 5;

export const normalizeEmployeeDisplayNameForCode = (displayName: string): string =>
  displayName.trim().replace(/\s+/gu, ' ');

export const transliterateCyrillicToLatin = (value: string): string =>
  Array.from(value.toLowerCase())
    .map((character) => CYRILLIC_TO_LATIN_MAP[character] ?? character)
    .join('');

export const buildEmployeeCodeBase = (displayName: string): string => {
  const normalizedDisplayName = normalizeEmployeeDisplayNameForCode(displayName);
  const transliteratedDisplayName = transliterateCyrillicToLatin(normalizedDisplayName);
  const dashedCode = transliteratedDisplayName.replace(/[\s\p{P}\p{S}]+/gu, '-');
  const sanitizedCode = dashedCode
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitizedCode || EMPLOYEE_CODE_FALLBACK;
};

export const buildEmployeeCodeCandidate = (
  baseCode: string,
  attemptNumber: number
): string => {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error('Employee code attempt number must be a positive integer');
  }

  return attemptNumber === 1 ? baseCode : `${baseCode}-${attemptNumber}`;
};
