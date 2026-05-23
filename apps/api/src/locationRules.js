const ROOM_ALIASES = [
  { room: '客厅', re: /^(客厅|起居室|会客厅|大厅|家庭区|休闲区)$/ },
  { room: '卧室', re: /^(卧室|主卧|次卧|客卧|儿童房|老人房|宝宝房|婴儿房|睡房)$/ },
  { room: '书房', re: /^(书房|办公室|工作间|工作区|学习区|阅读区)$/ },
  { room: '厨房', re: /^(厨房|餐厨|厨)$/ },
  { room: '餐厅', re: /^(餐厅|饭厅|用餐区)$/ },
  { room: '玄关', re: /^(玄关|门厅|入户|入口|门口)$/ },
  { room: '走廊', re: /^(走廊|过道|通道)$/ },
  { room: '卫生间', re: /^(卫生间|洗手间|厕所|浴室|洗漱间)$/ },
  { room: '阳台', re: /^(阳台|露台|晾晒区)$/ },
  { room: '储物间', re: /^(储物间|储藏室|储藏间|杂物间|库房|仓库|工具间)$/ },
  { room: '衣帽间', re: /^(衣帽间|更衣间)$/ },
  { room: '车库', re: /^(车库|车房)$/ }
];

const ROOM_PREFIX_RE = /^(客厅|起居室|会客厅|大厅|卧室|主卧|次卧|客卧|儿童房|老人房|书房|办公室|工作区|学习区|厨房|餐厨|餐厅|饭厅|玄关|门厅|入户|走廊|过道|卫生间|洗手间|厕所|浴室|阳台|露台|储物间|储藏室|储藏间|杂物间|库房|仓库|工具间|衣帽间|车库)/;

const POSITION_SPACE_RULES = [
  { space: '卧室', re: /梳妆台|床头柜|床边柜|床头|床上|床下|衣柜|衣橱|衣架|斗柜/ },
  { space: '书房', re: /书桌|电脑桌|办公桌|书架|文件柜|打印机|显示器/ },
  { space: '客厅', re: /电视柜|茶几|沙发|边几|角几|电视墙|电视机/ },
  { space: '厨房', re: /橱柜|灶台|水槽|料理台|操作台|冰箱|微波炉|烤箱|洗碗机|锅架/ },
  { space: '餐厅', re: /餐桌|餐边柜|餐椅|酒柜/ },
  { space: '玄关', re: /鞋柜|玄关柜|换鞋凳|门边|钥匙盘|伞架/ },
  { space: '卫生间', re: /洗手台|洗漱台|浴室柜|马桶|淋浴|浴缸|毛巾架/ },
  { space: '阳台', re: /阳台柜|洗衣机|烘干机|晾衣架|花架/ },
  { space: '储物间', re: /储物柜|置物架|货架|收纳架|工具柜|杂物柜/ }
];

const GENERIC_POSITION_RE = /柜|桌|椅|架|台|床|沙发|冰箱|灶|水槽|马桶|抽屉|盒|箱|篮|筐|桶|地面|桌面|台面|墙角|角落|旁|边|顶部|上面|下面|层|收纳/;

function cleanName(name) {
  return String(name || '').trim().replace(/\s+/g, '');
}

export function canonicalSpaceName(name) {
  const text = cleanName(name);
  if (!text) return '';
  for (const item of ROOM_ALIASES) {
    if (item.re.test(text)) return item.room;
  }
  return '';
}

export function isLikelyRoomName(name) {
  return Boolean(canonicalSpaceName(name));
}

export function inferSpaceNameForPosition(name) {
  const text = cleanName(name);
  if (!text || isLikelyRoomName(text)) return '';

  const prefix = text.match(ROOM_PREFIX_RE)?.[1];
  if (prefix && text.length > prefix.length) {
    return canonicalSpaceName(prefix) || prefix;
  }

  for (const item of POSITION_SPACE_RULES) {
    if (item.re.test(text)) return item.space;
  }

  return '';
}

export function isLikelyPositionName(name) {
  const text = cleanName(name);
  if (!text || isLikelyRoomName(text)) return false;
  if (inferSpaceNameForPosition(text)) return true;
  return GENERIC_POSITION_RE.test(text);
}
