//! Startup / shutdown lifecycle.
//!
//! Covers the "启停" contract: the server serves, `Handle::shutdown` stops it,
//! the port is released, and a second server starts on the same port.

use std::time::Duration;

use clover_server::{bind, start_with_listener, Config, CorsPolicy, Handle, PortPolicy};

fn config(port: u16) -> Config {
    Config {
        host: "127.0.0.1".to_string(),
        port,
        port_policy: PortPolicy::Strict,
        readonly: false,
        cors: CorsPolicy::AllowAny,
        static_dir: None,
        state_dir: None,
        home_dir: None,
        warmup_agents: false,
    }
}

/// Ask the OS for an unused port.
fn free_port() -> u16 {
    bind("127.0.0.1", 0, PortPolicy::Strict)
        .expect("bind ephemeral port")
        .local_addr()
        .expect("local addr")
        .port()
}

async fn start_on(port: u16) -> Handle {
    let listener = bind("127.0.0.1", port, PortPolicy::Strict).expect("bind test port");
    start_with_listener(listener, config(port))
        .await
        .expect("start server")
}

/// Poll until the port refuses connections.
async fn assert_port_released(port: u16) {
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err()
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("port {port} is still accepting connections after shutdown");
}

#[tokio::test]
async fn serves_then_stops_and_restarts_on_the_same_port() {
    let port = free_port();
    assert_ne!(port, 0);

    // --- first run -------------------------------------------------------
    let server = start_on(port).await;
    assert_eq!(server.port(), port);
    assert_eq!(server.addr().ip().to_string(), "127.0.0.1");

    {
        let client = reqwest::Client::new();

        let health: serde_json::Value = client
            .get(format!("http://127.0.0.1:{port}/api/local/health"))
            .send()
            .await
            .expect("health request")
            .json()
            .await
            .expect("health json");
        assert_eq!(health["status"], "ok");
        assert_eq!(health["readonly"], false);

        let token_body: serde_json::Value = client
            .get(format!("http://127.0.0.1:{port}/api/local/auth/token"))
            .send()
            .await
            .expect("token request")
            .json()
            .await
            .expect("token json");
        let token = token_body["token"].as_str().expect("token").to_string();
        assert!(!token.is_empty());

        // Protected route: 401 without a token, 501 (placeholder) with one.
        let unauthorized = client
            .post(format!("http://127.0.0.1:{port}/api/local/scan"))
            .json(&serde_json::json!({ "path": "." }))
            .send()
            .await
            .expect("scan without token");
        assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);
        let body: serde_json::Value = unauthorized.json().await.expect("error json");
        assert_eq!(body["success"], false);
        assert_eq!(body["message"], "Unauthorized");

        let authorized = client
            .post(format!("http://127.0.0.1:{port}/api/local/scan"))
            .bearer_auth(&token)
            .json(&serde_json::json!({ "path": "." }))
            .send()
            .await
            .expect("scan with token");
        assert_eq!(authorized.status(), reqwest::StatusCode::OK);
        let body: serde_json::Value = authorized.json().await.expect("scan json");
        assert_eq!(body["success"], true);
        assert_eq!(body["type"], "file-service");
        assert_eq!(body["data"]["kind"], "directory");
    }

    server.shutdown().await;
    assert_port_released(port).await;

    // --- second run on the same port ------------------------------------
    let server = start_on(port).await;
    {
        let client = reqwest::Client::new();
        let response = client
            .get(format!("http://127.0.0.1:{port}/api/local/health"))
            .send()
            .await
            .expect("health request after restart");
        assert!(response.status().is_success());
    }
    server.shutdown().await;
    assert_port_released(port).await;
}

#[tokio::test]
async fn strict_policy_fails_on_a_busy_port() {
    let port = free_port();
    let _held = bind("127.0.0.1", port, PortPolicy::Strict).expect("hold port");
    let error = bind("127.0.0.1", port, PortPolicy::Strict).expect_err("must fail");
    assert_eq!(error.kind(), std::io::ErrorKind::AddrInUse);
}

#[tokio::test]
async fn next_free_policy_moves_to_another_port() {
    let port = free_port();
    let _held = bind("127.0.0.1", port, PortPolicy::Strict).expect("hold port");

    let listener = bind("127.0.0.1", port, PortPolicy::NextFree).expect("fallback bind");
    let chosen = listener.local_addr().expect("addr").port();
    assert_ne!(chosen, port);
    assert!(chosen > port);
}