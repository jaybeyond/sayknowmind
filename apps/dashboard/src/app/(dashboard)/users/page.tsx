'use client';

import { UserTable } from '@/components/users/user-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAdminStats, fetchUsers } from '@/lib/api/sayknowmind';
import { useQuery } from '@tanstack/react-query';
import { FileText, MessageSquare, UserPlus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface StatCardProps {
  title: string;
  value: number | undefined;
  icon: React.ElementType;
  isLoading: boolean;
}

function StatCard({ title, value, icon: Icon, isLoading }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-2xl font-bold tabular-nums">{value ?? 0}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function UsersPage() {
  const { t } = useTranslation();

  const { data: users = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['admin-users'],
    queryFn: fetchUsers,
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: fetchAdminStats,
  });

  return (
    <ScrollArea className="h-full">
      <div className="p-page space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {t('users.title', 'User Management')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('users.subtitle', 'View and manage all registered users.')}
          </p>
        </header>

        {/* Stats */}
        <section aria-label="User statistics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={t('users.stats.totalUsers', 'Total Users')}
            value={stats?.total_users}
            icon={Users}
            isLoading={isLoadingStats}
          />
          <StatCard
            title={t('users.stats.totalDocuments', 'Total Documents')}
            value={stats?.total_documents}
            icon={FileText}
            isLoading={isLoadingStats}
          />
          <StatCard
            title={t('users.stats.totalConversations', 'Total Conversations')}
            value={stats?.total_conversations}
            icon={MessageSquare}
            isLoading={isLoadingStats}
          />
          <StatCard
            title={t('users.stats.newToday', 'New Today')}
            value={stats?.users_today}
            icon={UserPlus}
            isLoading={isLoadingStats}
          />
        </section>

        {/* Users Table */}
        <section aria-label="Users list">
          <UserTable users={users} isLoading={isLoadingUsers} />
        </section>
      </div>
    </ScrollArea>
  );
}
