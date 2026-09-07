plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.moontv.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.moontv.tv"
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // ponytail: one self-signed key for everyone. Keystore is gitignored, so the
    // password below protects nothing that isn't already local. Keep the .keystore
    // file safe — lose it and friends must uninstall before they can update.
    signingConfigs {
        create("release") {
            storeFile = file("../moontv-tv.keystore")
            storePassword = "moontv"
            keyAlias = "moontv"
            keyPassword = "moontv"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// ponytail: no dependencies. Plain android.app.Activity + WebView covers all of it.
// Add AndroidX only if Phase 3 needs Media3/ExoPlayer.
