'use client';

import { UserDetailView } from '@/components/users/user-detail';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchUser } from '@/lib/api/sayknowmind';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';

export default function UserDetailPage() {
  const { t } = useTranslation();
  const params = useParams();
  const id = params.id as string;

  const { data: user, isLoading, isError, error } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () => fetchUser(id),
    enabled: !!id,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="shrink-0 border-b bg-background px-6 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href="/users">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">{t('users.backToUsers', 'Back to users')}</span>
          </Link>
        </Button>
        {isLoading ? (
          <Skeleton className="h-6 w-48" />
        ) : (
          <h1 className="text-lg font-semibold">
            {user?.name ?? t('users.userDetail', 'User Detail')}
          </h1>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading && (
          <div className="space-y-4 max-w-3xl">
            <Skeleton className="h-32 w-full" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 text-center max-w-sm mx-auto">
            <div className="rounded-full bg-destructive/10 p-4 mb-4">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold mb-2">{t('users.notFound', 'User not found')}</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {(error as Error)?.message || t('users.notFoundDesc', 'This user could not be loaded.')}
            </p>
            <Button asChild>
              <Link href="/users">{t('users.backToUsers', 'Back to users')}</Link>
            </Button>
          </div>
        )}

        {user && !isLoading && (
          <div className="max-w-3xl">
            <UserDetailView user={user} />
          </div>
        )}
      </div>
    </div>
  );
}
