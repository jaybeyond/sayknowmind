//! Streaming query handler (SSE).
//!
//! @implements UC0203 (Stream Query Response)
//! @implements FEAT0404 (Query Streaming Endpoint)

use axum::{
    extract::State,
    response::sse::{Event, Sse},
    Json,
};
use futures::StreamExt;
use tracing::debug;

use crate::error::{ApiError, ApiResult};
use crate::middleware::TenantContext;
use crate::state::AppState;
use crate::validation::validate_query;
use edgequake_query::{QueryMode, QueryRequest as EngineQueryRequest};

use super::workspace_resolve::get_workspace;
pub use crate::handlers::query_types::StreamQueryRequest;

/// Execute a streaming query.
#[utoipa::path(
    post,
    path = "/api/v1/query/stream",
    tag = "Query",
    request_body = StreamQueryRequest,
    responses(
        (status = 200, description = "Streaming query started"),
        (status = 400, description = "Invalid query")
    )
)]
pub async fn stream_query(
    State(state): State<AppState>,
    tenant_ctx: TenantContext,
    Json(request): Json<StreamQueryRequest>,
) -> ApiResult<Sse<impl futures::Stream<Item = Result<Event, std::convert::Infallible>>>> {
    debug!(
        tenant_id = ?tenant_ctx.tenant_id,
        workspace_id = ?tenant_ctx.workspace_id,
        query = %request.query,
        "Executing streaming query with tenant context"
    );

    validate_query(&request.query, state.config.max_query_length)?;

    // Parse query mode
    let mode = request
        .mode
        .as_ref()
        .and_then(|m| QueryMode::parse(m))
        .unwrap_or(QueryMode::Hybrid);

    // Build engine query request with tenant context
    let mut engine_request = EngineQueryRequest::new(&request.query).with_mode(mode);

    // OODA-231.1: Fetch workspace to get correct tenant_id for data queries
    // WHY: Header tenant_id is for authentication (random UUID from frontend).
    // But the graph data was ingested with the workspace's actual tenant_id.
    let workspace = if let Some(ref workspace_id) = tenant_ctx.workspace_id {
        get_workspace(&state, workspace_id).await.ok().flatten()
    } else {
        None
    };

    // Use workspace's tenant_id for data queries, fall back to header tenant_id
    let data_tenant_id = workspace
        .as_ref()
        .map(|ws| ws.tenant_id.to_string())
        .or_else(|| tenant_ctx.tenant_id.clone());

    if let Some(ref tenant_id) = data_tenant_id {
        engine_request = engine_request.with_tenant_id(tenant_id.clone());
    }
    if let Some(ref workspace_id) = tenant_ctx.workspace_id {
        engine_request = engine_request.with_workspace_id(workspace_id.clone());
    }

    // Execute streaming query using SOTA engine (LightRAG-style)
    let stream = state
        .sota_engine
        .query_stream(engine_request)
        .await
        .map_err(|e| ApiError::Internal(format!("Streaming query failed: {}", e)))?;

    let sse_stream = stream.map(|res| match res {
        Ok(text) => Ok(Event::default().data(text)),
        Err(e) => Ok(Event::default().data(format!("Error: {}", e))),
    });

    Ok(Sse::new(sse_stream))
}
