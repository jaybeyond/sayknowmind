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
}

export const useCategoriesStore = create<CategoriesState>((set) => ({
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
}));
