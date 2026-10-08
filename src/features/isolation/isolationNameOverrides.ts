/** Reviewed GHSL name corrections, keyed by GHSL id. Owner-approved 2026-10-08. */
export interface IsolationNameOverride {
  /** Reviewed English display name when the GHSL main name misleads. */
  nameEn?: string;
  nameZh: string | null;
}

export const ISOLATION_NAME_OVERRIDES: Readonly<
  Record<string, IsolationNameOverride>
> = {
  // A. GHSL label is a district, a province or a placeholder.
  '673': { nameEn: 'Conakry', nameZh: '科纳克里' }, // GHSL: Coyah
  '4952': { nameEn: 'Mbuji-Mayi', nameZh: '姆布吉马伊' }, // GHSL: Kasaï-Oriental
  '10715': { nameEn: "Huai'an", nameZh: '淮安' }, // GHSL: Huaiyin District
  '10403': { nameEn: 'Huainan', nameZh: '淮南' }, // GHSL: Tianjia'an
  '8945': { nameEn: 'Zunyi', nameZh: '遵义' }, // GHSL: Honghuagang
  '7943': { nameEn: 'Nanchong', nameZh: '南充' }, // GHSL: Shunqing
  '10695': { nameEn: 'Haikou', nameZh: '海口' }, // GHSL: Xiuying District
  '10125': { nameEn: 'Zaozhuang', nameZh: '枣庄' }, // GHSL: 市中区
  '11593': { nameEn: 'Xiamen', nameZh: '厦门' }, // GHSL: Xiamen City
  // B. Chinese exonym shared by several GHSL rows; disambiguated.
  '9524': { nameZh: '海得拉巴（印度）' }, // Hyderabad (India)
  '5678': { nameZh: '海得拉巴（巴基斯坦）' }, // Hyderabad (Pakistan)
  '3109': { nameZh: '巴伦西亚（委内瑞拉）' }, // Valencia (Venezuela)
  '4522': { nameZh: '瓦伦西亚（西班牙）' }, // Valencia (Spain)
  '258': { nameZh: '的黎波里（利比亚）' }, // Tripoli (Libya)
  '870': { nameZh: '的黎波里（黎巴嫩）' }, // Tripoli (Lebanon)
  '9800': { nameZh: '塞勒姆（印度）' }, // Salem (India)
  '4909': { nameZh: '塞勒姆（美国）' }, // Salem (United States)
  '7365': { nameZh: '圣路易斯（巴西）' }, // São Luís (Brazil)
  '2018': { nameZh: '圣路易斯（阿根廷）' }, // San Luis (Argentina)
  '2471': { nameZh: '圣迭戈' }, // San Diego
  '798': { nameZh: '圣地亚哥-德洛斯卡瓦列罗斯' }, // Santiago de los Caballeros
  '10289': { nameZh: '湘潭' }, // Xiangtan (0.30 M)
  '10309': { nameZh: '湘潭（南部）' }, // Xiangtan (0.10 M)
  // C. Focal cities absent from, or only in English in, the GeoNames snapshot.
  '2007': { nameZh: '洛杉矶' }, // Los Angeles
  '10576': { nameZh: '哈吉布尔' }, // Hajipur
  '5213': { nameZh: '名古屋' }, // Nagoya
  '5862': { nameZh: '亚的斯亚贝巴' }, // Addis Ababa
  '7428': { nameZh: '费萨拉巴德' }, // Faisalabad
  '7439': { nameZh: '吉大港' }, // Chattogram
  '178': { nameZh: '新加坡' }, // Singapore
  '11185': { nameZh: '香港' }, // Hong Kong
  '632': { nameZh: '科伦坡' }, // Colombo [Sri Jayawardenepura Kotte]
  '1007': { nameZh: '迪拜' }, // Dubai
  '9244': { nameZh: '坎普尔' }, // Kanpur
  '391': { nameZh: '巴马科' }, // Bamako
  '10008': { nameZh: '瓦拉纳西' }, // Varanasi
  '3993': { nameZh: '萨那' }, // Sana'a
  '6000': { nameZh: '萨瓦尔' }, // Savar
  '7910': { nameZh: '华盛顿' }, // Washington
  '7739': { nameZh: '卡利安-栋比夫利' }, // Kalyan-Dombivli
  '5065': { nameZh: '宿务' }, // Cebu City
  '1498': { nameZh: '米兰' }, // Milan
  '6912': { nameZh: '木尔坦' }, // Multan
  '5985': { nameZh: '打横' }, // Tasikmalaya
  '2089': { nameZh: '危地马拉城' }, // Guatemala City
  '11080': { nameZh: '阿桑索尔' }, // Asansol
  '3739': { nameZh: '平壤' }, // P'yŏngyang
  '10306': { nameZh: '马哈拉杰甘杰' }, // Maharajganj
  '9298': { nameZh: '波纳尼' }, // Ponnani
  '6845': { nameZh: '日惹' }, // Yogyakarta
  '1158': { nameZh: '卡利' }, // Cali
  '2125': { nameZh: '基辅' }, // Kyiv
  '11302': { nameZh: '塔姆卢克' }, // Tamluk
  '1919': { nameZh: '高雄' }, // Kaohsiung
  '11079': { nameZh: '珠海－澳门' }, // Zhuhai [Macau]
  '8035': { nameZh: '望加锡' }, // Makassar
  '244': { nameZh: '鹿特丹－海牙' }, // Rotterdam [The Hague]
  '10998': { nameZh: '丹巴德' }, // Dhanbad
  '1375': { nameZh: '圣克鲁斯' }, // Santa Cruz de la Sierra
  '5853': { nameZh: '普埃布拉' }, // Puebla
  '6663': { nameZh: '婆罗门巴里亚' }, // Brahmanbaria
  '424': { nameZh: '恩贾梅纳' }, // N'Djamena
  '4538': { nameZh: '阿瓦士' }, // Ahwaz
  '4305': { nameZh: '本哈' }, // Banha
  '1531': { nameZh: '麦加' }, // Mecca
  '7054': { nameZh: '贝尼' }, // Beni
  '10766': { nameZh: '比布特布尔' }, // Bibhutpur
  '7890': { nameZh: '尼泰罗伊' }, // Niterói
  '5167': { nameZh: '曼苏拉' }, // El Mansura
  '8626': { nameZh: '阿里格尔' }, // Aligarh
  '9352': { nameZh: '特里苏尔' }, // Thrissur
  '222': { nameZh: '努瓦克肖特' }, // Nouakchott
  '658': { nameZh: '巴拿马城' }, // Panama City
  '7961': { nameZh: '乌约' }, // Uyo
  '11184': { nameZh: '杜利扬' }, // Dhulian
  '749': { nameZh: '麦地那' }, // Medina
  '10444': { nameZh: '马尔豪拉' }, // Marhaura
  '3823': { nameZh: '拉杰果德' }, // Rajkot
  '7563': { nameZh: '瓦赛-维拉尔' }, // Vasai-Virar
  '8672': { nameZh: '奥兰加巴德' }, // Chhatrapati Sambhajinagar
  '8806': { nameZh: '瓜廖尔' }, // Gwalior
  '2448': { nameZh: '埃尔比勒' }, // Erbil
  '2005': { nameZh: '安赫莱斯' }, // Angeles
  '6297': { nameZh: '吉绍尔甘杰' }, // Kishoreganj
  '1900': { nameZh: '哈尔格萨' }, // Hargeisa
  '5830': { nameZh: '塔罗贡' }, // Tarogong
  '1290': { nameZh: '布鲁塞尔' }, // Brussels
  '3809': { nameZh: '索尚古韦' }, // Soshanguve
  '11489': { nameZh: '慈溪' }, // Cixi
  '10512': { nameZh: '梅西' }, // Mehsi
  '8666': { nameZh: '莫拉达巴德' }, // Moradabad
  '4407': { nameZh: '非斯' }, // Fez
  '9251': { nameZh: '滨海新区' }, // Binhai New Area
  '4694': { nameZh: '巴淡' }, // Batam City
  '4478': { nameZh: '莱昂' }, // León
  '4034': { nameZh: '纳杰夫' }, // Al-Najaf
  '9860': { nameZh: '吉扬布尔' }, // Gyanpur
  '40': { nameZh: '塞雷昆达' }, // Serrekunda
  '3886': { nameZh: '丹吉尔' }, // Tangier
  '5918': { nameZh: '宰加济格' }, // Al Zaqaziq
  '8100': { nameZh: '维多利亚（巴西）' }, // Vitória
  '4118': { nameZh: '塔伊兹' }, // Ta'izz
  '3811': { nameZh: '哈尔科夫' }, // Kharkiv
  '7426': { nameZh: '阿博' }, // Aboh
  '6635': { nameZh: '北加浪岸' }, // Pekalongan
  '6515': { nameZh: '普禾格多' }, // Purwokerto
  '5500': { nameZh: '仙台' }, // Sendai
  '1063': { nameZh: '塔科拉迪' }, // Takoradi
  '7991': { nameZh: '萨哈兰布尔' }, // Saharanpur
  '564': { nameZh: '卡宾达' }, // Cabinda
  '7181': { nameZh: '明尼阿波利斯－圣保罗' }, // Minneapolis [Saint Paul]
  '4644': { nameZh: '下诺夫哥罗德' }, // Nizhny Novgorod
  '5294': { nameZh: '岘港' }, // Đà Nẵng
  '11122': { nameZh: '布巴内斯瓦尔' }, // Bhubaneshwar
  '4822': { nameZh: '辛詹' }, // Sincan
  '9620': { nameZh: '蒂鲁普' }, // Tiruppur
  '6776': { nameZh: '艾斯尤特' }, // Asyut
  '2921': { nameZh: '广岛' }, // Hiroshima
  '11653': { nameZh: '乐清' }, // Yueqing
  '8363': { nameZh: '纳塔尔' }, // Natal
  '1634': { nameZh: '阿斯塔纳' }, // Astana
  '8954': { nameZh: '绍拉布尔' }, // Solapur
  '7093': { nameZh: '索哈杰' }, // Suhaj
  '4230': { nameZh: '迈哈莱-库布拉' }, // El Mahalla El Kubra
  '7057': { nameZh: '叶卡捷琳堡' }, // Yekaterinburg
  '11280': { nameZh: '伯汉布尔' }, // Berhampore
  '456': { nameZh: '加沙' }, // Gaza
  '1058': { nameZh: '波尔图' }, // Porto
  '1521': { nameZh: '拉姆安拉' }, // Ramallah
  '3509': { nameZh: '马兰热' }, // Malanje
  '6474': { nameZh: '奥凯内' }, // Okene
  '3860': { nameZh: '希拉' }, // Al Hillah
  '312': { nameZh: '埃里温' }, // Yerevan
  '3673': { nameZh: '桑给巴尔城' }, // Zanzibar City
  '6525': { nameZh: '萨尔韦斯坦' }, // Sarvestan
  '5215': { nameZh: '圣路易斯波托西' }, // San Luis Potosí
  '9676': { nameZh: '科拉切尔' }, // Colachel
};
