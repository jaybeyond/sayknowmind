/**
 * @module DocumentsPage
 * @description Document ingestion and management page route.
 *
 * @implements FEAT0001 - Document ingestion
 * @see DocumentManager component for full implementation
 */
import { PageSkeleton } from '@/components/shared/page-skeleton';
import dynamic from 'next/dynamic';

const DocumentManager = dynamic(
  () => import('@/components/documents/document-manager').then(m => ({ default: m.DocumentManager })),
  { ssr: false, loading: () => <PageSkeleton /> }
);

export default function DocumentsPage() {
  return <DocumentManager />;
}
