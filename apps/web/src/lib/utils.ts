import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getName as getCountryNameFromCode } from 'country-list';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert ISO 3166-1 alpha-2 country code to full country name.
 * Returns the original value if not a recognized code (e.g., "Local Network").
 */
export function getCountryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const name = getCountryNameFromCode(code) ?? code;
  // Strip ISO 3166-1 article suffixes like "(the)", "(The)"
  return name.replace(/\s*\([Tt]he\)$/, '');
}
