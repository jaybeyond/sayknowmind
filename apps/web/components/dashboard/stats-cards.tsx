"use client";

import Link from "next/link";
import { Brain, Star, Tag, FolderOpen } from "lucide-react";
import { useMemoryStore } from "@/store/memory-store";
import { useCategoriesStore } from "@/store/categories-store";

const stats = [
  {
    label: "Total Memories",
    icon: Brain,
    color: "bg-blue-500/10 text-blue-500",
    href: "/",
  },
  {
    label: "Favorites",
    icon: Star,
    color: "bg-amber-500/10 text-amber-500",
    href: "/favorites",
  },
  {
    label: "Collections",
    icon: FolderOpen,
    color: "bg-violet-500/10 text-violet-500",
    href: "/categories",
  },
  {
    label: "Tags Used",
    icon: Tag,
    color: "bg-emerald-500/10 text-emerald-500",
    href: "/categories",
  },
];

export function StatsCards() {
  const { memories, totalCount, getDerivedTags } = useMemoryStore();
  const { categories } = useCategoriesStore();

  const derivedTags = getDerivedTags();
  const values = [
    totalCount,
    memories.filter((m) => m.isFavorite).length,
    categories.length,
    derivedTags.length,
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <Link
          key={stat.label}
          href={stat.href}
          className="flex items-center gap-4 p-4 rounded-xl border bg-card transition-all hover:bg-accent hover:border-primary/40 hover:shadow-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <div
            className={`size-10 rounded-lg ${stat.color} flex items-center justify-center`}
          >
            <stat.icon className="size-5" />
          </div>
          <div>
            <p className="text-2xl font-bold">{values[index]}</p>
            <p className="text-sm text-muted-foreground">{stat.label}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
