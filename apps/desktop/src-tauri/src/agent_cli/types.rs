use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentHookEnvelope {
    pub runtime_id: String,
    pub slot_id: String,
    pub source: String,
    #[serde(default)]
    pub payload_base64: Option<String>,
}
