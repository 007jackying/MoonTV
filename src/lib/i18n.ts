/**
 * 界面文案（中 / EN）。
 * 每个元素只显示一种语言，由导航栏的语言切换决定；
 * 影片标题、简介等来自播放源的内容不翻译。
 */

export type Lang = 'zh' | 'en';

export const LANG_STORAGE_KEY = 'moontv_lang';

const zh = {
  // 导航
  navHome: '首页',
  navMovie: '电影',
  navTv: '剧集',
  navAnime: '动漫',
  navShow: '综艺',
  navCustom: '自定义',
  navSearch: '搜索',
  searchPlaceholder: '搜索电影、电视剧…',
  allSources: '全部源',
  nSources: (n: number) => `${n} 个源`,
  searchHistory: '搜索历史',
  clearAll: '清空全部',
  delete: '删除',
  clear: '清除',
  downloadManager: '下载管理器',
  toggleTheme: '切换主题',
  userMenu: '用户菜单',
  language: '界面语言',
  back: '返回',

  // 播放器
  play: '播放',
  pause: '暂停',
  prevEpisode: '上一集',
  nextEpisode: '下一集',
  nextEpisodeLabel: (ep: string) => `下一集 · ${ep}`,
  volume: '音量',
  mute: '静音',
  unmute: '取消静音',
  playbackSpeed: '播放速度',
  seekBar: '播放进度',
  pip: '画中画',
  settings: '设置',
  fullscreen: '全屏',
  exitFullscreen: '退出全屏',
  airplay: '投屏',
  noticeVolume: (n: number) => `音量 ${n}`,
  noticeSpeed: (n: number) => `${n}× 倍速`,
  noticeFastForward: '快进中 3×',
  noticeSkippedIntro: (t: string) => `已跳过片头 (${t})`,
  noticeSkippedOutro: (t: string) => `已跳过片尾 (${t})`,
  noticeIntroSet: (t: string) => `片头设为 ${t}`,
  noticeOutroSet: (t: string) => `片尾设为 -${t}`,
  playbackError: '播放出错，正在尝试恢复…',
  playbackFailed: '该播放源无法播放，请尝试换源',

  // 播放器设置
  blockAd: '去广告',
  skipIntroOutro: '跳过片头片尾',
  setIntro: '设置片头',
  setOutro: '设置片尾',
  setAtCurrent: '设为当前位置',
  clearSkip: '删除跳过配置',
  danmaku: '弹幕',
  danmakuSource: '弹幕源',
  notSelected: '未选择',
  notSet: '未设置',
  on: '开',
  off: '关',
  autoDanmakuLoading: '正在自动加载弹幕…',
  autoDanmakuFailed: '自动加载弹幕失败，请手动选择弹幕源',

  // 切换状态
  switchingSource: '正在切换播放源',
  switchingEpisode: '正在切换剧集',
  loadingVideo: '正在加载视频',
  stepStop: '已停止上一路视频',
  stepFetch: '已获取播放列表',
  stepFetching: '获取播放列表',
  stepBuffer: '缓冲中',
  resumeAt: (t: string) => `从 ${t} 继续`,

  // 选集与换源面板
  source: '播放源',
  autoPick: '自动优选',
  autoPicking: '优选中…',
  cancel: '取消',
  moreSources: (n: number) => `另有 ${n} 个源`,
  collapse: '收起',
  changeShort: '换源',
  epsCount: (n: number) => `${n} 集`,
  episodes: '选集',
  sortReverse: '倒序',
  sortForward: '正序',
  showAllEps: (n: number) => `展开全部 ${n} 集`,
  collapseEps: '收起选集',
  wrongMatch: '影片匹配有误？去搜索',
  searchingSources: '正在搜索播放源…',
  noSources: '暂无可用的播放源',
  testFailed: '检测失败',
  noSpeedData: '无测速数据',
  measuring: '测速中…',
  switchingState: '切换中…',

  // 详情
  download: '下载',
  douban: '豆瓣',
  more: '更多',
  favorite: '收藏',
  unfavorite: '取消收藏',
  upNext: '下一集',
  episodeN: (n: number) => `第 ${n} 集`,
  movie: '电影',
  untitled: '影片标题',

  // 页面加载 / 错误
  loadSearching: '正在搜索播放源…',
  loadPreferring: '正在优选播放源…',
  loadFetching: '正在获取视频详情…',
  loadReady: '准备就绪，即将开始播放…',
  errorTitle: '哎呀，出现了一些问题',
  errorHint: '请检查网络连接或尝试刷新页面',
  backToSearch: '返回搜索',
  goBack: '返回上页',
  retry: '重新尝试',
  errMissingParams: '缺少必要参数',
  errNotFound: '未找到匹配结果',
  errInvalidEpisode: (n: number) => `选集索引无效，当前共 ${n} 集`,
  errSourceChange: '换源失败',
};

export type Messages = typeof zh;

const en: Messages = {
  navHome: 'Home',
  navMovie: 'Movies',
  navTv: 'Series',
  navAnime: 'Anime',
  navShow: 'Variety',
  navCustom: 'Custom',
  navSearch: 'Search',
  searchPlaceholder: 'Search movies, series…',
  allSources: 'All sources',
  nSources: (n) => `${n} sources`,
  searchHistory: 'Search history',
  clearAll: 'Clear all',
  delete: 'Delete',
  clear: 'Clear',
  downloadManager: 'Downloads',
  toggleTheme: 'Toggle theme',
  userMenu: 'Account',
  language: 'Interface language',
  back: 'Back',

  play: 'Play',
  pause: 'Pause',
  prevEpisode: 'Previous episode',
  nextEpisode: 'Next episode',
  nextEpisodeLabel: (ep) => `Next · ${ep}`,
  volume: 'Volume',
  mute: 'Mute',
  unmute: 'Unmute',
  playbackSpeed: 'Playback speed',
  seekBar: 'Seek',
  pip: 'Picture-in-picture',
  settings: 'Settings',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  airplay: 'AirPlay',
  noticeVolume: (n) => `Volume ${n}`,
  noticeSpeed: (n) => `${n}× speed`,
  noticeFastForward: 'Fast-forward 3×',
  noticeSkippedIntro: (t) => `Skipped intro (${t})`,
  noticeSkippedOutro: (t) => `Skipped outro (${t})`,
  noticeIntroSet: (t) => `Intro ends at ${t}`,
  noticeOutroSet: (t) => `Outro starts at -${t}`,
  playbackError: 'Playback error, trying to recover…',
  playbackFailed: 'This source can’t be played. Try another source.',

  blockAd: 'Block ads',
  skipIntroOutro: 'Skip intro & outro',
  setIntro: 'Intro ends',
  setOutro: 'Outro starts',
  setAtCurrent: 'Set to current time',
  clearSkip: 'Remove skip settings',
  danmaku: 'Danmaku',
  danmakuSource: 'Danmaku source',
  notSelected: 'None',
  notSet: 'Not set',
  on: 'On',
  off: 'Off',
  autoDanmakuLoading: 'Loading danmaku…',
  autoDanmakuFailed:
    'Couldn’t load danmaku automatically. Pick a source manually.',

  switchingSource: 'Switching source',
  switchingEpisode: 'Switching episode',
  loadingVideo: 'Loading video',
  stepStop: 'Previous stream stopped',
  stepFetch: 'Playlist loaded',
  stepFetching: 'Loading playlist',
  stepBuffer: 'Buffering',
  resumeAt: (t) => `Resume ${t}`,

  source: 'Source',
  autoPick: 'Auto-pick best',
  autoPicking: 'Picking…',
  cancel: 'Cancel',
  moreSources: (n) => `${n} more source${n === 1 ? '' : 's'}`,
  collapse: 'Collapse',
  changeShort: 'Change',
  epsCount: (n) => `${n} eps`,
  episodes: 'Episodes',
  sortReverse: 'Reverse order',
  sortForward: 'Original order',
  showAllEps: (n) => `Show all ${n} episodes`,
  collapseEps: 'Show fewer',
  wrongMatch: 'Wrong title? Search instead',
  searchingSources: 'Searching sources…',
  noSources: 'No other sources available',
  testFailed: 'Test failed',
  noSpeedData: 'No speed data',
  measuring: 'Testing…',
  switchingState: 'Switching…',

  download: 'Download',
  douban: 'Douban',
  more: 'More',
  favorite: 'Add to favorites',
  unfavorite: 'Remove from favorites',
  upNext: 'Up next',
  episodeN: (n) => `Episode ${n}`,
  movie: 'Movie',
  untitled: 'Untitled',

  loadSearching: 'Searching sources…',
  loadPreferring: 'Picking the best source…',
  loadFetching: 'Loading details…',
  loadReady: 'Ready, starting playback…',
  errorTitle: 'Something went wrong',
  errorHint: 'Check your connection or try refreshing the page.',
  backToSearch: 'Back to search',
  goBack: 'Go back',
  retry: 'Try again',
  errMissingParams: 'Missing required parameters',
  errNotFound: 'No matching results',
  errInvalidEpisode: (n) => `Invalid episode. This title has ${n} episodes.`,
  errSourceChange: 'Couldn’t switch source',
};

export const MESSAGES: Record<Lang, Messages> = { zh, en };

/**
 * 把播放源给出的集名（如 “第06集”、“06”、“HD中字”）转为当前语言的显示文本。
 * 能识别出集数时使用统一格式，否则保留原名。
 */
export function formatEpisodeLabel(
  t: Messages,
  title: string | undefined,
  index: number
): string {
  if (!title) return t.episodeN(index + 1);
  const match = title.match(/^第?\s*0*(\d+)\s*[集话話]?$/);
  if (match) return t.episodeN(Number(match[1]));
  return title;
}

/** 选集网格里的短标签：能提取数字就只显示数字 */
export function shortEpisodeLabel(
  title: string | undefined,
  index: number
): string {
  if (!title) return String(index + 1);
  const match =
    title.match(/第\s*0*(\d+)\s*[集话話]/) || title.match(/^0*(\d+)$/);
  if (match) return match[1];
  return title;
}
