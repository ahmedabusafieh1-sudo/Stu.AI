export interface VerifiedCitation {
  sourceName: string;
  unitIndex?: number;
  unitType?: string;
  isVerified: boolean;
  rawMatch: string;
}

export function verifyAndAnnotateCitations(
  text: string,
  manifests: {
    fileName: string;
    totalUnits: number;
    unitIndices: number[];
  }[]
): { cleanedText: string; citations: VerifiedCitation[] } {
  const citations: VerifiedCitation[] = [];

  // Match [filename, page X] or [filename, الشريحة X] or [filename, ص 4] or [الصورة 2]
  const citationRegex = /\[([^,\]]+?)(?:,\s*(?:صفحة|ص|page|slide|شريحة|ورقة|sheet)?\s*(\d+))?\]/gi;

  const cleanedText = text.replace(citationRegex, (match, rawName, unitStr) => {
    const trimmedName = rawName.trim();
    const unitNum = unitStr ? parseInt(unitStr, 10) : undefined;

    // Check if rawName matches any uploaded attachment (exact or partial)
    const matchedManifest = manifests.find(
      (m) =>
        m.fileName.toLowerCase().includes(trimmedName.toLowerCase()) ||
        trimmedName.toLowerCase().includes(m.fileName.toLowerCase()) ||
        trimmedName.includes('صورة') ||
        trimmedName.includes('مرفق')
    );

    if (matchedManifest) {
      if (unitNum !== undefined) {
        // Verify unitNum exists within totalUnits
        if (unitNum >= 1 && unitNum <= matchedManifest.totalUnits) {
          citations.push({
            sourceName: matchedManifest.fileName,
            unitIndex: unitNum,
            isVerified: true,
            rawMatch: match,
          });
          return match; // Valid verified citation
        } else {
          // Out of bounds page! Replace with valid range or flag
          citations.push({
            sourceName: matchedManifest.fileName,
            unitIndex: unitNum,
            isVerified: false,
            rawMatch: match,
          });
          return `[${matchedManifest.fileName}]`;
        }
      } else {
        citations.push({
          sourceName: matchedManifest.fileName,
          isVerified: true,
          rawMatch: match,
        });
        return match;
      }
    }

    // If it's a general bracket like [1] or [مفهوم] or not a file reference, leave as is
    return match;
  });

  return { cleanedText, citations };
}
