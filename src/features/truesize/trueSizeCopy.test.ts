import { describe, expect, it } from 'vitest';
import { findingSentence, formatArea } from './trueSizeCopy';

const decimal = (tag: string) =>
  new Intl.NumberFormat(tag, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
const integer = (tag: string) =>
  new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });

describe('True Size copy', () => {
  it('rounds areas to three significant figures in both languages', () => {
    expect(formatArea(2_133_938, 'zh')).toBe('213 万平方公里');
    expect(formatArea(2_133_938, 'en')).toBe('2.13 million km²');
    expect(formatArea(16_140, 'en')).toBe('16,100 km²');
    expect(formatArea(6_543, 'zh')).toBe('6,540 平方公里');
  });

  it('states the area ratio and the Mercator contrast with matching meaning', () => {
    expect(
      findingSentence(
        'zh',
        '格陵兰',
        '中国',
        2.13e6,
        9.45e6,
        16.4,
        1.39,
        decimal('zh-CN'),
        integer('zh-CN'),
      ),
    ).toBe(
      '格陵兰的面积约为中国的 23%。在常见网络地图上，它在原处看起来是放在这里时的 11.8 倍大。',
    );
    expect(
      findingSentence(
        'en',
        'Greenland',
        'China',
        2.13e6,
        9.45e6,
        16.4,
        1.39,
        decimal('en-US'),
        integer('en-US'),
      ),
    ).toBe(
      'Greenland is about 23% of the area of China. On a common web map it looks 11.8 times as large at home as it does here.',
    );
  });

  it('handles larger countries, the open ocean and similar latitudes', () => {
    expect(
      findingSentence(
        'en',
        'Brazil',
        'France',
        8.5e6,
        6.3e5,
        1.1,
        2.0,
        decimal('en-US'),
        integer('en-US'),
      ),
    ).toBe(
      'Brazil is about 13.5 times the area of France. On a common web map it would look 1.8 times as large here as it does at home.',
    );
    expect(
      findingSentence(
        'zh',
        '巴西',
        '海洋',
        8.5e6,
        null,
        1.1,
        1.12,
        decimal('zh-CN'),
        integer('zh-CN'),
      ),
    ).toBe('在常见网络地图上，它在这里和在原处看起来差不多大。');
  });
});
