import { describe, it, expect } from 'vitest';
import { verifyAndAnnotateCitations } from '../server/services/citations.js';
import { generatedQuizSchema } from '../server/services/gemini.js';

describe('Citations Verification & Quiz Schemas', () => {
  it('verifies valid citations and rejects fabricated/out-of-range citations', () => {
    const rawText = `
وفقاً لما ورد في [ملخص_الفيزياء.pdf, صفحة 3]، فإن قانون نيوتن ينص على القوة المؤثرة.
بينما ورد في [ملخص_الفيزياء.pdf, صفحة 99] معلومة أخرى لا أصل لها.
كذلك في [الصورة 1] نجد المخطط البياني.
    `.trim();

    const manifests = [
      {
        fileName: 'ملخص_الفيزياء.pdf',
        totalUnits: 5, // only 5 pages exist!
        unitIndices: [1, 2, 3, 4, 5],
      },
      {
        fileName: 'الصورة 1',
        totalUnits: 1,
        unitIndices: [1],
      },
    ];

    const { cleanedText, citations } = verifyAndAnnotateCitations(rawText, manifests);

    // Page 3 is valid (<= 5)
    const validCitation = citations.find((c) => c.unitIndex === 3);
    expect(validCitation).toBeDefined();
    expect(validCitation?.isVerified).toBe(true);

    // Page 99 is invalid (> 5 total units)
    const invalidCitation = citations.find((c) => c.unitIndex === 99);
    expect(invalidCitation).toBeDefined();
    expect(invalidCitation?.isVerified).toBe(false);
    expect(cleanedText).not.toContain('صفحة 99');
  });

  it('validates structured quiz generation schema correctly', () => {
    const sampleGeneratedQuiz = {
      title: 'كويز فيزياء الحركة',
      questions: [
        {
          questionOrder: 1,
          questionType: 'mcq',
          questionText: 'ما هي وحدة قياس التسارع في النظام الدولي؟',
          options: ['م/ث²', 'م/ث', 'نيوتن', 'جول'],
          correctKey: 'م/ث²',
          explanation: 'وحدة التسارع هي متر لكل ثانية مربعة (m/s²).',
          points: 1,
          topic: 'علم الحركة',
          sourceReferences: [{ sourceName: 'notes.txt', unitIndex: 1 }],
        },
        {
          questionOrder: 2,
          questionType: 'essay',
          questionText: 'اشرح باختصار الفرق بين السرعة القياسية والسرعة المتجهة.',
          correctKey: 'السرعة القياسية مقدار عددي بينما المتجهة لها مقدار واتجاه.',
          explanation: 'المتجهة تعتمد على الإزاحة والقياسية على المسافة الكلية.',
          points: 2,
          topic: 'المتجهات',
          sourceReferences: [],
        },
      ],
    };

    const parsed = generatedQuizSchema.safeParse(sampleGeneratedQuiz);
    expect(parsed.success).toBe(true);
  });
});
