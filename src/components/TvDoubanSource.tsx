'use client';

import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * 电视端「豆瓣数据源」面板。
 *
 * 网页端这一项藏在 UserMenu 的设置里 —— 那是一整屏密集表单，遥控器根本填不了，
 * 所以电视端只把这一项单独拎出来：它是唯一一个「不改就整个首页都是空的」的设置。
 * 直连模式下豆瓣会拒掉海外服务器的请求（10 秒超时后 500），换个 CDN 就好了。
 *
 * 复用选源面板那套样式和交互：全屏、单列、上下走、确认即生效。
 *
 * ponytail: 不放「自定义代理」—— 那需要输入一个 URL，遥控器打字是酷刑。
 * 要用自定义代理请用手机或电脑打开同一个地址，设置存在同一个 localStorage 键里。
 */

const OPTIONS = [
  { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN（阿里云）', hint: 'by CMLiussss' },
  {
    value: 'cmliussss-cdn-tencent',
    label: '豆瓣 CDN（腾讯云）',
    hint: 'by CMLiussss',
  },
  { value: 'cors-proxy-zwei', label: 'Cors Proxy', hint: 'by Zwei' },
  {
    value: 'direct',
    label: '直连',
    hint: '由服务器请求豆瓣，海外服务器常被拒绝',
  },
];

export default function TvDoubanSource() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');

  useEffect(() => {
    setCurrent(
      localStorage.getItem('doubanDataSource') ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE ||
        'direct'
    );
  }, []);

  const choose = (value: string) => {
    localStorage.setItem('doubanDataSource', value);
    // 列表是各个页面挂载时拉的，换数据源之后只能整页重来才会重新请求。
    location.reload();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className='tv-nav-item tv-nav-icon'
        aria-label='数据源'
      >
        <Settings size={24} strokeWidth={2} />
      </button>

      {open && (
        <div className='tv-source-picker'>
          {/* 遥控器的返回键被 Activity 吃掉，收不到 keydown；由注入的 __tvBack 代按 */}
          <button data-tv-dismiss='' hidden onClick={() => setOpen(false)} />
          <h1 className='tv-source-picker-title'>豆瓣数据源</h1>
          <p className='tv-source-picker-hint'>
            首页和分类的片单从哪里取。列表空白或一直转圈时换一个试试。
          </p>
          <div className='tv-source-picker-list'>
            {OPTIONS.map(({ value, label, hint }) => {
              const active = value === current;
              return (
                <button
                  key={value}
                  autoFocus={active}
                  data-tv-nav={active ? 'active' : undefined}
                  className='tv-source-option'
                  onClick={() => choose(value)}
                >
                  <span className='tv-source-option-name'>{label}</span>
                  <span className='tv-source-option-meta'>
                    {active ? '使用中' : hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
