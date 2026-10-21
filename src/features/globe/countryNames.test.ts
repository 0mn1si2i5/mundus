import { describe, expect, it } from 'vitest';
import {
  COUNTRY_NAMES,
  displayCountryName,
  geonamesCountryNameZh,
  ghslCountryNameZh,
} from './countryNames';

describe('reviewed country names', () => {
  it('shows the reviewed Chinese name and keeps the English unit name', () => {
    const taiwan = { countryId: 'ne-158', name: 'Taiwan' };
    expect(displayCountryName(taiwan, 'zh')).toBe('台湾');
    expect(displayCountryName(taiwan, 'en')).toBe('Taiwan');
    expect(
      displayCountryName(
        { countryId: 'ne-x-unknown', name: 'Elsewhere' },
        'zh',
      ),
    ).toBe('Elsewhere');
  });

  it('keeps the owner decisions of 2026-10-21', () => {
    expect(COUNTRY_NAMES['ne-398']?.zh).toBe('哈萨克斯坦');
    expect(COUNTRY_NAMES['ne-408']?.zh).toBe('朝鲜');
    expect(COUNTRY_NAMES['ne-410']?.zh).toBe('韩国');
    expect(COUNTRY_NAMES['ne-214']?.zh).toBe('多米尼加');
    expect(COUNTRY_NAMES['ne-212']?.zh).toBe('多米尼克');
    expect(COUNTRY_NAMES['ne-496']?.zh).toBe('蒙古国');
  });

  it('gives every source the same name for the same country', () => {
    expect(geonamesCountryNameZh('CD')).toBe(COUNTRY_NAMES['ne-180']?.zh);
    expect(ghslCountryNameZh('Democratic Republic of the Congo')).toBe(
      COUNTRY_NAMES['ne-180']?.zh,
    );
    expect(geonamesCountryNameZh('XK')).toBe('塞尔维亚（科索沃）');
    expect(ghslCountryNameZh('Kosovo')).toBe('塞尔维亚（科索沃）');
    expect(ghslCountryNameZh('Northern Cyprus')).toBe('塞浦路斯（北部）');
    expect(geonamesCountryNameZh('ZZ')).toBeNull();
  });
});
