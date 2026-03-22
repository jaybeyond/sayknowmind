"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { toast } from "sonner";
import { Download, Trash2, Shield, Loader2 } from "lucide-react";

export function PrivacyTab() {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/documents?limit=10000");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sayknowmind-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data exported");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to delete your account? This action cannot be undone."
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await fetch("/api/user/me", { method: "DELETE" });
      if (res.ok) {
        await signOut();
        router.push("/login");
      } else {
        toast.error("Failed to delete account");
      }
    } catch {
      toast.error("Failed to delete account");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Shield className="size-4" />
            Private Mode
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            OS-level network isolation for sensitive data
          </p>
        </div>
        <div className="rounded-xl border border-border p-4 bg-muted/30">
          <p className="text-sm text-muted-foreground">
            Coming soon in a future release. Private mode will enable full
            network isolation for sensitive browsing sessions.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Export data</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Download all your bookmarks and documents as JSON
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          {exporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Export data
        </Button>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-destructive">Danger zone</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Permanently delete your account and all associated data
          </p>
        </div>
        <div className="rounded-xl border border-destructive/30 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground">
                This action is irreversible
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete account
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
