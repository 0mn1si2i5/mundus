import type { Locale } from '../../i18n/messages';
import urbanIsolationManifest from '../../data/manifests/urban-isolation.json';
import { Dialog } from '../controls/Dialog';
import styles from './AboutDialog.module.css';

interface Credit {
  name: string;
  use: string;
  notice: string;
  links: readonly { label: string; href: string }[];
}

const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';

const COPY = {
  zh: {
    title: '关于 Mundus',
    description:
      'Mundus 是一个交互式三维地球：选择一种观察方式，转动地球，看见一个清楚的发现。所有计算都在你的浏览器里完成。',
    close: '关闭',
    methods: '观察与方法',
    sources: '数据来源与许可',
    software: '软件',
    softwareText: '源代码与第三方软件许可：',
    repository: 'GitHub 仓库',
    notices: '第三方许可声明',
    methodItems: [
      [
        '地球另一端',
        '对跖点按球面几何在本地计算。端点附近的实线贴合地表，虚线表示穿过不透明地球内部的剖面。最近城市只在捆绑的 GeoNames 主要城市快照中比较，不代表最近的聚居点或行政区划。',
      ],
      [
        '姓氏观察',
        '社区整理的常见姓氏快照，不是统一的官方排名；有数字排名时显示第一位，部分国家为人工整理、未逐条核实。中文译名、本国文字写法和两处拼写更正由 Mundus 审校。',
      ],
      [
        '日照线',
        '太阳位置与晨昏线采用 NOAA/Meeus 近似算法，仅供教育参考，不能用于导航、航空或法定时间。',
      ],
      [
        '城市邻近性',
        '使用 GHSL 城市中心数据库（R2024A）2025 年人口。层级邻近距离是从一座人口 ≥100 万的城市出发、到最近一座人口至少为其 α 倍的城市中心的大圆距离；α 越大门槛越高，距离呈阶梯式增长。全球分区把陆地点归给“距离 ÷ 当前邻近距离”最小的中心，形成不规则区域；颜色只区分归属，没有有效邻近距离的中心只标点。相邻城市可能被合并为一个城市中心；结果只反映几何与人口规模，不代表交通或经济可达性。',
      ],
    ] as const,
    credits: [
      {
        name: 'Natural Earth',
        use: '国家边界与地球矢量底图。边界采用 Natural Earth 中国视角数据，台湾单独显示；地图边界不构成对领土地位的法律认定。',
        notice: 'Made with Natural Earth · 公共领域数据',
        links: [
          { label: '来源', href: 'https://www.naturalearthdata.com/' },
          {
            label: '使用条款',
            href: 'https://www.naturalearthdata.com/about/terms-of-use/',
          },
        ],
      },
      {
        name: 'GeoNames',
        use: '城市搜索与最近主要城市',
        notice: '包含 GeoNames 数据，按 CC BY 4.0 许可，不提供任何保证。',
        links: [
          { label: '来源', href: 'https://www.geonames.org/' },
          { label: 'CC BY 4.0', href: CC_BY_4 },
        ],
      },
      {
        name: '常见姓氏数据',
        use: '姓氏观察',
        notice:
          'Popular Names by Country v1.2（CC0，源自维基百科姓氏列表，CC BY-SA 4.0）；瑞典统计局 2012 年姓名统计；伊朗姓氏频率样本（Apache-2.0）；Pulse Nigeria 非洲常见姓氏列表。',
        links: [
          {
            label: '数据集',
            href: 'https://github.com/sigpwned/popular-names-by-country-dataset/tree/v1.2',
          },
          {
            label: '维基百科列表',
            href: 'https://en.wikipedia.org/wiki/Lists_of_most_common_surnames',
          },
          {
            label: '伊朗样本',
            href: 'https://github.com/farbodbj/iranian-surname-frequencies',
          },
          {
            label: 'Pulse Nigeria',
            href: 'https://www.pulse.ng/story/these-are-the-most-common-surnames-in-every-african-country-2024121210174957832',
          },
        ],
      },
      {
        name: 'GHSL Urban Centre Database',
        use: '城市邻近性',
        notice: `${urbanIsolationManifest.attribution} · CC BY 4.0`,
        links: [
          {
            label: '数据集页面',
            href: 'https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php',
          },
          { label: 'GHSL · CC BY 4.0', href: CC_BY_4 },
        ],
      },
    ] satisfies readonly Credit[],
  },
  en: {
    title: 'About Mundus',
    description:
      'Mundus is an interactive globe: choose a way of observing, turn the Earth, and see one clear finding. Everything is computed in your browser.',
    close: 'Close',
    methods: 'Observations and methods',
    sources: 'Data sources and licenses',
    software: 'Software',
    softwareText: 'Source code and third-party software licenses:',
    repository: 'GitHub repository',
    notices: 'Third-party notices',
    methodItems: [
      [
        'Other Side',
        'The antipode is computed locally with spherical geometry. Solid pieces near the endpoints hug the surface; the dashed line denotes a section through the opaque Earth. Nearest cities are compared only within the bundled GeoNames major-city snapshot; they are not nearest settlements or administrative areas.',
      ],
      [
        'Surname Atlas',
        'A community snapshot of common surnames, not a unified official ranking. Rank one is shown where a numeric rank exists; some countries are manually compiled and not individually verified. Chinese forms, native-script spellings and two spelling corrections are reviewed by Mundus.',
      ],
      [
        'Sunline',
        'Solar position and the terminator use NOAA/Meeus-style approximations, for education only — not for navigation, aviation or legal time.',
      ],
      [
        'Urban Proximity',
        'Uses 2025 populations from the GHSL Urban Centre Database (R2024A). The hierarchical proximity distance is the great-circle distance from a city of at least one million people to the nearest urban centre with at least α times its population; a higher α raises the bar, and the distance grows in steps. Global regions assign land points to the centre with the lowest distance / current proximity distance, producing irregular boundaries. Colours distinguish owners; centres without a valid proximity distance remain dots only. Neighbouring cities can merge into one urban centre; results reflect geometry and size only, not travel or economic access.',
      ],
    ] as const,
    credits: [
      {
        name: 'Natural Earth',
        use: 'Country borders and the vector globe. Boundaries follow the Natural Earth China point-of-view layer, with Taiwan shown separately; map boundaries are not a legal statement on territorial status.',
        notice: 'Made with Natural Earth · public domain data',
        links: [
          { label: 'Source', href: 'https://www.naturalearthdata.com/' },
          {
            label: 'Terms of use',
            href: 'https://www.naturalearthdata.com/about/terms-of-use/',
          },
        ],
      },
      {
        name: 'GeoNames',
        use: 'City search and nearest major cities',
        notice:
          'Contains GeoNames data, licensed under CC BY 4.0, provided without warranty.',
        links: [
          { label: 'Source', href: 'https://www.geonames.org/' },
          { label: 'CC BY 4.0', href: CC_BY_4 },
        ],
      },
      {
        name: 'Common surname data',
        use: 'Surname Atlas',
        notice:
          'Popular Names by Country v1.2 (CC0, from Wikipedia surname lists, CC BY-SA 4.0); Statistics Sweden 2012 name statistics; Iranian surname frequency sample (Apache-2.0); Pulse Nigeria list of common African surnames.',
        links: [
          {
            label: 'Dataset',
            href: 'https://github.com/sigpwned/popular-names-by-country-dataset/tree/v1.2',
          },
          {
            label: 'Wikipedia lists',
            href: 'https://en.wikipedia.org/wiki/Lists_of_most_common_surnames',
          },
          {
            label: 'Iranian sample',
            href: 'https://github.com/farbodbj/iranian-surname-frequencies',
          },
          {
            label: 'Pulse Nigeria',
            href: 'https://www.pulse.ng/story/these-are-the-most-common-surnames-in-every-african-country-2024121210174957832',
          },
        ],
      },
      {
        name: 'GHSL Urban Centre Database',
        use: 'Urban Proximity',
        notice: `${urbanIsolationManifest.attribution} · CC BY 4.0`,
        links: [
          {
            label: 'Dataset page',
            href: 'https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php',
          },
          { label: 'GHSL · CC BY 4.0', href: CC_BY_4 },
        ],
      },
    ] satisfies readonly Credit[],
  },
} as const;

/** Methods, data sources, licenses and software credits in one place. */
export function AboutDialog({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const copy = COPY[locale];
  return (
    <Dialog
      titleId="about-title"
      title={copy.title}
      description={copy.description}
      closeLabel={copy.close}
      onClose={onClose}
      wide
    >
      <section className={styles.section} aria-labelledby="about-methods">
        <h3 id="about-methods">{copy.methods}</h3>
        <dl className={styles.methods}>
          {copy.methodItems.map(([name, text]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={styles.section} aria-labelledby="about-sources">
        <h3 id="about-sources">{copy.sources}</h3>
        <ul className={styles.credits}>
          {copy.credits.map((credit) => (
            <li key={credit.name}>
              <div className={styles.creditHeading}>
                <strong>{credit.name}</strong>
                <span>{credit.use}</span>
              </div>
              <p>{credit.notice}</p>
              <p className={styles.links}>
                {credit.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label} ↗
                  </a>
                ))}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.section} aria-labelledby="about-software">
        <h3 id="about-software">{copy.software}</h3>
        <p className={styles.links}>
          <span>{copy.softwareText}</span>
          <a
            href="https://github.com/0mn1si2i5/Mundus"
            target="_blank"
            rel="noreferrer"
          >
            {copy.repository} ↗
          </a>
          <a href="./THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">
            {copy.notices} ↗
          </a>
        </p>
      </section>
    </Dialog>
  );
}
