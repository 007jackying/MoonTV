import { ImagePlaceholder } from '@/components/ImagePlaceholder';

const DoubanCardSkeleton = () => {
  return (
    // aria-hidden + inert 的意思是"这里还没有东西"：骨架屏不该被读屏念出来，
    // 也不该有任何可点/可聚焦的东西 —— 遥控器停在一张空卡上按确认是没有反应的。
    <div className='w-full tv-skeleton' aria-hidden='true'>
      <div className='group relative w-full rounded-lg bg-transparent shadow-none flex flex-col'>
        {/* 海报占位：微光扫过，比整块闪烁更接近"正在到来"而不是"出错了" */}
        <div className='tv-shimmer relative aspect-[2/3] w-full overflow-hidden rounded-lg'>
          <ImagePlaceholder aspectRatio='aspect-[2/3]' />
        </div>

        {/* 标题占位 */}
        <div className='absolute top-[calc(100%+0.5rem)] left-0 right-0'>
          <div className='flex flex-col items-center justify-center'>
            <div className='tv-shimmer h-4 w-24 sm:w-32 rounded mb-2'></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DoubanCardSkeleton;
