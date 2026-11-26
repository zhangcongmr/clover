//! Build helper for the optional `web-ui` feature.
//!
//! `rust-embed` needs the `web/` folder to exist at compile time, even when it
//! is empty (a fresh checkout that has not run `stage-web.mjs`). Creating it
//! here keeps `cargo build --features web-ui` working; the runtime then serves
//! a short "not embedded" page instead of failing to compile.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    if std::env::var_os("CARGO_FEATURE_WEB_UI").is_none() {
        return;
    }

    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo"),
    );
    let web = manifest_dir.join("web");
    if let Err(error) = std::fs::create_dir_all(&web) {
        println!("cargo:warning=could not create {}: {error}", web.display());
    }
    println!("cargo:rerun-if-changed={}", web.display());
}
