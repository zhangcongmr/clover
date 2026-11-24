//! HTTP / WebSocket route table.
//!
//! One module per migrated surface. The public routing table stays identical to
//! `packages/server`:
//!
//! | module | prefix | batch |
//! |---|---|---|
//! | [`local`]   | `/api/local`, `/ws/*` | P0 (health/token) / P1 (files, ws) |
//! | `mcp`       | `/api/mcp`   | P2 |
//! | `skills`    | `/api/skills`| P3 |
//! | `acp`       | `/api/acp`   | P4/P5 |
//! | `projects`  | `/api/projects`, `/api/tasks` | P6 |
//! | `a2a`       | `/a2a`, `/api/a2a` | P8 |

pub mod acp;
pub mod a2a;
pub mod local;
pub mod mcp;
pub mod projects;
pub mod skills;
pub mod ws;