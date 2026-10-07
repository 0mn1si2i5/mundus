import type { SurnameRecord } from './surnameData';
import type { SurnameDisplayMode } from '../../state/urlState';

export type SurnameDisplaySource = 'local' | 'latin' | 'chinese';

export interface SurnameWordmark {
  value: string;
  source: SurnameDisplaySource;
  requestedMode: SurnameDisplayMode;
  fellBack: boolean;
  generated: boolean;
  layout: 'straight';
  characterCount: number;
}

export const SURNAME_WORDMARK_ASPECT_RATIO = 1024 / 280;
export const SURNAME_WORDMARK_HEIGHT_RATIO = 1 / SURNAME_WORDMARK_ASPECT_RATIO;
export const SURNAME_WORDMARK_SURFACE_RADIUS = 1.012;
// The slot asset already samples the complete wordmark envelope against
// neighbouring land. Keep only a small runtime margin for projection and
// texture filtering instead of the old 18% shrink inherited from country cards.
export const SURNAME_WORDMARK_CLEARANCE_SAFETY = 0.96;
// This is only a runaway guard for malformed geometry. Normal labels are
// sized by the country/neighbor clearance search, rather than by a fixed card
// width inherited from the old three-line country labels.
export const SURNAME_WORDMARK_MAX_WIDTH = 2.2;
export const SURNAME_WORDMARK_LATIN_FONT_FAMILY =
  "Georgia, 'Times New Roman', serif";
export const SURNAME_WORDMARK_CJK_FONT_FAMILY =
  "'Songti SC', 'Noto Serif CJK SC', STSong, SimSun, serif";

interface SurnameWordmarkMetrics {
  width: number;
  fontSize: number;
  baseline: number;
  cjk: boolean;
}

const WORDMARK_CANVAS_HEIGHT = 280;
const WORDMARK_SIDE_PADDING = 32;
const WORDMARK_LETTER_SPACING = 1;

function isCjkWordmark(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    value,
  );
}

/**
 * Estimates the natural advance of each glyph category in the selected serif
 * family. SVG text is intentionally left unstretched; this only determines a
 * sufficiently padded viewBox and a readable font size.
 */
function getWordmarkGlyphUnits(value: string): number {
  return Array.from(value).reduce((total, character) => {
    if (
      /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
        character,
      )
    ) {
      return total + 1;
    }
    if (/\s/u.test(character)) return total + 0.34;
    if (/[\p{P}\p{S}]/u.test(character)) return total + 0.42;
    if (/[A-Z\u00C0-\u024F]/u.test(character)) return total + 0.72;
    if (/[a-z\u00DF-\u024F]/u.test(character)) return total + 0.54;
    if (/\p{Number}/u.test(character)) return total + 0.58;
    return total + 0.68;
  }, 0);
}

function getSurnameWordmarkMetrics(
  wordmark: SurnameWordmark,
): SurnameWordmarkMetrics {
  const cjk = isCjkWordmark(wordmark.value);
  const glyphUnits = Math.max(1, getWordmarkGlyphUnits(wordmark.value));
  const glyphCount = Math.max(1, Array.from(wordmark.value).length);
  const fontSize = cjk
    ? Math.max(112, Math.min(190, 190 - (glyphCount - 1) * 14))
    : Math.max(100, Math.min(168, 168 - Math.max(0, glyphUnits - 6) * 4));
  const naturalWidth =
    glyphUnits * fontSize +
    WORDMARK_SIDE_PADDING * 2 +
    Math.max(0, glyphCount - 1) * WORDMARK_LETTER_SPACING;
  const width = Math.max(
    cjk && glyphCount === 1 ? 280 : 240,
    Math.min(1800, Math.ceil(naturalWidth)),
  );
  return {
    width,
    fontSize,
    baseline: cjk ? 214 : 198,
    cjk,
  };
}

export function getSurnameWordmarkAspectRatio(
  wordmark: SurnameWordmark,
): number {
  return getSurnameWordmarkMetrics(wordmark).width / 280;
}

export function getSurnameWordmarkHeightRatio(
  wordmark: SurnameWordmark,
): number {
  return 280 / getSurnameWordmarkMetrics(wordmark).width;
}

/**
 * Converts a candidate's angular clearance into the largest readable plane
 * width for this wordmark's actual aspect ratio. The old country-label helper
 * assumed a three-line card and therefore left most country interiors unused.
 */
export function getSurnameWordmarkWorldWidth(
  clearanceDegrees: number,
  wordmark: SurnameWordmark,
): number {
  const clearanceRadians =
    Math.max(0, Math.min(clearanceDegrees, 65)) * (Math.PI / 180);
  const heightRatio = getSurnameWordmarkHeightRatio(wordmark);
  const halfDiagonal =
    SURNAME_WORDMARK_SURFACE_RADIUS *
    Math.tan(clearanceRadians * SURNAME_WORDMARK_CLEARANCE_SAFETY);
  return Math.min(
    SURNAME_WORDMARK_MAX_WIDTH,
    (2 * halfDiagonal) / Math.sqrt(1 + heightRatio ** 2),
  );
}

export function getSurnameWordmarkAngularFootprintDegrees(
  width: number,
  wordmark: SurnameWordmark,
): number {
  const halfDiagonal =
    (Math.max(0, width) / 2) *
    Math.sqrt(1 + getSurnameWordmarkHeightRatio(wordmark) ** 2);
  return (
    Math.atan2(halfDiagonal, SURNAME_WORDMARK_SURFACE_RADIUS) * (180 / Math.PI)
  );
}

const NON_LATIN_TO_LATIN: Readonly<Record<string, string>> = {
  А: 'A',
  Б: 'B',
  В: 'V',
  Г: 'G',
  Д: 'D',
  Е: 'E',
  Ё: 'Yo',
  Ж: 'Zh',
  З: 'Z',
  И: 'I',
  Й: 'Y',
  К: 'K',
  Л: 'L',
  М: 'M',
  Н: 'N',
  О: 'O',
  П: 'P',
  Р: 'R',
  С: 'S',
  Т: 'T',
  У: 'U',
  Ф: 'F',
  Х: 'Kh',
  Ц: 'Ts',
  Ч: 'Ch',
  Ш: 'Sh',
  Щ: 'Shch',
  Ъ: '',
  Ы: 'Y',
  Ь: '',
  Э: 'E',
  Ю: 'Yu',
  Я: 'Ya',
  Γ: 'G',
  Α: 'A',
  Β: 'V',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'I',
  Ι: 'I',
  Κ: 'K',
  Δ: 'D',
  Μ: 'M',
  Ν: 'N',
  Θ: 'Th',
  Λ: 'L',
  Ξ: 'X',
  Ο: 'O',
  Π: 'P',
  Ρ: 'R',
  Σ: 'S',
  Τ: 'T',
  Υ: 'Y',
  Φ: 'F',
  Χ: 'Ch',
  Ψ: 'Ps',
  Ω: 'O',
  Ա: 'A',
  Բ: 'B',
  Գ: 'G',
  Դ: 'D',
  Ե: 'Ye',
  Զ: 'Z',
  Է: 'E',
  Ը: 'Y',
  Թ: 'T',
  Ժ: 'Zh',
  Ի: 'I',
  Լ: 'L',
  Խ: 'Kh',
  Ծ: 'Ts',
  Կ: 'K',
  Հ: 'H',
  Ձ: 'Dz',
  Ղ: 'Gh',
  Ճ: 'Ch',
  Մ: 'M',
  Յ: 'Y',
  Ն: 'N',
  Շ: 'Sh',
  Ո: 'Vo',
  Չ: 'Ch',
  Պ: 'P',
  Ջ: 'J',
  Ռ: 'R',
  Ս: 'S',
  Վ: 'V',
  Տ: 'T',
  Ր: 'R',
  Ց: 'Ts',
  Փ: 'P',
  Ք: 'Q',
  Օ: 'O',
  Ֆ: 'F',
  ж: 'zh',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ю: 'yu',
  я: 'ya',
  й: 'y',
  ы: 'y',
  э: 'e',
  ё: 'yo',
  ъ: '',
  ь: '',
  γ: 'g',
  δ: 'd',
  θ: 'th',
  λ: 'l',
  ξ: 'x',
  σ: 's',
  φ: 'f',
  χ: 'ch',
  ψ: 'ps',
  ω: 'o',
  ար: 'ar',
  محمد: 'Mohammad',
  ی: 'y',
  ا: 'a',
  ب: 'b',
  پ: 'p',
  ت: 't',
  ج: 'j',
  چ: 'ch',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ع: "'",
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ک: 'k',
  ك: 'k',
  گ: 'g',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  و: 'v',
  अ: 'a',
  आ: 'a',
  इ: 'i',
  ई: 'i',
  उ: 'u',
  ऊ: 'u',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
  क: 'k',
  ख: 'kh',
  ग: 'g',
  घ: 'gh',
  च: 'ch',
  ज: 'j',
  झ: 'jh',
  त: 't',
  थ: 'th',
  द: 'd',
  ध: 'dh',
  न: 'n',
  प: 'p',
  फ: 'ph',
  ब: 'b',
  भ: 'bh',
  म: 'm',
  य: 'y',
  र: 'r',
  ल: 'l',
  व: 'v',
  श: 'sh',
  ष: 'sh',
  स: 's',
  ह: 'h',
  ក: 'k',
  'ូ': 'o',
  យ: 'y',
};

const CHINESE_SURNAME_FORMS: Readonly<Record<string, string>> = {
  Andersson: '安德松',
  Chaudhary: '乔杜里',
  Chowdhury: '乔杜里',
  Cohen: '科恩',
  Devi: '德维',
  Gonzalez: '冈萨雷斯',
  Grigoryan: '格里戈良',
  Hernández: '埃尔南德斯',
  Horvath: '霍尔瓦特',
  Jovanovic: '约万诺维奇',
  Krasniqi: '克拉斯尼奇',
  Mammadov: '马梅多夫',
  Melnyk: '梅尔尼克',
  Mohammadi: '穆罕默迪',
  Nowak: '诺瓦克',
  Popovic: '波波维奇',
  Quispe: '基斯佩',
  Rossi: '罗西',
  Satō: '佐藤',
  Sato: '佐藤',
  Singh: '辛格',
  Smith: '史密斯',
  Silva: '席尔瓦',
  Smirnov: '斯米尔诺夫',
  Yılmaz: '伊尔马兹',
  Wang: '王',
  Zhang: '张',
  Li: '李',
  Liu: '刘',
  Chen: '陈',
  Chén: '陈',
  Kim: '金',
  Gim: '金',
  Nguyen: '阮',
  Nguyễn: '阮',
  Garcia: '加西亚',
  García: '加西亚',
  Martin: '马丁',
  Müller: '穆勒',
  Muller: '穆勒',
  Ivanov: '伊万诺夫',
  Hassan: '哈桑',
  Khan: '汗',
  Koy: '科伊',
};

const REVIEWED_LOCAL_FORMS: Readonly<
  Record<string, { latin: string; chinese: string }>
> = {
  // Khmer spelling used by the Cambodia source snapshot.
  កូយ: { latin: 'Koy', chinese: '科伊' },
};

const HAN_TO_LATIN: Readonly<Record<string, string>> = {
  王: 'Wang',
  张: 'Zhang',
  李: 'Li',
  刘: 'Liu',
  陈: 'Chen',
  陳: 'Chen',
  金: 'Kim',
  佐藤: 'Sato',
  阮: 'Nguyen',
};

const NORMALIZED_CHINESE_SURNAME_FORMS = new Map(
  Object.entries(CHINESE_SURNAME_FORMS).map(([key, value]) => [
    key
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('en-US'),
    value,
  ]),
);

const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  ж: 'zh',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ю: 'yu',
  я: 'ya',
  й: 'y',
  ы: 'y',
  э: 'e',
  ё: 'yo',
  ъ: '',
  ь: '',
};

function generatedLatin(record: SurnameRecord): string | null {
  const existing = record.romanizedForms.find((value) => value.trim());
  if (existing) return existing.trim();
  const local = record.localForms[0]?.value?.trim();
  if (!local) return null;
  const reviewed = REVIEWED_LOCAL_FORMS[local];
  if (reviewed) return reviewed.latin;
  if (HAN_TO_LATIN[local]) return HAN_TO_LATIN[local];
  return local
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .split('')
    .map((character) => {
      const direct = NON_LATIN_TO_LATIN[character];
      if (direct !== undefined) return direct;
      const upper = NON_LATIN_TO_LATIN[character.toUpperCase()];
      if (upper !== undefined) {
        return character === character.toLowerCase()
          ? upper.toLowerCase()
          : upper;
      }
      return LATIN_TO_CYRILLIC[character.toLowerCase()] ?? character;
    })
    .join('')
    .replace(/[^\p{Letter}\p{Number} -]/gu, '')
    .trim();
}

function generatedChinese(record: SurnameRecord): string | null {
  const local = record.localForms[0]?.value?.trim();
  const reviewed = local ? REVIEWED_LOCAL_FORMS[local] : undefined;
  if (reviewed) return reviewed.chinese;
  const latin =
    record.romanizedForms.find((value) => value.trim())?.trim() ??
    generatedLatin(record);
  if (record.zhDisplay?.trim()) return record.zhDisplay.trim();
  if (local && /\p{Script=Han}/u.test(local)) return local;
  if (!latin) return null;
  const known =
    CHINESE_SURNAME_FORMS[latin] ??
    NORMALIZED_CHINESE_SURNAME_FORMS.get(
      latin
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLocaleLowerCase('en-US'),
    );
  // Only reviewed forms and established transliterations are presented as
  // Chinese. Anything else stays explicitly unavailable (see
  // docs/NAMING_OBSERVATION_RESEARCH.md) rather than being synthesized.
  return known ?? null;
}

export function getSurnameDisplayForms(record: SurnameRecord): {
  local: string | null;
  latin: string | null;
  chinese: string | null;
} {
  return {
    local: record.localForms[0]?.value?.trim() ?? null,
    latin: generatedLatin(record),
    chinese: generatedChinese(record),
  };
}

/** Chooses exactly one display form, generating local transliteration forms when absent. */
export function resolveSurnameWordmark(
  record: SurnameRecord,
  requestedMode: SurnameDisplayMode,
): SurnameWordmark | null {
  const latin = generatedLatin(record);
  const chinese = generatedChinese(record);
  const latinWasGenerated = Boolean(
    latin && !record.romanizedForms.some((value) => value.trim() === latin),
  );
  const chineseWasGenerated = Boolean(
    chinese && record.zhDisplay?.trim() !== chinese,
  );
  const candidates: Array<{
    source: SurnameDisplaySource;
    value: string | null;
    generated: boolean;
  }> =
    requestedMode === 'local'
      ? [
          {
            source: 'local',
            value: record.localForms[0]?.value ?? null,
            generated: false,
          },
          { source: 'latin', value: latin, generated: latinWasGenerated },
          { source: 'chinese', value: chinese, generated: chineseWasGenerated },
        ]
      : requestedMode === 'latin'
        ? [
            { source: 'latin', value: latin, generated: latinWasGenerated },
            {
              source: 'local',
              value: record.localForms[0]?.value ?? null,
              generated: false,
            },
            {
              source: 'chinese',
              value: chinese,
              generated: chineseWasGenerated,
            },
          ]
        : [
            {
              source: 'chinese',
              value: chinese,
              generated: chineseWasGenerated,
            },
            {
              source: 'local',
              value: record.localForms[0]?.value ?? null,
              generated: false,
            },
            { source: 'latin', value: latin, generated: latinWasGenerated },
          ];
  const chosen = candidates.find((candidate) => candidate.value?.trim().length);
  if (!chosen?.value) return null;
  const value = chosen.value.trim();
  return {
    value,
    source: chosen.source,
    requestedMode,
    fellBack: chosen.source !== requestedMode,
    generated: chosen.generated,
    layout: chooseWordmarkLayout(value),
    characterCount: Array.from(value).length,
  };
}

export function chooseWordmarkLayout(_value: string): 'straight' {
  void _value;
  return 'straight';
}

export function escapeSvgText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Creates a transparent, borderless SVG wordmark texture with one word only. */
// Raster resolution per unit of globe radius. A wordmark one radius wide
// spans roughly 1400 device pixels at the closest zoom on a high-DPI screen.
const WORDMARK_PIXELS_PER_RADIUS = 1400;
const WORDMARK_MIN_PIXEL_WIDTH = 96;
const WORDMARK_MAX_PIXEL_WIDTH = 1024;

/**
 * Texture width for a wordmark of the given world width. Every country keeps
 * its wordmark loaded, so small countries get small rasters.
 */
export function getSurnameWordmarkTexturePixelWidth(worldWidth: number) {
  return Math.round(
    Math.min(
      WORDMARK_MAX_PIXEL_WIDTH,
      Math.max(
        WORDMARK_MIN_PIXEL_WIDTH,
        worldWidth * WORDMARK_PIXELS_PER_RADIUS,
      ),
    ),
  );
}

export function createSurnameWordmarkSvg(
  wordmark: SurnameWordmark,
  pixelWidth?: number,
): string {
  const text = escapeSvgText(wordmark.value);
  const metrics = getSurnameWordmarkMetrics(wordmark);
  const fontFamily = metrics.cjk
    ? SURNAME_WORDMARK_CJK_FONT_FAMILY
    : SURNAME_WORDMARK_LATIN_FONT_FAMILY;
  const x = metrics.width / 2;
  const fontSize = metrics.fontSize;
  const y = metrics.baseline;
  const glyph = `<text x="${x}" y="${y}" text-anchor="middle">${text}</text>`;
  const rasterWidth = pixelWidth ?? metrics.width;
  const rasterHeight = Math.max(
    1,
    Math.round((rasterWidth * WORDMARK_CANVAS_HEIGHT) / metrics.width),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${rasterWidth}" height="${rasterHeight}" viewBox="0 0 ${metrics.width} ${WORDMARK_CANVAS_HEIGHT}"><g fill="#183f40" font-family="${fontFamily}" font-size="${fontSize}" font-weight="600" letter-spacing="${WORDMARK_LETTER_SPACING}">${glyph}</g></svg>`;
}
