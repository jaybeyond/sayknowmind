//! Document deletion handlers.
//!
//! | Sub-module | Responsibility                                    |
//! |------------|---------------------------------------------------|
//! | `single`   | Delete a single document by ID (cascade cleanup)  |
//! | `bulk`     | Delete all documents (bulk clear with skip logic)  |
//! | `impact`   | Read-only deletion impact preview                 |

mod bulk;
mod impact;
mod single;

pub use bulk::*;
pub use impact::*;
pub use single::*;
