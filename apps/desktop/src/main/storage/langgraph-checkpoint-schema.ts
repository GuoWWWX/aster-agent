/** Versioned graph channels shared by the unified and standalone checkpoint stores. */
export const LANGGRAPH_CHECKPOINT_BLOBS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS langgraph_checkpoint_blobs (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL,
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    value_type TEXT NOT NULL,
    value_blob BLOB NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
  );
`;
