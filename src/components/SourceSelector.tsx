'use client';
import { ChevronDown, Save, Server, Settings, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Swal from 'sweetalert2';

import { getAvailableApiSitesClient } from '@/lib/config.client';
import { getRequestTimeout } from '@/lib/utils';

import { useI18n } from './LanguageProvider';

interface SourceSelectorProps {
  selectedSources: string[];
  onChange: (sources: string[]) => void;
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  // pill：导航栏搜索框内的胶囊样式（Organic 设计）
  size?: 'default' | 'compact' | 'pill';
}

export default function SourceSelector({
  selectedSources,
  onChange,
  openFilter,
  setOpenFilter,
  size = 'default',
}: SourceSelectorProps) {
  const { t } = useI18n();
  const [availableSources, setAvailableSources] = useState<{ key: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(30);
  const [enableSearchSuggestions, setEnableSearchSuggestions] = useState<boolean>(true);
  
  // 由父组件控制是否展开
  const open = openFilter === 'sources';

  const [popupStyles, setPopupStyles] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // 当前已选源的最新值。上面的恢复/裁剪 effect 只依赖 availableSources，
  // 用 ref 读取可以避免把 selectedSources 塞进依赖数组——那会在用户手动改选后
  // 又把保存的选择覆盖回去。
  const selectedSourcesRef = useRef(selectedSources);
  selectedSourcesRef.current = selectedSources;

  /**
   * 加载可用的搜索源（getAvailableApiSitesClient 已按本地偏好过滤掉 AV 源）。
   * 只在客户端执行，SSR 时直接返回，由下面的 effect 收尾。
   */
  const loadSources = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const sites = await getAvailableApiSitesClient();
      setAvailableSources(sites.map(site => ({ key: site.key, name: site.name })));
    } catch (error) {
      console.error('Failed to load sources:', error);
      setAvailableSources([]); // 确保不会因为错误导致状态未更新
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      // 在服务端渲染时直接设置为完成状态
      setIsLoading(false);
      return;
    }
    loadSources();
  }, [loadSources]);

  // 监听设置变更（如 AV 源过滤开关），重新裁剪可选源与已选源
  useEffect(() => {
    const handleSettingsChange = async () => {
      await loadSources();
    };
    window.addEventListener('searchSettingsChanged', handleSettingsChange);
    return () => {
      window.removeEventListener('searchSettingsChanged', handleSettingsChange);
    };
  }, [loadSources]);

  const toggleOpen = () => {
    if (open) {
      setOpenFilter(null); // 已展开 → 关闭
    } else {
      setOpenFilter('sources'); // 打开自己，关闭其他
    }
  };

  const handleSourceClick = (sourceKey: string) => {
    if (selectedSources.includes(sourceKey)) {
      onChange(selectedSources.filter(key => key !== sourceKey));
    } else {
      onChange([...selectedSources, sourceKey]);
    }
  };


  const handleClearAll = () => {
    onChange([]);
  };

  const handleSaveSources = () => {
    localStorage.setItem('savedSources', JSON.stringify(selectedSources));
    localStorage.setItem('requestTimeout', timeoutSeconds.toString());
    
    // 显示保存成功提示
    Swal.fire({
      icon: 'success',
      title: '保存成功',
      text: '只保存在本地',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
    });
  };

  // 切换搜索建议开关时立即生效
  const handleToggleSearchSuggestions = () => {
    const newValue = !enableSearchSuggestions;
    setEnableSearchSuggestions(newValue);
    
    // 立即保存到 localStorage
    localStorage.setItem('enableSearchSuggestions', newValue.toString());
    
    // 触发自定义事件通知其他组件设置已更改
    window.dispatchEvent(new CustomEvent('searchSettingsChanged', {
      detail: { enableSearchSuggestions: newValue }
    }));
  };

  // 加载保存的搜索源，并清理不存在的源
  useEffect(() => {
    if (typeof window !== 'undefined' && availableSources.length > 0) {
      const savedSources = localStorage.getItem('savedSources');
      if (savedSources) {
        try {
          const parsedSources = JSON.parse(savedSources);
          // 确保保存的源在可用源列表中
          const validSources = parsedSources.filter((source: string) =>
            availableSources.some(avail => avail.key === source)
          );
          
          // 如果保存的源中有不存在的源（已禁用、已被分组限制或被 AV 过滤），更新本地存储
          if (validSources.length !== parsedSources.length) {
            localStorage.setItem('savedSources', JSON.stringify(validSources));
          }

          // 无条件同步，确保被过滤掉的源不会残留（否则父级仍会把它
          // 带上 sources= 参数发出去，得到一个空结果页）。内容相同时跳过，
          // 避免无谓地让父级重渲染并回写 URL。
          const current = selectedSourcesRef.current;
          const unchanged =
            current.length === validSources.length &&
            current.every((s, i) => s === validSources[i]);
          if (!unchanged) {
            onChange(validSources);
          }
        } catch (error) {
          console.error('Failed to parse saved sources:', error);
        }
      }

      // 加载保存的超时时间
      const timeout = getRequestTimeout();
      setTimeoutSeconds(timeout);
      
      // 加载搜索建议设置
      const savedEnableSearchSuggestions = localStorage.getItem('enableSearchSuggestions');
      if (savedEnableSearchSuggestions !== null) {
        setEnableSearchSuggestions(savedEnableSearchSuggestions === 'true');
      }
    }
  }, [availableSources, onChange]);

  // 计算弹窗位置，防止超出屏幕
  useEffect(() => {
    if (open && buttonRef.current && popupRef.current) {
      const btnRect = buttonRef.current.getBoundingClientRect();
      const screenWidth = window.innerWidth;

      let left = btnRect.left;
      const top = btnRect.bottom + 4; // 下方间距
      const width = Math.min(screenWidth - 16, 400); // 弹窗最大宽度400，留一点边距

      // 如果右边超出屏幕，向左移动
      if (left + width > screenWidth - 8) {
        left = Math.max(8, screenWidth - width - 8);
      }

      setPopupStyles({ left, top, width });
    }
  }, [open]);

  const heightClass = size === 'compact' ? 'h-10' : 'h-12';

  /**
   * 服务端渲染时 selectedSources 只能来自 URL（localStorage 读不到），而客户端
   * 水合后会立刻用 localStorage 里的 savedSources 覆盖它。加载完成前不显示
   * 计数，SSR 与首次客户端渲染才能一致，否则 React 会报
   * “Text content did not match”（全部源 → N 个源）并把整段 DOM 重建一次。
   */
  const selectedCount = isLoading ? 0 : selectedSources.length;

  const pillTrigger = (
    <button
      ref={buttonRef}
      type='button'
      onClick={toggleOpen}
      disabled={isLoading}
      aria-expanded={open}
      className='flex h-8 flex-none items-center gap-1.5 rounded-full bg-o-bg px-3 text-[13px] font-semibold text-o-ink transition-colors hover:bg-o-neutral-100 disabled:opacity-60'
    >
      <Server className='h-3.5 w-3.5' strokeWidth={2.75} />
      <span className='whitespace-nowrap'>
        {selectedCount > 0 ? t.nSources(selectedCount) : t.allSources}
      </span>
      <ChevronDown
        className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        strokeWidth={2.75}
      />
    </button>
  );

  if (isLoading) {
    if (size === 'pill') return pillTrigger;
    return (
      <div className="relative inline-block">
        <div className="flex items-center bg-gray-200 dark:bg-gray-700 rounded-l-lg overflow-hidden">
          <button
            className={`flex items-center gap-1 px-3 ${heightClass} text-sm font-medium opacity-50`}
            disabled
          >
            <Settings className="w-4 h-4" />
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      {size === 'pill' ? pillTrigger : (
      <div className="flex items-center bg-gray-200 dark:bg-gray-700 rounded-l-lg overflow-hidden">
        <button
          ref={buttonRef}
          onClick={toggleOpen}
          className={`flex items-center gap-1 px-3 ${heightClass} text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors`}
        >
          <Settings className="w-4 h-4" />
          {selectedSources.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs bg-green-500 text-white rounded-full ml-1">
              {selectedSources.length}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : 'rotate-0'}`} />
        </button>
        
      </div>
      )}

      {open && (
        <div
          ref={popupRef}
          style={popupStyles}
          className="
            fixed z-50
            bg-o-surface text-o-ink
            rounded-[28px] shadow-o-lg p-4
            max-h-[50vh] overflow-auto
          "
        >
          <div
            className="mb-3 grid gap-2"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            }}
          >
            {/* 保存按钮 */}
            <button
              onClick={handleSaveSources}
              className="o-btn o-btn-primary px-3 py-1 text-sm"
              title="保存当前选中的搜索源和超时设置"
            >
              <Save className="w-3 h-3" />
              保存
            </button>
            
            {/* 清空按钮 */}
            <button
              onClick={handleClearAll}
              className="o-btn o-btn-secondary px-2 py-1 text-sm"
              title="清空所有选中的搜索源"
            >
              <X className="w-4 h-4" />
              清空
            </button>
            
            {/* 超时时间设置 */}
            <div className="flex items-center justify-center gap-2 bg-o-bg rounded-full px-3 py-1">
              <label className="text-xs text-o-neutral-700 whitespace-nowrap">
                超时:
              </label>
              <input
                type="number"
                min="1"
                max="60"
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(Math.max(1, Math.min(60, Number(e.target.value) || 30)))}
                className="w-12 px-1 py-0.5 text-sm bg-o-surface border border-o-divider rounded-full text-center text-o-ink focus:outline-none focus:ring-1 focus:ring-o-accent"
                title="请求超时时间（秒）"
              />
              <span className="text-xs text-o-neutral-700 whitespace-nowrap">秒</span>
            </div>
            
            {/* 搜索建议开关 */}
            <div className="flex items-center justify-center gap-2 bg-o-bg rounded-full px-3 py-1">
              <label className="text-xs text-o-neutral-700 whitespace-nowrap">
                搜索建议
              </label>
              <button
                onClick={handleToggleSearchSuggestions}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  enableSearchSuggestions ? 'bg-o-sage' : 'bg-o-neutral-400'
                }`}
                title={enableSearchSuggestions ? '点击关闭搜索建议（立即生效）' : '点击开启搜索建议（立即生效）'}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-o-bg transition-transform ${
                    enableSearchSuggestions ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
          
          {availableSources.length > 0 ? (
            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              }}
            >
              {availableSources.map((source) => (
                <button
                  key={source.key}
                  onClick={() => handleSourceClick(source.key)}
                  className={`px-3 py-2 text-sm font-semibold rounded-full transition-colors text-center truncate ${
                    selectedSources.includes(source.key)
                      ? 'bg-o-accent text-o-on-accent'
                      : 'text-o-ink hover:bg-o-ink/[0.07]'
                  }`}
                  title={source.name}
                >
                  {source.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-o-neutral-700">
              请配置搜索源或清除缓存
            </div>
          )}
        </div>
      )}
    </div>
  );
}