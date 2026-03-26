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
  fetchCategories: () => Promise<void>;
  addCategory: (name: string, parentId?: string) => Promise<string | null>;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
}

export const useCategoriesStore = create<CategoriesState>((set, get) => ({
  categories: [],
  isLoading: false,

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
