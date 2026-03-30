import { create } from "zustand";

export interface CategoryItem {
  id: string;
  name: string;
  color: string | null;
  depth: number;
  path: string;
  parent_id: string | null;
}

interface CategoriesState {
  categories: CategoryItem[];
  isLoading: boolean;
  expandedFolders: Set<string>;

  // Actions
  fetchCategories: () => Promise<void>;
  addCategory: (name: string, parentId?: string) => Promise<string | null>;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
  toggleFolder: (id: string) => void;

  // Computed helpers
  getRootCategories: () => CategoryItem[];
  getChildren: (parentId: string) => CategoryItem[];
  getDescendantIds: (parentId: string) => string[];
  hasChildren: (categoryId: string) => boolean;
}

export const useCategoriesStore = create<CategoriesState>((set, get) => ({
  categories: [],
  isLoading: false,
  expandedFolders: new Set<string>(),

  toggleFolder: (id) =>
    set((state) => {
      const next = new Set(state.expandedFolders);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedFolders: next };
    }),

  getRootCategories: () =>
    get().categories.filter((c) => !c.parent_id),

  getChildren: (parentId) =>
    get().categories.filter((c) => c.parent_id === parentId),

  getDescendantIds: (parentId) => {
    const cats = get().categories;
    const result: string[] = [];
    const queue = [parentId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const c of cats) {
        if (c.parent_id === current) {
          result.push(c.id);
          queue.push(c.id);
        }
      }
    }
    return result;
  },

  hasChildren: (categoryId) =>
    get().categories.some((c) => c.parent_id === categoryId),

  fetchCategories: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) {
        set({ isLoading: false });
        return;
      }
      const data = await res.json();
      set({
        categories: data.categories ?? [],
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  addCategory: async (name: string, parentId?: string) => {
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId }),
      });
      if (res.ok) {
        const data = await res.json();
        await get().fetchCategories();
        return data.categoryId as string;
      }
      return null;
    } catch {
      return null;
    }
  },

  renameCategory: async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await get().fetchCategories();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  deleteCategory: async (id: string) => {
    try {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      if (res.ok) {
        await get().fetchCategories();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
}));
