/**
 * @module PipelinePage
 * @description Dedicated page for monitoring document ingestion pipeline.
 *
 * @implements FEAT0004 - Processing status tracking
 * @implements UC0007 - User monitors document processing progress
 */
import { PageSkeleton } from '@/components/shared/page-skeleton';
import dynamic from 'next/dynamic';

const PipelineMonitor = dynamic(
  () => import('@/components/pipeline/pipeline-monitor').then(m => ({ default: m.PipelineMonitor })),
  { ssr: false, loading: () => <PageSkeleton /> }
);

export default function PipelinePage() {
  return <PipelineMonitor />;
}
