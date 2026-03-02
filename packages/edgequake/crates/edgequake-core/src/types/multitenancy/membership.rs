//! Membership and role types for tenant/workspace access control.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// A user's membership in a tenant/workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Membership {
    /// Unique membership identifier.
    pub membership_id: Uuid,
    /// User ID (from auth system).
    pub user_id: Uuid,
    /// Tenant ID.
    pub tenant_id: Uuid,
    /// Optional workspace ID (None = all workspaces in tenant).
    pub workspace_id: Option<Uuid>,
    /// Role within the tenant/workspace.
    pub role: MembershipRole,
    /// Whether the membership is active.
    pub is_active: bool,
    /// When the user joined.
    pub joined_at: chrono::DateTime<chrono::Utc>,
    /// Custom metadata.
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Membership {
    /// Create a new membership.
    pub fn new(user_id: Uuid, tenant_id: Uuid, role: MembershipRole) -> Self {
        Self {
            membership_id: Uuid::new_v4(),
            user_id,
            tenant_id,
            workspace_id: None,
            role,
            is_active: true,
            joined_at: chrono::Utc::now(),
            metadata: HashMap::new(),
        }
    }

    /// Scope membership to a specific workspace.
    pub fn for_workspace(mut self, workspace_id: Uuid) -> Self {
        self.workspace_id = Some(workspace_id);
        self
    }

    /// Check if user has at least the given role.
    pub fn has_role(&self, required: MembershipRole) -> bool {
        self.role.level() >= required.level()
    }

    /// Check if user can access a specific workspace.
    pub fn can_access_workspace(&self, workspace_id: &Uuid) -> bool {
        if !self.is_active {
            return false;
        }
        // None = access to all workspaces
        self.workspace_id.is_none() || self.workspace_id.as_ref() == Some(workspace_id)
    }
}

/// Roles for tenant/workspace membership.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum MembershipRole {
    /// Read-only access.
    Readonly,
    /// Standard member (read/write).
    #[default]
    Member,
    /// Administrator (can manage users).
    Admin,
    /// Owner (full control, can delete tenant).
    Owner,
}

impl MembershipRole {
    /// Get the permission level (higher = more permissions).
    pub fn level(&self) -> u8 {
        match self {
            MembershipRole::Readonly => 1,
            MembershipRole::Member => 2,
            MembershipRole::Admin => 3,
            MembershipRole::Owner => 4,
        }
    }

    /// Check if this role can write data.
    pub fn can_write(&self) -> bool {
        matches!(
            self,
            MembershipRole::Member | MembershipRole::Admin | MembershipRole::Owner
        )
    }

    /// Check if this role can manage users.
    pub fn can_manage_users(&self) -> bool {
        matches!(self, MembershipRole::Admin | MembershipRole::Owner)
    }

    /// Check if this role can delete the tenant.
    pub fn can_delete_tenant(&self) -> bool {
        matches!(self, MembershipRole::Owner)
    }
}

impl std::fmt::Display for MembershipRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MembershipRole::Readonly => write!(f, "readonly"),
            MembershipRole::Member => write!(f, "member"),
            MembershipRole::Admin => write!(f, "admin"),
            MembershipRole::Owner => write!(f, "owner"),
        }
    }
}

impl std::str::FromStr for MembershipRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "readonly" => Ok(MembershipRole::Readonly),
            "member" => Ok(MembershipRole::Member),
            "admin" => Ok(MembershipRole::Admin),
            "owner" => Ok(MembershipRole::Owner),
            _ => Err(format!("Unknown role: {}", s)),
        }
    }
}
