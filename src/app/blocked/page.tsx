import BlockedNotice from '@/components/BlockedNotice';

export const runtime = 'edge';

/** 检测到开发者工具后的落地页（见 lib/devtools-guard.ts） */
export default function BlockedPage() {
  return <BlockedNotice />;
}
