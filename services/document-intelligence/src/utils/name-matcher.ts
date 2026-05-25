/**
 * Name Matching Utilities for Identity Verification
 * Handles variations, typos, and cultural naming patterns
 */

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const matrix: number[][] = [];

  for (let i = 0; i <= m; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= n; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[m][n];
}

/**
 * Calculate Jaro-Winkler similarity (0-1, higher is more similar)
 */
export function jaroWinklerSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;

  const len1 = str1.length;
  const len2 = str2.length;

  if (len1 === 0 || len2 === 0) return 0;

  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

  const str1Matches = new Array(len1).fill(false);
  const str2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);

    for (let j = start; j < end; j++) {
      if (str2Matches[j] || str1[i] !== str2[j]) continue;
      str1Matches[i] = true;
      str2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!str1Matches[i]) continue;
    while (!str2Matches[k]) k++;
    if (str1[i] !== str2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  // Winkler modification
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (str1[i] === str2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Normalize a name for comparison
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Extract name parts (first, middle, last)
 */
export function extractNameParts(fullName: string): {
  firstName: string;
  middleName: string | null;
  lastName: string;
} {
  const normalized = normalizeName(fullName);
  const parts = normalized.split(' ').filter(p => p.length > 0);

  if (parts.length === 0) {
    return { firstName: '', middleName: null, lastName: '' };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], middleName: null, lastName: parts[0] };
  }

  if (parts.length === 2) {
    return { firstName: parts[0], middleName: null, lastName: parts[1] };
  }

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' ') || null,
    lastName: parts[parts.length - 1],
  };
}

/**
 * Match two names with configurable threshold
 */
export interface NameMatchResult {
  isMatch: boolean;
  similarity: number;
  matchType: 'exact' | 'fuzzy' | 'partial' | 'no_match';
  details: string;
}

export function matchNames(
  name1: string,
  name2: string,
  threshold: number = 0.85
): NameMatchResult {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);

  // Exact match
  if (norm1 === norm2) {
    return {
      isMatch: true,
      similarity: 1,
      matchType: 'exact',
      details: 'Names match exactly',
    };
  }

  // Jaro-Winkler similarity
  const similarity = jaroWinklerSimilarity(norm1, norm2);

  if (similarity >= threshold) {
    return {
      isMatch: true,
      similarity,
      matchType: 'fuzzy',
      details: `Names are similar (${(similarity * 100).toFixed(1)}% match)`,
    };
  }

  // Try matching name parts
  const parts1 = extractNameParts(name1);
  const parts2 = extractNameParts(name2);

  const firstNameSim = jaroWinklerSimilarity(parts1.firstName, parts2.firstName);
  const lastNameSim = jaroWinklerSimilarity(parts1.lastName, parts2.lastName);

  // If first and last names match well
  if (firstNameSim >= threshold && lastNameSim >= threshold) {
    const avgSim = (firstNameSim + lastNameSim) / 2;
    return {
      isMatch: true,
      similarity: avgSim,
      matchType: 'partial',
      details: `First and last names match (${(avgSim * 100).toFixed(1)}% average)`,
    };
  }

  // Check for swapped first/last names
  const swappedFirstSim = jaroWinklerSimilarity(parts1.firstName, parts2.lastName);
  const swappedLastSim = jaroWinklerSimilarity(parts1.lastName, parts2.firstName);

  if (swappedFirstSim >= threshold && swappedLastSim >= threshold) {
    const avgSim = (swappedFirstSim + swappedLastSim) / 2;
    return {
      isMatch: true,
      similarity: avgSim * 0.9, // Slight penalty for swapped names
      matchType: 'partial',
      details: `Names appear to be swapped (${(avgSim * 100).toFixed(1)}% match)`,
    };
  }

  return {
    isMatch: false,
    similarity,
    matchType: 'no_match',
    details: `Names do not match (${(similarity * 100).toFixed(1)}% similarity)`,
  };
}

/**
 * Compare ID numbers with normalization
 */
export function normalizeIdNumber(idNumber: string): string {
  return idNumber
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ''); // Remove all non-alphanumeric
}

export function matchIdNumbers(id1: string, id2: string): boolean {
  return normalizeIdNumber(id1) === normalizeIdNumber(id2);
}

/**
 * Check if an ID number follows expected format
 */
export interface IdFormatValidation {
  isValid: boolean;
  format: string;
  country: string | null;
  details: string;
}

export function validateIdFormat(
  idNumber: string,
  expectedType: string
): IdFormatValidation {
  const normalized = normalizeIdNumber(idNumber);

  // Tanzania National ID (NIDA)
  if (expectedType === 'national_id' || expectedType === 'nida') {
    // NIDA numbers are typically 20 digits
    if (/^\d{20}$/.test(normalized)) {
      return {
        isValid: true,
        format: 'NIDA',
        country: 'TZ',
        details: 'Valid Tanzania NIDA format',
      };
    }
    // Older format might be different
    if (/^\d{8,12}$/.test(normalized)) {
      return {
        isValid: true,
        format: 'TZ_OLD_ID',
        country: 'TZ',
        details: 'Possibly older Tanzania ID format',
      };
    }
  }

  // Kenya National ID
  if (expectedType === 'national_id' && /^\d{7,8}$/.test(normalized)) {
    return {
      isValid: true,
      format: 'KE_ID',
      country: 'KE',
      details: 'Valid Kenya national ID format',
    };
  }

  // Passport (general)
  if (expectedType === 'passport') {
    if (/^[A-Z]{1,2}\d{6,9}$/.test(normalized)) {
      return {
        isValid: true,
        format: 'PASSPORT',
        country: null,
        details: 'Valid passport format',
      };
    }
  }

  // Driver's license (general format check)
  if (expectedType === 'drivers_license') {
    if (normalized.length >= 6 && normalized.length <= 20) {
      return {
        isValid: true,
        format: 'DRIVERS_LICENSE',
        country: null,
        details: 'Acceptable driver\'s license format',
      };
    }
  }

  return {
    isValid: false,
    format: 'UNKNOWN',
    country: null,
    details: `ID format not recognized for type: ${expectedType}`,
  };
}
