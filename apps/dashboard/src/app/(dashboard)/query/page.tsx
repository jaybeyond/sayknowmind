/**
 * @module QueryPage
 * @description RAG query interface page route.
 *
 * @implements FEAT0007 - Natural language query processing
 * @see QueryInterface component for full implementation
 */
import { PageSkeleton } from '@/components/shared/page-skeleton';
import dynamic from 'next/dynamic';

const QueryInterface = dynamic(
  () => import('@/components/query/query-interface').then(m => ({ default: m.QueryInterface })),
  { ssr: false, loading: () => <PageSkeleton /> }
);

export default function QueryPage() {
  return <QueryInterface />;
}
