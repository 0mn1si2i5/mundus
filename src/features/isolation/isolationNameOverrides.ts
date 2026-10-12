/** Reviewed GHSL name corrections, keyed by GHSL id. Owner-approved 2026-10-08 and 2026-10-12. */
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
  // Owner-approved explanatory label; GHSL's main name is empty, not a verified place name.
  '4893': { nameEn: 'Unnamed urban centre (GHSL 4893)', nameZh: null },
  // D. Owner-reviewed 2026-10-12: county, state and country disambiguation.
  '8903': { nameZh: '承德' }, // reviewed name distinction: Chengde (China)
  '9011': { nameEn: 'Chengde County', nameZh: '承德县' }, // county centre: Chengde (China)
  '10101': { nameZh: '岳阳' }, // reviewed name distinction: Yueyang (China)
  '10151': { nameEn: 'Yueyang County', nameZh: '岳阳县' }, // county centre: Yueyang (China)
  '10335': { nameZh: '衡阳' }, // reviewed name distinction: Hengyang (China)
  '10285': { nameEn: 'Hengyang County', nameZh: '衡阳县' }, // county centre: Hengyang (China)
  '9757': { nameZh: '东营' }, // reviewed name distinction: Dongying (China)
  '9809': { nameEn: 'Guangli', nameZh: '广利' }, // Guangli fishing port: Dongying (China)
  '6682': {
    nameEn: 'Springfield (Missouri)',
    nameZh: '斯普林菲尔德（密苏里州）',
  }, // state distinction: Springfield (United States)
  '8225': {
    nameEn: 'Springfield (Massachusetts)',
    nameZh: '斯普林菲尔德（马萨诸塞州）',
  }, // state distinction: Springfield (United States)
  '5816': { nameZh: '伦敦' }, // reviewed name distinction: London (United Kingdom)
  '2255': { nameEn: 'London (Canada)', nameZh: '伦敦（加拿大）' }, // reviewed name distinction: London (Canada)
  '6080': { nameZh: '剑桥' }, // reviewed name distinction: Cambridge (United Kingdom)
  '2549': { nameEn: 'Cambridge (Canada)', nameZh: '剑桥（加拿大）' }, // reviewed name distinction: Cambridge (Canada)
  '3888': { nameZh: '伯明翰' }, // reviewed name distinction: Birmingham (United Kingdom)
  '6862': { nameEn: 'Birmingham (United States)', nameZh: '伯明翰（美国）' }, // reviewed name distinction: Birmingham (United States)
  '5071': { nameZh: '巴塞罗那' }, // reviewed name distinction: Barcelona (Spain)
  '4175': { nameEn: 'Barcelona (Venezuela)', nameZh: '巴塞罗那（委内瑞拉）' }, // reviewed name distinction: Barcelona (Venezuela)
  '1186': { nameZh: '科隆' }, // reviewed name distinction: Cologne (Germany)
  '203': { nameEn: 'Colón (Panama)', nameZh: '科隆（巴拿马）' }, // reviewed name distinction: Colón (Panama)
  '5194': { nameZh: '巴里' }, // reviewed name distinction: Bari (Italy)
  '3110': { nameEn: 'Barrie (Canada)', nameZh: '巴里（加拿大）' }, // reviewed name distinction: Barrie (Canada)
  '1756': { nameEn: 'Manzanillo (Cuba)', nameZh: '曼萨尼约（古巴）' }, // reviewed name distinction: Manzanillo (Cuba)
  '2672': { nameEn: 'Manzanillo (Mexico)', nameZh: '曼萨尼约（墨西哥）' }, // reviewed name distinction: Manzanillo (México)
  '1031': { nameEn: 'Hamilton (New Zealand)', nameZh: '汉密尔顿（新西兰）' }, // reviewed name distinction: Hamilton (New Zealand)
  '2679': { nameEn: 'Hamilton (Canada)', nameZh: '汉密尔顿（加拿大）' }, // reviewed name distinction: Hamilton (Canada)
  '2335': { nameEn: 'Cordoba (Argentina)', nameZh: '科尔多瓦（阿根廷）' }, // reviewed name distinction: Cordoba (Argentina)
  '2812': { nameEn: 'Córdoba (Spain)', nameZh: '科尔多瓦（西班牙）' }, // reviewed name distinction: Córdoba (Spain)
  '6316': { nameEn: 'Córdoba (Mexico)', nameZh: '科尔多瓦（墨西哥）' }, // reviewed name distinction: Córdoba (México)
  '2087': { nameEn: 'Santa Rosa (United States)', nameZh: '圣罗莎（美国）' }, // reviewed name distinction: Santa Rosa (United States)
  '2871': { nameEn: 'Santa Rosa (Argentina)', nameZh: '圣罗莎（阿根廷）' }, // reviewed name distinction: Santa Rosa (Argentina)
  '648': { nameEn: 'Santa Maria (United States)', nameZh: '圣玛丽亚（美国）' }, // reviewed name distinction: Santa Maria (United States)
  '4014': { nameEn: 'Santa Maria (Brazil)', nameZh: '圣玛丽亚（巴西）' }, // reviewed name distinction: Santa Maria (Brazil)
  '3275': { nameEn: 'Cartagena (Colombia)', nameZh: '卡塔赫纳（哥伦比亚）' }, // reviewed name distinction: Cartagena (Colombia)
  '4295': { nameEn: 'Cartagena (Spain)', nameZh: '卡塔赫纳（西班牙）' }, // reviewed name distinction: Cartagena (Spain)
  '199': { nameEn: 'León (Nicaragua)', nameZh: '莱昂（尼加拉瓜）' }, // reviewed name distinction: León (Nicaragua)
  '4478': { nameEn: 'León (Mexico)', nameZh: '莱昂（墨西哥）' }, // reviewed name distinction: León (México)
  '564': { nameEn: 'Cabinda (Angola)', nameZh: '卡宾达（安哥拉）' }, // reviewed name distinction: Cabinda (Angola)
  '5331': {
    nameEn: 'Kabinda (Democratic Republic of the Congo)',
    nameZh: '卡宾达（刚果（金））',
  }, // reviewed name distinction: Kabinda (Democratic Republic of the Congo)
  '3651': { nameEn: 'Formosa (Argentina)', nameZh: '福莫萨（阿根廷）' }, // reviewed name distinction: Formosa (Argentina)
  '6413': { nameEn: 'Formosa (Brazil)', nameZh: '福莫萨（巴西）' }, // reviewed name distinction: Formosa (Brazil)
  '2930': { nameEn: 'San Carlos (Venezuela)', nameZh: '圣卡洛斯（委内瑞拉）' }, // reviewed name distinction: San Carlos (Venezuela)
  '6638': { nameEn: 'São Carlos (Brazil)', nameZh: '圣卡洛斯（巴西）' }, // reviewed name distinction: São Carlos (Brazil)
  '5796': { nameEn: 'Lincoln (United Kingdom)', nameZh: '林肯（英国）' }, // reviewed name distinction: Lincoln (United Kingdom)
  '6652': { nameEn: 'Lincoln (United States)', nameZh: '林肯（美国）' }, // reviewed name distinction: Lincoln (United States)
  '1445': { nameEn: 'Bharatpur (Nepal)', nameZh: '婆罗多布尔（尼泊尔）' }, // reviewed name distinction: Bharatpur (Nepal)
  '8544': { nameEn: 'Bharatpur (India)', nameZh: '婆罗多布尔（印度）' }, // reviewed name distinction: Bharatpur (India)
  // E. Owner-reviewed 2026-10-12: the complete 99-row city-name review.
  '2454': { nameZh: '撒马尔罕' }, // reviewed name: Samarqand
  '10160': { nameZh: '比拉斯布尔' }, // 印度有多处同名，此为恰蒂斯加尔邦的比拉斯布尔
  '7790': { nameZh: '马辰' }, // reviewed name: Banjarmasin
  '4438': { nameZh: '伊洛伊洛' }, // reviewed name: Iloilo City
  '2115': { nameZh: '马拉迪' }, // reviewed name: Maradi
  '6867': { nameZh: '马哈奇卡拉' }, // reviewed name: Makhachkala
  '5451': { nameZh: '塔克洛班' }, // 近距离候选“独鲁万市”为闽南语社群用名，不采用
  '11608': { nameZh: '英帕尔' }, // reviewed name: Imphal
  '3400': { nameZh: '法兰克福' }, // reviewed name: Frankfurt
  '2558': { nameZh: '塔马利' }, // reviewed name: Tamale
  '6745': { nameZh: '布卡武' }, // reviewed name: Bukavu
  '11310': { nameZh: '库奇比哈尔' }, // 译名不统一
  '11172': { nameZh: '杰尔拜古里' }, // 译名不统一
  '4509': { nameZh: '占碑' }, // reviewed name: Jambi
  '2224': { nameEn: 'Toamasina', nameZh: '图阿马西纳' }, // GHSL 名是局部地名，中心位于图阿马西纳
  '1119': { nameEn: 'Fianarantsoa', nameZh: '菲亚纳兰楚阿' }, // GHSL 名是局部地名，中心位于菲亚纳兰楚阿
  '3129': { nameZh: '杰梅纳' }, // reviewed name: Gemena
  '213': { nameEn: 'San Juan (Puerto Rico)', nameZh: '圣胡安（波多黎各）' }, // GHSL 名带方括号别名；与阿根廷圣胡安（id 29，现名“圣胡安”）重名，按先例加地区名，阿根廷一条也应改为“圣胡安（阿根廷）”
  '8866': { nameZh: '达尔瓦德' }, // 与胡布利（Hubballi）是双子城；也可写作“胡布利-达尔瓦德”
  '10524': { nameZh: '拉贾蒙德里' }, // 旧称 Rajahmundry
  '2377': { nameZh: '海米斯穆谢特' }, // reviewed name: Khamis Mushayt
  '3259': { nameZh: '马扎里沙里夫' }, // reviewed name: Mazar i sharif
  '2024': { nameZh: '塞维利亚' }, // reviewed name: Seville
  '6261': { nameZh: null }, // reviewed name: Kavar
  '3858': { nameZh: '欧拜伊德' }, // reviewed name: Al-Ubayyid
  '756': { nameZh: null }, // reviewed name: Ambovombe
  '4576': { nameZh: '安集延' }, // reviewed name: Andijon
  '6477': { nameZh: '迪亚巴克尔' }, // reviewed name: Diyarbakir
  '7499': { nameZh: '克拉斯诺亚尔斯克' }, // reviewed name: Krasnoyarsk
  '1006': { nameZh: '乌尔根奇' }, // reviewed name: Urgench
  '4382': { nameZh: '沃罗涅日' }, // reviewed name: Voronezh
  '2025': { nameZh: '塞瓦雷' }, // 与莫普提（Mopti）相连；如果负责人想用通行城市名，可改为 Mopti／莫普提
  '3380': { nameZh: '哥打基纳巴卢' }, // 马来西亚华人通称“亚庇”；中国官方领馆名用“哥打基纳巴卢”
  '11578': { nameZh: '迪马布尔' }, // reviewed name: Dimapur
  '2045': { nameZh: '格贝哈' }, // 旧称伊丽莎白港（Port Elizabeth），2021 年更名
  '782': { nameZh: '芒特哈根' }, // reviewed name: Mount Hagen
  '8128': { nameZh: '帕卢' }, // reviewed name: Palu
  '5781': { nameZh: '斯塔夫罗波尔' }, // reviewed name: Stavropol
  '894': { nameEn: 'Yining', nameZh: '伊宁' }, // 近距离候选“伊梨”为错字
  '6577': { nameZh: '塔尔萨' }, // reviewed name: Tulsa
  '5114': { nameEn: 'Aden', nameZh: '亚丁' }, // GHSL 名是局部地名，中心位于亚丁
  '504': { nameZh: '门迪' }, // reviewed name: Mendi
  '4134': { nameZh: '奇瓦瓦' }, // reviewed name: Chihuahua
  '3015': { nameZh: '代恩' }, // reviewed name: Ad Da'ein
  '3613': { nameZh: '奎托' }, // reviewed name: Cuito
  '6540': { nameZh: null }, // reviewed name: Kharameh
  '3766': { nameZh: '扎波罗热' }, // reviewed name: Zaporizhzhia
  '6430': { nameZh: '马诺诺' }, // reviewed name: Manono
  '1313': { nameZh: null }, // reviewed name: Kebkabiya
  '11582': { nameZh: '焦尔哈德' }, // reviewed name: Jorhat
  '8242': { nameZh: '哥伦打洛' }, // reviewed name: Gorontalo
  '4698': { nameZh: '巴科洛德' }, // reviewed name: Bacolod
  '2404': { nameZh: '塔拉波托' }, // reviewed name: Tarapoto
  '11612': { nameZh: '丁苏吉亚' }, // reviewed name: Tinsukia
  '4820': { nameZh: '卡塔尼亚' }, // reviewed name: Catania
  '2575': { nameZh: '法希尔' }, // reviewed name: Al-Fashir
  '1210': { nameZh: '马斯温戈' }, // reviewed name: Masvingo
  '5436': { nameZh: '梅尔辛' }, // reviewed name: Mersin
  '472': { nameZh: '荷台达' }, // reviewed name: Hodeidah
  '75': { nameZh: '哥德堡' }, // reviewed name: Gothenburg
  '5383': { nameZh: '卡米纳' }, // reviewed name: Kamina
  '518': { nameZh: '帕斯托' }, // reviewed name: Pasto
  '2338': { nameZh: '恩泽雷科雷' }, // reviewed name: Nzérékoré
  '11056': { nameZh: '大吉岭' }, // reviewed name: Darjeeling
  '4055': { nameZh: '哈利法克斯' }, // reviewed name: Halifax
  '232': { nameZh: '曼' }, // reviewed name: Man
  '6046': { nameZh: null }, // reviewed name: Malemba-Nkulu
  '6904': { nameZh: '圣彼得斯堡' }, // 美国佛罗里达州，与俄罗斯“圣彼得堡”区分
  '2898': { nameZh: '辛吉达' }, // reviewed name: Singida
  '5453': { nameZh: '阿尔伯克基' }, // reviewed name: Albuquerque
  '1975': { nameZh: null }, // reviewed name: Riwoto
  '7110': { nameZh: null }, // reviewed name: Narmashir
  '5156': { nameZh: '塔比拉兰' }, // reviewed name: Tagbilaran
  '2181': { nameZh: '锡吉里' }, // reviewed name: Siguiri
  '3816': { nameZh: null }, // reviewed name: El Wak
  '4109': { nameZh: '利萨拉' }, // reviewed name: Lisala
  '401': { nameZh: '朱古' }, // reviewed name: Djougou
  '879': { nameZh: '乌尔米耶' }, // reviewed name: Urmia
  '885': { nameZh: '达绍古兹' }, // reviewed name: Dashoguz
  '8332': { nameZh: '安汶' }, // reviewed name: Ambon
  '6038': { nameZh: '归仁' }, // reviewed name: Quy Nhơn
  '6448': { nameZh: '卡马河畔切尔尼' }, // reviewed name: Naberezhnye Chelny
  '5546': { nameZh: '槟港' }, // reviewed name: Pangkalpinang
  '1358': { nameZh: '公主港' }, // reviewed name: Puerto Princesa
  '1938': { nameZh: '康康' }, // reviewed name: Kankan
  '8424': { nameZh: null }, // reviewed name: Elelim
  '1308': { nameZh: '伊万诺-弗兰科夫斯克' }, // reviewed name: Ivano-Frankivsk
  '496': { nameZh: '波贝' }, // reviewed name: Poipet
  '6273': { nameZh: '孔戈洛' }, // reviewed name: Kongolo
  '2582': { nameZh: '米兰热' }, // reviewed name: Milange
  '7608': { nameZh: '雅库茨克' }, // reviewed name: Yakutsk
  '5188': { nameZh: '帕尔马斯' }, // reviewed name: Palmas
  '8402': { nameZh: null }, // reviewed name: Mulia
  '882': { nameZh: '基斯马尤' }, // reviewed name: Kismayo
  '736': { nameZh: '阿鲁阿' }, // reviewed name: Arua
  '2508': { nameZh: null }, // reviewed name: Buram
  '3224': { nameZh: '蒙特港' }, // reviewed name: Puerto Montt
  '2803': { nameZh: '蒙特里亚' }, // reviewed name: Montería
  '3526': { nameZh: null }, // reviewed name: Denov
  '29': { nameEn: 'San Juan (Argentina)', nameZh: '圣胡安（阿根廷）' }, // paired with the reviewed Puerto Rico San Juan (id 213)
};
