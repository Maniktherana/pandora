fn main() {
    tauri_build::build();

    let target = std::env::var("TARGET").unwrap_or_default();
    if target.as_str() != "aarch64-apple-darwin" {
        return;
    }

    println!("cargo:rerun-if-changed=src/native_terminal_view.m");
    println!("cargo:rerun-if-changed=vendor/libghostty/ghostty.h");

    cc::Build::new()
        .file("src/native_terminal_view.m")
        .include("vendor/libghostty")
        .flag("-fobjc-arc")
        .compile("pandora_terminal_view");

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    println!(
        "cargo:rustc-link-search=native={}/vendor/libghostty",
        manifest_dir
    );
    println!("cargo:rustc-link-lib=static=ghostty");

    for fw in [
        "Metal",
        "MetalKit",
        "QuartzCore",
        "Carbon",
        "CoreFoundation",
        "CoreGraphics",
        "IOSurface",
        "IOKit",
        "CoreText",
        "Foundation",
        "AppKit",
    ] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }

    println!("cargo:rustc-link-lib=c++");
}
