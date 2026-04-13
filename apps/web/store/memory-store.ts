import { create } from "zustand";
import { useCategoriesStore } from "./categories-store";

export type Memory = {
  id: string;
  title: string;
  url: string;
  description: string;
  favicon: string;
  collectionId: string;
  categoryIds: string[]; // all categories this memory belongs to
  tags: string[]; // merged view (aiTags + userTags) for backward compat
  aiTags: string[];
  userTags: string[];
  createdAt: string;
  isFavorite: boolean;
  hasDarkIcon?: boolean;
  // AI summary fields
  summary?: string;
  whatItSolves?: string;
  keyPoints?: string[];
  readingTimeMinutes?: number;
  docType?: "url" | "file" | "text";
  fileType?: string; // image, video, pdf, docx, etc.
  fileName?: string;
  ogImage?: string;
  jobStatus?: "pending" | "processing" | "completed" | "failed";
};

type ViewMode = "grid" | "list";
type SortBy = "date-newest" | "date-oldest" | "alpha-az" | "alpha-za";
type FilterType = "all" | "favorites" | "with-tags" | "without-tags";

const PAGE_SIZE = 20;

/** Map a DB document row to the Memory shape used by the UI */
function documentToMemory(row: Record<string, unknown>): Memory {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const aiTags = (Array.isArray(metadata.aiTags) ? metadata.aiTags : []).filter(
    (t): t is string => typeof t === "string"
  );
  const userTags = (Array.isArray(metadata.userTags) ? metadata.userTags : []).filter(
    (t): t is string => typeof t === "string"
  );
  // Backward compat: old docs may still have metadata.tags (pre-migration)
  const legacyTags = (Array.isArray(metadata.tags) ? metadata.tags : []).filter(
    (t): t is string => typeof t === "string"
  );
  // Merge all tags for unified view (deduped)
  const tags = [...new Set([...userTags, ...aiTags, ...legacyTags])];
  const categories = (row.categories ?? []) as Array<{ id: string; name: string }>;

  // Use DB source_type column (reliable) over metadata.doc_type
  const sourceType = String(row.source_type ?? "");
  const docType: "url" | "file" | "text" =
    sourceType === "file" ? "file" : sourceType === "text" ? "text" : "url";

  const fileType = typeof metadata.fileType === "string" ? metadata.fileType : undefined;
  const hasFile = typeof metadata.filePath === "string";
  const isImage = docType === "file" && fileType === "image";

  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    description: String(row.summary ?? ""),
    favicon: row.url
      ? `https://www.google.com/s2/favicons?domain=${new URL(String(row.url)).hostname}&sz=64`
      : "",
    collectionId: categories[0]?.id ?? "all",
    categoryIds: categories.map((c) => c.id),
    tags,
    aiTags,
    userTags,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    isFavorite: metadata.isFavorite === true,
    summary: typeof metadata.summary === "string" ? metadata.summary : undefined,
    whatItSolves: typeof metadata.what_it_solves === "string" ? metadata.what_it_solves : undefined,
    keyPoints: Array.isArray(metadata.key_points) ? (metadata.key_points as unknown[]).filter((k): k is string => typeof k === "string") : undefined,
    readingTimeMinutes: typeof metadata.reading_time_minutes === "number" ? metadata.reading_time_minutes : undefined,
    docType,
    fileType,
    fileName: typeof metadata.fileName === "string" ? metadata.fileName : undefined,
    ogImage: typeof metadata.ogImage === "string"
      ? (metadata.ogImageBase64 ? `/api/og/${String(row.id)}` : metadata.ogImage)
      : (isImage && hasFile ? `/api/files/${String(row.id)}` : undefined),
    jobStatus: typeof row.job_status === "string" ? row.job_status as Memory["jobStatus"] : undefined,
  };
}

export interface DerivedTag {
  id: string;
  name: string;
  count: number;
}

interface MemoryState {
  // Data
  memories: Memory[];
  archivedMemories: Memory[];
  trashedMemories: Memory[];

  // Pagination
  page: number;
  hasMore: boolean;
  totalCount: number;
  archivedLoaded: boolean;
  trashedLoaded: boolean;

  // UI state
  selectedCollection: string;
  selectedTab: string | null;
  selectedTags: string[];
  searchQuery: string;
  viewMode: ViewMode;
  sortBy: SortBy;
  filterType: FilterType;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;

  // Actions
  setSelectedCollection: (collectionId: string) => void;
  setSelectedTab: (tabId: string | null) => void;
  toggleTag: (tagId: string) => void;
  clearTags: () => void;
  setSearchQuery: (query: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setSortBy: (sort: SortBy) => void;
  setFilterType: (filter: FilterType) => void;
  addUserTag: (memoryId: string, tag: string) => void;
  removeUserTag: (memoryId: string, tag: string) => void;
  updateMemoryTitle: (memoryId: string, title: string) => void;
  toggleFavorite: (memoryId: string) => void;
  archiveMemory: (memoryId: string) => void;
  restoreFromArchive: (memoryId: string) => void;
  trashMemory: (memoryId: string) => void;
  restoreFromTrash: (memoryId: string) => void;
  permanentlyDelete: (memoryId: string) => void;
  fetchMemories: () => Promise<void>;
  loadMoreMemories: () => Promise<void>;
  fetchArchivedMemories: () => Promise<void>;
  fetchTrashedMemories: () => Promise<void>;
  getFilteredMemories: () => Memory[];
  getFavoriteMemories: () => Memory[];
  getArchivedMemories: () => Memory[];
  getTrashedMemories: () => Memory[];
  getDerivedTags: () => DerivedTag[];
}

/** Build query string for the /api/documents endpoint */
function buildDocumentsUrl(params: {
  page?: number;
  limit?: number;
  status?: string;
  q?: string;
  categoryId?: string;
  isFavorite?: boolean;
}): string {
  const sp = new URLSearchParams();
  sp.set("page", String(params.page ?? 1));
  sp.set("limit", String(params.limit ?? PAGE_SIZE));
  if (params.status) sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  if (params.categoryId) sp.set("categoryId", params.categoryId);
  if (params.isFavorite) sp.set("isFavorite", "true");
  return `/api/documents?${sp.toString()}`;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  archivedMemories: [],
  trashedMemories: [],

  page: 1,
  hasMore: true,
  totalCount: 0,
  archivedLoaded: false,
  trashedLoaded: false,

  selectedCollection: "all",
  selectedTab: null,
  selectedTags: [],
  searchQuery: "",
  viewMode: "grid",
  sortBy: "date-newest",
  filterType: "all",
  isLoading: true,
  isLoadingMore: false,
  error: null,

  setSelectedCollection: (collectionId) => set({ selectedCollection: collectionId, selectedTab: null }),
  setSelectedTab: (tabId) => set({ selectedTab: tabId }),

  toggleTag: (tagId) =>
    set((state) => ({
      selectedTags: state.selectedTags.includes(tagId)
        ? state.selectedTags.filter((t) => t !== tagId)
        : [...state.selectedTags, tagId],
    })),

  clearTags: () => set({ selectedTags: [] }),

  setSearchQuery: (query) => {
    set({ searchQuery: query });
    // Debounced server-side search: reset and re-fetch
    const store = get();
    set({ memories: [], page: 1, hasMore: true });
    store.fetchMemories();
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  setSortBy: (sort) => set({ sortBy: sort }),

  setFilterType: (filter) => set({ filterType: filter }),

  addUserTag: (memoryId, tag) => {
    const memory = get().memories.find((m) => m.id === memoryId);
    if (!memory) return;
    const prevTags = memory.userTags;
    const prevAllTags = memory.tags;
    const newTags = [...new Set([...memory.userTags, tag])];
    const allTags = [...new Set([...newTags, ...memory.aiTags])];
    set((s) => ({
      memories: s.memories.map((m) =>
        m.id === memoryId ? { ...m, userTags: newTags, tags: allTags } : m
      ),
    }));
    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { userTags: newTags } }),
    }).catch(() => {
      set((s) => ({
        memories: s.memories.map((m) =>
          m.id === memoryId ? { ...m, userTags: prevTags, tags: prevAllTags } : m
        ),
      }));
    });
  },

  removeUserTag: (memoryId, tag) => {
    const memory = get().memories.find((m) => m.id === memoryId);
    if (!memory) return;
    const prevTags = memory.userTags;
    const prevAllTags = memory.tags;
    const newTags = memory.userTags.filter((t) => t !== tag);
    const allTags = [...new Set([...newTags, ...memory.aiTags])];
    set((s) => ({
      memories: s.memories.map((m) =>
        m.id === memoryId ? { ...m, userTags: newTags, tags: allTags } : m
      ),
    }));
    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { userTags: newTags } }),
    }).catch(() => {
      set((s) => ({
        memories: s.memories.map((m) =>
          m.id === memoryId ? { ...m, userTags: prevTags, tags: prevAllTags } : m
        ),
      }));
    });
  },

  updateMemoryTitle: (memoryId, title) => {
    const prevTitle = get().memories.find((m) => m.id === memoryId)?.title;
    set((s) => ({
      memories: s.memories.map((m) =>
        m.id === memoryId ? { ...m, title } : m
      ),
    }));
    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => {
      if (prevTitle !== undefined) {
        set((s) => ({
          memories: s.memories.map((m) =>
            m.id === memoryId ? { ...m, title: prevTitle } : m
          ),
        }));
      }
    });
  },

  toggleFavorite: (memoryId) => {
    const state = get();
    const memory = state.memories.find((m) => m.id === memoryId);
    if (!memory) return;

    const newValue = !memory.isFavorite;

    // Optimistic update
    set({
      memories: state.memories.map((m) =>
        m.id === memoryId ? { ...m, isFavorite: newValue } : m
      ),
    });

    // Persist to API (fire-and-forget)
    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { isFavorite: newValue } }),
    }).catch(() => {
      // Revert on failure
      set((s) => ({
        memories: s.memories.map((m) =>
          m.id === memoryId ? { ...m, isFavorite: !newValue } : m
        ),
      }));
    });
  },

  archiveMemory: (memoryId) => {
    const state = get();
    const memory = state.memories.find((m) => m.id === memoryId);
    if (!memory) return;

    set({
      memories: state.memories.filter((m) => m.id !== memoryId),
      archivedMemories: [...state.archivedMemories, memory],
      totalCount: state.totalCount - 1,
    });

    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "archived" } }),
    }).catch(() => {
      set((s) => ({
        memories: [...s.memories, memory],
        archivedMemories: s.archivedMemories.filter((m) => m.id !== memoryId),
        totalCount: s.totalCount + 1,
      }));
    });
  },

  restoreFromArchive: (memoryId) => {
    const state = get();
    const memory = state.archivedMemories.find((m) => m.id === memoryId);
    if (!memory) return;

    set({
      archivedMemories: state.archivedMemories.filter((m) => m.id !== memoryId),
      memories: [...state.memories, memory],
      totalCount: state.totalCount + 1,
    });

    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "active" } }),
    }).catch(() => {
      set((s) => ({
        memories: s.memories.filter((m) => m.id !== memoryId),
        archivedMemories: [...s.archivedMemories, memory],
        totalCount: s.totalCount - 1,
      }));
    });
  },

  trashMemory: (memoryId) => {
    const state = get();
    const memory = state.memories.find((m) => m.id === memoryId);
    if (!memory) return;

    set({
      memories: state.memories.filter((m) => m.id !== memoryId),
      trashedMemories: [...state.trashedMemories, memory],
      totalCount: state.totalCount - 1,
    });

    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "trashed" } }),
    }).catch(() => {
      set((s) => ({
        memories: [...s.memories, memory],
        trashedMemories: s.trashedMemories.filter((m) => m.id !== memoryId),
        totalCount: s.totalCount + 1,
      }));
    });
  },

  restoreFromTrash: (memoryId) => {
    const state = get();
    const memory = state.trashedMemories.find((m) => m.id === memoryId);
    if (!memory) return;

    set({
      trashedMemories: state.trashedMemories.filter((m) => m.id !== memoryId),
      memories: [...state.memories, memory],
      totalCount: state.totalCount + 1,
    });

    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "active" } }),
    }).catch(() => {
      set((s) => ({
        memories: s.memories.filter((m) => m.id !== memoryId),
        trashedMemories: [...s.trashedMemories, memory],
        totalCount: s.totalCount - 1,
      }));
    });
  },

  permanentlyDelete: (memoryId) => {
    const memory = get().trashedMemories.find((m) => m.id === memoryId);
    set((state) => ({
      trashedMemories: state.trashedMemories.filter((m) => m.id !== memoryId),
    }));

    // Hard-delete from DB
    fetch(`/api/documents/${memoryId}`, { method: "DELETE" }).catch(() => {
      if (memory) {
        set((s) => ({ trashedMemories: [...s.trashedMemories, memory] }));
      }
    });
  },

  /** Fetch first page of active memories (resets pagination) */
  fetchMemories: async () => {
    const { searchQuery } = get();
    set({ isLoading: true, error: null });
    try {
      const url = buildDocumentsUrl({
        page: 1,
        limit: PAGE_SIZE,
        status: "active",
        q: searchQuery || undefined,
      });
      const res = await fetch(url);

      if (!res.ok) {
        set({ isLoading: false, error: res.status === 401 ? null : "Failed to load memories" });
        return;
      }

      const data = await res.json();
      const docs = Array.isArray(data.documents) ? data.documents.map(documentToMemory) : [];
      const total = data.pagination?.total ?? docs.length;

      set({
        memories: docs,
        page: 1,
        hasMore: docs.length >= PAGE_SIZE && docs.length < total,
        totalCount: total,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false, error: "Network error" });
    }
  },

  /** Load next page and append to existing memories */
  loadMoreMemories: async () => {
    const { hasMore, isLoadingMore, page, searchQuery } = get();
    if (!hasMore || isLoadingMore) return;

    set({ isLoadingMore: true });
    try {
      const nextPage = page + 1;
      const url = buildDocumentsUrl({
        page: nextPage,
        limit: PAGE_SIZE,
        status: "active",
        q: searchQuery || undefined,
      });
      const res = await fetch(url);
      if (!res.ok) {
        set({ isLoadingMore: false });
        return;
      }

      const data = await res.json();
      const docs = Array.isArray(data.documents) ? data.documents.map(documentToMemory) : [];
      const total = data.pagination?.total ?? 0;

      set((state) => {
        const merged = [...state.memories, ...docs];
        return {
          memories: merged,
          page: nextPage,
          hasMore: merged.length < total,
          isLoadingMore: false,
        };
      });
    } catch {
      set({ isLoadingMore: false });
    }
  },

  /** Lazy-load archived memories (called only when /archive page is visited) */
  fetchArchivedMemories: async () => {
    if (get().archivedLoaded) return;
    try {
      const res = await fetch(buildDocumentsUrl({ page: 1, limit: 100, status: "archived" }));
      if (!res.ok) return;
      const data = await res.json();
      set({
        archivedMemories: Array.isArray(data.documents) ? data.documents.map(documentToMemory) : [],
        archivedLoaded: true,
      });
    } catch { /* silent */ }
  },

  /** Lazy-load trashed memories (called only when /trash page is visited) */
  fetchTrashedMemories: async () => {
    if (get().trashedLoaded) return;
    try {
      const res = await fetch(buildDocumentsUrl({ page: 1, limit: 100, status: "trashed" }));
      if (!res.ok) return;
      const data = await res.json();
      set({
        trashedMemories: Array.isArray(data.documents) ? data.documents.map(documentToMemory) : [],
        trashedLoaded: true,
      });
    } catch { /* silent */ }
  },

  getFilteredMemories: () => {
    const state = get();
    let filtered = [...state.memories];

    if (state.selectedCollection !== "all") {
      if (state.selectedTab) {
        // Tab selected: filter to only that specific sub-category
        filtered = filtered.filter((m) => m.categoryIds.includes(state.selectedTab!));
      } else {
        // Folder selected: include memories in folder or any descendant
        const { getDescendantIds } = useCategoriesStore.getState();
        const descendantIds = getDescendantIds(state.selectedCollection);
        const validIds = new Set([state.selectedCollection, ...descendantIds]);
        filtered = filtered.filter((m) =>
          m.categoryIds.some((cid) => validIds.has(cid))
        );
      }
    }

    if (state.selectedTags.length > 0) {
      filtered = filtered.filter((m) =>
        state.selectedTags.some((tag) => m.tags.includes(tag))
      );
    }

    // Search is now server-side, but keep client filter for instant sub-filtering
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.title.toLowerCase().includes(query) ||
          m.description.toLowerCase().includes(query) ||
          m.url.toLowerCase().includes(query)
      );
    }

    switch (state.filterType) {
      case "favorites":
        filtered = filtered.filter((m) => m.isFavorite);
        break;
      case "with-tags":
        filtered = filtered.filter((m) => m.tags.length > 0);
        break;
      case "without-tags":
        filtered = filtered.filter((m) => m.tags.length === 0);
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

  getFavoriteMemories: () => {
    const state = get();
    let filtered = state.memories.filter((m) => m.isFavorite);

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.title.toLowerCase().includes(query) ||
          m.description.toLowerCase().includes(query) ||
          m.url.toLowerCase().includes(query)
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

  getArchivedMemories: () => {
    const state = get();
    let filtered = [...state.archivedMemories];

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.title.toLowerCase().includes(query) ||
          m.description.toLowerCase().includes(query) ||
          m.url.toLowerCase().includes(query)
      );
    }

    return filtered;
  },

  getTrashedMemories: () => {
    const state = get();
    let filtered = [...state.trashedMemories];

    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.title.toLowerCase().includes(query) ||
          m.description.toLowerCase().includes(query) ||
          m.url.toLowerCase().includes(query)
      );
    }

    return filtered;
  },

  getDerivedTags: () => {
    // Scope tags to current filtered view (folder/tab context)
    const filtered = get().getFilteredMemories();
    // Count case-insensitively to avoid duplicate tag ids
    const counts = new Map<string, { name: string; count: number }>();
    for (const m of filtered) {
      for (const tag of m.tags) {
        const key = tag.toLowerCase();
        const existing = counts.get(key);
        if (existing) {
          existing.count++;
        } else {
          counts.set(key, { name: tag, count: 1 });
        }
      }
    }
    return Array.from(counts.entries())
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => b.count - a.count);
  },
}));
