'use client';

import { X } from 'lucide-react';
import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 叠放的对话框：Esc 只关闭最上层 */
const stack: string[] = [];

interface DownloadDialogProps {
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 工具栏等固定在标题下方、不随列表滚动的内容 */
  toolbar?: ReactNode;
  closeLabel: string;
  size?: 'md' | 'lg';
  /** 叠在其他对话框之上 */
  layer?: 1 | 2;
}

/**
 * 下载相关对话框的外壳：手机上是底部弹出的面板，桌面上是居中的对话框。
 * 支持 Esc / 点击遮罩关闭，打开时把焦点移进对话框，关闭后还给原来的元素。
 */
export function DownloadDialog({
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  toolbar,
  closeLabel,
  size = 'md',
  layer = 1,
}: DownloadDialogProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    stack.push(id);
    // 打开期间锁住背后的页面滚动（iOS 上在遮罩上滑动会滚动页面）
    if (stack.length === 1) document.documentElement.style.overflow = 'hidden';
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.documentElement.style.overflow = '';
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [id]);

  useEffect(() => {
    if (mounted) panelRef.current?.focus({ preventScroll: true });
  }, [mounted]);

  if (!mounted) return null;

  const width = size === 'lg' ? 'md:max-w-3xl' : 'md:max-w-xl';
  const z = layer === 2 ? 'z-[10001]' : 'z-[10000]';

  return createPortal(
    <div
      className={`fixed inset-0 ${z} flex items-end justify-center bg-black/45 backdrop-blur-[2px] md:items-center md:p-6`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className={`flex max-h-[92svh] w-full ${width} animate-o-sheet flex-col overflow-hidden rounded-t-[28px] bg-o-bg text-o-ink shadow-o-lg outline-none md:max-h-[85vh] md:animate-o-pop md:rounded-[28px]`}
      >
        {/* 手机上的拖拽提示条 */}
        <div className='flex justify-center pt-2 md:hidden' aria-hidden='true'>
          <span className='h-1 w-10 rounded-full bg-o-ink/20' />
        </div>
        <div className='flex items-start gap-3 px-5 pb-3 pt-3 md:px-6 md:pt-5'>
          {icon && (
            <span className='mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full bg-o-accent/15 text-o-accent'>
              {icon}
            </span>
          )}
          <div className='min-w-0 flex-1'>
            <h2
              id={`${id}-title`}
              className='m-0 truncate font-heading text-xl leading-tight'
            >
              {title}
            </h2>
            {subtitle && (
              <div className='mt-0.5 truncate text-[13px] text-o-neutral-700'>
                {subtitle}
              </div>
            )}
          </div>
          <button
            type='button'
            onClick={onClose}
            className='o-btn o-btn-secondary o-btn-icon -mr-1 flex-none'
            aria-label={closeLabel}
            title={closeLabel}
          >
            <X className='h-[18px] w-[18px]' strokeWidth={2.5} />
          </button>
        </div>
        {toolbar && <div className='px-5 pb-3 md:px-6'>{toolbar}</div>}
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-o-divider px-5 py-4 md:px-6'>
          {children}
        </div>
        {footer && (
          <div className='border-t border-o-divider px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 md:px-6 md:pb-4'>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** 不用于主要内容的小标签 */
export function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'sage' | 'danger';
}) {
  const tones = {
    neutral: 'bg-o-neutral-200 text-o-neutral-800',
    accent: 'bg-o-accent-100 text-o-accent-800',
    sage: 'bg-o-sage-100 text-o-sage-800',
    danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${
    units[i]
  }`;
}
