import { describe, it, expect } from 'vitest';
import { inspectFileMagicBytes, extractSourceUnits } from '../server/services/extractor.js';

describe('File Magic Bytes & Security Inspector', () => {
  it('detects JPEG images correctly from magic bytes', () => {
    // FF D8 FF
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const res = inspectFileMagicBytes(jpegBuffer, 'lesson.jpg');
    expect(res.isValid).toBe(true);
    expect(res.detectedType).toBe('image');
    expect(res.detectedMime).toBe('image/jpeg');
  });

  it('detects PNG images correctly from magic bytes', () => {
    // 89 50 4E 47 0D 0A 1A 0A
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = inspectFileMagicBytes(pngBuffer, 'diagram.png');
    expect(res.isValid).toBe(true);
    expect(res.detectedType).toBe('image');
    expect(res.detectedMime).toBe('image/png');
  });

  it('detects PDF documents correctly from magic bytes', () => {
    // %PDF
    const pdfBuffer = Buffer.from('%PDF-1.4 sample content');
    const res = inspectFileMagicBytes(pdfBuffer, 'physics.pdf');
    expect(res.isValid).toBe(true);
    expect(res.detectedType).toBe('pdf');
    expect(res.detectedMime).toBe('application/pdf');
  });

  it('blocks dangerous executable files (PE and ELF)', () => {
    // MZ header
    const peBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    const resPe = inspectFileMagicBytes(peBuffer, 'tool.exe');
    expect(resPe.isValid).toBe(false);
    expect(resPe.detectedType).toBe('unsupported');

    // ELF header
    const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
    const resElf = inspectFileMagicBytes(elfBuffer, 'binary');
    expect(resElf.isValid).toBe(false);
  });

  it('identifies HEIC files and provides clear guidance instead of silent failure', () => {
    // ftypheic
    const heicBuffer = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    const res = inspectFileMagicBytes(heicBuffer, 'photo.heic');
    expect(res.isValid).toBe(false);
    expect(res.detectedType).toBe('heic');
    expect(res.error).toContain('HEIC');
  });

  it('extracts units from plain text and builds manifest with facts and formulas', async () => {
    const sampleText = `
المفهوم الأول: قانون السرعة
السرعة هي الإزاحة المقطوعة خلال وحدة الزمن وتعرف بأنها المعدل الزمني للتغير في الموضع.
القانون الرياضي:
v = d / t

المفهوم الثاني: التسارع
التسارع هو معدل تغير السرعة بالنسبة للزمن.
القانون:
a = (v2 - v1) / t
    `.trim();

    const textBuffer = Buffer.from(sampleText, 'utf-8');
    const { units, manifest } = await extractSourceUnits(textBuffer, 'text', 'physics_notes.txt', 'dummy_hash');

    expect(units.length).toBeGreaterThanOrEqual(1);
    expect(manifest.totalUnits).toBe(units.length);
    expect(manifest.processedUnits).toBe(units.length);
    expect(manifest.failedUnits).toBe(0);
    expect(units[0].facts.length).toBeGreaterThan(0);
  });
});
