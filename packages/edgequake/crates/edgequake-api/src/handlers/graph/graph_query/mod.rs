//! REST query handlers for graph entities, labels, and nodes.
//!
//! | Sub-module   | Responsibility                           | Spec            |
//! |-------------|------------------------------------------|-----------------|
//! | `traversal` | Full graph traversal with timeout/fallback| UC0101, FEAT0601|
//! | `node`      | Single-node lookup by ID                 | —               |
//! | `search`    | Label + node search with neighbors       | —               |
//! | `popular`   | Popular labels + batch degree query      | —               |

mod node;
mod popular;
mod search;
mod traversal;

pub use node::*;
pub use popular::*;
pub use search::*;
pub use traversal::*;
