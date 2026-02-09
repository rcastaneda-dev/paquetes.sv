/**
 * Text encoding utilities for fixing character encoding issues.
 *
 * The database contains text that was stored with Latin1/Windows-1252 encoding
 * but is being interpreted as UTF-8, causing special Spanish characters
 * (Á, É, Í, Ó, Ú, Ñ, etc.) to render incorrectly.
 *
 * This utility detects and fixes these encoding issues.
 */

/**
 * Fixes text that was encoded in Latin1/Windows-1252 but interpreted as UTF-8.
 *
 * Common issues:
 * - "Á" becomes "��" or "ÿý"
 * - "É" becomes "��"
 * - "Í" becomes "��"
 * - "Ó" becomes "��"
 * - "Ú" becomes "��"
 * - "Ñ" becomes "��"
 *
 * @param text - The incorrectly encoded text
 * @returns The correctly decoded text
 */
export function fixLatin1Encoding(text: string | null | undefined): string {
  if (!text) {
    return '';
  }

  try {
    // Check if the text contains common encoding issue patterns
    const hasEncodingIssue = /[\u00C0-\u00FF]{2,}|��|ÿý/.test(text);

    if (!hasEncodingIssue) {
      // No encoding issues detected, return as-is
      return text;
    }

    // Convert the string to Latin1 bytes, then re-interpret as UTF-8
    // This reverses the incorrect UTF-8 interpretation of Latin1 data
    const latin1Bytes = new Uint8Array(text.split('').map(char => char.charCodeAt(0) & 0xff));

    // Decode as UTF-8
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return decoder.decode(latin1Bytes);
  } catch (error) {
    // If conversion fails, return original text
    console.error('Error fixing text encoding:', error);
    return text;
  }
}

/**
 * Safely converts text to uppercase with encoding fix.
 * Useful for rendering school names, departamentos, and distritos.
 *
 * @param text - The text to convert
 * @returns Uppercase text with encoding issues fixed
 */
export function toUpperCaseFixed(text: string | null | undefined): string {
  return fixLatin1Encoding(text).toUpperCase();
}

/**
 * Batch fixes encoding for multiple text fields in an object.
 * Useful for processing database records with multiple text fields.
 *
 * @param obj - Object with text fields to fix
 * @param fields - Array of field names to fix
 * @returns New object with fixed text fields
 */
export function fixEncodingInObject<T extends Record<string, unknown>>(
  obj: T,
  fields: Array<keyof T>
): T {
  const result = { ...obj };
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === 'string') {
      result[field] = fixLatin1Encoding(value) as T[keyof T];
    }
  }
  return result;
}
