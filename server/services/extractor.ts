import crypto from 'crypto';
import JSZip from 'jszip';
import * as xlsx from 'xlsx';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export interface FileValidationResult {
  isValid: boolean;
  detectedMime: string;
  detectedType: 'image' | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'text' | 'csv' | 'heic' | 'unsupported';
  error?: string;
  sha256: string;
}

export interface ExtractedUnit {
  unitIndex: number;
  unitType: 'page' | 'slide' | 'sheet' | 'chunk' | 'image';
  contentText: string;
  facts: string[];
  formulas: string[];
  visualDescription?: string;
  status: 'ready' | 'unclear' | 'failed';
}

export interface ExtractionManifest {
  totalUnits: number;
  processedUnits: number;
  failedUnits: number;
  type: string;
  originalName: string;
  sizeBytes: number;
  sha256: string;
  hasVisuals: boolean;
  warnings: string[];
}

// ----------------------------------------------------
// 1. Magic Bytes & Security Inspection
// ----------------------------------------------------
export function inspectFileMagicBytes(buffer: Buffer, originalName: string): FileValidationResult {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  if (buffer.length < 4) {
    return {
      isValid: false,
      detectedMime: 'application/octet-stream',
      detectedType: 'unsupported',
      error: 'الملف فارغ أو تالف جداً.',
      sha256,
    };
  }

  // 1. Check for executable / dangerous binary magic bytes
  // MZ (Windows PE Executable)
  if (buffer[0] === 0x4D && buffer[1] === 0x5A) {
    return {
      isValid: false,
      detectedMime: 'application/x-dosexec',
      detectedType: 'unsupported',
      error: 'الملفات التنفيذية والبرمجية غير مسموح بها لأسباب أمنية.',
      sha256,
    };
  }
  // ELF (Linux executable)
  if (buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
    return {
      isValid: false,
      detectedMime: 'application/x-executable',
      detectedType: 'unsupported',
      error: 'الملفات التنفيذية والبرمجية غير مسموح بها لأسباب أمنية.',
      sha256,
    };
  }

  // 2. JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { isValid: true, detectedMime: 'image/jpeg', detectedType: 'image', sha256 };
  }

  // 3. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return { isValid: true, detectedMime: 'image/png', detectedType: 'image', sha256 };
  }

  // 4. WebP: RIFF .... WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { isValid: true, detectedMime: 'image/webp', detectedType: 'image', sha256 };
  }

  // 5. HEIC / HEIF: offset 4 ftypheic, ftypmif1, ftypmsf1
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) {
      return {
        isValid: false,
        detectedMime: 'image/heic',
        detectedType: 'heic',
        error: 'صيغة HEIC غير مدعومة مباشرة للمعالجة البصرية، يرجى التقاط الصورة بصيغة JPEG أو PNG من إعدادات الكاميرا أو تحويلها.',
        sha256,
      };
    }
  }

  // 6. PDF: %PDF (25 50 44 46)
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return { isValid: true, detectedMime: 'application/pdf', detectedType: 'pdf', sha256 };
  }

  // 7. ZIP-based Office Formats (DOCX, PPTX, XLSX): PK (50 4B 03 04)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && (buffer[2] === 0x03 || buffer[2] === 0x05)) {
    const ext = originalName.split('.').pop()?.toLowerCase();
    if (ext === 'docx') {
      return { isValid: true, detectedMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', detectedType: 'docx', sha256 };
    }
    if (ext === 'pptx') {
      return { isValid: true, detectedMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', detectedType: 'pptx', sha256 };
    }
    if (ext === 'xlsx') {
      return { isValid: true, detectedMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', detectedType: 'xlsx', sha256 };
    }
    // Generic zip
    return {
      isValid: false,
      detectedMime: 'application/zip',
      detectedType: 'unsupported',
      error: 'ملفات الأرشيف والضغط العامة (.zip) غير مدعومة مباشرة، يرجى رفع ملفات DOCX أو PPTX أو XLSX أو PDF.',
      sha256,
    };
  }

  // 8. Plain Text, Markdown, CSV
  const ext = originalName.split('.').pop()?.toLowerCase();
  if (['txt', 'md', 'csv'].includes(ext || '')) {
    // Check if buffer is valid text (not binary garbage)
    let isBinary = false;
    const checkLength = Math.min(buffer.length, 1024);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) {
        isBinary = true;
        break;
      }
    }
    if (!isBinary) {
      if (ext === 'csv') {
        return { isValid: true, detectedMime: 'text/csv', detectedType: 'csv', sha256 };
      }
      return { isValid: true, detectedMime: 'text/plain', detectedType: 'text', sha256 };
    }
  }

  return {
    isValid: false,
    detectedMime: 'application/octet-stream',
    detectedType: 'unsupported',
    error: `صيغة الملف غير مدعومة (${originalName}). الأنواع المدعومة: الصور (JPEG, PNG, WebP)، وPDF، وDOCX، وPPTX، وXLSX، وCSV، وTXT، وMD.`,
    sha256,
  };
}

// ----------------------------------------------------
// 2. Unit Extraction Implementation
// ----------------------------------------------------
export async function extractSourceUnits(
  buffer: Buffer,
  fileType: 'image' | 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'text' | 'csv',
  originalName: string,
  sha256: string
): Promise<{ units: ExtractedUnit[]; manifest: ExtractionManifest }> {
  const units: ExtractedUnit[] = [];
  const warnings: string[] = [];
  let hasVisuals = false;

  try {
    switch (fileType) {
      case 'image': {
        hasVisuals = true;
        units.push({
          unitIndex: 1,
          unitType: 'image',
          contentText: `[صورة: ${originalName}]`,
          facts: [`مرفق صورة بصرية: ${originalName}`],
          formulas: [],
          visualDescription: `صورة دراسية تتطلب تحليلاً بصرياً بواسطة النموذج المتعدد الوسائط.`,
          status: 'ready',
        });
        break;
      }

      case 'pdf': {
        hasVisuals = true;
        try {
          // Limit to 60 pages to prevent memory spikes on massive textbooks
          const parsePromise = pdfParse(buffer, { max: 60 });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('PDF extraction timed out')), 10000)
          );

          const pdfData = (await Promise.race([parsePromise, timeoutPromise])) as any;
          const totalPages = Math.min(pdfData.numpages || 1, 60);
          const fullText = pdfData.text || '';

          // Check if PDF text is extracted or scanned
          if (fullText.trim().length < 50) {
            warnings.push('المستند يتضمن صوراً أو نصوصاً قليلة؛ ستتم قراءته وفهمه عبر الرؤية البصرية للنموذج.');
          }

          // Split text roughly by form feeds (\f) or chunks of pages
          const pages = fullText.split('\f');
          if (pages.length >= totalPages && pages.length > 1) {
            for (let i = 0; i < totalPages; i++) {
              const pageContent = (pages[i] || '').trim();
              units.push({
                unitIndex: i + 1,
                unitType: 'page',
                contentText: pageContent || `[الصفحة ${i + 1}: محتوى بصري/رسوم]`,
                facts: extractKeyFacts(pageContent),
                formulas: extractFormulas(pageContent),
                status: pageContent ? 'ready' : 'unclear',
              });
            }
          } else {
            // If form feeds are absent, chunk evenly across total pages
            const chunkSize = Math.max(1, Math.ceil(fullText.length / totalPages));
            for (let i = 0; i < totalPages; i++) {
              const chunk = fullText.slice(i * chunkSize, (i + 1) * chunkSize).trim();
              units.push({
                unitIndex: i + 1,
                unitType: 'page',
                contentText: chunk || `[الصفحة ${i + 1}: محتوى بصري]`,
                facts: extractKeyFacts(chunk),
                formulas: extractFormulas(chunk),
                status: chunk ? 'ready' : 'unclear',
              });
            }
          }
        } catch (pdfErr: any) {
          console.warn(`[PDF_SAFE_FALLBACK] pdfParse error or timeout for ${originalName}:`, pdfErr.message);
          warnings.push(`تم اعتماد المستند للمعالجة المباشرة بالذكاء الاصطناعي: ${pdfErr.message}`);
          units.push({
            unitIndex: 1,
            unitType: 'page',
            contentText: `[مستند PDF: ${originalName}]. سيتم استخراج وشرح المعلومات منه مباشرة عبر نموذج الذكاء الاصطناعي.`,
            facts: [`مستند دراسي: ${originalName}`],
            formulas: [],
            status: 'ready',
          });
        }
        break;
      }

      case 'docx': {
        const result = await mammoth.extractRawText({ buffer });
        const text = result.value || '';
        const paragraphs = text
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        if (paragraphs.length === 0) {
          units.push({
            unitIndex: 1,
            unitType: 'chunk',
            contentText: '[مستند فارغ]',
            facts: [],
            formulas: [],
            status: 'unclear',
          });
        } else {
          // Group paragraphs into units of ~1000 words
          let currentChunk: string[] = [];
          let currentWordCount = 0;
          let unitIdx = 1;

          for (const para of paragraphs) {
            const words = para.split(/\s+/).length;
            currentChunk.push(para);
            currentWordCount += words;

            if (currentWordCount >= 600) {
              const content = currentChunk.join('\n\n');
              units.push({
                unitIndex: unitIdx++,
                unitType: 'chunk',
                contentText: content,
                facts: extractKeyFacts(content),
                formulas: extractFormulas(content),
                status: 'ready',
              });
              currentChunk = [];
              currentWordCount = 0;
            }
          }

          if (currentChunk.length > 0) {
            const content = currentChunk.join('\n\n');
            units.push({
              unitIndex: unitIdx,
              unitType: 'chunk',
              contentText: content,
              facts: extractKeyFacts(content),
              formulas: extractFormulas(content),
              status: 'ready',
            });
          }
        }
        break;
      }

      case 'pptx': {
        hasVisuals = true;
        const zip = await JSZip.loadAsync(buffer);
        const slideFiles = Object.keys(zip.files)
          .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
          .sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)![0], 10);
            const numB = parseInt(b.match(/\d+/)![0], 10);
            return numA - numB;
          });

        if (slideFiles.length === 0) {
          warnings.push('لم يتم العثور على شرائح واضحة في ملف العرض التقديمي.');
          units.push({
            unitIndex: 1,
            unitType: 'slide',
            contentText: '[عرض تقديمي بدون نصوص شرائح]',
            facts: [],
            formulas: [],
            status: 'unclear',
          });
        } else {
          for (let i = 0; i < slideFiles.length; i++) {
            const slideName = slideFiles[i];
            const slideXml = await zip.file(slideName)!.async('text');
            // Extract text inside <a:t> tags
            const textMatches = slideXml.match(/<a:t[^>]*>(.*?)<\/a:t>/g) || [];
            const slideText = textMatches
              .map((t) => t.replace(/<[^>]+>/g, ''))
              .join(' ')
              .trim();

            // Try to fetch speaker notes if available: ppt/notesSlides/notesSlide{i+1}.xml
            let notesText = '';
            const notesName = `ppt/notesSlides/notesSlide${i + 1}.xml`;
            if (zip.file(notesName)) {
              const notesXml = await zip.file(notesName)!.async('text');
              const noteMatches = notesXml.match(/<a:t[^>]*>(.*?)<\/a:t>/g) || [];
              notesText = noteMatches
                .map((t) => t.replace(/<[^>]+>/g, ''))
                .join(' ')
                .trim();
            }

            const combined = [
              slideText ? `[محتوى الشريحة ${i + 1}]: ${slideText}` : `[الشريحة ${i + 1}: رسوم وتصميم بصري]`,
              notesText ? `[ملاحظات المحاضر]: ${notesText}` : '',
            ]
              .filter(Boolean)
              .join('\n');

            units.push({
              unitIndex: i + 1,
              unitType: 'slide',
              contentText: combined,
              facts: extractKeyFacts(combined),
              formulas: extractFormulas(combined),
              status: slideText ? 'ready' : 'unclear',
            });
          }
        }
        break;
      }

      case 'xlsx': {
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetNames = workbook.SheetNames;

        if (sheetNames.length === 0) {
          units.push({
            unitIndex: 1,
            unitType: 'sheet',
            contentText: '[ملف جدول فارغ]',
            facts: [],
            formulas: [],
            status: 'unclear',
          });
        } else {
          for (let i = 0; i < sheetNames.length; i++) {
            const sheetName = sheetNames[i];
            const worksheet = workbook.Sheets[sheetName];
            const csvData = xlsx.utils.sheet_to_csv(worksheet);
            const content = `ورقة عمل: "${sheetName}"\n\nالبيانات:\n${csvData}`;

            units.push({
              unitIndex: i + 1,
              unitType: 'sheet',
              contentText: content,
              facts: [`ورقة البيانات تحتوي على الجداول والقيم الرقمية لـ ${sheetName}`],
              formulas: [],
              status: 'ready',
            });
          }
        }
        break;
      }

      case 'csv':
      case 'text': {
        const textContent = buffer.toString('utf-8');
        const lines = textContent.split(/\r?\n/);
        const linesPerUnit = 100;
        const totalUnits = Math.max(1, Math.ceil(lines.length / linesPerUnit));

        for (let i = 0; i < totalUnits; i++) {
          const slice = lines.slice(i * linesPerUnit, (i + 1) * linesPerUnit);
          const numberedLines = slice.map((line, idx) => `[سطر ${i * linesPerUnit + idx + 1}] ${line}`).join('\n');

          units.push({
            unitIndex: i + 1,
            unitType: 'chunk',
            contentText: numberedLines,
            facts: extractKeyFacts(numberedLines),
            formulas: extractFormulas(numberedLines),
            status: 'ready',
          });
        }
        break;
      }
    }
  } catch (err: any) {
    warnings.push(`حدث خطأ أثناء فك ومعالجة أجزاء الملف: ${err.message}`);
    units.push({
      unitIndex: 1,
      unitType: 'chunk',
      contentText: `[فشل في معالجة المستند: ${err.message}]`,
      facts: [],
      formulas: [],
      status: 'failed',
    });
  }

  const processedCount = units.filter((u) => u.status === 'ready').length;
  const failedCount = units.filter((u) => u.status === 'failed').length;

  const manifest: ExtractionManifest = {
    totalUnits: units.length,
    processedUnits: processedCount,
    failedUnits: failedCount,
    type: fileType,
    originalName,
    sizeBytes: buffer.length,
    sha256,
    hasVisuals,
    warnings,
  };

  return { units, manifest };
}

// ----------------------------------------------------
// Helper: Extract Facts and Formulas
// ----------------------------------------------------
function extractKeyFacts(text: string): string[] {
  if (!text) return [];
  // Extract sentences with definitions, numbers, or rules
  const sentences = text
    .split(/[.!\n؟]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 250);

  const keywords = ['هو', 'هي', 'يعرف', 'تتكون', 'قانون', 'نظرية', 'يساوي', 'def', 'is', 'defined as', 'formula'];
  return sentences
    .filter((s) => keywords.some((k) => s.toLowerCase().includes(k)))
    .slice(0, 10);
}

function extractFormulas(text: string): string[] {
  if (!text) return [];
  // Detect mathematical equations, symbols: =, +, -, *, /, ^, \int, \frac
  const formulaRegex = /([a-zA-Z\u0621-\u064A0-9_]+\s*=\s*[^.\n]{3,60})/g;
  const matches = text.match(formulaRegex) || [];
  return Array.from(new Set(matches.map((m) => m.trim()))).slice(0, 10);
}
