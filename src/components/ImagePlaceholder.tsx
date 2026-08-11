// 图片占位符组件 - 实现骨架屏效果（支持暗色模式）
//
// 关键字和变量放在 globals.css 里，不要写成内联 <style>：
// 这个组件每张卡片渲染一次，首页一屏 200 张卡就是 200 个一模一样的 <style> 节点，
// 每个都要解析一遍再往全局样式表里塞一份重复规则 —— 电视盒子上光这一项就够卡了。
const ImagePlaceholder = ({ aspectRatio }: { aspectRatio: string }) => (
  <div className={`skeleton-shine w-full ${aspectRatio} rounded-lg`} />
);

export { ImagePlaceholder };
