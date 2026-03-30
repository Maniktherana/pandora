fn main() {
    tauri_build::build();
    println!("cargo:rerun-if-changed=src/native_terminal_view.m");
    println!("cargo:rerun-if-changed=vendor/libghostty/ghostty.h");

    cc::Build::new()
        .file("src/native_terminal_view.m")
        .include("vendor/libghostty")
        .flag("-fobjc-arc")
        .compile("pandora_terminal_view");

    // Link the vendored libghostty static library
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    println!(
        "cargo:rustc-link-search=native={}/vendor/libghostty",
        manifest_dir
    );
    println!("cargo:rustc-link-lib=static=ghostty");

    // Link required macOS system frameworks
    let frameworks = [
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
    ];
    for framework in &frameworks {
        println!("cargo:rustc-link-lib=framework={}", framework);
    }

    // Link C++ standard library
    println!("cargo:rustc-link-lib=c++");
}
