'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { deleteUser, type UserDetail } from '@/lib/api/sayknowmind';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, FolderOpen, MessageSquare, Shield, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getRoleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' {
  switch (role.toLowerCase()) {
    case 'admin':
      return 'default';
    case 'moderator':
      return 'secondary';
    default:
      return 'outline';
  }
}

function getDocumentStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
    case 'indexed':
      return 'default';
    case 'failed':
      return 'destructive';
    case 'processing':
      return 'secondary';
    default:
      return 'outline';
  }
}

interface UserDetailProps {
  user: UserDetail;
}

export function UserDetailView({ user }: UserDetailProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { mutate: handleDelete, isPending: isDeleting } = useMutation({
    mutationFn: () => deleteUser(user.id),
    onSuccess: () => {
      toast.success(t('users.deleteSuccess', 'User deleted successfully.'));
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      router.push('/users');
    },
    onError: (err: Error) => {
      toast.error(err.message || t('users.deleteError', 'Failed to delete user.'));
    },
  });

  return (
    <div className="space-y-6">
      {/* Profile Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user.image ?? undefined} alt={user.name} />
                <AvatarFallback className="text-lg">{getInitials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">{user.name}</h2>
                <p className="text-sm text-muted-foreground">{user.email}</p>
                <div className="flex items-center gap-2">
                  <Badge variant={getRoleBadgeVariant(user.role)} className="capitalize text-xs">
                    <Shield className="mr-1 h-3 w-3" />
                    {user.role}
                  </Badge>
                  {user.emailVerified && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                      {t('users.verified', 'Verified')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {t('users.memberSince', 'Member since')} {formatDate(user.createdAt)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('users.stats.documents', 'Documents')}
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{user.document_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('users.stats.categories', 'Categories')}
            </CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{user.category_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('users.stats.conversations', 'Conversations')}
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{user.conversation_count}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Documents */}
      {user.recent_documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('users.recentDocuments', 'Recent Documents')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('users.docColumns.title', 'Title')}</TableHead>
                  <TableHead>{t('users.docColumns.status', 'Status')}</TableHead>
                  <TableHead>{t('users.docColumns.created', 'Created')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.recent_documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium truncate max-w-[280px]">
                      {doc.title || `Document ${doc.id.slice(0, 8)}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getDocumentStatusVariant(doc.status)} className="capitalize text-xs">
                        {doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(doc.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            {t('users.dangerZone', 'Danger Zone')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('users.deleteUser', 'Delete this user')}</p>
              <p className="text-xs text-muted-foreground">
                {t('users.deleteWarning', 'This action is permanent and cannot be undone.')}
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isDeleting}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('common.delete', 'Delete')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('users.confirmDeleteTitle', 'Delete user?')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(
                      'users.confirmDeleteDesc',
                      'This will permanently delete {{name}} and all associated data. This cannot be undone.',
                      { name: user.name },
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleDelete()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t('users.confirmDelete', 'Yes, delete user')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Back link at bottom for convenience */}
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/users">
            {t('users.backToUsers', '← Back to users')}
          </Link>
        </Button>
      </div>
    </div>
  );
}
