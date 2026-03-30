const WEB_APP_URL = process.env.NEXT_PUBLIC_WEB_APP_URL || 'http://localhost:3000';

async function fetchFromWeb<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${WEB_APP_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// Types
export interface UserWithStats {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: string;
  createdAt: string;
  document_count: number;
  category_count: number;
  conversation_count: number;
  last_active: string | null;
}

export interface UserDetail extends UserWithStats {
  recent_documents: Array<{ id: string; title: string; status: string; created_at: string }>;
}

export interface AdminStats {
  total_users: number;
  total_documents: number;
  total_categories: number;
  total_conversations: number;
  users_today: number;
}

// API functions
export const fetchUsers = () => fetchFromWeb<UserWithStats[]>('/api/admin/users');
export const fetchUser = (id: string) => fetchFromWeb<UserDetail>(`/api/admin/users/${id}`);
export const deleteUser = (id: string) => fetchFromWeb<{ success: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' });
export const fetchAdminStats = () => fetchFromWeb<AdminStats>('/api/admin/stats');
