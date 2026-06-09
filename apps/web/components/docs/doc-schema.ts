import { BlockNoteSchema, defaultBlockSpecs, type Block } from "@blocknote/core";
import { mindmapBlockSpec } from "./mindmap-block";
import { htmlBlockSpec } from "./html-block";

// ── Shared document schema ────────────────────────────────────────────────────
// Extends the default BlockNote schema with our custom inline blocks (mindmap,
// embedded HTML). Both editors (single-user and collab) must use this same
// schema instance so the block types are consistently recognised everywhere.
export const docSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, mindmap: mindmapBlockSpec, html: htmlBlockSpec },
});

// Convenience type alias — use DocBlock wherever doc-tabs.tsx previously used Block.
export type DocBlock = Block<
  typeof docSchema.blockSchema,
  typeof docSchema.inlineContentSchema,
  typeof docSchema.styleSchema
>;
