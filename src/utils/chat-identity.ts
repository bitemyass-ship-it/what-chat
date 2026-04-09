const DIRECT_CHAT_ID_PATTERN = /^(\d+)@(c\.us|s\.whatsapp\.net)$/u;
const LID_CHAT_ID_PATTERN = /^(\d+)@lid$/u;

export const normalizePhoneDigits = (
  value: string | null | undefined
): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.replace(/\D+/gu, '');
  return normalizedValue === '' ? undefined : normalizedValue;
};

export const extractDirectPhoneDigitsFromChatId = (
  chatId: string
): string | undefined => {
  const match = chatId.match(DIRECT_CHAT_ID_PATTERN);
  return match?.[1];
};

export const extractLidDigitsFromChatId = (
  chatId: string
): string | undefined => {
  const match = chatId.match(LID_CHAT_ID_PATTERN);
  return match?.[1];
};

export const isLidChatId = (chatId: string): boolean =>
  LID_CHAT_ID_PATTERN.test(chatId);

export const resolveReliablePhoneNumber = ({
  chatId,
  isPhoneNumberVerified = false,
  phoneNumber
}: {
  chatId: string;
  isPhoneNumberVerified?: boolean;
  phoneNumber?: string | null;
}): string | undefined => {
  const explicitPhoneNumber = normalizePhoneDigits(phoneNumber);

  if (explicitPhoneNumber && isPhoneNumberVerified) {
    return explicitPhoneNumber;
  }

  return extractDirectPhoneDigitsFromChatId(chatId);
};

export const inferLegacyPhoneNumberVerification = ({
  chatId,
  phoneNumber
}: {
  chatId: string;
  phoneNumber?: string | null;
}): boolean => {
  const explicitPhoneNumber = normalizePhoneDigits(phoneNumber);

  if (!explicitPhoneNumber) {
    return false;
  }

  if (extractDirectPhoneDigitsFromChatId(chatId)) {
    return true;
  }

  if (!isLidChatId(chatId)) {
    return false;
  }

  const lidDigits = extractLidDigitsFromChatId(chatId);
  return explicitPhoneNumber !== lidDigits;
};

export const buildChatContactKey = ({
  chatId,
  phoneNumber
}: {
  chatId: string;
  phoneNumber?: string | null;
}): string => {
  const reliablePhoneNumber = normalizePhoneDigits(phoneNumber);

  if (reliablePhoneNumber) {
    return `phone:${reliablePhoneNumber}`;
  }

  return `chat:${chatId}`;
};
