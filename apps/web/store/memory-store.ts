import { create } from "zustand";

export type Memory = {
  id: string;
  title: string;
  url: string;
  description: string;
  favicon: string;
  collectionId: string;
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
      ? metadata.ogImage
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
  memories: Memory[];
  archivedMemories: Memory[];
  trashedMemories: Memory[];
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
  toggleFavorite: (memoryId: string) => void;
  archiveMemory: (memoryId: string) => void;
  restoreFromArchive: (memoryId: string) => void;
  trashMemory: (memoryId: string) => void;
  restoreFromTrash: (memoryId: string) => void;
  permanentlyDelete: (memoryId: string) => void;
  fetchMemories: () => Promise<void>;
  getFilteredMemories: () => Memory[];
  getFavoriteMemories: () => Memory[];
  getArchivedMemories: () => Memory[];
  getTrashedMemories: () => Memory[];
  getDerivedTags: () => DerivedTag[];
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  archivedMemories: [],
  trashedMemories: [],
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
    });

    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "archived" } }),
    }).catch(() => {
      set((s) => ({
        memories: [...s.memories, memory],
        archivedMemories: s.archivedMemories.filter((m) => m.id !== memoryId),
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
    });

    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "active" } }),
    }).catch(() => {
      set((s) => ({
        memories: s.memories.filter((m) => m.id !== memoryId),
        archivedMemories: [...s.archivedMemories, memory],
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
    });

    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "trashed" } }),
    }).catch(() => {
      set((s) => ({
        memories: [...s.memories, memory],
        trashedMemories: s.trashedMemories.filter((m) => m.id !== memoryId),
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
    });

    fetch(`/api/documents/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { status: "active" } }),
    }).catch(() => {
      set((s) => ({
        memories: s.memories.filter((m) => m.id !== memoryId),
        trashedMemories: [...s.trashedMemories, memory],
      }));
    });
  },

  permanentlyDelete: (memoryId) => {
    set((state) => ({
      trashedMemories: state.trashedMemories.filter((m) => m.id !== memoryId),
    }));

    // Hard-delete from DB
    fetch(`/api/documents/${memoryId}`, { method: "DELETE" }).catch(() => {});
  },

  fetchMemories: async () => {
    set({ isLoading: true, error: null });
    try {
      const [activeRes, archivedRes, trashedRes] = await Promise.all([
        fetch("/api/documents?limit=100&status=active"),
        fetch("/api/documents?limit=100&status=archived"),
        fetch("/api/documents?limit=100&status=trashed"),
      ]);

      if (!activeRes.ok) {
        set({ isLoading: false, error: activeRes.status === 401 ? null : "Failed to load memories" });
        return;
      }

      const [activeData, archivedData, trashedData] = await Promise.all([
        activeRes.json(),
        archivedRes.ok ? archivedRes.json() : { documents: [] },
        trashedRes.ok ? trashedRes.json() : { documents: [] },
      ]);

      set({
        memories: Array.isArray(activeData.documents) ? activeData.documents.map(documentToMemory) : [],
        archivedMemories: Array.isArray(archivedData.documents) ? archivedData.documents.map(documentToMemory) : [],
        trashedMemories: Array.isArray(trashedData.documents) ? trashedData.documents.map(documentToMemory) : [],
        isLoading: false,
      });
    } catch {
      set({ isLoading: false, error: "Network error" });
    }
  },

  getFilteredMemories: () => {
    const state = get();
    let filtered = [...state.memories];

    if (state.selectedCollection !== "all") {
      filtered = filtered.filter((m) => m.collectionId === state.selectedCollection);
    }

    if (state.selectedTags.length > 0) {
      filtered = filtered.filter((m) =>
        state.selectedTags.some((tag) => m.tags.includes(tag))
      );
    }

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
    const { memories } = get();
    // Count case-insensitively to avoid duplicate tag ids
    const counts = new Map<string, { name: string; count: number }>();
    for (const m of memories) {
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
