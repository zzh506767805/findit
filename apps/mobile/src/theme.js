export const colors = {
  // 背景层级
  bg: '#FAF8F5',
  bgRaised: '#FFFFFF',
  bgCard: '#FFFFFF',
  bgInput: '#F2EFEB',

  // 文字层级
  white: '#FFFFFF',
  text: '#1A1A1A',
  textSecondary: '#6B6560',
  textTertiary: '#9C958E',
  textDim: '#C4BEB7',

  // 主色（用于主按钮、强调）
  primary: '#3A3A3A',
  primaryText: '#FFFFFF',

  // 线条/边框
  line: '#EAE6E1',
  lineStrong: '#D9D4CD',

  // 状态色（克制使用）
  green: '#2D8C5F',
  greenSoft: 'rgba(45,140,95,0.1)',
  orange: '#C47520',
  orangeSoft: 'rgba(196,117,32,0.1)',
  red: '#C0392B',
  redSoft: 'rgba(192,57,43,0.1)',
  blue: '#2E6BC6',
  blueSoft: 'rgba(46,107,198,0.1)',

  // 遮罩
  scrim: 'rgba(26,26,26,0.5)'
};

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999
};

export const shadows = {
  none: {},
  card: {
    shadowColor: '#8C8578',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2
  },
  dock: {
    shadowColor: '#8C8578',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4
  }
};
