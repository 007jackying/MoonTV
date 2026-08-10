interface MoonPhaseProps {
  /** 0–1，看完的比例 */
  progress: number;
  size?: number;
  className?: string;
}

/**
 * 用月相表示观看进度：新月 = 还没看，满月 = 看完了。
 *
 * 这是 MoonTV 电视端的标志性元素。它不是装饰——月相本身就是一个进度刻度，
 * 而且在 3 米外比 4px 高的进度条好认得多。
 *
 * 明亮部分由两段圆弧构成：右半圆，再用一段椭圆弧收回来。
 * 椭圆的横半轴 a = r·|1-2f|，扫掠方向在过半月时翻转：
 *   f=0   a=r, sweep=0 → 两段弧重合，面积为 0（新月）
 *   f=0.5 a=0, sweep=0 → 直线，正好半圆（上弦）
 *   f=1   a=r, sweep=1 → 合成整圆（满月）
 */
export default function MoonPhase({
  progress,
  size = 28,
  className = '',
}: MoonPhaseProps) {
  const f = Math.min(1, Math.max(0, progress));
  const r = 12;
  const a = r * Math.abs(1 - 2 * f);
  const sweep = f > 0.5 ? 1 : 0;
  const lit = `M 0,${-r} A ${r},${r} 0 0,1 0,${r} A ${a},${r} 0 0,${sweep} 0,${-r} Z`;
  const pct = Math.round(f * 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox='-14 -14 28 28'
      className={className}
      role='img'
      aria-label={`看到 ${pct}%`}
    >
      {/* 未看部分：暗面，只留一圈微光勾出轮廓 */}
      <circle r={r} fill='rgba(8,12,22,0.72)' stroke='currentColor' strokeOpacity='0.35' strokeWidth='1' />
      {f > 0.004 && <path d={lit} fill='currentColor' />}
    </svg>
  );
}
