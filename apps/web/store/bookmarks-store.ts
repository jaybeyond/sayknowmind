import { create } from "zustand";

export type Bookmark = {
  id: string;
  title: string;
  url: string;
  description: string;
  favicon: string;
  collectionId: string;
  tags: string[];
  createdAt: string;
  isFavorite: boolean;
  hasDarkIcon?: boolean;
  // AI summary fields
  summary?: string;
  whatItSolves?: string;
  keyPoints?: string[];
  readingTimeMinutes?: number;
  docType?: "url" | "file" | "text";
};

type ViewMode = "grid" | "list";
type SortBy = "date-newest" | "date-oldest" | "alpha-az" | "alpha-za";
type FilterType = "all" | "favorites" | "with-tags" | "without-tags";

/** Map a DB document row to the Bookmark shape used by the UI */
function documentToBookmark(row: Record<string, unknown>): Bookmark {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const tags = (Array.isArray(metadata.tags) ? metadata.tags : []).filter(
    (t): t is string => typeof t === "string"
  );
  const categories = (row.categories ?? []) as Array<{ id: string; name: string }>;

  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    description: String(row.summary ?? ""),
    favicon: row.url
      ? `https://www.google.com/s2/favicons?domain=${new URL(String(row.url)).hostname}&sz=64`
      : "",
    collectionId: categories[0]?.id ?? "all",
    tags,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    isFavorite: metadata.isFavorite === true,
    summary: typeof metadata.summary === "string" ? metadata.summary : undefined,
    whatItSolves: typeof metadata.what_it_solves === "string" ? metadata.what_it_solves : undefined,
    keyPoints: Array.isArray(metadata.key_points) ? (metadata.key_points as unknown[]).filter((k): k is string => typeof k === "string") : undefined,
    readingTimeMinutes: typeof metadata.reading_time_minutes === "number" ? metadata.reading_time_minutes : undefined,
    docType: (metadata.doc_type === "file" || metadata.doc_type === "text") ? metadata.doc_type as "file" | "text" : "url",
  };
}

export interface DerivedTag {
  id: string;
  name: string;
  count: number;
}

interface BookmarksState {
  bookmarks: Bookmark[];
  archivedBookmarks: Bookmark[];
  trashedBookmarks: Bookmark[];
  selectedCollection: string;
  selectedTags: string[];
  searchQuery: string;
  viewMode: ViewMode;
  sortBy: SortBy;
  filterType: FilterType;
  isLoading: boolean;
  error: string | null;
  setSelectedCollection: (collectionId: string) => void;
  toggleTag: (tagId: string) => void;
  clearTags: () => void;
  setSearchQuery: (query: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setSortBy: (sort: SortBy) => void;
  setFilterType: (filter: FilterType) => void;
  toggleFavorite: (bookmarkId: string) => void;
  archiveBookmark: (bookmarkId: string) => void;
  restoreFromArchive: (bookmarkId: string) => void;
  trashBookmark: (bookmarkId: string) => void;
  restoreFromTrash: (bookmarkId: string) => void;
  permanentlyDelete: (bookmarkId: string) => void;
  fetchBookmarks: () => Promise<void>;
  getFilteredBookmarks: () => Bookmark[];
  getFavoriteBookmarks: () => Bookmark[];
  getArchivedBookmarks: () => Bookmark[];
  getTrashedBookmarks: () => Bookmark[];
  getDerivedTags: () => DerivedTag[];
}

export const useBookmarksStore = create<BookmarksState>((set, get) => ({
  bookmarks: [],
  archivedBookmarks: [],
  trashedBookmarks: [],
  selectedCollection: "all",
  selectedTags: [],
  searchQuery: "",
  viewMode: "grid",
  sortBy: "date-newest",
  filterType: "all",
  isLoading: true,
  error: null,

  setSelectedCollection: (collectionId) => set({ selectedCollection: collectionId }),

  toggleTag: (tagId) =>
    set((state) => ({
      selectedTags: state.selectedTags.includes(tagId)
        ? state.selectedTags.filter((t) => t !== tagId)
        : [...state.selectedTags, tagId],
    })),

  clearTags: () => set({ selectedTags: [] }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setSortBy: (sort) => set({ sortBy: sort }),

  setFilterType: (filter) => set({ filterType: filter }),

  toggleFavorite: (bookmarkId) => {
    const state = get();
    const bookmark = state.bookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) return;

    const newValue = !bookmark.isFavorite;

    // Optimistic update
    set({
      bookmarks: state.bookmarks.map((b) =>
        b.id === bookmarkId ? { ...b, isFavorite: newValue } : b
      ),
    });

    // Persist to API (fire-and-forget)
    fetch(`/api/documents/${bookmarkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { isFavorite: newValue } }),
    }).catch(() => {
      // Revert on failure
      set((s) => ({
        bookmarks: s.bookmarks.map((b) =>
          b.id === bookmarkId ? { ...b, isFavorite: !newValue } : b
        ),
      }));
    });
  },

  archiveBookmark: (bookmarkId) => {
    const state = get();
    const bookmark = state.bookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) return;

    set({
      bookmarks: state.bookmarks.filter((b) => b.id !== bookmarkId),
      archivedBookmarks: [...state.archivedBookmarks, bookmark],
    });

    fetch(`/api/documents/${bookmarkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "archived" } }),
    }).catch(() => {
      set((s) => ({
        bookmarks: [...s.bookmarks, bookmark],
        archivedBookmarks: s.archivedBookmarks.filter((b) => b.id !== bookmarkId),
      }));
    });
  },

  restoreFromArchive: (bookmarkId) => {
    const state = get();
    const bookmark = state.archivedBookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) return;

    set({
      archivedBookmarks: state.archivedBookmarks.filter((b) => b.id !== bookmarkId),
      bookmarks: [...state.bookmarks, bookmark],
    });

    fetch(`/api/documents/${bookmarkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "active" } }),
    }).catch(() => {
      set((s) => ({
        bookmarks: s.bookmarks.filter((b) => b.id !== bookmarkId),
        archivedBookmarks: [...s.archivedBookmarks, bookmark],
      }));
    });
  },

  trashBookmark: (bookmarkId) => {
    const state = get();
    const bookmark = state.bookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) return;

    set({
      bookmarks: state.bookmarks.filter((b) => b.id !== bookmarkId),
      trashedBookmarks: [...state.trashedBookmarks, bookmark],
    });

    fetch(`/api/documents/${bookmarkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "trashed" } }),
    }).catch(() => {
      set((s) => ({
        bookmarks: [...s.bookmarks, bookmark],
        trashedBookmarks: s.trashedBookmarks.filter((b) => b.id !== bookmarkId),
      }));
    });
  },

  restoreFromTrash: (bookmarkId) => {
    const state = get();
    const bookmark = state.trashedBookmarks.find((b) => b.id === bookmarkId);
    if (!bookmark) return;

    set({
      trashedBookmarks: state.trashedBookmarks.filter((b) => b.id !== bookmarkId),
      bookmarks: [...state.bookmarks, bookmark],
    });

    fetch(`/api/documents/${bookmarkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "active" } }),
    }).catch(() => {
      set((s) => ({
        bookmarks: s.bookmarks.filter((b) => b.id !== bookmarkId),
        trashedBookmarks: [...s.trashedBookmarks, bookmark],
      }));
    });
  },

  permanentlyDelete: (bookmarkId) => {
    set((state) => ({
      trashedBookmarks: state.trashedBookmarks.filter((b) => b.id !== bookmarkId),
    }));

    // Hard-delete from DB
    fetch(`/api/documents/${bookmarkId}`, { method: "DELETE" }).catch(() => {});
  },

  fetchBookmarks: async () => {
    set({ isLoading: true, error: null });
    try {
      const [activeRes, archivedRes, trashedRes] = await Promise.all([
        fetch("/api/documents?limit=100&status=active"),
        fetch("/api/documents?limit=100&status=archived"),
        fetch("/api/documents?limit=100&status=trashed"),
      ]);

      if (!activeRes.ok) {
        set({ isLoading: false, error: activeRes.status === 401 ? null : "Failed to load bookmarks" });
        return;
      }

      const [activeData, archivedData, trashedData] = await Promise.all([
        activeRes.json(),
        archivedRes.ok ? archivedRes.json() : { documents: [] },
        trashedRes.ok ? trashedRes.json() : { documents: [] },
      ]);

      set({
        bookmarks: Array.isArray(activeData.documents) ? activeData.documents.map(documentToBookmark) : [],
        archivedBookmarks: Array.isArray(archivedData.documents) ? archivedData.documents.map(documentToBookmark) : [],
        trashedBookmarks: Array.isArray(trashedData.documents) ? trashedData.documents.map(documentToBookmark) : [],
        isLoading: false,
      });
    } catch {
      set({ isLoading: false, error: "Network error" });
    }
  },

  getFilteredBookmarks: () => {
    const state = get();
    let filtered = [...state.bookmarks];

    if (state.selectedCollection !== "all") {
      filtered = filtered.filter((b) => b.collectionId === state.selectedCollection);
    }

    if (state.selectedTags.length > 0) {
      filtered = filtered.filter((b) =>
        state.selectedTags.some((tag) => b.tags.includes(tag))
      );
    }

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    switch (state.filterType) {
      case "favorites":
        filtered = filtered.filter((b) => b.isFavorite);
        break;
      case "with-tags":
        filtered = filtered.filter((b) => b.tags.length > 0);
        break;
      case "without-tags":
        filtered = filtered.filter((b) => b.tags.length === 0);
        break;
    }

    switch (state.sortBy) {
      case "date-newest":
        filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "date-oldest":
        filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case "alpha-az":
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "alpha-za":
        filtered.sort((a, b) => b.title.localeCompare(a.title));
        break;
    }

    return filtered;
  },

  getFavoriteBookmarks: () => {
    const state = get();
    let filtered = state.bookmarks.filter((b) => b.isFavorite);

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    switch (state.sortBy) {
      case "date-newest":
        filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "date-oldest":
        filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case "alpha-az":
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "alpha-za":
        filtered.sort((a, b) => b.title.localeCompare(a.title));
        break;
    }

    return filtered;
  },

  getArchivedBookmarks: () => {
    const state = get();
    let filtered = [...state.archivedBookmarks];

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    return filtered;
  },

  getTrashedBookmarks: () => {
    const state = get();
    let filtered = [...state.trashedBookmarks];

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.description.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query)
      );
    }

    return filtered;
  },

  getDerivedTags: () => {
    const { bookmarks } = get();
    const counts = new Map<string, number>();
    for (const b of bookmarks) {
      for (const tag of b.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ id: name.toLowerCase(), name, count }))
      .sort((a, b) => b.count - a.count);
  },
}));
