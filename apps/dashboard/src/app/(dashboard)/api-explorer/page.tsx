import { PageSkeleton } from '@/components/shared/page-skeleton';
import dynamic from 'next/dynamic';

const ApiExplorer = dynamic(
  () => import('@/components/shared/api-explorer').then(m => ({ default: m.ApiExplorer })),
  { ssr: false, loading: () => <PageSkeleton /> }
);

export default function ApiExplorerPage() {
  return <ApiExplorer />;
}
