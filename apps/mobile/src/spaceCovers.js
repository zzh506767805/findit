const coverSets = {
  living: [
    require('../assets/space-covers/living_1.jpg'),
    require('../assets/space-covers/living_2.jpg'),
    require('../assets/space-covers/living_3.jpg'),
    require('../assets/space-covers/living_4.jpg')
  ],
  bedroom: [
    require('../assets/space-covers/bedroom_1.jpg'),
    require('../assets/space-covers/bedroom_2.jpg'),
    require('../assets/space-covers/bedroom_3.jpg'),
    require('../assets/space-covers/bedroom_4.jpg')
  ],
  kitchen: [
    require('../assets/space-covers/kitchen_1.jpg'),
    require('../assets/space-covers/kitchen_2.jpg'),
    require('../assets/space-covers/kitchen_3.jpg'),
    require('../assets/space-covers/kitchen_4.jpg')
  ],
  entry: [
    require('../assets/space-covers/entry_1.jpg'),
    require('../assets/space-covers/entry_2.jpg'),
    require('../assets/space-covers/entry_3.jpg'),
    require('../assets/space-covers/entry_4.jpg')
  ],
  hallway: [
    require('../assets/space-covers/hallway_1.jpg'),
    require('../assets/space-covers/hallway_2.jpg'),
    require('../assets/space-covers/hallway_3.jpg'),
    require('../assets/space-covers/hallway_4.jpg')
  ],
  bathroom: [
    require('../assets/space-covers/bathroom_1.jpg'),
    require('../assets/space-covers/bathroom_2.jpg'),
    require('../assets/space-covers/bathroom_3.jpg'),
    require('../assets/space-covers/bathroom_4.jpg')
  ],
  study: [
    require('../assets/space-covers/study_1.jpg'),
    require('../assets/space-covers/study_2.jpg'),
    require('../assets/space-covers/study_3.jpg'),
    require('../assets/space-covers/study_4.jpg')
  ],
  balcony: [
    require('../assets/space-covers/balcony_1.jpg'),
    require('../assets/space-covers/balcony_2.jpg'),
    require('../assets/space-covers/balcony_3.jpg'),
    require('../assets/space-covers/balcony_4.jpg')
  ],
  storage: [
    require('../assets/space-covers/storage_1.jpg'),
    require('../assets/space-covers/storage_2.jpg'),
    require('../assets/space-covers/storage_3.jpg'),
    require('../assets/space-covers/storage_4.jpg')
  ]
};

coverSets.default = [
  ...coverSets.living,
  ...coverSets.bedroom,
  ...coverSets.kitchen,
  ...coverSets.entry,
  ...coverSets.hallway,
  ...coverSets.bathroom,
  ...coverSets.study,
  ...coverSets.balcony,
  ...coverSets.storage
];

const coverRules = [
  {
    key: 'living',
    words: [
      '客厅', '起居', '起居室', '会客', '会客厅', '大厅', '厅', '沙发', '电视', '电视柜',
      '茶几', '休闲区', '家庭区', 'living', 'lounge', 'sitting', 'familyroom', 'tvroom', 'den',
      'playroom', 'gameroom'
    ]
  },
  {
    key: 'bedroom',
    words: [
      '卧室', '主卧', '次卧', '客卧', '儿童房', '老人房', '宝宝房', '婴儿房', '房间',
      '睡房', '床边', '床头', '床', '榻榻米', 'bedroom', 'bed', 'kidsroom', 'nursery',
      'guestroom', 'master'
    ]
  },
  {
    key: 'kitchen',
    words: [
      '厨房', '餐厨', '厨', '灶台', '橱柜', '料理台', '操作台', '水槽', '冰箱', '餐厅',
      '餐桌', '饭厅', '用餐', 'kitchen', 'pantry', 'dining', 'diningroom', 'fridge'
    ]
  },
  {
    key: 'entry',
    words: [
      '玄关', '门厅', '入户', '入口', '进门', '门口', '门边', '鞋柜', '换鞋', '钥匙',
      '伞架', 'entry', 'entryway', 'foyer', 'mudroom', 'doorway'
    ]
  },
  {
    key: 'hallway',
    words: [
      '走廊', '过道', '通道', '廊', '楼道', '楼梯', '楼梯间', '电梯厅', '过厅',
      'hallway', 'corridor', 'hall', 'stair', 'stairs', 'landing'
    ]
  },
  {
    key: 'bathroom',
    words: [
      '卫生间', '洗手间', '厕所', '浴室', '洗漱', '洗漱台', '浴柜', '马桶', '淋浴',
      '澡', '浴缸', 'bathroom', 'bath', 'toilet', 'washroom', 'shower', 'lavatory', 'restroom', 'powder',
      'ensuite'
    ]
  },
  {
    key: 'study',
    words: [
      '书房', '办公室', '办公', '工作区', '工作间', '电脑桌', '书桌', '桌面', '学习',
      '学习区', '阅读', '书架', 'study', 'office', 'workspace', 'desk', 'library',
      'reading'
    ]
  },
  {
    key: 'balcony',
    words: [
      '阳台', '露台', '晾晒', '晾衣', '洗衣', '洗衣机', '花架', '花园', '庭院',
      'balcony', 'terrace', 'patio', 'garden', 'laundry', 'porch', 'deck', 'yard', 'sunroom'
    ]
  },
  {
    key: 'storage',
    words: [
      '储物', '储藏', '杂物', '衣帽', '衣帽间', '衣柜', '柜子', '柜', '抽屉', '收纳',
      '置物', '货架', '架子', '库房', '仓库', '杂物间', '工具间', 'closet', 'wardrobe',
      'storage', 'shelf', 'shelves', 'drawer', 'cabinet', 'utility', 'garage', 'basement', 'attic',
      'shed', 'storeroom', 'loft'
    ]
  }
];

function normalizeSpaceName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s_\-·.。/\\|()[\]{}【】（）"'“”‘’]+/g, '');
}

function getSpaceCoverKey(name) {
  const value = normalizeSpaceName(name);
  for (const rule of coverRules) {
    if (rule.words.some((word) => value.includes(word.toLowerCase()))) return rule.key;
  }
  return 'default';
}

export function getSpaceCoverSource(name, index = 0) {
  const set = coverSets[getSpaceCoverKey(name)] || coverSets.default;
  return set[Math.abs(index) % set.length];
}
